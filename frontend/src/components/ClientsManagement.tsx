import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import {
  CreditCardIcon,
  GlobeAltIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  WifiIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../lib/apiClient'

type ClientStatus = 'active' | 'inactive' | 'suspended' | 'past_due' | 'trial' | string

interface Client {
  id: number
  name: string
  ip_address?: string | null
  plan?: string | null
  plan_id?: number | null
  router_id?: number | null
  status: ClientStatus
  email?: string | null
  portal_access?: boolean
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

  const [portalModalClient, setPortalModalClient] = useState<Client | null>(null)
  const [portalSaving, setPortalSaving] = useState(false)
  const [portalForm, setPortalForm] = useState({ email: '', password: '' })
  const [lastPortalCredentials, setLastPortalCredentials] = useState<{
    clientName: string
    email: string
    password: string
  } | null>(null)

  const renderModal = (content: React.ReactNode) => {
    if (typeof document === 'undefined') return null
    return createPortal(content, document.body)
  }

  const load = async () => {
    setLoading(true)
    try {
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

  const filteredClients = useMemo(() => {
    return clients
      .filter((item) => {
        const query = searchTerm.trim().toLowerCase()
        const matchesSearch =
          !query ||
          item.name.toLowerCase().includes(query) ||
          String(item.id).includes(query) ||
          String(item.email || '')
            .toLowerCase()
            .includes(query)
        const matchesStatus = filterStatus === 'all' || item.status === filterStatus
        return matchesSearch && matchesStatus
      })
      .sort((a, b) => {
        if (sortBy === 'plan') return String(a.plan || '').localeCompare(String(b.plan || ''))
        return String(a.name || '').localeCompare(String(b.name || ''))
      })
  }, [clients, filterStatus, searchTerm, sortBy])

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

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-blue-600">Clientes</p>
            <h2 className="text-2xl font-bold text-gray-900">Gestion de Clientes</h2>
            <p className="text-sm text-gray-500">Admin ISP puede crear clientes y credenciales portal.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar cliente, email o ID..."
                className="rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <PlusIcon className="h-5 w-5" />
              Nuevo Cliente
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <select
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="all">Todos los estados</option>
            <option value="active">Activos</option>
            <option value="suspended">Suspendidos</option>
            <option value="past_due">Mora</option>
            <option value="inactive">Inactivos</option>
          </select>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as 'name' | 'plan')}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="name">Ordenar por nombre</option>
            <option value="plan">Ordenar por plan</option>
          </select>
        </div>

        {lastPortalCredentials && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Credenciales portal generadas</p>
            <p className="mt-1 text-sm text-emerald-900">
              Cliente: <strong>{lastPortalCredentials.clientName}</strong>
            </p>
            <p className="text-sm text-emerald-900">
              Email: <strong>{lastPortalCredentials.email}</strong>
            </p>
            <p className="text-sm text-emerald-900">
              Password: <strong>{lastPortalCredentials.password}</strong>
            </p>
            <button
              onClick={() => setLastPortalCredentials(null)}
              className="mt-2 rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              Cerrar
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Cliente</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">IP / Router</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Plan</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Estado</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Portal</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && (
              <tr>
                <td colSpan={6} className="px-6 py-6 text-center text-sm text-gray-500">
                  Cargando...
                </td>
              </tr>
            )}

            {!loading &&
              filteredClients.map((client, index) => (
                <motion.tr
                  key={client.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.02 }}
                  className="hover:bg-gray-50"
                >
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {client.name}
                    <div className="text-xs text-gray-500">ID: {client.id}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    <div>{client.ip_address || '-'}</div>
                    <div className="text-xs text-gray-500">Router: {client.router_id ?? '-'}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    <select
                      className="rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900"
                      value={client.plan_id || ''}
                      onChange={(event) => {
                        const selected = Number(event.target.value)
                        if (selected) void changeSpeed(client.id, selected)
                      }}
                    >
                      <option value="">{client.plan || 'Seleccionar plan'}</option>
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        statusConfig[client.status]?.bg || 'bg-gray-100'
                      } ${statusConfig[client.status]?.text || 'text-gray-800'}`}
                    >
                      {statusConfig[client.status]?.label || client.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        client.portal_access ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {client.portal_access ? 'Activo' : 'Sin acceso'}
                    </span>
                    <div className="mt-1 text-xs text-gray-500">{client.email || 'Sin email portal'}</div>
                  </td>
                  <td className="space-x-2 px-6 py-4 text-sm">
                    <button
                      onClick={() => void suspend(client.id)}
                      className="rounded-lg bg-amber-100 px-3 py-1 text-xs text-amber-800 hover:bg-amber-200"
                    >
                      Suspender
                    </button>
                    <button
                      onClick={() => void activate(client.id)}
                      className="rounded-lg bg-emerald-100 px-3 py-1 text-xs text-emerald-800 hover:bg-emerald-200"
                    >
                      Activar
                    </button>
                    <button
                      onClick={() => openPortalModal(client)}
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-100 px-3 py-1 text-xs text-blue-800 hover:bg-blue-200"
                    >
                      <KeyIcon className="h-3.5 w-3.5" />
                      {client.portal_access ? 'Reset portal' : 'Crear portal'}
                    </button>
                  </td>
                </motion.tr>
              ))}

            {!loading && filteredClients.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                  No se encontraron clientes
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-gray-200 bg-gray-50 px-6 py-4 md:grid-cols-4">
        <div>
          <p className="text-xs text-gray-600">Total</p>
          <p className="text-xl font-bold text-gray-900">{clients.length}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Activos</p>
          <p className="text-xl font-bold text-emerald-600">{clients.filter((item) => item.status === 'active').length}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Suspendidos</p>
          <p className="text-xl font-bold text-rose-600">{clients.filter((item) => item.status === 'suspended').length}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Con portal</p>
          <p className="text-xl font-bold text-blue-600">{clients.filter((item) => item.portal_access).length}</p>
        </div>
      </div>

      {showModal &&
        renderModal(
          <div
            className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:p-6"
            onClick={() => setShowModal(false)}
          >
            <div
              className="my-2 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
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
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Ej: Juan Perez"
                />

                <label className="mt-4 block text-sm font-semibold text-gray-800">Plan</label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  value={form.plan_id}
                  onChange={(event) => setForm({ ...form, plan_id: event.target.value })}
                >
                  <option value="">Seleccionar plan</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} {plan.download_speed ? `(${plan.download_speed}/${plan.upload_speed} Mbps)` : ''}
                    </option>
                  ))}
                </select>

                <label className="mt-4 block text-sm font-semibold text-gray-800">Router</label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  value={form.router_id}
                  onChange={(event) => setForm({ ...form, router_id: event.target.value })}
                >
                  <option value="">Sin router</option>
                  {routers.map((router) => (
                    <option key={router.id} value={router.id}>
                      {router.name} {router.ip_address ? `(${router.ip_address})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-semibold text-gray-800">Tipo de conexion</label>
                <div className="grid grid-cols-3 gap-2">
                  {['pppoe', 'dhcp', 'static'].map((type) => (
                    <button
                      key={type}
                      onClick={() => setForm({ ...form, connection_type: type })}
                      className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                        form.connection_type === type
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-700 hover:border-blue-300'
                      }`}
                      type="button"
                    >
                      {type === 'pppoe' ? <WifiIcon className="h-4 w-4" /> : <GlobeAltIcon className="h-4 w-4" />}
                      {type.toUpperCase()}
                    </button>
                  ))}
                </div>

                <label className="mt-4 block text-sm font-semibold text-gray-800">IP del cliente</label>
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  value={form.ip_address}
                  onChange={(event) => setForm({ ...form, ip_address: event.target.value })}
                  placeholder="10.0.0.51"
                />

                {form.connection_type === 'pppoe' && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-800">Usuario PPPoE</label>
                      <input
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        value={form.pppoe_username}
                        onChange={(event) => setForm({ ...form, pppoe_username: event.target.value })}
                        placeholder="cliente01"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-800">Password PPPoE</label>
                      <input
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        value={form.pppoe_password}
                        onChange={(event) => setForm({ ...form, pppoe_password: event.target.value })}
                        placeholder="********"
                      />
                    </div>
                  </div>
                )}

                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                    <input
                      type="checkbox"
                      checked={form.create_portal_access}
                      onChange={(event) => setForm({ ...form, create_portal_access: event.target.checked })}
                    />
                    Crear acceso al portal cliente
                  </label>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-semibold text-gray-800">Email cliente</label>
                      <input
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100"
                        value={form.email}
                        onChange={(event) => setForm({ ...form, email: event.target.value })}
                        placeholder="cliente@correo.com"
                        disabled={!form.create_portal_access}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-800">Password portal (opcional)</label>
                      <input
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100"
                        value={form.password}
                        onChange={(event) => setForm({ ...form, password: event.target.value })}
                        placeholder="Se genera automaticamente si esta vacio"
                        disabled={!form.create_portal_access}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                  <CreditCardIcon className="h-4 w-4" />
                  Facturacion y cobranzas se gestionan desde el modulo financiero.
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => void submitClient()}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? 'Guardando...' : 'Guardar cliente'}
              </button>
            </div>
          </div>
        </div>,
        )}

      {portalModalClient &&
        renderModal(
          <div
            className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:p-6"
            onClick={() => setPortalModalClient(null)}
          >
            <div
              className="my-6 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Portal cliente</p>
                <h3 className="text-xl font-bold text-gray-900">
                  {portalModalClient.portal_access ? 'Actualizar credenciales' : 'Crear acceso portal'}
                </h3>
                <p className="text-sm text-gray-500">Cliente: {portalModalClient.name}</p>
              </div>
              <button
                onClick={() => setPortalModalClient(null)}
                className="rounded-full p-2 hover:bg-gray-100"
                type="button"
              >
                <XMarkIcon className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-800">Email portal</label>
                <input
                  value={portalForm.email}
                  onChange={(event) => setPortalForm((prev) => ({ ...prev, email: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="cliente@correo.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-800">Password portal (opcional)</label>
                <input
                  value={portalForm.password}
                  onChange={(event) => setPortalForm((prev) => ({ ...prev, password: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="Si esta vacio se genera automaticamente"
                />
              </div>
              <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                La password final se muestra solo una vez luego de guardar.
              </p>
            </div>

            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button
                onClick={() => setPortalModalClient(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                type="button"
              >
                Cancelar
              </button>
              <button
                onClick={() => void submitPortalAccess()}
                disabled={portalSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                type="button"
              >
                <KeyIcon className="h-4 w-4" />
                {portalSaving ? 'Guardando...' : 'Guardar credenciales'}
              </button>
            </div>
          </div>
        </div>,
        )}
    </motion.div>
  )
}

export default ClientsManagement
