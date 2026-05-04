/**
 * NetworkNodesMap – Mapa de infraestructura de red
 * Muestra NAPs, mufas, splitters, antenas y clientes con estado online/offline.
 * Verde = online, Rojo = offline, Iconos diferenciados por tipo de nodo.
 */
import { useEffect, useState, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { apiClient } from '../../lib/apiClient'

// ── Tipos ──────────────────────────────────────────────────────────────────

interface NetworkNode {
 id: number
 name: string
 node_type: string
 technology: string
 latitude: number
 longitude: number
 address: string
 zone: string
 capacity: number | null
 used_ports: number
 status: string
 parent_node_id: number | null
 router_id: number | null
 notes: string
}

interface ClientMapEntry {
 id: number
 name: string
 ip_address: string
 lat: number
 lng: number
 status: 'online' | 'offline'
 access_technology: string
 nap_id: number | null
 plan_name: string | null
}

interface MapData {
 nodes: NetworkNode[]
 clients: ClientMapEntry[]
 active_ips_count: number
}

// ── Iconos SVG inline ──────────────────────────────────────────────────────

const nodeIcons: Record<string, string> = {
 nap: '🔵',
 mufa: '🟣',
 splitter: '🟡',
 antenna: '📡',
 olt: '🟠',
 router: '🔷',
 caja: '⬛',
 poste: '🟤',
 otro: '⚪',
}

function makeIcon(emoji: string, size = 28) {
 return L.divIcon({
 html: `<div style="font-size:${size}px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">${emoji}</div>`,
 className: '',
 iconSize: [size, size],
 iconAnchor: [size / 2, size / 2],
 popupAnchor: [0, -size / 2],
 })
}

const clientOnlineIcon = makeIcon('🟢', 22)
const clientOfflineIcon = makeIcon('🔴', 22)

// ── Componente de control de zoom ──────────────────────────────────────────

function FitBounds({ nodes, clients }: { nodes: NetworkNode[]; clients: ClientMapEntry[] }) {
 const map = useMap()
 useEffect(() => {
 const points: [number, number][] = [
 ...nodes.filter(n => n.latitude && n.longitude).map(n => [n.latitude, n.longitude] as [number, number]),
 ...clients.filter(c => c.lat && c.lng).map(c => [c.lat, c.lng] as [number, number]),
 ]
 if (points.length > 0) {
 map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 })
 }
 }, [nodes, clients, map])
 return null
}

// ── Componente principal ───────────────────────────────────────────────────

