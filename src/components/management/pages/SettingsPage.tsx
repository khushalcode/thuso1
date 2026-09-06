'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Store, Receipt, Save, Loader2, RotateCcw, Palette, Type, Eye, EyeOff,
  AlignLeft, AlignCenter, AlignRight, FileText, ChefHat, Bike, Link as LinkIcon,
  ShieldCheck, AlertCircle, Copy, Zap, Bold, Ruler, GripVertical,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { useShopFetch } from '@/hooks/use-shop-fetch'
import { useSession } from '@/lib/session'
import type { ShopSettings } from '@/lib/types'
import { BillReceiptPreview } from '@/components/shared/StylePreviews'
import { WysiwygTemplateEditor, BILL_BLOCK_META, KOT_BLOCK_META } from '@/components/shared/WysiwygTemplateEditor'
import type { TemplateBlock } from '@/components/shared/Receipts'

// ─── Thermal printer presets ───────────────────────────────────────────
// Kept for reference — these are no longer surfaced as a dedicated
// "Printer" tab (that tab was removed per user request), but the preset
// values are still applied when the user picks a paper width on the
// Bill / KOT tabs.
interface PrinterPreset {
  id: string
  name: string
  description: string
  values: {
    paperWidth: number
    printFontSize: number
    printMargin: number
    billCopies: number
    autoPrint: boolean
    silentPrint: boolean
  }
}

const PRINTER_PRESETS: PrinterPreset[] = [
  {
    id: 'retsol-8tuep',
    name: 'Retsol 8TUEP (80mm USB Thermal)',
    description: '80mm paper · 11px font · 4mm margin · 1 copy · auto-print on',
    values: {
      paperWidth: 80,
      printFontSize: 11,
      printMargin: 4,
      billCopies: 1,
      autoPrint: true,
      silentPrint: false,
    },
  },
  {
    id: 'epson-tm-t82',
    name: 'Epson TM-T82 (80mm USB Thermal)',
    description: '80mm paper · 12px font · 4mm margin · 1 copy · auto-print on',
    values: {
      paperWidth: 80,
      printFontSize: 12,
      printMargin: 4,
      billCopies: 1,
      autoPrint: true,
      silentPrint: false,
    },
  },
  {
    id: 'xprinter-58',
    name: 'Xprinter 58mm (Compact Thermal)',
    description: '58mm paper · 10px font · 3mm margin · 1 copy · auto-print on',
    values: {
      paperWidth: 58,
      printFontSize: 10,
      printMargin: 3,
      billCopies: 1,
      autoPrint: true,
      silentPrint: false,
    },
  },
]

const DEFAULT_BILL_FIELDS = ['header', 'meta', 'items', 'subtotal', 'total', 'extra_note', 'footer']
const DEFAULT_KOT_FIELDS = ['header', 'meta', 'items', 'notes', 'extra_note', 'footer']

/**
 * Normalize a template loaded from the DB into TemplateBlock[].
 *
 * The DB stores the template as a JSON string. After JSON.parse it can be:
 *   1. null / empty array → return default blocks
 *   2. array of strings (old format — just field keys) → convert to blocks
 *   3. array of TemplateBlock objects (new format) → use as-is
 *
 * We also make sure ALL default fields are present so the admin can always
 * re-add a block they previously deleted.
 */
function normalizeLoadedTemplate(tpl: any, defaults: string[]): TemplateBlock[] {
  if (!tpl || !Array.isArray(tpl) || tpl.length === 0) {
    return defaults.map((key) => ({ key, enabled: true }))
  }
  // Old format: array of strings
  if (typeof tpl[0] === 'string') {
    const seen = new Set(tpl as string[])
    const blocks = (tpl as string[]).map((key) => ({ key, enabled: true }))
    // Append any missing defaults so the editor shows them in "Add block"
    for (const key of defaults) {
      if (!seen.has(key)) blocks.push({ key, enabled: false })
    }
    return blocks
  }
  // New format: array of objects — make sure all defaults are represented
  const blocks = tpl as TemplateBlock[]
  const seen = new Set(blocks.map((b) => b.key))
  const complete = [...blocks]
  for (const key of defaults) {
    if (!seen.has(key)) complete.push({ key, enabled: false })
  }
  return complete
}

