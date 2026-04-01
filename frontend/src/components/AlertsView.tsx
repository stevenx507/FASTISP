import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  XMarkIcon,
  BellIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../lib/apiClient'

type AlertSeverity = 'critical' | 'warning' | 'info' | 'success'

interface UiAlert {
  id: string
  title: string
  message: string
  severity: AlertSeverity
  timestamp: string
  source: string
  dismissed: boolean
}

interface NetworkAlert {
  id: string
  severity: string
  scope?: string
  target?: string
  message: string
  since?: string
}

interface ScreenAlert {
  id: string
  title: string
  message: string
  severity: string
  audience: string
  status: string
  updated_at?: string
}

const severityConfig: Record<
  AlertSeverity,
  {
    icon: React.ComponentType<{ className?: string }>
    bg: string
    border: string
    title: string
    text: string
    leftBorder: string
  }
> = {
  critical: {
    icon: ExclamationTriangleIcon,
    bg: 'bg-red-50',
    border: 'border-red-200',
    title: 'text-red-900',
    text: 'text-red-700',
    leftBorder: 'border-l-4 border-l-red-600',
  },
  warning: {
    icon: ExclamationTriangleIcon,
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    title: 'text-yellow-900',
    text: 'text-yellow-700',
    leftBorder: 'border-l-4 border-l-yellow-600',
  },
  info: {
    icon: InformationCircleIcon,
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    title: 'text-blue-900',
    text: 'text-blue-700',
    leftBorder: 'border-l-4 border-l-blue-600',
  },
  success: {
    icon: CheckCircleIcon,
    bg: 'bg-green-50',
    border: 'border-green-200',
    title: 'text-green-900',
    text: 'text-green-700',
    leftBorder: 'border-l-4 border-l-green-600',
  },
}

const normalizeSeverity = (raw: string): AlertSeverity => {
  if (raw === 'critical') return 'critical'
  if (raw === 'warning') return 'warning'
  if (raw === 'success') return 'success'
  return 'info'
}

