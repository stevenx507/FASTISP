import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { 
  EnvelopeIcon, 
  LockClosedIcon, 
  BoltIcon,
  EyeIcon,
  EyeSlashIcon,
  ChevronLeftIcon
} from '@heroicons/react/24/outline'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'

const Login: React.FC = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const { login } = useAuthStore()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      await login(email, password)
      toast.success('¡Bienvenido a ISPFAST!')
      navigate('/admin')
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error al conectar con el servidor'
      toast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FDF5E6] flex flex-col md:flex-row overflow-hidden font-sans">
      
      {/* ─── Panel Izquierdo: Branding (Captura Style) ─── */}
      <div className="hidden md:flex flex-1 bg-[#FDF5E6] relative items-center justify-center p-12 lg:p-24 overflow-hidden">
        
        <div className="relative z-10 max-w-lg w-full">
          {/* Logo con Rayo */}
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-4 mb-16"
          >
            <div className="relative">
              <BoltIcon className="h-20 w-20 text-[#FF6961] drop-shadow-[0_10px_10px_rgba(255,105,97,0.3)]" />
              <motion.div 
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute inset-0 bg-[#FF6961] blur-2xl opacity-20" 
              />
            </div>
            <h1 className="text-6xl font-black tracking-tighter text-[#FF6961]">ISPFAST</h1>
          </motion.div>

          {/* Imagen de Dashboard */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="relative mb-16"
          >
            <div className="absolute inset-0 bg-[#FF6961]/10 blur-[80px] rounded-full scale-110" />
            <img 
              src="/login-dashboard.png" 
              alt="Dashboard Preview" 
              className="relative rounded-[2.5rem] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.15)] border-8 border-white transform hover:rotate-1 transition-transform duration-700"
            />
          </motion.div>

          {/* Textos Branding */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-center md:text-left"
          >
            <h2 className="text-5xl lg:text-6xl font-black text-slate-900 mb-6 leading-tight">
              Tu Red, <span className="relative">
                Más Inteligente.
                <span className="absolute bottom-1 left-0 w-full h-4 bg-[#FF6961]/10 -z-10" />
              </span>
            </h2>
            <p className="text-xl text-slate-500 font-bold leading-relaxed opacity-80">
              Gestión proactiva y monitorización en tiempo real <br /> potenciada por IA.
            </p>
          </motion.div>
        </div>

        {/* Info Versión */}
        <div className="absolute bottom-10 left-10 text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">
          ISP PLATFORM v2.0
        </div>
        <div className="absolute bottom-10 right-10">
           <a href="#" className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400 hover:text-[#FF6961] transition-colors">Documentación</a>
        </div>
      </div>

      {/* ─── Panel Derecho: Formulario Blanco (Captura Style) ─── */}
      <div className="flex-1 flex flex-col justify-center p-8 sm:p-12 lg:p-24 bg-white relative">
        
        {/* Botón Volver al inicio */}
        <div className="absolute top-10 right-10">
           <button 
             onClick={() => navigate('/')}
             className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-300 hover:text-[#FF6961] transition-colors"
           >
             — Volver al inicio
           </button>
        </div>

        <div className="max-w-md w-full mx-auto">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="mb-14"
          >
            <h3 className="text-4xl lg:text-5xl font-black text-slate-900 mb-4 tracking-tight">Bienvenido</h3>
            <p className="text-slate-400 font-bold text-sm leading-relaxed">
              Ingresa tus credenciales para acceder al panel administrativo.
            </p>
          </motion.div>

          <form onSubmit={handleLogin} className="space-y-8">
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 ml-1">Email</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                  <EnvelopeIcon className="h-5 w-5 text-slate-300 group-focus-within:text-[#FF6961] transition-colors" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-14 pr-5 py-5 bg-[#FDF5E6]/30 border border-slate-100 rounded-2xl text-slate-900 font-bold placeholder:text-slate-300 focus:outline-none focus:ring-4 focus:ring-[#FF6961]/5 focus:border-[#FF6961] transition-all"
                  placeholder="plataforma@fastisp.cloud"
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 ml-1">Contraseña</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                  <LockClosedIcon className="h-5 w-5 text-slate-300 group-focus-within:text-[#FF6961] transition-colors" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-14 pr-14 py-5 bg-[#FDF5E6]/30 border border-slate-100 rounded-2xl text-slate-900 font-bold placeholder:text-slate-300 focus:outline-none focus:ring-4 focus:ring-[#FF6961]/5 focus:border-[#FF6961] transition-all"
                  placeholder="••••••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-5 flex items-center text-slate-300 hover:text-[#FF6961] transition-colors"
                >
                  {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative">
                  <input type="checkbox" className="sr-only peer" />
                  <div className="h-5 w-5 bg-slate-50 border border-slate-200 rounded-md peer-checked:bg-[#FF6961] peer-checked:border-[#FF6961] transition-all" />
                  <CheckIcon className="absolute inset-0 h-3.5 w-3.5 text-white m-auto opacity-0 peer-checked:opacity-100 transition-opacity" />
                </div>
                <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest group-hover:text-slate-600">Recordarme</span>
              </label>
              <a href="#" className="text-[11px] font-black text-slate-400 hover:text-[#FF6961] transition-colors uppercase tracking-[0.15em]">
                ¿Olvidaste tu contraseña?
              </a>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-5 px-8 rounded-2xl bg-gradient-to-r from-[#FF6961] to-[#e55e57] text-white font-black text-sm uppercase tracking-[0.3em] shadow-xl shadow-[#FF6961]/20 hover:shadow-[#FF6961]/40 hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-70 flex items-center justify-center gap-3"
            >
              <AnimatePresence mode="wait">
                {isLoading ? (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Iniciando sesión...
                  </motion.div>
                ) : (
                  <motion.div key="text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2">
                    Iniciando sesión <BoltIcon className="h-5 w-5" />
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
          </form>

          <div className="mt-16 flex items-center justify-between pt-10 border-t border-slate-50">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
              ¿No tienes una cuenta? <a href="#" className="text-[#FF6961] hover:underline ml-1">Contactar Soporte</a>
            </div>
            <div className="h-1.5 w-1.5 rounded-full bg-slate-100" />
          </div>
        </div>
      </div>
    </div>
  )
}

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
  </svg>
)

export default Login
