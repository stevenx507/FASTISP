import React, { useMemo } from 'react'
import { motion } from 'framer-motion'

interface ChartDataPoint {
  label: string
  value: number
  color?: string
}

interface LineChartProps {
  data: ChartDataPoint[]
  title: string
  height?: number
  showGrid?: boolean
}

export const LineChart: React.FC<LineChartProps> = ({ 
  data, 
  title, 
  height = 200, 
  showGrid = true 
}) => {
  const maxValue = Math.max(...data.map(d => d.value))
  const scale = height / maxValue
  
  return (
    <div className="bg-white rounded-lg p-4 border border-gray-200">
      <h3 className="font-semibold text-gray-900 mb-4">{title}</h3>
      <svg width="100%" height={height + 40} viewBox={`0 0 ${data.length * 40} ${height + 40}`}>
        {showGrid && (
          <>
            {[0, 25, 50, 75, 100].map((y) => (
              <line
                key={`grid-${y}`}
                x1="0"
                y1={height - (height * y) / 100}
                x2={data.length * 40}
                y2={height - (height * y) / 100}
                stroke="#e5e7eb"
                strokeDasharray="4"
              />
            ))}
          </>
        )}

        {/* Lines */}
        <polyline
          points={data
            .map((d, i) => `${i * 40 + 20},${height - d.value * scale}`)
            .join(' ')}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="3"
        />

        {/* Points */}
        {data.map((d, i) => (
          <motion.circle
            key={`point-${i}`}
            initial={{ r: 0 }}
            animate={{ r: 4 }}
            cx={i * 40 + 20}
            cy={height - d.value * scale}
            fill="#3b82f6"
            className="hover:r-6 transition-all"
          />
        ))}

        {/* Labels */}
        {data.map((d, i) => (
          <text
            key={`label-${i}`}
            x={i * 40 + 20}
            y={height + 25}
            textAnchor="middle"
            fontSize="12"
            fill="#6b7280"
          >
            {d.label}
          </text>
        ))}
      </svg>
    </div>
  )
}

interface BarChartProps {
  data: ChartDataPoint[]
  title: string
  showValues?: boolean
}

export const BarChart: React.FC<BarChartProps> = ({ data, title, showValues = true }) => {
  const maxValue = Math.max(...data.map(d => d.value))
  
  return (
    <div className="bg-white rounded-lg p-4 border border-gray-200">
      <h3 className="font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="space-y-3">
        {data.map((d, i) => (
          <motion.div key={i} initial={{ width: 0 }} animate={{ width: '100%' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700">{d.label}</span>
              {showValues && <span className="text-sm text-gray-600">{d.value}%</span>}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(d.value / maxValue) * 100}%` }}
                className={`h-3 rounded-full ${d.color || 'bg-blue-600'}`}
                transition={{ duration: 0.8, delay: i * 0.1 }}
              />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

export default LineChart
