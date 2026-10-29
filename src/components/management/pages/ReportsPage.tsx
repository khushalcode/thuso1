'use client'

import { useState, useEffect, useMemo, Fragment } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart3, TrendingUp, Receipt, Wallet, Download, Filter, Package,
  CreditCard, FileJson, FileSpreadsheet, FileText, FileDown, ChevronDown, ChevronUp,
  Search, Calendar, Users, Tag, IndianRupee, ShoppingBag, AlertCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, Legend, PieChart, Pie, Cell, LineChart, Line,
} from 'recharts'
import { formatCurrency, formatDateTime } from '@/lib/format'
import { useShopFetch } from '@/hooks/use-shop-fetch'
import { useSession } from '@/lib/session'
import { downloadExcel, downloadCsv, downloadPdf, type Sheet } from '@/lib/excel-export'
import { PdfExportDialog, buildDefaultsFromCurrentFilters, type PdfExportOptions } from './PdfExportDialog'
import { toast } from 'sonner'

const PIE_COLORS = ['#f97316', '#10b981', '#8b5cf6', '#ef4444', '#3b82f6', '#0f172a', '#eab308']

type PeriodType = 'today' | '7d' | '30d' | 'monthly' | 'range'

export default function ReportsPage() {
  const shopFetch = useShopFetch()
  const { currentShop } = useSession()

  // ─── Filter state ──────────────────────────────────────────────────────
  const [period, setPeriod] = useState<PeriodType>('today')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [paymentMode, setPaymentMode] = useState('all')
  const [tableNumber, setTableNumber] = useState('all')
  const [billNoSearch, setBillNoSearch] = useState('')
  const [itemSearch, setItemSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [waiter, setWaiter] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  // BUG 5 FIX: Surface fetch errors instead of silently rendering a
  // blank page. Previously any thrown error (sql.js not ready, schema
  // drift, corrupted row, network blip) was swallowed by the missing
  // `catch` block — `setData` was never called and `if (!data) return
  // null` made the entire Reports tab disappear. The user could not
  // tell whether reports were loading, empty, or broken. Now we
  // capture the error and render an explicit error card with a Retry
  // button.
  const [error, setError] = useState<string | null>(null)
  // BUG 5 FIX: A counter we bump to force the data-loading useEffect
  // to re-run (retry). The useEffect depends on `retryToken` so
  // bumping it re-fetches the report.
  const [retryToken, setRetryToken] = useState(0)
  const [expandedBill, setExpandedBill] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  // ─── Pre-download export dialog state ──────────────────────────────
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportDefaults, setExportDefaults] = useState<Partial<PdfExportOptions>>({
    period: 'today', format: 'pdf', reportType: 'summary',
  })

  // Compute from/to ISO strings based on the selected period
  const { fromIso, toIso } = useMemo(() => {
    const now = new Date()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    switch (period) {
      case 'today':
        return { fromIso: today.toISOString(), toIso: end.toISOString() }
      case '7d': {
        const d = new Date(today)
        d.setDate(d.getDate() - 6)
        return { fromIso: d.toISOString(), toIso: end.toISOString() }
      }
      case '30d': {
        const d = new Date(today)
        d.setDate(d.getDate() - 29)
        return { fromIso: d.toISOString(), toIso: end.toISOString() }
      }
      case 'monthly': {
        const d = new Date(today)
        d.setDate(1)
        return { fromIso: d.toISOString(), toIso: end.toISOString() }
      }
      case 'range': {
        const f = from ? new Date(from) : new Date(0)
        f.setHours(0, 0, 0, 0)
        const t = to ? new Date(to) : new Date()
        t.setHours(23, 59, 59, 999)
        return { fromIso: f.toISOString(), toIso: t.toISOString() }
      }
    }
  }, [period, from, to])

  // Build the query string from all filters
  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    p.set('from', fromIso)
    p.set('to', toIso)
    if (paymentMode !== 'all') p.set('paymentMode', paymentMode)
    if (tableNumber !== 'all') p.set('table', tableNumber)
    if (billNoSearch) p.set('billNo', billNoSearch)
    if (itemSearch) p.set('item', itemSearch)
    if (category !== 'all') p.set('category', category)
    if (waiter) p.set('waiter', waiter)
    if (minAmount) p.set('minAmount', minAmount)
    if (maxAmount) p.set('maxAmount', maxAmount)
    return p.toString()
  }, [fromIso, toIso, paymentMode, tableNumber, billNoSearch, itemSearch, category, waiter, minAmount, maxAmount])

  // Load report data whenever filters change
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      // BUG 5 FIX: Clear any previous error so the loading skeleton
      // shows instead of a stale error card during refetch.
      setError(null)
      try {
        const res = await shopFetch(`/api/reports?${queryString}`)
        // BUG 5 FIX: shopFetch returns a Response object; a non-2xx
        // status (e.g. 500 from a thrown Prisma error) doesn't throw
        // automatically. We have to check `res.ok` and surface the
        // body's error message.
        if (!res.ok) {
          let msg = `Reports request failed (HTTP ${res.status})`
          try {
            const body = await res.json()
            if (body?.error) msg = String(body.error)
          } catch { /* non-JSON body */ }
          throw new Error(msg)
        }
        const d = await res.json()
        if (!cancelled) {
          setData(d)
        }
      } catch (e: any) {
        // BUG 5 FIX: Capture the error message so we can render an
        // explicit error card with a Retry button instead of going
        // blank.
        console.error('[ReportsPage] failed to load report:', e)
        if (!cancelled) {
          setError(e?.message || String(e) || 'Failed to load reports')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    const t = setTimeout(load, 300) // debounce 300ms
    return () => { cancelled = true; clearTimeout(t) }
  }, [queryString, shopFetch, retryToken]) // BUG 5 FIX: include retryToken

  // Load categories for the filter dropdown
  useEffect(() => {
    shopFetch('/api/menu-categories')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.categories)) {
          setCategories(d.categories.map((c: any) => c.name))
        }
      })
      .catch(() => {})
  }, [shopFetch])

  const clearAllFilters = () => {
    setPaymentMode('all')
    setTableNumber('all')
    setBillNoSearch('')
    setItemSearch('')
    setCategory('all')
    setWaiter('')
    setMinAmount('')
    setMaxAmount('')
  }

  const activeFilterCount =
    (paymentMode !== 'all' ? 1 : 0) +
    (tableNumber !== 'all' ? 1 : 0) +
    (billNoSearch ? 1 : 0) +
    (itemSearch ? 1 : 0) +
    (category !== 'all' ? 1 : 0) +
    (waiter ? 1 : 0) +
    (minAmount ? 1 : 0) +
    (maxAmount ? 1 : 0)

  // ─── Derived state (must be computed BEFORE any early returns so the
  // useMemo below always runs in the same position in the hook list —
  // otherwise React's Rules-of-Hooks check throws "Rendered fewer
  // hooks than expected" when the loading/error early-returns fire
  // before this line on the first render).
  const DISPLAY_LIMIT = 200
  const bills: any[] = data?.bills || []
  const itemizedRows: any[] = data?.itemizedRows || []
  const displayedBills = bills.slice(0, DISPLAY_LIMIT)

  // PERF FIX: Memoize the four tfoot reduces so they don't re-run
  // on every state change (expand row, search keystroke, filter
  // toggle). With 200 bills in the period, the previous code ran
  // 4 × 200 = 800 reduce iterations per re-render.
  const billTotals = useMemo(() => {
    let subtotal = 0, taxAmount = 0, discount = 0, total = 0
    // BUG 3 FIX: Iterate `displayedBills` (sliced), not `bills` (full).
    for (const b of displayedBills) {
      subtotal += (b.subtotal || 0)
      taxAmount += (b.taxAmount || 0)
      discount += (b.discount || 0)
      total += (b.total || 0)
    }
    return { subtotal, taxAmount, discount, total }
  }, [displayedBills])

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-40 bg-slate-200 rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 bg-slate-100 rounded-2xl animate-pulse" />)}
        </div>
      </div>
    )
  }

  // BUG 5 FIX: Render an explicit error card instead of `return null`
  // when the report fetch fails. This is the most likely root cause of
  // the user's "Reports section is not working properly" complaint —
  // any thrown error in `reports.get()` (sql.js not ready, schema
  // drift, corrupted row, etc.) previously made the entire Reports
  // tab disappear silently. Now the user sees what went wrong and can
  // click Retry to re-fetch once they've addressed the underlying
  // issue (e.g. waited for the DB to finish seeding).
  if (error && !data) {
    return (
      <div className="space-y-4">
        <Card className="border-0 shadow-md rounded-2xl">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 text-rose-500" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              Reports failed to load
            </h3>
            <p className="text-sm text-slate-600 mb-4 max-w-md mx-auto break-words">
              {error}
            </p>
            <p className="text-xs text-slate-400 mb-4">
              This usually happens when the local database is still
              initialising or has been corrupted. Try again in a few
              seconds, or restart the app.
            </p>
            <Button
              onClick={() => {
                setError(null)
                setRetryToken((n) => n + 1)
              }}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data) return null
  const s = data.summary

  // ─── Stat cards ────────────────────────────────────────────────────────
  // BUG 1 FIX: Add separate cards for Cash Flow (the real bottom line
  // including owner contributions/withdrawals) and Money In / Money Out
  // so the user can see all four components of the cash calculation.
  // Previously the UI only showed "Net Profit" which silently ignored
  // MoneyIn/MoneyOut, hiding real cash movement from the owner.
  const stats = [
    { title: 'Sales Revenue', value: formatCurrency(s.salesRevenue), icon: TrendingUp, gradient: 'from-emerald-500 to-teal-500', sub: `${s.billCount} bills` },
    { title: 'Items Sold', value: String(s.totalItemsSold || 0), icon: ShoppingBag, gradient: 'from-orange-500 to-rose-500', sub: `${data.topItems?.length || 0} unique items` },
    { title: 'Avg Bill', value: formatCurrency(s.avgBill || 0), icon: IndianRupee, gradient: 'from-violet-500 to-fuchsia-500', sub: `per bill` },
    {
      title: 'Net Profit',
      value: formatCurrency(s.netProfit),
      icon: BarChart3,
      gradient: s.netProfit >= 0 ? 'from-blue-500 to-indigo-500' : 'from-rose-500 to-pink-500',
      sub: `sales − expenses − purchases`,
    },
    {
      title: 'Money In',
      value: formatCurrency(s.totalMoneyIn || 0),
      icon: Wallet,
      gradient: 'from-emerald-500 to-green-500',
      sub: `owner contributions`,
    },
    {
      title: 'Money Out',
      value: formatCurrency(s.totalMoneyOut || 0),
      icon: Wallet,
      gradient: 'from-rose-500 to-red-500',
      sub: `owner withdrawals`,
    },
    {
      title: 'Cash Flow',
      value: formatCurrency(s.cashFlow ?? s.netProfit),
      icon: TrendingUp,
      gradient: (s.cashFlow ?? s.netProfit) >= 0 ? 'from-emerald-600 to-teal-600' : 'from-rose-600 to-pink-600',
      sub: `net cash movement`,
    },
  ]

  // ─── Charts data ───────────────────────────────────────────────────────
  const paymentData = Object.entries(data.byPayment || {}).map(([mode, v]: [string, any]) => ({
    name: mode.toUpperCase(),
    value: v.total,
    count: v.count,
  }))

  const categoryData = (data.byCategory || []).slice(0, 8).map((c: any) => ({
    name: c.name.length > 15 ? c.name.slice(0, 12) + '…' : c.name,
    fullName: c.name,
    revenue: c.revenue,
    qty: c.qty,
  }))

  const hourlyData = (data.hourlyBreakdown || []).filter((h: any) => h.count > 0)

  // ─── Export handlers ───────────────────────────────────────────────────
  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${period}-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportExcel = () => {
    const sheets: Sheet[] = []
    sheets.push({
      name: 'Summary',
      columns: ['Metric', 'Value'],
      rows: [
        ['Sales Revenue', s.salesRevenue],
        ['Bill Count', s.billCount],
        ['Items Sold', s.totalItemsSold || 0],
        ['Avg Bill', s.avgBill],
        ['Total Expenses', s.totalExpenses],
        ['Total Purchases', s.totalPurchases],
        // BUG 1 FIX: Include MoneyIn / MoneyOut / Cash Flow in the
        // Excel export so the full cash picture is exported.
        ['Money In (owner contributions)', s.totalMoneyIn || 0],
        ['Money Out (owner withdrawals)', s.totalMoneyOut || 0],
        ['Net Profit', s.netProfit],
        ['Cash Flow', s.cashFlow ?? s.netProfit],
        ['Period', period],
        ['Generated At', new Date().toISOString().replace('T', ' ').slice(0, 19)],
      ],
    })
    if (bills.length > 0) {
      sheets.push({
        name: 'Bills',
        columns: ['Bill No', 'Date', 'Table', 'Waiter', 'Customer', 'Items', 'Payment', 'Subtotal', 'Tax', 'Discount', 'Service', 'Total'],
        rows: bills.map((b: any) => [
          b.billNo,
          (b.paidAt || '').slice(0, 19).replace('T', ' '),
          b.tableNumber,
          b.order?.waiterName || '',
          b.order?.customerName || '',
          b.order?.items?.filter((i: any) => i.status !== 'cancelled').length || 0,
          (b.paymentMode || '').toUpperCase(),
          Number(b.subtotal) || 0,
          Number(b.taxAmount) || 0,
          Number(b.discount) || 0,
          Number(b.serviceCharge) || 0,
          Number(b.total) || 0,
        ]),
      })
    }
    if (itemizedRows.length > 0) {
      sheets.push({
        name: 'Itemized Sales',
        columns: ['Bill No', 'Date', 'Table', 'Waiter', 'Item', 'Category', 'Qty', 'Price', 'Line Total', 'Bill Total', 'Payment'],
        rows: itemizedRows.map((r: any) => [
          r.billNo,
          (r.paidAt || '').slice(0, 19).replace('T', ' '),
          r.tableNumber,
          r.waiterName || '',
          r.itemName,
          r.category,
          r.quantity,
          r.price,
          r.lineTotal,
          r.billTotal,
          (r.paymentMode || '').toUpperCase(),
        ]),
      })
    }
    if ((data.topItems || []).length > 0) {
      // Per user request: clearer column names that emphasize this is the
      // aggregated per-item view ("Total Qty Sold" + "Total Sell Amount")
      // rather than per-bill line items.
      const totalQty = (data.topItems || []).reduce((sum: number, it: any) => sum + (it.qty || 0), 0)
      const totalRev = (data.topItems || []).reduce((sum: number, it: any) => sum + (it.revenue || 0), 0)
      sheets.push({
        name: 'Item-Wise Sales',
        columns: ['Item Name', 'Category', 'Total Qty Sold', 'Avg Price', 'Total Sell Amount', '% of Sales'],
        rows: [
          ...(data.topItems || []).map((it: any) => [
            it.name,
            it.category || 'General',
            Number(it.qty) || 0,
            it.qty > 0 ? Number((it.revenue / it.qty).toFixed(2)) : 0,
            Number(it.revenue) || 0,
            s.salesRevenue > 0 ? Number(((it.revenue / s.salesRevenue) * 100).toFixed(1)) : 0,
          ]),
          // Grand total row at the bottom of the sheet so accountants can
          // see "Total X units sold, ₹Y in revenue" without re-summing.
          ['GRAND TOTAL', '', Number(totalQty) || 0, '', Number(totalRev) || 0, 100],
        ],
      })
    }
    if ((data.byCategory || []).length > 0) {
      sheets.push({
        name: 'By Category',
        columns: ['Category', 'Qty Sold', 'Revenue'],
        rows: (data.byCategory || []).map((c: any) => [c.name, Number(c.qty) || 0, Number(c.revenue) || 0]),
      })
    }
    if ((data.dailyBreakdown || []).length > 0) {
      sheets.push({
        name: 'Daily Breakdown',
        columns: ['Date', 'Sales', 'Expenses', 'Bill Count'],
        rows: (data.dailyBreakdown || []).map((d: any) => [
          d.date, Number(d.sales || 0) || 0, Number(d.expenses || 0) || 0, Number(d.count || 0) || 0,
        ]),
      })
    }
    const paymentEntries = Object.entries(data.byPayment || {})
    if (paymentEntries.length > 0) {
      sheets.push({
        name: 'Payment Modes',
        columns: ['Mode', 'Total', 'Count'],
        rows: paymentEntries.map(([mode, v]: [string, any]) => [
          mode.toUpperCase(), Number(v.total || 0) || 0, Number(v.count || 0) || 0,
        ]),
      })
    }
    const expenseEntries = Object.entries(data.expenseByCategory || {})
    if (expenseEntries.length > 0) {
      sheets.push({
        name: 'Expenses by Category',
        columns: ['Category', 'Amount'],
        rows: expenseEntries.map(([cat, amt]: [string, any]) => [cat, Number(amt) || 0]),
      })
    }
    const dateStr = new Date().toISOString().split('T')[0]
    downloadExcel(sheets, `sales-report-${period}-${dateStr}`)
  }

  // ─── PDF export ───
  // Reuses the same sheet builder as Excel export, but renders to a
  // print-ready PDF via the browser's native print-to-PDF. The user
  // picks "Save as PDF" from the print dialog. This gives accountants
  // a clean printable report without needing Excel.
  const handleExportPdf = () => {
    const sheets: Sheet[] = []
    sheets.push({
      name: 'Summary',
      columns: ['Metric', 'Value'],
      rows: [
        ['Sales Revenue', formatCurrency(s.salesRevenue)],
        ['Bill Count', s.billCount],
        ['Items Sold', s.totalItemsSold || 0],
        ['Avg Bill', formatCurrency(s.avgBill)],
        ['Total Expenses', formatCurrency(s.totalExpenses)],
        ['Total Purchases', formatCurrency(s.totalPurchases)],
        // BUG 1 FIX: Include MoneyIn / MoneyOut / Cash Flow in the
        // export so accountants see the full cash picture.
        ['Money In (owner contributions)', formatCurrency(s.totalMoneyIn || 0)],
        ['Money Out (owner withdrawals)', formatCurrency(s.totalMoneyOut || 0)],
        ['Net Profit', formatCurrency(s.netProfit)],
        ['Cash Flow', formatCurrency(s.cashFlow ?? s.netProfit)],
        ['Period', period],
        ['Generated At', new Date().toLocaleString()],
      ],
    })
    if (bills.length > 0) {
      sheets.push({
        name: 'Bills',
        columns: ['Bill No', 'Date', 'Table', 'Waiter', 'Customer', 'Items', 'Payment', 'Subtotal', 'Tax', 'Discount', 'Service', 'Total'],
        rows: bills.map((b: any) => [
          b.billNo,
          (b.paidAt || '').slice(0, 19).replace('T', ' '),
          b.tableNumber,
          b.order?.waiterName || '',
          b.order?.customerName || '',
          b.order?.items?.filter((i: any) => i.status !== 'cancelled').length || 0,
          (b.paymentMode || '').toUpperCase(),
          formatCurrency(Number(b.subtotal) || 0),
          formatCurrency(Number(b.taxAmount) || 0),
          formatCurrency(Number(b.discount) || 0),
          formatCurrency(Number(b.serviceCharge) || 0),
          formatCurrency(Number(b.total) || 0),
        ]),
      })
    }
    if (itemizedRows.length > 0) {
      sheets.push({
        name: 'Itemized Sales',
        columns: ['Bill No', 'Date', 'Table', 'Waiter', 'Item', 'Category', 'Qty', 'Price', 'Line Total', 'Bill Total', 'Payment'],
        rows: itemizedRows.map((r: any) => [
          r.billNo,
          (r.paidAt || '').slice(0, 19).replace('T', ' '),
          r.tableNumber,
          r.waiterName || '',
          r.itemName,
          r.category,
          r.quantity,
          formatCurrency(r.price),
          formatCurrency(r.lineTotal),
          formatCurrency(r.billTotal),
          (r.paymentMode || '').toUpperCase(),
        ]),
      })
    }
    if ((data.topItems || []).length > 0) {
      // Per user request: clearer column names + grand-total row, mirroring
      // the on-screen "Item-Wise Sales Summary" card so the PDF export
      // matches what the cashier sees in the browser.
      const totalQty = (data.topItems || []).reduce((sum: number, it: any) => sum + (it.qty || 0), 0)
      const totalRev = (data.topItems || []).reduce((sum: number, it: any) => sum + (it.revenue || 0), 0)
      sheets.push({
        name: 'Item-Wise Sales',
        columns: ['Item Name', 'Category', 'Total Qty Sold', 'Avg Price', 'Total Sell Amount', '% of Sales'],
        rows: [
          ...(data.topItems || []).map((it: any) => [
            it.name,
            it.category || 'General',
            Number(it.qty) || 0,
            formatCurrency(it.qty > 0 ? Number((it.revenue / it.qty).toFixed(2)) : 0),
            formatCurrency(Number(it.revenue) || 0),
            s.salesRevenue > 0 ? Number(((it.revenue / s.salesRevenue) * 100).toFixed(1)) : 0,
          ]),
          ['GRAND TOTAL', '', Number(totalQty) || 0, '', formatCurrency(Number(totalRev) || 0), 100],
        ],
      })
    }
    if ((data.byCategory || []).length > 0) {
      sheets.push({
        name: 'By Category',
        columns: ['Category', 'Qty Sold', 'Revenue'],
        rows: (data.byCategory || []).map((c: any) => [c.name, Number(c.qty) || 0, formatCurrency(Number(c.revenue) || 0)]),
      })
    }
    if ((data.dailyBreakdown || []).length > 0) {
      sheets.push({
        name: 'Daily Breakdown',
        columns: ['Date', 'Sales', 'Expenses', 'Bill Count'],
        rows: (data.dailyBreakdown || []).map((d: any) => [
          d.date, formatCurrency(Number(d.sales || 0) || 0), formatCurrency(Number(d.expenses || 0) || 0), Number(d.count || 0) || 0,
        ]),
      })
    }
    const paymentEntries = Object.entries(data.byPayment || {})
    if (paymentEntries.length > 0) {
      sheets.push({
        name: 'Payment Modes',
        columns: ['Mode', 'Total', 'Count'],
        rows: paymentEntries.map(([mode, v]: [string, any]) => [
          mode.toUpperCase(), formatCurrency(Number(v.total || 0) || 0), Number(v.count || 0) || 0,
        ]),
      })
    }
    const expenseEntries = Object.entries(data.expenseByCategory || {})
    if (expenseEntries.length > 0) {
      sheets.push({
        name: 'Expenses by Category',
        columns: ['Category', 'Amount'],
        rows: expenseEntries.map(([cat, amt]: [string, any]) => [cat, formatCurrency(Number(amt) || 0)]),
      })
    }
    const dateStr = new Date().toISOString().split('T')[0]
    downloadPdf(sheets, `sales-report-${period}-${dateStr}`)
  }

  const handleExportCsv = () => {
    // Export the item-wise aggregated sales as CSV — per user request,
    // this is the "total qty per item + total sell amount" view (NOT the
    // per-bill line items). Falls back to the per-bill detail if no
    // aggregated items are available so the export never comes back empty.
    const hasItemWise = (data.topItems || []).length > 0
    const sheet: Sheet = hasItemWise
      ? {
          name: 'Item-Wise Sales',
          columns: ['Item Name', 'Category', 'Total Qty Sold', 'Avg Price', 'Total Sell Amount', '% of Sales'],
          rows: [
            ...(data.topItems || []).map((it: any) => [
              it.name,
              it.category || 'General',
              Number(it.qty) || 0,
              it.qty > 0 ? Number((it.revenue / it.qty).toFixed(2)) : 0,
              Number(it.revenue) || 0,
              s.salesRevenue > 0 ? Number(((it.revenue / s.salesRevenue) * 100).toFixed(1)) : 0,
            ]),
            // Grand total row so the cashier / accountant can see
            // "Total X units sold, ₹Y in revenue" at a glance.
            [
              'GRAND TOTAL',
              '',
              Number((data.topItems || []).reduce((sum: number, it: any) => sum + (it.qty || 0), 0)),
              '',
              Number((data.topItems || []).reduce((sum: number, it: any) => sum + (it.revenue || 0), 0)),
              100,
            ],
          ],
        }
      : {
          name: 'Itemized Sales',
          columns: ['Bill No', 'Date', 'Table', 'Waiter', 'Customer', 'Item', 'Category', 'Qty', 'Price', 'Line Total', 'Bill Total', 'Payment'],
          rows: itemizedRows.length > 0
            ? itemizedRows.map((r: any) => [
                r.billNo,
                (r.paidAt || '').slice(0, 19).replace('T', ' '),
                r.tableNumber,
                r.waiterName || '',
                r.customerName || '',
                r.itemName,
                r.category,
                r.quantity,
                r.price,
                r.lineTotal,
                r.billTotal,
                (r.paymentMode || '').toUpperCase(),
              ])
            : bills.map((b: any) => [
                b.billNo,
                (b.paidAt || '').slice(0, 19).replace('T', ' '),
                b.tableNumber,
                b.order?.waiterName || '',
                b.order?.customerName || '',
                b.order?.items?.filter((i: any) => i.status !== 'cancelled').length || 0,
                '',
                '',
                '',
                '',
                Number(b.total) || 0,
                (b.paymentMode || '').toUpperCase(),
              ]),
        }
    const dateStr = new Date().toISOString().split('T')[0]
    downloadCsv(sheet, `sales-${hasItemWise ? 'item-wise' : 'detail'}-${period}-${dateStr}`)
  }

  // ─── Open the pre-download export dialog ──────────────────────────
  const openExportDialog = (format: 'pdf' | 'excel' | 'csv') => {
    setExportDefaults(
      buildDefaultsFromCurrentFilters({
        period,
        from,
        to,
        paymentMode,
        currentShopId: currentShop?.id || '',
      })
    )
    setExportDefaults((prev) => ({ ...prev, format }))
    setExportDialogOpen(true)
  }

  return (
    <div className="space-y-5">
      {/* BUG 5 FIX: Non-blocking warning when a refetch fails but we
          still have stale data to show. Helps the user understand
          why totals may not match the latest filter change. */}
      {error && data && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              Showing previous data — last refresh failed: {error}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-amber-400 text-amber-800 hover:bg-amber-100"
            onClick={() => {
              setError(null)
              setRetryToken((n) => n + 1)
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight">Sales Reports</h1>
          <p className="text-[10px] sm:text-sm text-slate-500">Detailed sales analytics with advanced filters · {s.billCount} bills · {s.totalItemsSold || 0} items</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openExportDialog('csv')} className="border-sky-300 text-sky-700 hover:bg-sky-50">
            <FileText className="w-3.5 h-3.5 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => openExportDialog('excel')} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => openExportDialog('pdf')} className="border-rose-300 text-rose-700 hover:bg-rose-50">
            <FileDown className="w-3.5 h-3.5 mr-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportJson}>
            <FileJson className="w-3.5 h-3.5 mr-1" /> JSON
          </Button>
        </div>
      </div>

      {/* ─── Pre-download export dialog ─────────────────────────────── */}
      <PdfExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        defaults={exportDefaults}
        onDownloaded={(filename, fmt) => {
          toast.success(`${fmt.toUpperCase()} report ready: ${filename}`)
        }}
      />

      {/* ─── Filter bar ────────────────────────────────────────────────── */}
      <Card className="border-0 shadow-md rounded-2xl p-4 bg-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Filters</span>
            {activeFilterCount > 0 && (
              <Badge className="text-[10px] bg-orange-100 text-orange-700 border-orange-200">{activeFilterCount} active</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-[10px] text-rose-500 h-7">
                Clear all
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setShowAdvanced(!showAdvanced)} className="text-[10px] h-7">
              {showAdvanced ? 'Less' : 'More'} filters
              {showAdvanced ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Period */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><Calendar className="w-3 h-3" /> Period</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodType)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
                <SelectItem value="monthly">This Month</SelectItem>
                <SelectItem value="range">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Payment mode */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><CreditCard className="w-3 h-3" /> Payment</Label>
            <Select value={paymentMode} onValueChange={setPaymentMode}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payments</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="space-y-1.5">
            <Label className="text-xs">Table</Label>
            <Select value={tableNumber} onValueChange={setTableNumber}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tables</SelectItem>
                <SelectItem value="0">Direct Counter</SelectItem>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>Table {n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Bill # search */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><Search className="w-3 h-3" /> Bill #</Label>
            <Input
              value={billNoSearch}
              onChange={(e) => setBillNoSearch(e.target.value)}
              placeholder="e.g. 1001"
              className="h-9"
            />
          </div>
        </div>

        {/* Date range (only when period === 'range') */}
        {period === 'range' && (
          <div className="mt-3 grid grid-cols-2 gap-3 max-w-md">
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
            </div>
          </div>
        )}

        {/* Advanced filters (collapsible) */}
        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-200">
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Package className="w-3 h-3" /> Item Search</Label>
                  <Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="e.g. Pizza" className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Tag className="w-3 h-3" /> Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Users className="w-3 h-3" /> Waiter</Label>
                  <Input value={waiter} onChange={(e) => setWaiter(e.target.value)} placeholder="e.g. Riya" className="h-9" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Min ₹</Label>
                    <Input type="number" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="0" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Max ₹</Label>
                    <Input type="number" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="∞" className="h-9" />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active filter chips */}
        {activeFilterCount > 0 && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-slate-500">Active:</span>
            {paymentMode !== 'all' && <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700">{paymentMode.toUpperCase()}</Badge>}
            {tableNumber !== 'all' && <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700">Table {tableNumber}</Badge>}
            {billNoSearch && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700">#{billNoSearch}</Badge>}
            {itemSearch && <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">"{itemSearch}"</Badge>}
            {category !== 'all' && <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700">{category}</Badge>}
            {waiter && <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700">Waiter: {waiter}</Badge>}
            {minAmount && <Badge variant="outline" className="text-[10px] bg-slate-50">Min ₹{minAmount}</Badge>}
            {maxAmount && <Badge variant="outline" className="text-[10px] bg-slate-50">Max ₹{maxAmount}</Badge>}
          </div>
        )}
      </Card>

      {/* ─── Stat cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((st, i) => (
          <motion.div key={st.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="border-0 shadow-md rounded-2xl overflow-hidden relative">
              <div className={`absolute inset-0 bg-gradient-to-br ${st.gradient} opacity-95`} />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.25),transparent_60%)]" />
              <CardContent className="relative p-4 text-white">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-medium text-white/80 uppercase tracking-wide">{st.title}</span>
                  <st.icon className="w-4 h-4 text-white/80" />
                </div>
                <div className="text-xl sm:text-2xl font-bold">{st.value}</div>
                <div className="text-[10px] text-white/70">{st.sub}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* ─── Charts row 1: Sales trend + Payment pie ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-0 shadow-md rounded-2xl">
          <CardHeader className="pb-1 px-5 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-900">Sales vs Expenses (Daily)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-2 sm:px-4 pb-4">
            {data.dailyBreakdown?.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.dailyBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => `₹${v}`} axisLine={false} tickLine={false} width={45} />
                  <RechartsTooltip formatter={(v: any, name: string) => [formatCurrency(Number(v)), name === 'sales' ? 'Sales' : 'Expenses']} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="sales" name="Sales" fill="#10b981" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-[250px] flex items-center justify-center text-sm text-slate-400">No data for the period</div>}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md rounded-2xl">
          <CardHeader className="pb-1 px-5 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-900">Payment Mode Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-2 sm:px-4 pb-4">
            {paymentData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={paymentData} cx="50%" cy="50%" labelLine={false} label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`} outerRadius={80} fill="#8884d8" dataKey="value">
                    {paymentData.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip formatter={(v: any) => formatCurrency(Number(v))} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="h-[250px] flex items-center justify-center text-sm text-slate-400">No payment data</div>}
          </CardContent>
        </Card>
      </div>

      {/* ─── Charts row 2: Hourly + Category ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-0 shadow-md rounded-2xl">
          <CardHeader className="pb-1 px-5 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-900">Hourly Sales</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-2 sm:px-4 pb-4">
            {hourlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={hourlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={1} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => `₹${v}`} axisLine={false} tickLine={false} width={45} />
                  <RechartsTooltip formatter={(v: any) => [formatCurrency(Number(v)), 'Sales']} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Line type="monotone" dataKey="sales" stroke="#f97316" strokeWidth={2.5} dot={{ fill: '#f97316', r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <div className="h-[250px] flex items-center justify-center text-sm text-slate-400">No hourly data</div>}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md rounded-2xl">
          <CardHeader className="pb-1 px-5 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-900">Revenue by Category</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-2 sm:px-4 pb-4">
            {categoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={categoryData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v: number) => `₹${v}`} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={100} />
                  <RechartsTooltip formatter={(v: any) => [formatCurrency(Number(v)), 'Revenue']} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-[250px] flex items-center justify-center text-sm text-slate-400">No category data</div>}
          </CardContent>
        </Card>
      </div>

      {/* ─── Item-Wise Sales Summary (moved up & enhanced) ───────────────
          Per user request: show item-wise totals — "total 29 daal" along
          with the total sell amount — aggregated across ALL bills in the
          period (NOT separated per bill). This is now the FIRST table on
          the page so the cashier sees it before the per-bill detail. */}
      <Card className="border-0 shadow-md rounded-2xl overflow-hidden ring-1 ring-orange-200">
        <CardHeader className="pb-2 px-5 pt-5 bg-gradient-to-r from-orange-50 to-rose-50 border-b border-orange-100">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-orange-500" />
                Item-Wise Sales Summary
              </CardTitle>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Total quantity &amp; revenue per item across the selected period
              </p>
            </div>
            {/* Per user request: prominent grand-total chips at the top of
                the item-wise section. "Total X items sold" + "Total sell
                amount ₹Y" so the cashier can read the bottom line at a
                glance without scrolling to the table footer. */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="bg-white rounded-lg px-3 py-1.5 border border-orange-200 shadow-sm">
                <div className="text-[9px] font-semibold text-slate-500 uppercase tracking-wide">Items Sold</div>
                <div className="text-base font-bold text-orange-600">
                  {(data.topItems || []).reduce((s: number, it: any) => s + (it.qty || 0), 0)}
                  <span className="text-[10px] font-medium text-slate-400 ml-1">units</span>
                </div>
              </div>
              <div className="bg-white rounded-lg px-3 py-1.5 border border-emerald-200 shadow-sm">
                <div className="text-[9px] font-semibold text-slate-500 uppercase tracking-wide">Total Sell Amount</div>
                <div className="text-base font-bold text-emerald-600">
                  {formatCurrency((data.topItems || []).reduce((s: number, it: any) => s + (it.revenue || 0), 0))}
                </div>
              </div>
              <div className="bg-white rounded-lg px-3 py-1.5 border border-slate-200 shadow-sm">
                <div className="text-[9px] font-semibold text-slate-500 uppercase tracking-wide">Unique Items</div>
                <div className="text-base font-bold text-slate-700">
                  {(data.topItems || []).length}
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto max-h-[500px] thin-scrollbar">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="text-left font-semibold text-slate-600 px-3 py-2 w-10">#</th>
                  <th className="text-left font-semibold text-slate-600 px-3 py-2">Item Name</th>
                  <th className="text-left font-semibold text-slate-600 px-3 py-2">Category</th>
                  <th className="text-right font-semibold text-slate-600 px-3 py-2">Total Qty Sold</th>
                  <th className="text-right font-semibold text-slate-600 px-3 py-2">Avg Price</th>
                  <th className="text-right font-semibold text-slate-600 px-3 py-2">Total Sell Amount</th>
                  <th className="text-right font-semibold text-slate-600 px-3 py-2">% of Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data.topItems || []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-10 text-slate-400">
                      <Package className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                      No items sold in this period
                    </td>
                  </tr>
                ) : (
                  (data.topItems || []).map((it: any, i: number) => {
                    const totalRevenue = s.salesRevenue || 1
                    const pct = ((it.revenue / totalRevenue) * 100).toFixed(1)
                    const avgPrice = it.qty > 0 ? it.revenue / it.qty : 0
                    return (
                      <tr key={it.name} className="hover:bg-orange-50/40">
                        <td className="px-3 py-2.5 text-slate-400 font-mono">{i + 1}</td>
                        <td className="px-3 py-2.5 font-semibold text-slate-900">{it.name}</td>
                        <td className="px-3 py-2.5">
                          <Badge variant="outline" className="text-[9px] bg-slate-50">
                            {it.category || 'General'}
                          </Badge>
                        </td>
                        {/* Per user request: total qty per item shown
                            prominently as "29 Daal" style — big bold number
                            + item-name suffix so it reads naturally. */}
                        <td className="px-3 py-2.5 text-right">
                          <span className="inline-flex items-baseline gap-1 justify-end">
                            <span className="text-base font-bold text-orange-600 tabular-nums">{it.qty}</span>
                            <span className="text-[10px] text-slate-400">sold</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">{formatCurrency(avgPrice)}</td>
                        {/* Total sell amount per item — bold emerald so it
                            visually pairs with the orange qty number. */}
                        <td className="px-3 py-2.5 text-right">
                          <span className="text-sm font-bold text-emerald-700 tabular-nums">{formatCurrency(it.revenue)}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-500 tabular-nums">{pct}%</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
              {(data.topItems || []).length > 0 && (
                <tfoot className="bg-slate-900 text-white sticky bottom-0">
                  <tr>
                    <td colSpan={3} className="px-3 py-3 text-right font-semibold">
                      Grand Total ({(data.topItems || []).length} unique items)
                    </td>
                    <td className="px-3 py-3 text-right font-bold text-orange-400 text-base tabular-nums">
                      {(data.topItems || []).reduce((s: number, it: any) => s + (it.qty || 0), 0)}
                    </td>
                    <td></td>
                    <td className="px-3 py-3 text-right font-bold text-emerald-400 text-base tabular-nums">
                      {formatCurrency((data.topItems || []).reduce((s: number, it: any) => s + (it.revenue || 0), 0))}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ─── Detailed Sales Table (expandable per bill) ──────────────── */}
      <Card className="border-0 shadow-md rounded-2xl overflow-hidden">
        <CardHeader className="pb-1 px-5 pt-5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-slate-900">
              Detailed Sales ({bills.length} bills)
            </CardTitle>
            <span className="text-[10px] text-slate-400">Click a row to expand itemized details</span>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="text-left font-semibold text-slate-600 px-3 py-2 w-6"></th>
                  <th className="text-left font-semibold text-slate-600 px-3 py-2">Bill #</th>
                  <th className="text-left font-semibold text-slate-600 px-3 py-2">Date / Time</th>
                  <th className="text-left font-semibold text-slate-600 px-3 py-2">Table</th>
                  <th className="text-left font-semibold text-slate-600 px-3 py-2">Waiter</th>
                  <th className="text-left font-semibold text-slate-600 px-3 py-2">Items</th>
                  <th className="text-left font-semibold text-slate-600 px-3 py-2">Payment</th>
                  <th className="text-right font-semibold text-slate-600 px-3 py-2">Subtotal</th>
                  <th className="text-right font-semibold text-slate-600 px-3 py-2">Tax</th>
                  <th className="text-right font-semibold text-slate-600 px-3 py-2">Disc</th>
                  <th className="text-right font-semibold text-slate-600 px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bills.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-10 text-slate-400">
                      <AlertCircle className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                      No bills match the current filters
                    </td>
                  </tr>
                ) : (
                  // BUG 3 FIX: Use the `displayedBills` slice (computed
                  // above) so the rendered rows and the footer totals
                  // both come from the same array.
                  displayedBills.map((b: any) => {
                    const isExpanded = expandedBill === b.id
                    const items = (b.order?.items || []).filter((i: any) => i.status !== 'cancelled')
                    // BUG 8 FIX: Direct Counter bills use tableNumber=0.
                    // Display "Direct Counter" in the badge instead of
                    // the confusing "Table 0" — matches the filter
                    // dropdown which already labels them this way.
                    const tableLabel = b.tableNumber === 0
                      ? 'Direct Counter'
                      : `Table ${b.tableNumber}`
                    return (
                      // REACT FIX: Use a keyed <Fragment> instead of `<>`.
                      // Previously the key was on the inner <tr>s, which
                      // doesn't satisfy React's list-key requirement and
                      // could cause the expanded items table to render
                      // under the wrong bill when toggling.
                      <Fragment key={b.id}>
                        <tr
                          className="hover:bg-slate-50 cursor-pointer"
                          onClick={() => setExpandedBill(isExpanded ? null : b.id)}
                        >
                          <td className="px-3 py-2 text-slate-400">
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </td>
                          <td className="px-3 py-2 font-mono font-semibold text-slate-900">#{b.billNo}</td>
                          <td className="px-3 py-2 text-slate-600">{formatDateTime(b.paidAt)}</td>
                          <td className="px-3 py-2"><Badge variant="outline" className="text-[9px]">{tableLabel}</Badge></td>
                          <td className="px-3 py-2 text-slate-600">{b.order?.waiterName || '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{items.length}</td>
                          <td className="px-3 py-2"><Badge variant="outline" className="text-[9px] uppercase">{b.paymentMode}</Badge></td>
                          <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(b.subtotal)}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(b.taxAmount)}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{formatCurrency(b.discount)}</td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">{formatCurrency(b.total)}</td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-amber-50/50">
                            <td colSpan={11} className="px-6 py-3">
                              <div className="rounded-lg bg-white border border-slate-200 overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead className="bg-slate-100">
                                    <tr>
                                      <th className="text-left font-semibold text-slate-600 px-3 py-1.5">Item</th>
                                      <th className="text-right font-semibold text-slate-600 px-3 py-1.5">Qty</th>
                                      <th className="text-right font-semibold text-slate-600 px-3 py-1.5">Price</th>
                                      <th className="text-right font-semibold text-slate-600 px-3 py-1.5">Line Total</th>
                                      {b.order?.customerName && <th className="text-left font-semibold text-slate-600 px-3 py-1.5">Customer</th>}
                                      {b.order?.notes && <th className="text-left font-semibold text-slate-600 px-3 py-1.5">Notes</th>}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {/*
                                      BUG 4 FIX: The rowSpan cells
                                      (Customer / Notes) must only be
                                      rendered on the FIRST iteration
                                      of items.map(). Previously they
                                      were rendered on every iteration
                                      with rowSpan={items.length},
                                      causing the table to claim N×N
                                      rowSpans for an N-row table —
                                      browsers misrender this with
                                      extra columns and cells in wrong
                                      rows. We now guard with
                                      `idx === 0 &&` so each rowSpan
                                      cell is emitted exactly once.
                                    */}
                                    {items.map((it: any, idx: number) => (
                                      <tr key={it.id || idx}>
                                        <td className="px-3 py-1.5 text-slate-800 font-medium">{it.name}</td>
                                        <td className="px-3 py-1.5 text-right text-slate-600">{it.quantity}</td>
                                        <td className="px-3 py-1.5 text-right text-slate-600">{formatCurrency(it.price)}</td>
                                        <td className="px-3 py-1.5 text-right font-semibold text-slate-900">{formatCurrency(it.price * it.quantity)}</td>
                                        {idx === 0 && b.order?.customerName && <td className="px-3 py-1.5 text-slate-600" rowSpan={items.length}>{b.order.customerName}</td>}
                                        {idx === 0 && b.order?.notes && <td className="px-3 py-1.5 text-slate-500 italic" rowSpan={items.length}>{b.order.notes}</td>}
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                                    <tr>
                                      <td colSpan={3} className="px-3 py-2 text-right font-semibold text-slate-600">Bill Total</td>
                                      <td className="px-3 py-2 text-right font-bold text-orange-700">{formatCurrency(b.total)}</td>
                                      {(b.order?.customerName || b.order?.notes) && <td className="px-3 py-2"></td>}
                                      {b.order?.notes && <td className="px-3 py-2"></td>}
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
              {bills.length > 0 && (
                <tfoot className="bg-slate-900 text-white sticky bottom-0">
                  <tr>
                    <td colSpan={7} className="px-3 py-3 text-right font-semibold">
                      {/* BUG 3 FIX: Show "X bills" (total in filter) AND
                          "showing Y" (visible rows) separately so the
                          user can tell when the table is truncated. */}
                      Total ({bills.length} bills{bills.length > DISPLAY_LIMIT ? `, showing ${displayedBills.length}` : ''})
                    </td>
                    <td className="px-3 py-3 text-right font-bold">{formatCurrency(billTotals.subtotal)}</td>
                    <td className="px-3 py-3 text-right font-bold">{formatCurrency(billTotals.taxAmount)}</td>
                    <td className="px-3 py-3 text-right font-bold">{formatCurrency(billTotals.discount)}</td>
                    <td className="px-3 py-3 text-right font-bold text-orange-400">{formatCurrency(billTotals.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ─── Category-Wise Sales Report + Expense breakdown ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-0 shadow-md rounded-2xl overflow-hidden">
          <CardHeader className="pb-1 px-5 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-900">Category-Wise Sales</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="text-left font-semibold text-slate-600 px-3 py-2">Category</th>
                    <th className="text-right font-semibold text-slate-600 px-3 py-2">Qty Sold</th>
                    <th className="text-right font-semibold text-slate-600 px-3 py-2">Revenue</th>
                    <th className="text-right font-semibold text-slate-600 px-3 py-2">% </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data.byCategory || []).length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-6 text-slate-400">No category data</td></tr>
                  ) : (
                    (data.byCategory || []).map((c: any) => {
                      const totalRev = s.salesRevenue || 1
                      const pct = ((c.revenue / totalRev) * 100).toFixed(1)
                      return (
                        <tr key={c.name} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">{c.name}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">{c.qty}</td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">{formatCurrency(c.revenue)}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{pct}%</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
                {(data.byCategory || []).length > 0 && (
                  <tfoot className="bg-slate-100 border-t-2 border-slate-200">
                    <tr>
                      <td className="px-3 py-2 font-semibold text-slate-700">Total</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900">
                        {(data.byCategory || []).reduce((s: number, c: any) => s + (c.qty || 0), 0)}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-violet-700">
                        {formatCurrency((data.byCategory || []).reduce((s: number, c: any) => s + (c.revenue || 0), 0))}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md rounded-2xl">
          <CardHeader className="pb-1 px-5 pt-5">
            <CardTitle className="text-sm font-semibold text-slate-900">Expense Breakdown by Category</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-4">
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {Object.keys(data.expenseByCategory || {}).length > 0 ? (
                Object.entries(data.expenseByCategory).map(([cat, amt]: [string, any]) => (
                  <div key={cat} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-slate-50">
                    <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">{cat}</Badge>
                    <span className="text-xs font-bold text-slate-900">{formatCurrency(amt)}</span>
                  </div>
                ))
              ) : <div className="py-6 text-center text-xs text-slate-400">No expenses in this period</div>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
