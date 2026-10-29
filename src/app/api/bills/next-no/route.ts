import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getShopId } from '@/lib/shop-context'

// GET /api/bills/next-no — get the next bill number for the current shop.
//
// CRITICAL DAY-2 FIX: Bill numbers are now a GLOBAL per-shop sequence
// (no daily reset). Previously they reset to 1000 every day, which
// combined with the UNIQUE(shopId, billNo) constraint caused the first
// INSERT of day 2 to collide with day 1's billNo=1000 row. We now
// monotonically increment the number forever.
//
// The bill number for an order is the SAME as that order's KOT number
// — assigned the first time a KOT is printed for the order (see
// orders.assignKotNumber in client-data.ts).
//
// This endpoint is used to PREVIEW the next bill number on the billing
// dialog header. The actual billNo used at bill-create time comes from
// the order's assigned KOT number, so this preview is best-effort.
export async function GET(req: Request) {
  const shopId = getShopId(req as any)
  if (!shopId) return NextResponse.json({ error: 'Shop ID required' }, { status: 400 })

  // Last bill number paid across ALL days — keeps counting up forever.
  const last = await db.bill.findFirst({
    where: { shopId },
    orderBy: { billNo: 'desc' },
  })
  const nextNo = last ? last.billNo + 1 : 1000
  return NextResponse.json({ nextNo })
}
