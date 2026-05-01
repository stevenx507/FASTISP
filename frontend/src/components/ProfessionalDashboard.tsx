import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  UserGroupIcon,
  CurrencyDollarIcon,
  ServerIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import StatsCard from './StatsCard'
import { LineChart, BarChart } from './Chart'
import { apiClient } from '../lib/apiClient'

interface DashboardResponse {
  clients: number
  routers: { ok: number; down: number }
  finance: { paid_today: number; pending: number }
}

interface NocSummaryResponse {
  uptime: string
  active_alerts: number
  tickets_open: number
}

interface RouterUsage {
  router_id: string
  rx_mbps: number
  tx_mbps: number
  cpu?: number
}

interface TicketItem {
  id: number
  subject: string
  status: string
  priority: string
  created_at?: string
}

interface FinanceSummaryResponse {
  summary?: {
    paid_this_month?: number
    pending_this_month?: number
    collection_rate?: number
    mrr?: number
  }
  cashflow?: Array<{
    label: string
    paid: number
    pending: number
  }>
}

interface ActivityItem {
  id: string
  action: string
  time: string
  status: 'success' | 'warning' | 'info'
}

const ProfessionalDashboard: React.FC = () => {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [nocSummary, setNocSummary] = useState<NocSummaryResponse | null>(null)
  const [routers, setRouters] = useState<RouterUsage[]>([])
  const [tickets, setTickets] = useState<TicketItem[]>([])
  const [financeSummary, setFinanceSummary] = useState<FinanceSummaryResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [dashboardRes, nocRes, routersRes, ticketsRes, financeRes] = await Promise.allSettled([
        apiClient.get('/dashboard'),
        apiClient.get('/network/noc-summary'),
        apiClient.get('/admin/routers/usage'),
        apiClient.get('/tickets?limit=8'),
        apiClient.get('/admin/finance/summary'),
      ])

      if (dashboardRes.status === 'fulfilled') {
        setDashboard(dashboardRes.value as DashboardResponse)
      }
      if (nocRes.status === 'fulfilled') {
        setNocSummary(nocRes.value as NocSummaryResponse)
      }
      if (routersRes.status === 'fulfilled') {
        setRouters(((routersRes.value as { items?: RouterUsage[] }).items || []) as RouterUsage[])
      }
      if (ticketsRes.status === 'fulfilled') {
        setTickets((((ticketsRes.value as { items?: TicketItem[] }).items || []) as TicketItem[]).slice(0, 6))
      }
      if (financeRes.status === 'fulfilled') {
        setFinanceSummary(financeRes.value as FinanceSummaryResponse)
      }

      const hasErrors = [dashboardRes, nocRes, routersRes, ticketsRes, financeRes].some(
        (result) => result.status === 'rejected'
      )
      if (hasErrors) {
        toast.error('Algunas metricas del dashboard no se pudieron cargar')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar dashboard'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [load])

  const totalThroughput = useMemo(
    () => routers.reduce((sum, row) => sum + Number(row.rx_mbps || 0) + Number(row.tx_mbps || 0), 0),
    [routers]
  )

  const avgBandwidth = useMemo(() => {
    if (!routers.length) return 0
    return totalThroughput / routers.length
  }, [routers, totalThroughput])

  const uptimeValue = useMemo(() => {
    const raw = nocSummary?.uptime || '0'
    const numeric = Number(String(raw).replace('%', '').trim())
    return Number.isFinite(numeric) ? numeric : 0
  }, [nocSummary?.uptime])

  const lineData = useMemo(() => {
    const fromCashflow = (financeSummary?.cashflow || []).slice(-6).map((row) => ({
      label: row.label.split(' ')[0] || row.label,
      value: Number(row.paid || 0),
    }))
    if (fromCashflow.length) return fromCashflow
    return [{ label: 'Hoy', value: Number(dashboard?.finance?.paid_today || 0) }]
  }, [financeSummary?.cashflow, dashboard?.finance?.paid_today])

  const utilizationData = useMemo(() => {
    if (!routers.length) return [{ label: 'Sin datos', value: 0, color: 'bg-slate-400' }]
    const totals = routers.map((router) => ({
      label: String(router.router_id),
      total: Number(router.rx_mbps || 0) + Number(router.tx_mbps || 0),
    }))
    const maxTotal = Math.max(...totals.map((row) => row.total), 1)
    return totals
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
      .map((row, index) => ({
        label: row.label,
        value: Number(((row.total / maxTotal) * 100).toFixed(1)),
        color:
          index % 4 === 0
            ? 'bg-blue-600'
            : index % 4 === 1
              ? 'bg-emerald-600'
              : index % 4 === 2
                ? 'bg-orange-600'
                : 'bg-violet-600',
      }))
  }, [routers])

  const activityFeed = useMemo<ActivityItem[]>(() => {
    const ticketActivity = tickets.map((ticket) => ({
      id: `ticket-${ticket.id}`,
      action: `Ticket #${ticket.id}: ${ticket.subject}`,
      time: ticket.created_at ? ticket.created_at.replace('T', ' ').slice(0, 16) : 'reciente',
      status: ticket.priority === 'urgent' || ticket.priority === 'high' ? 'warning' as const : 'info' as const,
    }))

    const systemActivity: ActivityItem[] = [
      {
        id: 'routers',
        action: `Routers activos: ${dashboard?.routers?.ok ?? 0}, caidos: ${dashboard?.routers?.down ?? 0}`,
        time: 'actualizado',
        status: (dashboard?.routers?.down || 0) > 0 ? 'warning' : 'success',
      },
      {
        id: 'collection',
        action: `Collection rate: ${(financeSummary?.summary?.collection_rate ?? 0).toFixed(1)}%`,
        time: 'mes en curso',
        status: (financeSummary?.summary?.collection_rate ?? 100) >= 90 ? 'success' : 'warning',
      },
      {
        id: 'alerts',
        action: `Alertas activas NOC: ${nocSummary?.active_alerts ?? 0}`,
        time: 'actualizado',
        status: (nocSummary?.active_alerts || 0) > 0 ? 'warning' : 'success',
      },
    ]
    return [...systemActivity, ...ticketActivity].slice(0, 6)
  }, [tickets, dashboard?.routers?.ok, dashboard?.routers?.down, financeSummary?.summary?.collection_rate, nocSummary?.active_alerts])

  const paidThisMonth = financeSummary?.summary?.paid_this_month ?? dashboard?.finance?.paid_today ?? 0
  const mrr = financeSummary?.summary?.mrr ?? paidThisMonth

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
          <StatsCard
            title="Clientes Activos"
            value={(dashboard?.clients ?? 0).toLocaleString()}
            trend={8}
            color="coral"
            icon={<UserGroupIcon />}
            subtitle={`${nocSummary?.tickets_open ?? 0} tickets abiertos`}
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <StatsCard
            title="Ingresos del Mes"
            value={`$${paidThisMonth.toLocaleString()}`}
            trend={6}
            color="emerald"
            icon={<CurrencyDollarIcon />}
            subtitle={`MRR estimado: $${mrr.toLocaleString()}`}
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
          <StatsCard
            title="Routers Activos"
            value={dashboard?.routers?.ok ?? 0}
            trend={0}
            color="blue"
            icon={<ServerIcon />}
            subtitle={`${dashboard?.routers?.down ?? 0} caidos`}
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
          <StatsCard
            title="Uptime"
            value={`${uptimeValue.toFixed(2)}%`}
            color="purple"
            icon={<SparklesIcon />}
            subtitle={`${nocSummary?.active_alerts ?? 0} alertas activas`}
          />
        </motion.div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LineChart data={lineData} title="Cobranza (ultimos meses)" height={250} />
        <BarChart data={utilizationData} title="Utilizacion de Routers (top)" showValues={true} />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Ancho de Banda Promedio</p>
          <p className="mt-3 text-3xl font-black text-slate-800">{avgBandwidth.toFixed(1)} <span className="text-lg font-bold text-slate-500">Mbps</span></p>
          <div className="mt-4 h-1 w-full bg-gray-50 rounded-full overflow-hidden">
             <div className="h-full bg-coral-400" style={{ width: '65%' }} />
          </div>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Throughput Total</p>
          <p className="mt-3 text-3xl font-black text-slate-800">{totalThroughput.toFixed(1)} <span className="text-lg font-bold text-slate-500">Mbps</span></p>
          <div className="mt-4 h-1 w-full bg-gray-50 rounded-full overflow-hidden">
             <div className="h-full bg-blue-400" style={{ width: '45%' }} />
          </div>
        </div>
        <div className="rounded-2xl border border-coral-100 bg-white p-6 shadow-sm ring-1 ring-coral-50">
          <p className="text-xs font-bold uppercase tracking-wider text-coral-500">Collection Rate</p>
          <p className="mt-3 text-3xl font-black text-slate-800">
            {(financeSummary?.summary?.collection_rate ?? 0).toFixed(1)}<span className="text-lg font-bold text-slate-500">%</span>
          </p>
          <div className="mt-4 h-1 w-full bg-gray-50 rounded-full overflow-hidden">
             <div className="h-full bg-coral-500" style={{ width: `${financeSummary?.summary?.collection_rate ?? 0}%` }} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-black text-slate-800">Actividad Reciente</h3>
            <p className="text-sm text-slate-500">Monitoreo en tiempo real de eventos del sistema</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-gray-50 disabled:opacity-60 transition-all"
          >
            {loading ? 'Actualizando...' : 'Refrescar'}
          </button>
        </div>
        <div className="space-y-1">
          {activityFeed.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-4 border-b border-gray-50 last:border-b-0 hover:bg-gray-50/50 px-2 rounded-xl transition-colors">
              <div className="flex items-center gap-4">
                <div className={`h-2.5 w-2.5 rounded-full ${
                  item.status === 'success' ? 'bg-emerald-400' : item.status === 'warning' ? 'bg-coral-400' : 'bg-blue-400'
                }`} />
                <div>
                  <p className="text-sm font-bold text-slate-700">{item.action}</p>
                  <p className="text-xs font-medium text-slate-500">{item.time}</p>
                </div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider ${
                  item.status === 'success'
                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                    : item.status === 'warning'
                      ? 'bg-coral-50 text-coral-600 border border-coral-100'
                      : 'bg-blue-50 text-blue-600 border border-blue-100'
                }`}
              >
                {item.status}
              </span>
            </div>
          ))}
          {!activityFeed.length && <p className="text-sm text-slate-500 text-center py-10">Sin actividad reciente.</p>}
        </div>
      </div>
    </motion.div>
  )
}

export default ProfessionalDashboard
