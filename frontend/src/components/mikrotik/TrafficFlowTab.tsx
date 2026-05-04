import React from 'react'
import { RouterItem } from './types'

export interface TrafficFlowStat {
  src_ip: string
  mb_total: number
  bytes_total: number
  packets_total: number
  last_seen: string | null
}

interface TrafficFlowTabProps {
  selectedRouter: RouterItem
  tfCollector: { ip: string; port: number } | null
  setTfCollector: (c: { ip: string; port: number }) => void
  tfLoading: boolean
  setTfLoading: (l: boolean) => void
  tfLanGw: string
  setTfLanGw: (v: string) => void
  tfWanGw: string
  setTfWanGw: (v: string) => void
  tfScripts: { ros6: string; ros7_lan: string; ros7_wan: string } | null
  setTfScripts: (s: { ros6: string; ros7_lan: string; ros7_wan: string } | null) => void
  tfCopied: string | null
  setTfCopied: (v: string | null) => void
  tfHours: number
  setTfHours: (v: number) => void
  tfStatsLoading: boolean
  setTfStatsLoading: (l: boolean) => void
  tfStats: TrafficFlowStat[]
  setTfStats: (s: TrafficFlowStat[]) => void
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>
  addToast: (type: 'success' | 'error', msg: string) => void
  copyToClipboard: (text: string) => Promise<boolean>
}

