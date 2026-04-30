import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import { config } from '../lib/config'
import { Dialog, Transition, Menu } from '@headlessui/react'
import {
  ChartBarIcon,
  CreditCardIcon,
  WifiIcon,
  ChatBubbleLeftRightIcon,
  Bars3Icon,
  XMarkIcon,
  BellIcon,
  ArrowLeftOnRectangleIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../store/authStore'
import { apiClient } from '../lib/apiClient'
import NocAlertListener from './admin/NocAlertListener'
import { useTheme } from '../contexts/ThemeContext'

const tabs = [
  { id: 'dashboard', name: 'Dashboard', path: '/dashboard', icon: ChartBarIcon },
  { id: 'billing', name: 'Facturacion', path: '/dashboard/billing', icon: CreditCardIcon },
  { id: 'usage', name: 'Uso detallado', path: '/dashboard/usage', icon: WifiIcon },
  { id: 'wifi', name: 'Mi WiFi', path: '/dashboard/wifi', icon: WifiIcon },
  { id: 'support', name: 'Soporte', path: '/dashboard/support', icon: ChatBubbleLeftRightIcon },
  { id: 'profile', name: 'Mi perfil', path: '/dashboard/profile', icon: UserCircleIcon },
]

interface NotificationItem {
  id: string
  message: string
  time: string
  read: boolean
  href: string
}

interface AppLayoutProps {
  children?: React.ReactNode
}

const inferNotificationHref = (message: string) => {
  const text = message.toLowerCase()
  if (text.includes('factura') || text.includes('pago')) return '/dashboard/billing'
  if (text.includes('ticket') || text.includes('soporte')) return '/dashboard/support'
  return '/dashboard'
}

const formatRelativeTime = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value

  const diffMs = Date.now() - parsed.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Hace unos segundos'
  if (diffMin < 60) return `Hace ${diffMin} min`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `Hace ${diffHours} h`
  return parsed.toLocaleDateString()
}

