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
    return 'bg-green-100 text-green-800'
  }
  if (normalized === 'pending' || normalized === 'in_progress') {
    return 'bg-yellow-100 text-yellow-800'
  }
  if (normalized === 'overdue' || normalized === 'past_due' || normalized === 'suspended') {
    return 'bg-red-100 text-red-800'
  }
  return 'bg-slate-100 text-slate-700'
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
            <h1 className="text-3xl font-bold text-white">Hola, {user?.name || 'Cliente'}</h1>
            <p className="mt-2 text-sm text-gray-300">Panel de control de tu servicio de internet.</p>
          </div>
          <button
            onClick={loadDashboard}
            disabled={loading}
            className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-60"
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
          <div className="lg:col-span-1">
            <SpeedTestWidget />
          </div>
          <div className="lg:col-span-2 rounded-lg bg-white p-6 shadow">
            <h2 className="text-xl font-bold text-gray-900">Estado del servicio</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {serviceItems.map((item) => (
                <div key={item.label} className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">{item.label}</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{item.value}</p>
                </div>
              ))}
            </div>

            {nextInvoice ? (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">Proxima factura #{nextInvoice.id}</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusPillClass(nextInvoice.status || 'pending')}`}>
                    {nextInvoice.status || 'pending'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-700">
                  Monto: {(nextInvoice.total_amount ?? nextInvoice.amount ?? 0).toFixed(2)} {nextInvoice.currency || 'USD'}
                </p>
                <p className="text-xs text-gray-600">Vence: {nextInvoice.due_date || stats?.nextBillDue || 'N/A'}</p>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                No tienes facturas pendientes.
              </div>
            )}
          </div>
        </div>

        <UsageDetails />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 p-6">
            <h3 className="text-lg font-bold text-blue-900">Soporte tecnico</h3>
            <p className="mt-2 text-sm text-blue-800">Abre tickets, ejecuta diagnostico y conversa con soporte.</p>
            <button
              onClick={() => navigate('/dashboard/support')}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Ir a soporte
            </button>
          </div>

          <div className="rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-violet-100 p-6">
            <h3 className="text-lg font-bold text-violet-900">Analitica de consumo</h3>
            <p className="mt-2 text-sm text-violet-800">Consulta graficos por rango de fechas y comportamiento diario.</p>
            <button
              onClick={() => navigate('/dashboard/usage')}
              className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
            >
              Ver uso detallado
            </button>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-6">
            <h3 className="text-lg font-bold text-emerald-900">Pagos y facturas</h3>
            <p className="mt-2 text-sm text-emerald-800">Revisa estado de tus comprobantes y realiza pagos online.</p>
            <button
              onClick={() => navigate('/dashboard/billing')}
              className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Abrir facturacion
            </button>
          </div>

          <PushOptInCard className="md:col-span-2" />
        </div>
      </motion.div>
    </AppLayout>
  )
}

export default ClientDashboard
