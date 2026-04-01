import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { billingApi } from '../../lib/billingApi'

interface Props {
  invoiceId: number | null
  open: boolean
  onClose: () => void
  onSaved: () => void
}

const ManualPaymentModal: React.FC<Props> = ({ invoiceId, open, onClose, onSaved }) => {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('transfer')
  const [reference, setReference] = useState('')
  const [loading, setLoading] = useState(false)

  if (!open || invoiceId === null) return null

  const submit = async () => {
    const amt = parseFloat(amount)
    if (Number.isNaN(amt) || amt <= 0) {
      toast.error('Monto inválido')
      return
    }
    setLoading(true)
    try {
      await billingApi.manualPayment(invoiceId, amt, method, reference || undefined)
      toast.success('Pago registrado')
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo registrar el pago')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur">
      <div className="bg-slate-900/90 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 text-slate-50">
        <h3 className="text-xl font-semibold mb-4">Registrar pago manual</h3>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-slate-200">Monto</label>
            <input
              type="number"
              step="0.01"
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-slate-100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm text-slate-200">Método</label>
            <select
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-slate-100"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="transfer">Transferencia</option>
              <option value="yape">Yape</option>
              <option value="nequi">Nequi</option>
              <option value="cash">Efectivo</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-200">Referencia / comprobante</label>
            <input
              type="text"
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-slate-100"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="OP-123, imagen en drive, etc."
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/10 text-slate-200 hover:bg-white/20">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-semibold hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? 'Guardando...' : 'Registrar pago'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ManualPaymentModal
