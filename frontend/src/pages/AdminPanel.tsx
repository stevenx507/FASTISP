import React, { useState, Fragment, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useTheme } from '../contexts/ThemeContext'
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
  HomeIcon,
  WrenchScrewdriverIcon,
  DocumentTextIcon,
  CubeIcon,
  UsersIcon,
  ShieldCheckIcon,
  ClipboardDocumentListIcon,
  FireIcon,
  SignalIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  PhotoIcon,
  PresentationChartLineIcon,
  ArrowTrendingUpIcon,
  TicketIcon,
  CircleStackIcon,
  BuildingStorefrontIcon,
  QrCodeIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../store/authStore'
import { safeStorage } from '../lib/storage'
import ProfessionalDashboard from '../components/ProfessionalDashboard'
import ClientsManagement from '../components/ClientsManagement'
import MikroTikManagement from '../components/MikroTikManagement'
import NetworkMap from '../components/NetworkMap'
import BillingManagement from '../components/BillingManagement'
import MonitoringView from '../components/MonitoringView'
import AlertsView from '../components/AlertsView'
import SettingsView from '../components/SettingsView'
import OltManagement from '../components/OltManagement'
import NocDashboard from './NocDashboard'
import TicketsAdmin from './TicketsAdmin'
import BackupsView from '../components/BackupsView'
import SearchClients from '../components/admin/SearchClients'
import Installations from '../components/admin/Installations'
import ScreenAlerts from '../components/admin/ScreenAlerts'
import TrafficView from '../components/admin/TrafficView'
import StatsView from '../components/admin/StatsView'
import PushNotifications from '../components/admin/PushNotifications'
import ExtraServices from '../components/admin/ExtraServices'
import FinanceView from '../components/admin/FinanceView'
import SystemSettings from '../components/admin/SystemSettings'
import HotspotCards from '../components/admin/HotspotCards'
import TechSupport from '../components/admin/TechSupport'
import Inventory from '../components/admin/Inventory'
import ConnectivityDashboard from '../components/admin/ConnectivityDashboard'
import StaffView from '../components/admin/StaffView'
import AuditTrail from '../components/admin/AuditTrail'
import BillingPromisesView from '../components/admin/BillingPromisesView'
import MaintenanceWindowsView from '../components/admin/MaintenanceWindowsView'
import PermissionsView from '../components/admin/PermissionsView'
import PlanChangeModal from '../components/admin/PlanChangeModal'
import ManualPaymentModal from '../components/admin/ManualPaymentModal'
import InteractiveDocs from '../components/admin/InteractiveDocs'
import SstpProvisioning from './SstpProvisioning'
import InfrastructureMap from './InfrastructureMap'
import AssetTracking from './AssetTracking'
import { apiClient } from '../lib/apiClient'

import { normalizeRole } from '../lib/roles'

// ── Tipos ──────────────────────────────────────────────────────────────────────
type NotificationType = 'error' | 'warning' | 'info'
interface Notification {
  id: string
  message: string
  time: string
  read: boolean
  type: NotificationType
  source: string
}

// ── Grupos de navegación con colores ──────────────────────────────────────────
interface NavItem {
  id: string
  name: string
  icon: React.ElementType
  badge?: string
}
interface NavGroup {
  id: string
  label: string
  color: string        // color del acento (Tailwind class fragment)
  bgColor: string      // fondo del grupo
  items: NavItem[]
}

