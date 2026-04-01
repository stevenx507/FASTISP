import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

interface SystemSettingsPayload {
  portal_maintenance_mode: boolean
  auto_suspend_overdue: boolean
  notifications_push_enabled: boolean
  notifications_email_enabled: boolean
  allow_self_signup: boolean
  change_control_required_for_live: boolean
  require_preflight_for_live: boolean
  admin_mfa_required: boolean
  default_ticket_priority: string
  backup_retention_days: number
  metrics_poll_interval_sec: number
  password_policy_min_length: number
  backup_restore_drill_days: number
  slo_router_availability_target: number
  slo_ticket_sla_target: number
  slo_provision_success_target: number
}

interface SystemHealth {
  routers_up: number
  routers_down: number
  tickets_open: number
  timestamp: string
}

interface JobEntry {
  id: string
  job: string
  status: string
  requested_by?: number | null
  started_at: string
  finished_at?: string
  result?: Record<string, unknown>
}

interface OpsPreflightResponse {
  score: number
  checks: Array<{ id: string; ok: boolean; detail: string; severity?: string }>
  blockers: Array<{ id: string; detail: string }>
}

interface OpsSloResponse {
  score: number
  metrics: {
    router_availability: number
    ticket_sla: number
    provision_success: number
  }
  targets: {
    router_availability: number
    ticket_sla: number
    provision_success: number
  }
}

interface OpsSop {
  id: string
  title: string
  category?: string
  owner_role?: string
  checklist?: Array<{ id?: string; label?: string; required?: boolean }>
}

interface OpsChangeRequest {
  id: string
  title: string
  status: string
  scope?: string
  ticket_ref?: string
  window_start?: string | null
  window_end?: string | null
}

interface OpsCollectionsSummary {
  subscriptions?: { active?: number; past_due?: number; suspended?: number }
  invoices?: { pending?: number; paid?: number; cancelled?: number }
  promises?: { pending?: number; kept?: number; broken?: number; cancelled?: number }
}

interface OpsSupportSlaSummary {
  open?: number
  overdue?: number
  due_soon_4h?: number
  sla_compliance_estimate?: number
}

const jobs = ['backup', 'cleanup_leases', 'enforce_billing', 'rotate_passwords', 'recalc_balances', 'backup_restore_drill'] as const
const jobStatuses = ['all', 'completed', 'completed_with_errors', 'skipped', 'failed'] as const

