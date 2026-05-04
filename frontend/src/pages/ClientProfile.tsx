import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import AppLayout from '../components/AppLayout'
import { apiClient } from '../lib/apiClient'
import { useAuthStore } from '../store/authStore'

interface NotificationPreferences {
  email: boolean
  whatsapp: boolean
  push: boolean
}

interface PortalOverview {
  plan?: string | null
  router?: string | null
  connection_type?: string | null
  ip_address?: string | null
  status?: string | null
}

const emptyPreferences: NotificationPreferences = {
  email: true,
  whatsapp: false,
  push: false,
}

const ClientProfile: React.FC = () => {
  const { user, logout } = useAuthStore()
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [preferences, setPreferences] = useState<NotificationPreferences>(emptyPreferences)
  const [overview, setOverview] = useState<PortalOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPreferences, setSavingPreferences] = useState(false)

  useEffect(() => {
    setName(user?.name || '')
    setEmail(user?.email || '')
  }, [user?.name, user?.email])

  const loadProfileData = useCallback(async () => {
    setLoading(true)
    try {
      const [preferencesRes, overviewRes] = await Promise.allSettled([
        apiClient.get('/client/notifications/preferences') as Promise<{ preferences?: NotificationPreferences }>,
        apiClient.get('/client/portal') as Promise<PortalOverview>,
      ])

      if (preferencesRes.status === 'fulfilled') {
        setPreferences({
          email: Boolean(preferencesRes.value.preferences?.email),
          whatsapp: Boolean(preferencesRes.value.preferences?.whatsapp),
          push: Boolean(preferencesRes.value.preferences?.push),
        })
      }

      if (overviewRes.status === 'fulfilled') {
        setOverview(overviewRes.value || null)
      }

      if (preferencesRes.status === 'rejected' || overviewRes.status === 'rejected') {
        toast.error('No se pudo cargar toda la informacion del perfil.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar perfil'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProfileData()
  }, [loadProfileData])

  const canSaveProfile = useMemo(() => {
    return name.trim().length > 0 && email.trim().length > 0
  }, [email, name])

  const saveProfile = async () => {
    if (!canSaveProfile) {
      toast.error('Nombre y correo son obligatorios')
      return
    }

    setSavingProfile(true)
    try {
      await apiClient.put('/auth/profile', {
        name: name.trim(),
        email: email.trim().toLowerCase(),
      })

      const current = useAuthStore.getState().user
      if (current) {
        useAuthStore.setState({
          user: {
            ...current,
            name: name.trim(),
            email: email.trim().toLowerCase(),
          },
        })
      }

      toast.success('Perfil actualizado correctamente')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo guardar perfil'
      toast.error(msg)
    } finally {
      setSavingProfile(false)
    }
  }

  const savePreferences = async () => {
    setSavingPreferences(true)
    try {
      const response = await apiClient.post('/client/notifications/preferences', preferences) as {
        preferences?: NotificationPreferences
      }
      if (response?.preferences) {
        setPreferences({
          email: Boolean(response.preferences.email),
          whatsapp: Boolean(response.preferences.whatsapp),
          push: Boolean(response.preferences.push),
        })
      }
      toast.success('Preferencias guardadas')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo guardar preferencias'
      toast.error(msg)
    } finally {
      setSavingPreferences(false)
    }
  }

  const handleLogout = () => {
    logout()
    window.location.href = '/login'
  }

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Mi perfil</h1>
          <p className="mt-2 text-sm text-slate-500">
            Administra tus datos de cuenta y preferencias de notificacion.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white backdrop-blur-md p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white">Datos de cuenta</h2>
            <p className="mt-1 text-sm text-slate-500">Mantiene esta informacion actualizada para soporte y facturacion.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="profile-name" className="mb-1 block text-sm font-medium text-slate-600">
                  Nombre completo
                </label>
                <input
                  id="profile-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-lg border border-white/20 bg-white px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Nombre"
                />
              </div>
              <div>
                <label htmlFor="profile-email" className="mb-1 block text-sm font-medium text-slate-600">
                  Correo
                </label>
                <input
                  id="profile-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-white/20 bg-white px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="correo@empresa.com"
                />
              </div>
              <div className="pt-2">
                <button
                  onClick={saveProfile}
                  disabled={!canSaveProfile || savingProfile}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingProfile ? 'Guardando...' : 'Guardar perfil'}
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white backdrop-blur-md p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-white">Notificaciones</h2>
            <p className="mt-1 text-sm text-slate-500">Selecciona por donde quieres recibir avisos del servicio.</p>
            <div className="mt-4 space-y-3">
              {[
                {
                  key: 'email',
                  label: 'Correo electronico',
                  description: 'Facturas, avisos de mantenimiento y tickets.',
                },
                {
                  key: 'whatsapp',
                  label: 'WhatsApp',
                  description: 'Recordatorios y alertas operativas.',
                },
                {
                  key: 'push',
                  label: 'Notificaciones push',
                  description: 'Alertas inmediatas en navegador.',
                },
              ].map((item) => (
                <label key={item.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 hover:bg-white/10 transition-colors">
                  <input
                    type="checkbox"
                    checked={Boolean(preferences[item.key as keyof NotificationPreferences])}
                    onChange={(event) =>
                      setPreferences((prev) => ({
                        ...prev,
                        [item.key]: event.target.checked,
                      }))
                    }
                    className="mt-0.5 h-4 w-4 rounded border-white/20 bg-black/20 text-emerald-500 focus:ring-emerald-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-white">{item.label}</p>
                    <p className="text-xs text-slate-500">{item.description}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="pt-4">
              <button
                onClick={savePreferences}
                disabled={savingPreferences}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingPreferences ? 'Guardando...' : 'Guardar preferencias'}
              </button>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-gray-200 bg-white backdrop-blur-md p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-white">Resumen del servicio</h2>
          <p className="mt-1 text-sm text-slate-500">Datos operativos vinculados a tu cuenta.</p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Plan</p>
              <p className="mt-1 text-sm font-semibold text-white">{overview?.plan || 'Sin plan'}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Router</p>
              <p className="mt-1 text-sm font-semibold text-white">{overview?.router || 'No asignado'}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Conexion</p>
              <p className="mt-1 text-sm font-semibold uppercase text-white">{overview?.connection_type || 'N/A'}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">IP</p>
              <p className="mt-1 text-sm font-semibold text-white">{overview?.ip_address || 'N/A'}</p>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
            <div>
              <p className="text-sm font-semibold text-rose-400">Cerrar sesion</p>
              <p className="text-xs text-rose-300">Finaliza tu sesion en este dispositivo.</p>
            </div>
            <button
              onClick={handleLogout}
              disabled={loading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              Cerrar sesion
            </button>
          </div>
        </section>
      </motion.div>
    </AppLayout>
  )
}

export default ClientProfile
