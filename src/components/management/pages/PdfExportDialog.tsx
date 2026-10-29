'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  Calendar, Store, ShoppingBag, CreditCard, CheckCircle2, FileDown,
  Loader2, AlertCircle, Filter as FilterIcon,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useShopFetch } from '@/hooks/use-shop-fetch'
import { useSession, type Shop } from '@/lib/session'
import { downloadPdf, downloadExcel, downloadCsv, type Sheet } from '@/lib/excel-export'
import { formatCurrency } from '@/lib/format'

// ─── Types ────────────────────────────────────────────────────────────
export type ReportFormat = 'pdf' | 'excel' | 'csv'
export type ReportType = 'summary' | 'detailed' | 'itemized' | 'category' | 'payment' | 'daily'
export type OrderTypeFilter = 'all' | 'dine_in' | 'takeaway' | 'delivery' | 'pickup'
export type PaymentModeFilter = 'all' | 'cash' | 'upi' | 'card' | 'other'
export type PaymentStatusFilter = 'all' | 'paid' | 'pending' | 'partial'
export type PeriodFilter = 'today' | 'yesterday' | '7d' | '30d' | 'monthly' | 'range'

export interface PdfExportOptions {
  period: PeriodFilter
  from: string
  to: string
  outlet: string                  // shopId, 'all' = current shop only
  orderType: OrderTypeFilter
  paymentMode: PaymentModeFilter
  paymentStatus: PaymentStatusFilter
  reportType: ReportType
  format: ReportFormat
}

interface PdfExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Default options when the dialog opens (pre-filled from the live filter bar). */
  defaults: Partial<PdfExportOptions>
  /** Called after a download is triggered (so the parent can toast/log). */
  onDownloaded?: (filename: string, format: ReportFormat) => void
}

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'monthly', label: 'This Month' },
  { value: 'range', label: 'Custom Range' },
]

const ORDER_TYPE_OPTIONS: { value: OrderTypeFilter; label: string }[] = [
  { value: 'all', label: 'All Order Types' },
  { value: 'dine_in', label: 'Dine-in' },
  { value: 'takeaway', label: 'Takeaway' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'pickup', label: 'Pickup' },
]

const PAYMENT_MODE_OPTIONS: { value: PaymentModeFilter; label: string }[] = [
  { value: 'all', label: 'All Payments' },
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
]

const PAYMENT_STATUS_OPTIONS: { value: PaymentStatusFilter; label: string }[] = [
  { value: 'all', label: 'All Status' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'partial', label: 'Partially Paid' },
]

const REPORT_TYPE_OPTIONS: { value: ReportType; label: string; description: string }[] = [
  { value: 'summary', label: 'Summary', description: 'Top-line numbers + payment/category breakdown' },
  { value: 'detailed', label: 'Detailed (Bill-wise)', description: 'Every bill with items, totals, payment mode' },
  { value: 'itemized', label: 'Itemized Sales', description: 'One row per line item across all bills' },
  { value: 'category', label: 'Category-wise', description: 'Revenue grouped by menu category' },
  { value: 'payment', label: 'Payment-wise', description: 'Totals grouped by payment mode' },
  { value: 'daily', label: 'Day-wise', description: 'Daily sales vs expenses for the period' },
]

const FORMAT_OPTIONS: { value: ReportFormat; label: string; mime: string; ext: string }[] = [
  { value: 'pdf', label: 'PDF', mime: 'text/html', ext: 'html' },
  { value: 'excel', label: 'Excel', mime: 'application/vnd.ms-excel', ext: 'xls' },
  { value: 'csv', label: 'CSV', mime: 'text/csv', ext: 'csv' },
]

