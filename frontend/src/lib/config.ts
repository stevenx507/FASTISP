// Frontend environment configuration
// This file centralizes all API endpoints and configuration

export const config = {
  API_BASE_URL: import.meta.env.VITE_API_URL || '/api',
  APP_NAME: 'ISPMAX',
  APP_VERSION: '1.0.0',
  GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  GRAFANA_URL: import.meta.env.VITE_GRAFANA_URL || '',
  WONDERPUSH_WEBKEY: import.meta.env.VITE_WONDERPUSH_WEBKEY || '',
  
  // Feature flags
  FEATURES: {
    SPEEDTEST: true,
    NETWORK_MAP: true,
    AI_DIAGNOSIS: true,
    ADVANCED_MONITORING: true,
  },

  // API endpoints
  ENDPOINTS: {
    AUTH: {
      LOGIN: '/auth/login',
      LOGOUT: '/auth/logout',
      REFRESH: '/auth/refresh',
    },
    CLIENT: {
      DASHBOARD: '/dashboard/stats',
      USAGE_HISTORY: '/clients/usage-history',
      REBOOT_CPE: (id: number) => `/clients/${id}/reboot-cpe`,
      HISTORY: (id: number) => `/clients/${id}/history`,
    },
    ADMIN: {
      ROUTERS: '/mikrotik/routers',
      CLIENTS: '/admin/clients',
      PLANS: '/admin/plans',
      METRICS: (routerId: string) => `/mikrotik/routers/${routerId}/metrics`,
    },
  },
}

export default config
