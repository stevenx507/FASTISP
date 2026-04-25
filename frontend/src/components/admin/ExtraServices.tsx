import React, { useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

type ServiceStatus = 'active' | 'disabled'

interface ExtraServiceItem {
  id: string
  name: string
  category: string
  description: string
  monthly_price: number
  one_time_fee: number
  status: ServiceStatus
  subscribers: number
  created_at?: string
  updated_at?: string
  created_by_name?: string
  updated_by_name?: string
}

interface CreateForm {
  name: string
  category: string
  description: string
  monthly_price: string
  one_time_fee: string
  status: ServiceStatus
}

const defaultForm: CreateForm = {
  name: '',
  category: 'other',
  description: '',
  monthly_price: '',
  one_time_fee: '',
  status: 'active',
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

const ExtraServices: React.FC = () => {
  const [items, setItems] = useState<ExtraServiceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateForm>(defaultForm)

  const load = async () => {
    setLoading(true)
    try {
      const response = await apiClient.get('/admin/extra-services')
      setItems((response.items || []) as ExtraServiceItem[])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar servicios'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const createService = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      toast.error('Nombre requerido')
      return
    }
    setCreating(true)
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim(),
        description: form.description.trim(),
        monthly_price: Number(form.monthly_price || 0),
        one_time_fee: Number(form.one_time_fee || 0),
        status: form.status,
      }
      const response = await apiClient.post('/admin/extra-services', payload)
      const created = response.service as ExtraServiceItem
      setItems((prev) => [created, ...prev])
      setForm(defaultForm)
      toast.success('Servicio creado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo crear servicio'
      toast.error(msg)
    } finally {
      setCreating(false)
    }
  }

  const updateService = async (serviceId: string, patch: Partial<ExtraServiceItem>) => {
    setSavingId(serviceId)
    try {
      const response = await apiClient.patch(`/admin/extra-services/${serviceId}`, patch)
      const updated = response.service as ExtraServiceItem
      setItems((prev) => prev.map((item) => (item.id === serviceId ? updated : item)))
      toast.success('Servicio actualizado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar servicio'
      toast.error(msg)
    } finally {
      setSavingId(null)
    }
  }

  const summary = useMemo(() => {
    const active = items.filter((item) => item.status === 'active').length
    const subscribers = items.reduce((sum, item) => sum + Number(item.subscribers || 0), 0)
    const mrr = items.reduce((sum, item) => sum + Number(item.monthly_price || 0) * Number(item.subscribers || 0), 0)
    return { active, subscribers, mrr }
  }, [items])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Servicios adicionales</h2>
          <p className="text-sm text-slate-400">Catalogo comercial, precios y estado operativo de addons.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 backdrop-blur-md px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 disabled:opacity-60"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-blue-100 bg-blue-500/10 p-4">
          <p className="text-xs font-semibold uppercase text-blue-300">Servicios activos</p>
          <p className="mt-2 text-2xl font-bold text-blue-200">{summary.active}</p>
        </div>
        <div className="rounded-xl border border-violet-100 bg-violet-500/10 p-4">
          <p className="text-xs font-semibold uppercase text-violet-700">Suscriptores</p>
          <p className="mt-2 text-2xl font-bold text-violet-900">{summary.subscribers}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase text-emerald-700">MRR estimado</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">${summary.mrr.toFixed(2)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <form onSubmit={createService} className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-4 shadow-sm">
          <h3 className="mb-3 font-semibold text-white">Nuevo servicio</h3>
          <div className="space-y-3">
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Nombre"
              className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm"
            />
            <input
              value={form.category}
              onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
              placeholder="Categoria"
              className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm"
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              rows={3}
              placeholder="Descripcion"
              className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.monthly_price}
                onChange={(e) => setForm((prev) => ({ ...prev, monthly_price: e.target.value }))}
                placeholder="Mensual"
                className="rounded-lg border border-white/20 px-3 py-2 text-sm"
              />
              <input
                value={form.one_time_fee}
                onChange={(e) => setForm((prev) => ({ ...prev, one_time_fee: e.target.value }))}
                placeholder="Unico"
                className="rounded-lg border border-white/20 px-3 py-2 text-sm"
              />
            </div>
            <select
              value={form.status}
              onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as ServiceStatus }))}
              className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm"
            >
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {creating ? 'Creando...' : 'Crear servicio'}
            </button>
          </div>
        </form>

        <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md shadow-sm xl:col-span-2">
          <div className="border-b border-white/5 px-4 py-3">
            <h3 className="font-semibold text-white">Catalogo</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/5 text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Servicio</th>
                  <th className="px-4 py-3 text-left">Categoria</th>
                  <th className="px-4 py-3 text-right">Mensual</th>
                  <th className="px-4 py-3 text-right">Unico</th>
                  <th className="px-4 py-3 text-right">Subs</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{item.name}</p>
                      <p className="text-xs text-slate-400">{item.description}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        creado por {item.created_by_name || 'system'} - {formatDateTime(item.created_at)}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        actualizado por {item.updated_by_name || 'system'} - {formatDateTime(item.updated_at)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{item.category}</td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={item.monthly_price}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row) =>
                              row.id === item.id ? { ...row, monthly_price: Number(e.target.value) } : row
                            )
                          )
                        }
                        onBlur={() => updateService(item.id, { monthly_price: item.monthly_price })}
                        className="w-20 rounded-md border border-white/20 px-2 py-1 text-xs text-right"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={item.one_time_fee}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row) =>
                              row.id === item.id ? { ...row, one_time_fee: Number(e.target.value) } : row
                            )
                          )
                        }
                        onBlur={() => updateService(item.id, { one_time_fee: item.one_time_fee })}
                        className="w-20 rounded-md border border-white/20 px-2 py-1 text-xs text-right"
                      />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-white">{item.subscribers}</td>
                    <td className="px-4 py-3">
                      <select
                        value={item.status}
                        onChange={(e) => updateService(item.id, { status: e.target.value as ServiceStatus })}
                        className={`rounded-md border border-white/20 px-2 py-1 text-xs font-semibold ${
                          item.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <option value="active">active</option>
                        <option value="disabled">disabled</option>
                      </select>
                      {savingId === item.id && <span className="ml-2 text-xs text-slate-400">...</span>}
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-slate-400" colSpan={6}>
                      Sin servicios adicionales cargados.
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

export default ExtraServices
