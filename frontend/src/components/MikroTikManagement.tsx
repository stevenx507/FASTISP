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
  onboarding_profile?: RouterOnboardingProfile | null
  tenant_scope?: TenantScopePayload | null
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

interface RouterSnmpProfilePayload {
  enabled?: boolean
  label?: string
  host?: string
  port?: number
  version?: string
  community?: string
  community_configured?: boolean
  community_preview?: string
  timeout_seconds?: number
  retries?: number
  poll_interfaces?: boolean
  interface_names?: string[]
  scalar_oids?: Record<string, string | { oid?: string; scale?: number }>
  thresholds?: Record<string, number>
  trap_enabled?: boolean
  trap_port?: number
  configured?: boolean
}

interface RouterSnmpProfileResponse {
  success?: boolean
  error?: string
  profile?: RouterSnmpProfilePayload | null
  runtime_available?: boolean
}

interface RouterSnmpPollInterface {
  index?: number | null
  name?: string
  alias?: string | null
  rx_bytes?: number
  tx_bytes?: number
  oper_status?: number
}

interface RouterSnmpPollResponse {
  success?: boolean
  error?: string
  persisted?: boolean
  polled_at?: string
  runtime_available?: boolean
  health_metrics?: Record<string, unknown>
  interfaces?: RouterSnmpPollInterface[]
}

interface SstpTunnelData {
  id: number
  router_id: number
  username: string
  password?: string
  server_host: string
  server_port: number
  server_ip: string
  client_ip: string
  status: string
  script?: string
  verification_script?: string
  created_at?: string
  router_name?: string
  error?: string
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
  onboarding_profile?: RouterOnboardingProfile | null
  tenant_scope?: TenantScopePayload | null
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
  default_username?: string
  bth_private_key?: string
  bth_user_name?: string
  router_tunnel_ip?: string | null
  router_management_ip_required?: boolean
  account_label?: string
}

interface WireGuardImportResponse {
  success?: boolean
  error?: string
  source_file?: string
  wireguard?: WireGuardImportData
  suggestions?: WireGuardImportSuggestions
  onboarding_profile?: RouterOnboardingProfile | null
  tenant_scope?: TenantScopePayload | null
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
  onboarding_profile?: RouterOnboardingProfile | null
  tenant_scope?: TenantScopePayload | null
}

interface TenantScopePayload {
  tenant_id?: number | null
  tenant_slug?: string | null
  tenant_name?: string | null
  actor_email?: string | null
  actor_name?: string | null
}

interface RouterOnboardingProfile {
  account_label?: string
  account_slug?: string
  router_name_prefix?: string
  default_username?: string
  default_api_port?: number
  default_bth_user_name?: string
  default_allow_lan?: boolean
  auto_vps_link?: boolean
  auto_bootstrap_bth?: boolean
  comment_prefix?: string
  tenant_scope?: TenantScopePayload | null
}

interface RouterOnboardingProfileResponse {
  success?: boolean
  error?: string
  profile?: RouterOnboardingProfile | null
  tenant_scope?: TenantScopePayload | null
}

interface RouterFormState {
  name: string
  ip_address: string
  username: string
  password: string
  api_port: string
  // Campos extendidos
  wan_port: string
  lan_interface: string
  ip_ranges: string
  ros_version: '6' | '7'
  coordinates: string
  comments: string
  use_sstp_script: boolean
  historial_trafico: boolean
  control_pppoe: boolean
  control_queue: boolean
  control_ap: boolean
  control_dhcp: boolean
  control_hotspot: boolean
  traffic_flow_enabled: boolean
}

interface RouterSnmpFormState {
  enabled: boolean
  host: string
  port: string
  community: string
  timeout_seconds: string
  retries: string
  poll_interfaces: boolean
  interface_names: string
  trap_enabled: boolean
  trap_port: string
  cpu_oid: string
  mem_oid: string
  temperature_oid: string
  temperature_scale: string
  voltage_oid: string
  voltage_scale: string
  signal_oid: string
  signal_scale: string
  optical_oid: string
  optical_scale: string
  onu_online_oid: string
  onu_offline_oid: string
  threshold_temperature: string
  threshold_voltage_min: string
  threshold_signal_min: string
  threshold_optical_min: string
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
  if (!diagnostics) return 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
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
  const [activeTab, setActiveTab] = useState<'overview' | 'queues' | 'connections' | 'config' | 'security' | 'traffic_flow' | 'ai_diagnosis' | 'logs'>('overview')

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
  const [logs, setLogs] = useState<any[]>([])
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

      <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-4 shadow">
        <h3 className="mb-3 text-lg font-semibold text-white">Alta rapida de MikroTik</h3>
        <p className="mb-3 text-sm text-slate-400">
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
                className="rounded-lg bg-white/5 backdrop-blur-md px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
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