export default function SettingsPage() {
  const { currentShop } = useSession()
  const shopFetch = useShopFetch()
  const [settings, setSettings] = useState<ShopSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [f, setF] = useState({
    shopName: '',
    address: '',
    phone: '',
    email: '',
    gstin: '',
    taxRate: '0',
    serviceRate: '0',
    currency: 'Rs.',
    invoicePrefix: 'INV',
    kotPrefix: 'KOT',
    footerNote: 'Thank you for dining with us!',
    // Bill style — 3-color scheme: light blue accent + black bold text
    billShowLogo: true,
    billShowGstin: true,
    billShowPhone: true,
    billShowAddress: true,
    billShowEmail: false,
    billShowDateTime: true,
    billShowWaiter: true,
    billShowCustomer: true,
    billShowKotNo: true,
    billFontSize: 11,
    billHeaderAlign: 'center',
    billExtraNote: '',
    billAccentColor: '#0EA5E9',
    billBoldText: true,
    billTextColor: '#000000',
    billPaperWidth: 80,
    billTemplate: DEFAULT_BILL_FIELDS.map((k) => ({ key: k, enabled: true })) as TemplateBlock[],
    // KOT style — 3-color scheme: light green accent + black bold text
    // Font size is intentionally LARGER than bill (14 vs 11) for kitchen
    // readability on thermal paper.
    kotShowLogo: true,
    kotShowWaiter: true,
    kotShowDateTime: true,
    kotShowTable: true,
    kotShowGuests: true,
    kotFontSize: 14,
    kotHeaderAlign: 'center',
    kotAccentColor: '#22C55E',
    kotExtraNote: '',
    kotPaperWidth: 80,
    kotBoldText: true,
    kotTextColor: '#000000',
    kotTemplate: DEFAULT_KOT_FIELDS.map((k) => ({ key: k, enabled: true })) as TemplateBlock[],
    // Zomato API
    zomatoEnabled: false,
    zomatoApiKey: '',
    zomatoRestaurantId: '',
    zomatoApiBaseUrl: 'https://www.zomato.com/partners/v1',
    zomatoWebhookSecret: '',
    // Printer setup — kept in state (the legacy fields still drive the
    // PrintPreview width) but no longer surfaced as a dedicated tab.
    paperWidth: 80,
    printFontSize: 11,
    printMargin: 4,
    autoPrint: true,
    billCopies: 1,
    silentPrint: false,
    printHeaderText: '',
    printFooterText: '',
  })

  useEffect(() => {
    const load = async () => {
      const res = await shopFetch('/api/settings')
      const data = await res.json()
      setSettings(data.settings)
      setF({
        shopName: data.settings.shopName || '',
        address: data.settings.address || '',
        phone: data.settings.phone || '',
        email: data.settings.email || '',
        gstin: data.settings.gstin || '',
        taxRate: String(data.settings.taxRate ?? 0),
        serviceRate: String(data.settings.serviceRate ?? 0),
        currency: data.settings.currency || 'Rs.',
        invoicePrefix: data.settings.invoicePrefix || 'INV',
        kotPrefix: data.settings.kotPrefix || 'KOT',
        footerNote: data.settings.footerNote || 'Thank you for dining with us!',
        billShowLogo: data.settings.billShowLogo ?? true,
        billShowGstin: data.settings.billShowGstin ?? true,
        billShowPhone: data.settings.billShowPhone ?? true,
        billShowAddress: data.settings.billShowAddress ?? true,
        billShowEmail: data.settings.billShowEmail ?? false,
        billShowDateTime: data.settings.billShowDateTime ?? true,
        billShowWaiter: data.settings.billShowWaiter ?? true,
        billShowCustomer: data.settings.billShowCustomer ?? true,
        billShowKotNo: data.settings.billShowKotNo ?? true,
        billFontSize: data.settings.billFontSize ?? 11,
        billHeaderAlign: data.settings.billHeaderAlign || 'center',
        billExtraNote: data.settings.billExtraNote || '',
        billAccentColor: data.settings.billAccentColor || '#0EA5E9',
        billBoldText: data.settings.billBoldText ?? true,
        billTextColor: data.settings.billTextColor || '#000000',
        billPaperWidth: data.settings.billPaperWidth ?? 80,
        billTemplate: normalizeLoadedTemplate(data.settings.billTemplate, DEFAULT_BILL_FIELDS),
        kotShowLogo: data.settings.kotShowLogo ?? true,
        kotShowWaiter: data.settings.kotShowWaiter ?? true,
        kotShowDateTime: data.settings.kotShowDateTime ?? true,
        kotShowTable: data.settings.kotShowTable ?? true,
        kotShowGuests: data.settings.kotShowGuests ?? true,
        kotFontSize: data.settings.kotFontSize ?? 14,
        kotHeaderAlign: data.settings.kotHeaderAlign || 'center',
        kotAccentColor: data.settings.kotAccentColor || '#22C55E',
        kotExtraNote: data.settings.kotExtraNote || '',
        kotPaperWidth: data.settings.kotPaperWidth ?? 80,
        kotBoldText: data.settings.kotBoldText ?? true,
        kotTextColor: data.settings.kotTextColor || '#000000',
        kotTemplate: normalizeLoadedTemplate(data.settings.kotTemplate, DEFAULT_KOT_FIELDS),
        zomatoEnabled: data.settings.zomatoEnabled ?? false,
        zomatoApiKey: data.settings.zomatoApiKey || '',
        zomatoRestaurantId: data.settings.zomatoRestaurantId || '',
        zomatoApiBaseUrl: data.settings.zomatoApiBaseUrl || 'https://www.zomato.com/partners/v1',
        zomatoWebhookSecret: data.settings.zomatoWebhookSecret || '',
        paperWidth: data.settings.paperWidth ?? 80,
        printFontSize: data.settings.printFontSize ?? 11,
        printMargin: data.settings.printMargin ?? 4,
        autoPrint: data.settings.autoPrint ?? true,
        billCopies: data.settings.billCopies ?? 1,
        silentPrint: data.settings.silentPrint ?? false,
        printHeaderText: data.settings.printHeaderText || '',
        printFooterText: data.settings.printFooterText || '',
      })
      setLoading(false)
    }
    load()
  }, [shopFetch, currentShop?.id])

  const save = async () => {
    setSaving(true)
    try {
      // ─── Defensive: trim any unknown keys from the payload so the
      // server-side UPDATE never crashes on a column it doesn't know
      // about. The client-data.ts settings.update() also does this
      // check, but doing it here too means we get a cleaner error
      // message in the console if something is misaligned.
      const payload = { ...f }
      const res = await shopFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('[SettingsPage] save failed:', err)
        toast.error(err?.error || 'Failed to save settings — check console for details')
        return
      }
      const data = await res.json()
      setSettings(data.settings)
      toast.success('Settings saved successfully')
    } catch (e) {
      console.error('[SettingsPage] save threw:', e)
      toast.error('Failed to save settings — check console for details')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-40 bg-slate-200 rounded animate-pulse" />
        <div className="h-80 bg-slate-100 rounded-2xl animate-pulse" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight">Settings</h1>
          <p className="text-[10px] sm:text-sm text-slate-500">Configure restaurant profile, bill & KOT styles</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
          </Button>
          <Button onClick={save} disabled={saving} className="bg-gradient-to-r from-slate-700 to-slate-900 text-white">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
            Save Settings
          </Button>
        </div>
      </div>

      {/* Profile card */}
      <Card className="border-0 shadow-md rounded-2xl overflow-hidden">
        <CardContent className="p-5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-brand-gradient flex items-center justify-center text-white font-bold text-lg shadow-lg">
              {f.shopName ? f.shopName.charAt(0).toUpperCase() : 'S'}
            </div>
            <div>
              <p className="font-semibold text-slate-900 text-base">{f.shopName || 'Restaurant'}</p>
              <p className="text-xs text-slate-500">{f.phone || '+91 XXXXX XXXXX'} {f.gstin && `· GSTIN: ${f.gstin}`}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Tax (asked at bill time)</p>
            <p className="text-lg font-bold text-orange-600">{f.taxRate}%</p>
          </div>
        </CardContent>
      </Card>

      {/* Tabs: Shop / Bill Style / KOT Style / Zomato
          (Printer tab removed per user request — paper-width + font-size
          controls are now inline on the Bill / KOT tabs themselves.) */}
      <Tabs defaultValue="shop" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="shop" className="text-xs sm:text-sm">
            <Store className="w-3.5 h-3.5 mr-1.5" /> Shop
          </TabsTrigger>
          <TabsTrigger value="bill" className="text-xs sm:text-sm">
            <Receipt className="w-3.5 h-3.5 mr-1.5" /> Bill
          </TabsTrigger>
          <TabsTrigger value="kot" className="text-xs sm:text-sm">
            <ChefHat className="w-3.5 h-3.5 mr-1.5" /> KOT
          </TabsTrigger>
          <TabsTrigger value="zomato" className="text-xs sm:text-sm">
            <Bike className="w-3.5 h-3.5 mr-1.5" /> Zomato
          </TabsTrigger>
        </TabsList>

        {/* Shop details tab */}
        <TabsContent value="shop" className="mt-4">
          <Card className="border-0 shadow-md rounded-2xl">
            <CardHeader className="pb-3 px-5 pt-5">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-50">
                  <Store className="w-4 h-4 text-blue-600" />
                </div>
                <CardTitle className="text-sm font-semibold text-slate-900">Restaurant Details</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Restaurant Name</Label>
                  <Input value={f.shopName} onChange={(e) => setF({ ...f, shopName: e.target.value })} placeholder="Spice Garden" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Phone</Label>
                  <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 98765 43210" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="hello@restaurant.com" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">GSTIN</Label>
                  <Input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} placeholder="29ABCDE1234F1Z5" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Address</Label>
                <Textarea value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Full restaurant address" rows={2} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Default Tax % (optional)</Label>
                  <Input type="number" step="0.5" value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: e.target.value })} />
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Only used as a hint. Tax is asked at bill-print time.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Service Charge %</Label>
                  <Input type="number" step="0.5" value={f.serviceRate} onChange={(e) => setF({ ...f, serviceRate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Currency</Label>
                  <Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} placeholder="Rs." />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Invoice Prefix</Label>
                  <Input value={f.invoicePrefix} onChange={(e) => setF({ ...f, invoicePrefix: e.target.value })} placeholder="INV" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">KOT Prefix</Label>
                  <Input value={f.kotPrefix} onChange={(e) => setF({ ...f, kotPrefix: e.target.value })} placeholder="KOT" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Bill Footer Note</Label>
                  <Input value={f.footerNote} onChange={(e) => setF({ ...f, footerNote: e.target.value })} placeholder="Thank you!" />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Bill style tab */}
        <TabsContent value="bill" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Bill style controls */}
            <div className="space-y-4">
            <Card className="border-0 shadow-md rounded-2xl">
              <CardHeader className="pb-3 px-5 pt-5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-sky-50">
                    <Receipt className="w-4 h-4 text-sky-600" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-slate-900">Bill Style</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-4">
                {/* Show/hide toggles */}
                <div>
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Show / Hide Elements</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <ToggleRow label="Logo / Shop Name" checked={f.billShowLogo} onChange={(v) => setF({ ...f, billShowLogo: v })} />
                    <ToggleRow label="GSTIN" checked={f.billShowGstin} onChange={(v) => setF({ ...f, billShowGstin: v })} />
                    <ToggleRow label="Phone" checked={f.billShowPhone} onChange={(v) => setF({ ...f, billShowPhone: v })} />
                    <ToggleRow label="Address" checked={f.billShowAddress} onChange={(v) => setF({ ...f, billShowAddress: v })} />
                    <ToggleRow label="Email" checked={f.billShowEmail} onChange={(v) => setF({ ...f, billShowEmail: v })} />
                    <ToggleRow label="Date / Time" checked={f.billShowDateTime} onChange={(v) => setF({ ...f, billShowDateTime: v })} />
                    <ToggleRow label="Waiter Name" checked={f.billShowWaiter} onChange={(v) => setF({ ...f, billShowWaiter: v })} />
                    <ToggleRow label="Customer Name" checked={f.billShowCustomer} onChange={(v) => setF({ ...f, billShowCustomer: v })} />
                    <ToggleRow label="KOT Number" checked={f.billShowKotNo} onChange={(v) => setF({ ...f, billShowKotNo: v })} />
                  </div>
                </div>

                {/* Text style: bold + dark */}
                <div>
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Text Style</Label>
                  <div className="space-y-2">
                    <ToggleRow
                      label="Bold & Dark Text (all bill text)"
                      checked={f.billBoldText}
                      onChange={(v) => setF({ ...f, billBoldText: v })}
                    />
                    {f.billBoldText && (
                      <div className="space-y-1.5 pl-1">
                        <Label className="text-xs">Text Color</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={f.billTextColor}
                            onChange={(e) => setF({ ...f, billTextColor: e.target.value })}
                            className="w-12 h-9 rounded-lg border border-slate-200 cursor-pointer"
                          />
                          <Input value={f.billTextColor} onChange={(e) => setF({ ...f, billTextColor: e.target.value })} className="flex-1" />
                          <div className="flex gap-1">
                            {/* Dark + bold text colors — pure black is the default */}
                            {['#000000', '#0f172a', '#1e293b', '#18181b'].map((c) => (
                              <button
                                key={c}
                                onClick={() => setF({ ...f, billTextColor: c })}
                                className="w-6 h-6 rounded-full border-2 border-white shadow"
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-400">
                          Applies to all bill text, not just the accent color. Darker = better contrast on thermal prints.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Font size */}
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Type className="w-3 h-3" /> Font Size: {f.billFontSize}px</Label>
                  <input
                    type="range"
                    min={9}
                    max={14}
                    value={f.billFontSize}
                    onChange={(e) => setF({ ...f, billFontSize: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>

                {/* Header alignment */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Header Alignment</Label>
                  <div className="grid grid-cols-3 gap-1">
                    {(['left', 'center', 'right'] as const).map((a) => (
                      <button
                        key={a}
                        onClick={() => setF({ ...f, billHeaderAlign: a })}
                        className={`flex items-center justify-center py-2 rounded-lg border-2 text-xs font-medium ${
                          f.billHeaderAlign === a ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-600'
                        }`}
                      >
                        {a === 'left' ? <AlignLeft className="w-3.5 h-3.5" /> : a === 'center' ? <AlignCenter className="w-3.5 h-3.5" /> : <AlignRight className="w-3.5 h-3.5" />}
                        <span className="ml-1 capitalize">{a}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Accent color */}
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Palette className="w-3 h-3" /> Accent Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={f.billAccentColor}
                      onChange={(e) => setF({ ...f, billAccentColor: e.target.value })}
                      className="w-12 h-9 rounded-lg border border-slate-200 cursor-pointer"
                    />
                    <Input value={f.billAccentColor} onChange={(e) => setF({ ...f, billAccentColor: e.target.value })} className="flex-1" />
                    <div className="flex gap-1">
                      {/* 3-color scheme presets: light blue, light green, black */}
                      {['#0EA5E9', '#38BDF8', '#22C55E', '#4ADE80', '#000000'].map((c) => (
                        <button
                          key={c}
                          onClick={() => setF({ ...f, billAccentColor: c })}
                          className="w-6 h-6 rounded-full border-2 border-white shadow"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Extra note */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Extra Note (above footer)</Label>
                  <Textarea
                    value={f.billExtraNote}
                    onChange={(e) => setF({ ...f, billExtraNote: e.target.value })}
                    placeholder="e.g. Returns accepted within 7 days with bill"
                    rows={2}
                  />
                </div>

                {/* ─── Paper width (thermal printer sizing) ─── */}
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Ruler className="w-3 h-3" /> Paper Width (thermal printer)</Label>
                  <div className="grid grid-cols-4 gap-1">
                    {[58, 72, 80, 210].map((w) => (
                      <button
                        key={w}
                        onClick={() => setF({ ...f, billPaperWidth: w, paperWidth: w })}
                        className={`py-2 rounded-lg border-2 text-xs font-medium ${
                          f.billPaperWidth === w ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-600'
                        }`}
                      >
                        {w}mm
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400">
                    58/72/80mm = thermal roll · 210mm = A4. Bill + KOT can have different widths.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* ─── WYSIWYG template editor ───
                Full mouse + keyboard editor. Click a block to select it,
                use the toolbar (Bold, Italic, Underline, Font Size, Color,
                Alignment) to style it, drag blocks to reorder, and type
                custom text directly into text blocks (header, footer,
                extra note). */}
            <Card className="border-0 shadow-md rounded-2xl">
              <CardHeader className="pb-3 px-5 pt-5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-emerald-50">
                    <GripVertical className="w-4 h-4 text-emerald-600" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-slate-900">
                    Template Editor
                    <span className="ml-2 text-[10px] font-normal text-slate-500">click + style + drag</span>
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-2">
                <p className="text-xs text-slate-500 mb-2">
                  Click any block below to select it, then use the toolbar to change font size, bold, italic,
                  underline, color, and alignment. For text blocks (header, footer, extra note) you can type
                  custom text directly. Drag blocks by the grip handle to reorder. Changes apply on Save.
                </p>
                <WysiwygTemplateEditor
                  blocks={f.billTemplate}
                  blockMeta={BILL_BLOCK_META}
                  globalFontSize={f.billFontSize}
                  globalBold={f.billBoldText}
                  globalColor={f.billTextColor}
                  globalAlign={f.billHeaderAlign}
                  onChange={(blocks) => setF({ ...f, billTemplate: blocks })}
                  onReset={() => setF({ ...f, billTemplate: DEFAULT_BILL_FIELDS.map((k) => ({ key: k, enabled: true })) })}
                />
              </CardContent>
            </Card>
            </div>

            {/* Bill live preview + ruler */}
            <div className="space-y-4">
            <Card className="border-0 shadow-md rounded-2xl">
              <CardHeader className="pb-3 px-5 pt-5">
                <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Eye className="w-4 h-4" /> Live Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {/* ─── Ruler ───
                    A measurement guide showing mm marks so the admin can
                    see how the receipt will fit on their thermal paper.
                    Width auto-scales to the selected paper width. */}
                <PaperRuler mm={f.billPaperWidth} />
                <div className="mt-2 mx-auto" style={{ width: `${mmToPx(f.billPaperWidth)}px` }}>
                  <BillReceiptPreview settings={f} />
                </div>
              </CardContent>
            </Card>
            </div>
          </div>
        </TabsContent>

        {/* KOT style tab */}
        <TabsContent value="kot" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-4">
            <Card className="border-0 shadow-md rounded-2xl">
              <CardHeader className="pb-3 px-5 pt-5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-emerald-50">
                    <ChefHat className="w-4 h-4 text-emerald-600" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-slate-900">KOT Style</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-4">
                <div>
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Show / Hide Elements</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <ToggleRow label="Logo / Shop Name" checked={f.kotShowLogo} onChange={(v) => setF({ ...f, kotShowLogo: v })} />
                    <ToggleRow label="Waiter Name" checked={f.kotShowWaiter} onChange={(v) => setF({ ...f, kotShowWaiter: v })} />
                    <ToggleRow label="Date / Time" checked={f.kotShowDateTime} onChange={(v) => setF({ ...f, kotShowDateTime: v })} />
                    <ToggleRow label="Table Number" checked={f.kotShowTable} onChange={(v) => setF({ ...f, kotShowTable: v })} />
                    <ToggleRow label="Guests Count" checked={f.kotShowGuests} onChange={(v) => setF({ ...f, kotShowGuests: v })} />
                  </div>
                </div>

                {/* Text style: bold + dark (mirrors the bill tab's controls) */}
                <div>
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Text Style</Label>
                  <div className="space-y-2">
                    <ToggleRow
                      label="Bold & Dark Text (all KOT text)"
                      checked={f.kotBoldText}
                      onChange={(v) => setF({ ...f, kotBoldText: v })}
                    />
                    {f.kotBoldText && (
                      <div className="space-y-1.5 pl-1">
                        <Label className="text-xs">Text Color</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={f.kotTextColor}
                            onChange={(e) => setF({ ...f, kotTextColor: e.target.value })}
                            className="w-12 h-9 rounded-lg border border-slate-200 cursor-pointer"
                          />
                          <Input value={f.kotTextColor} onChange={(e) => setF({ ...f, kotTextColor: e.target.value })} className="flex-1" />
                          <div className="flex gap-1">
                            {/* Dark + bold text colors — pure black is the default */}
                            {['#000000', '#0f172a', '#1e293b', '#18181b'].map((c) => (
                              <button
                                key={c}
                                onClick={() => setF({ ...f, kotTextColor: c })}
                                className="w-6 h-6 rounded-full border-2 border-white shadow"
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-400">
                          Applies to all KOT text, not just the accent color. Darker = better contrast on thermal prints.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Type className="w-3 h-3" /> Font Size: {f.kotFontSize}px</Label>
                  <input
                    type="range"
                    min={10}
                    max={18}
                    value={f.kotFontSize}
                    onChange={(e) => setF({ ...f, kotFontSize: Number(e.target.value) })}
                    className="w-full"
                  />
                  <p className="text-[10px] text-slate-400">
                    KOT font is intentionally larger than the bill for kitchen readability.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Header Alignment</Label>
                  <div className="grid grid-cols-3 gap-1">
                    {(['left', 'center', 'right'] as const).map((a) => (
                      <button
                        key={a}
                        onClick={() => setF({ ...f, kotHeaderAlign: a })}
                        className={`flex items-center justify-center py-2 rounded-lg border-2 text-xs font-medium ${
                          f.kotHeaderAlign === a ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600'
                        }`}
                      >
                        {a === 'left' ? <AlignLeft className="w-3.5 h-3.5" /> : a === 'center' ? <AlignCenter className="w-3.5 h-3.5" /> : <AlignRight className="w-3.5 h-3.5" />}
                        <span className="ml-1 capitalize">{a}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Palette className="w-3 h-3" /> Accent Color (light green default)</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={f.kotAccentColor}
                      onChange={(e) => setF({ ...f, kotAccentColor: e.target.value })}
                      className="w-12 h-9 rounded-lg border border-slate-200 cursor-pointer"
                    />
                    <Input value={f.kotAccentColor} onChange={(e) => setF({ ...f, kotAccentColor: e.target.value })} className="flex-1" />
                    <div className="flex gap-1">
                      {['#22C55E', '#4ADE80', '#0EA5E9', '#38BDF8', '#000000'].map((c) => (
                        <button
                          key={c}
                          onClick={() => setF({ ...f, kotAccentColor: c })}
                          className="w-6 h-6 rounded-full border-2 border-white shadow"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Extra Note (for kitchen)</Label>
                  <Textarea
                    value={f.kotExtraNote}
                    onChange={(e) => setF({ ...f, kotExtraNote: e.target.value })}
                    placeholder="e.g. Allergies? Note here"
                    rows={2}
                  />
                </div>

                {/* ─── Paper width (thermal printer sizing) ─── */}
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Ruler className="w-3 h-3" /> Paper Width (thermal printer)</Label>
                  <div className="grid grid-cols-4 gap-1">
                    {[58, 72, 80, 210].map((w) => (
                      <button
                        key={w}
                        onClick={() => setF({ ...f, kotPaperWidth: w })}
                        className={`py-2 rounded-lg border-2 text-xs font-medium ${
                          f.kotPaperWidth === w ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600'
                        }`}
                      >
                        {w}mm
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400">
                    KOT rolls are usually the same width as bill rolls — but you can set a different width here if your kitchen printer is different.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* ─── KOT WYSIWYG template editor ─── */}
            <Card className="border-0 shadow-md rounded-2xl">
              <CardHeader className="pb-3 px-5 pt-5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-sky-50">
                    <GripVertical className="w-4 h-4 text-sky-600" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-slate-900">
                    KOT Template Editor
                    <span className="ml-2 text-[10px] font-normal text-slate-500">click + style + drag</span>
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-2">
                <p className="text-xs text-slate-500 mb-2">
                  Click any block to select it, then use the toolbar to style it (bold, italic, underline,
                  font size, color, alignment). Type custom text directly into text blocks. Drag to reorder.
                </p>
                <WysiwygTemplateEditor
                  blocks={f.kotTemplate}
                  blockMeta={KOT_BLOCK_META}
                  globalFontSize={f.kotFontSize}
                  globalBold={f.kotBoldText}
                  globalColor={f.kotTextColor}
                  globalAlign={f.kotHeaderAlign}
                  onChange={(blocks) => setF({ ...f, kotTemplate: blocks })}
                  onReset={() => setF({ ...f, kotTemplate: DEFAULT_KOT_FIELDS.map((k) => ({ key: k, enabled: true })) })}
                />
              </CardContent>
            </Card>
            </div>

            <Card className="border-0 shadow-md rounded-2xl">
              <CardHeader className="pb-3 px-5 pt-5">
                <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Eye className="w-4 h-4" /> Live Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <PaperRuler mm={f.kotPaperWidth} />
                <div className="mt-2 mx-auto" style={{ width: `${mmToPx(f.kotPaperWidth)}px` }}>
                  <KotReceiptPreview settings={f} />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Zomato API tab */}
        <TabsContent value="zomato" className="mt-4">
          <Card className="border-0 shadow-md rounded-2xl">
            <CardHeader className="pb-3 px-5 pt-5">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-rose-50">
                  <Bike className="w-4 h-4 text-rose-600" />
                </div>
                <CardTitle className="text-sm font-semibold text-slate-900">Zomato Partner API</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              {/* Enable toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Enable Real Zomato Integration</p>
                  <p className="text-xs text-slate-500">When enabled, Sync button calls the real Zomato API instead of simulation</p>
                </div>
                <Switch checked={f.zomatoEnabled} onCheckedChange={(v) => setF({ ...f, zomatoEnabled: v })} />
              </div>

              {f.zomatoEnabled && (
                <>
                  {/* Status badge */}
                  <div className={`flex items-center gap-2 p-3 rounded-lg text-xs ${
                    f.zomatoApiKey && f.zomatoRestaurantId
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}>
                    {f.zomatoApiKey && f.zomatoRestaurantId ? (
                      <><ShieldCheck className="w-4 h-4" /> Configured — real Zomato orders will be fetched on Sync</>
                    ) : (
                      <><AlertCircle className="w-4 h-4" /> API Key and Restaurant ID required to use real integration</>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Zomato API Key</Label>
                      <Input
                        value={f.zomatoApiKey}
                        onChange={(e) => setF({ ...f, zomatoApiKey: e.target.value })}
                        placeholder="Bearer token from Zomato Partner Dashboard"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Zomato Restaurant ID</Label>
                      <Input
                        value={f.zomatoRestaurantId}
                        onChange={(e) => setF({ ...f, zomatoRestaurantId: e.target.value })}
                        placeholder="Your restaurant ID on Zomato"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">API Base URL</Label>
                      <Input
                        value={f.zomatoApiBaseUrl}
                        onChange={(e) => setF({ ...f, zomatoApiBaseUrl: e.target.value })}
                        placeholder="https://www.zomato.com/partners/v1"
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Webhook Secret (optional)</Label>
                      <Input
                        value={f.zomatoWebhookSecret}
                        onChange={(e) => setF({ ...f, zomatoWebhookSecret: e.target.value })}
                        placeholder="Secret to verify incoming webhooks"
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>

                  {/* Webhook URL */}
                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1">
                      <LinkIcon className="w-3 h-3" /> Webhook URL (set this in Zomato Dashboard → Webhooks)
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        value={`${typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'}/api/zomato/webhook?shopId=${currentShop?.id || 'SHOP_ID'}${f.zomatoWebhookSecret ? `&secret=${f.zomatoWebhookSecret}` : ''}`}
                        className="font-mono text-[10px] bg-slate-50"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const url = `${window.location.origin}/api/zomato/webhook?shopId=${currentShop?.id || 'SHOP_ID'}${f.zomatoWebhookSecret ? `&secret=${f.zomatoWebhookSecret}` : ''}`
                          navigator.clipboard.writeText(url)
                          toast.success('Webhook URL copied')
                        }}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Instructions */}
                  <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 space-y-1">
                    <p className="font-bold">Setup Instructions:</p>
                    <p>1. Log in to <a href="https://partners.zomato.com" target="_blank" rel="noopener" className="underline">Zomato Partner Dashboard</a></p>
                    <p>2. Get your API Key from Settings → API</p>
                    <p>3. Find your Restaurant ID in Settings → Restaurant</p>
                    <p>4. Set the Webhook URL (above) in Settings → Webhooks</p>
                    <p>5. Save settings → click Sync in Zomato Orders to fetch real orders</p>
                  </div>
                </>
              )}

              {!f.zomatoEnabled && (
                <div className="p-3 rounded-lg bg-slate-50 text-xs text-slate-500">
                  Currently using <strong>simulation mode</strong> — sample orders are created on Sync.
                  Enable real integration to fetch actual Zomato orders.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

// KOT preview (inline to avoid circular imports)
function KotReceiptPreview({ settings }: { settings: any }) {
  const accent = settings.kotAccentColor || '#22C55E'
  const fontSize = settings.kotFontSize || 14
  const align = settings.kotHeaderAlign || 'center'
  const bold = settings.kotBoldText !== false
  const textColor = settings.kotTextColor || '#000000'
  const fw = bold ? 700 : 400
  const labelStyle: React.CSSProperties = { fontWeight: fw, color: textColor, fontSize: `${fontSize}px` }
  const valueStyle: React.CSSProperties = { fontWeight: fw, color: textColor, fontSize: `${fontSize}px` }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 font-mono" style={{ fontSize: `${fontSize}px`, color: textColor, fontWeight: fw }}>
      {settings.kotShowLogo && (
        <div style={{ textAlign: align as any }} className="mb-1">
          <div className="font-bold" style={{ color: accent, fontSize: `${fontSize + 2}px` }}>
            ** {settings.kotPrefix || 'KOT'} **
          </div>
          <div style={{ ...labelStyle, fontSize: `${fontSize + 1}px` }}>{settings.shopName || 'Restaurant Name'}</div>
          <div style={{ ...valueStyle, fontSize: `${fontSize - 2}px` }}>Kitchen Order Ticket</div>
        </div>
      )}
      <div className="border-t-2 border-dashed my-1.5" style={{ borderTopColor: accent }} />
      <div className="space-y-0.5">
        <Row label="KOT No:" value="#1000" labelStyle={labelStyle} valueStyle={valueStyle} />
        {settings.kotShowTable && <Row label="Table:" value="Table 5" labelStyle={labelStyle} valueStyle={valueStyle} />}
        {settings.kotShowGuests && <Row label="Guests:" value="4" labelStyle={labelStyle} valueStyle={valueStyle} />}
        {settings.kotShowWaiter && <Row label="Waiter:" value="Riya" labelStyle={labelStyle} valueStyle={valueStyle} />}
        {settings.kotShowDateTime && <Row label="Time:" value="12:30 PM" labelStyle={labelStyle} valueStyle={valueStyle} />}
      </div>
      <div className="border-t border-dashed border-slate-300 my-1.5" />
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: `2px solid ${accent}` }}>
            <th className="text-left py-0.5" style={labelStyle}>Item</th>
            <th className="text-right" style={labelStyle}>Qty</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={valueStyle}>Butter Chicken</td><td className="text-right" style={valueStyle}>1</td></tr>
          <tr><td style={valueStyle}>Butter Naan</td><td className="text-right" style={valueStyle}>3</td></tr>
          <tr><td style={valueStyle}>Masala Chai</td><td className="text-right" style={valueStyle}>2</td></tr>
        </tbody>
      </table>
      {settings.kotExtraNote && (
        <>
          <div className="border-t border-dashed border-slate-300 my-1.5" />
          <div className="italic" style={{ ...valueStyle, color: accent }}>{settings.kotExtraNote}</div>
        </>
      )}
    </div>
  )
}

function Row({ label, value, labelStyle, valueStyle }: { label: string; value: string; labelStyle?: React.CSSProperties; valueStyle?: React.CSSProperties }) {
  return (
    <div className="flex justify-between">
      <span style={labelStyle}>{label}</span>
      <span style={valueStyle}>{value}</span>
    </div>
  )
}

// ─── mm → px conversion for the live preview ruler ───
// 80mm thermal paper ≈ 302px at 96dpi (the standard CSS pixel density).
// We use this to size the preview container so the admin sees an
// approximately-true-to-life rendering of how the receipt will fit on
// the selected paper width.
function mmToPx(mm: number): number {
  // 1mm = 3.7795px at 96dpi. We cap the max so 210mm (A4) doesn't
  // overflow the sidebar layout — anything wider than 100mm gets
  // scaled down to fit a 380px column.
  const raw = Math.round(mm * 3.7795)
  return Math.min(raw, 380)
}

/**
 * PaperRuler — a horizontal measurement guide showing mm marks.
 *
 * Rendered above each live preview so the admin can see at a glance
 * whether their content fits within the thermal paper width. Major
 * ticks every 10mm, minor ticks every 5mm.
 */
function PaperRuler({ mm }: { mm: number }) {
  const widthPx = mmToPx(mm)
  // Build tick marks: major every 10mm, minor every 5mm in between.
  const ticks: { left: number; major: boolean; label?: string }[] = []
  for (let i = 0; i <= mm; i += 5) {
    const left = (i / mm) * widthPx
    const major = i % 10 === 0
    ticks.push({ left, major, label: major ? String(i) : undefined })
  }
  return (
    <div className="mb-2 mx-auto select-none" style={{ width: `${widthPx}px` }}>
      <div className="relative h-5 border-b border-slate-300 bg-slate-50 rounded-t">
        {ticks.map((t, idx) => (
          <div
            key={idx}
            className={`absolute bottom-0 ${t.major ? 'h-3 bg-slate-500' : 'h-2 bg-slate-300'}`}
            style={{ left: `${t.left}px`, width: '1px' }}
          >
            {t.label && (
              <span className="absolute -top-3.5 left-1 text-[8px] font-mono text-slate-500">
                {t.label}
              </span>
            )}
          </div>
        ))}
        {/* Right-edge label */}
        <span className="absolute -bottom-4 right-0 text-[9px] font-mono text-slate-500">
          {mm}mm
        </span>
      </div>
    </div>
  )
}
