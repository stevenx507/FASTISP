import React, { useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

interface RouterUsage {
  router_id: string
  rx_mbps: number
  tx_mbps: number
  cpu?: number
  mem?: number
}

const TrafficView: React.FC = () => {
  const [routers, setRouters] = useState<RouterUsage[]>([])
  const [clientsCount, setClientsCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [usageRes, clientsRes] = await Promise.all([
        apiClient.get('/admin/routers/usage') as Promise<{ items: RouterUsage[] }>,
        apiClient.get('/admin/clients') as Promise<{ count: number }>,
      ])
      setRouters(usageRes.items || [])
      setClientsCount(Number(clientsRes.count || 0))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar trafico'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 20000)
    return () => clearInterval(timer)
  }, [])

  const totals = useMemo(() => {
    const totalRx = routers.reduce((sum, row) => sum + Number(row.rx_mbps || 0), 0)
    const totalTx = routers.reduce((sum, row) => sum + Number(row.tx_mbps || 0), 0)
    const total = totalRx + totalTx
    const avgPerClient = clientsCount > 0 ? total / clientsCount : 0
    const peakRouter = routers
      .map((row) => ({ ...row, total: Number(row.rx_mbps || 0) + Number(row.tx_mbps || 0) }))
      .sort((a, b) => b.total - a.total)[0]
    return {
      totalRx,
      totalTx,
      total,
      avgPerClient,
      peakRouter,
    }
  }, [routers, clientsCount])

  const maxRouterTotal = useMemo(() => {
    if (!routers.length) return 1
    return Math.max(...routers.map((row) => Number(row.rx_mbps || 0) + Number(row.tx_mbps || 0)))
  }, [routers])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Trafico</h2>
          <p className="text-sm text-gray-600">Throughput agregado por router y carga operacional.</p>
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs font-semibold uppercase text-blue-700">RX Total</p>
          <p className="mt-2 text-2xl font-bold text-blue-900">{totals.totalRx.toFixed(1)} Mbps</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase text-emerald-700">TX Total</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">{totals.totalTx.toFixed(1)} Mbps</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase text-slate-700">Throughput</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totals.total.toFixed(1)} Mbps</p>
        </div>
        <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
          <p className="text-xs font-semibold uppercase text-violet-700">Promedio x Cliente</p>
          <p className="mt-2 text-2xl font-bold text-violet-900">{totals.avgPerClient.toFixed(2)} Mbps</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase text-amber-700">Routers Monitoreados</p>
          <p className="mt-2 text-2xl font-bold text-amber-900">{routers.length}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-gray-900">Carga por router</h3>
        <div className="mt-4 space-y-3">
          {routers.map((router) => {
            const total = Number(router.rx_mbps || 0) + Number(router.tx_mbps || 0)
            return (
              <div key={router.router_id}>
                <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                  <span>{router.router_id}</span>
                  <span>{total.toFixed(1)} Mbps</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full bg-blue-600"
                    style={{ width: `${(total / maxRouterTotal) * 100}%` }}
                  />
                </div>
              </div>
            )
          })}
          {!routers.length && <p className="text-sm text-gray-500">Sin datos de trafico para mostrar.</p>}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3">
          <h3 className="font-semibold text-gray-900">Detalle por router</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Router</th>
                <th className="px-4 py-3 text-right">RX (Mbps)</th>
                <th className="px-4 py-3 text-right">TX (Mbps)</th>
                <th className="px-4 py-3 text-right">Total (Mbps)</th>
                <th className="px-4 py-3 text-right">CPU</th>
                <th className="px-4 py-3 text-right">Memoria</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {routers.map((router) => {
                const total = Number(router.rx_mbps || 0) + Number(router.tx_mbps || 0)
                return (
                  <tr key={router.router_id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{router.router_id}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{Number(router.rx_mbps || 0).toFixed(1)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{Number(router.tx_mbps || 0).toFixed(1)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{total.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {router.cpu != null ? `${Number(router.cpu).toFixed(1)}%` : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {router.mem != null ? `${Number(router.mem).toFixed(1)}%` : '-'}
                    </td>
                  </tr>
                )
              })}
              {!routers.length && (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={6}>
                    Sin routers con metricas disponibles.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totals.peakRouter && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase text-emerald-700">Router con mayor carga</p>
          <p className="mt-1 text-lg font-bold text-emerald-900">
            {totals.peakRouter.router_id} - {(totals.peakRouter.total || 0).toFixed(1)} Mbps
          </p>
        </div>
      )}
    </div>
  )
}

export default TrafficView
