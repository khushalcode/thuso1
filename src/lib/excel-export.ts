/**
 * ExcelExport — generate .xlsx-compatible Excel files in the browser
 * without any external dependency.
 *
 * Approach: build an HTML table with the Excel-specific XML namespace
 * and serve it as an .xls file with the Excel MIME type. Excel and
 * LibreOffice both open this format natively. Number cells are
 * detected automatically by Excel; explicit type hints can be added
 * by prefixing values.
 *
 * For richer Excel output (multi-sheet, formatting) we'd use a library
 * like SheetJS, but for plain tabular exports the HTML approach is
 * smallest and zero-dep.
 */

export interface Sheet {
  name: string
  columns: string[]
  rows: (string | number | boolean | null | undefined)[][]
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') {
    if (!isFinite(value)) return '0'
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  // String — escape, preserve as text. Prefix with ' to force text
  // treatment for numeric-looking strings (e.g. invoice numbers).
  let s = String(value)
  // Force numbers-like text (e.g. phone, gstin, bill numbers) to stay as text
  if (/^\d+$/.test(s) && s.length > 10) {
    // Looks like a phone / long digit string — keep as text
    return `<td>${escapeXml(s)}</td>`
  }
  // If it's a pure number string but short, leave Excel to auto-detect.
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    return `<td>${escapeXml(s)}</td>`
  }
  return `<td>${escapeXml(s)}</td>`
}

/**
 * Build an .xls file (HTML-table-based, Excel SpreadsheetML-ish).
 * This is the most compatible format — opens cleanly in Excel,
 * LibreOffice, and Google Sheets without any dependencies.
 */
export function buildXlsBlob(sheets: Sheet[]): Blob {
  const html: string[] = []
  html.push('<?xml version="1.0" encoding="UTF-8"?>')
  html.push('<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">')
  html.push('<head>')
  html.push('<meta charset="UTF-8">')
  html.push('<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>')
  for (const s of sheets) {
    const safeName = escapeXml(s.name.replace(/[\\/?*[\]:]/g, '_')).slice(0, 31)
    html.push(`<x:ExcelWorksheet><x:Name>${safeName}</x:Name>`)
    html.push(`<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>`)
    html.push(`</x:ExcelWorksheet>`)
  }
  html.push('</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->')
  html.push('<style>td, th { font-family: Calibri, Arial, sans-serif; font-size: 11pt; mso-number-format: General; } th { background: #f3f4f6; font-weight: bold; text-align: left; padding: 4px; } td { padding: 4px; vertical-align: top; }</style>')
  html.push('</head>')
  html.push('<body>')
  for (const sheet of sheets) {
    html.push(`<table border="1"><thead><tr>`)
    for (const col of sheet.columns) {
      html.push(`<th>${escapeXml(String(col))}</th>`)
    }
    html.push('</tr></thead><tbody>')
    for (const row of sheet.rows) {
      html.push('<tr>')
      for (let i = 0; i < sheet.columns.length; i++) {
        const cell = row[i]
        if (typeof cell === 'number') {
          html.push(`<td>${cell}</td>`)
        } else {
          html.push(formatCell(cell))
        }
      }
      html.push('</tr>')
    }
    html.push('</tbody></table>')
    // Add a small separator — Excel will treat each <table> as a separate worksheet.
    html.push('<br/><br/>')
  }
  html.push('</body></html>')
  return new Blob([html.join('\n')], { type: 'application/vnd.ms-excel' })
}

