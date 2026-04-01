import React from 'react'
import { motion } from 'framer-motion'
import AppLayout from '../components/AppLayout'
import UsageDetails from '../components/UsageDetails'

const ClientUsage: React.FC = () => {
  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Uso de datos</h1>
          <p className="mt-2 text-sm text-gray-300">
            Revisa tu consumo historico y detecta tendencias de uso.
          </p>
        </div>

        <UsageDetails />
      </motion.div>
    </AppLayout>
  )
}

export default ClientUsage
