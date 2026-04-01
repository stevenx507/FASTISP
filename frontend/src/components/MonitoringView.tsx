import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart } from './Chart'
import { apiClient } from '../lib/apiClient'
import toast from 'react-hot-toast'

type RouterUsage = {
  router_id: string
  rx_mbps: number
  tx_mbps: number
  cpu?: number
  mem?: number
}

type NetworkAlert = {
  id: string
  severity: string
  message: string
  target?: string
  scope?: string
}

const MonitoringView: React.FC = () => {
  const [routers, setRouters] = useState<RouterUsage[]>([])
  const [alerts, setAlerts] = useState<NetworkAlert[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [usageResp, alertsResp] = await Promise.all([
          apiClient.get('/admin/routers/usage') as Promise<{ items: RouterUsage[] }>,
          apiClient.get('/network/alerts') as Promise<{ alerts: NetworkAlert[] }>,
        ])
        setRouters(usageResp.items || [])
        setAlerts(alertsResp.alerts || [])
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudieron cargar metricas'
        setError(msg)
        toast.error(msg)
      } finally {
        setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [])

  const avgCpu = useMemo(() => {
    const values = routers.map((r) => r.cpu).filter((v) => v != null) as number[]
    if (!values.length) return 0
    return values.reduce((a, b) => a + b, 0) / values.length
  }, [routers])

  const avgMem = useMemo(() => {
    const values = routers.map((r) => r.mem).filter((v) => v != null) as number[]
    if (!values.length) return 0
    return values.reduce((a, b) => a + b, 0) / values.length
  }, [routers])

  const totalRx = useMemo(() => routers.reduce((sum, row) => sum + row.rx_mbps, 0), [routers])
  const totalTx = useMemo(() => routers.reduce((sum, row) => sum + row.tx_mbps, 0), [routers])

  const cpuData = routers.map((router) => ({
    label: router.router_id,
    value: router.cpu || 0,
    color: 'bg-cyan-500',
  }))
  const bwData = routers.map((router) => ({
    label: router.router_id,
    value: router.rx_mbps + router.tx_mbps,
    color: 'bg-emerald-500',
  }))

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'CPU Promedio', value: avgCpu, unit: '%', threshold: 70 },
          { label: 'Memoria Prom.', value: avgMem, unit: '%', threshold: 80 },
          { label: 'Throughput RX', value: totalRx, unit: 'Mbps', threshold: 800 },
          { label: 'Throughput TX', value: totalTx, unit: 'Mbps', threshold: 800 },
          { label: 'Routers', value: routers.length, unit: '', threshold: 9999 },
          { label: 'Refresco', value: 15, unit: 's', threshold: 9999 },
        ].map((metric, index) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
            className="rounded-xl border border-white/10 bg-slate-900/70 p-4 shadow"
          >
            <p className="mb-2 text-xs font-medium text-slate-300">{metric.label}</p>
            <div className="flex items-baseline gap-1">
              <p className="text-2xl font-bold text-white">{metric.value.toFixed(1)}</p>
              <p className="text-xs text-slate-400">{metric.unit}</p>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-1.5 rounded-full bg-cyan-500"
                animate={{ width: `${Math.min((metric.value / metric.threshold) * 100, 100)}%` }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {loading && <p className="text-sm text-slate-300">Cargando metricas...</p>}
      {error && <p className="text-sm text-amber-300">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BarChart data={cpuData} title="CPU por router" showValues={true} />
        <BarChart data={bwData} title="Throughput (rx+tx) por router" showValues={true} />
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-900/70 p-6 shadow">
        <h3 className="mb-3 text-lg font-semibold text-white">Alertas</h3>
        <div className="space-y-2">
          {alerts.slice(0, 6).map((alert) => (
            <div key={alert.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-slate-100">{alert.message}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    alert.severity === 'critical'
                      ? 'bg-red-500/20 text-red-300'
                      : alert.severity === 'warning'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-blue-500/20 text-blue-300'
                  }`}
                >
                  {alert.severity}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {alert.scope || 'network'} {alert.target ? `| ${alert.target}` : ''}
              </p>
            </div>
          ))}
          {!alerts.length && <p className="text-sm text-slate-300">Sin alertas activas.</p>}
        </div>
      </div>
    </motion.div>
  )
}

export default MonitoringView