const TrafficFlowTab: React.FC<TrafficFlowTabProps> = ({
  selectedRouter,
  tfCollector,
  setTfCollector,
  tfLoading,
  setTfLoading,
  tfLanGw,
  setTfLanGw,
  tfWanGw,
  setTfWanGw,
  tfScripts,
  setTfScripts,
  tfCopied,
  setTfCopied,
  tfHours,
  setTfHours,
  tfStatsLoading,
  setTfStatsLoading,
  tfStats,
  setTfStats,
  apiFetch,
  addToast,
  copyToClipboard
}) => {
  const handleGenerateScripts = async () => {
    setTfLoading(true)
    try {
      const params = new URLSearchParams()
      if (tfLanGw) params.set('lan_gateways', tfLanGw)
      if (tfWanGw) params.set('wan_gateways', tfWanGw)
      const r = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/traffic-flow/script?${params}`)
      const d = await r.json().catch(() => ({}))
      if (d.success && d.scripts) {
        setTfScripts(d.scripts)
        setTfCollector({ ip: d.collector_ip || '', port: d.collector_port || 2055 })
      } else {
        addToast('error', 'Error generando script de Traffic Flow')
      }
    } catch { addToast('error', 'Error de red') }
    setTfLoading(false)
  }

  const handleUpdateStats = async () => {
    setTfStatsLoading(true)
    try {
      const r = await apiFetch(`/api/mikrotik/traffic-flow/stats/router/${selectedRouter.id}?hours=${tfHours}&limit=50`)
      const d = await r.json().catch(() => ({}))
      if (d.success) setTfStats(d.stats || [])
      else addToast('error', 'Error cargando estadísticas de Traffic Flow')
    } catch { addToast('error', 'Error de red') }
    setTfStatsLoading(false)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-bold text-slate-800">📊 Script de Traffic Flow</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            Habilita NetFlow v5 en el MikroTik para enviar métricas de consumo por cliente a FASTISP.
          </p>
          {tfCollector && (
            <p className="mt-1 text-xs text-emerald-600 font-mono">
              Colector: <strong>{tfCollector.ip}:{tfCollector.port}</strong>
            </p>
          )}
        </div>
        <button
          onClick={() => void handleGenerateScripts()}
          disabled={tfLoading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60 transition"
        >
          {tfLoading ? 'Generando...' : '⚡ Generar scripts'}
        </button>
      </div>

      {/* Gateway inputs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            IPs Puerta de Enlace LAN (separadas por coma)
          </label>
          <input
            type="text"
            value={tfLanGw}
            onChange={(e) => setTfLanGw(e.target.value)}
            placeholder="192.168.1.1, 192.168.2.1"
            className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono text-slate-800 focus:border-blue-500 outline-none"
          />
          <p className="mt-0.5 text-[10px] text-slate-500">Solo RouterOS 7 — Opción 1 (LAN gateway)</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            IPs Puerta de Enlace WAN (separadas por coma)
          </label>
          <input
            type="text"
            value={tfWanGw}
            onChange={(e) => setTfWanGw(e.target.value)}
            placeholder="203.0.113.1"
            className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono text-slate-800 focus:border-blue-500 outline-none"
          />
          <p className="mt-0.5 text-[10px] text-slate-500">Solo RouterOS 7 — Opción 2 (WAN gateway)</p>
        </div>
      </div>

      {/* Scripts */}
      {tfScripts && (
        <div className="space-y-4">
          {[
            { key: 'ros6', label: '📋 RouterOS 6.x o inferior', desc: 'Un solo target sin src-address' },
            { key: 'ros7_lan', label: '📋 RouterOS 7.x — Opción 1 (LAN gateways)', desc: 'Un target por IP de puerta de enlace LAN' },
            { key: 'ros7_wan', label: '📋 RouterOS 7.x — Opción 2 (WAN gateways)', desc: 'Un target por IP de puerta de enlace WAN' },
          ].map((item) => {
            const script = tfScripts[item.key as keyof typeof tfScripts]
            return (
              <div key={item.key} className="rounded-2xl border border-gray-100 bg-white overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50">
                  <div>
                    <p className="text-xs font-black text-slate-700 uppercase tracking-widest">{item.label}</p>
                    <p className="text-[10px] font-bold text-slate-500 mt-1">{item.desc}</p>
                  </div>
                  <button
                    onClick={async () => {
                      await copyToClipboard(script)
                      setTfCopied(item.key)
                      setTimeout(() => setTfCopied(null), 2500)
                    }}
                    className="rounded-xl bg-coral-500 px-4 py-2 text-[11px] font-black text-white hover:bg-coral-600 transition-all shadow-lg shadow-coral-500/20"
                  >
                    {tfCopied === item.key ? '✅ Copiado' : '📋 Copiar Código'}
                  </button>
                </div>
                <pre className="overflow-x-auto p-6 text-[11px] leading-relaxed text-slate-700 font-mono whitespace-pre-wrap bg-slate-50/30">{script}</pre>
              </div>
            )
          })}
        </div>
      )}

      {/* Stats: top consumers */}
      <div className="rounded-lg border border-gray-200 bg-white backdrop-blur-md p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h5 className="font-semibold text-slate-800">📈 Top Consumidores</h5>
            <p className="text-xs text-slate-500">Clientes con mayor consumo según NetFlow recibido.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={tfHours}
              onChange={(e) => setTfHours(Number(e.target.value))}
              className="rounded border border-gray-200 px-2 py-1 text-xs text-slate-800"
            >
              {[1, 6, 12, 24, 48, 168].map((h) => (
                <option key={h} value={h}>{h === 168 ? '7 días' : `${h}h`}</option>
              ))}
            </select>
            <button
              onClick={() => void handleUpdateStats()}
              disabled={tfStatsLoading}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60 transition"
            >
              {tfStatsLoading ? 'Cargando...' : '🔄 Actualizar'}
            </button>
          </div>
        </div>

        {tfStats.length === 0 && !tfStatsLoading && (
          <div className="py-6 text-center">
            <p className="text-sm text-slate-500">Sin datos de tráfico aún.</p>
            <p className="mt-1 text-xs text-slate-500">
              Aplica el script en el MikroTik, espera 1-2 minutos y presiona Actualizar.
            </p>
          </div>
        )}

        {tfStats.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">IP Cliente</th>
                  <th className="px-4 py-3 text-right">MB Total</th>
                  <th className="px-4 py-3 text-right">Bytes</th>
                  <th className="px-4 py-3 text-right">Paquetes</th>
                  <th className="px-4 py-3 text-left">Último flujo</th>
                </tr>
              </thead>
              <tbody>
                {tfStats.map((row, i) => (
                  <tr key={row.src_ip} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-slate-500 font-bold">{i + 1}</td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-700">{row.src_ip}</td>
                    <td className="px-4 py-3 text-right font-black text-coral-500">{row.mb_total.toLocaleString()} MB</td>
                    <td className="px-4 py-3 text-right text-slate-500">{(row.bytes_total || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{(row.packets_total || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[10px]">{row.last_seen ? new Date(row.last_seen).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 space-y-1">
        <p className="font-semibold">📌 Instrucciones:</p>
        <p>1. Genera los scripts con el botón de arriba.</p>
        <p>2. Copia el script correspondiente a tu versión de RouterOS.</p>
        <p>3. En Winbox → New Terminal → pega el script → Enter.</p>
        <p>4. Espera 5-10 minutos para ver el primer consumo en la tabla de Top Consumidores.</p>
        <p>5. Si en 24h no aparecen datos, usa la Opción 2 (WAN gateway) para RouterOS 7.</p>
      </div>
    </div>
  )
}

export default TrafficFlowTab
