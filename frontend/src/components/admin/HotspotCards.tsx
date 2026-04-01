import React, { useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

type VoucherStatus = 'generated' | 'sold' | 'used' | 'expired' | 'cancelled'

interface VoucherItem {
  id: string
  code: string
  profile: string
  duration_minutes: number
  data_limit_mb: number
  price: number
  status: VoucherStatus
  assigned_to?: string | null
  created_at?: string
  updated_at?: string
  expires_at?: string
  used_at?: string | null
  created_by_name?: string
  updated_by_name?: string
}

interface BatchForm {
  quantity: string
  profile: string
  duration_minutes: string
  data_limit_mb: string
  price: string
  expires_days: string
}

const defaultForm: BatchForm = {
  quantity: '10',
  profile: 'basic',
  duration_minutes: '60',
  data_limit_mb: '0',
  price: '1.5',
  expires_days: '7',
}

const statusColor: Record<VoucherStatus, string> = {
  generated: 'bg-slate-100 text-slate-700',
  sold: 'bg-blue-100 text-blue-700',
  used: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('es-PE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

const HotspotCards: React.FC = () => {
  const [items, setItems] = useState<VoucherItem[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [form, setForm] = useState<BatchForm>(defaultForm)

  const load = async () => {
    setLoading(true)
    try {
      const response = await apiClient.get('/admin/hotspot/vouchers')
      setItems((response.items || []) as VoucherItem[])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar vouchers'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const createBatch = async (event: React.FormEvent) => {
    event.preventDefault()
    setCreating(true)
    try {
      const payload = {
        quantity: Number(form.quantity || 1),
        profile: form.profile.trim(),
        duration_minutes: Number(form.duration_minutes || 60),
        data_limit_mb: Number(form.data_limit_mb || 0),
        price: Number(form.price || 0),
        expires_days: Number(form.expires_days || 7),
      }
      const response = await apiClient.post('/admin/hotspot/vouchers', payload)
      const created = (response.items || []) as VoucherItem[]
      setItems((prev) => [...created, ...prev])
      toast.success(`Se generaron ${created.length} vouchers`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo generar batch'
      toast.error(msg)
    } finally {
      setCreating(false)
    }
  }

  const updateVoucher = async (voucherId: string, patch: Partial<VoucherItem>) => {
    setUpdatingId(voucherId)
    try {
      const response = await apiClient.patch(`/admin/hotspot/vouchers/${voucherId}`, patch)
      const updated = response.voucher as VoucherItem
      setItems((prev) => prev.map((item) => (item.id === voucherId ? updated : item)))
      toast.success('Voucher actualizado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar voucher'
      toast.error(msg)
    } finally {
      setUpdatingId(null)
    }
  }

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      toast.success('Codigo copiado')
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  const filteredItems = items.filter((item) => filter === 'all' || item.status === filter)
  const summary = useMemo(() => {
    return {
      generated: items.filter((item) => item.status === 'generated').length,
      sold: items.filter((item) => item.status === 'sold').length,
      used: items.filter((item) => item.status === 'used').length,
      revenue: items
        .filter((item) => item.status === 'sold' || item.status === 'used')
        .reduce((sum, item) => sum + Number(item.price || 0), 0),
    }
  }, [items])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Fichas Hotspot</h2>
          <p className="text-sm text-gray-600">Generacion masiva de vouchers, ciclo de vida y revenue estimado.</p>
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase text-slate-700">Generated</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{summary.generated}</p>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs font-semibold uppercase text-blue-700">Sold</p>
          <p className="mt-2 text-2xl font-bold text-blue-900">{summary.sold}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase text-emerald-700">Used</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">{summary.used}</p>
        </div>
        <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
          <p className="text-xs font-semibold uppercase text-violet-700">Revenue</p>
          <p className="mt-2 text-2xl font-bold text-violet-900">${summary.revenue.toFixed(2)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <form onSubmit={createBatch} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold text-gray-900">Generar lote</h3>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.quantity}
                onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
                placeholder="Cantidad"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                value={form.profile}
                onChange={(e) => setForm((prev) => ({ ...prev, profile: e.target.value }))}
                placeholder="Perfil"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.duration_minutes}
                onChange={(e) => setForm((prev) => ({ ...prev, duration_minutes: e.target.value }))}
                placeholder="Minutos"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                value={form.data_limit_mb}
                onChange={(e) => setForm((prev) => ({ ...prev, data_limit_mb: e.target.value }))}
                placeholder="MB limite"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.price}
                onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                placeholder="Precio"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                value={form.expires_days}
                onChange={(e) => setForm((prev) => ({ ...prev, expires_days: e.target.value }))}
                placeholder="Expira dias"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {creating ? 'Generando...' : 'Generar vouchers'}
            </button>
          </div>
        </form>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm xl:col-span-2">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="font-semibold text-gray-900">Inventario de vouchers</h3>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="all">Todos</option>
              <option value="generated">generated</option>
              <option value="sold">sold</option>
              <option value="used">used</option>
              <option value="expired">expired</option>
              <option value="cancelled">cancelled</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Codigo</th>
                  <th className="px-4 py-3 text-left">Perfil</th>
                  <th className="px-4 py-3 text-right">Duracion</th>
                  <th className="px-4 py-3 text-right">Precio</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Asignado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-700">{item.code}</span>
                        <button
                          onClick={() => copyCode(item.code)}
                          className="rounded-md border border-gray-200 p-1 text-gray-500 hover:bg-gray-100"
                        >
                          <DocumentDuplicateIcon className="h-3 w-3" />
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">
                        creado: {item.created_by_name || 'system'} - {formatDateTime(item.created_at)}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        actualizado: {item.updated_by_name || 'system'} - {formatDateTime(item.updated_at)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.profile}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{item.duration_minutes}m</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">${item.price.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={item.status}
                        onChange={(e) => updateVoucher(item.id, { status: e.target.value as VoucherStatus })}
                        className={`rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold ${statusColor[item.status]}`}
                      >
                        <option value="generated">generated</option>
                        <option value="sold">sold</option>
                        <option value="used">used</option>
                        <option value="expired">expired</option>
                        <option value="cancelled">cancelled</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={item.assigned_to || ''}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row) =>
                              row.id === item.id ? { ...row, assigned_to: e.target.value } : row
                            )
                          )
                        }
                        onBlur={() => updateVoucher(item.id, { assigned_to: item.assigned_to || undefined })}
                        className="w-36 rounded-md border border-gray-300 px-2 py-1 text-xs"
                        placeholder="cliente/email"
                      />
                      {updatingId === item.id && <span className="ml-2 text-xs text-gray-500">...</span>}
                    </td>
                  </tr>
                ))}
                {!filteredItems.length && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={6}>
                      Sin vouchers para este filtro.
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

export default HotspotCards
