/**
 * RemoteNatPanel – Acceso remoto sin IP pública
 * Gestiona reglas NAT de redirección en MikroTik para acceder a nodos internos.
 * Ejemplo: puerto 2222 del router → 192.168.1.10:22 (SSH a nodo sin IP pública)
 */
import { useEffect, useState, useCallback } from 'react'
import { apiClient } from '../../lib/apiClient'

interface NatRule {
  id: number
  router_id: number
  name: string
  protocol: string
  src_port: number
  dst_address: string
  dst_port: number
  description: string
  is_active: boolean
  mikrotik_rule_id: string | null
  created_at: string
}

interface Router {
  id: number
  name: string
  ip_address: string
}

const COMMON_PORTS = [
  { label: 'SSH (22)', port: 22 },
  { label: 'HTTP (80)', port: 80 },
  { label: 'HTTPS (443)', port: 443 },
  { label: 'RDP (3389)', port: 3389 },
  { label: 'Winbox (8291)', port: 8291 },
  { label: 'Telnet (23)', port: 23 },
  { label: 'FTP (21)', port: 21 },
  { label: 'SNMP (161)', port: 161 },
]

export default function RemoteNatPanel() {
  const [rules, setRules] = useState<NatRule[]>([])
  const [routers, setRouters] = useState<Router[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterRouter, setFilterRouter] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    router_id: '',
    name: '',
    protocol: 'tcp',
    src_port: '',
    dst_address: '',
    dst_port: '',
    description: '',
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<number | null>(null)
  const [testResult, setTestResult] = useState<{ ruleId: number; reachable: boolean; error: string | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rulesRes, routersRes] = await Promise.all([
        apiClient.request('/api/network/nat-rules' + (filterRouter ? `?router_id=${filterRouter}` : '')),
        apiClient.request('/api/routers'),
      ])
      const rulesData = await rulesRes.json()
      const routersData = await routersRes.json()
      setRules(rulesData.rules || [])
      setRouters(routersData.routers || routersData || [])
    } catch {
      setError('Error cargando reglas NAT')
    } finally {
      setLoading(false)
    }
  }, [filterRouter])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!form.router_id || !form.name || !form.src_port || !form.dst_address || !form.dst_port) {
      alert('Completa todos los campos requeridos')
      return
    }
    setSaving(true)
    try {
      const res = await apiClient.request('/api/network/nat-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          router_id: parseInt(form.router_id),
          src_port: parseInt(form.src_port),
          dst_port: parseInt(form.dst_port),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Error creando regla')
        return
      }
      if (data.warning) {
        alert(`⚠️ Regla guardada pero: ${data.warning}`)
      }
      setShowForm(false)
      setForm({ router_id: '', name: '', protocol: 'tcp', src_port: '', dst_address: '', dst_port: '', description: '' })
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (rule: NatRule) => {
    try {
      await apiClient.request(`/api/network/nat-rules/${rule.id}/toggle`, { method: 'POST' })
      load()
    } catch {
      alert('Error al cambiar estado')
    }
  }

  const handleDelete = async (rule: NatRule) => {
    if (!confirm(`¿Eliminar regla "${rule.name}"? Esto también la eliminará del router.`)) return
    try {
      const res = await apiClient.request(`/api/network/nat-rules/${rule.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.warning) alert(`⚠️ ${data.warning}`)
      load()
    } catch {
      alert('Error eliminando regla')
    }
  }

  const handleTest = async (rule: NatRule) => {
    setTesting(rule.id)
    setTestResult(null)
    try {
      const res = await apiClient.request('/api/network/nat-rules/test-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ router_id: rule.router_id, src_port: rule.src_port }),
      })
      const data = await res.json()
      setTestResult({ ruleId: rule.id, reachable: data.reachable, error: data.error })
    } finally {
      setTesting(null)
    }
  }

  const getRouterName = (id: number) => routers.find(r => r.id === id)?.name || `Router #${id}`
  const getRouterIp = (id: number) => routers.find(r => r.id === id)?.ip_address || ''

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white dark:text-white">🧭 Acceso Remoto sin IP Pública</h2>
          <p className="text-sm text-slate-400">Redirección NAT automática desde el router principal hacia nodos internos</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <select
            aria-label="Filtrar por router"
            value={filterRouter || ''}
            onChange={e => setFilterRouter(e.target.value ? parseInt(e.target.value) : null)}
            className="text-sm border rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white dark:border-gray-600">
            <option value="">Todos los routers</option>
            {routers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button onClick={() => setShowForm(true)}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            + Nueva Regla NAT
          </button>
          <button onClick={load} className="px-3 py-2 bg-white/15 dark:bg-gray-700 text-slate-300 dark:text-gray-200 rounded-lg text-sm">↻</button>
        </div>
      </div>

      {/* Info box */}
      <div className="bg-blue-500/10 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-300 dark:text-blue-300">
        <p className="font-semibold mb-1">💡 ¿Cómo funciona?</p>
        <p>Crea una regla <strong>dstnat</strong> en el router MikroTik que redirige un puerto externo hacia la IP interna del nodo destino.
        Ejemplo: <code className="bg-blue-500/20 dark:bg-blue-800 px-1 rounded">router_ip:2222 → 192.168.1.10:22</code> permite SSH al nodo sin IP pública.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      ) : error ? (
        <div className="bg-rose-500/10 rounded-xl p-4 text-red-600">{error}</div>
      ) : rules.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <p className="text-4xl mb-3">🔌</p>
          <p>No hay reglas NAT configuradas.</p>
          <button onClick={() => setShowForm(true)} className="mt-3 text-blue-600 hover:underline text-sm">Crear primera regla →</button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map(rule => (
            <div key={rule.id}
              className={`bg-white/5 backdrop-blur-md dark:bg-gray-800 rounded-xl border p-4 flex flex-wrap items-center gap-4 ${
                rule.is_active ? 'border-white/5 dark:border-gray-700' : 'border-white/10 dark:border-gray-600 opacity-60'}`}>
              {/* Estado */}
              <div className={`w-3 h-3 rounded-full flex-shrink-0 ${rule.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />

              {/* Info principal */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-white dark:text-white">{rule.name}</p>
                  <span className="text-xs px-2 py-0.5 bg-white/10 dark:bg-gray-700 text-slate-400 dark:text-slate-400 rounded-full uppercase">{rule.protocol}</span>
                  {!rule.mikrotik_rule_id && (
                    <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full">⚠️ No aplicado en router</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-sm text-slate-400 flex-wrap">
                  <span className="font-mono">{getRouterIp(rule.router_id)}:<strong className="text-blue-600">{rule.src_port}</strong></span>
                  <span>→</span>
                  <span className="font-mono text-green-600">{rule.dst_address}:{rule.dst_port}</span>
                  <span className="text-xs text-slate-500">({getRouterName(rule.router_id)})</span>
                </div>
                {rule.description && <p className="text-xs text-slate-500 mt-0.5">{rule.description}</p>}
              </div>

              {/* Test result */}
              {testResult?.ruleId === rule.id && (
                <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                  testResult.reachable ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                  {testResult.reachable ? '✅ Alcanzable' : `❌ ${testResult.error || 'No alcanzable'}`}
                </span>
              )}

              {/* Acciones */}
              <div className="flex gap-2 flex-shrink-0">
                <button onClick={() => handleTest(rule)} disabled={testing === rule.id}
                  title="Probar conectividad"
                  className="p-2 text-blue-600 hover:bg-blue-500/10 dark:hover:bg-blue-900/30 rounded-lg text-sm disabled:opacity-50">
                  {testing === rule.id ? '⏳' : '🔍'}
                </button>
                <button onClick={() => handleToggle(rule)}
                  title={rule.is_active ? 'Deshabilitar' : 'Habilitar'}
                  className="p-2 text-yellow-600 hover:bg-amber-500/10 dark:hover:bg-yellow-900/30 rounded-lg text-sm">
                  {rule.is_active ? '⏸' : '▶️'}
                </button>
                <button onClick={() => handleDelete(rule)}
                  title="Eliminar regla"
                  className="p-2 text-red-600 hover:bg-rose-500/10 dark:hover:bg-red-900/30 rounded-lg text-sm">
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Crear regla */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white/5 backdrop-blur-md dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <h3 className="text-lg font-bold mb-1 text-white dark:text-white">🔌 Nueva Regla NAT Remoto</h3>
            <p className="text-sm text-slate-400 mb-5">Redirige un puerto del router hacia un nodo interno sin IP pública</p>

            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">Router *</label>
                <select aria-label="Router" value={form.router_id} onChange={e => setForm(f => ({ ...f, router_id: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600">
                  <option value="">Seleccionar router...</option>
                  {routers.map(r => <option key={r.id} value={r.id}>{r.name} ({r.ip_address})</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">Nombre descriptivo *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: SSH Nodo Zona Norte"
                  className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">Protocolo</label>
                  <select aria-label="Protocolo" value={form.protocol} onChange={e => setForm(f => ({ ...f, protocol: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600">
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">Puerto externo (router) *</label>
                  <input type="number" value={form.src_port} onChange={e => setForm(f => ({ ...f, src_port: e.target.value }))}
                    placeholder="Ej: 2222"
                    className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">IP destino (nodo interno) *</label>
                  <input value={form.dst_address} onChange={e => setForm(f => ({ ...f, dst_address: e.target.value }))}
                    placeholder="Ej: 192.168.1.10"
                    className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">Puerto destino *</label>
                  <select aria-label="Puerto destino" value={form.dst_port} onChange={e => setForm(f => ({ ...f, dst_port: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600">
                    <option value="">Seleccionar...</option>
                    {COMMON_PORTS.map(p => <option key={p.port} value={p.port}>{p.label}</option>)}
                  </select>
                  <input type="number" value={form.dst_port} onChange={e => setForm(f => ({ ...f, dst_port: e.target.value }))}
                    placeholder="O escribe el puerto"
                    className="w-full border rounded-lg px-3 py-2 text-sm mt-1 dark:bg-gray-700 dark:text-white dark:border-gray-600" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">Descripción (opcional)</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Ej: Acceso SSH al switch de la zona norte"
                  className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:text-white dark:border-gray-600" />
              </div>

              {/* Preview */}
              {form.router_id && form.src_port && form.dst_address && form.dst_port && (
                <div className="bg-white/5 dark:bg-gray-700 rounded-lg p-3 text-xs font-mono text-slate-400 dark:text-slate-400">
                  <p className="text-slate-500 mb-1">Vista previa de la regla:</p>
                  <p>{getRouterIp(parseInt(form.router_id))}:<strong className="text-blue-600">{form.src_port}</strong>
                    {' → '}<strong className="text-green-600">{form.dst_address}:{form.dst_port}</strong>
                    {' ('}{form.protocol.toUpperCase()}{')'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={handleCreate} disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Creando...' : '🔌 Crear Regla NAT'}
              </button>
              <button onClick={() => setShowForm(false)}
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
