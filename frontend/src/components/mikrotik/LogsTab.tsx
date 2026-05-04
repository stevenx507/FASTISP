import React from 'react'
import { LogItem } from './types'

interface LogsTabProps {
  logs: LogItem[]
  logsLoading: boolean
  loadLogs: () => Promise<void>
}

const LogsTab: React.FC<LogsTabProps> = ({ logs, logsLoading, loadLogs }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-bold text-slate-800 uppercase tracking-tight">Logs del Sistema</h4>
        <button
          onClick={() => void loadLogs()}
          disabled={logsLoading}
          className="rounded-xl bg-slate-100 px-5 py-2.5 text-xs font-black text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition-all shadow-sm"
        >
          {logsLoading ? 'Cargando...' : '🔄 Refrescar Logs'}
        </button>
      </div>
      <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden shadow-sm">
        <div className="bg-slate-50/50 px-4 py-2 border-b border-gray-100">
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Actividad Reciente</p>
        </div>
        <div className="p-4">
          {logsLoading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-coral-500" />
              <p className="text-xs font-bold text-slate-400">Consultando MikroTik...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center">
               <p className="text-sm font-bold text-slate-400">No hay logs recientes.</p>
            </div>
          ) : (
            <div className="space-y-1 overflow-y-auto max-h-[600px] pr-2 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
              {logs.map((log, idx) => (
                <div key={idx} className="flex gap-4 border-b border-gray-50 pb-2 text-[11px] hover:bg-gray-50 transition-colors px-3 py-2 rounded-lg">
                  <span className="text-slate-400 shrink-0 font-mono font-bold">{log.time}</span>
                  <span className={`shrink-0 font-black uppercase tracking-tighter ${log.topics?.includes('error') ? 'text-coral-500' : 'text-indigo-500'}`}>
                    [{log.topics}]
                  </span>
                  <span className="text-slate-600 font-medium leading-relaxed">{log.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default LogsTab
