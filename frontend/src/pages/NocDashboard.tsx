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
    <p className="text-sm text-gray-600">{label}</p>
    <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
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
          <h1 className="text-3xl font-bold text-gray-900">NOC Dashboard</h1>
          <p className="text-gray-600">Uptime, cortes y alertas en un solo panel.</p>
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
        <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Grafana NOC</h2>
          </div>
          <iframe
            title="Grafana"
            src={`${config.GRAFANA_URL}?kiosk&refresh=30s`}
            className="w-full"
            style={{ minHeight: '650px', border: 0 }}
          />
        </div>
      )}

      <div className="bg-white rounded-xl shadow border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Alertas recientes</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {(alerts || []).slice(0, 10).map((a, i) => (
            <div key={i} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">{a.message || a.title || 'Alerta'}</p>
                <p className="text-sm text-gray-600">{a.severity?.toUpperCase?.() || 'info'}</p>
              </div>
              <span className={`px-2 py-1 text-xs rounded-full ${
                a.severity === 'critical' ? 'bg-red-100 text-red-700' :
                a.severity === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                'bg-blue-100 text-blue-700'
              }`}>
                {a.severity || 'info'}
              </span>
            </div>
          ))}
          {!alerts?.length && <div className="p-4 text-sm text-gray-600">Sin alertas activas.</div>}
        </div>
      </div>
    </div>
  )
}

export default NocDashboard