      {/* ── Editor Router Modal (Premium Redesign) ── */}
      {showRouterModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 backdrop-blur-sm py-10 px-4 sm:px-6">
          <div 
            className="w-full max-w-3xl rounded-3xl bg-white/5 backdrop-blur-md shadow-2xl ring-1 ring-white/10 overflow-hidden transform transition-all" 
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Moderno con Gradiente */}
            <div className="flex items-center justify-between bg-gradient-to-r from-emerald-600 to-teal-600 px-8 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                  <ServerIcon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight">
                    {editingRouter ? `Editar Router — ${editingRouter.name}` : 'Añadir Nuevo Router'}
                  </h3>
                  <p className="text-emerald-100 text-xs font-medium opacity-80">
                    Integra tu equipo a ISPMAX para gestión centralizada
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowRouterModal(false)} 
                className="rounded-full p-2 text-emerald-100 hover:bg-white/10 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Pestañas (Tabs) Estilizadas */}
            <div className="flex border-b border-white/5 bg-slate-50/50 px-6 pt-2">
              {[
                { id: 'general', label: '1. Parámetros Básicos' },
                { id: 'sstp',    label: '2. Equipos NAT / VPN' },
                { id: 'traffic', label: '3. Integración NetFlow' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setRouterModalTab(t.id as typeof routerModalTab)}
                  className={`px-5 py-3 text-sm font-semibold border-b-2 transition-all ${
                    routerModalTab === t.id
                      ? 'border-teal-500 text-teal-700 bg-white/5 backdrop-blur-md shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)] rounded-t-xl'
                      : 'border-transparent text-slate-400 hover:text-slate-300 hover:bg-white/10/50 rounded-t-xl'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="p-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
              {/* ─── Tab: Parámetros Básicos ─── */}
              {routerModalTab === 'general' && (
                <div className="space-y-8">
                  {/* Sección: Identificación y Acceso */}
                  <div className="space-y-4">
                    <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-teal-700">
                      <span className="h-px flex-1 bg-teal-100"></span>
                      Identidad y Acceso
                      <span className="h-px flex-1 bg-teal-100"></span>
                    </h4>
                    
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1.5">Nombre del Router *</label>
                        <input
                          value={routerForm.name}
                          onChange={(e) => setRouterForm((p) => ({ ...p, name: e.target.value }))}
                          placeholder="Ej. Torre Principal"
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white focus:border-teal-500 focus:bg-white/5 backdrop-blur-md focus:ring-2 focus:ring-teal-200 transition-all outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1.5">IP Pública (WAN) *</label>
                        <input
                          value={routerForm.ip_address}
                          onChange={(e) => setRouterForm((p) => ({ ...p, ip_address: e.target.value }))}
                          placeholder="Si tienes NAT, déjalo vacío"
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-mono text-white focus:border-teal-500 focus:bg-white/5 backdrop-blur-md focus:ring-2 focus:ring-teal-200 transition-all outline-none placeholder:font-sans placeholder:text-slate-500"
                        />
                        <p className="mt-1.5 text-[10px] text-slate-400 font-medium">
                          ¿No tienes IP Pública? Usa la pestaña <strong className="text-teal-600">Equipos NAT / VPN</strong> para conectar.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1.5">Usuario API *</label>
                        <input
                          value={routerForm.username}
                          onChange={(e) => setRouterForm((p) => ({ ...p, username: e.target.value }))}
                          placeholder="admin"
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white focus:border-teal-500 focus:bg-white/5 backdrop-blur-md focus:ring-2 focus:ring-teal-200 transition-all outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1.5">Contraseña API *</label>
                        <input
                          type="password"
                          value={routerForm.password}
                          onChange={(e) => setRouterForm((p) => ({ ...p, password: e.target.value }))}
                          placeholder="••••••••"
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white focus:border-teal-500 focus:bg-white/5 backdrop-blur-md focus:ring-2 focus:ring-teal-200 transition-all outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Sección: Puertos y Red */}
                  <div className="space-y-4">
                    <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-teal-700">
                      <span className="h-px flex-1 bg-teal-100"></span>
                      Configuración de Red
                      <span className="h-px flex-1 bg-teal-100"></span>
                    </h4>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1.5">Puerto API</label>
                        <input
                          value={routerForm.api_port}
                          onChange={(e) => setRouterForm((p) => ({ ...p, api_port: e.target.value }))}
                          placeholder="8728"
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono text-white focus:border-teal-500 focus:bg-white/5 backdrop-blur-md transition-all outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1.5">Versión ROS</label>
                        <select
                          value={routerForm.ros_version}
                          onChange={(e) => setRouterForm((p) => ({ ...p, ros_version: e.target.value as '6' | '7' }))}
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-teal-500 focus:bg-white/5 backdrop-blur-md transition-all outline-none appearance-none"
                        >
                          <option value="7">v7 o superior</option>
                          <option value="6">v6 o inferior</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1.5">Interfaz LAN</label>
                        <input
                          value={routerForm.lan_interface}
                          onChange={(e) => setRouterForm((p) => ({ ...p, lan_interface: e.target.value }))}
                          placeholder="ether1"
                          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono text-white focus:border-teal-500 focus:bg-white/5 backdrop-blur-md transition-all outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Feature toggles modernizados */}
                  <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-teal-50/50 p-5">
                    <p className="mb-4 text-xs font-bold text-emerald-800 uppercase tracking-wide">Módulos Activos en ISPMAX</p>
                    <div className="grid grid-cols-2 gap-y-4 gap-x-6 sm:grid-cols-3">
                      {[
                        { key: 'use_sstp_script',     label: 'Túnel SSTP/VPN' },
                        { key: 'control_pppoe',        label: 'Gestión PPPoE' },
                        { key: 'control_queue',        label: 'Simple Queues' },
                        { key: 'control_dhcp',         label: 'DHCP Leases' },
                        { key: 'control_hotspot',      label: 'Portal HotSpot' },
                        { key: 'traffic_flow_enabled', label: 'Monitor NetFlow' },
                      ].map(({ key, label }) => {
                        const val = routerForm[key as keyof RouterFormState] as boolean
                        return (
                          <label key={key} className="flex cursor-pointer items-center gap-3 group">
                            <div className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-all duration-300 ease-in-out ${
                                val ? 'bg-teal-500 shadow-inner' : 'bg-slate-300'
                              }`}
                              onClick={() => setRouterForm((p) => ({ ...p, [key]: !val }))}
                            >
                              <span className={`inline-block h-5 w-5 transform rounded-full bg-white/5 backdrop-blur-md shadow-md transition-transform duration-300 ease-in-out ${
                                val ? 'translate-x-5' : 'translate-x-0'
                              }`} />
                            </div>
                            <span className={`text-sm font-semibold transition-colors duration-200 ${ val ? 'text-teal-800' : 'text-slate-500 group-hover:text-slate-700'}`}>{label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ─── Tab: Script de Conexión (Rediseñado) ─── */}
              {routerModalTab === 'sstp' && (
                <div className="space-y-6">
                  <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-r from-blue-50 to-indigo-50 p-5 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0 rounded-full bg-blue-500/20 p-1">
                        <ShieldCheckIcon className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-blue-200">Solución para CGNAT e IPs Privadas</h4>
                        <p className="mt-1 text-xs text-blue-300/80 leading-relaxed">
                          Si tu MikroTik no es accesible directamente desde internet, ISPMAX puede crear un túnel reverso. 
                          Guarda el router y luego ve a la pestaña <strong>Script de Conexión</strong> del router seleccionado para obtener el comando que debes pegar en el New Terminal de tu equipo.
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="rounded-2xl border border-white/5 bg-white/5 backdrop-blur-md p-5 shadow-sm ring-1 ring-white/10">
                    <label className="flex cursor-pointer items-center gap-4 group">
                      <div className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-all duration-300 ease-in-out ${
                          routerForm.use_sstp_script ? 'bg-teal-500 shadow-inner' : 'bg-slate-300'
                        }`}
                        onClick={() => setRouterForm((p) => ({ ...p, use_sstp_script: !p.use_sstp_script }))}
                      >
                        <span className={`inline-block h-6 w-6 transform rounded-full bg-white/5 backdrop-blur-md shadow-md transition-transform duration-300 ease-in-out ${
                          routerForm.use_sstp_script ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </div>
                      <div>
                        <span className="text-base font-bold text-slate-800">Habilitar Auto-Aprovisionamiento de VPN</span>
                        <p className="text-xs text-slate-500 mt-0.5">ISPMAX preparará la IP de túnel y credenciales automáticamente.</p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* ─── Tab: Script de Traffic Flow ─── */}
              {routerModalTab === 'traffic' && (
                <div className="space-y-6">
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0 rounded-full bg-amber-500/20 p-1 border border-amber-500/30">
                        <ChartBarIcon className="h-5 w-5 text-amber-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-amber-400">Monitor de Tráfico Avanzado</h4>
                        <p className="mt-1 text-xs text-amber-200/70 leading-relaxed">
                          Analiza el tráfico detallado de tus clientes. Guarda el router primero y luego obtén los scripts NetFlow en el panel de gestión del router.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/5 bg-white/5 backdrop-blur-md p-5 shadow-sm ring-1 ring-white/10">
                    <label className="flex cursor-pointer items-center gap-4 group">
                      <div className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-all duration-300 ease-in-out ${
                          routerForm.traffic_flow_enabled ? 'bg-teal-500 shadow-inner' : 'bg-slate-300'
                        }`}
                        onClick={() => setRouterForm((p) => ({ ...p, traffic_flow_enabled: !p.traffic_flow_enabled }))}
                      >
                        <span className={`inline-block h-6 w-6 transform rounded-full bg-white/5 backdrop-blur-md shadow-md transition-transform duration-300 ease-in-out ${
                          routerForm.traffic_flow_enabled ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </div>
                      <div>
                        <span className="text-base font-bold text-slate-800">Recopilar Estadísticas NetFlow</span>
                        <p className="text-xs text-slate-500 mt-0.5">Compatible con RouterOS {routerForm.ros_version === '6' ? 'v6' : 'v7'} de forma nativa.</p>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Moderno */}
            <div className="flex items-center justify-between rounded-b-3xl border-t border-white/5 bg-slate-50 px-8 py-5">
              <button
                onClick={() => setShowRouterModal(false)}
                className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md px-5 py-2.5 text-sm font-bold text-slate-400 shadow-sm hover:bg-white/5 hover:text-white transition-all"
              >
                Cancelar
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (routerModalTab === 'general') setRouterModalTab('sstp')
                    else if (routerModalTab === 'sstp') setRouterModalTab('traffic')
                  }}
                  disabled={routerModalTab === 'traffic'}
                  className="rounded-xl px-5 py-2.5 text-sm font-bold text-teal-600 hover:bg-teal-50 disabled:opacity-40 transition-colors"
                >
                  Siguiente Paso ➔
                </button>
                <button
                  onClick={() => void createRouter()}
                  disabled={creatingRouter}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/30 hover:scale-105 hover:shadow-emerald-500/50 disabled:opacity-60 disabled:hover:scale-100 transition-all duration-300"
                >
                  {creatingRouter ? (
                    <span className="flex items-center gap-2">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Conectando...
                    </span>
                  ) : (
                    '✔ Guardar Router'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm mb-6">
        <h3 className="mb-4 text-sm font-black text-slate-800 uppercase tracking-widest">Lista de Routers</h3>

        {/* Tabla de routers */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-left">IP de Gestión</th>
                <th className="px-4 py-3 text-left">Usuario</th>
                <th className="px-4 py-3 text-center">API</th>
                <th className="px-4 py-3 text-center">Puerto</th>
                <th className="px-4 py-3 text-center">SSTP</th>
                <th className="px-4 py-3 text-center">VPN IP</th>
                <th className="px-4 py-3 text-right">Gestión</th>
              </tr>
            </thead>
            <tbody>
              {routers.map((router) => {
                const snapshot = routerConnectionSnapshots[router.id]
                const diagnostics = snapshot?.diagnostics || null
                const isSelected = selectedRouter?.id === router.id
                const apiOk = diagnostics?.success === true
                return (
                  <tr
                    key={router.id}
                    onClick={() => setSelectedRouter(router)}
                    className={`cursor-pointer border-b border-gray-50 transition-all ${
                      isSelected ? 'bg-coral-50/50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${apiOk ? 'bg-emerald-50 text-emerald-600' : 'bg-coral-50 text-coral-600'}`}>
                          <ServerIcon className="h-5 w-5" />
                        </div>
                        <span className="font-bold text-slate-700">{router.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-slate-700 text-xs">{router.ip_address}</td>
                    <td className="px-4 py-4 text-slate-700 text-xs font-bold">{router.username || '-'}</td>
                    <td className="px-4 py-4 text-center">
                      <div className={`mx-auto h-2 w-2 rounded-full ${apiOk ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-coral-500 shadow-[0_0_8px_rgba(255,105,97,0.5)]'}`} />
                    </td>
                    <td className="px-4 py-4 text-center text-xs font-bold text-slate-700">{router.api_port || 8728}</td>
                    <td className="px-4 py-4 text-center">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-tighter ${
                        router.sstp_active 
                          ? 'bg-blue-50 text-blue-600 border border-blue-100' 
                          : 'bg-gray-100 text-slate-400'
                      }`}>
                        {router.sstp_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center font-mono text-[10px] font-bold text-slate-700">
                      {router.vpn_ip || '-'}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedRouter(router) }}
                        className="rounded-xl bg-slate-800 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-slate-700 transition-all shadow-sm"
                      >
                        Gestionar
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!routers.length && <p className="mt-6 text-sm text-slate-400 text-center font-bold">No hay routers registrados todavía.</p>}
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
                <span className="font-mono text-[10px] font-bold text-slate-400 uppercase tracking-wider">{selectedRouter.ip_address}</span>
              </div>
              {selectedRouter.sstp_active ? (
                <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black text-blue-600 border border-blue-100">TUNNEL ACTIVO</span>
              ) : (
                <span className="rounded-full bg-gray-50 px-3 py-1 text-[10px] font-black text-slate-400 border border-gray-100">MODO DIRECTO</span>
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
                  <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-white/10 bg-white/5 backdrop-blur-md py-1 shadow-xl">
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
                        className="block w-full px-4 py-2 text-left text-xs text-slate-300 hover:bg-white/5"
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
              <div className="w-full max-w-3xl rounded-xl bg-white/5 backdrop-blur-md p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-bold text-white">
                    {herramientasModal === 'arp' ? '📍 Lista ARP' : '📶 PPP Active Connections'} — {selectedRouter.name}
                  </h3>
                  <button onClick={() => setHerramientasModal(null)} className="text-slate-500 hover:text-slate-400 text-lg">✕</button>
                </div>
                {herramientasLoading ? (
                  <div className="py-8 text-center text-sm text-slate-400">Cargando...</div>
                ) : herramientasData.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-400">Sin datos disponibles.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b bg-white/5 text-[10px] font-semibold uppercase text-slate-400">
                          {Object.keys(herramientasData[0]).map((k) => (
                            <th key={k} className="px-3 py-1.5 text-left">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {herramientasData.map((row, i) => (
                          <tr key={i} className="border-b hover:bg-white/5">
                            {Object.values(row).map((v, j) => (
                              <td key={j} className="px-3 py-1.5 font-mono text-slate-300">{String(v ?? '-')}</td>
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
              {[
                { id: 'overview', name: 'Resumen', icon: ChartBarIcon },
                { id: 'queues', name: 'Colas', icon: UserGroupIcon },
                { id: 'connections', name: 'Conexiones', icon: WifiIcon },
                { id: 'config', name: 'Configuracion', icon: CogIcon },
                { id: 'security', name: 'Seguridad', icon: ShieldCheckIcon },
                { id: 'traffic_flow', name: 'Traffic Flow', icon: ChartBarIcon },
                { id: 'ai_diagnosis', name: 'IA Diagnosis', icon: SparklesIcon },
                { id: 'logs', name: 'Logs', icon: DocumentTextIcon },
              ].map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id as any)
                      if (tab.id === 'logs') void loadLogs()
                      if (tab.id === 'ai_diagnosis' && !aiAnalysis) void runAiDiagnosis()
                    }}
                    className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-bold transition-all duration-300 ${
                      isActive 
                        ? 'bg-coral-500 text-white shadow-lg shadow-coral-500/30 scale-105 z-10' 
                        : 'bg-white text-slate-500 border border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <tab.icon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
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
                {activeTab === 'ai_diagnosis' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-medium text-slate-700">Diagnóstico Inteligente (AI)</h4>
                      <button 
                        onClick={runAiDiagnosis} 
                        disabled={isAiLoading}
                        className="text-xs bg-blue-600/20 text-blue-400 px-3 py-1 rounded-full border border-blue-500/30 hover:bg-blue-600/30"
                      >
                        {isAiLoading ? 'Analizando...' : 'Refrescar Análisis'}
                      </button>
                    </div>
                    <AIDiagnosis analysis={aiAnalysis} error={aiError} isLoading={isAiLoading} />
                  </div>
                )}
                {activeTab === 'logs' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-medium text-slate-700">Logs del Router (RouterOS)</h4>
                      <button 
                        onClick={loadLogs} 
                        disabled={logsLoading}
                        className="text-xs bg-slate-100 text-slate-600 px-3 py-1 rounded-full border border-slate-200 hover:bg-slate-200"
                      >
                        {logsLoading ? 'Cargando...' : 'Actualizar Logs'}
                      </button>
                    </div>
                    <div className="max-h-[500px] overflow-y-auto rounded-lg bg-black/40 p-4 font-mono text-xs">
                      {logsLoading ? (
                        <div className="py-10 text-center text-slate-500">Cargando logs...</div>
                      ) : logs.length === 0 ? (
                        <div className="py-10 text-center text-slate-500">No hay logs recientes.</div>
                      ) : (
                        <div className="space-y-1">
                          {logs.map((log, idx) => (
                            <div key={idx} className="flex gap-2">
                              <span className="text-slate-500 shrink-0">{log.time}</span>
                              <span className={`shrink-0 ${log.topics?.includes('error') ? 'text-rose-600' : 'text-cyan-600'}`}>
                                [{log.topics}]
                              </span>
                              <span className="text-slate-600">{log.message}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {activeTab === 'config' && (
                  <div className="space-y-4">
                    <h4 className="text-lg font-semibold text-slate-800">Conexion remota guiada</h4>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-emerald-800">Aislamiento por cuenta ISP</p>
                          <p className="text-xs text-emerald-700">
                            Perfil activo: <strong>{quickConnect?.onboarding_profile?.account_label || onboardingProfile?.account_label || user?.email || 'Cuenta actual'}</strong>
                            {' '}| prefijo routers: <strong>{quickConnect?.onboarding_profile?.router_name_prefix || onboardingProfile?.router_name_prefix || '-'}</strong>
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                            {selectedRouter.status === 'reachable' ? 'En línea' : 'Desconectado'}
                          </span>
                          <span className="rounded-full bg-blue-500/20 px-2 py-1 text-xs font-semibold text-blue-300 border border-blue-500/30">
                            tenant {quickConnect?.tenant_scope?.tenant_slug || onboardingProfile?.tenant_scope?.tenant_slug || tenantContextId || 'global'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-700">Perfil de acceso WAN</p>
                        <div className="flex items-center gap-2">
                          <select
                            value={quickConnectScope}
                            onChange={(e) => setQuickConnectScope(e.target.value as 'auto' | 'public' | 'private')}
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
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
                        <div className="mt-2 space-y-1 text-xs text-slate-600">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-600 border border-slate-200">
                              detectado: {quickConnect.access_profile.detected_scope || 'unknown'}
                            </span>
                            <span className="rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-600 border border-blue-100">
                              efectivo: {quickConnect.access_profile.effective_scope || 'unknown'}
                            </span>
                            <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-600 border border-emerald-100">
                              recomendado: {quickConnect.access_profile.recommended_transport || '-'}
                            </span>
                          </div>
                          <p className="text-slate-600">{quickConnect.access_profile.reason || '-'}</p>
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-700">Diagnostico de conexion API</p>
                          <p className="text-xs text-slate-600">Muestra la causa real del ultimo test: DNS, puerto, login API y ruta sugerida para el operador.</p>
                          <p className="text-[11px] text-slate-600">
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

                      {/* NAT Warning */}
                      {quickConnect?.access_profile?.effective_scope === 'private' && (
                        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <div className="flex gap-2">
                            <span className="text-amber-500 font-bold">⚠️ NAT detectado:</span>
                            <div className="text-xs text-amber-800 space-y-1">
                              <p>El router tiene una IP privada o está tras CGNAT. El acceso directo por puerto 8728 fallará.</p>
                              <p className="font-semibold">Solución recomendada:</p>
                              <ul className="list-disc list-inside">
                                <li>Usa <strong>SSTP Nativo</strong> (más fácil) o <strong>WireGuard</strong>.</li>
                                <li>Si el router soporta <strong>Back To Home (BTH)</strong>, es la opción más robusta.</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      )}

                      {!activeConnectionDiagnostics && (
                        <p className="text-xs text-slate-600">Todavia no hay un diagnostico guardado para este router. Usa "Probar conexion" o la validacion del wizard.</p>
                      )}
                      {activeConnectionDiagnostics && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                             <span
                              className={`rounded-full px-2 py-1 text-xs font-semibold border ${
                                activeConnectionDiagnostics.success 
                                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
                                  : 'bg-amber-50 text-amber-600 border-amber-200'
                              }`}
                            >
                              {activeConnectionDiagnostics.summary || 'Sin resumen'}
                            </span>
                            {activeConnectionDiagnostics.transport_hint && (
                              <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-600 border border-sky-200">
                                Ruta sugerida: {activeConnectionDiagnostics.transport_hint}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-700">
                            Host <strong>{activeConnectionDiagnostics.host || selectedRouter.ip_address}</strong>:{' '}
                            <strong>{activeConnectionDiagnostics.api_port || '-'}</strong> | tipo:{' '}
                            <strong>{describeHostScope(activeConnectionDiagnostics.host_scope)}</strong>
                          </p>
                          <ul className="space-y-1 text-xs text-slate-800">
                            {(activeConnectionDiagnostics.checks || []).map((check) => {
                              const severity = check.severity || (check.ok ? 'ok' : 'warning')
                              const toneClass =
                                severity === 'critical'
                                  ? 'bg-rose-50 text-rose-600 border-rose-200'
                                  : severity === 'warning'
                                    ? 'bg-amber-50 text-amber-600 border-amber-200'
                                    : 'bg-emerald-50 text-emerald-600 border-emerald-200'
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
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-700">Monitoreo SNMP</p>
                          <p className="text-xs text-slate-600">
                            Configura sondeo para CPU, memoria, temperatura, voltaje, senal u optica desde esta misma vista.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold border ${
                              routerSnmpProfile?.enabled 
                                ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}
                          >
                            {routerSnmpProfile?.enabled ? 'SNMP activo' : 'SNMP inactivo'}
                          </span>
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold border ${
                              routerSnmpRuntimeAvailable === false 
                                ? 'bg-amber-50 text-amber-600 border-amber-200' 
                                : 'bg-blue-50 text-blue-600 border-blue-200'
                            }`}
                          >
                            {routerSnmpRuntimeAvailable === false ? 'Backend sin runtime SNMP' : 'Backend listo'}
                          </span>
                        </div>
                      </div>
                      {routerSnmpLoading ? (
                        <p className="text-xs text-slate-400">Cargando perfil SNMP...</p>
                      ) : (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
                            <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                              <span className="mb-1 block font-semibold text-slate-700">Host</span>
                              <input
                                value={routerSnmpForm.host}
                                onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, host: e.target.value }))}
                                placeholder={selectedRouter.ip_address}
                                className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                              />
                            </label>
                            <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                              <span className="mb-1 block font-semibold text-slate-700">Community</span>
                              <input
                                value={routerSnmpForm.community}
                                onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, community: e.target.value }))}
                                placeholder={routerSnmpProfile?.community_preview || 'public'}
                                className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                              />
                              <span className="mt-1 block text-[11px] text-slate-600">
                                {routerSnmpProfile?.community_configured ? `Actual: ${routerSnmpProfile.community_preview || 'configurada'}` : 'Escribe una nueva para guardarla.'}
                              </span>
                            </label>
                            <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                              <span className="mb-1 block font-semibold text-slate-700">Puerto / timeout / retries</span>
                              <div className="grid grid-cols-3 gap-2">
                                <input
                                  value={routerSnmpForm.port}
                                  onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, port: e.target.value }))}
                                  className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                                />
                                <input
                                  value={routerSnmpForm.timeout_seconds}
                                  onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, timeout_seconds: e.target.value }))}
                                  className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                                />
                                <input
                                  value={routerSnmpForm.retries}
                                  onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, retries: e.target.value }))}
                                  className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                                />
                              </div>
                            </label>
                            <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                              <span className="mb-2 block font-semibold text-slate-700">Switches</span>
                              <div className="space-y-2">
                                <label className="flex items-center justify-between gap-2">
                                  <span>SNMP habilitado</span>
                                  <input
                                    type="checkbox"
                                    checked={routerSnmpForm.enabled}
                                    onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                                  />
                                </label>
                                <label className="flex items-center justify-between gap-2">
                                  <span>Leer interfaces</span>
                                  <input
                                    type="checkbox"
                                    checked={routerSnmpForm.poll_interfaces}
                                    onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, poll_interfaces: e.target.checked }))}
                                  />
                                </label>
                                <label className="flex items-center justify-between gap-2">
                                  <span>Esperar traps</span>
                                  <input
                                    type="checkbox"
                                    checked={routerSnmpForm.trap_enabled}
                                    onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, trap_enabled: e.target.checked }))}
                                  />
                                </label>
                              </div>
                            </div>
                          </div>

                          <label className="block rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                            <span className="mb-1 block font-semibold text-slate-700">Interfaces a graficar</span>
                            <input
                              value={routerSnmpForm.interface_names}
                              onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, interface_names: e.target.value }))}
                              placeholder="ether1, sfp1, bridge"
                              className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                            />
                            <span className="mt-1 block text-[11px] text-slate-600">
                              Dejalo vacio para leer todas las interfaces expuestas por SNMP.
                            </span>
                          </label>

                          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                            {[
                              { key: 'cpu_oid', label: 'CPU %', scaleKey: '' },
                              { key: 'mem_oid', label: 'Memoria %', scaleKey: '' },
                              { key: 'temperature_oid', label: 'Temperatura C', scaleKey: 'temperature_scale' },
                              { key: 'voltage_oid', label: 'Voltaje V', scaleKey: 'voltage_scale' },
                              { key: 'signal_oid', label: 'Senal dBm', scaleKey: 'signal_scale' },
                              { key: 'optical_oid', label: 'Optica RX dBm', scaleKey: 'optical_scale' },
                              { key: 'onu_online_oid', label: 'ONU online', scaleKey: '' },
                              { key: 'onu_offline_oid', label: 'ONU offline', scaleKey: '' },
                            ].map((field) => {
                              const currentValue = routerSnmpForm[field.key as keyof RouterSnmpFormState] as string
                              const currentScale = field.scaleKey
                                ? (routerSnmpForm[field.scaleKey as keyof RouterSnmpFormState] as string)
                                : ''
                              return (
                                <div key={field.key} className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                                  <span className="mb-1 block font-semibold text-slate-700">{field.label}</span>
                                  <div className={`grid gap-2 ${field.scaleKey ? 'grid-cols-[minmax(0,1fr)_88px]' : 'grid-cols-1'}`}>
                                    <input
                                      value={currentValue}
                                      onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                                      placeholder="OID"
                                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                                    />
                                    {field.scaleKey && (
                                      <input
                                        value={currentScale}
                                        onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, [field.scaleKey]: e.target.value }))}
                                        placeholder="scale"
                                        className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                                      />
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                            <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                              <span className="mb-1 block font-semibold text-slate-700">Temp. critica C</span>
                              <input
                                value={routerSnmpForm.threshold_temperature}
                                onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, threshold_temperature: e.target.value }))}
                                className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                              />
                            </label>
                            <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                              <span className="mb-1 block font-semibold text-slate-700">Voltaje minimo</span>
                              <input
                                value={routerSnmpForm.threshold_voltage_min}
                                onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, threshold_voltage_min: e.target.value }))}
                                className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                              />
                            </label>
                            <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                              <span className="mb-1 block font-semibold text-slate-700">Senal minima dBm</span>
                              <input
                                value={routerSnmpForm.threshold_signal_min}
                                onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, threshold_signal_min: e.target.value }))}
                                className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                              />
                            </label>
                            <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                              <span className="mb-1 block font-semibold text-slate-700">Optica minima dBm</span>
                              <input
                                value={routerSnmpForm.threshold_optical_min}
                                onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, threshold_optical_min: e.target.value }))}
                                className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                              />
                            </label>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => void saveRouterSnmpProfile()}
                              disabled={routerSnmpSaving}
                              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                            >
                              {routerSnmpSaving ? 'Guardando...' : 'Guardar perfil SNMP'}
                            </button>
                            <button
                              onClick={() => void runRouterSnmpPoll(false)}
                              disabled={routerSnmpPolling}
                              className="rounded bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
                            >
                              {routerSnmpPolling ? 'Consultando...' : 'Probar SNMP'}
                            </button>
                            <button
                              onClick={() => void runRouterSnmpPoll(true)}
                              disabled={routerSnmpPolling}
                              className="rounded border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-60"
                            >
                              Probar + persistir
                            </button>
                          </div>

                          {routerSnmpPollResult && (
                            <div className="rounded border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-semibold">Ultima lectura SNMP</p>
                                <span>{routerSnmpPollResult.polled_at || '-'}</span>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                                <div className="rounded bg-white/5 backdrop-blur-md px-2 py-2">CPU: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.cpu_percent, '%')}</strong></div>
                                <div className="rounded bg-white/5 backdrop-blur-md px-2 py-2">Mem: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.mem_percent, '%')}</strong></div>
                                <div className="rounded bg-white/5 backdrop-blur-md px-2 py-2">Temp: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.temperature_c, ' C')}</strong></div>
                                <div className="rounded bg-white/5 backdrop-blur-md px-2 py-2">Volt: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.voltage_v, ' V')}</strong></div>
                                <div className="rounded bg-white/5 backdrop-blur-md px-2 py-2">Senal: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.signal_level_dbm, ' dBm')}</strong></div>
                                <div className="rounded bg-white/5 backdrop-blur-md px-2 py-2">Optica: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.optical_rx_dbm, ' dBm')}</strong></div>
                                <div className="rounded bg-white/5 backdrop-blur-md px-2 py-2">ONU on: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.onu_online)}</strong></div>
                                <div className="rounded bg-white/5 backdrop-blur-md px-2 py-2">ONU off: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.onu_offline)}</strong></div>
                              </div>
                              {(routerSnmpPollResult.interfaces || []).length > 0 && (
                                <div className="mt-2 rounded border border-sky-100 bg-white/5 backdrop-blur-md p-2">
                                  <p className="font-semibold text-sky-800">Interfaces leidas</p>
                                  <div className="mt-1 grid grid-cols-1 gap-1 text-[11px] text-sky-900">
                                    {(routerSnmpPollResult.interfaces || []).slice(0, 4).map((iface) => (
                                      <div key={`${iface.name}-${iface.index ?? 'idx'}`} className="rounded bg-sky-50 px-2 py-1">
                                        <strong>{iface.name || 'if'}</strong> | RX {formatSnmpMetric(iface.rx_bytes)} | TX {formatSnmpMetric(iface.tx_bytes)} | estado {formatSnmpMetric(iface.oper_status)}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-200">Readiness remoto del router</p>
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
                      {readinessLoading && <p className="text-xs text-slate-400">Evaluando readiness...</p>}
                      {!readinessLoading && !routerReadiness && (
                        <p className="text-xs text-slate-400">Sin datos de readiness para este router.</p>
                      )}
                      {!readinessLoading && routerReadiness && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-blue-500/20 px-2 py-1 text-xs font-semibold text-blue-300">
                              Score {routerReadiness.score ?? 0}%
                            </span>
                            <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">
                              Blockers {(routerReadiness.blockers || []).length}
                            </span>
                          </div>
                          <ul className="space-y-1 text-xs text-slate-600">
                            {(routerReadiness.checks || []).map((check) => {
                              const severity = check.severity || (check.ok ? 'ok' : 'warning')
                              const toneClass =
                                severity === 'critical'
                                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                  : severity === 'warning'
                                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                                    : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                              return (
                                <li key={check.id} className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded px-2 py-0.5 font-semibold ${toneClass}`}>{check.id}</span>
                                  <span>{check.detail || '-'}</span>
                                </li>
                              )
                            })}
                          </ul>
                          {(routerReadiness.recommendations || []).length > 0 && (
                            <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2">
                              <p className="text-xs font-semibold uppercase text-amber-400">Recomendaciones</p>
                              <ul className="mt-1 space-y-1 text-xs text-amber-200/80">
                                {(routerReadiness.recommendations || []).map((item, idx) => (
                                  <li key={`${item}-${idx}`}>- {item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {quickLoading && <p className="text-sm text-slate-400">Cargando scripts...</p>}
                    {!quickLoading && !quickConnect?.scripts && (
                      <p className="text-sm text-rose-600">No se pudieron cargar scripts para este router.</p>
                    )}
                    {quickConnect?.scripts && (
                      <>
                        {quickConnect.connection_plan && (
                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-emerald-400">
                                  {quickConnect.connection_plan.title || 'Conexion Express'}
                                </p>
                                <p className="text-xs text-emerald-300/80">
                                  {quickConnect.connection_plan.summary || 'Sigue los pasos recomendados.'}
                                </p>
                              </div>
                              <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                                {quickConnect.connection_plan.recommended_transport || '-'}
                              </span>
                            </div>
                            {/* ── SSTP single-panel (replaces 3-step wizard) ── */}
                            <div className="mt-2 rounded-xl border border-emerald-500/30 bg-white/5 backdrop-blur-md p-4 space-y-3">

                              {/* Loading */}
                              {sstpLoadingForRouter === String(selectedRouter?.id) && (
                                <p className="text-xs text-emerald-600 animate-pulse">Verificando túnel SSTP...</p>
                              )}

                              {/* No tunnel */}
                              {!sstpLoadingForRouter && !sstpTunnel && (
                                <div className="text-center py-2">
                                  <p className="text-sm font-semibold text-slate-700">Sin túnel SSTP activo</p>
                                  <p className="mt-1 text-xs text-slate-500">Crea el túnel para que el MikroTik se conecte al servidor VPN y el panel pueda gestionarlo remotamente.</p>
                                  <button
                                    onClick={() => void provisionSstpForRouter()}
                                    disabled={sstpProvisioning}
                                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow hover:bg-emerald-500 disabled:opacity-60 transition"
                                  >
                                    {sstpProvisioning ? (
                                      <><svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Provisionando...</>
                                    ) : (
                                      <>⚡ Provisionar SSTP</>
                                    )}
                                  </button>
                                </div>
                              )}

                              {/* Tunnel active */}
                              {!sstpLoadingForRouter && sstpTunnel && (
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse shadow-lg shadow-emerald-400/50" />
                                      <p className="text-sm font-bold text-emerald-700">Servidor SSTP Nativo Activo</p>
                                    </div>
                                    <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30 uppercase tracking-wide">{sstpTunnel.status}</span>
                                  </div>

                                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-gradient-to-r from-emerald-50 to-slate-50 px-3 py-2.5 text-xs text-slate-700 border border-emerald-200">
                                    <div><span className="text-slate-500">Usuario PPP:</span> <strong className="font-mono text-emerald-800">{sstpTunnel.username}</strong></div>
                                    <div><span className="text-slate-500">Servidor:</span> <strong className="font-mono text-emerald-800">{sstpTunnel.server_host}:{sstpTunnel.server_port}</strong></div>
                                    {sstpTunnel.password && (
                                      <div className="col-span-2"><span className="text-slate-500">Password:</span> <strong className="font-mono text-emerald-900">{sstpTunnel.password}</strong></div>
                                    )}
                                  </div>

                                  {sstpScript && (
                                    <div className="rounded-xl border border-slate-200 bg-slate-950 overflow-hidden shadow-sm">
                                      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700 bg-slate-900">
                                        <div className="flex items-center gap-2">
                                          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                          <p className="text-[11px] font-semibold text-slate-300">Script RouterOS - Winbox New Terminal - pegar - Enter</p>
                                        </div>
                                        <button
                                          onClick={async () => {
                                            await copyToClipboard(sstpScript)
                                            setSstpScriptCopied(true)
                                            setTimeout(() => setSstpScriptCopied(false), 2500)
                                          }}
                                          className="rounded-md bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 transition shadow-sm"
                                        >
                                          {sstpScriptCopied ? 'Copiado!' : 'Copiar script'}
                                        </button>
                                      </div>
                                      <pre className="max-h-52 overflow-y-auto p-3 text-[10px] leading-relaxed text-emerald-300 whitespace-pre-wrap">{sstpScript}</pre>
                                    </div>
                                  )}

                                  <div className="flex flex-wrap gap-2 pt-1">
                                    <button
                                      onClick={() => void runWizardValidation()}
                                      disabled={wizardValidating || readinessLoading}
                                      className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60 transition shadow-sm"
                                    >
                                      {wizardValidating ? 'Validando...' : 'Validar conexion'}
                                    </button>
                                    <button
                                      onClick={() => void provisionSstpForRouter()}
                                      disabled={sstpProvisioning}
                                      className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 transition"
                                    >
                                      Regenerar credenciales
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>

                            {expressSteps.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {expressSteps.map((step) => {
                                  const toneClass =
                                    step.status === 'success'
                                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                      : step.status === 'failed'
                                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                        : step.status === 'running'
                                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                          : step.status === 'skipped'
                                            ? 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                                            : 'bg-white/5 backdrop-blur-md text-slate-400'
                                  return (
                                    <div key={step.id} className={`rounded px-2 py-1 text-xs border ${toneClass}`}>
                                      <strong>{step.label}</strong>
                                      {step.detail ? `: ${step.detail}` : ''}
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            <div className="mt-2 flex items-center justify-between rounded border border-emerald-200 bg-white/5 backdrop-blur-md p-2">
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
                                    <div key={action.id} className="rounded border border-emerald-200 bg-white/5 backdrop-blur-md p-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                          <p className="text-xs font-semibold text-emerald-900">{action.label}</p>
                                          <p className="text-xs text-emerald-800">{action.description || '-'}</p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          {action.requires_local_access && (
                                            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/30">
                                              vía script local
                                            </span>
                                          )}
                                          {action.auto_available && (
                                            <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold text-blue-300 border border-blue-500/30">
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
                        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm font-semibold text-slate-200">Script acceso directo API/SSH</p>
                            <button
                              onClick={() => copyScript('script API', quickConnect.scripts?.direct_api_script || '')}
                              className="rounded bg-gray-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-gray-200"
                            >
                              Copiar
                            </button>
                          </div>
                          <pre className="max-h-52 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
                            {quickConnect.scripts.direct_api_script}
                          </pre>
                        </div>
                        <div className="rounded-lg border border-white/10 p-3">
                          <p className="text-xs font-semibold uppercase text-slate-400">Login Windows/Linux</p>
                          <p className="mt-2 rounded bg-slate-900 px-2 py-1 text-xs text-slate-100">{quickConnect.scripts.windows_login}</p>
                          <p className="mt-2 rounded bg-slate-900 px-2 py-1 text-xs text-slate-100">{quickConnect.scripts.linux_login}</p>
                        </div>

                        </>
                        )}
                      </>
                    )}
                  </div>
                )}
                {activeTab === 'security' && (
                  <div className="space-y-4 text-sm text-slate-300">
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <h4 className="text-lg font-semibold text-white">Operacion enterprise y seguridad</h4>
                      <p className="mt-1 text-xs text-slate-400">
                        Acciones live requieren ticket de cambio cuando la politica `change_control_required_for_live` esta activa.
                      </p>
                      {(quickConnect?.guidance?.notes || []).map((note, idx) => (
                        <p key={idx} className="mt-2 text-xs text-slate-300">
                          - {note}
                        </p>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div className="rounded-lg border border-white/10 bg-white/5 backdrop-blur-md p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-white">Hardening runbook</p>
                          <span className={`rounded px-2 py-1 text-xs font-semibold border ${hardeningDryRun ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'}`}>
                            {hardeningDryRun ? 'dry-run' : 'live'}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                          <label className="text-xs text-slate-300">
                            Perfil router
                            <select
                              value={hardeningProfile}
                              onChange={(e) => setHardeningProfile(e.target.value)}
                              className="mt-1 w-full rounded border border-white/20 px-2 py-1 text-xs text-white"
                            >
                              {(enterpriseProfiles?.router_profiles || [{ id: 'baseline', label: 'Baseline' }]).map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs text-slate-300">
                            Perfil sitio
                            <select
                              value={hardeningSiteProfile}
                              onChange={(e) => setHardeningSiteProfile(e.target.value)}
                              className="mt-1 w-full rounded border border-white/20 px-2 py-1 text-xs text-white"
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
                          <label className="flex items-center gap-2 text-xs text-slate-300">
                            <input
                              type="checkbox"
                              checked={hardeningDryRun}
                              onChange={(e) => setHardeningDryRun(e.target.checked)}
                              className="rounded border-white/20"
                            />
                            Ejecutar dry-run
                          </label>
                          <label className="flex items-center gap-2 text-xs text-slate-300">
                            <input
                              type="checkbox"
                              checked={hardeningAutoRollback}
                              onChange={(e) => setHardeningAutoRollback(e.target.checked)}
                              className="rounded border-white/20"
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
                          <div className="mt-3 rounded border border-white/20 bg-white/5 p-2">
                            <p className="text-xs font-semibold uppercase text-slate-300">Resultado hardening</p>
                            <p className="mt-1 text-xs text-slate-300">
                              change_id: <strong>{hardeningResult.change_id || '-'}</strong> | modo:{' '}
                              <strong>{hardeningResult.dry_run ? 'dry-run' : 'live'}</strong>
                            </p>
                            {hardeningResult.message && <p className="mt-1 text-xs text-slate-300">{hardeningResult.message}</p>}
                            {hardeningResult.error && <p className="mt-1 text-xs text-rose-700">{hardeningResult.error}</p>}
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-white/10 bg-white/5 backdrop-blur-md p-4">
                        <p className="text-sm font-semibold text-white">Failover test</p>
                        <p className="mt-1 text-xs text-slate-400">
                          Ejecuta probes desde el router para validar perdida de paquetes y latencia.
                        </p>
                        <textarea
                          value={failoverTargets}
                          onChange={(e) => setFailoverTargets(e.target.value)}
                          rows={3}
                          placeholder="1.1.1.1,8.8.8.8,9.9.9.9"
                          className="mt-2 w-full rounded border border-white/20 px-2 py-1 text-xs text-white"
                        />
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            value={failoverCount}
                            onChange={(e) => setFailoverCount(e.target.value)}
                            className="w-20 rounded border border-white/20 px-2 py-1 text-xs text-white"
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
                          <div className="mt-3 rounded border border-white/20 bg-white/5 p-2">
                            <p className="text-xs font-semibold uppercase text-slate-300">
                              Estado general: <span className="font-bold">{failoverResult.overall_status || 'unknown'}</span>
                            </p>
                            <div className="mt-2 max-h-44 overflow-auto">
                              {(failoverResult.targets || []).map((item, idx) => (
                                <p key={`${item.target}-${idx}`} className="text-xs text-slate-300">
                                  {item.target} | loss {item.packet_loss}% | avg {item.avg_latency_ms ?? '-'} ms | {item.status}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/5 backdrop-blur-md p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white">Change log y rollback</p>
                        <button
                          onClick={() => selectedRouter && loadEnterpriseChangeLog(selectedRouter.id)}
                          disabled={securityBusy}
                          className="rounded bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-300 disabled:opacity-60"
                        >
                          Refrescar log
                        </button>
                      </div>
                      {!enterpriseChangeLog.length && <p className="mt-2 text-xs text-slate-400">No hay cambios registrados.</p>}
                      <div className="mt-2 space-y-2">
                        {enterpriseChangeLog.map((entry) => (
                          <div key={entry.change_id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 px-2 py-2">
                            <div className="text-xs text-slate-300">
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

                {activeTab === 'traffic_flow' && (
                  <div className="space-y-5">
                    {/* Header */}
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-lg font-bold text-white">📊 Script de Traffic Flow</h4>
                        <p className="mt-0.5 text-xs text-slate-400">
                          Habilita NetFlow v5 en el MikroTik para enviar métricas de consumo por cliente a FASTISP.
                        </p>
                        {tfCollector && (
                          <p className="mt-1 text-xs text-emerald-700 font-mono">
                            Colector: <strong>{tfCollector.ip}:{tfCollector.port}</strong>
                          </p>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          setTfLoading(true)
                          try {
                            const params = new URLSearchParams()
                            if (tfLanGw) params.set('lan_gateways', tfLanGw)
                            if (tfWanGw) params.set('wan_gateways', tfWanGw)
                            const r = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/traffic-flow/script?${params}`)
                            const d = await r.json().catch(() => ({})) as {success?: boolean; scripts?: {ros6: string; ros7_lan: string; ros7_wan: string}; collector_ip?: string; collector_port?: number}
                            if (d.success && d.scripts) {
                              setTfScripts(d.scripts)
                              setTfCollector({ ip: d.collector_ip || '', port: d.collector_port || 2055 })
                            } else {
                              addToast('error', 'Error generando script de Traffic Flow')
                            }
                          } catch { addToast('error', 'Error de red') }
                          setTfLoading(false)
                        }}
                        disabled={tfLoading}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60 transition"
                      >
                        {tfLoading ? 'Generando...' : '⚡ Generar scripts'}
                      </button>
                    </div>

                    {/* Gateway inputs */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-lg border border-white/10 bg-white/5 p-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                          IPs Puerta de Enlace LAN (separadas por coma)
                        </label>
                        <input
                          type="text"
                          value={tfLanGw}
                          onChange={(e) => setTfLanGw(e.target.value)}
                          placeholder="192.168.1.1, 192.168.2.1"
                          className="w-full rounded border border-white/20 px-2 py-1 text-xs font-mono text-white"
                        />
                        <p className="mt-0.5 text-[10px] text-slate-500">Solo RouterOS 7 — Opción 1 (LAN gateway)</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                          IPs Puerta de Enlace WAN (separadas por coma)
                        </label>
                        <input
                          type="text"
                          value={tfWanGw}
                          onChange={(e) => setTfWanGw(e.target.value)}
                          placeholder="203.0.113.1"
                          className="w-full rounded border border-white/20 px-2 py-1 text-xs font-mono text-white"
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
                            <div key={item.key} className="rounded-2xl border border-gray-100 bg-slate-900 overflow-hidden shadow-sm">
                              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/5">
                                <div>
                                  <p className="text-xs font-black text-slate-200 uppercase tracking-widest">{item.label}</p>
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
                              <pre className="overflow-x-auto p-6 text-[11px] leading-relaxed text-coral-100 font-mono whitespace-pre-wrap">{script}</pre>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Stats: top consumers */}
                    <div className="rounded-lg border border-white/10 bg-white/5 backdrop-blur-md p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div>
                          <h5 className="font-semibold text-white">📈 Top Consumidores</h5>
                          <p className="text-xs text-slate-400">Clientes con mayor consumo según NetFlow recibido.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={tfHours}
                            onChange={(e) => setTfHours(Number(e.target.value))}
                            className="rounded border border-white/20 px-2 py-1 text-xs text-white"
                          >
                            {[1, 6, 12, 24, 48, 168].map((h) => (
                              <option key={h} value={h}>{h === 168 ? '7 días' : `${h}h`}</option>
                            ))}
                          </select>
                          <button
                            onClick={async () => {
                              setTfStatsLoading(true)
                              try {
                                const r = await apiFetch(`/api/mikrotik/traffic-flow/stats/router/${selectedRouter.id}?hours=${tfHours}&limit=50`)
                                const d = await r.json().catch(() => ({})) as {success?: boolean; stats?: typeof tfStats}
                                if (d.success) setTfStats(d.stats || [])
                                else addToast('error', 'Error cargando estadísticas de Traffic Flow')
                              } catch { addToast('error', 'Error de red') }
                              setTfStatsLoading(false)
                            }}
                            disabled={tfStatsLoading}
                            className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
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
                                  <td className="px-4 py-3 text-slate-400 font-bold">{i + 1}</td>
                                  <td className="px-4 py-3 font-mono font-bold text-slate-700">{row.src_ip}</td>
                                  <td className="px-4 py-3 text-right font-black text-coral-500">{row.mb_total.toLocaleString()} MB</td>
                                  <td className="px-4 py-3 text-right text-slate-500">{(row.bytes_total || 0).toLocaleString()}</td>
                                  <td className="px-4 py-3 text-right text-slate-500">{(row.packets_total || 0).toLocaleString()}</td>
                                  <td className="px-4 py-3 text-slate-400 font-mono text-[10px]">{row.last_seen ? new Date(row.last_seen).toLocaleString() : '-'}</td>
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
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setConfirmOpen(false)}></div>
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
