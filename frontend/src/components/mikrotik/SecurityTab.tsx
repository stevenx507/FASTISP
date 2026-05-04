import React from 'react'
import { 
  RouterItem, 
  RouterQuickConnectResponse, 
  EnterpriseProfilesPayload, 
  EnterpriseChangeLogEntry, 
  EnterpriseHardeningResult, 
  EnterpriseFailoverResult 
} from './types'

interface SecurityTabProps {
  selectedRouter: RouterItem
  quickConnect: RouterQuickConnectResponse | null
  enterpriseProfiles: EnterpriseProfilesPayload | null
  hardeningProfile: string
  setHardeningProfile: (profile: string) => void
  hardeningSiteProfile: string
  setHardeningSiteProfile: (profile: string) => void
  hardeningDryRun: boolean
  setHardeningDryRun: (dryRun: boolean) => void
  hardeningAutoRollback: boolean
  setHardeningAutoRollback: (autoRollback: boolean) => void
  securityBusy: boolean
  applyEnterpriseHardening: () => Promise<void>
  loadEnterpriseProfiles: (id: string) => Promise<void>
  hardeningResult: EnterpriseHardeningResult | null
  failoverTargets: string
  setFailoverTargets: (targets: string) => void
  failoverCount: string
  setFailoverCount: (count: string) => void
  runEnterpriseFailoverTest: () => Promise<void>
  failoverResult: EnterpriseFailoverResult | null
  enterpriseChangeLog: EnterpriseChangeLogEntry[]
  loadEnterpriseChangeLog: (id: string) => Promise<void>
  rollbackEnterpriseChange: (changeId: string) => Promise<void>
  openConfirm: (msg: string, action: () => void) => void
}

