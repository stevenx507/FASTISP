import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChartBarIcon,
  CogIcon,
  ServerIcon,
  ShieldCheckIcon,
  UserGroupIcon,
  WifiIcon,
} from '@heroicons/react/24/outline'
import AIDiagnosis from './AIDiagnosis'
import ActionsHeader from './ActionsHeader'
import ConnectionsTab from './ConnectionsTab'
import OverviewTab from './OverviewTab'
import QueuesTab from './QueuesTab'
import SidePanels from './SidePanels'
import config from '../lib/config'
import { useAuthStore } from '../store/authStore'
import { RouterItem, RouterStats, Toast } from './types'

interface RouterListResponse {
  success: boolean
  routers: unknown[]
}

interface RouterCreateResponse {
  success: boolean
  router?: unknown
  connection_tested?: boolean
  reachable?: boolean | null
  diagnostics?: RouterConnectionDiagnosticsPayload | null
  error?: string
}

interface RouterConnectionDiagnosticsPayload {
  success?: boolean
  status?: string
  summary?: string
  host?: string
  api_port?: number
  host_scope?: string
  transport_hint?: string
  checks?: RouterReadinessCheck[]
  recommendations?: string[]
  runtime?: Record<string, unknown>
}

interface RouterConnectionActionResponse {
  success?: boolean
  error?: string
  diagnostics?: RouterConnectionDiagnosticsPayload | null
}

interface RouterConnectionSnapshot {
  diagnostics: RouterConnectionDiagnosticsPayload
  checkedAt: number
}

interface RememberConnectionDiagnosticsOptions {
  notifyOnChange?: boolean
  routerName?: string
}

interface RouterQuickScripts {
  direct_api_script: string
  wireguard_site_to_vps_script: string
  bth_enable_minimal_script?: string
  windows_login: string
  linux_login: string
}

interface RouterQuickGuidance {
  back_to_home: string[]
  notes: string[]
}

interface RouterConnectionPlanAction {
  id: string
  label: string
  description?: string
  script_key?: string
  requires_local_access?: boolean
  auto_available?: boolean
}

interface RouterConnectionPlan {
  status?: string
  title?: string
  summary?: string
  recommended_transport?: string
  actions?: RouterConnectionPlanAction[]
}

interface ExpressStepState {
  id: string
  label: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  detail?: string
}

interface RouterAccessProfile {
  requested_scope?: string
  detected_scope?: string
  effective_scope?: string
  is_ip?: boolean
  host?: string
  allows_direct_inbound?: boolean
  recommended_transport?: string
  reason?: string
}

interface RouterBackToHomeUser {
  name: string
  allow_lan: boolean
  disabled: boolean
  expires: string
}

interface RouterBackToHomeScripts {
  enable_script: string
  add_vps_user_script: string
  generate_private_key_hint: string
}

interface RouterBackToHomeStatus {
  reachable?: boolean
  routeros_version?: string | null
  supported?: boolean | null
  bth_users_supported?: boolean | null
  ddns_enabled?: boolean | null
  back_to_home_vpn?: string | null
  vpn_status?: string | null
  vpn_dns_name?: string | null
  vpn_interface?: string | null
  vpn_port?: string | null
  users?: RouterBackToHomeUser[]
  users_error?: string
  scripts?: RouterBackToHomeScripts
  managed_identity?: {
    enabled?: boolean
    source?: string
    key_source?: string
    user_name?: string
    public_key?: string | null
    tenant_id?: number | null
    created_now?: boolean
    error?: string | null
  }
  limitations?: string[]
  error?: string
}

interface RouterWireGuardProfile {
  endpoint?: string
  endpoint_host?: string
  endpoint_port?: number
  server_public_key?: string
  server_public_key_valid?: boolean
  allowed_subnets?: string
  ready?: boolean
  issues?: string[]
  source?: {
    endpoint?: string
    server_public_key?: string
    allowed_subnets?: string
  }
}

interface RouterQuickConnectResponse {
  success: boolean
  access_profile?: RouterAccessProfile
  connection_plan?: RouterConnectionPlan
  wireguard_profile?: RouterWireGuardProfile
  scripts?: RouterQuickScripts
  guidance?: RouterQuickGuidance
  back_to_home?: RouterBackToHomeStatus
}

interface RouterWireGuardRegisterAttempt {
  transport?: string
  success?: boolean
  mode?: string
  message?: string
}

interface RouterWireGuardRegisterVpsSync {
  success?: boolean
  mode?: string
  message?: string
  manual_required?: boolean
  manual_command?: string
  attempts?: RouterWireGuardRegisterAttempt[]
}

interface RouterWireGuardRegisterResponse {
  success?: boolean
  error?: string
  vps_sync?: RouterWireGuardRegisterVpsSync
}

interface RouterBackToHomeBootstrapData {
  success?: boolean
  error?: string
  user_name?: string
  allow_lan?: boolean
  user_visible_after_run?: boolean
  operational?: boolean
  state?: string
  message?: string
  missing?: string[]
  next_steps?: string[]
}

interface RouterBackToHomeBootstrapResponse {
  success?: boolean
  error?: string
  bootstrap?: RouterBackToHomeBootstrapData
  vps_sync?: RouterWireGuardRegisterVpsSync
}

interface EnterpriseProfileOption {
  id: string
  label: string
  description?: string
}

interface EnterpriseProfilesPayload {
  router_profiles?: EnterpriseProfileOption[]
  site_profiles?: EnterpriseProfileOption[]
}

interface EnterpriseProfilesResponse {
  success?: boolean
  profiles?: EnterpriseProfilesPayload
  error?: string
}

interface EnterpriseHardeningResponse {
  success?: boolean
  dry_run?: boolean
  profile?: string
  site_profile?: string
  change_id?: string
  message?: string
  error?: string
  commands?: string[]
  rollback_commands?: string[]
  result?: string
  rollback_result?: Record<string, unknown> | null
}

interface EnterpriseFailoverTarget {
  target: string
  total_probes: number
  success_probes: number
  packet_loss: number
  avg_latency_ms: number | null
  status: 'ok' | 'warning' | 'critical'
  error?: string
}

interface EnterpriseFailoverReport {
  generated_at?: string
  overall_status?: 'ok' | 'warning' | 'critical'
  targets?: EnterpriseFailoverTarget[]
}

interface EnterpriseFailoverResponse {
  success?: boolean
  report?: EnterpriseFailoverReport
  error?: string
}

interface EnterpriseChangeLogEntry {
  change_id: string
  status: string
  category?: string
  actor?: string
  profile?: string
  site_profile?: string
  created_at?: string
  rolled_back_at?: string
}

interface EnterpriseChangeLogResponse {
  success?: boolean
  changes?: EnterpriseChangeLogEntry[]
  error?: string
}

interface WireGuardImportData {
  endpoint?: string
  endpoint_host?: string
  endpoint_port?: number | null
  interface_addresses?: string[]
  interface_private_key?: string
  peer_allowed_ips?: string[]
}

interface WireGuardImportSuggestions {
  router_name?: string
  router_ip_or_host?: string
  api_port?: number
  bth_private_key?: string
  bth_user_name?: string
  router_tunnel_ip?: string | null
  router_management_ip_required?: boolean
}

interface WireGuardImportResponse {
  success?: boolean
  error?: string
  source_file?: string
  wireguard?: WireGuardImportData
  suggestions?: WireGuardImportSuggestions
}

interface RouterReadinessCheck {
  id: string
  ok: boolean
  detail?: string
  severity?: string
}

interface RouterReadinessBlocker {
  id: string
  detail?: string
}

interface RouterReadinessPayload {
  score?: number
  checks?: RouterReadinessCheck[]
  blockers?: RouterReadinessBlocker[]
  recommendations?: string[]
  write_probe_enabled?: boolean
}

interface RouterReadinessResponse {
  success?: boolean
  error?: string
  readiness?: RouterReadinessPayload
}

interface WireGuardOnboardResponse {
  success?: boolean
  error?: string
  created?: boolean
  reused_existing?: boolean
  updated_existing?: boolean
  source_file?: string
  wireguard?: WireGuardImportData
  router?: unknown
  readiness?: RouterReadinessPayload
  bootstrap?: RouterBackToHomeBootstrapData
  vps_sync?: RouterWireGuardRegisterVpsSync
}

interface RouterFormState {
  name: string
  ip_address: string
  username: string
  password: string
  api_port: string
}

const CONNECTION_POLL_INTERVAL_MS = 60000

const resolveConnectionFeedback = (
  payload: { diagnostics?: RouterConnectionDiagnosticsPayload | null; error?: string | null } | null | undefined,
  fallback: string
) => {
  const summary = String(payload?.diagnostics?.summary || '').trim()
  if (summary) return summary
  const error = String(payload?.error || '').trim()
  return error || fallback
}

const describeHostScope = (scope?: string) => {
  if (scope === 'private') return 'IP privada'
  if (scope === 'public') return 'IP publica'
  if (scope === 'hostname') return 'hostname'
  if (scope === 'link_local') return 'link-local'
  if (scope === 'loopback') return 'loopback'
  return 'sin clasificar'
}

const buildConnectionStatusKey = (diagnostics?: RouterConnectionDiagnosticsPayload | null) => {
  if (!diagnostics) return 'unknown'
  if (diagnostics.success) return 'connected'
  return String(diagnostics.status || 'failed')
}

const getConnectionStatusLabel = (diagnostics?: RouterConnectionDiagnosticsPayload | null) => {
  if (!diagnostics) return 'Sin test'
  if (diagnostics.success) return 'API OK'
  const status = String(diagnostics.status || '')
  if (status === 'dns_unresolved') return 'DNS'
  if (status === 'tcp_unreachable') return 'Puerto'
  if (status === 'api_auth_failed') return 'Auth'
  if (status === 'api_service_disabled') return 'Servicio'
  if (status === 'api_timeout') return 'Timeout'
  if (status === 'api_tls_mismatch') return 'TLS'
  if (status === 'api_protocol_error') return 'Protocolo'
  if (status === 'api_pool_exhausted') return 'Pool'
  return 'Falla API'
}

const getConnectionStatusTone = (diagnostics?: RouterConnectionDiagnosticsPayload | null) => {
  if (!diagnostics) return 'bg-slate-100 text-slate-600'
  return diagnostics.success ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
}

const formatConnectionCheckedAt = (checkedAt?: number) => {
  if (!checkedAt) return 'sin chequeo'
  return new Date(checkedAt).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const normalizeRouterItem = (input: unknown): RouterItem => {
  const item = (input || {}) as Record<string, unknown>
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? 'Router'),
    ip_address: String(item.ip_address ?? ''),
    model: item.model ? String(item.model) : undefined,
    status: item.status ? String(item.status) : undefined,
  }
}

const copyToClipboard = async (value: string): Promise<boolean> => {
  if (!value) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  }
}

const isQrImageFile = (file: File): boolean => {
  const loweredName = String(file.name || '').toLowerCase()
  const imageByExt = /\.(png|jpe?g|webp|bmp|gif)$/i.test(loweredName)
  return String(file.type || '').startsWith('image/') || imageByExt
}

const decodeWireGuardQrFromImage = async (file: File): Promise<string> => {
  const detectorCtor = (window as Window & { BarcodeDetector?: any }).BarcodeDetector
  if (!detectorCtor) {
    throw new Error('Tu navegador no soporta lectura QR local. Usa Chrome/Edge actual o importa .zip/.conf.')
  }
  const detector = new detectorCtor({ formats: ['qr_code'] })
  const bitmap = await createImageBitmap(file)
  try {
    const results = await detector.detect(bitmap)
    const payload = String(results?.[0]?.rawValue || '').trim()
    if (!payload) {
      throw new Error('No se detecto un QR valido en la imagen.')
    }
    return payload
  } finally {
    if (typeof (bitmap as ImageBitmap).close === 'function') {
      ;(bitmap as ImageBitmap).close()
    }
  }
}

const normalizeUiError = (error: unknown, fallback: string): string => {
  const message = String(error instanceof Error ? error.message : '').trim()
  if (!message) return fallback
  const lowered = message.toLowerCase()
  if (lowered.includes('unauthorized')) return 'Sesion expirada. Vuelve a iniciar sesion.'
  if (lowered.includes('failed to fetch')) return 'No se pudo conectar al backend. Verifica VPS, dominio y red.'
  if (lowered.includes('abort')) return 'Solicitud interrumpida. Reintenta con sesion activa.'
  if (lowered.includes('qr')) return message
  if (lowered.includes('decode')) return 'No se pudo leer la imagen QR. Usa PNG/JPG nítido o importa ZIP/CONF.'
  return message
}

