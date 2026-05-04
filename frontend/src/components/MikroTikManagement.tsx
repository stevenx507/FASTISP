import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChartBarIcon,
  CogIcon,
  ServerIcon,
  ShieldCheckIcon,
  UserGroupIcon,
  WifiIcon,
  SparklesIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline'
import AIDiagnosis from './mikrotik/AIDiagnosis'
import ActionsHeader from './mikrotik/ActionsHeader'
import ConnectionsTab from './mikrotik/ConnectionsTab'
import OverviewTab from './mikrotik/OverviewTab'
import QueuesTab from './mikrotik/QueuesTab'
import LogsTab from './mikrotik/LogsTab'
import SidePanels from './mikrotik/SidePanels'
import config from '../lib/config'
import { useAuthStore } from '../store/authStore'
import { 
  RouterItem, 
  RouterStats, 
  Toast, 
  RouterFormState, 
  RouterSnmpFormState,
  RouterQuickConnectResponse,
  EnterpriseProfilesPayload,
  EnterpriseHardeningResult,
  EnterpriseFailoverResult,
  EnterpriseChangeLogEntry,
  RouterBackToHomeBootstrapData,
  RouterConnectionDiagnosticsPayload,
  RouterReadinessPayload,
  RouterSnmpProfilePayload,
  RouterSnmpPollResponse,
  RouterQuickScripts,
  RouterQuickGuidance,
  RouterConnectionPlan,
  RouterConnectionPlanAction,
  ExpressStepState,
  RouterAccessProfile,
  RouterBackToHomeUser,
  RouterBackToHomeScripts,
  RouterBackToHomeStatus,
  RouterWireGuardProfile,
  RouterWireGuardRegisterAttempt,
  RouterWireGuardRegisterVpsSync,
  RouterWireGuardRegisterResponse,
  RouterBackToHomeBootstrapResponse,
  EnterpriseProfileOption,
  EnterpriseProfilesResponse,
  EnterpriseHardeningResponse,
  EnterpriseFailoverTarget,
  EnterpriseFailoverReport,
  EnterpriseFailoverResponse,
  EnterpriseChangeLogResponse,
  WireGuardImportData,
  WireGuardImportSuggestions,
  WireGuardImportResponse,
  RouterReadinessCheck,
  RouterReadinessBlocker,
  RouterReadinessResponse,
  WireGuardOnboardResponse,
  TenantScopePayload,
  RouterOnboardingProfile,
  RouterOnboardingProfileResponse,
  LogItem,
  RouterListResponse,
  RouterCreateResponse,
  SstpTunnelData,
  RememberConnectionDiagnosticsOptions,
  RouterConnectionActionResponse,
  RouterSnmpProfileResponse,
  RouterConnectionSnapshot
} from './mikrotik/types'

import RoutersTable from './mikrotik/RoutersTable'
import RouterFormModal from './mikrotik/RouterFormModal'
import ConfigTab from './mikrotik/ConfigTab'
import SecurityTab from './mikrotik/SecurityTab'
import TrafficFlowTab from './mikrotik/TrafficFlowTab'
import VpnTab from './mikrotik/VpnTab'

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
  if (!diagnostics) return 'bg-slate-500/10 text-slate-500 border border-slate-500/20'
  return diagnostics.success 
    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
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
    username: item.username ? String(item.username) : undefined,
    api_port: item.api_port ? Number(item.api_port) : 8728,
    sstp_active: Boolean(item.sstp_active),
    sstp_username: item.sstp_username ? String(item.sstp_username) : undefined,
    vpn_ip: item.vpn_ip ? String(item.vpn_ip) : undefined,
    last_seen: item.last_seen ? String(item.last_seen) : undefined,
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
      (bitmap as ImageBitmap).close()
    }
  }
}

const normalizeUiError = (error: unknown, fallback: string): string => {
  const message = String(error instanceof Error ? error.message : '').trim()
  if (!message) return fallback
  const lowered = message.toLowerCase()
  if (lowered.includes('unauthorized')) return 'Sesion expirada. Vuelve a iniciar sesion.'
  if (lowered.includes('failed to fetch') || lowered.includes('networkerror') || lowered.includes('network request failed')) {
    return 'No se pudo conectar al backend. Verifica VPS, dominio, red y que el proxy/API estén activos.'
  }
  if (lowered.includes('abort')) return 'Solicitud interrumpida. Reintenta con sesion activa.'
  if (lowered.includes('qr')) return message
  if (lowered.includes('decode')) return 'No se pudo leer la imagen QR. Usa PNG/JPG nítido o importa ZIP/CONF.'
  return message
}

const readSnmpMetricSpec = (
  source: RouterSnmpProfilePayload['scalar_oids'],
  metricName: string
): { oid: string; scale: string } => {
  const metric = source?.[metricName]
  if (!metric) return { oid: '', scale: '' }
  if (typeof metric === 'string') return { oid: metric, scale: '' }
  return {
    oid: String(metric.oid || ''),
    scale: metric.scale != null ? String(metric.scale) : '',
  }
}

