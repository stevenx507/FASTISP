import React, { useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

interface InventorySummary {
  clients_total: number
  routers_total: number
  stock_items: number
  low_stock_items: number
  available_units: number
  updated_at: string
}

interface InventoryItem {
  sku: string
  name: string
  category: string
  total: number
  assigned: number
  available: number
  reorder_point: number
  unit: string
  status: 'ok' | 'warning' | 'critical'
  updated_at: string
}

interface InventoryAlert {
  sku: string
  name: string
  level: 'warning' | 'critical'
  available: number
  reorder_point: number
}

interface PlanDistributionItem {
  plan: string
  clients: number
}

const statusPill: Record<InventoryItem['status'], string> = {
  ok: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
}

const Inventory: React.FC = () => {
  const [summary, setSummary] = useState<InventorySummary | null>(null)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [alerts, setAlerts] = useState<InventoryAlert[]>([])
  const [planDistribution, setPlanDistribution] = useState<PlanDistributionItem[]>([])
  const [loading, setLoading] = useState(false)

  const loadInventory = async () => {
    setLoading(true)
    try {
      const response = await apiClient.get('/admin/inventory/summary')
      setSummary((response.summary || null) as InventorySummary | null)
      setItems((response.items || []) as InventoryItem[])
      setAlerts((response.alerts || []) as InventoryAlert[])
      setPlanDistribution((response.plan_distribution || []) as PlanDistributionItem[])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar el inventario'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadInventory()
  }, [])

  const maxPlanClients = useMemo(() => {
    if (!planDistribution.length) return 1
    return Math.max(...planDistribution.map((item) => item.clients))
  }, [planDistribution])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Almacen e Inventario</h2>
          <p className="text-sm text-gray-600">Stock operativo, asignaciones y alertas de reposicion.</p>
        </div>
        <button
          onClick={loadInventory}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs font-semibold uppercase text-blue-700">Clientes</p>
          <p className="mt-2 text-2xl font-bold text-blue-900">{summary?.clients_total ?? 0}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase text-emerald-700">Routers</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">{summary?.routers_total ?? 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase text-slate-700">Unidades Disponibles</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{summary?.available_units ?? 0}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase text-amber-700">Items en Riesgo</p>
          <p className="mt-2 text-2xl font-bold text-amber-900">{summary?.low_stock_items ?? 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-semibold text-gray-900">Stock por SKU</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">SKU</th>
                  <th className="px-4 py-3 text-left">Item</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Asignado</th>
                  <th className="px-4 py-3 text-right">Disponible</th>
                  <th className="px-4 py-3 text-right">Minimo</th>
                  <th className="px-4 py-3 text-right">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => (
                  <tr key={item.sku}>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">{item.sku}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-500">{item.category}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{item.total}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{item.assigned}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {item.available} {item.unit}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {item.reorder_point} {item.unit}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusPill[item.status]}`}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={7}>
                      Sin datos de inventario.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="font-semibold text-gray-900">Distribucion por Plan</h3>
            <div className="mt-4 space-y-3">
              {planDistribution.slice(0, 6).map((item) => (
                <div key={item.plan}>
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                    <span>{item.plan}</span>
                    <span>{item.clients}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-blue-500"
                      style={{ width: `${(item.clients / maxPlanClients) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
              {!planDistribution.length && <p className="text-sm text-gray-500">Sin datos de planes.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="font-semibold text-gray-900">Alertas de Reposicion</h3>
            <div className="mt-3 space-y-2">
              {alerts.map((alert) => (
                <div key={alert.sku} className="flex items-start gap-2 rounded-lg bg-red-50 p-3">
                  <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 text-red-500" />
                  <div className="text-sm">
                    <p className="font-semibold text-red-800">{alert.name}</p>
                    <p className="text-red-700">
                      Disponible: {alert.available} | Minimo: {alert.reorder_point}
                    </p>
                  </div>
                </div>
              ))}
              {!alerts.length && <p className="text-sm text-gray-500">No hay alertas activas.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Inventory
