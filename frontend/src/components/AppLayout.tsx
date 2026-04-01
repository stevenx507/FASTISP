import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
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

const tabs = [
  { id: 'dashboard', name: 'Dashboard', path: '/dashboard', icon: ChartBarIcon },
  { id: 'billing', name: 'Facturacion', path: '/dashboard/billing', icon: CreditCardIcon },
  { id: 'usage', name: 'Uso detallado', path: '/dashboard/usage', icon: WifiIcon },
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
    let mounted = true
    const check = async () => {
      try {
        const res = await fetch('/api/health')
        if (!mounted) return
        setServiceActive(res.ok)
      } catch {
        if (mounted) setServiceActive(false)
      }
    }

    check()
    const id = setInterval(check, 15000)
    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    loadNotifications()
    const timer = setInterval(loadNotifications, 30000)
    return () => clearInterval(timer)
  }, [loadNotifications])

  const NavigationLinks: React.FC<{ isMobile?: boolean }> = ({ isMobile = false }) => (
    <nav className={isMobile ? 'space-y-1 px-2' : 'flex-1 space-y-1 px-2 pb-4'}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.name}
          to={tab.path}
          end={tab.path === '/dashboard'}
          onClick={() => isMobile && setSidebarOpen(false)}
          className={({ isActive }) =>
            `group flex items-center rounded-md px-2 py-2 text-sm font-medium ${
              isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-300 hover:bg-white/10 hover:text-white'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <tab.icon
                className={`mr-3 h-5 w-5 flex-shrink-0 ${
                  isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-white'
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
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_#071327,_#0b1221)] text-gray-100">
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
              <div className="fixed inset-0 bg-gray-900/60" />
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
                <Dialog.Panel className="card relative flex w-full max-w-xs flex-1 flex-col bg-[rgba(255,255,255,0.02)] pb-4 pt-5">
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
                        className="ml-1 flex h-10 w-10 items-center justify-center rounded-full text-white focus:outline-none"
                        onClick={() => setSidebarOpen(false)}
                      >
                        <XMarkIcon className="h-6 w-6" />
                      </button>
                    </div>
                  </Transition.Child>

                  <div className="flex flex-shrink-0 items-center px-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500">
                      <span className="text-lg font-bold text-black">IM</span>
                    </div>
                    <h1 className="ml-3 text-xl font-bold text-white">ISPMAX</h1>
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
          <div className="card flex flex-grow flex-col overflow-y-auto border-r border-transparent bg-[rgba(255,255,255,0.02)] pt-5">
            <div className="flex flex-shrink-0 items-center px-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-r from-neon-cyan to-violet shadow-md">
                <span className="text-lg font-extrabold text-black">IM</span>
              </div>
              <div className="ml-3">
                <h1 className="text-xl font-extrabold tracking-tight text-white">ISPMAX</h1>
                <p className="text-sm text-gray-400">Panel del cliente</p>
              </div>
            </div>
            <div className="mt-5 flex flex-grow flex-col">
              <NavigationLinks />
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col md:pl-64">
          <div className="sticky top-0 z-10 flex h-16 flex-shrink-0 bg-[rgba(255,255,255,0.02)] shadow-sm backdrop-blur-md">
            <button
              type="button"
              className="border-r border-white/10 px-4 text-gray-300 focus:outline-none md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Bars3Icon className="h-6 w-6" />
            </button>

            <div className="flex flex-1 justify-between px-4">
              <div className="flex flex-1">
                <h1 className="my-auto text-lg font-semibold text-white">{currentTitle}</h1>
              </div>

              <div className="ml-4 flex items-center md:ml-6">
                <div className="hidden items-center space-x-2 rounded-lg border border-white/10 bg-[rgba(255,255,255,0.02)] px-3 py-2 md:flex">
                  <div className={`${serviceActive ? 'h-2 w-2 animate-pulse bg-green-400' : 'h-2 w-2 bg-gray-600'} rounded-full`} />
                  <span className={`text-sm font-medium ${serviceActive ? 'text-green-300' : 'text-gray-400'}`}>
                    {serviceActive ? 'Servicio activo' : 'Desconectado'}
                  </span>
                </div>

                <Menu as="div" className="relative ml-3">
                  <Menu.Button className="relative rounded-full p-1 text-gray-300 hover:text-white focus:outline-none">
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
                    <Menu.Items className="absolute right-0 z-10 mt-2 w-80 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                      <div className="border-b border-gray-200 px-4 py-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-gray-900">Notificaciones</p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={loadNotifications}
                              className="text-xs text-gray-600 hover:underline disabled:text-gray-400"
                              disabled={loadingNotifications}
                            >
                              {loadingNotifications ? 'Actualizando...' : 'Refrescar'}
                            </button>
                            <button
                              onClick={markAllAsRead}
                              className="text-xs text-blue-600 hover:underline disabled:text-gray-400"
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
                                className={`${active ? 'bg-gray-100' : ''} block w-full px-4 py-3 text-left text-sm text-gray-700`}
                              >
                                <p className={`font-medium ${!notification.read ? 'text-gray-900' : 'text-gray-600'}`}>
                                  {notification.message}
                                </p>
                                <p className="mt-1 text-xs text-gray-500">{formatRelativeTime(notification.time)}</p>
                              </button>
                            )}
                          </Menu.Item>
                        ))}

                        {!notifications.length && (
                          <div className="px-4 py-6 text-center text-sm text-gray-500">
                            No hay notificaciones recientes.
                          </div>
                        )}
                      </div>
                    </Menu.Items>
                  </Transition>
                </Menu>

                <Menu as="div" className="relative ml-3">
                  <Menu.Button className="flex max-w-xs items-center rounded-full bg-white text-sm focus:outline-none">
                    <span className="sr-only">Abrir menu de usuario</span>
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-neon-cyan to-violet shadow-md">
                      <span className="font-bold text-gray-900">{user?.name ? user.name.charAt(0).toUpperCase() : ''}</span>
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
                    <Menu.Items className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                      <div className="border-b border-gray-200 px-4 py-3">
                        <p className="truncate text-sm font-medium text-gray-900">{user?.name}</p>
                        <p className="truncate text-sm text-gray-500">{user?.email}</p>
                      </div>

                      <div className="py-1">
                        <Menu.Item>
                          {({ active }) => (
                            <NavLink
                              to="/dashboard/profile"
                              className={({ isActive: navIsActive }) =>
                                `${active || navIsActive ? 'bg-gray-100' : ''} group flex w-full items-center px-4 py-2 text-sm text-gray-700`
                              }
                            >
                              <UserCircleIcon className="mr-2 h-5 w-5 text-gray-500" /> Mi perfil
                            </NavLink>
                          )}
                        </Menu.Item>
                        <Menu.Item>
                          {({ active }) => (
                            <button
                              onClick={handleLogout}
                              className={`${active ? 'bg-gray-100' : ''} group flex w-full items-center px-4 py-2 text-sm text-red-600`}
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
