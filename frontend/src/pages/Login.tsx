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

const LoginForm: React.FC = () => {
  const [email, setEmail] = useState(safeStorage.getItem('rememberedEmail') || '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(!!safeStorage.getItem('rememberedEmail'))
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleReady, setIsGoogleReady] = useState(false)
  const { login } = useAuthStore()
  const navigate = useNavigate()

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
      toast.success('¡Bienvenido de nuevo!')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Credenciales inválidas'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleCredential = useCallback(async (credential: string) => {
    try {
      const response = await apiClient.post('/auth/google', { credential })
      useAuthStore.setState({ user: response.user, token: response.token, isAuthenticated: true })
      toast.success('Inicio de sesión exitoso')
    } catch (error) {
      toast.error('Error con Google')
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
    if (window.google?.accounts?.id) initGoogle()
    else {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.onload = initGoogle
      document.body.appendChild(script)
    }
  }, [handleGoogleCredential])

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Email</label>
        <div className="relative">
          <EnvelopeIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-gray-100 bg-gray-50 py-3.5 pl-12 pr-4 text-slate-800 placeholder:text-slate-400 focus:border-coral-400 focus:ring-4 focus:ring-coral-500/5 outline-none transition-all"
            placeholder="admin@ispfast.cloud"
            required
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Contraseña</label>
        <div className="relative">
          <LockClosedIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-gray-100 bg-gray-50 py-3.5 pl-12 pr-12 text-slate-800 placeholder:text-slate-400 focus:border-coral-400 focus:ring-4 focus:ring-coral-500/5 outline-none transition-all"
            placeholder="••••••••"
            required
          />
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2 cursor-pointer text-slate-500">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="rounded border-gray-300 text-coral-500 focus:ring-coral-500/20" />
          Recordarme
        </label>
        <button type="button" className="font-semibold text-coral-500 hover:text-coral-600">¿Olvidaste tu contraseña?</button>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-4 rounded-xl bg-coral-500 text-white font-bold shadow-lg shadow-coral-500/20 hover:bg-coral-600 hover:-translate-y-0.5 active:scale-95 transition-all disabled:opacity-50"
      >
        {isLoading ? 'Iniciando sesión...' : 'Entrar al Panel'}
      </button>

      {isGoogleReady && (
        <button
          type="button"
          onClick={() => window.google.accounts.id.prompt()}
          className="w-full py-3.5 rounded-xl border border-gray-200 bg-white text-slate-700 font-bold flex items-center justify-center gap-3 hover:bg-gray-50 transition-all"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="h-5 w-5" alt="Google" />
          Continuar con Google
        </button>
      )}
    </form>
  )
}

const Login: React.FC = () => {
  const navigate = useNavigate()
  const { isAuthenticated, user } = useAuthStore()
  const { branding } = useTheme()

  useEffect(() => {
    if (isAuthenticated) navigate(roleHomePath(user?.role))
  }, [isAuthenticated, navigate, user?.role])

  return (
    <div className="min-h-screen bg-white flex overflow-hidden">
      {/* Lado Izquierdo: Ilustración y Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#FDF5E6] relative items-center justify-center p-12">
        <div className="absolute top-12 left-12 flex items-center gap-3">
           <div className="h-10 w-10 bg-coral-500 rounded-xl flex items-center justify-center shadow-lg shadow-coral-500/20">
              <span className="text-xl font-black text-white">I</span>
           </div>
           <span className="text-2xl font-black tracking-tighter text-slate-800 uppercase">
             {branding.brand_name || 'ISPFAST'}
           </span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="max-w-lg text-center"
        >
          <div className="mb-8 relative">
            {/* Ilustración de Rack Minimalista */}
            <div className="w-64 h-80 mx-auto bg-white rounded-3xl shadow-2xl border border-coral-100 flex flex-col p-4 gap-4 overflow-hidden relative">
               <div className="absolute -top-10 -right-10 w-32 h-32 bg-coral-100/50 rounded-full blur-3xl" />
               <div className="h-1 w-full bg-coral-50 rounded-full" />
               <div className="h-1 w-2/3 bg-coral-50 rounded-full" />
               <div className="mt-4 space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                       <div className="h-1.5 w-1.5 rounded-full bg-coral-400" />
                       <div className="h-2 flex-1 bg-gray-50 rounded-full" />
                       <div className={`h-2 w-${[8, 12, 6, 16, 10][i]} bg-coral-200/50 rounded-full`} />
                    </div>
                  ))}
               </div>
               <div className="mt-auto flex justify-between items-end">
                  <div className="space-y-1">
                    <div className="h-2 w-16 bg-coral-50 rounded-full" />
                    <div className="h-4 w-24 bg-coral-500/10 rounded-lg" />
                  </div>
                  <div className="h-12 w-12 bg-coral-50 rounded-2xl flex items-center justify-center">
                     <div className="h-6 w-6 border-4 border-coral-200 rounded-full" />
                  </div>
               </div>
            </div>
            {/* Floating particles */}
            <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 4, repeat: Infinity }} className="absolute -top-6 -left-6 h-12 w-12 bg-coral-200/30 rounded-full blur-xl" />
            <motion.div animate={{ y: [0, 10, 0] }} transition={{ duration: 5, repeat: Infinity }} className="absolute -bottom-8 -right-4 h-16 w-16 bg-coral-300/20 rounded-full blur-2xl" />
          </div>

          <h2 className="text-4xl font-black text-slate-800 leading-tight mb-4">
            Tu Red, <span className="text-coral-500">Más Inteligente.</span>
          </h2>
          <p className="text-slate-500 text-lg leading-relaxed px-10">
            Gestiona operaciones, monitoreo en tiempo real y soporte autónomo con IA desde un solo lugar.
          </p>
        </motion.div>

        <div className="absolute bottom-12 left-12 text-slate-400 text-sm font-bold tracking-widest uppercase">
          ISP Platform v2.0
        </div>
      </div>

      {/* Lado Derecho: Formulario */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 sm:p-12 md:p-24 relative">
        <button
          onClick={() => navigate('/')}
          className="absolute top-12 right-12 text-sm font-bold text-slate-400 hover:text-coral-500 transition-colors"
        >
          ← Volver al Inicio
        </button>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-md"
        >
          <div className="mb-10 lg:hidden flex items-center gap-3 mb-12">
             <div className="h-10 w-10 bg-coral-500 rounded-xl flex items-center justify-center">
                <span className="text-xl font-black text-white">I</span>
             </div>
             <span className="text-2xl font-black tracking-tighter text-slate-800 uppercase">
               ISPFAST
             </span>
          </div>

          <div className="mb-10">
            <h1 className="text-3xl font-black text-slate-800 mb-2">Bienvenido</h1>
            <p className="text-slate-500">Ingresa tus credenciales para acceder al panel administrativo.</p>
          </div>

          <LoginForm />

          <div className="mt-12 pt-8 border-t border-gray-100 flex items-center justify-between">
            <p className="text-sm text-slate-400">¿No tienes una cuenta?</p>
            <button className="text-sm font-bold text-coral-500 hover:text-coral-600">Contactar Soporte</button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export default Login

