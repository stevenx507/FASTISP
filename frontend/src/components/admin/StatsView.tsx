import React, { useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

interface DashboardPayload {
  clients: number
  routers: { ok: number; down: number }
  tickets: { today: number; pending: number; month: number }
  finance: { paid_today: number; pending: number }
}

interface NocPayload {
  uptime: string
  active_alerts: number
  tickets_open: number
}

interface AlertItem {
  id: string
  severity: string
  message: string
}

interface TicketItem {
  id: number
  subject: string
  status: string
  priority: string
  assigned_to?: string
  created_at?: string
}

interface ClientItem {
  id: number
  plan?: string | null
}

const severityPill: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  info: 'bg-blue-100 text-blue-700',
}

const StatsView: React.FC = () => {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null)
  const [noc, setNoc] = useState<NocPayload | null>(null)
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [tickets, setTickets] = useState<TicketItem[]>([])
  const [clients, setClients] = useState<ClientItem[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [dashboardRes, nocRes, alertsRes, ticketsRes, clientsRes] = await Promise.allSettled([
        apiClient.get('/dashboard'),
        apiClient.get('/network/noc-summary'),
        apiClient.get('/network/alerts'),
        apiClient.get('/tickets?limit=40'),
        apiClient.get('/admin/clients'),
      ])

      if (dashboardRes.status === 'fulfilled') {
        setDashboard(dashboardRes.value as DashboardPayload)
      }
      if (nocRes.status === 'fulfilled') {
        setNoc(nocRes.value as NocPayload)
      }
      if (alertsRes.status === 'fulfilled') {
        setAlerts(((alertsRes.value as { alerts?: AlertItem[] }).alerts || []) as AlertItem[])
      }
      if (ticketsRes.status === 'fulfilled') {
        setTickets((((ticketsRes.value as { items?: TicketItem[] }).items || []) as TicketItem[]).slice(0, 20))
      }
      if (clientsRes.status === 'fulfilled') {
        setClients((((clientsRes.value as { items?: ClientItem[] }).items || []) as ClientItem[]).slice(0, 500))
      }

      const hasError = [dashboardRes, nocRes, alertsRes, ticketsRes, clientsRes].some(
        (result) => result.status === 'rejected'
      )
      if (hasError) {
        toast.error('Algunas metricas no se pudieron cargar')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar estadisticas'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = { critical: 0, warning: 0, info: 0 }
    alerts.forEach((alert) => {
      const key = (alert.severity || 'info').toLowerCase()
      if (key in counts) counts[key] += 1
      else counts.info += 1
    })
    return counts
  }, [alerts])

  const priorityCounts = useMemo(() => {
    const counts: Record<string, number> = { low: 0, medium: 0, high: 0, urgent: 0 }
    tickets.forEach((ticket) => {
      const key = (ticket.priority || 'medium').toLowerCase()
      if (key in counts) counts[key] += 1
      else counts.medium += 1
    })
    return counts
  }, [tickets])

  const topPlans = useMemo(() => {
    const counts: Record<string, number> = {}
    clients.forEach((client) => {
      const plan = client.plan || 'Sin plan'
      counts[plan] = (counts[plan] || 0) + 1
    })
    return Object.entries(counts)
      .map(([plan, total]) => ({ plan, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
  }, [clients])

  const openTickets = useMemo(
    () => tickets.filter((ticket) => ['open', 'in_progress'].includes(ticket.status)).length,
    [tickets]
  )

  const maxPlan = useMemo(() => {
    if (!topPlans.length) return 1
    return Math.max(...topPlans.map((item) => item.total))
  }, [topPlans])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Estadisticas</h2>
          <p className="text-sm text-gray-600">KPIs de clientes, red, tickets y facturacion.</p>
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs font-semibold uppercase text-blue-700">Clientes</p>
          <p className="mt-2 text-2xl font-bold text-blue-900">{dashboard?.clients ?? 0}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase text-emerald-700">Routers OK</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">{dashboard?.routers?.ok ?? 0}</p>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-4">
          <p className="text-xs font-semibold uppercase text-red-700">Routers Down</p>
          <p className="mt-2 text-2xl font-bold text-red-900">{dashboard?.routers?.down ?? 0}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase text-amber-700">Tickets Abiertos</p>
          <p className="mt-2 text-2xl font-bold text-amber-900">{noc?.tickets_open ?? openTickets}</p>
        </div>
        <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
          <p className="text-xs font-semibold uppercase text-violet-700">Alertas Activas</p>
          <p className="mt-2 text-2xl font-bold text-violet-900">{noc?.active_alerts ?? alerts.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase text-slate-700">Uptime</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{noc?.uptime || '-'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-gray-900">Alertas por severidad</h3>
          <div className="mt-4 space-y-3">
            {Object.entries(severityCounts).map(([severity, count]) => (
              <div key={severity} className="flex items-center justify-between text-sm">
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${severityPill[severity] || severityPill.info}`}>
                  {severity}
                </span>
                <span className="font-semibold text-gray-900">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-gray-900">Tickets por prioridad</h3>
          <div className="mt-4 space-y-3">
            {Object.entries(priorityCounts).map(([priority, count]) => (
              <div key={priority}>
                <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                  <span>{priority}</span>
                  <span>{count}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.min(count * 12, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-gray-900">Ingreso de Hoy</h3>
          <p className="mt-3 text-3xl font-bold text-emerald-700">${dashboard?.finance?.paid_today ?? 0}</p>
          <p className="mt-2 text-sm text-gray-600">Pendiente: ${dashboard?.finance?.pending ?? 0}</p>
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-gray-600">
            Tickets hoy: {dashboard?.tickets?.today ?? 0} | Pendientes: {dashboard?.tickets?.pending ?? 0}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm xl:col-span-1">
          <h3 className="font-semibold text-gray-900">Clientes por plan</h3>
          <div className="mt-4 space-y-3">
            {topPlans.map((entry) => (
              <div key={entry.plan}>
                <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                  <span>{entry.plan}</span>
                  <span>{entry.total}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full bg-emerald-500"
                    style={{ width: `${(entry.total / maxPlan) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {!topPlans.length && <p className="text-sm text-gray-500">Sin datos de planes.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm xl:col-span-2">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-semibold text-gray-900">Tickets recientes</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">Asunto</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Prioridad</th>
                  <th className="px-4 py-3 text-left">Asignado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">#{ticket.id}</td>
                    <td className="px-4 py-3 text-gray-900">{ticket.subject}</td>
                    <td className="px-4 py-3 text-gray-700">{ticket.status}</td>
                    <td className="px-4 py-3 text-gray-700">{ticket.priority}</td>
                    <td className="px-4 py-3 text-gray-700">{ticket.assigned_to || '-'}</td>
                  </tr>
                ))}
                {!tickets.length && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={5}>
                      Sin tickets recientes.
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

export default StatsView
