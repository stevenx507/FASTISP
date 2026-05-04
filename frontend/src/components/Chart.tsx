import React from 'react'
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
  const maxValue = Math.max(...data.map(d => d.value), 1)
  const scale = height / maxValue
  
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6">{title}</h3>
      <svg width="100%" height={height + 40} viewBox={`0 0 ${data.length * 60} ${height + 40}`} preserveAspectRatio="none">
        {showGrid && (
          <>
            {[0, 25, 50, 75, 100].map((y) => (
              <line
                key={`grid-${y}`}
                x1="0"
                y1={height - (height * y) / 100}
                x2={data.length * 60}
                y2={height - (height * y) / 100}
                stroke="#f3f4f6"
                strokeWidth="1"
              />
            ))}
          </>
        )}

        {/* Gradient Area */}
        <defs>
          <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF6961" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#FF6961" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <path
          d={`M ${20},${height} ` + data.map((d, i) => `L ${i * 60 + 20},${height - d.value * scale}`).join(' ') + ` L ${(data.length - 1) * 60 + 20},${height} Z`}
          fill="url(#lineGradient)"
        />

        {/* Lines */}
        <polyline
          points={data
            .map((d, i) => `${i * 60 + 20},${height - d.value * scale}`)
            .join(' ')}
          fill="none"
          stroke="#FF6961"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Points */}
        {data.map((d, i) => (
          <motion.circle
            key={`point-${i}`}
            initial={{ r: 0 }}
            animate={{ r: 4 }}
            cx={i * 60 + 20}
            cy={height - d.value * scale}
            fill="#FF6961"
            stroke="white"
            strokeWidth="2"
          />
        ))}

        {/* Labels */}
        {data.map((d, i) => (
          <text
            key={`label-${i}`}
            x={i * 60 + 20}
            y={height + 25}
            textAnchor="middle"
            fontSize="10"
            fontWeight="700"
            fill="#94a3b8"
            className="uppercase tracking-tighter"
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
  const maxValue = Math.max(...data.map(d => d.value), 1)
  
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-6">{title}</h3>
      <div className="space-y-4">
        {data.map((d, i) => (
          <div key={i}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-slate-600">{d.label}</span>
              {showValues && <span className="text-xs font-black text-slate-500">{d.value}%</span>}
            </div>
            <div className="w-full bg-gray-50 rounded-full h-2 overflow-hidden border border-gray-100">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(d.value / maxValue) * 100}%` }}
                className={`h-full rounded-full ${d.color?.includes('bg-') ? d.color : 'bg-coral-400'}`}
                transition={{ duration: 0.8, delay: i * 0.1 }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default LineChart
