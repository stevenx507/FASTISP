import React from 'react'
import { motion } from 'framer-motion'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ 
  size = 'md', 
  label 
}) => {
  const sizeClasses = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-14 h-14'
  }

  const borderSize = {
    sm: 'border-2',
    md: 'border-[3px]',
    lg: 'border-4'
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center gap-4"
    >
      <div className="relative">
        {/* Glow */}
        <div className={`absolute inset-0 ${sizeClasses[size]} bg-coral-400/20 rounded-full blur-lg`} />
        {/* Outer ring */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
          className={`${sizeClasses[size]} ${borderSize[size]} border-gray-100 border-t-coral-500 rounded-full`}
        />
        {/* Inner ring */}
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
          className={`absolute inset-1.5 ${borderSize[size]} border-transparent border-b-coral-300 rounded-full`}
        />
      </div>
      {label && (
        <p className="text-sm font-medium text-slate-500">{label}</p>
      )}
    </motion.div>
  )
}

interface SkeletonLoaderProps {
  rows?: number
  className?: string
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({ rows = 3, className = '' }) => (
  <div className={`space-y-4 ${className}`}>
    <div className="skeleton-title" />
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="skeleton-text" style={{ width: `${85 - i * 10}%` }} />
    ))}
  </div>
)

export default LoadingSpinner
