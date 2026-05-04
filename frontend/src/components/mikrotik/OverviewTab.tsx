import React from 'react'
import { 
  RouterItem, 
  RouterConnectionSnapshot, 
  RouterConnectionDiagnosticsPayload 
} from './types'
import { 
  formatConnectionCheckedAt, 
  getConnectionStatusTone, 
  getConnectionStatusLabel 
} from './helpers'

interface OverviewTabProps {
  selectedRouter: RouterItem
  routerConnectionSnapshots: Record<string, RouterConnectionSnapshot>
  diagnostics: RouterConnectionDiagnosticsPayload | null
  testConnection: () => Promise<void>
  backupRouter: () => Promise<void>
  runAiDiagnosis: () => Promise<void>
  isAiLoading: boolean
  rebootRouter: () => Promise<void>
  actionLoading: boolean
  openConfirm: (msg: string, action: () => void) => void
}

const OverviewTab: React.FC<OverviewTabProps> = ({
  selectedRouter,
  routerConnectionSnapshots,
  diagnostics,
  testConnection,
  backupRouter,
  runAiDiagnosis,
  isAiLoading,
  rebootRouter,
  actionLoading,
  openConfirm
}) => {
  const snapshot = routerConnectionSnapshots[selectedRouter.id]
  
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Estado Conexión</p>
          <div className="mt-2 flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${diagnostics?.success ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-coral-500 shadow-[0_0_8px_rgba(255,105,97,0.5)]'}`} />
            <span className={`text-sm font-bold ${diagnostics?.success ? 'text-emerald-700' : 'text-coral-700'}`}>
              {diagnostics?.success ? 'API Operativa' : 'API Desconectada'}
            </span>
          </div>
          <p className="mt-1 text-[10px] font-bold text-slate-400">
            Último check: {formatConnectionCheckedAt(snapshot?.checkedAt)}
          </p>
        </div>
        
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Transporte Activo</p>
          <p className="mt-2 text-sm font-bold text-slate-700 uppercase tracking-tight">
            {selectedRouter.sstp_active ? 'Túnel SSTP / VPN' : 'Conexión Directa'}
          </p>
          <p className="mt-1 text-[10px] font-bold text-slate-400">
            IP: {selectedRouter.vpn_ip || selectedRouter.ip_address}
          </p>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Diagnóstico IA</p>
          <div className="mt-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-tighter ${
               diagnostics ? getConnectionStatusTone(diagnostics) : 'bg-gray-100 text-slate-500'
            }`}>
              {diagnostics ? getConnectionStatusLabel(diagnostics) : 'Pendiente'}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-gray-50/50 p-6">
        <h4 className="mb-4 text-xs font-black text-slate-800 uppercase tracking-widest">Acciones Rápidas</h4>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void testConnection()}
            disabled={actionLoading}
            className="rounded-xl bg-white border border-gray-200 px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
          >
            ⚡ Probar Conexión
          </button>
          <button
            onClick={() => void backupRouter()}
            disabled={actionLoading}
            className="rounded-xl bg-white border border-gray-200 px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
          >
            💾 Generar Backup
          </button>
          <button
            onClick={() => void runAiDiagnosis()}
            disabled={isAiLoading || actionLoading}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20 disabled:opacity-50"
          >
            🧠 Diagnóstico IA
          </button>
          <button
            onClick={() => openConfirm(`¿Reiniciar el router ${selectedRouter.name}?`, rebootRouter)}
            disabled={actionLoading}
            className="rounded-xl bg-rose-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-rose-700 transition-all shadow-lg shadow-rose-600/20 disabled:opacity-50"
          >
            🔄 Reiniciar Router
          </button>
        </div>
      </div>
    </div>
  )
}

export default OverviewTab
