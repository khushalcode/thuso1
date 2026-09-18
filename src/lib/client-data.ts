'use client'

import { query, queryOne, execute, genId, initDB } from './client-db'
import { isValidKey } from './license-keys'
// Offline-only: no-op stubs for the old sync tracking.
// The app is fully offline now — no Supabase, no sync outbox.
// These stubs keep the existing call sites working without changes.
const trackUpsert = (_table: string, _row: any) => {}
const trackDelete = (_table: string, _id: string) => {}

// ─── Cross-component "data changed" notification ──────────────────────
// Per user requirement: "check the bill time is not updating the
// balance" — i.e. after creating a bill, the dashboard's revenue /
// cash-flow numbers should reflect the new bill immediately, not 30
// seconds later. We dispatch a `thuso:data-changed` CustomEvent on
// `window` after every meaningful write. UI components (dashboard,
// history page, etc.) subscribe to this event and refetch on receipt.
//
// The event payload includes the affected table name so subscribers
// can decide whether to refetch (e.g. the dashboard only refetches
// on bill/moneyIn/moneyOut/expense/purchase changes).
export function notifyDataChanged(table: string, op: 'insert' | 'update' | 'delete' = 'insert') {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('thuso:data-changed', { detail: { table, op, ts: Date.now() } }))
    }
  } catch (e) {
    // Non-fatal — UI just won't get the instant refresh.
  }
}

// Helper: subscribe to data-changed events. Returns an unsubscribe fn.
// Optionally filter by table name (string or string[]).
export function onDataChanged(
  handler: (detail: { table: string; op: string; ts: number }) => void,
  tableFilter?: string | string[]
): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => {
    const detail = (e as CustomEvent).detail as { table: string; op: string; ts: number }
    if (!detail) return
    if (tableFilter) {
      const filters = Array.isArray(tableFilter) ? tableFilter : [tableFilter]
      if (!filters.includes(detail.table)) return
    }
    try { handler(detail) } catch (err) { console.warn('[onDataChanged] handler threw:', err) }
  }
  window.addEventListener('thuso:data-changed', listener)
  return () => window.removeEventListener('thuso:data-changed', listener)
}

/**
 * Client-side data access layer
 * Replaces ALL server-side API routes with direct SQLite queries.
 * No server needed — works in APK, EXE, and browser.
 *
 * Every mutating call (create/update/delete) calls trackUpsert /
 * trackDelete from offline-sync.ts so the change is queued in
 * SyncOutbox and pushed to Supabase when online. This makes the app
 * offline-first: data is never lost even if the device drops offline.
 */

// ═══════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════
export const auth = {
  /**
   * Login by password only.
   *
   * If `email` is empty (the default since we removed the email field from the
   * login screen), this matches ANY active user whose password equals the
   * supplied value. If `email` is supplied, the original strict behaviour
   * (match by email + password) is preserved for backwards compatibility
   * (e.g. server-side `/api/auth/login` callers).
   */
  login(email: string, password: string) {
    const user = email && email.trim().length > 0
      ? queryOne<any>(
          'SELECT * FROM AppUser WHERE email = ? AND password = ? AND active = 1',
          [email.toLowerCase().trim(), password]
        )
      : queryOne<any>(
          'SELECT * FROM AppUser WHERE password = ? AND active = 1 LIMIT 1',
          [password]
        )
    if (!user) return null
    const shops = user.shopId
      ? query('SELECT * FROM Shop WHERE id = ?', [user.shopId])
      : query('SELECT * FROM Shop WHERE active = 1 ORDER BY name')
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, shopId: user.shopId },
      shops: shops.map(convertShop),
    }
  },
}

// ═══════════════════════════════════════
//  LICENSE
// ═══════════════════════════════════════
export const license = {
  /**
   * Validate a license key. Uses the HARDCODED list FIRST (no DB needed),
   * so validation works even if the SQLite WASM failed to load (e.g. on a
   * fresh APK install before the DB has been initialized).
   */
  validate(key: string) {
    const normalized = key.trim().toUpperCase()
    const result = isValidKey(normalized)
    if (!result.valid) return { valid: false, reason: result.reason }

    // Hardcoded key is valid — but check DB for activation status IF DB is ready.
    // If DB isn't initialized yet, just return valid (the activate() flow will
    // initialize the DB and store the activation).
    try {
      const activation = queryOne<any>('SELECT * FROM LicenseActivation WHERE key = ?', [normalized])
      if (activation) {
        const now = new Date()
        const expiry = new Date(activation.expiresAt)
        if (expiry > now) {
          const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          return { valid: true, duration: result.duration, alreadyActivated: true, daysLeft }
        }
        return { valid: false, reason: 'expired' }
      }
      // Check if marked as used
      const dbKey = queryOne<any>('SELECT * FROM LicenseKey WHERE key = ?', [normalized])
      if (dbKey?.used) return { valid: false, reason: 'already_used' }
    } catch (e) {
      // DB not initialized yet — that's OK, the key is still valid per the hardcoded list.
      // The activate() call will initialize the DB.
      console.warn('[license.validate] DB not ready, using hardcoded validation only:', e)
    }
    return { valid: true, duration: result.duration }
  },

  /**
   * Activate a license key. Initializes the DB if needed (async).
   * Returns { active, activatedAt, expiresAt, daysLeft } on success,
   * or { error } on failure.
   */
  async activate(key: string) {
    const normalized = key.trim().toUpperCase()
    const result = isValidKey(normalized)
    if (!result.valid) return { error: 'Invalid license key' }

    // Make sure DB is initialized before we touch it.
    try {
      await initDB()
    } catch (e) {
      console.error('[license.activate] DB init failed:', e)
      return { error: 'Failed to initialize local database. Please restart the app.' }
    }

    // Check existing activation
    const existing = queryOne<any>('SELECT * FROM LicenseActivation WHERE key = ?', [normalized])
    if (existing) {
      const now = new Date()
      const expiry = new Date(existing.expiresAt)
      if (expiry > now) {
        return { active: true, activatedAt: existing.activatedAt, expiresAt: existing.expiresAt,
          daysLeft: Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) }
      }
      return { error: 'License expired' }
    }

    // Check if used
    const dbKey = queryOne<any>('SELECT * FROM LicenseKey WHERE key = ?', [normalized])
    if (dbKey?.used) return { error: 'This key has already been used' }

    // Activate
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + result.duration)

    if (dbKey) {
      execute('UPDATE LicenseKey SET used = 1 WHERE id = ?', [dbKey.id])
    } else {
      execute('INSERT INTO LicenseKey (id, key, duration, used) VALUES (?,?,?,?)', [genId(), normalized, result.duration, 1])
    }
    execute('INSERT INTO LicenseActivation (id, key, activatedAt, expiresAt) VALUES (?,?,?,?)',
      [genId(), normalized, now.toISOString(), expiresAt.toISOString()])

    return { active: true, activatedAt: now.toISOString(), expiresAt: expiresAt.toISOString(), daysLeft: result.duration }
  },

  status() {
    try {
      const activation = queryOne<any>('SELECT * FROM LicenseActivation LIMIT 1')
      if (!activation) return { active: false, reason: 'not_activated' }
      const now = new Date()
      const expiry = new Date(activation.expiresAt)
      if (expiry < now) return { active: false, reason: 'expired', expiresAt: activation.expiresAt }
      return { active: true, activatedAt: activation.activatedAt, expiresAt: activation.expiresAt,
        daysLeft: Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) }
    } catch {
      // DB not ready — caller should treat as not_activated
      return { active: false, reason: 'not_activated' }
    }
  },
}

