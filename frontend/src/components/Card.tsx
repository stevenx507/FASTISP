import React from 'react'
import { motion } from 'framer-motion'

interface CardProps {
  title?: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  hoverable?: boolean
}

export const Card: React.FC<CardProps> = ({
  title,
  description,
  children,
  footer,
  className = '',
  hoverable = false
}) => {
  const Component = hoverable ? motion.div : 'div'

  return (
    <Component
      whileHover={hoverable ? { y: -4 } : undefined}
      className={`bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden ${
        hoverable ? 'transition-shadow hover:shadow-md' : ''
      } ${className}`}
    >
      {(title || description) && (
        <div className="p-6 border-b border-gray-200">
          {title && <h3 className="text-lg font-semibold text-gray-900">{title}</h3>}
          {description && <p className="text-sm text-gray-600 mt-1">{description}</p>}
        </div>
      )}
      <div className="p-6">{children}</div>
      {footer && (
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          {footer}
        </div>
      )}
    </Component>
  )
}

interface CardGridProps {
  children: React.ReactNode
  columns?: 1 | 2 | 3 | 4
}

export const CardGrid: React.FC<CardGridProps> = ({ children, columns = 3 }) => {
  const colClasses = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
  }

  return <div className={`grid ${colClasses[columns]} gap-6`}>{children}</div>
}

export default Card
