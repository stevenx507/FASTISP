import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { apiClient } from '../lib/apiClient'
import { config } from '../lib/config'

interface NocSummary {
  uptime: string
  routers: { ok: number; down: number }
  suspended_clients: number
  active_alerts: number
  tickets_open: number
}

const StatCard: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color = 'blue' }) => (
  <motion.div
    whileHover={{ y: -4 }}
    className={`rounded-xl p-4 shadow border border-${color}-100 bg-${color}-50/60`}
  >
    <p className="text-sm text-slate-400">{label}</p>
    <p className="text-2xl font-bold text-white mt-1">{value}</p>
  </motion.div>
)

const NocDashboard: React.FC = () => {
  const [summary, setSummary] = useState<NocSummary | null>(null)
  const [alerts, setAlerts] = useState<any[]>([])

  useEffect(() => {
    const load = async () => {
      try {
        const s = await apiClient.get('/network/noc-summary')
        setSummary(s)
        const a = await apiClient.get('/network/alerts')
        setAlerts(a.alerts || [])
      } catch (err) {
        console.error('[NOC] error', err)
      }
    }
    load()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">NOC Dashboard</h1>
          <p className="text-slate-400">Uptime, cortes y alertas en un solo panel.</p>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Uptime" value={summary.uptime} color="green" />
          <StatCard label="Routers OK" value={String(summary.routers.ok)} color="blue" />
          <StatCard label="Routers Caídos" value={String(summary.routers.down)} color="red" />
          <StatCard label="Clientes Suspendidos" value={String(summary.suspended_clients)} color="orange" />
          <StatCard label="Alertas Activas" value={String(summary.active_alerts)} color="red" />
          <StatCard label="Tickets Abiertos" value={String(summary.tickets_open)} color="purple" />
        </div>
      )}

      {config.GRAFANA_URL && (
        <div className="bg-white/5 backdrop-blur-md rounded-xl shadow border border-white/10 overflow-hidden">
          <div className="p-4 border-b border-white/10">
            <h2 className="text-lg font-semibold text-white">Grafana NOC</h2>
          </div>
          <iframe
            title="Grafana"
            src={`${config.GRAFANA_URL}?kiosk&refresh=30s`}
            className="w-full"
            style={{ minHeight: '650px', border: 0 }}
          />
        </div>
      )}

      <div className="bg-white/5 backdrop-blur-md rounded-xl shadow border border-white/10">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Alertas recientes</h2>
        </div>
        <div className="divide-y divide-white/5">
          {(alerts || []).slice(0, 10).map((a, i) => (
            <div key={i} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-white">{a.message || a.title || 'Alerta'}</p>
                <p className="text-sm text-slate-400">{a.severity?.toUpperCase?.() || 'info'}</p>
              </div>
              <span className={`px-2 py-1 text-xs rounded-full ${
                a.severity === 'critical' ? 'bg-rose-500/20 text-rose-400' :
                a.severity === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                'bg-blue-500/20 text-blue-300'
              }`}>
                {a.severity || 'info'}
              </span>
            </div>
          ))}
          {!alerts?.length && <div className="p-4 text-sm text-slate-400">Sin alertas activas.</div>}
        </div>
      </div>
    </div>
  )
}

export default NocDashboard
