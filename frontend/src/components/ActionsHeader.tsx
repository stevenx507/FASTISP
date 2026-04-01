// frontend/src/components/ActionsHeader.tsx
import React from 'react';
import {
  WifiIcon,
  CloudArrowDownIcon,
  ArrowPathIcon,
  SparklesIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { RouterItem } from './types';

interface ActionsHeaderProps {
  actionLoading: boolean;
  isAiLoading: boolean;
  isLoading: boolean;
  selectedRouter: RouterItem | null;
  onTestConnection: () => void;
  onBackupRouter: () => void;
  onRebootClick: () => void;
  onRunAiDiagnosis: () => void;
  onRefreshStats: () => void;
  onShowLogs: () => void;
  onShowDhcpLeases: () => void;
  onShowWifiClients: () => void;
  onDeleteRouterClick: () => void;
}

const ActionsHeader: React.FC<ActionsHeaderProps> = ({
  actionLoading,
  isAiLoading,
  isLoading,
  selectedRouter,
  onTestConnection,
  onBackupRouter,
  onRebootClick,
  onRunAiDiagnosis,
  onRefreshStats,
  onShowLogs,
  onShowDhcpLeases,
  onShowWifiClients,
  onDeleteRouterClick,
}) => {
  return (
    <div className="flex justify-between items-center">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Gestión MikroTik</h2>
        <p className="text-gray-600">Administra y monitorea tus routers MikroTik</p>
        {selectedRouter ? <p className="mt-1 text-xs text-gray-500">Router seleccionado: {selectedRouter.name}</p> : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={onTestConnection}
          disabled={actionLoading}
          className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
        >
          <WifiIcon className="w-5 h-5" />
          <span>Probar Conexión</span>
        </button>
        <button
          onClick={onShowLogs}
          disabled={actionLoading}
          className="flex items-center space-x-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
        >
          <span>Ver Logs</span>
        </button>
        <button
          onClick={onShowDhcpLeases}
          disabled={actionLoading}
          className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          <span>DHCP Leases</span>
        </button>
        <button
          onClick={onShowWifiClients}
          disabled={actionLoading}
          className="flex items-center space-x-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
        >
          <span>Clientes WiFi</span>
        </button>
        <button
          onClick={onBackupRouter}
          disabled={actionLoading}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <CloudArrowDownIcon className="w-5 h-5" />
          <span>Backup</span>
        </button>
        <button
          onClick={onRebootClick}
          disabled={actionLoading}
          className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
        >
          <ArrowPathIcon className="w-5 h-5" />
          <span>Reiniciar</span>
        </button>
        <button
          onClick={onRunAiDiagnosis}
          disabled={isAiLoading || actionLoading}
          className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          <SparklesIcon className={`w-5 h-5 ${isAiLoading ? 'animate-spin' : ''}`} />
          <span>{isAiLoading ? 'Analizando...' : 'Diagnóstico IA'}</span>
        </button>
        <button
          onClick={onRefreshStats}
          disabled={isLoading}
          className="flex items-center space-x-2 px-4 py-2 bg-slate-200 text-slate-900 rounded-lg hover:bg-slate-300 disabled:opacity-50"
        >
          <span>Refrescar</span>
        </button>
        <button
          onClick={onDeleteRouterClick}
          disabled={actionLoading || !selectedRouter}
          className="flex items-center space-x-2 px-4 py-2 bg-rose-800 text-white rounded-lg hover:bg-rose-900 disabled:opacity-50"
        >
          <TrashIcon className="w-5 h-5" />
          <span>Eliminar router</span>
        </button>
      </div>
    </div>
  );
};

export default ActionsHeader;
