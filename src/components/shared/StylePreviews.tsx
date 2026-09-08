'use client'

/**
 * Live bill preview used in Settings page.
 * Renders a sample bill using the user's style preferences.
 *
 * All text is rendered DARK + BOLD by default (per user request:
 * "pura bill aur puri kot ka sagla words dark bold kr").
 * The accent color (default light blue #0EA5E9) is used only for divider
 * lines + the shop-name header; body text is pure black.
 */
export function BillReceiptPreview({ settings }: { settings: any }) {
  const accent = settings.billAccentColor || '#0EA5E9'
  const fontSize = settings.billFontSize || 11
  const align = settings.billHeaderAlign || 'center'
  const bold = settings.billBoldText !== false
  const textColor = settings.billTextColor || '#000000'
  const fw = bold ? 700 : 400
  const labelStyle: React.CSSProperties = { fontWeight: fw, color: textColor, fontSize: `${fontSize}px` }
  const valueStyle: React.CSSProperties = { fontWeight: fw, color: textColor, fontSize: `${fontSize}px` }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 font-mono" style={{ fontSize: `${fontSize}px`, color: textColor, fontWeight: fw }}>
      {settings.billShowLogo && (
        <div style={{ textAlign: align as any }} className="mb-1">
          <div className="font-bold" style={{ color: accent, fontSize: `${fontSize + 3}px` }}>
            {settings.shopName || 'Restaurant Name'}
          </div>
          <div style={{ ...valueStyle, fontSize: `${fontSize - 1}px` }}>Tax Invoice</div>
        </div>
      )}
      {settings.billShowAddress && settings.address && (
        <div style={{ textAlign: align as any, ...valueStyle }}>{settings.address}</div>
      )}
      {settings.billShowPhone && settings.phone && (
        <div style={{ textAlign: align as any, ...valueStyle }}>Phone: {settings.phone}</div>
      )}
      {settings.billShowEmail && settings.email && (
        <div style={{ textAlign: align as any, ...valueStyle }}>{settings.email}</div>
      )}
      {settings.billShowGstin && settings.gstin && (
        <div style={{ textAlign: align as any, ...valueStyle }}>GSTIN: {settings.gstin}</div>
      )}
      <div className="border-t-2 my-1.5" style={{ borderTopColor: accent }} />
      <div className="text-center" style={{ ...labelStyle, fontSize: `${fontSize + 1}px` }}>TAX INVOICE</div>
      <div className="border-t border-dashed border-slate-300 my-1.5" />
      <div className="space-y-0.5">
        <Row label="Bill No:" value={`#${settings.invoicePrefix || 'INV'}-1000`} labelStyle={labelStyle} valueStyle={valueStyle} />
        {settings.billShowDateTime && <Row label="Date:" value="05 Jul 2026, 12:30 PM" labelStyle={labelStyle} valueStyle={valueStyle} />}
        {settings.billShowCustomer && <Row label="Customer:" value="Walk-in" labelStyle={labelStyle} valueStyle={valueStyle} />}
        {settings.billShowWaiter && <Row label="Waiter:" value="Riya" labelStyle={labelStyle} valueStyle={valueStyle} />}
        {settings.billShowKotNo && <Row label="KOT No:" value="#1000" labelStyle={labelStyle} valueStyle={valueStyle} />}
      </div>
      <div className="border-t border-dashed border-slate-300 my-1.5" />
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: `2px solid ${accent}` }}>
            <th className="text-left py-0.5" style={labelStyle}>Item</th>
            <th className="text-right" style={labelStyle}>Qty</th>
            <th className="text-right" style={labelStyle}>Rate</th>
            <th className="text-right" style={labelStyle}>Amt</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style={valueStyle}>Butter Chicken</td><td className="text-right" style={valueStyle}>1</td><td className="text-right" style={valueStyle}>320</td><td className="text-right" style={valueStyle}>320</td></tr>
          <tr><td style={valueStyle}>Butter Naan</td><td className="text-right" style={valueStyle}>3</td><td className="text-right" style={valueStyle}>50</td><td className="text-right" style={valueStyle}>150</td></tr>
          <tr><td style={valueStyle}>Masala Chai</td><td className="text-right" style={valueStyle}>2</td><td className="text-right" style={valueStyle}>40</td><td className="text-right" style={valueStyle}>80</td></tr>
        </tbody>
      </table>
      <div className="border-t border-dashed border-slate-300 my-1.5" />
      <Row label="Subtotal" value="Rs. 550.00" labelStyle={labelStyle} valueStyle={valueStyle} />
      <Row label={`Tax (${settings.taxRate || 0}%)`} value="Rs. 0.00" labelStyle={labelStyle} valueStyle={valueStyle} />
      <div className="border-t-2 my-1" style={{ borderTopColor: accent }} />
      <div className="flex justify-between" style={{ fontSize: `${fontSize + 1}px`, fontWeight: fw }}>
        <span style={labelStyle}>TOTAL</span>
        <span style={{ ...valueStyle, color: accent }}>Rs. 550.00</span>
      </div>
      {settings.billExtraNote && (
        <div className="border-t border-dashed border-slate-300 my-1.5 pt-1 italic" style={valueStyle}>
          {settings.billExtraNote}
        </div>
      )}
      <div className="text-center mt-2" style={valueStyle}>
        {settings.footerNote || 'Thank you for dining with us!'}
      </div>
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
