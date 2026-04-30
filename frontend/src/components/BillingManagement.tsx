import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowDownTrayIcon, CreditCardIcon, CalendarIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { billingApi, InvoiceDTO } from '../lib/billingApi'
import { useAuthStore } from '../store/authStore'
import PaymentProofModal from './PaymentProofModal'

type InvoiceStatus = 'paid' | 'pending' | 'cancelled' | 'overdue'

const statusConfig: Record<InvoiceStatus, { bg: string; text: string; label: string }> = {
  paid: { bg: 'bg-emerald-50 text-emerald-700 border-emerald-100', text: 'text-emerald-700', label: 'Pagada' },
  pending: { bg: 'bg-amber-50 text-amber-700 border-amber-100', text: 'text-amber-700', label: 'Pendiente' },
  overdue: { bg: 'bg-rose-50 text-rose-700 border-rose-100', text: 'text-rose-700', label: 'Vencida' },
  cancelled: { bg: 'bg-slate-100 text-slate-600 border-slate-200', text: 'text-slate-600', label: 'Cancelada' },
}

interface Props {
  onSelectInvoice?: (invoiceId: number) => void
  mode?: 'client' | 'admin'
}

const BillingManagement: React.FC<Props> = ({ onSelectInvoice, mode = 'client' }) => {
  const [filterStatus, setFilterStatus] = useState<'all' | InvoiceStatus>('all')
  const [invoices, setInvoices] = useState<InvoiceDTO[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { user } = useAuthStore()
  const [showProof, setShowProof] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<number | null>(null)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const resp = await billingApi.listClientInvoices()
        setInvoices(resp.items || [])
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudieron cargar las facturas'
        setError(msg)
        toast.error(msg)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const filteredInvoices = useMemo(
    () => invoices.filter((inv) => filterStatus === 'all' || (inv.status as InvoiceStatus) === filterStatus),
    [invoices, filterStatus]
  )

  const totalRevenue = useMemo(() => invoices.reduce((sum, inv) => sum + inv.total_amount, 0), [invoices])
  const paidRevenue = useMemo(() => invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.total_amount, 0), [invoices])
  const pendingRevenue = useMemo(
    () => invoices.filter((i) => i.status === 'pending' || i.status === 'overdue').reduce((s, i) => s + i.total_amount, 0),
    [invoices]
  )

  const formatter = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'USD' })

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div whileHover={{ y: -4 }} className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
          <p className="text-sm font-medium text-slate-700">Ingresos Totales</p>
          <p className="text-3xl font-bold text-slate-900 mt-2">{formatter.format(totalRevenue)}</p>
          <p className="text-xs text-slate-600 mt-2">{invoices.length} facturas en el período</p>
        </motion.div>

        <motion.div whileHover={{ y: -4 }} className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
          <p className="text-sm font-medium text-emerald-600">Pagos Recibidos</p>
          <p className="text-3xl font-bold text-slate-900 mt-2">{formatter.format(paidRevenue)}</p>
          <p className="text-xs text-slate-600 mt-2">{invoices.filter((i) => i.status === 'paid').length} facturas pagadas</p>
        </motion.div>

        <motion.div whileHover={{ y: -4 }} className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
          <p className="text-sm font-medium text-amber-600">Pendiente de Cobranza</p>
          <p className="text-3xl font-bold text-slate-900 mt-2">{formatter.format(pendingRevenue)}</p>
          <p className="text-xs text-slate-600 mt-2">
            {invoices.filter((i) => i.status === 'pending' || i.status === 'overdue').length} facturas pendientes
          </p>
        </motion.div>
      </div>

      {/* Invoices Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Facturas</h2>
            <p className="text-sm text-slate-700">Portal de {user?.email}</p>
          </div>
          <div className="flex gap-2">
            {(['all', 'paid', 'pending', 'overdue'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                  filterStatus === status ? 'bg-coral-500 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {status === 'all' ? 'Todas' : status === 'paid' ? 'Pagadas' : status === 'pending' ? 'Pendientes' : 'Vencidas'}
              </button>
            ))}
          </div>
        </div>

        {isLoading && (
          <div className="p-6 text-slate-600 text-sm flex items-center gap-2">
            <div className="h-4 w-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            Cargando facturas...
          </div>
        )}
        {error && !isLoading && (
          <div className="p-6 text-amber-700 text-sm flex items-center gap-2 bg-amber-50 border-t border-amber-100">
            <ExclamationTriangleIcon className="w-5 h-5" />
            {error}
          </div>
        )}

        {!isLoading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full text-slate-800">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide">Factura</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide">Monto</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide">Emisión</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide">Vencimiento</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide">Estado</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvoices.map((inv, i) => (
                  <motion.tr key={inv.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="hover:bg-slate-50/50">
                    <td className="px-6 py-4 text-sm font-medium">INV-{inv.id.toString().padStart(5, '0')}</td>
                    <td className="px-6 py-4 text-sm">{formatter.format(inv.total_amount)}</td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-1 text-slate-700">
                        <CalendarIcon className="w-4 h-4 text-slate-600" />
                        {inv.created_at ? new Date(inv.created_at).toLocaleDateString('es-ES') : '—'}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-1 text-slate-700">
                        <CalendarIcon className="w-4 h-4 text-slate-600" />
                        {inv.due_date ? new Date(inv.due_date).toLocaleDateString('es-ES') : '—'}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${statusConfig[inv.status as InvoiceStatus]?.bg || 'bg-slate-100 text-slate-600'}`}>
                        {statusConfig[inv.status as InvoiceStatus]?.label || inv.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm flex gap-2">
                      <button 
                        onClick={async () => {
                          try {
                            const url = `${import.meta.env.VITE_API_URL || '/api'}/billing/invoices/${inv.id}/pdf`
                            // FIX #4: Usar token del store en lugar de localStorage('token')
                            const token = useAuthStore.getState().token || ''
                            const response = await fetch(url, {
                              headers: {
                                'Authorization': `Bearer ${token}`
                              }
                            })
                            if (!response.ok) throw new Error('Error al descargar PDF')
                            const blob = await response.blob()
                            const downloadUrl = window.URL.createObjectURL(blob)
                            const link = document.createElement('a')
                            link.href = downloadUrl
                            link.setAttribute('download', `Factura_ISPMAX_${inv.id}.pdf`)
                            document.body.appendChild(link)
                            link.click()
                            link.remove()
                          } catch (err) {
                            toast.error('No se pudo descargar la factura')
                          }
                        }}
                        className="text-coral-500 hover:text-coral-600 font-semibold flex items-center gap-1"
                      >
                        <ArrowDownTrayIcon className="w-4 h-4" />
                        PDF
                      </button>
                      {mode === 'admin' && (
                        <button
                          onClick={() => {
                            setSelectedInvoice(inv.id)
                            setShowProof(true)
                          }}
                          className="text-emerald-600 hover:text-emerald-700 font-semibold"
                        >
                          Registrar pago
                        </button>
                      )}
                    </td>
                  </motion.tr>
                ))}
                {filteredInvoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-slate-500 text-sm">
                      No hay facturas en este estado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>

      <PaymentProofModal
        invoiceId={selectedInvoice}
        open={showProof}
        onClose={() => setShowProof(false)}
        onSaved={() => {
          setShowProof(false)
          setIsLoading(true)
          billingApi
            .listClientInvoices()
            .then((resp) => setInvoices(resp.items || []))
            .finally(() => setIsLoading(false))
        }}
      />
    </>
  )
}

export default BillingManagement