const buildSnmpFormFromProfile = (profile?: RouterSnmpProfilePayload | null): RouterSnmpFormState => {
  const cpu = readSnmpMetricSpec(profile?.scalar_oids, 'cpu_percent')
  const mem = readSnmpMetricSpec(profile?.scalar_oids, 'mem_percent')
  const temperature = readSnmpMetricSpec(profile?.scalar_oids, 'temperature_c')
  const voltage = readSnmpMetricSpec(profile?.scalar_oids, 'voltage_v')
  const signal = readSnmpMetricSpec(profile?.scalar_oids, 'signal_level_dbm')
  const optical = readSnmpMetricSpec(profile?.scalar_oids, 'optical_rx_dbm')
  const onuOnline = readSnmpMetricSpec(profile?.scalar_oids, 'onu_online')
  const onuOffline = readSnmpMetricSpec(profile?.scalar_oids, 'onu_offline')
  const thresholds = profile?.thresholds || {}

  return {
    enabled: Boolean(profile?.enabled),
    host: String(profile?.host || ''),
    port: String(profile?.port ?? 161),
    community: '',
    timeout_seconds: String(profile?.timeout_seconds ?? 2),
    retries: String(profile?.retries ?? 1),
    poll_interfaces: profile?.poll_interfaces !== false,
    interface_names: Array.isArray(profile?.interface_names) ? profile?.interface_names.join(', ') : '',
    trap_enabled: Boolean(profile?.trap_enabled),
    trap_port: String(profile?.trap_port ?? 162),
    cpu_oid: cpu.oid,
    mem_oid: mem.oid,
    temperature_oid: temperature.oid,
    temperature_scale: temperature.scale,
    voltage_oid: voltage.oid,
    voltage_scale: voltage.scale,
    signal_oid: signal.oid,
    signal_scale: signal.scale,
    optical_oid: optical.oid,
    optical_scale: optical.scale,
    onu_online_oid: onuOnline.oid,
    onu_offline_oid: onuOffline.oid,
    threshold_temperature: thresholds.temperature_c != null ? String(thresholds.temperature_c) : '70',
    threshold_voltage_min: thresholds.voltage_v_min != null ? String(thresholds.voltage_v_min) : '21.5',
    threshold_signal_min: thresholds.signal_level_dbm_min != null ? String(thresholds.signal_level_dbm_min) : '-30',
    threshold_optical_min: thresholds.optical_rx_dbm_min != null ? String(thresholds.optical_rx_dbm_min) : '-30',
  }
}

const buildSnmpPayloadFromForm = (form: RouterSnmpFormState): RouterSnmpProfilePayload => {
  const scalar_oids: NonNullable<RouterSnmpProfilePayload['scalar_oids']> = {}

  const appendMetric = (metricName: string, oid: string, scaleText = '') => {
    const normalizedOid = oid.trim()
    if (!normalizedOid) return
    const normalizedScale = scaleText.trim()
    if (!normalizedScale || normalizedScale === '1') {
      scalar_oids[metricName] = normalizedOid
      return
    }
    const parsedScale = Number(normalizedScale)
    scalar_oids[metricName] = Number.isFinite(parsedScale)
      ? { oid: normalizedOid, scale: parsedScale }
      : normalizedOid
  }

  appendMetric('cpu_percent', form.cpu_oid)
  appendMetric('mem_percent', form.mem_oid)
  appendMetric('temperature_c', form.temperature_oid, form.temperature_scale)
  appendMetric('voltage_v', form.voltage_oid, form.voltage_scale)
  appendMetric('signal_level_dbm', form.signal_oid, form.signal_scale)
  appendMetric('optical_rx_dbm', form.optical_oid, form.optical_scale)
  appendMetric('onu_online', form.onu_online_oid)
  appendMetric('onu_offline', form.onu_offline_oid)

  const thresholds: Record<string, number> = {}
  const appendThreshold = (key: string, value: string) => {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) thresholds[key] = parsed
  }
  appendThreshold('temperature_c', form.threshold_temperature)
  appendThreshold('voltage_v_min', form.threshold_voltage_min)
  appendThreshold('signal_level_dbm_min', form.threshold_signal_min)
  appendThreshold('optical_rx_dbm_min', form.threshold_optical_min)

  const payload: RouterSnmpProfilePayload = {
    enabled: form.enabled,
    host: form.host.trim(),
    port: Number(form.port || '161'),
    timeout_seconds: Number(form.timeout_seconds || '2'),
    retries: Number(form.retries || '1'),
    poll_interfaces: form.poll_interfaces,
    interface_names: form.interface_names
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    scalar_oids,
    thresholds,
    trap_enabled: form.trap_enabled,
    trap_port: Number(form.trap_port || '162'),
  }
  if (form.community.trim()) payload.community = form.community
  return payload
}

const formatSnmpMetric = (value: unknown, suffix = ''): string => {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'number') return `${value}${suffix}`
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return `${numeric}${suffix}`
  return String(value)
}

