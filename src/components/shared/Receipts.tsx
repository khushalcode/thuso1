'use client'

import { formatDateTime, formatTime, formatCurrency } from '@/lib/format'
import type { Order } from '@/lib/types'

// ─── Template block config ─────────────────────────────────────────────
//
// Each section of the bill / KOT can be individually styled by the admin
// via the WYSIWYG template editor in Settings. The admin can:
//   • enable / disable the block
//   • override the global font size for this block
//   • toggle bold / italic / underline
//   • override the text color
//   • override the alignment
//   • for text blocks (header, footer, extra_note): edit the text directly
//
// When a field is undefined, the global style (billFontSize / billBoldText /
// billTextColor / billHeaderAlign) is used as fallback. This keeps the
// config compact — only overrides need to be stored.
export interface TemplateBlock {
  key: string
  enabled?: boolean        // default true
  fontSize?: number        // undefined = use global
  bold?: boolean           // undefined = use global
  italic?: boolean         // default false
  underline?: boolean      // default false
  color?: string           // undefined = use global
  align?: string           // undefined = use global
  customText?: string      // for text blocks — overrides the default text
}

export interface ReceiptStyle {
  shopName?: string
  address?: string | null
  phone?: string | null
  email?: string | null
  gstin?: string | null
  taxRate?: number
  currency?: string
  invoicePrefix?: string
  kotPrefix?: string
  footerNote?: string
  // Bill style (global defaults — per-block overrides come from billTemplate)
  billShowLogo?: boolean
  billShowGstin?: boolean
  billShowPhone?: boolean
  billShowAddress?: boolean
  billShowEmail?: boolean
  billShowDateTime?: boolean
  billShowWaiter?: boolean
  billShowCustomer?: boolean
  billShowKotNo?: boolean
  billFontSize?: number
  billHeaderAlign?: string
  billExtraNote?: string | null
  billAccentColor?: string
  billBoldText?: boolean
  billTextColor?: string
  billPaperWidth?: number
  billTemplate?: TemplateBlock[] | string[] | null
  // KOT style
  kotShowLogo?: boolean
  kotShowWaiter?: boolean
  kotShowDateTime?: boolean
  kotShowTable?: boolean
  kotShowGuests?: boolean
  kotFontSize?: number
  kotHeaderAlign?: string
  kotAccentColor?: string
  kotExtraNote?: string | null
  kotPaperWidth?: number
  kotBoldText?: boolean
  kotTextColor?: string
  kotTemplate?: TemplateBlock[] | string[] | null
}

// Default field order for the bill template.
export const BILL_TEMPLATE_FIELDS = [
  'header', 'meta', 'items', 'subtotal', 'total', 'extra_note', 'footer',
] as const

export const KOT_TEMPLATE_FIELDS = [
  'header', 'meta', 'items', 'notes', 'extra_note', 'footer',
] as const

/**
 * Normalize a template config into TemplateBlock[].
 *
 * Handles three input shapes:
 *   1. null / undefined → default blocks (all enabled, no overrides)
 *   2. string[] (old format — just field keys) → convert to blocks with defaults
 *   3. TemplateBlock[] (new format) → use as-is, filling in any missing keys
 */
export function normalizeTemplate(
  tpl: TemplateBlock[] | string[] | null | undefined,
  defaults: readonly string[]
): TemplateBlock[] {
  if (!tpl || !Array.isArray(tpl) || tpl.length === 0) {
    return defaults.map((key) => ({ key, enabled: true }))
  }
  // Old format: array of strings
  if (typeof tpl[0] === 'string') {
    return (tpl as string[]).map((key) => ({ key, enabled: true }))
  }
  // New format: array of TemplateBlock — but make sure ALL default fields
  // are present (in case the admin deleted one and wants it back, the
  // editor will show a "add missing" option).
  const blocks = tpl as TemplateBlock[]
  const seen = new Set(blocks.map((b) => b.key))
  const complete = [...blocks]
  for (const key of defaults) {
    if (!seen.has(key)) {
      complete.push({ key, enabled: true })
    }
  }
  return complete
}

