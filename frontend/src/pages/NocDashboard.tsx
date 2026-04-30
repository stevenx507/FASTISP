import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  SignalIcon, 
  ExclamationTriangleIcon, 
  ServerIcon, 
  UsersIcon, 
  CpuChipIcon, 
  ArrowPathIcon,
  GlobeAltIcon
} from '@heroicons/react/24/outline'
import { apiClient } from '../lib/apiClient'
import { config } from '../lib/config'
import { BarChart, LineChart } from '../components/Chart'
import NetworkTopology from '../components/admin/NetworkTopology'

interface NocSummary {
  uptime: string
  routers: { ok: number; down: number }
  suspended_clients: number
  active_alerts: number
  tickets_open: number
  total_bw_mbps?: number
  avg_cpu_pct?: number
}

const PremiumStatCard: React.FC<{ 
  label: string; 
  value: string | number; 
  icon: React.ElementType; 
  trend?: string;
  colorClass: string;
}> = ({ label, value, icon: Icon, trend, colorClass }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={{ scale: 1.02 }}
    className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40 p-6 shadow-2xl backdrop-blur-xl"
  >
    <div className={`absolute -right-4 -top-4 h-24 w-24 rounded-full opacity-10 blur-3xl ${colorClass}`} />
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <h3 className="mt-2 text-3xl font-black text-white">{value}</h3>
        {trend && (
          <p className={`mt-2 text-xs font-semibold ${trend.startsWith('+') ? 'text-emerald-400' : 'text-rose-400'}`}>
            {trend} <span className="text-slate-500 font-normal ml-1">vs últ. 24h</span>
          </p>
        )}
      </div>
      <div className={`rounded-xl p-3 shadow-lg ${colorClass} bg-opacity-20`}>
        <Icon className={`h-6 w-6 ${colorClass.replace('bg-', 'text-')}`} />
      </div>
    </div>
  </motion.div>
)

