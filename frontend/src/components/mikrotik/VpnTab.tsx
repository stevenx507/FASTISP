import React from 'react'
import { RouterItem, RouterQuickConnectResponse, RouterBackToHomeBootstrapData } from './types'

interface VpnTabProps {
  selectedRouter: RouterItem
  quickConnect: RouterQuickConnectResponse | null
  bthActionLoading: boolean
  bthUserName: string
  setBthUserName: (v: string) => void
  bthAllowLan: boolean
  setBthAllowLan: (v: boolean) => void
  bootstrapResult: RouterBackToHomeBootstrapData | null
  confirmEnableBackToHome: () => void
  confirmCreateBackToHomeUser: () => void
  confirmBootstrapBackToHome: () => void
  confirmRemoveBackToHomeUser: (userName: string) => void
}

const VpnTab: React.FC<VpnTabProps> = ({
  selectedRouter,
  quickConnect,
  bthActionLoading,
  bthUserName,
  setBthUserName,
  bthAllowLan,
  setBthAllowLan,
  bootstrapResult,
  confirmEnableBackToHome,
  confirmCreateBackToHomeUser,
  confirmBootstrapBackToHome,
  confirmRemoveBackToHomeUser
}) => {
  const bthEnabled = Boolean(quickConnect?.back_to_home?.enabled)
  const bthReachable = Boolean(quickConnect?.back_to_home?.reachable)

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-lg font-bold text-indigo-900">Back To Home (BTH) — MikroTik Nativo</h4>
            <p className="mt-0.5 text-xs text-indigo-700">
              Solución de acceso remoto oficial de MikroTik para equipos tras NAT o IP dinámica (RouterOS 7+).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-xs font-semibold border ${bthEnabled ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
              {bthEnabled ? 'BTH Habilitado' : 'BTH Deshabilitado'}
            </span>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold border ${bthReachable ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
              {bthReachable ? 'Alcanzable por API' : 'No alcanzable'}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!bthEnabled && (
            <button
              onClick={confirmEnableBackToHome}
              disabled={bthActionLoading}
              className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition"
            >
              Habilitar BTH en router
            </button>
          )}
          <button
            onClick={confirmBootstrapBackToHome}
            disabled={bthActionLoading}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition"
          >
            ⚡ Bootstrap 1-clic (Recomendado)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">Gestion de Usuarios BTH</p>
          <p className="mt-1 text-xs text-slate-500">
            Crea usuarios para que el VPS de FASTISP pueda conectarse por el tunel BTH.
          </p>
          <div className="mt-3 space-y-3">
            <input
              value={bthUserName}
              onChange={(e) => setBthUserName(e.target.value)}
              placeholder="Nombre de usuario BTH"
              className="w-full rounded border border-gray-200 px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-500"
            />
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={bthAllowLan}
                onChange={(e) => setBthAllowLan(e.target.checked)}
                className="rounded border-gray-300"
              />
              Permitir acceso a la LAN
            </label>
            <button
              onClick={confirmCreateBackToHomeUser}
              disabled={bthActionLoading}
              className="w-full rounded bg-slate-100 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-60 transition"
            >
              Crear Usuario BTH
            </button>
          </div>

          <div className="mt-4 space-y-2">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Usuarios Activos</p>
            {!(quickConnect?.back_to_home?.users || []).length && (
              <p className="text-xs text-slate-400 italic">No hay usuarios configurados.</p>
            )}
            {(quickConnect?.back_to_home?.users || []).map((user: any) => (
              <div key={user.name} className="flex items-center justify-between rounded border border-gray-100 px-2 py-1 bg-gray-50/50">
                <span className="text-xs font-bold text-slate-700">{user.name}</span>
                <button
                  onClick={() => confirmRemoveBackToHomeUser(user.name)}
                  disabled={bthActionLoading}
                  className="text-[10px] font-bold text-rose-500 hover:text-rose-600 uppercase transition"
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">Resultado de Bootstrap</p>
          <p className="mt-1 text-xs text-slate-500">
            Muestra el estado de la vinculacion con el relay de MikroTik y el VPS.
          </p>
          {!bootstrapResult && (
            <div className="mt-4 flex flex-col items-center justify-center py-6 text-center text-slate-400">
               <p className="text-xs italic">Pendiente: ejecuta Bootstrap 1-clic.</p>
            </div>
          )}
          {bootstrapResult && (
            <div className="mt-3 space-y-2">
              <div className={`rounded p-2 text-xs font-bold border ${bootstrapResult.operational ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                {bootstrapResult.message || 'Sin mensaje de bootstrap'}
              </div>
              <p className="text-xs text-slate-600">
                Paso actual: <strong>{bootstrapResult.step || '-'}</strong>
              </p>
              {(bootstrapResult.missing || []).length > 0 && (
                <div className="rounded border border-rose-100 bg-rose-50 p-2">
                  <p className="text-[10px] font-black uppercase text-rose-500">Pendiente de configurar</p>
                  <ul className="mt-1 space-y-0.5 text-[10px] text-rose-600">
                    {(bootstrapResult.missing || []).map((m: string, i: number) => (
                      <li key={i}>- {m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {bootstrapResult.qr_text && (
                <div className="mt-2 rounded bg-slate-950 p-2 text-[10px] text-emerald-400 overflow-auto max-h-32">
                  <p className="mb-1 font-bold">QR Token (para importacion manual):</p>
                  <code className="break-all">{bootstrapResult.qr_text}</code>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default VpnTab
