import React, { useEffect, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

type AlertStatus = 'draft' | 'active' | 'paused' | 'expired'
type AlertSeverity = 'info' | 'warning' | 'critical' | 'success'
type AlertAudience = 'all' | 'active' | 'overdue' | 'suspended'

interface ScreenAlertItem {
  id: string
  title: string
  message: string
  severity: AlertSeverity
  audience: AlertAudience
  status: AlertStatus
  starts_at?: string | null
  ends_at?: string | null
  impressions?: number
  acknowledged?: number
  created_at?: string
  updated_at?: string
  created_by_name?: string
  updated_by_name?: string
}

interface FormState {
  title: string
  message: string
  severity: AlertSeverity
  audience: AlertAudience
  status: AlertStatus
}

const templates: Array<{ label: string; title: string; message: string; severity: AlertSeverity; audience: AlertAudience }> = [
  {
    label: 'Mantenimiento',
    title: 'Mantenimiento programado',
    message: 'Tendremos una ventana de mantenimiento entre 01:00 y 02:00.',
    severity: 'info',
    audience: 'all',
  },
  {
    label: 'Mora',
    title: 'Regulariza tu pago',
    message: 'Evita corte por mora realizando el pago hoy.',
    severity: 'warning',
    audience: 'overdue',
  },
  {
    label: 'Incidente',
    title: 'Incidencia de red en tu zona',
    message: 'Estamos trabajando para restablecer el servicio lo antes posible.',
    severity: 'critical',
    audience: 'active',
  },
]

const severityColor: Record<AlertSeverity, string> = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
  success: 'bg-emerald-100 text-emerald-700',
}

const statusColor: Record<AlertStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  active: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  expired: 'bg-gray-100 text-gray-700',
}

const defaultForm: FormState = {
  title: '',
  message: '',
  severity: 'info',
  audience: 'all',
  status: 'draft',
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

const ScreenAlerts: React.FC = () => {
  const [items, setItems] = useState<ScreenAlertItem[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [form, setForm] = useState<FormState>(defaultForm)

  const load = async () => {
    setLoading(true)
    try {
      const response = await apiClient.get('/admin/screen-alerts')
      setItems((response.items || []) as ScreenAlertItem[])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar avisos'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const applyTemplate = (template: (typeof templates)[number]) => {
    setForm({
      title: template.title,
      message: template.message,
      severity: template.severity,
      audience: template.audience,
      status: 'draft',
    })
  }

  const createAlert = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.title.trim() || !form.message.trim()) {
      toast.error('Titulo y mensaje son requeridos')
      return
    }
    setCreating(true)
    try {
      const payload = {
        title: form.title.trim(),
        message: form.message.trim(),
        severity: form.severity,
        audience: form.audience,
        status: form.status,
      }
      const response = await apiClient.post('/admin/screen-alerts', payload)
      const created = response.alert as ScreenAlertItem
      setItems((prev) => [created, ...prev])
      setForm(defaultForm)
      toast.success('Aviso creado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo crear aviso'
      toast.error(msg)
    } finally {
      setCreating(false)
    }
  }

  const updateStatus = async (alertId: string, status: AlertStatus) => {
    setSavingId(alertId)
    try {
      const response = await apiClient.patch(`/admin/screen-alerts/${alertId}`, { status })
      const updated = response.alert as ScreenAlertItem
      setItems((prev) => prev.map((item) => (item.id === alertId ? updated : item)))
      toast.success('Estado actualizado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar aviso'
      toast.error(msg)
    } finally {
      setSavingId(null)
    }
  }

  const filteredItems = items.filter((item) => filter === 'all' || item.status === filter)
  const activeCount = items.filter((item) => item.status === 'active').length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Avisos en pantalla</h2>
          <p className="text-sm text-gray-600">Banners operativos para portal cliente por audiencia y severidad.</p>
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
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase text-emerald-700">Activos</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">{activeCount}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase text-slate-700">Draft</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{items.filter((item) => item.status === 'draft').length}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase text-amber-700">Warning</p>
          <p className="mt-2 text-2xl font-bold text-amber-900">{items.filter((item) => item.severity === 'warning').length}</p>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-4">
          <p className="text-xs font-semibold uppercase text-red-700">Critical</p>
          <p className="mt-2 text-2xl font-bold text-red-900">{items.filter((item) => item.severity === 'critical').length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <form onSubmit={createAlert} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold text-gray-900">Nuevo aviso</h3>
          <div className="mb-3 flex flex-wrap gap-2">
            {templates.map((template) => (
              <button
                key={template.label}
                type="button"
                onClick={() => applyTemplate(template)}
                className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              >
                {template.label}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <input
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Titulo"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <textarea
              value={form.message}
              onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
              rows={4}
              placeholder="Mensaje"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-3 gap-2">
              <select
                value={form.severity}
                onChange={(e) => setForm((prev) => ({ ...prev, severity: e.target.value as AlertSeverity }))}
                className="rounded-lg border border-gray-300 px-2 py-2 text-xs"
              >
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="critical">critical</option>
                <option value="success">success</option>
              </select>
              <select
                value={form.audience}
                onChange={(e) => setForm((prev) => ({ ...prev, audience: e.target.value as AlertAudience }))}
                className="rounded-lg border border-gray-300 px-2 py-2 text-xs"
              >
                <option value="all">all</option>
                <option value="active">active</option>
                <option value="overdue">overdue</option>
                <option value="suspended">suspended</option>
              </select>
              <select
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as AlertStatus }))}
                className="rounded-lg border border-gray-300 px-2 py-2 text-xs"
              >
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="expired">expired</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {creating ? 'Creando...' : 'Guardar aviso'}
            </button>
          </div>
        </form>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm xl:col-span-2">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="font-semibold text-gray-900">Historial y estado</h3>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="all">Todos</option>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="expired">expired</option>
            </select>
          </div>
          <div className="divide-y divide-gray-100">
            {filteredItems.map((item) => (
              <div key={item.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900">{item.title}</p>
                    <p className="mt-1 text-sm text-gray-700">{item.message}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-full px-2 py-1 font-semibold ${severityColor[item.severity]}`}>
                        {item.severity}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                        audience: {item.audience}
                      </span>
                      <span className="text-gray-500">
                        impresiones: {item.impressions || 0} | ack: {item.acknowledged || 0}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">
                      creado por {item.created_by_name || 'system'} - {formatDateTime(item.created_at)} | actualizado por {item.updated_by_name || 'system'} - {formatDateTime(item.updated_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={item.status}
                      onChange={(e) => updateStatus(item.id, e.target.value as AlertStatus)}
                      className={`rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold ${statusColor[item.status]}`}
                    >
                      <option value="draft">draft</option>
                      <option value="active">active</option>
                      <option value="paused">paused</option>
                      <option value="expired">expired</option>
                    </select>
                    {savingId === item.id && <span className="text-xs text-gray-500">...</span>}
                  </div>
                </div>
              </div>
            ))}
            {!filteredItems.length && (
              <div className="px-4 py-8 text-center text-sm text-gray-500">Sin avisos para este filtro.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ScreenAlerts