const NocDashboard: React.FC = () => {
  const [summary, setSummary] = useState<NocSummary | null>(null)
  const [alerts, setAlerts] = useState<any[]>([])
  const [trafficData, setTrafficData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'traffic' | 'topology'>('traffic')

  const loadData = async () => {
    try {
      const [s, a, t] = await Promise.all([
        apiClient.get('/network/noc-summary'),
        apiClient.get('/network/alerts'),
        apiClient.get('/network/analytics/traffic?range=-24h')
      ])
      setSummary(s)
      setAlerts(a.alerts || [])
      
      // Transformar datos de InfluxDB para el gráfico
      if (t.metrics) {
        const formatted = t.metrics.map((m: any) => ({
          label: new Date(m._time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          value: Math.round((m.download_rate || 0) / 1000000), // Mbps
          color: 'bg-cyan-500'
        }))
        setTrafficData(formatted)
      }
    } catch (err) {
      console.error('[NOC] error', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    const id = setInterval(loadData, 30000)
    return () => clearInterval(id)
  }, [])



  return (
    <div className="min-h-screen space-y-8 pb-12">
      {/* Header Section */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-white">
            Network Operations <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600">Center</span>
          </h1>
          <p className="mt-2 text-slate-400 font-medium">Monitoreo crítico de infraestructura ISPMAX v2.0</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button 
            onClick={() => window.location.href = '/admin/gis'}
            className="flex items-center gap-2 rounded-xl bg-blue-600/20 px-4 py-2 text-sm font-bold text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 transition-all"
          >
            <GlobeAltIcon className="h-4 w-4" />
            Infraestructura GIS
          </button>
          <button 
            onClick={() => { setLoading(true); loadData(); }}
            className="flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-sm font-bold text-white border border-white/10 hover:bg-white/10 transition-all"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refrescar Ahora
          </button>
        </div>

      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <PremiumStatCard 
          label="Uptime Global" 
          value={summary?.uptime || '99.9%'} 
          icon={GlobeAltIcon} 
          trend="+0.02%" 
          colorClass="bg-cyan-500" 
        />
        <PremiumStatCard 
          label="Nodos Activos" 
          value={`${summary?.routers.ok || 0}/${(summary?.routers.ok || 0) + (summary?.routers.down || 0)}`} 
          icon={ServerIcon} 
          colorClass="bg-blue-500" 
        />
        <PremiumStatCard 
          label="Tráfico Total" 
          value={`${summary?.total_bw_mbps || 842} Mbps`} 
          icon={SignalIcon} 
          trend="+12%" 
          colorClass="bg-emerald-500" 
        />
        <PremiumStatCard 
          label="Alertas Críticas" 
          value={summary?.active_alerts || 0} 
          icon={ExclamationTriangleIcon} 
          colorClass="bg-rose-500" 
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Main Monitoring Area */}
        <div className="lg:col-span-2 space-y-8">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-3xl border border-white/10 bg-slate-900/40 p-8 shadow-2xl backdrop-blur-xl min-h-[450px]"
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold text-white flex items-center gap-3">
                {activeTab === 'traffic' ? (
                  <>
                    <SignalIcon className="h-5 w-5 text-cyan-400" />
                    Flujo de Tráfico Agregado (24h)
                  </>
                ) : (
                  <>
                    <ServerIcon className="h-5 w-5 text-amber-400" />
                    Topología Jerárquica de Red
                  </>
                )}
              </h2>
              <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                <button 
                  onClick={() => setActiveTab('traffic')}
                  className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${activeTab === 'traffic' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-slate-400 hover:text-white'}`}
                >
                  Tráfico
                </button>
                <button 
                  onClick={() => setActiveTab('topology')}
                  className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${activeTab === 'topology' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'text-slate-400 hover:text-white'}`}
                >
                  Topología
                </button>
              </div>
            </div>
            
            <AnimatePresence mode="wait">
              {activeTab === 'traffic' ? (
                <motion.div 
                  key="traffic"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="h-72"
                >
                  {trafficData.length > 0 ? (
                    <BarChart data={trafficData} title="" showValues={false} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-500 italic">
                      No hay datos de tráfico disponibles para este periodo.
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div 
                  key="topology"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  <NetworkTopology />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <PremiumStatCard 
              label="Tickets de Soporte" 
              value={summary?.tickets_open || 0} 
              icon={UsersIcon} 
              colorClass="bg-indigo-500" 
            />
            <PremiumStatCard 
              label="Recursos CPU Avg" 
              value={summary?.avg_cpu_pct != null ? `${summary.avg_cpu_pct}%` : '--'} 
              icon={CpuChipIcon} 
              colorClass="bg-amber-500" 
            />
          </div>
        </div>

        {/* Alerts Sidebar */}
        <div className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6 shadow-2xl backdrop-blur-xl h-full">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Eventos Live</h2>
              <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
            </div>
            
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10">
              <AnimatePresence>
                {alerts.length > 0 ? (
                  alerts.map((a, i) => (
                    <motion.div
                      key={a.id || i}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`rounded-2xl border p-4 transition-all hover:bg-white/5 ${
                        a.severity === 'critical' ? 'border-rose-500/30 bg-rose-500/5' : 
                        a.severity === 'warning' ? 'border-amber-500/30 bg-amber-500/5' : 
                        'border-white/10 bg-white/5'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={`text-xs font-black uppercase tracking-widest ${
                            a.severity === 'critical' ? 'text-rose-400' : 
                            a.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
                          }`}>
                            {a.severity || 'INFO'}
                          </p>
                          <p className="mt-1 text-sm font-bold text-white leading-tight">{a.message}</p>
                          <p className="mt-2 text-[10px] font-medium text-slate-500 uppercase">
                            {a.target || 'GLOBAL'} • {a.since || 'Justo ahora'}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="py-12 text-center text-slate-500 italic">
                    Sin eventos críticos detectados.
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Grafana Integration Fallback */}
      {config.GRAFANA_URL && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-3xl border border-white/10 bg-slate-900/40 overflow-hidden shadow-2xl backdrop-blur-xl"
        >
          <div className="p-6 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center gap-3">
              <GlobeAltIcon className="h-5 w-5 text-cyan-400" />
              Sonda Externa (Grafana)
            </h2>
          </div>
          <iframe
            title="Grafana"
            src={`${config.GRAFANA_URL}?kiosk&refresh=30s&theme=dark`}
            className="w-full"
            style={{ minHeight: '650px', border: 0 }}
          />
        </motion.div>
      )}
    </div>
  )
}

export default NocDashboard
