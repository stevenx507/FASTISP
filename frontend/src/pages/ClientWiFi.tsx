import React, { useState, useEffect } from 'react'
import AppLayout from '../components/AppLayout'
import { WifiIcon, ShieldCheckIcon, EyeIcon, EyeSlashIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { apiClient } from '../lib/apiClient'
import toast from 'react-hot-toast'

const ClientWiFi: React.FC = () => {
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const fetchWifiSettings = async () => {
      try {
        const data = await apiClient.get('/client/wifi-settings') as { ssid: string; success: boolean }
        if (data.success) {
          setSsid(data.ssid)
        }
      } catch (error) {
        console.error('Error fetching wifi settings:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchWifiSettings()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ssid || !password) {
      toast.error('Nombre y contraseña son obligatorios')
      return
    }
    if (password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres')
      return
    }

    setSaving(true)
    try {
      const data = await apiClient.post('/client/wifi-settings', { ssid, password }) as { success: boolean; message: string; error?: string }
      if (data.success) {
        toast.success(data.message || 'Configuración actualizada. El router puede reiniciarse.')
        setPassword('')
      } else {
        toast.error(data.error || 'No se pudo actualizar la configuración')
      }
    } catch (error) {
      toast.error('Error al conectar con el servidor')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="flex items-center space-x-3 mb-8">
          <div className="p-3 bg-blue-600/20 rounded-xl">
            <WifiIcon className="h-8 w-8 text-blue-500" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Mi WiFi</h1>
            <p className="text-slate-400">Gestiona el nombre y la clave de tu red inalámbrica</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <ArrowPathIcon className="h-8 w-8 text-blue-500 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-8 shadow-2xl">
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Nombre de la red (SSID)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <WifiIcon className="h-5 w-5 text-slate-500" />
                  </div>
                  <input
                    type="text"
                    value={ssid}
                    onChange={(e) => setSsid(e.target.value)}
                    className="block w-full pl-10 bg-black/20 border border-white/10 rounded-xl py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    placeholder="Ej. MiInternet_5G"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Nueva Contraseña</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <ShieldCheckIcon className="h-5 w-5 text-slate-500" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-10 pr-10 bg-black/20 border border-white/10 rounded-xl py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    placeholder="Mínimo 8 caracteres"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-white transition"
                  >
                    {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-600/20 transition flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <>
                      <ArrowPathIcon className="h-5 w-5 animate-spin" />
                      <span>Actualizando...</span>
                    </>
                  ) : (
                    <span>Guardar Cambios</span>
                  )}
                </button>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 mt-6">
                <p className="text-sm text-yellow-200">
                  <span className="font-bold">Aviso:</span> Al cambiar el nombre o la clave, todos tus dispositivos se desconectarán y deberás volver a conectarlos con los nuevos datos. El router puede tardar 1-2 minutos en aplicar los cambios.
                </p>
              </div>
            </div>
          </form>
        )}
      </div>
    </AppLayout>
  )
}

export default ClientWiFi
