import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  isDangerous?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  isDangerous = false,
  onConfirm,
  onCancel
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white/5 backdrop-blur-md rounded-lg shadow-xl max-w-sm w-full mx-4 z-50"
          >
            <div className="p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {isDangerous && (
                    <div className="p-2 bg-rose-500/20 rounded-full">
                      <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
                    </div>
                  )}
                  <h2 className="text-lg font-semibold text-white">{title}</h2>
                </div>
                <button
                  onClick={onCancel}
                  className="p-1 hover:bg-white/10 rounded-lg transition"
                >
                  <XMarkIcon className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              {/* Message */}
              <p className={`text-sm ${isDangerous ? 'text-rose-400' : 'text-slate-400'} mb-6`}>
                {message}
              </p>

              {/* Actions */}
              <div className="flex gap-3 justify-end">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-slate-300 bg-white/10 rounded-lg hover:bg-white/15 transition font-medium"
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  className={`px-4 py-2 text-white rounded-lg transition font-medium ${
                    isDangerous
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export default ConfirmDialog
