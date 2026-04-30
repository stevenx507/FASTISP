import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowPathIcon,
  BoltIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  ServerIcon,
  ShieldCheckIcon,
  SignalIcon,
  SignalSlashIcon,
  WifiIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

// ── Types ────────────────────────────────────────────────────────────────────

interface RouterStatus {
  router_id: number
  router_name: string
  tenant_id: number
  status: 'online' | 'offline' | 'warning' | 'never_connected'
  vpn_ip: string | null
  last_seen: string | null
  minutes_since_seen: number | null
  is_active: boolean
  api_port: number
}

interface ConnectivityData {
  routers: RouterStatus[]
  summary: {
    total: number
    online: number
    offline: number
    warning: number
    never_connected: number
  }
  generated_at: string
}

interface VpnSession {
  name?: string
  username?: string
  ip?: string
  connected_at?: string
}

interface VpnSessionsData {
  success: boolean
  sessions: VpnSession[]
  count: number
  hub?: string
}

type Tab = 'monitor' | 'vpn' | 'security' | 'commands'

// ── Helpers ──────────────────────────────────────────────────────────────────

const statusConfig = {
  online:          { label: 'En línea',       dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: SignalIcon },
  warning:         { label: 'Advertencia',    dot: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-700 border-amber-200',       Icon: ExclamationTriangleIcon },
  offline:         { label: 'Offline',        dot: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 border-rose-200',          Icon: SignalSlashIcon },
  never_connected: { label: 'Sin conectar',   dot: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-600 border-slate-200',       Icon: XCircleIcon },
}

const copyToClipboard = async (text: string) => {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

const formatLastSeen = (val: string | null, mins: number | null) => {
  if (!val) return 'Nunca'
  if (mins === null) return new Date(val).toLocaleString('es-CO')
  if (mins < 1) return 'Hace menos de 1 min'
  if (mins < 60) return `Hace ${Math.round(mins)} min`
  return `Hace ${Math.round(mins / 60)} h`
}

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-coral-500 focus:ring-2 focus:ring-coral-500/20 outline-none transition'
const btnPrimary = 'inline-flex items-center gap-2 rounded-lg bg-coral-500 px-3 py-2 text-sm font-semibold text-white hover:bg-coral-600 disabled:opacity-50 transition focus:outline-none'
const btnDanger = 'inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 transition focus:outline-none'
const btnSuccess = 'inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition focus:outline-none'
const btnSecondary = 'inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition focus:outline-none'
const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'

// ── Main Component ───────────────────────────────────────────────────────────

const ConnectivityDashboard: React.FC = () => {
  const [tab, setTab] = useState<Tab>('monitor')

  // Heartbeat
  const [connectivity, setConnectivity] = useState<ConnectivityData | null>(null)
  const [loadingConn, setLoadingConn] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // VPN
  const [vpnSessions, setVpnSessions] = useState<VpnSessionsData | null>(null)
  const [loadingVpnSessions, setLoadingVpnSessions] = useState(false)
  const [provisioningId, setProvisioningId] = useState<number | null>(null)
  const [vpnResults, setVpnResults] = useState<Record<number, { vpn_username?: string; vpn_ip?: string; sstp_url?: string; script?: string }>>({})
  const [showScriptModal, setShowScriptModal] = useState<{ routerId: number; name: string; script: string } | null>(null)

  // Security
  const [securingId, setSecuringId] = useState<number | null>(null)
  const [securityResults, setSecurityResults] = useState<Record<number, { success: boolean; message: string }>>({})

  // Commands
  const [cmdRouterIds, setCmdRouterIds] = useState('')
  const [cmdClientIp, setCmdClientIp] = useState('')
  const [cmdClientName, setCmdClientName] = useState('')
  const [cmdDownload, setCmdDownload] = useState('10')
  const [cmdUpload, setCmdUpload] = useState('5')
  const [cmdLoading, setCmdLoading] = useState(false)
  const [cmdResult, setCmdResult] = useState<{ success: boolean; message: string } | null>(null)

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadConnectivity = useCallback(async (silent = false) => {
    if (!silent) setLoadingConn(true)
    try {
      const data = await apiClient.get('/connectivity') as ConnectivityData
      setConnectivity(data)
    } catch (err) {
      if (!silent) toast.error(err instanceof Error ? err.message : 'Error cargando conectividad')
    } finally {
      if (!silent) setLoadingConn(false)
    }
  }, [])

  const loadVpnSessions = useCallback(async () => {
    setLoadingVpnSessions(true)
    try {
      const data = await apiClient.get('/vpn/sessions') as VpnSessionsData
      setVpnSessions(data)
    } catch {
      setVpnSessions(null)
    } finally {
      setLoadingVpnSessions(false)
    }
  }, [])

  useEffect(() => {
    void loadConnectivity()
  }, [loadConnectivity])

  useEffect(() => {
    if (tab === 'vpn') void loadVpnSessions()
  }, [tab, loadVpnSessions])

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => void loadConnectivity(true), 60000)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, loadConnectivity])

  // ── VPN Orchestrator actions ───────────────────────────────────────────────

  const provisionVpn = async (routerId: number) => {
    setProvisioningId(routerId)
    try {
      const res = await apiClient.post(`/routers/${routerId}/provision-vpn`, {}) as {
        success?: boolean; vpn_username?: string; vpn_ip?: string; sstp_url?: string
      }
      if (res.success || res.vpn_username) {
        setVpnResults(prev => ({ ...prev, [routerId]: res }))
        toast.success(`SSTP nativo provisionado: ${res.vpn_username}`)
      } else {
        toast.error('No se pudo provisionar VPN')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error provisionando VPN')
    } finally {
      setProvisioningId(null)
    }
  }

  const loadOnboardingScript = async (routerId: number, routerName: string) => {
    try {
      const res = await apiClient.get(`/routers/${routerId}/onboarding-script`) as {
        script?: string; error?: string
      }
      if (res.script) {
        setShowScriptModal({ routerId, name: routerName, script: res.script })
      } else {
        toast.error(res.error || 'Router sin SSTP nativo provisionado. Ejecuta "Provisionar SSTP" primero.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error obteniendo script')
    }
  }

  // ── Security actions ──────────────────────────────────────────────────────

  const secureApi = async (routerId: number) => {
    setSecuringId(routerId)
    try {
      const res = await apiClient.post(`/routers/${routerId}/secure-api`, { allowed_ip: '10.100.0.1' }) as {
        success?: boolean; api_security?: { success?: boolean }; firewall?: { success?: boolean }
      }
      const ok = Boolean(res.success || res.api_security?.success)
      setSecurityResults(prev => ({
        ...prev,
        [routerId]: { success: ok, message: ok ? 'API asegurada + firewall aplicado' : 'Error en hardening' }
      }))
      if (ok) toast.success('API MikroTik asegurada correctamente')
      else toast.error('Error aplicando seguridad')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error'
      setSecurityResults(prev => ({ ...prev, [routerId]: { success: false, message: msg } }))
      toast.error(msg)
    } finally {
      setSecuringId(null)
    }
  }

  // ── Command actions ───────────────────────────────────────────────────────

  const runCommand = async (action: 'suspend' | 'restore' | 'bandwidth') => {
    const routerId = parseInt(cmdRouterIds)
    if (!routerId || !cmdClientIp) { toast.error('Router ID e IP cliente son obligatorios'); return }
    setCmdLoading(true)
    setCmdResult(null)
    try {
      let res: { success?: boolean; action?: string; error?: string; message?: string }
      if (action === 'suspend') {
        res = await apiClient.post(`/routers/${routerId}/suspend-client`, { client_ip: cmdClientIp, client_name: cmdClientName }) as typeof res
      } else if (action === 'restore') {
        res = await apiClient.post(`/routers/${routerId}/restore-client`, { client_ip: cmdClientIp }) as typeof res
      } else {
        res = await apiClient.post(`/routers/${routerId}/set-bandwidth`, {
          client_ip: cmdClientIp, client_name: cmdClientName,
          download_mbps: parseInt(cmdDownload), upload_mbps: parseInt(cmdUpload)
        }) as typeof res
      }
      const ok = Boolean(res.success)
      setCmdResult({ success: ok, message: res.message || res.action || (ok ? 'Ejecutado' : res.error || 'Error') })
      if (ok) toast.success('Comando ejecutado')
      else toast.error(res.error || 'Error ejecutando comando')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error'
      setCmdResult({ success: false, message: msg })
      toast.error(msg)
    } finally {
      setCmdLoading(false)
    }
  }

  // ── Tabs navigation ────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; Icon: React.ElementType }[] = [
    { id: 'monitor',  label: 'Heartbeat Monitor', Icon: SignalIcon },
    { id: 'vpn',      label: 'VPN Orquestador',   Icon: ShieldCheckIcon },
    { id: 'security', label: 'Seguridad API',      Icon: LockClosedIcon },
    { id: 'commands', label: 'Comandos ISP',       Icon: BoltIcon },
  ]

  const summary = connectivity?.summary
  const routers = connectivity?.routers || []

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-coral-500">ISP Orquestador</p>
          <h2 className="text-2xl font-bold text-slate-900">Dashboard de Conectividad</h2>
          <p className="text-sm text-slate-700">Los 4 pilares del sistema ISP profesional</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded border-slate-600"
            />
            Auto-refresh 60s
          </label>
          <button onClick={() => void loadConnectivity()} disabled={loadingConn} className={btnSecondary}>
            <ArrowPathIcon className={`h-4 w-4 ${loadingConn ? 'animate-spin' : ''}`} />
            Refrescar
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: 'Total',         val: summary.total,           cls: 'text-slate-950' },
            { label: 'En línea',      val: summary.online,          cls: 'text-emerald-700' },
            { label: 'Offline',       val: summary.offline,         cls: 'text-rose-700' },
            { label: 'Advertencia',   val: summary.warning,         cls: 'text-amber-700' },
            { label: 'Sin conectar',  val: summary.never_connected, cls: 'text-slate-700' },
          ].map(item => (
            <div key={item.label} className={card}>
              <p className="text-xs text-slate-600">{item.label}</p>
              <p className={`mt-1 text-3xl font-bold ${item.cls}`}>{item.val}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === t.id
                ? 'bg-coral-500 text-white shadow'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <t.Icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB 1: Heartbeat Monitor ─────────────────────────────────────── */}
      {tab === 'monitor' && (
        <div className="space-y-4">
          {loadingConn && !connectivity && (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <ArrowPathIcon className="mr-2 h-5 w-5 animate-spin" /> Cargando datos de conectividad...
            </div>
          )}

          {connectivity?.generated_at && (
            <p className="text-right text-[10px] text-slate-700">
              Último check: {new Date(connectivity.generated_at).toLocaleString('es-CO')}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {routers.map((r, i) => {
              const cfg = statusConfig[r.status] || statusConfig.never_connected
              return (
                <motion.div
                  key={r.router_id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={`rounded-2xl border p-4 shadow-sm ${
                    r.status === 'offline' ? 'border-rose-200 bg-rose-50' :
                    r.status === 'warning' ? 'border-amber-200 bg-amber-50' :
                    r.status === 'online'  ? 'border-emerald-200 bg-emerald-50' :
                    'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`mt-0.5 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${cfg.dot} ${r.status === 'online' ? 'animate-pulse' : ''}`} />
                      <p className="text-sm font-semibold text-slate-800">{r.router_name}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-slate-700">
                    <p>IP VPN: <span className="font-mono text-slate-700">{r.vpn_ip || 'No asignada'}</span></p>
                    <p>API Port: <span className="text-slate-600">{r.api_port || 8728}</span></p>
                    <p>Último contacto: <span className="text-slate-600">{formatLastSeen(r.last_seen, r.minutes_since_seen)}</span></p>
                  </div>

                  {r.status === 'offline' && (
                    <div className="mt-3 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs text-rose-600">
                      ⚠ MikroTik Offline — Verifica el túnel SSTP en el equipo
                    </div>
                  )}
                </motion.div>
              )
            })}
          </div>

          {!loadingConn && routers.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-500">
              <ServerIcon className="h-10 w-10 opacity-30" />
              <p className="text-sm">No hay routers registrados en el sistema</p>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: VPN Orchestrator ──────────────────────────────────────── */}
      {tab === 'vpn' && (
        <div className="space-y-4">
          <div className={`${card} border-l-4 border-l-coral-500`}>
            <p className="text-xs font-semibold uppercase text-coral-500">Pilar 1 — Orquestador VPN</p>
            <p className="mt-1 text-sm text-slate-700">
              El sistema configura automáticamente un servidor SSTP nativo por router y guarda las credenciales de
              gestión cada vez que se provisiona. Usa "Provisionar" para re-generar credenciales o para routers
              existentes que aún no tienen SSTP nativo asignado.
            </p>
          </div>

          {/* VPN Sessions */}
          <div className={card}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <WifiIcon className="h-4 w-4 text-coral-500" /> Servidores SSTP Nativos Activos
              </h3>
              <button onClick={() => void loadVpnSessions()} disabled={loadingVpnSessions} className={btnSecondary}>
                <ArrowPathIcon className={`h-3.5 w-3.5 ${loadingVpnSessions ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {vpnSessions ? (
              vpnSessions.sessions.length > 0 ? (
                <div className="mt-3 divide-y divide-white/5">
                  {vpnSessions.sessions.map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-2 text-xs">
                      <span className="font-mono text-slate-300">{s.username || s.name || `sesión-${i}`}</span>
                      <span className="text-slate-400">{s.ip || '—'}</span>
                      <span className="text-slate-500">{s.connected_at || '—'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-700">Sin servidores SSTP activos registrados.</p>
              )
            ) : (
              <p className="mt-3 text-xs text-slate-700">Cargando sesiones...</p>
            )}
          </div>

          {/* Per-router VPN */}
          <div className="space-y-3">
            {routers.map(r => {
              const vpnRes = vpnResults[r.router_id]
              const isProvisioning = provisioningId === r.router_id
              return (
                <div key={r.router_id} className={card}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{r.router_name}</p>
                      <p className="text-xs text-slate-700">
                        IP VPN: <span className="font-mono text-coral-500">{vpnRes?.vpn_ip || r.vpn_ip || 'Por asignar'}</span>
                        {vpnRes?.vpn_username && (
                          <span className="ml-3">Usuario: <span className="font-mono text-emerald-600">{vpnRes.vpn_username}</span></span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void provisionVpn(r.router_id)}
                        disabled={isProvisioning}
                        className={btnPrimary}
                      >
                        {isProvisioning ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <ShieldCheckIcon className="h-4 w-4" />}
                        {isProvisioning ? 'Provisionando...' : 'Provisionar SSTP'}
                      </button>
                      <button
                        onClick={() => void loadOnboardingScript(r.router_id, r.router_name)}
                        className={btnSecondary}
                      >
                        <DocumentTextIcon className="h-4 w-4" />
                        Script RouterOS
                      </button>
                    </div>
                  </div>

                  {vpnRes && (
                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                      <p>✓ SSTP nativo provisionado</p>
                      {vpnRes.sstp_url && <p>URL: <span className="font-mono">{vpnRes.sstp_url}</span></p>}
                    </div>
                  )}
                </div>
              )
            })}

            {routers.length === 0 && (
              <p className="text-center text-sm text-slate-700 py-8">No hay routers. Agrega uno en el módulo MikroTik.</p>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 3: API Security ──────────────────────────────────────────── */}
      {tab === 'security' && (
        <div className="space-y-4">
          <div className={`${card} border-l-4 border-l-amber-500`}>
            <p className="text-xs font-semibold uppercase text-amber-400">Pilar 3 — Seguridad de la API REST</p>
            <p className="mt-1 text-sm text-slate-300">
              Configura el MikroTik remoto para que <strong className="text-white">solo acepte conexiones API desde la IP interna del VPN</strong> (10.100.0.1).
              También aplica reglas de firewall para bloquear intentos externos de fuerza bruta.
            </p>
          </div>

          <div className={`${card}`}>
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Reglas de seguridad aplicadas:</h3>
            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex items-start gap-2"><CheckCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" /> <span><strong>IP Service restrict:</strong> Limita /ip service api al rango 10.100.0.0/16 (solo VPN interna)</span></li>
              <li className="flex items-start gap-2"><CheckCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" /> <span><strong>Drop externa:</strong> Firewall descarta paquetes API (8728/8729) fuera de la VPN</span></li>
              <li className="flex items-start gap-2"><CheckCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" /> <span><strong>Anti brute-force:</strong> Rate limit en intentos de login a la API</span></li>
            </ul>
          </div>

          <div className="space-y-3">
            {routers.map(r => {
              const secRes = securityResults[r.router_id]
              const isSecuring = securingId === r.router_id
              return (
                <div key={r.router_id} className={card}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{r.router_name}</p>
                      <p className="text-xs text-slate-700">IP VPN: {r.vpn_ip || 'No asignada'} | Puerto API: {r.api_port || 8728}</p>
                    </div>
                    <button
                      onClick={() => void secureApi(r.router_id)}
                      disabled={isSecuring || !r.vpn_ip}
                      className={btnSuccess}
                      title={!r.vpn_ip ? 'Requiere SSTP nativo provisionado primero' : ''}
                    >
                      {isSecuring ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <LockClosedIcon className="h-4 w-4" />}
                      {isSecuring ? 'Aplicando...' : 'Asegurar API'}
                    </button>
                  </div>

                  {!r.vpn_ip && (
                    <p className="mt-2 text-xs text-amber-400">⚠ Este router no tiene IP VPN asignada. Provisiona el VPN primero.</p>
                  )}

                  {secRes && (
                    <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${secRes.success ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                      {secRes.success ? '✓' : '✗'} {secRes.message}
                    </div>
                  )}
                </div>
              )
            })}

            {routers.length === 0 && (
              <p className="text-center text-sm text-slate-700 py-8">No hay routers registrados.</p>
            )}
          </div>

          <div className={`${card} mt-4`}>
            <h3 className="mb-2 text-sm font-semibold text-slate-800 flex items-center gap-2">
              <DocumentTextIcon className="h-4 w-4 text-amber-600" /> Recomendación: iptables en el servidor VPS
            </h3>
            <p className="mb-2 text-xs text-slate-400">Ejecuta esto en el servidor Ubuntu para que nadie fuera de la VPN pueda acceder a los puertos API de los MikroTik:</p>
            <div className="relative rounded-lg bg-slate-950 p-3 font-mono text-xs text-emerald-300">
              <button
                onClick={async () => {
                  const cmd = `# Solo permite API MikroTik desde VPN interna\niptables -I DOCKER-USER -p tcp --dport 8728 -s 10.100.0.0/16 -j ACCEPT\niptables -I DOCKER-USER -p tcp --dport 8728 ! -s 10.100.0.0/16 -j DROP\niptables -I DOCKER-USER -p tcp --dport 8729 -s 10.100.0.0/16 -j ACCEPT\niptables -I DOCKER-USER -p tcp --dport 8729 ! -s 10.100.0.0/16 -j DROP\n# Guardar reglas\nnetfilter-persistent save`
                  const ok = await copyToClipboard(cmd)
                  if (ok) toast.success('Copiado al portapapeles')
                }}
                className="absolute right-2 top-2 rounded p-1 text-slate-500 hover:text-white"
              >
                <ClipboardDocumentIcon className="h-4 w-4" />
              </button>
              <pre className="whitespace-pre-wrap text-[11px]">{`# Solo permite API MikroTik desde VPN interna
iptables -I DOCKER-USER -p tcp --dport 8728 -s 10.100.0.0/16 -j ACCEPT
iptables -I DOCKER-USER -p tcp --dport 8728 ! -s 10.100.0.0/16 -j DROP
iptables -I DOCKER-USER -p tcp --dport 8729 -s 10.100.0.0/16 -j ACCEPT
iptables -I DOCKER-USER -p tcp --dport 8729 ! -s 10.100.0.0/16 -j DROP
# Guardar reglas
netfilter-persistent save`}</pre>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 4: Commands ──────────────────────────────────────────────── */}
      {tab === 'commands' && (
        <div className="space-y-4">
          <div className={`${card} border-l-4 border-l-violet-500`}>
            <p className="text-xs font-semibold uppercase text-violet-600">Pilar 4 — Plantillas de Comandos</p>
            <p className="mt-1 text-sm text-slate-700">
              Ejecuta comandos en tiempo real en cualquier router: corte por mora, reactivación,
              control de ancho de banda y lectura de tráfico. Todos los cambios se aplican
              directamente en el RouterOS vía API.
            </p>
          </div>

          <div className={card}>
            <h3 className="mb-4 text-sm font-bold text-slate-800">Parámetros de comando</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Router</label>
                <select
                  value={cmdRouterIds}
                  onChange={e => setCmdRouterIds(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Seleccionar router...</option>
                  {routers.map(r => (
                    <option key={r.router_id} value={r.router_id}>{r.router_name} ({r.vpn_ip || r.router_id})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">IP del cliente</label>
                <input value={cmdClientIp} onChange={e => setCmdClientIp(e.target.value)} placeholder="192.168.1.100" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Nombre cliente (opcional)</label>
                <input value={cmdClientName} onChange={e => setCmdClientName(e.target.value)} placeholder="Juan Pérez" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Bajada (Mbps)</label>
                  <input type="number" value={cmdDownload} onChange={e => setCmdDownload(e.target.value)} min="1" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Subida (Mbps)</label>
                  <input type="number" value={cmdUpload} onChange={e => setCmdUpload(e.target.value)} min="1" className={inputCls} />
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={() => void runCommand('suspend')} disabled={cmdLoading} className={btnDanger}>
                {cmdLoading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <XCircleIcon className="h-4 w-4" />}
                Corte por mora
              </button>
              <button onClick={() => void runCommand('restore')} disabled={cmdLoading} className={btnSuccess}>
                {cmdLoading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckCircleIcon className="h-4 w-4" />}
                Reactivar cliente
              </button>
              <button onClick={() => void runCommand('bandwidth')} disabled={cmdLoading} className={btnPrimary}>
                {cmdLoading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <BoltIcon className="h-4 w-4" />}
                Cambiar velocidad
              </button>
            </div>

            {cmdResult && (
              <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
                cmdResult.success ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              }`}>
                {cmdResult.success ? '✓' : '✗'} {cmdResult.message}
              </div>
            )}
          </div>

          {/* Command reference */}
          <div className={card}>
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Referencia de comandos RouterOS</h3>
            <div className="space-y-3">
              {[
                { title: 'Corte por mora', color: 'rose', cmd: '/ip firewall address-list add list=fastisp-morosos address=<IP> comment="FASTISP-MOROSO: Cliente"' },
                { title: 'Reactivar cliente', color: 'emerald', cmd: '/ip firewall address-list remove [find list=fastisp-morosos address=<IP>]' },
                { title: 'Limitar velocidad', color: 'cyan', cmd: '/queue simple add name="FASTISP-<IP>" target=<IP> max-limit=<UP>M/<DOWN>M' },
                { title: 'Ver tráfico interface', color: 'violet', cmd: ':put [/interface monitor-traffic ether1 once as-value]' },
              ].map(item => (
                <div key={item.title} className="rounded-lg border border-white/5 bg-slate-950/60 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-600">{item.title}</p>
                    <button
                      onClick={async () => { if (await copyToClipboard(item.cmd)) toast.success('Copiado') }}
                      className="text-slate-500 hover:text-white"
                    >
                      <ClipboardDocumentIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <pre className="mt-1 overflow-x-auto text-[11px] text-emerald-400">{item.cmd}</pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Onboarding Script Modal ──────────────────────────────────────── */}
      {showScriptModal && (
        <div className="fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
          <div className="my-4 w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase text-coral-500">Script de Onboarding</p>
                <h3 className="text-lg font-bold text-slate-800">{showScriptModal.name}</h3>
                <p className="text-xs text-slate-700">Copia y pega este script en Terminal del MikroTik (New Terminal)</p>
              </div>
              <button onClick={() => setShowScriptModal(null)} className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4">
              <div className="relative rounded-xl bg-slate-950 p-4">
                <button
                  onClick={async () => { if (await copyToClipboard(showScriptModal.script)) toast.success('Script copiado al portapapeles') }}
                  className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
                >
                  <ClipboardDocumentIcon className="h-3.5 w-3.5" /> Copiar
                </button>
                <pre className="max-h-96 overflow-auto text-[11px] leading-relaxed text-emerald-300 whitespace-pre-wrap">
                  {showScriptModal.script}
                </pre>
              </div>
              <div className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-xs text-cyan-300">
                <strong>Instrucciones:</strong>
                <ol className="mt-1 list-decimal pl-4 space-y-1">
                  <li>En el MikroTik: Abrir Winbox → New Terminal</li>
                  <li>Pegar el script completo y presionar Enter</li>
                  <li>El MikroTik se conectará al túnel SSTP automáticamente</li>
                  <li>Verificar en este panel que el estado cambie a "En línea"</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}

export default ConnectivityDashboard
