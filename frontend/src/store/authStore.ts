import { create } from 'zustand'
import { persist, StorageValue } from 'zustand/middleware'
import { apiClient } from '../lib/apiClient'
import { safeStorage } from '../lib/storage'
import { AppRole, normalizeRole } from '../lib/roles'

interface User {
  id: string
  name: string
  email: string
  role: AppRole
  plan?: string
  client_id?: number
  mfa_enabled?: boolean
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  tenantContextId: number | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  setTenantContext: (tenantId: number | null) => void
}

const storage = {
  getItem: (name: string): StorageValue<AuthState> | null => {
    try {
      const item = safeStorage.getItem(name)
      return item ? JSON.parse(item) : null
    } catch (error) {
      console.warn('[AuthStore] Failed to load state from storage:', error)
      return null
    }
  },
  setItem: (name: string, value: StorageValue<AuthState>): void => {
    try {
      safeStorage.setItem(name, JSON.stringify(value))
    } catch (error) {
      console.warn('[AuthStore] Failed to save state to storage:', error)
    }
  },
  removeItem: (name: string): void => {
    try {
      safeStorage.removeItem(name)
    } catch (error) {
      console.warn('[AuthStore] Failed to remove state from storage:', error)
    }
  },
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      tenantContextId: null,
      login: async (email, password) => {
        const data = await apiClient.post('/auth/login', { email, password })
        const token = data.token
        const user = data.user

        if (!token || !user) {
          throw new Error('Respuesta de autenticacion invalida.')
        }

        const normalizedUser: User = {
          ...user,
          role: normalizeRole(user.role),
        }

        set({ user: normalizedUser, token, isAuthenticated: true, tenantContextId: null })
      },
      logout: () => {
        set({ user: null, token: null, isAuthenticated: false, tenantContextId: null })
      },
      setTenantContext: (tenantId) => {
        set({ tenantContextId: tenantId })
      },
    }),
    {
      name: 'auth-storage',
      storage,
    },
  ),
)

