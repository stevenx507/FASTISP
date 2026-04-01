import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from './contexts/ThemeContext'
import { useAuthStore } from './store/authStore'
import ProtectedRoute from './components/ProtectedRoute'
import LoadingSpinner from './components/LoadingSpinner'
import { roleHomePath } from './lib/roles'

const Login = lazy(() => import('./pages/Login'))
const ClientDashboard = lazy(() => import('./pages/ClientDashboard'))
const BillingPortal = lazy(() => import('./pages/BillingPortal'))
const AdminPanel = lazy(() => import('./pages/AdminPanel'))
const TechApp = lazy(() => import('./pages/TechApp'))
const ClientUsage = lazy(() => import('./pages/ClientUsage'))
const ClientSupport = lazy(() => import('./pages/ClientSupport'))
const ClientProfile = lazy(() => import('./pages/ClientProfile'))
const PlatformAdmin = lazy(() => import('./pages/PlatformAdmin'))
const PlatformBootstrap = lazy(() => import('./pages/PlatformBootstrap'))

const staffAllowedRoles = ['admin', 'platform_admin', 'tech', 'support', 'billing', 'noc', 'operator']

const RouteLoadingFallback = () => (
  <div className="flex min-h-screen items-center justify-center px-6">
    <LoadingSpinner size="lg" label="Cargando modulo..." />
  </div>
)

function App() {
  const { isAuthenticated, user } = useAuthStore()
  const authHome = roleHomePath(user?.role)

  return (
    <ThemeProvider>
      <div className="app-shell min-h-screen">
        <Toaster position="top-right" />
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to={isAuthenticated ? authHome : "/login"} />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['client']}><ClientDashboard /></ProtectedRoute>} />
            <Route path="/dashboard/billing" element={<ProtectedRoute allowedRoles={['client']}><BillingPortal /></ProtectedRoute>} />
            <Route path="/dashboard/usage" element={<ProtectedRoute allowedRoles={['client']}><ClientUsage /></ProtectedRoute>} />
            <Route path="/dashboard/support" element={<ProtectedRoute allowedRoles={['client']}><ClientSupport /></ProtectedRoute>} />
            <Route path="/dashboard/profile" element={<ProtectedRoute allowedRoles={['client']}><ClientProfile /></ProtectedRoute>} />
            <Route path="/tech" element={<ProtectedRoute allowedRoles={staffAllowedRoles}><TechApp /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute allowedRoles={staffAllowedRoles}><AdminPanel /></ProtectedRoute>} />
            <Route path="/platform" element={<ProtectedRoute allowedRoles={['platform_admin']}><PlatformAdmin /></ProtectedRoute>} />
            <Route path="/platform/bootstrap" element={isAuthenticated ? <Navigate to={authHome} /> : <PlatformBootstrap />} />
            <Route path="*" element={<Navigate to={isAuthenticated ? authHome : "/login"} />} />
          </Routes>
        </Suspense>
      </div>
    </ThemeProvider>
  )
}

export default App
