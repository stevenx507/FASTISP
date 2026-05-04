// frontend/src/components/SidePanels.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { LogItem, DhcpLease, WirelessClient, Toast } from '../types';

interface SidePanelsProps {
  sidePanel: 'none' | 'logs' | 'dhcp' | 'wifi';
  onClose: () => void;
  selectedRouterId: string | null;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
  addToast: (type: Toast['type'], message: string) => void;
}

const SidePanels: React.FC<SidePanelsProps> = ({ sidePanel, onClose, selectedRouterId, apiFetch, addToast }) => {
  const [panelLoading, setPanelLoading] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logTopic, setLogTopic] = useState<string>('');
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [leaseFilter, setLeaseFilter] = useState<string>('');
  const [wifiClients, setWifiClients] = useState<WirelessClient[]>([]);

  const loadLogs = useCallback(async () => {
    if (!selectedRouterId) return;
    try {
      setPanelLoading(true);
      const params = new URLSearchParams();
      if (logTopic) params.set('topic', logTopic);
      params.set('limit', '100');
      const res = await apiFetch(`/api/mikrotik/routers/${selectedRouterId}/logs?${params.toString()}`);
      const data = await res.json().catch(() => ({ success: false, logs: [] }));
      if (res.ok && data.success) setLogs(data.logs as LogItem[]);
      else {
        setLogs([]);
        addToast('error', 'No se pudieron cargar los logs.');
      }
    } catch (e) {
      console.error('Error loading logs:', e);
      setLogs([]);
      addToast('error', 'Error de red al cargar logs.');
    } finally {
      setPanelLoading(false);
    }
  }, [selectedRouterId, apiFetch, addToast, logTopic]);

  const loadDhcpLeases = useCallback(async () => {
    if (!selectedRouterId) return;
    try {
      setPanelLoading(true);
      const res = await apiFetch(`/api/mikrotik/routers/${selectedRouterId}/dhcp/leases`);
      const data = await res.json().catch(() => ({ success: false, leases: [] }));
      if (res.ok && data.success) setLeases(data.leases as DhcpLease[]);
      else {
        setLeases([]);
        addToast('error', 'No se pudieron cargar los DHCP leases.');
      }
    } catch (e) {
      console.error('Error loading leases:', e);
      setLeases([]);
      addToast('error', 'Error de red al cargar DHCP leases.');
    } finally {
      setPanelLoading(false);
    }
  }, [selectedRouterId, apiFetch, addToast]);

  const loadWirelessClients = useCallback(async () => {
    if (!selectedRouterId) return;
    try {
      setPanelLoading(true);
      const res = await apiFetch(`/api/mikrotik/routers/${selectedRouterId}/wireless/clients`);
      const data = await res.json().catch(() => ({ success: false, clients: [] }));
      if (res.ok && data.success) setWifiClients(data.clients as WirelessClient[]);
      else {
        setWifiClients([]);
        addToast('error', 'No se pudieron cargar los clientes WiFi.');
      }
    } catch (e) {
      console.error('Error loading wireless clients:', e);
      setWifiClients([]);
      addToast('error', 'Error de red al cargar clientes WiFi.');
    } finally {
      setPanelLoading(false);
    }
  }, [selectedRouterId, apiFetch, addToast]);
  
  useEffect(() => {
    if (sidePanel === 'logs') loadLogs();
    if (sidePanel === 'dhcp') loadDhcpLeases();
    if (sidePanel === 'wifi') loadWirelessClients();
  }, [sidePanel, loadLogs, loadDhcpLeases, loadWirelessClients]);


  if (sidePanel === 'none') return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />
      <div className="relative h-full w-full max-w-xl bg-white/95 backdrop-blur-xl shadow-2xl border-l border-white/20 p-6 overflow-y-auto animate-in slide-in-from-right duration-300">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-100">
          <h3 className="text-xl font-black text-slate-800 uppercase tracking-widest">
            {sidePanel === 'logs' && 'Logs del Router'}
            {sidePanel === 'dhcp' && 'DHCP Leases'}
            {sidePanel === 'wifi' && 'Clientes WiFi'}
          </h3>
          <button 
            className="p-2 rounded-full hover:bg-gray-100 text-slate-400 hover:text-slate-600 transition-colors" 
            onClick={onClose}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {sidePanel === 'logs' && (
          <div className="space-y-4">
            <div className="flex gap-3 items-center p-3 bg-slate-50 rounded-2xl border border-gray-100">
              <select 
                className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20" 
                value={logTopic} 
                onChange={(e) => setLogTopic(e.target.value)}
              >
                <option value="">Todos los tópicos</option>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
                <option value="account">account</option>
              </select>
              <button 
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20" 
                onClick={() => void loadLogs()}
              >
                Filtrar
              </button>
            </div>
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {panelLoading ? 'Cargando logs...' : `${logs.length} entradas encontradas`}
              </span>
            </div>
            <div className="space-y-2">
              {logs.length === 0 && !panelLoading && (
                <div className="py-20 text-center">
                  <p className="text-sm font-bold text-slate-400 italic">No hay logs para mostrar.</p>
                </div>
              )}
              {logs.map((l, idx) => (
                <div key={idx} className="p-3 rounded-xl border border-gray-50 bg-gray-50/50 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold text-slate-400 font-mono">{l.time || ''}</span>
                    <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${l.topics?.includes('error') ? 'bg-rose-50 text-rose-500' : 'bg-indigo-50 text-indigo-500'}`}>
                      {l.topics || 'system'}
                    </span>
                  </div>
                  <div className="text-xs font-medium text-slate-700 leading-relaxed">{l.message || ''}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {sidePanel === 'dhcp' && (
          <div className="space-y-4">
            <div className="flex gap-3 items-center p-3 bg-slate-50 rounded-2xl border border-gray-100">
              <input 
                className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-coral-500/20" 
                placeholder="Buscar por IP o MAC..." 
                value={leaseFilter} 
                onChange={(e) => setLeaseFilter(e.target.value)} 
              />
              <button 
                className="px-4 py-2 bg-coral-500 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-coral-600 transition-all shadow-lg shadow-coral-500/20" 
                onClick={() => void loadDhcpLeases()}
              >
                Refrescar
              </button>
            </div>
            <div className="overflow-hidden rounded-2xl border border-gray-100 shadow-sm">
              <table className="min-w-full divide-y divide-gray-100 text-xs">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">IP Address</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">MAC / HW</th>
                    <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 bg-white">
                  {leases
                    .filter((l) => {
                      const ip = l.address || '';
                      const mac = l.mac_address || l['mac-address'] || '';
                      const q = leaseFilter.trim().toLowerCase();
                      return !q || ip.toLowerCase().includes(q) || mac.toLowerCase().includes(q);
                    })
                    .map((l, idx) => (
                      <tr key={idx} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-indigo-600">{l.address}</td>
                        <td className="px-4 py-3 font-mono text-slate-500">{l.mac_address || l['mac-address']}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${l.status === 'bound' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                            {l.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {sidePanel === 'wifi' && (
          <div className="space-y-4">
             <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {panelLoading ? 'Consultando radio WiFi...' : `${wifiClients.length} dispositivos conectados`}
              </span>
              <button 
                className="text-[10px] font-black text-indigo-500 uppercase tracking-widest hover:text-indigo-600"
                onClick={() => void loadWirelessClients()}
              >
                Actualizar
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {wifiClients.map((w, idx) => (
                <div key={idx} className="p-4 rounded-2xl border border-gray-100 bg-white shadow-sm flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dispositivo</span>
                    <span className="text-xs font-mono font-bold text-slate-800">{w.mac_address || w['mac-address']}</span>
                    <span className="text-[10px] font-bold text-slate-500">Uptime: {w.uptime || '-'}</span>
                  </div>
                  <div className="text-right flex flex-col gap-1">
                    <span className={`text-sm font-black ${parseInt(w.signal || '0') > -60 ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {w.signal || '-'} dBm
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">TX/RX: {w['tx-rate'] || '-'}/{w['rx-rate'] || '-'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SidePanels;
