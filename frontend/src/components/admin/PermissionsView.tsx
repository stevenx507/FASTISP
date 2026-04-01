import React, { useEffect, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

interface RoleMatrixItem {
  role: string
  wildcard: boolean
  permissions: string[]
}

interface OverrideItem {
  id: number
  role: string
  permission: string
  allowed: boolean
  updated_at?: string
}

const roleOptions = ['admin', 'noc', 'tech', 'support', 'billing', 'operator', 'client']

const PermissionsView: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [catalog, setCatalog] = useState<string[]>([])
  const [roles, setRoles] = useState<RoleMatrixItem[]>([])
  const [overrides, setOverrides] = useState<OverrideItem[]>([])
  const [formRole, setFormRole] = useState('tech')
  const [formPermission, setFormPermission] = useState('')
  const [formAllowed, setFormAllowed] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const response = await apiClient.get('/admin/permissions') as {
        catalog?: string[]
        roles?: RoleMatrixItem[]
        overrides?: OverrideItem[]
      }
      const incomingCatalog = (response.catalog || []) as string[]
      setCatalog(incomingCatalog)
      setRoles((response.roles || []) as RoleMatrixItem[])
      setOverrides((response.overrides || []) as OverrideItem[])
      if (!formPermission && incomingCatalog.length > 0) {
        setFormPermission(incomingCatalog[0])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar permisos'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const saveOverride = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!formPermission) {
      toast.error('Selecciona un permiso')
      return
    }
    setSaving(true)
    try {
      await apiClient.post('/admin/permissions', {
        role: formRole,
        permission: formPermission,
        allowed: formAllowed,
      })
      toast.success('Permiso actualizado')
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo guardar override'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Permisos Granulares</h2>
          <p className="text-sm text-gray-600">RBAC por rol para controlar acceso por modulo y accion.</p>
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

      <form onSubmit={saveOverride} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold text-gray-900">Nuevo override</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <select value={formRole} onChange={(e) => setFormRole(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {roleOptions.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
          <select value={formPermission} onChange={(e) => setFormPermission(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {catalog.map((permission) => (
              <option key={permission} value={permission}>{permission}</option>
            ))}
          </select>
          <select value={formAllowed ? 'allow' : 'deny'} onChange={(e) => setFormAllowed(e.target.value === 'allow')} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="allow">allow</option>
            <option value="deny">deny</option>
          </select>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Guardando...' : 'Aplicar'}
          </button>
        </div>
      </form>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-semibold text-gray-900">Matriz por rol</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {roles.map((item) => (
              <div key={item.role} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-gray-900">{item.role}</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.wildcard ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                    {item.wildcard ? 'full access' : `${item.permissions.length} permisos`}
                  </span>
                </div>
                {!item.wildcard && (
                  <p className="mt-2 text-xs text-gray-600">{item.permissions.slice(0, 10).join(', ') || 'sin permisos'}</p>
                )}
              </div>
            ))}
            {!roles.length && <div className="px-4 py-8 text-sm text-gray-500">Sin datos.</div>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-semibold text-gray-900">Overrides</h3>
          </div>
          <div className="max-h-96 overflow-auto divide-y divide-gray-100">
            {overrides.map((item) => (
              <div key={item.id} className="px-4 py-3 text-sm">
                <p className="font-semibold text-gray-900">{item.role}</p>
                <p className="text-xs text-gray-600">{item.permission}</p>
                <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${item.allowed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {item.allowed ? 'allow' : 'deny'}
                </span>
              </div>
            ))}
            {!overrides.length && <div className="px-4 py-8 text-sm text-gray-500">Sin overrides.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PermissionsView
