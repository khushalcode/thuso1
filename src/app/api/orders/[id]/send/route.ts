import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

// POST /api/orders/[id]/send
// Mark the order as "sent" so the kitchen sees it as a KOT.
// Also marks kotPrinted=true (counter just printed it).
//
// ─── Re-print tracking ──────────────────────────────────────────────────
// Per user requirement:
//   • First KOT print  → print ALL active items
//   • Subsequent prints → print only items added since the last print
//
// We persist a `kotPrinted` boolean on each OrderItem row. The first time
// /send is called for an order, every active item is stamped kotPrinted=true
// and returned to the cashier as `printedItems` (the cashier renders the
// full receipt). On subsequent calls, only items where kotPrinted=false are
// returned as `printedItems` and then stamped true — so the cashier's
// re-print only shows what was newly added.
//
// This survives page reloads / table-close-and-reopen, which the previous
// in-memory `printedItemIds` Set did not.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const order = await db.order.findUnique({ where: { id }, include: { items: true } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.items.length === 0) {
    return NextResponse.json({ error: 'Cannot send an empty order' }, { status: 400 })
  }

  // Decide which items to print:
  //   • If order has NEVER been KOT-printed (order.kotPrinted === false),
  //     print every active (non-cancelled) item — this is the first KOT.
  //   • Otherwise, only items that have not yet been kotPrinted.
  //     (These are the items added since the last print.)
  const isFirstPrint = !order.kotPrinted
  const itemsToPrint = isFirstPrint
    ? order.items.filter((i) => i.status !== 'cancelled')
    : order.items.filter((i) => i.status !== 'cancelled' && !i.kotPrinted)

  // Stamp every item we're about to print as kotPrinted=true so the next
  // call won't re-print them.
  if (itemsToPrint.length > 0) {
    await db.orderItem.updateMany({
      where: { id: { in: itemsToPrint.map((i) => i.id) } },
      data: { kotPrinted: true },
    })
  }

  const updated = await db.order.update({
    where: { id },
    data: {
      // Only flip open → sent on the FIRST print. Re-prints keep the
      // existing status (so a "preparing" order doesn't regress to "sent").
      status: order.status === 'open' ? 'sent' : order.status,
      kotPrinted: body.kotPrinted !== false ? true : order.kotPrinted,
    },
    include: { items: true, table: true },
  })

  return NextResponse.json({
    order: updated,
    printedItems: itemsToPrint,
    isFirstPrint,
  })
}
