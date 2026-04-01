import React from 'react'
import { motion } from 'framer-motion'
import AppLayout from '../components/AppLayout'
import SupportChat from '../components/SupportChat'

const ClientSupport: React.FC = () => {
  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Centro de soporte</h1>
          <p className="mt-2 text-sm text-gray-300">
            Ejecuta diagnostico de red, crea tickets y da seguimiento a tus incidencias.
          </p>
        </div>

        <SupportChat />
      </motion.div>
    </AppLayout>
  )
}

export default ClientSupport
