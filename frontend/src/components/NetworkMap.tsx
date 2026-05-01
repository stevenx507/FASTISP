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
  DocumentTextIcon,
} from '@heroicons/react/24/solid'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import toast from 'react-hot-toast'
import { apiClient } from '../lib/apiClient'
import config from '../lib/config'

declare global {
  interface Window {
    google?: any
  }
}

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

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

interface Event {
  id: string
  timestamp: string
  type: 'info' | 'warning' | 'error' | 'success'
  message: string
}

const GOOGLE_MAPS_SCRIPT_ID = 'fastisp-google-maps-script'
const DEFAULT_CENTER: [number, number] = [19.4326, -99.1332]

let googleMapsPromise: Promise<any> | null = null

const createClientIcon = (status: ClientStatus) => {
  const statusColors: Record<ClientStatus, string> = {
    active: 'bg-green-500',
    warning: 'bg-yellow-500 animate-pulse',
    offline: 'bg-red-500',
  }
  const colorClass = statusColors[status] || 'bg-gray-500'

  return L.divIcon({
    html: `<span class="relative flex h-4 w-4">
             <span class="absolute inline-flex h-full w-full rounded-full ${colorClass} opacity-75"></span>
             <span class="relative inline-flex rounded-full h-4 w-4 ${colorClass} border-2 border-white"></span>
           </span>`,
    className: 'bg-transparent',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

const getStatusText = (status: ClientStatus) => {
  const texts: Record<ClientStatus, string> = {
    active: 'Activo',
    warning: 'Advertencia',
    offline: 'Desconectado',
  }
  return texts[status] || 'Desconocido'
}

const getStatusColor = (status: ClientStatus) => {
  const colors: Record<ClientStatus, string> = {
    active: '#22c55e',
    warning: '#eab308',
    offline: '#ef4444',
  }
  return colors[status] || '#6b7280'
}

const loadGoogleMapsApi = (apiKey: string) => {
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps API key no configurada'))
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps)
  }

  if (googleMapsPromise) {
    return googleMapsPromise
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.google?.maps))
      existingScript.addEventListener('error', () => {
        googleMapsPromise = null
        reject(new Error('No se pudo cargar Google Maps'))
      })
      return
    }

    const script = document.createElement('script')
    script.id = GOOGLE_MAPS_SCRIPT_ID
    script.async = true
    script.defer = true
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`
    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google.maps)
      } else {
        googleMapsPromise = null
        reject(new Error('Google Maps no quedo disponible en window'))
      }
    }
    script.onerror = () => {
      googleMapsPromise = null
      reject(new Error('No se pudo cargar Google Maps'))
    }
    document.head.appendChild(script)
  })

  return googleMapsPromise
}

const MapLegend: React.FC<{ provider: 'google' | 'leaflet' }> = ({ provider }) => (
  <>
    <div className="absolute left-4 top-4 z-[1000] rounded-full border border-gray-200 bg-white/90 px-3 py-1 text-xs font-semibold text-slate-600 shadow">
      {provider === 'google' ? 'Google Maps' : 'OpenStreetMap'}
    </div>
    <div className="absolute bottom-4 right-4 z-[1000] rounded-lg border border-gray-200 bg-white/80 p-3 shadow-lg backdrop-blur-sm">
      <h4 className="mb-2 text-sm font-bold">Leyenda</h4>
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <div className="h-3 w-3 rounded-full bg-green-500"></div>
          <span className="text-sm">Activo</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="h-3 w-3 rounded-full bg-yellow-500"></div>
          <span className="text-sm">Advertencia</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="h-3 w-3 rounded-full bg-red-500"></div>
          <span className="text-sm">Desconectado</span>
        </div>
      </div>
    </div>
  </>
)

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
    className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 p-4"
    onClick={onClose}
  >
    <motion.div
      initial={{ scale: 0.95, y: 20 }}
      animate={{ scale: 1, y: 0 }}
      exit={{ scale: 0.95, y: 20 }}
      className="flex h-[70vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-gray-200 p-5">
        <h3 className="text-xl font-bold text-white">Historial de Eventos: {clientName}</h3>
        <button onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-white/15">
          <XMarkIcon className="h-6 w-6" />
        </button>
      </div>
      <div className="flex-grow overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="flow-root">
            <ul className="-mb-8">
              {history.map((event, eventIndex) => (
                <li key={event.id}>
                  <div className="relative pb-8">
                    {eventIndex !== history.length - 1 ? (
                      <span className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-white/15" aria-hidden="true" />
                    ) : null}
                    <div className="relative flex space-x-3">
                      <div>
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15">
                          <DocumentTextIcon className="h-5 w-5 text-slate-500" />
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                        <div>
                          <p className="text-sm text-slate-600">{event.message}</p>
                        </div>
                        <div className="whitespace-nowrap text-right text-sm text-slate-500">
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
  onShowHistory: (client: Client) => void
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
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white backdrop-blur-md shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-5">
              <h3 className="text-xl font-bold text-white">{client.name}</h3>
              <button onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-white/10 hover:text-slate-500">
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="space-y-6 p-6">
              <div className="flex items-center space-x-3">
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    client.status === 'active'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : client.status === 'warning'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-rose-500/20 text-rose-300'
                  }`}
                >
                  {getStatusText(client.status)}
                </span>
                <p className="text-sm text-slate-500">Ultima vez visto: {client.last_seen || 'N/A'}</p>
              </div>

              <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                <div className="rounded-lg bg-white p-4">
                  <h4 className="mb-2 font-semibold text-slate-500">Detalles de Red</h4>
                  <ul className="space-y-2">
                    <li className="flex items-center">
                      <ComputerDesktopIcon className="mr-2 h-4 w-4 text-slate-500" />
                      IP: {client.ip_address || 'No asignada'}
                    </li>
                    <li className="flex items-center">
                      <SignalIcon className="mr-2 h-4 w-4 text-slate-500" />
                      Plan: {client.plan_name || 'Basico'}
                    </li>
                    <li className="flex items-center">
                      <ClockIcon className="mr-2 h-4 w-4 text-slate-500" />
                      Conexion: {client.connection_type || 'DHCP'}
                    </li>
                  </ul>
                </div>
                <div className="rounded-lg bg-white p-4">
                  <h4 className="mb-2 font-semibold text-slate-500">Ubicacion</h4>
                  <ul className="space-y-2">
                    <li className="flex items-center">
                      <MapPinIcon className="mr-2 h-4 w-4 text-slate-500" />
                      Lat: {client.lat.toFixed(5)}
                    </li>
                    <li className="flex items-center">
                      <MapPinIcon className="mr-2 h-4 w-4 text-slate-500" />
                      Lng: {client.lng.toFixed(5)}
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 border-t border-gray-200 bg-white px-6 py-4">
              <button
                onClick={() => client && onShowHistory(client)}
                className="flex items-center space-x-2 rounded-lg border border-white/20 bg-white backdrop-blur-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white"
              >
                <DocumentTextIcon className="h-4 w-4" />
                <span>Ver Historial</span>
              </button>
              <button
                onClick={handleRebootClick}
                disabled={isRebooting || client.status === 'offline'}
                className="flex items-center justify-center space-x-2 rounded-lg border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {isRebooting ? (
                  <>
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                    <span>Reiniciando...</span>
                  </>
                ) : (
                  <>
                    <ArrowPathIcon className="h-4 w-4" />
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
  const leafletMapRef = useRef<L.Map | null>(null)
  const googleMapContainerRef = useRef<HTMLDivElement | null>(null)
  const googleMapRef = useRef<any>(null)
  const googleMarkersRef = useRef<any[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [historyClient, setHistoryClient] = useState<Client | null>(null)
  const [historyEvents, setHistoryEvents] = useState<Event[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [isGoogleMapsReady, setIsGoogleMapsReady] = useState(false)

  const googleMapsApiKey = String(config.GOOGLE_MAPS_API_KEY || '').trim()
  const [mapProvider, setMapProvider] = useState<'google' | 'leaflet'>(googleMapsApiKey ? 'google' : 'leaflet')

  useEffect(() => {
    const fetchClients = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const data = (await apiClient.get('/clients/map-data')) as Client[]
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

  useEffect(() => {
    if (mapProvider !== 'google') {
      setIsGoogleMapsReady(true)
      return
    }

    let cancelled = false
    setIsGoogleMapsReady(false)

    loadGoogleMapsApi(googleMapsApiKey)
      .then(() => {
        if (!cancelled) {
          setIsGoogleMapsReady(true)
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.error(err)
        toast.error('No se pudo cargar Google Maps. Se usara OpenStreetMap como respaldo.')
        setMapProvider('leaflet')
        setIsGoogleMapsReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [googleMapsApiKey, mapProvider])

  useEffect(() => {
    if (mapProvider !== 'google' || !isGoogleMapsReady || !googleMapContainerRef.current || !window.google?.maps) {
      return
    }

    if (!googleMapRef.current) {
      googleMapRef.current = new window.google.maps.Map(googleMapContainerRef.current, {
        center: { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] },
        zoom: 14,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
      })
    }
  }, [isGoogleMapsReady, mapProvider])

  useEffect(() => {
    if (leafletMapRef.current && mapProvider === 'leaflet' && clients.length > 0) {
      const bounds = L.latLngBounds(clients.map((client) => [client.lat, client.lng]))
      leafletMapRef.current.fitBounds(bounds, { padding: [50, 50] })
    }
  }, [clients, mapProvider])

  useEffect(() => {
    if (mapProvider !== 'google' || !googleMapRef.current || !window.google?.maps) return

    googleMarkersRef.current.forEach((marker) => marker.setMap(null))
    googleMarkersRef.current = []

    if (!clients.length) {
      googleMapRef.current.setCenter({ lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] })
      googleMapRef.current.setZoom(14)
      return
    }

    const bounds = new window.google.maps.LatLngBounds()
    googleMarkersRef.current = clients.map((client) => {
      const marker = new window.google.maps.Marker({
        map: googleMapRef.current,
        position: { lat: client.lat, lng: client.lng },
        title: `${client.name} - ${getStatusText(client.status)}`,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: getStatusColor(client.status),
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      })

      marker.addListener('click', () => {
        setSelectedClient(client)
      })

      bounds.extend(marker.getPosition())
      return marker
    })

    if (clients.length === 1) {
      googleMapRef.current.setCenter({ lat: clients[0].lat, lng: clients[0].lng })
      googleMapRef.current.setZoom(16)
    } else {
      googleMapRef.current.fitBounds(bounds, 60)
    }
  }, [clients, mapProvider])

  useEffect(() => {
    return () => {
      googleMarkersRef.current.forEach((marker) => marker.setMap(null))
      googleMarkersRef.current = []
    }
  }, [])

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
      const data = (await apiClient.get(`/clients/${client.id}/history`)) as Event[]
      setHistoryEvents(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido.')
      setHistoryEvents([])
    } finally {
      setIsHistoryLoading(false)
    }
  }

  const closeHistoryModal = () => setHistoryClient(null)
  const isMapBooting = mapProvider === 'google' && !isGoogleMapsReady

  return (
    <div className="relative h-96 overflow-hidden rounded-lg border border-gray-200">
      {error && (
        <div className="absolute inset-0 z-[1001] flex items-center justify-center bg-rose-500/20/80">
          <p className="font-semibold text-rose-400">{error}</p>
        </div>
      )}
      {(isLoading || isMapBooting) && (
        <div className="absolute inset-0 z-[1001] flex items-center justify-center bg-white/10/50">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
            <p className="mt-2 text-slate-500">{isMapBooting ? 'Cargando Google Maps...' : 'Cargando mapa de red...'}</p>
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

      {mapProvider === 'google' ? (
        <div
          ref={googleMapContainerRef}
          style={{ height: '100%', width: '100%' }}
          className={isLoading || error || isMapBooting ? 'invisible' : ''}
        />
      ) : (
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={14}
          style={{ height: '100%', width: '100%' }}
          ref={leafletMapRef}
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
                  <div className="font-bold text-slate-700">{client.name}</div>
                  <p className="text-sm text-slate-500">Estado: {getStatusText(client.status)}</p>
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      setSelectedClient(client)
                    }}
                    className="mt-2 w-full rounded bg-blue-500/20 px-2 py-1 text-center text-xs text-blue-300 hover:bg-blue-200"
                  >
                    Ver detalles
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      )}

      <MapLegend provider={mapProvider} />
    </div>
  )
}

export default NetworkMap
