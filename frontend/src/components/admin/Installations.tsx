import React, { useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

type InstallationStatus = 'pending' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

interface InstallationItem {
  id: string
  client_id?: number | null
  client_name: string
  plan?: string | null
  router?: string | null
  address: string
  status: InstallationStatus
  priority: string
  technician: string
  scheduled_for: string
  notes?: string
  checklist?: Record<string, boolean>
  completed_at?: string
  created_by_name?: string
  updated_by_name?: string
  created_at?: string
  updated_at?: string
}

interface StaffMember {
  id: number
  email: string
  name: string
  role: string
  status: string
}

interface CreateForm {
  client_name: string
  address: string
  technician: string
  scheduled_for: string
  priority: string
  notes: string
}

const statusColor: Record<InstallationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-violet-100 text-violet-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-700',
}

const defaultForm: CreateForm = {
  client_name: '',
  address: '',
  technician: '',
  scheduled_for: '',
  priority: 'normal',
  notes: '',
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

const Installations: React.FC = () => {
  const [items, setItems] = useState<InstallationItem[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [form, setForm] = useState<CreateForm>(defaultForm)

  const load = async () => {
    setLoading(true)
    try {
      const [installationsRes, staffRes] = await Promise.all([
        apiClient.get('/admin/installations') as Promise<{ items: InstallationItem[] }>,
        apiClient.get('/admin/staff') as Promise<{ items: StaffMember[] }>,
      ])
      setItems(installationsRes.items || [])
      setStaff((staffRes.items || []).filter((member) => ['tech', 'support', 'admin', 'noc'].includes(member.role)))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar instalaciones'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filteredItems = useMemo(() => {
    if (statusFilter === 'all') return items
    return items.filter((item) => item.status === statusFilter)
  }, [items, statusFilter])

  const saveStatus = async (installationId: string, status: InstallationStatus) => {
    setSavingId(installationId)
    try {
      const response = await apiClient.patch(`/admin/installations/${installationId}`, { status })
      const updated = response.installation as InstallationItem
      setItems((prev) => prev.map((item) => (item.id === installationId ? updated : item)))
      toast.success('Estado actualizado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar estado'
      toast.error(msg)
    } finally {
      setSavingId(null)
    }
  }

  const saveTechnician = async (installationId: string, technician: string) => {
    setSavingId(installationId)
    try {
      const response = await apiClient.patch(`/admin/installations/${installationId}`, { technician })
      const updated = response.installation as InstallationItem
      setItems((prev) => prev.map((item) => (item.id === installationId ? updated : item)))
      toast.success('Tecnico actualizado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar tecnico'
      toast.error(msg)
    } finally {
      setSavingId(null)
    }
  }

  const createInstallation = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.client_name.trim()) {
      toast.error('Cliente es requerido')
      return
    }
    setCreating(true)
    try {
      const payload = {
        client_name: form.client_name.trim(),
        address: form.address.trim(),
        technician: form.technician.trim() || undefined,
        scheduled_for: form.scheduled_for || undefined,
        priority: form.priority,
        notes: form.notes.trim(),
      }
      const response = await apiClient.post('/admin/installations', payload)
      const created = response.installation as InstallationItem
      setItems((prev) => [created, ...prev])
      setForm(defaultForm)
      toast.success('Instalacion creada')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo crear instalacion'
      toast.error(msg)
    } finally {
      setCreating(false)
    }
  }

  const counters = useMemo(() => {
    return {
      pending: items.filter((item) => item.status === 'pending').length,
      scheduled: items.filter((item) => item.status === 'scheduled').length,
      in_progress: items.filter((item) => item.status === 'in_progress').length,
      completed: items.filter((item) => item.status === 'completed').length,
    }
  }, [items])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Instalaciones</h2>
          <p className="text-sm text-gray-600">Agenda de altas, asignacion de tecnicos y control de avance.</p>
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
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase text-amber-700">Pendientes</p>
          <p className="mt-2 text-2xl font-bold text-amber-900">{counters.pending}</p>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs font-semibold uppercase text-blue-700">Programadas</p>
          <p className="mt-2 text-2xl font-bold text-blue-900">{counters.scheduled}</p>
        </div>
        <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
          <p className="text-xs font-semibold uppercase text-violet-700">En curso</p>
          <p className="mt-2 text-2xl font-bold text-violet-900">{counters.in_progress}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase text-emerald-700">Completadas</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">{counters.completed}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <form onSubmit={createInstallation} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold text-gray-900">Nueva orden</h3>
          <div className="space-y-3">
            <input
              value={form.client_name}
              onChange={(e) => setForm((prev) => ({ ...prev, client_name: e.target.value }))}
              placeholder="Cliente"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={form.address}
              onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
              placeholder="Direccion"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              value={form.technician}
              onChange={(e) => setForm((prev) => ({ ...prev, technician: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Tecnico (asignar luego)</option>
              {staff.map((member) => (
                <option key={member.id} value={member.email}>
                  {member.name} ({member.email})
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="datetime-local"
                value={form.scheduled_for}
                onChange={(e) => setForm((prev) => ({ ...prev, scheduled_for: e.target.value }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <select
                value={form.priority}
                onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="normal">normal</option>
                <option value="high">high</option>
                <option value="urgent">urgent</option>
              </select>
            </div>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              rows={3}
              placeholder="Notas"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {creating ? 'Creando...' : 'Crear orden'}
            </button>
          </div>
        </form>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm xl:col-span-2">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="font-semibold text-gray-900">Cola operativa</h3>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="all">Todos</option>
              <option value="pending">pending</option>
              <option value="scheduled">scheduled</option>
              <option value="in_progress">in_progress</option>
              <option value="completed">completed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Tecnico</th>
                  <th className="px-4 py-3 text-left">Agenda</th>
                  <th className="px-4 py-3 text-left">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{item.client_name}</p>
                      <p className="text-xs text-gray-500">{item.address}</p>
                      <p className="mt-1 text-[11px] text-gray-500">
                        creado por {item.created_by_name || 'system'} - {formatDateTime(item.created_at)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={item.status}
                          onChange={(e) => saveStatus(item.id, e.target.value as InstallationStatus)}
                          className={`rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold ${statusColor[item.status]}`}
                        >
                          <option value="pending">pending</option>
                          <option value="scheduled">scheduled</option>
                          <option value="in_progress">in_progress</option>
                          <option value="completed">completed</option>
                          <option value="cancelled">cancelled</option>
                        </select>
                        {savingId === item.id && <span className="text-xs text-gray-500">...</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={item.technician || ''}
                        onChange={(e) => saveTechnician(item.id, e.target.value)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                      >
                        <option value="">Sin asignar</option>
                        {staff.map((member) => (
                          <option key={member.id} value={member.email}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {item.scheduled_for?.replace('T', ' ').slice(0, 16) || '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      <p>{item.notes || '-'}</p>
                      <p className="mt-1 text-[11px] text-gray-500">
                        ultimo cambio: {item.updated_by_name || 'system'} - {formatDateTime(item.updated_at)}
                      </p>
                    </td>
                  </tr>
                ))}
                {!filteredItems.length && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={5}>
                      Sin ordenes para este filtro.
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

export default Installations
