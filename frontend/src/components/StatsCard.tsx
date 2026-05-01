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
  blue: { bg: 'bg-blue-50', border: 'border-blue-100', icon: 'bg-blue-100 text-blue-600', glow: 'from-blue-100/60' },
  green: { bg: 'bg-emerald-50', border: 'border-emerald-100', icon: 'bg-emerald-100 text-emerald-600', glow: 'from-emerald-100/60' },
  purple: { bg: 'bg-purple-50', border: 'border-purple-100', icon: 'bg-purple-100 text-purple-600', glow: 'from-purple-100/60' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-100', icon: 'bg-orange-100 text-orange-600', glow: 'from-orange-100/60' },
  red: { bg: 'bg-rose-50', border: 'border-rose-100', icon: 'bg-rose-100 text-rose-600', glow: 'from-rose-100/60' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100', icon: 'bg-emerald-100 text-emerald-600', glow: 'from-emerald-100/60' },
  cyan: { bg: 'bg-cyan-50', border: 'border-cyan-100', icon: 'bg-cyan-100 text-cyan-600', glow: 'from-cyan-100/60' },
  coral: { bg: 'bg-white', border: 'border-gray-100', icon: 'bg-coral-50 text-coral-500', glow: 'from-coral-100/60' }
}

export const StatsCard: React.FC<StatsCardProps> = ({ 
  title, value, trend, icon, color, subtitle 
}) => {
  const colors = colorVariants[color] || colorVariants.coral
  
  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="relative bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden"
    >
      {/* Decorative gradient glow */}
      <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl ${colors.glow} to-transparent rounded-bl-full opacity-60 pointer-events-none`} />
      
      <div className="relative flex items-center justify-between">
        <div className="flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">{title}</p>
          <p className="text-3xl font-black text-slate-800 mt-2 tracking-tight">{value}</p>
          {subtitle && <p className="text-xs font-medium text-slate-500 mt-1">{subtitle}</p>}
          {trend !== undefined && trend !== 0 && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className={`inline-flex items-center gap-1 mt-3 px-2.5 py-0.5 rounded-full text-[10px] font-black ${trend > 0 ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100'}`}
            >
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
            </motion.div>
          )}
        </div>
        <div className={`p-3.5 rounded-2xl ${colors.icon}`}>
          {React.cloneElement(icon as React.ReactElement, { className: 'w-7 h-7' })}
        </div>
      </div>
    </motion.div>
  )
}

export default StatsCard
