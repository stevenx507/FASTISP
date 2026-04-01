// frontend/src/components/SidePanels.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { LogItem, DhcpLease, WirelessClient, Toast } from './types';

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
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={onClose}></div>
      <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl p-4 overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            {sidePanel === 'logs' && 'Logs del Router'}
            {sidePanel === 'dhcp' && 'DHCP Leases'}
            {sidePanel === 'wifi' && 'Clientes WiFi'}
          </h3>
          <button className="text-gray-500 hover:text-gray-800" onClick={onClose}>Cerrar</button>
        </div>

        {sidePanel === 'logs' && (
          <div className="space-y-3">
            <div className="flex gap-2 items-center">
              <select className="border rounded px-2 py-1" value={logTopic} onChange={(e) => setLogTopic(e.target.value)}>
                <option value="">Todos los tópicos</option>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
                <option value="account">account</option>
              </select>
              <button className="px-3 py-1 bg-slate-200 rounded hover:bg-slate-300" onClick={() => void loadLogs()}>Filtrar</button>
            </div>
            <div className="text-sm text-gray-600">{panelLoading ? 'Cargando logs...' : `${logs.length} entradas`}</div>
            <div className="divide-y">
              {logs.map((l, idx) => (
                <div key={idx} className="py-2">
                  <div className="text-xs text-gray-500">{l.time || ''} {l.topics ? `[${l.topics}]` : ''}</div>
                  <div className="text-gray-900">{l.message || ''}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {sidePanel === 'dhcp' && (
            <div className="space-y-3">
            <div className="flex gap-2 items-center">
              <input className="border rounded px-2 py-1" placeholder="Buscar IP/MAC" value={leaseFilter} onChange={(e) => setLeaseFilter(e.target.value)} />
              <button className="px-3 py-1 bg-slate-200 rounded hover:bg-slate-300" onClick={() => void loadDhcpLeases()}>Refrescar</button>
            </div>
            <div className="text-sm text-gray-600">{panelLoading ? 'Cargando leases...' : `${leases.length} leases`}</div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left">IP</th>
                    <th className="px-3 py-2 text-left">MAC</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                    <th className="px-3 py-2 text-left">Expira</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leases
                    .filter((l) => {
                      const ip = l.address || '';
                      const mac = l.mac_address || l['mac-address'] || '';
                      const q = leaseFilter.trim().toLowerCase();
                      return !q || ip.toLowerCase().includes(q) || mac.toLowerCase().includes(q);
                    })
                    .map((l, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2">{l.address}</td>
                        <td className="px-3 py-2">{l.mac_address || l['mac-address']}</td>
                        <td className="px-3 py-2">{l.status}</td>
                        <td className="px-3 py-2">{l.expires_after || l['expires-after']}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {sidePanel === 'wifi' && (
          <div className="space-y-3">
            <div className="text-sm text-gray-600">{panelLoading ? 'Cargando clientes WiFi...' : `${wifiClients.length} clientes`}</div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left">MAC</th>
                    <th className="px-3 py-2 text-left">Señal</th>
                    <th className="px-3 py-2 text-left">TX</th>
                    <th className="px-3 py-2 text-left">RX</th>
                    <th className="px-3 py-2 text-left">Uptime</th>
                    <th className="px-3 py-2 text-left">Auth</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {wifiClients.map((w, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2">{w.mac_address || w['mac-address']}</td>
                      <td className="px-3 py-2">{w.signal || ''}</td>
                      <td className="px-3 py-2">{w['tx-rate'] || ''}</td>
                      <td className="px-3 py-2">{w['rx-rate'] || ''}</td>
                      <td className="px-3 py-2">{w.uptime || ''}</td>
                      <td className="px-3 py-2">{String(w.authenticated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SidePanels;
