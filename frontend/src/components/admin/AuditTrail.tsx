import React, { useEffect, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

interface AuditItem {
  id: number
  action: string
  entity_type?: string | null
  entity_id?: string | null
  user_name?: string | null
  user_email?: string | null
  ip_address?: string | null
  created_at?: string | null
  metadata?: Record<string, unknown> | null
}

const LIMIT = 40

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

const metadataPreview = (metadata?: Record<string, unknown> | null) => {
  if (!metadata || typeof metadata !== 'object') return '-'
  const changes = metadata.changes
  if (Array.isArray(changes) && changes.length > 0) {
    return `changes: ${changes.slice(0, 4).join(', ')}`
  }
  const message = metadata.message
  if (typeof message === 'string' && message.trim().length > 0) {
    return message
  }
  const keys = Object.keys(metadata)
  if (!keys.length) return '-'
  return keys.slice(0, 3).join(', ')
}

const AuditTrail: React.FC = () => {
  const [items, setItems] = useState<AuditItem[]>([])
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [userIdFilter, setUserIdFilter] = useState('')

  const load = async (nextOffset = offset) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(nextOffset),
      })
      if (actionFilter.trim()) params.set('action', actionFilter.trim())
      if (entityFilter.trim()) params.set('entity_type', entityFilter.trim())
      if (userIdFilter.trim()) params.set('user_id', userIdFilter.trim())

      const response = await apiClient.get(`/admin/audit-logs?${params.toString()}`) as {
        items?: AuditItem[]
        total?: number
      }
      setItems((response.items || []) as AuditItem[])
      setTotal(Number(response.total || 0))
      setOffset(nextOffset)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar auditoria'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(0)
  }, [])

  const hasPrev = offset > 0
  const hasNext = offset + LIMIT < total

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Auditoria</h2>
          <p className="text-sm text-gray-600">Trazabilidad de acciones, actor, entidad y hora de ejecucion.</p>
        </div>
        <button
          onClick={() => load(offset)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="Filtrar accion"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            placeholder="Filtrar entidad"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
            placeholder="User ID"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={() => load(0)}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Aplicar filtros
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3 className="font-semibold text-gray-900">Eventos ({total})</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => hasPrev && load(Math.max(0, offset - LIMIT))}
              disabled={!hasPrev || loading}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              onClick={() => hasNext && load(offset + LIMIT)}
              disabled={!hasNext || loading}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 disabled:opacity-50"
            >
              Siguiente
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Fecha</th>
                <th className="px-4 py-3 text-left">Accion</th>
                <th className="px-4 py-3 text-left">Entidad</th>
                <th className="px-4 py-3 text-left">Actor</th>
                <th className="px-4 py-3 text-left">IP</th>
                <th className="px-4 py-3 text-left">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-xs text-gray-600">{formatDateTime(item.created_at)}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">{item.action}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {item.entity_type || '-'}
                    {item.entity_id ? <span className="ml-1 text-xs text-gray-500">#{item.entity_id}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <p>{item.user_name || '-'}</p>
                    <p className="text-xs text-gray-500">{item.user_email || '-'}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{item.ip_address || '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{metadataPreview(item.metadata)}</td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={6}>
                    Sin eventos para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default AuditTrail
