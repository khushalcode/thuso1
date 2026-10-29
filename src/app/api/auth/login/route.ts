import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

// POST /api/auth/login — validate credentials, return user + accessible shops
//
// Password-only login: if `email` is omitted/empty, match ANY active user
// whose password equals the supplied value. The login screen no longer
// collects an email field.
export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  if (!password) {
    return NextResponse.json({ error: 'Password required' }, { status: 400 })
  }

  let user
  if (email && String(email).trim().length > 0) {
    user = await db.appUser.findUnique({
      where: { email: String(email).toLowerCase().trim() },
      include: { shop: true },
    })
  } else {
    // Password-only: pick the first active user with this password.
    user = await db.appUser.findFirst({
      where: { password, active: true },
      include: { shop: true },
    })
  }

  if (!user || !user.active) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  if (user.password !== password) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  // Determine accessible shops
  let shops: any[] = []
  if (user.shopId) {
    shops = [user.shop]
  } else {
    // Super admin — access all shops
    shops = await db.shop.findMany({ where: { active: true }, orderBy: { name: 'asc' } })
  }

  // Audit log
  await logAudit({
    shopId: user.shopId,
    userId: user.id,
    userName: user.name,
    userRole: user.role,
    action: 'login',
    details: { email: user.email },
    ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
  })

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
    },
    shops: shops.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      color: s.color,
      address: s.address,
      phone: s.phone,
      gstin: s.gstin,
      taxRate: s.taxRate,
      currency: s.currency,
    })),
  })
}