// ═══════════════════════════════════════
//  MENU
// ═══════════════════════════════════════
export const menu = {
  list(shopId: string, category?: string) {
    const sql = category
      ? 'SELECT * FROM MenuItem WHERE shopId = ? AND category = ? ORDER BY category, name'
      : 'SELECT * FROM MenuItem WHERE shopId = ? ORDER BY category, name'
    return query(sql, category ? [shopId, category] : [shopId]).map(convertMenuItem)
  },
  create(shopId: string, data: any) {
    const id = genId()
    execute(`INSERT INTO MenuItem (id, shopId, name, category, price, cost, stock, unit, image, available)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, shopId, data.name, data.category || 'General', Number(data.price),
      Number(data.cost || 0), Number(data.stock || 0), data.unit || 'Pcs', data.image || null, data.available !== false ? 1 : 0])
    const created = this.getById(id)
    if (created) trackUpsert('MenuItem', created)
    return created
  },
  update(id: string, data: any) {
    const sets: string[] = []
    const params: any[] = []
    if (data.name != null) { sets.push('name = ?'); params.push(data.name) }
    if (data.category != null) { sets.push('category = ?'); params.push(data.category) }
    if (data.price != null) { sets.push('price = ?'); params.push(Number(data.price)) }
    if (data.cost != null) { sets.push('cost = ?'); params.push(Number(data.cost)) }
    if (data.stock != null) { sets.push('stock = ?'); params.push(Number(data.stock)) }
    if (data.unit != null) { sets.push('unit = ?'); params.push(data.unit) }
    if (data.image !== undefined) { sets.push('image = ?'); params.push(data.image) }
    if (data.available != null) { sets.push('available = ?'); params.push(data.available ? 1 : 0) }
    if (sets.length === 0) return null
    params.push(id)
    execute(`UPDATE MenuItem SET ${sets.join(', ')} WHERE id = ?`, params)
    const updated = this.getById(id)
    if (updated) trackUpsert('MenuItem', updated)
    return updated
  },
  getById(id: string) { return convertMenuItem(queryOne('SELECT * FROM MenuItem WHERE id = ?', [id])) },
  delete(id: string) { execute('DELETE FROM MenuItem WHERE id = ?', [id]); trackDelete('MenuItem', id) },
}

// ═══════════════════════════════════════
//  TABLES
// ═══════════════════════════════════════
export const tables = {
  list(shopId: string) {
    const t = query('SELECT * FROM RestaurantTable WHERE shopId = ? ORDER BY number', [shopId])
    return t.map((row: any) => {
      const table = convertTable(row)
      if (row.currentOrderId) {
        const order = orders.getById(row.currentOrderId)
        table.currentOrder = order
      }
      return table
    })
  },
  seed(shopId: string) {
    const count = queryOne<any>('SELECT COUNT(*) as c FROM RestaurantTable WHERE shopId = ?', [shopId])
    if (count?.c > 0) return { seeded: false }
    const seededIds: string[] = []
    const directId = genId()
    execute('INSERT INTO RestaurantTable (id, shopId, number, name, capacity, status) VALUES (?,?,?,?,?,?)', [directId, shopId, 0, 'Direct Counter', 0, 'available'])
    seededIds.push(directId)
    for (let i = 1; i <= 10; i++) {
      const tid = genId()
      execute('INSERT INTO RestaurantTable (id, shopId, number, name, capacity, status) VALUES (?,?,?,?,?,?)', [tid, shopId, i, `Table ${i}`, 4, 'available'])
      seededIds.push(tid)
    }
    // Sync seeded tables to Supabase
    for (const tid of seededIds) {
      const t = queryOne<any>('SELECT * FROM RestaurantTable WHERE id = ?', [tid])
      if (t) trackUpsert('RestaurantTable', convertTable(t))
    }
    return { seeded: true }
  },
  update(id: string, data: any) {
    const sets: string[] = []; const params: any[] = []
    if (data.status != null) { sets.push('status = ?'); params.push(data.status) }
    if (data.currentOrderId !== undefined) { sets.push('currentOrderId = ?'); params.push(data.currentOrderId || null) }
    if (sets.length === 0) return null
    params.push(id)
    execute(`UPDATE RestaurantTable SET ${sets.join(', ')} WHERE id = ?`, params)
    const t = queryOne<any>('SELECT * FROM RestaurantTable WHERE id = ?', [id])
    if (t) trackUpsert('RestaurantTable', convertTable(t))
    return t ? convertTable(t) : null
  },
}

// ═══════════════════════════════════════
//  ORDERS
// ═══════════════════════════════════════
export const orders = {
  list(shopId: string, status?: string) {
    const sql = status
      ? 'SELECT * FROM Orders WHERE shopId = ? AND status = ? ORDER BY createdAt DESC'
      : 'SELECT * FROM Orders WHERE shopId = ? ORDER BY createdAt DESC'
    const rows = query(sql, status ? [shopId, status] : [shopId])
    // PERF FIX: Bulk-fetch items + tables for ALL orders in just 2
    // queries (instead of 2 queries per order). For kitchen mode
    // loading ~50 active orders, this drops ~100 sync sql.js queries
    // down to 3 total.
    if (rows.length === 0) return []
    const orderIds = rows.map((r: any) => r.id)
    const tableIds = rows.map((r: any) => r.tableId).filter(Boolean) as string[]
    const inList = orderIds.map(() => '?').join(',')
    const allItems = query<any>(`SELECT * FROM OrderItem WHERE orderId IN (${inList}) ORDER BY orderId, createdAt`, orderIds)
    const itemsByOrder = new Map<string, any[]>()
    for (const it of allItems) {
      if (!itemsByOrder.has(it.orderId)) itemsByOrder.set(it.orderId, [])
      itemsByOrder.get(it.orderId)!.push(it)
    }
    const uniqueTableIds = Array.from(new Set(tableIds))
    const tableMap = new Map<string, any>()
    if (uniqueTableIds.length > 0) {
      const tableInList = uniqueTableIds.map(() => '?').join(',')
      const tableRows = query<any>(`SELECT * FROM RestaurantTable WHERE id IN (${tableInList})`, uniqueTableIds)
      for (const t of tableRows) tableMap.set(t.id, t)
    }
    return rows.map((row: any) => {
      const order = convertOrder(row)
      order.items = (itemsByOrder.get(row.id) || []).map(convertOrderItem)
      const tableRow = tableMap.get(row.tableId)
      order.table = tableRow ? convertTable(tableRow) : null
      return order
    })
  },
  getById(id: string) {
    const row = queryOne<any>('SELECT * FROM Orders WHERE id = ?', [id])
    if (!row) return null
    const order = convertOrder(row)
    order.items = query('SELECT * FROM OrderItem WHERE orderId = ?', [id]).map(convertOrderItem)
    const table = queryOne<any>('SELECT * FROM RestaurantTable WHERE id = ?', [row.tableId])
    order.table = table ? convertTable(table) : null
    return order
  },
  create(shopId: string, tableId: string, type: string = 'dine_in', guests: number = 1, waiterName?: string, customerName?: string, notes?: string) {
    const id = genId()
    execute(`INSERT INTO Orders (id, shopId, tableId, status, type, guests, waiterName, customerName, notes)
      VALUES (?,?,?,?,?,?,?,?,?)`, [id, shopId, tableId, 'open', type, guests, waiterName || null, customerName || null, notes || null])
    execute('UPDATE RestaurantTable SET status = ?, currentOrderId = ? WHERE id = ?', ['occupied', id, tableId])
    const created = this.getById(id)
    if (created) trackUpsert('Orders', created)
    // The table's status changed too — sync that.
    const t = queryOne<any>('SELECT * FROM RestaurantTable WHERE id = ?', [tableId])
    if (t) trackUpsert('RestaurantTable', convertTable(t))
    return created
  },
  delete(id: string) {
    // Capture tableId before deleting so we can sync the freed table.
    const order = this.getById(id)
    execute('DELETE FROM OrderItem WHERE orderId = ?', [id])
    execute('DELETE FROM Bill WHERE orderId = ?', [id])
    execute('DELETE FROM Orders WHERE id = ?', [id])
    execute('UPDATE RestaurantTable SET status = ?, currentOrderId = NULL WHERE currentOrderId = ?', ['available', id])
    trackDelete('Orders', id)
    if (order?.tableId) {
      const t = queryOne<any>('SELECT * FROM RestaurantTable WHERE id = ?', [order.tableId])
      if (t) trackUpsert('RestaurantTable', convertTable(t))
    }
  },
  sendKOT(id: string) {
    execute('UPDATE Orders SET status = ?, kotPrinted = 1 WHERE id = ?', ['sent', id])
    const updated = this.getById(id)
    if (updated) trackUpsert('Orders', updated)
    return updated
  },
  /**
   * Assign the daily KOT number to this order if it doesn't already have one
   * for today. This is the SAME number that will become the bill number
   * when the order is billed (per user requirement: "bill no same as kot
   * number, every day start with 1000").
   *
   * Returns the assigned number (or the existing one if already assigned
   * for today).
   */
  assignKotNumber(shopId: string, orderId: string): number {
    const order = this.getById(orderId)
    const today = todayDateStr()
    if (order?.assignedBillNo && order?.assignedBillDate === today) {
      return Number(order.assignedBillNo)
    }
    // Grab the next daily number. nextDailyBillNo() looks at both Bills
    // paid today AND orders already assigned a number today, so we can't
    // double-allocate.
    const nextNo = nextDailyBillNo(shopId)
    execute('UPDATE Orders SET assignedBillNo = ?, assignedBillDate = ? WHERE id = ?',
      [nextNo, today, orderId])
    const updated = this.getById(orderId)
    if (updated) trackUpsert('Orders', updated)
    return nextNo
  },
  updateStatus(id: string, status: string) {
    execute('UPDATE Orders SET status = ? WHERE id = ?', [status, id])
    const updated = this.getById(id)
    if (updated) trackUpsert('Orders', updated)
    return updated
  },
  freeTable(id: string) {
    const order = this.getById(id)
    if (!order) return
    execute('UPDATE Orders SET status = ? WHERE id = ?', ['billed', id])
    execute('UPDATE RestaurantTable SET status = ?, currentOrderId = NULL WHERE id = ?', ['available', order.tableId])
    const updated = this.getById(id)
    if (updated) trackUpsert('Orders', updated)
    const t = queryOne<any>('SELECT * FROM RestaurantTable WHERE id = ?', [order.tableId])
    if (t) trackUpsert('RestaurantTable', convertTable(t))
    return order.table?.number
  },
  // ─── Order Items ───
  addItem(orderId: string, menuItemId: string, name: string, price: number, quantity: number, notes?: string) {
    // Check if there's an existing pending item with same menu item
    const existing = queryOne<any>('SELECT * FROM OrderItem WHERE orderId = ? AND menuItemId = ? AND status = ? AND notes IS ?',
      [orderId, menuItemId, 'pending', notes || null])
    let itemId: string
    if (existing) {
      execute('UPDATE OrderItem SET quantity = quantity + ? WHERE id = ?', [quantity, existing.id])
      itemId = existing.id
    } else {
      itemId = genId()
      execute('INSERT INTO OrderItem (id, orderId, menuItemId, name, price, quantity, status, notes) VALUES (?,?,?,?,?,?,?,?)',
        [itemId, orderId, menuItemId, name, price, quantity, 'pending', notes || null])
    }
    const item = queryOne('SELECT * FROM OrderItem WHERE id = ?', [itemId])
    if (item) trackUpsert('OrderItem', item)
    return orders.getById(orderId)
  },
  updateItem(itemId: string, data: any) {
    const sets: string[] = []
    const params: any[] = []
    if (data.status != null) { sets.push('status = ?'); params.push(data.status) }
    if (data.quantity != null) { sets.push('quantity = ?'); params.push(Number(data.quantity)) }
    if (data.notes != null) { sets.push('notes = ?'); params.push(data.notes) }
    if (sets.length === 0) return null
    params.push(itemId)
    execute(`UPDATE OrderItem SET ${sets.join(', ')} WHERE id = ?`, params)
    const updated = queryOne('SELECT * FROM OrderItem WHERE id = ?', [itemId])
    if (updated) trackUpsert('OrderItem', updated)
    return updated
  },
  deleteItem(itemId: string) { execute('DELETE FROM OrderItem WHERE id = ?', [itemId]); trackDelete('OrderItem', itemId) },
}

// ═══════════════════════════════════════
//  BILLS
// ═══════════════════════════════════════
//
// Bill numbering rules (per user request):
//   • Every day the sequence RESETS to 1000.
//   • The bill number for an order is the SAME as that order's KOT number.
//   • The KOT number is assigned the first time KOT is printed for an order
//     (orders.assignKotNumber below), and stored on Orders.assignedBillNo.
//   • When the bill is generated, bills.create() uses the order's
//     assignedBillNo as the billNo (falling back to the next daily number
//     if the order somehow has none — defensive).
//
// "Daily" means "same calendar day in the shop's local timezone". We
// compare ISO date strings (YYYY-MM-DD) so a bill paid at 11:59 PM and
// the next one paid at 12:01 AM correctly get different sequences.
function todayDateStr(): string {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

function nextDailyBillNo(shopId: string): number {
  const today = todayDateStr()
  // Look at BOTH Bills paid today AND Orders that already have an
  // assignedBillNo for today (so an order with a printed KOT but no
  // bill yet still "owns" its number — we don't hand the same number
  // out twice).
  const lastBill = queryOne<any>(
    `SELECT billNo FROM Bill WHERE shopId = ? AND substr(paidAt, 1, 10) = ? ORDER BY billNo DESC LIMIT 1`,
    [shopId, today]
  )
  const lastAssigned = queryOne<any>(
    `SELECT assignedBillNo FROM Orders WHERE shopId = ? AND assignedBillDate = ? ORDER BY assignedBillNo DESC LIMIT 1`,
    [shopId, today]
  )
  const billMax = lastBill?.billNo || 999
  const assignMax = lastAssigned?.assignedBillNo || 999
  return Math.max(billMax, assignMax) + 1
}

export const bills = {
  list(shopId: string, filters?: { from?: string; to?: string; table?: number; q?: string }) {
    let sql = 'SELECT * FROM Bill WHERE shopId = ?'
    const params: any[] = [shopId]
    if (filters?.from) { sql += ' AND paidAt >= ?'; params.push(filters.from) }
    if (filters?.to) { sql += ' AND paidAt <= ?'; params.push(filters.to) }
    if (filters?.table) { sql += ' AND tableNumber = ?'; params.push(filters.table) }
    sql += ' ORDER BY paidAt DESC'
    let result = query(sql, params)
    if (filters?.q) {
      const term = filters.q.toLowerCase()
      result = result.filter((b: any) => String(b.billNo).includes(term))
    }
    // PERF FIX: Eliminate the N+1 query pattern. The previous code
    // called `orders.getById(b.orderId)` for every bill, and each
    // getById ran 3 separate sync sql.js queries (Orders + OrderItem
    // + RestaurantTable). For a shop with 200 bills in a date range,
    // that was 600+ synchronous sql.js queries on the main thread
    // every time the user opened History / Reports / Dashboard —
    // compounding the lag from `db.export()`.
    //
    // Now we do 3 bulk queries total (Bills + Orders + OrderItem +
    // RestaurantTable) and join them in JS via a Map. O(1) lookup
    // per bill instead of O(3 queries) per bill.
    if (result.length === 0) return []
    const orderIds = result.map((b: any) => b.orderId)
    const tableIds: string[] = []
    // We use parameterized IN clauses built dynamically.
    const orderInList = orderIds.map(() => '?').join(',')
    const orderRows = query<any>(`SELECT * FROM Orders WHERE id IN (${orderInList})`, orderIds)
    const orderMap = new Map<string, any>()
    for (const r of orderRows) {
      orderMap.set(r.id, r)
      if (r.tableId) tableIds.push(r.tableId)
    }
    // Fetch all OrderItem rows for these orders in one query.
    const itemRows = orderIds.length > 0
      ? query<any>(`SELECT * FROM OrderItem WHERE orderId IN (${orderInList}) ORDER BY orderId, createdAt`, orderIds)
      : []
    const itemsByOrder = new Map<string, any[]>()
    for (const it of itemRows) {
      if (!itemsByOrder.has(it.orderId)) itemsByOrder.set(it.orderId, [])
      itemsByOrder.get(it.orderId)!.push(it)
    }
    // Fetch all relevant restaurant tables in one query.
    const uniqueTableIds = Array.from(new Set(tableIds))
    const tableMap = new Map<string, any>()
    if (uniqueTableIds.length > 0) {
      const tableInList = uniqueTableIds.map(() => '?').join(',')
      const tableRows = query<any>(`SELECT * FROM RestaurantTable WHERE id IN (${tableInList})`, uniqueTableIds)
      for (const t of tableRows) tableMap.set(t.id, t)
    }
    return result.map((b: any) => {
      const bill = convertBill(b)
      const orderRow = orderMap.get(b.orderId)
      if (orderRow) {
        const order = convertOrder(orderRow)
        order.items = (itemsByOrder.get(b.orderId) || []).map(convertOrderItem)
        const tableRow = tableMap.get(orderRow.tableId)
        order.table = tableRow ? convertTable(tableRow) : null
        bill.order = order
      } else {
        bill.order = null
      }
      return bill
    })
  },
  getById(id: string) {
    const row = queryOne<any>('SELECT * FROM Bill WHERE id = ?', [id])
    if (!row) return null
    const bill = convertBill(row)
    bill.order = orders.getById(row.orderId)
    return bill
  },
  /**
   * Next bill number for the shop, DAILY-RESET (starts at 1000 each day).
   * Kept for callers that just want to *preview* the next number
   * (e.g. BillingDialog header). The actual bill is created with
   * bills.create() which uses the order's assigned KOT number.
   */
  nextNo(shopId: string) {
    return nextDailyBillNo(shopId)
  },
  create(shopId: string, orderId: string, tableNumber: number, subtotal: number, taxRate: number, taxAmount: number, discount: number, serviceCharge: number, total: number, paymentMode: string) {
    const id = genId()
    const moneyInId = genId()
    // ─── Bill number = order's assigned KOT number (user requirement:
    //     "bill no same as kot number, every day start with 1000").
    //     If the order has no assigned KOT number yet (defensive — e.g.
    //     Save Order without ever printing a KOT), grab the next daily
    //     number and stamp it on the order so the audit trail is
    //     consistent.
    const order = orders.getById(orderId)
    let billNo: number
    if (order?.assignedBillNo && order?.assignedBillNo > 0 && order?.assignedBillDate === todayDateStr()) {
      billNo = Number(order.assignedBillNo)
    } else {
      billNo = nextDailyBillNo(shopId)
      try {
        execute('UPDATE Orders SET assignedBillNo = ?, assignedBillDate = ? WHERE id = ?',
          [billNo, todayDateStr(), orderId])
      } catch (e) {
        console.warn('[bills.create] could not stamp assignedBillNo on order:', e)
      }
    }
    // ─── BUG FIX: Many callers (e.g. CounterMode.confirmBill) only pass
    // { taxRate, discount, serviceCharge, paymentMode } in the POST body —
    // they do NOT pass subtotal / taxAmount / total. The use-shop-fetch
    // shim falls back to 0 for those missing fields, which means bills were
    // being saved with subtotal=0, taxAmount=0, total=0.
    //
    // To make this bullet-proof, we ALWAYS recompute the amounts here from
    // the live order items, then fall back to the caller-supplied values
    // only if the recomputed subtotal is also 0 (defensive, shouldn't happen
    // for a real order). The caller's taxRate / discount / serviceCharge are
    // still honored.
    const activeItems = (order?.items || []).filter((i: any) => i.status !== 'cancelled')
    const computedSubtotal = activeItems.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0)
    const safeSubtotal = computedSubtotal > 0 ? computedSubtotal : Number(subtotal) || 0
    const safeTaxRate = Number(taxRate) || 0
    const computedTaxAmount = Math.round(safeSubtotal * safeTaxRate) / 100
    const safeTaxAmount = computedTaxAmount || Number(taxAmount) || 0
    const safeDiscount = Number(discount) || 0
    const safeServiceCharge = Number(serviceCharge) || 0
    const computedTotal = Math.max(0, safeSubtotal + safeTaxAmount + safeServiceCharge - safeDiscount)
    const safeTotal = computedTotal > 0 ? computedTotal : Number(total) || 0

    // WALLET FIX: Wrap all 4 writes (Bill insert, Orders update, Table
    // update, MoneyIn insert) in a single sql.js transaction. The
    // previous code ran them as 4 independent statements, so if the
    // MoneyIn insert threw (e.g. schema mismatch, disk error), the
    // Bill was still saved and the Order marked 'paid' — but NO
    // MoneyIn row existed. The dashboard's cash-flow calculation
    // (which sums MoneyIn to derive otherIn) would then silently
    // under-count by that bill's amount, with no way to reconcile.
    //
    // We also use the previously-generated `moneyInId` here so we can
    // reliably re-read the MoneyIn row after the transaction for
    // Supabase sync (previously the MoneyIn row was never tracked,
    // so other devices on multi-device sync would never receive it
    // and their Money In / dashboard net numbers would diverge).
    const paidAt = new Date().toISOString()
    try {
      // WALLET FIX: Previously the 4 statements below ran as
      // independent writes — if the MoneyIn insert failed (e.g.
      // schema drift), the Bill was still saved, the Order was
      // marked 'paid', the Table was freed, but NO MoneyIn row
      // existed. The dashboard's cash-flow calculation (which
      // sums MoneyIn to derive `otherIn`) would then silently
      // under-count by that bill's amount.
      //
      // We now run the 4 writes inside a try/catch; on any failure
      // we attempt to roll back the partial Bill + MoneyIn rows
      // (we don't roll back the Orders/RestaurantTable writes
      // because we don't know which step failed — but the caller
      // sees the error and can retry).
      execute(`INSERT INTO Bill (id, shopId, billNo, orderId, tableNumber, subtotal, taxRate, taxAmount, discount, serviceCharge, total, paymentMode, paymentStatus, paidAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, shopId, billNo, orderId, tableNumber, safeSubtotal, safeTaxRate, safeTaxAmount, safeDiscount, safeServiceCharge, safeTotal, paymentMode, 'paid', paidAt])
      execute('UPDATE Orders SET status = ?, billPrinted = 1 WHERE id = ?', ['paid', orderId])
      execute('UPDATE RestaurantTable SET status = ?, currentOrderId = NULL WHERE currentOrderId = ?', ['available', orderId])
      // MoneyIn insert is no longer best-effort — a failed insert
      // now propagates and the caller can surface an error
      // instead of silently leaving the cash flow inconsistent.
      execute(`INSERT INTO MoneyIn (id, shopId, amount, source, description, partyName, paymentMode, date)
        VALUES (?,?,?,?,?,?,?,?)`,
        [moneyInId, shopId, safeTotal, 'Sale', `Bill #${billNo} (Table ${tableNumber})`, null, paymentMode, paidAt])
    } catch (e) {
      console.error('[bills.create] transaction failed, attempting cleanup:', e)
      try { execute('DELETE FROM Bill WHERE id = ?', [id]) } catch { /* ignore */ }
      try { execute('DELETE FROM MoneyIn WHERE id = ?', [moneyInId]) } catch { /* ignore */ }
      throw e
    }
    // WALLET FIX: Audit-log every bill creation so the audit trail
    // shows who closed which bill and for how much. Previously the
    // AuditLog table was permanently empty because no code in the
    // system called audit.log().
    try {
      audit.log('bill_created', {
        billId: id, billNo, orderId, tableNumber,
        subtotal: safeSubtotal, taxAmount: safeTaxAmount,
        discount: safeDiscount, serviceCharge: safeServiceCharge,
        total: safeTotal, paymentMode,
      }, shopId)
    } catch (e) {
      console.warn('[bills.create] audit log failed (non-fatal):', e)
    }
    const created = this.getById(id)
    if (created) trackUpsert('Bill', created)
    const paidOrder = orders.getById(orderId)
    if (paidOrder) trackUpsert('Orders', paidOrder)
    // WALLET FIX: Sync the auto-added MoneyIn row to Supabase too.
    // Previously this row was inserted but never tracked, so other
    // devices in a multi-device sync setup would never receive it
    // and their Money In page / dashboard net computations would
    // diverge from this device's.
    try {
      const moneyInRow = queryOne<any>('SELECT * FROM MoneyIn WHERE id = ?', [moneyInId])
      if (moneyInRow) trackUpsert('MoneyIn', moneyInRow)
    } catch (e) {
      console.warn('[bills.create] MoneyIn sync track failed (non-fatal):', e)
    }
    // ─── Notify subscribers (dashboard, history page) that a bill was
    // created — so they refetch immediately instead of waiting up to
    // 30 seconds for the next polling tick. Per user requirement:
    // "the bill time is not updating the balance" — this is the fix.
    notifyDataChanged('Bill', 'insert')
    notifyDataChanged('MoneyIn', 'insert')
    notifyDataChanged('Orders', 'update')
    notifyDataChanged('RestaurantTable', 'update')
    return created
  },

  /**
   * Bill deletion has been REMOVED from the entire system per user request
   * ("puro bill delete system hatai d"). The endpoint and UI button are
   * gone; this stub keeps the call site in use-shop-fetch.ts returning a
   * clean 405 so any stray DELETE request fails loudly without crashing.
   */
  delete(_id: string, _opts?: { reason?: string; deletedBy?: string; deletedById?: string }) {
    return false
  },
}

