import { RouterConnectionDiagnosticsPayload, RouterSnmpProfilePayload, RouterSnmpFormState } from './types'

export const resolveConnectionFeedback = (
  payload: { diagnostics?: RouterConnectionDiagnosticsPayload | null; error?: string | null } | null | undefined,
  fallback: string
) => {
  const summary = String(payload?.diagnostics?.summary || '').trim()
  if (summary) return summary
  const error = String(payload?.error || '').trim()
  return error || fallback
}

export const describeHostScope = (scope?: string) => {
  if (scope === 'private') return 'IP privada'
  if (scope === 'public') return 'IP publica'
  if (scope === 'hostname') return 'hostname'
  if (scope === 'link_local') return 'link-local'
  if (scope === 'loopback') return 'loopback'
  return 'sin clasificar'
}

export const buildConnectionStatusKey = (diagnostics?: RouterConnectionDiagnosticsPayload | null) => {
  if (!diagnostics) return 'unknown'
  if (diagnostics.success) return 'connected'
  return String(diagnostics.status || 'failed')
}

export const getConnectionStatusLabel = (diagnostics?: RouterConnectionDiagnosticsPayload | null) => {
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

export const getConnectionStatusTone = (diagnostics?: RouterConnectionDiagnosticsPayload | null) => {
  if (!diagnostics) return 'bg-slate-500/10 text-slate-500 border border-slate-500/20'
  return diagnostics.success 
    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
}

export const formatConnectionCheckedAt = (checkedAt?: number) => {
  if (!checkedAt) return 'sin chequeo'
  return new Date(checkedAt).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const copyToClipboard = async (value: string): Promise<boolean> => {
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

export const normalizeUiError = (error: unknown, fallback: string): string => {
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

export const readSnmpMetricSpec = (
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

export const buildSnmpFormFromProfile = (profile?: RouterSnmpProfilePayload | null): RouterSnmpFormState => {
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

export const buildSnmpPayloadFromForm = (form: RouterSnmpFormState): RouterSnmpProfilePayload => {
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

export const formatSnmpMetric = (value: unknown, suffix = ''): string => {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'number') return `${value}${suffix}`
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return `${numeric}${suffix}`
  return String(value)
}

export const resolveQuickScript = (scripts: any, key: string): string => {
  if (!scripts || !key) return ''
  return String(scripts[key] || '')
}