export default function NetworkNodesMap() {
 const [data, setData] = useState<MapData | null>(null)
 const [loading, setLoading] = useState(true)
 const [error, setError] = useState<string | null>(null)
 const [filter, setFilter] = useState<{ nodeType: string; technology: string; showOffline: boolean }>({
 nodeType: 'all',
 technology: 'all',
 showOffline: true,
 })
 const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null)
 const [showNodeForm, setShowNodeForm] = useState(false)
 const [newNode, setNewNode] = useState({ name: '', node_type: 'nap', technology: 'fiber', latitude: '', longitude: '', zone: '', capacity: '', notes: '' })
 const [saving, setSaving] = useState(false)

 const load = useCallback(async () => {
 setLoading(true)
 setError(null)
 try {
 const res = await apiClient.request('/api/network/nodes/map')
 const data = await res.json()
 if (!res.ok) throw new Error(data.error || 'Error cargando mapa')
 setData(data)
 } catch (e: any) {
 setError(e?.message || 'Error cargando mapa')
 } finally {
 setLoading(false)
 }
 }, [])

 useEffect(() => { load() }, [load])

 const handleCreateNode = async () => {
 if (!newNode.name || !newNode.latitude || !newNode.longitude) return
 setSaving(true)
 try {
 const res = await apiClient.request('/api/network/nodes', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 ...newNode,
 latitude: parseFloat(newNode.latitude),
 longitude: parseFloat(newNode.longitude),
 capacity: newNode.capacity ? parseInt(newNode.capacity) : null,
 }),
 })
 const d = await res.json()
 if (!res.ok) { alert(d.error || 'Error creando nodo'); return }
 setShowNodeForm(false)
 setNewNode({ name: '', node_type: 'nap', technology: 'fiber', latitude: '', longitude: '', zone: '', capacity: '', notes: '' })
 load()
 } catch (e: any) {
 alert(e?.message || 'Error creando nodo')
 } finally {
 setSaving(false)
 }
 }

 const filteredNodes = (data?.nodes || []).filter(n => {
 if (filter.nodeType !== 'all' && n.node_type !== filter.nodeType) return false
 if (filter.technology !== 'all' && n.technology !== filter.technology) return false
 return true
 })

 const filteredClients = (data?.clients || []).filter(c => {
 if (!filter.showOffline && c.status === 'offline') return false
 return true
 })

 // Líneas de conexión nodo padre → hijo
 const connections: [number, number][][] = []
 filteredNodes.forEach(node => {
 if (node.parent_node_id) {
 const parent = filteredNodes.find(n => n.id === node.parent_node_id)
 if (parent && parent.latitude && parent.longitude && node.latitude && node.longitude) {
 connections.push([[parent.latitude, parent.longitude], [node.latitude, node.longitude]])
 }
 }
 })

 // Líneas cliente → NAP
 const clientConnections: [number, number][][] = []
 filteredClients.forEach(c => {
 if (c.nap_id) {
 const nap = filteredNodes.find(n => n.id === c.nap_id)
 if (nap && nap.latitude && nap.longitude && c.lat && c.lng) {
 clientConnections.push([[nap.latitude, nap.longitude], [c.lat, c.lng]])
 }
 }
 })

 const onlineCount = (data?.clients || []).filter(c => c.status === 'online').length
 const offlineCount = (data?.clients || []).filter(c => c.status === 'offline').length

 return (
 <div className="flex flex-col gap-4">
 {/* Header */}
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <h2 className="text-xl font-bold text-slate-800">🗺️ Mapa de Red</h2>
 <p className="text-sm text-slate-500">Nodos de infraestructura y clientes en tiempo real</p>
 </div>
 <div className="flex gap-2 flex-wrap">
 <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">🟢 {onlineCount} online</span>
 <span className="px-2 py-1 rounded-full bg-rose-100 text-rose-800 text-xs font-semibold">🔴 {offlineCount} offline</span>
 <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-800 text-blue-800 text-xs font-semibold">🔵 {filteredNodes.length} nodos</span>
 <button onClick={() => setShowNodeForm(true)} className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">+ Nodo</button>
 <button onClick={load} className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-slate-700 rounded-lg text-sm hover:bg-gray-300">↻ Actualizar</button>
 </div>
 </div>

 {/* Filtros */}
 <div className="flex flex-wrap gap-3 bg-white shadow-sm p-3 rounded-xl shadow-sm border border-gray-200">
 <select aria-label="Filtrar por tipo de nodo" value={filter.nodeType} onChange={e => setFilter(f => ({ ...f, nodeType: e.target.value }))}
 className="text-sm border rounded-lg px-2 py-1">
 <option value="all">Todos los tipos</option>
 {['nap','mufa','splitter','antenna','olt','router','caja','poste','otro'].map(t => (
 <option key={t} value={t}>{nodeIcons[t]} {t.toUpperCase()}</option>
 ))}
 </select>
 <select aria-label="Filtrar por tecnología" value={filter.technology} onChange={e => setFilter(f => ({ ...f, technology: e.target.value }))}
 className="text-sm border rounded-lg px-2 py-1">
 <option value="all">Toda tecnología</option>
 <option value="fiber">Fibra óptica</option>
 <option value="wireless">Inalámbrico</option>
 <option value="coax">Coaxial</option>
 <option value="copper">Cobre</option>
 </select>
 <label className="flex items-center gap-2 text-sm text-slate-500 cursor-pointer">
 <input type="checkbox" checked={filter.showOffline} onChange={e => setFilter(f => ({ ...f, showOffline: e.target.checked }))} />
 Mostrar clientes offline
 </label>
 </div>

 {/* Mapa */}
 {loading ? (
 <div className="h-96 flex items-center justify-center bg-white rounded-xl">
 <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
 </div>
 ) : error ? (
 <div className="h-96 flex items-center justify-center bg-rose-500/10 rounded-xl text-red-600">{error}</div>
 ) : (
 <div className="rounded-xl overflow-hidden shadow-md border border-gray-100" style={{ height: 520 }}>
 <MapContainer center={[-4.0, -79.2]} zoom={12} style={{ height: '100%', width: '100%' }}>
 <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
 attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
 {data && <FitBounds nodes={filteredNodes} clients={filteredClients} />}

 {/* Líneas de conexión entre nodos */}
 {connections.map((pos, i) => (
 <Polyline key={`conn-${i}`} positions={pos} color="#6366f1" weight={2} opacity={0.6} dashArray="6 4" />
 ))}
 {/* Líneas cliente → NAP */}
 {clientConnections.map((pos, i) => (
 <Polyline key={`cconn-${i}`} positions={pos} color="#10b981" weight={1} opacity={0.4} dashArray="3 5" />
 ))}

 {/* Nodos de infraestructura */}
 {filteredNodes.map(node => (
 <Marker key={`node-${node.id}`}
 position={[node.latitude, node.longitude]}
 icon={makeIcon(nodeIcons[node.node_type] || '⚪', 30)}
 eventHandlers={{ click: () => setSelectedNode(node) }}>
 <Popup>
 <div className="min-w-[180px]">
 <p className="font-bold text-base">{nodeIcons[node.node_type]} {node.name}</p>
 <p className="text-xs text-slate-500 capitalize">{node.node_type} · {node.technology}</p>
 {node.zone && <p className="text-xs">📍 {node.zone}</p>}
 {node.address && <p className="text-xs text-slate-500">{node.address}</p>}
 {node.capacity != null && (
 <p className="text-xs">Puertos: {node.used_ports}/{node.capacity}</p>
 )}
 <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
 node.status === 'active' ? 'bg-emerald-100 text-emerald-800' :
 node.status === 'fault' ? 'bg-rose-100 text-rose-800' :
 node.status === 'maintenance' ? 'bg-amber-100 text-amber-800' :
 'bg-gray-100 text-slate-500'}`}>{node.status}</span>
 {node.notes && <p className="text-xs mt-1 text-slate-500 italic">{node.notes}</p>}
 </div>
 </Popup>
 </Marker>
 ))}

 {/* Clientes */}
 {filteredClients.map(c => (
 <Marker key={`client-${c.id}`}
 position={[c.lat, c.lng]}
 icon={c.status === 'online' ? clientOnlineIcon : clientOfflineIcon}>
 <Popup>
 <div className="min-w-[160px]">
 <p className="font-bold">{c.name}</p>
 <p className="text-xs text-slate-500">{c.ip_address}</p>
 {c.plan_name && <p className="text-xs">📶 {c.plan_name}</p>}
 <p className="text-xs capitalize">🔌 {c.access_technology}</p>
 <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
 c.status === 'online' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
 {c.status === 'online' ? '🟢 En línea' : '🔴 Offline'}
 </span>
 </div>
 </Popup>
 </Marker>
 ))}
 </MapContainer>
 </div>
 )}

 {/* Leyenda */}
 <div className="flex flex-wrap gap-3 text-xs text-slate-500">
 {Object.entries(nodeIcons).map(([type, icon]) => (
 <span key={type}>{icon} {type.toUpperCase()}</span>
 ))}
 <span>🟢 Cliente online</span>
 <span>🔴 Cliente offline</span>
 </div>

 {/* Modal: Crear nodo */}
 {showNodeForm && (
 <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
 <div className="bg-white shadow-sm rounded-2xl shadow-2xl w-full max-w-md p-6">
 <h3 className="text-lg font-bold mb-4 text-slate-800">➕ Nuevo Nodo de Red</h3>
 <div className="flex flex-col gap-3">
 <input placeholder="Nombre *" value={newNode.name} onChange={e => setNewNode(n => ({ ...n, name: e.target.value }))}
 className="border rounded-lg px-3 py-2 text-sm" />
 <div className="grid grid-cols-2 gap-3">
 <select aria-label="Tipo de nodo" value={newNode.node_type} onChange={e => setNewNode(n => ({ ...n, node_type: e.target.value }))}
 className="border rounded-lg px-3 py-2 text-sm">
 {['nap','mufa','splitter','antenna','olt','router','caja','poste','otro'].map(t => (
 <option key={t} value={t}>{t.toUpperCase()}</option>
 ))}
 </select>
 <select aria-label="Tecnología" value={newNode.technology} onChange={e => setNewNode(n => ({ ...n, technology: e.target.value }))}
 className="border rounded-lg px-3 py-2 text-sm">
 <option value="fiber">Fibra</option>
 <option value="wireless">Inalámbrico</option>
 <option value="coax">Coaxial</option>
 <option value="copper">Cobre</option>
 </select>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <input placeholder="Latitud *" value={newNode.latitude} onChange={e => setNewNode(n => ({ ...n, latitude: e.target.value }))}
 className="border rounded-lg px-3 py-2 text-sm" />
 <input placeholder="Longitud *" value={newNode.longitude} onChange={e => setNewNode(n => ({ ...n, longitude: e.target.value }))}
 className="border rounded-lg px-3 py-2 text-sm" />
 </div>
 <input placeholder="Zona / Sector" value={newNode.zone} onChange={e => setNewNode(n => ({ ...n, zone: e.target.value }))}
 className="border rounded-lg px-3 py-2 text-sm" />
 <input placeholder="Capacidad (puertos)" type="number" value={newNode.capacity} onChange={e => setNewNode(n => ({ ...n, capacity: e.target.value }))}
 className="border rounded-lg px-3 py-2 text-sm" />
 <textarea placeholder="Notas" value={newNode.notes} onChange={e => setNewNode(n => ({ ...n, notes: e.target.value }))}
 rows={2} className="border rounded-lg px-3 py-2 text-sm" />
 </div>
 <div className="flex gap-3 mt-5">
 <button onClick={handleCreateNode} disabled={saving}
 className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
 {saving ? 'Guardando...' : 'Crear Nodo'}
 </button>
 <button onClick={() => setShowNodeForm(false)}
 className="flex-1 bg-gray-100 hover:bg-gray-200 text-slate-700 rounded-lg py-2 text-sm hover:bg-gray-300">
 Cancelar
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 )
}
