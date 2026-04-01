import React from 'react'
import { motion } from 'framer-motion'

interface StatsCardProps {
  title: string
  value: string | number
  trend?: number
  icon: React.ReactNode
  color: 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'emerald' | 'cyan'
  subtitle?: string
}

const colorVariants = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-700', dark: 'text-blue-600', icon: 'text-blue-500' },
  green: { bg: 'bg-green-50', text: 'text-green-700', dark: 'text-green-600', icon: 'text-green-500' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-700', dark: 'text-purple-600', icon: 'text-purple-500' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-700', dark: 'text-orange-600', icon: 'text-orange-500' },
  red: { bg: 'bg-red-50', text: 'text-red-700', dark: 'text-red-600', icon: 'text-red-500' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', dark: 'text-emerald-600', icon: 'text-emerald-500' },
  cyan: { bg: 'bg-cyan-50', text: 'text-cyan-700', dark: 'text-cyan-600', icon: 'text-cyan-500' }
}

export const StatsCard: React.FC<StatsCardProps> = ({ 
  title, value, trend, icon, color, subtitle 
}) => {
  const colors = colorVariants[color]
  
  return (
    <motion.div
      whileHover={{ y: -4 }}
      className={`${colors.bg} rounded-xl p-6 border-l-4 border-${color}-600 shadow-sm hover:shadow-md transition-all`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className={`text-sm font-medium ${colors.text}`}>{title}</p>
          <p className={`text-3xl font-bold ${colors.dark} mt-2`}>{value}</p>
          {subtitle && <p className="text-xs text-gray-600 mt-1">{subtitle}</p>}
          {trend !== undefined && (
            <p className={`text-xs mt-2 ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% vs mes anterior
            </p>
          )}
        </div>
        <div className={`${colors.icon} p-3`}>
          {React.cloneElement(icon as React.ReactElement, { className: 'w-8 h-8' })}
        </div>
      </div>
    </motion.div>
  )
}

export default StatsCard
