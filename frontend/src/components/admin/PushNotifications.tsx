import React, { useEffect, useState } from 'react'
import { ArrowPathIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

type Channel = 'push' | 'email' | 'whatsapp' | 'system'
type Audience = 'all' | 'active' | 'overdue' | 'suspended'

interface NotificationHistoryItem {
  id: string
  title: string
  message: string
  channel: Channel
  audience: Audience
  plan?: string | null
  router_id?: number | null
  target_count: number
  status: string
  sent_at: string
}

interface FormState {
  title: string
  message: string
  channel: Channel
  audience: Audience
  plan: string
  router_id: string
}

const templates: Array<{ label: string; title: string; message: string }> = [
  {
    label: 'Mantenimiento',
    title: 'Mantenimiento programado',
    message: 'Habra una ventana de mantenimiento esta noche entre 01:00 y 02:00.',
  },
  {
    label: 'Cobranza',
    title: 'Recordatorio de pago',
    message: 'Tu factura esta proxima a vencer. Evita corte realizando el pago hoy.',
  },
  {
    label: 'Incidente',
    title: 'Incidencia de red',
    message: 'Estamos atendiendo una incidencia en tu zona. Te notificaremos al restablecer servicio.',
  },
]

const PushNotifications: React.FC = () => {
  const [history, setHistory] = useState<NotificationHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [form, setForm] = useState<FormState>({
    title: '',
    message: '',
    channel: 'push',
    audience: 'all',
    plan: '',
    router_id: '',
  })

  const loadHistory = async () => {
    setLoading(true)
    try {
      const response = await apiClient.get('/admin/notifications/history?limit=100')
      setHistory((response.items || []) as NotificationHistoryItem[])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar el historial'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [])

  const applyTemplate = (template: { title: string; message: string }) => {
    setForm((prev) => ({
      ...prev,
      title: template.title,
      message: template.message,
    }))
  }

  const sendNotification = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.title.trim() || !form.message.trim()) {
      toast.error('Titulo y mensaje son requeridos')
      return
    }
    setSending(true)
    try {
      const payload = {
        title: form.title.trim(),
        message: form.message.trim(),
        channel: form.channel,
        audience: form.audience,
        plan: form.plan.trim() || undefined,
        router_id: form.router_id.trim() ? Number(form.router_id) : undefined,
      }
      const response = await apiClient.post('/admin/notifications/send', payload)
      const sent = response.notification as NotificationHistoryItem
      setHistory((prev) => [sent, ...prev])
      setForm((prev) => ({ ...prev, title: '', message: '' }))
      toast.success('Notificacion enviada')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo enviar la notificacion'
      toast.error(msg)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Notificaciones Push</h2>
          <p className="text-sm text-gray-600">Campanas masivas por canal, audiencia y segmentacion.</p>
        </div>
        <button
          onClick={loadHistory}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <form onSubmit={sendNotification} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold text-gray-900">Nueva campana</h3>
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
              placeholder="Mensaje"
              rows={5}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />

            <div className="grid grid-cols-2 gap-2">
              <select
                value={form.channel}
                onChange={(e) => setForm((prev) => ({ ...prev, channel: e.target.value as Channel }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="push">push</option>
                <option value="email">email</option>
                <option value="whatsapp">whatsapp</option>
                <option value="system">system</option>
              </select>
              <select
                value={form.audience}
                onChange={(e) => setForm((prev) => ({ ...prev, audience: e.target.value as Audience }))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">all</option>
                <option value="active">active</option>
                <option value="overdue">overdue</option>
                <option value="suspended">suspended</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.plan}
                onChange={(e) => setForm((prev) => ({ ...prev, plan: e.target.value }))}
                placeholder="Plan (opcional)"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                value={form.router_id}
                onChange={(e) => setForm((prev) => ({ ...prev, router_id: e.target.value }))}
                placeholder="Router ID (opcional)"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={sending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <PaperAirplaneIcon className="h-4 w-4" />
              {sending ? 'Enviando...' : 'Enviar campana'}
            </button>
          </div>
        </form>

        <div className="xl:col-span-2 rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-semibold text-gray-900">Historial de envios</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Fecha</th>
                  <th className="px-4 py-3 text-left">Titulo</th>
                  <th className="px-4 py-3 text-left">Canal</th>
                  <th className="px-4 py-3 text-left">Audiencia</th>
                  <th className="px-4 py-3 text-right">Destinos</th>
                  <th className="px-4 py-3 text-right">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 text-xs text-gray-500">{entry.sent_at?.replace('T', ' ').slice(0, 16) || '-'}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{entry.title}</p>
                      <p className="line-clamp-1 text-xs text-gray-500">{entry.message}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{entry.channel}</td>
                    <td className="px-4 py-3 text-gray-700">{entry.audience}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{entry.target_count}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                        {entry.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {!history.length && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={6}>
                      Sin notificaciones enviadas.
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

export default PushNotifications
