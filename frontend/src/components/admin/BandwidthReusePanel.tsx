/**
 * BandwidthReusePanel – Gestión de reuso dinámico de ancho de banda
 * Permite configurar ratio (1:1, 1:2, 1:4, 1:8), tipo de cola y algoritmo por plan.
 * Muestra velocidades efectivas en tiempo real según clientes activos.
 */
import { useEffect, useState, useCallback } from 'react'
import { apiClient } from '../../lib/apiClient'

interface ReuseConfig {
  id: number
  plan_id: number
  plan_name: string
  plan_down: number
  plan_up: number
  reuse_ratio: string
  queue_type: string
  queue_algorithm: string
  parent_queue_name: string
  auto_adjust: boolean
  current_active_clients: number
  current_effective_down: number
  current_effective_up: number
  last_adjusted_at: string | null
  last_active_clients: number | null
}

interface Router {
  id: number
  name: string
  ip_address: string
}

const RATIO_LABELS: Record<string, string> = {
  '1:1': '1:1 – Sin reuso (dedicado)',
  '1:2': '1:2 – Compartido x2',
  '1:4': '1:4 – Compartido x4',
  '1:8': '1:8 – Compartido x8',
}

const QUEUE_TYPE_LABELS: Record<string, string> = {
  simple: 'Queue Simple',
  tree: 'Queue Tree',
  mangle_tree: 'Mangle + Queue Tree',
}

const ALGO_LABELS: Record<string, string> = {
  default: 'Default (FIFO)',
  pcq: 'PCQ (Per Connection Queue)',
  cake: 'CAKE (v7+)',
}

