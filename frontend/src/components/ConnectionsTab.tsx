// frontend/src/components/ConnectionsTab.tsx
import React, { useState } from 'react';
import { TrashIcon } from '@heroicons/react/24/outline';
import { RouterStats, ConnectionItem, Toast, RouterItem } from './types';

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
    <div>
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-semibold text-white">
          Conexiones Activas ({filteredConnections.length} de {routerStats?.connections.length || 0} total)
        </h4>
        <input
          type="text"
          placeholder="Buscar por IP, MAC o Host..."
          value={connectionSearchTerm}
          onChange={(e) => {
            setConnectionSearchTerm(e.target.value);
            setConnectionsCurrentPage(1);
          }}
          className="block w-full max-w-xs border-white/20 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/10">
          <thead>
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Tipo</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Dirección IP</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">MAC Address</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Host Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Uptime/Expira</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody className="bg-white backdrop-blur-md divide-y divide-white/10">
            {currentConnections.map((conn, idx) => (
              <tr key={`${conn.address}-${idx}`}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    conn.type === 'dhcp' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-blue-500/20 text-blue-300'
                  }`}>
                    {conn.type.toUpperCase()}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">{conn.address}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{conn.mac_address}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{conn.host_name || 'N/A'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{conn.uptime || conn.status}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <button
                    onClick={() => openConfirm(`¿Eliminar la conexión de ${conn.address}? Esto forzará al dispositivo a reconectarse.`, () => deleteConnection(conn))}
                    className="p-2 text-red-500 hover:bg-rose-500/20 rounded-md" title="Eliminar Conexión"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalConnectionPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => paginateConnections(connectionsCurrentPage - 1)}
            disabled={connectionsCurrentPage === 1}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-white backdrop-blur-md border border-white/20 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Anterior
          </button>
          <span className="text-sm text-slate-600">
            Página {connectionsCurrentPage} de {totalConnectionPages}
          </span>
          <button
            onClick={() => paginateConnections(connectionsCurrentPage + 1)}
            disabled={connectionsCurrentPage === totalConnectionPages}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-white backdrop-blur-md border border-white/20 rounded-lg hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
};

export default ConnectionsTab;
