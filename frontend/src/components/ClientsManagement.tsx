import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  active: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Activo' },
  inactive: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Inactivo' },
  suspended: { bg: 'bg-rose-100', text: 'text-rose-800', label: 'Suspendido' },
  past_due: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Mora' },
  trial: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Trial' },
}

const emptyClientForm = {
  name: '',
  plan_id: '',
  router_id: '',
  ip_address: '',
  connection_type: 'pppoe',
  pppoe_username: '',
  pppoe_password: '',
  email: '',
  password: '',
  create_portal_access: true,
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
  // WispHub-style additions
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

  const load = async () => {
    setLoading(true)
    try {
      void loadOltDevices()
    const [clientsResp, plansResp, routersResp] = await Promise.allSettled([
        apiClient.get('/admin/clients'),
        apiClient.get('/plans'),
        apiClient.get('/mikrotik/routers'),
      ])

      if (clientsResp.status === 'fulfilled') setClients(clientsResp.value.items || [])
      if (plansResp.status === 'fulfilled') setPlans(plansResp.value.items || [])
      if (routersResp.status === 'fulfilled') {
        setRouters(routersResp.value.routers || routersResp.value.items || [])
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudieron cargar los datos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

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
        const q = searchTerm.trim().toLowerCase()
        const matchesGlobal =
          !q ||
          item.name.toLowerCase().includes(q) ||
          String(item.username || '').toLowerCase().includes(q) ||
          String(item.ip_address || '').includes(q) ||
          String(item.email || '').toLowerCase().includes(q)
        const matchesStatus = filterStatus === 'all' || item.status === filterStatus
        const matchesName = !colSearch.name || item.name.toLowerCase().includes(colSearch.name.toLowerCase())
        const matchesUser = !colSearch.username || String(item.username || '').toLowerCase().includes(colSearch.username.toLowerCase())
        const matchesIp   = !colSearch.ip || String(item.ip_address || '').includes(colSearch.ip)
        const matchesLan  = !colSearch.lan_interface || String(item.lan_interface || '').toLowerCase().includes(colSearch.lan_interface.toLowerCase())
        const matchesDia  = !colSearch.dia_corte || String(item.dia_corte ?? '').includes(colSearch.dia_corte)
        return matchesGlobal && matchesStatus && matchesName && matchesUser && matchesIp && matchesLan && matchesDia
      })
      .sort((a, b) => {
        if (sortBy === 'plan') return String(a.plan || '').localeCompare(String(b.plan || ''))
        return String(a.name || '').localeCompare(String(b.name || ''))
      })
  }, [clients, filterStatus, searchTerm, sortBy, colSearch])

  const totalPages = Math.max(1, Math.ceil(allFiltered.length / pageSize))
  const filteredClients = useMemo(() => {
    const start = (page - 1) * pageSize
    return allFiltered.slice(start, start + pageSize)
  }, [allFiltered, page, pageSize])

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
        toast('AcciÃ³n no implementada aÃºn')
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
      try {
        await apiClient.post(`/admin/clients/${client.id}/mac-binding`)
        toast.success('Amarrar IP-MAC solicitado')
      } catch { toast.error('No se pudo amarrar IP-MAC') }
      return
    }
    toast(`"${action}" para ${client.name} â€” prÃ³ximamente`)
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
    if (!form.name.trim() || !form.plan_id) {
      toast.error('Nombre y plan son obligatorios')
      return
    }
    if (form.create_portal_access && !form.email.trim()) {
      toast.error('Email obligatorio para acceso portal')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        plan_id: Number(form.plan_id),
        router_id: form.router_id ? Number(form.router_id) : undefined,
        ip_address: form.ip_address.trim() || undefined,
        connection_type: form.connection_type,
        pppoe_username: form.pppoe_username.trim() || undefined,
        pppoe_password: form.pppoe_password.trim() || undefined,
        email: form.email.trim().toLowerCase() || undefined,
        password: form.password.trim() || undefined,
        create_portal_access: form.create_portal_access,
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

  // â”€â”€â”€ action tooltip button helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const ActionBtn = ({ color, tip, onClick, children }: { color: string; tip: string; onClick: () => void; children: React.ReactNode }) => (
    <div className="group relative">
      <button type="button" onClick={onClick}
        className={`flex h-8 w-8 items-center justify-center rounded text-white text-xs font-bold shadow ${color} hover:opacity-80 transition`}>
        {children}
      </button>
      <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition z-50">
        {tip}
      </span>
    </div>
  )

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-0 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">

      {/* â”€â”€ Header â”€â”€ */}
      <div className="border-b border-gray-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800">
            <span className="text-green-500">ðŸ‘¥</span> Lista de Clientes
          </h2>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 focus:outline-none"
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

      {/* â”€â”€ AcciÃ³n masiva â”€â”€ */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-5 py-2">
        <span className="text-sm font-medium text-gray-600">AcciÃ³n:</span>
        <select
          value={bulkAction}
          onChange={(e) => setBulkAction(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700"
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
          â–¶ Ejecutar
        </button>
        <span className="text-xs text-gray-500">{selectedIds.size} seleccionados/as</span>
      </div>

      {/* â”€â”€ Toolbar â”€â”€ */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-5 py-2">
        {/* Page size */}
        <select
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700"
        >
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>Mostrar {n} registros</option>)}
        </select>
        {/* Export buttons */}
        <button onClick={() => { const rows = allFiltered; const csv = ['ID,Nombre,Usuario,IP,Estado,LAN,Corte', ...rows.map((c) => `${c.id},"${c.name}",${c.username||''},${c.ip_address||''},${c.status},${c.lan_interface||''},${c.dia_corte??''}`)].join('\n'); const b = new Blob([csv],{type:'text/csv'}); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href=u; a.download='clientes.csv'; a.click(); toast.success('CSV exportado') }}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-100" title="Exportar CSV">CSV</button>

        <span className="ml-2 text-xs font-semibold text-gray-500">Botonas de AcciÃ³n:</span>

        <ActionBtn color="bg-green-500" tip="Generar Factura" onClick={() => { if(selectedIds.size===0){toast('Selecciona clientes');return}; toast('Generar factura â€” prÃ³ximamente') }}>$</ActionBtn>
        <ActionBtn color="bg-green-600" tip="Activar Cliente" onClick={() => { selectedIds.forEach((id)=>void activate(id)); toast.success('Activandoâ€¦') }}>â–¶</ActionBtn>
        <ActionBtn color="bg-orange-500" tip="Desactivar Cliente" onClick={() => { selectedIds.forEach((id)=>void suspend(id)); toast.success('Desactivandoâ€¦') }}>â¸</ActionBtn>
        <ActionBtn color="bg-yellow-500" tip="Agregar Ticket" onClick={() => toast('Agregar Ticket â€” prÃ³ximamente')}>ðŸŽ«</ActionBtn>
        <ActionBtn color="bg-blue-500" tip="Ver TrÃ¡fico" onClick={() => toast('Ver TrÃ¡fico â€” prÃ³ximamente')}>ðŸ“Š</ActionBtn>
        <ActionBtn color="bg-violet-600" tip="Ver ONU" onClick={() => { const id = Array.from(selectedIds)[0]; if(id){const c=clients.find(x=>x.id===id); if(c) openGponModal(c)} else toast('Selecciona un cliente') }}>ðŸ“¡</ActionBtn>
        <ActionBtn color="bg-teal-500" tip="Portal Cliente" onClick={() => { const id = Array.from(selectedIds)[0]; if(id){const c=clients.find(x=>x.id===id); if(c) openPortalModal(c)} else toast('Selecciona un cliente') }}>ðŸ”‘</ActionBtn>

        {/* Herramientas */}
        <div className="relative ml-1" ref={herramientasRef}>
          <button
            onClick={() => setHerramientasId(herramientasId === -1 ? null : -1)}
            className="flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100"
          >
            ðŸ”§ Herramientas <ChevronDownIcon className="h-3 w-3" />
          </button>
          {herramientasId === -1 && (
            <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-gray-200 bg-white shadow-2xl py-1">
              {[
                { label: 'âš¡ Torch al Cliente', key: 'torch' },
                { label: 'ðŸ” Actualizar Password', key: 'password' },
                { label: 'ðŸ‘ Auto-Login Portal del Cliente', key: 'portal_login' },
                { label: 'ðŸ’³ Ver Historial de Pagos', key: 'pagos' },
                { label: 'ðŸŽ« Ver Historial de Tickets', key: 'tickets' },
                { label: 'ðŸ“‹ Ver Log', key: 'log' },
                { label: 'ðŸ”— Hacer Amarrar IP-MAC', key: 'mac' },
                { label: 'ðŸš« Cancelar Cliente', key: 'cancelar' },
                { label: 'ðŸ—‘ Eliminar Cliente de FASTISP + RB', key: 'delete' },
                { label: 'ðŸ“¶ Cambiar ContraseÃ±a WiFi', key: 'wifi_pass' },
                { label: 'ðŸ”„ Recalcular informaciÃ³n del cliente', key: 'recalc' },
              ].map(({ label, key }) => (
                <button key={key} onClick={() => {
                    const id = Array.from(selectedIds)[0]
                    const c = id ? clients.find((x) => x.id === id) : null
                    if (!c) { toast('Selecciona un cliente primero'); return }
                    void herramientasAction(key, c)
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 transition"
                >{label}</button>
              ))}
            </div>
          )}
        </div>

        {/* Buscar global */}
        <div className="relative ml-auto">
          <MagnifyingGlassIcon className="absolute left-2 top-1.5 h-4 w-4 text-gray-400" />
          <input
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1) }}
            placeholder="Buscar..."
            className="rounded border border-gray-300 py-1 pl-7 pr-3 text-sm text-gray-900"
          />
        </div>
      </div>

      {/* â”€â”€ Credenciales banner â”€â”€ */}
      {lastPortalCredentials && (
        <div className="mx-5 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-emerald-700">Credenciales portal generadas â€” {lastPortalCredentials.clientName}</p>
          <p className="text-emerald-900">Email: <strong>{lastPortalCredentials.email}</strong> Â· Password: <strong>{lastPortalCredentials.password}</strong></p>
          <button onClick={() => setLastPortalCredentials(null)} className="mt-1 text-xs text-emerald-600 underline">Cerrar</button>
        </div>
      )}

      {/* â”€â”€ Tabla â”€â”€ */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left w-8">
                <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} className="cursor-pointer" />
              </th>
              <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => setSortBy('name')}>
                Nombre {sortBy === 'name' && 'â†‘'}
              </th>
              <th className="px-3 py-2 text-left">Usuario</th>
              <th className="px-3 py-2 text-left">IP</th>
              <th className="px-3 py-2 text-center">Enviar Avisos en Pantalla</th>
              <th className="px-3 py-2 text-left">Interfaz LAN</th>
              <th className="px-3 py-2 text-left">DÃ­a de Corte</th>
              <th className="px-3 py-2 text-right">AcciÃ³n</th>
            </tr>
            {/* Per-column search row */}
            <tr className="bg-white border-b border-gray-100">
              <td />
              <td className="px-2 py-1"><input value={colSearch.name} onChange={(e)=>setColSearch(p=>({...p,name:e.target.value}))} placeholder="Buscar Nombre" className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-700" /></td>
              <td className="px-2 py-1"><input value={colSearch.username} onChange={(e)=>setColSearch(p=>({...p,username:e.target.value}))} placeholder="Buscar Usuario" className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-700" /></td>
              <td className="px-2 py-1"><input value={colSearch.ip} onChange={(e)=>setColSearch(p=>({...p,ip:e.target.value}))} placeholder="Buscar IP" className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-700" /></td>
              <td className="px-2 py-1 text-center"><input value={colSearch.lan_interface} onChange={(e)=>setColSearch(p=>({...p,lan_interface:e.target.value}))} placeholder="Buscar" className="w-24 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700" /></td>
              <td className="px-2 py-1"><input value={colSearch.lan_interface} onChange={(e)=>setColSearch(p=>({...p,lan_interface:e.target.value}))} placeholder="Buscar Interfaz" className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-700" /></td>
              <td className="px-2 py-1"><input value={colSearch.dia_corte} onChange={(e)=>setColSearch(p=>({...p,dia_corte:e.target.value}))} placeholder="Buscar DÃ­a" className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-700" /></td>
              <td className="px-2 py-1 text-right"><button onClick={()=>setColSearch({name:'',username:'',ip:'',lan_interface:'',dia_corte:''})} className="rounded bg-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-300">Limpiar</button></td>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={8} className="py-8 text-center text-sm text-gray-400">
                <ArrowPathIcon className="mx-auto h-6 w-6 animate-spin mb-2" />Cargando...
              </td></tr>
            )}
            {!loading && filteredClients.map((client, idx) => (
              <motion.tr key={client.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.01 }}
                className={`hover:bg-blue-50 transition-colors ${selectedIds.has(client.id) ? 'bg-blue-50' : ''}`}
              >
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selectedIds.has(client.id)} onChange={() => toggleSelect(client.id)} className="cursor-pointer" />
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{client.name}</div>
                  <div className="text-xs text-gray-400">{client.email || ''}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-600">{client.username || '-'}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-700">{client.ip_address || '-'}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${client.avisos_pantalla ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {client.avisos_pantalla ? 'Si' : 'No'}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-600">{client.lan_interface || '-'}</td>
                <td className="px-3 py-2 text-xs text-gray-600">{client.dia_corte ?? '-'}</td>
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
                        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-gray-200 bg-white shadow-2xl py-1">
                          {[
                            { label: 'ðŸ‘ Portal auto-login', key: 'portal_login' },
                            { label: 'ðŸ” Actualizar Password', key: 'password' },
                            { label: 'ðŸ’³ Historial de Pagos', key: 'pagos' },
                            { label: 'ðŸŽ« Historial de Tickets', key: 'tickets' },
                            { label: 'ðŸ”— Amarrar IP-MAC', key: 'mac' },
                            { label: 'ðŸ“¡ Ver ONU GPON', key: 'gpon' },
                            { label: 'â–¶ Activar Cliente', key: 'activate' },
                            { label: 'â¸ Suspender Cliente', key: 'suspend' },
                            { label: 'ðŸ—‘ Eliminar Cliente', key: 'delete' },
                          ].map(({ label, key }) => (
                            <button key={key}
                              onClick={() => void herramientasAction(key, client)}
                              className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                            >{label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Edit button (orange) */}
                    <button title="Editar" onClick={() => toast(`Editar ${client.name} â€” prÃ³ximamente`)}
                      className="flex h-7 w-7 items-center justify-center rounded bg-orange-400 text-white text-xs hover:opacity-80">âœ</button>
                    {/* View button (blue) */}
                    <button title="Ver detalle" onClick={() => openPortalModal(client)}
                      className="flex h-7 w-7 items-center justify-center rounded bg-blue-500 text-white text-xs hover:opacity-80">ðŸ‘</button>
                  </div>
                </td>
              </motion.tr>
            ))}
            {!loading && filteredClients.length === 0 && (
              <tr><td colSpan={8} className="py-10 text-center text-sm text-gray-400">No se encontraron clientes</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* â”€â”€ Pagination â”€â”€ */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
        <span className="text-xs text-gray-500">
          Mostrando {Math.min((page-1)*pageSize+1, allFiltered.length)}â€“{Math.min(page*pageSize, allFiltered.length)} de {allFiltered.length} registros en {clients.length} clientes
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(1)} disabled={page===1} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 disabled:opacity-40">Â«</button>
          <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={page===1} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 disabled:opacity-40">Anterior</button>
          {Array.from({length: Math.min(5,totalPages)}, (_,i) => {
            const p = page <= 3 ? i+1 : page - 2 + i
            if (p < 1 || p > totalPages) return null
            return <button key={p} onClick={()=>setPage(p)} className={`rounded border px-2 py-1 text-xs ${p===page ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 text-gray-600'}`}>{p}</button>
          })}
          <button onClick={() => setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 disabled:opacity-40">Siguiente</button>
          <button onClick={() => setPage(totalPages)} disabled={page===totalPages} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 disabled:opacity-40">Â»</button>
        </div>
      </div>

      {/* â”€â”€ Footer stats â”€â”€ */}
      <div className="grid grid-cols-4 border-t border-gray-200 bg-white divide-x divide-gray-200">
        {[
          { label: 'Total', value: clients.length, color: 'text-gray-900' },
          { label: 'Activos', value: clients.filter(c=>c.status==='active').length, color: 'text-green-600' },
          { label: 'Suspendidos', value: clients.filter(c=>c.status==='suspended').length, color: 'text-rose-600' },
          { label: 'Mora', value: clients.filter(c=>c.status==='past_due').length, color: 'text-amber-600' },
        ].map(({label,value,color}) => (
          <div key={label} className="px-4 py-3 text-center">
            <div className={`text-xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      {/* â”€â”€ Modals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {showModal &&
        renderModal(
          <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:p-6" onClick={() => setShowModal(false)}>
            <div className="my-2 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase text-blue-600">Nuevo cliente</p>
                <h3 className="text-xl font-bold text-gray-900">Datos rapidos</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full p-2 hover:bg-gray-100">
                <XMarkIcon className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto px-6 py-6 md:grid-cols-2">
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-800">Nombre completo</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej: Juan Perez" />
                <label className="mt-4 block text-sm font-semibold text-gray-800">Plan</label>
                <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900" value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
                  <option value="">Seleccionar plan</option>
                  {plans.map((plan) => (<option key={plan.id} value={plan.id}>{plan.name} {plan.download_speed ? `(${plan.download_speed}/${plan.upload_speed} Mbps)` : ''}</option>))}
                </select>
                <label className="mt-4 block text-sm font-semibold text-gray-800">Router</label>
                <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900" value={form.router_id} onChange={(e) => setForm({ ...form, router_id: e.target.value })}>
                  <option value="">Sin router</option>
                  {routers.map((r) => (<option key={r.id} value={r.id}>{r.name} {r.ip_address ? `(${r.ip_address})` : ''}</option>))}
                </select>
              </div>
              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-800">Tipo de conexion</label>
                <div className="grid grid-cols-4 gap-2">
                  {['pppoe', 'dhcp', 'static', 'fiber'].map((type) => (
                    <button key={type} onClick={() => setForm({ ...form, connection_type: type })}
                      className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs ${form.connection_type === type ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700'}`} type="button">
                      {type === 'pppoe' ? <WifiIcon className="h-3 w-3" /> : type === 'fiber' ? <SignalIcon className="h-3 w-3" /> : <GlobeAltIcon className="h-3 w-3" />}
                      {type === 'fiber' ? 'GPON' : type.toUpperCase()}
                    </button>
                  ))}
                </div>
                <label className="mt-4 block text-sm font-semibold text-gray-800">IP del cliente</label>
                <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="10.0.0.51" />
                {form.connection_type === 'pppoe' && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div><label className="block text-sm font-semibold text-gray-800">Usuario PPPoE</label>
                      <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.pppoe_username} onChange={(e) => setForm({ ...form, pppoe_username: e.target.value })} placeholder="cliente01" /></div>
                    <div><label className="block text-sm font-semibold text-gray-800">Password PPPoE</label>
                      <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={form.pppoe_password} onChange={(e) => setForm({ ...form, pppoe_password: e.target.value })} placeholder="********" /></div>
                  </div>
                )}
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                    <input type="checkbox" checked={form.create_portal_access} onChange={(e) => setForm({ ...form, create_portal_access: e.target.checked })} />
                    Crear acceso al portal cliente
                  </label>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div><label className="block text-sm font-semibold text-gray-800">Email cliente</label>
                      <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="cliente@correo.com" disabled={!form.create_portal_access} /></div>
                    <div><label className="block text-sm font-semibold text-gray-800">Password portal (opcional)</label>
                      <input className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Auto-generado" disabled={!form.create_portal_access} /></div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                  <CreditCardIcon className="h-4 w-4" /> Facturacion desde el modulo financiero.
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button onClick={() => setShowModal(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button onClick={() => void submitClient()} disabled={saving} className="rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-60">
                {saving ? 'Guardando...' : 'Guardar cliente'}
              </button>
            </div>
          </div>
        </div>,
        )}

      {/* GPON Modal */}
      {gponClient && renderModal(
        <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6" onClick={() => setGponClient(null)}>
          <div className="my-4 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b bg-violet-50 px-6 py-4">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-violet-600">ProvisiÃ³n GPON</p>
                <h3 className="text-lg font-bold text-gray-900">Autorizar ONU â€” {gponClient.name}</h3></div>
              <button onClick={() => setGponClient(null)} className="rounded-full p-2 hover:bg-violet-100"><XMarkIcon className="h-5 w-5 text-gray-500" /></button>
            </div>
            <div className="flex border-b">
              {[1,2,3].map((s) => (<div key={s} className={`flex-1 py-2 text-center text-xs font-semibold ${gponStep===s?'border-b-2 border-violet-500 text-violet-700':'text-gray-400'}`}>{s===1?'1. OLT + PON':s===2?'2. Seleccionar ONU':'3. Resultado'}</div>))}
            </div>
            <div className="max-h-[65vh] overflow-y-auto p-6">
              {gponStep===1 && (
                <div className="space-y-4">
                  <div><label className="mb-1 block text-sm font-semibold text-gray-700">Dispositivo OLT</label>
                    <select value={gponDeviceId} onChange={e=>setGponDeviceId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                      <option value="">Seleccionar OLT...</option>
                      {oltDevices.map(d=><option key={d.id} value={d.id}>{d.name} ({d.vendor}) {d.host?`â€” ${d.host}`:''}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><label className="mb-1 block text-xs font-semibold text-gray-600">Frame</label><input type="number" min="0" value={gponFrame} onChange={e=>setGponFrame(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></div>
                    <div><label className="mb-1 block text-xs font-semibold text-gray-600">Slot</label><input type="number" min="0" value={gponSlot} onChange={e=>setGponSlot(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></div>
                    <div><label className="mb-1 block text-xs font-semibold text-gray-600">Puerto PON</label><input type="number" min="1" value={gponPon} onChange={e=>setGponPon(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setGponClient(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Cancelar</button>
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
                  <p className="mb-2 text-sm font-semibold text-gray-700">ONUs encontradas:</p>
                  {pendingOnus.length>0?(
                    <div className="space-y-2">{pendingOnus.map((onu,i)=>(
                      <button key={i} onClick={()=>{setGponSerial(onu.serial);setGponOnu(String(onu.onu||i+1))}}
                        className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition ${gponSerial===onu.serial?'border-violet-500 bg-violet-50':'border-gray-200 hover:border-violet-300'}`}>
                        <div className="flex items-center justify-between"><span className="font-mono font-semibold">{onu.serial}</span>{gponSerial===onu.serial&&<CheckCircleIcon className="h-5 w-5 text-violet-600"/>}</div>
                        <div className="mt-1 text-xs text-gray-500">{onu.vendor&&<span className="mr-3">{onu.vendor}</span>}{onu.model&&<span>{onu.model}</span>}</div>
                      </button>
                    ))}</div>
                  ):(
                    <div className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">No se encontraron ONUs pendientes.</div>
                  )}
                  <div><label className="mb-1 block text-xs font-semibold text-gray-700">Serial ONU (manual)</label>
                    <input value={gponSerial} onChange={e=>setGponSerial(e.target.value)} placeholder="ZTEG12345678" className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="mb-1 block text-xs font-semibold text-gray-700">VLAN</label><input type="number" value={gponVlan} onChange={e=>setGponVlan(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></div>
                    <div><label className="mb-1 block text-xs font-semibold text-gray-700">Tipo WAN</label>
                      <select value={gponWanType} onChange={e=>setGponWanType(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        <option value="pppoe">PPPoE</option><option value="dhcp">DHCP</option><option value="static">IP EstÃ¡tica</option><option value="bridge">Bridge</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-between gap-2">
                    <button onClick={()=>setGponStep(1)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">â† AtrÃ¡s</button>
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
                  <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${gponResult.success?'bg-emerald-100':'bg-red-100'}`}>
                    {gponResult.success?<CheckCircleIcon className="h-10 w-10 text-emerald-600"/>:<XMarkIcon className="h-10 w-10 text-red-600"/>}
                  </div>
                  <p className={`text-sm font-semibold ${gponResult.success?'text-emerald-700':'text-red-700'}`}>{gponResult.message}</p>
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
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase text-blue-600">Portal cliente</p>
                <h3 className="text-lg font-bold text-gray-900">{portalModalClient.name}</h3>
              </div>
              <button onClick={() => setPortalModalClient(null)} className="rounded-full p-2 hover:bg-gray-100"><XMarkIcon className="h-5 w-5 text-gray-500" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
                <input value={portalForm.email} onChange={(e)=>setPortalForm(p=>({...p,email:e.target.value}))} placeholder="cliente@correo.com" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Nueva contraseÃ±a (opcional)</label>
                <input type="password" value={portalForm.password} onChange={(e)=>setPortalForm(p=>({...p,password:e.target.value}))} placeholder="Auto-generada si se deja vacÃ­o" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button onClick={() => setPortalModalClient(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Cancelar</button>
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