export default function BandwidthReusePanel() {
  const [configs, setConfigs] = useState<ReuseConfig[]>([])
  const [routers, setRouters] = useState<Router[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ReuseConfig | null>(null)
  const [editForm, setEditForm] = useState({ reuse_ratio: '1:1', queue_type: 'simple', queue_algorithm: 'default', parent_queue_name: '', auto_adjust: true })
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState<number | null>(null)
  const [applyResult, setApplyResult] = useState<any>(null)
  const [selectedRouter, setSelectedRouter] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [reuseRes, routerRes] = await Promise.all([
        apiClient.request('/api/network/bandwidth-reuse'),
        apiClient.request('/api/routers'),
      ])
      const reuseData = await reuseRes.json()
      const routerData = await routerRes.json()
      setConfigs(reuseData.reuse_configs || [])
      setRouters(routerData.routers || routerData || [])
    } catch {
      setError('Error cargando configuraciones de reuso')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openEdit = (cfg: ReuseConfig) => {
    setEditing(cfg)
    setEditForm({
      reuse_ratio: cfg.reuse_ratio,
      queue_type: cfg.queue_type,
      queue_algorithm: cfg.queue_algorithm,
      parent_queue_name: cfg.parent_queue_name || '',
      auto_adjust: cfg.auto_adjust,
    })
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const res = await apiClient.request(`/api/network/bandwidth-reuse/${editing.plan_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      if (!res.ok) {
        const d = await res.json()
        alert(d.error || 'Error guardando')
        return
      }
      setEditing(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleApply = async (planId: number) => {
    if (!selectedRouter) {
      alert('Selecciona un router primero')
      return
    }
    setApplying(planId)
    setApplyResult(null)
    try {
      const res = await apiClient.request(`/api/network/bandwidth-reuse/${planId}/apply/${selectedRouter}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
      const data = await res.json()
      setApplyResult(data)
      load()
    } finally {
      setApplying(null)
    }
  }

  const handleApplyAll = async () => {
    if (!selectedRouter) {
      alert('Selecciona un router primero')
      return
    }
    setApplying(-1)
    setApplyResult(null)
    try {
      const res = await apiClient.request(`/api/network/bandwidth-reuse/apply-all/${selectedRouter}`, {
        method: 'POST',
      })
      const data = await res.json()
      setApplyResult(data)
      load()
    } finally {
      setApplying(null)
    }
  }

  const speedBar = (effective: number, plan: number) => {
    const pct = plan > 0 ? Math.min(100, (effective / plan) * 100) : 100
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-white/15 dark:bg-gray-700 rounded-full h-2">
          <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-mono text-slate-400 dark:text-slate-500 w-16 text-right">{effective}/{plan}M</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white dark:text-white">📶 Reuso de Ancho de Banda</h2>
          <p className="text-sm text-slate-400">Configura Queue Simple, Tree o Mangle+Tree con CAKE, PCQ o Default</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <select
            aria-label="Seleccionar router"
            value={selectedRouter || ''}
            onChange={e => setSelectedRouter(e.target.value ? parseInt(e.target.value) : null)}
            className="text-sm border rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white dark:border-gray-600">
            <option value="">Seleccionar router...</option>
            {routers.map(r => <option key={r.id} value={r.id}>{r.name} ({r.ip_address})</option>)}
          </select>
          <button onClick={handleApplyAll} disabled={applying !== null || !selectedRouter}
            className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
            {applying === -1 ? '⏳ Aplicando...' : '⚡ Aplicar Todos'}
          </button>
          <button onClick={load} className="px-3 py-2 bg-white/15 dark:bg-gray-700 text-slate-300 dark:text-gray-200 rounded-lg text-sm">↻</button>
        </div>
      </div>

      {/* Resultado de aplicación */}
      {applyResult && (
        <div className={`rounded-xl p-4 text-sm border ${applyResult.success ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
          <p className="font-semibold">{applyResult.success ? '✅ Aplicado correctamente' : '❌ Error al aplicar'}</p>
          {applyResult.plan_name && <p>Plan: {applyResult.plan_name} · {applyResult.active_clients} clientes activos</p>}
          {applyResult.effective_down_mbps && (
            <p>Velocidad efectiva: ↓{applyResult.effective_down_mbps}M / ↑{applyResult.effective_up_mbps}M</p>
          )}
          {applyResult.errors?.length > 0 && (
            <p className="text-red-600 mt-1">Errores: {applyResult.errors.map((e: any) => e.error || JSON.stringify(e)).join(', ')}</p>
          )}
          <button onClick={() => setApplyResult(null)} className="mt-2 text-xs underline">Cerrar</button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      ) : error ? (
        <div className="bg-rose-500/10 rounded-xl p-4 text-red-600">{error}</div>
      ) : configs.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <p className="text-4xl mb-3">📭</p>
          <p>No hay planes configurados. Los planes aparecerán aquí automáticamente.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {configs.map(cfg => (
            <div key={cfg.plan_id}
              className="bg-white/5 backdrop-blur-md dark:bg-gray-800 rounded-2xl shadow-sm border border-white/5 dark:border-gray-700 p-5 flex flex-col gap-3">
              {/* Plan header */}
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-white dark:text-white">{cfg.plan_name}</p>
                  <p className="text-xs text-slate-400">Plan: ↓{cfg.plan_down}M / ↑{cfg.plan_up}M</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                  cfg.reuse_ratio === '1:1' ? 'bg-emerald-500/20 text-emerald-400' :
                  cfg.reuse_ratio === '1:2' ? 'bg-blue-500/20 text-blue-300' :
                  cfg.reuse_ratio === '1:4' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-rose-500/20 text-rose-400'}`}>{cfg.reuse_ratio}</span>
              </div>

              {/* Velocidades efectivas */}
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-slate-400 font-medium">Velocidad efectiva por cliente</p>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-xs text-slate-400">↓ Descarga</div>
                  {speedBar(cfg.current_effective_down, cfg.plan_down)}
                  <div className="flex items-center gap-1 text-xs text-slate-400 mt-1">↑ Subida</div>
                  {speedBar(cfg.current_effective_up, cfg.plan_up)}
                </div>
              </div>

              {/* Info */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/5 dark:bg-gray-700 rounded-lg p-2">
                  <p className="text-slate-500">Clientes activos</p>
                  <p className="font-bold text-slate-200 dark:text-gray-200">{cfg.current_active_clients}</p>
                </div>
                <div className="bg-white/5 dark:bg-gray-700 rounded-lg p-2">
                  <p className="text-slate-500">Tipo de cola</p>
                  <p className="font-bold text-slate-200 dark:text-gray-200 capitalize">{cfg.queue_type.replace('_', ' ')}</p>
                </div>
                <div className="bg-white/5 dark:bg-gray-700 rounded-lg p-2">
                  <p className="text-slate-500">Algoritmo</p>
                  <p className="font-bold text-slate-200 dark:text-gray-200 uppercase">{cfg.queue_algorithm}</p>
                </div>
                <div className="bg-white/5 dark:bg-gray-700 rounded-lg p-2">
                  <p className="text-slate-500">Auto-ajuste</p>
                  <p className={`font-bold ${cfg.auto_adjust ? 'text-green-600' : 'text-slate-400'}`}>
                    {cfg.auto_adjust ? '✅ Activo' : '⏸ Inactivo'}
                  </p>
                </div>
              </div>

              {/* Acciones */}
              <div className="flex gap-2 mt-1">
                <button onClick={() => openEdit(cfg)}
                  className="flex-1 text-xs py-1.5 bg-blue-500/10 dark:bg-blue-900/30 text-blue-300 dark:text-blue-300 rounded-lg hover:bg-blue-500/20 font-medium">
                  ✏️ Configurar
                </button>
                <button onClick={() => handleApply(cfg.plan_id)} disabled={applying !== null || !selectedRouter}
                  className="flex-1 text-xs py-1.5 bg-emerald-500/10 dark:bg-green-900/30 text-emerald-400 dark:text-green-300 rounded-lg hover:bg-emerald-500/20 font-medium disabled:opacity-50">
                  {applying === cfg.plan_id ? '⏳' : '⚡ Aplicar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de edición */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white/5 backdrop-blur-md dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-1 text-white dark:text-white">⚙️ Configurar Reuso</h3>
            <p className="text-sm text-slate-400 mb-5">Plan: <strong>{editing.plan_name}</strong> ({editing.plan_down}/{editing.plan_up} Mbps)</p>

            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 dark:text-slate-400 mb-1">Ratio de Reuso</label>
                <select aria-label="Ratio de reuso" value={editForm.reuse_ratio} onChange={e => setEditForm(f => ({ ...f, reuse_ratio: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600">
                  {Object.entries(RATIO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Con {editing.current_active_clients} clientes activos y ratio {editForm.reuse_ratio}:
                  velocidad efectiva ≈ {Math.max(1, Math.floor(editing.plan_down / Math.min(editing.current_active_clients || 1, parseInt(editForm.reuse_ratio.split(':')[1]))))}M↓ /
                  {Math.max(1, Math.floor(editing.plan_up / Math.min(editing.current_active_clients || 1, parseInt(editForm.reuse_ratio.split(':')[1]))))}M↑
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 dark:text-slate-400 mb-1">Tipo de Cola</label>
                <select aria-label="Tipo de cola" value={editForm.queue_type} onChange={e => setEditForm(f => ({ ...f, queue_type: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600">
                  {Object.entries(QUEUE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 dark:text-slate-400 mb-1">Algoritmo de Cola</label>
                <select aria-label="Algoritmo de cola" value={editForm.queue_algorithm} onChange={e => setEditForm(f => ({ ...f, queue_algorithm: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600">
                  {Object.entries(ALGO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              {editForm.queue_type === 'tree' && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 dark:text-slate-400 mb-1">Nombre Cola Padre (opcional)</label>
                  <input value={editForm.parent_queue_name} onChange={e => setEditForm(f => ({ ...f, parent_queue_name: e.target.value }))}
                    placeholder="Ej: plan_basico_pool"
                    className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600" />
                </div>
              )}

              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={editForm.auto_adjust} onChange={e => setEditForm(f => ({ ...f, auto_adjust: e.target.checked }))}
                  className="w-4 h-4 rounded" />
                <div>
                  <p className="text-sm font-medium text-slate-300 dark:text-slate-400">Auto-ajuste automático</p>
                  <p className="text-xs text-slate-500">Recalcula límites cuando cambia el número de clientes activos</p>
                </div>
              </label>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Guardando...' : '💾 Guardar'}
              </button>
              <button onClick={() => setEditing(null)}
                className="flex-1 bg-white/15 dark:bg-gray-700 text-slate-300 dark:text-gray-200 rounded-lg py-2 text-sm hover:bg-gray-300">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
