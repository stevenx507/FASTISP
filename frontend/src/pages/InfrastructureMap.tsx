import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MapContainer, 
  TileLayer, 
  Marker, 
  Popup, 
  Polyline,
  useMapEvents,
  useMap
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  MapPinIcon, 
  PlusIcon, 
  TrashIcon, 
  CloudArrowUpIcon,
  AdjustmentsHorizontalIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';
import { apiClient } from '../lib/apiClient';
import toast from 'react-hot-toast';

// Leaflet Icon Fix
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface NapBox {
  id?: number;
  name: string;
  latitude: number;
  longitude: number;
  capacity: number;
  used_ports: number;
  status: string;
}

interface FiberLine {
  id?: number;
  name: string;
  path: string; // JSON GeoJSON
  color: string;
  status: string;
}

const InfrastructureMap: React.FC = () => {
  const [naps, setNaps] = useState<NapBox[]>([]);
  const [lines, setLines] = useState<FiberLine[]>([]);
  const [isAddingNap, setIsAddingNap] = useState(false);
  const [isAddingLine, setIsAddingLine] = useState(false);
  const [newLinePoints, setNewLinePoints] = useState<[number, number][]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [napsRes, linesRes]: any = await Promise.all([
        apiClient.get('/admin/gis/naps'),
        apiClient.get('/admin/gis/lines')
      ]);
      setNaps(napsRes.items || []);
      setLines(linesRes.items || []);
    } catch (error) {
      toast.error('Error al cargar infraestructura GIS');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMapClick = async (e: L.LeafletMouseEvent) => {
    if (isAddingNap) {
      const name = prompt('Nombre de la Caja NAP:');
      if (!name) return;
      
      try {
        await apiClient.post('/admin/gis/naps', {
          name,
          latitude: e.latlng.lat,
          longitude: e.latlng.lng,
          capacity: 16
        });
        toast.success('Caja NAP creada');
        setIsAddingNap(false);
        fetchData();
      } catch (error) {
        toast.error('Error al crear NAP');
      }
    } else if (isAddingLine) {
      setNewLinePoints([...newLinePoints, [e.latlng.lat, e.latlng.lng]]);
    }
  };

  const saveLine = async () => {
    if (newLinePoints.length < 2) return;
    const name = prompt('Nombre de la Línea de Fibra:');
    if (!name) return;

    try {
      await apiClient.post('/admin/gis/lines', {
        name,
        path: JSON.stringify(newLinePoints),
        color: '#3b82f6'
      });
      toast.success('Línea de fibra guardada');
      setNewLinePoints([]);
      setIsAddingLine(false);
      fetchData();
    } catch (error) {
      toast.error('Error al guardar línea');
    }
  };

  const MapEvents = () => {
    useMapEvents({
      click: handleMapClick,
    });
    return null;
  };

  const napIcon = L.divIcon({
    html: `<div class="p-1 bg-blue-600 rounded-lg shadow-lg border-2 border-white">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>`,
    className: 'bg-transparent',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

  return (
    <div className="relative h-[calc(100vh-100px)] w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
      <MapContainer 
        center={[-12.0464, -77.0428]} 
        zoom={13} 
        style={{ height: '100%', width: '100%' }}
        className="z-0"
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <MapEvents />

        {/* NAPs */}
        {naps.map(nap => (
          <Marker 
            key={nap.id} 
            position={[nap.latitude, nap.longitude]} 
            icon={napIcon}
          >
            <Popup className="premium-popup">
              <div className="p-2 min-w-[200px]">
                <h3 className="font-bold text-slate-800 text-lg">{nap.name}</h3>
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-slate-500">Puertos: {nap.used_ports}/{nap.capacity}</p>
                  <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-blue-600 h-full" 
                      style={{ width: `${(nap.used_ports/nap.capacity)*100}%` }}
                    />
                  </div>
                  <p className="text-xs font-mono text-slate-500 mt-2">
                    {nap.latitude.toFixed(6)}, {nap.longitude.toFixed(6)}
                  </p>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Lines */}
        {lines.map(line => {
          try {
            const points = JSON.parse(line.path);
            return (
              <Polyline 
                key={line.id} 
                positions={points} 
                pathOptions={{ color: line.color, weight: 4, opacity: 0.8 }}
              />
            );
          } catch (e) {
            return null;
          }
        })}

        {/* Draw Line Preview */}
        {isAddingLine && (
          <Polyline 
            positions={newLinePoints} 
            pathOptions={{ color: '#fbbf24', weight: 4, dashArray: '10, 10' }} 
          />
        )}
      </MapContainer>

      {/* Floating Controls */}
      <div className="absolute top-6 left-6 z-[1000] flex flex-col space-y-4">
        <motion.div 
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="bg-white/90 backdrop-blur-xl border border-gray-200 p-4 rounded-2xl shadow-2xl w-80"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-white flex items-center">
              <AdjustmentsHorizontalIcon className="w-5 h-5 mr-2 text-blue-400" />
              Gestión GIS
            </h2>
            <div className="flex space-x-2">
               <button 
                onClick={() => { setIsAddingNap(!isAddingNap); setIsAddingLine(false); }}
                className={`p-2 rounded-lg transition-all ${isAddingNap ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-white/10'}`}
                title="Añadir NAP"
              >
                <MapPinIcon className="w-5 h-5" />
              </button>
              <button 
                onClick={() => { setIsAddingLine(!isAddingLine); setIsAddingNap(false); setNewLinePoints([]); }}
                className={`p-2 rounded-lg transition-all ${isAddingLine ? 'bg-amber-600 text-white' : 'bg-white text-slate-500 hover:bg-white/10'}`}
                title="Trazar Fibra"
              >
                <PlusIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                type="text" 
                placeholder="Buscar infraestructura..."
                className="w-full bg-white border border-gray-200 rounded-xl py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider px-2">Cajas NAP ({naps.length})</div>
              {naps.map(nap => (
                <div key={nap.id} className="group flex items-center justify-between p-2 rounded-xl hover:bg-white transition-colors cursor-pointer border border-transparent hover:border-white/5">
                  <div className="flex items-center space-x-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                    <span className="text-sm text-slate-600 font-medium">{nap.name}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 group-hover:text-slate-600 transition-colors">
                    {nap.used_ports}/{nap.capacity} ports
                  </div>
                </div>
              ))}
            </div>
          </div>

          {isAddingLine && newLinePoints.length > 0 && (
            <motion.button
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={saveLine}
              className="mt-6 w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600 text-white rounded-xl font-bold text-sm shadow-xl shadow-amber-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center"
            >
              <CloudArrowUpIcon className="w-5 h-5 mr-2" />
              Guardar Trazado ({newLinePoints.length} pts)
            </motion.button>
          )}
        </motion.div>
      </div>

      {/* Legend & Stats Overlay */}
      <div className="absolute bottom-6 right-6 z-[1000] flex space-x-4">
        <div className="bg-white/90 backdrop-blur-xl border border-gray-200 p-4 rounded-2xl shadow-2xl flex space-x-6">
          <div className="flex flex-col">
            <span className="text-xs text-slate-500">Cobertura Total</span>
            <span className="text-xl font-bold text-white">4.2 km</span>
          </div>
          <div className="w-px h-10 bg-white/10" />
          <div className="flex flex-col">
            <span className="text-xs text-slate-500">Puertos Libres</span>
            <span className="text-xl font-bold text-emerald-400">142</span>
          </div>
        </div>
      </div>

      {/* Helper Toast when adding */}
      <AnimatePresence>
        {(isAddingNap || isAddingLine) && (
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[2000] bg-blue-600 text-white px-6 py-3 rounded-full shadow-2xl font-medium flex items-center"
          >
            <div className="w-2 h-2 rounded-full bg-white animate-ping mr-3" />
            {isAddingNap ? 'Haz clic en el mapa para colocar una Caja NAP' : 'Haz clic en el mapa para marcar los puntos de la fibra'}
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .premium-popup .leaflet-popup-content-wrapper {
          background: rgba(15, 23, 42, 0.9);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          border-radius: 16px;
          padding: 0;
        }
        .premium-popup .leaflet-popup-tip {
          background: rgba(15, 23, 42, 0.9);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 20px;
        }
      `}</style>
    </div>
  );
};

export default InfrastructureMap;
