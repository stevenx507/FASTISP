import React from 'react'
import { motion } from 'framer-motion'

type StatusType = 'active' | 'inactive' | 'pending' | 'error' | 'success' | 'warning'

interface StatusBadgeProps {
  status: StatusType
  label?: string
  size?: 'sm' | 'md' | 'lg'
}

const statusConfig = {
  active: { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  inactive: { bg: 'bg-gray-100', text: 'text-gray-800', dot: 'bg-gray-500' },
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-500' },
  error: { bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-500' },
  success: { bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  warning: { bg: 'bg-orange-100', text: 'text-orange-800', dot: 'bg-orange-500' }
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
      className={`inline-flex items-center gap-2 rounded-full font-medium ${config.bg} ${config.text} ${sizeClasses[size]}`}
    >
      <span className={`w-2 h-2 rounded-full ${config.dot}`}></span>
      {label || statusLabel[status]}
    </motion.span>
  )
}

export default StatusBadge