const MikroTikManagement: React.FC = () => {
  const [routers, setRouters] = useState<RouterItem[]>([])
  const [selectedRouter, setSelectedRouter] = useState<RouterItem | null>(null)
  const [routerStats, setRouterStats] = useState<RouterStats | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'queues' | 'connections' | 'config' | 'security'>('overview')

  const [isLoading, setIsLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [creatingRouter, setCreatingRouter] = useState(false)
  const [quickLoading, setQuickLoading] = useState(false)
  const [bthActionLoading, setBthActionLoading] = useState(false)
  const [expressConnecting, setExpressConnecting] = useState(false)
  const [expressSteps, setExpressSteps] = useState<ExpressStepState[]>([])
  const [connectionWizardStep, setConnectionWizardStep] = useState<1 | 2 | 3>(1)
  const [showAdvancedScripts, setShowAdvancedScripts] = useState(false)
  const [wizardValidating, setWizardValidating] = useState(false)

  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [isAiLoading, setIsAiLoading] = useState(false)

  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmMessage, setConfirmMessage] = useState('')
  const confirmActionRef = useRef<(() => void) | null>(null)
  const wireGuardFileInputRef = useRef<HTMLInputElement | null>(null)
  const wireGuardOnboardFileInputRef = useRef<HTMLInputElement | null>(null)
  const [sidePanel, setSidePanel] = useState<'none' | 'logs' | 'dhcp' | 'wifi'>('none')
  const [quickConnect, setQuickConnect] = useState<RouterQuickConnectResponse | null>(null)
  const [quickConnectScope, setQuickConnectScope] = useState<'auto' | 'public' | 'private'>('auto')
  const [routerReadiness, setRouterReadiness] = useState<RouterReadinessPayload | null>(null)
  const [routerConnectionSnapshots, setRouterConnectionSnapshots] = useState<Record<string, RouterConnectionSnapshot>>({})
  const [readinessLoading, setReadinessLoading] = useState(false)
  const [bootstrapResult, setBootstrapResult] = useState<RouterBackToHomeBootstrapData | null>(null)
  const [bthUserName, setBthUserName] = useState('noc-vps')
  const [bthPrivateKey, setBthPrivateKey] = useState('')
  const [bthAllowLan, setBthAllowLan] = useState(true)
  const [changeTicket, setChangeTicket] = useState('')
  const [preflightAck, setPreflightAck] = useState(false)
  const [wireGuardWriteProbe, setWireGuardWriteProbe] = useState(false)
  const [wireGuardBootstrapOnboard, setWireGuardBootstrapOnboard] = useState(false)
  const [wireGuardOnboarding, setWireGuardOnboarding] = useState(false)
  const [routerForm, setRouterForm] = useState<RouterFormState>({
    name: '',
    ip_address: '',
    username: 'admin',
    password: '',
    api_port: '8728',
  })
  const [securityBusy, setSecurityBusy] = useState(false)
  const [enterpriseProfiles, setEnterpriseProfiles] = useState<EnterpriseProfilesPayload | null>(null)
  const [hardeningProfile, setHardeningProfile] = useState('baseline')
  const [hardeningSiteProfile, setHardeningSiteProfile] = useState('access')
  const [hardeningDryRun, setHardeningDryRun] = useState(true)
  const [hardeningAutoRollback, setHardeningAutoRollback] = useState(true)
  const [hardeningResult, setHardeningResult] = useState<EnterpriseHardeningResponse | null>(null)
  const [failoverTargets, setFailoverTargets] = useState('1.1.1.1,8.8.8.8,9.9.9.9')
  const [failoverCount, setFailoverCount] = useState('4')
  const [failoverResult, setFailoverResult] = useState<EnterpriseFailoverReport | null>(null)
  const [enterpriseChangeLog, setEnterpriseChangeLog] = useState<EnterpriseChangeLogEntry[]>([])
  const [wireGuardImporting, setWireGuardImporting] = useState(false)
  const [wireGuardImportSummary, setWireGuardImportSummary] = useState<WireGuardImportResponse | null>(null)
  const connectionStatusRef = useRef<Record<string, string>>({})
  const token = useAuthStore((state) => state.token)
  const tenantContextId = useAuthStore((state) => state.tenantContextId)
  const logout = useAuthStore((state) => state.logout)
  const activeConnectionSnapshot = selectedRouter ? routerConnectionSnapshots[selectedRouter.id] || null : null
  const activeConnectionDiagnostics = activeConnectionSnapshot?.diagnostics || null

  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts((t) => [...t, { id, type, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }, [])

  const openConfirm = (message: string, onConfirm: () => void) => {
    setConfirmMessage(message)
    confirmActionRef.current = onConfirm
    setConfirmOpen(true)
  }

  const authHeaders = useCallback(() => {
    return token ? { Authorization: `Bearer ${token}` } : {}
  }, [token])

  const API_BASE = useMemo(() => {
    const raw = config.API_BASE_URL || '/api'
    return raw.endsWith('/') ? raw.slice(0, -1) : raw
  }, [])

  const withChangeTicket = useCallback(
    (payload: Record<string, unknown> = {}) => {
      const ticket = changeTicket.trim()
      const nextPayload: Record<string, unknown> = { ...payload }
      if (ticket) nextPayload.change_ticket = ticket
      if (preflightAck) nextPayload.preflight_ack = true
      return nextPayload
    },
    [changeTicket, preflightAck]
  )

  const safeJson = useCallback(async (res: Response): Promise<unknown> => {
    try {
      return await res.json()
    } catch {
      return null
    }
  }, [])

  const rememberConnectionDiagnostics = useCallback(
    (
      routerId: string,
      diagnostics?: RouterConnectionDiagnosticsPayload | null,
      options: RememberConnectionDiagnosticsOptions = {}
    ) => {
      if (!diagnostics) return

      const normalizedRouterId = String(routerId)
      const nextStatus = buildConnectionStatusKey(diagnostics)
      const previousStatus = connectionStatusRef.current[normalizedRouterId]
      connectionStatusRef.current[normalizedRouterId] = nextStatus

      setRouterConnectionSnapshots((prev) => ({
        ...prev,
        [normalizedRouterId]: {
          diagnostics,
          checkedAt: Date.now(),
        },
      }))

      if (options.notifyOnChange && previousStatus && previousStatus !== nextStatus) {
        const summary = resolveConnectionFeedback({ diagnostics }, 'Estado de conexion actualizado')
        const routerLabel = options.routerName ? ` ${options.routerName}` : ''
        addToast(diagnostics.success ? 'success' : 'error', `Semaforo MikroTik${routerLabel}: ${summary}`)
      }
    },
    [addToast]
  )

  const apiFetch = useCallback(
    (path: string, options: RequestInit = {}) => {
      const headers: Record<string, string> = {
        ...(authHeaders() as Record<string, string>),
        ...((options.headers as Record<string, string>) || {}),
      }
      if (tenantContextId !== null && tenantContextId !== undefined) {
        headers['X-Tenant-ID'] = String(tenantContextId)
      }
      let normalizedPath = path.startsWith('/') ? path : `/${path}`
      if (API_BASE.endsWith('/api') && (normalizedPath === '/api' || normalizedPath.startsWith('/api/'))) {
        normalizedPath = normalizedPath.slice(4) || '/'
      }
      const url = path.startsWith('http') ? path : `${API_BASE}${normalizedPath}`
      return fetch(url, { ...options, headers }).then(async (res) => {
        if (res.status === 401) {
          logout()
          throw new Error('Unauthorized')
        }
        return res
      })
    },
    [API_BASE, authHeaders, logout, tenantContextId]
  )

  const fetchConnectionDiagnostics = useCallback(
    async (routerId: string) => {
      const response = await apiFetch(`/api/mikrotik/routers/${routerId}/test-connection`)
      const payload = (await safeJson(response)) as RouterConnectionActionResponse | null
      return { ok: response.ok, payload }
    },
    [apiFetch, safeJson]
  )

  const loadRouters = useCallback(async () => {
    try {
      const response = await apiFetch('/api/mikrotik/routers')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = (await safeJson(response)) as RouterListResponse | null
      const source = payload?.success && Array.isArray(payload.routers) ? payload.routers : []
      const nextRouters = source.map(normalizeRouterItem).filter((item) => item.id && item.ip_address)
      setRouters(nextRouters)
      setRouterConnectionSnapshots((prev) => {
        const allowedIds = new Set(nextRouters.map((item) => item.id))
        const filtered = Object.entries(prev).filter(([routerId]) => allowedIds.has(routerId))
        return Object.fromEntries(filtered)
      })
      connectionStatusRef.current = Object.fromEntries(
        Object.entries(connectionStatusRef.current).filter(([routerId]) => nextRouters.some((item) => item.id === routerId))
      )
      setSelectedRouter((prev) => {
        if (!nextRouters.length) return null
        if (!prev) return nextRouters[0]
        return nextRouters.find((item) => item.id === prev.id) || nextRouters[0]
      })
    } catch (error) {
      console.error('Error loading routers:', error)
      addToast('error', 'No se pudieron cargar los routers')
    }
  }, [addToast, apiFetch, safeJson])

  const loadRouterStats = useCallback(
    async (routerId: string) => {
      setIsLoading(true)
      try {
        const [healthRes, queuesRes, connectionsRes] = await Promise.all([
          apiFetch(`/api/mikrotik/routers/${routerId}/health`),
          apiFetch(`/api/mikrotik/routers/${routerId}/queues`),
          apiFetch(`/api/mikrotik/routers/${routerId}/connections`),
        ])

        const healthData = healthRes.ok ? ((await safeJson(healthRes)) as Record<string, unknown>) : { success: false }
        const queuesData = queuesRes.ok ? ((await safeJson(queuesRes)) as Record<string, unknown>) : { success: false }
        const connectionsData = connectionsRes.ok ? ((await safeJson(connectionsRes)) as Record<string, unknown>) : { success: false }

        const nextStats: RouterStats = {
          health: healthData.success === true ? (healthData.health as RouterStats['health']) : null,
          queues: queuesData.success === true && Array.isArray(queuesData.queues) ? (queuesData.queues as RouterStats['queues']) : [],
          connections:
            connectionsData.success === true && Array.isArray(connectionsData.connections)
              ? (connectionsData.connections as RouterStats['connections'])
              : [],
        }
        setRouterStats(nextStats)
      } catch (error) {
        console.error('Error loading router stats:', error)
        setRouterStats({ health: null, queues: [], connections: [] })
        addToast('error', 'Error de red al cargar estadisticas del router')
      } finally {
        setIsLoading(false)
      }
    },
    [addToast, apiFetch, safeJson]
  )

  const loadQuickConnect = useCallback(
    async (routerId: string, scope: 'auto' | 'public' | 'private' = 'auto') => {
      setQuickLoading(true)
      try {
        const query = scope && scope !== 'auto' ? `?ip_scope=${scope}` : ''
        const response = await apiFetch(`/api/mikrotik/routers/${routerId}/quick-connect${query}`)
        const payload = (await safeJson(response)) as RouterQuickConnectResponse | null
        if (response.ok && payload?.success) {
          setQuickConnect(payload)
        } else {
          setQuickConnect(null)
        }
      } catch (error) {
        console.error('Error loading quick connect:', error)
        setQuickConnect(null)
      } finally {
        setQuickLoading(false)
      }
    },
    [apiFetch, safeJson]
  )

  const loadRouterReadiness = useCallback(
    async (routerId: string, runWriteProbe = false) => {
      setReadinessLoading(true)
      try {
        const query = runWriteProbe ? '?write_probe=true' : ''
        const response = await apiFetch(`/api/mikrotik/routers/${routerId}/readiness${query}`)
        const payload = (await safeJson(response)) as RouterReadinessResponse | null
        if (response.ok && payload?.success && payload.readiness) {
          setRouterReadiness(payload.readiness)
        } else {
          setRouterReadiness(null)
          if (runWriteProbe) {
            addToast('error', payload?.error || 'No se pudo ejecutar write probe')
          }
        }
      } catch (error) {
        console.error('Error loading router readiness:', error)
        setRouterReadiness(null)
        if (runWriteProbe) {
          addToast('error', 'Error de red ejecutando readiness')
        }
      } finally {
        setReadinessLoading(false)
      }
    },
    [addToast, apiFetch, safeJson]
  )

  const loadEnterpriseProfiles = useCallback(
    async (routerId: string) => {
      try {
        const response = await apiFetch(`/api/mikrotik/routers/${routerId}/enterprise/hardening/profiles`)
        const payload = (await safeJson(response)) as EnterpriseProfilesResponse | null
        if (response.ok && payload?.success && payload.profiles) {
          const profiles = payload.profiles
          setEnterpriseProfiles(profiles)
          const defaultRouterProfile = profiles.router_profiles?.[0]?.id
          const defaultSiteProfile = profiles.site_profiles?.[0]?.id
          if (defaultRouterProfile) setHardeningProfile((prev) => prev || defaultRouterProfile)
          if (defaultSiteProfile) setHardeningSiteProfile((prev) => prev || defaultSiteProfile)
          return
        }
        setEnterpriseProfiles(null)
      } catch (error) {
        console.error('Error loading enterprise hardening profiles:', error)
        setEnterpriseProfiles(null)
      }
    },
    [apiFetch, safeJson]
  )

  const loadEnterpriseChangeLog = useCallback(
    async (routerId: string) => {
      try {
        const response = await apiFetch(`/api/mikrotik/routers/${routerId}/enterprise/change-log?limit=30`)
        const payload = (await safeJson(response)) as EnterpriseChangeLogResponse | null
        if (response.ok && payload?.success && Array.isArray(payload.changes)) {
          setEnterpriseChangeLog(payload.changes)
          return
        }
        setEnterpriseChangeLog([])
      } catch (error) {
        console.error('Error loading enterprise change-log:', error)
        setEnterpriseChangeLog([])
      }
    },
    [apiFetch, safeJson]
  )

  useEffect(() => {
    loadRouters()
  }, [loadRouters])

  useEffect(() => {
    if (!selectedRouter) return
    loadRouterStats(selectedRouter.id)
    loadQuickConnect(selectedRouter.id, quickConnectScope)
    loadRouterReadiness(selectedRouter.id)
    loadEnterpriseProfiles(selectedRouter.id)
    loadEnterpriseChangeLog(selectedRouter.id)
    setAiAnalysis(null)
    setAiError(null)
    setBootstrapResult(null)
    setConnectionWizardStep(1)
    setExpressSteps([])
    setRouterReadiness(null)
    setHardeningResult(null)
    setFailoverResult(null)
  }, [loadEnterpriseChangeLog, loadEnterpriseProfiles, loadQuickConnect, loadRouterReadiness, loadRouterStats, quickConnectScope, selectedRouter])

  useEffect(() => {
    if (!selectedRouter || activeTab !== 'config') return

    let cancelled = false

    const runPoll = async (notifyOnChange = false) => {
      try {
        const { payload } = await fetchConnectionDiagnostics(selectedRouter.id)
        if (cancelled || !payload?.diagnostics) return
        rememberConnectionDiagnostics(selectedRouter.id, payload.diagnostics, {
          notifyOnChange,
          routerName: selectedRouter.name,
        })
      } catch (error) {
        if (!cancelled) {
          console.error('Error polling connection diagnostics:', error)
        }
      }
    }

    void runPoll(false)

    const timer = window.setInterval(() => {
      void runPoll(true)
    }, CONNECTION_POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeTab, fetchConnectionDiagnostics, rememberConnectionDiagnostics, selectedRouter])

  const applyEnterpriseHardening = async () => {
    if (!selectedRouter) return
    setSecurityBusy(true)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/enterprise/hardening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withChangeTicket({
            dry_run: hardeningDryRun,
            profile: hardeningProfile,
            site_profile: hardeningSiteProfile,
            auto_rollback: hardeningAutoRollback,
          })
        ),
      })
      const payload = (await safeJson(response)) as EnterpriseHardeningResponse | null
      if (!response.ok || !payload) {
        addToast('error', payload?.error || 'No se pudo ejecutar hardening')
        return
      }
      setHardeningResult(payload)
      if (payload.success) {
        addToast('success', payload.message || 'Hardening ejecutado')
        if (!payload.dry_run) await loadEnterpriseChangeLog(selectedRouter.id)
      } else {
        addToast('error', payload.error || payload.message || 'No se pudo aplicar hardening')
      }
    } catch (error) {
      console.error('Error applying enterprise hardening:', error)
      addToast('error', 'Error de red ejecutando hardening')
    } finally {
      setSecurityBusy(false)
    }
  }

  const runEnterpriseFailoverTest = async () => {
    if (!selectedRouter) return
    const targets = failoverTargets
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8)
    if (!targets.length) {
      addToast('error', 'Ingresa al menos un target para failover test')
      return
    }

    const parsedCount = Number(failoverCount)
    const count = Number.isFinite(parsedCount) ? Math.max(1, Math.min(20, Math.floor(parsedCount))) : 4

    setSecurityBusy(true)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/enterprise/failover-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withChangeTicket({
            targets,
            count,
          })
        ),
      })
      const payload = (await safeJson(response)) as EnterpriseFailoverResponse | null
      if (!response.ok || !payload?.success || !payload.report) {
        addToast('error', payload?.error || 'No se pudo ejecutar failover test')
        return
      }
      setFailoverResult(payload.report)
      addToast('success', 'Failover test completado')
    } catch (error) {
      console.error('Error running enterprise failover test:', error)
      addToast('error', 'Error de red en failover test')
    } finally {
      setSecurityBusy(false)
    }
  }

  const rollbackEnterpriseChange = async (changeId: string) => {
    if (!selectedRouter || !changeId) return
    setSecurityBusy(true)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/enterprise/rollback/${changeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withChangeTicket({})),
      })
      const payload = (await safeJson(response)) as { success?: boolean; error?: string } | null
      if (response.ok && payload?.success) {
        addToast('success', `Rollback ${changeId} ejecutado`)
        await loadEnterpriseChangeLog(selectedRouter.id)
      } else {
        addToast('error', payload?.error || 'No se pudo ejecutar rollback')
      }
    } catch (error) {
      console.error('Error rolling back enterprise change:', error)
      addToast('error', 'Error de red ejecutando rollback')
    } finally {
      setSecurityBusy(false)
    }
  }

  const rebootRouter = async () => {
    if (!selectedRouter) return
    setActionLoading(true)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/reboot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withChangeTicket({})),
      })
      const data = (await safeJson(response)) as { success?: boolean; error?: string } | null
      if (response.ok && data?.success) addToast('success', 'Reinicio solicitado correctamente')
      else addToast('error', data?.error || 'Error reiniciando router')
    } catch {
      addToast('error', 'Error de red reiniciando router')
    } finally {
      setActionLoading(false)
    }
  }

  const backupRouter = async () => {
    if (!selectedRouter) return
    setActionLoading(true)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withChangeTicket({ name: `backup_${new Date().toISOString()}` })),
      })
      const data = (await safeJson(response)) as { success?: boolean; error?: string } | null
      if (response.ok && data?.success) addToast('success', 'Backup creado exitosamente')
      else addToast('error', data?.error || 'Error creando backup')
    } catch {
      addToast('error', 'Error de red creando backup')
    } finally {
      setActionLoading(false)
    }
  }

  const testConnection = async () => {
    if (!selectedRouter) return
    setActionLoading(true)
    try {
      const { ok, payload: data } = await fetchConnectionDiagnostics(selectedRouter.id)
      if (data?.diagnostics) rememberConnectionDiagnostics(selectedRouter.id, data.diagnostics)
      if (ok && data?.success) addToast('success', resolveConnectionFeedback(data, 'Conexion al router exitosa'))
      else addToast('error', resolveConnectionFeedback(data, 'No se pudo conectar al router'))
    } catch {
      addToast('error', 'Error de red al probar conexion')
    } finally {
      setActionLoading(false)
    }
  }

  const runAiDiagnosis = async () => {
    if (!selectedRouter) return
    setIsAiLoading(true)
    setAiAnalysis(null)
    setAiError(null)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/ai-diagnose`)
      const data = (await safeJson(response)) as { success?: boolean; diagnosis?: { analysis?: string }; error?: string } | null
      if (response.ok && data?.success) setAiAnalysis(data.diagnosis?.analysis || '')
      else throw new Error(data?.error || 'Failed to get AI analysis')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setAiError(message)
    } finally {
      setIsAiLoading(false)
    }
  }

  const deleteSelectedRouter = async () => {
    if (!selectedRouter) return
    setActionLoading(true)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}`, { method: 'DELETE' })
      const payload = (await safeJson(response)) as { success?: boolean; error?: string; linked_clients?: number } | null
      if (response.ok && payload?.success) {
        addToast('success', `Router ${selectedRouter.name} eliminado`)
        setRouterStats(null)
        setQuickConnect(null)
        setRouterReadiness(null)
        setRouterConnectionSnapshots((prev) => {
          const next = { ...prev }
          delete next[selectedRouter.id]
          return next
        })
        delete connectionStatusRef.current[selectedRouter.id]
        setBootstrapResult(null)
        setEnterpriseProfiles(null)
        setEnterpriseChangeLog([])
        setAiAnalysis(null)
        setAiError(null)
        await loadRouters()
      } else if (response.status === 409) {
        addToast('error', payload?.error || 'No se puede eliminar: tiene clientes vinculados')
      } else {
        addToast('error', payload?.error || 'No se pudo eliminar el router')
      }
    } catch (error) {
      console.error('Error deleting router:', error)
      addToast('error', 'Error de red eliminando router')
    } finally {
      setActionLoading(false)
    }
  }

  const appendWireGuardSourceToFormData = useCallback(
    async (formData: FormData, sourceFile: File): Promise<'archive' | 'qr'> => {
      if (!isQrImageFile(sourceFile)) {
        formData.append('archive', sourceFile)
        return 'archive'
      }
      const qrPayload = await decodeWireGuardQrFromImage(sourceFile)
      formData.append('config_text', qrPayload)
      formData.append('source_name', sourceFile.name || 'wireguard-qr.png')
      return 'qr'
    },
    []
  )

  const importWireGuardArchive = useCallback(
    async (archiveFile: File) => {
      if (!archiveFile) return
      setWireGuardImporting(true)
      try {
        const formData = new FormData()
        const sourceKind = await appendWireGuardSourceToFormData(formData, archiveFile)
        const response = await apiFetch('/api/mikrotik/wireguard/import', {
          method: 'POST',
          body: formData,
        })
        const payload = (await safeJson(response)) as WireGuardImportResponse | null
        if (!response.ok || !payload?.success) {
          addToast('error', payload?.error || `No se pudo importar archivo WireGuard (${response.status})`)
          return
        }

        setWireGuardImportSummary(payload)
        const suggestions = payload.suggestions || {}
        const suggestedIpOrHost = String(suggestions.router_ip_or_host || '').trim()
        setRouterForm((prev) => ({
          ...prev,
          name: prev.name.trim() ? prev.name : String(suggestions.router_name || prev.name || ''),
          ip_address: prev.ip_address.trim() ? prev.ip_address : (suggestedIpOrHost || String(prev.ip_address || '')),
          api_port: String(suggestions.api_port || prev.api_port || '8728'),
        }))

        const importedPrivateKey = String(suggestions.bth_private_key || '').trim()
        if (importedPrivateKey && !bthPrivateKey.trim()) {
          setBthPrivateKey(importedPrivateKey)
        }
        const importedBthUser = String(suggestions.bth_user_name || '').trim()
        if (importedBthUser && !bthUserName.trim()) {
          setBthUserName(importedBthUser)
        }

        if (Boolean(suggestions.router_management_ip_required) && !routerForm.ip_address.trim() && !suggestedIpOrHost) {
          addToast('info', 'Perfil BTH detectado: ingresa la IP de gestion del MikroTik en "IP o DNS".')
        }

        addToast('success', sourceKind === 'qr' ? `QR importado: ${payload.source_file || archiveFile.name}` : `WireGuard importado: ${payload.source_file || archiveFile.name}`)
      } catch (error) {
        console.error('Error importing WireGuard archive:', error)
        addToast('error', normalizeUiError(error, 'Error importando QR/ZIP'))
      } finally {
        setWireGuardImporting(false)
      }
    },
    [addToast, apiFetch, appendWireGuardSourceToFormData, bthPrivateKey, bthUserName, routerForm.ip_address, safeJson]
  )

  const onboardRouterFromWireGuardArchive = useCallback(
    async (archiveFile: File) => {
      if (!archiveFile) return
      if (!routerForm.username.trim() || !routerForm.password.trim()) {
        addToast('error', 'Ingresa usuario y password API antes de onboarding')
        return
      }
      if (wireGuardBootstrapOnboard && !changeTicket.trim()) {
        addToast('error', 'Para bootstrap en vivo debes ingresar Change Ticket')
        return
      }
      if (wireGuardBootstrapOnboard && !preflightAck) {
        addToast('error', 'Activa preflight_ack para bootstrap en vivo')
        return
      }

      setWireGuardOnboarding(true)
      try {
        const formData = new FormData()
        const sourceKind = await appendWireGuardSourceToFormData(formData, archiveFile)
        if (routerForm.name.trim()) formData.append('name', routerForm.name.trim())
        if (routerForm.ip_address.trim()) formData.append('ip_address', routerForm.ip_address.trim())
        formData.append('username', routerForm.username.trim())
        formData.append('password', routerForm.password)
        formData.append('api_port', String(Number(routerForm.api_port || '8728')))
        formData.append('write_probe', wireGuardWriteProbe ? 'true' : 'false')
        formData.append('auto_vps_link', 'true')

        const shouldBootstrapBth = wireGuardBootstrapOnboard && sourceKind !== 'qr'
        formData.append('bootstrap_bth', shouldBootstrapBth ? 'true' : 'false')
        if (shouldBootstrapBth) {
          formData.append('bth_user_name', bthUserName.trim() || 'noc-vps')
          if (bthPrivateKey.trim()) formData.append('bth_private_key', bthPrivateKey.trim())
          formData.append('bth_allow_lan', bthAllowLan ? 'true' : 'false')
          formData.append('change_ticket', changeTicket.trim())
          formData.append('preflight_ack', preflightAck ? 'true' : 'false')
        }

        const response = await apiFetch('/api/mikrotik/wireguard/onboard', {
          method: 'POST',
          body: formData,
        })
        const payload = (await safeJson(response)) as WireGuardOnboardResponse | null
        if (!response.ok || !payload?.success) {
          addToast('error', payload?.error || `No se pudo completar onboarding (${response.status})`)
          return
        }

        setRouterReadiness(payload.readiness || null)
        if (payload.bootstrap) {
          setBootstrapResult(payload.bootstrap)
          if (payload.bootstrap.success === false) {
            addToast('error', payload.bootstrap.error || 'Bootstrap automatico no pudo ejecutarse por API')
          }
        }
        if (payload.vps_sync) {
          if (payload.vps_sync.success) {
            addToast('success', `Vinculacion VPS completada (${payload.vps_sync.mode || 'auto'})`)
          } else if (payload.vps_sync.manual_command) {
            await copyToClipboard(String(payload.vps_sync.manual_command || ''))
            addToast('info', `${payload.vps_sync.message || 'Vinculacion VPS pendiente'}. Comando manual copiado.`)
          } else if (payload.vps_sync.message) {
            addToast('info', payload.vps_sync.message)
          }
        }
        setWireGuardImportSummary({
          success: true,
          source_file: payload.source_file,
          wireguard: payload.wireguard,
        })

        const outcome = payload.created ? 'creado' : payload.updated_existing ? 'actualizado' : 'procesado'
        addToast('success', `Router ${outcome}. Readiness: ${payload.readiness?.score ?? 0}%`)

        await loadRouters()
        if (payload.router) {
          const onboardedRouter = normalizeRouterItem(payload.router)
          if (onboardedRouter.id) {
            setSelectedRouter(onboardedRouter)
            setActiveTab('config')
          }
        }
      } catch (error) {
        console.error('Error onboarding WireGuard archive:', error)
        addToast('error', normalizeUiError(error, 'Error durante onboarding'))
      } finally {
        setWireGuardOnboarding(false)
      }
    },
    [
      addToast,
      apiFetch,
      bthAllowLan,
      bthPrivateKey,
      bthUserName,
      changeTicket,
      loadRouters,
      preflightAck,
      routerForm.api_port,
      routerForm.ip_address,
      routerForm.name,
      routerForm.password,
      routerForm.username,
      safeJson,
      wireGuardBootstrapOnboard,
      wireGuardWriteProbe,
      appendWireGuardSourceToFormData,
    ]
  )

  const handleWireGuardFilePick = useCallback(() => {
    wireGuardFileInputRef.current?.click()
  }, [])

  const handleWireGuardOnboardFilePick = useCallback(() => {
    wireGuardOnboardFileInputRef.current?.click()
  }, [])

  const handleWireGuardFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const archiveFile = event.target.files?.[0]
      if (archiveFile) {
        void importWireGuardArchive(archiveFile)
      }
      event.target.value = ''
    },
    [importWireGuardArchive]
  )

  const handleWireGuardOnboardFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const archiveFile = event.target.files?.[0]
      if (archiveFile) {
        void onboardRouterFromWireGuardArchive(archiveFile)
      }
      event.target.value = ''
    },
    [onboardRouterFromWireGuardArchive]
  )

  const createRouter = async () => {
    if (!routerForm.name.trim() || !routerForm.ip_address.trim() || !routerForm.username.trim() || !routerForm.password.trim()) {
      addToast('error', 'Completa nombre, IP, usuario y password')
      return
    }
    setCreatingRouter(true)
    try {
      const response = await apiFetch('/api/mikrotik/routers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: routerForm.name.trim(),
          ip_address: routerForm.ip_address.trim(),
          username: routerForm.username.trim(),
          password: routerForm.password,
          api_port: Number(routerForm.api_port || '8728'),
          is_active: true,
          test_connection: true,
        }),
      })
      const payload = (await safeJson(response)) as RouterCreateResponse | null
      if (!response.ok || !payload?.success || !payload.router) {
        addToast('error', payload?.error || `Error ${response.status} al agregar router`)
        return
      }

      const createdRouter = normalizeRouterItem(payload.router)
      if (payload.diagnostics) rememberConnectionDiagnostics(createdRouter.id, payload.diagnostics)
      const connectionMessage = resolveConnectionFeedback(
        payload,
        payload.reachable === false ? 'Router agregado, pero la API aun no responde.' : 'Router agregado correctamente.'
      )
      addToast(payload.reachable === false ? 'error' : 'success', payload.reachable === false ? `Router agregado. ${connectionMessage}` : connectionMessage)
      setRouterForm((prev) => ({ ...prev, name: '', ip_address: '', password: '' }))
      await loadRouters()
      setSelectedRouter(createdRouter)
      setActiveTab('config')
    } catch (error) {
      console.error('Error creating router:', error)
      addToast('error', 'No se pudo agregar el router')
    } finally {
      setCreatingRouter(false)
    }
  }

  const copyScript = async (label: string, value: string) => {
    const ok = await copyToClipboard(value)
    addToast(ok ? 'success' : 'error', ok ? `${label} copiado` : `No se pudo copiar ${label}`)
  }

  const resolveQuickScript = useCallback((scripts: RouterQuickScripts | undefined, scriptKey: string | undefined): string => {
    if (!scripts || !scriptKey) return ''
    if (scriptKey === 'direct_api_script') return scripts.direct_api_script || ''
    if (scriptKey === 'wireguard_site_to_vps_script') return scripts.wireguard_site_to_vps_script || ''
    if (scriptKey === 'bth_enable_minimal_script') return scripts.bth_enable_minimal_script || ''
    return ''
  }, [])

  const runWizardDetection = async () => {
    if (!selectedRouter) return
    try {
      await loadQuickConnect(selectedRouter.id, quickConnectScope)
      await loadRouterReadiness(selectedRouter.id)
      setConnectionWizardStep(2)
      addToast('success', 'Deteccion completada. Continua con la conexion express.')
    } catch (error) {
      console.error('Error running wizard detection:', error)
      addToast('error', 'No se pudo completar la deteccion')
    }
  }

  const runWizardValidation = async () => {
    if (!selectedRouter) return
    setWizardValidating(true)
    try {
      const { ok, payload } = await fetchConnectionDiagnostics(selectedRouter.id)
      if (payload?.diagnostics) rememberConnectionDiagnostics(selectedRouter.id, payload.diagnostics)
      await loadQuickConnect(selectedRouter.id, quickConnectScope)
      await loadRouterReadiness(selectedRouter.id)
      setConnectionWizardStep(3)
      if (ok && payload?.success) {
        addToast('success', resolveConnectionFeedback(payload, 'Validacion completada: router alcanzable'))
      } else {
        addToast('error', resolveConnectionFeedback(payload, 'Validacion fallida: router no alcanzable'))
      }
    } catch (error) {
      console.error('Error running wizard validation:', error)
      addToast('error', 'Error de red en validacion')
    } finally {
      setWizardValidating(false)
    }
  }

  const runConnectionExpress = async () => {
    if (!selectedRouter || !quickConnect?.scripts) return
    if (!changeTicket.trim() || !preflightAck) {
      addToast('error', 'Conexion Express requiere change_ticket y preflight_ack=true')
      return
    }
    setConnectionWizardStep(2)

    const updateStep = (id: string, status: ExpressStepState['status'], detail?: string) => {
      setExpressSteps((prev) => prev.map((step) => (step.id === id ? { ...step, status, detail } : step)))
    }

    const executeScriptStep = async (stepId: string, label: string, scriptContent: string) => {
      updateStep(stepId, 'running')
      try {
        const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/execute-script`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withChangeTicket({ script: scriptContent })),
        })
        const payload = (await safeJson(response)) as { success?: boolean; error?: string; result?: string } | null
        if (response.ok && payload?.success) {
          updateStep(stepId, 'success', `${label} aplicado`)
          return true
        }
        updateStep(stepId, 'failed', payload?.error || `Fallo ${label}`)
        return false
      } catch (error) {
        const detail = error instanceof Error ? error.message : `Fallo ${label}`
        updateStep(stepId, 'failed', detail)
        return false
      }
    }

    const testConnectionStep = async (stepId: string, detailOnSuccess: string) => {
      updateStep(stepId, 'running')
      try {
        const { ok, payload } = await fetchConnectionDiagnostics(selectedRouter.id)
        if (payload?.diagnostics) rememberConnectionDiagnostics(selectedRouter.id, payload.diagnostics)
        if (ok && payload?.success) {
          updateStep(stepId, 'success', detailOnSuccess)
          return true
        }
        updateStep(stepId, 'failed', resolveConnectionFeedback(payload, 'Router aun no responde por API'))
        return false
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Fallo de red en test'
        updateStep(stepId, 'failed', detail)
        return false
      }
    }

    const bootstrapBthStep = async (stepId: string) => {
      updateStep(stepId, 'running')
      try {
        const payloadBody: Record<string, unknown> = {
          confirm: true,
          user_name: bthUserName.trim() || 'noc-vps',
          allow_lan: bthAllowLan,
          fast_link_vps: true,
        }
        const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/back-to-home/bootstrap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withChangeTicket(payloadBody)),
        })
        const payload = (await safeJson(response)) as RouterBackToHomeBootstrapResponse | null
        if (response.ok && payload?.success) {
          if (payload.bootstrap) setBootstrapResult(payload.bootstrap)
          const detail = payload.bootstrap?.message || 'Bootstrap BTH completado'
          updateStep(stepId, 'success', detail)
          return {
            ok: true,
            operational: Boolean(payload.bootstrap?.operational),
            detail,
          }
        }
        updateStep(stepId, 'failed', payload?.error || 'No se pudo ejecutar bootstrap BTH')
        return {
          ok: false,
          operational: false,
          detail: payload?.error || 'No se pudo ejecutar bootstrap BTH',
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Fallo bootstrap BTH'
        updateStep(stepId, 'failed', detail)
        return {
          ok: false,
          operational: false,
          detail,
        }
      }
    }

    const registerWireGuardPeerStep = async (stepId: string) => {
      updateStep(stepId, 'running')
      try {
        const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/wireguard/register-peer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            withChangeTicket({
              router_interface: 'wg-fastisp',
            })
          ),
        })
        const payload = (await safeJson(response)) as RouterWireGuardRegisterResponse | null
        if (response.ok && payload?.success) {
          const mode = payload?.vps_sync?.mode || 'auto'
          updateStep(stepId, 'success', `Peer registrado en VPS (${mode})`)
          return true
        }
        const detail = payload?.error || payload?.vps_sync?.message || 'No se pudo registrar peer en VPS'
        const manualCommand = String(payload?.vps_sync?.manual_command || '').trim()
        if (manualCommand) {
          await copyToClipboard(manualCommand)
          updateStep(stepId, 'failed', `${detail}. Comando copiado al portapapeles`)
        } else {
          updateStep(stepId, 'failed', detail)
        }
        return false
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Fallo registrando peer WireGuard en VPS'
        updateStep(stepId, 'failed', detail)
        return false
      }
    }

    const reachable = Boolean(quickConnect.back_to_home?.reachable)

    const baseSteps: ExpressStepState[] = [
      { id: 'bth_bootstrap', label: 'Back To Home automatico', status: 'pending' },
      { id: 'verify_bth', label: 'Validar operacion BTH', status: 'pending' },
      { id: 'wg_tunnel', label: 'WireGuard opcional', status: 'pending' },
      { id: 'wg_register_peer', label: 'Registrar peer en VPS', status: 'pending' },
      { id: 'verify_wg', label: 'Validar tunel WireGuard', status: 'pending' },
    ]
    setExpressSteps(baseSteps)
    setExpressConnecting(true)

    try {
      if (!reachable) {
        setExpressSteps([
          {
            id: 'manual_local',
            label: 'Paso local requerido',
            status: 'failed',
            detail: 'Router no alcanzable por API. Importa QR BTH o ejecuta script minimo local y vuelve a intentar.',
          },
        ])
        const minimalScript = quickConnect.scripts.bth_enable_minimal_script || ''
        if (minimalScript) {
          await copyToClipboard(minimalScript)
        }
        addToast('error', 'Router no alcanzable. Importa QR BTH o ejecuta script minimo en WinBox.')
        return
      }

      let connected = false

      const bthResult = await bootstrapBthStep('bth_bootstrap')
      if (bthResult.ok) {
        if (bthResult.operational) {
          updateStep('verify_bth', 'success', 'Back To Home operativo y vinculado al sistema')
          connected = true
        } else {
          connected = await testConnectionStep('verify_bth', 'Conexion operativa tras BTH')
        }
      } else {
        updateStep('verify_bth', 'failed', bthResult.detail)
      }

      if (!connected) {
        const wgOk = await executeScriptStep('wg_tunnel', 'tunel WireGuard', quickConnect.scripts.wireguard_site_to_vps_script || '')
        if (wgOk) {
          const registered = await registerWireGuardPeerStep('wg_register_peer')
          if (registered) {
            connected = await testConnectionStep('verify_wg', 'Conexion por WireGuard operativa')
          } else {
            updateStep('verify_wg', 'skipped', 'Pendiente: registro de peer en VPS')
          }
        } else {
          updateStep('wg_register_peer', 'skipped', 'No aplicado: tunel WG fallo')
          updateStep('verify_wg', 'skipped', 'No aplicado: tunel WG fallo')
        }
      } else {
        updateStep('wg_tunnel', 'skipped', 'No requerido')
        updateStep('wg_register_peer', 'skipped', 'No requerido')
        updateStep('verify_wg', 'skipped', 'No requerido')
      }

      if (connected) {
        addToast('success', 'Conexion Express completada')
      } else {
        addToast('error', 'Conexion Express no pudo completar acceso remoto. Revisar pasos marcados en rojo.')
      }
    } finally {
      setExpressConnecting(false)
      await loadQuickConnect(selectedRouter.id, quickConnectScope)
      await loadRouterReadiness(selectedRouter.id)
      setConnectionWizardStep(3)
    }
  }

  const enableBackToHome = async () => {
    if (!selectedRouter) return
    setBthActionLoading(true)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/back-to-home/enable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withChangeTicket({ confirm: true })),
      })
      const payload = (await safeJson(response)) as { success?: boolean; error?: string } | null
      if (response.ok && payload?.success) {
        addToast('success', 'Back To Home habilitado en router')
      } else {
        addToast('error', payload?.error || 'No se pudo habilitar Back To Home')
      }
      await loadQuickConnect(selectedRouter.id, quickConnectScope)
    } catch (error) {
      console.error('Error enabling Back To Home:', error)
      addToast('error', 'Error de red habilitando Back To Home')
    } finally {
      setBthActionLoading(false)
    }
  }

  const createBackToHomeUser = async () => {
    if (!selectedRouter) return
    const userName = bthUserName.trim()
    if (!userName) {
      addToast('error', 'Ingresa un nombre de usuario BTH')
      return
    }
    setBthActionLoading(true)
    try {
      const payloadBody: Record<string, unknown> = {
        confirm: true,
        user_name: userName,
        allow_lan: bthAllowLan,
        comment: 'FastISP VPS',
      }
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/back-to-home/users/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withChangeTicket(payloadBody)
        ),
      })
      const payload = (await safeJson(response)) as { success?: boolean; error?: string } | null
      if (response.ok && payload?.success) {
        addToast('success', `Usuario BTH ${userName} creado`)
      } else {
        addToast('error', payload?.error || 'No se pudo crear usuario BTH')
      }
      await loadQuickConnect(selectedRouter.id, quickConnectScope)
    } catch (error) {
      console.error('Error creating Back To Home user:', error)
      addToast('error', 'Error de red creando usuario BTH')
    } finally {
      setBthActionLoading(false)
    }
  }

  const removeBackToHomeUser = async (userName: string) => {
    if (!selectedRouter || !userName.trim()) return
    setBthActionLoading(true)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/back-to-home/users/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withChangeTicket({
            confirm: true,
            user_name: userName.trim(),
          })
        ),
      })
      const payload = (await safeJson(response)) as { success?: boolean; error?: string } | null
      if (response.ok && payload?.success) {
        addToast('success', `Usuario BTH ${userName} eliminado`)
      } else {
        addToast('error', payload?.error || 'No se pudo eliminar usuario BTH')
      }
      await loadQuickConnect(selectedRouter.id, quickConnectScope)
    } catch (error) {
      console.error('Error removing Back To Home user:', error)
      addToast('error', 'Error de red eliminando usuario BTH')
    } finally {
      setBthActionLoading(false)
    }
  }

  const bootstrapBackToHome = async () => {
    if (!selectedRouter) return
    const userName = bthUserName.trim()
    if (!userName) {
      addToast('error', 'Ingresa un nombre de usuario BTH')
      return
    }

    setBthActionLoading(true)
    try {
      const payloadBody: Record<string, unknown> = {
        confirm: true,
        user_name: userName,
        allow_lan: bthAllowLan,
        replace_existing_user: true,
        fast_link_vps: true,
        comment: 'FastISP VPS',
      }
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/back-to-home/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          withChangeTicket(payloadBody)
        ),
      })
      const payload = (await safeJson(response)) as RouterBackToHomeBootstrapResponse | null
      if (response.ok && payload?.success) {
        setBootstrapResult(payload.bootstrap || null)
        const pendingCount = Array.isArray(payload.bootstrap?.missing) ? payload.bootstrap?.missing.length : 0
        const operational = Boolean(payload.bootstrap?.operational)
        if (operational) {
          addToast('success', payload.bootstrap?.message || 'Back To Home operativo y vinculado')
        } else {
          addToast('success', pendingCount > 0 ? `Bootstrap aplicado con ${pendingCount} pendiente(s)` : 'Bootstrap BTH aplicado correctamente')
        }
      } else {
        addToast('error', payload?.error || 'No se pudo ejecutar bootstrap Back To Home')
      }
      await loadQuickConnect(selectedRouter.id, quickConnectScope)
    } catch (error) {
      console.error('Error bootstrapping Back To Home:', error)
      addToast('error', 'Error de red ejecutando bootstrap BTH')
    } finally {
      setBthActionLoading(false)
    }
  }

  const confirmEnableBackToHome = () => {
    if (!selectedRouter) return
    openConfirm(`Habilitar Back To Home en ${selectedRouter.name}?`, () => {
      void enableBackToHome()
    })
  }

  const confirmCreateBackToHomeUser = () => {
    if (!selectedRouter) return
    const userName = bthUserName.trim()
    if (!userName) {
      addToast('error', 'Ingresa un nombre de usuario BTH')
      return
    }
    openConfirm(`Crear usuario Back To Home ${userName} en ${selectedRouter.name}?`, () => {
      void createBackToHomeUser()
    })
  }

  const confirmBootstrapBackToHome = () => {
    if (!selectedRouter) return
    const userName = bthUserName.trim()
    if (!userName) {
      addToast('error', 'Ingresa un nombre de usuario BTH')
      return
    }
    openConfirm(`Aplicar bootstrap BTH 1 clic en ${selectedRouter.name} para usuario ${userName}?`, () => {
      void bootstrapBackToHome()
    })
  }

  const confirmRemoveBackToHomeUser = (userName: string) => {
    if (!selectedRouter) return
    openConfirm(`Eliminar usuario Back To Home ${userName} de ${selectedRouter.name}?`, () => {
      void removeBackToHomeUser(userName)
    })
  }

  const confirmDeleteRouter = () => {
    if (!selectedRouter) return
    openConfirm(
      `Eliminar el router ${selectedRouter.name}? Esta accion no se puede deshacer y requiere que no tenga clientes vinculados.`,
      () => {
        void deleteSelectedRouter()
      }
    )
  }

  return (
    <div className="space-y-6">
      <ActionsHeader
        actionLoading={actionLoading}
        isAiLoading={isAiLoading}
        isLoading={isLoading}
        selectedRouter={selectedRouter}
        onTestConnection={testConnection}
        onBackupRouter={backupRouter}
        onRebootClick={() => openConfirm(`Reiniciar el router ${selectedRouter?.name}?`, rebootRouter)}
        onRunAiDiagnosis={runAiDiagnosis}
        onRefreshStats={() => selectedRouter && loadRouterStats(selectedRouter.id)}
        onShowLogs={() => setSidePanel('logs')}
        onShowDhcpLeases={() => setSidePanel('dhcp')}
        onShowWifiClients={() => setSidePanel('wifi')}
        onDeleteRouterClick={confirmDeleteRouter}
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Control de cambios</p>
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center">
          <input
            value={changeTicket}
            onChange={(e) => setChangeTicket(e.target.value)}
            placeholder="Ticket de cambio (ej: CHG-2026-0001)"
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 md:max-w-md"
          />
          <p className="text-xs text-amber-800">
            Se usa para acciones live (reinicio, scripts, hardening y operacion Back To Home).
          </p>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-amber-900">
          <input
            type="checkbox"
            checked={preflightAck}
            onChange={(e) => setPreflightAck(e.target.checked)}
            className="rounded border-amber-400"
          />
          Preflight validado para ejecutar cambios en vivo
        </label>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow">
        <h3 className="mb-3 text-lg font-semibold text-gray-900">Alta rapida de MikroTik</h3>
        <p className="mb-3 text-sm text-gray-600">
          Agrega routers nuevos con sus credenciales de API. Luego usa la pestana Configuracion para scripts de conexion remota.
        </p>
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Importar QR / WireGuard</p>
              <p className="text-xs text-blue-700">
                Sube QR en imagen o ZIP/CONF para autocompletar tunel y vincular rapido. Back To Home usa identidad automatica por tenant.
              </p>
            </div>
            <button
              onClick={handleWireGuardOnboardFilePick}
              disabled={wireGuardOnboarding}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {wireGuardOnboarding ? 'Conectando...' : 'QR/ZIP + conexion auto'}
            </button>
            <button
              onClick={handleWireGuardFilePick}
              disabled={wireGuardImporting}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {wireGuardImporting ? 'Importando...' : 'Solo leer QR/ZIP'}
            </button>
            <input
              ref={wireGuardFileInputRef}
              type="file"
              accept=".zip,.conf,.cfg,.txt,image/png,image/jpeg,image/webp,image/bmp"
              className="hidden"
              onChange={handleWireGuardFileChange}
            />
            <input
              ref={wireGuardOnboardFileInputRef}
              type="file"
              accept=".zip,.conf,.cfg,.txt,image/png,image/jpeg,image/webp,image/bmp"
              className="hidden"
              onChange={handleWireGuardOnboardFileChange}
            />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-blue-800 md:grid-cols-2">
            <label className="flex items-center gap-2 rounded border border-blue-200 bg-white px-2 py-1">
              <input
                type="checkbox"
                checked={wireGuardWriteProbe}
                onChange={(e) => setWireGuardWriteProbe(e.target.checked)}
                className="h-4 w-4"
              />
              Ejecutar write probe API durante onboarding
            </label>
            <label className="flex items-center gap-2 rounded border border-blue-200 bg-white px-2 py-1">
              <input
                type="checkbox"
                checked={wireGuardBootstrapOnboard}
                onChange={(e) => setWireGuardBootstrapOnboard(e.target.checked)}
                className="h-4 w-4"
              />
              Bootstrap Back To Home automatico
            </label>
          </div>
          {wireGuardImportSummary?.success && (
            <div className="mt-2 rounded border border-blue-300 bg-white p-2 text-xs text-blue-900">
              <p>
                Archivo: <strong>{wireGuardImportSummary.source_file || '-'}</strong>
              </p>
              <p>
                Endpoint: <strong>{wireGuardImportSummary.wireguard?.endpoint_host || '-'}</strong>
                {wireGuardImportSummary.wireguard?.endpoint_port ? `:${wireGuardImportSummary.wireguard?.endpoint_port}` : ''}
              </p>
              <p>
                Allowed IPs:{' '}
                <strong>{(wireGuardImportSummary.wireguard?.peer_allowed_ips || []).join(', ') || '-'}</strong>
              </p>
            </div>
          )}
          {wireGuardBootstrapOnboard && (
            <p className="mt-2 text-xs text-blue-700">
              Bootstrap en vivo requiere `change_ticket` y `preflight_ack=true` en este panel.
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <input
            value={routerForm.name}
            onChange={(e) => setRouterForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Nombre"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          />
          <input
            value={routerForm.ip_address}
            onChange={(e) => setRouterForm((prev) => ({ ...prev, ip_address: e.target.value }))}
            placeholder="IP o DNS (sin puerto)"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          />
          <input
            value={routerForm.username}
            onChange={(e) => setRouterForm((prev) => ({ ...prev, username: e.target.value }))}
            placeholder="Usuario API"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          />
          <input
            type="password"
            value={routerForm.password}
            onChange={(e) => setRouterForm((prev) => ({ ...prev, password: e.target.value }))}
            placeholder="Password API"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          />
          <div className="flex items-center gap-2">
            <input
              value={routerForm.api_port}
              onChange={(e) => setRouterForm((prev) => ({ ...prev, api_port: e.target.value }))}
              placeholder="Puerto API"
              className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
            <button
              onClick={createRouter}
              disabled={creatingRouter}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {creatingRouter ? 'Guardando...' : 'Agregar'}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow">
        <h3 className="mb-3 text-lg font-semibold text-gray-900">Seleccionar Router</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {routers.map((router) => (
            (() => {
              const snapshot = routerConnectionSnapshots[router.id]
              const diagnostics = snapshot?.diagnostics || null
              return (
                <button
                  key={router.id}
                  onClick={() => setSelectedRouter(router)}
                  className={`rounded-lg border p-4 text-left transition-all ${
                    selectedRouter?.id === router.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <ServerIcon className="h-6 w-6 text-green-500" />
                      <div>
                        <div className="font-medium text-gray-900">{router.name}</div>
                        <div className="text-sm text-gray-600">{router.ip_address}</div>
                        <div className="text-xs text-gray-500">{router.model || '-'}</div>
                        <div className="mt-1 text-[11px] text-gray-500">
                          Ultimo check: {formatConnectionCheckedAt(snapshot?.checkedAt)}
                        </div>
                      </div>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${getConnectionStatusTone(diagnostics)}`}>
                      {getConnectionStatusLabel(diagnostics)}
                    </span>
                  </div>
                </button>
              )
            })()
          ))}
        </div>
        {!routers.length && <p className="mt-3 text-sm text-gray-500">No hay routers registrados todavia.</p>}
      </div>

      {selectedRouter && (
        <>
          <div className="my-4">
            <AIDiagnosis isLoading={isAiLoading} analysis={aiAnalysis} error={aiError} />
          </div>

          <div className="border-b border-gray-200">
            <nav className="flex space-x-8">
              {[
                { id: 'overview', name: 'Resumen', icon: ChartBarIcon },
                { id: 'queues', name: 'Colas', icon: UserGroupIcon },
                { id: 'connections', name: 'Conexiones', icon: WifiIcon },
                { id: 'config', name: 'Configuracion', icon: CogIcon },
                { id: 'security', name: 'Seguridad', icon: ShieldCheckIcon },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as 'overview' | 'queues' | 'connections' | 'config' | 'security')}
                  className={`flex items-center space-x-2 border-b-2 px-1 py-3 text-sm font-medium ${
                    activeTab === tab.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <tab.icon className="h-4 w-4" />
                  <span>{tab.name}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow">
            {isLoading ? (
              <div className="py-12 text-center">
                <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
                <p className="mt-4 text-gray-600">Cargando informacion del router...</p>
              </div>
            ) : (
              <>
                {activeTab === 'overview' && <OverviewTab routerStats={routerStats} />}
                {activeTab === 'queues' && (
                  <QueuesTab
                    routerStats={routerStats}
                    setRouterStats={setRouterStats}
                    selectedRouter={selectedRouter}
                    apiFetch={apiFetch}
                    addToast={addToast}
                    openConfirm={openConfirm}
                  />
                )}
                {activeTab === 'connections' && (
                  <ConnectionsTab
                    routerStats={routerStats}
                    setRouterStats={setRouterStats}
                    selectedRouter={selectedRouter}
                    apiFetch={apiFetch}
                    addToast={addToast}
                    openConfirm={openConfirm}
                  />
                )}
                {activeTab === 'config' && (
                  <div className="space-y-4">
                    <h4 className="text-lg font-semibold text-gray-900">Conexion remota rapida</h4>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-800">Perfil de acceso WAN</p>
                        <div className="flex items-center gap-2">
                          <select
                            value={quickConnectScope}
                            onChange={(e) => setQuickConnectScope(e.target.value as 'auto' | 'public' | 'private')}
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900"
                          >
                            <option value="auto">Auto detectar</option>
                            <option value="public">Forzar publica</option>
                            <option value="private">Forzar privada</option>
                          </select>
                          <button
                            onClick={() => selectedRouter && void loadQuickConnect(selectedRouter.id, quickConnectScope)}
                            disabled={quickLoading}
                            className="rounded bg-slate-700 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                          >
                            Aplicar
                          </button>
                        </div>
                      </div>
                      {quickConnect?.access_profile && (
                        <div className="mt-2 space-y-1 text-xs text-gray-700">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-200 px-2 py-1 font-semibold text-slate-700">
                              detectado: {quickConnect.access_profile.detected_scope || 'unknown'}
                            </span>
                            <span className="rounded-full bg-blue-100 px-2 py-1 font-semibold text-blue-700">
                              efectivo: {quickConnect.access_profile.effective_scope || 'unknown'}
                            </span>
                            <span className="rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-700">
                              recomendado: {quickConnect.access_profile.recommended_transport || '-'}
                            </span>
                          </div>
                          <p>{quickConnect.access_profile.reason || '-'}</p>
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">Diagnostico de conexion API</p>
                          <p className="text-xs text-gray-500">Muestra la causa real del ultimo test: DNS, puerto, login API y ruta sugerida para el operador.</p>
                          <p className="text-[11px] text-gray-500">
                            Monitoreo automatico cada {Math.round(CONNECTION_POLL_INTERVAL_MS / 1000)}s mientras esta abierta esta pestaña.
                            Ultimo check: {formatConnectionCheckedAt(activeConnectionSnapshot?.checkedAt)}
                          </p>
                        </div>
                        {activeConnectionDiagnostics && (
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              getConnectionStatusTone(activeConnectionDiagnostics)
                            }`}
                          >
                            {getConnectionStatusLabel(activeConnectionDiagnostics)}
                          </span>
                        )}
                      </div>
                      {!activeConnectionDiagnostics && (
                        <p className="text-xs text-gray-500">Todavia no hay un diagnostico guardado para este router. Usa "Probar conexion" o la validacion del wizard.</p>
                      )}
                      {activeConnectionDiagnostics && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-semibold ${
                                activeConnectionDiagnostics.success ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                              }`}
                            >
                              {activeConnectionDiagnostics.summary || 'Sin resumen'}
                            </span>
                            {activeConnectionDiagnostics.transport_hint && (
                              <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700">
                                Ruta sugerida: {activeConnectionDiagnostics.transport_hint}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-600">
                            Host <strong>{activeConnectionDiagnostics.host || selectedRouter.ip_address}</strong>:{' '}
                            <strong>{activeConnectionDiagnostics.api_port || '-'}</strong> | tipo:{' '}
                            <strong>{describeHostScope(activeConnectionDiagnostics.host_scope)}</strong>
                          </p>
                          <ul className="space-y-1 text-xs text-gray-700">
                            {(activeConnectionDiagnostics.checks || []).map((check) => {
                              const severity = check.severity || (check.ok ? 'ok' : 'warning')
                              const toneClass =
                                severity === 'critical'
                                  ? 'bg-rose-100 text-rose-700'
                                  : severity === 'warning'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-emerald-100 text-emerald-700'
                              return (
                                <li key={check.id} className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded px-2 py-0.5 font-semibold ${toneClass}`}>{check.id}</span>
                                  <span>{check.detail || '-'}</span>
                                </li>
                              )
                            })}
                          </ul>
                          {(activeConnectionDiagnostics.recommendations || []).length > 0 && (
                            <div className="rounded border border-sky-200 bg-sky-50 p-2">
                              <p className="text-xs font-semibold uppercase text-sky-700">Mejoras sugeridas</p>
                              <ul className="mt-1 space-y-1 text-xs text-sky-800">
                                {(activeConnectionDiagnostics.recommendations || []).map((item, idx) => (
                                  <li key={`${item}-${idx}`}>- {item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-800">Readiness remoto del router</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => selectedRouter && void loadRouterReadiness(selectedRouter.id)}
                            disabled={readinessLoading}
                            className="rounded bg-slate-700 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                          >
                            Refrescar
                          </button>
                          <button
                            onClick={() => selectedRouter && void loadRouterReadiness(selectedRouter.id, true)}
                            disabled={readinessLoading}
                            className="rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                          >
                            Refrescar + write probe
                          </button>
                        </div>
                      </div>
                      {readinessLoading && <p className="text-xs text-gray-500">Evaluando readiness...</p>}
                      {!readinessLoading && !routerReadiness && (
                        <p className="text-xs text-gray-500">Sin datos de readiness para este router.</p>
                      )}
                      {!readinessLoading && routerReadiness && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
                              Score {routerReadiness.score ?? 0}%
                            </span>
                            <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">
                              Blockers {(routerReadiness.blockers || []).length}
                            </span>
                          </div>
                          <ul className="space-y-1 text-xs text-gray-700">
                            {(routerReadiness.checks || []).map((check) => {
                              const severity = check.severity || (check.ok ? 'ok' : 'warning')
                              const toneClass =
                                severity === 'critical'
                                  ? 'bg-rose-100 text-rose-700'
                                  : severity === 'warning'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-emerald-100 text-emerald-700'
                              return (
                                <li key={check.id} className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded px-2 py-0.5 font-semibold ${toneClass}`}>{check.id}</span>
                                  <span>{check.detail || '-'}</span>
                                </li>
                              )
                            })}
                          </ul>
                          {(routerReadiness.recommendations || []).length > 0 && (
                            <div className="rounded border border-amber-200 bg-amber-50 p-2">
                              <p className="text-xs font-semibold uppercase text-amber-700">Recomendaciones</p>
                              <ul className="mt-1 space-y-1 text-xs text-amber-800">
                                {(routerReadiness.recommendations || []).map((item, idx) => (
                                  <li key={`${item}-${idx}`}>- {item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {quickLoading && <p className="text-sm text-gray-500">Cargando scripts...</p>}
                    {!quickLoading && !quickConnect?.scripts && (
                      <p className="text-sm text-rose-600">No se pudieron cargar scripts para este router.</p>
                    )}
                    {quickConnect?.scripts && (
                      <>
                        {quickConnect.connection_plan && (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-emerald-800">
                                  {quickConnect.connection_plan.title || 'Conexion Express'}
                                </p>
                                <p className="text-xs text-emerald-700">
                                  {quickConnect.connection_plan.summary || 'Sigue los pasos recomendados.'}
                                </p>
                              </div>
                              <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                                {quickConnect.connection_plan.recommended_transport || '-'}
                              </span>
                            </div>
                            {quickConnect.wireguard_profile && (
                              <div className={`mt-2 rounded border p-2 text-xs ${
                                quickConnect.wireguard_profile.ready
                                  ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
                                  : 'border-amber-200 bg-amber-50 text-amber-800'
                              }`}>
                                <p>
                                  Perfil WG: <strong>{quickConnect.wireguard_profile.ready ? 'listo' : 'incompleto'}</strong> | endpoint:{' '}
                                  <strong>{quickConnect.wireguard_profile.endpoint || '-'}</strong>
                                </p>
                                {!quickConnect.wireguard_profile.ready && (quickConnect.wireguard_profile.issues || []).length > 0 && (
                                  <p className="mt-1">
                                    {(quickConnect.wireguard_profile.issues || []).join(' | ')}
                                  </p>
                                )}
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap gap-2">
                              {[1, 2, 3].map((step) => (
                                <button
                                  key={step}
                                  onClick={() => setConnectionWizardStep(step as 1 | 2 | 3)}
                                  className={`rounded px-3 py-1 text-xs font-semibold ${
                                    connectionWizardStep === step
                                      ? 'bg-emerald-700 text-white'
                                      : 'bg-white text-emerald-800'
                                  }`}
                                >
                                  Paso {step}
                                </button>
                              ))}
                            </div>

                            {connectionWizardStep === 1 && (
                              <div className="mt-2 rounded border border-emerald-200 bg-white p-3">
                                <p className="text-xs font-semibold uppercase text-emerald-800">Paso 1: Deteccion</p>
                                <p className="mt-1 text-xs text-emerald-700">
                                  Detecta automaticamente si conviene conexion directa o tunel (WireGuard/BTH).
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <button
                                    onClick={() => void runWizardDetection()}
                                    disabled={quickLoading || readinessLoading}
                                    className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                                  >
                                    {quickLoading || readinessLoading ? 'Detectando...' : 'Detectar ruta'}
                                  </button>
                                  <button
                                    onClick={() => setConnectionWizardStep(2)}
                                    className="rounded bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-300"
                                  >
                                    Continuar al paso 2
                                  </button>
                                </div>
                              </div>
                            )}

                            {connectionWizardStep === 2 && (
                              <div className="mt-2 rounded border border-emerald-200 bg-white p-3">
                                <p className="text-xs font-semibold uppercase text-emerald-800">Paso 2: Ejecutar conexion</p>
                                <p className="mt-1 text-xs text-emerald-700">
                                  Conexion Express intenta Back To Home primero y usa WireGuard solo como opcion de respaldo.
                                </p>
                                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-1">
                                  <input
                                    value={bthUserName}
                                    onChange={(e) => setBthUserName(e.target.value)}
                                    placeholder="Usuario BTH (ej: noc-vps)"
                                    className="rounded border border-emerald-300 px-2 py-1 text-xs text-gray-900"
                                  />
                                </div>
                                <label className="mt-2 flex items-center gap-2 text-xs text-emerald-800">
                                  <input
                                    type="checkbox"
                                    checked={bthAllowLan}
                                    onChange={(e) => setBthAllowLan(e.target.checked)}
                                    className="rounded border-emerald-300"
                                  />
                                  Permitir acceso LAN en fallback BTH
                                </label>
                                <p className="mt-2 text-xs text-emerald-700">
                                  Identidad BTH:{' '}
                                  <strong>
                                    {quickConnect.back_to_home?.managed_identity?.enabled ? 'automatica por tenant' : 'pendiente'}
                                  </strong>
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <button
                                    onClick={() => void runConnectionExpress()}
                                    disabled={expressConnecting || bthActionLoading || quickLoading}
                                    className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                                  >
                                    {expressConnecting ? 'Conectando...' : 'Conectar Router Ahora'}
                                  </button>
                                  <button
                                    onClick={() => setConnectionWizardStep(3)}
                                    className="rounded bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-300"
                                  >
                                    Ir al paso 3
                                  </button>
                                </div>
                              </div>
                            )}

                            {connectionWizardStep === 3 && (
                              <div className="mt-2 rounded border border-emerald-200 bg-white p-3">
                                <p className="text-xs font-semibold uppercase text-emerald-800">Paso 3: Validar</p>
                                <p className="mt-1 text-xs text-emerald-700">
                                  Verifica que el router responda y que la ruta remota quede operativa.
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <span className={`rounded px-2 py-1 text-xs font-semibold ${routerReadiness?.checks?.find((item) => item.id === 'api_connectivity')?.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                    API {routerReadiness?.checks?.find((item) => item.id === 'api_connectivity')?.ok ? 'OK' : 'pendiente'}
                                  </span>
                                  <span className={`rounded px-2 py-1 text-xs font-semibold ${quickConnect.back_to_home?.reachable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                    Reachability {quickConnect.back_to_home?.reachable ? 'OK' : 'sin confirmar'}
                                  </span>
                                  <span className={`rounded px-2 py-1 text-xs font-semibold ${expressSteps.some((step) => step.status === 'failed') ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                                    Fallback {expressSteps.some((step) => step.status === 'failed') ? 'con incidencias' : 'sin incidencias'}
                                  </span>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <button
                                    onClick={() => void runWizardValidation()}
                                    disabled={wizardValidating || quickLoading || readinessLoading}
                                    className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                                  >
                                    {wizardValidating ? 'Validando...' : 'Validar conexion'}
                                  </button>
                                  <button
                                    onClick={() => setConnectionWizardStep(1)}
                                    className="rounded bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-300"
                                  >
                                    Reiniciar asistente
                                  </button>
                                </div>
                              </div>
                            )}

                            {expressSteps.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {expressSteps.map((step) => {
                                  const toneClass =
                                    step.status === 'success'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : step.status === 'failed'
                                        ? 'bg-rose-100 text-rose-800'
                                        : step.status === 'running'
                                          ? 'bg-blue-100 text-blue-800'
                                          : step.status === 'skipped'
                                            ? 'bg-slate-200 text-slate-700'
                                            : 'bg-white text-slate-700'
                                  return (
                                    <div key={step.id} className={`rounded px-2 py-1 text-xs ${toneClass}`}>
                                      <strong>{step.label}</strong>
                                      {step.detail ? `: ${step.detail}` : ''}
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            <div className="mt-2 flex items-center justify-between rounded border border-emerald-200 bg-white p-2">
                              <p className="text-xs text-emerald-800">Modo avanzado (scripts/manual)</p>
                              <button
                                onClick={() => setShowAdvancedScripts((prev) => !prev)}
                                className="rounded bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-800"
                              >
                                {showAdvancedScripts ? 'Ocultar avanzado' : 'Mostrar avanzado'}
                              </button>
                            </div>

                            {(quickConnect.connection_plan.actions || []).length > 0 && (
                              <div className="mt-2 space-y-2">
                                {(quickConnect.connection_plan.actions || []).map((action) => {
                                  const scriptValue = resolveQuickScript(quickConnect.scripts, action.script_key)
                                  return (
                                    <div key={action.id} className="rounded border border-emerald-200 bg-white p-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                          <p className="text-xs font-semibold text-emerald-900">{action.label}</p>
                                          <p className="text-xs text-emerald-800">{action.description || '-'}</p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          {action.requires_local_access && (
                                            <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                              paso local
                                            </span>
                                          )}
                                          {action.auto_available && (
                                            <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                              auto
                                            </span>
                                          )}
                                          {scriptValue && (
                                            <button
                                              onClick={() => copyScript(`script ${action.label}`, scriptValue)}
                                              className="rounded bg-emerald-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-800"
                                            >
                                              Copiar script
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                        {showAdvancedScripts && (
                          <>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm font-semibold text-gray-800">Script acceso directo API/SSH</p>
                            <button
                              onClick={() => copyScript('script API', quickConnect.scripts?.direct_api_script || '')}
                              className="rounded bg-gray-800 px-2 py-1 text-xs font-semibold text-white hover:bg-gray-700"
                            >
                              Copiar
                            </button>
                          </div>
                          <pre className="max-h-52 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
                            {quickConnect.scripts.direct_api_script}
                          </pre>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm font-semibold text-gray-800">Script WireGuard sitio a VPS</p>
                            <button
                              onClick={() => copyScript('script WireGuard', quickConnect.scripts?.wireguard_site_to_vps_script || '')}
                              className="rounded bg-gray-800 px-2 py-1 text-xs font-semibold text-white hover:bg-gray-700"
                            >
                              Copiar
                            </button>
                          </div>
                          <pre className="max-h-52 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
                            {quickConnect.scripts.wireguard_site_to_vps_script}
                          </pre>
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="rounded-lg border border-gray-200 p-3">
                            <p className="text-xs font-semibold uppercase text-gray-500">Login Windows/Linux</p>
                            <p className="mt-2 rounded bg-slate-900 px-2 py-1 text-xs text-slate-100">{quickConnect.scripts.windows_login}</p>
                            <p className="mt-2 rounded bg-slate-900 px-2 py-1 text-xs text-slate-100">{quickConnect.scripts.linux_login}</p>
                          </div>
                          <div className="rounded-lg border border-gray-200 p-3">
                            <p className="text-xs font-semibold uppercase text-gray-500">Back To Home</p>
                            <ul className="mt-2 space-y-1 text-xs text-gray-700">
                              {(quickConnect.guidance?.back_to_home || []).map((step, idx) => (
                                <li key={idx}>- {step}</li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        {quickConnect.back_to_home && (
                          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${quickConnect.back_to_home.reachable ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                {quickConnect.back_to_home.reachable ? 'router reachable' : 'router unreachable'}
                              </span>
                              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${quickConnect.back_to_home.supported ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {quickConnect.back_to_home.supported ? 'BTH soportado' : 'BTH no confirmado'}
                              </span>
                              {quickConnect.back_to_home.routeros_version && (
                                <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">
                                  RouterOS {quickConnect.back_to_home.routeros_version}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-700">
                              DDNS: <strong>{String(quickConnect.back_to_home.ddns_enabled ?? 'unknown')}</strong> | BTH VPN: <strong>{quickConnect.back_to_home.back_to_home_vpn || '-'}</strong> | Estado: <strong>{quickConnect.back_to_home.vpn_status || '-'}</strong>
                            </p>
                            <p className="text-xs text-gray-700">
                              DNS: <strong>{quickConnect.back_to_home.vpn_dns_name || '-'}</strong> | Interfaz: <strong>{quickConnect.back_to_home.vpn_interface || '-'}</strong> | Puerto: <strong>{quickConnect.back_to_home.vpn_port || '-'}</strong>
                            </p>

                            <div className="rounded border border-gray-300 bg-white p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-semibold uppercase text-gray-600">Acciones operativas BTH</p>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={confirmBootstrapBackToHome}
                                    disabled={bthActionLoading || !quickConnect.back_to_home.reachable}
                                    className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                                  >
                                    {bthActionLoading ? 'Procesando...' : 'Bootstrap 1 clic'}
                                  </button>
                                  <button
                                    onClick={confirmEnableBackToHome}
                                    disabled={bthActionLoading || !quickConnect.back_to_home.reachable}
                                    className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                                  >
                                    {bthActionLoading ? 'Procesando...' : 'Solo habilitar BTH'}
                                  </button>
                                </div>
                              </div>
                              <p className="mt-2 text-xs text-gray-600">
                                Bootstrap 1 clic aplica DDNS + BTH + usuario VPS. "Solo habilitar" mantiene el flujo manual.
                              </p>

                              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-1">
                                <input
                                  value={bthUserName}
                                  onChange={(e) => setBthUserName(e.target.value)}
                                  placeholder="Usuario BTH (ej: noc-vps)"
                                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-900"
                                />
                              </div>

                              <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={bthAllowLan}
                                  onChange={(e) => setBthAllowLan(e.target.checked)}
                                  className="rounded border-gray-300"
                                />
                                Permitir acceso LAN desde este usuario BTH
                              </label>
                              <p className="mt-2 text-xs text-gray-600">
                                Identidad BTH:{' '}
                                <strong>
                                  {quickConnect.back_to_home?.managed_identity?.enabled ? 'automatica por tenant' : 'automatica pendiente'}
                                </strong>
                              </p>

                              <div className="mt-3">
                                <button
                                  onClick={confirmCreateBackToHomeUser}
                                  disabled={bthActionLoading || quickConnect.back_to_home.bth_users_supported === false}
                                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                                >
                                  {bthActionLoading ? 'Procesando...' : 'Crear usuario BTH para VPS'}
                                </button>
                                {quickConnect.back_to_home.bth_users_supported === false && (
                                  <p className="mt-2 text-xs text-amber-700">
                                    Este router no expone API de usuarios BTH. Requiere RouterOS 7.14+.
                                  </p>
                                )}
                              </div>

                              {bootstrapResult && (
                                <div className="mt-3 rounded border border-slate-300 bg-slate-50 p-2">
                                  <p className="text-xs font-semibold uppercase text-slate-700">Resultado bootstrap</p>
                                  <p className="mt-1 text-xs text-slate-700">
                                    Usuario visible despues de ejecutar: <strong>{String(bootstrapResult.user_visible_after_run ?? false)}</strong>
                                  </p>
                                  {Array.isArray(bootstrapResult.missing) && bootstrapResult.missing.length > 0 && (
                                    <ul className="mt-2 space-y-1 text-xs text-amber-700">
                                      {bootstrapResult.missing.map((item, idx) => (
                                        <li key={`${item}-${idx}`}>- {item}</li>
                                      ))}
                                    </ul>
                                  )}
                                  {Array.isArray(bootstrapResult.next_steps) && bootstrapResult.next_steps.length > 0 && (
                                    <ul className="mt-2 space-y-1 text-xs text-slate-700">
                                      {bootstrapResult.next_steps.map((item, idx) => (
                                        <li key={`${item}-${idx}`}>- {item}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}
                            </div>

                            {quickConnect.back_to_home.scripts?.enable_script && (
                              <div className="rounded border border-gray-300 bg-white p-2">
                                <div className="mb-2 flex items-center justify-between">
                                  <p className="text-xs font-semibold uppercase text-gray-600">Script habilitar Back To Home</p>
                                  <button
                                    onClick={() => copyScript('script BTH enable', quickConnect.back_to_home?.scripts?.enable_script || '')}
                                    className="rounded bg-gray-800 px-2 py-1 text-xs font-semibold text-white hover:bg-gray-700"
                                  >
                                    Copiar
                                  </button>
                                </div>
                                <pre className="max-h-40 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-100">
                                  {quickConnect.back_to_home.scripts.enable_script}
                                </pre>
                              </div>
                            )}

                            {quickConnect.back_to_home.scripts?.add_vps_user_script && (
                              <div className="rounded border border-gray-300 bg-white p-2">
                                <div className="mb-2 flex items-center justify-between">
                                  <p className="text-xs font-semibold uppercase text-gray-600">Script usuario BTH para VPS</p>
                                  <button
                                    onClick={() => copyScript('script BTH VPS', quickConnect.back_to_home?.scripts?.add_vps_user_script || '')}
                                    className="rounded bg-gray-800 px-2 py-1 text-xs font-semibold text-white hover:bg-gray-700"
                                  >
                                    Copiar
                                  </button>
                                </div>
                                <pre className="max-h-40 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-100">
                                  {quickConnect.back_to_home.scripts.add_vps_user_script}
                                </pre>
                                <p className="mt-2 text-xs text-gray-600">
                                  Generar private key WireGuard en VPS: <code>{quickConnect.back_to_home.scripts.generate_private_key_hint}</code>
                                </p>
                              </div>
                            )}

                            {Array.isArray(quickConnect.back_to_home.users) && quickConnect.back_to_home.users.length > 0 && (
                              <div className="rounded border border-gray-300 bg-white p-2">
                                <p className="text-xs font-semibold uppercase text-gray-600">Usuarios BTH actuales</p>
                                <ul className="mt-2 space-y-2 text-xs text-gray-700">
                                  {quickConnect.back_to_home.users.map((user, idx) => (
                                    <li key={`${user.name}-${idx}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1">
                                      <span>
                                        {user.name} | allow-lan: {String(user.allow_lan)} | disabled: {String(user.disabled)} | expires: {user.expires || '-'}
                                      </span>
                                      <button
                                        onClick={() => confirmRemoveBackToHomeUser(user.name)}
                                        disabled={bthActionLoading || !user.name}
                                        className="rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                                      >
                                        Eliminar
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {Array.isArray(quickConnect.back_to_home.limitations) && quickConnect.back_to_home.limitations.length > 0 && (
                              <div className="rounded border border-gray-300 bg-white p-2">
                                <p className="text-xs font-semibold uppercase text-gray-600">Limitaciones BTH</p>
                                <ul className="mt-2 space-y-1 text-xs text-gray-700">
                                  {quickConnect.back_to_home.limitations.map((item, idx) => (
                                    <li key={idx}>- {item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {quickConnect.back_to_home.users_error && (
                              <p className="text-xs text-amber-700">No fue posible leer usuarios BTH: {quickConnect.back_to_home.users_error}</p>
                            )}
                            {quickConnect.back_to_home.error && (
                              <p className="text-xs text-rose-700">Error BTH: {quickConnect.back_to_home.error}</p>
                            )}
                          </div>
                        )}
                        </>
                        )}
                      </>
                    )}
                  </div>
                )}
                {activeTab === 'security' && (
                  <div className="space-y-4 text-sm text-gray-700">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <h4 className="text-lg font-semibold text-gray-900">Operacion enterprise y seguridad</h4>
                      <p className="mt-1 text-xs text-gray-600">
                        Acciones live requieren ticket de cambio cuando la politica `change_control_required_for_live` esta activa.
                      </p>
                      {(quickConnect?.guidance?.notes || []).map((note, idx) => (
                        <p key={idx} className="mt-2 text-xs text-gray-700">
                          - {note}
                        </p>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div className="rounded-lg border border-gray-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-gray-900">Hardening runbook</p>
                          <span className={`rounded px-2 py-1 text-xs font-semibold ${hardeningDryRun ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {hardeningDryRun ? 'dry-run' : 'live'}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                          <label className="text-xs text-gray-700">
                            Perfil router
                            <select
                              value={hardeningProfile}
                              onChange={(e) => setHardeningProfile(e.target.value)}
                              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-900"
                            >
                              {(enterpriseProfiles?.router_profiles || [{ id: 'baseline', label: 'Baseline' }]).map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs text-gray-700">
                            Perfil sitio
                            <select
                              value={hardeningSiteProfile}
                              onChange={(e) => setHardeningSiteProfile(e.target.value)}
                              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-900"
                            >
                              {(enterpriseProfiles?.site_profiles || [{ id: 'access', label: 'Access' }]).map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-3">
                          <label className="flex items-center gap-2 text-xs text-gray-700">
                            <input
                              type="checkbox"
                              checked={hardeningDryRun}
                              onChange={(e) => setHardeningDryRun(e.target.checked)}
                              className="rounded border-gray-300"
                            />
                            Ejecutar dry-run
                          </label>
                          <label className="flex items-center gap-2 text-xs text-gray-700">
                            <input
                              type="checkbox"
                              checked={hardeningAutoRollback}
                              onChange={(e) => setHardeningAutoRollback(e.target.checked)}
                              className="rounded border-gray-300"
                            />
                            Auto rollback si falla live
                          </label>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={applyEnterpriseHardening}
                            disabled={securityBusy}
                            className="rounded bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                          >
                            {securityBusy ? 'Procesando...' : hardeningDryRun ? 'Ejecutar hardening dry-run' : 'Aplicar hardening live'}
                          </button>
                          <button
                            onClick={() => selectedRouter && loadEnterpriseProfiles(selectedRouter.id)}
                            disabled={securityBusy}
                            className="rounded bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-300 disabled:opacity-60"
                          >
                            Refrescar perfiles
                          </button>
                        </div>

                        {hardeningResult && (
                          <div className="mt-3 rounded border border-gray-300 bg-gray-50 p-2">
                            <p className="text-xs font-semibold uppercase text-gray-700">Resultado hardening</p>
                            <p className="mt-1 text-xs text-gray-700">
                              change_id: <strong>{hardeningResult.change_id || '-'}</strong> | modo:{' '}
                              <strong>{hardeningResult.dry_run ? 'dry-run' : 'live'}</strong>
                            </p>
                            {hardeningResult.message && <p className="mt-1 text-xs text-gray-700">{hardeningResult.message}</p>}
                            {hardeningResult.error && <p className="mt-1 text-xs text-rose-700">{hardeningResult.error}</p>}
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-white p-4">
                        <p className="text-sm font-semibold text-gray-900">Failover test</p>
                        <p className="mt-1 text-xs text-gray-600">
                          Ejecuta probes desde el router para validar perdida de paquetes y latencia.
                        </p>
                        <textarea
                          value={failoverTargets}
                          onChange={(e) => setFailoverTargets(e.target.value)}
                          rows={3}
                          placeholder="1.1.1.1,8.8.8.8,9.9.9.9"
                          className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-900"
                        />
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            value={failoverCount}
                            onChange={(e) => setFailoverCount(e.target.value)}
                            className="w-20 rounded border border-gray-300 px-2 py-1 text-xs text-gray-900"
                          />
                          <button
                            onClick={runEnterpriseFailoverTest}
                            disabled={securityBusy}
                            className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                          >
                            {securityBusy ? 'Procesando...' : 'Ejecutar failover test'}
                          </button>
                        </div>

                        {failoverResult && (
                          <div className="mt-3 rounded border border-gray-300 bg-gray-50 p-2">
                            <p className="text-xs font-semibold uppercase text-gray-700">
                              Estado general: <span className="font-bold">{failoverResult.overall_status || 'unknown'}</span>
                            </p>
                            <div className="mt-2 max-h-44 overflow-auto">
                              {(failoverResult.targets || []).map((item, idx) => (
                                <p key={`${item.target}-${idx}`} className="text-xs text-gray-700">
                                  {item.target} | loss {item.packet_loss}% | avg {item.avg_latency_ms ?? '-'} ms | {item.status}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900">Change log y rollback</p>
                        <button
                          onClick={() => selectedRouter && loadEnterpriseChangeLog(selectedRouter.id)}
                          disabled={securityBusy}
                          className="rounded bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-300 disabled:opacity-60"
                        >
                          Refrescar log
                        </button>
                      </div>
                      {!enterpriseChangeLog.length && <p className="mt-2 text-xs text-gray-500">No hay cambios registrados.</p>}
                      <div className="mt-2 space-y-2">
                        {enterpriseChangeLog.map((entry) => (
                          <div key={entry.change_id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 px-2 py-2">
                            <div className="text-xs text-gray-700">
                              <p>
                                <strong>{entry.change_id}</strong> | {entry.category || '-'} | {entry.status}
                              </p>
                              <p>
                                actor: {entry.actor || '-'} | profile: {entry.profile || '-'} | site: {entry.site_profile || '-'}
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                openConfirm(`Ejecutar rollback del cambio ${entry.change_id}?`, () => {
                                  void rollbackEnterpriseChange(entry.change_id)
                                })
                              }
                              disabled={securityBusy || entry.status !== 'applied'}
                              className="rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              Rollback
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      <SidePanels
        sidePanel={sidePanel}
        onClose={() => setSidePanel('none')}
        selectedRouterId={selectedRouter?.id || null}
        apiFetch={apiFetch}
        addToast={addToast}
      />

      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded px-4 py-2 text-white shadow ${t.type === 'success' ? 'bg-green-600' : t.type === 'error' ? 'bg-red-600' : 'bg-slate-700'}`}>
            {t.message}
          </div>
        ))}
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmOpen(false)}></div>
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
              <h4 className="mb-2 text-lg font-semibold text-gray-900">Confirmar accion</h4>
              <p className="mb-4 text-gray-700">{confirmMessage}</p>
              <div className="flex justify-end gap-2">
                <button className="rounded bg-slate-200 px-4 py-2 hover:bg-slate-300" onClick={() => setConfirmOpen(false)}>
                  Cancelar
                </button>
                <button
                  className="rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
                  onClick={() => {
                    setConfirmOpen(false)
                    if (confirmActionRef.current) confirmActionRef.current()
                  }}
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MikroTikManagement
