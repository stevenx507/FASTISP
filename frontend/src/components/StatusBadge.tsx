import React from 'react'
import { motion } from 'framer-motion'

type StatusType = 'active' | 'inactive' | 'pending' | 'error' | 'success' | 'warning'

interface StatusBadgeProps {
  status: StatusType
  label?: string
  size?: 'sm' | 'md' | 'lg'
}

const statusConfig = {
  active: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  inactive: { bg: 'bg-gray-100', text: 'text-slate-600', dot: 'bg-gray-400' },
  pending: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  error: { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
  success: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  warning: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' }
}

const statusLabel = {
  active: 'Activo',
  inactive: 'Inactivo',
  pending: 'Pendiente',
  error: 'Error',
  success: 'Exitoso',
  warning: 'Advertencia'
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ 
  status, 
  label, 
  size = 'md' 
}) => {
  const config = statusConfig[status]
  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-2 text-base'
  }

  return (
    <motion.span
      whileHover={{ scale: 1.05 }}
      className={`inline-flex items-center gap-2 rounded-full font-bold ${config.bg} ${config.text} ${sizeClasses[size]}`}
    >
      <span className={`w-2 h-2 rounded-full ${config.dot}`}></span>
      {label || statusLabel[status]}
    </motion.span>
  )
}

export default StatusBadge
