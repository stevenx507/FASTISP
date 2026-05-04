import React from 'react'
import { ServerIcon } from '@heroicons/react/24/outline'
import { RouterItem, RouterConnectionSnapshot } from './types'

interface RoutersTableProps {
  routers: RouterItem[]
  selectedRouter: RouterItem | null
  setSelectedRouter: (router: RouterItem) => void
  routerConnectionSnapshots: Record<string, RouterConnectionSnapshot>
}

const RoutersTable: React.FC<RoutersTableProps> = ({
  routers,
  selectedRouter,
  setSelectedRouter,
  routerConnectionSnapshots
}) => {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50 text-[10px] font-black uppercase tracking-widest text-slate-500">
            <th className="px-4 py-3 text-left">Nombre</th>
            <th className="px-4 py-3 text-left">IP de Gestión</th>
            <th className="px-4 py-3 text-left">Usuario</th>
            <th className="px-4 py-3 text-center">API</th>
            <th className="px-4 py-3 text-center">Puerto</th>
            <th className="px-4 py-3 text-center">SSTP</th>
            <th className="px-4 py-3 text-center">VPN IP</th>
            <th className="px-4 py-3 text-right">Gestión</th>
          </tr>
        </thead>
        <tbody>
          {routers.map((router) => {
            const snapshot = routerConnectionSnapshots[router.id]
            const diagnostics = snapshot?.diagnostics || null
            const isSelected = selectedRouter?.id === router.id
            const apiOk = diagnostics?.success === true
            return (
              <tr
                key={router.id}
                onClick={() => setSelectedRouter(router)}
                className={`cursor-pointer border-b border-gray-50 transition-all ${
                  isSelected ? 'bg-coral-50/50' : 'hover:bg-gray-50'
                }`}
              >
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${apiOk ? 'bg-emerald-50 text-emerald-600' : 'bg-coral-50 text-coral-600'}`}>
                      <ServerIcon className="h-5 w-5" />
                    </div>
                    <span className="font-bold text-slate-700">{router.name}</span>
                  </div>
                </td>
                <td className="px-4 py-4 font-mono text-slate-700 text-xs">{router.ip_address}</td>
                <td className="px-4 py-4 text-slate-700 text-xs font-bold">{router.username || '-'}</td>
                <td className="px-4 py-4 text-center">
                  <div className={`mx-auto h-2 w-2 rounded-full ${apiOk ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-coral-500 shadow-[0_0_8px_rgba(255,105,97,0.5)]'}`} />
                </td>
                <td className="px-4 py-4 text-center text-xs font-bold text-slate-700">{router.api_port || 8728}</td>
                <td className="px-4 py-4 text-center">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-tighter ${
                    router.sstp_active 
                      ? 'bg-blue-50 text-blue-600 border border-blue-100' 
                      : 'bg-gray-100 text-slate-500'
                  }`}>
                    {router.sstp_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-4 text-center font-mono text-[10px] font-bold text-slate-700">
                  {router.vpn_ip || '-'}
                </td>
                <td className="px-4 py-4 text-right">
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedRouter(router) }}
                    className="rounded-xl bg-gray-50 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-gray-100 transition-all shadow-sm"
                  >
                    Gestionar
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!routers.length && (
        <p className="mt-6 text-sm text-slate-500 text-center font-bold py-10">
          No hay routers registrados todavía.
        </p>
      )}
    </div>
  )
}

export default RoutersTable