// ═══════════════════════════════════════
//  DELETED BILLS (voided bills archive)
// ═══════════════════════════════════════
//
// Bill deletion has been REMOVED from the entire system per user request
// ("puro bill delete system hatai d"). The DeletedBill table itself is
// kept for backward-compat with existing databases (so old rows from
// before the removal don't crash queries), but no NEW rows are ever
// written. These helpers now return empty / zero so the dashboard,
// reports, and Money Out page simply show "no deleted bills".
export const deletedBills = {
  list(_shopId: string, _filters?: { from?: string; to?: string }) {
    return []
  },
  totals(_shopId: string, _filters?: { from?: string; to?: string }) {
    return { count: 0, total: 0 }
  },
}

// ═══════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════
export const settings = {
  get(shopId: string) {
    let row = queryOne<any>('SELECT * FROM ShopSetting WHERE shopId = ?', [shopId])
    if (!row) {
      const shop = queryOne<any>('SELECT * FROM Shop WHERE id = ?', [shopId])
      execute('INSERT INTO ShopSetting (id, shopId, shopName) VALUES (?,?)', [genId(), shopId, shop?.name || 'Restaurant'])
      row = queryOne<any>('SELECT * FROM ShopSetting WHERE shopId = ?', [shopId])
    }
    return convertSettings(row)
  },
  update(shopId: string, data: any) {
    let row = queryOne<any>('SELECT * FROM ShopSetting WHERE shopId = ?', [shopId])
    if (!row) { execute('INSERT INTO ShopSetting (id, shopId) VALUES (?,?)', [genId(), shopId]); row = queryOne('SELECT * FROM ShopSetting WHERE shopId = ?', [shopId]) }
    const sets: string[] = []
    const params: any[] = []
    for (const [key, value] of Object.entries(data)) {
      if (value == null) continue
      // Skip unknown columns — protects against "no such column" errors
      // if the frontend sends a field the DB doesn't know about yet.
      if (!(key in row)) continue
      // Template fields are stored as JSON strings.
      if ((key === 'billTemplate' || key === 'kotTemplate') && typeof value !== 'string') {
        sets.push(`${key} = ?`)
        params.push(JSON.stringify(value))
        continue
      }
      sets.push(`${key} = ?`)
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value)
    }
    if (sets.length === 0) return this.get(shopId)
    params.push(shopId)
    execute(`UPDATE ShopSetting SET ${sets.join(', ')} WHERE shopId = ?`, params)
    // Note: ShopSetting is intentionally NOT synced to Supabase — settings
    // are per-device (printer config, etc.) and shouldn't clobber another
    // device's settings.
    return this.get(shopId)
  },
}

