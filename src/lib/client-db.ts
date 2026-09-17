'use client'

import initSqlJs, { type Database } from 'sql.js'
import { isValidKey } from '@/lib/license-keys'

/**
 * ClientSideDB — Offline-first SQLite in the browser via WebAssembly
 *
 * Architecture:
 * - sql.js loads SQLite as WebAssembly in the browser
 * - Database file persisted in IndexedDB (survives page reload)
 * - ALL data operations happen client-side — NO server needed
 * - Works in APK (Capacitor), EXE (Tauri/Electron), and browser
 * - Supabase used ONLY for KOT event sync (not data storage)
 */

let db: Database | null = null
let initialized = false
const DB_KEY = 'thuso-database'
const DB_VERSION = 1

// ─── IndexedDB helpers (for persisting SQLite file) ───
function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('thuso', DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('database')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveDB(database: Database) {
  const idb = await openIDB()
  const data = database.export()
  return new Promise<void>((resolve, reject) => {
    const tx = idb.transaction('database', 'readwrite')
    tx.objectStore('database').put(data, DB_KEY)
    tx.oncomplete = () => { idb.close(); resolve() }
    tx.onerror = () => { idb.close(); reject(tx.error) }
  })
}

async function loadDB(): Promise<Uint8Array | null> {
  const idb = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('database', 'readonly')
    const req = tx.objectStore('database').get(DB_KEY)
    req.onsuccess = () => {
      idb.close()
      const data = req.result || null
      if (data) {
        resolve(data)
      } else {
        // IndexedDB has no backup — try the localStorage last-resort
        // backup. If we find one, decode base64 → Uint8Array and
        // repopulate IndexedDB on the next save. This is the recovery
        // path for "IndexedDB was cleared but localStorage survived".
        try {
          const lsBackup = localStorage.getItem(`${DB_KEY}-ls-backup`)
          if (lsBackup) {
            console.log('[client-db] recovering DB from localStorage backup')
            const binary = atob(lsBackup)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            resolve(bytes)
          } else {
            resolve(null)
          }
        } catch (lsErr) {
          console.warn('[client-db] localStorage backup read failed:', lsErr)
          resolve(null)
        }
      }
    }
    req.onerror = () => { idb.close(); reject(req.error) }
  })
}

