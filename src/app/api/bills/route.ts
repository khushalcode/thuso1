import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getShopId } from '@/lib/shop-context'

// GET /api/bills?from=&to=&table=&q=
export async function GET(req: NextRequest) {
  const shopId = getShopId(req)
  if (!shopId) return NextResponse.json({ error: 'Shop ID required' }, { status: 400 })

  const sp = req.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  const table = sp.get('table')
  const q = sp.get('q')

  const bills = await db.bill.findMany({
    where: {
      shopId,
      ...(from || to
        ? {
            paidAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
      ...(table ? { tableNumber: Number(table) } : {}),
    },
    include: { order: { include: { items: true } } },
    orderBy: { paidAt: 'desc' },
  })

  let filtered = bills
  if (q) {
    const term = q.toLowerCase()
    filtered = bills.filter(
      (b) =>
        String(b.billNo).includes(term) ||
        b.order.items.some((i) => i.name.toLowerCase().includes(term))
    )
  }

  const totalRevenue = filtered.reduce((s, b) => s + b.total, 0)
  const totalBills = filtered.length
  const byPayment = filtered.reduce<Record<string, number>>((acc, b) => {
    acc[b.paymentMode] = (acc[b.paymentMode] || 0) + b.total
    return acc
  }, {})

  return NextResponse.json({
    bills: filtered,
    summary: { totalRevenue, totalBills, byPayment },
  })
}

// POST /api/bills — generate a bill from an order
export async function POST(req: NextRequest) {
  const shopId = getShopId(req)
  if (!shopId) return NextResponse.json({ error: 'Shop ID required' }, { status: 400 })

  const body = await req.json()
  const { orderId, taxRate = 0, discount = 0, serviceCharge = 0, paymentMode = 'cash', customerName } = body

  const order = await db.order.findFirst({
    where: { id: orderId, shopId },
    include: { items: true, table: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status === 'paid') {
    return NextResponse.json({ error: 'Order already paid' }, { status: 400 })
  }

  const activeItems = order.items.filter((i) => i.status !== 'cancelled')
  const subtotal = activeItems.reduce((s, i) => s + i.price * i.quantity, 0)
  const taxAmount = subtotal * (Number(taxRate) / 100)
  const total = Math.max(0, subtotal + taxAmount + Number(serviceCharge) - Number(discount))

  // ─── Global per-shop bill number sequence ─────────────────────────────
  // CRITICAL DAY-2 FIX: Previously this reset bill numbers to 1000 every
  // day, which combined with the UNIQUE(shopId, billNo) constraint caused
  // the first INSERT of day 2 to collide with day 1's billNo=1000 row
  // and throw a constraint-violation. We now use a global per-shop
  // sequence (no daily reset) so the unique index can never conflict.
  // This mirrors the client-side fix in src/lib/client-data.ts.
  //
  // Prefer the order's pre-assigned KOT number when set (so the bill
  // number matches the KOT number that was already printed), falling
  // back to MAX(billNo)+1 otherwise.
  let billNo: number | undefined =
    (order.assignedBillNo && order.assignedBillNo > 0)
      ? Number(order.assignedBillNo)
      : undefined
  if (billNo === undefined) {
    const last = await db.bill.findFirst({
      where: { shopId },
      orderBy: { billNo: 'desc' },
    })
    billNo = last ? last.billNo + 1 : 1000
  }

  const bill = await db.$transaction(async (tx) => {
    const created = await tx.bill.create({
      data: {
        shopId,
        billNo,
        orderId,
        tableNumber: order.table.number,
        subtotal,
        taxRate: Number(taxRate),
        taxAmount,
        discount: Number(discount),
        serviceCharge: Number(serviceCharge),
        total,
        paymentMode,
        paymentStatus: 'paid',
        paidAt: new Date(),
      },
    })
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'paid',
        billPrinted: true,
        // Persist the customer name the cashier entered in the BillingDialog
        // (per user requirement: ask for customer name when generating the
        // first bill). We only overwrite if a non-empty name was supplied —
        // otherwise we keep whatever was already on the order (so a bill
        // re-issue can't accidentally wipe an existing customer name).
        ...(typeof customerName === 'string' && customerName.trim() !== ''
          ? { customerName: customerName.trim() }
          : {}),
      },
    })
    await tx.restaurantTable.update({
      where: { id: order.tableId },
      data: { status: 'available', currentOrderId: null },
    })
    return created
  })

  const full = await db.bill.findUnique({
    where: { id: bill.id },
    include: { order: { include: { items: true } } },
  })

  return NextResponse.json({ bill: full }, { status: 201 })
}