const ALL_NAV_GROUPS: NavGroup[] = [
  {
    id: 'operations',
    label: 'Operaciones',
    color: 'text-coral-500',
    bgColor: 'from-coral-500/10 to-coral-500/5',
    items: [
      { id: 'dashboard',   name: 'Dashboard',        icon: HomeIcon },
      { id: 'clients',     name: 'Clientes',          icon: UserGroupIcon },
      { id: 'billing',     name: 'Facturación',       icon: CreditCardIcon },
      { id: 'tickets',     name: 'Tickets',           icon: TicketIcon },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infraestructura',
    color: 'text-blue-500',
    bgColor: 'from-blue-500/10 to-blue-500/5',
    items: [
      { id: 'network',     name: 'MikroTik',          icon: WifiIcon },
      { id: 'olt',         name: 'OLT',               icon: ServerIcon },
      { id: 'sstp',        name: 'Túneles SSTP',      icon: ShieldCheckIcon },
      { id: 'maps',        name: 'Mapa de Red',       icon: MapIcon },
      { id: 'gis',         name: 'Infraestructura GIS', icon: CubeIcon },
    ],
  },
  {
    id: 'monitoring',
    label: 'Monitoreo & NOC',
    color: 'text-emerald-500',
    bgColor: 'from-emerald-500/10 to-emerald-500/5',
    items: [
      { id: 'noc',         name: 'NOC',               icon: PresentationChartLineIcon },
      { id: 'monitoring',  name: 'Monitoreo',         icon: SignalIcon },
      { id: 'connectivity', name: 'Conectividad ISP', icon: FireIcon },
      { id: 'alerts',      name: 'Alertas',           icon: BellAlertIcon },
      { id: 'backups',     name: 'Backups',           icon: CircleStackIcon },
    ],
  },
  {
    id: 'system',
    label: 'Sistema',
    color: 'text-purple-500',
    bgColor: 'from-purple-500/10 to-purple-500/5',
    items: [
      { id: 'settings',    name: 'Configuración',     icon: CogIcon },
      { id: 'academy',     name: 'Documentación',     icon: AcademicCapIcon },
    ],
  },
  {
    id: 'clientes',
    label: 'Gestión Clientes',
    color: 'text-amber-500',
    bgColor: 'from-amber-500/10 to-amber-500/5',
    items: [
      { id: 'clients-search', name: 'Buscar Clientes',    icon: MagnifyingGlassIcon },
      { id: 'installations',  name: 'Instalaciones',      icon: WrenchScrewdriverIcon },
      { id: 'screen-alerts',  name: 'Avisos en Pantalla', icon: PhotoIcon },
      { id: 'traffic',        name: 'Tráfico',            icon: ArrowTrendingUpIcon },
      { id: 'stats',          name: 'Estadísticas',       icon: ChartBarIcon },
      { id: 'push',           name: 'Push Notifications', icon: BellAlertIcon },
      { id: 'extras',         name: 'Servicios Extra',    icon: BuildingStorefrontIcon },
    ],
  },
  {
    id: 'finanzas',
    label: 'Finanzas',
    color: 'text-teal-500',
    bgColor: 'from-teal-500/10 to-teal-500/5',
    items: [
      { id: 'finance',           name: 'Finanzas',          icon: BanknotesIcon },
      { id: 'billing-promises',  name: 'Promesas de Pago',  icon: CalendarDaysIcon },
    ],
  },
  {
    id: 'sistema',
    label: 'Admin Sistema',
    color: 'text-slate-500',
    bgColor: 'from-slate-500/10 to-slate-500/5',
    items: [
      { id: 'system',      name: 'Sistema',     icon: CogIcon },
      { id: 'permissions', name: 'Permisos',    icon: ShieldCheckIcon },
      { id: 'audit',       name: 'Auditoría',   icon: ClipboardDocumentListIcon },
    ],
  },
]

// ── Componente principal ───────────────────────────────────────────────────────
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ operations: true, infrastructure: true, monitoring: true })
  const { logout, user, tenantContextId, tenantContextName, setTenantContext } = useAuthStore()
  const { branding } = useTheme()

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
              type: 'info' as NotificationType,
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
              type: 'info' as NotificationType,
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
              type: (item.severity === 'critical' ? 'error' : item.severity === 'warning' ? 'warning' : 'info') as NotificationType,
              source: 'network',
            }))
          : []

      const merged = [...networkItems, ...feedItems, ...historyItems]
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
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

  const unreadCount = notifications.filter((n) => !n.read).length
  const isPlatformAdminMode = normalizeRole(user?.role) === 'platform_admin'

  useEffect(() => {
    if (isPlatformAdminMode && !tenantContextId) {
      navigate('/platform')
      return
    }
    loadNotifications()
    const timer = setInterval(loadNotifications, 30000)
    return () => clearInterval(timer)
  }, [loadNotifications, isPlatformAdminMode, tenantContextId, navigate])

  const handleExitTenantMode = () => {
    setTenantContext(null)
    navigate('/platform')
  }

  // Grupos visibles según modo avanzado
  const visibleGroups = showAdvancedMenu ? ALL_NAV_GROUPS : ALL_NAV_GROUPS.slice(0, 4)

  // Nombre de la vista activa
  const activeLabel = ALL_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === activeView)?.name ?? 'Panel'

  const handleMarkAsRead = (id: string) =>
    setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, read: true } : item)))
  const handleMarkAllAsRead = () =>
    setNotifications((prev) => prev.map((item) => ({ ...item, read: true })))
  const handleClearAll = () => setNotifications([])

  const notifIcons: Record<NotificationType, React.ElementType> = {
    error: ExclamationTriangleIcon,
    warning: InformationCircleIcon,
    info: CheckCircleIcon,
  }
  const notifColors: Record<NotificationType, string> = {
    error: 'text-red-400',
    warning: 'text-amber-400',
    info: 'text-emerald-400',
  }

  // ── Sidebar content ──────────────────────────────────────────────────────────
  const SidebarContent: React.FC<{ mobile?: boolean }> = ({ mobile = false }) => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-100">
        {branding.logo_url ? (
          <img src={branding.logo_url} alt={branding.brand_name} className="h-10 w-10 object-contain rounded-lg" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-coral-500 shadow-lg shadow-coral-500/30">
            <span className="text-sm font-black text-white">{branding.brand_name?.[0] || 'I'}</span>
          </div>
        )}
        <div>
          <p className="text-base font-black text-slate-800 leading-tight">{branding.brand_name}</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-coral-500">Panel Admin</p>
        </div>
      </div>

      {/* Toggle módulos avanzados */}
      <div className="px-4 py-3 border-b border-gray-100">
        <label className="flex cursor-pointer items-center gap-2.5 text-xs text-slate-500 hover:text-slate-800 transition-colors">
          <div className="relative">
            <input
              type="checkbox"
              checked={showAdvancedMenu}
              onChange={(e) => {
                const val = e.target.checked
                setShowAdvancedMenu(val)
                safeStorage.setItem('showAdvancedMenu', String(val))
              }}
              className="sr-only"
            />
            <div className={`h-5 w-9 rounded-full transition-colors ${showAdvancedMenu ? 'bg-coral-500' : 'bg-slate-200'}`} />
            <div className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${showAdvancedMenu ? 'translate-x-4' : ''}`} />
          </div>
          <span>Módulos avanzados</span>
        </label>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-200">
        {visibleGroups.map((group) => {
          const isOpen = openGroups[group.id] ?? false
          return (
            <div key={group.id} className="rounded-xl overflow-hidden border border-gray-100">
              <button
                onClick={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !isOpen }))}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold uppercase tracking-[0.12em] bg-gradient-to-r ${group.bgColor} hover:brightness-105 transition-all`}
              >
                <span className={`flex items-center gap-2 ${group.color}`}>
                  <ChevronRightIcon className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
                  {group.label}
                </span>
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 bg-white/50 ${group.color}`}>
                  {group.items.length}
                </span>
              </button>
              {isOpen && (
                <div className="bg-white py-1">
                  {group.items.map((item) => {
                    const isActive = activeView === item.id
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveView(item.id)
                          if (mobile) setSidebarOpen(false)
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-all rounded-lg mx-1 my-0.5 ${
                          isActive
                            ? `bg-coral-50 text-coral-500 shadow-sm border border-coral-100`
                            : 'text-slate-500 hover:text-slate-800 hover:bg-gray-50'
                        }`}
                        style={{ width: 'calc(100% - 8px)' }}
                      >
                        <item.icon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-coral-500' : 'text-slate-500'}`} />
                        <span className="truncate">{item.name}</span>
                        {isActive && (
                          <span className={`ml-auto h-1.5 w-1.5 rounded-full bg-coral-500 flex-shrink-0`} />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* User info */}
      <div className="border-t border-gray-100 px-4 py-4 bg-gray-50/50">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-coral-500 text-sm font-bold text-white shadow-sm">
            {(user?.name?.[0] ?? 'A').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-800">{user?.name || 'Admin ISP'}</p>
            <p className="truncate text-xs text-slate-500">{user?.email || 'admin@ispmax.com'}</p>
            {isPlatformAdminMode && (
              <p className="text-[10px] text-coral-600 font-bold">Tenant: {tenantContextName || tenantContextId}</p>
            )}
          </div>
          <button
            onClick={logout}
            title="Cerrar sesión"
            className="flex-shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-coral-100 hover:text-coral-600 transition-colors"
          >
            <ArrowLeftOnRectangleIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )

  // ── View components ──────────────────────────────────────────────────────────
  const viewComponents: Record<string, React.ReactNode> = {
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
    sstp: <SstpProvisioning />,
    academy: <InteractiveDocs onNavigateToModule={(moduleId) => setActiveView(moduleId)} />,
    maps: <NetworkMap />,
    billing: (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => {
              const idStr = window.prompt('ID del cliente para cambiar plan')
              const parsed = idStr ? parseInt(idStr, 10) : NaN
              if (!parsed) return
              setSelectedClientId(parsed)
              setShowPlanModal(true)
            }}
            className="px-4 py-2.5 rounded-xl bg-coral-500 text-white font-bold hover:bg-coral-600 transition-colors shadow-sm shadow-coral-500/20 border border-coral-400"
          >
            Cambiar plan
          </button>
          <button
            onClick={async () => {
              if (!window.confirm('¿Generar facturas masivas para este mes?')) return
              try {
                const res = await apiClient.post('/admin/billing/generate-batch')
                if (res.task_id) {
                  alert('Éxito: El proceso de facturación masiva se inició en segundo plano. Esto puede tardar unos minutos.')
                } else {
                  alert(`Éxito: Se generaron ${res.generated_count || 0} facturas.`)
                }
              } catch (err) {
                alert('Error al generar facturas masivas.')
              }
            }}
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition-colors shadow flex items-center gap-2"
          >
            <CalendarDaysIcon className="h-5 w-5" />
            Generar Facturas del Mes
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
    connectivity: <ConnectivityDashboard />,
    noc: <NocDashboard />,
    alerts: <AlertsView />,
    tickets: <TicketsAdmin />,
    backups: <BackupsView />,
    settings: <SettingsView />,
    gis: <InfrastructureMap />,
    assets: <AssetTracking />,
  }


  return (
    <div className="min-h-screen bg-[#FDF5E6] text-slate-800">

      {/* ── Mobile sidebar ── */}
      <Transition.Root show={sidebarOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50 lg:hidden" onClose={setSidebarOpen}>
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-linear duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm" />
          </Transition.Child>
          <div className="fixed inset-0 z-50 flex">
            <Transition.Child
              as={Fragment}
              enter="transition ease-in-out duration-300 transform"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition ease-in-out duration-300 transform"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <Dialog.Panel className="relative flex w-72 flex-col bg-white border-r border-gray-100 shadow-2xl">
                <div className="absolute top-3 right-3">
                  <button
                    onClick={() => setSidebarOpen(false)}
                    title="Cerrar menú"
                    aria-label="Cerrar menú"
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-gray-100 hover:text-slate-800"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
                <SidebarContent mobile />
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>

      {/* ── Desktop sidebar ── */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col z-30 border-r border-gray-100 bg-white shadow-sm">
        <SidebarContent />
      </div>

      {/* ── Main content ── */}
      <div className="lg:pl-64 flex flex-col min-h-screen">

        {/* Platform admin banner */}
        {isPlatformAdminMode && (
          <div className="mx-4 mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center justify-between">
            <span>
              <span className="font-bold text-amber-700">Modo Admin ISP</span> — Tenant activo:{' '}
              <span className="font-mono font-bold text-amber-900">{tenantContextName || tenantContextId || 'Ninguno (Error)'}</span>
            </span>
            <button
              onClick={handleExitTenantMode}
              className="ml-4 rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-200 transition-colors"
            >
              ← Volver a Admin Total
            </button>
          </div>
        )}

        {/* ── Top navbar ── */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-gray-100 bg-white/80 backdrop-blur-md px-4 shadow-sm">
          {/* Mobile menu button */}
          <button
            onClick={() => setSidebarOpen(true)}
            title="Abrir menú"
            aria-label="Abrir menú"
            className="lg:hidden rounded-lg p-2 text-slate-500 hover:bg-gray-100 transition-colors"
          >
            <Bars3Icon className="h-5 w-5" />
          </button>

          {/* Breadcrumb / title */}
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-xs text-slate-500 hidden sm:block">{branding.brand_name}</span>
            <ChevronRightIcon className="h-3 w-3 text-slate-600 hidden sm:block" />
            <h2 className="text-sm font-bold text-slate-800 truncate">{activeLabel}</h2>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2">

            {/* Notifications */}
            <Menu as="div" className="relative">
              <Menu.Button className="relative flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-gray-100 transition-colors">
                <BellAlertIcon className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-coral-500 text-[10px] font-bold text-white shadow-sm">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Menu.Button>
              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <Menu.Items className="absolute right-0 z-30 mt-2 w-96 origin-top-right rounded-2xl border border-gray-100 bg-white shadow-xl focus:outline-none overflow-hidden">
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <p className="text-sm font-bold text-slate-800">Notificaciones</p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={loadNotifications}
                        disabled={loadingNotifications}
                        className="text-xs text-slate-500 hover:text-slate-600 disabled:opacity-50 transition-colors"
                      >
                        {loadingNotifications ? 'Actualizando...' : 'Refrescar'}
                      </button>
                      <button
                        onClick={handleMarkAllAsRead}
                        disabled={unreadCount === 0}
                        className="text-xs text-coral-500 hover:text-coral-600 disabled:opacity-40 transition-colors"
                      >
                        Leer todas
                      </button>
                      <button
                        onClick={handleClearAll}
                        disabled={notifications.length === 0}
                        className="text-xs text-slate-500 hover:text-slate-600 disabled:opacity-40 transition-colors"
                      >
                        Limpiar
                      </button>
                    </div>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
                    {notifications.length > 0 ? (
                      notifications.map((n) => {
                        const Icon = notifIcons[n.type]
                        return (
                          <Menu.Item key={n.id}>
                            {({ active }) => (
                              <button
                                onClick={() => handleMarkAsRead(n.id)}
                                className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${active ? 'bg-gray-50' : ''}`}
                              >
                                {!n.read && (
                                  <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-coral-400" />
                                )}
                                <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${notifColors[n.type]} ${n.read ? 'ml-4' : ''}`} />
                                <div className="min-w-0 flex-1">
                                  <p className={`text-xs leading-snug ${n.read ? 'text-slate-500' : 'text-slate-800 font-medium'}`}>
                                    {n.message}
                                  </p>
                                  <p className="mt-0.5 text-[10px] text-slate-500">
                                    {n.time.replace('T', ' ').slice(0, 16)} · {n.source}
                                  </p>
                                </div>
                              </button>
                            )}
                          </Menu.Item>
                        )
                      })
                    ) : (
                      <div className="py-10 text-center text-sm text-slate-500">Sin notificaciones</div>
                    )}
                  </div>
                </Menu.Items>
              </Transition>
            </Menu>

            {/* Profile */}
            <Menu as="div" className="relative">
              <Menu.Button className="flex h-9 w-9 items-center justify-center rounded-xl bg-coral-500 text-sm font-bold text-white shadow-lg shadow-coral-500/25 hover:brightness-110 transition-all">
                {(user?.name?.[0] ?? 'A').toUpperCase()}
              </Menu.Button>
              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <Menu.Items className="absolute right-0 z-30 mt-2 w-52 origin-top-right rounded-2xl border border-gray-100 bg-white py-1 shadow-xl focus:outline-none overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-bold text-slate-800 truncate">{user?.name || 'Admin ISP'}</p>
                    <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                  </div>
                  {isPlatformAdminMode && (
                    <Menu.Item>
                      {({ active }) => (
                        <button
                          onClick={handleExitTenantMode}
                          className={`flex w-full items-center gap-2 px-4 py-2.5 text-sm text-amber-600 font-medium transition-colors ${active ? 'bg-gray-50' : ''}`}
                        >
                          <ArrowLeftOnRectangleIcon className="h-4 w-4" />
                          Volver a Admin Total
                        </button>
                      )}
                    </Menu.Item>
                  )}
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={logout}
                        className={`flex w-full items-center gap-2 px-4 py-2.5 text-sm text-rose-500 font-medium transition-colors ${active ? 'bg-gray-50' : ''}`}
                      >
                        <ArrowLeftOnRectangleIcon className="h-4 w-4" />
                        Cerrar sesión
                      </button>
                    )}
                  </Menu.Item>
                </Menu.Items>
              </Transition>
            </Menu>
          </div>
        </header>

        {/* ── Main area ── */}
        <main className="flex-1 bg-[#FDF5E6]">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              {viewComponents[activeView] ?? (
                <div className="flex items-center justify-center py-20 text-slate-500">
                  Vista no encontrada
                </div>
              )}
            </motion.div>
          </div>
        </main>
      </div>

      {/* ── Modals ── */}
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
