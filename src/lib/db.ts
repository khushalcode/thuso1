import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  /** Set to true once the auto-migration has run in this process. */
  __thusoSchemaMigrated?: boolean
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// ─── Non-destructive auto-migration on startup ─────────────────────────
//
// PROBLEM: When a user updates their .exe (Electron build), the new code
// ships with a Prisma schema that may have new columns the user's
// existing database doesn't know about. The DB lives in
// `%APPDATA%/Thuso/db/custom.db` (Electron's userData dir) and is
// preserved across updates — which is exactly what the user wants
// ("retrieve old data also") — but Prisma generates SQL that references
// the new columns, so the first request after an update would throw
// `no such column: OrderItem.kotPrinted` and break the whole app.
//
// We can't run `prisma db push` from inside the packaged .exe (Prisma
// CLI isn't bundled), so we apply the migrations inline using raw SQL
// `ALTER TABLE … ADD COLUMN` statements. Each migration is:
//   1. idempotent — checks PRAGMA table_info() first so it's a no-op
//      if the column already exists (fresh install OR already-migrated DB)
//   2. non-destructive — only adds columns with safe defaults; never
//      drops, renames, or rewrites existing data
//   3. wrapped in try/catch — a migration failure must NEVER block the
//      app from starting; the worst case is the new feature doesn't
//      work and we log a warning so the user can report it
//
// Add a new block to the array below every time the schema gains a
// column that existing user installs won't have.
const SCHEMA_MIGRATIONS: Array<{ table: string; column: string; type: string }> = [
  // ─── v1 (this update): OrderItem.kotPrinted ───
  // Used by the KOT re-print logic to persist which items have already
  // been printed. Existing rows default to false (= not yet printed),
  // which is the safe state — the cashier can still re-print everything.
  { table: 'OrderItem', column: 'kotPrinted', type: 'BOOLEAN NOT NULL DEFAULT 0' },
]

async function applyStartupMigrations() {
  if (globalForPrisma.__thusoSchemaMigrated) return
  globalForPrisma.__thusoSchemaMigrated = true

  try {
    for (const m of SCHEMA_MIGRATIONS) {
      // Check if the column already exists — PRAGMA table_info returns
      // one row per column with the column name in field `name`.
      const cols = await (db as any).$queryRawUnsafe(`PRAGMA table_info(${m.table})`)
      const exists = Array.isArray(cols) && cols.some((c: any) => c.name === m.column)
      if (exists) continue

      // Column is missing — add it with the declared type + default.
      // SQLite's ALTER TABLE ADD COLUMN is non-destructive: existing
      // rows get the column's DEFAULT value, no data is lost.
      // Note: we wrap the column name in double quotes so reserved
      // words / mixed-case identifiers work too.
      console.log(`[db] applying migration: ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`)
      await (db as any).$executeRawUnsafe(
        `ALTER TABLE ${m.table} ADD COLUMN "${m.column}" ${m.type}`
      )
      console.log(`[db] migration applied: ${m.table}.${m.column}`)
    }
  } catch (e: any) {
    // Non-fatal — log and continue. The app will still start; the
    // feature that depends on this column will throw a more specific
    // error at request time, which is easier to debug than a startup
    // crash.
    console.warn('[db] startup migration failed (non-fatal):', e?.message || e)
  }
}

// Fire-and-forget — the migrations run in the background while the
// Next.js server boots. By the time the first API request lands,
// they've almost certainly completed. If a request comes in mid-
// migration, Prisma will throw a transient "no such column" error
// which the client already retries (the Reports page has a Retry
// button, the Counter mode re-fetches on the next interaction, etc.).
void applyStartupMigrations()
