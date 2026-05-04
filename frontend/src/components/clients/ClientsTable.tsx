import React from 'react'
import {
  ChevronDownIcon,
  GlobeAltIcon,
  PlusIcon,
  SignalIcon,
  WifiIcon,
} from '@heroicons/react/24/outline'
import { Client, Plan } from './types'

interface Props {
  clients: Client[]
  plans: Plan[]
  selectedIds: Set<number>
  onToggleSelect: (id: number) => void
  onToggleSelectAll: () => void
  onAction: (client: Client, action: string) => void
  onEdit: (client: Client) => void
  onGpon: (client: Client) => void
  onPortal: (client: Client) => void
  onDelete: (id: number) => void
}

const ClientsTable: React.FC<Props> = ({
  clients,
  plans,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onAction,
  onEdit,
  onGpon,
  onPortal,
  onDelete,
}) => {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="badge-ws badge-ws-success">Activo</span>
      case 'suspended':
        return <span className="badge-ws badge-ws-danger">Suspendido</span>
      case 'past_due':
        return <span className="badge-ws badge-ws-warning">Vencido</span>
      case 'trial':
        return <span className="badge-ws badge-ws-info">Prueba</span>
      default:
        return <span className="badge-ws">{status}</span>
    }
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-6 py-4">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300"
                checked={clients.length > 0 && selectedIds.size === clients.length}
                onChange={onToggleSelectAll}
              />
            </th>
            <th className="px-6 py-4">Nombre / Usuario</th>
            <th className="px-6 py-4">IP / Router</th>
            <th className="px-6 py-4">Plan / Velocidad</th>
            <th className="px-6 py-4">Estado</th>
            <th className="px-6 py-4">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {clients.map((c) => (
            <tr key={c.id} className="group transition-colors hover:bg-slate-50/50">
              <td className="px-6 py-4">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={selectedIds.has(c.id)}
                  onChange={() => onToggleSelect(c.id)}
                />
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shadow-sm transition-transform group-hover:scale-110">
                    <WifiIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.username || 'Sin usuario'}</p>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="space-y-1">
                  <p className="font-mono text-xs font-semibold text-slate-700">{c.ip_address || 'Sin IP'}</p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">{c.router_name || 'Sin router'}</p>
                </div>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                    {plans.find((p) => p.id === c.plan_id)?.name || 'Default'}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4">{getStatusBadge(c.status)}</td>
              <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  <button onClick={() => onEdit(c)} className="rounded-lg p-2 text-slate-400 hover:bg-blue-50 hover:text-blue-600">
                    <PlusIcon className="h-4 w-4" />
                  </button>
                  <button onClick={() => onGpon(c)} className="rounded-lg p-2 text-slate-400 hover:bg-violet-50 hover:text-violet-600" title="GPON">
                    <SignalIcon className="h-4 w-4" />
                  </button>
                  <button onClick={() => onPortal(c)} className="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-600" title="Portal">
                    <GlobeAltIcon className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default ClientsTable
