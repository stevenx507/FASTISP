import React, { useEffect, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

interface MaintenanceItem {
  id: number
  title: string
  scope: 'all' | 'router' | 'billing' | 'network'
  starts_at: string
  ends_at: string
  mute_alerts: boolean
  note?: string
  status?: 'scheduled' | 'active' | 'finished'
}

const toLocalInputValue = (iso?: string) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

const MaintenanceWindowsView: React.FC = () => {
  const [items, setItems] = useState<MaintenanceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [scope, setScope] = useState<MaintenanceItem['scope']>('all')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [muteAlerts, setMuteAlerts] = useState(true)
  const [note, setNote] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'scheduled' | 'active' | 'finished'>('all')

  const load = async () => {
    setLoading(true)
    try {
      const query = statusFilter === 'all' ? '' : `?status=${statusFilter}`
      const response = await apiClient.get(`/admin/network/maintenance${query}`) as { items?: MaintenanceItem[] }
      setItems((response.items || []) as MaintenanceItem[])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar ventanas'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [statusFilter])

  const createWindow = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        scope,
        starts_at: startsAt,
        ends_at: endsAt,
        mute_alerts: muteAlerts,
        note: note.trim(),
      }
      const response = await apiClient.post('/admin/network/maintenance', payload)
      const created = response.item as MaintenanceItem
      setItems((prev) => [created, ...prev])
      setTitle('')
      setStartsAt('')
      setEndsAt('')
      setNote('')
      setMuteAlerts(true)
      toast.success('Ventana creada')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo crear ventana'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const patchWindow = async (item: MaintenanceItem, patch: Partial<MaintenanceItem>) => {
    try {
      const response = await apiClient.patch(`/admin/network/maintenance/${item.id}`, patch)
      const updated = response.item as MaintenanceItem
      setItems((prev) => prev.map((row) => (row.id === item.id ? updated : row)))
      toast.success('Ventana actualizada')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar ventana'
      toast.error(msg)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Ventanas de Mantenimiento NOC</h2>
          <p className="text-sm text-gray-600">Programa mantenimientos y silencia alertas por alcance.</p>
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <form onSubmit={createWindow} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold text-gray-900">Nueva ventana</h3>
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Titulo"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <select value={scope} onChange={(e) => setScope(e.target.value as MaintenanceItem['scope'])} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="all">all</option>
              <option value="router">router</option>
              <option value="billing">billing</option>
              <option value="network">network</option>
            </select>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={muteAlerts} onChange={(e) => setMuteAlerts(e.target.checked)} />
              Silenciar alertas durante la ventana
            </label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Notas" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <button type="submit" disabled={saving} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Guardando...' : 'Crear ventana'}
            </button>
          </div>
        </form>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm xl:col-span-2">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="font-semibold text-gray-900">Ventanas configuradas</h3>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
              <option value="all">Todos</option>
              <option value="scheduled">scheduled</option>
              <option value="active">active</option>
              <option value="finished">finished</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Titulo</th>
                  <th className="px-4 py-3 text-left">Scope</th>
                  <th className="px-4 py-3 text-left">Inicio</th>
                  <th className="px-4 py-3 text-left">Fin</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Mute</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{item.title}</p>
                      <p className="text-xs text-gray-500">{item.note || '-'}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.scope}</td>
                    <td className="px-4 py-3 text-gray-700">{new Date(item.starts_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-700">{new Date(item.ends_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.status === 'active' ? 'bg-emerald-100 text-emerald-700' : item.status === 'scheduled' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                        {item.status || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={Boolean(item.mute_alerts)}
                          onChange={(e) => patchWindow(item, { mute_alerts: e.target.checked })}
                        />
                        mute
                      </label>
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={6}>
                      Sin ventanas registradas.
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

export default MaintenanceWindowsView
