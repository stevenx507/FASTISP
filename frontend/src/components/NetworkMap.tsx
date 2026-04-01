import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { motion, AnimatePresence } from 'framer-motion'
import {
  XMarkIcon,
  SignalIcon,
  MapPinIcon,
  ComputerDesktopIcon,
  ClockIcon,
  ArrowPathIcon,
  DocumentTextIcon
} from '@heroicons/react/24/solid'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import toast from 'react-hot-toast'
import { apiClient } from '../lib/apiClient'

// Arreglo para el problema de los marcadores por defecto en React-Leaflet con Webpack
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png'
})

// --- Interfaces y Tipos ---
type ClientStatus = 'active' | 'warning' | 'offline'

interface Client {
  id: number
  name: string
  lat: number
  lng: number
  status: ClientStatus
  ip_address?: string
  plan_name?: string
  last_seen?: string
  connection_type?: string
}

// --- Helper Functions ---

/**
 * Crea un icono de cliente personalizado con un color y animación según el estado.
 */
const createClientIcon = (status: ClientStatus) => {
  const statusColors: Record<ClientStatus, string> = {
    active: 'bg-green-500',
    warning: 'bg-yellow-500 animate-pulse',
    offline: 'bg-red-500'
  }
  const colorClass = statusColors[status] || 'bg-gray-500'

  return L.divIcon({
    html: `<span class="relative flex h-4 w-4">
             <span class="absolute inline-flex h-full w-full rounded-full ${colorClass} opacity-75"></span>
             <span class="relative inline-flex rounded-full h-4 w-4 ${colorClass} border-2 border-white"></span>
           </span>`,
    className: 'bg-transparent',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  })
}

const getStatusText = (status: ClientStatus) => {
  const texts: Record<ClientStatus, string> = {
    active: 'Activo',
    warning: 'Advertencia',
    offline: 'Desconectado'
  }
  return texts[status] || 'Desconocido'
}

// --- Componentes ---

const MapLegend: React.FC = () => (
  <div className="absolute bottom-4 right-4 bg-white/80 backdrop-blur-sm p-3 rounded-lg shadow-lg border border-gray-200 z-[1000]">
    <h4 className="font-bold text-sm mb-2">Leyenda</h4>
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        <div className="w-3 h-3 rounded-full bg-green-500"></div>
        <span className="text-sm">Activo</span>
      </div>
      <div className="flex items-center space-x-2">
        <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
        <span className="text-sm">Advertencia</span>
      </div>
      <div className="flex items-center space-x-2">
        <div className="w-3 h-3 rounded-full bg-red-500"></div>
        <span className="text-sm">Desconectado</span>
      </div>
    </div>
  </div>
)

interface Event {
  id: string
  timestamp: string
  type: 'info' | 'warning' | 'error' | 'success'
  message: string
}