// ─── Component ────────────────────────────────────────────────────────
export function PdfExportDialog({ open, onOpenChange, defaults, onDownloaded }: PdfExportDialogProps) {
  const shopFetch = useShopFetch()
  const { shops, currentShop } = useSession()

  // ─── Local state (initialised from defaults when dialog opens) ───
  const [period, setPeriod] = useState<PeriodFilter>(defaults.period || 'today')
  const [from, setFrom] = useState(defaults.from || '')
  const [to, setTo] = useState(defaults.to || '')
  const [outlet, setOutlet] = useState<string>(defaults.outlet || currentShop?.id || 'all')
  const [orderType, setOrderType] = useState<OrderTypeFilter>(defaults.orderType || 'all')
  const [paymentMode, setPaymentMode] = useState<PaymentModeFilter>(defaults.paymentMode || 'all')
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatusFilter>(defaults.paymentStatus || 'all')
  const [reportType, setReportType] = useState<ReportType>(defaults.reportType || 'summary')
  const [format, setFormat] = useState<ReportFormat>(defaults.format || 'pdf')

  // Re-sync state when the dialog opens with fresh defaults from the live filter bar
  useEffect(() => {
    if (open) {
      if (defaults.period) setPeriod(defaults.period)
      if (defaults.from !== undefined) setFrom(defaults.from)
      if (defaults.to !== undefined) setTo(defaults.to)
      if (defaults.outlet) setOutlet(defaults.outlet)
      if (defaults.orderType) setOrderType(defaults.orderType)
      if (defaults.paymentMode) setPaymentMode(defaults.paymentMode)
      if (defaults.paymentStatus) setPaymentStatus(defaults.paymentStatus)
      if (defaults.reportType) setReportType(defaults.reportType)
      if (defaults.format) setFormat(defaults.format)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const [preview, setPreview] = useState<any>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ─── Compute date range from selected period ───
  const { fromIso, toIso, periodLabel } = useMemo(() => {
    const now = new Date()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    switch (period) {
      case 'today':
        return { fromIso: today.toISOString(), toIso: end.toISOString(), periodLabel: 'Today' }
      case 'yesterday': {
        const yStart = new Date(today)
        yStart.setDate(yStart.getDate() - 1)
        const yEnd = new Date(yStart)
        yEnd.setHours(23, 59, 59, 999)
        return { fromIso: yStart.toISOString(), toIso: yEnd.toISOString(), periodLabel: 'Yesterday' }
      }
      case '7d': {
        const d = new Date(today)
        d.setDate(d.getDate() - 6)
        return { fromIso: d.toISOString(), toIso: end.toISOString(), periodLabel: 'Last 7 days' }
      }
      case '30d': {
        const d = new Date(today)
        d.setDate(d.getDate() - 29)
        return { fromIso: d.toISOString(), toIso: end.toISOString(), periodLabel: 'Last 30 days' }
      }
      case 'monthly': {
        const d = new Date(today)
        d.setDate(1)
        return { fromIso: d.toISOString(), toIso: end.toISOString(), periodLabel: 'This Month' }
      }
      case 'range': {
        const f = from ? new Date(from) : new Date(0)
        f.setHours(0, 0, 0, 0)
        const t = to ? new Date(to) : new Date()
        t.setHours(23, 59, 59, 999)
        return {
          fromIso: f.toISOString(),
          toIso: t.toISOString(),
          periodLabel: `${f.toLocaleDateString()} → ${t.toLocaleDateString()}`,
        }
      }
    }
  }, [period, from, to])

  // ─── Build the query string for the preview ───
  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    p.set('from', fromIso)
    p.set('to', toIso)
    if (paymentMode !== 'all') p.set('paymentMode', paymentMode)
    if (orderType !== 'all') p.set('orderType', orderType)
    if (paymentStatus !== 'all') p.set('paymentStatus', paymentStatus)
    if (outlet !== 'all') p.set('outlet', outlet)
    return p.toString()
  }, [fromIso, toIso, paymentMode, orderType, paymentStatus, outlet])

  // ─── Fetch preview whenever the dialog is open and filters change ───
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingPreview(true)
    setError(null)
    const t = setTimeout(async () => {
      try {
        const res = await shopFetch(`/api/reports?${queryString}`)
        if (!res.ok) {
          let msg = `Reports request failed (HTTP ${res.status})`
          try {
            const body = await res.json()
            if (body?.error) msg = String(body.error)
          } catch { /* non-JSON */ }
          throw new Error(msg)
        }
        const d = await res.json()
        if (!cancelled) setPreview(d)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e) || 'Failed to load preview')
      } finally {
        if (!cancelled) setLoadingPreview(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [open, queryString, shopFetch])

  // ─── Build the sheets for the chosen report type ───
  const sheets = useMemo<Sheet[]>(() => {
    if (!preview) return []
    const s = preview.summary || {}
    const bills: any[] = preview.bills || []
    const itemizedRows: any[] = preview.itemizedRows || []
    const fmtCurrency = formatCurrency
    const out: Sheet[] = []

    // The Summary sheet is always included (even on detailed reports it
    // gives the recipient the top-line numbers up front).
    if (reportType === 'summary' || reportType === 'detailed' || reportType === 'itemized') {
      out.push({
        name: 'Summary',
        columns: ['Metric', 'Value'],
        rows: [
          ['Period', periodLabel],
          ['Outlet', outlet === 'all' ? (currentShop?.name || 'Current Shop') : (shops.find((x: Shop) => x.id === outlet)?.name || 'Unknown')],
          ['Order Type', orderType === 'all' ? 'All' : orderType.replace('_', ' ')],
          ['Payment Mode', paymentMode === 'all' ? 'All' : paymentMode],
          ['Payment Status', paymentStatus === 'all' ? 'All' : paymentStatus],
          ['Sales Revenue', fmtCurrency(s.salesRevenue || 0)],
          ['Bill Count', s.billCount || 0],
          ['Items Sold', s.totalItemsSold || 0],
          ['Avg Bill', fmtCurrency(s.avgBill || 0)],
          ['Total Expenses', fmtCurrency(s.totalExpenses || 0)],
          ['Total Purchases', fmtCurrency(s.totalPurchases || 0)],
          ['Money In', fmtCurrency(s.totalMoneyIn || 0)],
          ['Money Out', fmtCurrency(s.totalMoneyOut || 0)],
          ['Net Profit', fmtCurrency(s.netProfit || 0)],
          ['Cash Flow', fmtCurrency(s.cashFlow || 0)],
          ['Generated At', new Date().toISOString().replace('T', ' ').slice(0, 19)],
        ],
      })
    }

    if (reportType === 'detailed') {
      out.push({
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
          fmtCurrency(Number(b.subtotal) || 0),
          fmtCurrency(Number(b.taxAmount) || 0),
          fmtCurrency(Number(b.discount) || 0),
          fmtCurrency(Number(b.serviceCharge) || 0),
          fmtCurrency(Number(b.total) || 0),
        ]),
      })
    }

    if (reportType === 'itemized') {
      out.push({
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
          fmtCurrency(r.price),
          fmtCurrency(r.lineTotal),
          fmtCurrency(r.billTotal),
          (r.paymentMode || '').toUpperCase(),
        ]),
      })
    }

    if (reportType === 'category' || reportType === 'summary') {
      if ((preview.byCategory || []).length > 0) {
        out.push({
          name: 'By Category',
          columns: ['Category', 'Qty Sold', 'Revenue'],
          rows: (preview.byCategory || []).map((c: any) => [c.name, Number(c.qty) || 0, fmtCurrency(Number(c.revenue) || 0)]),
        })
      }
    }

    if (reportType === 'payment' || reportType === 'summary') {
      const paymentEntries = Object.entries(preview.byPayment || {})
      if (paymentEntries.length > 0) {
        out.push({
          name: 'Payment Modes',
          columns: ['Mode', 'Total', 'Count'],
          rows: paymentEntries.map(([mode, v]: [string, any]) => [
            mode.toUpperCase(), fmtCurrency(Number(v.total || 0) || 0), Number(v.count || 0) || 0,
          ]),
        })
      }
    }

    if (reportType === 'daily' || reportType === 'summary') {
      if ((preview.dailyBreakdown || []).length > 0) {
        out.push({
          name: 'Daily Breakdown',
          columns: ['Date', 'Sales', 'Expenses', 'Bill Count'],
          rows: (preview.dailyBreakdown || []).map((d: any) => [
            d.date, fmtCurrency(Number(d.sales || 0) || 0), fmtCurrency(Number(d.expenses || 0) || 0), Number(d.count || 0) || 0,
          ]),
        })
      }
    }

    return out
  }, [preview, reportType, periodLabel, outlet, orderType, paymentMode, paymentStatus, shops, currentShop])

  // ─── Trigger the actual download ───
  const handleDownload = async () => {
    if (sheets.length === 0) return
    setDownloading(true)
    try {
      const dateStr = new Date().toISOString().split('T')[0]
      const baseName = `sales-report-${reportType}-${period}-${dateStr}`
      if (format === 'pdf') {
        downloadPdf(sheets, baseName)
      } else if (format === 'excel') {
        downloadExcel(sheets, baseName)
      } else {
        // CSV — export the FIRST sheet (most relevant one based on reportType)
        const primarySheet = sheets[0] || { name: 'Report', columns: [], rows: [] }
        downloadCsv(primarySheet, baseName)
      }
      onDownloaded?.(`${baseName}.${FORMAT_OPTIONS.find((f) => f.value === format)?.ext}`, format)
      onOpenChange(false)
    } catch (err: any) {
      console.error('[PdfExportDialog] download failed:', err)
      setError(err?.message || 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  // ─── Active filter count for the header badge ───
  const activeFilterCount =
    (orderType !== 'all' ? 1 : 0) +
    (paymentMode !== 'all' ? 1 : 0) +
    (paymentStatus !== 'all' ? 1 : 0) +
    (outlet !== 'all' ? 1 : 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FileDown className="w-5 h-5 text-rose-500" />
            Export Report
            {activeFilterCount > 0 && (
              <Badge className="text-[10px] bg-rose-100 text-rose-700 border-rose-200 ml-1">
                {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Choose the report type, date range and filters before downloading. The preview updates live as you change filters.
          </DialogDescription>
        </DialogHeader>

        {/* ─── Filter grid ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          {/* Period */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><Calendar className="w-3 h-3" /> Period</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Outlet */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><Store className="w-3 h-3" /> Outlet / Branch</Label>
            <Select value={outlet} onValueChange={setOutlet}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Current Shop Only ({currentShop?.name})</SelectItem>
                {shops.map((s: Shop) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Order Type */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><ShoppingBag className="w-3 h-3" /> Order Type</Label>
            <Select value={orderType} onValueChange={(v) => setOrderType(v as OrderTypeFilter)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORDER_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Payment Mode */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><CreditCard className="w-3 h-3" /> Payment Mode</Label>
            <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as PaymentModeFilter)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_MODE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Payment Status */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Payment Status</Label>
            <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as PaymentStatusFilter)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Custom range (only when period === 'range') */}
          {period === 'range' && (
            <div className="sm:col-span-2 grid grid-cols-2 gap-3">
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
        </div>

        {/* ─── Report type ─────────────────────────────────────────── */}
        <div className="py-2 border-t border-slate-200">
          <Label className="text-xs font-bold uppercase tracking-wide text-slate-700 flex items-center gap-1 mb-2">
            <FilterIcon className="w-3 h-3" /> Report Type
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {REPORT_TYPE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setReportType(o.value)}
                className={`text-left p-2.5 rounded-lg border transition-all ${
                  reportType === o.value
                    ? 'border-rose-400 bg-rose-50 ring-2 ring-rose-200'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="text-xs font-semibold text-slate-900">{o.label}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{o.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ─── Format ───────────────────────────────────────────────── */}
        <div className="py-2 border-t border-slate-200">
          <Label className="text-xs font-bold uppercase tracking-wide text-slate-700 mb-2 block">Format</Label>
          <div className="grid grid-cols-3 gap-2">
            {FORMAT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setFormat(o.value)}
                className={`p-2 rounded-lg border text-center transition-all ${
                  format === o.value
                    ? 'border-rose-400 bg-rose-50 ring-2 ring-rose-200'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="text-xs font-bold text-slate-900">{o.label}</div>
                <div className="text-[9px] text-slate-500 mt-0.5">.{o.ext}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ─── Preview summary ─────────────────────────────────────── */}
        <div className="py-2 border-t border-slate-200">
          <Label className="text-xs font-bold uppercase tracking-wide text-slate-700 mb-2 block">
            Live Preview
          </Label>
          {loadingPreview && (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading preview…
            </div>
          )}
          {error && !loadingPreview && (
            <div className="flex items-center gap-2 text-xs text-rose-600 py-3 bg-rose-50 px-3 rounded-lg">
              <AlertCircle className="w-3 h-3 shrink-0" />
              {error}
            </div>
          )}
          {preview && !loadingPreview && !error && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <PreviewStat label="Bills" value={String(preview.summary?.billCount || 0)} />
              <PreviewStat label="Revenue" value={formatCurrency(preview.summary?.salesRevenue || 0)} />
              <PreviewStat label="Items Sold" value={String(preview.summary?.totalItemsSold || 0)} />
              <PreviewStat label="Net Profit" value={formatCurrency(preview.summary?.netProfit || 0)} />
            </div>
          )}
        </div>

        {/* ─── Footer ─────────────────────────────────────────────── */}
        <DialogFooter className="gap-2 border-t border-slate-200 pt-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={downloading}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleDownload}
            disabled={downloading || loadingPreview || !!error || sheets.length === 0}
            className="bg-rose-500 hover:bg-rose-600 text-white"
          >
            {downloading ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Generating…</>
            ) : (
              <><FileDown className="w-3.5 h-3.5 mr-1" /> Download {format.toUpperCase()}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Small preview stat component ─────────────────────────────────────
function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
      <div className="text-sm font-bold text-slate-900 truncate">{value}</div>
    </div>
  )
}

// ─── Helper to open the dialog from anywhere in ReportsPage ──────────
export function buildDefaultsFromCurrentFilters(opts: {
  period: string
  from: string
  to: string
  paymentMode: string
  currentShopId: string
}): Partial<PdfExportOptions> {
  return {
    period: (opts.period as PeriodFilter) || 'today',
    from: opts.from || '',
    to: opts.to || '',
    outlet: opts.currentShopId || 'all',
    paymentMode: (opts.paymentMode as PaymentModeFilter) || 'all',
    orderType: 'all',
    paymentStatus: 'all',
    reportType: 'summary',
    format: 'pdf',
  }
}