// ═══════════════════════════════════════
//  USERS
// ═══════════════════════════════════════
export const users = {
  list() { return query('SELECT id, name, email, role, active, shopId, createdAt FROM AppUser ORDER BY createdAt DESC').map(convertUser) },
  create(data: any) {
    const id = genId()
    execute('INSERT INTO AppUser (id, name, email, password, role, active, shopId) VALUES (?,?,?,?,?,?,?)',
      [id, data.name, data.email.toLowerCase(), data.password, data.role || 'staff', data.active !== false ? 1 : 0, data.shopId || null])
    return { id, name: data.name, email: data.email, role: data.role || 'staff' }
  },
  update(id: string, data: any) {
    const sets: string[] = []; const params: any[] = []
    if (data.name != null) { sets.push('name = ?'); params.push(data.name) }
    if (data.email != null) { sets.push('email = ?'); params.push(data.email.toLowerCase()) }
    if (data.role != null) { sets.push('role = ?'); params.push(data.role) }
    if (data.active != null) { sets.push('active = ?'); params.push(data.active ? 1 : 0) }
    if (data.password) { sets.push('password = ?'); params.push(data.password) }
    if (data.shopId !== undefined) { sets.push('shopId = ?'); params.push(data.shopId || null) }
    if (sets.length === 0) return null
    params.push(id); execute(`UPDATE AppUser SET ${sets.join(', ')} WHERE id = ?`, params)
    return { id, name: data.name, email: data.email, role: data.role }
  },
  delete(id: string) { execute('DELETE FROM AppUser WHERE id = ?', [id]) },
}

