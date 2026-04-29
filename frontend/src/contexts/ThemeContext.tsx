import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { apiClient } from '../lib/apiClient'

export interface BrandingConfig {
  tenant_id?: number | null
  brand_name: string
  logo_url: string | null
  primary_color: string
  secondary_color: string
  custom_domain?: string | null
}

interface ThemeContextType {
  isDark: boolean
  toggleTheme: () => void
  branding: BrandingConfig
  refreshBranding: () => Promise<void>
}

const defaultBranding: BrandingConfig = {
  tenant_id: null,
  brand_name: 'ISPMAX',
  logo_url: null,
  primary_color: '#3b82f6',
  secondary_color: '#1e293b',
  custom_domain: null,
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

/**
 * Aplica las variables CSS del branding al :root del documento.
 * Esto permite que cualquier componente use var(--primary-color), etc.
 */
function applyBrandingCSS(config: BrandingConfig): void {
  const root = document.documentElement

  if (config.primary_color) {
    root.style.setProperty('--primary-color', config.primary_color)
    // Derivar variantes de color del primario
    root.style.setProperty('--primary-color-hover', config.primary_color + 'cc')
  }

  if (config.secondary_color) {
    root.style.setProperty('--secondary-color', config.secondary_color)
  }

  if (config.logo_url) {
    root.style.setProperty('--logo-url', `url("${config.logo_url}")`)
  } else {
    root.style.removeProperty('--logo-url')
  }

  if (config.brand_name) {
    // Actualizar el título de la pestaña del navegador
    const currentTitle = document.title
    const baseName = config.brand_name
    if (!currentTitle.includes(baseName)) {
      document.title = `${baseName} | Panel`
    }
  }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDark, setIsDark] = useState(true)
  const [branding, setBranding] = useState<BrandingConfig>(defaultBranding)

  const fetchBranding = useCallback(async () => {
    try {
      // Pasar el hostname para resolución por subdominio en el backend
      const host = window.location.hostname
      const params = host && host !== 'localhost' ? `?host=${encodeURIComponent(host)}` : ''
      const config = await apiClient.get(`/branding/config${params}`)
      if (config && config.brand_name) {
        const validated: BrandingConfig = {
          tenant_id: config.tenant_id ?? null,
          brand_name: config.brand_name || defaultBranding.brand_name,
          logo_url: config.logo_url || null,
          primary_color: config.primary_color || defaultBranding.primary_color,
          secondary_color: config.secondary_color || defaultBranding.secondary_color,
          custom_domain: config.custom_domain || null,
        }
        setBranding(validated)
        applyBrandingCSS(validated)
      }
    } catch (err) {
      console.warn('[ThemeContext] Branding no disponible, usando valores por defecto')
    }
  }, [])

  useEffect(() => {
    // Modo oscuro por defecto para look premium
    document.documentElement.classList.add('dark')
    // Aplicar defaults inmediatamente (evita flash sin estilos)
    applyBrandingCSS(defaultBranding)
    // Luego cargar branding real desde API
    fetchBranding()
  }, [fetchBranding])

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev
      if (next) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme, branding, refreshBranding: fetchBranding }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
