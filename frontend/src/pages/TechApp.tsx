import React, { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { apiClient } from '../lib/apiClient'
import { 
  CheckCircleIcon, 
  WrenchScrewdriverIcon, 
  ClockIcon, 
  ChatBubbleBottomCenterTextIcon,
  MapIcon,
  MapPinIcon,
  SignalIcon
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Leaflet Icon Fix
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface Ticket {
  id: number
  subject: string
  description: string
  status: string
  priority: string
  address?: string
  latitude?: number
  longitude?: number
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
  const [showMap, setShowMap] = useState<number | null>(null)

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

  const captureLocation = async (ticketId: number) => {
    if (!navigator.geolocation) {
      toast.error('Geolocalización no soportada')
      return
    }
    
    toast.loading('Obteniendo ubicación...')
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await apiClient.patch(`/tickets/${ticketId}`, {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        })
        toast.dismiss()
        toast.success('Ubicación guardada')
        loadTickets()
      } catch {
        toast.dismiss()
        toast.error('Error al guardar ubicación')
      }
    }, () => {
      toast.dismiss()
      toast.error('Permiso denegado')
    })
  }

  return (
    <div className="min-h-screen bg-[#FDF5E6] px-4 py-6 max-w-4xl mx-auto text-slate-800">
      <header className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
             <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
             <p className="text-[10px] uppercase font-bold tracking-widest text-emerald-600">Tech Field Ops</p>
          </div>
          <h1 className="text-3xl font-black text-slate-900">Órdenes de Trabajo</h1>
          <p className="text-sm text-slate-500 mt-1">Sincronizado para {user?.name || 'técnico'}.</p>
        </div>
        <button
          onClick={loadTickets}
          disabled={loading}
          className="p-3 rounded-2xl bg-white border border-gray-200 text-slate-600 shadow-sm hover:bg-gray-50 disabled:opacity-60 transition-all"
        >
          <ArrowPathIcon className={`w-6 h-6 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <div className="space-y-4">
        {tickets.map((t) => (
          <div key={t.id} className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 flex flex-col gap-4 overflow-hidden hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter ${
                    t.priority === 'high' ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-blue-50 text-blue-600 border border-blue-200'
                  }`}>
                    {t.priority}
                  </span>
                  <p className="text-[10px] text-slate-400 font-mono">#{t.id}</p>
                </div>
                <h2 className="text-xl font-bold text-slate-900">{t.subject}</h2>
                <p className="text-sm text-slate-500 line-clamp-2">{t.description}</p>
                
                {t.address && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-blue-600 bg-blue-50 w-fit px-3 py-1 rounded-full border border-blue-200">
                    <MapPinIcon className="w-3 h-3" />
                    {t.address}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="text-[10px] px-2.5 py-1 rounded-lg bg-gray-50 text-slate-600 font-bold border border-gray-200">
                  {statusLabels[t.status] || t.status}
                </span>
                {t.sla_due_at && (
                  <div className="text-[10px] font-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    SLA: {t.sla_due_at.replace('T',' ').slice(0,16)}
                  </div>
                )}
              </div>
            </div>

            {/* GIS Map Inline */}
            {showMap === t.id && t.latitude && t.longitude && (
              <div className="h-48 w-full rounded-2xl overflow-hidden border border-gray-200">
                <MapContainer center={[t.latitude, t.longitude]} zoom={15} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                  <Marker position={[t.latitude, t.longitude]} />
                </MapContainer>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button onClick={() => updateStatus(t, 'in_progress')} className="flex items-center justify-center gap-2 text-xs font-bold px-3 py-2.5 rounded-xl bg-blue-600 text-white shadow-sm hover:bg-blue-500 transition-all">
                <WrenchScrewdriverIcon className="w-4 h-4" /> En ruta
              </button>
              <button onClick={() => captureLocation(t.id)} className="flex items-center justify-center gap-2 text-xs font-bold px-3 py-2.5 rounded-xl bg-white text-slate-600 border border-gray-200 hover:bg-gray-50 transition-all">
                <MapIcon className="w-4 h-4" /> {t.latitude ? 'Re-ubicar' : 'Geo-tag'}
              </button>
              {t.latitude && (
                <button onClick={() => setShowMap(showMap === t.id ? null : t.id)} className="flex items-center justify-center gap-2 text-xs font-bold px-3 py-2.5 rounded-xl bg-white text-slate-600 border border-gray-200 hover:bg-gray-50 transition-all">
                  <SignalIcon className="w-4 h-4" /> {showMap === t.id ? 'Cerrar Mapa' : 'Ver Mapa'}
                </button>
              )}
              <button onClick={() => updateStatus(t, 'resolved')} className="flex items-center justify-center gap-2 text-xs font-bold px-3 py-2.5 rounded-xl bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 transition-all">
                <CheckCircleIcon className="w-4 h-4" /> Resolver
              </button>
            </div>

            <div className="flex gap-2 bg-gray-50 p-2 rounded-2xl border border-gray-200">
              <input
                className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-slate-700 px-2 placeholder-slate-400"
                placeholder="Escribe una actualización..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                onClick={() => addQuickNote(t)}
                className="px-4 py-2 bg-coral-500 text-white rounded-xl text-xs font-bold hover:bg-coral-600 transition-all"
              >
                Actualizar
              </button>
            </div>
          </div>
        ))}
        {!tickets.length && (
          <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-200">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
               <CheckCircleIcon className="w-8 h-8 text-emerald-400" />
            </div>
            <p className="text-slate-500 font-medium">Bandeja de entrada limpia.</p>
            <p className="text-xs text-slate-400 mt-1">Buen trabajo, no hay pendientes hoy.</p>
          </div>
        )}
      </div>

      <style>{`
        .leaflet-container {
          background: #e2e8f0 !important;
        }
      `}</style>
    </div>
  )
}

const ArrowPathIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
)

export default TechApp

