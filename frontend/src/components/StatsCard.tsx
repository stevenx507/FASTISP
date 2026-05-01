import React from 'react'
import { motion } from 'framer-motion'

interface StatsCardProps {
  title: string
  value: string | number
  trend?: number
  icon: React.ReactNode
  color: 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'emerald' | 'cyan' | 'coral'
  subtitle?: string
}

const colorVariants = {
  blue: { bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-600', icon: 'text-blue-500' },
  green: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-600', icon: 'text-emerald-500' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-100', text: 'text-purple-600', icon: 'text-purple-500' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-100', text: 'text-orange-600', icon: 'text-orange-500' },
  red: { bg: 'bg-rose-50', border: 'border-rose-100', text: 'text-rose-600', icon: 'text-rose-500' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-600', icon: 'text-emerald-500' },
  cyan: { bg: 'bg-cyan-50', border: 'border-cyan-100', text: 'text-cyan-600', icon: 'text-cyan-500' },
  coral: { bg: 'bg-white', border: 'border-gray-100', text: 'text-slate-500', icon: 'text-coral-500' }
}

export const StatsCard: React.FC<StatsCardProps> = ({ 
  title, value, trend, icon, color, subtitle 
}) => {
  const colors = colorVariants[color] || colorVariants.coral
  
  return (
    <motion.div
      whileHover={{ y: -4 }}
      className={`bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</p>
          <p className="text-3xl font-black text-slate-800 mt-2">{value}</p>
          {subtitle && <p className="text-xs font-medium text-slate-500 mt-1">{subtitle}</p>}
          {trend !== undefined && trend !== 0 && (
            <div className={`inline-flex items-center gap-1 mt-3 px-2 py-0.5 rounded-full text-[10px] font-bold ${trend > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
            </div>
          )}
        </div>
        <div className={`p-4 rounded-2xl bg-gray-50 ${colors.icon}`}>
          {React.cloneElement(icon as React.ReactElement, { className: 'w-7 h-7' })}
        </div>
      </div>
    </motion.div>
  )
}

export default StatsCard
