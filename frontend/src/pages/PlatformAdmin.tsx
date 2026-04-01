import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import {
  ArrowPathIcon,
  BuildingOffice2Icon,
  BoltIcon,
  CheckBadgeIcon,
  PlusCircleIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import { apiClient } from '../lib/apiClient'
import { useAuthStore } from '../store/authStore'

interface PlatformOverview {
  tenants_total: number
  tenants_active: number
  tenants_inactive: number
  tenants_trial: number
  tenants_past_due: number
  tenants_suspended: number
  users_total: number
  clients_total: number
  routers_total: number
  subscriptions_total: number
  subscriptions_active: number
  subscriptions_overdue: number
  mrr_total: number
}

interface PlatformTenantItem {
  id: number
  slug: string
  name: string
  is_active: boolean
  created_at: string | null
  host: string
  plan_code: string
  billing_status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'
  billing_cycle: 'monthly' | 'quarterly' | 'yearly'
  monthly_price: number
  max_admins: number
  max_routers: number
  max_clients: number
  trial_ends_at: string | null
  users_total: number
  admins_total: number
  clients_total: number
  routers_total: number
  subscriptions_total: number
  subscriptions_active: number
  subscriptions_suspended: number
}

interface PlatformTenantsResponse {
  items?: PlatformTenantItem[]
}

interface TenantPlanTemplate {
  monthly_price: number
  max_admins: number
  max_routers: number
  max_clients: number
}

interface TenantPlanTemplatesResponse {
  items?: Record<string, TenantPlanTemplate>
}

const defaultPlanTemplates: Record<string, TenantPlanTemplate> = {
  starter: { monthly_price: 39, max_admins: 2, max_routers: 5, max_clients: 400 },
  growth: { monthly_price: 89, max_admins: 5, max_routers: 20, max_clients: 2000 },
  pro: { monthly_price: 179, max_admins: 10, max_routers: 60, max_clients: 8000 },
  enterprise: { monthly_price: 399, max_admins: 30, max_routers: 250, max_clients: 50000 },
}

const defaultOverview: PlatformOverview = {
  tenants_total: 0,
  tenants_active: 0,
  tenants_inactive: 0,
  tenants_trial: 0,
  tenants_past_due: 0,
  tenants_suspended: 0,
  users_total: 0,
  clients_total: 0,
  routers_total: 0,
  subscriptions_total: 0,
  subscriptions_active: 0,
  subscriptions_overdue: 0,
  mrr_total: 0,
}

const PlatformAdmin: React.FC = () => {
  const navigate = useNavigate()
  const { user, logout, setTenantContext } = useAuthStore()
  const [overview, setOverview] = useState<PlatformOverview>(defaultOverview)
  const [tenants, setTenants] = useState<PlatformTenantItem[]>([])
  const [planTemplates, setPlanTemplates] = useState<Record<string, TenantPlanTemplate>>(defaultPlanTemplates)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [billingFilter, setBillingFilter] = useState<'all' | 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'>('all')

  const [tenantForm, setTenantForm] = useState({
    name: '',
    slug: '',
    is_active: true,
    plan_code: 'starter',
    billing_status: 'active',
    billing_cycle: 'monthly',
    monthly_price: '',
    max_admins: '',
    max_routers: '',
    max_clients: '',
    admin_email: '',
    admin_name: 'Admin ISP',
    admin_password: '',
  })
  const [createdTenantCredential, setCreatedTenantCredential] = useState<{
    tenant: string
    email: string
    password: string
  } | null>(null)

  const [editingTenant, setEditingTenant] = useState<PlatformTenantItem | null>(null)
  const [editForm, setEditForm] = useState({ name: '', slug: '' })

  const [billingTarget, setBillingTarget] = useState<PlatformTenantItem | null>(null)
  const [billingForm, setBillingForm] = useState({
    plan_code: 'starter',
    billing_status: 'active',
    billing_cycle: 'monthly',
    monthly_price: '',
    max_admins: '',
    max_routers: '',
    max_clients: '',
    trial_ends_at: '',
  })

  const [adminTarget, setAdminTarget] = useState<PlatformTenantItem | null>(null)
  const [adminForm, setAdminForm] = useState({ email: '', name: 'Admin ISP', password: '' })

  const parseOptionalNumber = (raw: string, field: string): number | undefined => {
    const token = raw.trim()
    if (!token) return undefined
    const parsed = Number(token)
    if (!Number.isFinite(parsed)) {
      throw new Error(`${field} invalido`)
    }
    return parsed
  }

  const parseOptionalInt = (raw: string, field: string): number | undefined => {
    const value = parseOptionalNumber(raw, field)
    if (value === undefined) return undefined
    if (!Number.isInteger(value)) {
      throw new Error(`${field} debe ser entero`)
    }
    return value
  }

  const toLocalDateTimeInput = (isoDate: string | null | undefined): string => {
    if (!isoDate) return ''
    const parsed = new Date(isoDate)
    if (Number.isNaN(parsed.getTime())) return ''
    return parsed.toISOString().slice(0, 16)
  }

  const formatDateTime = (isoDate: string | null | undefined): string => {
    if (!isoDate) return 'Automatico'
    const parsed = new Date(isoDate)
    if (Number.isNaN(parsed.getTime())) return 'Automatico'
    return parsed.toLocaleString('es-PE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }

  const usagePercent = (used: number, limit: number): number => {
    if (!Number.isFinite(limit) || limit <= 0) return 0
    const ratio = (used / limit) * 100
    return Math.max(0, Math.min(100, Math.round(ratio)))
  }

  const loadPlatformData = useCallback(async () => {
    setLoading(true)
    try {
      const [overviewResponse, tenantsResponse, templatesResponse] = await Promise.all([
        apiClient.get('/platform/overview') as Promise<PlatformOverview>,
        apiClient.get('/platform/tenants') as Promise<PlatformTenantsResponse>,
        apiClient.get('/platform/plans/templates') as Promise<TenantPlanTemplatesResponse>,
      ])
      setOverview({
        ...defaultOverview,
        ...overviewResponse,
      })
      const list = Array.isArray(tenantsResponse.items) ? tenantsResponse.items : []
      setTenants(list)
      const templates =
        templatesResponse && templatesResponse.items && Object.keys(templatesResponse.items).length
          ? templatesResponse.items
          : defaultPlanTemplates
      setPlanTemplates(templates)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error cargando admin total'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setTenantContext(null)
  }, [setTenantContext])

  useEffect(() => {
    void loadPlatformData()
  }, [loadPlatformData])

  const planCodes = useMemo(() => Object.keys(planTemplates), [planTemplates])

  const filteredTenants = useMemo(() => {
    const query = search.trim().toLowerCase()
    return tenants.filter((tenant) => {
      if (statusFilter === 'active' && !tenant.is_active) return false
      if (statusFilter === 'inactive' && tenant.is_active) return false
      if (billingFilter !== 'all' && tenant.billing_status !== billingFilter) return false
      if (!query) return true
      return tenant.name.toLowerCase().includes(query) || tenant.slug.toLowerCase().includes(query)
    })
  }, [billingFilter, search, statusFilter, tenants])

  const applyPlanTemplateToCreate = (planCode: string) => {
    const template = planTemplates[planCode]
    if (!template) return
    setTenantForm((prev) => ({
      ...prev,
      plan_code: planCode,
      monthly_price: String(template.monthly_price),
      max_admins: String(template.max_admins),
      max_routers: String(template.max_routers),
      max_clients: String(template.max_clients),
    }))
  }

  const applyPlanTemplateToBilling = (planCode: string) => {
    const template = planTemplates[planCode]
    if (!template) return
    setBillingForm((prev) => ({
      ...prev,
      plan_code: planCode,
      monthly_price: String(template.monthly_price),
      max_admins: String(template.max_admins),
      max_routers: String(template.max_routers),
      max_clients: String(template.max_clients),
    }))
  }

  const submitCreateTenant = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!tenantForm.name.trim()) {
      toast.error('Ingresa el nombre del ISP')
      return
    }

    setBusy(true)
    try {
      const monthlyPrice = parseOptionalNumber(tenantForm.monthly_price, 'monthly_price')
      const maxAdmins = parseOptionalInt(tenantForm.max_admins, 'max_admins')
      const maxRouters = parseOptionalInt(tenantForm.max_routers, 'max_routers')
      const maxClients = parseOptionalInt(tenantForm.max_clients, 'max_clients')

      const payload = {
        name: tenantForm.name.trim(),
        slug: tenantForm.slug.trim() || undefined,
        is_active: tenantForm.is_active,
        plan_code: tenantForm.plan_code,
        billing_status: tenantForm.billing_status,
        billing_cycle: tenantForm.billing_cycle,
        monthly_price: monthlyPrice,
        max_admins: maxAdmins,
        max_routers: maxRouters,
        max_clients: maxClients,
        admin_email: tenantForm.admin_email.trim() || undefined,
        admin_name: tenantForm.admin_name.trim() || undefined,
        admin_password: tenantForm.admin_password.trim() || undefined,
      }
      const response = (await apiClient.post('/platform/tenants', payload)) as {
        success?: boolean
        tenant?: PlatformTenantItem
        admin?: { email?: string; password?: string }
      }
      if (!response.success) {
        throw new Error('No se pudo crear el tenant')
      }
      if (response.admin?.email && response.admin?.password && response.tenant?.slug) {
        setCreatedTenantCredential({
          tenant: response.tenant.slug,
          email: response.admin.email,
          password: response.admin.password,
        })
      }

      setTenantForm((prev) => ({
        ...prev,
        name: '',
        slug: '',
        plan_code: 'starter',
        billing_status: 'active',
        billing_cycle: 'monthly',
        monthly_price: '',
        max_admins: '',
        max_routers: '',
        max_clients: '',
        admin_email: '',
        admin_password: '',
      }))
      toast.success('Tenant creado correctamente')
      await loadPlatformData()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error creando tenant'
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const toggleTenantStatus = async (tenant: PlatformTenantItem) => {
    setBusy(true)
    try {
      await apiClient.patch(`/platform/tenants/${tenant.id}`, { is_active: !tenant.is_active })
      toast.success(`Tenant ${tenant.is_active ? 'desactivado' : 'activado'}`)
      await loadPlatformData()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error actualizando tenant'
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const openEditTenant = (tenant: PlatformTenantItem) => {
    setEditingTenant(tenant)
    setEditForm({ name: tenant.name, slug: tenant.slug })
  }

  const submitEditTenant = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingTenant) return
    if (!editForm.name.trim() || !editForm.slug.trim()) {
      toast.error('Nombre y slug son obligatorios')
      return
    }
    setBusy(true)
    try {
      await apiClient.patch(`/platform/tenants/${editingTenant.id}`, {
        name: editForm.name.trim(),
        slug: editForm.slug.trim(),
      })
      toast.success('Tenant actualizado')
      setEditingTenant(null)
      await loadPlatformData()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error actualizando tenant'
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const openBillingEditor = (tenant: PlatformTenantItem) => {
    setBillingTarget(tenant)
    setBillingForm({
      plan_code: tenant.plan_code || 'starter',
      billing_status: tenant.billing_status || 'active',
      billing_cycle: tenant.billing_cycle || 'monthly',
      monthly_price: String(tenant.monthly_price ?? ''),
      max_admins: String(tenant.max_admins ?? ''),
      max_routers: String(tenant.max_routers ?? ''),
      max_clients: String(tenant.max_clients ?? ''),
      trial_ends_at: toLocalDateTimeInput(tenant.trial_ends_at),
    })
  }

  const submitBillingUpdate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!billingTarget) return

    setBusy(true)
    try {
      const monthlyPrice = parseOptionalNumber(billingForm.monthly_price, 'monthly_price')
      const maxAdmins = parseOptionalInt(billingForm.max_admins, 'max_admins')
      const maxRouters = parseOptionalInt(billingForm.max_routers, 'max_routers')
      const maxClients = parseOptionalInt(billingForm.max_clients, 'max_clients')

      let trialEndsAt: string | null = null
      if (billingForm.trial_ends_at.trim()) {
        const parsed = new Date(billingForm.trial_ends_at)
        if (Number.isNaN(parsed.getTime())) {
          throw new Error('trial_ends_at invalido')
        }
        trialEndsAt = parsed.toISOString()
      }

      await apiClient.patch(`/platform/tenants/${billingTarget.id}`, {
        plan_code: billingForm.plan_code,
        billing_status: billingForm.billing_status,
        billing_cycle: billingForm.billing_cycle,
        monthly_price: monthlyPrice,
        max_admins: maxAdmins,
        max_routers: maxRouters,
        max_clients: maxClients,
        trial_ends_at: trialEndsAt,
      })
      toast.success('Suscripcion del tenant actualizada')
      setBillingTarget(null)
      await loadPlatformData()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error actualizando suscripcion'
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const openCreateAdmin = (tenant: PlatformTenantItem) => {
    setAdminTarget(tenant)
    setAdminForm({ email: '', name: 'Admin ISP', password: '' })
  }

  const openTenantAdminMode = (tenant: PlatformTenantItem) => {
    if (!tenant.is_active) {
      toast.error('Activa el tenant antes de entrar al modo Admin ISP')
      return
    }
    setTenantContext(tenant.id)
    toast.success(`Modo Admin ISP activo: ${tenant.name}`)
    navigate('/admin')
  }

  const submitCreateTenantAdmin = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!adminTarget) return
    if (!adminForm.email.trim()) {
      toast.error('Email de admin requerido')
      return
    }
    setBusy(true)
    try {
      const response = (await apiClient.post(`/platform/tenants/${adminTarget.id}/admins`, {
        email: adminForm.email.trim(),
        name: adminForm.name.trim() || 'Admin ISP',
        password: adminForm.password.trim() || undefined,
      })) as {
        success?: boolean
        admin?: { email?: string; password?: string }
      }
      if (response.success && response.admin?.email && response.admin?.password) {
        setCreatedTenantCredential({
          tenant: adminTarget.slug,
          email: response.admin.email,
          password: response.admin.password,
        })
      }
      toast.success('Admin de tenant creado')
      setAdminTarget(null)
      await loadPlatformData()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error creando admin'
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#112347_0%,#0b1020_40%,#070b15_100%)] text-slate-100">
      <header className="border-b border-white/10 bg-slate-950/40 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">FastISP Master</p>
            <h1 className="text-2xl font-black text-white">Admin Total de Plataforma</h1>
            <p className="text-sm text-slate-300">Control de tenants, cuentas admin y salud global del SaaS.</p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2">
            <ShieldCheckIcon className="h-5 w-5 text-emerald-300" />
            <div>
              <p className="text-sm font-semibold text-white">{user?.name || 'Platform Admin'}</p>
              <p className="text-xs text-slate-300">{user?.email}</p>
            </div>
            <button
              onClick={logout}
              className="ml-3 rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/30"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-6 py-6 xl:grid-cols-[1.8fr,1fr]">
        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
            {[
              {
                label: 'Tenants',
                value: overview.tenants_total,
                meta: `Activos ${overview.tenants_active} | Inactivos ${overview.tenants_inactive}`,
                icon: BuildingOffice2Icon,
                tone: 'from-cyan-500/30 to-blue-500/10',
              },
              {
                label: 'Clientes',
                value: overview.clients_total,
                meta: `Usuarios ${overview.users_total}`,
                icon: UsersIcon,
                tone: 'from-emerald-500/30 to-green-500/10',
              },
              {
                label: 'Routers',
                value: overview.routers_total,
                meta: `Subs vencidas ${overview.subscriptions_overdue}`,
                icon: ServerStackIcon,
                tone: 'from-amber-500/30 to-orange-500/10',
              },
              {
                label: 'Subs Activas',
                value: overview.subscriptions_active,
                meta: `Total subs ${overview.subscriptions_total}`,
                icon: CheckBadgeIcon,
                tone: 'from-violet-500/30 to-indigo-500/10',
              },
              {
                label: 'MRR',
                value: `$${overview.mrr_total.toFixed(2)}`,
                meta: `Mora ${overview.tenants_past_due} | Trial ${overview.tenants_trial}`,
                icon: BoltIcon,
                tone: 'from-cyan-500/30 to-emerald-500/10',
              },
            ].map((card) => (
              <div
                key={card.label}
                className={`rounded-2xl border border-white/10 bg-gradient-to-br ${card.tone} p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.95)]`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">{card.label}</p>
                  <card.icon className="h-5 w-5 text-white/80" />
                </div>
                <p className="mt-3 text-3xl font-black text-white">{card.value}</p>
                <p className="mt-1 text-xs text-slate-300">{card.meta}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/55 p-5 shadow-[0_20px_50px_-35px_rgba(15,23,42,1)]">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">Tenants registrados</h2>
                <p className="text-sm text-slate-300">Aislamiento por subdominio y control operativo centralizado.</p>
              </div>
              <button
                onClick={() => void loadPlatformData()}
                disabled={loading || busy}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-400 disabled:opacity-60"
              >
                <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refrescar
              </button>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr,170px,180px]">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nombre o slug"
                className="rounded-xl border border-white/15 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
              />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'inactive')}
                className="rounded-xl border border-white/15 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
              >
                <option value="all">Todos</option>
                <option value="active">Activos</option>
                <option value="inactive">Inactivos</option>
              </select>
              <select
                value={billingFilter}
                onChange={(event) =>
                  setBillingFilter(event.target.value as 'all' | 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled')
                }
                className="rounded-xl border border-white/15 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
              >
                <option value="all">Facturacion</option>
                <option value="trial">Trial</option>
                <option value="active">Activa</option>
                <option value="past_due">Vencida</option>
                <option value="suspended">Suspendida</option>
                <option value="cancelled">Cancelada</option>
              </select>
            </div>

            {loading ? (
              <div className="py-14 text-center text-slate-300">Cargando tenants...</div>
            ) : (
              <div className="space-y-3">
                {filteredTenants.map((tenant) => {
                  const adminsUsage = usagePercent(tenant.admins_total, tenant.max_admins)
                  const clientsUsage = usagePercent(tenant.clients_total, tenant.max_clients)
                  const routersUsage = usagePercent(tenant.routers_total, tenant.max_routers)

                  return (
                    <article key={tenant.id} className="rounded-xl border border-white/10 bg-slate-950/35 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-semibold text-white">{tenant.name}</h3>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${tenant.is_active ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'}`}>
                              {tenant.is_active ? 'activo' : 'inactivo'}
                            </span>
                            <span className="rounded-full bg-cyan-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-cyan-100">
                              {tenant.plan_code}
                            </span>
                            <span className="rounded-full bg-violet-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-violet-100">
                              {tenant.billing_status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{tenant.host || `${tenant.slug}.fastisp.cloud`}</p>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300">
                            <p>
                              <span className="text-slate-400">Creado:</span> {formatDateTime(tenant.created_at)}
                            </p>
                            <p>
                              <span className="text-slate-400">Trial hasta:</span> {formatDateTime(tenant.trial_ends_at)}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => void toggleTenantStatus(tenant)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-60"
                          >
                            <BoltIcon className="h-4 w-4" />
                            {tenant.is_active ? 'Desactivar' : 'Activar'}
                          </button>
                          <button
                            onClick={() => openEditTenant(tenant)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/40 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-60"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => openBillingEditor(tenant)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg border border-violet-400/40 bg-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-500/30 disabled:opacity-60"
                          >
                            Suscripcion
                          </button>
                          <button
                            onClick={() => openCreateAdmin(tenant)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-60"
                          >
                            <UserPlusIcon className="h-4 w-4" />
                            Crear admin
                          </button>
                          <button
                            onClick={() => openTenantAdminMode(tenant)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-300/40 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/30 disabled:opacity-60"
                          >
                            Entrar panel ISP
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                        <div className="rounded-lg border border-white/10 bg-slate-900/55 p-2">
                          <div className="flex items-center justify-between text-[11px] text-slate-200">
                            <span>Admins</span>
                            <span>{tenant.admins_total}/{tenant.max_admins}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-white/10">
                            <div
                              className={`h-1.5 rounded-full ${adminsUsage >= 90 ? 'bg-rose-400' : adminsUsage >= 75 ? 'bg-amber-300' : 'bg-emerald-300'}`}
                              style={{ width: `${adminsUsage}%` }}
                            />
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-slate-900/55 p-2">
                          <div className="flex items-center justify-between text-[11px] text-slate-200">
                            <span>Clientes</span>
                            <span>{tenant.clients_total}/{tenant.max_clients}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-white/10">
                            <div
                              className={`h-1.5 rounded-full ${clientsUsage >= 90 ? 'bg-rose-400' : clientsUsage >= 75 ? 'bg-amber-300' : 'bg-emerald-300'}`}
                              style={{ width: `${clientsUsage}%` }}
                            />
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-slate-900/55 p-2">
                          <div className="flex items-center justify-between text-[11px] text-slate-200">
                            <span>Routers</span>
                            <span>{tenant.routers_total}/{tenant.max_routers}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-white/10">
                            <div
                              className={`h-1.5 rounded-full ${routersUsage >= 90 ? 'bg-rose-400' : routersUsage >= 75 ? 'bg-amber-300' : 'bg-emerald-300'}`}
                              style={{ width: `${routersUsage}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-200 md:grid-cols-4">
                        <p><span className="text-slate-400">Usuarios:</span> {tenant.users_total}</p>
                        <p><span className="text-slate-400">Subs:</span> {tenant.subscriptions_total}</p>
                        <p><span className="text-slate-400">Ciclo:</span> {tenant.billing_cycle}</p>
                        <p><span className="text-slate-400">Precio:</span> ${Number(tenant.monthly_price || 0).toFixed(2)}</p>
                      </div>
                    </article>
                  )
                })}
                {!filteredTenants.length && (
                  <div className="rounded-xl border border-dashed border-white/20 py-8 text-center text-sm text-slate-400">
                    No hay tenants para este filtro.
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
            <div className="mb-4 flex items-center gap-2">
              <PlusCircleIcon className="h-5 w-5 text-cyan-300" />
              <h2 className="text-lg font-bold text-white">Alta de tenant</h2>
            </div>
            <form onSubmit={submitCreateTenant} className="space-y-3">
              <input
                value={tenantForm.name}
                onChange={(event) => setTenantForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Nombre comercial ISP"
                className="w-full rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
              />
              <input
                value={tenantForm.slug}
                onChange={(event) => setTenantForm((prev) => ({ ...prev, slug: event.target.value }))}
                placeholder="Slug (opcional)"
                className="w-full rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
              />
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <select
                  value={tenantForm.plan_code}
                  onChange={(event) => applyPlanTemplateToCreate(event.target.value)}
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  {planCodes.map((planCode) => (
                    <option key={planCode} value={planCode}>
                      Plan {planCode}
                    </option>
                  ))}
                </select>
                <select
                  value={tenantForm.billing_status}
                  onChange={(event) => setTenantForm((prev) => ({ ...prev, billing_status: event.target.value }))}
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  <option value="trial">Trial</option>
                  <option value="active">Activa</option>
                  <option value="past_due">Vencida</option>
                  <option value="suspended">Suspendida</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <select
                  value={tenantForm.billing_cycle}
                  onChange={(event) => setTenantForm((prev) => ({ ...prev, billing_cycle: event.target.value }))}
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  <option value="monthly">Ciclo mensual</option>
                  <option value="quarterly">Ciclo trimestral</option>
                  <option value="yearly">Ciclo anual</option>
                </select>
                <input
                  value={tenantForm.monthly_price}
                  onChange={(event) => setTenantForm((prev) => ({ ...prev, monthly_price: event.target.value }))}
                  placeholder="Precio mensual (opcional)"
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <input
                  value={tenantForm.max_admins}
                  onChange={(event) => setTenantForm((prev) => ({ ...prev, max_admins: event.target.value }))}
                  placeholder="Max admins"
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
                />
                <input
                  value={tenantForm.max_routers}
                  onChange={(event) => setTenantForm((prev) => ({ ...prev, max_routers: event.target.value }))}
                  placeholder="Max routers"
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
                />
                <input
                  value={tenantForm.max_clients}
                  onChange={(event) => setTenantForm((prev) => ({ ...prev, max_clients: event.target.value }))}
                  placeholder="Max clientes"
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
                />
              </div>
              <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                <p>
                  <span className="font-semibold">Creacion:</span> fecha y hora automaticas del servidor.
                </p>
                {tenantForm.billing_status === 'trial' && (
                  <p className="mt-1 text-cyan-200">
                    <span className="font-semibold">Fin de trial:</span> se calcula automaticamente al crear.
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={tenantForm.is_active}
                  onChange={(event) => setTenantForm((prev) => ({ ...prev, is_active: event.target.checked }))}
                  className="rounded border-slate-500 bg-slate-900"
                />
                Crear tenant activo
              </label>
              <input
                value={tenantForm.admin_email}
                onChange={(event) => setTenantForm((prev) => ({ ...prev, admin_email: event.target.value }))}
                placeholder="Admin email inicial (opcional)"
                className="w-full rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
              />
              <input
                value={tenantForm.admin_name}
                onChange={(event) => setTenantForm((prev) => ({ ...prev, admin_name: event.target.value }))}
                placeholder="Nombre admin inicial"
                className="w-full rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
              />
              <input
                type="password"
                value={tenantForm.admin_password}
                onChange={(event) => setTenantForm((prev) => ({ ...prev, admin_password: event.target.value }))}
                placeholder="Password admin inicial (opcional)"
                className="w-full rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-400 disabled:opacity-60"
              >
                <PlusCircleIcon className="h-4 w-4" />
                Crear tenant
              </button>
            </form>
          </div>

          {createdTenantCredential && (
            <div className="rounded-2xl border border-emerald-300/25 bg-emerald-500/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200">Credenciales generadas</p>
              <p className="mt-2 text-xs text-emerald-100">
                Tenant: <strong>{createdTenantCredential.tenant}</strong>
              </p>
              <p className="text-xs text-emerald-100">
                Email: <strong>{createdTenantCredential.email}</strong>
              </p>
              <p className="text-xs text-emerald-100">
                Password: <strong>{createdTenantCredential.password}</strong>
              </p>
            </div>
          )}
        </aside>
      </main>

      {editingTenant && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-5">
            <h3 className="text-lg font-bold text-white">Editar tenant</h3>
            <form onSubmit={submitEditTenant} className="mt-4 space-y-3">
              <input
                value={editForm.name}
                onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Nombre"
                className="w-full rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
              />
              <input
                value={editForm.slug}
                onChange={(event) => setEditForm((prev) => ({ ...prev, slug: event.target.value }))}
                placeholder="Slug"
                className="w-full rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditingTenant(null)} className="rounded-lg border border-white/20 px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
                  Cancelar
                </button>
                <button type="submit" disabled={busy} className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-400 disabled:opacity-60">
                  Guardar cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {billingTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-slate-900 p-5">
            <h3 className="text-lg font-bold text-white">Suscripcion de {billingTarget.name}</h3>
            <form onSubmit={submitBillingUpdate} className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <select
                  value={billingForm.plan_code}
                  onChange={(event) => applyPlanTemplateToBilling(event.target.value)}
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  {planCodes.map((planCode) => (
                    <option key={planCode} value={planCode}>
                      Plan {planCode}
                    </option>
                  ))}
                </select>
                <select
                  value={billingForm.billing_status}
                  onChange={(event) => setBillingForm((prev) => ({ ...prev, billing_status: event.target.value }))}
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  <option value="trial">Trial</option>
                  <option value="active">Activa</option>
                  <option value="past_due">Vencida</option>
                  <option value="suspended">Suspendida</option>
                  <option value="cancelled">Cancelada</option>
                </select>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <select
                  value={billingForm.billing_cycle}
                  onChange={(event) => setBillingForm((prev) => ({ ...prev, billing_cycle: event.target.value }))}
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  <option value="monthly">Ciclo mensual</option>
                  <option value="quarterly">Ciclo trimestral</option>
                  <option value="yearly">Ciclo anual</option>
                </select>
                <input
                  value={billingForm.monthly_price}
                  onChange={(event) => setBillingForm((prev) => ({ ...prev, monthly_price: event.target.value }))}
                  placeholder="Precio mensual"
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <input
                  value={billingForm.max_admins}
                  onChange={(event) => setBillingForm((prev) => ({ ...prev, max_admins: event.target.value }))}
                  placeholder="Max admins"
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
                <input
                  value={billingForm.max_routers}
                  onChange={(event) => setBillingForm((prev) => ({ ...prev, max_routers: event.target.value }))}
                  placeholder="Max routers"
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
                <input
                  value={billingForm.max_clients}
                  onChange={(event) => setBillingForm((prev) => ({ ...prev, max_clients: event.target.value }))}
                  placeholder="Max clientes"
                  className="rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
              </div>
              <input
                type="datetime-local"
                value={billingForm.trial_ends_at}
                onChange={(event) => setBillingForm((prev) => ({ ...prev, trial_ends_at: event.target.value }))}
                className="w-full rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setBillingTarget(null)} className="rounded-lg border border-white/20 px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
                  Cancelar
                </button>
                <button type="submit" disabled={busy} className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-60">
                  Guardar suscripcion
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {adminTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-5">
            <h3 className="text-lg font-bold text-white">Crear admin para {adminTarget.name}</h3>
            <form onSubmit={submitCreateTenantAdmin} className="mt-4 space-y-3">
              <input
                value={adminForm.email}
                onChange={(event) => setAdminForm((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="Email admin"
                className="w-full rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
              />
              <input
                value={adminForm.name}
                onChange={(event) => setAdminForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Nombre admin"
                className="w-full rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
              />
              <input
                type="password"
                value={adminForm.password}
                onChange={(event) => setAdminForm((prev) => ({ ...prev, password: event.target.value }))}
                placeholder="Password (opcional)"
                className="w-full rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAdminTarget(null)} className="rounded-lg border border-white/20 px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
                  Cancelar
                </button>
                <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-60">
                  <UserPlusIcon className="h-4 w-4" />
                  Crear admin
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default PlatformAdmin