const SecurityTab: React.FC<SecurityTabProps> = ({
  selectedRouter,
  quickConnect,
  enterpriseProfiles,
  hardeningProfile,
  setHardeningProfile,
  hardeningSiteProfile,
  setHardeningSiteProfile,
  hardeningDryRun,
  setHardeningDryRun,
  hardeningAutoRollback,
  setHardeningAutoRollback,
  securityBusy,
  applyEnterpriseHardening,
  loadEnterpriseProfiles,
  hardeningResult,
  failoverTargets,
  setFailoverTargets,
  failoverCount,
  setFailoverCount,
  runEnterpriseFailoverTest,
  failoverResult,
  enterpriseChangeLog,
  loadEnterpriseChangeLog,
  rollbackEnterpriseChange,
  openConfirm
}) => {
  return (
    <div className="space-y-6">
      <div className="p-6 rounded-3xl bg-indigo-900 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <svg className="w-32 h-32" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z" />
          </svg>
        </div>
        <div className="relative z-10">
          <h4 className="text-xl font-black uppercase tracking-tight">Ciberseguridad Enterprise</h4>
          <p className="mt-2 text-xs font-medium text-indigo-200 leading-relaxed max-w-2xl">
            Control de cambios endurecido. Las acciones live requieren validación de ticket si el control de cambios está activo.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(quickConnect?.guidance?.notes || []).map((note, idx) => (
              <span key={idx} className="px-3 py-1 rounded-full bg-white/10 text-[10px] font-bold uppercase tracking-widest border border-white/10">
                • {note}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="p-6 rounded-3xl border border-gray-100 bg-white shadow-xl space-y-6">
          <div className="flex items-center justify-between border-b border-gray-50 pb-4">
            <div>
              <h5 className="text-sm font-black text-slate-800 uppercase tracking-widest">Hardening Runbook</h5>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Automatización de seguridad</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
              hardeningDryRun 
                ? 'bg-amber-50 text-amber-600 border-amber-200' 
                : 'bg-emerald-50 text-emerald-600 border-emerald-200'
            }`}>
              {hardeningDryRun ? 'DRY-RUN MODE' : 'LIVE DEPLOYMENT'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Perfil Router</label>
              <select
                value={hardeningProfile}
                onChange={(e) => setHardeningProfile(e.target.value)}
                className="w-full bg-slate-50 border border-gray-100 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
              >
                {(enterpriseProfiles?.router_profiles || [{ id: 'baseline', label: 'Baseline' }]).map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Perfil de Sitio</label>
              <select
                value={hardeningSiteProfile}
                onChange={(e) => setHardeningSiteProfile(e.target.value)}
                className="w-full bg-slate-50 border border-gray-100 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
              >
                {(enterpriseProfiles?.site_profiles || [{ id: 'access', label: 'Access' }]).map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 p-4 bg-slate-50 rounded-2xl border border-gray-100">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={hardeningDryRun}
                  onChange={(e) => setHardeningDryRun(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-10 h-5 rounded-full transition-colors ${hardeningDryRun ? 'bg-amber-500' : 'bg-slate-300'}`} />
                <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${hardeningDryRun ? 'translate-x-5' : ''}`} />
              </div>
              <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Modo Simulación</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={hardeningAutoRollback}
                  onChange={(e) => setHardeningAutoRollback(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-10 h-5 rounded-full transition-colors ${hardeningAutoRollback ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${hardeningAutoRollback ? 'translate-x-5' : ''}`} />
              </div>
              <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Auto-Rollback</span>
            </label>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => void applyEnterpriseHardening()}
              disabled={securityBusy}
              className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-white transition-all shadow-xl ${
                hardeningDryRun 
                  ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20' 
                  : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20'
              } disabled:opacity-50`}
            >
              {securityBusy ? 'Procesando...' : hardeningDryRun ? 'Simular Hardening' : 'Desplegar Seguridad'}
            </button>
            <button
              onClick={() => selectedRouter && void loadEnterpriseProfiles(selectedRouter.id)}
              disabled={securityBusy}
              className="p-3 bg-slate-100 text-slate-500 rounded-2xl hover:bg-slate-200 transition-all"
              title="Refrescar Perfiles"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          </div>

          {hardeningResult && (
            <div className={`p-4 rounded-2xl border ${hardeningResult.error ? 'bg-rose-50 border-rose-100' : 'bg-indigo-50 border-indigo-100'}`}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Resultado de Ejecución</span>
                <span className="text-[10px] font-mono font-bold text-slate-400">ID: {hardeningResult.change_id || 'N/A'}</span>
              </div>
              <p className={`text-xs font-bold leading-relaxed ${hardeningResult.error ? 'text-rose-600' : 'text-indigo-700'}`}>
                {hardeningResult.error || hardeningResult.message}
              </p>
            </div>
          )}
        </div>

        <div className="p-6 rounded-3xl border border-gray-100 bg-white shadow-xl space-y-6">
          <div className="border-b border-gray-50 pb-4">
            <h5 className="text-sm font-black text-slate-800 uppercase tracking-widest">Failover Diagnostics</h5>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Simulación de probes de red</p>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Targets de Monitoreo</label>
              <textarea
                value={failoverTargets}
                onChange={(e) => setFailoverTargets(e.target.value)}
                rows={3}
                placeholder="1.1.1.1, 8.8.8.8, 9.9.9.9"
                className="w-full bg-slate-50 border border-gray-100 rounded-2xl px-4 py-3 text-xs font-mono font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10 focus:bg-white transition-all resize-none"
              />
            </div>
            
            <div className="flex items-end gap-3">
              <div className="space-y-2 flex-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Número de Probes</label>
                <input
                  type="number"
                  value={failoverCount}
                  onChange={(e) => setFailoverCount(e.target.value)}
                  className="w-full bg-slate-50 border border-gray-100 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                />
              </div>
              <button
                onClick={() => void runEnterpriseFailoverTest()}
                disabled={securityBusy}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50"
              >
                {securityBusy ? 'Wait...' : 'Iniciar Test'}
              </button>
            </div>
          </div>

          {failoverResult && (
            <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-gray-100">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Estado Global</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                  failoverResult.overall_status === 'healthy' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
                }`}>
                  {failoverResult.overall_status || 'desconocido'}
                </span>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                {(failoverResult.targets || []).map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center p-2 bg-white rounded-xl border border-gray-50">
                    <span className="text-xs font-mono font-bold text-slate-700">{item.target}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-slate-400">{item.packet_loss}% Loss</span>
                      <span className="text-[10px] font-black text-indigo-600">{item.avg_latency_ms ?? '-'} ms</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-6 rounded-3xl border border-gray-100 bg-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-50 pb-4 mb-4">
          <div>
            <h5 className="text-sm font-black text-slate-800 uppercase tracking-widest">Registro de Cambios & Rollback</h5>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Historial de auditoría técnica</p>
          </div>
          <button
            onClick={() => selectedRouter && void loadEnterpriseChangeLog(selectedRouter.id)}
            disabled={securityBusy}
            className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all border border-gray-100"
          >
            Refrescar Historial
          </button>
        </div>

        {enterpriseChangeLog.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm font-bold text-slate-300 italic uppercase tracking-widest">No hay registros de auditoría disponibles</p>
          </div>
        ) : (
          <div className="space-y-3">
            {enterpriseChangeLog.map((entry) => (
              <div key={entry.change_id} className="p-4 rounded-2xl bg-slate-50 border border-gray-100 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono font-bold text-indigo-600">{entry.change_id}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                      entry.status === 'applied' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
                    }`}>
                      {entry.status}
                    </span>
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Actor: {entry.actor} • Perfil: {entry.profile} • Sitio: {entry.site_profile}
                  </p>
                </div>
                <button
                  onClick={() => openConfirm(`¿Desea revertir (rollback) el cambio ${entry.change_id}? Esta acción es destructiva.`, () => rollbackEnterpriseChange(entry.change_id))}
                  disabled={securityBusy || entry.status !== 'applied'}
                  className="px-6 py-2 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 transition-all shadow-lg shadow-rose-600/20 disabled:opacity-30"
                >
                  Rollback Change
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default SecurityTab
