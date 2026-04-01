import React, { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { apiClient } from '../lib/apiClient'
import { CheckCircleIcon, WrenchScrewdriverIcon, ClockIcon, ChatBubbleBottomCenterTextIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface Ticket {
  id: number
  subject: string
  description: string
  status: string
  priority: string
  address?: string
  sla_due_at?: string
  assigned_to?: string
}

const statusLabels: Record<string, string> = {
  open: 'Pendiente',
  in_progress: 'En ruta',
  resolved: 'Resuelto',
  closed: 'Cerrado'
}

const TechApp: React.FC = () => {
  const { user } = useAuthStore()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')

  const loadTickets = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get('/tickets?status=open')
      const items = res.items || []
      const filtered = user?.email ? items.filter((t: Ticket) => !t.assigned_to || t.assigned_to === user.email) : items
      setTickets(filtered)
    } catch (err) {
      toast.error('No se pudieron cargar tickets')
    } finally {
      setLoading(false)
    }
  }, [user?.email])

  useEffect(() => { loadTickets() }, [loadTickets])

  const updateStatus = async (ticket: Ticket, status: string) => {
    try {
      await apiClient.patch(`/tickets/${ticket.id}`, { status, assigned_to: user?.email || ticket.assigned_to })
      toast.success(`Ticket ${ticket.id} -> ${statusLabels[status] || status}`)
      setTickets((prev) => prev.map((t) => t.id === ticket.id ? { ...t, status, assigned_to: user?.email || t.assigned_to } : t))
    } catch {
      toast.error('No se pudo actualizar el ticket')
    }
  }

  const addQuickNote = async (ticket: Ticket) => {
    if (!note.trim()) return
    try {
      await apiClient.post(`/tickets/${ticket.id}/comments`, { comment: note })
      toast.success('Nota enviada')
      setNote('')
    } catch {
      toast.error('No se pudo enviar la nota')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white px-4 py-6 max-w-4xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs uppercase text-gray-500">App de campo</p>
          <h1 className="text-2xl font-bold text-gray-900">Tickets asignados</h1>
          <p className="text-sm text-gray-600">Hola {user?.name || 'técnico'}, atiende y cierra con un toque.</p>
        </div>
        <button
          onClick={loadTickets}
          disabled={loading}
          className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold shadow hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </header>

      <div className="space-y-3">
        {tickets.map((t) => (
          <div key={t.id} className="bg-white rounded-xl shadow border border-gray-200 p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500">#{t.id} • {t.priority}</p>
                <h2 className="text-lg font-semibold text-gray-900">{t.subject}</h2>
                <p className="text-sm text-gray-700 mt-1">{t.description}</p>
                {t.address && <p className="text-xs text-gray-500 mt-1">Dir: {t.address}</p>}
                {t.sla_due_at && <p className="text-xs text-amber-600 mt-1">SLA: {t.sla_due_at.replace('T',' ').slice(0,16)}</p>}
              </div>
              <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                {statusLabels[t.status] || t.status}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => updateStatus(t, 'in_progress')} className="flex items-center justify-center gap-1 text-sm px-2 py-2 rounded-lg bg-sky-50 text-sky-700 border border-sky-100">
                <WrenchScrewdriverIcon className="w-4 h-4" /> En ruta
              </button>
              <button onClick={() => updateStatus(t, 'resolved')} className="flex items-center justify-center gap-1 text-sm px-2 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100">
                <CheckCircleIcon className="w-4 h-4" /> Resuelto
              </button>
              <button onClick={() => updateStatus(t, 'closed')} className="flex items-center justify-center gap-1 text-sm px-2 py-2 rounded-lg bg-gray-50 text-gray-700 border border-gray-200">
                <ClockIcon className="w-4 h-4" /> Cerrar
              </button>
            </div>

            <div className="flex gap-2">
              <input
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
                placeholder="Nota rápida (ej. ONT reiniciada)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                onClick={() => addQuickNote(t)}
                className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700"
              >
                <ChatBubbleBottomCenterTextIcon className="w-4 h-4 inline-block mr-1" />
                Nota
              </button>
            </div>
          </div>
        ))}
        {!tickets.length && (
          <div className="text-center text-gray-500 text-sm py-10 bg-white rounded-xl border border-dashed border-gray-200">
            Sin tickets asignados. Pulsa actualizar para sincronizar.
          </div>
        )}
      </div>
    </div>
  )
}

export default TechApp
