import React, { useCallback, useEffect, useState } from 'react'
import { useTheme } from '../contexts/ThemeContext'
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

const LoginHeader: React.FC = () => {
  const { branding } = useTheme()
  return (
    <div className="flex flex-col gap-6 text-left">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <span className="text-2xl font-black text-white">I</span>
        </div>
        <span className="text-3xl font-black tracking-tighter text-white">
          ISPFAST
        </span>
      </div>
      <h1 className="text-5xl lg:text-7xl font-black leading-[1.1] text-white">
        Tu Red, <br />
        <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
          Más Inteligente.
        </span>
      </h1>
      <p className="max-w-md text-lg text-slate-400 leading-relaxed">
        Gestiona operaciones, monitoreo en tiempo real y soporte autónomo con IA desde un solo lugar.
      </p>
    </div>
  )
}

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
        <label className="mb-2 block text-sm font-medium text-slate-400">Correo Electrónico</label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
            <EnvelopeIcon className="h-5 w-5 text-slate-500" />
          </div>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="block w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-4 text-white placeholder:text-slate-500 transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 outline-none"
            placeholder="usuario@ejemplo.com"
            required
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-400">Contraseña</label>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
            <LockClosedIcon className="h-5 w-5 text-slate-500" />
          </div>
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="block w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-12 text-white placeholder:text-slate-500 transition-all focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 outline-none"
            placeholder="********"
            required
          />
          <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute inset-y-0 right-0 flex items-center pr-4">
            {showPassword ? <EyeSlashIcon className="h-5 w-5 text-slate-500 hover:text-white" /> : <EyeIcon className="h-5 w-5 text-slate-500 hover:text-white" />}
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
            className="h-4 w-4 rounded border-white/10 bg-white/5 text-cyan-500 focus:ring-cyan-500/30"
          />
          <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-400">
            Recordarme
          </label>
        </div>
        <button
          type="button"
          onClick={() => {
            setRecoveryEmail((prev) => prev || email)
            setShowRecovery((prev) => !prev)
          }}
          className="text-sm font-medium text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          ¿Olvidaste tu contraseña?
        </button>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="flex w-full justify-center rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-4 text-sm font-bold text-white shadow-xl shadow-cyan-500/20 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
      >
        {isLoading ? (
          <div className="flex items-center">
            <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Autenticando...
          </div>
        ) : (
          'Iniciar Sesión'
        )}
      </button>

      {config.GOOGLE_CLIENT_ID && (
        <button
          type="button"
          onClick={() => window.google?.accounts?.id?.prompt()}
          disabled={!isGoogleReady}
          className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm font-bold text-white transition-all hover:bg-white/10 disabled:opacity-50"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="h-5 w-5" />
          Continuar con Google
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
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Orbs */}
      <div className="absolute top-0 left-0 w-full h-full -z-10 overflow-hidden">
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-cyan-500/20 rounded-full blur-[120px]" />
        <div className="absolute -bottom-20 -right-20 w-96 h-96 bg-blue-600/20 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-12 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="hidden lg:block"
        >
          <LoginHeader />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md mx-auto bg-slate-900/50 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-8 lg:p-12 shadow-2xl"
        >
          <div className="mb-8">
            <h2 className="text-2xl font-black text-white mb-2">Bienvenido</h2>
            <p className="text-slate-400 text-sm">Ingresa tus credenciales para continuar.</p>
          </div>

          <LoginForm />

          <div className="mt-10 text-center">
             <p className="text-slate-500 text-xs mb-4 uppercase tracking-widest font-bold">ISPFAST Platform v2.0</p>
             <button
                type="button"
                onClick={() => navigate('/')}
                className="text-cyan-400 hover:text-cyan-300 text-sm font-bold transition-colors"
              >
                ← Volver al Inicio
              </button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export default Login

