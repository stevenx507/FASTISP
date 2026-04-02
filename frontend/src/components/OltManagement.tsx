import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { ApiError, apiClient } from '../lib/apiClient'

type RunMode = 'simulate' | 'dry-run' | 'live'
type OltActionIntent = 'authorize' | 'suspend' | 'activate' | 'reboot'
type OltCheckSeverity = 'ok' | 'warning' | 'critical'

interface OltVendor {
  id: string
  label: string
  actions: string[]
}

interface OltDevice {
  id: string
  name: string
  vendor: string
  model?: string
  host?: string
  transport?: string
  site?: string
  origin?: string
  port?: number
  username?: string
}

interface OltServiceTemplate {
  id: string
  label: string
  line_profile: string
  srv_profile: string
  origin?: string
}

interface OltAuditEntry {
  id: string
  device_id: string
  run_mode: string
  success: boolean
  started_at: string
  finished_at: string
  commands: number
  error?: string | null
}

interface OltRemoteOptions {
  success: boolean
  device?: OltDevice
  options?: {
    direct_login?: string
    tcp_probe_windows?: string
    tcp_probe_linux?: string
    jump_host_ssh?: string
    reverse_tunnel_template?: string
    recommendations?: string[]
  }
  readiness?: {
    score?: number
    status?: 'ready' | 'degraded' | 'blocked'
    status_label?: string
    summary?: string
    checked_at?: number
    host_analysis?: {
      kind?: string
      label?: string
      detail?: string
      recommended_path?: string
      vpn_recommended?: boolean
    }
    management_path?: {
      id?: string
      label?: string
    }
    checks?: Array<{
      id: string
      label: string
      ok: boolean
      detail?: string
      severity?: OltCheckSeverity
    }>
    missing?: string[]
    recommendations?: string[]
  }
  grafana?: {
    configured?: boolean
    dashboard_url?: string | null
    health_url?: string | null
    reachable?: boolean | null
    status_code?: number | null
    response_time_ms?: number | null
    datasource_uid?: string | null
    error?: string | null
    recommendations?: string[]
  }
}

interface OltDeviceForm {
  vendor: string
  name: string
  host: string
  transport: string
  port: string
  username: string
  model: string
  site: string
  password: string
  enable_password: string
}

interface OltConnectionDiagnostics {
  success?: boolean
  status?: 'ready' | 'degraded' | 'blocked'
  status_label?: string
  summary?: string
  next_step?: string | null
  checked_at?: number
  management_path?: {
    id?: string
    label?: string
  }
  host_analysis?: {
    kind?: string
    label?: string
    detail?: string
    recommended_path?: string
    vpn_recommended?: boolean
  }
  connection?: {
    success?: boolean
    reachable?: boolean
    latency_ms?: number
    error?: string
    message?: string
  }
  readiness?: OltRemoteOptions['readiness']
  recommendations?: string[]
  device?: OltDevice
}

interface OnuPreflight {
  score: number
  status: 'ready' | 'degraded' | 'blocked'
  summary: string
  checks: Array<{
    id: string
    label: string
    ok: boolean
    detail?: string
    severity?: OltCheckSeverity
  }>
  missing: string[]
  recommendations: string[]
}

interface OltSnapshotData {
  device_id?: string
  generated_at?: string
  pon_total?: number
  pon_alert?: number
  onu_online?: number
  onu_offline?: number
  cpu_load?: number
  memory_usage?: number
  temperature_c?: number
}

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const toNumber = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const statusPillClass = (status?: string) => {
  if (!status) return 'bg-slate-700 text-slate-200'
  if (status === 'ready') return 'bg-emerald-500/20 text-emerald-300'
  if (status === 'degraded') return 'bg-amber-500/20 text-amber-200'
  return 'bg-rose-500/20 text-rose-300'
}

const checkPillClass = (ok: boolean, severity?: OltCheckSeverity) => {
  if (ok) return 'bg-emerald-500/20 text-emerald-300'
  if (severity === 'critical') return 'bg-rose-500/20 text-rose-300'
  return 'bg-amber-500/20 text-amber-300'
}

const formatCheckedAt = (value?: number) => {
  if (!value) return '-'
  return new Date(value * 1000).toLocaleString('es-CO')
}

const formatIsoDate = (value?: string | null) => {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('es-CO')
}

const formatRunMode = (value?: string | null) => {
  if (!value) return '-'
  if (value === 'dry-run') return 'dry-run'
  if (value === 'live') return 'live'
  return 'simulate'
}

const intentLabel = (value: OltActionIntent) => {
  if (value === 'authorize') return 'Autorizar'
  if (value === 'suspend') return 'Suspender'
  if (value === 'activate') return 'Activar'
  return 'Reiniciar'
}

const toneCardClass = (tone: 'cyan' | 'emerald' | 'amber' | 'rose' | 'slate') => {
  if (tone === 'cyan') return 'border-cyan-400/20 bg-cyan-500/10 text-cyan-100'
  if (tone === 'emerald') return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
  if (tone === 'amber') return 'border-amber-400/20 bg-amber-500/10 text-amber-100'
  if (tone === 'rose') return 'border-rose-400/20 bg-rose-500/10 text-rose-100'
  return 'border-white/10 bg-slate-800/70 text-slate-100'
}

const toneProgressClass = (tone: 'cyan' | 'emerald' | 'amber' | 'rose' | 'slate') => {
  if (tone === 'cyan') return 'bg-cyan-400'
  if (tone === 'emerald') return 'bg-emerald-400'
  if (tone === 'amber') return 'bg-amber-400'
  if (tone === 'rose') return 'bg-rose-400'
  return 'bg-slate-400'
}