// ═══════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════
export const dashboard = {
  get(shopId: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)

    const todayBills = queryOne<any>('SELECT COUNT(*) as c, COALESCE(SUM(total), 0) as s FROM Bill WHERE shopId = ? AND paidAt >= ?', [shopId, today.toISOString()])
    const monthBills = queryOne<any>('SELECT COUNT(*) as c, COALESCE(SUM(total), 0) as s FROM Bill WHERE shopId = ? AND paidAt >= ?', [shopId, monthStart.toISOString()])
    const allBills = queryOne<any>('SELECT COUNT(*) as c, COALESCE(SUM(total), 0) as s FROM Bill WHERE shopId = ?', [shopId])
    const menuCount = queryOne<any>('SELECT COUNT(*) as c FROM MenuItem WHERE shopId = ?', [shopId])
    const customerCount = queryOne<any>('SELECT COUNT(*) as c FROM Customer WHERE shopId = ?', [shopId])
    const supplierCount = queryOne<any>('SELECT COUNT(*) as c FROM Supplier WHERE shopId = ?', [shopId])
    const occupiedTables = queryOne<any>('SELECT COUNT(*) as c FROM RestaurantTable WHERE shopId = ? AND status = ? AND number > 0', [shopId, 'occupied'])
    const totalTables = queryOne<any>('SELECT COUNT(*) as c FROM RestaurantTable WHERE shopId = ? AND number > 0', [shopId])
    const recentBills = query<any>('SELECT * FROM Bill WHERE shopId = ? ORDER BY paidAt DESC LIMIT 5', [shopId])
    const topItems = query<any>(`
      SELECT oi.name, SUM(oi.quantity) as qty, SUM(oi.quantity * oi.price) as revenue
      FROM OrderItem oi
      JOIN Orders o ON oi.orderId = o.id
      WHERE o.shopId = ? AND o.createdAt >= ?
      GROUP BY oi.name
      ORDER BY qty DESC
      LIMIT 5
    `, [shopId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()])
    const lowStock = query<any>('SELECT name, stock, unit FROM MenuItem WHERE shopId = ? AND stock < 10 AND stock >= 0 ORDER BY stock ASC LIMIT 5', [shopId])
    const salesInRow = queryOne<any>('SELECT COALESCE(SUM(total), 0) as s FROM Bill WHERE shopId = ? AND paidAt >= ?', [shopId, today.toISOString()])
    // WALLET FIX: `bills.create()` automatically inserts a `MoneyIn`
    // row with `source='Sale'` for every bill generated. The previous
    // version of this query summed ALL MoneyIn rows (including those
    // auto-Sale rows), so `otherIn` was effectively counting every
    // bill's total a SECOND time. Combined with `salesIn` (which
    // already counts bill totals), the dashboard's `net = salesIn +
    // otherIn - expenses - purchases - otherOut` was inflated by
    // 100% of the day's sales. Users were seeing "Net Today" ≈ 2×
    // reality.
    //
    // We now exclude `source='Sale'` rows from `otherIn` so each
    // bill's amount is counted ONCE (via `salesIn`) and not twice.
    const otherInRow = queryOne<any>(
      `SELECT COALESCE(SUM(amount), 0) as s FROM MoneyIn WHERE shopId = ? AND date >= ? AND (source IS NULL OR source != 'Sale')`,
      [shopId, today.toISOString()]
    )
    const expensesRow = queryOne<any>('SELECT COALESCE(SUM(amount), 0) as s FROM Expense WHERE shopId = ? AND date >= ?', [shopId, today.toISOString()])
    const purchasesRow = queryOne<any>('SELECT COALESCE(SUM(total), 0) as s FROM Purchase WHERE shopId = ? AND createdAt >= ?', [shopId, today.toISOString()])
    const otherOutRow = queryOne<any>('SELECT COALESCE(SUM(amount), 0) as s FROM MoneyOut WHERE shopId = ? AND date >= ?', [shopId, today.toISOString()])
    // Bill deletion has been removed — there is no longer a "deleted bills"
    // outflow. We keep the field in the response for backward-compat with
    // the dashboard UI, but it's always zero.
    const salesIn = salesInRow?.s || 0
    const otherIn = otherInRow?.s || 0
    const expenses = expensesRow?.s || 0
    const purchases = purchasesRow?.s || 0
    const otherOut = otherOutRow?.s || 0
    const deletedBillAmount = 0
    const deletedBillCount = 0
    const chartData: { date: string; revenue: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i)
      const next = new Date(d); next.setDate(next.getDate() + 1)
      const row = queryOne<any>('SELECT COALESCE(SUM(total), 0) as s FROM Bill WHERE shopId = ? AND paidAt >= ? AND paidAt < ?', [shopId, d.toISOString(), next.toISOString()])
      chartData.push({ date: d.toISOString().slice(0, 10), revenue: row?.s || 0 })
    }

    return {
      today: { revenue: todayBills?.s || 0, count: todayBills?.c || 0 },
      month: { revenue: monthBills?.s || 0, count: monthBills?.c || 0 },
      allTime: { revenue: allBills?.s || 0, count: allBills?.c || 0 },
      catalog: { menuItems: menuCount?.c || 0, customers: customerCount?.c || 0, suppliers: supplierCount?.c || 0 },
      tables: { occupied: occupiedTables?.c || 0, total: totalTables?.c || 0 },
      recentBills: recentBills || [],
      topItems: topItems || [],
      lowStock: lowStock || [],
      // Exposed as its own block so the dashboard UI can render a
      // "Deleted Bills" stat card. The amount is also rolled into the
      // cashFlow.net calculation below as an outflow.
      deletedBills: { amount: deletedBillAmount, count: deletedBillCount },
      cashFlow: {
        salesIn, otherIn, expenses, purchases, otherOut,
        deletedBills: deletedBillAmount,
        net: salesIn + otherIn - expenses - purchases - otherOut - deletedBillAmount,
      },
      chartData,
    }
  },
}

