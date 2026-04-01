import React, { useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

type StaffRole = 'admin' | 'tech' | 'support' | 'billing' | 'noc' | 'operator'
type StaffStatus = 'active' | 'on_leave' | 'inactive'
type StaffShift = 'day' | 'night' | 'mixed'

interface StaffMember {
  id: number
  name: string
  email: string
  role: StaffRole
  mfa_enabled: boolean
  zone: string
  status: StaffStatus
  shift: StaffShift
  phone: string
  open_tickets: number
  last_seen_at?: string
  created_at?: string
}

interface StaffFormState {
  name: string
  email: string
  role: StaffRole
  zone: string
  status: StaffStatus
  shift: StaffShift
  phone: string
  mfa_enabled: boolean
}

const defaultForm: StaffFormState = {
  name: '',
  email: '',
  role: 'tech',
  zone: 'general',
  status: 'active',
  shift: 'day',
  phone: '',
  mfa_enabled: false,
}

const roleOptions: StaffRole[] = ['admin', 'tech', 'support', 'billing', 'noc', 'operator']
const statusOptions: StaffStatus[] = ['active', 'on_leave', 'inactive']
const shiftOptions: StaffShift[] = ['day', 'night', 'mixed']

const StaffView: React.FC = () => {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [form, setForm] = useState<StaffFormState>(defaultForm)
  const [drafts, setDrafts] = useState<Record<number, Partial<StaffMember>>>({})
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null)

  const loadStaff = async () => {
    setLoading(true)
    try {
      const response = await apiClient.get('/admin/staff')
      setStaff((response.items || []) as StaffMember[])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar el staff'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStaff()
  }, [])

  const filteredStaff = useMemo(() => {
    const q = query.trim().toLowerCase()
    return staff.filter((member) => {
      if (roleFilter !== 'all' && member.role !== roleFilter) return false
      if (!q) return true
      return (
        member.name.toLowerCase().includes(q) ||
        member.email.toLowerCase().includes(q) ||
        member.zone.toLowerCase().includes(q)
      )
    })
  }, [staff, query, roleFilter])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Nombre y email son requeridos')
      return
    }
    setCreating(true)
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        zone: form.zone.trim(),
        status: form.status,
        shift: form.shift,
        phone: form.phone.trim(),
        mfa_enabled: form.mfa_enabled,
      }
      const response = await apiClient.post('/admin/staff', payload)
      const created = response.staff as StaffMember
      setStaff((prev) => [created, ...prev])
      setForm(defaultForm)
      if (response.temporary_password) {
        setTemporaryPassword(String(response.temporary_password))
      }
      toast.success('Staff creado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo crear el staff'
      toast.error(msg)
    } finally {
      setCreating(false)
    }
  }

  const updateDraft = <K extends keyof StaffMember>(staffId: number, key: K, value: StaffMember[K]) => {
    setDrafts((prev) => ({
      ...prev,
      [staffId]: {
        ...(prev[staffId] || {}),
        [key]: value,
      },
    }))
  }

  const saveDraft = async (staffId: number) => {
    const patch = drafts[staffId]
    if (!patch || !Object.keys(patch).length) return
    setSavingId(staffId)
    try {
      const response = await apiClient.patch(`/admin/staff/${staffId}`, patch)
      const updated = response.staff as StaffMember
      setStaff((prev) => prev.map((member) => (member.id === staffId ? updated : member)))
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[staffId]
        return next
      })
      toast.success('Staff actualizado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar el staff'
      toast.error(msg)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Staff</h2>
          <p className="text-sm text-gray-600">Gestiona roles operativos, turnos, zonas y MFA.</p>
        </div>
        <button
          onClick={loadStaff}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {temporaryPassword && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Password temporal generado: <span className="font-mono font-semibold">{temporaryPassword}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <form onSubmit={handleCreate} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold text-gray-900">Nuevo miembro</h3>
          <div className="space-y-3">
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Nombre"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="Email"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={form.role}
                onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as StaffRole }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
              <select
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as StaffStatus }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.zone}
                onChange={(e) => setForm((prev) => ({ ...prev, zone: e.target.value }))}
                placeholder="Zona"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <select
                value={form.shift}
                onChange={(e) => setForm((prev) => ({ ...prev, shift: e.target.value as StaffShift }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {shiftOptions.map((shift) => (
                  <option key={shift} value={shift}>{shift}</option>
                ))}
              </select>
            </div>
            <input
              value={form.phone}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder="Telefono"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.mfa_enabled}
                onChange={(e) => setForm((prev) => ({ ...prev, mfa_enabled: e.target.checked }))}
              />
              MFA habilitado
            </label>
            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {creating ? 'Creando...' : 'Crear staff'}
            </button>
          </div>
        </form>

        <div className="xl:col-span-2 rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre, email o zona"
                className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">Todos los roles</option>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-500">{filteredStaff.length} miembros</p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Miembro</th>
                  <th className="px-4 py-3 text-left">Rol</th>
                  <th className="px-4 py-3 text-left">Zona</th>
                  <th className="px-4 py-3 text-left">Turno</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Tickets</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredStaff.map((member) => {
                  const draft = drafts[member.id] || {}
                  const currentMfa = (draft.mfa_enabled as boolean | undefined) ?? member.mfa_enabled
                  return (
                    <tr key={member.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{member.name}</p>
                        <p className="text-xs text-gray-500">{member.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={(draft.role as StaffRole | undefined) || member.role}
                          onChange={(e) => updateDraft(member.id, 'role', e.target.value as StaffRole)}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        >
                          {roleOptions.map((role) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={(draft.zone as string | undefined) ?? member.zone}
                          onChange={(e) => updateDraft(member.id, 'zone', e.target.value)}
                          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={(draft.shift as StaffShift | undefined) || member.shift}
                          onChange={(e) => updateDraft(member.id, 'shift', e.target.value as StaffShift)}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        >
                          {shiftOptions.map((shift) => (
                            <option key={shift} value={shift}>{shift}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={(draft.status as StaffStatus | undefined) || member.status}
                          onChange={(e) => updateDraft(member.id, 'status', e.target.value as StaffStatus)}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        >
                          {statusOptions.map((status) => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{member.open_tickets}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => updateDraft(member.id, 'mfa_enabled', !currentMfa)}
                            className={`rounded-md px-2 py-1 text-xs font-semibold ${
                              currentMfa ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            MFA {currentMfa ? 'on' : 'off'}
                          </button>
                          <button
                            onClick={() => saveDraft(member.id)}
                            disabled={savingId === member.id || !Object.keys(drafts[member.id] || {}).length}
                            className="rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingId === member.id ? 'Guardando...' : 'Guardar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!filteredStaff.length && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={7}>
                      Sin miembros para mostrar.
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

export default StaffView
