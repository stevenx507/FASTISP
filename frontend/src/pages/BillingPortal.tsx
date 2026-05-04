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
  paid: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  active: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  pending: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  overdue: 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
  past_due: 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
  suspended: 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
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

  const pay = async (invoiceId: number, method: string = 'card') => {
    setPaying(invoiceId)
    try {
      const res = await apiClient.post(`/payments/stripe/create-checkout/${invoiceId}`, { method })
      if (res?.url) {
        window.location.href = res.url
      } else {
        throw new Error('No se recibió URL de pago')
      }
    } catch (err) {
      console.error(err)
      toast.error(`No se pudo iniciar la pasarela de pago (${method}).`)
    } finally {
      setPaying(null)
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Facturación</h1>
            <p className="text-slate-500">Revisa y paga tus facturas.</p>
          </div>
          <button onClick={load} disabled={loading} className="px-4 py-2 rounded-lg bg-blue-600/80 text-white hover:bg-blue-600 transition-colors disabled:opacity-50">
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>

        <div className="bg-white backdrop-blur-md rounded-xl shadow-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-6 px-6 py-4 text-xs font-semibold text-slate-500 bg-black/20 border-b border-gray-200">
            <span>ID</span>
            <span>Monto</span>
            <span>Impuesto</span>
            <span>Total</span>
            <span>Vence</span>
            <span>Estado</span>
          </div>
          <div className="divide-y divide-white/5">
            {invoices.map((inv) => (
              <motion.div key={inv.id} className="grid grid-cols-6 px-6 py-4 items-center hover:bg-white transition-colors">
                <span className="font-mono text-sm text-white">#{inv.id}</span>
                <span className="text-sm text-slate-600">{inv.amount.toFixed(2)} {inv.currency}</span>
                <span className="text-sm text-slate-500">{(inv.tax_percent ?? 0).toFixed(2)}%</span>
                <span className="text-sm font-semibold text-emerald-400">{(inv.total_amount ?? inv.amount).toFixed(2)} {inv.currency}</span>
                <span className="text-sm text-slate-600">{inv.due_date}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${statusColors[inv.status] || 'bg-slate-500/20 text-slate-600 border border-slate-500/30'}`}>
                    {inv.status}
                  </span>
                  {inv.status !== 'paid' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => pay(inv.id, 'card')}
                        disabled={paying === inv.id}
                        className="group relative inline-flex items-center gap-1 overflow-hidden rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-blue-500 hover:shadow-[0_0_15px_rgba(37,99,235,0.4)] disabled:opacity-50"
                        title="Pagar con Tarjeta de Crédito/Débito"
                      >
                        <span className="relative z-10">Tarjeta</span>
                        <div className="absolute inset-0 z-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-[100%]" />
                      </button>
                      
                      <button
                        onClick={() => pay(inv.id, 'pagoefectivo')}
                        disabled={paying === inv.id}
                        className="group relative inline-flex items-center gap-1 overflow-hidden rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-900 transition-all hover:bg-amber-400 hover:shadow-[0_0_15px_rgba(245,158,11,0.4)] disabled:opacity-50"
                        title="Pagar en Efectivo (Banca Móvil, Agentes, Western Union)"
                      >
                        <span className="relative z-10 font-bold text-black">CIP / Efectivo</span>
                        <div className="absolute inset-0 z-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-500 group-hover:translate-x-[100%]" />
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
            {!invoices.length && (
              <div className="px-6 py-8 text-center text-slate-500">No hay facturas pendientes.</div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

export default BillingPortal
