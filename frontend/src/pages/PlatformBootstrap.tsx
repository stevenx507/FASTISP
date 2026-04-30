import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CheckCircleIcon, KeyIcon, LockClosedIcon, ShieldCheckIcon, UserCircleIcon } from '@heroicons/react/24/outline'
import { apiClient } from '../lib/apiClient'
import { useAuthStore } from '../store/authStore'
import { roleHomePath } from '../lib/roles'

interface BootstrapStatus {
  master_context: boolean
  token_configured: boolean
  platform_admin_exists: boolean
  bootstrap_allowed: boolean
}

const PlatformBootstrap: React.FC = () => {
  const navigate = useNavigate()
  const { login, isAuthenticated, user } = useAuthStore()
  const [status, setStatus] = useState<BootstrapStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    token: '',
    name: '',
    email: '',
    password: '',
  })

  useEffect(() => {
    if (isAuthenticated) {
      navigate(roleHomePath(user?.role))
    }
  }, [isAuthenticated, navigate, user?.role])

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const response = (await apiClient.get('/platform/bootstrap/status')) as BootstrapStatus
      setStatus(response)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error cargando estado bootstrap'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.token.trim() || !form.name.trim() || !form.email.trim() || !form.password.trim()) {
      toast.error('Completa token, nombre, email y password')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        token: form.token.trim(),
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
      }
      const response = (await apiClient.post('/platform/bootstrap', payload)) as { success?: boolean; message?: string }
      if (!response?.success) {
        throw new Error(response?.message || 'No fue posible crear platform admin')
      }
      await login(payload.email, payload.password)
      toast.success('Platform Admin creado. Sesion iniciada.')
      navigate('/platform')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error en bootstrap'
      toast.error(message)
      await loadStatus()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FDF5E6] text-slate-800">
      <div className="mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 gap-10 px-6 py-10 lg:grid-cols-[1.2fr,1fr]">
        <section className="flex flex-col justify-center">
          <div className="max-w-xl space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-coral-200 bg-coral-50 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-coral-600">
              <ShieldCheckIcon className="h-4 w-4" />
              Bootstrap Seguro
            </span>
            <h1 className="text-4xl font-black text-slate-900">Inicializa el Admin Total de la plataforma</h1>
            <p className="text-base text-slate-600">
              Este asistente solo se habilita una vez. Crea el primer usuario <strong>platform_admin</strong> y cierra el modo bootstrap.
            </p>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
              <p>- Ejecuta este flujo en host master/global.</p>
              <p>- Usa un token temporal (`PLATFORM_BOOTSTRAP_TOKEN`).</p>
              <p>- Despues de crear el usuario, elimina ese token del entorno.</p>
            </div>
          </div>
        </section>

        <section className="flex items-center">
          <div className="w-full rounded-3xl border border-gray-100 bg-white p-6 shadow-xl">
            <div className="mb-5">
              <h2 className="text-xl font-bold text-slate-900">Configurar Platform Admin</h2>
              <p className="text-sm text-slate-500">Provision inicial del control maestro.</p>
            </div>

            {loading ? (
              <div className="py-8 text-center text-sm text-slate-400">Verificando estado bootstrap...</div>
            ) : (
              <>
                <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-slate-600">
                  <p className="flex items-center gap-2">
                    <CheckCircleIcon className={`h-4 w-4 ${status?.master_context ? 'text-emerald-600' : 'text-rose-600'}`} />
                    master context: {String(status?.master_context)}
                  </p>
                  <p className="flex items-center gap-2">
                    <CheckCircleIcon className={`h-4 w-4 ${status?.token_configured ? 'text-emerald-600' : 'text-rose-600'}`} />
                    token configurado: {String(status?.token_configured)}
                  </p>
                  <p className="flex items-center gap-2">
                    <CheckCircleIcon className={`h-4 w-4 ${!status?.platform_admin_exists ? 'text-emerald-600' : 'text-amber-600'}`} />
                    platform admin existente: {String(status?.platform_admin_exists)}
                  </p>
                </div>

                {status?.bootstrap_allowed ? (
                  <form onSubmit={submit} className="space-y-3">
                    <label className="block">
                      <span className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                        <KeyIcon className="h-4 w-4" />
                        Token bootstrap
                      </span>
                      <input
                        type="password"
                        value={form.token}
                        onChange={(event) => setForm((prev) => ({ ...prev, token: event.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-coral-400 focus:ring-2 focus:ring-coral-500/10 focus:outline-none"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                        <UserCircleIcon className="h-4 w-4" />
                        Nombre
                      </span>
                      <input
                        value={form.name}
                        onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-coral-400 focus:ring-2 focus:ring-coral-500/10 focus:outline-none"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                        <UserCircleIcon className="h-4 w-4" />
                        Email
                      </span>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-coral-400 focus:ring-2 focus:ring-coral-500/10 focus:outline-none"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                        <LockClosedIcon className="h-4 w-4" />
                        Password (min 10)
                      </span>
                      <input
                        type="password"
                        value={form.password}
                        onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-coral-400 focus:ring-2 focus:ring-coral-500/10 focus:outline-none"
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-coral-500 px-4 py-2 text-sm font-semibold text-white hover:bg-coral-600 disabled:opacity-60 shadow-lg shadow-coral-500/20"
                    >
                      <ShieldCheckIcon className="h-4 w-4" />
                      {submitting ? 'Creando...' : 'Crear Platform Admin'}
                    </button>
                  </form>
                ) : (
                  <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    <p>Bootstrap no disponible en este momento.</p>
                    <button
                      onClick={() => navigate('/login')}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-gray-50 shadow-sm"
                    >
                      Ir a login
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default PlatformBootstrap
