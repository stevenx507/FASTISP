import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CreditCardIcon,
  GlobeAltIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SignalIcon,
  WifiIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../lib/apiClient'

type ClientStatus = 'active' | 'inactive' | 'suspended' | 'past_due' | 'trial' | string

interface OltDevice {
  id: string
  name: string
  vendor: string
  host?: string
}

interface PendingOnu {
  serial: string
  frame?: number | string
  slot?: number | string
  pon?: number | string
  onu?: number | string
  vendor?: string
  model?: string
  status?: string
}

interface Client {
  id: number
  name: string
  ip_address?: string | null
  username?: string | null
  plan?: string | null
  plan_id?: number | null
  router_id?: number | null
  router_name?: string | null
  status: ClientStatus
  email?: string | null
  phone?: string | null
  portal_access?: boolean
  lan_interface?: string | null
  dia_corte?: number | null
  avisos_pantalla?: boolean
}

interface Plan {
  id: number
  name: string
  download_speed?: number
  upload_speed?: number
}

interface Router {
  id: number
  name: string
  ip_address?: string
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400 border border-emerald-500/30', label: 'Activo' },
  inactive: { bg: 'bg-white/10', text: 'text-slate-700', label: 'Inactivo' },
  suspended: { bg: 'bg-rose-500/20', text: 'text-rose-400 border border-rose-500/30', label: 'Suspendido' },
  past_due: { bg: 'bg-amber-500/20', text: 'text-amber-400 border border-amber-500/30', label: 'Mora' },
  trial: { bg: 'bg-blue-500/20', text: 'text-blue-300', label: 'Trial' },
}

const emptyClientForm = {
  // Tab 1: Datos de Conexión
  name: '',           // nombre secret PPPoE
  pppoe_username: '',
  pppoe_password: '',
  remote_address_pppoe: '',
  local_address_pppoe: '',
  mac_address: '',
  coordinates: '',
  ip_address: '',
  connection_type: 'pppoe',
  plan_id: '',
  router_id: '',
  sectorial_nap: '',
  // Tab 2: Datos del Cliente
  full_name: '',
  apellido: '',
  dni: '',
  email: '',
  external_id: '',
  address: '',
  barrio: '',
  ciudad: '',
  codigo_postal: '',
  phone: '',
  forma_contratacion: '',
  // Tab 3: Facturación
  tipo_cliente: 'prepago',
  dia_corte: '8',
  dia_factura: '1',
  dia_pago: '3',
  impuestos: '0',
  avisos_pantalla: true,
  notificaciones_push: true,
  suspender_facturas: '1',
  corte_automatico: true,
  facturas_automaticas: true,
  correo_corte: true,
  correo_facturas: true,
  // Tab 4: Configuración Avanzada
  password: '',
  create_portal_access: true,
  firewall_enabled: true,
  sistema_id: '',
  modelo_antena: '',
  password_antena: '',
  protocolo_conexion: '',
  ip_router_wifi: '',
  modelo_router_wifi: '',
  usuario_router_wifi: '',
  password_router_wifi: '',
  ssid_router_wifi: '',
  password_ssid_wifi: '',
  mac_router_wifi: '',
  comentarios: '',
  razon_social: '',
  ruc_nit: '',
}

