import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowPathIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../lib/apiClient'
import { useDebounce } from '../hooks/useDebounce'

import { 
  Client, 
  Plan, 
  Router, 
  ClientForm, 
  OltDevice, 
  emptyClientForm 
} from './clients/types'

import ClientFormModal from './clients/ClientFormModal'
import GponOnuModal from './clients/GponOnuModal'
import PortalAccessModal from './clients/PortalAccessModal'
import BulkActionsBar from './clients/BulkActionsBar'
import ClientsTable from './clients/ClientsTable'

const ClientsManagement: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [routers, setRouters] = useState<Router[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearchTerm = useDebounce(searchTerm, 500)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'name' | 'plan'>('name')
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyClientForm)
  const [clientTab, setClientTab] = useState<1 | 2 | 3 | 4>(1)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkAction, setBulkAction] = useState('')
  const [runningBulk, setRunningBulk] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [colSearch, setColSearch] = useState({ name: '', username: '', ip: '', lan_interface: '', dia_corte: '' })
  
  const [portalModalClient, setPortalModalClient] = useState<Client | null>(null)
  const [oltDevices, setOltDevices] = useState<OltDevice[]>([])
  const [gponClient, setGponClient] = useState<Client | null>(null)
  
  const [lastPortalCredentials, setLastPortalCredentials] = useState<{
    clientName: string
    email: string
    password: string
  } | null>(null)

  const { data: initData, isLoading: loading, refetch } = useQuery({
    queryKey: ['clients_init', page, pageSize, debouncedSearchTerm, filterStatus],
    queryFn: async () => {
      const q = debouncedSearchTerm ? `&q=${encodeURIComponent(debouncedSearchTerm)}` : ''
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
    }
  }, [initData])

  const load = useCallback(() => {
    refetch()
  }, [refetch])

  useEffect(() => {
    const loadOlt = async () => {
      try {
        const resp = (await apiClient.get('/olt/devices')) as { devices: OltDevice[] }
        setOltDevices(resp.devices || [])
      } catch {
        setOltDevices([])
      }
    }
    loadOlt()
  }, [])

  const filteredClients = useMemo(() => {
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
    if (!bulkAction || selectedIds.size === 0) return
    setRunningBulk(true)
    try {
      const ids = Array.from(selectedIds)
      if (bulkAction === 'activate' || bulkAction === 'deactivate') {
        const endpoint = bulkAction === 'activate' ? 'activate' : 'suspend'
        await Promise.all(ids.map((id) => apiClient.post(`/admin/clients/${id}/${endpoint}`)))
        toast.success(`${ids.length} clientes actualizados`)
      } else if (bulkAction === 'delete') {
        if (!confirm('¿Seguro que desea eliminar los clientes seleccionados?')) return
        await Promise.all(ids.map((id) => apiClient.delete(`/admin/clients/${id}`)))
        toast.success(`${ids.length} clientes eliminados`)
      }
      load()
      setSelectedIds(new Set())
    } catch (err) {
      toast.error('Error en acción masiva')
    } finally {
      setRunningBulk(false)
    }
  }

  const suspend = async (id: number) => {
    try {
      await apiClient.post(`/admin/clients/${id}/suspend`)
      toast.success('Cliente suspendido')
      load()
    } catch (err) {
      toast.error('Error al suspender')
    }
  }

  const activate = async (id: number) => {
    try {
      await apiClient.post(`/admin/clients/${id}/activate`)
      toast.success('Cliente activado')
      load()
    } catch (err) {
      toast.error('Error al activar')
    }
  }

  const herramientasAction = async (action: string, client: Client) => {
    if (action === 'activate') return activate(client.id)
    if (action === 'suspend') return suspend(client.id)
    if (action === 'gpon') return setGponClient(client)
    if (action === 'portal_login' || action === 'password') return setPortalModalClient(client)
    if (action === 'delete') {
      if (confirm(`¿Eliminar a ${client.name}?`)) {
        await apiClient.delete(`/admin/clients/${client.id}`)
        toast.success('Cliente eliminado')
        load()
      }
      return
    }
    toast(`Función "${action}" próximamente`)
  }

  const submitClient = async () => {
    if (!form.plan_id) {
      toast.error('El plan es obligatorio')
      return
    }
    setSaving(true)
    try {
      const isEdit = Boolean((form as any).id)
      const payload = { ...form, plan_id: Number(form.plan_id), router_id: form.router_id ? Number(form.router_id) : undefined }
      
      if (isEdit) {
        await apiClient.put(`/admin/clients/${(form as any).id}`, payload)
        toast.success('Cliente actualizado')
      } else {
        const resp = (await apiClient.post('/admin/clients', payload)) as any
        toast.success('Cliente creado')
        if (resp.password) {
          setLastPortalCredentials({
            clientName: form.full_name || form.name,
            email: resp.user?.email || form.email,
            password: resp.password
          })
        }
      }
      load()
      setShowModal(false)
      setForm(emptyClientForm)
    } catch (err) {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Gestión de Clientes</h1>
          <p className="text-slate-500 text-sm">Administra tus suscriptores, planes y provisionamiento GPON</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-64 rounded-xl border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <button
            onClick={() => { setForm(emptyClientForm as any); setShowModal(true) }}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700 hover:scale-[1.02]"
          >
            <PlusIcon className="h-5 w-5" /> Nuevo Cliente
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Clientes', value: initData?.total || 0, color: 'text-blue-600' },
          { label: 'Activos', value: clients.filter(c => c.status === 'active').length, color: 'text-emerald-600' },
          { label: 'Suspendidos', value: clients.filter(c => c.status === 'suspended').length, color: 'text-rose-600' },
          { label: 'En Mora', value: clients.filter(c => c.status === 'past_due').length, color: 'text-amber-600' },
        ].map((stat, i) => (
          <div key={i} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">{stat.label}</p>
            <p className={`mt-2 text-3xl font-black ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {lastPortalCredentials && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-emerald-700">
              Credenciales generadas para <strong>{lastPortalCredentials.clientName}</strong>: 
              Email: <strong>{lastPortalCredentials.email}</strong> | Password: <strong>{lastPortalCredentials.password}</strong>
            </p>
            <button onClick={() => setLastPortalCredentials(null)} className="text-emerald-600 font-bold text-xs underline">Cerrar</button>
          </div>
        </div>
      )}

      <ClientsTable
        clients={filteredClients}
        plans={plans}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onAction={herramientasAction}
        onEdit={(c) => { setForm(c as any); setShowModal(true) }}
        onGpon={setGponClient}
        onPortal={setPortalModalClient}
        onDelete={suspend}
      />

      <div className="flex items-center justify-between border-t border-gray-200 bg-white px-5 py-3">
        <span className="text-xs text-slate-500">Página {page} de {totalPages}</span>
        <div className="flex gap-2">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="rounded border px-3 py-1 text-xs disabled:opacity-40">Anterior</button>
          <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="rounded border px-3 py-1 text-xs disabled:opacity-40">Siguiente</button>
        </div>
      </div>

      <BulkActionsBar
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        onActivate={() => { setBulkAction('activate'); void runBulkAction() }}
        onSuspend={() => { setBulkAction('deactivate'); void runBulkAction() }}
        onDelete={() => { setBulkAction('delete'); void runBulkAction() }}
      />

      <ClientFormModal
        show={showModal}
        onClose={() => setShowModal(false)}
        form={form as ClientForm}
        setForm={setForm as any}
        tab={clientTab}
        setTab={setClientTab}
        plans={plans}
        routers={routers}
        saving={saving}
        onSubmit={submitClient}
        isEdit={Boolean((form as any).id)}
      />

      {gponClient && (
        <GponOnuModal
          client={gponClient}
          oltDevices={oltDevices}
          onClose={() => setGponClient(null)}
        />
      )}

      {portalModalClient && (
        <PortalAccessModal
          client={portalModalClient}
          onClose={() => setPortalModalClient(null)}
          onSuccess={load}
        />
      )}
    </motion.div>
  )
}

export default ClientsManagement
