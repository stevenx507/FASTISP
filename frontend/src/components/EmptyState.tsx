import React from 'react'
import { motion } from 'framer-motion'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-12 text-center"
    >
      {icon && (
        <div className="mb-4 p-4 bg-white/10 rounded-full">
          {React.cloneElement(icon as React.ReactElement, { 
            className: 'w-8 h-8 text-slate-500' 
          })}
        </div>
      )}
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      {description && (
        <p className="mt-1 text-slate-400 text-sm">{description}</p>
      )}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
        >
          {actionLabel}
        </button>
      )}
    </motion.div>
  )
}

export default EmptyState
