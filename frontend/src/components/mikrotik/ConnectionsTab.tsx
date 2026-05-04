// frontend/src/components/ConnectionsTab.tsx
import React, { useState } from 'react';
import { TrashIcon } from '@heroicons/react/24/outline';
import { RouterStats, ConnectionItem, Toast, RouterItem } from '../types';

interface ConnectionsTabProps {
  routerStats: RouterStats | null;
  setRouterStats: React.Dispatch<React.SetStateAction<RouterStats | null>>;
  selectedRouter: RouterItem | null;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
  addToast: (type: Toast['type'], message: string) => void;
  openConfirm: (message: string, onConfirm: () => void) => void;
}

const ConnectionsTab: React.FC<ConnectionsTabProps> = ({
  routerStats,
  setRouterStats,
  selectedRouter,
  apiFetch,
  addToast,
  openConfirm,
}) => {
  const [connectionsCurrentPage, setConnectionsCurrentPage] = useState(1);
  const connectionsItemsPerPage = 10;
  const [connectionSearchTerm, setConnectionSearchTerm] = useState('');

  const deleteConnection = async (connection: ConnectionItem) => {
    if (!selectedRouter || !connection.id) return;

    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/connections`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: connection.id, type: connection.type }),
      });

      const data = await response.json().catch(() => ({ success: false }));

      if (response.ok && data.success) {
        addToast('success', `Conexión ${connection.address} eliminada.`);
        setRouterStats((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            connections: prev.connections.filter((c) => c.id !== connection.id),
          };
        });
      } else {
        addToast('error', data.error || 'No se pudo eliminar la conexión.');
      }
    } catch (error) {
      addToast('error', 'Error de red al eliminar la conexión.');
    }
  };

  const filteredConnections =
    routerStats?.connections.filter(
      (conn) =>
        conn.address?.toLowerCase().includes(connectionSearchTerm.toLowerCase()) ||
        conn.mac_address?.toLowerCase().includes(connectionSearchTerm.toLowerCase()) ||
        conn.host_name?.toLowerCase().includes(connectionSearchTerm.toLowerCase())
    ) || [];

  const indexOfLastConnection = connectionsCurrentPage * connectionsItemsPerPage;
  const indexOfFirstConnection = indexOfLastConnection - connectionsItemsPerPage;
  const currentConnections = filteredConnections.slice(indexOfFirstConnection, indexOfLastConnection);
  const totalConnectionPages = Math.ceil(filteredConnections.length / connectionsItemsPerPage);
  const paginateConnections = (pageNumber: number) => setConnectionsCurrentPage(pageNumber);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h4 className="text-xl font-black text-slate-800 uppercase tracking-tight">
            Conexiones Activas
          </h4>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
            {filteredConnections.length} de {routerStats?.connections.length || 0} dispositivos detectados
          </p>
        </div>
        <div className="relative flex-1 max-w-sm">
          <input
            type="text"
            placeholder="Buscar por IP, MAC o Host..."
            value={connectionSearchTerm}
            onChange={(e) => {
              setConnectionSearchTerm(e.target.value);
              setConnectionsCurrentPage(1);
            }}
            className="w-full bg-slate-50 border border-gray-100 rounded-2xl px-10 py-2.5 text-xs font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10 focus:bg-white transition-all"
          />
          <svg className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-gray-100 shadow-sm bg-white">
        <table className="min-w-full divide-y divide-gray-50">
          <thead className="bg-slate-50/50">
            <tr>
              <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Dirección IP</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">MAC / HW ID</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Host Name</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Estado</th>
              <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {currentConnections.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center">
                  <p className="text-sm font-bold text-slate-400 italic">No se encontraron conexiones activas.</p>
                </td>
              </tr>
            )}
            {currentConnections.map((conn, idx) => (
              <tr key={`${conn.address}-${idx}`} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2.5 py-1 text-[10px] font-black uppercase rounded-lg ${
                    conn.type === 'dhcp' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {conn.type.toUpperCase()}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-bold text-indigo-600">{conn.address}</td>
                <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-slate-500">{conn.mac_address}</td>
                <td className="px-6 py-4 whitespace-nowrap text-xs font-bold text-slate-700">{conn.host_name || 'Generic Device'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-xs font-medium text-slate-500">{conn.uptime || conn.status}</td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <button
                    onClick={() => openConfirm(`¿Eliminar la conexión de ${conn.address}? Esto forzará al dispositivo a reconectarse.`, () => deleteConnection(conn))}
                    className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors" title="Eliminar Conexión"
                  >
                    <TrashIcon className="w-5 h-5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalConnectionPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <button
            onClick={() => paginateConnections(connectionsCurrentPage - 1)}
            disabled={connectionsCurrentPage === 1}
            className="flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-600 bg-slate-50 border border-gray-100 rounded-xl hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Anterior
          </button>
          <span className="text-xs font-bold text-slate-400">
            Página <span className="text-slate-800">{connectionsCurrentPage}</span> de <span className="text-slate-800">{totalConnectionPages}</span>
          </span>
          <button
            onClick={() => paginateConnections(connectionsCurrentPage + 1)}
            disabled={connectionsCurrentPage === totalConnectionPages}
            className="flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-600 bg-slate-50 border border-gray-100 rounded-xl hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            Siguiente
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default ConnectionsTab;
