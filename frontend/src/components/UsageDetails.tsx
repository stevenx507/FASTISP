import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { LineChart, BarChart } from './Chart'
import { apiClient } from '../lib/apiClient'

type RangeKey = '7d' | '30d' | '90d'

interface UsageHistoryResponse {
  labels?: string[]
  datasets?: Array<{
    data?: number[]
  }>
}

interface UsagePoint {
  label: string
  total: number
}

const UsageDetails: React.FC = () => {
  const [timeRange, setTimeRange] = useState<RangeKey>('30d')
  const [usageData, setUsageData] = useState<UsagePoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const loadUsage = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await apiClient.get(`/clients/usage-history?range=${timeRange}`) as UsageHistoryResponse
        const labels = Array.isArray(response.labels) ? response.labels : []
        const values = Array.isArray(response.datasets?.[0]?.data) ? response.datasets?.[0]?.data || [] : []

        const points: UsagePoint[] = labels.map((label, index) => ({
          label,
          total: Number(values[index] || 0),
        }))

        if (active) {
          setUsageData(points)
        }
      } catch (err) {
        if (!active) return
        const message = err instanceof Error ? err.message : 'No se pudo cargar historial de uso'
        setError(message)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadUsage()
    return () => {
      active = false
    }
  }, [timeRange])

  const total = useMemo(() => usageData.reduce((acc, point) => acc + point.total, 0), [usageData])
  const avg = useMemo(() => (usageData.length ? total / usageData.length : 0), [total, usageData.length])
  const peak = useMemo(() => Math.max(...usageData.map((point) => point.total), 0), [usageData])

  const linePoints = useMemo(
    () =>
      usageData.map((point) => ({
        label: point.label,
        value: Number(point.total.toFixed(2)),
      })),
    [usageData]
  )

  const barPoints = useMemo(() => {
    const lastSeven = usageData.slice(-7)
    const maxValue = Math.max(...lastSeven.map((point) => point.total), 1)
    return lastSeven.map((point) => ({
      label: point.label,
      value: Number(((point.total / maxValue) * 100).toFixed(1)),
      color: 'bg-indigo-500',
    }))
  }, [usageData])

  const tableRows = useMemo(() => {
    let runningTotal = 0
    const rows = usageData.map((point) => {
      runningTotal += point.total
      return {
        ...point,
        cumulative: runningTotal,
      }
    })
    return rows.slice(-14).reverse()
  }, [usageData])

  const summary = [
    { label: `Consumo (${timeRange})`, value: `${total.toFixed(2)} GB` },
    { label: 'Promedio diario', value: `${avg.toFixed(2)} GB` },
    { label: 'Dia de mayor uso', value: `${peak.toFixed(2)} GB` },
  ]

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Uso detallado de datos</h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {summary.map((item) => (
          <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-5 shadow">
            <p className="text-sm text-gray-600">{item.label}</p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(['7d', '30d', '90d'] as RangeKey[]).map((range) => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              timeRange === range ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {range === '7d' ? 'Ultimos 7 dias' : range === '30d' ? 'Ultimos 30 dias' : 'Ultimos 90 dias'}
          </button>
        ))}
      </div>

      {loading && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          Cargando uso de datos...
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {!loading && !error && usageData.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          Aun no hay informacion de consumo para este rango.
        </div>
      )}

      {!loading && !error && usageData.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <LineChart data={linePoints} title="Consumo diario (GB)" height={260} />
            <BarChart data={barPoints} title="Uso relativo ultimos 7 dias (%)" showValues />
          </div>

          <div className="overflow-hidden rounded-lg bg-white shadow">
            <div className="border-b border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900">Detalle diario</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Fecha</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Consumo</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Acumulado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {tableRows.map((row, index) => (
                    <motion.tr
                      key={`${row.label}-${index}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.03 }}
                      className="transition hover:bg-gray-50"
                    >
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{row.label}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{row.total.toFixed(2)} GB</td>
                      <td className="px-6 py-4 text-sm font-semibold text-gray-900">{row.cumulative.toFixed(2)} GB</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </motion.div>
  )
}

export default UsageDetails