const ClientsManagement: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [routers, setRouters] = useState<Router[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'name' | 'plan'>('name')
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyClientForm)
  const [clientTab, setClientTab] = useState<1|2|3|4>(1)
  // Selección masiva y acciones
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkAction, setBulkAction] = useState('')
  const [runningBulk, setRunningBulk] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [colSearch, setColSearch] = useState({ name: '', username: '', ip: '', lan_interface: '', dia_corte: '' })
  const [herramientasId, setHerramientasId] = useState<number | null>(null)
  const herramientasRef = useRef<HTMLDivElement>(null)

  const [portalModalClient, setPortalModalClient] = useState<Client | null>(null)
  const [portalSaving, setPortalSaving] = useState(false)
  const [portalForm, setPortalForm] = useState({ email: '', password: '' })

  const [oltDevices, setOltDevices] = useState<OltDevice[]>([])
  const [gponClient, setGponClient] = useState<Client | null>(null)
  const [gponStep, setGponStep] = useState<1 | 2 | 3>(1)
  const [gponDeviceId, setGponDeviceId] = useState('')
  const [gponFrame, setGponFrame] = useState('0')
  const [gponSlot, setGponSlot] = useState('1')
  const [gponPon, setGponPon] = useState('1')
  const [gponVlan, setGponVlan] = useState('100')
  const [gponWanType, setGponWanType] = useState('pppoe')
  const [gponSerial, setGponSerial] = useState('')
  const [gponOnu, setGponOnu] = useState('1')
  const [pendingOnus, setPendingOnus] = useState<PendingOnu[]>([])
  const [searchingOnus, setSearchingOnus] = useState(false)
  const [authorizingOnu, setAuthorizingOnu] = useState(false)
  const [gponResult, setGponResult] = useState<{ success: boolean; message: string } | null>(null)

  const [lastPortalCredentials, setLastPortalCredentials] = useState<{
    clientName: string
    email: string
    password: string
  } | null>(null)

  const loadOltDevices = async () => {
    try {
      const resp = (await apiClient.get('/olt/devices')) as { devices: OltDevice[] }
      setOltDevices(resp.devices || [])
    } catch {
      setOltDevices([])
    }
  }

  const searchPendingOnus = async () => {
    if (!gponDeviceId) { toast.error('Selecciona un dispositivo OLT'); return }
    setSearchingOnus(true)
    setPendingOnus([])
    setGponSerial('')
    try {
      const params = new URLSearchParams({ frame: gponFrame, slot: gponSlot, pon: gponPon, run_mode: 'live' })
      const resp = (await apiClient.get(`/olt/devices/${gponDeviceId}/autofind-onu?${params}`)) as { onus?: PendingOnu[]; onu_list?: PendingOnu[]; success?: boolean }
      const list = resp.onus || resp.onu_list || []
      setPendingOnus(list)
      if (!list.length) toast('No se encontraron ONUs pendientes en ese PON')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error buscando ONUs')
    } finally {
      setSearchingOnus(false)
    }
  }

  const authorizeOnu = async () => {
    if (!gponDeviceId || !gponSerial) { toast.error('Selecciona ONU y OLT'); return }
    setAuthorizingOnu(true)
    setGponResult(null)
    try {
      const payload = {
        serial: gponSerial,
        frame: Number(gponFrame),
        slot: Number(gponSlot),
        pon: Number(gponPon),
        onu: Number(gponOnu),
        vlan: Number(gponVlan),
        wan_type: gponWanType,
        run_mode: 'live',
        live_confirm: true,
      }
      const resp = (await apiClient.post(`/olt/devices/${gponDeviceId}/authorize-onu`, payload)) as { success?: boolean; message?: string; error?: string }
      if (resp.success) {
        setGponResult({ success: true, message: resp.message || 'ONU autorizada correctamente' })
        setGponStep(3)
        toast.success('ONU GPON autorizada')
      } else {
        setGponResult({ success: false, message: resp.error || resp.message || 'No se pudo autorizar la ONU' })
        toast.error(resp.error || 'Error autorizando ONU')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error autorizando ONU'
      setGponResult({ success: false, message: msg })
      toast.error(msg)
    } finally {
      setAuthorizingOnu(false)
    }
  }

  const openGponModal = (client: Client) => {
    setGponClient(client)
    setGponStep(1)
    setGponDeviceId(oltDevices[0]?.id || '')
    setGponFrame('0'); setGponSlot('1'); setGponPon('1'); setGponOnu('1')
    setGponVlan('100'); setGponWanType('pppoe'); setGponSerial('')
    setPendingOnus([]); setGponResult(null)
    if (!oltDevices.length) void loadOltDevices()
  }

  const renderModal = (content: React.ReactNode) => {
    if (typeof document === 'undefined') return null
    return createPortal(content, document.body)
  }

  const { data: initData, isLoading: queryLoading, refetch } = useQuery({
    queryKey: ['clients_init', page, pageSize, searchTerm, filterStatus],
    queryFn: async () => {
      const q = searchTerm ? `&q=${encodeURIComponent(searchTerm)}` : ''
      const status = filterStatus !== 'all' ? `&status=${filterStatus}` : ''
      const url = `/admin/clients?page=${page}&per_page=${pageSize}${q}${status}`
      
      const [clientsResp, plansResp, routersResp] = await Promise.all([
        apiClient.get(url),
        apiClient.get('/plans'),
        apiClient.get('/routers'),
      ])
      return {
        clients: (clientsResp as any).items || [],
        total: (clientsResp as any).total || 0,
        plans: (plansResp as any).items || [],
        routers: (routersResp as any).routers || (routersResp as any).items || [],
      }
    }
  })

  useEffect(() => {
    if (initData) {
      setClients(initData.clients)
      setPlans(initData.plans)
      setRouters(initData.routers)
      void loadOltDevices()
    }
  }, [initData])

  const load = useCallback(() => {
    refetch()
  }, [refetch])

  // Close herramientas on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (herramientasRef.current && !herramientasRef.current.contains(e.target as Node)) {
        setHerramientasId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const allFiltered = useMemo(() => {
    return clients
      .filter((item) => {
        const matchesName = !colSearch.name || item.name.toLowerCase().includes(colSearch.name.toLowerCase())
        const matchesUser = !colSearch.username || String(item.username || '').toLowerCase().includes(colSearch.username.toLowerCase())
        const matchesIp   = !colSearch.ip || String(item.ip_address || '').includes(colSearch.ip)
        const matchesLan  = !colSearch.lan_interface || String(item.lan_interface || '').toLowerCase().includes(colSearch.lan_interface.toLowerCase())
        const matchesDia  = !colSearch.dia_corte || String(item.dia_corte ?? '').includes(colSearch.dia_corte)
        return matchesName && matchesUser && matchesIp && matchesLan && matchesDia
      })
      .sort((a, b) => {
        if (sortBy === 'plan') return String(a.plan || '').localeCompare(String(b.plan || ''))
        return String(a.name || '').localeCompare(String(b.name || ''))
      })
  }, [clients, sortBy, colSearch])

  const totalPages = Math.max(1, Math.ceil((initData?.total || 0) / pageSize))
  const filteredClients = allFiltered

  const allPageSelected = filteredClients.length > 0 && filteredClients.every((c) => selectedIds.has(c.id))
  const toggleSelectAll = () => {
    if (allPageSelected) {
      setSelectedIds((prev) => { const next = new Set(prev); filteredClients.forEach((c) => next.delete(c.id)); return next })
    } else {
      setSelectedIds((prev) => { const next = new Set(prev); filteredClients.forEach((c) => next.add(c.id)); return next })
    }
  }
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const runBulkAction = async () => {
    if (!bulkAction || selectedIds.size === 0) { toast('Selecciona clientes y una acciÃ³n'); return }
    setRunningBulk(true)
    try {
      const ids = Array.from(selectedIds)
      if (bulkAction === 'activate') {
        await Promise.all(ids.map((id) => apiClient.post(`/admin/clients/${id}/activate`)))
        setClients((prev) => prev.map((c) => selectedIds.has(c.id) ? { ...c, status: 'active' } : c))
        toast.success(`${ids.length} cliente(s) activado(s)`)
      } else if (bulkAction === 'deactivate') {
        await Promise.all(ids.map((id) => apiClient.post(`/admin/clients/${id}/suspend`)))
        setClients((prev) => prev.map((c) => selectedIds.has(c.id) ? { ...c, status: 'suspended' } : c))
        toast.success(`${ids.length} cliente(s) suspendido(s)`)
      } else if (bulkAction === 'export_csv') {
        const rows = clients.filter((c) => selectedIds.has(c.id))
        const csv = ['ID,Nombre,Usuario,IP,Plan,Estado,Corte,LAN',
          ...rows.map((c) => `${c.id},"${c.name}",${c.username || ''},${c.ip_address || ''},"${c.plan || ''}",${c.status},${c.dia_corte ?? ''},${c.lan_interface || ''}`)].join('\n')
        const blob = new Blob([csv], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = 'clientes.csv'; a.click()
        toast.success('CSV exportado')
      } else {
        toast('Acción no implementada aún')
      }
      setSelectedIds(new Set())
      setBulkAction('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error en acciÃ³n masiva')
    } finally {
      setRunningBulk(false)
    }
  }

  const herramientasAction = async (action: string, client: Client) => {
    setHerramientasId(null)
    if (action === 'portal') { openPortalModal(client); return }
    if (action === 'gpon') { openGponModal(client); return }
    if (action === 'activate') { await activate(client.id); return }
    if (action === 'suspend') { await suspend(client.id); return }
    if (action === 'mac') {
      // MAC binding is applied via set-bandwidth which syncs ARP table as a side effect.
      // If a dedicated endpoint is added later, replace this call.
      toast('Función amarrar IP-MAC disponible próximamente desde el panel de cliente.')
      return
    }
    toast(`"${action}" para ${client.name} â€” próximamente`)
  }

  const suspend = async (id: number) => {
    try {
      await apiClient.post(`/admin/clients/${id}/suspend`)
      setClients((prev) => prev.map((item) => (item.id === id ? { ...item, status: 'suspended' } : item)))
      toast.success('Cliente suspendido')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo suspender')
    }
  }

  const activate = async (id: number) => {
    try {
      await apiClient.post(`/admin/clients/${id}/activate`)
      setClients((prev) => prev.map((item) => (item.id === id ? { ...item, status: 'active' } : item)))
      toast.success('Cliente activado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo activar')
    }
  }

  const changeSpeed = async (id: number, planId: number) => {
    try {
      await apiClient.post(`/admin/clients/${id}/speed`, { plan_id: planId })
      const plan = plans.find((item) => item.id === planId)
      setClients((prev) =>
        prev.map((item) => (item.id === id ? { ...item, plan_id: planId, plan: plan?.name || item.plan } : item)),
      )
      toast.success('Plan actualizado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cambiar plan')
    }
  }

  const submitClient = async () => {
    if (!form.plan_id) {
      toast.error('El plan es obligatorio')
      setClientTab(1)
      return
    }
    if (form.create_portal_access && !form.email.trim()) {
      toast.error('Email obligatorio para acceso portal')
      setClientTab(4)
      return
    }

    const clientName = form.full_name.trim() || form.name.trim()
    if (!clientName) {
      toast.error('El nombre del cliente es obligatorio')
      setClientTab(2)
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: form.name.trim() || clientName,
        full_name: clientName,
        plan_id: Number(form.plan_id),
        router_id: form.router_id ? Number(form.router_id) : undefined,
        ip_address: form.ip_address.trim() || undefined,
        connection_type: form.connection_type,
        pppoe_username: form.pppoe_username.trim() || undefined,
        pppoe_password: form.pppoe_password.trim() || undefined,
        mac_address: form.mac_address.trim() || undefined,
        coordinates: form.coordinates.trim() || undefined,
        remote_address_pppoe: form.remote_address_pppoe.trim() || undefined,
        local_address_pppoe: form.local_address_pppoe.trim() || undefined,
        sectorial_nap: form.sectorial_nap.trim() || undefined,
        apellido: form.apellido.trim() || undefined,
        dni: form.dni.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        barrio: form.barrio.trim() || undefined,
        ciudad: form.ciudad.trim() || undefined,
        codigo_postal: form.codigo_postal.trim() || undefined,
        forma_contratacion: form.forma_contratacion || undefined,
        external_id: form.external_id.trim() || undefined,
        email: form.email.trim().toLowerCase() || undefined,
        password: form.password.trim() || undefined,
        create_portal_access: form.create_portal_access,
        tipo_cliente: form.tipo_cliente,
        dia_corte: Number(form.dia_corte) || 8,
        dia_factura: Number(form.dia_factura) || 1,
        dia_pago: Number(form.dia_pago) || 3,
        impuestos: parseFloat(form.impuestos) || 0,
        avisos_pantalla: form.avisos_pantalla,
        notificaciones_push: form.notificaciones_push,
        suspender_facturas: Number(form.suspender_facturas) || 1,
        corte_automatico: form.corte_automatico,
        facturas_automaticas: form.facturas_automaticas,
        correo_corte: form.correo_corte,
        correo_facturas: form.correo_facturas,
        firewall_enabled: form.firewall_enabled,
        sistema_id: form.sistema_id.trim() || undefined,
        modelo_antena: form.modelo_antena.trim() || undefined,
        password_antena: form.password_antena.trim() || undefined,
        protocolo_conexion: form.protocolo_conexion || undefined,
        ip_router_wifi: form.ip_router_wifi.trim() || undefined,
        modelo_router_wifi: form.modelo_router_wifi.trim() || undefined,
        usuario_router_wifi: form.usuario_router_wifi.trim() || undefined,
        password_router_wifi: form.password_router_wifi.trim() || undefined,
        ssid_router_wifi: form.ssid_router_wifi.trim() || undefined,
        password_ssid_wifi: form.password_ssid_wifi.trim() || undefined,
        mac_router_wifi: form.mac_router_wifi.trim() || undefined,
        comentarios: form.comentarios.trim() || undefined,
        razon_social: form.razon_social.trim() || undefined,
        ruc_nit: form.ruc_nit.trim() || undefined,
      }

      const response = (await apiClient.post('/admin/clients', payload)) as {
        client: Client
        user?: { email?: string }
        password?: string
      }

      const createdClient: Client = {
        ...response.client,
        email: response.user?.email || form.email.trim().toLowerCase() || null,
        portal_access: Boolean(response.user),
      }
      setClients((prev) => [...prev, createdClient])

      if (response.user?.email && response.password) {
        setLastPortalCredentials({
          clientName: createdClient.name,
          email: response.user.email,
          password: response.password,
        })
      }

      toast.success('Cliente creado')
      setForm(emptyClientForm)
      setShowModal(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear el cliente')
    } finally {
      setSaving(false)
    }
  }

  const openPortalModal = (client: Client) => {
    setPortalModalClient(client)
    setPortalForm({
      email: client.email || '',
      password: '',
    })
  }

  const submitPortalAccess = async () => {
    if (!portalModalClient) return
    if (!portalModalClient.portal_access && !portalForm.email.trim()) {
      toast.error('Email requerido para crear acceso portal')
      return
    }

    setPortalSaving(true)
    try {
      const payload = {
        email: portalForm.email.trim().toLowerCase() || undefined,
        password: portalForm.password.trim() || undefined,
      }
      const response = (await apiClient.post(
        `/admin/clients/${portalModalClient.id}/portal-access`,
        payload,
      )) as {
        success?: boolean
        created?: boolean
        user?: { email?: string }
        password?: string
      }

      if (!response.success || !response.user?.email || !response.password) {
        throw new Error('No se pudo generar credenciales de portal')
      }

      setClients((prev) =>
        prev.map((item) =>
          item.id === portalModalClient.id
            ? {
                ...item,
                email: response.user?.email || item.email || null,
                portal_access: true,
              }
            : item,
        ),
      )

      setLastPortalCredentials({
        clientName: portalModalClient.name,
        email: response.user.email,
        password: response.password,
      })

      toast.success(response.created ? 'Acceso portal creado' : 'Credenciales portal actualizadas')
      setPortalModalClient(null)
      setPortalForm({ email: '', password: '' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo actualizar acceso portal')
    } finally {
      setPortalSaving(false)
    }
  }

  // ──â”€ action tooltip button helper ──────────────────────────────────────────â”€
  const ActionBtn = ({ color, tip, onClick, children }: { color: string; tip: string; onClick: () => void; children: React.ReactNode }) => (
    <div className="group relative">
      <button type="button" onClick={onClick}
        className={`flex h-8 w-8 items-center justify-center rounded text-white text-xs font-bold shadow ${color} hover:opacity-80 transition`}>
        {children}
      </button>
      <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-white shadow-lg border border-gray-100 px-2 py-1 text-xs text-slate-800 opacity-0 group-hover:opacity-100 transition z-50">
        {tip}
      </span>
    </div>
  )

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-0 rounded-xl border border-gray-200 bg-white backdrop-blur-md shadow-sm overflow-hidden">

      {/* ── Header ── */}
      <div className="border-b border-gray-200 bg-white backdrop-blur-md px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-700">
            <span className="text-green-500">ðŸ‘¥</span> Lista de Clientes
          </h2>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-slate-600 focus:outline-none"
          >
            <option value="all">Todas las Zonas / Estados</option>
            <option value="active">Activos</option>
            <option value="suspended">Suspendidos</option>
            <option value="past_due">Mora</option>
            <option value="inactive">Inactivos</option>
          </select>
          <button
            onClick={() => setShowModal(true)}
            className="ml-auto flex items-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-white hover:bg-green-600 shadow-sm transition"
          >
            <PlusIcon className="h-4 w-4" /> Agregar Cliente
          </button>
        </div>
      </div>

      {/* ── Acción masiva ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-5 py-2">
        <span className="text-sm font-medium text-slate-500">Acción:</span>
        <select
          value={bulkAction}
          onChange={(e) => setBulkAction(e.target.value)}
          className="rounded border border-white/20 px-2 py-1 text-sm text-slate-600"
        >
          <option value="">----------</option>
          <option value="activate">Activar Clientes Seleccionados</option>
          <option value="deactivate">Desactivar Clientes Seleccionados</option>
          <option value="export_csv">Exportar clientes seleccionados (CSV)</option>
          <option value="whatsapp">Enviar WhatsApp a Clientes Seleccionados</option>
          <option value="email">Enviar Correo Personalizado</option>
        </select>
        <button
          onClick={() => void runBulkAction()}
          disabled={runningBulk}
          className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          ▶ Ejecutar
        </button>
        <span className="text-xs text-slate-500">{selectedIds.size} seleccionados/as</span>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-5 py-2">
        {/* Page size */}
        <select
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
          className="rounded border border-white/20 px-2 py-1 text-xs text-slate-600"
        >
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>Mostrar {n} registros</option>)}
        </select>
        {/* Export buttons */}
        <button onClick={() => { const rows = allFiltered; const csv = ['ID,Nombre,Usuario,IP,Estado,LAN,Corte', ...rows.map((c) => `${c.id},"${c.name}",${c.username||''},${c.ip_address||''},${c.status},${c.lan_interface||''},${c.dia_corte??''}`)].join('\n'); const b = new Blob([csv],{type:'text/csv'}); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href=u; a.download='clientes.csv'; a.click(); toast.success('CSV exportado') }}
          className="rounded border border-white/20 bg-white backdrop-blur-md px-2 py-1 text-xs text-slate-500 hover:bg-white/10" title="Exportar CSV">CSV</button>

        <span className="ml-2 text-xs font-semibold text-slate-500">Botonas de Acción:</span>

        <ActionBtn color="bg-green-500" tip="Generar Factura" onClick={() => { if(selectedIds.size===0){toast('Selecciona clientes');return} toast('Generar factura â€” próximamente') }}>$</ActionBtn>
        <ActionBtn color="bg-green-600" tip="Activar Cliente" onClick={() => { selectedIds.forEach((id)=>void activate(id)); toast.success('Activandoâ€¦') }}>▶</ActionBtn>
        <ActionBtn color="bg-orange-500" tip="Desactivar Cliente" onClick={() => { selectedIds.forEach((id)=>void suspend(id)); toast.success('Desactivandoâ€¦') }}>â¸</ActionBtn>
        <ActionBtn color="bg-yellow-500" tip="Agregar Ticket" onClick={() => toast('Agregar Ticket â€” próximamente')}>🎟️</ActionBtn>
        <ActionBtn color="bg-blue-500" tip="Ver TrÃ¡fico" onClick={() => toast('Ver TrÃ¡fico â€” próximamente')}>📊</ActionBtn>
        <ActionBtn color="bg-violet-600" tip="Ver ONU" onClick={() => { const id = Array.from(selectedIds)[0]; if(id){const c=clients.find(x=>x.id===id); if(c) openGponModal(c)} else toast('Selecciona un cliente') }}>📡</ActionBtn>
        <ActionBtn color="bg-teal-500" tip="Portal Cliente" onClick={() => { const id = Array.from(selectedIds)[0]; if(id){const c=clients.find(x=>x.id===id); if(c) openPortalModal(c)} else toast('Selecciona un cliente') }}>🔑</ActionBtn>

        {/* Herramientas */}
        <div className="relative ml-1" ref={herramientasRef}>
          <button
            onClick={() => setHerramientasId(herramientasId === -1 ? null : -1)}
            className="flex items-center gap-1 rounded border border-white/20 bg-white backdrop-blur-md px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white/10"
          >
            ðŸ”§ Herramientas <ChevronDownIcon className="h-3 w-3" />
          </button>
          {herramientasId === -1 && (
            <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-gray-200 bg-white backdrop-blur-md shadow-2xl py-1">
              {[
                { label: 'âš¡ Torch al Cliente', key: 'torch' },
                { label: 'ðŸ” Actualizar Password', key: 'password' },
                { label: 'ðŸ‘ Auto-Login Portal del Cliente', key: 'portal_login' },
                { label: 'ðŸ’³ Ver Historial de Pagos', key: 'pagos' },
                { label: '🎟️ Ver Historial de Tickets', key: 'tickets' },
                { label: 'ðŸ“‹ Ver Log', key: 'log' },
                { label: 'ðŸ”— Hacer Amarrar IP-MAC', key: 'mac' },
                { label: 'ðŸš« Cancelar Cliente', key: 'cancelar' },
                { label: 'ðŸ—‘ Eliminar Cliente de FASTISP + RB', key: 'delete' },
                { label: '📶 Cambiar Contraseña WiFi', key: 'wifi_pass' },
                { label: '🔄 Recalcular información del cliente', key: 'recalc' },
              ].map(({ label, key }) => (
                <button key={key} onClick={() => {
                    const id = Array.from(selectedIds)[0]
                    const c = id ? clients.find((x) => x.id === id) : null
                    if (!c) { toast('Selecciona un cliente primero'); return }
                    void herramientasAction(key, c)
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-slate-600 hover:bg-white/10 transition"
                >{label}</button>
              ))}
            </div>
          )}
        </div>

        {/* Buscar global */}
        <div className="relative ml-auto">
          <MagnifyingGlassIcon className="absolute left-2 top-1.5 h-4 w-4 text-slate-500" />
          <input
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1) }}
            placeholder="Buscar..."
            className="rounded border border-white/20 py-1 pl-7 pr-3 text-sm text-white"
          />
        </div>
      </div>

      {/* ── Credenciales banner ── */}
      {lastPortalCredentials && (
        <div className="mx-5 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-emerald-700">Credenciales portal generadas â€” {lastPortalCredentials.clientName}</p>
          <p className="text-emerald-900">Email: <strong>{lastPortalCredentials.email}</strong> Â· Password: <strong>{lastPortalCredentials.password}</strong></p>
          <button onClick={() => setLastPortalCredentials(null)} className="mt-1 text-xs text-emerald-600 underline">Cerrar</button>
        </div>
      )}

      {/* ── Tabla ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-white text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left w-8">
                <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} className="cursor-pointer" />
              </th>
              <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => setSortBy('name')}>
                Nombre {sortBy === 'name' && '↑'}
              </th>
              <th className="px-3 py-2 text-left">Usuario</th>
              <th className="px-3 py-2 text-left">IP</th>
              <th className="px-3 py-2 text-center">Enviar Avisos en Pantalla</th>
              <th className="px-3 py-2 text-left">Interfaz LAN</th>
              <th className="px-3 py-2 text-left">Día de Corte</th>
              <th className="px-3 py-2 text-right">Acción</th>
            </tr>
            {/* Per-column search row */}
            <tr className="bg-white backdrop-blur-md border-b border-white/5">
              <td />
              <td className="px-2 py-1"><input value={colSearch.name} onChange={(e)=>setColSearch(p=>({...p,name:e.target.value}))} placeholder="Buscar Nombre" className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-slate-600" /></td>
              <td className="px-2 py-1"><input value={colSearch.username} onChange={(e)=>setColSearch(p=>({...p,username:e.target.value}))} placeholder="Buscar Usuario" className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-slate-600" /></td>
              <td className="px-2 py-1"><input value={colSearch.ip} onChange={(e)=>setColSearch(p=>({...p,ip:e.target.value}))} placeholder="Buscar IP" className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-slate-600" /></td>
              <td className="px-2 py-1 text-center"><input value={colSearch.lan_interface} onChange={(e)=>setColSearch(p=>({...p,lan_interface:e.target.value}))} placeholder="Buscar" className="w-24 rounded border border-gray-200 px-2 py-1 text-xs text-slate-600" /></td>
              <td className="px-2 py-1"><input value={colSearch.lan_interface} onChange={(e)=>setColSearch(p=>({...p,lan_interface:e.target.value}))} placeholder="Buscar Interfaz" className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-slate-600" /></td>
              <td className="px-2 py-1"><input value={colSearch.dia_corte} onChange={(e)=>setColSearch(p=>({...p,dia_corte:e.target.value}))} placeholder="Buscar Día" className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-slate-600" /></td>
              <td className="px-2 py-1 text-right"><button onClick={()=>setColSearch({name:'',username:'',ip:'',lan_interface:'',dia_corte:''})} className="rounded bg-white/15 px-2 py-1 text-xs text-slate-500 hover:bg-gray-300">Limpiar</button></td>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && (
              <tr><td colSpan={8} className="py-8 text-center text-sm text-slate-500">
                <ArrowPathIcon className="mx-auto h-6 w-6 animate-spin mb-2" />Cargando...
              </td></tr>
            )}
            {!loading && filteredClients.map((client, idx) => (
              <motion.tr key={client.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.01 }}
                className={`hover:bg-blue-500/10 transition-colors ${selectedIds.has(client.id) ? 'bg-blue-500/10' : ''}`}
              >
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selectedIds.has(client.id)} onChange={() => toggleSelect(client.id)} className="cursor-pointer" />
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-white">{client.name}</div>
                  <div className="text-xs text-slate-500">{client.email || ''}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{client.username || '-'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{client.ip_address || '-'}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${client.avisos_pantalla ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-slate-500'}`}>
                    {client.avisos_pantalla ? 'Si' : 'No'}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{client.lan_interface || '-'}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{client.dia_corte ?? '-'}</td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex items-center gap-1">
                    {/* Row Herramientas */}
                    <div className="relative" ref={herramientasId === client.id ? herramientasRef : undefined}>
                      <button
                        onClick={() => setHerramientasId(herramientasId === client.id ? null : client.id)}
                        title="Herramientas"
                        className="flex h-7 w-7 items-center justify-center rounded bg-teal-500 text-white text-xs hover:opacity-80"
                      >ðŸ”§</button>
                      {herramientasId === client.id && (
                        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-gray-200 bg-white backdrop-blur-md shadow-2xl py-1">
                          {[
                            { label: 'ðŸ‘ Portal auto-login', key: 'portal_login' },
                            { label: 'ðŸ” Actualizar Password', key: 'password' },
                            { label: 'ðŸ’³ Historial de Pagos', key: 'pagos' },
                            { label: '🎟️ Historial de Tickets', key: 'tickets' },
                            { label: 'ðŸ”— Amarrar IP-MAC', key: 'mac' },
                            { label: '📡 Ver ONU GPON', key: 'gpon' },
                            { label: '▶ Activar Cliente', key: 'activate' },
                            { label: 'â¸ Suspender Cliente', key: 'suspend' },
                            { label: 'ðŸ—‘ Eliminar Cliente', key: 'delete' },
                          ].map(({ label, key }) => (
                            <button key={key}
                              onClick={() => void herramientasAction(key, client)}
                              className="block w-full px-4 py-2 text-left text-sm text-slate-600 hover:bg-white/10"
                            >{label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Edit button (orange) */}
                    <button title="Editar" onClick={() => toast(`Editar ${client.name} — próximamente`)}
                      className="flex h-7 w-7 items-center justify-center rounded bg-orange-400 text-white text-xs hover:opacity-80">✎ </button>
                    {/* View button (blue) */}
                    <button title="Ver detalle" onClick={() => openPortalModal(client)}
                      className="flex h-7 w-7 items-center justify-center rounded bg-blue-500 text-white text-xs hover:opacity-80">👤 </button>
                  </div>
                </td>
              </motion.tr>
            ))}
            {!loading && filteredClients.length === 0 && (
              <tr><td colSpan={8} className="py-10 text-center text-sm text-slate-500">No se encontraron clientes</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-white px-5 py-3">
        <span className="text-xs text-slate-500">
          Mostrando {Math.min((page-1)*pageSize+1, initData?.total || 0)}–{Math.min(page*pageSize, initData?.total || 0)} de {initData?.total || 0} registros totales
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(1)} disabled={page===1} className="rounded border border-white/20 px-2 py-1 text-xs text-slate-500 disabled:opacity-40">Â«</button>
          <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={page===1} className="rounded border border-white/20 px-2 py-1 text-xs text-slate-500 disabled:opacity-40">Anterior</button>
          {Array.from({length: Math.min(5,totalPages)}, (_,i) => {
            const p = page <= 3 ? i+1 : page - 2 + i
            if (p < 1 || p > totalPages) return null
            return <button key={p} onClick={()=>setPage(p)} className={`rounded border px-2 py-1 text-xs ${p===page ? 'border-blue-500 bg-blue-500 text-white' : 'border-white/20 text-slate-500'}`}>{p}</button>
          })}
          <button onClick={() => setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages} className="rounded border border-white/20 px-2 py-1 text-xs text-slate-500 disabled:opacity-40">Siguiente</button>
          <button onClick={() => setPage(totalPages)} disabled={page===totalPages} className="rounded border border-white/20 px-2 py-1 text-xs text-slate-500 disabled:opacity-40">Â»</button>
        </div>
      </div>

      {/* ── Footer stats ── */}
      <div className="grid grid-cols-4 border-t border-gray-200 bg-white backdrop-blur-md divide-x divide-white/10">
        {[
          { label: 'Total', value: clients.length, color: 'text-white' },
          { label: 'Activos', value: clients.filter(c=>c.status==='active').length, color: 'text-green-600' },
          { label: 'Suspendidos', value: clients.filter(c=>c.status==='suspended').length, color: 'text-rose-600' },
          { label: 'Mora', value: clients.filter(c=>c.status==='past_due').length, color: 'text-amber-600' },
        ].map(({label,value,color}) => (
          <div key={label} className="px-4 py-3 text-center">
            <div className={`text-xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </div>
        ))}
      </div>

      {/* ── Modals ──────────────────────────────────────────── */}
      {showModal && renderModal(
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:p-4"
          onClick={() => { setShowModal(false); setClientTab(1) }}>
          <div className="my-2 flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white backdrop-blur-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center gap-3 border-b bg-white backdrop-blur-md px-6 py-4">
              <span className="text-2xl">👤</span>
              <h3 className="text-xl font-bold text-white">Agregar Cliente</h3>
              <button onClick={() => { setShowModal(false); setClientTab(1) }} className="ml-auto rounded-full p-2 hover:bg-white/10">
                <XMarkIcon className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b bg-white">
              {[
                { id: 1 as const, label: 'Datos de Conexión', icon: '📶' },
                { id: 2 as const, label: 'Datos del Cliente', icon: 'ℹ️' },
                { id: 3 as const, label: 'Facturación',       icon: '🧾' },
                { id: 4 as const, label: 'Config. Avanzada',  icon: '⚙️' },
              ].map(({ id, label, icon }) => (
                <button key={id} type="button" onClick={() => setClientTab(id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-3 text-xs font-semibold transition ${clientTab === id ? 'border-green-500 bg-white backdrop-blur-md text-emerald-400' : 'border-transparent text-slate-500 hover:text-slate-600'}`}>
                  <span>{icon}</span><span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">

              {/* ── Tab 1: Datos de Conexión ── */}
              {clientTab === 1 && (
                <div className="p-6 space-y-4">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-slate-600">📶 Datos de Conexión</h4>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="label-ws">Nombre Secret PPPoE</label>
                      <input className="input-ws" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="0162" />
                    </div>
                    <div>
                      <label className="label-ws">Password PPPoE</label>
                      <input className="input-ws" value={form.pppoe_password} onChange={(e) => setForm({ ...form, pppoe_password: e.target.value })} placeholder="3es65cf3" />
                    </div>
                    <div>
                      <label className="label-ws">Remote Address PPPoE</label>
                      <input className="input-ws" value={form.remote_address_pppoe} onChange={(e) => setForm({ ...form, remote_address_pppoe: e.target.value })} placeholder="10.0.0.1" />
                    </div>
                    <div>
                      <label className="label-ws">Local Address PPPoE</label>
                      <input className="input-ws" value={form.local_address_pppoe} onChange={(e) => setForm({ ...form, local_address_pppoe: e.target.value })} placeholder="10.0.0.254" />
                    </div>
                    <div>
                      <label className="label-ws">Mac CPE</label>
                      <input className="input-ws font-mono" value={form.mac_address} onChange={(e) => setForm({ ...form, mac_address: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" />
                    </div>
                    <div>
                      <label className="label-ws">Coordenadas</label>
                      <input className="input-ws" value={form.coordinates} onChange={(e) => setForm({ ...form, coordinates: e.target.value })} placeholder="21.150188,-86.875023" />
                    </div>
                    <div>
                      <label className="label-ws">Router cliente</label>
                      <select className="input-ws" value={form.router_id} onChange={(e) => setForm({ ...form, router_id: e.target.value })}>
                        <option value="">Seleccionar Router...</option>
                        {routers.map((r) => <option key={r.id} value={r.id}>{r.name}{r.ip_address ? ` (${r.ip_address})` : ''}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label-ws">Zona cliente</label>
                      <select className="input-ws" value={form.router_id} onChange={(e) => setForm({ ...form, router_id: e.target.value })}>
                        <option value="">Seleccionar Zona...</option>
                        {routers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label-ws">Plan internet</label>
                      <select className="input-ws" value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
                        <option value="">Seleccionar plan...</option>
                        {plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.download_speed ? ` (${p.download_speed}/${p.upload_speed} Mbps)` : ''}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label-ws">Sectorial/Nodo/NAP</label>
                      <input className="input-ws" value={form.sectorial_nap} onChange={(e) => setForm({ ...form, sectorial_nap: e.target.value })} placeholder="NAP-01" />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Tab 2: Datos del Cliente ── */}
              {clientTab === 2 && (
                <div className="p-6 space-y-4">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-slate-600">ℹ️ Datos del cliente</h4>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="label-ws">Nombre</label>
                      <input className="input-ws" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Juan" />
                    </div>
                    <div>
                      <label className="label-ws">Apellido</label>
                      <input className="input-ws" value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} placeholder="Pérez" />
                    </div>
                    <div>
                      <label className="label-ws">DNI / C.I. / C.C.</label>
                      <input className="input-ws" value={form.dni} onChange={(e) => setForm({ ...form, dni: e.target.value })} placeholder="12345678" />
                    </div>
                    <div>
                      <label className="label-ws">Dirección de correo electrónico</label>
                      <input className="input-ws" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="cliente@correo.com" />
                    </div>
                    <div>
                      <label className="label-ws">External ID</label>
                      <input className="input-ws" value={form.external_id} onChange={(e) => setForm({ ...form, external_id: e.target.value })} placeholder="EXT-001" />
                    </div>
                    <div>
                      <label className="label-ws">Teléfono Celular</label>
                      <input className="input-ws" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 0000" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label-ws">Dirección</label>
                      <textarea className="input-ws resize-none" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Calle, número, colonia..." />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label-ws">Barrio / Localidad / Departamento</label>
                      <input className="input-ws" value={form.barrio} onChange={(e) => setForm({ ...form, barrio: e.target.value })} placeholder="Escribe el nombre de la localidad" />
                    </div>
                    <div>
                      <label className="label-ws">Ciudad / Municipio</label>
                      <input className="input-ws" value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })} placeholder="Ciudad" />
                    </div>
                    <div>
                      <label className="label-ws">Código Postal</label>
                      <input className="input-ws" value={form.codigo_postal} onChange={(e) => setForm({ ...form, codigo_postal: e.target.value })} placeholder="00000" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label-ws">Forma de contratación</label>
                      <select className="input-ws" value={form.forma_contratacion} onChange={(e) => setForm({ ...form, forma_contratacion: e.target.value })}>
                        <option value="">-----------</option>
                        <option value="mensual">Mensual</option>
                        <option value="trimestral">Trimestral</option>
                        <option value="semestral">Semestral</option>
                        <option value="anual">Anual</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Tab 3: Facturación ── */}
              {clientTab === 3 && (
                <div className="p-6 space-y-5">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                    ⚠ NOTA: Solo edite estos campos si desea que el cliente tenga fecha de corte y facturación diferente a su Zona.
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="label-ws">Tipo</label>
                      <select className="input-ws" value={form.tipo_cliente} onChange={(e) => setForm({ ...form, tipo_cliente: e.target.value })}>
                        <option value="prepago">Prepago</option>
                        <option value="postpago">Postpago</option>
                      </select>
                    </div>
                    <div>
                      <label className="label-ws">Suspender servicio</label>
                      <select className="input-ws" value={form.suspender_facturas} onChange={(e) => setForm({ ...form, suspender_facturas: e.target.value })}>
                        {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} Factura{n>1?'s':''} Vencida{n>1?'s':''}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label-ws">Día de corte (día del mes)</label>
                      <select className="input-ws" value={form.dia_corte} onChange={(e) => setForm({ ...form, dia_corte: e.target.value })}>
                        {Array.from({length:28},(_,i)=><option key={i+1} value={i+1}>Día {i+1} de cada mes</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label-ws">Día de factura (día del mes)</label>
                      <select className="input-ws" value={form.dia_factura} onChange={(e) => setForm({ ...form, dia_factura: e.target.value })}>
                        {Array.from({length:28},(_,i)=><option key={i+1} value={i+1}>Día {i+1} de cada mes</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label-ws">Día de pago (día del mes)</label>
                      <select className="input-ws" value={form.dia_pago} onChange={(e) => setForm({ ...form, dia_pago: e.target.value })}>
                        {Array.from({length:28},(_,i)=><option key={i+1} value={i+1}>Día {i+1} de cada mes</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label-ws">Impuestos (%)</label>
                      <input className="input-ws" type="number" min="0" max="100" value={form.impuestos} onChange={(e) => setForm({ ...form, impuestos: e.target.value })} placeholder="0" />
                    </div>
                  </div>

                  {/* Toggle helper */}
                  {(() => {
                    const Toggle = ({ label, val, field }: { label: string; val: boolean; field: string }) => (
                      <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                        <span className="text-sm text-slate-600">{label}</span>
                        <button type="button" onClick={() => setForm((p) => ({ ...p, [field]: !val }))}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${val ? 'bg-blue-500' : 'bg-gray-300'}`}>
                          <span className={`inline-block h-5 w-5 transform rounded-full bg-white backdrop-blur-md shadow transition-transform ${val ? 'translate-x-5' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    )
                    return (
                      <div className="space-y-3">
                        <p className="text-xs font-bold uppercase text-green-600">● Tareas Periódicas</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Toggle label="Realizar Corte Automáticamente" val={form.corte_automatico} field="corte_automatico" />
                          <Toggle label="Realizar Facturas Automáticamente" val={form.facturas_automaticas} field="facturas_automaticas" />
                          <Toggle label="Realizar Avisos en Pantalla" val={form.avisos_pantalla} field="avisos_pantalla" />
                          <Toggle label="Enviar Notificaciones Push" val={form.notificaciones_push} field="notificaciones_push" />
                        </div>
                        <p className="text-xs font-bold uppercase text-green-600">● Correos Automáticos</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Toggle label="Recibir Correo de Corte" val={form.correo_corte} field="correo_corte" />
                          <Toggle label="Recibir Correo de Facturas" val={form.correo_facturas} field="correo_facturas" />
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* ── Tab 4: Configuración Avanzada ── */}
              {clientTab === 4 && (
                <div className="p-6 space-y-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="label-ws">Password Portal Cliente</label>
                      <div className="flex gap-2">
                        <input className="input-ws flex-1" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Auto-generado" />
                        <button type="button" onClick={() => setForm((p) => ({ ...p, password: Math.random().toString(36).slice(2,10) }))}
                          className="rounded-lg bg-white/15 px-2 py-1 text-xs text-slate-600 hover:bg-gray-300">Gen</button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 self-end">
                      <span className="text-sm text-slate-600">Firewall</span>
                      <button type="button" onClick={() => setForm((p) => ({ ...p, firewall_enabled: !p.firewall_enabled }))}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${form.firewall_enabled ? 'bg-blue-500' : 'bg-gray-300'}`}>
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white backdrop-blur-md shadow transition-transform ${form.firewall_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                    </div>
                    <div>
                      <label className="label-ws">Sistema ID</label>
                      <input className="input-ws" value={form.sistema_id} onChange={(e) => setForm({ ...form, sistema_id: e.target.value })} placeholder="SIS-001" />
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <input type="checkbox" id="portal_cb" checked={form.create_portal_access} onChange={(e) => setForm({ ...form, create_portal_access: e.target.checked })} className="h-4 w-4" />
                      <label htmlFor="portal_cb" className="text-sm font-semibold text-slate-600">Crear acceso al portal cliente</label>
                    </div>
                  </div>

                  <p className="text-xs font-bold uppercase text-green-600">● Datos de CPE o Radio</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="label-ws">Modelo Antena</label>
                      <input className="input-ws" value={form.modelo_antena} onChange={(e) => setForm({ ...form, modelo_antena: e.target.value })} placeholder="Ubiquiti NanoStation" />
                    </div>
                    <div>
                      <label className="label-ws">Password Antena</label>
                      <input className="input-ws" value={form.password_antena} onChange={(e) => setForm({ ...form, password_antena: e.target.value })} placeholder="ubnt" />
                    </div>
                    <div>
                      <label className="label-ws">Protocolo de Conexión</label>
                      <select className="input-ws" value={form.protocolo_conexion} onChange={(e) => setForm({ ...form, protocolo_conexion: e.target.value })}>
                        <option value="">-----------</option>
                        <option value="pppoe">PPPoE</option>
                        <option value="dhcp">DHCP</option>
                        <option value="static">IP Estática</option>
                        <option value="bridge">Bridge</option>
                      </select>
                    </div>
                  </div>

                  <p className="text-xs font-bold uppercase text-green-600">● Datos del Router WiFi</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="label-ws">IP router wifi</label>
                      <input className="input-ws" value={form.ip_router_wifi} onChange={(e) => setForm({ ...form, ip_router_wifi: e.target.value })} placeholder="192.168.1.1" />
                    </div>
                    <div>
                      <label className="label-ws">Modelo Router Wifi</label>
                      <input className="input-ws" value={form.modelo_router_wifi} onChange={(e) => setForm({ ...form, modelo_router_wifi: e.target.value })} placeholder="TP-Link Archer" />
                    </div>
                    <div>
                      <label className="label-ws">Usuario router wifi</label>
                      <input className="input-ws" value={form.usuario_router_wifi} onChange={(e) => setForm({ ...form, usuario_router_wifi: e.target.value })} placeholder="admin" />
                    </div>
                    <div>
                      <label className="label-ws">Password router wifi</label>
                      <input className="input-ws" value={form.password_router_wifi} onChange={(e) => setForm({ ...form, password_router_wifi: e.target.value })} placeholder="admin123" />
                    </div>
                    <div>
                      <label className="label-ws">SSID router wifi</label>
                      <input className="input-ws" value={form.ssid_router_wifi} onChange={(e) => setForm({ ...form, ssid_router_wifi: e.target.value })} placeholder="WiFi-Cliente" />
                    </div>
                    <div>
                      <label className="label-ws">Password SSID wifi</label>
                      <input className="input-ws" value={form.password_ssid_wifi} onChange={(e) => setForm({ ...form, password_ssid_wifi: e.target.value })} placeholder="En-una_XXXXX" />
                    </div>
                    <div>
                      <label className="label-ws">Mac router wifi</label>
                      <input className="input-ws font-mono" value={form.mac_router_wifi} onChange={(e) => setForm({ ...form, mac_router_wifi: e.target.value })} placeholder="AA:BB:CC:DD:EE:FF" />
                    </div>
                  </div>
                  <div>
                    <label className="label-ws">Comentarios</label>
                    <textarea className="input-ws resize-none" rows={3} value={form.comentarios} onChange={(e) => setForm({ ...form, comentarios: e.target.value })} placeholder="Observaciones del cliente..." />
                  </div>

                  <p className="text-xs font-bold uppercase text-green-600">● Datos Fiscales (Opcional)</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="label-ws">Razón Social</label>
                      <input className="input-ws" value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} placeholder="Empresa S.A." />
                    </div>
                    <div>
                      <label className="label-ws">RUC / NIT / NIF</label>
                      <input className="input-ws" value={form.ruc_nit} onChange={(e) => setForm({ ...form, ruc_nit: e.target.value })} placeholder="20123456789" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t bg-white px-6 py-4">
              <div className="flex gap-2">
                {clientTab > 1 && (
                  <button type="button" onClick={() => setClientTab((t) => Math.max(1, t - 1) as 1|2|3|4)}
                    className="rounded-lg border border-white/20 px-4 py-2 text-sm text-slate-600 hover:bg-white/10">← Anterior</button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowModal(false); setClientTab(1) }}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm text-slate-600 hover:bg-white">Cancelar</button>
                {clientTab < 4 ? (
                  <button type="button" onClick={() => setClientTab((t) => Math.min(4, t + 1) as 1|2|3|4)}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Siguiente →</button>
                ) : (
                  <button onClick={() => void submitClient()} disabled={saving}
                    className="inline-flex items-center gap-2 rounded-lg bg-green-500 px-5 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-60">
                    {saving ? <><ArrowPathIcon className="h-4 w-4 animate-spin" /> Guardando...</> : '💾 Guardar cliente'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GPON Modal */}
      {gponClient && renderModal(
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6" onClick={() => setGponClient(null)}>
          <div className="my-4 w-full max-w-2xl overflow-hidden rounded-2xl bg-white backdrop-blur-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b bg-violet-500/10 px-6 py-4">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Provisión GPON</p>
                <h3 className="text-lg font-bold text-white">Autorizar ONU â€” {gponClient.name}</h3></div>
              <button onClick={() => setGponClient(null)} className="rounded-full p-2 hover:bg-violet-500/20"><XMarkIcon className="h-5 w-5 text-slate-500" /></button>
            </div>
            <div className="flex border-b">
              {[1,2,3].map((s) => (<div key={s} className={`flex-1 py-2 text-center text-xs font-semibold ${gponStep===s?'border-b-2 border-violet-500 text-violet-700':'text-slate-500'}`}>{s===1?'1. OLT + PON':s===2?'2. Seleccionar ONU':'3. Resultado'}</div>))}
            </div>
            <div className="max-h-[65vh] overflow-y-auto p-6">
              {gponStep===1 && (
                <div className="space-y-4">
                  <div><label className="mb-1 block text-sm font-semibold text-slate-600">Dispositivo OLT</label>
                    <select value={gponDeviceId} onChange={e=>setGponDeviceId(e.target.value)} className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm">
                      <option value="">Seleccionar OLT...</option>
                      {oltDevices.map(d=><option key={d.id} value={d.id}>{d.name} ({d.vendor}) {d.host?`â€” ${d.host}`:''}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><label className="mb-1 block text-xs font-semibold text-slate-500">Frame</label><input type="number" min="0" value={gponFrame} onChange={e=>setGponFrame(e.target.value)} className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm" /></div>
                    <div><label className="mb-1 block text-xs font-semibold text-slate-500">Slot</label><input type="number" min="0" value={gponSlot} onChange={e=>setGponSlot(e.target.value)} className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm" /></div>
                    <div><label className="mb-1 block text-xs font-semibold text-slate-500">Puerto PON</label><input type="number" min="1" value={gponPon} onChange={e=>setGponPon(e.target.value)} className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm" /></div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setGponClient(null)} className="rounded-lg border border-white/20 px-4 py-2 text-sm text-slate-600">Cancelar</button>
                    <button onClick={async()=>{await searchPendingOnus();setGponStep(2)}} disabled={searchingOnus||!gponDeviceId}
                      className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                      {searchingOnus?<ArrowPathIcon className="h-4 w-4 animate-spin"/>:<SignalIcon className="h-4 w-4"/>}
                      {searchingOnus?'Buscando...':'Buscar ONUs pendientes'}
                    </button>
                  </div>
                </div>
              )}
              {gponStep===2 && (
                <div className="space-y-4">
                  <p className="mb-2 text-sm font-semibold text-slate-600">ONUs encontradas:</p>
                  {pendingOnus.length>0?(
                    <div className="space-y-2">{pendingOnus.map((onu,i)=>(
                      <button key={i} onClick={()=>{setGponSerial(onu.serial);setGponOnu(String(onu.onu||i+1))}}
                        className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition ${gponSerial===onu.serial?'border-violet-500 bg-violet-500/10':'border-gray-200 hover:border-violet-300'}`}>
                        <div className="flex items-center justify-between"><span className="font-mono font-semibold">{onu.serial}</span>{gponSerial===onu.serial&&<CheckCircleIcon className="h-5 w-5 text-violet-600"/>}</div>
                        <div className="mt-1 text-xs text-slate-500">{onu.vendor&&<span className="mr-3">{onu.vendor}</span>}{onu.model&&<span>{onu.model}</span>}</div>
                      </button>
                    ))}</div>
                  ):(
                    <div className="rounded-lg border border-dashed border-white/20 p-4 text-center text-sm text-slate-500">No se encontraron ONUs pendientes.</div>
                  )}
                  <div><label className="mb-1 block text-xs font-semibold text-slate-600">Serial ONU (manual)</label>
                    <input value={gponSerial} onChange={e=>setGponSerial(e.target.value)} placeholder="ZTEG12345678" className="w-full rounded-lg border border-white/20 px-3 py-2 font-mono text-sm" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="mb-1 block text-xs font-semibold text-slate-600">VLAN</label><input type="number" value={gponVlan} onChange={e=>setGponVlan(e.target.value)} className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm" /></div>
                    <div><label className="mb-1 block text-xs font-semibold text-slate-600">Tipo WAN</label>
                      <select value={gponWanType} onChange={e=>setGponWanType(e.target.value)} className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm">
                        <option value="pppoe">PPPoE</option><option value="dhcp">DHCP</option><option value="static">IP Estática</option><option value="bridge">Bridge</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-between gap-2">
                    <button onClick={()=>setGponStep(1)} className="rounded-lg border border-white/20 px-4 py-2 text-sm text-slate-600">â† Atrás</button>
                    <button onClick={()=>void authorizeOnu()} disabled={authorizingOnu||!gponSerial}
                      className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                      {authorizingOnu?<ArrowPathIcon className="h-4 w-4 animate-spin"/>:<CheckCircleIcon className="h-4 w-4"/>}
                      {authorizingOnu?'Autorizando...':'Autorizar ONU'}
                    </button>
                  </div>
                </div>
              )}
              {gponStep===3&&gponResult&&(
                <div className="space-y-4 text-center">
                  <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${gponResult.success?'bg-emerald-100':'bg-rose-500/20'}`}>
                    {gponResult.success?<CheckCircleIcon className="h-10 w-10 text-emerald-600"/>:<XMarkIcon className="h-10 w-10 text-red-600"/>}
                  </div>
                  <p className={`text-sm font-semibold ${gponResult.success?'text-emerald-700':'text-rose-400'}`}>{gponResult.message}</p>
                  <button onClick={()=>setGponClient(null)} className="rounded-lg bg-violet-600 px-6 py-2 text-sm font-semibold text-white">Cerrar</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Portal access modal */}
      {portalModalClient && renderModal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setPortalModalClient(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white backdrop-blur-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase text-blue-600">Portal cliente</p>
                <h3 className="text-lg font-bold text-white">{portalModalClient.name}</h3>
              </div>
              <button onClick={() => setPortalModalClient(null)} className="rounded-full p-2 hover:bg-white/10"><XMarkIcon className="h-5 w-5 text-slate-500" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1">Email</label>
                <input value={portalForm.email} onChange={(e)=>setPortalForm(p=>({...p,email:e.target.value}))} placeholder="cliente@correo.com" className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1">Nueva contraseÃ±a (opcional)</label>
                <input type="password" value={portalForm.password} onChange={(e)=>setPortalForm(p=>({...p,password:e.target.value}))} placeholder="Auto-generada si se deja vacío" className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button onClick={() => setPortalModalClient(null)} className="rounded-lg border border-white/20 px-4 py-2 text-sm text-slate-600">Cancelar</button>
              <button onClick={() => void submitPortalAccess()} disabled={portalSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                <KeyIcon className="h-4 w-4" />{portalSaving ? 'Guardando...' : 'Guardar credenciales'}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}

export default ClientsManagement