const SystemSettings: React.FC = () => {
  const [settings, setSettings] = useState<SystemSettingsPayload | null>(null)
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [jobHistory, setJobHistory] = useState<JobEntry[]>([])
  const [preflight, setPreflight] = useState<OpsPreflightResponse | null>(null)
  const [slo, setSlo] = useState<OpsSloResponse | null>(null)
  const [sops, setSops] = useState<OpsSop[]>([])
  const [changeRequests, setChangeRequests] = useState<OpsChangeRequest[]>([])
  const [newChangeTitle, setNewChangeTitle] = useState('')
  const [newChangeTicket, setNewChangeTicket] = useState('')
  const [creatingChange, setCreatingChange] = useState(false)
  const [collections, setCollections] = useState<OpsCollectionsSummary | null>(null)
  const [supportSla, setSupportSla] = useState<OpsSupportSlaSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [runningJob, setRunningJob] = useState<string | null>(null)
  const [jobStatusFilter, setJobStatusFilter] = useState<(typeof jobStatuses)[number]>('all')
  const [jobTypeFilter, setJobTypeFilter] = useState<'all' | (typeof jobs)[number]>('all')

  const loadJobHistory = useCallback(async (
    status: (typeof jobStatuses)[number] = jobStatusFilter,
    job: 'all' | (typeof jobs)[number] = jobTypeFilter,
  ) => {
    const params = new URLSearchParams({ limit: '50' })
    if (status !== 'all') params.set('status', status)
    if (job !== 'all') params.set('job', job)
    const history = await apiClient.get(`/admin/system/jobs/history?${params.toString()}`) as { items?: JobEntry[] }
    setJobHistory((history.items || []) as JobEntry[])
  }, [jobStatusFilter, jobTypeFilter])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [response, preflightResp, sloResp, sopsResp, changesResp, collectionsResp, supportResp] = await Promise.all([
        apiClient.get('/admin/system/settings'),
        apiClient.get('/admin/ops/preflight/summary').catch(() => null),
        apiClient.get('/admin/ops/slo-summary').catch(() => null),
        apiClient.get('/admin/ops/sops').catch(() => null),
        apiClient.get('/admin/ops/change-requests').catch(() => null),
        apiClient.get('/admin/ops/collections-summary').catch(() => null),
        apiClient.get('/admin/ops/support-sla-summary').catch(() => null),
      ])
      setSettings((response.settings || null) as SystemSettingsPayload | null)
      setHealth((response.health || null) as SystemHealth | null)
      setPreflight((preflightResp || null) as OpsPreflightResponse | null)
      setSlo((sloResp || null) as OpsSloResponse | null)
      setSops(((sopsResp?.items || []) as OpsSop[]).slice(0, 50))
      setChangeRequests(((changesResp?.items || []) as OpsChangeRequest[]).slice(0, 200))
      setCollections((collectionsResp || null) as OpsCollectionsSummary | null)
      setSupportSla((supportResp || null) as OpsSupportSlaSummary | null)
      await loadJobHistory()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar ajustes del sistema'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [loadJobHistory])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadJobHistory().catch((err) => {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar historial de jobs'
      toast.error(msg)
    })
  }, [loadJobHistory])

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const response = await apiClient.post('/admin/system/settings', { settings })
      setSettings((response.settings || settings) as SystemSettingsPayload)
      toast.success('Ajustes guardados')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron guardar ajustes'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const runJob = async (job: (typeof jobs)[number]) => {
    setRunningJob(job)
    try {
      const response = await apiClient.post('/admin/system/jobs/run', { job })
      const completedJob = response.job as JobEntry
      setJobHistory((prev) => [completedJob, ...prev.filter((item) => item.id !== completedJob.id)])
      await loadJobHistory()
      const status = String(completedJob.status || 'completed')
      const human = status === 'completed_with_errors' ? 'completado con errores' : status
      toast.success(`Job ${job}: ${human}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : `No se pudo ejecutar ${job}`
      toast.error(msg)
    } finally {
      setRunningJob(null)
    }
  }

  const createChangeRequest = async () => {
    const title = newChangeTitle.trim()
    if (!title) {
      toast.error('Ingresa titulo del cambio')
      return
    }
    setCreatingChange(true)
    try {
      const now = new Date()
      const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000)
      const response = await apiClient.post('/admin/ops/change-requests', {
        title,
        ticket_ref: newChangeTicket.trim(),
        scope: 'network',
        risk_level: 'medium',
        window_start: now.toISOString(),
        window_end: inTwoHours.toISOString(),
        status: 'requested',
      }) as { item?: OpsChangeRequest }
      if (response?.item) {
        setChangeRequests((prev) => [response.item as OpsChangeRequest, ...prev])
      }
      setNewChangeTitle('')
      setNewChangeTicket('')
      toast.success('Cambio registrado')
      await load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo registrar cambio'
      toast.error(msg)
    } finally {
      setCreatingChange(false)
    }
  }

  const updateChangeStatus = async (changeId: string, status: string) => {
    try {
      const response = await apiClient.patch(`/admin/ops/change-requests/${changeId}`, { status }) as { item?: OpsChangeRequest }
      if (response?.item) {
        setChangeRequests((prev) => prev.map((item) => (item.id === changeId ? (response.item as OpsChangeRequest) : item)))
      }
      toast.success(`Cambio ${status}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar cambio'
      toast.error(msg)
    }
  }

  const dangerLevel = useMemo(() => {
    if (!health) return 'ok'
    if (health.routers_down >= 3 || health.tickets_open >= 20) return 'critical'
    if (health.routers_down > 0 || health.tickets_open >= 8) return 'warning'
    return 'ok'
  }, [health])

  const renderJobResult = (job: JobEntry) => {
    const result = job.result || {}
    if (job.job === 'rotate_passwords') {
      const rotated = Number(result.rotated || 0)
      const failed = Number(result.failed || 0)
      const dryRun = Boolean(result.dry_run)
      return `${dryRun ? 'dry-run' : 'rotados'}: ${rotated}, fallidos: ${failed}`
    }
    if (job.job === 'recalc_balances') {
      const updated = Number(result.updated || 0)
      const scanned = Number(result.scanned || 0)
      return `facturas actualizadas: ${updated}/${scanned}`
    }
    if (job.job === 'cleanup_leases') {
      const changed = Number(result.count || 0)
      return `suscripciones cambiadas: ${changed}`
    }
    if (job.job === 'enforce_billing') {
      if (result.auto_suspend_overdue === false) {
        return String(result.message || 'job omitido por configuracion')
      }
      const scanned = Number(result.scanned || 0)
      const updated = Number(result.updated || 0)
      const failed = Number(result.failed || 0)
      return `subs: ${updated}/${scanned}, errores: ${failed}`
    }
    if (job.job === 'backup') {
      const dbBackup = result.pg_dump
      if (typeof dbBackup === 'string' && dbBackup.length > 0) {
        return `db: ${dbBackup}`
      }
    }
    if (job.job === 'backup_restore_drill') {
      const passed = Boolean(result.passed)
      const checks = Array.isArray(result.checks) ? result.checks.length : 0
      return `drill ${passed ? 'ok' : 'con alertas'} | checks: ${checks}`
    }
    if (typeof result.message === 'string' && result.message) {
      return result.message
    }
    return ''
  }

  const statusBadgeClass = (status: string) => {
    if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    if (status === 'skipped') return 'border-slate-200 bg-slate-50 text-slate-700'
    if (status === 'completed_with_errors') return 'border-amber-200 bg-amber-50 text-amber-700'
    return 'border-red-200 bg-red-50 text-red-700'
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Sistema</h2>
          <p className="text-sm text-gray-600">Parametros operativos, jobs administrativos y salud general.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={!settings || saving}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase text-emerald-700">Routers UP</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">{health?.routers_up ?? 0}</p>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-4">
          <p className="text-xs font-semibold uppercase text-red-700">Routers DOWN</p>
          <p className="mt-2 text-2xl font-bold text-red-900">{health?.routers_down ?? 0}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase text-amber-700">Tickets Open</p>
          <p className="mt-2 text-2xl font-bold text-amber-900">{health?.tickets_open ?? 0}</p>
        </div>
        <div
          className={`rounded-xl p-4 ${
            dangerLevel === 'critical'
              ? 'border border-red-200 bg-red-50'
              : dangerLevel === 'warning'
                ? 'border border-amber-200 bg-amber-50'
                : 'border border-emerald-200 bg-emerald-50'
          }`}
        >
          <p className="text-xs font-semibold uppercase text-gray-700">Estado</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{dangerLevel}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Preflight Operativo</h3>
          <div className="mt-3 flex items-center gap-3">
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
              score {preflight?.score ?? 0}/100
            </span>
            {!!preflight?.blockers?.length && (
              <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                blockers {preflight.blockers.length}
              </span>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {(preflight?.checks || []).slice(0, 6).map((check) => (
              <div key={check.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-gray-800">{check.id}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      check.ok ? 'bg-emerald-100 text-emerald-700' : check.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {check.ok ? 'ok' : check.severity || 'warn'}
                  </span>
                </div>
                <p className="mt-1 text-gray-600">{check.detail}</p>
              </div>
            ))}
            {!preflight?.checks?.length && <p className="text-xs text-gray-500">Sin datos de preflight.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">SLO Operativo</h3>
          <div className="mt-3 flex items-center gap-3">
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
              score {slo?.score ?? 0}/100
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="rounded-lg border border-gray-200 p-3 text-xs">
              <p className="text-gray-500">Routers</p>
              <p className="mt-1 font-semibold text-gray-900">
                {slo?.metrics?.router_availability ?? 0}% / target {slo?.targets?.router_availability ?? 0}%
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3 text-xs">
              <p className="text-gray-500">SLA Tickets</p>
              <p className="mt-1 font-semibold text-gray-900">
                {slo?.metrics?.ticket_sla ?? 0}% / target {slo?.targets?.ticket_sla ?? 0}%
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3 text-xs">
              <p className="text-gray-500">Provisioning</p>
              <p className="mt-1 font-semibold text-gray-900">
                {slo?.metrics?.provision_success ?? 0}% / target {slo?.targets?.provision_success ?? 0}%
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">SOP Activos</h3>
          <div className="mt-3 space-y-2">
            {sops.slice(0, 8).map((sop) => (
              <div key={sop.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
                <p className="font-semibold text-gray-900">{sop.title}</p>
                <p className="text-gray-600">
                  {sop.category || 'general'} | owner: {sop.owner_role || 'admin'} | checklist: {sop.checklist?.length || 0}
                </p>
              </div>
            ))}
            {!sops.length && <p className="text-xs text-gray-500">No hay SOP configurados.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Control de Cambios</h3>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <input
              value={newChangeTitle}
              onChange={(e) => setNewChangeTitle(e.target.value)}
              placeholder="Titulo del cambio"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={newChangeTicket}
              onChange={(e) => setNewChangeTicket(e.target.value)}
              placeholder="Ticket ref (opcional)"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              onClick={createChangeRequest}
              disabled={creatingChange}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {creatingChange ? 'Registrando...' : 'Registrar cambio'}
            </button>
          </div>
          <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
            {changeRequests.slice(0, 12).map((row) => (
              <div key={row.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-gray-900">{row.title}</p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                    {row.status}
                  </span>
                </div>
                <p className="text-gray-600">
                  {row.id} | {row.scope || 'network'} {row.ticket_ref ? `| ${row.ticket_ref}` : ''}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => updateChangeStatus(row.id, 'approved')}
                    className="rounded bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700"
                  >
                    aprobar
                  </button>
                  <button
                    onClick={() => updateChangeStatus(row.id, 'executing')}
                    className="rounded bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-700"
                  >
                    ejecutar
                  </button>
                  <button
                    onClick={() => updateChangeStatus(row.id, 'done')}
                    className="rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-700"
                  >
                    cerrar
                  </button>
                </div>
              </div>
            ))}
            {!changeRequests.length && <p className="text-xs text-gray-500">Sin cambios registrados.</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Cobranza Operativa</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-gray-500">Subs activas</p>
              <p className="mt-1 font-semibold text-gray-900">{collections?.subscriptions?.active ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-gray-500">Subs mora/suspendidas</p>
              <p className="mt-1 font-semibold text-gray-900">
                {(collections?.subscriptions?.past_due ?? 0) + (collections?.subscriptions?.suspended ?? 0)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-gray-500">Promesas pendientes</p>
              <p className="mt-1 font-semibold text-gray-900">{collections?.promises?.pending ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-gray-500">Facturas pendientes</p>
              <p className="mt-1 font-semibold text-gray-900">{collections?.invoices?.pending ?? 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Soporte SLA</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-gray-500">Tickets abiertos</p>
              <p className="mt-1 font-semibold text-gray-900">{supportSla?.open ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-gray-500">Vencidos SLA</p>
              <p className="mt-1 font-semibold text-gray-900">{supportSla?.overdue ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-gray-500">Por vencer (4h)</p>
              <p className="mt-1 font-semibold text-gray-900">{supportSla?.due_soon_4h ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-gray-500">Cumplimiento estimado</p>
              <p className="mt-1 font-semibold text-gray-900">{supportSla?.sla_compliance_estimate ?? 0}%</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm xl:col-span-2">
          <h3 className="mb-3 font-semibold text-gray-900">Configuracion operativa</h3>
          {settings ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {[
                  ['portal_maintenance_mode', 'Portal en mantenimiento'],
                  ['auto_suspend_overdue', 'Suspension automatica por mora'],
                  ['notifications_push_enabled', 'Notificaciones push'],
                  ['notifications_email_enabled', 'Notificaciones email'],
                  ['allow_self_signup', 'Permitir autorregistro'],
                  ['change_control_required_for_live', 'Control de cambios obligatorio (live)'],
                  ['require_preflight_for_live', 'Preflight obligatorio (live)'],
                  ['admin_mfa_required', 'MFA obligatorio para staff/admin'],
                ].map(([keyName, label]) => (
                  <label key={keyName} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(settings[keyName as keyof SystemSettingsPayload])}
                      onChange={(e) =>
                        setSettings((prev) =>
                          prev ? { ...prev, [keyName]: e.target.checked } as SystemSettingsPayload : prev
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
                <label className="text-sm text-gray-700">
                  Prioridad ticket default
                  <select
                    value={settings.default_ticket_priority}
                    onChange={(e) => setSettings((prev) => (prev ? { ...prev, default_ticket_priority: e.target.value } : prev))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="urgent">urgent</option>
                  </select>
                </label>
                <label className="text-sm text-gray-700">
                  Retencion backup (dias)
                  <input
                    type="number"
                    value={settings.backup_retention_days}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, backup_retention_days: Number(e.target.value) } : prev
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Polling metricas (seg)
                  <input
                    type="number"
                    value={settings.metrics_poll_interval_sec}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, metrics_poll_interval_sec: Number(e.target.value) } : prev
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Minimo password
                  <input
                    type="number"
                    value={settings.password_policy_min_length}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, password_policy_min_length: Number(e.target.value) } : prev
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Drill backup (dias)
                  <input
                    type="number"
                    value={settings.backup_restore_drill_days}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, backup_restore_drill_days: Number(e.target.value) } : prev
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  SLO routers (%)
                  <input
                    type="number"
                    value={settings.slo_router_availability_target}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, slo_router_availability_target: Number(e.target.value) } : prev
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  SLO SLA tickets (%)
                  <input
                    type="number"
                    value={settings.slo_ticket_sla_target}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, slo_ticket_sla_target: Number(e.target.value) } : prev
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  SLO provision (%)
                  <input
                    type="number"
                    value={settings.slo_provision_success_target}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev ? { ...prev, slo_provision_success_target: Number(e.target.value) } : prev
                      )
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Cargando configuracion...</p>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 font-semibold text-gray-900">Jobs</h3>
          <div className="mb-3 grid grid-cols-1 gap-2">
            <select
              value={jobTypeFilter}
              onChange={(e) => setJobTypeFilter(e.target.value as 'all' | (typeof jobs)[number])}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
            >
              <option value="all">todos los jobs</option>
              {jobs.map((job) => (
                <option key={job} value={job}>
                  {job}
                </option>
              ))}
            </select>
            <select
              value={jobStatusFilter}
              onChange={(e) => setJobStatusFilter(e.target.value as (typeof jobStatuses)[number])}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
            >
              {jobStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            {jobs.map((job) => (
              <button
                key={job}
                onClick={() => runJob(job)}
                disabled={runningJob === job}
                className="w-full rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60"
              >
                {runningJob === job ? `Ejecutando ${job}...` : job}
              </button>
            ))}
          </div>

          <div className="mt-4 border-t border-gray-100 pt-3">
            <h4 className="mb-2 text-sm font-semibold text-gray-900">Historial reciente</h4>
            <div className="max-h-52 space-y-2 overflow-y-auto">
              {jobHistory.map((job) => (
                <div key={job.id} className="rounded-md border border-gray-200 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-gray-800">{job.job}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusBadgeClass(job.status)}`}>
                      {job.status}
                    </span>
                  </div>
                  <p className="text-gray-500">
                    inicio: {job.started_at?.replace('T', ' ').slice(0, 16)}
                  </p>
                  {job.finished_at && <p className="text-gray-500">fin: {job.finished_at.replace('T', ' ').slice(0, 16)}</p>}
                  {renderJobResult(job) && <p className="mt-1 text-gray-700">{renderJobResult(job)}</p>}
                </div>
              ))}
              {!jobHistory.length && <p className="text-xs text-gray-500">Sin jobs recientes.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SystemSettings