const MikroTikManagement: React.FC = () => {
  const [routers, setRouters] = useState<RouterItem[]>([])
  const [selectedRouter, setSelectedRouter] = useState<RouterItem | null>(null)
  const [routerStats, setRouterStats] = useState<RouterStats | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'queues' | 'connections' | 'config' | 'security' | 'traffic_flow' | 'ai_diagnosis' | 'logs' | 'vpn'>('overview')

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
  const [logs, setLogs] = useState<LogItem[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

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
  const [onboardingProfile, setOnboardingProfile] = useState<RouterOnboardingProfile | null>(null)
  const [onboardingProfileLoading, setOnboardingProfileLoading] = useState(false)
  const [savingOnboardingProfile, setSavingOnboardingProfile] = useState(false)
  const [routerForm, setRouterForm] = useState<RouterFormState>({
    name: '',
    ip_address: '',
    username: 'admin',
    password: '',
    api_port: '8728',
    wan_port: '80',
    lan_interface: 'ether1',
    ip_ranges: '',
    ros_version: '7',
    coordinates: '',
    comments: '',
    use_sstp_script: true,
    historial_trafico: false,
    control_pppoe: false,
    control_queue: false,
    control_ap: false,
    control_dhcp: false,
    control_hotspot: false,
    traffic_flow_enabled: false,
  })
  const [showRouterModal, setShowRouterModal] = useState(false)
  const [routerModalTab, setRouterModalTab] = useState<'general' | 'sstp' | 'traffic'>('general')
  const [editingRouter, setEditingRouter] = useState<RouterItem | null>(null)
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
  const [sstpTunnel, setSstpTunnel] = useState<SstpTunnelData | null>(null)
  const [sstpScript, setSstpScript] = useState('')
  const [sstpProvisioning, setSstpProvisioning] = useState(false)
  const [sstpScriptCopied, setSstpScriptCopied] = useState(false)
  const [sstpLoadingForRouter, setSstpLoadingForRouter] = useState<string | null>(null)
  const [vpnMode, setVpnMode] = useState<'native' | 'hub'>('hub')
  const [hubProvisioning, setHubProvisioning] = useState(false)
  const [hubScript, setHubScript] = useState('')
  const [hubData, setHubData] = useState<any>(null)
  const [routerSnmpProfile, setRouterSnmpProfile] = useState<RouterSnmpProfilePayload | null>(null)
  const [routerSnmpForm, setRouterSnmpForm] = useState<RouterSnmpFormState>(() => buildSnmpFormFromProfile(null))
  const [routerSnmpPollResult, setRouterSnmpPollResult] = useState<RouterSnmpPollResponse | null>(null)
  const [routerSnmpRuntimeAvailable, setRouterSnmpRuntimeAvailable] = useState<boolean | null>(null)
  const [routerSnmpLoading, setRouterSnmpLoading] = useState(false)
  const [routerSnmpSaving, setRouterSnmpSaving] = useState(false)
  const [routerSnmpPolling, setRouterSnmpPolling] = useState(false)
  // Herramientas
  const [herramientasOpen, setHerramientasOpen] = useState(false)
  const [herramientasModal, setHerramientasModal] = useState<'arp' | 'ppp' | null>(null)
  const [herramientasData, setHerramientasData] = useState<Record<string, unknown>[]>([])
  const [herramientasLoading, setHerramientasLoading] = useState(false)
  // Traffic Flow
  const [tfScripts, setTfScripts] = useState<{ros6: string; ros7_lan: string; ros7_wan: string} | null>(null)
  const [tfCollector, setTfCollector] = useState<{ip: string; port: number} | null>(null)
  const [tfStats, setTfStats] = useState<{src_ip: string; mb_total: number; bytes_total: number; packets_total: number; last_seen: string | null}[]>([])
  const [tfLoading, setTfLoading] = useState(false)
  const [tfStatsLoading, setTfStatsLoading] = useState(false)
  const [tfLanGw, setTfLanGw] = useState('')
  const [tfWanGw, setTfWanGw] = useState('')
  const [tfCopied, setTfCopied] = useState<string | null>(null)
  const [tfHours, setTfHours] = useState(24)
  const connectionStatusRef = useRef<Record<string, string>>({})
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
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

  const applyOnboardingProfileDefaults = useCallback((profile?: RouterOnboardingProfile | null) => {
    if (!profile) return
    setOnboardingProfile(profile)
    setRouterForm((prev) => ({
      ...prev,
      username:
        prev.username.trim() && prev.username.trim() !== 'admin'
          ? prev.username
          : String(profile.default_username || prev.username || 'admin'),
      api_port:
        prev.api_port.trim() && prev.api_port.trim() !== '8728'
          ? prev.api_port
          : String(profile.default_api_port || prev.api_port || '8728'),
    }))
    setBthUserName((prev) => (prev.trim() && prev.trim() !== 'noc-vps' ? prev : String(profile.default_bth_user_name || prev || 'noc-vps')))
    setBthAllowLan(Boolean(profile.default_allow_lan))
    setWireGuardBootstrapOnboard(Boolean(profile.auto_bootstrap_bth))
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

  const loadOnboardingProfile = useCallback(async () => {
    setOnboardingProfileLoading(true)
    try {
      const response = await apiFetch('/api/mikrotik/onboarding/profile')
      const payload = (await safeJson(response)) as RouterOnboardingProfileResponse | null
      if (response.ok && payload?.success && payload.profile) {
        applyOnboardingProfileDefaults(payload.profile)
        return
      }
      setOnboardingProfile(null)
    } catch (error) {
      console.error('Error loading onboarding profile:', error)
      addToast('error', normalizeUiError(error, 'No se pudo cargar el perfil de onboarding'))
      setOnboardingProfile(null)
    } finally {
      setOnboardingProfileLoading(false)
    }
  }, [addToast, apiFetch, applyOnboardingProfileDefaults, safeJson])

  const saveOnboardingProfile = useCallback(async () => {
    if (!onboardingProfile) return
    setSavingOnboardingProfile(true)
    try {
      const response = await apiFetch('/api/mikrotik/onboarding/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(onboardingProfile),
      })
      const payload = (await safeJson(response)) as RouterOnboardingProfileResponse | null
      if (response.ok && payload?.success && payload.profile) {
        applyOnboardingProfileDefaults(payload.profile)
        addToast('success', 'Perfil MikroTik guardado para esta cuenta ISP')
      } else {
        addToast('error', payload?.error || 'No se pudo guardar el perfil MikroTik')
      }
    } catch (error) {
      console.error('Error saving onboarding profile:', error)
      addToast('error', 'Error de red guardando perfil MikroTik')
    } finally {
      setSavingOnboardingProfile(false)
    }
  }, [addToast, apiFetch, applyOnboardingProfileDefaults, onboardingProfile, safeJson])

  const loadSstpTunnelForRouter = useCallback(async (routerId: string) => {
    setSstpLoadingForRouter(routerId)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${routerId}/sstp/status`)
      const payload = (await safeJson(response)) as { success?: boolean; tunnel?: SstpTunnelData | null } | null
      if (response.ok && payload?.tunnel) {
        setSstpTunnel(payload.tunnel)
        setSstpScript(payload.tunnel.script || '')
      } else {
        setSstpTunnel(null)
        setSstpScript('')
      }
    } catch {
      setSstpTunnel(null)
      setSstpScript('')
    } finally {
      setSstpLoadingForRouter(null)
    }
  }, [apiFetch, safeJson])

  const provisionSstpForRouter = useCallback(async () => {
    if (!selectedRouter) return
    setSstpProvisioning(true)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/sstp/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = (await safeJson(response)) as SstpTunnelData | null
      if (!response.ok || (payload as { error?: string })?.error) {
        addToast('error', (payload as { error?: string })?.error || `Error ${response.status} al provisionar SSTP`)
        return
      }
      setSstpTunnel(payload)
      setSstpScript(payload?.script || '')
      addToast('success', 'Túnel SSTP listo. Copia el script y pégalo en el MikroTik (New Terminal).')
      setConnectionWizardStep(2)
    } catch (error: unknown) {
      addToast('error', normalizeUiError(error, 'Error al provisionar SSTP'))
    } finally {
      setSstpProvisioning(false)
    }
  }, [addToast, apiFetch, safeJson, selectedRouter])

  const provisionHubForRouter = useCallback(async () => {
    if (!selectedRouter) return
    setHubProvisioning(true)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/vpn-hub/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = (await safeJson(response)) as any
      if (!response.ok || payload?.error || !payload?.success) {
        addToast('error', payload?.error || `Error ${response.status} al provisionar Túnel Hub`)
        return
      }
      setHubData(payload)
      setHubScript(payload?.script || '')
      addToast('success', 'Túnel Hub (Estilo WispHub) listo. Copia el script y pégalo en tu MikroTik.')
    } catch (error: unknown) {
      addToast('error', normalizeUiError(error, 'Error al provisionar Túnel Hub'))
    } finally {
      setHubProvisioning(false)
    }
  }, [addToast, apiFetch, safeJson, selectedRouter])

  const fetchConnectionDiagnostics = useCallback(
    async (routerId: string) => {
      const response = await apiFetch(`/api/mikrotik/routers/${routerId}/test-connection`)
      const payload = (await safeJson(response)) as RouterConnectionActionResponse | null
      return { ok: response.ok, payload }
    },
    [apiFetch, safeJson]
  )

  const loadRouterSnmpProfile = useCallback(
    async (routerId: string) => {
      setRouterSnmpLoading(true)
      try {
        const response = await apiFetch(`/api/mikrotik/routers/${routerId}/snmp-profile`)
        const payload = (await safeJson(response)) as RouterSnmpProfileResponse | null
        if (response.ok && payload?.success && payload.profile) {
          setRouterSnmpProfile(payload.profile)
          setRouterSnmpForm(buildSnmpFormFromProfile(payload.profile))
          setRouterSnmpRuntimeAvailable(payload.runtime_available ?? null)
          return
        }
        setRouterSnmpProfile(null)
        setRouterSnmpForm(buildSnmpFormFromProfile(null))
        setRouterSnmpRuntimeAvailable(payload?.runtime_available ?? null)
      } catch (error) {
        console.error('Error loading SNMP profile:', error)
        setRouterSnmpProfile(null)
        setRouterSnmpForm(buildSnmpFormFromProfile(null))
        setRouterSnmpRuntimeAvailable(null)
      } finally {
        setRouterSnmpLoading(false)
      }
    },
    [apiFetch, safeJson]
  )

  const saveRouterSnmpProfile = useCallback(async () => {
    if (!selectedRouter) return
    setRouterSnmpSaving(true)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/snmp-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSnmpPayloadFromForm(routerSnmpForm)),
      })
      const payload = (await safeJson(response)) as RouterSnmpProfileResponse | null
      if (!response.ok || !payload?.success || !payload.profile) {
        addToast('error', payload?.error || 'No se pudo guardar el perfil SNMP')
        return
      }
      setRouterSnmpProfile(payload.profile)
      setRouterSnmpForm(buildSnmpFormFromProfile(payload.profile))
      setRouterSnmpRuntimeAvailable(payload.runtime_available ?? null)
      addToast('success', 'Perfil SNMP guardado')
    } catch (error) {
      console.error('Error saving SNMP profile:', error)
      addToast('error', normalizeUiError(error, 'Error guardando perfil SNMP'))
    } finally {
      setRouterSnmpSaving(false)
    }
  }, [addToast, apiFetch, routerSnmpForm, safeJson, selectedRouter])

  const runRouterSnmpPoll = useCallback(
    async (persist = false) => {
      if (!selectedRouter) return
      setRouterSnmpPolling(true)
      try {
        const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/snmp/poll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            persist,
            profile: buildSnmpPayloadFromForm(routerSnmpForm),
          }),
        })
        const payload = (await safeJson(response)) as RouterSnmpPollResponse | null
        if (!response.ok || !payload?.success) {
          addToast('error', payload?.error || 'No se pudo consultar SNMP')
          return
        }
        setRouterSnmpPollResult(payload)
        addToast('success', persist ? 'SNMP consultado y persistido' : 'SNMP consultado correctamente')
      } catch (error) {
        console.error('Error polling SNMP profile:', error)
        addToast('error', normalizeUiError(error, 'Error consultando SNMP'))
      } finally {
        setRouterSnmpPolling(false)
      }
    },
    [addToast, apiFetch, routerSnmpForm, safeJson, selectedRouter]
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
      addToast('error', normalizeUiError(error, 'No se pudieron cargar los routers'))
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
        addToast('error', normalizeUiError(error, 'Error de red al cargar estadísticas del router'))
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
          if (payload.onboarding_profile) {
            applyOnboardingProfileDefaults(payload.onboarding_profile)
          }
          setQuickConnect(payload)
        } else {
          setQuickConnect(null)
          addToast('error', 'No se pudo cargar la conexión rápida')
        }
      } catch (error) {
        console.error('Error loading quick connect:', error)
        setQuickConnect(null)
        addToast('error', normalizeUiError(error, 'No se pudo cargar la conexión rápida'))
      } finally {
        setQuickLoading(false)
      }
    },
    [addToast, apiFetch, applyOnboardingProfileDefaults, safeJson]
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
          addToast('error', normalizeUiError(error, 'Error de red ejecutando readiness'))
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
    loadOnboardingProfile()
  }, [loadOnboardingProfile, loadRouters])

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
    setSstpTunnel(null)
    setSstpScript('')
    setSstpScriptCopied(false)
    setRouterSnmpProfile(null)
    setRouterSnmpForm(buildSnmpFormFromProfile(null))
    setRouterSnmpPollResult(null)
    void loadSstpTunnelForRouter(selectedRouter.id)
    void loadRouterSnmpProfile(selectedRouter.id)
  }, [loadEnterpriseChangeLog, loadEnterpriseProfiles, loadQuickConnect, loadRouterReadiness, loadRouterSnmpProfile, loadRouterStats, loadSstpTunnelForRouter, quickConnectScope, selectedRouter])

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

  const loadLogs = async () => {
    if (!selectedRouter) return
    setLogsLoading(true)
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/logs?limit=200`)
      const data = (await safeJson(response)) as { success?: boolean; logs?: any[] } | null
      if (response.ok && data?.success) {
        setLogs(data.logs || [])
      }
    } catch (err) {
      addToast('error', 'Error al cargar logs del router')
    } finally {
      setLogsLoading(false)
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
        if (payload.onboarding_profile) {
          applyOnboardingProfileDefaults(payload.onboarding_profile)
        }
        const suggestions = payload.suggestions || {}
        const suggestedIpOrHost = String(suggestions.router_ip_or_host || '').trim()
        setRouterForm((prev) => ({
          ...prev,
          name: prev.name.trim() ? prev.name : String(suggestions.router_name || prev.name || ''),
          ip_address: prev.ip_address.trim() ? prev.ip_address : (suggestedIpOrHost || String(prev.ip_address || '')),
          username: prev.username.trim() ? prev.username : String(suggestions.default_username || prev.username || ''),
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
    [addToast, apiFetch, appendWireGuardSourceToFormData, applyOnboardingProfileDefaults, bthPrivateKey, bthUserName, routerForm.ip_address, safeJson]
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

        if (payload.onboarding_profile) {
          applyOnboardingProfileDefaults(payload.onboarding_profile)
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
      applyOnboardingProfileDefaults,
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
          wan_port: Number(routerForm.wan_port || '80'),
          lan_interface: routerForm.lan_interface.trim() || 'ether1',
          ip_ranges: routerForm.ip_ranges.trim() || null,
          ros_version: routerForm.ros_version,
          coordinates: routerForm.coordinates.trim() || null,
          comments: routerForm.comments.trim() || null,
          use_sstp_script: routerForm.use_sstp_script,
          historial_trafico: routerForm.historial_trafico,
          control_pppoe: routerForm.control_pppoe,
          control_queue: routerForm.control_queue,
          control_ap: routerForm.control_ap,
          control_dhcp: routerForm.control_dhcp,
          control_hotspot: routerForm.control_hotspot,
          traffic_flow_enabled: routerForm.traffic_flow_enabled,
          is_active: true,
          test_connection: true,
        }),
      })
      const payload = (await safeJson(response)) as RouterCreateResponse | null
      if (!response.ok || !payload?.success || !payload.router) {
        addToast('error', payload?.error || `Error ${response.status} al agregar router`)
        return
      }

      if (payload.onboarding_profile) {
        applyOnboardingProfileDefaults(payload.onboarding_profile)
      }
      const createdRouter = normalizeRouterItem(payload.router)
      if (payload.diagnostics) rememberConnectionDiagnostics(createdRouter.id, payload.diagnostics)
      const connectionMessage = resolveConnectionFeedback(
        payload,
        payload.reachable === false ? 'Router agregado, pero la API aun no responde.' : 'Router agregado correctamente.'
      )
      addToast(payload.reachable === false ? 'error' : 'success', payload.reachable === false ? `Router agregado. ${connectionMessage}` : connectionMessage)
      setRouterForm((prev) => ({ ...prev, name: '', ip_address: '', password: '' }))
      setShowRouterModal(false)
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
            className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-amber-500/50 md:max-w-md"
          />
          <p className="text-xs text-amber-800">
            Se usa para acciones live (reinicio, scripts y hardening).
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

      <div className="rounded-xl border border-gray-200 bg-white backdrop-blur-md p-4 shadow">
        <h3 className="mb-3 text-lg font-semibold text-slate-800">Alta rapida de MikroTik</h3>
        <p className="mb-3 text-sm text-slate-500">
          Agrega routers nuevos con sus credenciales de API. Luego usa la pestana Configuracion para provisionar el servidor SSTP nativo.
        </p>
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Cuenta ISP actual</p>
              <p className="mt-1 text-sm text-emerald-900">
                {onboardingProfile?.account_label || user?.name || user?.email || 'Cuenta actual'}
              </p>
              <p className="text-xs text-emerald-700">
                {onboardingProfile?.tenant_scope?.tenant_name || onboardingProfile?.tenant_scope?.tenant_slug || user?.email || 'Sin tenant explicito'}
                {onboardingProfile?.tenant_scope?.tenant_id !== null && onboardingProfile?.tenant_scope?.tenant_id !== undefined
                  ? ` | tenant #${onboardingProfile?.tenant_scope?.tenant_id}`
                  : ''}
              </p>
              <p className="mt-1 text-xs text-emerald-700">
                Este perfil aplica solo a la cuenta ISP/tenant seleccionada. Cada ISP puede usar sus propios defaults de nombre y API.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => applyOnboardingProfileDefaults(onboardingProfile)}
                disabled={!onboardingProfile}
                className="rounded-lg bg-white backdrop-blur-md px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
              >
                Aplicar defaults
              </button>
              <button
                onClick={() => void saveOnboardingProfile()}
                disabled={savingOnboardingProfile || !onboardingProfile}
                className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                {savingOnboardingProfile ? 'Guardando...' : 'Guardar perfil ISP'}
              </button>
            </div>
          </div>

          {onboardingProfileLoading && <p className="mt-2 text-xs text-emerald-700">Cargando perfil de onboarding...</p>}
          {onboardingProfile && (
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
              <input
                value={onboardingProfile.account_label || ''}
                onChange={(e) => setOnboardingProfile((prev) => ({ ...(prev || {}), account_label: e.target.value }))}
                placeholder="Nombre de cuenta ISP"
                className="rounded border border-emerald-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-emerald-500/50"
              />
              <input
                value={onboardingProfile.router_name_prefix || ''}
                onChange={(e) => setOnboardingProfile((prev) => ({ ...(prev || {}), router_name_prefix: e.target.value }))}
                placeholder="Prefijo de routers"
                className="rounded border border-emerald-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-emerald-500/50"
              />
              <input
                value={onboardingProfile.comment_prefix || ''}
                onChange={(e) => setOnboardingProfile((prev) => ({ ...(prev || {}), comment_prefix: e.target.value }))}
                placeholder="Prefijo de comentarios"
                className="rounded border border-emerald-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-emerald-500/50"
              />
              <input
                value={onboardingProfile.default_username || ''}
                onChange={(e) => setOnboardingProfile((prev) => ({ ...(prev || {}), default_username: e.target.value }))}
                placeholder="Usuario API por defecto"
                className="rounded border border-emerald-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-emerald-500/50"
              />
              <input
                value={String(onboardingProfile.default_api_port || '')}
                onChange={(e) => setOnboardingProfile((prev) => ({ ...(prev || {}), default_api_port: Number(e.target.value || '8728') }))}
                placeholder="Puerto API por defecto"
                className="rounded border border-emerald-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-emerald-500/50"
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setEditingRouter(null)
              setRouterModalTab('general')
              setShowRouterModal(true)
            }}
            className="group flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 hover:scale-105 hover:shadow-emerald-500/50 transition-all duration-300"
          >
            <span className="text-lg font-bold group-hover:rotate-90 transition-transform duration-300">+</span> Añadir Router
          </button>
          <p className="text-xs text-slate-500">Haz click para abrir el Editor Router completo</p>
        </div>
      </div>

      <RouterFormModal
        isOpen={showRouterModal}
        onClose={() => setShowRouterModal(false)}
        editingRouter={editingRouter}
        routerForm={routerForm}
        setRouterForm={setRouterForm}
        routerModalTab={routerModalTab}
        setRouterModalTab={setRouterModalTab}
        onSubmit={createRouter}
        isSaving={creatingRouter}
      />

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm mb-6">
        <h3 className="mb-4 text-sm font-black text-slate-800 uppercase tracking-widest">Lista de Routers</h3>

        <RoutersTable
          routers={routers}
          selectedRouter={selectedRouter}
          setSelectedRouter={setSelectedRouter}
          routerConnectionSnapshots={routerConnectionSnapshots}
        />
      </div>

      {selectedRouter && (
        <>
          <div className="my-4">
            <AIDiagnosis isLoading={isAiLoading} analysis={aiAnalysis} error={aiError} />
          </div>

          {/* ── Herramientas toolbar ── */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-100 bg-white px-6 py-4 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-coral-50 flex items-center justify-center text-coral-500">
                 <ServerIcon className="h-6 w-6" />
              </div>
              <div>
                <span className="block text-sm font-black text-slate-800">{selectedRouter.name}</span>
                <span className="font-mono text-[10px] font-bold text-slate-500 uppercase tracking-wider">{selectedRouter.ip_address}</span>
              </div>
              {selectedRouter.sstp_active ? (
                <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black text-blue-600 border border-blue-100">TUNNEL ACTIVO</span>
              ) : (
                <span className="rounded-full bg-gray-50 px-3 py-1 text-[10px] font-black text-slate-500 border border-gray-100">MODO DIRECTO</span>
              )}
            </div>
            <div className="relative flex items-center gap-2">
              {/* Reboot */}
              <button
                onClick={() => openConfirm(`¿Reiniciar el router ${selectedRouter.name}?`, async () => {
                  try {
                    const res = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/reboot`, { method: 'POST' })
                    const d = await res.json().catch(() => ({}))
                    if (res.ok) addToast('success', 'Router reiniciado')
                    else addToast('error', (d as {error?: string}).error || 'Error al reiniciar')
                  } catch { addToast('error', 'Error de red') }
                })}
                className="rounded bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-400 hover:bg-rose-500/30 border border-rose-500/30"
              >
                🔄 Reiniciar
              </button>
              {/* Herramientas dropdown */}
              <div className="relative">
                <button
                  onClick={() => setHerramientasOpen((p) => !p)}
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  🔧 Herramientas ▾
                </button>
                {herramientasOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white backdrop-blur-md py-1 shadow-xl">
                    {[
                      { label: '📍 Lista ARP', action: async () => {
                        setHerramientasLoading(true); setHerramientasOpen(false); setHerramientasModal('arp')
                        try {
                          const r = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/arp`)
                          const d = await r.json().catch(() => ({}))
                          setHerramientasData((d as {arp?: Record<string, unknown>[]}).arp || [])
                        } catch { addToast('error', 'Error cargando ARP') }
                        setHerramientasLoading(false)
                      }},
                      { label: '📶 PPP Active Connections', action: async () => {
                        setHerramientasLoading(true); setHerramientasOpen(false); setHerramientasModal('ppp')
                        try {
                          const r = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/ppp/active`)
                          const d = await r.json().catch(() => ({}))
                          setHerramientasData((d as {sessions?: Record<string, unknown>[]}).sessions || [])
                        } catch { addToast('error', 'Error cargando PPP') }
                        setHerramientasLoading(false)
                      }},
                      { label: '📄 Logs del Router', action: () => { setSidePanel('logs'); setHerramientasOpen(false) }},
                      { label: '💻 Clientes DHCP', action: () => { setSidePanel('dhcp'); setHerramientasOpen(false) }},
                      { label: '📡 Clientes WiFi', action: () => { setSidePanel('wifi'); setHerramientasOpen(false) }},
                    ].map((item) => (
                      <button
                        key={item.label}
                        onClick={() => void item.action()}
                        className="block w-full px-4 py-2 text-left text-xs text-slate-600 hover:bg-white"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Herramientas result modal */}
          {herramientasModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setHerramientasModal(null)}>
              <div className="w-full max-w-3xl rounded-xl bg-white backdrop-blur-md p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-bold text-slate-800">
                    {herramientasModal === 'arp' ? '📍 Lista ARP' : '📶 PPP Active Connections'} — {selectedRouter.name}
                  </h3>
                  <button onClick={() => setHerramientasModal(null)} className="text-slate-500 hover:text-slate-500 text-lg">✕</button>
                </div>
                {herramientasLoading ? (
                  <div className="py-8 text-center text-sm text-slate-500">Cargando...</div>
                ) : herramientasData.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">Sin datos disponibles.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b bg-white text-[10px] font-semibold uppercase text-slate-500">
                          {Object.keys(herramientasData[0]).map((k) => (
                            <th key={k} className="px-3 py-1.5 text-left">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {herramientasData.map((row, i) => (
                          <tr key={i} className="border-b hover:bg-white">
                            {Object.values(row).map((v, j) => (
                              <td key={j} className="px-3 py-1.5 font-mono text-slate-600">{String(v ?? '-')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-2 text-right text-[11px] text-slate-500">{herramientasData.length} registros</p>
              </div>
            </div>
          )}

          <div className="mb-8 overflow-x-auto pb-2">
            <nav className="flex space-x-2">
              {([
                { id: 'overview', name: 'Resumen', icon: ChartBarIcon },
                { id: 'queues', name: 'Colas', icon: UserGroupIcon },
                { id: 'connections', name: 'Conexiones', icon: WifiIcon },
                { id: 'config', name: 'Configuracion', icon: CogIcon },
                { id: 'vpn', name: 'VPN', icon: ShieldCheckIcon },
                { id: 'security', name: 'Seguridad', icon: ShieldCheckIcon },
                { id: 'traffic_flow', name: 'Traffic Flow', icon: ChartBarIcon },
                { id: 'ai_diagnosis', name: 'IA Diagnosis', icon: SparklesIcon },
                { id: 'logs', name: 'Logs', icon: DocumentTextIcon },
              ] as const).map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id)
                      if (tab.id === 'logs') void loadLogs()
                      if (tab.id === 'ai_diagnosis' && !aiAnalysis) void runAiDiagnosis()
                    }}
                    className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-bold transition-all duration-300 ${
                      isActive 
                        ? 'bg-coral-500 text-white shadow-lg shadow-coral-500/30 scale-105 z-10' 
                        : 'bg-white text-slate-500 border border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <tab.icon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                    <span>{tab.name}</span>
                  </button>
                )
              })}
            </nav>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
            {isLoading ? (
              <div className="py-12 text-center">
                <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
                <p className="mt-4 text-slate-600">Cargando informacion del router...</p>
              </div>
            ) : (
              <>
                {activeTab === 'overview' && selectedRouter && (
                  <OverviewTab
                    selectedRouter={selectedRouter}
                    routerConnectionSnapshots={routerConnectionSnapshots}
                    diagnostics={activeConnectionDiagnostics}
                    testConnection={testConnection}
                    backupRouter={backupRouter}
                    runAiDiagnosis={runAiDiagnosis}
                    isAiLoading={isAiLoading}
                    rebootRouter={rebootRouter}
                    actionLoading={actionLoading}
                    openConfirm={openConfirm}
                  />
                )}
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
                {activeTab === 'ai_diagnosis' && (
                  <AIDiagnosis analysis={aiAnalysis} isLoading={isAiLoading} error={aiError} onRetry={runAiDiagnosis} />
                )}
                {activeTab === 'logs' && (
                  <LogsTab
                    logs={logs}
                    logsLoading={logsLoading}
                    loadLogs={loadLogs}
                  />
                )}
                {activeTab === 'config' && (
                  <ConfigTab
                    selectedRouter={selectedRouter}
                    quickConnect={quickConnect}
                    onboardingProfile={onboardingProfile}
                    tenantContextId={tenantContextId}
                    quickConnectScope={quickConnectScope}
                    setQuickConnectScope={setQuickConnectScope}
                    loadQuickConnect={loadQuickConnect}
                    quickLoading={quickLoading}
                    activeConnectionSnapshot={activeConnectionSnapshot}
                    activeConnectionDiagnostics={activeConnectionDiagnostics}
                    CONNECTION_POLL_INTERVAL_MS={CONNECTION_POLL_INTERVAL_MS}
                    routerReadiness={routerReadiness}
                    readinessLoading={readinessLoading}
                    loadRouterReadiness={loadRouterReadiness}
                    routerSnmpProfile={routerSnmpProfile}
                    routerSnmpLoading={routerSnmpLoading}
                    routerSnmpForm={routerSnmpForm}
                    setRouterSnmpForm={setRouterSnmpForm}
                    routerSnmpRuntimeAvailable={routerSnmpRuntimeAvailable}
                    saveRouterSnmpProfile={saveRouterSnmpProfile}
                    routerSnmpSaving={routerSnmpSaving}
                    runRouterSnmpPoll={runRouterSnmpPoll}
                    routerSnmpPolling={routerSnmpPolling}
                    routerSnmpPollResult={routerSnmpPollResult}
                    vpnMode={vpnMode}
                    setVpnMode={setVpnMode}
                    hubScript={hubScript}
                    hubData={hubData}
                    hubProvisioning={hubProvisioning}
                    provisionHubForRouter={provisionHubForRouter}
                    runWizardValidation={runWizardValidation}
                    sstpTunnel={sstpTunnel}
                    sstpProvisioning={sstpProvisioning}
                    provisionSstpForRouter={provisionSstpForRouter}
                    sstpScript={sstpScript}
                    sstpLoadingForRouter={sstpLoadingForRouter}
                    expressSteps={expressSteps}
                    showAdvancedScripts={showAdvancedScripts}
                    setShowAdvancedScripts={setShowAdvancedScripts}
                    copyScript={copyScript}
                    copyToClipboard={copyToClipboard}
                    resolveQuickScript={resolveQuickScript}
                    addToast={addToast}
                  />
                )}
                {activeTab === 'vpn' && selectedRouter && (
                  <VpnTab
                    selectedRouter={selectedRouter}
                    quickConnect={quickConnect}
                    bthActionLoading={bthActionLoading}
                    bthUserName={bthUserName}
                    setBthUserName={setBthUserName}
                    bthAllowLan={bthAllowLan}
                    setBthAllowLan={setBthAllowLan}
                    bootstrapResult={bootstrapResult}
                    confirmEnableBackToHome={confirmEnableBackToHome}
                    confirmCreateBackToHomeUser={confirmCreateBackToHomeUser}
                    confirmBootstrapBackToHome={confirmBootstrapBackToHome}
                    confirmRemoveBackToHomeUser={confirmRemoveBackToHomeUser}
                  />
                )}
                {activeTab === 'security' && (
                  <SecurityTab
                    selectedRouter={selectedRouter}
                    quickConnect={quickConnect}
                    enterpriseProfiles={enterpriseProfiles}
                    hardeningProfile={hardeningProfile}
                    setHardeningProfile={setHardeningProfile}
                    hardeningSiteProfile={hardeningSiteProfile}
                    setHardeningSiteProfile={setHardeningSiteProfile}
                    hardeningDryRun={hardeningDryRun}
                    setHardeningDryRun={setHardeningDryRun}
                    hardeningAutoRollback={hardeningAutoRollback}
                    setHardeningAutoRollback={setHardeningAutoRollback}
                    applyEnterpriseHardening={applyEnterpriseHardening}
                    securityBusy={securityBusy}
                    loadEnterpriseProfiles={loadEnterpriseProfiles}
                    hardeningResult={hardeningResult}
                    failoverTargets={failoverTargets}
                    setFailoverTargets={setFailoverTargets}
                    failoverCount={failoverCount}
                    setFailoverCount={setFailoverCount}
                    runEnterpriseFailoverTest={runEnterpriseFailoverTest}
                    failoverResult={failoverResult}
                    loadEnterpriseChangeLog={loadEnterpriseChangeLog}
                    enterpriseChangeLog={enterpriseChangeLog}
                    openConfirm={openConfirm}
                    rollbackEnterpriseChange={rollbackEnterpriseChange}
                  />
                )}

                {activeTab === 'traffic_flow' && (
                  <TrafficFlowTab
                    selectedRouter={selectedRouter}
                    apiFetch={apiFetch}
                    addToast={addToast}
                    tfCollector={tfCollector}
                    setTfCollector={setTfCollector}
                    tfLanGw={tfLanGw}
                    setTfLanGw={setTfLanGw}
                    tfWanGw={tfWanGw}
                    setTfWanGw={setTfWanGw}
                    tfScripts={tfScripts}
                    setTfScripts={setTfScripts}
                    tfLoading={tfLoading}
                    setTfLoading={setTfLoading}
                    tfCopied={tfCopied}
                    setTfCopied={setTfCopied}
                    tfHours={tfHours}
                    setTfHours={setTfHours}
                    tfStats={tfStats}
                    setTfStats={setTfStats}
                    tfStatsLoading={tfStatsLoading}
                    setTfStatsLoading={setTfStatsLoading}
                    copyToClipboard={copyToClipboard}
                  />
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
          <div key={t.id} className={`rounded px-4 py-2 text-white shadow ${t.type === 'success' ? 'bg-green-600' : t.type === 'error' ? 'bg-red-600' : 'bg-gray-100'}`}>
            {t.message}
          </div>
        ))}
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-gray-100 backdrop-blur-sm" onClick={() => setConfirmOpen(false)}></div>
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl border border-gray-100">
              <h4 className="mb-2 text-xl font-black text-slate-800">Confirmar acción</h4>
              <p className="mb-6 text-slate-500 leading-relaxed">{confirmMessage}</p>
              <div className="flex justify-end gap-3">
                <button className="rounded-xl bg-gray-50 px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-gray-100 transition-colors" onClick={() => setConfirmOpen(false)}>
                  Cancelar
                </button>
                <button
                  className="rounded-xl bg-coral-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-coral-600 shadow-lg shadow-coral-500/20 transition-all"
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