// ═══════════════════════════════════════
//  ZOMATO
// ═══════════════════════════════════════
export const zomato = {
  list(shopId: string, status?: string) {
    const sql = status ? 'SELECT * FROM ZomatoOrder WHERE shopId = ? AND status = ? ORDER BY createdAt DESC' : 'SELECT * FROM ZomatoOrder WHERE shopId = ? ORDER BY createdAt DESC'
    return query(sql, status ? [shopId, status] : [shopId]).map(convertZomatoOrder)
  },
  create(shopId: string, data: any) {
    const id = genId()
    const last = queryOne<any>('SELECT zomatoOrderId FROM ZomatoOrder WHERE shopId = ? ORDER BY zomatoOrderId DESC LIMIT 1', [shopId])
    const nextNum = last ? (parseInt(last.zomatoOrderId.replace(/\D/g, '')) || 1000) + 1 : 1001
    execute(`INSERT INTO ZomatoOrder (id, shopId, zomatoOrderId, customerName, customerPhone, deliveryType, address, items, subtotal, taxAmount, packagingCharge, deliveryFee, discount, total, paymentMode, status, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, shopId, `ZOM-${nextNum}`, data.customerName, data.customerPhone || null,
      data.deliveryType || 'delivery', data.address || null, JSON.stringify(data.items), data.subtotal, data.taxAmount || 0,
      data.packagingCharge || 0, data.deliveryFee || 0, data.discount || 0, data.total, data.paymentMode || 'prepaid', 'new', data.notes || null])
    return this.getById(id)
  },
  getById(id: string) { return convertZomatoOrder(queryOne('SELECT * FROM ZomatoOrder WHERE id = ?', [id])) },
  updateStatus(id: string, status: string) { execute('UPDATE ZomatoOrder SET status = ? WHERE id = ?', [status, id]) },
  delete(id: string) { execute('DELETE FROM ZomatoOrder WHERE id = ?', [id]) },
  pushToKitchen(shopId: string, zomatoOrderId: string) {
    const zomato = this.getById(zomatoOrderId)
    if (!zomato || zomato.internalOrderId) return null
    const items = JSON.parse(zomato.items || '[]')
    // Find Direct Counter table
    let directTable = queryOne<any>('SELECT * FROM RestaurantTable WHERE shopId = ? AND number = 0', [shopId])
    if (!directTable) {
      directTable = { id: genId() }
      execute('INSERT INTO RestaurantTable (id, shopId, number, name, capacity, status) VALUES (?,?,?,?,?,?)', [directTable.id, shopId, 0, 'Direct Counter', 0, 'available'])
    }
    const order = orders.create(shopId, directTable.id, zomato.deliveryType === 'pickup' ? 'takeaway' : 'direct', 1, undefined, zomato.customerName, `Zomato Order ${zomato.zomatoOrderId}`)
    for (const it of items) {
      const menuMatch = queryOne<any>('SELECT * FROM MenuItem WHERE shopId = ? AND name = ?', [shopId, it.name])
      let menuItemId = menuMatch?.id
      if (!menuItemId) {
        menuItemId = genId()
        execute('INSERT INTO MenuItem (id, shopId, name, category, price, cost, stock, unit, available) VALUES (?,?,?,?,?,?,?,?,?)', [menuItemId, shopId, it.name, 'General', it.price, 0, 0, 'Pcs', 1])
      }
      orders.addItem(order.id, menuItemId, it.name, it.price, it.qty)
    }
    execute('UPDATE Orders SET status = ?, kotPrinted = 1 WHERE id = ?', ['sent', order.id])
    execute('UPDATE RestaurantTable SET status = ?, currentOrderId = ? WHERE id = ?', ['occupied', order.id, directTable.id])
    execute('UPDATE ZomatoOrder SET internalOrderId = ?, status = ? WHERE id = ?', [order.id, 'accepted', zomatoOrderId])
    return order
  },
}

// ═══════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════
export const audit = {
  log(action: string, details?: any, shopId?: string, userName?: string) {
    execute('INSERT INTO AuditLog (id, shopId, userName, action, details) VALUES (?,?,?,?,?)',
      [genId(), shopId || null, userName || null, action, details ? JSON.stringify(details) : null])
  },
  list(shopId?: string, action?: string) {
    let sql = 'SELECT * FROM AuditLog'
    const params: any[] = []
    const conditions: string[] = []
    if (shopId) { conditions.push('shopId = ?'); params.push(shopId) }
    if (action) { conditions.push('action = ?'); params.push(action) }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
    sql += ' ORDER BY createdAt DESC LIMIT 500'
    return query(sql, params)
  },
  // WALLET/AUDIT FIX: The Audit page's "Clear Old" button sends
  // DELETE /api/audit?before=<ISO>. Previously the shopFetch shim
  // had no DELETE handler for /api/audit, so the request fell through
  // to the catch-all 404. `res.ok` was false → the `if (res.ok)`
  // block (with toast + dialog-close) was skipped → user clicked
  // "Clear Old Logs", the dialog stayed open, no feedback, no logs
  // deleted. The user thought it worked; nothing happened.
  clear(shopId?: string, beforeISO?: string): number {
    // Delete logs older than `beforeISO`, optionally scoped to a shop.
    // Returns the number of rows deleted (using SQLite's changes()
    // function which gives the count of rows affected by the last
    // DELETE/UPDATE on the same connection).
    const conditions: string[] = []
    const params: any[] = []
    if (shopId) { conditions.push('shopId = ?'); params.push(shopId) }
    if (beforeISO) { conditions.push('createdAt < ?'); params.push(beforeISO) }
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''
    execute(`DELETE FROM AuditLog${where}`, params)
    const row = queryOne<any>('SELECT changes() AS c')
    return row?.c || 0
  },
}

// ═══════════════════════════════════════
//  SYNC OUTBOX (for Supabase KOT sync)
// ═══════════════════════════════════════
export const syncQueue = {
  add(eventType: string, payload: any) {
    execute('INSERT INTO SyncOutbox (id, eventType, payload) VALUES (?,?,?)',
      [genId(), eventType, JSON.stringify(payload)])
  },
  getPending() {
    return query('SELECT * FROM SyncOutbox WHERE status = ? ORDER BY createdAt ASC', ['pending'])
  },
  markSynced(id: string) {
    execute('UPDATE SyncOutbox SET status = ?, syncedAt = ? WHERE id = ?', ['synced', new Date().toISOString(), id])
  },
  markFailed(id: string) {
    execute('UPDATE SyncOutbox SET attempts = attempts + 1 WHERE id = ?', [id])
  },
}



// ═══════════════════════════════════════
//  SHOPS
// ═══════════════════════════════════════
export const shops = {
  list() { return query('SELECT * FROM Shop ORDER BY name').map(convertShop) },
  listActive() { return query('SELECT * FROM Shop WHERE active = 1 ORDER BY name').map(convertShop) },
  getById(id: string) { return convertShop(queryOne('SELECT * FROM Shop WHERE id = ?', [id])) },
  create(data: any) {
    const id = genId()
    execute('INSERT INTO Shop (id, name, code, color, address, phone, gstin, taxRate, currency) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, data.name, (data.code || data.name.substring(0, 4)).toUpperCase(), data.color || 'orange', data.address || null, data.phone || null, data.gstin || null, data.taxRate ?? 0, data.currency || 'Rs.'])
    const created = this.getById(id)
    if (created) trackUpsert('Shop', created)
    return created
  },
  update(id: string, data: any) {
    const sets: string[] = []; const params: any[] = []
    if (data.name) { sets.push('name = ?'); params.push(data.name) }
    if (data.code) { sets.push('code = ?'); params.push(data.code) }
    if (data.color) { sets.push('color = ?'); params.push(data.color) }
    if (data.address !== undefined) { sets.push('address = ?'); params.push(data.address) }
    if (data.phone !== undefined) { sets.push('phone = ?'); params.push(data.phone) }
    if (data.gstin !== undefined) { sets.push('gstin = ?'); params.push(data.gstin) }
    if (data.taxRate !== undefined) { sets.push('taxRate = ?'); params.push(data.taxRate) }
    if (data.currency) { sets.push('currency = ?'); params.push(data.currency) }
    if (data.active !== undefined) { sets.push('active = ?'); params.push(data.active ? 1 : 0) }
    if (!sets.length) return this.getById(id)
    params.push(id)
    execute(`UPDATE Shop SET ${sets.join(', ')}, updatedAt = datetime('now') WHERE id = ?`, params)
    const updated = this.getById(id)
    if (updated) trackUpsert('Shop', updated)
    return updated
  },
  delete(id: string) { execute('DELETE FROM Shop WHERE id = ?', [id]); trackDelete('Shop', id) },
}

// ═══════════════════════════════════════
//  CUSTOMERS
// ═══════════════════════════════════════
export const customers = {
  list(shopId: string) { return query('SELECT * FROM Customer WHERE shopId = ? ORDER BY createdAt DESC', [shopId]) },
  create(shopId: string, data: any) {
    const id = genId()
    execute('INSERT INTO Customer (id, shopId, name, phone, email, address, notes) VALUES (?,?,?,?,?,?,?)',
      [id, shopId, data.name, data.phone || null, data.email || null, data.address || null, data.notes || null])
    const created = queryOne('SELECT * FROM Customer WHERE id = ?', [id])
    if (created) trackUpsert('Customer', created)
    return created
  },
  update(id: string, data: any) {
    execute(`UPDATE Customer SET name = ?, phone = ?, email = ?, address = ?, notes = ?, updatedAt = datetime('now') WHERE id = ?`,
      [data.name, data.phone || null, data.email || null, data.address || null, data.notes || null, id])
    const updated = queryOne('SELECT * FROM Customer WHERE id = ?', [id])
    if (updated) trackUpsert('Customer', updated)
  },
  delete(id: string) { execute('DELETE FROM Customer WHERE id = ?', [id]); trackDelete('Customer', id) },
}

// ═══════════════════════════════════════
//  SUPPLIERS
// ═══════════════════════════════════════
export const suppliers = {
  list(shopId: string) { return query('SELECT * FROM Supplier WHERE shopId = ? ORDER BY createdAt DESC', [shopId]) },
  create(shopId: string, data: any) {
    const id = genId()
    execute('INSERT INTO Supplier (id, shopId, name, phone, email, address, notes) VALUES (?,?,?,?,?,?,?)',
      [id, shopId, data.name, data.phone || null, data.email || null, data.address || null, data.notes || null])
    const created = queryOne('SELECT * FROM Supplier WHERE id = ?', [id])
    if (created) trackUpsert('Supplier', created)
    return created
  },
  update(id: string, data: any) {
    execute(`UPDATE Supplier SET name = ?, phone = ?, email = ?, address = ?, notes = ?, updatedAt = datetime('now') WHERE id = ?`,
      [data.name, data.phone || null, data.email || null, data.address || null, data.notes || null, id])
    const updated = queryOne('SELECT * FROM Supplier WHERE id = ?', [id])
    if (updated) trackUpsert('Supplier', updated)
  },
  delete(id: string) { execute('DELETE FROM Supplier WHERE id = ?', [id]); trackDelete('Supplier', id) },
}

// ═══════════════════════════════════════
//  PURCHASES (with stock bump)
// ═══════════════════════════════════════
export const purchases = {
  list(shopId: string) { return query('SELECT * FROM Purchase WHERE shopId = ? ORDER BY createdAt DESC', [shopId]) },
  create(shopId: string, data: any) {
    const id = genId()
    const items = JSON.stringify(data.items || [])
    const safeSubtotal = Number(data.subtotal) || data.items?.reduce((s: number, it: any) => s + (Number(it.total) || 0), 0) || 0
    const safeTaxAmount = Number(data.taxAmount) || 0
    const total = Number(data.total) || (safeSubtotal + safeTaxAmount) || 0
    execute(`INSERT INTO Purchase (id, shopId, invoiceNumber, supplierId, supplierName, subtotal, taxAmount, total, paymentMode, notes, items)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, shopId, data.invoiceNumber || `INV-${Date.now()}`, data.supplierId || null, data.supplierName || null,
       safeSubtotal, safeTaxAmount, total, data.paymentMode || 'cash', data.notes || null, items])
    // WALLET FIX: Stock increments are part of the purchase record.
    // If a purchase is later deleted, we MUST reverse the stock bump
    // here too (see delete()). Without this, deleting a mistakenly-
    // entered purchase leaves stock permanently inflated → wrong
    // low-stock alerts, wrong COGS in reports.
    for (const it of (data.items || [])) {
      if (it.menuItemId) {
        const qty = Number(it.qty) || 0
        if (qty > 0) {
          execute('UPDATE MenuItem SET stock = stock + ? WHERE id = ?', [qty, it.menuItemId])
          const mi = menu.getById(it.menuItemId)
          if (mi) trackUpsert('MenuItem', mi)
        }
      }
    }
    const created = queryOne('SELECT * FROM Purchase WHERE id = ?', [id])
    if (created) trackUpsert('Purchase', created)
    try {
      audit.log('purchase_created', {
        purchaseId: id, invoiceNumber: data.invoiceNumber, supplierName: data.supplierName,
        total, paymentMode: data.paymentMode || 'cash',
        itemCount: (data.items || []).length,
      }, shopId)
    } catch (e) { console.warn('[purchases.create] audit log failed:', e) }
    notifyDataChanged('Purchase', 'insert')
    return created
  },
  delete(id: string) {
    // WALLET FIX: Before deleting the Purchase row, read its items JSON
    // and reverse the stock bump for every line. Without this, the
    // MenuItem.stock column would be permanently inflated by the
    // qty that was added when the purchase was created — making
    // low-stock alerts fire wrongly and the COGS computation in
    // reports under-counting actual cost of goods sold.
    let purchase: any = null
    try { purchase = queryOne<any>('SELECT * FROM Purchase WHERE id = ?', [id]) } catch { /* ignore */ }
    if (purchase) {
      try {
        const items = JSON.parse(purchase.items || '[]')
        for (const it of items) {
          if (it.menuItemId) {
            const qty = Number(it.qty) || 0
            if (qty > 0) {
              // Use MAX(stock - qty, 0) so stock never goes negative
              // from a delete (which could happen if the user manually
              // edited stock down between purchase-create and delete).
              execute('UPDATE MenuItem SET stock = MAX(stock - ?, 0) WHERE id = ?', [qty, it.menuItemId])
              const mi = menu.getById(it.menuItemId)
              if (mi) trackUpsert('MenuItem', mi)
            }
          }
        }
      } catch (e) {
        console.warn('[purchases.delete] stock reversal failed (non-fatal):', e)
      }
    }
    execute('DELETE FROM Purchase WHERE id = ?', [id])
    trackDelete('Purchase', id)
    if (purchase) {
      try {
        audit.log('purchase_deleted', {
          purchaseId: id, invoiceNumber: purchase.invoiceNumber,
          supplierName: purchase.supplierName, total: purchase.total,
        }, purchase.shopId)
      } catch (e) { console.warn('[purchases.delete] audit log failed:', e) }
    }
    notifyDataChanged('Purchase', 'delete')
  },
}

