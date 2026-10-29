# Thuso POS — Latest Changes

## 🔒 Data Preservation on Update (IMPORTANT)

When you build a new `.exe` from this code and install it over your
existing installation, **ALL your existing data is preserved** — bills,
orders, menu items, customers, settings, everything.

How it works:
- The database lives at `%APPDATA%/Thuso/db/custom.db` (Electron's
  `userData` directory), NOT in the program folder. Installing a new
  `.exe` does NOT touch this file.
- The new code ships with a **non-destructive auto-migration** in
  `src/lib/db.ts` that runs on app startup. It checks the actual
  SQLite schema (via `PRAGMA table_info`) and adds any new columns
  that are missing using `ALTER TABLE … ADD COLUMN` — which is
  non-destructive in SQLite (existing rows get the column's DEFAULT
  value, no data is lost).
- This means you can safely ship the new `.exe` to your existing
  users. Their old data will be there, and the new KOT re-print
  feature will work on any new orders they create (existing order
  items will have `kotPrinted=false`, which is the correct state for
  "not yet printed").

Verified with a simulation test (`scripts/test-migration.js`):
- Snapshot of all table counts taken
- `OrderItem.kotPrinted` column dropped (simulating old DB)
- Migration runs → column re-added via `ALTER TABLE`
- All table counts match the snapshot — zero data loss

---

## Sales Reports — Item-Wise Sales Summary (NEW)

The **Item-Wise Sales Summary** is now the FIRST table on the Reports
page (right after the charts). For every item sold in the selected
period, it shows ONE aggregated row — not separate rows per bill:

| Column                | Example                              |
|-----------------------|--------------------------------------|
| Item Name             | Daal Makhani                         |
| Category              | Main Course                          |
| **Total Qty Sold**    | **29** sold (big orange number)      |
| Avg Price             | ₹65.00                               |
| **Total Sell Amount** | **₹1,885.00** (bold emerald)         |
| % of Sales            | 12.4%                                |

Three prominent grand-total chips at the top of the card:
**Items Sold**, **Total Sell Amount**, **Unique Items**.

Footer has a matching **Grand Total** row with the same two numbers
in larger orange + emerald type.

Excel / PDF / CSV exports all use the same column names and include a
`GRAND TOTAL` row at the bottom of the Item-Wise Sales sheet.

---

## Earlier Changes (from previous round)

### 1. Sidebar scrollbar hidden
The management sidebar's scrollbar is now invisible (still scrolls).

### 2. Customer name on the Tables screen
Occupied table cards show `👤 Customer Name` at the top of the order
summary (hidden if no name is set).

### 3. Customer name asked when creating a bill
A "Customer Name" input appears at the top of the Billing dialog
(auto-focused, pre-filled from the order if already set). The name is
persisted on the order in the same DB transaction that marks it `paid`.

### 4. Customer name shows on KOT
The KOT receipt renders a `Customer:` line between `Table:` and
`Guests:` (hidden when no name is set). The kitchen display also
shows `👤 Name` on the ticket header.

### 5. KOT re-print logic fixed (server-side, persisted)
First print returns ALL items; re-prints return ONLY newly-added items.
A new `kotPrinted` boolean column on `OrderItem` persists the printed
state across page reloads and table close/reopen. The migration that
adds this column is the one described in the "Data Preservation"
section above — your existing users' databases will get the column
added automatically on first launch of the new .exe.

---

## Run Instructions (Dev)

```bash
# Install dependencies
bun install

# Apply the schema (creates db/custom.db if missing, adds new columns
# if existing — non-destructive)
bunx prisma generate
bunx prisma db push

# Start dev server
bun run dev
# → http://localhost:3000
```

## Build the .exe

```bash
# Build the standalone Next.js server + Electron wrapper
bash scripts/build-exe.sh           # auto-detect OS
bash scripts/build-exe.sh --win     # force Windows .exe (needs wine on Linux)
bash scripts/build-exe.sh --linux   # force Linux AppImage
bash scripts/build-exe.sh --mac     # force macOS .dmg
```

The installer will be in `download/`. Ship it to your users — their
existing data at `%APPDATA%/Thuso/db/custom.db` will be preserved and
automatically migrated on first launch.
