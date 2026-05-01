import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ServerIcon, DevicePhoneMobileIcon, HomeIcon, CpuChipIcon } from '@heroicons/react/24/outline'
import { apiClient } from '../../lib/apiClient'

interface TopologyNode {
  id: string
  type: 'router' | 'nap' | 'client' | string
  label: string
  status: string
}

interface TopologyEdge {
  from: string
  to: string
}

const NetworkTopology: React.FC = () => {
  const [data, setData] = useState<{ nodes: TopologyNode[]; edges: TopologyEdge[] } | null>(null)
  const [loading, setLoading] = useState(true)

  const loadTopology = async () => {
    try {
      const res = await apiClient.get('/network/topology')
      setData(res)
    } catch (err) {
      console.error('Topology failed', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTopology()
  }, [])

  const getNodeIcon = (type: string) => {
    switch (type) {
      case 'router': return <ServerIcon className="h-6 w-6 text-cyan-400" />
      case 'client': return <DevicePhoneMobileIcon className="h-5 w-5 text-emerald-400" />
      case 'nap': return <CpuChipIcon className="h-6 w-6 text-amber-400" />
      default: return <HomeIcon className="h-5 w-5 text-slate-500" />
    }
  }

  if (loading) return <div className="p-12 text-center text-slate-500 animate-pulse font-bold">Cargando Topología de Red...</div>

  // Renderizado simplificado tipo "Árbol" por capas
  const rootRouters = data?.nodes.filter(n => n.type === 'router') || []

  return (
    <div className="space-y-12 py-4">
      {rootRouters.map(router => (
        <div key={router.id} className="space-y-8">
          {/* Router Nivel 1 */}
          <div className="flex justify-center">
            <motion.div 
              initial={{ scale: 0 }} 
              animate={{ scale: 1 }}
              className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-gray-50 border border-cyan-500/30 shadow-lg shadow-cyan-500/10"
            >
              {getNodeIcon('router')}
              <span className="text-xs font-black text-white uppercase">{router.label}</span>
            </motion.div>
          </div>

          {/* Hijos (Nodos/NAPs) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {data?.edges.filter(e => e.from === router.id).map(edge => {
              const node = data?.nodes.find(n => n.id === edge.to)
              if (!node) return null
              
              const clients = data?.edges.filter(e => e.from === node.id)

              return (
                <div key={node.id} className="space-y-6">
                  <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-gray-50 border border-amber-500/20">
                    {getNodeIcon(node.type)}
                    <span className="text-[10px] font-bold text-slate-600 uppercase">{node.label}</span>
                  </div>

                  {/* Clientes Nivel 3 */}
                  <div className="flex flex-wrap justify-center gap-3 px-4">
                    {clients?.map(cEdge => {
                      const client = data?.nodes.find(n => n.id === cEdge.to)
                      return (
                        <motion.div 
                          key={cEdge.to}
                          whileHover={{ y: -5 }}
                          className="p-2 rounded-lg bg-white border border-white/5 flex flex-col items-center gap-1"
                          title={client?.label}
                        >
                          {getNodeIcon('client')}
                          <span className="text-[8px] font-medium text-slate-500">#{client?.id.split('_')[1]}</span>
                        </motion.div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default NetworkTopology
