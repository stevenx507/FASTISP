import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import AppLayout from '../components/AppLayout'
import { apiClient } from '../lib/apiClient'

interface Invoice {
  id: number
  amount: number
  tax_percent?: number
  total_amount?: number
  currency: string
  due_date: string
  status: string
  method?: string
}

const statusColors: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  active: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  overdue: 'bg-red-100 text-red-700',
  past_due: 'bg-red-100 text-red-700',
  suspended: 'bg-red-100 text-red-700',
}

const BillingPortal: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(false)
  const [paying, setPaying] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiClient.get('/client/portal')
      setInvoices(res?.invoices || [])
    } catch (err) {
      console.error(err)
      toast.error('No se pudieron cargar facturas.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const pay = async (invoiceId: number, amount: number, currency: string) => {
    setPaying(invoiceId)
    try {
      const res = await apiClient.post('/payments/checkout', { invoice_id: invoiceId, amount, currency, method: 'transfer' })
      if (res?.payment_url) {
        window.open(res.payment_url, '_blank')
      }
      toast.success('Pago registrado, pendiente de confirmación.')
      load()
    } catch (err) {
      console.error(err)
      toast.error('No se pudo iniciar el pago.')
    } finally {
      setPaying(null)
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Facturación</h1>
            <p className="text-gray-600">Revisa y paga tus facturas.</p>
          </div>
          <button onClick={load} disabled={loading} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>

        <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-6 px-6 py-3 text-xs font-semibold text-gray-600 bg-gray-50">
            <span>ID</span>
            <span>Monto</span>
            <span>Impuesto</span>
            <span>Total</span>
            <span>Vence</span>
            <span>Estado</span>
          </div>
          <div className="divide-y divide-gray-100">
            {invoices.map((inv) => (
              <motion.div key={inv.id} className="grid grid-cols-6 px-6 py-4 items-center">
                <span className="font-mono text-sm text-gray-900">{inv.id}</span>
                <span className="text-sm text-gray-800">{inv.amount.toFixed(2)} {inv.currency}</span>
                <span className="text-sm text-gray-600">{(inv.tax_percent ?? 0).toFixed(2)}%</span>
                <span className="text-sm font-semibold text-gray-900">{(inv.total_amount ?? inv.amount).toFixed(2)} {inv.currency}</span>
                <span className="text-sm text-gray-600">{inv.due_date}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${statusColors[inv.status] || 'bg-gray-100 text-gray-700'}`}>
                    {inv.status}
                  </span>
                  {inv.status !== 'paid' && (
                    <button
                      onClick={() => pay(inv.id, inv.total_amount ?? inv.amount, inv.currency || 'USD')}
                      disabled={paying === inv.id}
                      className="text-xs px-3 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {paying === inv.id ? 'Procesando...' : 'Pagar'}
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
            {!invoices.length && (
              <div className="px-6 py-8 text-center text-gray-500">No hay facturas pendientes.</div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

export default BillingPortal
