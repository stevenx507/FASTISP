import React, { useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

interface BillingPromiseItem {
  id: number
  subscription_id: number
  promised_amount: number
  promised_date: string
  status: 'pending' | 'kept' | 'broken' | 'cancelled'
  notes?: string
  created_at?: string
}

const BillingPromisesView: React.FC = () => {
  const [items, setItems] = useState<BillingPromiseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [subscriptionId, setSubscriptionId] = useState('')
  const [amount, setAmount] = useState('')
  const [promiseDate, setPromiseDate] = useState('')
  const [notes, setNotes] = useState('')
  const [filter, setFilter] = useState<'all' | 'pending' | 'kept' | 'broken' | 'cancelled'>('all')

  const load = async () => {
    setLoading(true)
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`
      const response = await apiClient.get(`/admin/billing/promises${query}`) as { items?: BillingPromiseItem[] }
      setItems((response.items || []) as BillingPromiseItem[])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar promesas'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [filter])

  const createPromise = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        subscription_id: Number(subscriptionId),
        promised_amount: Number(amount),
        promised_date: promiseDate,
        notes,
      }
      const response = await apiClient.post('/admin/billing/promises', payload)
      const created = response.promise as BillingPromiseItem
      setItems((prev) => [created, ...prev])
      setSubscriptionId('')
      setAmount('')
      setPromiseDate('')
      setNotes('')
      toast.success('Promesa registrada')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo crear promesa'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (id: number, status: BillingPromiseItem['status']) => {
    try {
      const response = await apiClient.patch(`/admin/billing/promises/${id}`, { status })
      const updated = response.promise as BillingPromiseItem
      setItems((prev) => prev.map((item) => (item.id === id ? updated : item)))
      toast.success('Estado actualizado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar promesa'
      toast.error(msg)
    }
  }

  const summary = useMemo(() => ({
    pending: items.filter((item) => item.status === 'pending').length,
    kept: items.filter((item) => item.status === 'kept').length,
    broken: items.filter((item) => item.status === 'broken').length,
  }), [items])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Promesas de Pago</h2>
          <p className="text-sm text-gray-600">Control de compromisos para evitar cortes y mejorar cobranza.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase text-amber-700">Pendientes</p>
          <p className="mt-2 text-2xl font-bold text-amber-900">{summary.pending}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase text-emerald-700">Cumplidas</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">{summary.kept}</p>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-4">
          <p className="text-xs font-semibold uppercase text-red-700">Incumplidas</p>
          <p className="mt-2 text-2xl font-bold text-red-900">{summary.broken}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <form onSubmit={createPromise} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold text-gray-900">Nueva promesa</h3>
          <div className="space-y-3">
            <input
              value={subscriptionId}
              onChange={(e) => setSubscriptionId(e.target.value)}
              placeholder="Subscription ID"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Monto prometido"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={promiseDate}
              onChange={(e) => setPromiseDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Notas"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Registrar'}
            </button>
          </div>
        </form>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm xl:col-span-2">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="font-semibold text-gray-900">Listado</h3>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="all">Todos</option>
              <option value="pending">pending</option>
              <option value="kept">kept</option>
              <option value="broken">broken</option>
              <option value="cancelled">cancelled</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">Subscription</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3 text-left">Fecha</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-xs text-gray-600">#{item.id}</td>
                    <td className="px-4 py-3 text-gray-800">#{item.subscription_id}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">${item.promised_amount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-gray-700">{item.promised_date}</td>
                    <td className="px-4 py-3">
                      <select
                        value={item.status}
                        onChange={(e) => updateStatus(item.id, e.target.value as BillingPromiseItem['status'])}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                      >
                        <option value="pending">pending</option>
                        <option value="kept">kept</option>
                        <option value="broken">broken</option>
                        <option value="cancelled">cancelled</option>
                      </select>
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={5}>
                      Sin promesas registradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BillingPromisesView