const resolveRouteTitle = (pathname: string) => {
  const sortedTabs = tabs.slice().sort((a, b) => b.path.length - a.path.length)
  const match = sortedTabs.find((tab) => pathname === tab.path || pathname.startsWith(`${tab.path}/`))
  return match?.name || 'Dashboard'
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { user, logout } = useAuthStore()
  const { branding } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [serviceActive, setServiceActive] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loadingNotifications, setLoadingNotifications] = useState(false)

  const currentTitle = useMemo(() => resolveRouteTitle(location.pathname), [location.pathname])
  const unreadNotifications = useMemo(() => notifications.filter((item) => !item.read).length, [notifications])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const loadNotifications = useCallback(async () => {
    setLoadingNotifications(true)
    try {
      const response = await apiClient.get('/notifications') as {
        notifications?: Array<{ id: string | number; message: string; time?: string; read?: boolean }>
      }

      const nextItems: NotificationItem[] = (response.notifications || []).map((item) => ({
        id: String(item.id),
        message: item.message,
        time: item.time || new Date().toISOString(),
        read: Boolean(item.read),
        href: inferNotificationHref(item.message),
      }))

      setNotifications((previous) => {
        const readMap = new Map(previous.map((item) => [item.id, item.read]))
        return nextItems.map((item) => ({
          ...item,
          read: readMap.get(item.id) ?? item.read,
        }))
      })
    } catch (err) {
      console.error('[AppLayout] notifications error', err)
    } finally {
      setLoadingNotifications(false)
    }
  }, [])

  const handleNotificationClick = (notification: NotificationItem) => {
    setNotifications((previous) =>
      previous.map((item) => (item.id === notification.id ? { ...item, read: true } : item))
    )
    navigate(notification.href)
  }

  const markAllAsRead = () => {
    setNotifications((previous) => previous.map((item) => ({ ...item, read: true })))
  }

  useEffect(() => {
    // Real-Time 2.0: Conexión vía Socket.io para reemplazar polling
    const socketUrl = config.API_BASE_URL.replace('/api', '')
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    })

    socket.on('health_update', (data) => {
      // Si somos admin, data tiene 'routers'.
      if (user?.role === 'admin') {
        const anyOnline = data.routers?.some((r: any) => r.health_score > 0)
        setServiceActive(anyOnline)
      } else {
        setServiceActive(true)
      }
    })

    socket.on('notification_received', (data) => {
      const newItem: NotificationItem = {
        id: String(Date.now()),
        message: data.message,
        time: data.timestamp || new Date().toISOString(),
        read: false,
        href: inferNotificationHref(data.message),
      }
      setNotifications(prev => [newItem, ...prev.slice(0, 19)])
    })

    // Cargas iniciales
    loadNotifications()

    return () => {
      socket.disconnect()
    }
  }, [loadNotifications, user?.role])

  const NavigationLinks: React.FC<{ isMobile?: boolean }> = ({ isMobile = false }) => (
    <nav className={isMobile ? 'space-y-1 px-2' : 'flex-1 space-y-1 px-2 pb-4'}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.name}
          to={tab.path}
          end={tab.path === '/dashboard'}
          onClick={() => isMobile && setSidebarOpen(false)}
          className={({ isActive }) =>
            `group flex items-center rounded-xl px-3 py-2.5 text-sm font-bold ${
              isActive ? 'bg-coral-50 text-coral-500 border border-coral-100' : 'text-slate-500 hover:bg-gray-50 hover:text-slate-800'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <tab.icon
                className={`mr-3 h-5 w-5 flex-shrink-0 ${
                  isActive ? 'text-coral-500' : 'text-slate-400 group-hover:text-slate-700'
                }`}
              />
              {tab.name}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <>
      <NocAlertListener />
      <div className="min-h-screen bg-[#FDF5E6] text-slate-800">
        <Transition.Root show={sidebarOpen} as={Fragment}>
          <Dialog as="div" className="relative z-40 md:hidden" onClose={setSidebarOpen}>
            <Transition.Child
              as={Fragment}
              enter="transition-opacity ease-linear duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="transition-opacity ease-linear duration-300"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm" />
            </Transition.Child>
            <div className="fixed inset-0 z-40 flex">
              <Transition.Child
                as={Fragment}
                enter="transition ease-in-out duration-300 transform"
                enterFrom="-translate-x-full"
                enterTo="translate-x-0"
                leave="transition ease-in-out duration-300 transform"
                leaveFrom="translate-x-0"
                leaveTo="-translate-x-full"
              >
                <Dialog.Panel className="relative flex w-full max-w-xs flex-1 flex-col bg-white border-r border-gray-100 shadow-2xl pb-4 pt-5">
                  <Transition.Child
                    as={Fragment}
                    enter="ease-in-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in-out duration-300"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                  >
                    <div className="absolute right-0 top-0 -mr-12 pt-2">
                      <button
                        type="button"
                        className="ml-1 flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:text-slate-800 focus:outline-none"
                        onClick={() => setSidebarOpen(false)}
                      >
                        <XMarkIcon className="h-6 w-6" />
                      </button>
                    </div>
                  </Transition.Child>

                  <div className="flex flex-shrink-0 items-center px-4">
                    {branding.logo_url ? (
                      <img src={branding.logo_url} alt={branding.brand_name} className="h-10 w-auto max-w-[8rem] object-contain" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-coral-500 shadow-lg shadow-coral-500/30">
                        <span className="text-lg font-bold text-white">
                          {branding.brand_name?.slice(0, 2).toUpperCase() || 'IS'}
                        </span>
                      </div>
                    )}
                    <h1 className="ml-3 text-xl font-black text-slate-800">{branding.brand_name}</h1>
                  </div>

                  <div className="mt-5 h-0 flex-1 overflow-y-auto">
                    <NavigationLinks isMobile />
                  </div>
                </Dialog.Panel>
              </Transition.Child>
              <div className="w-14 flex-shrink-0" />
            </div>
          </Dialog>
        </Transition.Root>

        <div className="hidden md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col">
          <div className="flex flex-grow flex-col overflow-y-auto border-r border-gray-100 bg-white shadow-sm pt-5">
            <div className="flex flex-shrink-0 items-center px-4">
              {branding.logo_url ? (
                <img src={branding.logo_url} alt={branding.brand_name} className="h-10 w-auto max-w-[7rem] object-contain" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-coral-500 shadow-lg shadow-coral-500/30">
                  <span className="text-lg font-extrabold text-white">
                    {branding.brand_name?.slice(0, 2).toUpperCase() || 'IS'}
                  </span>
                </div>
              )}
              <div className="ml-3">
                <h1 className="text-xl font-extrabold tracking-tight text-slate-800">{branding.brand_name}</h1>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-coral-500">Panel del cliente</p>
              </div>
            </div>
            <div className="mt-5 flex flex-grow flex-col">
              <NavigationLinks />
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col md:pl-64">
          <div className="sticky top-0 z-10 flex h-16 flex-shrink-0 bg-white/80 backdrop-blur-md border-b border-gray-100 shadow-sm">
            <button
              type="button"
              className="border-r border-gray-100 px-4 text-slate-500 hover:text-slate-800 focus:outline-none md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Bars3Icon className="h-6 w-6" />
            </button>

            <div className="flex flex-1 justify-between px-4">
              <div className="flex flex-1">
                <h1 className="my-auto text-lg font-bold text-slate-800">{currentTitle}</h1>
              </div>

              <div className="ml-4 flex items-center md:ml-6">
                <div className="hidden items-center space-x-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 md:flex">
                  <div className={`${serviceActive ? 'h-2 w-2 animate-pulse bg-green-400' : 'h-2 w-2 bg-gray-600'} rounded-full`} />
                  <span className={`text-sm font-bold ${serviceActive ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {serviceActive ? 'Servicio activo' : 'Desconectado'}
                  </span>
                </div>

                <Menu as="div" className="relative ml-3">
                  <Menu.Button className="relative rounded-full p-1 text-slate-500 hover:text-coral-500 focus:outline-none">
                    <span className="sr-only">Ver notificaciones</span>
                    <BellIcon className="h-6 w-6" />
                    {unreadNotifications > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                        {unreadNotifications}
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
                    <Menu.Items className="absolute right-0 z-10 mt-2 w-80 origin-top-right rounded-2xl bg-white border border-gray-100 py-1 shadow-xl focus:outline-none">
                      <div className="border-b border-gray-100 px-4 py-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-bold text-slate-800">Notificaciones</p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={loadNotifications}
                              className="text-xs text-slate-400 hover:text-slate-600 hover:underline disabled:text-slate-300"
                              disabled={loadingNotifications}
                            >
                              {loadingNotifications ? 'Actualizando...' : 'Refrescar'}
                            </button>
                            <button
                              onClick={markAllAsRead}
                              className="text-xs text-coral-500 hover:text-coral-600 hover:underline disabled:text-slate-300"
                              disabled={unreadNotifications === 0}
                            >
                              Marcar leidas
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="max-h-80 overflow-y-auto py-1">
                        {notifications.map((notification) => (
                          <Menu.Item key={notification.id}>
                            {({ active }) => (
                              <button
                                onClick={() => handleNotificationClick(notification)}
                                className={`${active ? 'bg-gray-50' : ''} block w-full px-4 py-3 text-left text-sm text-slate-600`}
                              >
                                <p className={`font-medium ${!notification.read ? 'text-slate-800' : 'text-slate-400'}`}>
                                  {notification.message}
                                </p>
                                <p className="mt-1 text-xs text-slate-400">{formatRelativeTime(notification.time)}</p>
                              </button>
                            )}
                          </Menu.Item>
                        ))}

                        {!notifications.length && (
                          <div className="px-4 py-6 text-center text-sm text-slate-400">
                            No hay notificaciones recientes.
                          </div>
                        )}
                      </div>
                    </Menu.Items>
                  </Transition>
                </Menu>

                <Menu as="div" className="relative ml-3">
                  <Menu.Button className="flex max-w-xs items-center rounded-full text-sm focus:outline-none">
                    <span className="sr-only">Abrir menu de usuario</span>
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-coral-500 shadow-lg shadow-coral-500/25">
                      <span className="font-bold text-white">{user?.name ? user.name.charAt(0).toUpperCase() : ''}</span>
                    </div>
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
                    <Menu.Items className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-2xl bg-white border border-gray-100 py-1 shadow-xl focus:outline-none">
                      <div className="border-b border-gray-100 px-4 py-3">
                        <p className="truncate text-sm font-bold text-slate-800">{user?.name}</p>
                        <p className="truncate text-xs text-slate-500">{user?.email}</p>
                      </div>

                      <div className="py-1">
                        <Menu.Item>
                          {({ active }) => (
                            <NavLink
                              to="/dashboard/profile"
                              className={({ isActive: navIsActive }) =>
                                `${active || navIsActive ? 'bg-gray-50' : ''} group flex w-full items-center px-4 py-2 text-sm font-medium text-slate-600`
                              }
                            >
                              <UserCircleIcon className="mr-2 h-5 w-5 text-slate-400" /> Mi perfil
                            </NavLink>
                          )}
                        </Menu.Item>
                        <Menu.Item>
                          {({ active }) => (
                            <button
                              onClick={handleLogout}
                              className={`${active ? 'bg-gray-50' : ''} group flex w-full items-center px-4 py-2 text-sm font-medium text-rose-500`}
                            >
                              <ArrowLeftOnRectangleIcon className="mr-2 h-5 w-5 text-red-500" />
                              Cerrar sesion
                            </button>
                          )}
                        </Menu.Item>
                      </div>
                    </Menu.Items>
                  </Transition>
                </Menu>
              </div>
            </div>
          </div>

          <main className="flex-1">
            <div className="py-6">
              <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">{children || <Outlet />}</div>
            </div>
          </main>
        </div>
      </div>
    </>
  )
}

export default AppLayout
