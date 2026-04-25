import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'

interface TicketItem {
  id: number
  subject: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  assigned_to?: string
  sla_due_at?: string
  created_at?: string
}

interface TicketComment {
  id: number
  ticket_id: number
  comment: string
  author?: string
  created_at?: string
}

interface StaffItem {
  id: number
  name: string
  email: string
  role: string
  status: string
}

const statusPill: Record<TicketStatus, string> = {
  open: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-500/20 text-blue-300',
  resolved: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-slate-100 text-slate-700',
}

const TechSupport: React.FC = () => {
  const [tickets, setTickets] = useState<TicketItem[]>([])
  const [staff, setStaff] = useState<StaffItem[]>([])
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null)
  const [comments, setComments] = useState<Record<number, TicketComment[]>>({})
  const [newComment, setNewComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filters, setFilters] = useState({ status: 'all', priority: 'all' })

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) || null,
    [tickets, selectedTicketId]
  )

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      if (filters.status !== 'all' && ticket.status !== filters.status) return false
      if (filters.priority !== 'all' && ticket.priority !== filters.priority) return false
      return true
    })
  }, [tickets, filters])

  const activeStaff = useMemo(
    () =>
      staff.filter(
        (member) => member.status === 'active' && ['admin', 'tech', 'support', 'noc'].includes(member.role)
      ),
    [staff]
  )

  const stats = useMemo(() => {
    const open = tickets.filter((ticket) => ticket.status === 'open').length
    const inProgress = tickets.filter((ticket) => ticket.status === 'in_progress').length
    const overdue = tickets.filter((ticket) => {
      if (!ticket.sla_due_at) return false
      return new Date(ticket.sla_due_at).getTime() < Date.now() && ticket.status !== 'resolved' && ticket.status !== 'closed'
    }).length
    return { open, inProgress, overdue, total: tickets.length }
  }, [tickets])

  const loadBase = useCallback(async () => {
    setLoading(true)
    try {
      const [ticketsRes, staffRes] = await Promise.all([
        apiClient.get('/tickets?limit=120') as Promise<{ items: TicketItem[] }>,
        apiClient.get('/admin/staff') as Promise<{ items: StaffItem[] }>,
      ])
      const ticketItems = ticketsRes.items || []
      setTickets(ticketItems)
      setStaff(staffRes.items || [])
      setSelectedTicketId((current) => current ?? (ticketItems.length ? ticketItems[0].id : null))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar soporte tecnico'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadComments = useCallback(async (ticketId: number) => {
    try {
      const response = await apiClient.get(`/tickets/${ticketId}/comments`)
      setComments((prev) => ({ ...prev, [ticketId]: (response.items || []) as TicketComment[] }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar comentarios'
      toast.error(msg)
    }
  }, [])

  useEffect(() => {
    loadBase()
  }, [loadBase])

  useEffect(() => {
    if (selectedTicketId && comments[selectedTicketId] == null) {
      loadComments(selectedTicketId)
    }
  }, [selectedTicketId, comments, loadComments])

  const updateTicket = async (patch: Partial<TicketItem>) => {
    if (!selectedTicket) return
    setSaving(true)
    try {
      const response = await apiClient.patch(`/tickets/${selectedTicket.id}`, patch)
      const updated = response.ticket as TicketItem
      setTickets((prev) => prev.map((ticket) => (ticket.id === updated.id ? updated : ticket)))
      toast.success('Ticket actualizado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo actualizar ticket'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const addComment = async () => {
    if (!selectedTicket || !newComment.trim()) return
    setSaving(true)
    try {
      await apiClient.post(`/tickets/${selectedTicket.id}/comments`, { comment: newComment.trim() })
      setNewComment('')
      await loadComments(selectedTicket.id)
      toast.success('Comentario agregado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo agregar comentario'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Soporte Tecnico</h2>
          <p className="text-sm text-slate-400">Cola operativa de tickets, SLA y seguimiento de comentarios.</p>
        </div>
        <button
          onClick={loadBase}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 backdrop-blur-md px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 disabled:opacity-60"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase text-amber-700">Open</p>
          <p className="mt-2 text-2xl font-bold text-amber-900">{stats.open}</p>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-500/10 p-4">
          <p className="text-xs font-semibold uppercase text-blue-300">In Progress</p>
          <p className="mt-2 text-2xl font-bold text-blue-200">{stats.inProgress}</p>
        </div>
        <div className="rounded-xl border border-red-100 bg-rose-500/10 p-4">
          <p className="text-xs font-semibold uppercase text-rose-400">SLA Vencido</p>
          <p className="mt-2 text-2xl font-bold text-rose-300">{stats.overdue}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase text-slate-700">Total</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{stats.total}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md shadow-sm xl:col-span-1">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-3">
            <select
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
              className="rounded-lg border border-white/20 px-2 py-1 text-xs"
            >
              <option value="all">Todos estados</option>
              <option value="open">open</option>
              <option value="in_progress">in_progress</option>
              <option value="resolved">resolved</option>
              <option value="closed">closed</option>
            </select>
            <select
              value={filters.priority}
              onChange={(e) => setFilters((prev) => ({ ...prev, priority: e.target.value }))}
              className="rounded-lg border border-white/20 px-2 py-1 text-xs"
            >
              <option value="all">Todas prioridades</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="urgent">urgent</option>
            </select>
          </div>
          <div className="max-h-[560px] divide-y divide-white/5 overflow-y-auto">
            {filteredTickets.map((ticket) => (
              <button
                key={ticket.id}
                onClick={() => setSelectedTicketId(ticket.id)}
                className={`w-full px-4 py-3 text-left transition ${
                  selectedTicketId === ticket.id ? 'bg-blue-500/10' : 'hover:bg-white/5'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-white">#{ticket.id} {ticket.subject}</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusPill[ticket.status]}`}>
                    {ticket.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-400">{ticket.description}</p>
                <p className="mt-1 text-[11px] text-slate-400">Prioridad: {ticket.priority}</p>
              </button>
            ))}
            {!filteredTickets.length && (
              <div className="px-4 py-8 text-center text-sm text-slate-400">Sin tickets para estos filtros.</div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-4 shadow-sm xl:col-span-2">
          {selectedTicket ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Ticket #{selectedTicket.id} - {selectedTicket.subject}
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{selectedTicket.description}</p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Estado</label>
                  <select
                    value={selectedTicket.status}
                    onChange={(e) => updateTicket({ status: e.target.value as TicketStatus })}
                    className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm"
                  >
                    <option value="open">open</option>
                    <option value="in_progress">in_progress</option>
                    <option value="resolved">resolved</option>
                    <option value="closed">closed</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Prioridad</label>
                  <select
                    value={selectedTicket.priority}
                    onChange={(e) => updateTicket({ priority: e.target.value as TicketPriority })}
                    className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="urgent">urgent</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Asignado</label>
                  <select
                    value={selectedTicket.assigned_to || ''}
                    onChange={(e) => updateTicket({ assigned_to: e.target.value || undefined })}
                    className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm"
                  >
                    <option value="">Sin asignar</option>
                    {activeStaff.map((member) => (
                      <option key={member.id} value={member.email}>
                        {member.name} ({member.email})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">SLA</label>
                  <input
                    value={selectedTicket.sla_due_at || ''}
                    onChange={(e) => updateTicket({ sla_due_at: e.target.value })}
                    className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm"
                    placeholder="2026-03-01T10:00:00"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-white/10 p-3">
                <h4 className="mb-2 font-semibold text-white">Comentarios</h4>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {(comments[selectedTicket.id] || []).map((comment) => (
                    <div key={comment.id} className="rounded-md border border-white/10 px-3 py-2 text-sm">
                      <p className="text-xs text-slate-400">
                        {comment.author || 'usuario'} - {comment.created_at?.replace('T', ' ').slice(0, 16) || '-'}
                      </p>
                      <p className="mt-1 text-slate-200">{comment.comment}</p>
                    </div>
                  ))}
                  {!comments[selectedTicket.id]?.length && (
                    <p className="text-sm text-slate-400">Sin comentarios.</p>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Agregar comentario"
                    className="flex-1 rounded-lg border border-white/20 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={addComment}
                    disabled={saving || !newComment.trim()}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    Enviar
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-slate-400">Selecciona un ticket para comenzar.</div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TechSupport