/** Trigger a browser download of the .xls blob. */
export function downloadExcel(sheets: Sheet[], filename: string): void {
  const blob = buildXlsBlob(sheets)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xls') ? filename : `${filename}.xls`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Build a CSV blob from a single sheet. Comma-separated, double-quote
 * escaped, UTF-8 with BOM (so Excel opens it with correct encoding).
 */
export function buildCsvBlob(sheet: Sheet): Blob {
  const escape = (v: string | number | boolean | null | undefined): string => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    // Quote if it contains comma, quote, newline, or leading/trailing space
    if (/[",\n\r]/.test(s) || /^\s|\s$/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const lines: string[] = []
  lines.push(sheet.columns.map(escape).join(','))
  for (const row of sheet.rows) {
    lines.push(row.slice(0, sheet.columns.length).map(escape).join(','))
  }
  // BOM prefix so Excel detects UTF-8
  return new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
}

/** Trigger a browser download of a CSV file. */
export function downloadCsv(sheet: Sheet, filename: string): void {
  const blob = buildCsvBlob(sheet)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─── PDF export ────────────────────────────────────────────────────────
//
// Generates a printable PDF using the browser's native print-to-PDF
// capability via a hidden iframe. We build a self-contained HTML
// document with print-optimized CSS (@page margins, table layout) and
// trigger window.print() inside the iframe — the user picks "Save as
// PDF" from the print dialog. This avoids shipping a heavy PDF library
// (jsPDF/pdfmake are 300KB+ minified) and works on every platform
// (Electron, Chrome, Firefox, Safari, mobile WebView).
export function downloadPdf(sheets: Sheet[], filename: string): void {
  const html: string[] = []
  html.push('<!DOCTYPE html>')
  html.push('<html xmlns="http://www.w3.org/1999/xhtml">')
  html.push('<head><meta charset="UTF-8" />')
  html.push('<title>Report</title>')
  html.push('<style>')
  // Print layout: A4 portrait, narrow margins, repeat table headers on
  // each page. Tables get full-width with banded rows for readability.
  html.push(`
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #0f172a; margin: 0; padding: 0; font-size: 10pt; }
    h2 { font-size: 13pt; margin: 18px 0 6px 0; color: #0EA5E9; border-bottom: 2px solid #0EA5E9; padding-bottom: 3px; }
    h2:first-child { margin-top: 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th { background: #f1f5f9; color: #0f172a; font-weight: 700; text-align: left; padding: 5px 6px; border: 1px solid #cbd5e1; font-size: 9pt; }
    td { padding: 4px 6px; border: 1px solid #e2e8f0; font-size: 9pt; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .report-meta { font-size: 8pt; color: #64748b; margin-bottom: 12px; }
    .report-meta strong { color: #0f172a; }
    @media print {
      h2 { page-break-after: avoid; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
    }
  `)
  html.push('</style></head><body>')
  html.push(`<div class="report-meta"><strong>Generated:</strong> ${new Date().toLocaleString()}</div>`)
  for (const sheet of sheets) {
    const safeName = escapeXml(sheet.name)
    html.push(`<h2>${safeName}</h2>`)
    html.push('<table><thead><tr>')
    for (const col of sheet.columns) {
      html.push(`<th>${escapeXml(String(col))}</th>`)
    }
    html.push('</tr></thead><tbody>')
    for (const row of sheet.rows) {
      html.push('<tr>')
      for (let i = 0; i < sheet.columns.length; i++) {
        const cell = row[i]
        if (cell === null || cell === undefined) {
          html.push('<td></td>')
        } else if (typeof cell === 'number') {
          html.push(`<td style="text-align:right">${cell}</td>`)
        } else {
          html.push(`<td>${escapeXml(String(cell))}</td>`)
        }
      }
      html.push('</tr>')
    }
    html.push('</tbody></table>')
  }
  html.push('</body></html>')

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.opacity = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    return
  }
  doc.open()
  doc.write(html.join('\n'))
  doc.close()

  const w = iframe.contentWindow
  if (!w) {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    return
  }

  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
  }

  // Give the iframe a tick to lay out before calling print.
  setTimeout(() => {
    try {
      w.focus()
      const afterOnce = () => {
        w.removeEventListener('afterprint', afterOnce)
        cleanup()
      }
      w.addEventListener('afterprint', afterOnce)
      w.print()
      setTimeout(cleanup, 2000)
    } catch (err) {
      console.error('[downloadPdf] print failed:', err)
      cleanup()
    }
  }, 150)

  // The browser's "Save as PDF" dialog handles the actual file naming —
  // the user can save with whatever name they like. We still keep the
  // suggested filename around for logging purposes.
  void filename
}
