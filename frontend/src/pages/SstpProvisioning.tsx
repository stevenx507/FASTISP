/**
 * SSTP VPN Provisioning Panel (MikroTik Native)
 * ==============================================
 * Panel para gestionar servidores SSTP nativos en routers MikroTik de clientes ISP.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheckIcon,
  PlusIcon,
  ArrowDownTrayIcon,
  ClipboardDocumentIcon,
  ArrowPathIcon,
  TrashIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  CommandLineIcon,
  WifiIcon,
  KeyIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ServerIcon,
  SignalIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon as CheckCircleSolid, SignalIcon as SignalSolid } from '@heroicons/react/24/solid'
import { apiClient } from '../lib/apiClient'

// ── Types ──────────────────────────────────────────────────────────────────────
interface SstpTunnel {
  id: number
  router_id: number
  router_name: string
  tenant_id: number | null
  username: string
  password?: string
  server_ip: string
  client_ip: string
  server_host: string
  server_port: number
  status: 'active' | 'revoked' | 'pending'
  last_seen: string | null
  created_at: string
  revoked_at: string | null
  script?: string
  verification_script?: string
  api_applied?: boolean
  api_results?: string[]
  message?: string
}

interface Router {
  id: number
  name: string
  ip_address: string
  status: string
}

interface ConnectionTest {
  success: boolean
  status: string
  summary: string
  checks?: { id: string; ok: boolean; detail: string; severity: string }[]
  recommendations?: string[]
  runtime?: { tcp_latency_ms?: number; dns_lookup_ms?: number }
}

interface SstpStatus {
  total_tunnels: number
  active_tunnels: number
  revoked_tunnels: number
  certificate_fingerprint: string
  server_port: number
  architecture: string
  ip_pool: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const statusColor = (status: string) => {
  switch (status) {
    case 'active': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
    case 'revoked': return 'text-red-400 bg-red-400/10 border-red-400/30'
    default: return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30'
  }
}

const statusLabel = (status: string) => {
  switch (status) {
    case 'active': return 'Activo'
    case 'revoked': return 'Revocado'
    default: return 'Pendiente'
  }
}

const isRecentlySeen = (lastSeen: string | null): boolean => {
  if (!lastSeen) return false
  const diff = Date.now() - new Date(lastSeen).getTime()
  return diff < 5 * 60 * 1000
}

const formatLastSeen = (lastSeen: string | null): string => {
  if (!lastSeen) return 'Sin actividad'
  const diff = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000)
  if (diff < 60) return `Hace ${diff}s`
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)}m`
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)}h`
  return new Date(lastSeen).toLocaleDateString('es-CO')
}

// ── Script Modal ───────────────────────────────────────────────────────────────
const ScriptModal: React.FC<{
  tunnel: SstpTunnel
  onClose: () => void
  onDownload: () => void
}> = ({ tunnel, onClose, onDownload }) => {
  const [copied, setCopied] = useState(false)
  const [showVerify, setShowVerify] = useState(false)

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white border border-gray-200 shadow-xl rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl" onClick={(event) => event.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-lg border border-cyan-500/20">
              <CommandLineIcon className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-slate-800 font-bold">Script del Servidor SSTP</h2>
              <p className="text-slate-500 text-sm">{tunnel.router_name} · {tunnel.username}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 transition-colors text-xl">✕</button>
        </div>

        {/* Info banner */}
        <div className="mx-5 mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg flex gap-2">
          <InformationCircleIcon className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-blue-300 text-sm">
            <strong>API Auto-provisioning:</strong> Si el router está online, el script se aplicará automáticamente.
            Si falla, pega este script en <strong>Winbox → New Terminal</strong> del MikroTik.
          </p>
        </div>

        {/* Credentials summary */}
        <div className="mx-5 mt-3 grid grid-cols-2 gap-2">
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-slate-500 text-xs mb-1">Servidor SSTP (router)</p>
            <p className="text-slate-800 font-mono text-sm">{tunnel.server_host}:{tunnel.server_port}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-slate-500 text-xs mb-1">Usuario PPP</p>
            <p className="text-slate-800 font-mono text-sm">{tunnel.username}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-slate-500 text-xs mb-1">Gateway local</p>
            <p className="text-slate-800 font-mono text-sm">{tunnel.server_ip}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-slate-500 text-xs mb-1">Primer cliente</p>
            <p className="text-slate-800 font-mono text-sm">{tunnel.client_ip}</p>
          </div>
        </div>

        {/* Script tabs */}
        <div className="flex gap-2 mx-5 mt-3">
          <button
            onClick={() => setShowVerify(false)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              !showVerify ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Script del Servidor SSTP
          </button>
          <button
            onClick={() => setShowVerify(true)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              showVerify ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Script de Verificación
          </button>
        </div>

        {/* Script content */}
        <div className="flex-1 overflow-hidden mx-5 mt-2 mb-5">
          <div className="relative">
            <pre className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-slate-700 font-mono overflow-auto h-64 leading-relaxed whitespace-pre-wrap">
              {showVerify ? tunnel.verification_script : tunnel.script}
            </pre>
            <button
              onClick={() => handleCopy(showVerify ? tunnel.verification_script || '' : tunnel.script || '')}
              className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-slate-700 border border-gray-200 text-xs rounded-lg transition-colors"
            >
              {copied
                ? <CheckCircleSolid className="w-3.5 h-3.5 text-emerald-400" />
                : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onDownload}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            Descargar .rsc
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-slate-700 border border-gray-200 rounded-lg text-sm font-medium transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Provision Modal ────────────────────────────────────────────────────────────
const ProvisionModal: React.FC<{
  routers: Router[]
  onClose: () => void
  onProvision: (routerId: number, notes: string) => Promise<void>
  loading: boolean
}> = ({ routers, onClose, onProvision, loading }) => {
  const [selectedRouter, setSelectedRouter] = useState<number | null>(null)
  const [notes, setNotes] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white border border-gray-200 shadow-xl rounded-2xl w-full max-w-md shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
              <PlusIcon className="w-5 h-5 text-emerald-400" />
            </div>
            <h2 className="text-slate-800 font-bold">Configurar Servidor SSTP</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 transition-colors text-xl">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="sstp-router-select" className="block text-slate-500 text-sm font-medium mb-2">
              Router MikroTik
            </label>
            <select
              id="sstp-router-select"
              title="Seleccionar router MikroTik"
              value={selectedRouter || ''}
              onChange={e => setSelectedRouter(Number(e.target.value))}
              className="w-full bg-white border border-gray-200 text-slate-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500"
            >
              <option value="">Seleccionar router...</option>
              {routers.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.ip_address})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sstp-notes" className="block text-slate-500 text-sm font-medium mb-2">
              Notas (opcional)
            </label>
            <textarea
              id="sstp-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ej: Router principal sede norte..."
              rows={3}
              className="w-full bg-white border border-gray-200 text-slate-800 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500 resize-none"
            />
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 flex gap-2">
            <ExclamationTriangleIcon className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
            <p className="text-yellow-300 text-xs">
              Se configurará el MikroTik como <strong>servidor SSTP nativo</strong> con certificados propios, pool de IPs y PPP secrets. Si el router está online, se aplicará automáticamente vía API.
            </p>
          </div>
        </div>

        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={() => selectedRouter && onProvision(selectedRouter, notes)}
            disabled={!selectedRouter || loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading
              ? <ArrowPathIcon className="w-4 h-4 animate-spin" />
              : <ShieldCheckIcon className="w-4 h-4" />}
            {loading ? 'Configurando...' : 'Configurar Servidor SSTP'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-slate-700 border border-gray-200 rounded-lg text-sm font-medium transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
const SstpProvisioning: React.FC = () => {
  const [tunnels, setTunnels] = useState<SstpTunnel[]>([])
  const [routers, setRouters] = useState<Router[]>([])
  const [status, setStatus] = useState<SstpStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [provisionLoading, setProvisionLoading] = useState(false)
  const [showProvisionModal, setShowProvisionModal] = useState(false)
  const [selectedTunnel, setSelectedTunnel] = useState<SstpTunnel | null>(null)
  const [showScriptModal, setShowScriptModal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'revoked'>('all')
  const [testingConnection, setTestingConnection] = useState<number | null>(null)
  const [connectionResult, setConnectionResult] = useState<Record<number, ConnectionTest>>({})

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowProvisionModal(false)
        setShowScriptModal(false)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [])

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 4000)
  }

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [tunnelsData, routersData, statusData] = await Promise.all([
        apiClient.get('/sstp/tunnels') as Promise<SstpTunnel[]>,
        apiClient.get('/routers') as Promise<Router[]>,
        apiClient.get('/sstp/status') as Promise<SstpStatus>,
      ])
      setTunnels(Array.isArray(tunnelsData) ? tunnelsData : [])
      setRouters(Array.isArray(routersData) ? routersData : [])
      setStatus(statusData)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error cargando datos'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleProvision = async (routerId: number, notes: string) => {
    try {
      setProvisionLoading(true)
      const newTunnel = await apiClient.post('/sstp/tunnels', { router_id: routerId, notes }) as SstpTunnel
      setTunnels(prev => [newTunnel, ...prev])
      setShowProvisionModal(false)
      setShowScriptModal(false)
      setSelectedTunnel(newTunnel)
      setShowScriptModal(true)
      showSuccess(newTunnel.message || 'Servidor SSTP configurado')
      loadData()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al configurar servidor'
      setError(msg)
    } finally {
      setProvisionLoading(false)
    }
  }

  const handleViewScript = async (tunnel: SstpTunnel) => {
    try {
      const data = await apiClient.get(`/sstp/tunnels/${tunnel.id}`) as SstpTunnel
      setShowProvisionModal(false)
      setSelectedTunnel(data)
      setShowScriptModal(true)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error cargando script'
      setError(msg)
    }
  }

  const handleDownloadScript = async (tunnel: SstpTunnel) => {
    try {
      // FIX #4: Obtener token desde Zustand en lugar de localStorage
      const { useAuthStore } = await import('../store/authStore')
      const token = useAuthStore.getState().token || ''
      
      const apiBase = (window as unknown as { __API_BASE__?: string }).__API_BASE__ || '/api'
      const response = await fetch(`${apiBase}/sstp/tunnels/${tunnel.id}/script`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const text = await response.text()
      const blob = new Blob([text], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fastisp-sstp-${tunnel.username}.rsc`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error descargando script'
      setError(msg)
    }
  }

  const handleRegenerate = async (tunnel: SstpTunnel) => {
    if (!confirm(`¿Regenerar credenciales para ${tunnel.router_name}? El script anterior dejará de funcionar.`)) return
    try {
      const data = await apiClient.post(`/sstp/tunnels/${tunnel.id}/regenerate`) as SstpTunnel
      setShowProvisionModal(false)
      setSelectedTunnel(data)
      setShowScriptModal(true)
      showSuccess(data.message || 'Credenciales regeneradas')
      loadData()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error regenerando credenciales'
      setError(msg)
    }
  }

  const handleRevoke = async (tunnel: SstpTunnel) => {
    if (!confirm(`¿Revocar el túnel de ${tunnel.router_name}? El MikroTik perderá conectividad.`)) return
    try {
      await apiClient.delete(`/sstp/tunnels/${tunnel.id}`)
      showSuccess(`Túnel ${tunnel.username} revocado`)
      loadData()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error revocando túnel'
      setError(msg)
    }
  }

  const handleTestConnection = async (tunnel: SstpTunnel) => {
    setTestingConnection(tunnel.id)
    try {
      const data = await apiClient.get(`/routers/${tunnel.router_id}/test-connection`) as ConnectionTest
      setConnectionResult(prev => ({ ...prev, [tunnel.id]: data }))
      if (data.success) {
        showSuccess(`Conexión verificada: ${tunnel.router_name} alcanzable (${data.runtime?.tcp_latency_ms ?? '?'}ms)`)
      } else {
        setError(`${tunnel.router_name}: ${data.summary || 'No alcanzable'}`)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error testeando conexión'
      setConnectionResult(prev => ({ ...prev, [tunnel.id]: { success: false, status: 'error', summary: msg } }))
      setError(msg)
    } finally {
      setTestingConnection(null)
    }
  }

  const filteredTunnels = tunnels.filter(t =>
    filterStatus === 'all' ? true : t.status === filterStatus
  )

  return (
    <div className="min-h-screen bg-transparent text-slate-800 p-6">
      {/* Header */}
      <div className="relative mb-8 rounded-2xl overflow-hidden bg-white shadow-sm border border-black/5 p-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-cyan-500/10 via-transparent to-transparent pointer-events-none" />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-cyan-500/15 rounded-2xl border border-cyan-500/30 shadow-lg shadow-cyan-500/10">
              <ShieldCheckIcon className="w-8 h-8 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-800">Servidores SSTP Nativo MikroTik</h1>
                <span className="px-2 py-0.5 bg-cyan-500/20 border border-cyan-500/30 rounded-full text-cyan-300 text-xs font-medium">VPN</span>
              </div>
              <p className="text-slate-500 text-sm mt-0.5">Aprovisionamiento automático vía API MikroTik para routers clientes ISP</p>
            </div>
          </div>
          <button
            onClick={() => setShowProvisionModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:-translate-y-0.5"
          >
            <PlusIcon className="w-4 h-4" />
            Nuevo Servidor SSTP
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-2 text-red-300 text-sm">
          <XCircleIcon className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-200">✕</button>
        </div>
      )}
      {successMsg && (
        <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2 text-emerald-300 text-sm">
          <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Stats */}
      {status && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-black/5 shadow-sm rounded-xl p-4 hover:border-emerald-500/40 transition-all hover:shadow-lg hover:shadow-emerald-500/5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-500 text-xs font-medium">Servidores Activos</p>
              <div className="p-1.5 bg-emerald-500/10 rounded-lg"><SignalSolid className="w-4 h-4 text-emerald-400" /></div>
            </div>
            <p className="text-3xl font-bold text-emerald-400">{status.active_tunnels}</p>
            <p className="text-slate-500 text-xs mt-1">de {status.total_tunnels} totales</p>
          </div>
          <div className="bg-white border border-black/5 shadow-sm rounded-xl p-4 hover:border-gray-600 transition-all hover:shadow-lg hover:shadow-gray-500/5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-500 text-xs font-medium">Total Servidores</p>
              <div className="p-1.5 bg-gray-500/10 rounded-lg"><WifiIcon className="w-4 h-4 text-slate-500" /></div>
            </div>
            <p className="text-3xl font-bold text-slate-800">{status.total_tunnels}</p>
            <p className="text-slate-500 text-xs mt-1">{status.revoked_tunnels} revocados</p>
          </div>
          <div className="bg-white border border-black/5 shadow-sm rounded-xl p-4 hover:border-cyan-500/40 transition-all hover:shadow-lg hover:shadow-cyan-500/5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-500 text-xs font-medium">Arquitectura</p>
              <div className="p-1.5 bg-cyan-500/10 rounded-lg"><ServerIcon className="w-4 h-4 text-cyan-400" /></div>
            </div>
            <p className="text-sm font-mono text-cyan-400 font-bold">{status.architecture}</p>
            <p className="text-slate-500 text-xs mt-1">Puerto {status.server_port}</p>
          </div>
          <div className="bg-white border border-black/5 shadow-sm rounded-xl p-4 hover:border-purple-500/40 transition-all hover:shadow-lg hover:shadow-purple-500/5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-500 text-xs font-medium">Pool de IPs</p>
              <div className="p-1.5 bg-purple-500/10 rounded-lg"><SignalIcon className="w-4 h-4 text-purple-400" /></div>
            </div>
            <p className="text-sm font-mono text-purple-400 font-bold">{status.ip_pool}</p>
            <p className="text-slate-500 text-xs mt-1">SSTP VPN Pool</p>
          </div>
        </div>
      )}

      {/* Certificate info */}
      {status?.certificate_fingerprint && status.certificate_fingerprint !== 'UNKNOWN' && (
        <div className="mb-6 p-3 bg-white border border-gray-200 shadow-xl rounded-xl flex items-center gap-3">
          <KeyIcon className="w-4 h-4 text-yellow-400 flex-shrink-0" />
          <div>
            <p className="text-slate-500 text-xs">Huella del certificado (CA MikroTik)</p>
            <p className="text-yellow-300 font-mono text-xs break-all">{status.certificate_fingerprint}</p>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all', 'active', 'revoked'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilterStatus(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filterStatus === f
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-500 hover:text-slate-800 border border-transparent'
            }`}
          >
            {f === 'all' ? 'Todos' : f === 'active' ? 'Activos' : 'Revocados'}
          </button>
        ))}
        <button
          onClick={loadData}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-slate-500 hover:text-slate-800 text-sm transition-colors"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {/* Tunnels list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <ArrowPathIcon className="w-8 h-8 text-cyan-400 animate-spin" />
        </div>
      ) : filteredTunnels.length === 0 ? (
        <div className="text-center py-24 rounded-2xl border border-dashed border-gray-200 bg-white/50">
          <div className="p-4 bg-cyan-500/10 rounded-2xl border border-cyan-500/20 inline-flex mb-4">
            <ShieldCheckIcon className="w-10 h-10 text-cyan-500/60" />
          </div>
          <p className="text-slate-500 font-medium text-lg">Sin servidores SSTP nativos</p>
          <p className="text-slate-500 text-sm mt-1 max-w-xs mx-auto">Configura el primer router MikroTik como servidor SSTP nativo</p>
          <button
            onClick={() => setShowProvisionModal(true)}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-semibold transition-all"
          >
            <PlusIcon className="w-4 h-4" />
            Nuevo Servidor SSTP
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTunnels.map(tunnel => (
            <div
              key={tunnel.id}
              className={`bg-white border rounded-xl p-4 transition-all hover:-translate-y-0.5 ${
                tunnel.status === 'active'
                  ? 'border-gray-200 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5'
                  : 'border-gray-100 opacity-70 hover:border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={`p-2.5 rounded-xl border flex-shrink-0 ${
                    tunnel.status === 'active'
                      ? 'bg-emerald-500/10 border-emerald-500/20'
                      : 'bg-red-500/10 border-red-500/20'
                  }`}>
                    <WifiIcon className={`w-5 h-5 ${tunnel.status === 'active' ? 'text-emerald-400' : 'text-red-400'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-slate-800 font-bold">{tunnel.router_name}</h3>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${statusColor(tunnel.status)}`}>
                        {tunnel.status === 'active'
                          ? <CheckCircleIcon className="w-3 h-3" />
                          : tunnel.status === 'revoked'
                          ? <XCircleIcon className="w-3 h-3" />
                          : <ClockIcon className="w-3 h-3" />}
                        {statusLabel(tunnel.status)}
                      </span>
                      {tunnel.status === 'active' && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                          isRecentlySeen(tunnel.last_seen)
                            ? 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30'
                            : 'text-slate-500 bg-gray-500/10 border-gray-500/20'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            isRecentlySeen(tunnel.last_seen) ? 'bg-cyan-400 animate-pulse' : 'bg-gray-500'
                          }`} />
                          {isRecentlySeen(tunnel.last_seen) ? 'En línea' : formatLastSeen(tunnel.last_seen)}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5">
                      <div>
                        <p className="text-slate-500 text-xs">Usuario PPP</p>
                        <p className="text-slate-500 font-mono text-xs truncate">{tunnel.username}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs">Gateway</p>
                        <p className="text-slate-500 font-mono text-xs">{tunnel.server_ip}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs">Pool inicio</p>
                        <p className="text-slate-500 font-mono text-xs">{tunnel.client_ip}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs">Creado</p>
                        <p className="text-slate-500 text-xs">
                          {new Date(tunnel.created_at).toLocaleDateString('es-CO')}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                {tunnel.status === 'active' && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleTestConnection(tunnel)}
                      title="Verificar conexi\u00f3n al router"
                      disabled={testingConnection === tunnel.id}
                      className="p-2 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <SignalIcon className={`w-4 h-4 ${testingConnection === tunnel.id ? 'animate-pulse' : ''}`} />
                    </button>
                    <button
                      onClick={() => handleViewScript(tunnel)}
                      title="Ver script de aprovisionamiento"
                      className="p-2 text-slate-500 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors"
                    >
                      <CommandLineIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDownloadScript(tunnel)}
                      title="Descargar script .rsc"
                      className="p-2 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleRegenerate(tunnel)}
                      title="Regenerar credenciales"
                      className="p-2 text-slate-500 hover:text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors"
                    >
                      <ArrowPathIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleRevoke(tunnel)}
                      title="Revocar t\u00fanel"
                      className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Connection test result inline */}
              {connectionResult[tunnel.id] && (
                <div className={`mt-3 p-3 rounded-lg border text-xs ${
                  connectionResult[tunnel.id].success
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                    : 'bg-red-500/10 border-red-500/20 text-red-300'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {connectionResult[tunnel.id].success
                        ? <CheckCircleIcon className="w-4 h-4 text-emerald-400" />
                        : <XCircleIcon className="w-4 h-4 text-red-400" />}
                      <span className="font-medium">{connectionResult[tunnel.id].summary}</span>
                    </div>
                    {connectionResult[tunnel.id].runtime?.tcp_latency_ms != null && (
                      <span className="px-2 py-0.5 bg-emerald-500/20 rounded-full text-emerald-300 font-mono text-[10px]">
                        {connectionResult[tunnel.id].runtime!.tcp_latency_ms}ms
                      </span>
                    )}
                  </div>
                  {connectionResult[tunnel.id].checks && (
                    <div className="mt-2 space-y-1">
                      {connectionResult[tunnel.id].checks!.map(check => (
                        <div key={check.id} className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${check.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          <span className="text-slate-500">{check.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {connectionResult[tunnel.id].recommendations && connectionResult[tunnel.id].recommendations!.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-200">
                      {connectionResult[tunnel.id].recommendations!.map((rec, i) => (
                        <p key={i} className="text-yellow-300/80 text-[11px]">- {rec}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* API applied indicator per tunnel */}
              {tunnel.api_applied && (
                <div className="mt-3 p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <div className="flex items-center gap-2 text-emerald-300 text-xs font-medium">
                    <CheckCircleIcon className="w-3.5 h-3.5" />
                    Aplicado autom\u00e1ticamente v\u00eda API MikroTik
                  </div>
                  {tunnel.api_results && tunnel.api_results.length > 0 && (
                    <details className="mt-1 text-emerald-400/80 text-[11px]">
                      <summary className="cursor-pointer hover:text-emerald-300">Ver detalles ({tunnel.api_results.length})</summary>
                      <pre className="mt-1 text-[10px] whitespace-pre-wrap">{tunnel.api_results.join('\n')}</pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* API Applied indicator (global, when script modal was opened) */}
      {selectedTunnel?.api_applied && !showScriptModal && (
        <div className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
          <div className="flex items-center gap-2 text-emerald-300 font-medium mb-2">
            <CheckCircleSolid className="w-5 h-5" />
            {selectedTunnel.router_name}: Configurado autom\u00e1ticamente v\u00eda API
          </div>
          {selectedTunnel.api_results && selectedTunnel.api_results.length > 0 && (
            <details className="text-emerald-400 text-xs">
              <summary className="cursor-pointer hover:text-emerald-300">Ver comandos aplicados ({selectedTunnel.api_results.length})</summary>
              <pre className="mt-2 bg-gray-50 rounded border border-gray-200 p-2 text-xs overflow-auto max-h-32">
                {selectedTunnel.api_results.join('\n')}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* Modals */}
      {showProvisionModal && (
        <ProvisionModal
          routers={routers.filter(r => r.status === 'online' || r.status === 'active')}
          onClose={() => setShowProvisionModal(false)}
          onProvision={handleProvision}
          loading={provisionLoading}
        />
      )}

      {showScriptModal && selectedTunnel && (
        <ScriptModal
          tunnel={selectedTunnel}
          onClose={() => { setShowScriptModal(false); setSelectedTunnel(null) }}
          onDownload={() => handleDownloadScript(selectedTunnel)}
        />
      )}
    </div>
  )
}

export default SstpProvisioning
