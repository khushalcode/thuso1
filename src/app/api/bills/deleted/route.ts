import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getShopId } from '@/lib/shop-context'

// GET /api/bills/deleted?from=&to=
//
// Bill deletion has been REMOVED from the entire system per user request
// ("puro bill delete system hatai d"). This endpoint is kept for
// backward-compat with the Money Out / Dashboard / Reports pages so they
// don't crash on older builds — but it now always returns an empty list
// and zero totals because no bills can ever be deleted going forward.
export async function GET(req: NextRequest) {
  const shopId = getShopId(req)
  if (!shopId) return NextResponse.json({ error: 'Shop ID required' }, { status: 400 })

  return NextResponse.json({
    items: [],
    totals: { count: 0, total: 0 },
  })
}
