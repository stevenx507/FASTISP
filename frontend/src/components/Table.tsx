import React from 'react'
import { motion } from 'framer-motion'

interface TableProps<T> {
  columns: {
    key: keyof T
    label: string
    render?: (value: T[keyof T], row: T) => React.ReactNode
  }[]
  data: T[]
  keyField: keyof T
  onRowClick?: (row: T) => void
  isLoading?: boolean
  emptyMessage?: string
}

export const Table = React.forwardRef<HTMLDivElement, TableProps<any>>(({
  columns,
  data,
  keyField,
  onRowClick,
  isLoading = false,
  emptyMessage = 'No hay datos disponibles'
}, ref) => {
  return (
    <div ref={ref} className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            {columns.map(col => (
              <th
                key={String(col.key)}
                className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-8 text-center">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-gray-200 border-t-coral-500 rounded-full animate-spin"></div>
                  <span className="text-slate-500">Cargando...</span>
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-8 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIdx) => (
              <motion.tr
                key={String(row[keyField])}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: rowIdx * 0.05 }}
                onClick={() => onRowClick?.(row)}
                className={`${
                  onRowClick ? 'hover:bg-gray-50 cursor-pointer transition' : ''
                }`}
              >
                {columns.map(col => (
                  <td
                    key={`${String(row[keyField])}-${String(col.key)}`}
                    className="px-6 py-4 text-sm text-slate-700"
                  >
                    {col.render ? col.render(row[col.key], row) : String(row[col.key])}
                  </td>
                ))}
              </motion.tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
})

Table.displayName = 'Table'

export default Table