const buildOnuPreflight = ({
  selectedDevice,
  remoteOptions,
  selectedTemplate,
  runMode,
  liveConfirm,
  changeTicket,
  preflightAck,
  serial,
  frame,
  slot,
  pon,
  onu,
  vlan,
  lineProfile,
  srvProfile,
  intent,
}: {
  selectedDevice: OltDevice | null
  remoteOptions: OltRemoteOptions | null
  selectedTemplate: OltServiceTemplate | null
  runMode: RunMode
  liveConfirm: boolean
  changeTicket: string
  preflightAck: boolean
  serial: string
  frame: string
  slot: string
  pon: string
  onu: string
  vlan: string
  lineProfile: string
  srvProfile: string
  intent: OltActionIntent
}): OnuPreflight => {
  const frameValue = toNumber(frame)
  const slotValue = toNumber(slot)
  const ponValue = toNumber(pon)
  const onuValue = toNumber(onu)
  const vlanValue = toNumber(vlan)
  const readiness = remoteOptions?.readiness
  const readinessStatus = readiness?.status
  const hasProfiles = Boolean(
    lineProfile.trim() || srvProfile.trim() || selectedTemplate?.line_profile || selectedTemplate?.srv_profile
  )
  const profileDetail =
    lineProfile.trim() || srvProfile.trim()
      ? 'Perfiles definidos manualmente.'
      : selectedTemplate
        ? `Se usara template ${selectedTemplate.label}.`
        : 'Se usaran defaults del vendor si no ajustas perfiles.'

  const checks: OnuPreflight['checks'] = [
    {
      id: 'device_selected',
      label: 'OLT seleccionada',
      ok: Boolean(selectedDevice),
      detail: selectedDevice ? `${selectedDevice.name} | ${selectedDevice.host || 'sin host'}` : 'Selecciona una OLT.',
      severity: 'critical',
    },
    {
      id: 'olt_path',
      label: 'Ruta de gestion OLT',
      ok: readinessStatus === 'ready' || readinessStatus === 'degraded',
      detail: readiness?.summary || 'Carga el readiness remoto para confirmar reachability.',
      severity: readinessStatus === 'blocked' ? 'critical' : 'warning',
    },
    {
      id: 'target_path',
      label: 'Frame / slot / PON validos',
      ok: frameValue !== null && slotValue !== null && ponValue !== null && frameValue >= 0 && slotValue >= 0 && ponValue >= 0,
      detail: `frame ${frame || '-'} | slot ${slot || '-'} | pon ${pon || '-'}`,
      severity: 'critical',
    },
    {
      id: 'serial',
      label: 'Serial ONU listo',
      ok: serial.trim().length >= 6,
      detail: serial.trim() ? serial.trim() : 'El backend exige serial para acciones ONU con auditoria.',
      severity: 'critical',
    },
    {
      id: 'onu_id',
      label: 'ONU ID definido',
      ok: onuValue !== null && onuValue > 0,
      detail: onuValue !== null ? `ONU ${onuValue}` : 'Define ONU ID para evitar defaults accidentales.',
      severity: 'critical',
    },
  ]

  if (intent === 'authorize' || intent === 'activate') {
    checks.push({
      id: 'vlan',
      label: 'VLAN operativa',
      ok: vlanValue !== null && vlanValue >= 1 && vlanValue <= 4094,
      detail: vlanValue !== null ? `VLAN ${vlanValue}` : 'Ingresa una VLAN valida entre 1 y 4094.',
      severity: 'critical',
    })
    checks.push({
      id: 'profiles',
      label: 'Profiles de servicio',
      ok: hasProfiles,
      detail: profileDetail,
      severity: hasProfiles ? 'ok' : 'warning',
    })
  }

  checks.push({
    id: 'live_guardrails',
    label: 'Guardrails live',
    ok: runMode !== 'live' || (liveConfirm && preflightAck && Boolean(changeTicket.trim())),
    detail:
      runMode === 'live'
        ? 'Live requiere confirmacion, ticket de cambio y preflight aprobado.'
        : 'Simulate / dry-run habilitan validacion segura antes de tocar la ONU.',
    severity: runMode === 'live' ? 'critical' : 'ok',
  })

  checks.push({
    id: 'transport',
    label: 'Transporte de gestion',
    ok: runMode !== 'live' || selectedDevice?.transport !== 'telnet',
    detail:
      selectedDevice?.transport === 'telnet'
        ? 'Telnet detectado. Para live, prioriza VPN privada o migra a SSH.'
        : 'SSH recomendado para auditoria y seguridad.',
    severity: selectedDevice?.transport === 'telnet' ? 'warning' : 'ok',
  })

  const weights: Record<string, number> = {
    device_selected: 15,
    olt_path: 20,
    target_path: 15,
    serial: 15,
    onu_id: 10,
    vlan: 10,
    profiles: 5,
    live_guardrails: 15,
    transport: 5,
  }
  const scoreBase = checks.reduce((sum, check) => sum + (weights[check.id] || 0), 0) || 1
  const scoreOk = checks.reduce((sum, check) => sum + (check.ok ? weights[check.id] || 0 : 0), 0)
  const score = Math.max(0, Math.min(100, Math.round((scoreOk / scoreBase) * 100)))
  const hasCriticalFailure = checks.some((check) => !check.ok && check.severity === 'critical')
  const hasWarningFailure = checks.some((check) => !check.ok)

  const missing = checks.filter((check) => !check.ok).map((check) => check.label)
  const recommendations = [
    readiness?.management_path?.label
      ? `Ruta sugerida: ${readiness.management_path.label}.`
      : 'Valida primero reachability entre backend y OLT.',
    intent === 'authorize' || intent === 'activate'
      ? 'Confirma line profile, srv profile y VLAN antes de provisionar.'
      : 'Confirma serial y ONU ID antes de tocar la ONT en live.',
    runMode === 'live'
      ? 'Haz una corrida simulate o dry-run antes del cambio real.'
      : 'Usa live solo cuando el readiness de la OLT este estable.',
  ]

  return {
    score,
    status: hasCriticalFailure ? 'blocked' : hasWarningFailure ? 'degraded' : 'ready',
    summary: hasCriticalFailure
      ? 'Hay bloqueos que conviene resolver antes de tocar la ONU.'
      : hasWarningFailure
        ? 'La operacion es posible, pero aun hay senales de riesgo o defaults activos.'
        : 'La operacion ONU luce lista para ejecutarse de forma controlada.',
    checks,
    missing,
    recommendations,
  }
}

