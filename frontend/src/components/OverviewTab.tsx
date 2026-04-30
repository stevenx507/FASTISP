// frontend/src/components/OverviewTab.tsx
import React from 'react';
import { motion } from 'framer-motion';
import { RouterStats } from './types';

interface OverviewTabProps {
  routerStats: RouterStats | null;
}

const OverviewTab: React.FC<OverviewTabProps> = ({ routerStats }) => {
  if (!routerStats?.health) {
    return (
      <div className="text-center py-10 text-slate-400">
        No se pudo cargar la información de resumen del router.
      </div>
    );
  }

  const { health } = routerStats;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-blue-500/10 p-4 rounded-lg">
          <div className="text-sm text-blue-300">CPU</div>
          <div className="text-2xl font-bold text-blue-200">
            {health.router?.cpu_load || 'N/A'}
          </div>
        </div>
        <div className="bg-emerald-500/10 p-4 rounded-lg">
          <div className="text-sm text-emerald-400">Memoria Libre</div>
          <div className="text-2xl font-bold text-emerald-300">
            {(() => {
              const bytesStr = health.router?.free_memory;
              const bytes = bytesStr ? Number(bytesStr) : NaN;
              if (Number.isFinite(bytes) && bytes > 0) {
                return `${Math.round(bytes / 1024 / 1024)} MB`;
              }
              return 'N/A';
            })()}
          </div>
        </div>
        <div className="bg-purple-500/10 p-4 rounded-lg border border-purple-500/20">
          <div className="text-sm text-purple-400">Uptime</div>
          <div className="text-2xl font-bold text-purple-200">
            {health.router?.uptime?.split(' ')[0] || 'N/A'}
          </div>
        </div>
        <div className="bg-amber-500/10 p-4 rounded-lg border border-amber-500/20">
          <div className="text-sm text-amber-400">Salud</div>
          <div className="text-2xl font-bold text-amber-200">
            {health.health_score || 0}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h4 className="font-semibold text-white mb-3">Información del Router</h4>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">Modelo:</span>
              <span className="font-medium">{health.router?.model}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Firmware:</span>
              <span className="font-medium">{health.router?.firmware}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Serial:</span>
              <span className="font-medium">{health.router?.serial_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Nombre:</span>
              <span className="font-medium">{health.router?.identity}</span>
            </div>
          </div>
        </div>

        <div>
          <h4 className="font-semibold text-white mb-3">Métricas</h4>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm text-slate-400 mb-1">
                <span>Colas Activas</span>
                <span>{health.queues}</span>
              </div>
              <div className="w-full bg-white/15 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full"
                  style={{ width: `${(() => { const v = Number(health.queues ?? 0); return Math.min(v * 2, 100); })()}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm text-slate-400 mb-1">
                <span>Conexiones Activas</span>
                <span>{health.connections}</span>
              </div>
              <div className="w-full bg-white/15 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full"
                  style={{ width: `${(() => { const v = Number(health.connections ?? 0); return Math.min(v * 5, 100); })()}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default OverviewTab;