const AlertsView: React.FC = () => {
  const [alerts, setAlerts] = useState<UiAlert[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | AlertSeverity>('all')

  const loadAlerts = async () => {
    setLoading(true)
    try {
      const [networkRes, screenRes] = await Promise.allSettled([
        apiClient.get('/network/alerts') as Promise<{ alerts: NetworkAlert[] }>,
        apiClient.get('/admin/screen-alerts') as Promise<{ items: ScreenAlert[] }>,
      ])

      const networkAlerts =
        networkRes.status === 'fulfilled'
          ? (networkRes.value.alerts || []).map<UiAlert>((alert) => ({
              id: `network-${alert.id}`,
              title: `${alert.scope || 'network'}: ${alert.target || 'infra'}`,
              message: alert.message,
              severity: normalizeSeverity(String(alert.severity || 'info').toLowerCase()),
              timestamp: alert.since || new Date().toISOString(),
              source: 'network',
              dismissed: false,
            }))
          : []

      const screenAlerts =
        screenRes.status === 'fulfilled'
          ? ((screenRes.value.items || []) as ScreenAlert[])
              .filter((alert) => alert.status !== 'expired')
              .map<UiAlert>((alert) => ({
                id: `screen-${alert.id}`,
                title: alert.title,
                message: alert.message,
                severity: normalizeSeverity(String(alert.severity || 'info').toLowerCase()),
                timestamp: alert.updated_at || new Date().toISOString(),
                source: `screen:${alert.audience}`,
                dismissed: false,
              }))
          : []

      const merged = [...networkAlerts, ...screenAlerts]
        .sort((a, b) => {
          const aTime = new Date(a.timestamp).getTime()
          const bTime = new Date(b.timestamp).getTime()
          return bTime - aTime
        })
        .slice(0, 100)

      setAlerts((prev) => {
        const dismissedMap = new Map(prev.map((item) => [item.id, item.dismissed]))
        return merged.map((item) => ({ ...item, dismissed: dismissedMap.get(item.id) || false }))
      })

      if (networkRes.status === 'rejected' || screenRes.status === 'rejected') {
        toast.error('Algunas fuentes de alertas no se pudieron cargar')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar alertas'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAlerts()
    const timer = setInterval(loadAlerts, 30000)
    return () => clearInterval(timer)
  }, [])

  const dismissAlert = (id: string) => {
    setAlerts((prev) => prev.map((alert) => (alert.id === id ? { ...alert, dismissed: true } : alert)))
  }

  const dismissAllAlerts = () => {
    setAlerts((prev) => prev.map((alert) => ({ ...alert, dismissed: true })))
  }

  const restoreAll = () => {
    setAlerts((prev) => prev.map((alert) => ({ ...alert, dismissed: false })))
  }

  const visibleAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      if (alert.dismissed) return false
      if (statusFilter === 'all') return true
      return alert.severity === statusFilter
    })
  }, [alerts, statusFilter])

  const dismissedAlerts = alerts.filter((alert) => alert.dismissed)

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BellIcon className="h-6 w-6 text-gray-700" />
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Alertas del Sistema</h2>
            <p className="text-sm text-gray-600">{visibleAlerts.length} alertas activas</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | AlertSeverity)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="all">Todas</option>
            <option value="critical">critical</option>
            <option value="warning">warning</option>
            <option value="info">info</option>
            <option value="success">success</option>
          </select>
          <button
            onClick={loadAlerts}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>
          {visibleAlerts.length > 0 && (
            <button
              onClick={dismissAllAlerts}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200"
            >
              Descartar todas
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {visibleAlerts.length > 0 ? (
          <div className="space-y-3">
            {visibleAlerts.map((alert, index) => {
              const config = severityConfig[alert.severity]
              const IconComponent = config.icon
              return (
                <motion.div
                  key={alert.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ delay: index * 0.03 }}
                  className={`${config.bg} ${config.border} ${config.leftBorder} flex items-start gap-3 rounded-lg border p-4`}
                >
                  <IconComponent className={`mt-0.5 h-6 w-6 flex-shrink-0 ${config.text}`} />
                  <div className="flex-1">
                    <h3 className={`font-semibold ${config.title}`}>{alert.title}</h3>
                    <p className={`mt-1 text-sm ${config.text}`}>{alert.message}</p>
                    <p className={`mt-2 text-xs opacity-80 ${config.text}`}>
                      {alert.source} | {alert.timestamp.replace('T', ' ').slice(0, 16)}
                    </p>
                  </div>
                  <button onClick={() => dismissAlert(alert.id)} className="rounded p-1 hover:bg-white">
                    <XMarkIcon className={`h-5 w-5 ${config.text}`} />
                  </button>
                </motion.div>
              )
            })}
          </div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-12 text-center text-gray-500">
            <CheckCircleIcon className="mx-auto mb-3 h-12 w-12 opacity-50" />
            <p className="text-lg font-medium">Sistema en buen estado</p>
            <p className="text-sm">No hay alertas activas para el filtro seleccionado</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Historial descartado</h3>
          {dismissedAlerts.length > 0 && (
            <button onClick={restoreAll} className="text-xs font-semibold text-blue-600 hover:underline">
              Restaurar todo
            </button>
          )}
        </div>
        <div className="space-y-2 text-sm">
          {dismissedAlerts.slice(0, 10).map((alert) => (
            <div key={alert.id} className="flex items-center justify-between border-b py-2 text-gray-600 last:border-b-0">
              <span>{alert.title}</span>
              <span className="text-xs text-gray-500">{alert.timestamp.replace('T', ' ').slice(0, 16)}</span>
            </div>
          ))}
          {!dismissedAlerts.length && <p className="text-sm text-gray-500">No hay alertas descartadas.</p>}
        </div>
      </div>
    </motion.div>
  )
}

export default AlertsView
