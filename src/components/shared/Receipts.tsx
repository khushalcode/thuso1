'use client'

import { formatDateTime, formatTime, formatCurrency } from '@/lib/format'
import type { Order } from '@/lib/types'

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
  // Bill style
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
}

export function KOTReceipt({ order, kotNo, style }: { order: Order; kotNo: number; style?: ReceiptStyle }) {
  const items = (order.items || []).filter((i) => i.status !== 'cancelled')
  const accent = style?.kotAccentColor || '#000'
  const fontSize = style?.kotFontSize || 12
  const align = style?.kotHeaderAlign || 'center'

  return (
    <div className="p-3 font-mono text-black" style={{ fontSize: `${fontSize}px` }}>
      {style?.kotShowLogo !== false && (
        <div style={{ textAlign: align as any }}>
          <div className="bold lg" style={{ color: accent }}>** {style?.kotPrefix || 'KOT'} **</div>
          <div className="bold md">{style?.shopName || 'Thuso'}</div>
          <div className="xs">Kitchen Order Ticket</div>
        </div>
      )}
      <div className="double" style={{ borderTopColor: accent }} />
      <div className="row sm">
        <span>{style?.kotPrefix || 'KOT'} No:</span>
        <span className="bold">#{kotNo}</span>
      </div>
      {style?.kotShowTable !== false && (
        <div className="row sm">
          <span>Table:</span>
          <span className="bold">{order.table?.name || '-'}</span>
        </div>
      )}
      {style?.kotShowGuests !== false && (
        <div className="row sm">
          <span>Guests:</span>
          <span>{order.guests}</span>
        </div>
      )}
      <div className="row sm">
        <span>Type:</span>
        <span className="bold uppercase">{order.type}</span>
      </div>
      {style?.kotShowWaiter !== false && order.waiterName && (
        <div className="row sm">
          <span>Waiter:</span>
          <span>{order.waiterName}</span>
        </div>
      )}
      {style?.kotShowDateTime !== false && (
        <div className="row sm">
          <span>Time:</span>
          <span>{formatTime(order.createdAt)}</span>
        </div>
      )}
      <div className="divider" />
      <table>
        <thead>
          <tr style={{ borderBottom: `1px solid ${accent}` }}>
            <th>Item</th>
            <th className="right">Qty</th>
            <th className="right">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>
                {it.name}
                {it.notes && <div className="xs italic">  ↳ {it.notes}</div>}
              </td>
              <td className="right bold">{it.quantity}</td>
              <td className="right uppercase">{it.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="divider" />
      {order.notes && (
        <div className="sm">
          <span className="bold">Special Notes:</span>
          <br />
          {order.notes}
        </div>
      )}
      {style?.kotExtraNote && (
        <div className="sm italic" style={{ color: accent }}>
          {style.kotExtraNote}
        </div>
      )}
      <div className="divider" />
      <div className="center xs">
        Generated {formatDateTime(new Date())}
        <br />
        *** Hand to kitchen ***
      </div>
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
  const accent = style?.billAccentColor || '#000'
  const fontSize = style?.billFontSize || 11
  const align = style?.billHeaderAlign || 'center'

  // Titles / labels (Bill No:, Subtotal, TAX INVOICE, TOTAL, etc.) all render
  // the same way — bold + dark — like the TOTAL row used to look.
  // Values (the numbers/data next to each label) stay normal weight.
  const bold = style?.billBoldText !== false // default true
  const textColor = style?.billTextColor || '#0f172a'
  const baseStyle: React.CSSProperties = { fontSize: `${fontSize}px`, lineHeight: 1.5 }
  // fontSize is pinned explicitly (not just inherited) on every label/value
  // so nothing can render larger or smaller than the TOTAL row, regardless
  // of any font-size rules on the row/center/etc. classes in the print CSS.
  const labelStyle: React.CSSProperties = { fontWeight: bold ? 700 : 400, color: textColor, fontSize: `${fontSize}px` }
  const valueStyle: React.CSSProperties = { fontWeight: bold ? 700 : 400, color: textColor, fontSize: `${fontSize}px`}

  const name = style?.shopName || restaurantName || 'Thuso'
  const addr = style?.address || restaurantAddr
  const phone = style?.phone || restaurantPhone
  const email = style?.email
  const gstin = style?.gstin
  const footer = style?.footerNote || footerNote || 'Thank you for dining with us!'

  return (
    <div className="p-3 font-mono" style={baseStyle}>
      {style?.billShowLogo !== false && (
        <div style={{ textAlign: align as any }}>
          <div style={{ ...labelStyle, color: accent }}>{name}</div>
          {addr && <div style={valueStyle}>{addr}</div>}
          {phone && <div style={valueStyle}>Phone: {phone}</div>}
          {style?.billShowEmail && email && <div style={valueStyle}>{email}</div>}
          {style?.billShowGstin && gstin && <div style={valueStyle}>GSTIN: {gstin}</div>}
        </div>
      )}
      {style?.billShowAddress && addr && !style?.billShowLogo && (
        <div className="center" style={valueStyle}>{addr}</div>
      )}
      <div className="double" style={{ borderTopColor: accent }} />
      <div className="center" style={labelStyle}>TAX INVOICE</div>
      <div className="divider" />
      <div className="row">
        <span style={labelStyle}>Bill No:</span>
        <span style={valueStyle}>#{bill.billNo}</span>
      </div>
      <div className="row">
        <span style={labelStyle}>Table:</span>
        <span style={valueStyle}>{bill.tableNumber}</span>
      </div>
      {style?.billShowDateTime !== false && (
        <div className="row">
          <span style={labelStyle}>Date:</span>
          <span style={valueStyle}>{formatDateTime(bill.paidAt)}</span>
        </div>
      )}
      <div className="row">
        <span style={labelStyle}>Payment:</span>
        <span className="uppercase" style={valueStyle}>{bill.paymentMode}</span>
      </div>
      {style?.billShowWaiter && bill.order?.waiterName && (
        <div className="row">
          <span style={labelStyle}>Waiter:</span>
          <span style={valueStyle}>{bill.order.waiterName}</span>
        </div>
      )}
      {style?.billShowCustomer && bill.order?.customerName && (
        <div className="row">
          <span style={labelStyle}>Customer:</span>
          <span style={valueStyle}>{bill.order.customerName}</span>
        </div>
      )}
      {style?.billShowKotNo && (
        <div className="row">
          <span style={labelStyle}>KOT No:</span>
          <span style={valueStyle}>#{bill.order?.kotPrinted ? '1' : '-'}</span>
        </div>
      )}
      <div className="divider" />
      <table style={{ width: '100%' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${accent}` }}>
            <th style={{ textAlign: 'left', ...labelStyle }}>Item</th>
            <th className="right" style={labelStyle}>Qty</th>
            <th className="right" style={labelStyle}>Rate</th>
            <th className="right" style={labelStyle}>Amt</th>
          </tr>
        </thead>
        <tbody>
          {items
            .filter((i: any) => i.status !== 'cancelled')
            .map((it: any) => (
              <tr key={it.id}>
                <td style={valueStyle}>
                  {it.name}
                  {it.notes && <div className="italic">  ↳ {it.notes}</div>}
                </td>
                <td className="right" style={valueStyle}>{it.quantity}</td>
                <td className="right" style={valueStyle}>{it.price.toFixed(2)}</td>
                <td className="right" style={valueStyle}>{(it.price * it.quantity).toFixed(2)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="divider" />
      <div className="row">
        <span style={labelStyle}>Subtotal</span>
        <span style={valueStyle}>{formatCurrency(bill.subtotal)}</span>
      </div>
      {bill.taxRate > 0 && (
        <div className="row">
          <span style={labelStyle}>Tax ({bill.taxRate}%)</span>
          <span style={valueStyle}>{formatCurrency(bill.taxAmount)}</span>
        </div>
      )}
      {bill.serviceCharge > 0 && (
        <div className="row">
          <span style={labelStyle}>Service Charge</span>
          <span style={valueStyle}>{formatCurrency(bill.serviceCharge)}</span>
        </div>
      )}
      {bill.discount > 0 && (
        <div className="row">
          <span style={labelStyle}>Discount</span>
          <span style={valueStyle}>- {formatCurrency(bill.discount)}</span>
        </div>
      )}
      <div className="double" style={{ borderTopColor: accent }} />
      <div className="row">
        <span style={labelStyle}>TOTAL</span>
        <span style={{ ...valueStyle, color: accent, fontWeight: bold ? 700 : 400 }}>{formatCurrency(bill.total)}</span>
      </div>
      {style?.billExtraNote && <div className="divider" />}
      {style?.billExtraNote && <div className="italic" style={valueStyle}>{style.billExtraNote}</div>}
      <div className="center">
        <div style={valueStyle}>{footer}</div>
        <div className="mt-1" style={valueStyle}>Powered by Thuso</div>
      </div>
    </div>
  )
}