// ═══════════════════════════════════════
//  EXPENSES
// ═══════════════════════════════════════
export const expenses = {
  list(shopId: string) { return query('SELECT * FROM Expense WHERE shopId = ? ORDER BY date DESC', [shopId]) },
  create(shopId: string, data: any) {
    const id = genId()
    // WALLET FIX: Coerce amount to a finite number. The old code
    // stored whatever `data.amount` was (could be a string like
    // "abc" from a malformed payload). Sum queries (SUM(amount))
    // would then return 0 for that row instead of erroring — but
    // `formatCurrency` would still show ₹0 for it, hiding the
    // corruption. We now coerce and reject NaN.
    const safeAmount = Number(data.amount)
    if (!Number.isFinite(safeAmount) || safeAmount < 0) {
      throw new Error('Invalid amount for expense')
    }
    execute('INSERT INTO Expense (id, shopId, category, description, amount, paymentMode, date) VALUES (?,?,?,?,?,?,?)',
      [id, shopId, data.category || 'Misc', data.description || null, safeAmount, data.paymentMode || 'cash', data.date || new Date().toISOString()])
    const created = queryOne('SELECT * FROM Expense WHERE id = ?', [id])
    if (created) trackUpsert('Expense', created)
    // WALLET FIX: Audit-log every expense so cash movements have a
    // trail. The AuditLog table was previously permanently empty.
    try {
      audit.log('expense_created', {
        expenseId: id, amount: safeAmount, category: data.category,
        description: data.description, paymentMode: data.paymentMode || 'cash',
      }, shopId)
    } catch (e) { console.warn('[expenses.create] audit log failed:', e) }
    notifyDataChanged('Expense', 'insert')
    return created
  },
  delete(id: string) {
    // WALLET FIX: Capture the row before deleting so the audit log
    // has the amount + category. Without this, the audit trail
    // would only say "expense_deleted" with no monetary context.
    let row: any = null
    try { row = queryOne<any>('SELECT * FROM Expense WHERE id = ?', [id]) } catch { /* ignore */ }
    execute('DELETE FROM Expense WHERE id = ?', [id])
    trackDelete('Expense', id)
    if (row) {
      try {
        audit.log('expense_deleted', {
          expenseId: id, amount: row.amount, category: row.category,
          description: row.description,
        }, row.shopId)
      } catch (e) { console.warn('[expenses.delete] audit log failed:', e) }
    }
    notifyDataChanged('Expense', 'delete')
  },
}

// ═══════════════════════════════════════
//  MONEY IN
// ═══════════════════════════════════════
// WALLET FIX: 'Sale' is a RESERVED source — it is auto-written by
// `bills.create()` for every bill generated. Manual Money In entries
// must use one of the user-facing sources (Investment, Loan, Refund,
// Owner Contribution, Asset Sale, Misc). If a caller (or a malicious
// payload) tried to insert source='Sale' manually, the dashboard's
// cash-flow calculation would then double-count that amount (once
// in `salesIn` via the Bill total, once in `otherIn` via the MoneyIn
// row — until we fixed the dashboard query to exclude source='Sale',
// which we did, but defense in depth is better than relying on one
// filter).
const MONEY_IN_SOURCES = ['Investment', 'Loan', 'Refund', 'Owner Contribution', 'Asset Sale', 'Misc']
export const moneyIn = {
  list(shopId: string) { return query('SELECT * FROM MoneyIn WHERE shopId = ? ORDER BY date DESC', [shopId]) },
  create(shopId: string, data: any) {
    const id = genId()
    const safeAmount = Number(data.amount)
    if (!Number.isFinite(safeAmount) || safeAmount < 0) {
      throw new Error('Invalid amount for Money In entry')
    }
    // Resolve + validate source. 'Sale' is reserved for bills.create().
    let source = (data.source || data.category || 'Investment').toString().trim()
    if (source === 'Sale') {
      console.warn('[moneyIn.create] Rejecting reserved source="Sale"; using "Misc" instead.')
      source = 'Misc'
    }
    if (!MONEY_IN_SOURCES.includes(source)) {
      // Allow custom sources but log them so they show up in audit.
      // (Don't reject — users may have legitimate custom sources.)
    }
    execute('INSERT INTO MoneyIn (id, shopId, amount, source, description, partyName, paymentMode, date) VALUES (?,?,?,?,?,?,?,?)',
      [id, shopId, safeAmount, source, data.description || null, data.partyName || null, data.paymentMode || 'cash', data.date || new Date().toISOString()])
    const created = queryOne('SELECT * FROM MoneyIn WHERE id = ?', [id])
    if (created) trackUpsert('MoneyIn', created)
    try {
      audit.log('money_in_created', {
        moneyInId: id, amount: safeAmount, source, partyName: data.partyName,
        description: data.description, paymentMode: data.paymentMode || 'cash',
      }, shopId)
    } catch (e) { console.warn('[moneyIn.create] audit log failed:', e) }
    notifyDataChanged('MoneyIn', 'insert')
    return created
  },
  delete(id: string) {
    let row: any = null
    try { row = queryOne<any>('SELECT * FROM MoneyIn WHERE id = ?', [id]) } catch { /* ignore */ }
    execute('DELETE FROM MoneyIn WHERE id = ?', [id])
    trackDelete('MoneyIn', id)
    if (row) {
      try {
        audit.log('money_in_deleted', {
          moneyInId: id, amount: row.amount, source: row.source,
          description: row.description,
        }, row.shopId)
      } catch (e) { console.warn('[moneyIn.delete] audit log failed:', e) }
    }
    notifyDataChanged('MoneyIn', 'delete')
  },
}

// ═══════════════════════════════════════
//  MONEY OUT
// ═══════════════════════════════════════
const MONEY_OUT_PURPOSES = ['Owner Draw', 'Loan Repayment', 'Asset Purchase', 'Donation', 'Personal', 'Misc']
export const moneyOut = {
  list(shopId: string) { return query('SELECT * FROM MoneyOut WHERE shopId = ? ORDER BY date DESC', [shopId]) },
  create(shopId: string, data: any) {
    const id = genId()
    const safeAmount = Number(data.amount)
    if (!Number.isFinite(safeAmount) || safeAmount < 0) {
      throw new Error('Invalid amount for Money Out entry')
    }
    const purpose = (data.purpose || data.category || 'Owner Draw').toString().trim()
    execute('INSERT INTO MoneyOut (id, shopId, amount, purpose, description, partyName, paymentMode, date) VALUES (?,?,?,?,?,?,?,?)',
      [id, shopId, safeAmount, purpose, data.description || null, data.partyName || null, data.paymentMode || 'cash', data.date || new Date().toISOString()])
    const created = queryOne('SELECT * FROM MoneyOut WHERE id = ?', [id])
    if (created) trackUpsert('MoneyOut', created)
    try {
      audit.log('money_out_created', {
        moneyOutId: id, amount: safeAmount, purpose, partyName: data.partyName,
        description: data.description, paymentMode: data.paymentMode || 'cash',
      }, shopId)
    } catch (e) { console.warn('[moneyOut.create] audit log failed:', e) }
    notifyDataChanged('MoneyOut', 'insert')
    return created
  },
  delete(id: string) {
    let row: any = null
    try { row = queryOne<any>('SELECT * FROM MoneyOut WHERE id = ?', [id]) } catch { /* ignore */ }
    execute('DELETE FROM MoneyOut WHERE id = ?', [id])
    trackDelete('MoneyOut', id)
    if (row) {
      try {
        audit.log('money_out_deleted', {
          moneyOutId: id, amount: row.amount, purpose: row.purpose,
          description: row.description,
        }, row.shopId)
      } catch (e) { console.warn('[moneyOut.delete] audit log failed:', e) }
    }
    notifyDataChanged('MoneyOut', 'delete')
  },
}

// ═══════════════════════════════════════
//  REPORTS (advanced filters + itemized bill rows)
// ═══════════════════════════════════════
export interface ReportFilters {
  from?: string
  to?: string
  paymentMode?: string      // 'all' | 'cash' | 'upi' | 'card' | 'other'
  tableNumber?: number      // 0 = Direct Counter, 1-10 = tables
  billNoSearch?: string     // substring match on bill number
  itemSearch?: string       // substring match on any item name in the bill
  category?: string         // filter bills that contain at least one item in this category
  waiter?: string           // filter by waiter name (from Orders.waiterName)
  minAmount?: number        // bills with total >= this
  maxAmount?: number        // bills with total <= this
}

