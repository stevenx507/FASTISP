import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { hasAllowedRole, normalizeRole, roleHomePath } from '../lib/roles'

type ProtectedRouteProps = {
  children: React.ReactElement
  adminOnly?: boolean
  allowedRoles?: string[]
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  adminOnly = false,
  allowedRoles,
}) => {
  const { isAuthenticated, user } = useAuthStore()
  const roleHome = roleHomePath(user?.role)
  const normalizedRole = normalizeRole(user?.role)

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (allowedRoles && !hasAllowedRole(user?.role, allowedRoles)) {
    return <Navigate to={roleHome} replace />
  }

  if (adminOnly && !['admin', 'platform_admin'].includes(normalizedRole)) {
    return <Navigate to={roleHome} replace />
  }

  return children
}

export default ProtectedRoute
