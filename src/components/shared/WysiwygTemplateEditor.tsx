'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Bold, Italic, Underline, Type, Palette, AlignLeft, AlignCenter, AlignRight,
  ArrowUp, ArrowDown, Eye, EyeOff, GripVertical, Plus, Trash2, RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { TemplateBlock } from '@/components/shared/Receipts'

// ─── Block type definitions ────────────────────────────────────────────
//
// "text" blocks (header, footer, extra_note) allow the admin to type
// custom text directly into a textarea. "dynamic" blocks (meta, items,
// subtotal, total, notes) are auto-generated from the bill/order data
// so the admin can only style them, not edit their text content.
type BlockType = 'text' | 'dynamic'

interface BlockMeta {
  key: string
  label: string
  type: BlockType
  // For text blocks: the default placeholder text shown in the textarea.
  placeholder?: string
}

export const BILL_BLOCK_META: BlockMeta[] = [
  { key: 'header', label: 'Shop Name + Address', type: 'text', placeholder: 'Restaurant name, address, phone, GSTIN…' },
  { key: 'meta', label: 'Bill No, Table, Date, Payment', type: 'dynamic' },
  { key: 'items', label: 'Line Items Table', type: 'dynamic' },
  { key: 'subtotal', label: 'Subtotal + Tax + Discount', type: 'dynamic' },
  { key: 'total', label: 'Grand Total', type: 'dynamic' },
  { key: 'extra_note', label: 'Extra Note', type: 'text', placeholder: 'e.g. Returns accepted within 7 days with bill' },
  { key: 'footer', label: 'Footer / Thank You', type: 'text', placeholder: 'e.g. Thank you for dining with us!' },
]

export const KOT_BLOCK_META: BlockMeta[] = [
  { key: 'header', label: 'Shop Name + KOT Banner', type: 'text', placeholder: 'KOT prefix + shop name…' },
  { key: 'meta', label: 'KOT No, Table, Guests, Waiter', type: 'dynamic' },
  { key: 'items', label: 'Items + Qty + Status', type: 'dynamic' },
  { key: 'notes', label: 'Special Notes', type: 'dynamic' },
  { key: 'extra_note', label: 'Extra Note for Kitchen', type: 'text', placeholder: 'e.g. Allergies? Note here' },
  { key: 'footer', label: 'Footer / Hand to Kitchen', type: 'text', placeholder: 'e.g. *** Hand to kitchen ***' },
]

interface WysiwygTemplateEditorProps {
  blocks: TemplateBlock[]
  blockMeta: BlockMeta[]
  globalFontSize: number
  globalBold: boolean
  globalColor: string
  globalAlign: string
  onChange: (blocks: TemplateBlock[]) => void
  onReset: () => void
}

/**
 * WysiwygTemplateEditor — a full WYSIWYG editor for bill / KOT templates.
 *
 * Features:
 *   • Click any block to select it (mouse)
 *   • Formatting toolbar: Bold, Italic, Underline, Font Size, Color, Alignment
 *   • For text blocks: direct textarea editing (keyboard typing)
 *   • Drag blocks up/down with mouse (or use ↑/↓ buttons)
 *   • Show/hide toggle per block (Eye icon)
 *   • Add missing blocks / delete blocks
 *   • Reset to default order
 *
 * The editor is entirely mouse + keyboard driven — no code, no JSON.
 * Every change is reflected immediately in the live preview.
 */
