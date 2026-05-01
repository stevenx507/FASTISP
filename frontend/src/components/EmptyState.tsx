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
        <div className="mb-4 p-4 bg-gray-100 rounded-2xl">
          {React.cloneElement(icon as React.ReactElement, { 
            className: 'w-8 h-8 text-slate-500' 
          })}
        </div>
      )}
      <h3 className="text-lg font-bold text-slate-800">{title}</h3>
      {description && (
        <p className="mt-1 text-slate-500 text-sm">{description}</p>
      )}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-4 px-4 py-2 bg-coral-500 text-white rounded-xl hover:bg-coral-600 transition text-sm font-bold shadow-md shadow-coral-500/20"
        >
          {actionLabel}
        </button>
      )}
    </motion.div>
  )
}

export default EmptyState
