import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { EyeIcon, EyeSlashIcon, EnvelopeIcon, LockClosedIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import { safeStorage } from '../lib/storage'
import { apiClient } from '../lib/apiClient'
import { config } from '../lib/config'
import { roleHomePath } from '../lib/roles'

declare global {
  interface Window {
    google?: any
  }
}

const LoginHeader: React.FC = () => (
  <div className="flex flex-col gap-3 text-left">
    <div className="inline-flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-2 ring-1 ring-white/20 backdrop-blur">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-white/80">FastISP Cloud</span>
      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
    </div>
    <h1 className="text-4xl font-black leading-tight text-white">
      Conecta, gestiona <br /> y escala tu red ISP
    </h1>
    <p className="max-w-xl text-lg text-white/80">
      Portal unificado para operaciones, soporte y clientes finales. Control total de facturacion,
      monitoreo y aprovisionamiento sin friccion.
    </p>
  </div>
)

const LoginForm: React.FC = () => {
  const [email, setEmail] = useState(safeStorage.getItem('rememberedEmail') || '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(!!safeStorage.getItem('rememberedEmail'))
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleReady, setIsGoogleReady] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [recoveryToken, setRecoveryToken] = useState('')
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [isRecovering, setIsRecovering] = useState(false)
  const { login } = useAuthStore()

  const handleRememberMeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRememberMe(event.target.checked)
    if (!event.target.checked) {
      safeStorage.removeItem('rememberedEmail')
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email || !password) {
      toast.error('Ingresa email y password')
      return
    }
    setIsLoading(true)
    try {
      if (rememberMe) safeStorage.setItem('rememberedEmail', email)
      else safeStorage.removeItem('rememberedEmail')

      await login(email, password)
      toast.success('Inicio de sesion exitoso')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Credenciales invalidas o error del servidor'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRequestPasswordReset = async () => {
    if (!recoveryEmail.trim()) {
      toast.error('Ingresa tu correo para recuperar password')
      return
    }

    setIsRecovering(true)
    try {
      const response = (await apiClient.post('/auth/password/forgot', {
        email: recoveryEmail.trim().toLowerCase(),
      })) as { message?: string; reset_token?: string }
      toast.success(response?.message || 'Si el correo existe, te enviaremos instrucciones.')
      if (response?.reset_token) {
        setRecoveryToken(response.reset_token)
        toast.success('Token de recuperacion recibido para este entorno.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo iniciar recuperacion'
      toast.error(message)
    } finally {
      setIsRecovering(false)
    }
  }

  const handleResetPassword = async () => {
    if (!recoveryToken.trim()) {
      toast.error('Ingresa el token de recuperacion')
      return
    }
    if (recoveryPassword.length < 8) {
      toast.error('La nueva password debe tener al menos 8 caracteres')
      return
    }

    setIsRecovering(true)
    try {
      await apiClient.post('/auth/password/reset', {
        token: recoveryToken.trim(),
        new_password: recoveryPassword,
      })
      toast.success('Password actualizada. Ya puedes iniciar sesion.')
      setShowRecovery(false)
      setRecoveryToken('')
      setRecoveryPassword('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo restablecer password'
      toast.error(message)
    } finally {
      setIsRecovering(false)
    }
  }

  const handleGoogleCredential = useCallback(async (credential: string) => {
    if (!credential) {
      toast.error('No se recibio token de Google')
      return
    }
    try {
      const response = await apiClient.post('/auth/google', { credential })
      useAuthStore.setState({ user: response.user, token: response.token, isAuthenticated: true })
      toast.success('Inicio de sesion con Google exitoso')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error iniciando con Google'
      toast.error(message)
    }
  }, [])

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const token = (params.get('reset_token') || '').trim()
      if (token) {
        setRecoveryToken(token)
        setShowRecovery(true)
      }
    } catch {
      // ignore malformed URLs in unsupported environments
    }
  }, [])

  useEffect(() => {
    if (!config.GOOGLE_CLIENT_ID) return

    const initGoogle = () => {
      if (!window.google?.accounts?.id) return
      window.google.accounts.id.initialize({
        client_id: config.GOOGLE_CLIENT_ID,
        callback: (response: any) => handleGoogleCredential(response.credential),
      })
      setIsGoogleReady(true)
    }

    if (window.google?.accounts?.id) {
      initGoogle()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = initGoogle
    script.onerror = () => console.warn('[Google] no se pudo cargar el script de Google Identity')
    document.body.appendChild(script)
  }, [handleGoogleCredential])

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Correo electronico</label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <EnvelopeIcon className="h-5 w-5 text-slate-400" />
          </div>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="block w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
            placeholder="usuario@ejemplo.com"
            required
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Password</label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <LockClosedIcon className="h-5 w-5 text-slate-400" />
          </div>
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="block w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-12 text-slate-900 placeholder:text-slate-400 transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
            placeholder="********"
            required
          />
          <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute inset-y-0 right-0 flex items-center pr-3">
            {showPassword ? <EyeSlashIcon className="h-5 w-5 text-slate-500 hover:text-slate-800" /> : <EyeIcon className="h-5 w-5 text-slate-500 hover:text-slate-800" />}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <input
            id="remember-me"
            name="remember-me"
            type="checkbox"
            checked={rememberMe}
            onChange={handleRememberMeChange}
            className="h-4 w-4 rounded border-slate-300 bg-white text-emerald-500 focus:ring-emerald-300"
          />
          <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-700">
            Recordarme
          </label>
        </div>
        <button
          type="button"
          onClick={() => {
            setRecoveryEmail((prev) => prev || email)
            setShowRecovery((prev) => !prev)
          }}
          className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
        >
          Olvide mi password
        </button>
      </div>

      {showRecovery && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800">Recuperar password</p>
          <input
            type="email"
            value={recoveryEmail}
            onChange={(event) => setRecoveryEmail(event.target.value)}
            className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
            placeholder="correo@ejemplo.com"
          />
          <button
            type="button"
            onClick={() => void handleRequestPasswordReset()}
            disabled={isRecovering}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            {isRecovering ? 'Enviando...' : 'Solicitar token de recuperacion'}
          </button>

          <input
            value={recoveryToken}
            onChange={(event) => setRecoveryToken(event.target.value)}
            className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
            placeholder="Token de recuperacion"
          />
          <input
            type="password"
            value={recoveryPassword}
            onChange={(event) => setRecoveryPassword(event.target.value)}
            className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
            placeholder="Nueva password"
          />
          <button
            type="button"
            onClick={() => void handleResetPassword()}
            disabled={isRecovering}
            className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
          >
            {isRecovering ? 'Procesando...' : 'Restablecer password'}
          </button>
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="flex w-full justify-center rounded-xl border border-transparent bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? (
          <div className="flex items-center">
            <div className="mr-2 h-5 w-5 animate-spin rounded-full border-b-2 border-white" />
            Iniciando sesion...
          </div>
        ) : (
          'Iniciar sesion'
        )}
      </button>

      {config.GOOGLE_CLIENT_ID && (
        <button
          type="button"
          onClick={() => window.google?.accounts?.id?.prompt()}
          disabled={!isGoogleReady}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="h-5 w-5" />
          {isGoogleReady ? 'Continuar con Google' : 'Cargando Google...'}
        </button>
      )}
    </form>
  )
}

