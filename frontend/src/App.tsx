import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from './contexts/ThemeContext'
import Login from './pages/Login'
import ClientDashboard from './pages/ClientDashboard'
import BillingPortal from './pages/BillingPortal'
import AdminPanel from './pages/AdminPanel'
import SstpProvisioning from './pages/SstpProvisioning'
import TechApp from './pages/TechApp'
import ClientUsage from './pages/ClientUsage'
import ClientSupport from './pages/ClientSupport'
import ClientProfile from './pages/ClientProfile'
import PlatformAdmin from './pages/PlatformAdmin'
import PlatformBootstrap from './pages/PlatformBootstrap'
import { useAuthStore } from './store/authStore'
import ProtectedRoute from './components/ProtectedRoute'
import { roleHomePath } from './lib/roles'


function App() {
  const { isAuthenticated, user } = useAuthStore()
  const authHome = roleHomePath(user?.role)

  return (
    <ThemeProvider>
        <div className="app-shell min-h-screen">
          <Toaster position="top-right" />
          <Routes>
            <Route path="/" element={<Navigate to={isAuthenticated ? authHome : "/login"} />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['client']}><ClientDashboard /></ProtectedRoute>} />
            <Route path="/dashboard/billing" element={<ProtectedRoute allowedRoles={['client']}><BillingPortal /></ProtectedRoute>} />
            <Route path="/dashboard/usage" element={<ProtectedRoute allowedRoles={['client']}><ClientUsage /></ProtectedRoute>} />
            <Route path="/dashboard/support" element={<ProtectedRoute allowedRoles={['client']}><ClientSupport /></ProtectedRoute>} />
            <Route path="/dashboard/profile" element={<ProtectedRoute allowedRoles={['client']}><ClientProfile /></ProtectedRoute>} />
            <Route path="/tech" element={<ProtectedRoute allowedRoles={['admin', 'platform_admin', 'tech', 'support', 'billing', 'noc', 'operator']}><TechApp /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin', 'platform_admin', 'tech', 'support', 'billing', 'noc', 'operator']}><AdminPanel /></ProtectedRoute>} />
            <Route path="/admin/sstp" element={<ProtectedRoute allowedRoles={['admin', 'platform_admin', 'tech', 'noc', 'operator']}><SstpProvisioning /></ProtectedRoute>} />
            <Route path="/platform" element={<ProtectedRoute allowedRoles={['platform_admin']}><PlatformAdmin /></ProtectedRoute>} />
            <Route path="/platform/bootstrap" element={isAuthenticated ? <Navigate to={authHome} /> : <PlatformBootstrap />} />
            <Route path="*" element={<Navigate to={isAuthenticated ? authHome : "/login"} />} />
          </Routes>
        </div>
    </ThemeProvider>
  )
}

export default App
