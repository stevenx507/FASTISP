import React, { useState } from 'react'
import { BellAlertIcon } from '@heroicons/react/24/outline'
import { usePushNotifications } from '../lib/usePushNotifications'
import toast from 'react-hot-toast'

interface Props {
  className?: string
}

const PushOptInCard: React.FC<Props> = ({ className = '' }) => {
  const { isSupported, permission, requestPermission, triggerLocalNotification } = usePushNotifications()
  const [isRequesting, setIsRequesting] = useState(false)

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
      await triggerLocalNotification('FASTISP', 'Recibirás avisos de corte y pagos aquí')
    } else {
      toast.error('Debes permitir notificaciones para recibir avisos')
    }
  }

  return (
    <div className={`bg-white/5 backdrop-blur-md rounded-xl shadow-lg p-5 border border-white/10 ${className}`}>
      <div className="flex items-start gap-3">
        <div className="p-3 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
          <BellAlertIcon className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">Avisos en tu dispositivo</p>
          <p className="text-sm text-slate-400 mt-1">
            Activa notificaciones PWA para cortes programados, facturas y pagos recibidos.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <button
              onClick={handleEnable}
              disabled={isRequesting || permission === 'granted'}
              className="px-4 py-2 rounded-lg bg-blue-600/80 text-white text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {permission === 'granted' ? 'Notificaciones activas' : 'Activar avisos'}
            </button>
            <span className="text-xs text-slate-500">
              Estado: {isSupported ? permission : 'no soportado'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PushOptInCard
