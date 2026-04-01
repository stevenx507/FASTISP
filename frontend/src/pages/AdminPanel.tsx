import React, { useState, Fragment, useEffect } from 'react'
import { Dialog, Transition, Menu } from '@headlessui/react'
import { useNavigate } from 'react-router-dom'
import {
  ChartBarIcon,
  UserGroupIcon,
  CreditCardIcon,
  WifiIcon,
  CogIcon,
  BellAlertIcon,
  MapIcon,
  ServerIcon,
  Bars3Icon,
  XMarkIcon,
  ArrowLeftOnRectangleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  AcademicCapIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../store/authStore'
import { safeStorage } from '../lib/storage'
import PlanChangeModal from '../components/admin/PlanChangeModal'
import ManualPaymentModal from '../components/admin/ManualPaymentModal'
import LoadingSpinner from '../components/LoadingSpinner'
import { apiClient } from '../lib/apiClient'
import { normalizeRole } from '../lib/roles'

const { Suspense, lazy } = React
const ProfessionalDashboard = lazy(() => import('../components/ProfessionalDashboard'))
const ClientsManagement = lazy(() => import('../components/ClientsManagement'))
const MikroTikManagement = lazy(() => import('../components/MikroTikManagement'))
const NetworkMap = lazy(() => import('../components/NetworkMap'))
const BillingManagement = lazy(() => import('../components/BillingManagement'))
const MonitoringView = lazy(() => import('../components/MonitoringView'))
const AlertsView = lazy(() => import('../components/AlertsView'))
const SettingsView = lazy(() => import('../components/SettingsView'))
const OltManagement = lazy(() => import('../components/OltManagement'))
const NocDashboard = lazy(() => import('./NocDashboard'))
const TicketsAdmin = lazy(() => import('./TicketsAdmin'))
const BackupsView = lazy(() => import('../components/BackupsView'))
const SearchClients = lazy(() => import('../components/admin/SearchClients'))
const Installations = lazy(() => import('../components/admin/Installations'))
const ScreenAlerts = lazy(() => import('../components/admin/ScreenAlerts'))
const TrafficView = lazy(() => import('../components/admin/TrafficView'))
const StatsView = lazy(() => import('../components/admin/StatsView'))
const PushNotifications = lazy(() => import('../components/admin/PushNotifications'))
const ExtraServices = lazy(() => import('../components/admin/ExtraServices'))
const FinanceView = lazy(() => import('../components/admin/FinanceView'))
const SystemSettings = lazy(() => import('../components/admin/SystemSettings'))
const HotspotCards = lazy(() => import('../components/admin/HotspotCards'))
const TechSupport = lazy(() => import('../components/admin/TechSupport'))
const Inventory = lazy(() => import('../components/admin/Inventory'))
const StaffView = lazy(() => import('../components/admin/StaffView'))
const AuditTrail = lazy(() => import('../components/admin/AuditTrail'))
const BillingPromisesView = lazy(() => import('../components/admin/BillingPromisesView'))
const MaintenanceWindowsView = lazy(() => import('../components/admin/MaintenanceWindowsView'))
const PermissionsView = lazy(() => import('../components/admin/PermissionsView'))
const InteractiveDocs = lazy(() => import('../components/admin/InteractiveDocs'))

const AdminPanel: React.FC = () => {
  const navigate = useNavigate()
  const [activeView, setActiveView] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null)
  const [showAdvancedMenu, setShowAdvancedMenu] = useState(() => {
    const saved = safeStorage.getItem('showAdvancedMenu')
    return saved ? saved === 'true' : false
  })
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ core: true })
  const { logout, user, tenantContextId, setTenantContext } = useAuthStore()

  type NotificationType = 'error' | 'warning' | 'info'
  interface Notification {
    id: string
    message: string
    time: string
    read: boolean
    type: NotificationType
    source: string
  }

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loadingNotifications, setLoadingNotifications] = useState(false)

  const loadNotifications = React.useCallback(async () => {
    setLoadingNotifications(true)
    try {
      const [feedRes, historyRes, networkRes] = await Promise.allSettled([
        apiClient.get('/notifications') as Promise<{ notifications?: Array<{ id: number | string; message: string; time?: string; read?: boolean }> }>,
        apiClient.get('/admin/notifications/history?limit=12') as Promise<{ items?: Array<{ id: string; title: string; message: string; channel: string; sent_at?: string }> }>,
        apiClient.get('/network/alerts') as Promise<{ alerts?: Array<{ id: string; severity: string; message: string; since?: string }> }>,
      ])

      const feedItems: Notification[] =
        feedRes.status === 'fulfilled'
          ? (feedRes.value.notifications || []).map((item) => ({
              id: `feed-${item.id}`,
              message: item.message,
              time: item.time || new Date().toISOString(),
              read: Boolean(item.read),
              type: 'info',
              source: 'feed',
            }))
          : []

      const historyItems: Notification[] =
        historyRes.status === 'fulfilled'
          ? (historyRes.value.items || []).map((item) => ({
              id: `history-${item.id}`,
              message: `${item.title} (${item.channel})`,
              time: item.sent_at || new Date().toISOString(),
              read: true,
              type: 'info',
              source: 'campaign',
            }))
          : []

      const networkItems: Notification[] =
        networkRes.status === 'fulfilled'
          ? (networkRes.value.alerts || []).map((item) => ({
              id: `network-${item.id}`,
              message: item.message,
              time: item.since || new Date().toISOString(),
              read: false,
              type: item.severity === 'critical' ? 'error' : item.severity === 'warning' ? 'warning' : 'info',
              source: 'network',
            }))
          : []

      const merged = [...networkItems, ...feedItems, ...historyItems]
        .sort((a, b) => {
          const aTs = new Date(a.time).getTime()
          const bTs = new Date(b.time).getTime()
          return bTs - aTs
        })
        .slice(0, 30)

      setNotifications((prev) => {
        const prevRead = new Map(prev.map((item) => [item.id, item.read]))
        return merged.map((item) => ({ ...item, read: prevRead.get(item.id) ?? item.read }))
      })
    } catch (err) {
      console.error('[AdminPanel] notification load error', err)
    } finally {
      setLoadingNotifications(false)
    }
  }, [])

  useEffect(() => {
    loadNotifications()
    const timer = setInterval(loadNotifications, 30000)
    return () => clearInterval(timer)
  }, [loadNotifications])

  const unreadNotificationsCount = notifications.filter(n => !n.read).length
  const isPlatformAdminMode = normalizeRole(user?.role) === 'platform_admin'
  const adminViewFallback = (
    <div className="flex min-h-[50vh] items-center justify-center px-6">
      <LoadingSpinner size="lg" label="Cargando vista..." />
    </div>
  )

  const handleExitTenantMode = () => {
    setTenantContext(null)
    navigate('/platform')
  }

  const menuItems = React.useMemo(() => ([
    { id: 'dashboard', name: 'Dashboard', icon: ChartBarIcon },
    { id: 'clients', name: 'Clientes', icon: UserGroupIcon },
    { id: 'clients-search', name: 'Buscar Clientes', icon: MagnifyingGlassIcon },
    { id: 'installations', name: 'Instalaciones', icon: Bars3Icon },
    { id: 'screen-alerts', name: 'Avisos en Pantalla', icon: BellAlertIcon },
    { id: 'traffic', name: 'Tráfico', icon: ServerIcon },
    { id: 'stats', name: 'Estadísticas', icon: ChartBarIcon },
    { id: 'push', name: 'Notificaciones Push', icon: BellAlertIcon },
    { id: 'extras', name: 'Servicios Adicionales', icon: WifiIcon },
    { id: 'finance', name: 'Finanzas', icon: CreditCardIcon },
    { id: 'billing-promises', name: 'Promesas de Pago', icon: CreditCardIcon },
    { id: 'system', name: 'Sistema', icon: CogIcon },
    { id: 'permissions', name: 'Permisos', icon: CogIcon },
    { id: 'audit', name: 'Auditoria', icon: InformationCircleIcon },
    { id: 'maintenance', name: 'Mantenimientos NOC', icon: BellAlertIcon },
    { id: 'hotspot', name: 'Fichas Hotspot', icon: WifiIcon },
    { id: 'support', name: 'Soporte Técnico', icon: BellAlertIcon },
    { id: 'inventory', name: 'Almacén', icon: ServerIcon },
    { id: 'staff', name: 'Staff', icon: UserGroupIcon },
    { id: 'network', name: 'Gestión MikroTik', icon: WifiIcon },
    { id: 'olt', name: 'Gestión OLT', icon: ServerIcon },
    { id: 'academy', name: 'Documentacion Interactiva', icon: AcademicCapIcon },
    { id: 'maps', name: 'Mapa de Red', icon: MapIcon },
    { id: 'billing', name: 'Facturación', icon: CreditCardIcon },
    { id: 'monitoring', name: 'Monitoreo', icon: ServerIcon },
    { id: 'noc', name: 'NOC', icon: ServerIcon },
    { id: 'alerts', name: 'Alertas', icon: BellAlertIcon },
    { id: 'tickets', name: 'Tickets', icon: BellAlertIcon },
    { id: 'backups', name: 'Backups', icon: ServerIcon },
    { id: 'settings', name: 'Configuración', icon: CogIcon }
  ]), [])
  const coreMenuIds = React.useMemo(
    () => new Set(['dashboard','clients','network','olt','academy','maps','billing','monitoring','noc','alerts','tickets','backups','settings']),
    []
  )
  const groups = React.useMemo(() => {
    const core = { id: 'core', label: 'Principal', items: menuItems.filter(m => coreMenuIds.has(m.id)) }
    if (!showAdvancedMenu) return [core]
    return [
      core,
      { id: 'clientes', label: 'Clientes', items: menuItems.filter(m => ['clients','clients-search','installations','screen-alerts','traffic','stats','push','extras'].includes(m.id)) },
      { id: 'finanzas', label: 'Finanzas', items: menuItems.filter(m => ['finance', 'billing-promises'].includes(m.id)) },
      { id: 'sistema', label: 'Sistema', items: menuItems.filter(m => ['system', 'permissions', 'audit'].includes(m.id)) },
      { id: 'nocx', label: 'NOC Avanzado', items: menuItems.filter(m => ['maintenance'].includes(m.id)) },
      { id: 'hotspot', label: 'Fichas Hotspot', items: menuItems.filter(m => ['hotspot'].includes(m.id)) },
      { id: 'soporte', label: 'Soporte Técnico', items: menuItems.filter(m => ['support'].includes(m.id)) },
      { id: 'almacen', label: 'Almacén', items: menuItems.filter(m => ['inventory'].includes(m.id)) },
      { id: 'staff', label: 'Staff', items: menuItems.filter(m => ['staff'].includes(m.id)) },
    ]
  }, [showAdvancedMenu, coreMenuIds, menuItems])

  useEffect(() => {
    // reset open groups when toggling advanced modules
    setOpenGroups((prev) => ({ core: true, ...prev }))
  }, [showAdvancedMenu])

  const handleMarkAsRead = (id: string) => {
    setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, read: true } : item)))
  }

  const handleMarkAllAsRead = () => {
    setNotifications((prev) => prev.map((item) => ({ ...item, read: true })))
  }

  const handleClearAll = () => {
    setNotifications([])
  }

  const notificationIcons: { [key in NotificationType]: React.ElementType } = {
    error: ExclamationTriangleIcon,
    warning: InformationCircleIcon,
    info: CheckCircleIcon,
  }

  const notificationIconColors: { [key in NotificationType]: string } = {
    error: 'text-red-500',
    warning: 'text-yellow-500',
    info: 'text-green-500',
  }

  const NavigationItems: React.FC<{ isMobile?: boolean }> = ({ isMobile = false }) => (
    <nav className={`mt-5 ${isMobile ? 'px-2 space-y-1' : 'flex-1 px-4 space-y-2'}`}>
      {groups.map((group) => {
        const isOpen = openGroups[group.id] ?? false
        return (
          <div key={group.id} className="border border-white/10 rounded-lg overflow-hidden">
            <button
              onClick={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !isOpen }))}
              className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-slate-100 bg-white/5 hover:bg-white/10"
            >
              <span className="flex items-center gap-2">
                <ChevronRightIcon className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                {group.label}
              </span>
              <span className="text-xs text-slate-300">{group.items.length}</span>
            </button>
            {isOpen && (
              <div className="py-1">
                {group.items.map((item) => (
                  <a
                    key={item.id}
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      setActiveView(item.id)
                      if (isMobile) setSidebarOpen(false)
                    }}
                    className={`group flex items-center w-full rounded-md ${
                      isMobile ? 'px-3 py-2 text-base font-medium' : 'px-4 py-2 text-sm font-medium'
                    } ${
                      activeView === item.id
                        ? 'bg-white/10 text-cyan-200'
                        : 'text-slate-200 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <item.icon className={`mr-3 h-5 w-5`} />
                    {item.name}
                  </a>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )

  const viewComponents: { [key: string]: React.ReactNode } = {
    dashboard: <ProfessionalDashboard />,
    clients: <ClientsManagement />,
    'clients-search': <SearchClients />,
    installations: <Installations />,
    'screen-alerts': <ScreenAlerts />,
    traffic: <TrafficView />,
    stats: <StatsView />,
    push: <PushNotifications />,
    extras: <ExtraServices />,
    finance: <FinanceView />,
    'billing-promises': <BillingPromisesView />,
    system: <SystemSettings />,
    permissions: <PermissionsView />,
    audit: <AuditTrail />,
    maintenance: <MaintenanceWindowsView />,
    hotspot: <HotspotCards />,
    support: <TechSupport />,
    inventory: <Inventory />,
    staff: <StaffView />,
    network: <MikroTikManagement />,
    olt: <OltManagement />,
    academy: <InteractiveDocs onNavigateToModule={(moduleId) => setActiveView(moduleId)} />,
    maps: <NetworkMap />,
    billing: (
      <div className="relative space-y-4">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => {
              const idStr = window.prompt('ID del cliente para cambiar plan')
              const parsed = idStr ? parseInt(idStr, 10) : NaN
              if (!parsed) return
              setSelectedClientId(parsed)
              setShowPlanModal(true)
            }}
            className="px-4 py-2 rounded-lg bg-cyan-500 text-white font-semibold hover:bg-cyan-400"
          >
            Cambiar plan
          </button>
        </div>
        <BillingManagement
          mode="admin"
          onSelectInvoice={(id) => {
            setSelectedInvoiceId(id)
            setShowPaymentModal(true)
          }}
        />
      </div>
    ),
    monitoring: <MonitoringView />,
    noc: <NocDashboard />,
    alerts: <AlertsView />,
    tickets: <TicketsAdmin />,
    backups: <BackupsView />,
    settings: <SettingsView />,
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Sidebar for Mobile */}
      <Transition.Root show={sidebarOpen} as={Fragment}>
        <Dialog as="div" className="relative z-40 lg:hidden" onClose={setSidebarOpen}>
          <Transition.Child as={Fragment} enter="transition-opacity ease-linear duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="transition-opacity ease-linear duration-300" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm" />
          </Transition.Child>
          <div className="fixed inset-0 z-40 flex">
            <Transition.Child as={Fragment} enter="transition ease-in-out duration-300 transform" enterFrom="-translate-x-full" enterTo="translate-x-0" leave="transition ease-in-out duration-300 transform" leaveFrom="translate-x-0" leaveTo="-translate-x-full">
              <Dialog.Panel className="relative flex w-full max-w-xs flex-1 flex-col enterprise-sidebar pt-5 pb-4 text-slate-100">
                <Transition.Child as={Fragment} enter="ease-in-out duration-300" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in-out duration-300" leaveFrom="opacity-100" leaveTo="opacity-0">
                  <div className="absolute top-0 right-0 -mr-12 pt-2">
                    <button 
                      type="button" 
                      title="Cerrar menu"
                      className="ml-1 flex h-10 w-10 items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white" 
                      onClick={() => setSidebarOpen(false)}
                    >
                      <XMarkIcon className="h-6 w-6 text-white" />
                    </button>
                  </div>
                </Transition.Child>
                <div className="flex flex-shrink-0 items-center px-4">
                  <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center"><span className="text-white font-bold text-lg">IM</span></div>
                  <div className="ml-3"><h1 className="text-lg font-bold text-slate-100">ISPMAX</h1><p className="text-xs text-slate-300">Panel Admin</p></div>
                </div>
                <div className="mt-5 h-0 flex-1 overflow-y-auto">
                  <NavigationItems isMobile />
                </div>
              </Dialog.Panel>
            </Transition.Child>
            <div className="w-14 flex-shrink-0" />
          </div>
        </Dialog>
      </Transition.Root>

      {/* Static sidebar for desktop */}
      <div className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 pointer-events-auto z-30">
          <div className="flex flex-grow flex-col overflow-y-auto enterprise-sidebar">
          <div className="flex flex-col flex-shrink-0 pt-5 pb-4">
            <div className="flex items-center flex-shrink-0 px-4">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center"><span className="text-white font-bold text-lg">IM</span></div>
              <div className="ml-3"><h1 className="text-lg font-bold text-slate-100">ISPMAX</h1><p className="text-xs text-slate-300">Panel Admin</p></div>
            </div>
            <div className="mt-3 px-4">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={showAdvancedMenu}
                  onChange={(e) => {
                    const val = e.target.checked
                    setShowAdvancedMenu(val)
                    safeStorage.setItem('showAdvancedMenu', String(val))
                  }}
                  className="rounded border-slate-500 bg-slate-800 text-blue-500 focus:ring-blue-500"
                />
                Mostrar módulos avanzados
              </label>
            </div>
            <NavigationItems />
          </div>
          <div className="flex-shrink-0 flex border-t border-white/10 p-4">
            <div className="flex items-center w-full">
              <div className="ml-3">
                <p className="text-sm font-medium text-slate-100">{user?.name || 'Admin ISP'}</p>
                <p className="text-xs text-slate-300">{user?.email || 'admin@ispmax.com'}</p>
                {isPlatformAdminMode && (
                  <p className="text-[10px] text-amber-200">Tenant: {tenantContextId ?? 'no seleccionado'}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pl-64 flex flex-col enterprise-main relative z-10">
        {isPlatformAdminMode && (
          <div className="mx-4 mt-4 rounded-lg border border-amber-300/30 bg-amber-500/15 px-4 py-2 text-xs text-amber-100">
            Modo Admin ISP por tenant. Tenant activo: {tenantContextId ?? 'no seleccionado'}.
            <button onClick={handleExitTenantMode} className="ml-2 font-semibold underline">
              Volver a Admin Total
            </button>
          </div>
        )}
        {/* Top navbar */}
        <div className="sticky top-0 z-10 flex-shrink-0 flex h-16 enterprise-header border-b border-white/10">
          <button
            type="button"
            className="px-4 border-r border-gray-200 text-gray-500 lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <span className="sr-only">Abrir menu</span>
            <Bars3Icon className="h-6 w-6" />
          </button>
          <div className="flex-1 px-4 flex justify-between">
            <div className="flex-1 flex">
              <h2 className="text-lg font-semibold text-slate-100 my-auto">
                {menuItems.find(item => item.id === activeView)?.name}
              </h2>
            </div>
            <div className="ml-4 flex items-center md:ml-6">
              {/* Notifications Dropdown */}
              <Menu as="div" className="relative">
                <Menu.Button className="relative p-2 text-slate-200 hover:text-white hover:bg-white/10 rounded-lg">
                  <span className="sr-only">Ver notificaciones</span>
                  <BellAlertIcon className="h-6 w-6" />
                  {unreadNotificationsCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                      {unreadNotificationsCount}
                    </span>
                  )}
                </Menu.Button>
                <Transition as={Fragment} enter="transition ease-out duration-100" enterFrom="transform opacity-0 scale-95" enterTo="transform opacity-100 scale-100" leave="transition ease-in duration-75" leaveFrom="transform opacity-100 scale-100" leaveTo="transform opacity-0 scale-95">
                  <Menu.Items className="absolute right-0 z-10 mt-2 w-96 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                    <div className="px-4 py-3 border-b flex justify-between items-center">
                      <p className="text-sm font-semibold">Alertas y Notificaciones</p>
                      <div className="flex items-center space-x-2">
                        <button onClick={loadNotifications} className="text-xs text-gray-600 hover:underline disabled:text-gray-400" disabled={loadingNotifications}>
                          {loadingNotifications ? 'Actualizando...' : 'Refrescar'}
                        </button>
                        <button onClick={handleMarkAllAsRead} className="text-xs text-blue-600 hover:underline disabled:text-gray-400" disabled={unreadNotificationsCount === 0}>Marcar todas leidas</button>
                        <button onClick={handleClearAll} className="text-xs text-gray-500 hover:underline disabled:text-gray-400" disabled={notifications.length === 0}>Limpiar</button>
                      </div>
                    </div>
                    <div className="py-1 max-h-80 overflow-y-auto">
                    {notifications.length > 0 ? notifications.map(n => {
                      const Icon = notificationIcons[n.type]
                      return (
                        <Menu.Item key={n.id}>
                          {({ active }) => (
                            <a href="#" onClick={(e) => { e.preventDefault(); handleMarkAsRead(n.id); }} className={`${active ? 'bg-gray-50' : ''} flex items-start px-4 py-3 text-sm text-gray-800`}>
                              {!n.read && <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 mr-3 flex-shrink-0"></div>}
                              <Icon className={`w-5 h-5 ${notificationIconColors[n.type]} mr-3 flex-shrink-0 mt-0.5 ${n.read ? 'ml-5' : ''}`} />
                              <div className="flex-1">
                                <p className={`font-medium ${!n.read ? 'text-gray-800' : 'text-gray-600'}`}>{n.message}</p>
                                <p className="text-xs text-gray-500 mt-1">{n.time.replace('T', ' ').slice(0, 16)} | {n.source}</p>
                              </div>
                            </a>
                          )}
                        </Menu.Item>
                      );
                    }) : (
                      <div className="text-center text-sm text-gray-500 py-6">No hay notificaciones</div>
                    )}
                    </div>
                  </Menu.Items>
                </Transition>
              </Menu>

              {/* Profile Dropdown */}
              <Menu as="div" className="relative ml-3">
                <Menu.Button className="flex items-center rounded-full bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                  <div className="w-8 h-8 bg-gradient-to-r from-green-400 to-blue-500 rounded-full flex items-center justify-center"><span className="text-white font-bold">A</span></div>
                </Menu.Button>
                <Transition as={Fragment} enter="transition ease-out duration-100" enterFrom="transform opacity-0 scale-95" enterTo="transform opacity-100 scale-100" leave="transition ease-in duration-75" leaveFrom="transform opacity-100 scale-100" leaveTo="transform opacity-0 scale-95">
                  <Menu.Items className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                    {isPlatformAdminMode && (
                      <Menu.Item>
                        {({ active }) => (
                          <button onClick={handleExitTenantMode} className={`${active ? 'bg-gray-100' : ''} group flex w-full items-center px-4 py-2 text-sm text-slate-700`}>
                            <ArrowLeftOnRectangleIcon className="mr-2 h-5 w-5 text-slate-500" />Volver a Admin Total
                          </button>
                        )}
                      </Menu.Item>
                    )}
                    <Menu.Item>
                      {({ active }) => (
                        <button onClick={logout} className={`${active ? 'bg-white/10' : ''} group flex w-full items-center px-4 py-2 text-sm text-red-300`}>
                          <ArrowLeftOnRectangleIcon className="mr-2 h-5 w-5 text-red-500" />Cerrar Sesion
                        </button>
                      )}
                    </Menu.Item>
                  </Menu.Items>
                </Transition>
              </Menu>
            </div>
          </div>
        </div>

        {/* Main content area */}
        <main className="flex-1 text-slate-900">
          <div className="py-6">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <Suspense fallback={adminViewFallback}>
                {viewComponents[activeView] || <div>Vista no encontrada</div>}
              </Suspense>
            </div>
          </div>
        </main>
      </div>
      <PlanChangeModal
        clientId={selectedClientId || 0}
        open={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        onChanged={() => setActiveView('billing')}
      />
      <ManualPaymentModal
        invoiceId={selectedInvoiceId}
        open={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSaved={() => setActiveView('billing')}
      />
    </div>
  )
}

export default AdminPanel














