import { useAuthStore } from '../store/authStore'
import config from './config'

export class ApiError extends Error {
  status: number
  payload?: unknown

  constructor(message: string, status: number, payload?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

const API_BASE = config.API_BASE_URL.endsWith('/')
  ? config.API_BASE_URL.slice(0, -1)
  : config.API_BASE_URL

const buildUrl = (endpoint: string) => {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint
  }

  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  return `${API_BASE}${normalizedEndpoint}`
}

export const apiClient = {
  async request(endpoint: string, options: RequestInit = {}) {
    const { token, tenantContextId } = useAuthStore.getState()
    const headers = new Headers(options.headers)
    const bodyIsFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
    if (options.body && !bodyIsFormData && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    if (tenantContextId !== null && tenantContextId !== undefined) {
      headers.set('X-Tenant-ID', String(tenantContextId))
    }

    // Add timeout to prevent indefinite hanging
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(new DOMException('Request timeout after 30s', 'TimeoutError')), 30000) // 30s timeout

    let response: Response
    try {
      response = await fetch(buildUrl(endpoint), {
        ...options,
        headers,
        signal: options.signal ?? controller.signal,
      })
    } catch (fetchError) {
      clearTimeout(timeoutId)
      if (fetchError instanceof DOMException && (fetchError.name === 'AbortError' || fetchError.name === 'TimeoutError')) {
        throw new ApiError('El servidor no respondió a tiempo. Verifica tu conexión o intenta de nuevo.', 0)
      }
      throw fetchError
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      if (response.status === 401) {
        useAuthStore.getState().logout()
      }

      const contentType = response.headers.get('content-type') || ''

      if (contentType.includes('application/json')) {
        try {
          const errorData = await response.json()
          const message = errorData?.error || errorData?.message || `HTTP Error: ${response.status}`
          throw new ApiError(String(message), response.status, errorData)
        } catch (jsonError) {
          if (jsonError instanceof ApiError) {
            throw jsonError
          }
        }
      }

      try {
        const text = await response.text()
        throw new ApiError(text || `HTTP Error: ${response.status}`, response.status)
      } catch {
        throw new ApiError(`HTTP Error: ${response.status}`, response.status)
      }
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) return response.json()
    return response.text()
  },

  get(endpoint: string) {
    return this.request(endpoint, { method: 'GET' })
  },

  post(endpoint: string, data?: unknown) {
    return this.request(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  },

  patch(endpoint: string, data?: unknown) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    })
  },

  put(endpoint: string, data?: unknown) {
    return this.request(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    })
  },

  delete(endpoint: string) {
    return this.request(endpoint, { method: 'DELETE' })
  },
}