/** Resolve a block's effective style by merging global defaults + per-block overrides. */
function resolveStyle(
  block: TemplateBlock | undefined,
  globalFontSize: number,
  globalBold: boolean,
  globalColor: string,
  globalAlign: string
): {
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  color: string
  align: string
} {
  if (!block) {
    return {
      fontSize: globalFontSize,
      bold: globalBold,
      italic: false,
      underline: false,
      color: globalColor,
      align: globalAlign,
    }
  }
  return {
    fontSize: block.fontSize ?? globalFontSize,
    bold: block.bold ?? globalBold,
    italic: block.italic ?? false,
    underline: block.underline ?? false,
    color: block.color ?? globalColor,
    align: block.align ?? globalAlign,
  }
}

export function KOTReceipt({ order, kotNo, style }: { order: Order; kotNo: number; style?: ReceiptStyle }) {
  const items = (order.items || []).filter((i) => i.status !== 'cancelled')
  const accent = style?.kotAccentColor || '#22C55E'
  const gFontSize = style?.kotFontSize || 14
  // KOT bold + dark text — mirrors the bill's controls. Defaults to true
  // (bold on) + pure black so KOTs print with maximum contrast on thermal
  // paper, just like the bills.
  const gBold = style?.kotBoldText !== false
  const gColor = style?.kotTextColor || '#000000'
  const gAlign = style?.kotHeaderAlign || 'center'

  const blocks = normalizeTemplate(style?.kotTemplate, KOT_TEMPLATE_FIELDS)

  const renderSection = (block: TemplateBlock) => {
    if (block.enabled === false) return null
    const s = resolveStyle(block, gFontSize, gBold, gColor, gAlign)
    const textDecoration = [s.underline ? 'underline' : '', s.italic ? 'italic' : ''].filter(Boolean).join(' ') || undefined
    const fontStyle: React.CSSProperties = {
      fontSize: `${s.fontSize}px`,
      lineHeight: 1.4,
      color: s.color,
      fontWeight: s.bold ? 700 : 400,
      fontStyle: s.italic ? 'italic' : 'normal',
      textDecoration: textDecoration as any,
      textAlign: s.align as any,
    }

    switch (block.key) {
      case 'header':
        return style?.kotShowLogo !== false ? (
          <div key="header" style={{ textAlign: s.align as any }}>
            <div style={{ ...fontStyle, color: accent, fontSize: `${s.fontSize + 2}px`, fontWeight: 700 }}>
              ** {style?.kotPrefix || 'KOT'} **
            </div>
            <div style={{ ...fontStyle, fontSize: `${s.fontSize + 1}px` }}>{style?.shopName || 'Thuso'}</div>
            <div style={{ ...fontStyle, fontSize: `${s.fontSize - 2}px` }}>Kitchen Order Ticket</div>
          </div>
        ) : null
      case 'meta':
        return (
          <div key="meta">
            <div className="double" style={{ borderTopColor: accent }} />
            <div className="row sm" style={fontStyle}>
              <span>{style?.kotPrefix || 'KOT'} No:</span>
              <span>#{kotNo}</span>
            </div>
            {style?.kotShowTable !== false && (
              <div className="row sm" style={fontStyle}>
                <span>Table:</span>
                <span>{order.table?.name || '-'}</span>
              </div>
            )}
            {style?.kotShowGuests !== false && (
              <div className="row sm" style={fontStyle}>
                <span>Guests:</span>
                <span>{order.guests}</span>
              </div>
            )}
            <div className="row sm" style={fontStyle}>
              <span>Type:</span>
              <span className="uppercase">{order.type}</span>
            </div>
            {style?.kotShowWaiter !== false && order.waiterName && (
              <div className="row sm" style={fontStyle}>
                <span>Waiter:</span>
                <span>{order.waiterName}</span>
              </div>
            )}
            {style?.kotShowDateTime !== false && (
              <div className="row sm" style={fontStyle}>
                <span>Time:</span>
                <span>{formatTime(order.createdAt)}</span>
              </div>
            )}
          </div>
        )
      case 'items':
        return (
          <div key="items">
            <div className="divider" />
            <table>
              <thead>
                <tr style={{ borderBottom: `2px solid ${accent}` }}>
                  <th style={fontStyle}>Item</th>
                  <th className="right" style={fontStyle}>Qty</th>
                  <th className="right" style={fontStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td style={fontStyle}>
                      {it.name}
                      {it.notes && <div className="xs italic" style={fontStyle}>  ↳ {it.notes}</div>}
                    </td>
                    <td className="right" style={fontStyle}>{it.quantity}</td>
                    <td className="right uppercase" style={fontStyle}>{it.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      case 'notes':
        return order.notes ? (
          <div key="notes" className="sm">
            <div className="divider" />
            <span style={fontStyle}>Special Notes:</span>
            <br />
            <span style={fontStyle}>{order.notes}</span>
          </div>
        ) : null
      case 'extra_note':
        return (block.customText ?? style?.kotExtraNote) ? (
          <div key="extra_note" className="sm italic" style={{ ...fontStyle, color: accent }}>
            <div className="divider" />
            {block.customText ?? style?.kotExtraNote}
          </div>
        ) : null
      case 'footer':
        return (
          <div key="footer">
            <div className="divider" />
            <div className="center xs" style={fontStyle}>
              {block.customText || `Generated ${formatDateTime(new Date())}`}
              <br />
              *** Hand to kitchen ***
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="p-3 font-mono">
      {blocks.map(renderSection)}
    </div>
  )
}

export function BillReceipt({
  bill,
  restaurantName,
  restaurantAddr,
  restaurantPhone,
  footerNote,
  style,
}: {
  bill: any
  restaurantName?: string
  restaurantAddr?: string
  restaurantPhone?: string
  footerNote?: string
  style?: ReceiptStyle
}) {
  const items = bill.order?.items || []
  const accent = style?.billAccentColor || '#0EA5E9'
  const gFontSize = style?.billFontSize || 11
  const gBold = style?.billBoldText !== false
  const gColor = style?.billTextColor || '#000000'
  const gAlign = style?.billHeaderAlign || 'center'

  const blocks = normalizeTemplate(style?.billTemplate, BILL_TEMPLATE_FIELDS)

  const name = style?.shopName || restaurantName || 'Thuso'
  const addr = style?.address || restaurantAddr
  const phone = style?.phone || restaurantPhone
  const email = style?.email
  const gstin = style?.gstin

  const renderSection = (block: TemplateBlock) => {
    if (block.enabled === false) return null
    const s = resolveStyle(block, gFontSize, gBold, gColor, gAlign)
    const textDecoration = [s.underline ? 'underline' : ''].filter(Boolean).join(' ') || undefined
    const fontStyle: React.CSSProperties = {
      fontSize: `${s.fontSize}px`,
      lineHeight: 1.45,
      color: s.color,
      fontWeight: s.bold ? 700 : 400,
      fontStyle: s.italic ? 'italic' : 'normal',
      textDecoration: textDecoration as any,
      textAlign: s.align as any,
    }

    switch (block.key) {
      case 'header':
        return style?.billShowLogo !== false ? (
          <div key="header" style={{ textAlign: s.align as any }}>
            <div style={{ ...fontStyle, color: accent, fontSize: `${s.fontSize + 3}px`, fontWeight: 700 }}>
              {name}
            </div>
            {addr && <div style={fontStyle}>{addr}</div>}
            {phone && <div style={fontStyle}>Phone: {phone}</div>}
            {style?.billShowEmail && email && <div style={fontStyle}>{email}</div>}
            {style?.billShowGstin && gstin && <div style={fontStyle}>GSTIN: {gstin}</div>}
          </div>
        ) : null
      case 'meta':
        return (
          <div key="meta">
            <div className="double" style={{ borderTopColor: accent }} />
            <div className="center" style={{ ...fontStyle, fontSize: `${s.fontSize + 1}px` }}>TAX INVOICE</div>
            <div className="divider" />
            <div className="row" style={fontStyle}>
              <span>Bill No:</span>
              <span>#{bill.billNo}</span>
            </div>
            <div className="row" style={fontStyle}>
              <span>Table:</span>
              <span>{bill.tableNumber}</span>
            </div>
            {style?.billShowDateTime !== false && (
              <div className="row" style={fontStyle}>
                <span>Date:</span>
                <span>{formatDateTime(bill.paidAt)}</span>
              </div>
            )}
            <div className="row" style={fontStyle}>
              <span>Payment:</span>
              <span className="uppercase">{bill.paymentMode}</span>
            </div>
            {style?.billShowWaiter && bill.order?.waiterName && (
              <div className="row" style={fontStyle}>
                <span>Waiter:</span>
                <span>{bill.order.waiterName}</span>
              </div>
            )}
            {style?.billShowCustomer && bill.order?.customerName && (
              <div className="row" style={fontStyle}>
                <span>Customer:</span>
                <span>{bill.order.customerName}</span>
              </div>
            )}
            {style?.billShowKotNo && (
              <div className="row" style={fontStyle}>
                <span>KOT No:</span>
                <span>#{bill.billNo}</span>
              </div>
            )}
          </div>
        )
      case 'items':
        return (
          <div key="items">
            <div className="divider" />
            <table style={{ width: '100%' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${accent}` }}>
                  <th style={{ textAlign: 'left', ...fontStyle }}>Item</th>
                  <th className="right" style={fontStyle}>Qty</th>
                  <th className="right" style={fontStyle}>Rate</th>
                  <th className="right" style={fontStyle}>Amt</th>
                </tr>
              </thead>
              <tbody>
                {items
                  .filter((i: any) => i.status !== 'cancelled')
                  .map((it: any) => (
                    <tr key={it.id}>
                      <td style={fontStyle}>
                        {it.name}
                        {it.notes && <div className="italic" style={fontStyle}>  ↳ {it.notes}</div>}
                      </td>
                      <td className="right" style={fontStyle}>{it.quantity}</td>
                      <td className="right" style={fontStyle}>{it.price.toFixed(2)}</td>
                      <td className="right" style={fontStyle}>{(it.price * it.quantity).toFixed(2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )
      case 'subtotal':
        return (
          <div key="subtotal">
            <div className="divider" />
            <div className="row" style={fontStyle}>
              <span>Subtotal</span>
              <span>{formatCurrency(bill.subtotal)}</span>
            </div>
            {bill.taxRate > 0 && (
              <div className="row" style={fontStyle}>
                <span>Tax ({bill.taxRate}%)</span>
                <span>{formatCurrency(bill.taxAmount)}</span>
              </div>
            )}
            {bill.serviceCharge > 0 && (
              <div className="row" style={fontStyle}>
                <span>Service Charge</span>
                <span>{formatCurrency(bill.serviceCharge)}</span>
              </div>
            )}
            {bill.discount > 0 && (
              <div className="row" style={fontStyle}>
                <span>Discount</span>
                <span>- {formatCurrency(bill.discount)}</span>
              </div>
            )}
          </div>
        )
      case 'total':
        return (
          <div key="total">
            <div className="double" style={{ borderTopColor: accent }} />
            <div className="row" style={{ ...fontStyle, fontSize: `${s.fontSize + 1}px` }}>
              <span>TOTAL</span>
              <span style={{ color: accent }}>{formatCurrency(bill.total)}</span>
            </div>
          </div>
        )
      case 'extra_note':
        return (block.customText ?? style?.billExtraNote) ? (
          <div key="extra_note">
            <div className="divider" />
            <div style={fontStyle}>{block.customText ?? style?.billExtraNote}</div>
          </div>
        ) : null
      case 'footer':
        return (
          <div key="footer" className="center" style={{ textAlign: s.align as any }}>
            <div style={fontStyle}>{block.customText || style?.footerNote || footerNote || 'Thank you for dining with us!'}</div>
            <div className="mt-1" style={fontStyle}>Powered by Thuso</div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="p-3 font-mono">
      {blocks.map(renderSection)}
    </div>
  )
}
