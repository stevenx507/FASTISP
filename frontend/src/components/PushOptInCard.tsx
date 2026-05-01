import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { BellAlertIcon, SparklesIcon } from '@heroicons/react/24/outline'
import { usePushNotifications } from '../lib/usePushNotifications'
import toast from 'react-hot-toast'
import { useTheme } from '../contexts/ThemeContext'

interface Props {
  className?: string
}

const PushOptInCard: React.FC<Props> = ({ className = '' }) => {
  const { isSupported, permission, requestPermission, triggerLocalNotification } = usePushNotifications()
  const [isRequesting, setIsRequesting] = useState(false)
  const { branding } = useTheme()

  const handleEnable = async () => {
    if (!isSupported) {
      toast.error('Tu dispositivo no soporta notificaciones push')
      return
    }
    setIsRequesting(true)
    const result = await requestPermission()
    setIsRequesting(false)
    if (result === 'granted') {
      toast.success('Notificaciones activadas')
      // FIX #11: Usar brand_name dinámico en lugar de ISPMAX
      await triggerLocalNotification(branding.brand_name, '¡Bienvenido! Recibirás avisos críticos aquí.')
    } else {
      toast.error('Debes permitir notificaciones para recibir avisos')
    }
  }

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`relative overflow-hidden bg-gradient-to-br from-slate-900/60 to-slate-900/40 backdrop-blur-xl rounded-2xl shadow-2xl p-6 border border-gray-200 ${className}`}
    >
      <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-blue-500 opacity-5 blur-3xl" />
      
      <div className="flex items-start gap-5">
        <div className="relative">
          <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/10 text-cyan-400 border border-cyan-500/30 shadow-lg shadow-cyan-500/10">
            <BellAlertIcon className="w-7 h-7" />
          </div>
          <motion.div 
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ repeat: Infinity, duration: 2 }}
            className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-rose-500 border-2 border-slate-900" 
          />
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-lg font-black text-white tracking-tight">Experiencia Pro</p>
            <SparklesIcon className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            Activa el centro de avisos para recibir alertas de pago, mantenimientos y soporte en tiempo real directamente en tu pantalla.
          </p>
          
          <div className="mt-5 flex flex-wrap gap-3 items-center">
            <button
              onClick={handleEnable}
              disabled={isRequesting || permission === 'granted'}
              className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all transform hover:scale-105 active:scale-95 shadow-lg ${
                permission === 'granted' 
                  ? 'bg-white text-slate-500 border border-gray-200 cursor-default' 
                  : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-blue-500/20 hover:shadow-cyan-500/30'
              } disabled:opacity-50`}
            >
              {isRequesting ? 'Configurando...' : permission === 'granted' ? 'Alertas activas' : 'Habilitar Notificaciones'}
            </button>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Estado</span>
              <span className={`text-xs font-bold ${permission === 'granted' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {isSupported ? (permission === 'granted' ? 'Conectado' : 'Pendiente') : 'No compatible'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

export default PushOptInCard
