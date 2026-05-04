import React, { useState } from 'react'
import { KeyIcon, XMarkIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'
import { Client } from './types'

interface Props {
  client: Client
  onClose: () => void
  onSuccess?: () => void
}

const PortalAccessModal: React.FC<Props> = ({ client, onClose, onSuccess }) => {
  const [email, setEmail] = useState(client.email || '')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const submitPortalAccess = async () => {
    if (!email) { toast.error('El email es requerido'); return }
    setSaving(true)
    try {
      await apiClient.post(`/clients/${client.id}/portal-access`, { email, password })
      toast.success('Credenciales de portal actualizadas')
      if (onSuccess) onSuccess()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error guardando acceso al portal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white backdrop-blur-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-blue-600">Portal cliente</p>
            <h3 className="text-lg font-bold text-slate-800">{client.name}</h3>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-gray-100">
            <XMarkIcon className="h-5 w-5 text-slate-500" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@correo.com"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">Nueva contraseña (opcional)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Auto-generada si se deja vacío"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-slate-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={submitPortalAccess}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <KeyIcon className="h-4 w-4" />
            {saving ? 'Guardando...' : 'Guardar credenciales'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PortalAccessModal
