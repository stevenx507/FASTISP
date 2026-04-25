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
    <div ref={ref} className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full">
        <thead className="bg-white/5 border-b border-white/10">
          <tr>
            {columns.map(col => (
              <th
                key={String(col.key)}
                className="px-6 py-3 text-left text-sm font-semibold text-white"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-8 text-center">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/20 border-t-blue-600 rounded-full animate-spin"></div>
                  <span className="text-slate-400">Cargando...</span>
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-8 text-center text-slate-400">
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
                  onRowClick ? 'hover:bg-white/5 cursor-pointer transition' : ''
                }`}
              >
                {columns.map(col => (
                  <td
                    key={`${String(row[keyField])}-${String(col.key)}`}
                    className="px-6 py-4 text-sm text-white"
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