export function WysiwygTemplateEditor({
  blocks,
  blockMeta,
  globalFontSize,
  globalBold,
  globalColor,
  globalAlign,
  onChange,
  onReset,
}: WysiwygTemplateEditorProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(blocks[0]?.key || null)
  const dragSrcIdx = useRef<number | null>(null)

  const selected = blocks.find((b) => b.key === selectedKey) || null
  const selectedMeta = blockMeta.find((m) => m.key === selectedKey) || null

  // ─── Block update helpers ───
  const updateBlock = useCallback((key: string, patch: Partial<TemplateBlock>) => {
    onChange(blocks.map((b) => (b.key === key ? { ...b, ...patch } : b)))
  }, [blocks, onChange])

  const moveBlock = useCallback((idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= blocks.length) return
    const copy = [...blocks]
    const [moved] = copy.splice(idx, 1)
    copy.splice(newIdx, 0, moved)
    onChange(copy)
  }, [blocks, onChange])

  const deleteBlock = useCallback((key: string) => {
    onChange(blocks.filter((b) => b.key !== key))
    if (selectedKey === key) setSelectedKey(null)
  }, [blocks, onChange, selectedKey])

  const addBlock = useCallback((key: string) => {
    if (blocks.some((b) => b.key === key)) return
    onChange([...blocks, { key, enabled: true }])
    setSelectedKey(key)
  }, [blocks, onChange])

  // ─── Drag and drop (HTML5 DnD) ───
  const onDragStart = (idx: number) => (e: React.DragEvent) => {
    dragSrcIdx.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  const onDrop = (targetIdx: number) => (e: React.DragEvent) => {
    e.preventDefault()
    const srcIdx = dragSrcIdx.current
    if (srcIdx === null || srcIdx === targetIdx) return
    const copy = [...blocks]
    const [moved] = copy.splice(srcIdx, 1)
    copy.splice(targetIdx, 0, moved)
    onChange(copy)
    dragSrcIdx.current = null
  }

  // ─── Formatting toggle helpers ───
  // When toggling bold/italic/underline, if the new value equals the global
  // default, we set it to `undefined` so the config stays compact (only
  // overrides are stored).
  const toggleBold = () => {
    if (!selected) return
    const newVal = !(selected.bold ?? globalBold)
    updateBlock(selected.key, { bold: newVal === globalBold ? undefined : newVal })
  }
  const toggleItalic = () => {
    if (!selected) return
    const newVal = !(selected.italic ?? false)
    updateBlock(selected.key, { italic: newVal || undefined })
  }
  const toggleUnderline = () => {
    if (!selected) return
    const newVal = !(selected.underline ?? false)
    updateBlock(selected.key, { underline: newVal || undefined })
  }
  const setFontSize = (val: number) => {
    if (!selected) return
    updateBlock(selected.key, { fontSize: val === globalFontSize ? undefined : val })
  }
  const setColor = (val: string) => {
    if (!selected) return
    updateBlock(selected.key, { color: val === globalColor ? undefined : val })
  }
  const setAlign = (val: string) => {
    if (!selected) return
    updateBlock(selected.key, { align: val === globalAlign ? undefined : val })
  }
  const toggleEnabled = () => {
    if (!selected) return
    updateBlock(selected.key, { enabled: !(selected.enabled ?? true) })
  }

  // ─── Keyboard shortcuts ───
  // Ctrl+B / Ctrl+I / Ctrl+U toggle bold / italic / underline on the
  // selected block. We only fire when NOT typing in an input/textarea
  // (so the browser's native text editing shortcuts still work inside
  // the custom-text textarea).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selected || !e.ctrlKey && !e.metaKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); toggleBold() }
      else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); toggleItalic() }
      else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); toggleUnderline() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Available blocks to add (not yet in the template) ───
  const availableToAdd = blockMeta.filter((m) => !blocks.some((b) => b.key === m.key))

  // Resolve the selected block's EFFECTIVE style for the toolbar state.
  const effBold = selected?.bold ?? globalBold
  const effItalic = selected?.italic ?? false
  const effUnderline = selected?.underline ?? false
  const effFontSize = selected?.fontSize ?? globalFontSize
  const effColor = selected?.color ?? globalColor
  const effAlign = selected?.align ?? globalAlign

  return (
    <div className="space-y-3">
      {/* ─── Formatting toolbar ───
          Shows controls for the currently-selected block. If no block is
          selected, the toolbar is dimmed. */}
      <div className="sticky top-0 z-10 bg-white border border-slate-200 rounded-lg p-2 shadow-sm">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mr-2">
            {selected ? `Editing: ${selectedMeta?.label || selected.key}` : 'Select a block'}
          </span>

          {/* Bold */}
          <button
            onClick={toggleBold}
            disabled={!selected}
            className={`p-1.5 rounded transition-colors ${effBold ? 'bg-sky-100 text-sky-700 border border-sky-300' : 'text-slate-500 hover:bg-slate-100 border border-transparent'} disabled:opacity-30`}
            title="Bold (Ctrl+B)"
          >
            <Bold className="w-4 h-4" />
          </button>

          {/* Italic */}
          <button
            onClick={toggleItalic}
            disabled={!selected}
            className={`p-1.5 rounded transition-colors ${effItalic ? 'bg-sky-100 text-sky-700 border border-sky-300' : 'text-slate-500 hover:bg-slate-100 border border-transparent'} disabled:opacity-30`}
            title="Italic (Ctrl+I)"
          >
            <Italic className="w-4 h-4" />
          </button>

          {/* Underline */}
          <button
            onClick={toggleUnderline}
            disabled={!selected}
            className={`p-1.5 rounded transition-colors ${effUnderline ? 'bg-sky-100 text-sky-700 border border-sky-300' : 'text-slate-500 hover:bg-slate-100 border border-transparent'} disabled:opacity-30`}
            title="Underline (Ctrl+U)"
          >
            <Underline className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {/* Font size */}
          <div className="flex items-center gap-1">
            <Type className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="number"
              min={6}
              max={32}
              value={effFontSize}
              disabled={!selected}
              onChange={(e) => setFontSize(Number(e.target.value) || globalFontSize)}
              className="w-12 h-7 text-xs text-center border border-slate-200 rounded px-1 disabled:opacity-30"
              title="Font size (px)"
            />
            <span className="text-[10px] text-slate-400">px</span>
            {/* Quick size presets */}
            <div className="flex gap-0.5 ml-1">
              {[8, 9, 10, 11, 12, 14, 16, 18].map((sz) => (
                <button
                  key={sz}
                  onClick={() => setFontSize(sz)}
                  disabled={!selected}
                  className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${effFontSize === sz ? 'bg-sky-100 text-sky-700 border border-sky-300' : 'text-slate-400 hover:bg-slate-100 border border-transparent'} disabled:opacity-30`}
                  title={`${sz}px`}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {/* Color */}
          <div className="flex items-center gap-1">
            <Palette className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="color"
              value={effColor}
              disabled={!selected}
              onChange={(e) => setColor(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border border-slate-200 disabled:opacity-30"
              title="Text color"
            />
            {/* 3-color scheme presets */}
            <div className="flex gap-0.5">
              {['#000000', '#0EA5E9', '#22C55E'].map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  disabled={!selected}
                  className={`w-5 h-5 rounded-full border-2 ${effColor === c ? 'border-sky-400' : 'border-white'} shadow disabled:opacity-30`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {/* Alignment */}
          <div className="flex items-center gap-0.5">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAlign(a)}
                disabled={!selected}
                className={`p-1.5 rounded transition-colors ${effAlign === a ? 'bg-sky-100 text-sky-700 border border-sky-300' : 'text-slate-500 hover:bg-slate-100 border border-transparent'} disabled:opacity-30`}
                title={`Align ${a}`}
              >
                {a === 'left' ? <AlignLeft className="w-4 h-4" /> : a === 'center' ? <AlignCenter className="w-4 h-4" /> : <AlignRight className="w-4 h-4" />}
              </button>
            ))}
          </div>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {/* Show/hide */}
          <button
            onClick={toggleEnabled}
            disabled={!selected}
            className={`p-1.5 rounded transition-colors ${(selected?.enabled ?? true) ? 'text-sky-600 hover:bg-sky-50' : 'text-slate-400 hover:bg-slate-100'} disabled:opacity-30`}
            title={selected?.enabled === false ? 'Show block' : 'Hide block'}
          >
            {selected?.enabled === false ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>

          {/* Move up / down */}
          <button
            onClick={() => { const idx = blocks.findIndex((b) => b.key === selectedKey); if (idx >= 0) moveBlock(idx, -1) }}
            disabled={!selected || blocks.findIndex((b) => b.key === selectedKey) === 0}
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            title="Move up"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => { const idx = blocks.findIndex((b) => b.key === selectedKey); if (idx >= 0) moveBlock(idx, 1) }}
            disabled={!selected || blocks.findIndex((b) => b.key === selectedKey) === blocks.length - 1}
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            title="Move down"
          >
            <ArrowDown className="w-4 h-4" />
          </button>

          {/* Delete block */}
          <button
            onClick={() => selected && deleteBlock(selected.key)}
            disabled={!selected}
            className="p-1.5 rounded text-rose-500 hover:bg-rose-50 disabled:opacity-30"
            title="Delete block"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <div className="flex-1" />

          {/* Reset */}
          <Button variant="ghost" size="sm" onClick={onReset} className="text-[10px] h-7 text-slate-500 ml-auto">
            <RotateCcw className="w-3 h-3 mr-1" /> Reset
          </Button>
        </div>

        {/* Keyboard shortcuts hint */}
        <div className="mt-1.5 text-[9px] text-slate-400 flex gap-3">
          <span><kbd className="px-1 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono">Ctrl+B</kbd> Bold</span>
          <span><kbd className="px-1 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono">Ctrl+I</kbd> Italic</span>
          <span><kbd className="px-1 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono">Ctrl+U</kbd> Underline</span>
          <span className="ml-auto">Tip: drag blocks with the grip handle to reorder</span>
        </div>
      </div>

      {/* ─── Block list ───
          Each block is a clickable card. Click to select, drag to reorder. */}
      <div className="space-y-1.5">
        {blocks.map((block, idx) => {
          const meta = blockMeta.find((m) => m.key === block.key)
          const isSelected = block.key === selectedKey
          const isEnabled = block.enabled ?? true
          const bFontSize = block.fontSize ?? globalFontSize
          const bBold = block.bold ?? globalBold
          const bItalic = block.italic ?? false
          const bUnderline = block.underline ?? false
          const bColor = block.color ?? globalColor

          return (
            <div
              key={block.key}
              draggable
              onDragStart={onDragStart(idx)}
              onDragOver={onDragOver}
              onDrop={onDrop(idx)}
              onClick={() => setSelectedKey(block.key)}
              className={`group flex items-start gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-all ${
                isSelected
                  ? 'border-sky-400 bg-sky-50/60 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/30'
              } ${!isEnabled ? 'opacity-50' : ''}`}
            >
              {/* Drag handle */}
              <GripVertical className="w-4 h-4 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing mt-0.5 shrink-0" />

              {/* Block number */}
              <span className="text-[10px] font-mono text-slate-400 w-5 shrink-0 mt-0.5">{idx + 1}.</span>

              {/* Block content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-slate-700">{meta?.label || block.key}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${meta?.type === 'text' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                    {meta?.type === 'text' ? 'editable text' : 'auto'}
                  </span>
                  {!isEnabled && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500">hidden</span>
                  )}
                </div>

                {/* Style summary chips */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-slate-400">
                    <span
                      style={{
                        fontSize: `${Math.min(bFontSize, 14)}px`,
                        fontWeight: bBold ? 700 : 400,
                        fontStyle: bItalic ? 'italic' : 'normal',
                        textDecoration: bUnderline ? 'underline' : 'none',
                        color: bColor,
                      }}
                    >
                      Aa
                    </span>
                    <span className="ml-1">{bFontSize}px</span>
                  </span>
                  {bBold && <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-600 font-bold">B</span>}
                  {bItalic && <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-600 italic">I</span>}
                  {bUnderline && <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-600 underline">U</span>}
                  {block.color && block.color !== globalColor && (
                    <span className="flex items-center gap-0.5 text-[9px] text-slate-500">
                      <span className="w-2.5 h-2.5 rounded-full border border-slate-200" style={{ backgroundColor: block.color }} />
                      color
                    </span>
                  )}
                  {block.align && block.align !== globalAlign && (
                    <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-600">↔ {block.align}</span>
                  )}
                </div>

                {/* Text editor for "text" blocks */}
                {meta?.type === 'text' && isSelected && (
                  <textarea
                    value={block.customText ?? ''}
                    onChange={(e) => updateBlock(block.key, { customText: e.target.value || undefined })}
                    placeholder={meta.placeholder || 'Type custom text here…'}
                    rows={2}
                    className="mt-2 w-full text-xs p-2 border border-slate-200 rounded font-mono resize-y focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-200"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}

                {/* Preview text for text blocks when not selected */}
                {meta?.type === 'text' && !isSelected && block.customText && (
                  <div className="mt-1 text-[10px] text-slate-400 truncate italic">
                    "{block.customText}"
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ─── Add missing blocks ─── */}
      {availableToAdd.length > 0 && (
        <div className="pt-2 border-t border-slate-100">
          <Label className="text-[10px] text-slate-400 uppercase tracking-wide mb-1.5 block">Add block</Label>
          <div className="flex gap-1.5 flex-wrap">
            {availableToAdd.map((meta) => (
              <button
                key={meta.key}
                onClick={() => addBlock(meta.key)}
                className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-sky-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {meta.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
