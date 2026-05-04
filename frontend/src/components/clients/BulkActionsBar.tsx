import React from 'react'
import {
  XMarkIcon,
  NoSymbolIcon,
  TrashIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'

interface Props {
  selectedCount: number
  onClear: () => void
  onSuspend: () => void
  onActivate: () => void
  onDelete: () => void
}

const BulkActionsBar: React.FC<Props> = ({
  selectedCount,
  onClear,
  onSuspend,
  onActivate,
  onDelete,
}) => {
  if (selectedCount === 0) return null

  return (
    <div className="fixed bottom-8 left-1/2 z-[100] -translate-x-1/2 flex items-center gap-6 rounded-2xl bg-slate-900 px-6 py-4 shadow-2xl ring-1 ring-white/10">
      <div className="flex items-center gap-3 border-r border-white/10 pr-6">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
          {selectedCount}
        </span>
        <span className="text-sm font-bold text-white">Clientes seleccionados</span>
        <button onClick={onClear} className="ml-2 rounded-full p-1 hover:bg-white/10">
          <XMarkIcon className="h-4 w-4 text-slate-400" />
        </button>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={onActivate}
          className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-400 transition-all hover:bg-emerald-500 hover:text-white"
        >
          <ArrowPathIcon className="h-4 w-4" /> Activar
        </button>
        <button
          onClick={onSuspend}
          className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-400 transition-all hover:bg-amber-500 hover:text-white"
        >
          <NoSymbolIcon className="h-4 w-4" /> Suspender
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-2 rounded-xl bg-rose-500/10 px-4 py-2 text-xs font-bold text-rose-400 transition-all hover:bg-rose-500 hover:text-white"
        >
          <TrashIcon className="h-4 w-4" /> Eliminar
        </button>
      </div>
    </div>
  )
}

export default BulkActionsBar