const Login: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated, user } = useAuthStore()

  useEffect(() => {
    if (isAuthenticated) {
      navigate(roleHomePath(user?.role))
    }
  }, [isAuthenticated, navigate, user?.role])

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 text-white">
      <div className="absolute inset-0 opacity-60 blur-3xl" aria-hidden>
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-emerald-500/30" />
        <div className="absolute right-0 top-10 h-80 w-80 rounded-full bg-blue-600/20" />
        <div className="absolute bottom-0 left-20 h-64 w-64 rounded-full bg-teal-400/20" />
      </div>

      <div className="relative grid min-h-screen lg:grid-cols-5">
        <div className="flex items-center px-8 py-12 lg:col-span-3 lg:px-16">
          <LoginHeader />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center justify-center px-6 py-12 lg:col-span-2 lg:px-10"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/40 bg-white/95 p-8 text-slate-900 shadow-2xl backdrop-blur-xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Acceso seguro</p>
                <h2 className="text-2xl font-bold text-slate-900">Iniciar sesion</h2>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 font-bold text-white">
                ISP
              </div>
            </div>

            <LoginForm />

            <div className="mt-8 text-center text-sm text-slate-600">
              No tienes una cuenta?
              <button
                type="button"
                onClick={() => toast.success('Contacta a soporte para crear una cuenta')}
                className="ml-1 font-semibold text-emerald-700 hover:text-emerald-900"
              >
                Contacta a tu proveedor
              </button>
            </div>
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => navigate('/platform/bootstrap')}
                className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700 hover:text-cyan-900"
              >
                Bootstrap admin total
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="absolute bottom-6 left-0 right-0 px-6 lg:px-12">
        <div className="flex flex-wrap gap-3 text-xs text-white/60">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1">Monitoreo NOC en vivo</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1">Scripts rapidos Mikrotik/OLT</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1">Pagos y facturacion integrados</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1">App movil tech</span>
        </div>
      </div>
    </div>
  )
}

export default Login
