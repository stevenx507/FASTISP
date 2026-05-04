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
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      {icon && (
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
          className="mb-5 relative"
        >
          <div className="absolute inset-0 bg-coral-100/50 rounded-full blur-xl scale-150" />
          <div className="relative p-5 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl border border-gray-100 shadow-sm">
            {React.cloneElement(icon as React.ReactElement, { 
              className: 'w-8 h-8 text-slate-400' 
            })}
          </div>
        </motion.div>
      )}
      <h3 className="text-lg font-black text-slate-800">{title}</h3>
      {description && (
        <p className="mt-2 text-slate-500 text-sm max-w-sm leading-relaxed">{description}</p>
      )}
      {actionLabel && onAction && (
        <motion.button
          whileHover={{ scale: 1.02, y: -1 }}
          whileTap={{ scale: 0.98 }}
          onClick={onAction}
          className="mt-5 px-5 py-2.5 bg-coral-500 text-white rounded-xl hover:bg-coral-600 transition-all text-sm font-bold shadow-sm shadow-coral-500/20"
        >
          {actionLabel}
        </motion.button>
      )}
    </motion.div>
  )
}

export default EmptyState
