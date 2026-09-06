import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getShopId } from '@/lib/shop-context'

// GET /api/bills/next-no — get the next bill number for the current shop.
//
// Bill numbering resets DAILY to 1000 (per user requirement:
// "every day bill start with 1000"). The bill number for an order is the
// SAME as that order's KOT number — assigned the first time a KOT is
// printed for the order (see orders.assignKotNumber in client-data.ts).
//
// This endpoint is used to PREVIEW the next bill number on the billing
// dialog header. The actual billNo used at bill-create time comes from
// the order's assigned KOT number, so this preview is best-effort.
export async function GET(req: Request) {
  const shopId = getShopId(req as any)
  if (!shopId) return NextResponse.json({ error: 'Shop ID required' }, { status: 400 })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Last bill number paid TODAY — if there are none yet today, we start
  // fresh at 1000.
  const last = await db.bill.findFirst({
    where: { shopId, paidAt: { gte: today } },
    orderBy: { billNo: 'desc' },
  })
  const nextNo = last ? last.billNo + 1 : 1000
  return NextResponse.json({ nextNo })
}