const OltManagement: React.FC = () => {
  const [vendors, setVendors] = useState<OltVendor[]>([])
  const [devices, setDevices] = useState<OltDevice[]>([])
  const [selectedVendor, setSelectedVendor] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [runMode, setRunMode] = useState<RunMode>('simulate')
  const [liveConfirm, setLiveConfirm] = useState(false)
  const [changeTicket, setChangeTicket] = useState('')
  const [preflightAck, setPreflightAck] = useState(false)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [busy, setBusy] = useState(false)
  const [savingDevice, setSavingDevice] = useState(false)

  const [serial, setSerial] = useState('')
  const [frame, setFrame] = useState('0')
  const [slot, setSlot] = useState('1')
  const [pon, setPon] = useState('1')
  const [onu, setOnu] = useState('1')
  const [vlan, setVlan] = useState('120')
  const [lineProfile, setLineProfile] = useState('')
  const [srvProfile, setSrvProfile] = useState('')
  const [onuIntent, setOnuIntent] = useState<OltActionIntent>('authorize')

  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null)
  const [connection, setConnection] = useState<OltConnectionDiagnostics | null>(null)
  const [lastResponse, setLastResponse] = useState<Record<string, unknown> | null>(null)
  const [auditEntries, setAuditEntries] = useState<OltAuditEntry[]>([])
  const [customAction, setCustomAction] = useState('show_pon_summary')
  const [customPayload, setCustomPayload] = useState('{\n  "frame": 0,\n  "slot": 1,\n  "pon": 1\n}')
  const [quickScript, setQuickScript] = useState('')
  const [remoteOptions, setRemoteOptions] = useState<OltRemoteOptions | null>(null)
  const [refreshingReadiness, setRefreshingReadiness] = useState(false)
  const [serviceTemplates, setServiceTemplates] = useState<Record<string, OltServiceTemplate[]>>({})
  const [selectedTemplateId, setSelectedTemplateId] = useState('')

  const [deviceForm, setDeviceForm] = useState<OltDeviceForm>({
    vendor: 'zte',
    name: '',
    host: '',
    transport: 'ssh',
    port: '22',
    username: 'admin',
    model: '',
    site: '',
    password: '',
    enable_password: '',
  })

  const filteredDevices = useMemo(
    () => (selectedVendor ? devices.filter((d) => d.vendor === selectedVendor) : devices),
    [devices, selectedVendor]
  )

  const selectedDevice = useMemo(
    () => filteredDevices.find((d) => d.id === selectedDeviceId) || null,
    [filteredDevices, selectedDeviceId]
  )

  const selectedVendorData = useMemo(
    () => vendors.find((v) => v.id === (selectedDevice?.vendor || selectedVendor)) || null,
    [vendors, selectedDevice?.vendor, selectedVendor]
  )
  const activeVendor = selectedDevice?.vendor || selectedVendor
  const templateOptions = useMemo(() => serviceTemplates[activeVendor] || [], [serviceTemplates, activeVendor])
  const selectedTemplate = useMemo(
    () => templateOptions.find((template) => template.id === selectedTemplateId) || null,
    [templateOptions, selectedTemplateId]
  )

  const liveModeBlocked = runMode === 'live' && (!liveConfirm || !preflightAck || !changeTicket.trim())
  const onuPreflight = useMemo(
    () =>
      buildOnuPreflight({
        selectedDevice,
        remoteOptions,
        selectedTemplate,
        runMode,
        liveConfirm,
        changeTicket,
        preflightAck,
        serial,
        frame,
        slot,
        pon,
        onu,
        vlan,
        lineProfile,
        srvProfile,
        intent: onuIntent,
      }),
    [
      selectedDevice,
      remoteOptions,
      selectedTemplate,
      runMode,
      liveConfirm,
      changeTicket,
      preflightAck,
      serial,
      frame,
      slot,
      pon,
      onu,
      vlan,
      lineProfile,
      srvProfile,
      onuIntent,
    ]
  )
  const snapshotData = useMemo(() => {
    if (!snapshot || typeof snapshot !== 'object') return null
    return snapshot as OltSnapshotData
  }, [snapshot])
  const latestAuditEntry = auditEntries[0] || null
  const auditSummary = useMemo(() => {
    const total = auditEntries.length
    const success = auditEntries.filter((entry) => entry.success).length
    const failed = total - success
    const successRate = total ? Math.round((success / total) * 100) : 0
    return { total, success, failed, successRate }
  }, [auditEntries])
  const executionSummary = useMemo(() => {
    const execution = lastResponse?.execution
    const executionRecord =
      execution && typeof execution === 'object' ? (execution as Record<string, unknown>) : null
    const transcript = Array.isArray(executionRecord?.transcript)
      ? executionRecord.transcript.map((item) => String(item)).slice(0, 6)
      : []
    return {
      action: String(lastResponse?.action || '-'),
      runMode: String(lastResponse?.run_mode || '-'),
      message: String(lastResponse?.message || lastResponse?.error || '-'),
      success: lastResponse?.success !== false,
      executedCommands: Number(executionRecord?.executed_commands || lastResponse?.commands || 0) || 0,
      startedAt: String(executionRecord?.started_at || ''),
      finishedAt: String(executionRecord?.finished_at || ''),
      transcript,
    }
  }, [lastResponse])
  const operationalSummaryCards = useMemo(
    () => [
      {
        id: 'olt',
        label: 'OLT activa',
        value: selectedDevice?.name || 'Sin seleccion',
        detail: selectedDevice ? `${selectedDevice.vendor.toUpperCase()} | ${selectedDevice.host || 'sin host'} | ${selectedDevice.site || 'sin sitio'}` : 'Selecciona una OLT para operar.',
        tone: 'slate' as const,
        progress: remoteOptions?.readiness?.score || 0,
      },
      {
        id: 'readiness',
        label: 'Readiness remoto',
        value: remoteOptions?.readiness?.status_label || 'Sin diagnostico',
        detail: remoteOptions?.readiness?.management_path?.label || 'Pendiente de route path',
        tone:
          remoteOptions?.readiness?.status === 'ready'
            ? ('emerald' as const)
            : remoteOptions?.readiness?.status === 'degraded'
              ? ('amber' as const)
              : ('rose' as const),
        progress: remoteOptions?.readiness?.score || 0,
      },
      {
        id: 'onu',
        label: 'Preflight ONU',
        value: `${intentLabel(onuIntent)} | ${onuPreflight.score}/100`,
        detail: onuPreflight.summary,
        tone:
          onuPreflight.status === 'ready'
            ? ('emerald' as const)
            : onuPreflight.status === 'degraded'
              ? ('amber' as const)
              : ('rose' as const),
        progress: onuPreflight.score,
      },
      {
        id: 'audit',
        label: 'Salud operativa',
        value: `${auditSummary.successRate}% exito`,
        detail: latestAuditEntry
          ? `${formatRunMode(latestAuditEntry.run_mode)} | ${latestAuditEntry.device_id} | ${latestAuditEntry.success ? 'ok' : 'error'}`
          : 'Sin ejecuciones recientes.',
        tone:
          auditSummary.failed === 0 && auditSummary.total > 0
            ? ('emerald' as const)
            : auditSummary.failed > 0
              ? ('amber' as const)
              : ('cyan' as const),
        progress: auditSummary.successRate,
      },
    ],
    [selectedDevice, remoteOptions, onuIntent, onuPreflight, auditSummary, latestAuditEntry]
  )

  const buildBasePayload = () => {
    const effectiveLineProfile = lineProfile.trim() || selectedTemplate?.line_profile || ''
    const effectiveSrvProfile = srvProfile.trim() || selectedTemplate?.srv_profile || ''
    const payload: Record<string, unknown> = {
      serial: serial.trim(),
      frame: Number(frame || 0),
      slot: Number(slot || 1),
      pon: Number(pon || 1),
      onu: Number(onu || 1),
      vlan: Number(vlan || 120),
    }
    if (effectiveLineProfile) payload.line_profile = effectiveLineProfile
    if (effectiveSrvProfile) payload.srv_profile = effectiveSrvProfile
    return payload
  }

  const withRunMode = (payload: Record<string, unknown> = {}) => {
    const merged: Record<string, unknown> = { ...payload, run_mode: runMode }
    if (runMode === 'live') {
      merged.live_confirm = liveConfirm
      merged.change_ticket = changeTicket.trim()
      merged.preflight_ack = preflightAck
    }
    return merged
  }

  const buildRunModeParams = () => {
    const params = new URLSearchParams()
    params.set('run_mode', runMode)
    if (runMode === 'live' && liveConfirm) {
      params.set('live_confirm', 'true')
      if (changeTicket.trim()) params.set('change_ticket', changeTicket.trim())
      if (preflightAck) params.set('preflight_ack', 'true')
    }
    return params
  }

  const loadCatalog = async () => {
    setLoadingCatalog(true)
    try {
      const [vendorsResp, devicesResp] = await Promise.all([
        apiClient.get('/olt/vendors') as Promise<{ vendors: OltVendor[] }>,
        apiClient.get('/olt/devices') as Promise<{ devices: OltDevice[] }>,
      ])
      const nextVendors = vendorsResp.vendors || []
      const nextDevices = devicesResp.devices || []
      setVendors(nextVendors)
      setDevices(nextDevices)

      const defaultVendor = nextVendors[0]?.id || ''
      const defaultDevice = nextDevices[0]?.id || ''
      setSelectedVendor((prev) => prev || defaultVendor)
      setSelectedDeviceId((prev) => prev || defaultDevice)
      if (!nextDevices.length) toast.error('No hay OLTs configuradas en backend')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar catalogo OLT'
      toast.error(msg)
    } finally {
      setLoadingCatalog(false)
    }
  }

  const loadAudit = async () => {
    try {
      const resp = (await apiClient.get('/olt/audit-log?limit=15')) as { entries: OltAuditEntry[] }
      setAuditEntries(resp.entries || [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar auditoria OLT'
      toast.error(msg)
    }
  }

  const loadRemoteOptions = async (deviceId: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    if (!silent) setRefreshingReadiness(true)
    try {
      const resp = (await apiClient.get(`/olt/devices/${deviceId}/remote-options`)) as OltRemoteOptions
      setRemoteOptions(resp)
    } catch (err) {
      setRemoteOptions(null)
      if (!silent) {
        const msg = err instanceof Error ? err.message : 'No se pudo cargar opciones remotas'
        toast.error(msg)
      }
    } finally {
      if (!silent) setRefreshingReadiness(false)
    }
  }

  const loadServiceTemplates = async (vendor?: string) => {
    const safeVendor = (vendor || '').trim().toLowerCase()
    if (!safeVendor) return
    try {
      const response = (await apiClient.get(`/olt/service-templates?vendor=${safeVendor}`)) as {
        templates?: OltServiceTemplate[]
      }
      setServiceTemplates((prev) => ({ ...prev, [safeVendor]: (response.templates || []) as OltServiceTemplate[] }))
    } catch {
      setServiceTemplates((prev) => ({ ...prev, [safeVendor]: [] }))
    }
  }

  useEffect(() => {
    loadCatalog()
    loadAudit()
  }, [])

  useEffect(() => {
    if (!activeVendor) return
    loadServiceTemplates(activeVendor)
  }, [activeVendor])

  useEffect(() => {
    if (!selectedTemplate) return
    if (!lineProfile.trim()) setLineProfile(selectedTemplate.line_profile || '')
    if (!srvProfile.trim()) setSrvProfile(selectedTemplate.srv_profile || '')
  }, [selectedTemplate, lineProfile, srvProfile])

  useEffect(() => {
    if (!filteredDevices.length) {
      setSelectedDeviceId('')
      return
    }
    if (!selectedDeviceId || !filteredDevices.some((d) => d.id === selectedDeviceId)) {
      setSelectedDeviceId(filteredDevices[0].id)
    }
  }, [filteredDevices, selectedDeviceId])

  useEffect(() => {
    if (!selectedDeviceId) {
      setRemoteOptions(null)
      setConnection(null)
      return
    }
    void loadRemoteOptions(selectedDeviceId)
  }, [selectedDeviceId])

  useEffect(() => {
    if (!selectedDeviceId) return
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadRemoteOptions(selectedDeviceId, { silent: true })
      }
    }, 60000)
    return () => window.clearInterval(intervalId)
  }, [selectedDeviceId])

  useEffect(() => {
    if (!deviceForm.vendor) return
    const vendor = vendors.find((v) => v.id === deviceForm.vendor)
    const suggestedTransport = vendor?.id === 'zte' ? 'telnet' : 'ssh'
    const suggestedPort = suggestedTransport === 'telnet' ? '23' : '22'
    setDeviceForm((prev) => ({ ...prev, transport: suggestedTransport, port: suggestedPort }))
  }, [deviceForm.vendor, vendors])

  const runAction = async (label: string, task: () => Promise<Record<string, unknown>>) => {
    if (!selectedDeviceId) {
      toast.error('Selecciona una OLT')
      return
    }
    if (liveModeBlocked) {
      toast.error('Confirma ejecucion live para continuar')
      return
    }

    setBusy(true)
    try {
      const response = await task()
      setLastResponse(response)
      if (response.success === false) {
        toast.error(String(response.error || response.message || `${label} con incidencias`))
      } else {
        toast.success(`${label} ejecutado`)
      }
    } catch (err) {
      if (err instanceof ApiError && err.payload && typeof err.payload === 'object') {
        setLastResponse(err.payload as Record<string, unknown>)
      }
      const msg = err instanceof Error ? err.message : `Error en ${label}`
      toast.error(msg)
    } finally {
      await Promise.all([
        loadAudit(),
        selectedDeviceId ? loadRemoteOptions(selectedDeviceId, { silent: true }) : Promise.resolve(),
      ])
      setBusy(false)
    }
  }

  const createDevice = async () => {
    if (!deviceForm.name.trim() || !deviceForm.host.trim() || !deviceForm.vendor) {
      toast.error('Completa vendor, nombre y host para crear la OLT')
      return
    }
    setSavingDevice(true)
    try {
      const payload = {
        vendor: deviceForm.vendor,
        name: deviceForm.name.trim(),
        host: deviceForm.host.trim(),
        transport: deviceForm.transport,
        port: Number(deviceForm.port || '22'),
        username: deviceForm.username.trim() || 'admin',
        model: deviceForm.model.trim() || 'N/D',
        site: deviceForm.site.trim() || 'N/D',
        password: deviceForm.password,
        enable_password: deviceForm.enable_password,
      }
      const response = (await apiClient.post('/olt/devices', payload)) as { success?: boolean; device?: OltDevice; error?: string }
      if (!response?.success || !response.device) {
        toast.error(response?.error || 'No se pudo crear la OLT')
        return
      }

      toast.success('OLT agregada correctamente')
      setDeviceForm((prev) => ({ ...prev, name: '', host: '', model: '', site: '', password: '', enable_password: '' }))
      await loadCatalog()
      setSelectedVendor(response.device.vendor)
      setSelectedDeviceId(response.device.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo crear la OLT'
      toast.error(msg)
    } finally {
      setSavingDevice(false)
    }
  }

  const removeCustomDevice = async () => {
    if (!selectedDeviceId || !selectedDevice) return
    if (selectedDevice.origin !== 'custom') {
      toast.error('Solo las OLT custom creadas desde panel se pueden eliminar aqui')
      return
    }
    try {
      await apiClient.delete(`/olt/devices/${selectedDeviceId}`)
      toast.success('OLT eliminada')
      setSelectedDeviceId('')
      await loadCatalog()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo eliminar la OLT'
      toast.error(msg)
    }
  }

  const testConnection = () =>
    runAction('Test conexion', async () => {
      const resp = (await apiClient.post('/olt/devices/test-connection', {
        device_id: selectedDeviceId,
        timeout: 2.5,
      })) as OltConnectionDiagnostics
      setConnection(resp)
      return resp as Record<string, unknown>
    })

  const refreshSnapshot = () =>
    runAction('Snapshot', async () => {
      const resp = (await apiClient.get(`/olt/devices/${selectedDeviceId}/snapshot`)) as Record<string, unknown>
      setSnapshot((resp.snapshot as Record<string, unknown>) || null)
      return resp
    })

  const discoverOnu = () =>
    runAction('Descubrir ONU', async () => {
      const params = buildRunModeParams()
      params.set('frame', frame)
      params.set('slot', slot)
      params.set('pon', pon)
      if (serial.trim()) params.set('serial', serial.trim())
      return (await apiClient.get(`/olt/devices/${selectedDeviceId}/autofind-onu?${params.toString()}`)) as Record<string, unknown>
    })

  const checkOpticalPower = () =>
    runAction('Potencia optica', async () => {
      const params = buildRunModeParams()
      params.set('frame', frame)
      params.set('slot', slot)
      params.set('pon', pon)
      params.set('onu', onu)
      return (await apiClient.get(`/olt/devices/${selectedDeviceId}/pon-power?${params.toString()}`)) as Record<string, unknown>
    })

  const runOnuAction = (action: 'authorize' | 'suspend' | 'activate' | 'reboot') =>
    runAction(`ONU ${action}`, async () => {
      setOnuIntent(action)
      const payload = withRunMode(buildBasePayload())
      const path =
        action === 'authorize'
          ? `/olt/devices/${selectedDeviceId}/authorize-onu`
          : action === 'suspend'
            ? `/olt/devices/${selectedDeviceId}/onu/suspend`
            : action === 'activate'
              ? `/olt/devices/${selectedDeviceId}/onu/activate`
              : `/olt/devices/${selectedDeviceId}/onu/reboot`
      return (await apiClient.post(path, payload)) as Record<string, unknown>
    })

  const runCustomScript = () =>
    runAction('Script OLT', async () => {
      let payload: Record<string, unknown> = {}
      if (customPayload.trim()) {
        try {
          payload = JSON.parse(customPayload)
        } catch {
          throw new Error('Payload JSON invalido para script')
        }
      }

      const generated = (await apiClient.post(`/olt/devices/${selectedDeviceId}/script/generate`, {
        action: customAction,
        payload,
      })) as { success?: boolean; commands?: string[]; error?: string }
      if (!generated?.success || !Array.isArray(generated?.commands)) {
        throw new Error(generated?.error || 'No se pudo generar script')
      }

      const executed = (await apiClient.post(`/olt/devices/${selectedDeviceId}/script/execute`, {
        commands: generated.commands,
        run_mode: runMode,
        live_confirm: runMode === 'live' ? liveConfirm : undefined,
      })) as Record<string, unknown>
      return { generated, executed }
    })

  const generateQuickScript = () =>
    runAction('Quick script', async () => {
      let payload: Record<string, unknown> = {}
      if (customPayload.trim()) {
        try {
          payload = JSON.parse(customPayload)
        } catch {
          throw new Error('Payload JSON invalido para quick script')
        }
      }

      const resp = (await apiClient.post(`/olt/devices/${selectedDeviceId}/quick-connect-script`, {
        action: customAction,
        payload,
        platform: 'windows',
      })) as { script?: string }
      setQuickScript(String(resp?.script || ''))
      return resp as Record<string, unknown>
    })

  const runTr064Probe = () =>
    runAction('TR-064 probe', async () => {
      if (!selectedDevice?.host) {
        throw new Error('La OLT seleccionada no tiene host configurado')
      }
      return (await apiClient.post('/olt/tr064/test', {
        host: selectedDevice.host,
        port: 7547,
        timeout: 2.5,
      })) as Record<string, unknown>
    })

  const copyOption = async (label: string, value?: string) => {
    const text = String(value || '').trim()
    if (!text) {
      toast.error(`No hay valor para ${label}`)
      return
    }
    const copied = await copyText(text)
    if (copied) toast.success(`${label} copiado`)
    else toast.error(`No se pudo copiar ${label}`)
  }

  const openExternal = (url?: string | null) => {
    const safeUrl = String(url || '').trim()
    if (!safeUrl) {
      toast.error('No hay URL configurada')
      return
    }
    window.open(safeUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="enterprise-dashboard space-y-6">
      <div className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-slate-950 shadow-[0_25px_80px_rgba(15,23,42,0.45)]">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.22),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.18),_transparent_28%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.96))] p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">OLT Command Center</p>
              <h2 className="mt-2 text-3xl font-semibold text-white">Panel profesional para operacion OLT y ONUs</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Consola unificada para reachability, preflight ONU, ejecucion controlada y trazabilidad operativa.
                La idea es que el operador vea en segundos si la OLT esta lista, cual es la ruta sugerida y que riesgo
                tiene la siguiente accion.
              </p>
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-2 xl:w-[26rem]">
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">OLT actual</p>
                <p className="mt-2 text-base font-semibold text-white">{selectedDevice?.name || 'Sin seleccion'}</p>
                <p className="mt-1 text-slate-300">{selectedDevice?.host || 'Define una OLT para continuar'}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Ruta de gestion</p>
                <p className="mt-2 text-base font-semibold text-white">
                  {remoteOptions?.readiness?.management_path?.label || connection?.management_path?.label || 'Pendiente'}
                </p>
                <p className="mt-1 text-slate-300">
                  {remoteOptions?.readiness?.host_analysis?.label || connection?.host_analysis?.label || 'Sin clasificar'}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Modo activo</p>
                <p className="mt-2 text-base font-semibold text-white">{formatRunMode(runMode)}</p>
                <p className="mt-1 text-slate-300">
                  {runMode === 'live' ? 'Cambio real con guardrails activos.' : 'Validacion segura antes de live.'}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Ultimo check</p>
                <p className="mt-2 text-base font-semibold text-white">
                  {formatCheckedAt(remoteOptions?.readiness?.checked_at || connection?.checked_at)}
                </p>
                <p className="mt-1 text-slate-300">
                  {remoteOptions?.readiness?.summary || connection?.summary || 'Ejecuta test de conexion para poblar diagnostico.'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {operationalSummaryCards.map((card) => (
              <div key={card.id} className={`rounded-2xl border px-4 py-4 ${toneCardClass(card.tone)}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-300/90">{card.label}</p>
                  <span className="rounded-full bg-slate-950/40 px-2 py-1 text-[10px] font-semibold text-white/90">
                    {Math.max(0, Math.min(100, Math.round(card.progress)))}%
                  </span>
                </div>
                <p className="mt-3 text-lg font-semibold text-white">{card.value}</p>
                <p className="mt-1 min-h-[2.5rem] text-sm text-slate-200/90">{card.detail}</p>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-950/50">
                  <div
                    className={`h-full rounded-full transition-all ${toneProgressClass(card.tone)}`}
                    style={{ width: `${Math.max(4, Math.min(100, Math.round(card.progress)))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
        <h3 className="text-lg font-semibold text-white">Alta OLT rapida</h3>
        <p className="mt-1 text-xs text-slate-300">
          Registra nuevas OLT para gestion desde VPS y pruebas remotas. Para conexion live, usa ACL y VPN privada.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-5">
          <select
            value={deviceForm.vendor}
            onChange={(e) => setDeviceForm((prev) => ({ ...prev, vendor: e.target.value }))}
            className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          >
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.label}
              </option>
            ))}
          </select>
          <input
            value={deviceForm.name}
            onChange={(e) => setDeviceForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Nombre OLT"
            className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          />
          <input
            value={deviceForm.host}
            onChange={(e) => setDeviceForm((prev) => ({ ...prev, host: e.target.value }))}
            placeholder="Host/IP"
            className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          />
          <select
            value={deviceForm.transport}
            onChange={(e) => setDeviceForm((prev) => ({ ...prev, transport: e.target.value }))}
            className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          >
            <option value="ssh">ssh</option>
            <option value="telnet">telnet</option>
          </select>
          <div className="flex gap-2">
            <input
              value={deviceForm.port}
              onChange={(e) => setDeviceForm((prev) => ({ ...prev, port: e.target.value }))}
              placeholder="Puerto"
              className="w-24 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            />
            <button
              onClick={createDevice}
              disabled={savingDevice}
              className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60"
            >
              {savingDevice ? 'Guardando...' : 'Agregar'}
            </button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-5">
          <input
            value={deviceForm.username}
            onChange={(e) => setDeviceForm((prev) => ({ ...prev, username: e.target.value }))}
            placeholder="Usuario"
            className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          />
          <input
            value={deviceForm.model}
            onChange={(e) => setDeviceForm((prev) => ({ ...prev, model: e.target.value }))}
            placeholder="Modelo"
            className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          />
          <input
            value={deviceForm.site}
            onChange={(e) => setDeviceForm((prev) => ({ ...prev, site: e.target.value }))}
            placeholder="Sitio"
            className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          />
          <input
            type="password"
            value={deviceForm.password}
            onChange={(e) => setDeviceForm((prev) => ({ ...prev, password: e.target.value }))}
            placeholder="Password (opcional)"
            className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          />
          <input
            type="password"
            value={deviceForm.enable_password}
            onChange={(e) => setDeviceForm((prev) => ({ ...prev, enable_password: e.target.value }))}
            placeholder="Enable pass (opcional)"
            className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
          <label className="text-xs text-slate-300">Vendor</label>
          <select
            value={selectedVendor}
            onChange={(e) => setSelectedVendor(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          >
            {!vendors.length && <option value="">Sin vendors</option>}
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
          <label className="text-xs text-slate-300">OLT</label>
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          >
            {!filteredDevices.length && <option value="">Sin OLTs</option>}
            {filteredDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-400">
            {selectedDevice?.host || '-'} | {selectedDevice?.transport || '-'} | {selectedDevice?.site || '-'}
          </p>
          {selectedDevice && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-1 font-semibold ${statusPillClass(remoteOptions?.readiness?.status)}`}>
                {remoteOptions?.readiness?.status_label || 'sin diagnostico'}
              </span>
              <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">
                score {Math.max(0, Math.min(100, Math.round(remoteOptions?.readiness?.score || 0)))}
              </span>
            </div>
          )}
          {!!remoteOptions?.readiness?.checked_at && (
            <p className="mt-1 text-[11px] text-slate-400">
              ultimo check {formatCheckedAt(remoteOptions.readiness.checked_at)}
            </p>
          )}
          {!!selectedDevice?.origin && (
            <p className="mt-1 text-xs text-cyan-300">
              origen: {selectedDevice.origin}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
          <label className="text-xs text-slate-300">Modo de ejecucion</label>
          <select
            value={runMode}
            onChange={(e) => setRunMode(e.target.value as RunMode)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          >
            <option value="simulate">simulate</option>
            <option value="dry-run">dry-run</option>
            <option value="live">live</option>
          </select>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={liveConfirm}
              onChange={(e) => setLiveConfirm(e.target.checked)}
            />
            Confirmar ejecucion live
          </label>
          {runMode === 'live' && (
            <>
              <input
                value={changeTicket}
                onChange={(e) => setChangeTicket(e.target.value)}
                placeholder="Ticket de cambio (ej. CHG-2026-001)"
                className="mt-2 w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
              />
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={preflightAck}
                  onChange={(e) => setPreflightAck(e.target.checked)}
                />
                Preflight revisado y aprobado
              </label>
            </>
          )}
        </div>

        <div className="flex flex-col justify-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 p-4">
          <button
            onClick={loadCatalog}
            disabled={loadingCatalog || busy}
            className="w-full rounded-lg bg-cyan-500 px-3 py-2 font-semibold text-slate-900 disabled:opacity-60"
          >
            {loadingCatalog ? 'Cargando...' : 'Recargar catalogo'}
          </button>
          <button
            onClick={loadAudit}
            disabled={busy}
            className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-slate-100 disabled:opacity-60"
          >
            Recargar auditoria
          </button>
          <button
            onClick={removeCustomDevice}
            disabled={busy || !selectedDevice || selectedDevice.origin !== 'custom'}
            className="w-full rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-2 text-rose-200 disabled:opacity-50"
          >
            Eliminar OLT custom
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-white/10 bg-slate-900/70 p-5">
          <h3 className="text-lg font-semibold text-white">Operaciones ONU</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Serial ONU" className="col-span-2 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
            <input value={frame} onChange={(e) => setFrame(e.target.value)} placeholder="Frame" className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
            <input value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="Slot" className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
            <input value={pon} onChange={(e) => setPon(e.target.value)} placeholder="PON" className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
            <input value={onu} onChange={(e) => setOnu(e.target.value)} placeholder="ONU ID" className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
            <input value={vlan} onChange={(e) => setVlan(e.target.value)} placeholder="VLAN" className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="col-span-2 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Template de servicio (opcional)</option>
              {templateOptions.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label} ({template.origin || 'default'})
                </option>
              ))}
            </select>
            <input value={lineProfile} onChange={(e) => setLineProfile(e.target.value)} placeholder="Line profile" className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
            <input value={srvProfile} onChange={(e) => setSrvProfile(e.target.value)} placeholder="Srv profile" className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
          </div>

          <div className="rounded-lg border border-white/10 bg-slate-800/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-300">Preflight ONU</p>
                <p className="mt-1 text-xs text-slate-400">Semaforo para validar la siguiente operacion antes de ejecutar cambios.</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={onuIntent}
                  onChange={(e) => setOnuIntent(e.target.value as OltActionIntent)}
                  className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-100"
                >
                  <option value="authorize">Autorizar</option>
                  <option value="suspend">Suspender</option>
                  <option value="activate">Activar</option>
                  <option value="reboot">Reiniciar</option>
                </select>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusPillClass(onuPreflight.status)}`}>
                  {onuPreflight.status} {onuPreflight.score}/100
                </span>
              </div>
            </div>

            <p className="mt-3 text-sm text-slate-100">{onuPreflight.summary}</p>

            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {onuPreflight.checks.map((check) => (
                <div key={check.id} className="rounded border border-white/10 bg-slate-900/50 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-100">{check.label}</span>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${checkPillClass(check.ok, check.severity)}`}>
                      {check.ok ? 'ok' : check.severity || 'warn'}
                    </span>
                  </div>
                  {!!check.detail && <p className="mt-1 text-slate-400">{check.detail}</p>}
                </div>
              ))}
            </div>

            {!!onuPreflight.missing.length && (
              <div className="mt-3 rounded border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-100">
                <p className="font-semibold uppercase text-amber-200">Pendientes</p>
                <ul className="mt-2 space-y-1">
                  {onuPreflight.missing.map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="mt-3 space-y-1 text-xs text-slate-300">
              {onuPreflight.recommendations.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <button onClick={discoverOnu} disabled={busy} className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100 disabled:opacity-60">Autofind</button>
            <button onClick={checkOpticalPower} disabled={busy} className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100 disabled:opacity-60">Potencia</button>
            <button onClick={runTr064Probe} disabled={busy} className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100 disabled:opacity-60">TR-064</button>
            <button onClick={refreshSnapshot} disabled={busy} className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100 disabled:opacity-60">Snapshot</button>
            <button onClick={testConnection} disabled={busy} className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60">Test conexion</button>
            <button onClick={() => runOnuAction('authorize')} disabled={busy} className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60">Autorizar</button>
            <button onClick={() => runOnuAction('suspend')} disabled={busy} className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60">Suspender</button>
            <button onClick={() => runOnuAction('activate')} disabled={busy} className="rounded-lg bg-green-500 px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60">Activar</button>
            <button onClick={() => runOnuAction('reboot')} disabled={busy} className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Reiniciar ONU</button>
          </div>

          {liveModeBlocked && (
            <p className="text-xs text-amber-300">
              Modo live activo: requiere confirmacion, ticket de cambio y preflight aprobado.
            </p>
          )}
        </div>

        <div className="space-y-4 rounded-xl border border-white/10 bg-slate-900/70 p-5">
          <h3 className="text-lg font-semibold text-white">Scripts y acceso remoto OLT</h3>
          <select
            value={customAction}
            onChange={(e) => setCustomAction(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
          >
            {(selectedVendorData?.actions || ['show_pon_summary']).map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
          <textarea
            value={customPayload}
            onChange={(e) => setCustomPayload(e.target.value)}
            rows={7}
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs font-mono text-slate-100"
          />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={runCustomScript} disabled={busy} className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60">
              Generar + Ejecutar
            </button>
            <button onClick={generateQuickScript} disabled={busy} className="rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100 disabled:opacity-60">
              Quick script
            </button>
          </div>

          {!!quickScript && <pre className="max-h-44 overflow-auto rounded-lg p-3 text-xs">{quickScript}</pre>}

          <div className="space-y-2 rounded-lg border border-white/10 bg-slate-800/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase text-slate-300">Conectividad remota</p>
              <button
                onClick={() => selectedDeviceId && loadRemoteOptions(selectedDeviceId)}
                disabled={busy || refreshingReadiness || !selectedDeviceId}
                className="rounded bg-slate-700 px-2 py-1 text-[10px] text-slate-100 disabled:opacity-50"
              >
                {refreshingReadiness ? 'Actualizando...' : 'Refrescar readiness'}
              </button>
            </div>
            {typeof remoteOptions?.readiness?.score === 'number' && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-1 font-semibold ${statusPillClass(remoteOptions?.readiness?.status)}`}>
                  {remoteOptions?.readiness?.status_label || remoteOptions?.readiness?.status || 'sin estado'}
                </span>
                <span className="rounded-full bg-cyan-500/20 px-2 py-1 font-semibold text-cyan-200">
                  readiness {Math.max(0, Math.min(100, Math.round(remoteOptions.readiness.score)))} / 100
                </span>
                {!!remoteOptions?.readiness?.missing?.length && (
                  <span className="rounded-full bg-amber-500/20 px-2 py-1 font-semibold text-amber-200">
                    faltantes {remoteOptions.readiness.missing.length}
                  </span>
                )}
              </div>
            )}
            <p className="text-sm text-slate-100">
              {remoteOptions?.readiness?.summary || 'Cargando diagnostico de reachability OLT.'}
            </p>
            <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
              <div className="rounded border border-white/10 bg-slate-900/50 px-3 py-2">
                <p className="font-semibold text-slate-100">Ruta sugerida</p>
                <p className="mt-1 text-slate-300">{remoteOptions?.readiness?.management_path?.label || '-'}</p>
              </div>
              <div className="rounded border border-white/10 bg-slate-900/50 px-3 py-2">
                <p className="font-semibold text-slate-100">Tipo de host</p>
                <p className="mt-1 text-slate-300">{remoteOptions?.readiness?.host_analysis?.label || '-'}</p>
                {!!remoteOptions?.readiness?.host_analysis?.detail && (
                  <p className="mt-1 text-slate-400">{remoteOptions.readiness.host_analysis.detail}</p>
                )}
              </div>
            </div>
            {!!remoteOptions?.readiness?.checked_at && (
              <p className="text-[11px] text-slate-400">
                ultimo check {formatCheckedAt(remoteOptions.readiness.checked_at)}
              </p>
            )}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <code className="truncate text-slate-100">{remoteOptions?.options?.direct_login || '-'}</code>
                <button onClick={() => copyOption('login directo', remoteOptions?.options?.direct_login)} className="rounded bg-slate-700 px-2 py-1 text-[10px] text-slate-100">Copiar</button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <code className="truncate text-slate-100">{remoteOptions?.options?.jump_host_ssh || '-'}</code>
                <button onClick={() => copyOption('jump host', remoteOptions?.options?.jump_host_ssh)} className="rounded bg-slate-700 px-2 py-1 text-[10px] text-slate-100">Copiar</button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <code className="truncate text-slate-100">{remoteOptions?.options?.reverse_tunnel_template || '-'}</code>
                <button onClick={() => copyOption('reverse tunnel', remoteOptions?.options?.reverse_tunnel_template)} className="rounded bg-slate-700 px-2 py-1 text-[10px] text-slate-100">Copiar</button>
              </div>
            </div>
            {(remoteOptions?.readiness?.checks || []).length > 0 && (
              <div className="space-y-1 text-xs">
                {(remoteOptions?.readiness?.checks || []).map((check) => (
                  <div key={check.id} className="rounded border border-white/10 bg-slate-900/50 px-2 py-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-100">{check.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${checkPillClass(check.ok, check.severity)}`}>
                        {check.ok ? 'ok' : check.severity || 'warn'}
                      </span>
                    </div>
                    {!!check.detail && <p className="mt-1 text-slate-400">{check.detail}</p>}
                  </div>
                ))}
              </div>
            )}
            {(remoteOptions?.readiness?.recommendations || []).length > 0 && (
              <ul className="space-y-1 text-xs text-slate-300">
                {(remoteOptions?.readiness?.recommendations || []).map((recommendation, idx) => (
                  <li key={idx}>- {recommendation}</li>
                ))}
              </ul>
            )}
            {(remoteOptions?.readiness?.missing || []).length > 0 && (
              <ul className="space-y-1 text-xs text-amber-200">
                {(remoteOptions?.readiness?.missing || []).map((item, idx) => (
                  <li key={idx}>- {item}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-white/10 bg-slate-800/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase text-slate-300">Grafana readiness</p>
              <div className="flex gap-2">
                <button
                  onClick={() => copyOption('grafana health', remoteOptions?.grafana?.health_url || '')}
                  className="rounded bg-slate-700 px-2 py-1 text-[10px] text-slate-100"
                >
                  Copiar health URL
                </button>
                <button
                  onClick={() => openExternal(remoteOptions?.grafana?.dashboard_url || '')}
                  className="rounded bg-cyan-500 px-2 py-1 text-[10px] font-semibold text-slate-900"
                >
                  Abrir Grafana
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-1 font-semibold ${
                  remoteOptions?.grafana?.configured ? 'bg-cyan-500/20 text-cyan-200' : 'bg-amber-500/20 text-amber-200'
                }`}
              >
                {remoteOptions?.grafana?.configured ? 'configurado' : 'sin configurar'}
              </span>
              {remoteOptions?.grafana?.reachable === true && (
                <span className="rounded-full bg-emerald-500/20 px-2 py-1 font-semibold text-emerald-300">
                  reachable {remoteOptions?.grafana?.status_code || 200}
                </span>
              )}
              {remoteOptions?.grafana?.reachable === false && (
                <span className="rounded-full bg-rose-500/20 px-2 py-1 font-semibold text-rose-300">
                  unreachable
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300">
              Dashboard: <code>{remoteOptions?.grafana?.dashboard_url || '-'}</code>
            </p>
            <p className="text-xs text-slate-300">
              Health: <code>{remoteOptions?.grafana?.health_url || '-'}</code>
            </p>
            {!!remoteOptions?.grafana?.datasource_uid && (
              <p className="text-xs text-slate-300">
                Datasource UID: <code>{remoteOptions.grafana.datasource_uid}</code>
              </p>
            )}
            {!!remoteOptions?.grafana?.error && (
              <p className="text-xs text-amber-300">Detalle: {remoteOptions.grafana.error}</p>
            )}
            {(remoteOptions?.grafana?.recommendations || []).length > 0 && (
              <ul className="space-y-1 text-xs text-slate-300">
                {(remoteOptions?.grafana?.recommendations || []).map((item, idx) => (
                  <li key={idx}>- {item}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-white/10 bg-slate-900/70 p-5">
          <h3 className="text-lg font-semibold text-white">Estado actual</h3>
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-slate-800/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs uppercase text-slate-300">Conexion</p>
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusPillClass(connection?.status)}`}>
                  {connection?.status_label || connection?.status || 'sin prueba'}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-100">
                {connection?.summary || 'Ejecuta "Test conexion" para obtener diagnostico completo de la OLT.'}
              </p>
              <div className="mt-3 space-y-1 text-xs text-slate-300">
                <p>Ruta sugerida: <span className="text-slate-100">{connection?.management_path?.label || '-'}</span></p>
                <p>Host: <span className="text-slate-100">{connection?.host_analysis?.label || '-'}</span></p>
                <p>Mensaje: <span className="text-slate-100">{connection?.connection?.message || '-'}</span></p>
                {typeof connection?.connection?.latency_ms === 'number' && (
                  <p>Latencia: <span className="text-slate-100">{connection.connection.latency_ms} ms</span></p>
                )}
                {!!connection?.next_step && <p>Siguiente paso: <span className="text-amber-200">{connection.next_step}</span></p>}
                {!!connection?.connection?.error && <p className="text-rose-300">Detalle: {connection.connection.error}</p>}
              </div>
              {!!connection?.recommendations?.length && (
                <ul className="mt-3 space-y-1 text-xs text-slate-300">
                  {connection.recommendations.slice(0, 3).map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
              )}
              <details className="mt-3 rounded border border-white/10 bg-slate-950/60 p-2 text-xs text-slate-300">
                <summary className="cursor-pointer font-semibold text-slate-100">Ver JSON de conexion</summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded p-2 text-xs">{JSON.stringify(connection, null, 2)}</pre>
              </details>
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-800/70 p-3">
              <p className="text-xs uppercase text-slate-300">Snapshot</p>
              {snapshotData ? (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded border border-white/10 bg-slate-900/50 px-3 py-2">
                      <p className="text-slate-400">ONU online</p>
                      <p className="mt-1 text-lg font-semibold text-emerald-300">{snapshotData.onu_online ?? '-'}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-slate-900/50 px-3 py-2">
                      <p className="text-slate-400">ONU offline</p>
                      <p className="mt-1 text-lg font-semibold text-rose-300">{snapshotData.onu_offline ?? '-'}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-slate-900/50 px-3 py-2">
                      <p className="text-slate-400">PON alertas</p>
                      <p className="mt-1 text-lg font-semibold text-amber-300">{snapshotData.pon_alert ?? '-'}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-slate-900/50 px-3 py-2">
                      <p className="text-slate-400">CPU / RAM</p>
                      <p className="mt-1 text-lg font-semibold text-cyan-300">
                        {snapshotData.cpu_load ?? '-'}% / {snapshotData.memory_usage ?? '-'}%
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">
                    generado {formatIsoDate(snapshotData.generated_at)} | temperatura {snapshotData.temperature_c ?? '-'} C
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-300">Aun no hay snapshot. Ejecuta la accion para poblar telemetria operativa.</p>
              )}
              <details className="mt-3 rounded border border-white/10 bg-slate-950/60 p-2 text-xs text-slate-300">
                <summary className="cursor-pointer font-semibold text-slate-100">Ver JSON de snapshot</summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded p-2 text-xs">{JSON.stringify(snapshot, null, 2)}</pre>
              </details>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-slate-800/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs uppercase text-slate-300">Ultima ejecucion</p>
              <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${lastResponse?.success === false ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                {lastResponse ? (lastResponse?.success === false ? 'con error' : 'ok') : 'sin datos'}
              </span>
            </div>
            <div className="mt-2 space-y-1 text-xs text-slate-300">
              <p>Accion: <span className="text-slate-100">{executionSummary.action}</span></p>
              <p>Modo: <span className="text-slate-100">{executionSummary.runMode}</span></p>
              <p>Comandos: <span className="text-slate-100">{executionSummary.executedCommands}</span></p>
              <p>Inicio: <span className="text-slate-100">{formatIsoDate(executionSummary.startedAt)}</span></p>
              <p>Fin: <span className="text-slate-100">{formatIsoDate(executionSummary.finishedAt)}</span></p>
              <p>Mensaje: <span className="text-slate-100">{executionSummary.message}</span></p>
            </div>
            {!!executionSummary.transcript.length && (
              <div className="mt-3 rounded border border-white/10 bg-slate-950/60 p-3">
                <p className="text-xs font-semibold uppercase text-slate-300">Preview transcript</p>
                <div className="mt-2 space-y-1 font-mono text-xs text-slate-200">
                  {executionSummary.transcript.map((line, index) => (
                    <p key={`${index}-${line}`}>{line}</p>
                  ))}
                </div>
              </div>
            )}
            <details className="mt-3 rounded border border-white/10 bg-slate-950/60 p-2 text-xs text-slate-300">
              <summary className="cursor-pointer font-semibold text-slate-100">Ver respuesta completa</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded p-2 text-xs">{JSON.stringify(lastResponse, null, 2)}</pre>
            </details>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
          <h3 className="mb-3 text-lg font-semibold text-white">Auditoria OLT</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-slate-100">
              <thead className="border-b border-white/10 text-xs text-slate-300">
                <tr>
                  <th className="py-2 text-left">Dispositivo</th>
                  <th className="py-2 text-left">Modo</th>
                  <th className="py-2 text-left">Comandos</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-left">Inicio</th>
                </tr>
              </thead>
              <tbody>
                {auditEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-white/5">
                    <td className="py-2">{entry.device_id}</td>
                    <td className="py-2">{entry.run_mode}</td>
                    <td className="py-2">{entry.commands}</td>
                    <td className="py-2">
                      <span className={entry.success ? 'text-emerald-300' : 'text-rose-300'}>
                        {entry.success ? 'ok' : 'error'}
                      </span>
                    </td>
                    <td className="py-2">{entry.started_at?.replace('T', ' ').slice(0, 19)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!auditEntries.length && <p className="mt-3 text-sm text-slate-300">Sin registros aun.</p>}
        </div>
      </div>
    </div>
  )
}

export default OltManagement