const HistoryModal: React.FC<{
  clientName: string
  history: Event[]
  isLoading: boolean
  onClose: () => void
}> = ({ clientName, history, isLoading, onClose }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 bg-black/60 z-[3000] flex items-center justify-center p-4"
    onClick={onClose}
  >
    <motion.div
      initial={{ scale: 0.95, y: 20 }}
      animate={{ scale: 1, y: 0 }}
      exit={{ scale: 0.95, y: 20 }}
      className="bg-gray-50 rounded-2xl shadow-2xl w-full max-w-2xl h-[70vh] flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-5 border-b border-gray-200 flex justify-between items-center">
        <h3 className="text-xl font-bold text-gray-900">Historial de Eventos: {clientName}</h3>
        <button onClick={onClose} className="p-2 rounded-full text-gray-400 hover:bg-gray-200">
          <XMarkIcon className="w-6 h-6" />
        </button>
      </div>
      <div className="p-6 overflow-y-auto flex-grow">
        {isLoading ? (
          <div className="flex justify-center items-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="flow-root">
            <ul className="-mb-8">
              {history.map((event, eventIdx) => (
                <li key={event.id}>
                  <div className="relative pb-8">
                    {eventIdx !== history.length - 1 ? (
                      <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200" aria-hidden="true" />
                    ) : null}
                    <div className="relative flex space-x-3">
                      <div>
                        <span className="h-8 w-8 rounded-full flex items-center justify-center bg-gray-200">
                          <DocumentTextIcon className="h-5 w-5 text-gray-600" />
                        </span>
                      </div>
                      <div className="min-w-0 flex-1 pt-1.5 flex justify-between space-x-4">
                        <div>
                          <p className="text-sm text-gray-700">{event.message}</p>
                        </div>
                        <div className="text-right text-sm whitespace-nowrap text-gray-500">
                          <time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </motion.div>
  </motion.div>
)

const ClientDetailModal: React.FC<{
  client: Client | null
  onClose: () => void
  onReboot: (client: Client) => Promise<void>
  onShowHistory: (client: Client) => void;
}> = ({ client, onClose, onReboot, onShowHistory }) => {
  const [isRebooting, setIsRebooting] = useState(false)

  const handleRebootClick = async () => {
    if (!client) return
    setIsRebooting(true)
    await onReboot(client)
    setIsRebooting(false)
  }

  return (
    <AnimatePresence>
      {client && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-[2000] flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900">{client.name}</h3>
              <button
                onClick={onClose}
                className="p-2 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6">
              {/* Status */}
              <div className="flex items-center space-x-3">
                <span
                  className={`px-3 py-1 text-sm font-semibold rounded-full ${
                    client.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : client.status === 'warning'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {getStatusText(client.status)}
                </span>
                <p className="text-sm text-gray-500">Última vez visto: {client.last_seen || 'N/A'}</p>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-semibold text-gray-600 mb-2">Detalles de Red</h4>
                  <ul className="space-y-2">
                    <li className="flex items-center"><ComputerDesktopIcon className="w-4 h-4 mr-2 text-gray-400" /> IP: {client.ip_address || 'No asignada'}</li>
                    <li className="flex items-center"><SignalIcon className="w-4 h-4 mr-2 text-gray-400" /> Plan: {client.plan_name || 'Básico'}</li>
                    <li className="flex items-center"><ClockIcon className="w-4 h-4 mr-2 text-gray-400" /> Conexión: {client.connection_type || 'DHCP'}</li>
                  </ul>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-semibold text-gray-600 mb-2">Ubicación</h4>
                  <ul className="space-y-2">
                    <li className="flex items-center"><MapPinIcon className="w-4 h-4 mr-2 text-gray-400" /> Lat: {client.lat.toFixed(5)}</li>
                    <li className="flex items-center"><MapPinIcon className="w-4 h-4 mr-2 text-gray-400" /> Lng: {client.lng.toFixed(5)}</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end space-x-3">
              <button
                onClick={() => client && onShowHistory(client)}
                className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <DocumentTextIcon className="w-4 h-4" />
                <span>Ver Historial</span>
              </button>
              <button
                onClick={handleRebootClick}
                disabled={isRebooting || client.status === 'offline'}
                className="flex items-center justify-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
              >
                {isRebooting ? (
                  <>
                    <ArrowPathIcon className="w-4 h-4 animate-spin" />
                    <span>Reiniciando...</span>
                  </>
                ) : (
                  <>
                    <ArrowPathIcon className="w-4 h-4" />
                    <span>Reiniciar Equipo</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const NetworkMap: React.FC = () => {
  const mapRef = useRef<L.Map | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [historyClient, setHistoryClient] = useState<Client | null>(null)
  const [historyEvents, setHistoryEvents] = useState<Event[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)

  // Carga de datos desde la API real
  useEffect(() => {
    const fetchClients = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const data = await apiClient.get('/clients/map-data') as Client[]
        setClients(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ocurrio un error desconocido.')
        console.error(err)
        setClients([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchClients()
  }, [])

  // Ajustar el mapa para mostrar todos los clientes cuando los datos cambien
  useEffect(() => {
    if (mapRef.current && clients.length > 0) {
      const bounds = L.latLngBounds(clients.map(c => [c.lat, c.lng]))
      mapRef.current.fitBounds(bounds, { padding: [50, 50] })
    }
  }, [clients])

  const handleRebootClient = async (client: Client) => {
    const toastId = toast.loading('Iniciando reinicio del equipo...')
    try {
      await apiClient.post(`/clients/${client.id}/reboot-cpe`)
      toast.success(`El equipo de ${client.name} se esta reiniciando.`, { id: toastId })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido.', { id: toastId })
    }
  }

  const handleShowHistory = async (client: Client) => {
    setHistoryClient(client)
    setIsHistoryLoading(true)
    try {
      const data = await apiClient.get(`/clients/${client.id}/history`) as Event[]
      setHistoryEvents(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido.')
      setHistoryEvents([])
    } finally {
      setIsHistoryLoading(false)
    }
  }

  const closeHistoryModal = () => setHistoryClient(null)

  return (
    <div className="h-96 rounded-lg overflow-hidden border border-gray-200 relative">
      {error && (
        <div className="absolute inset-0 bg-red-100/80 flex items-center justify-center z-[1001]">
           <p className="text-red-700 font-semibold">{error}</p>
        </div>
      )}
      {isLoading && (
        <div className="absolute inset-0 bg-gray-100/50 flex items-center justify-center z-[1001]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Cargando mapa de red...</p>
          </div>
        </div>
      )}
      <ClientDetailModal
        client={selectedClient}
        onClose={() => setSelectedClient(null)}
        onReboot={handleRebootClient}
        onShowHistory={handleShowHistory}
      />
      <AnimatePresence>
        {historyClient && (
          <HistoryModal
            clientName={historyClient.name}
            history={historyEvents}
            isLoading={isHistoryLoading}
            onClose={closeHistoryModal}
          />
        )}
      </AnimatePresence>
      <MapContainer
        center={[19.4326, -99.1332]}
        zoom={14}
        style={{ height: '100%', width: '100%' }}
        ref={mapRef}
        className={isLoading || error ? 'invisible' : ''}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {clients.map((client) => (
          <Marker key={client.id} position={[client.lat, client.lng]} icon={createClientIcon(client.status)}>
            <Popup>
              <div className="p-1">
                <div className="font-bold text-gray-800">{client.name}</div>
                <p className="text-sm text-gray-600">Estado: {getStatusText(client.status)}</p>
                <button
                  onClick={(e) => {
                    e.stopPropagation(); // Evita que el popup se cierre
                    setSelectedClient(client);
                  }}
                  className="mt-2 text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 w-full text-center"
                >
                  Ver detalles
                </button>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <MapLegend />
    </div>
  )
}

export default NetworkMap