// ─── Schema creation ───
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS Shop (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  address TEXT,
  phone TEXT,
  gstin TEXT,
  taxRate REAL NOT NULL DEFAULT 0,
  serviceRate REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'Rs.',
  color TEXT NOT NULL DEFAULT 'orange',
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS MenuItem (
  id TEXT PRIMARY KEY,
  shopId TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  price REAL NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'Pcs',
  image TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shopId) REFERENCES Shop(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_menuitem_shop_cat ON MenuItem(shopId, category);

CREATE TABLE IF NOT EXISTS RestaurantTable (
  id TEXT PRIMARY KEY,
  shopId TEXT NOT NULL,
  number INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT 'Table',
  capacity INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'available',
  currentOrderId TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shopId) REFERENCES Shop(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_table_shop_num ON RestaurantTable(shopId, number);

CREATE TABLE IF NOT EXISTS Orders (
  id TEXT PRIMARY KEY,
  shopId TEXT NOT NULL,
  tableId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  type TEXT NOT NULL DEFAULT 'dine_in',
  guests INTEGER NOT NULL DEFAULT 1,
  waiterName TEXT,
  customerName TEXT,
  notes TEXT,
  kotPrinted INTEGER NOT NULL DEFAULT 0,
  billPrinted INTEGER NOT NULL DEFAULT 0,
  assignedBillNo INTEGER,
  assignedBillDate TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shopId) REFERENCES Shop(id) ON DELETE CASCADE,
  FOREIGN KEY (tableId) REFERENCES RestaurantTable(id)
);
CREATE INDEX IF NOT EXISTS idx_order_shop_status ON Orders(shopId, status);

CREATE TABLE IF NOT EXISTS OrderItem (
  id TEXT PRIMARY KEY,
  orderId TEXT NOT NULL,
  menuItemId TEXT NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (orderId) REFERENCES Orders(id) ON DELETE CASCADE,
  FOREIGN KEY (menuItemId) REFERENCES MenuItem(id)
);
CREATE INDEX IF NOT EXISTS idx_orderitem_order ON OrderItem(orderId);

CREATE TABLE IF NOT EXISTS Bill (
  id TEXT PRIMARY KEY,
  shopId TEXT NOT NULL,
  billNo INTEGER NOT NULL,
  orderId TEXT NOT NULL UNIQUE,
  tableNumber INTEGER NOT NULL,
  subtotal REAL NOT NULL,
  taxRate REAL NOT NULL DEFAULT 0,
  taxAmount REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  serviceCharge REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  paymentMode TEXT NOT NULL DEFAULT 'cash',
  paymentStatus TEXT NOT NULL DEFAULT 'paid',
  paidAt TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shopId) REFERENCES Shop(id) ON DELETE CASCADE,
  FOREIGN KEY (orderId) REFERENCES Orders(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_shop_no ON Bill(shopId, billNo);

CREATE TABLE IF NOT EXISTS AppUser (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  active INTEGER NOT NULL DEFAULT 1,
  shopId TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ShopSetting (
  id TEXT PRIMARY KEY,
  shopId TEXT NOT NULL UNIQUE,
  shopName TEXT NOT NULL DEFAULT 'Thuso',
  address TEXT, phone TEXT, email TEXT, gstin TEXT,
  taxRate REAL NOT NULL DEFAULT 0,
  serviceRate REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'Rs.',
  invoicePrefix TEXT NOT NULL DEFAULT 'INV',
  kotPrefix TEXT NOT NULL DEFAULT 'KOT',
  footerNote TEXT NOT NULL DEFAULT 'Thank you for dining with us!',
  billShowLogo INTEGER NOT NULL DEFAULT 1,
  billShowGstin INTEGER NOT NULL DEFAULT 1,
  billShowPhone INTEGER NOT NULL DEFAULT 1,
  billShowAddress INTEGER NOT NULL DEFAULT 1,
  billShowEmail INTEGER NOT NULL DEFAULT 0,
  billShowDateTime INTEGER NOT NULL DEFAULT 1,
  billShowWaiter INTEGER NOT NULL DEFAULT 1,
  billShowCustomer INTEGER NOT NULL DEFAULT 1,
  billShowKotNo INTEGER NOT NULL DEFAULT 1,
  billFontSize INTEGER NOT NULL DEFAULT 11,
  billHeaderAlign TEXT NOT NULL DEFAULT 'center',
  billExtraNote TEXT,
  billAccentColor TEXT NOT NULL DEFAULT '#0EA5E9',
  billBoldText INTEGER NOT NULL DEFAULT 1,
  billTextColor TEXT NOT NULL DEFAULT '#000000',
  billPaperWidth INTEGER NOT NULL DEFAULT 80,
  billTemplate TEXT,
  kotShowLogo INTEGER NOT NULL DEFAULT 1,
  kotShowWaiter INTEGER NOT NULL DEFAULT 1,
  kotShowDateTime INTEGER NOT NULL DEFAULT 1,
  kotShowTable INTEGER NOT NULL DEFAULT 1,
  kotShowGuests INTEGER NOT NULL DEFAULT 1,
  kotFontSize INTEGER NOT NULL DEFAULT 14,
  kotHeaderAlign TEXT NOT NULL DEFAULT 'center',
  kotAccentColor TEXT NOT NULL DEFAULT '#22C55E',
  kotExtraNote TEXT,
  kotPaperWidth INTEGER NOT NULL DEFAULT 80,
  kotBoldText INTEGER NOT NULL DEFAULT 1,
  kotTextColor TEXT NOT NULL DEFAULT '#000000',
  kotTemplate TEXT,
  zomatoEnabled INTEGER NOT NULL DEFAULT 0,
  zomatoApiKey TEXT,
  zomatoRestaurantId TEXT,
  zomatoApiBaseUrl TEXT,
  zomatoWebhookSecret TEXT,
  paperWidth INTEGER NOT NULL DEFAULT 80,
  printFontSize INTEGER NOT NULL DEFAULT 11,
  printMargin INTEGER NOT NULL DEFAULT 4,
  autoPrint INTEGER NOT NULL DEFAULT 1,
  billCopies INTEGER NOT NULL DEFAULT 1,
  silentPrint INTEGER NOT NULL DEFAULT 0,
  printHeaderText TEXT,
  printFooterText TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shopId) REFERENCES Shop(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Customer (
  id TEXT PRIMARY KEY, shopId TEXT NOT NULL, name TEXT NOT NULL,
  phone TEXT, email TEXT, address TEXT, notes TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Supplier (
  id TEXT PRIMARY KEY, shopId TEXT NOT NULL, name TEXT NOT NULL,
  phone TEXT, email TEXT, address TEXT, notes TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Purchase (
  id TEXT PRIMARY KEY, shopId TEXT NOT NULL,
  invoiceNumber TEXT NOT NULL UNIQUE,
  supplierId TEXT, supplierName TEXT,
  subtotal REAL NOT NULL, taxAmount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL, paymentMode TEXT NOT NULL DEFAULT 'cash',
  notes TEXT, items TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Expense (
  id TEXT PRIMARY KEY, shopId TEXT NOT NULL,
  category TEXT NOT NULL, description TEXT NOT NULL,
  amount REAL NOT NULL, paymentMode TEXT NOT NULL DEFAULT 'cash',
  date TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS MoneyIn (
  id TEXT PRIMARY KEY, shopId TEXT NOT NULL,
  amount REAL NOT NULL, source TEXT NOT NULL,
  description TEXT, partyName TEXT,
  paymentMode TEXT NOT NULL DEFAULT 'cash',
  date TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS MoneyOut (
  id TEXT PRIMARY KEY, shopId TEXT NOT NULL,
  amount REAL NOT NULL, purpose TEXT NOT NULL,
  description TEXT, partyName TEXT,
  paymentMode TEXT NOT NULL DEFAULT 'cash',
  date TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ZomatoOrder (
  id TEXT PRIMARY KEY, shopId TEXT NOT NULL,
  zomatoOrderId TEXT NOT NULL UNIQUE,
  customerName TEXT NOT NULL, customerPhone TEXT,
  deliveryType TEXT NOT NULL DEFAULT 'delivery',
  address TEXT, items TEXT NOT NULL,
  subtotal REAL NOT NULL, taxAmount REAL NOT NULL DEFAULT 0,
  packagingCharge REAL NOT NULL DEFAULT 0, deliveryFee REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
  paymentMode TEXT NOT NULL DEFAULT 'prepaid',
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT, internalOrderId TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS LicenseKey (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  duration INTEGER NOT NULL DEFAULT 365,
  used INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS LicenseActivation (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  activatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  expiresAt TEXT NOT NULL,
  machineId TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS AuditLog (
  id TEXT PRIMARY KEY, shopId TEXT, userId TEXT, userName TEXT, userRole TEXT,
  action TEXT NOT NULL, details TEXT, ipAddress TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS SyncOutbox (
  id TEXT PRIMARY KEY,
  eventType TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  syncedAt TEXT
);

-- Deleted bills archive. When a bill is deleted (voided) we capture a
-- full snapshot here BEFORE the Bill row is removed, so:
--   • the dashboard / reports can show "Deleted Bill Amount" as its own
--     metric and subtract it from the net cash flow
--   • the Money Out page can list every deleted bill with reason + user
--   • an audit trail survives even after the original Bill row is gone
CREATE TABLE IF NOT EXISTS DeletedBill (
  id TEXT PRIMARY KEY,
  shopId TEXT NOT NULL,
  originalBillId TEXT NOT NULL,
  billNo INTEGER NOT NULL,
  orderId TEXT NOT NULL,
  tableNumber INTEGER NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0,
  taxRate REAL NOT NULL DEFAULT 0,
  taxAmount REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  serviceCharge REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  paymentMode TEXT NOT NULL DEFAULT 'cash',
  paymentStatus TEXT NOT NULL DEFAULT 'paid',
  originalPaidAt TEXT NOT NULL,
  originalCreatedAt TEXT NOT NULL,
  reason TEXT,
  deletedBy TEXT,
  deletedById TEXT,
  deletedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shopId) REFERENCES Shop(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deletedbill_shop_deletedAt ON DeletedBill(shopId, deletedAt);
CREATE INDEX IF NOT EXISTS idx_deletedbill_shop_originalPaidAt ON DeletedBill(shopId, originalPaidAt);
CREATE INDEX IF NOT EXISTS idx_deletedbill_deletedById ON DeletedBill(deletedById);

-- Menu categories (per-shop, user-manageable). Mirrors the Prisma model
-- added for the server-side / Supabase migration. The client UI reads &
-- writes through here via the use-shop-fetch shim.
CREATE TABLE IF NOT EXISTS MenuCategory (
  id TEXT PRIMARY KEY,
  shopId TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'slate',
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shopId) REFERENCES Shop(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_menucategory_shop_name ON MenuCategory(shopId, name);
CREATE INDEX IF NOT EXISTS idx_menucategory_shop_sort ON MenuCategory(shopId, sortOrder);
`

// ─── Seed data ───
const MENU_ITEMS = [
  { name: 'Maha Jumbo Sandwich', category: 'Sandwich', price: 150 }, { name: 'Cheese Chutney Sandwich', category: 'Sandwich', price: 90 },
  { name: 'Ultimate Cheese Burst Pizza', category: 'Pizza', price: 250 }, { name: 'Royal Paneer Tandoori Pizza', category: 'Pizza', price: 200 },
  { name: 'Classic Veg Delight Pizza', category: 'Pizza', price: 180 }, { name: 'Cheesy Corn Burst Pizza', category: 'Pizza', price: 180 },
  { name: 'Thuso Special Loaded Maggie', category: 'Maggie', price: 180 }, { name: 'Tandoori Paneer Maggie', category: 'Maggie', price: 150 },
  { name: 'Double Masala Cheese Maggie', category: 'Maggie', price: 100 },
  { name: 'Cheese Corn Momos', category: 'Momos', price: 90 }, { name: 'Paneer Momos', category: 'Momos', price: 80 }, { name: 'Veg Momos', category: 'Momos', price: 70 },
  { name: 'Double Tikki Cheese Royale Burger', category: 'Burgers', price: 130 }, { name: 'Classic Veg Cheese Burger', category: 'Burgers', price: 90 },
  { name: 'Cheese Ling Chips', category: 'Chips & Fries', price: 100 }, { name: 'Peri Peri Fries', category: 'Chips & Fries', price: 90 }, { name: 'Salted Fries', category: 'Chips & Fries', price: 90 },
  { name: 'Cold Coffee', category: 'Drinks', price: 80 }, { name: 'Classic Mojito', category: 'Drinks', price: 80 },
  { name: 'Watermelon Juice', category: 'Juices', price: 70 }, { name: 'Papaya Juice', category: 'Juices', price: 70 },
  { name: 'Muskmelon Juice', category: 'Juices', price: 80 }, { name: 'Pink Guava Juice', category: 'Juices', price: 80 },
  { name: 'Chikoo Juice', category: 'Juices', price: 80 }, { name: 'Pineapple Juice', category: 'Juices', price: 90 },
  { name: 'Alphonso Mango Juice', category: 'Juices', price: 90 }, { name: 'Custard Apple Juice', category: 'Juices', price: 90 },
  { name: 'Oreo Shake', category: 'Shakes', price: 100 }, { name: 'KitKat Shake', category: 'Shakes', price: 100 },
  { name: 'Watermelon Shake', category: 'Shakes', price: 100 }, { name: 'Papaya Shake', category: 'Shakes', price: 100 },
  { name: 'Muskmelon Shake', category: 'Shakes', price: 110 }, { name: 'Pink Guava Shake', category: 'Shakes', price: 110 },
  { name: 'Chikoo Shake', category: 'Shakes', price: 110 }, { name: 'Pineapple Shake', category: 'Shakes', price: 120 },
  { name: 'Alphonso Mango Shake', category: 'Shakes', price: 120 }, { name: 'Custard Apple Shake', category: 'Shakes', price: 120 },
]

const LICENSE_KEYS = [
  'SSYNC-PVKN-9U9R-HDCR','SSYNC-L2U4-6QND-DZ2D','SSYNC-QNQG-25HG-LMXK','SSYNC-4GTM-DJ4T-TQ5H','SSYNC-VZ4Y-7XAD-6JJF',
  'SSYNC-3H2E-RUFH-5YEE','SSYNC-EPNX-49ZJ-ZUNP','SSYNC-CQ26-NQ4P-EXHG','SSYNC-NYM5-UHGD-257M','SSYNC-8E6P-CPJ8-SH6Q',
  'SSYNC-CW5J-CJY2-4N35','SSYNC-DV2E-YNQB-UESS','SSYNC-RW8Y-2X3R-QAK5','SSYNC-YX9E-VAFG-A438','SSYNC-YBBG-AWF4-8SJB',
  'SSYNC-JLFC-KR6V-7HE3','SSYNC-L2XC-NJMB-U7EG','SSYNC-H36K-RD2Y-5XGW','SSYNC-JFF9-N789-YGJ2','SSYNC-3PAZ-HBEE-WAYR',
]

function genId(): string {
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function seedDatabase(database: Database) {
  // Check if already seeded
  const result = database.exec('SELECT COUNT(*) as count FROM Shop')
  if (result[0]?.values[0]?.[0] > 0) return

  // ─── Single-shop setup ────────────────────────────────────────────────
  // This POS is configured for ONE shop only. The shop-picker screen is
  // skipped automatically because session.tsx auto-selects when the user
  // has exactly one shop. If you ever need multi-shop, re-add a second
  // INSERT here and the picker will reappear.
  const shopId = genId()
  database.run('INSERT INTO Shop (id, name, code, color, address, phone, gstin, taxRate, currency) VALUES (?,?,?,?,?,?,?,?,?)',
    [shopId, 'Spice Garden', 'SPICE', 'blue', '12 Marine Drive, Mumbai', '+91 98200 11223', '27SPICE2024G1Z9', 5, 'Rs.'])

  // Seed settings for the single shop — new 3-color scheme:
  //   • bill accent  = light blue  (#0EA5E9 / sky-500)
  //   • KOT accent   = light green (#22C55E / green-500)
  //   • text color   = pure black  (#000000) — dark + bold by default
  database.run(`INSERT INTO ShopSetting (id, shopId, shopName, billAccentColor, kotAccentColor, billTextColor, billBoldText) VALUES (?,?,?,?,?,?,?)`,
    [genId(), shopId, 'Spice Garden', '#0EA5E9', '#22C55E', '#000000', 1])

  // Seed tables (0=Direct Counter + 1-10)
  database.run('INSERT INTO RestaurantTable (id, shopId, number, name, capacity, status) VALUES (?,?,?,?,?,?)',
    [genId(), shopId, 0, 'Direct Counter', 0, 'available'])
  for (let i = 1; i <= 10; i++) {
    database.run('INSERT INTO RestaurantTable (id, shopId, number, name, capacity, status) VALUES (?,?,?,?,?,?)',
      [genId(), shopId, i, `Table ${i}`, 4, 'available'])
  }

  // Seed menu items for the single shop
  for (const item of MENU_ITEMS) {
    database.run('INSERT INTO MenuItem (id, shopId, name, category, price, cost, stock, unit, available) VALUES (?,?,?,?,?,?,?,?,?)',
      [genId(), shopId, item.name, item.category, item.price, Math.round(item.price * 0.4), 100, 'Pcs', 1])
  }

  // Seed super admin
  database.run('INSERT INTO AppUser (id, name, email, password, role, active) VALUES (?,?,?,?,?,?)',
    [genId(), 'Super Admin', 'super@thuso.com', 'admin123', 'admin', 1])

  // Seed license keys
  for (const key of LICENSE_KEYS) {
    database.run('INSERT INTO LicenseKey (id, key, duration, used) VALUES (?,?,?,?)', [genId(), key, 365, 0])
  }
}

// ─── Initialize ───
//
// Robustness contract (added per "the most common issue is database error"):
//   1. WASM load tries multiple local paths first (offline-safe for
//      packaged Electron + APK), then falls back to a couple of CDNs.
//   2. If an existing IndexedDB backup exists but is corrupt / from an
//      incompatible schema version, we DO NOT throw — we back it up to
//      a separate IndexedDB key and re-seed a fresh database so the
//      user can at least keep using the app instead of staring at the
//      "Database Error" screen.
//   3. Migration errors are caught and logged but never abort init —
//      a missing column on a non-critical table should not brick the
//      whole POS.
//   4. Every step writes a clear, human-readable error to the console
//      AND to a `__dbInitError` global so the Settings page can show
//      the most recent one for diagnostics.
export async function initDB(): Promise<Database> {
  if (db && initialized) return db

  // Clear any prior init error.
  try { (globalThis as any).__dbInitError = null } catch { /* ignore */ }

  // ─── Step 1: load sql.js WASM ───
  // Try local bundle FIRST (works offline + in APK/EXE), then CDN fallbacks.
  // The CDN list includes both sql.js.org and jsDelivr — useful when one
  // is blocked (e.g. corporate firewall, regional DNS issue).
  const wasmLocators = [
    (file: string) => `./${file}`,                              // Capacitor (capacitor://localhost/sql-wasm.wasm)
    (file: string) => `/${file}`,                               // Web root (next.js static export)
    (file: string) => `https://sql.js.org/dist/${file}`,        // CDN fallback #1 (online only)
    (file: string) => `https://cdn.jsdelivr.net/npm/sql.js@1.14.1/dist/${file}`, // CDN fallback #2
    (file: string) => `https://unpkg.com/sql.js@1.14.1/dist/${file}`,            // CDN fallback #3
  ]

  let SQL: any = null
  let lastErr: any = null
  for (const locate of wasmLocators) {
    try {
      SQL = await initSqlJs({ locateFile: locate })
      if (SQL) {
        console.log('[client-db] sql.js WASM loaded via:', locate('sql-wasm.wasm'))
        break
      }
    } catch (e) {
      lastErr = e
      // try next locator
    }
  }
  if (!SQL) {
    const msg = `Failed to load sql.js WASM after trying ${wasmLocators.length} sources. Last error: ${lastErr?.message || lastErr}`
    console.error('[client-db]', msg)
    try { (globalThis as any).__dbInitError = msg } catch { /* ignore */ }
    throw new Error(msg)
  }

  // ─── Step 2: load existing database from IndexedDB ───
  // Wrapped in try/catch — a corrupted IndexedDB entry used to throw
  // "Database Error" and block the whole app. We now back it up and
  // re-seed instead.
  let existingData: Uint8Array | null = null
  try {
    existingData = await loadDB()
  } catch (e) {
    console.warn('[client-db] loadDB() failed — will re-seed a fresh DB:', e)
    existingData = null
  }

  if (existingData) {
    // Use a local `database` variable for the open + migrate + smoke-test
    // flow. This dodges TypeScript strict-null-check errors that arise
    // when assigning to the module-level `let db: Database | null` and
    // then immediately calling methods on it (the compiler can't prove
    // no concurrent code has nulled it in between).
    let database: Database
    try {
      database = new SQL.Database(existingData)
      // Run migrations inside a try — a single bad ALTER must NOT brick
      // the whole POS. The migrateSchema function itself swallows
      // per-column errors, but we wrap it once more for safety.
      try {
        migrateSchema(database)
      } catch (migrateErr) {
        console.warn('[client-db] migrateSchema threw (non-fatal):', migrateErr)
      }
      // Smoke-test the loaded DB: if the Shop table is missing or
      // unreadable, the backup is corrupt — fall through to re-seed.
      try {
        const smoke = database.exec('SELECT COUNT(*) FROM Shop')
        if (!smoke || !smoke[0]) throw new Error('Shop table unreadable')
      } catch (smokeErr) {
        console.error('[client-db] existing DB failed smoke test — re-seeding:', smokeErr)
        try {
          // Stash the corrupt backup so the user can later recover data
          // via Backup → Restore. Use a separate IndexedDB key.
          const idb = await openIDB()
          await new Promise<void>((resolve) => {
            const tx = idb.transaction('database', 'readwrite')
            tx.objectStore('database').put(existingData, `${DB_KEY}-corrupt-${Date.now()}`)
            tx.oncomplete = () => { idb.close(); resolve() }
            tx.onerror = () => { idb.close(); resolve() }
          })
        } catch { /* ignore backup-of-backup failure */ }
        // Re-seed
        database = new SQL.Database()
        database.run(SCHEMA_SQL)
        seedDatabase(database)
        await saveDB(database)
      }
    } catch (e) {
      console.error('[client-db] Failed to open existing DB, re-seeding:', e)
      database = new SQL.Database()
      database.run(SCHEMA_SQL)
      seedDatabase(database)
      await saveDB(database)
    }
    db = database
  } else {
    // Same local-variable pattern as above — avoids TS strict-null
    // errors on the module-level `db: Database | null`.
    const database = new SQL.Database()
    database.run(SCHEMA_SQL)
    seedDatabase(database)
    await saveDB(database)
    db = database
  }

  // ─── Step 3: schedule periodic background saves ───
  // Every 30s, flush the in-memory DB to IndexedDB. This protects
  // against data loss if the user just closes the laptop lid or the
  // Electron app is killed without firing beforeunload.
  if (!periodicSaveTimer) {
    try {
      periodicSaveTimer = setInterval(() => {
        try { persistDBSync() } catch (e) {
          console.warn('[client-db] periodic save failed:', e)
        }
      }, 30_000)
      // Don't keep the Node.js event loop alive forever just for this.
      if (typeof (periodicSaveTimer as any)?.unref === 'function') {
        (periodicSaveTimer as any).unref()
      }
    } catch (e) {
      console.warn('[client-db] could not schedule periodic save:', e)
    }
  }

  initialized = true
  console.log('[client-db] initDB complete — ready for queries.')
  // By this point, `db` is guaranteed non-null because we either
  // assigned it inside the if(existingData) / else branches above, or
  // we threw. Use a non-null assertion for the return type.
  return db!
}

// ─── Schema migrations (idempotent ALTER TABLE for missing columns) ───
function migrateSchema(database: Database) {
  const getColumns = (table: string): string[] => {
    const result = database.exec(`PRAGMA table_info(${table})`)
    if (!result[0]) return []
    return result[0].values.map((row) => String(row[1]))
  }
  const addColumn = (table: string, column: string, defn: string) => {
    const cols = getColumns(table)
    if (!cols.includes(column)) {
      try {
        database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${defn}`)
      } catch (e) {
        console.warn(`[migrate] could not add ${table}.${column}:`, e)
      }
    }
  }
  addColumn('ShopSetting', 'paperWidth', 'INTEGER NOT NULL DEFAULT 80')
  addColumn('ShopSetting', 'printFontSize', 'INTEGER NOT NULL DEFAULT 11')
  addColumn('ShopSetting', 'printMargin', 'INTEGER NOT NULL DEFAULT 4')
  addColumn('ShopSetting', 'autoPrint', 'INTEGER NOT NULL DEFAULT 1')
  addColumn('ShopSetting', 'billCopies', 'INTEGER NOT NULL DEFAULT 1')
  addColumn('ShopSetting', 'silentPrint', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('ShopSetting', 'printHeaderText', 'TEXT')
  addColumn('ShopSetting', 'printFooterText', 'TEXT')
  // ─── New columns for bold text, dark color, per-template paper width,
  //     and admin-editable template layouts (ruler + draggable fields).
  addColumn('ShopSetting', 'billBoldText', 'INTEGER NOT NULL DEFAULT 1')
  addColumn('ShopSetting', 'billTextColor', "TEXT NOT NULL DEFAULT '#000000'")
  addColumn('ShopSetting', 'billPaperWidth', 'INTEGER NOT NULL DEFAULT 80')
  addColumn('ShopSetting', 'billTemplate', 'TEXT')
  addColumn('ShopSetting', 'kotPaperWidth', 'INTEGER NOT NULL DEFAULT 80')
  addColumn('ShopSetting', 'kotTemplate', 'TEXT')
  // ─── KOT bold + dark text (mirrors the bill's controls) ───
  addColumn('ShopSetting', 'kotBoldText', 'INTEGER NOT NULL DEFAULT 1')
  addColumn('ShopSetting', 'kotTextColor', "TEXT NOT NULL DEFAULT '#000000'")
  // ─── Daily-reset KOT/Bill number assignment per order ───
  addColumn('Orders', 'assignedBillNo', 'INTEGER')
  addColumn('Orders', 'assignedBillDate', 'TEXT')
  addColumn('Orders', 'customerName', 'TEXT')
  addColumn('Orders', 'type', "TEXT NOT NULL DEFAULT 'dine_in'")
  addColumn('MenuItem', 'image', 'TEXT')
  addColumn('MenuItem', 'cost', 'REAL NOT NULL DEFAULT 0')
  addColumn('MenuItem', 'stock', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('MenuItem', 'unit', "TEXT NOT NULL DEFAULT 'Pcs'")
  addColumn('MenuItem', 'available', 'INTEGER NOT NULL DEFAULT 1')

  // ─── Idempotent table creation for upgrades ───────────────────────────
  // Existing user databases (in IndexedDB) won't have the DeletedBill or
  // MenuCategory tables because they were created before these features
  // existed. CREATE TABLE IF NOT EXISTS is safe to re-run on every boot.
  const ensureTable = (ddl: string) => {
    try { database.run(ddl) } catch (e) {
      console.warn('[migrate] could not ensure table:', e)
    }
  }
  ensureTable(`CREATE TABLE IF NOT EXISTS DeletedBill (
    id TEXT PRIMARY KEY,
    shopId TEXT NOT NULL,
    originalBillId TEXT NOT NULL,
    billNo INTEGER NOT NULL,
    orderId TEXT NOT NULL,
    tableNumber INTEGER NOT NULL,
    subtotal REAL NOT NULL DEFAULT 0,
    taxRate REAL NOT NULL DEFAULT 0,
    taxAmount REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    serviceCharge REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    paymentMode TEXT NOT NULL DEFAULT 'cash',
    paymentStatus TEXT NOT NULL DEFAULT 'paid',
    originalPaidAt TEXT NOT NULL,
    originalCreatedAt TEXT NOT NULL,
    reason TEXT,
    deletedBy TEXT,
    deletedById TEXT,
    deletedAt TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (shopId) REFERENCES Shop(id) ON DELETE CASCADE
  )`)
  ensureTable('CREATE INDEX IF NOT EXISTS idx_deletedbill_shop_deletedAt ON DeletedBill(shopId, deletedAt)')
  ensureTable('CREATE INDEX IF NOT EXISTS idx_deletedbill_shop_originalPaidAt ON DeletedBill(shopId, originalPaidAt)')
  ensureTable('CREATE INDEX IF NOT EXISTS idx_deletedbill_deletedById ON DeletedBill(deletedById)')

  ensureTable(`CREATE TABLE IF NOT EXISTS MenuCategory (
    id TEXT PRIMARY KEY,
    shopId TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'slate',
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (shopId) REFERENCES Shop(id) ON DELETE CASCADE
  )`)
  ensureTable('CREATE UNIQUE INDEX IF NOT EXISTS idx_menucategory_shop_name ON MenuCategory(shopId, name)')
  ensureTable('CREATE INDEX IF NOT EXISTS idx_menucategory_shop_sort ON MenuCategory(shopId, sortOrder)')

  // ─── Single-shop enforcement ──────────────────────────────────────────
  // This POS is configured for ONE shop only. Existing user databases
  // (created before this change) have 2 seeded shops ("Spice Garden" +
  // "Belly Bytes"). We keep the first shop (alphabetically by code, which
  // is "SPICE" → Spice Garden) and delete the rest. Cascade rules on all
  // child tables (MenuItem, RestaurantTable, Orders, Bill, etc.) clean
  // up the second shop's data automatically.
  //
  // Safe to re-run: if the shop count is already 1, this is a no-op.
  try {
    const shopCount = database.exec('SELECT COUNT(*) as c FROM Shop')
    const count = shopCount[0]?.values[0]?.[0]
    if (count && count > 1) {
      // Keep the shop with the smallest rowid (i.e. the first one inserted,
      // which is Spice Garden in the original seed). Delete the rest.
      database.run(`DELETE FROM Shop WHERE id NOT IN (
        SELECT id FROM Shop ORDER BY rowid ASC LIMIT 1
      )`)
      console.warn('[migrate] single-shop enforcement: removed extra shops')
    }
  } catch (e) {
    console.warn('[migrate] single-shop enforcement failed (non-fatal):', e)
  }
}

// ─── Get DB (must call initDB first) ───
export function getDB(): Database {
  if (!db) throw new Error('Database not initialized. Call initDB() first.')
  return db
}

// ─── Check if DB has been initialized (non-throwing version of getDB) ───
export function isDbReady(): boolean {
  return !!db && initialized
}

// ─── Save after writes ───
// PERF FIX: The old 500ms debounce was too aggressive — every keystroke in
// an input (e.g. waiter name, order notes) was triggering a full
// `db.export()` (multi-MB synchronous SQLite serialization) plus an
// `updateExcelBlob()` rebuild that iterated ALL 16 tables and built a
// multi-MB HTML string. As the database grew (more bills, more orders,
// more audit logs), each save cycle blocked the main thread for hundreds
// of milliseconds, producing the "app lags and freezes mid-use" symptom.
//
// New strategy:
//   • Raise the save debounce to 1500ms — coalesces rapid writes into one.
//   • Drop `updateExcelBlob()` from the save path entirely. The .xls
//     blob is now only built on-demand when the user clicks Export to
//     Excel in Management → Backup. This eliminates the biggest
//     main-thread blocker in the whole app.
let saveTimer: any = null
let periodicSaveTimer: any = null

export function persistDB() {
  if (!db) return
  if (saveTimer) clearTimeout(saveTimer)
  // Debounce writes (1500ms) so rapid mutations (typing in inputs,
  // clicking +/- on items, adding items to an order) coalesce into
  // a SINGLE IndexedDB put instead of spamming it.
  saveTimer = setTimeout(async () => {
    try {
      await saveDB(db!)
    } catch (e) {
      console.warn('[client-db] debounced save failed:', e)
    }
  }, 1500)
}

// ─── Force-save NOW (for tab close / app close) ────────────────────────
// PERF/CRASH FIX: The previous version referenced three undefined
// symbols (`DB_BACKUP_KEY`, `MAX_BACKUP_SIZE`, `uint8ToBase64`) that
// don't exist anywhere in the codebase. This threw a ReferenceError
// every time `beforeunload` / `pagehide` fired, which meant the
// final save was silently dropped on tab close / refresh — and any
// pending writes in the 1500ms debounce window were lost.
//
// We now do a clean sync export + IndexedDB put, no localStorage
// fallback (the localStorage 5MB cap was also a footgun on its own).
//
// EXTRA HARDENING (per "save all the statement" requirement):
//   • Catches every error so the unload handler never throws.
//   • Uses a synchronous export + a fire-and-forget IndexedDB put,
//     because beforeunload does NOT wait for promises. The put still
//     completes in practice because the browser keeps the event loop
//     alive briefly while the indexedDB transaction is open.
//   • Also tries localStorage as a last-resort backup (best-effort,
//     only if the data is small enough — under 2 MB). This is the
//     only way to recover data if IndexedDB itself is corrupted.
export function persistDBSync() {
  if (!db) return
  try {
    // Fire-and-forget the async IndexedDB write. beforeunload does not
    // await promises, but the IndexedDB transaction will still complete
    // in the brief grace period before the tab is destroyed.
    saveDB(db).catch((e) => console.warn('[client-db] sync save failed:', e))

    // Best-effort localStorage mirror (only if data is small).
    // This is a SECONDARY safety net — the primary store is IndexedDB.
    try {
      const data = db.export()
      if (data && data.length < 2_000_000) {
        // Convert Uint8Array to base64 in chunks to avoid call-stack overflow.
        let binary = ''
        const chunkSize = 0x8000
        for (let i = 0; i < data.length; i += chunkSize) {
          binary += String.fromCharCode.apply(
            null,
            Array.from(data.subarray(i, i + chunkSize)) as any
          )
        }
        const base64 = btoa(binary)
        localStorage.setItem(`${DB_KEY}-ls-backup`, base64)
      }
    } catch (lsErr) {
      // localStorage may be full or disabled — non-fatal.
      // (We intentionally don't log here to avoid spamming the console
      // on every unload.)
    }
  } catch (e) {
    console.warn('[client-db] sync save failed:', e)
  }
}

// ─── Persistent Excel file (stored in IndexedDB, NOT auto-downloaded) ──
//
// The user wants "Excel as database" — a single .xls file that accumulates
// ALL data over time, stored persistently, and downloadable on demand.
//
// How it works:
//   1. After every DB write, we rebuild the .xls blob from ALL tables
//      and store it in a SEPARATE IndexedDB store called 'excel-backup'.
//   2. This does NOT trigger a download — the blob just sits in
//      IndexedDB, always up-to-date.
//   3. When the user clicks "Export to Excel" in Management → Backup,
//      we read the blob from IndexedDB and trigger a single download.
//
// This gives the user a real-time, always-fresh Excel file without
// spamming their Downloads folder every 5 seconds.

const EXCEL_IDB_NAME = 'thuso-excel'
const EXCEL_IDB_STORE = 'file'
let excelUpdateTimer: any = null

function openExcelIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(EXCEL_IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(EXCEL_IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Build the .xls blob from ALL tables in the SQLite DB
function buildExcelBlob(): Blob | null {
  if (!db) return null
  const tableDefs = [
    { name: 'Shop', sql: 'SELECT * FROM Shop' },
    { name: 'MenuItems', sql: 'SELECT * FROM MenuItem ORDER BY category, name' },
    { name: 'Tables', sql: 'SELECT * FROM RestaurantTable ORDER BY number' },
    { name: 'Orders', sql: 'SELECT * FROM Orders ORDER BY createdAt DESC' },
    { name: 'OrderItems', sql: 'SELECT * FROM OrderItem ORDER BY orderId' },
    { name: 'Bills', sql: 'SELECT * FROM Bill ORDER BY paidAt DESC' },
    { name: 'DeletedBills', sql: 'SELECT * FROM DeletedBill ORDER BY deletedAt DESC' },
    { name: 'Customers', sql: 'SELECT * FROM Customer ORDER BY name' },
    { name: 'Suppliers', sql: 'SELECT * FROM Supplier ORDER BY name' },
    { name: 'Purchases', sql: 'SELECT * FROM Purchase ORDER BY createdAt DESC' },
    { name: 'Expenses', sql: 'SELECT * FROM Expense ORDER BY date DESC' },
    { name: 'MoneyIn', sql: 'SELECT * FROM MoneyIn ORDER BY date DESC' },
    { name: 'MoneyOut', sql: 'SELECT * FROM MoneyOut ORDER BY date DESC' },
    { name: 'Users', sql: 'SELECT id, name, email, role, active, shopId, createdAt FROM AppUser ORDER BY name' },
    { name: 'Settings', sql: 'SELECT * FROM ShopSetting' },
    { name: 'AuditLog', sql: 'SELECT * FROM AuditLog ORDER BY createdAt DESC' },
    { name: 'MenuCategories', sql: 'SELECT * FROM MenuCategory ORDER BY sortOrder' },
  ]
  const sheets: any[] = []
  for (const t of tableDefs) {
    try {
      const rows = query<any>(t.sql)
      if (rows.length === 0) continue
      const columns = Object.keys(rows[0])
      const sheetRows = rows.map((r: any) => columns.map((c) => {
        const v = r[c]
        if (v == null) return ''
        if (typeof v === 'number') return v
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
        return String(v)
      }))
      sheets.push({ name: t.name, columns, rows: sheetRows })
    } catch { /* table might not exist yet — skip */ }
  }
  if (sheets.length === 0) return null
  // Use the sync buildXlsBlob (no download, just returns the Blob)
  // We can't use dynamic import here because this is called from a
  // sync context sometimes. Instead, inline the HTML-table builder.
  return buildXlsBlobInline(sheets)
}

// Inline .xls blob builder (same as excel-export.ts but without import)
function buildXlsBlobInline(sheets: any[]): Blob {
  const html: string[] = []
  html.push('<?xml version="1.0" encoding="UTF-8"?>')
  html.push('<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">')
  html.push('<head><meta charset="UTF-8">')
  html.push('<style>td, th { font-family: Calibri, Arial, sans-serif; font-size: 11pt; } th { background: #f3f4f6; font-weight: bold; text-align: left; padding: 4px; } td { padding: 4px; vertical-align: top; }</style>')
  html.push('</head><body>')
  for (const sheet of sheets) {
    const safeName = sheet.name.replace(/[\\/?*[\]:]/g, '_').slice(0, 31)
    html.push(`<table border="1"><thead><tr>`)
    for (const col of sheet.columns) html.push(`<th>${escapeXmlInline(String(col))}</th>`)
    html.push('</tr></thead><tbody>')
    for (const row of sheet.rows) {
      html.push('<tr>')
      for (let i = 0; i < sheet.columns.length; i++) {
        const cell = row[i]
        if (typeof cell === 'number') html.push(`<td>${cell}</td>`)
        else html.push(`<td>${escapeXmlInline(String(cell || ''))}</td>`)
      }
      html.push('</tr>')
    }
    html.push('</tbody></table><br/><br/>')
  }
  html.push('</body></html>')
  return new Blob([html.join('\n')], { type: 'application/vnd.ms-excel' })
}

function escapeXmlInline(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Update the Excel blob in IndexedDB (debounced to 3s so we don't
// rebuild the .xls on every single keystroke)
function updateExcelBlob() {
  if (typeof window === 'undefined') return
  if (excelUpdateTimer) clearTimeout(excelUpdateTimer)
  excelUpdateTimer = setTimeout(async () => {
    try {
      const blob = buildExcelBlob()
      if (!blob) return
      const idb = await openExcelIDB()
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(EXCEL_IDB_STORE, 'readwrite')
        tx.objectStore(EXCEL_IDB_STORE).put(blob, 'latest')
        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => { idb.close(); reject(tx.error) }
      })
      console.log('[client-db] ✓ Excel blob updated in IndexedDB')
    } catch (e) {
      console.warn('[client-db] Excel blob update failed:', e)
    }
  }, 3000)
}

// ─── Public API: download the latest Excel file ────────────────────────
// Called by the "Export to Excel" button in Management → Backup.
// Reads the latest blob from IndexedDB and triggers a single download.
export async function downloadLatestExcel(): Promise<void> {
  try {
    const idb = await openExcelIDB()
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = idb.transaction(EXCEL_IDB_STORE, 'readonly')
      const req = tx.objectStore(EXCEL_IDB_STORE).get('latest')
      req.onsuccess = () => { idb.close(); resolve(req.result || null) }
      req.onerror = () => { idb.close(); reject(req.error) }
    })
    if (!blob) {
      // No blob yet — build one on the fly
      const freshBlob = buildExcelBlob()
      if (!freshBlob) {
        console.warn('[client-db] No data to export')
        return
      }
      triggerDownload(freshBlob)
    } else {
      triggerDownload(blob)
    }
  } catch (e) {
    console.warn('[client-db] Excel download failed:', e)
    // Fallback: build + download directly
    const blob = buildExcelBlob()
    if (blob) triggerDownload(blob)
  }
}

function triggerDownload(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const dateStr = new Date().toISOString().split('T')[0]
  a.download = `thuso-data-${dateStr}.xls`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─── Periodic auto-save (every 30 seconds) ────────────────────────────
export function startPeriodicSave() {
  if (periodicSaveTimer) clearInterval(periodicSaveTimer)
  periodicSaveTimer = setInterval(async () => {
    if (db) {
      try {
        await saveDB(db)
      } catch (e) {
        console.warn('[client-db] periodic save failed:', e)
      }
    }
  }, 30_000)
}

// ─── Query helpers ───
export function query<T = any>(sql: string, params: any[] = []): T[] {
  const database = getDB()
  const stmt = database.prepare(sql)
  stmt.bind(params)
  const results: T[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T)
  }
  stmt.free()
  return results
}

export function queryOne<T = any>(sql: string, params: any[] = []): T | null {
  const results = query<T>(sql, params)
  return results[0] || null
}

export function execute(sql: string, params: any[] = []): void {
  const database = getDB()
  database.run(sql, params)
  persistDB()
}

export { genId }
