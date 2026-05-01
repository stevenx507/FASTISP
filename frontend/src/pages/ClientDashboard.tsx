import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { WifiIcon, SignalIcon, MapIcon, BoltIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '../store/authStore'
import AppLayout from '../components/AppLayout'
import UsageDetails from '../components/UsageDetails'
import SpeedTestWidget from '../components/SpeedTestWidget'
import StatsCard from '../components/StatsCard'
import PushOptInCard from '../components/PushOptInCard'
import { apiClient } from '../lib/apiClient'

interface DashboardStatsResponse {
  currentSpeed?: string
  ping?: string
  monthlyUsage?: string
  nextBillAmount?: string
  nextBillDue?: string
  deviceCount?: number
}

interface InvoiceItem {
  id: number
  amount?: number
  total_amount?: number
  due_date?: string
  status?: string
  currency?: string
}

interface PortalOverview {
  plan?: string | null
  router?: string | null
  connection_type?: string | null
  ip_address?: string | null
  status?: string | null
  invoices?: InvoiceItem[]
}

const parseSpeed = (raw?: string) => {
  if (!raw || !raw.trim()) {
    return { download: 'N/A', upload: 'N/A' }
  }
  const parts = raw.split('/').map((part) => part.trim())
  if (parts.length >= 2) {
    return { download: parts[0], upload: parts[1] }
  }
  return { download: raw.trim(), upload: 'N/A' }
}

const statusPillClass = (status: string) => {
  const normalized = status.toLowerCase()
  if (normalized === 'active' || normalized === 'paid' || normalized === 'ok') {
    return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
  }
  if (normalized === 'pending' || normalized === 'in_progress') {
    return 'bg-amber-50 text-amber-700 border border-amber-200'
  }
  if (normalized === 'overdue' || normalized === 'past_due' || normalized === 'suspended') {
    return 'bg-rose-50 text-rose-700 border border-rose-200'
  }
  return 'bg-gray-100 text-slate-600 border border-gray-200'
}

const ClientDashboard: React.FC = () => {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStatsResponse | null>(null)
  const [portal, setPortal] = useState<PortalOverview | null>(null)
  const [loading, setLoading] = useState(false)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    try {
      const [statsRes, portalRes] = await Promise.allSettled([
        apiClient.get('/dashboard/stats') as Promise<DashboardStatsResponse>,
        apiClient.get('/client/portal') as Promise<PortalOverview>,
      ])

      if (statsRes.status === 'fulfilled') {
        setStats(statsRes.value)
      }

      if (portalRes.status === 'fulfilled') {
        setPortal(portalRes.value)
      }

      if (statsRes.status === 'rejected' || portalRes.status === 'rejected') {
        toast.error('No se pudo cargar toda la informacion del dashboard.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar dashboard'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  const connectionSpeed = useMemo(() => parseSpeed(stats?.currentSpeed), [stats?.currentSpeed])

  const nextInvoice = useMemo(() => {
    const items = (portal?.invoices || []).filter((invoice) => invoice.status !== 'paid')
    if (!items.length) return null
    return items
      .slice()
      .sort((a, b) => {
        const aTime = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER
        const bTime = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER
        return aTime - bTime
      })[0]
  }, [portal?.invoices])

  const serviceItems = [
    { label: 'Plan', value: portal?.plan || 'No asignado' },
    { label: 'Router', value: portal?.router || 'No asignado' },
    { label: 'Conexion', value: portal?.connection_type || 'N/A' },
    { label: 'IP', value: portal?.ip_address || 'N/A' },
  ]

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-800">Hola, {user?.name || 'Cliente'}</h1>
            <p className="mt-2 text-sm font-medium text-slate-500">Panel de control de tu servicio de internet.</p>
          </div>
          <button
            onClick={loadDashboard}
            disabled={loading}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-gray-50 hover:shadow-sm disabled:opacity-60 transition-all"
          >
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Velocidad descarga"
            value={connectionSpeed.download}
            color="blue"
            icon={<WifiIcon />}
            subtitle="Enlace actual"
          />
          <StatsCard
            title="Velocidad carga"
            value={connectionSpeed.upload}
            color="green"
            icon={<BoltIcon />}
            subtitle="Enlace actual"
          />
          <StatsCard
            title="Ping"
            value={stats?.ping || 'N/A'}
            color="purple"
            icon={<MapIcon />}
            subtitle="Latencia"
          />
          <StatsCard
            title="Dispositivos"
            value={typeof stats?.deviceCount === 'number' ? String(stats.deviceCount) : 'N/A'}
            color="emerald"
            icon={<SignalIcon />}
            subtitle={`Uso mensual: ${stats?.monthlyUsage || 'N/A'}`}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1 rounded-2xl bg-white p-6 shadow-sm border border-gray-100 flex flex-col items-center justify-center">
            <SpeedTestWidget />
          </div>
          <div className="lg:col-span-2 rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
            <h2 className="text-xl font-black text-slate-800">Estado del servicio</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {serviceItems.map((item) => (
                <div key={item.label} className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 hover:bg-gray-50 transition-colors">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400">{item.label}</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{item.value}</p>
                </div>
              ))}
            </div>

            {nextInvoice ? (
              <div className="mt-4 rounded-xl border border-coral-100 bg-gradient-to-r from-coral-50 to-orange-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-800">Próxima factura #{nextInvoice.id}</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusPillClass(nextInvoice.status || 'pending')}`}>
                    {nextInvoice.status || 'pending'}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-600">
                  Monto: {(nextInvoice.total_amount ?? nextInvoice.amount ?? 0).toFixed(2)} {nextInvoice.currency || 'USD'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Vence: {nextInvoice.due_date || stats?.nextBillDue || 'N/A'}</p>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                No tienes facturas pendientes.
              </div>
            )}
          </div>
        </div>

        <UsageDetails />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <motion.div
            whileHover={{ y: -4 }}
            className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-cyan-50 p-6 transition-all hover:shadow-md"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 rounded-xl bg-blue-100">
                <WifiIcon className="h-5 w-5 text-blue-600" />
              </div>
              <h3 className="text-lg font-black text-slate-800">Soporte técnico</h3>
            </div>
            <p className="text-sm text-slate-500 leading-relaxed">Abre tickets, ejecuta diagnóstico y conversa con soporte.</p>
            <button
              onClick={() => navigate('/dashboard/support')}
              className="mt-4 w-full rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-600 transition-colors shadow-sm shadow-blue-500/20"
            >
              Ir a soporte
            </button>
          </motion.div>

          <motion.div
            whileHover={{ y: -4 }}
            className="rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50 to-violet-50 p-6 transition-all hover:shadow-md"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 rounded-xl bg-purple-100">
                <SignalIcon className="h-5 w-5 text-purple-600" />
              </div>
              <h3 className="text-lg font-black text-slate-800">Analítica de consumo</h3>
            </div>
            <p className="text-sm text-slate-500 leading-relaxed">Consulta gráficos por rango de fechas y comportamiento diario.</p>
            <button
              onClick={() => navigate('/dashboard/usage')}
              className="mt-4 w-full rounded-xl bg-purple-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-purple-600 transition-colors shadow-sm shadow-purple-500/20"
            >
              Ver uso detallado
            </button>
          </motion.div>

          <motion.div
            whileHover={{ y: -4 }}
            className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-teal-50 p-6 transition-all hover:shadow-md"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 rounded-xl bg-emerald-100">
                <BoltIcon className="h-5 w-5 text-emerald-600" />
              </div>
              <h3 className="text-lg font-black text-slate-800">Pagos y facturas</h3>
            </div>
            <p className="text-sm text-slate-500 leading-relaxed">Revisa estado de tus comprobantes y realiza pagos online.</p>
            <button
              onClick={() => navigate('/dashboard/billing')}
              className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 transition-colors shadow-sm shadow-emerald-500/20"
            >
              Abrir facturación
            </button>
          </motion.div>

          <PushOptInCard className="md:col-span-2 lg:col-span-3" />
        </div>
      </motion.div>
    </AppLayout>
  )
}

export default ClientDashboard
