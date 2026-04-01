import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { apiClient } from '../lib/apiClient'

interface Ticket {
  id: number
  subject: string
  description: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assigned_to?: string
  sla_due_at?: string
  created_at?: string
}

interface Comment {
  id: number
  ticket_id: number
  comment: string
  author?: string
  created_at?: string
}

interface TicketDraft {
  status: Ticket['status']
  priority: Ticket['priority']
  assigned_to: string
  sla_due_at: string
}

const statusColors: Record<Ticket['status'], string> = {
  open: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-700',
}

const emptyDraft: TicketDraft = {
  status: 'open',
  priority: 'medium',
  assigned_to: '',
  sla_due_at: '',
}

const TicketsAdmin: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [comments, setComments] = useState<Record<number, Comment[]>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draft, setDraft] = useState<TicketDraft>(emptyDraft)
  const [newComment, setNewComment] = useState('')

  const selected = useMemo(() => tickets.find((ticket) => ticket.id === selectedId) || null, [tickets, selectedId])

  const syncDraftFromTicket = (ticket: Ticket | null) => {
    if (!ticket) {
      setDraft(emptyDraft)
      return
    }
    setDraft({
      status: ticket.status,
      priority: ticket.priority,
      assigned_to: ticket.assigned_to || '',
      sla_due_at: ticket.sla_due_at || '',
    })
  }

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiClient.get('/tickets')
      const next = (res.items || []) as Ticket[]
      setTickets(next)
      setSelectedId((prev) => prev ?? (next.length ? next[0].id : null))
    } catch (err) {
      toast.error('No se pudieron cargar tickets')
    } finally {
      setLoading(false)
    }
  }

  const loadComments = useCallback(async (ticketId: number) => {
    try {
      const res = await apiClient.get(`/tickets/${ticketId}/comments`)
      setComments((prev) => ({ ...prev, [ticketId]: (res.items || []) as Comment[] }))
    } catch (err) {
      toast.error('No se pudieron cargar comentarios')
    }
  }, [])

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    syncDraftFromTicket(selected)
    if (selected?.id) {
      loadComments(selected.id)
    }
  }, [selected, loadComments])

  const updateTicket = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const payload = {
        status: draft.status,
        priority: draft.priority,
        assigned_to: draft.assigned_to || undefined,
        sla_due_at: draft.sla_due_at || undefined,
      }
      const res = await apiClient.patch(`/tickets/${selected.id}`, payload)
      toast.success('Ticket actualizado')
      const updated = res.ticket as Ticket
      setTickets((prev) => prev.map((ticket) => (ticket.id === updated.id ? updated : ticket)))
      syncDraftFromTicket(updated)
    } catch (err) {
      toast.error('No se pudo actualizar ticket')
    } finally {
      setSaving(false)
    }
  }

  const addComment = async () => {
    if (!selected || !newComment.trim()) return
    setSaving(true)
    try {
      await apiClient.post(`/tickets/${selected.id}/comments`, { comment: newComment.trim() })
      setNewComment('')
      await loadComments(selected.id)
      toast.success('Comentario agregado')
    } catch (err) {
      toast.error('No se pudo agregar comentario')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Tickets</h1>
          <p className="text-gray-600">Administra SLA, estados y asignaciones.</p>
        </div>
        <button onClick={load} disabled={loading} className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-60">
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow lg:col-span-2">
          <div className="grid grid-cols-6 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600">
            <span>ID</span>
            <span>Asunto</span>
            <span>Prioridad</span>
            <span>Estado</span>
            <span>SLA</span>
            <span>Asignado</span>
          </div>
          <div className="divide-y divide-gray-100">
            {tickets.map((ticket) => (
              <button key={ticket.id} onClick={() => setSelectedId(ticket.id)} className="w-full text-left">
                <motion.div className={`grid grid-cols-6 px-4 py-3 ${selectedId === ticket.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <span className="text-sm font-mono text-gray-900">{ticket.id}</span>
                  <span className="truncate text-sm text-gray-900">{ticket.subject}</span>
                  <span className="text-xs font-semibold text-gray-700">{ticket.priority}</span>
                  <span className={`rounded-full px-2 py-1 text-xs ${statusColors[ticket.status]}`}>{ticket.status}</span>
                  <span className="text-xs text-gray-600">{ticket.sla_due_at ? ticket.sla_due_at.split('T')[0] : '-'}</span>
                  <span className="text-sm text-gray-700">{ticket.assigned_to || '-'}</span>
                </motion.div>
              </button>
            ))}
            {!tickets.length && <div className="px-4 py-6 text-center text-gray-500">Sin tickets</div>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow">
          {selected ? (
            <>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Ticket #{selected.id}</h3>
              <p className="mb-2 text-sm text-gray-700">{selected.subject}</p>
              <p className="mb-3 whitespace-pre-wrap text-sm text-gray-600">{selected.description}</p>

              <div className="mb-4 space-y-2">
                <label className="text-xs text-gray-600">Estado</label>
                <select
                  className="w-full rounded-lg border px-3 py-2"
                  value={draft.status}
                  onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value as Ticket['status'] }))}
                >
                  <option value="open">open</option>
                  <option value="in_progress">in_progress</option>
                  <option value="resolved">resolved</option>
                  <option value="closed">closed</option>
                </select>
                <label className="text-xs text-gray-600">Prioridad</label>
                <select
                  className="w-full rounded-lg border px-3 py-2"
                  value={draft.priority}
                  onChange={(e) => setDraft((prev) => ({ ...prev, priority: e.target.value as Ticket['priority'] }))}
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="urgent">urgent</option>
                </select>
                <label className="text-xs text-gray-600">Asignado a</label>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  placeholder="tecnico@isp.com"
                  value={draft.assigned_to}
                  onChange={(e) => setDraft((prev) => ({ ...prev, assigned_to: e.target.value }))}
                />
                <label className="text-xs text-gray-600">SLA (ISO)</label>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  placeholder="2026-02-22T12:00:00"
                  value={draft.sla_due_at}
                  onChange={(e) => setDraft((prev) => ({ ...prev, sla_due_at: e.target.value }))}
                />
                <button onClick={updateTicket} disabled={saving} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>

              <div className="border-t pt-3">
                <h4 className="mb-2 text-sm font-semibold text-gray-900">Comentarios</h4>
                <div className="mb-2 max-h-40 space-y-2 overflow-auto">
                  {(comments[selected.id] || []).map((comment) => (
                    <div key={comment.id} className="rounded-lg border px-3 py-2 text-sm text-gray-700">
                      <div className="mb-1 text-xs text-gray-500">
                        {comment.author || 'usuario'} - {comment.created_at?.replace('T', ' ').slice(0, 16)}
                      </div>
                      <div>{comment.comment}</div>
                    </div>
                  ))}
                  {!comments[selected.id]?.length && <div className="text-xs text-gray-500">Sin comentarios</div>}
                </div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border px-3 py-2"
                    placeholder="Agregar comentario"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                  />
                  <button onClick={addComment} disabled={saving || !newComment.trim()} className="rounded-lg bg-blue-600 px-3 py-2 text-white hover:bg-blue-700 disabled:opacity-60">
                    Enviar
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-500">Selecciona un ticket para ver detalles.</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TicketsAdmin
