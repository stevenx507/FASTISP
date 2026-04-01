export type StaffRole = 'admin' | 'tech' | 'support' | 'billing' | 'noc' | 'operator'
export type AppRole = 'platform_admin' | StaffRole | 'client'

export const normalizeRole = (rawRole: unknown): AppRole => {
  const token = String(rawRole || '')
    .trim()
    .toLowerCase()

  if (token === 'platform_admin' || token === 'platform-admin' || token === 'platformadmin') {
    return 'platform_admin'
  }

  if (token === 'admin' || token === 'admin_isp' || token === 'isp_admin' || token === 'administrator') {
    return 'admin'
  }
  if (token === 'tech' || token === 'technician' || token === 'tecnico') {
    return 'tech'
  }
  if (token === 'support' || token === 'soporte') {
    return 'support'
  }
  if (token === 'billing' || token === 'finance' || token === 'cobranzas') {
    return 'billing'
  }
  if (token === 'noc') {
    return 'noc'
  }
  if (token === 'operator' || token === 'operador' || token === 'ops') {
    return 'operator'
  }

  return 'client'
}

export const roleHomePath = (rawRole: unknown): '/platform' | '/admin' | '/tech' | '/dashboard' => {
  const role = normalizeRole(rawRole)
  if (role === 'platform_admin') return '/platform'
  if (role === 'admin') return '/admin'
  if (['tech', 'support', 'billing', 'noc', 'operator'].includes(role)) return '/tech'
  return '/dashboard'
}

export const hasAllowedRole = (rawRole: unknown, allowedRoles: string[]): boolean => {
  const role = normalizeRole(rawRole)
  return allowedRoles.includes(role)
}
