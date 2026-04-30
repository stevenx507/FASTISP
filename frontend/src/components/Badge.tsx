import React from 'react'
import { motion, type HTMLMotionProps } from 'framer-motion'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const variantStyles = {
  default: 'bg-gray-100 text-slate-600',
  primary: 'bg-coral-50 text-coral-600',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-rose-50 text-rose-700',
  info: 'bg-cyan-50 text-cyan-700'
}

const sizeStyles = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1 text-sm',
  lg: 'px-4 py-2 text-base'
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  className = ''
}) => {
  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`inline-block rounded-full font-bold ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {children}
    </motion.span>
  )
}

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'size' | 'children'> {
  children?: React.ReactNode
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  fullWidth?: boolean
  icon?: React.ReactNode
}

const buttonVariants = {
  primary: 'bg-coral-500 hover:bg-coral-600 text-white shadow-md shadow-coral-500/20',
  secondary: 'bg-gray-100 hover:bg-gray-200 text-slate-700',
  success: 'bg-emerald-500 hover:bg-emerald-600 text-white',
  danger: 'bg-rose-500 hover:bg-rose-600 text-white',
  warning: 'bg-amber-500 hover:bg-amber-600 text-white'
}

const buttonSizes = {
  sm: 'px-3 py-1 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg'
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      disabled={loading || disabled}
      className={`
        flex items-center justify-center gap-2 rounded-xl font-bold transition
        disabled:opacity-50 disabled:cursor-not-allowed
        ${buttonVariants[variant]} ${buttonSizes[size]}
        ${fullWidth ? 'w-full' : ''} ${className}
      `}
      {...props}
    >
      {loading && (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity }}
          className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
        />
      )}
      {icon && !loading && React.cloneElement(icon as React.ReactElement, { className: 'w-5 h-5' })}
      {children}
    </motion.button>
  )
}

export default Badge
