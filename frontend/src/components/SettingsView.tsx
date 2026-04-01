import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BellIcon,
  LockClosedIcon,
  UserIcon,
  ArrowLeftOnRectangleIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../lib/apiClient'
import { useAuthStore } from '../store/authStore'
import { normalizeRole } from '../lib/roles'

type ActiveTab = 'preferences' | 'security' | 'account'

interface PreferencesSettings {
  notifications_email_enabled: boolean
  notifications_push_enabled: boolean
  portal_maintenance_mode: boolean
  auto_suspend_overdue: boolean
}

interface MfaSetupResponse {
  secret: string
  provisioning_uri: string
  issuer: string
}

const defaultPreferences: PreferencesSettings = {
  notifications_email_enabled: false,
  notifications_push_enabled: false,
  portal_maintenance_mode: false,
  auto_suspend_overdue: true,
}

const SettingsView: React.FC = () => {
  const { user, logout } = useAuthStore()
  const [activeTab, setActiveTab] = useState<ActiveTab>('preferences')

  const [profileName, setProfileName] = useState(user?.name || '')
  const [profileEmail, setProfileEmail] = useState(user?.email || '')
  const [savingProfile, setSavingProfile] = useState(false)

  const [preferences, setPreferences] = useState<PreferencesSettings>(defaultPreferences)
  const [loadingPreferences, setLoadingPreferences] = useState(false)
  const [savingPreferences, setSavingPreferences] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const [mfaEnabled, setMfaEnabled] = useState(Boolean(user?.mfa_enabled))
  const [mfaCode, setMfaCode] = useState('')
  const [mfaSecret, setMfaSecret] = useState('')
  const [mfaUri, setMfaUri] = useState('')
  const [loadingMfaSetup, setLoadingMfaSetup] = useState(false)
  const [savingMfa, setSavingMfa] = useState(false)

  useEffect(() => {
    setProfileName(user?.name || '')
    setProfileEmail(user?.email || '')
    setMfaEnabled(Boolean(user?.mfa_enabled))
  }, [user?.email, user?.mfa_enabled, user?.name])

  const loadPreferences = useCallback(async () => {
    setLoadingPreferences(true)
    try {
      const response = await apiClient.get('/admin/system/settings') as {
        settings?: Record<string, unknown>
      }
      const settings = response.settings || {}
      setPreferences({
        notifications_email_enabled: Boolean(settings.notifications_email_enabled),
        notifications_push_enabled: Boolean(settings.notifications_push_enabled),
        portal_maintenance_mode: Boolean(settings.portal_maintenance_mode),
        auto_suspend_overdue: Boolean(settings.auto_suspend_overdue),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar configuracion'
      toast.error(msg)
    } finally {
      setLoadingPreferences(false)
    }
  }, [])

  useEffect(() => {
    loadPreferences()
  }, [loadPreferences])

  const savePreferences = async () => {
    setSavingPreferences(true)
    try {
      await apiClient.post('/admin/system/settings', { settings: preferences })
      toast.success('Configuracion guardada')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo guardar configuracion'
      toast.error(msg)
    } finally {
      setSavingPreferences(false)
    }
  }

  const saveProfile = async () => {
    if (!profileName.trim() || !profileEmail.trim()) {
      toast.error('Nombre y correo son requeridos')
      return
    }

    setSavingProfile(true)
    try {
      const response = await apiClient.put('/auth/profile', {
        name: profileName.trim(),
        email: profileEmail.trim().toLowerCase(),
      }) as { user?: { name?: string; email?: string } }

      const current = useAuthStore.getState().user
      if (current && response.user) {
        useAuthStore.setState({
          user: {
            ...current,
            name: response.user.name || profileName.trim(),
            email: response.user.email || profileEmail.trim().toLowerCase(),
          },
        })
      }

      toast.success('Perfil actualizado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar perfil'
      toast.error(msg)
    } finally {
      setSavingProfile(false)
    }
  }

  const changePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Completa todos los campos de contrasena')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Las contrasenas no coinciden')
      return
    }
    if (newPassword.length < 8) {
      toast.error('La nueva contrasena debe tener al menos 8 caracteres')
      return
    }

    setSavingPassword(true)
    try {
      await apiClient.post('/auth/password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Contrasena actualizada')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar contrasena'
      toast.error(msg)
    } finally {
      setSavingPassword(false)
    }
  }

  const prepareMfa = async () => {
    setLoadingMfaSetup(true)
    try {
      const response = await apiClient.get('/auth/mfa/setup') as MfaSetupResponse
      setMfaSecret(response.secret || '')
      setMfaUri(response.provisioning_uri || '')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo preparar MFA'
      toast.error(msg)
    } finally {
      setLoadingMfaSetup(false)
    }
  }

  const enableMfa = async () => {
    if (!mfaSecret || !mfaCode.trim()) {
      toast.error('Secret y codigo son requeridos para activar MFA')
      return
    }

    setSavingMfa(true)
    try {
      await apiClient.post('/auth/mfa/enable', {
        secret: mfaSecret,
        code: mfaCode.trim(),
      })
      setMfaEnabled(true)
      setMfaCode('')
      const current = useAuthStore.getState().user
      if (current) {
        useAuthStore.setState({ user: { ...current, mfa_enabled: true } })
      }
      toast.success('MFA activado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo activar MFA'
      toast.error(msg)
    } finally {
      setSavingMfa(false)
    }
  }

  const disableMfa = async () => {
    if (!mfaCode.trim()) {
      toast.error('Ingresa el codigo para desactivar MFA')
      return
    }

    setSavingMfa(true)
    try {
      await apiClient.post('/auth/mfa/disable', { code: mfaCode.trim() })
      setMfaEnabled(false)
      setMfaCode('')
      setMfaSecret('')
      setMfaUri('')
      const current = useAuthStore.getState().user
      if (current) {
        useAuthStore.setState({ user: { ...current, mfa_enabled: false } })
      }
      toast.success('MFA desactivado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo desactivar MFA'
      toast.error(msg)
    } finally {
      setSavingMfa(false)
    }
  }

  const handleLogout = () => {
    logout()
    window.location.href = '/login'
  }

  const tabs = [
    { id: 'preferences', name: 'Preferencias', icon: BellIcon },
    { id: 'security', name: 'Seguridad', icon: LockClosedIcon },
    { id: 'account', name: 'Cuenta', icon: UserIcon },
  ] as const

  const canSaveProfile = useMemo(() => profileName.trim().length > 0 && profileEmail.trim().length > 0, [profileEmail, profileName])

  const roleLabel = useMemo(() => {
    const role = normalizeRole(user?.role)
    if (role === 'platform_admin') return 'Admin Total'
    if (role === 'admin') return 'Administrador ISP'
    if (role === 'tech') return 'Tecnico'
    if (role === 'support') return 'Soporte'
    if (role === 'billing') return 'Facturacion'
    if (role === 'noc') return 'NOC'
    if (role === 'operator') return 'Operador'
    return 'Cliente'
  }, [user?.role])

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto max-w-4xl">
      <div className="mb-6 flex gap-4 border-b border-gray-200">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 font-medium transition ${
                isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="h-5 w-5" />
              {tab.name}
            </button>
          )
        })}
      </div>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg bg-white p-6 shadow"
      >
        {activeTab === 'preferences' && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Preferencias del sistema</h3>
              <p className="text-sm text-gray-600">Estos ajustes se guardan en configuracion administrativa real.</p>
            </div>

            {loadingPreferences ? (
              <p className="text-sm text-gray-500">Cargando configuracion...</p>
            ) : (
              <div className="space-y-3">
                {[
                  { key: 'notifications_email_enabled', label: 'Notificaciones por email', description: 'Envios automaticos de avisos operativos.' },
                  { key: 'notifications_push_enabled', label: 'Notificaciones push', description: 'Alertas web push para eventos de red.' },
                  { key: 'portal_maintenance_mode', label: 'Portal en mantenimiento', description: 'Muestra estado de mantenimiento al cliente.' },
                  { key: 'auto_suspend_overdue', label: 'Suspension automatica por mora', description: 'Aplica politicas de corte por deuda vencida.' },
                ].map((item) => (
                  <label key={item.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3">
                    <input
                      type="checkbox"
                      checked={Boolean(preferences[item.key as keyof PreferencesSettings])}
                      onChange={(event) =>
                        setPreferences((prev) => ({
                          ...prev,
                          [item.key]: event.target.checked,
                        }))
                      }
                      className="mt-0.5"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{item.label}</p>
                      <p className="text-xs text-gray-600">{item.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={savePreferences}
                disabled={savingPreferences || loadingPreferences}
                className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {savingPreferences ? 'Guardando...' : 'Guardar preferencias'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="space-y-8">
            <section>
              <h3 className="mb-4 text-lg font-semibold text-gray-900">Cambiar contrasena</h3>
              <div className="grid max-w-xl grid-cols-1 gap-3">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="rounded-lg border border-gray-300 px-4 py-2"
                  placeholder="Contrasena actual"
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="rounded-lg border border-gray-300 px-4 py-2"
                  placeholder="Nueva contrasena"
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="rounded-lg border border-gray-300 px-4 py-2"
                  placeholder="Confirmar nueva contrasena"
                />
                <button
                  onClick={changePassword}
                  disabled={savingPassword}
                  className="w-fit rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingPassword ? 'Actualizando...' : 'Actualizar contrasena'}
                </button>
              </div>
            </section>

            <section className="border-t border-gray-200 pt-6">
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Autenticacion MFA</h3>
              <p className="mb-4 text-sm text-gray-600">
                Estado actual: <span className={mfaEnabled ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>{mfaEnabled ? 'activado' : 'desactivado'}</span>
              </p>

              {!mfaEnabled && !mfaSecret && (
                <button
                  onClick={prepareMfa}
                  disabled={loadingMfaSetup}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingMfaSetup ? 'Preparando...' : 'Preparar MFA'}
                </button>
              )}

              {!mfaEnabled && mfaSecret && (
                <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <p className="text-sm text-blue-900">Registra este secret o URI en tu app autenticadora y confirma con codigo OTP.</p>
                  <input readOnly value={mfaSecret} className="w-full rounded border border-blue-200 bg-white px-3 py-2 text-xs" />
                  <input readOnly value={mfaUri} className="w-full rounded border border-blue-200 bg-white px-3 py-2 text-xs" />
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={mfaCode}
                      onChange={(event) => setMfaCode(event.target.value)}
                      className="rounded border border-blue-300 px-3 py-2 text-sm"
                      placeholder="Codigo OTP"
                    />
                    <button
                      onClick={enableMfa}
                      disabled={savingMfa}
                      className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {savingMfa ? 'Activando...' : 'Activar MFA'}
                    </button>
                  </div>
                </div>
              )}

              {mfaEnabled && (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm text-amber-900">Para desactivar MFA ingresa un codigo valido de tu app autenticadora.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={mfaCode}
                      onChange={(event) => setMfaCode(event.target.value)}
                      className="rounded border border-amber-300 px-3 py-2 text-sm"
                      placeholder="Codigo OTP"
                    />
                    <button
                      onClick={disableMfa}
                      disabled={savingMfa}
                      className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {savingMfa ? 'Desactivando...' : 'Desactivar MFA'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'account' && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-4 text-lg font-semibold text-gray-900">Informacion de cuenta</h3>
              <div className="grid max-w-xl grid-cols-1 gap-3">
                <label className="text-sm text-gray-700">
                  Nombre
                  <input
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2"
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Email
                  <input
                    type="email"
                    value={profileEmail}
                    onChange={(event) => setProfileEmail(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2"
                  />
                </label>
                <p className="text-sm text-gray-600">Rol: {roleLabel}</p>
                <button
                  onClick={saveProfile}
                  disabled={!canSaveProfile || savingProfile}
                  className="w-fit rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingProfile ? 'Guardando...' : 'Guardar perfil'}
                </button>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4">
              <h4 className="mb-4 font-semibold text-gray-900">Sesion</h4>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-6 py-2 text-white hover:bg-red-700"
              >
                <ArrowLeftOnRectangleIcon className="h-5 w-5" />
                Cerrar sesion
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

export default SettingsView
