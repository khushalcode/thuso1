'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, TrendingDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { formatCurrency, formatDateTime } from '@/lib/format'
import type { MoneyOut } from '@/lib/types'
import { EntryForm } from './ExpensesPage'
import { ReasonDialog, type PendingDelete } from './ReasonDialog'
import { useShopFetch } from '@/hooks/use-shop-fetch'
import { useSession } from '@/lib/session'

const PURPOSES = ['Owner Draw', 'Loan Repayment', 'Asset Purchase', 'Donation', 'Personal', 'Misc']

export default function MoneyOutPage() {
  const shopFetch = useShopFetch()
  const { user } = useSession()
  const [items, setItems] = useState<MoneyOut[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [pendingDel, setPendingDel] = useState<PendingDelete | null>(null)
  // Bill deletion has been REMOVED from the entire system — the
  // "Deleted Bills" section that used to live on this page is gone.
  // Money Out now only shows manually-recorded outflows (owner draws,
  // loan repayments, etc.).

  const load = useCallback(async () => {
    setLoading(true)
    const res = await shopFetch('/api/moneyout')
    const data = await res.json()
    setItems(data.items)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const total = items.reduce((s, i) => s + i.amount, 0)
  const totalToday = items.filter((i) => new Date(i.date).toDateString() === new Date().toDateString()).reduce((s, i) => s + i.amount, 0)

  const save = async (data: any) => {
    const res = await shopFetch('/api/moneyout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, purpose: data.category, partyName: data.partyName || null }),
    })
    if (!res.ok) { toast.error('Failed to save'); return }
    toast.success('Money Out recorded')
    setShowAdd(false)
    load()
  }

  const del = async (id: string, reason: string) => {
    const item = items.find((i) => i.id === id)
    try {
      await shopFetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'money_out_deleted',
          details: {
            id,
            amount: item?.amount,
            purpose: item?.purpose,
            date: item?.date,
            reason,
            deletedBy: user?.name || 'unknown',
          },
        }),
      })
    } catch (e) {
      console.warn('[moneyout] audit log failed:', e)
    }
    const res = await shopFetch(`/api/moneyout?id=${id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error('Failed to delete'); throw new Error('delete failed') }
    toast.success('Entry deleted')
    setPendingDel(null)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight">Money Out</h1>
          <p className="text-[10px] sm:text-sm text-slate-500">
            Today: {formatCurrency(totalToday)} · Total: {formatCurrency(total)}
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="bg-gradient-to-r from-sky-500 to-emerald-500 text-white">
          <Plus className="w-4 h-4 mr-1" /> New Entry
        </Button>
      </div>

      {loading ? (
        <div className="h-64 bg-slate-100 rounded-2xl animate-pulse" />
      ) : items.length === 0 ? (
        <Card className="p-12 text-center text-slate-500 bg-white border-slate-200">
          <TrendingDown className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <h3 className="text-lg font-semibold text-slate-700 mb-1">No entries yet</h3>
          <p className="text-sm">Record owner draws, loan repayments, asset purchases, etc.</p>
        </Card>
      ) : (
        <Card className="border-0 shadow-md rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left font-semibold text-slate-600 px-4 py-3">Date</th>
                  <th className="text-left font-semibold text-slate-600 px-4 py-3">Purpose</th>
                  <th className="text-left font-semibold text-slate-600 px-4 py-3">Description</th>
                  <th className="text-left font-semibold text-slate-600 px-4 py-3">Payment</th>
                  <th className="text-right font-semibold text-slate-600 px-4 py-3">Amount</th>
                  <th className="text-right font-semibold text-slate-600 px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <AnimatePresence>
                  {items.map((m) => (
                    <motion.tr key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <td className="px-4 py-3 text-slate-600">{formatDateTime(m.date)}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">{m.purpose}</Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{m.description || m.partyName || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="uppercase text-[10px]">{m.paymentMode}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-sky-600">{formatCurrency(m.amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" className="text-rose-500" onClick={() =>
                          setPendingDel({
                            id: m.id,
                            label: `${formatCurrency(m.amount)} · ${m.purpose}${m.description ? ' — ' + m.description : ''}`,
                          })
                        }>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td colSpan={4} className="px-4 py-3 text-right font-semibold text-slate-600">
                    Money Out Total ({items.length} entries)
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-sky-700">{formatCurrency(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Money Out</DialogTitle></DialogHeader>
          <EntryForm
            categories={PURPOSES}
            onSubmit={save}
            onCancel={() => setShowAdd(false)}
            accentColor="from-sky-500 to-emerald-500"
            catLabel="Purpose"
            descLabel="Description"
          />
        </DialogContent>
      </Dialog>

      {/* Delete reason dialog — always asks why before deleting */}
      <ReasonDialog
        pending={pendingDel}
        onConfirm={del}
        onCancel={() => setPendingDel(null)}
        entityLabel="Money Out Entry"
      />
    </div>
  )
}
