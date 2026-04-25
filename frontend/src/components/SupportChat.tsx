import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { apiClient } from '../lib/apiClient'

type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'
type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

type ChatRole = 'user' | 'assistant'

interface ChatMessage {
  id: string
  role: ChatRole
  text: string
}

interface TicketItem {
  id: number
  subject: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  created_at?: string
}

interface DiagnosticsResult {
  ping_gateway_ms?: number
  ping_internet_ms?: number
  packet_loss_pct?: number
  pppoe_session?: string
  recommendations?: string[]
}

const quickReplies = [
  'Tengo internet lento',
  'No tengo conexion',
  'Necesito ayuda con mi factura',
  'Quiero abrir un ticket',
]

const statusBadge: Record<TicketStatus, string> = {
  open: 'bg-rose-500/20 text-rose-400',
  in_progress: 'bg-amber-500/20 text-amber-400',
  resolved: 'bg-emerald-500/20 text-emerald-400',
  closed: 'bg-white/10 text-slate-300',
}

const priorityBadge: Record<TicketPriority, string> = {
  low: 'bg-slate-100 text-slate-700',
  medium: 'bg-blue-500/20 text-blue-300',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-rose-500/20 text-rose-400',
}



const formatDate = (value?: string) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

const SupportChat: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'assistant-1',
      role: 'assistant',
      text: 'Hola, soy soporte virtual. Describe tu problema o ejecuta un diagnostico rapido.',
    },
  ])
  const [draft, setDraft] = useState('')
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null)
  const [runningDiagnostics, setRunningDiagnostics] = useState(false)
  const [tickets, setTickets] = useState<TicketItem[]>([])
  const [loadingTickets, setLoadingTickets] = useState(false)
  const [creatingTicket, setCreatingTicket] = useState(false)
  const [ticketSubject, setTicketSubject] = useState('')
  const [ticketDescription, setTicketDescription] = useState('')
  const [ticketPriority, setTicketPriority] = useState<TicketPriority>('medium')

  const unreadOpenTickets = useMemo(
    () => tickets.filter((ticket) => ticket.status === 'open' || ticket.status === 'in_progress').length,
    [tickets]
  )

  const addAssistantMessage = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text,
      },
    ])
  }, [])

  const loadTickets = useCallback(async () => {
    setLoadingTickets(true)
    try {
      const response = await apiClient.get('/client/tickets') as { items?: TicketItem[] }
      setTickets((response.items || []) as TicketItem[])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudieron cargar tickets'
      toast.error(msg)
    } finally {
      setLoadingTickets(false)
    }
  }, [])

  useEffect(() => {
    loadTickets()
  }, [loadTickets])

  const runDiagnostics = async () => {
    setRunningDiagnostics(true)
    try {
      const response = await apiClient.post('/client/diagnostics/run') as DiagnosticsResult
      setDiagnostics(response)
      addAssistantMessage(
        `Diagnostico completado. Ping gateway ${Number(response.ping_gateway_ms || 0).toFixed(1)} ms, ping internet ${Number(response.ping_internet_ms || 0).toFixed(1)} ms, perdida ${Number(response.packet_loss_pct || 0).toFixed(1)}%.`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo ejecutar diagnostico'
      toast.error(msg)
    } finally {
      setRunningDiagnostics(false)
    }
  }

  const sendMessage = async (content: string) => {
    const text = content.trim()
    if (!text) return

    const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', text }
    setMessages((prev) => [...prev, userMsg])
    setDraft('')

    if (!ticketDescription.trim()) setTicketDescription(text)
    if (!ticketSubject.trim()) setTicketSubject(text.slice(0, 80))

    try {
      const response = await apiClient.post('/client/support/ai-chat', { message: text }) as { reply?: string }
      if (response.reply) {
        addAssistantMessage(response.reply)
      }
    } catch (err) {
      addAssistantMessage("Lo siento, no pude contactar con el asistente de IA. Intentemos de nuevo en un momento.")
    }
  }

  const createTicket = async () => {
    if (!ticketSubject.trim() || !ticketDescription.trim()) {
      toast.error('Asunto y descripcion son obligatorios')
      return
    }

    setCreatingTicket(true)
    try {
      const response = await apiClient.post('/client/tickets', {
        subject: ticketSubject.trim(),
        description: ticketDescription.trim(),
        priority: ticketPriority,
      }) as { ticket?: TicketItem }

      if (response.ticket) {
        setTickets((prev) => [response.ticket as TicketItem, ...prev])
        addAssistantMessage(`Ticket #${response.ticket.id} creado correctamente. Haremos seguimiento por este canal.`)
      }

      setTicketSubject('')
      setTicketDescription('')
      setTicketPriority('medium')
      toast.success('Ticket creado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo crear el ticket'
      toast.error(msg)
    } finally {
      setCreatingTicket(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <section className="lg:col-span-2 overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-md shadow">
        <div className="border-b border-white/10 p-4">
          <h3 className="text-lg font-semibold text-white">Asistente de soporte</h3>
          <p className="text-sm text-slate-400">Describe el problema o usa respuestas rapidas para acelerar atencion.</p>
        </div>

        <div className="max-h-96 space-y-3 overflow-y-auto bg-white/5 p-4">
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] rounded-lg px-3 py-2 text-sm ${
                  message.role === 'user' ? 'bg-blue-600 text-white' : 'border border-white/10 bg-white/5 backdrop-blur-md text-slate-300'
                }`}
              >
                {message.text}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            {quickReplies.map((reply) => (
              <button
                key={reply}
                onClick={() => sendMessage(reply)}
                className="rounded-full border border-white/20 bg-white/5 backdrop-blur-md px-3 py-1 text-xs text-slate-300 hover:bg-white/10"
              >
                {reply}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  sendMessage(draft)
                }
              }}
              className="flex-1 rounded-lg border border-white/20 px-3 py-2 text-sm"
              placeholder="Escribe tu consulta..."
            />
            <button
              onClick={() => sendMessage(draft)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Enviar
            </button>
            <button
              onClick={runDiagnostics}
              disabled={runningDiagnostics}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {runningDiagnostics ? 'Diagnosticando...' : 'Diagnostico rapido'}
            </button>
          </div>

          {diagnostics && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-200">
              <p className="font-semibold">Resultado de diagnostico</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <p>Ping gateway: {Number(diagnostics.ping_gateway_ms || 0).toFixed(1)} ms</p>
                <p>Ping internet: {Number(diagnostics.ping_internet_ms || 0).toFixed(1)} ms</p>
                <p>Perdida de paquetes: {Number(diagnostics.packet_loss_pct || 0).toFixed(1)}%</p>
                <p>Sesion PPPoE: {diagnostics.pppoe_session || 'N/A'}</p>
              </div>
              {!!diagnostics.recommendations?.length && (
                <ul className="mt-3 list-disc space-y-1 pl-5">
                  {diagnostics.recommendations.map((item, idx) => (
                    <li key={`${item}-${idx}`}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-white/10 bg-white/5 backdrop-blur-md p-4 shadow">
        <div>
          <h3 className="text-lg font-semibold text-white">Tickets</h3>
          <p className="text-sm text-slate-400">Abiertos: {unreadOpenTickets}</p>
        </div>

        <div className="space-y-2 rounded-lg border border-white/10 p-3">
          <p className="text-sm font-semibold text-white">Nuevo ticket</p>
          <input
            value={ticketSubject}
            onChange={(event) => setTicketSubject(event.target.value)}
            className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm"
            placeholder="Asunto"
          />
          <textarea
            value={ticketDescription}
            onChange={(event) => setTicketDescription(event.target.value)}
            rows={4}
            className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm"
            placeholder="Describe el problema"
          />
          <select
            value={ticketPriority}
            onChange={(event) => setTicketPriority(event.target.value as TicketPriority)}
            className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm"
          >
            <option value="low">Baja</option>
            <option value="medium">Media</option>
            <option value="high">Alta</option>
            <option value="urgent">Urgente</option>
          </select>
          <button
            onClick={createTicket}
            disabled={creatingTicket}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {creatingTicket ? 'Creando...' : 'Crear ticket'}
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Historial</p>
            <button
              onClick={loadTickets}
              disabled={loadingTickets}
              className="text-xs font-medium text-blue-600 hover:underline disabled:text-slate-500"
            >
              {loadingTickets ? 'Actualizando...' : 'Actualizar'}
            </button>
          </div>

          <div className="max-h-80 space-y-2 overflow-y-auto">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="rounded-lg border border-white/10 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-white">#{ticket.id} {ticket.subject}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge[ticket.status]}`}>
                    {ticket.status}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityBadge[ticket.priority]}`}>
                    {ticket.priority}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-400">{ticket.description}</p>
                <p className="mt-1 text-[11px] text-slate-400">{formatDate(ticket.created_at)}</p>
              </div>
            ))}
            {!tickets.length && !loadingTickets && (
              <p className="rounded-lg border border-dashed border-white/20 p-3 text-sm text-slate-400">
                No hay tickets registrados.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export default SupportChat