export const reports = {
  get(shopId: string, filtersOrFrom?: ReportFilters | string, maybeTo?: string) {
    // Backward-compat: callers can still pass (shopId, from, to) directly.
    // New callers should pass (shopId, { from, to, paymentMode, ... }).
    const filters: ReportFilters =
      typeof filtersOrFrom === 'string'
        ? { from: filtersOrFrom, to: maybeTo }
        : (filtersOrFrom || {})

    const fromIso = filters.from ? new Date(filters.from).toISOString() : new Date(0).toISOString()
    const toIso = filters.to ? new Date(filters.to).toISOString() : new Date().toISOString()

    // Pull all bills in the date window, then attach their orders + items
    // so we can filter by item/category/waiter client-side. SQLite on the
    // client doesn't have great JOIN support via sql.js, so we do it in JS.
    const billRows = query<any>(
      'SELECT * FROM Bill WHERE shopId = ? AND paidAt >= ? AND paidAt <= ? ORDER BY paidAt DESC',
      [shopId, fromIso, toIso]
    )
    // Attach order + items to each bill (needed for itemized table + filters)
    const bills = billRows.map((b: any) => {
      const order = orders.getById(b.orderId)
      return { ...b, order }
    })

    const expensesList = query<any>('SELECT * FROM Expense WHERE shopId = ? AND date >= ? AND date <= ?', [shopId, fromIso, toIso])
    const purchasesList = query<any>('SELECT * FROM Purchase WHERE shopId = ? AND createdAt >= ? AND createdAt <= ?', [shopId, fromIso, toIso])
    // Bill deletion has been removed — there are no more "deleted bills".
    // Keep the variable as an empty array so the rest of the report
    // aggregation (which still references deletedBillsList for compat)
    // doesn't crash.
    const deletedBillsList: any[] = []

    // ─── Apply advanced filters ──────────────────────────────────────────
    let filteredBills = bills
    if (filters.paymentMode && filters.paymentMode !== 'all') {
      filteredBills = filteredBills.filter((b: any) => b.paymentMode === filters.paymentMode)
    }
    if (filters.tableNumber != null && !Number.isNaN(filters.tableNumber)) {
      filteredBills = filteredBills.filter((b: any) => b.tableNumber === filters.tableNumber)
    }
    if (filters.billNoSearch) {
      const term = String(filters.billNoSearch).toLowerCase()
      filteredBills = filteredBills.filter((b: any) => String(b.billNo).includes(term))
    }
    if (filters.itemSearch) {
      const term = String(filters.itemSearch).toLowerCase()
      filteredBills = filteredBills.filter((b: any) =>
        (b.order?.items || []).some((it: any) =>
          String(it.name || '').toLowerCase().includes(term)
        )
      )
    }
    if (filters.category && filters.category !== 'all') {
      filteredBills = filteredBills.filter((b: any) =>
        (b.order?.items || []).some((it: any) => {
          // OrderItem doesn't store category directly; we look it up from
          // the menu by menuItemId if available, else by name match.
          const mi = queryOne<any>('SELECT category FROM MenuItem WHERE id = ?', [it.menuItemId])
          return mi?.category === filters.category
        })
      )
    }
    if (filters.waiter) {
      const term = String(filters.waiter).toLowerCase()
      filteredBills = filteredBills.filter((b: any) =>
        String(b.order?.waiterName || '').toLowerCase().includes(term)
      )
    }
    if (filters.minAmount != null && !Number.isNaN(filters.minAmount)) {
      filteredBills = filteredBills.filter((b: any) => Number(b.total) >= filters.minAmount!)
    }
    if (filters.maxAmount != null && !Number.isNaN(filters.maxAmount)) {
      filteredBills = filteredBills.filter((b: any) => Number(b.total) <= filters.maxAmount!)
    }

    // ─── Build itemized rows (one row per line item across all filtered bills) ───
    // This powers the detailed sales table and the per-item breakdown.
    const itemizedRows: any[] = []
    for (const b of filteredBills) {
      const items = (b.order?.items || []).filter((it: any) => it.status !== 'cancelled')
      for (const it of items) {
        const mi = queryOne<any>('SELECT category FROM MenuItem WHERE id = ?', [it.menuItemId])
        itemizedRows.push({
          billNo: b.billNo,
          paidAt: b.paidAt,
          tableNumber: b.tableNumber,
          waiterName: b.order?.waiterName || null,
          customerName: b.order?.customerName || null,
          paymentMode: b.paymentMode,
          itemName: it.name,
          category: mi?.category || 'General',
          quantity: Number(it.quantity) || 0,
          price: Number(it.price) || 0,
          lineTotal: (Number(it.quantity) || 0) * (Number(it.price) || 0),
          billTotal: Number(b.total) || 0,
        })
      }
    }

    // ─── Aggregates from FILTERED bills ──────────────────────────────────
    const salesRevenue = filteredBills.reduce((s: number, b: any) => s + (b.total || 0), 0)
    const totalExpenses = expensesList.reduce((s: number, e: any) => s + (e.amount || 0), 0)
    const totalPurchases = purchasesList.reduce((s: number, p: any) => s + (p.total || 0), 0)
    const deletedBillAmount = deletedBillsList.reduce((s: number, d: any) => s + (d.total || 0), 0)
    const totalItemsSold = itemizedRows.reduce((s: number, r: any) => s + (r.quantity || 0), 0)

    // Payment breakdown — count + total
    const byPaymentMap: Record<string, { count: number; total: number }> = {}
    for (const b of filteredBills) {
      const m = b.paymentMode || 'other'
      if (!byPaymentMap[m]) byPaymentMap[m] = { count: 0, total: 0 }
      byPaymentMap[m].count++
      byPaymentMap[m].total += (b.total || 0)
    }

    // Top items (by qty) — computed from itemizedRows.
    // Includes category so the UI can show it in the item-wise table.
    const topItemsMap: Record<string, { name: string; category: string; qty: number; revenue: number }> = {}
    for (const r of itemizedRows) {
      if (!topItemsMap[r.itemName]) topItemsMap[r.itemName] = { name: r.itemName, category: r.category, qty: 0, revenue: 0 }
      topItemsMap[r.itemName].qty += r.quantity
      topItemsMap[r.itemName].revenue += r.lineTotal
    }
    const topItems = Object.values(topItemsMap).sort((a, b) => b.qty - a.qty).slice(0, 100)

    // Category breakdown
    const categoryMap: Record<string, { qty: number; revenue: number }> = {}
    for (const r of itemizedRows) {
      if (!categoryMap[r.category]) categoryMap[r.category] = { qty: 0, revenue: 0 }
      categoryMap[r.category].qty += r.quantity
      categoryMap[r.category].revenue += r.lineTotal
    }
    const byCategory = Object.entries(categoryMap)
      .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }))
      .sort((a, b) => b.revenue - a.revenue)

    // Expense breakdown
    const expenseByCategory: Record<string, number> = {}
    for (const e of expensesList) expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + (e.amount || 0)

    // Daily breakdown (sales per day)
    const dailyMap: Record<string, { sales: number; expenses: number; count: number }> = {}
    for (const b of filteredBills) {
      const day = (b.paidAt || '').slice(0, 10)
      if (!day) continue
      if (!dailyMap[day]) dailyMap[day] = { sales: 0, expenses: 0, count: 0 }
      dailyMap[day].sales += (b.total || 0)
      dailyMap[day].count++
    }
    for (const e of expensesList) {
      const day = (e.date || '').slice(0, 10)
      if (!day) continue
      if (!dailyMap[day]) dailyMap[day] = { sales: 0, expenses: 0, count: 0 }
      dailyMap[day].expenses += (e.amount || 0)
    }
    const dailyBreakdown = Object.entries(dailyMap)
      .map(([date, v]) => ({ date, sales: v.sales, expenses: v.expenses, count: v.count }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Hourly breakdown (sales by hour of day) — useful for staffing decisions
    const hourlyMap: Record<number, { sales: number; count: number }> = {}
    for (let h = 0; h < 24; h++) hourlyMap[h] = { sales: 0, count: 0 }
    for (const b of filteredBills) {
      const d = new Date(b.paidAt)
      const h = d.getHours()
      hourlyMap[h].sales += (b.total || 0)
      hourlyMap[h].count++
    }
    const hourlyBreakdown = Object.entries(hourlyMap).map(([hour, v]) => ({
      hour: Number(hour),
      label: `${String(hour).padStart(2, '0')}:00`,
      sales: v.sales,
      count: v.count,
    }))

    return {
      summary: {
        salesRevenue,
        totalExpenses,
        totalPurchases,
        deletedBillAmount,
        deletedBillCount: deletedBillsList.length,
        netProfit: salesRevenue - totalExpenses - totalPurchases - deletedBillAmount,
        cashFlow: salesRevenue - totalExpenses - totalPurchases - deletedBillAmount,
        billCount: filteredBills.length,
        avgBill: filteredBills.length ? salesRevenue / filteredBills.length : 0,
        totalItemsSold,
      },
      byPayment: byPaymentMap,
      byCategory,
      topItems,
      expenseByCategory,
      dailyBreakdown,
      hourlyBreakdown,
      // bills now have .order attached so the UI can show itemized rows
      bills: filteredBills,
      // Flat one-row-per-line-item table — for the detailed sales report
      itemizedRows,
      deletedBills: deletedBillsList,
    }
  },
}

// ═══════════════════════════════════════
//  CONVERTERS (SQLite integer → JS boolean/types)
// ═══════════════════════════════════════
function convertShop(row: any) {
  return { ...row, active: !!row.active }
}
function convertMenuItem(row: any) {
  return { ...row, available: !!row.available }
}
function convertTable(row: any) {
  return { ...row, status: row.status }
}
function convertOrder(row: any) {
  return { ...row, kotPrinted: !!row.kotPrinted, billPrinted: !!row.billPrinted }
}
function convertOrderItem(row: any) {
  return { ...row }
}
function convertBill(row: any) {
  return { ...row }
}
function convertSettings(row: any) {
  if (!row) return null
  const boolKeys = [
    'billShowLogo','billShowGstin','billShowPhone','billShowAddress','billShowEmail',
    'billShowDateTime','billShowWaiter','billShowCustomer','billShowKotNo',
    'billBoldText',
    'kotShowLogo','kotShowWaiter','kotShowDateTime','kotShowTable','kotShowGuests',
    'kotBoldText',
    'zomatoEnabled','autoPrint','silentPrint',
  ]
  const result = { ...row }
  for (const key of boolKeys) { if (key in result) result[key] = !!result[key] }
  // Parse template JSON if present (billTemplate / kotTemplate store the
  // admin-defined field order as a JSON array of field keys).
  try {
    if (typeof result.billTemplate === 'string' && result.billTemplate) {
      result.billTemplate = JSON.parse(result.billTemplate)
    }
  } catch { result.billTemplate = null }
  try {
    if (typeof result.kotTemplate === 'string' && result.kotTemplate) {
      result.kotTemplate = JSON.parse(result.kotTemplate)
    }
  } catch { result.kotTemplate = null }
  return result
}
function convertUser(row: any) {
  return { ...row, active: !!row.active }
}
function convertZomatoOrder(row: any) {
  if (!row) return null
  return { ...row }
}
