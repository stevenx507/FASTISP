import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowDownTrayIcon, CreditCardIcon, CalendarIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { billingApi, InvoiceDTO } from '../lib/billingApi'
import { useAuthStore } from '../store/authStore'
import PaymentProofModal from './PaymentProofModal'

type InvoiceStatus = 'paid' | 'pending' | 'cancelled' | 'overdue'

const statusConfig: Record<InvoiceStatus, { bg: string; text: string; label: string }> = {
  paid: { bg: 'bg-green-100 text-green-800', text: 'text-green-800', label: 'Pagada' },
  pending: { bg: 'bg-yellow-100 text-yellow-800', text: 'text-yellow-800', label: 'Pendiente' },
  overdue: { bg: 'bg-red-100 text-red-800', text: 'text-red-800', label: 'Vencida' },
  cancelled: { bg: 'bg-gray-100 text-gray-700', text: 'text-gray-700', label: 'Cancelada' },
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
        <motion.div whileHover={{ y: -4 }} className="bg-gradient-to-br from-blue-900/30 via-slate-900/40 to-slate-900/80 rounded-xl p-6 border border-white/10 shadow-xl">
          <p className="text-sm font-medium text-blue-100/80">Ingresos Totales</p>
          <p className="text-3xl font-bold text-white mt-2">{formatter.format(totalRevenue)}</p>
          <p className="text-xs text-slate-300 mt-2">{invoices.length} facturas en el período</p>
        </motion.div>

        <motion.div whileHover={{ y: -4 }} className="bg-gradient-to-br from-emerald-900/30 via-slate-900/40 to-slate-900/80 rounded-xl p-6 border border-white/10 shadow-xl">
          <p className="text-sm font-medium text-emerald-100/90">Pagos Recibidos</p>
          <p className="text-3xl font-bold text-white mt-2">{formatter.format(paidRevenue)}</p>
          <p className="text-xs text-slate-300 mt-2">{invoices.filter((i) => i.status === 'paid').length} facturas pagadas</p>
        </motion.div>

        <motion.div whileHover={{ y: -4 }} className="bg-gradient-to-br from-amber-900/30 via-slate-900/40 to-slate-900/80 rounded-xl p-6 border border-white/10 shadow-xl">
          <p className="text-sm font-medium text-amber-100/90">Pendiente de Cobranza</p>
          <p className="text-3xl font-bold text-white mt-2">{formatter.format(pendingRevenue)}</p>
          <p className="text-xs text-slate-300 mt-2">
            {invoices.filter((i) => i.status === 'pending' || i.status === 'overdue').length} facturas pendientes
          </p>
        </motion.div>
      </div>

      {/* Invoices Table */}
      <div className="rounded-xl border border-white/10 bg-slate-900/70 shadow-xl backdrop-blur">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">Facturas</h2>
            <p className="text-sm text-slate-300">Portal de {user?.email}</p>
          </div>
          <div className="flex gap-2">
            {(['all', 'paid', 'pending', 'overdue'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                  filterStatus === status ? 'bg-cyan-500 text-white shadow' : 'bg-white/10 text-slate-200 hover:bg-white/20'
                }`}
              >
                {status === 'all' ? 'Todas' : status === 'paid' ? 'Pagadas' : status === 'pending' ? 'Pendientes' : 'Vencidas'}
              </button>
            ))}
          </div>
        </div>

        {isLoading && (
          <div className="p-6 text-slate-200 text-sm flex items-center gap-2">
            <div className="h-4 w-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            Cargando facturas...
          </div>
        )}
        {error && !isLoading && (
          <div className="p-6 text-amber-200 text-sm flex items-center gap-2 bg-amber-900/30 border-t border-amber-500/40">
            <ExclamationTriangleIcon className="w-5 h-5" />
            {error}
          </div>
        )}

        {!isLoading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full text-slate-100">
              <thead className="bg-white/5 border-b border-white/10">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide">Factura</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide">Monto</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide">Emisión</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide">Vencimiento</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide">Estado</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredInvoices.map((inv, i) => (
                  <motion.tr key={inv.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} className="hover:bg-white/5">
                    <td className="px-6 py-4 text-sm font-medium">INV-{inv.id.toString().padStart(5, '0')}</td>
                    <td className="px-6 py-4 text-sm">{formatter.format(inv.total_amount)}</td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-1 text-slate-200">
                        <CalendarIcon className="w-4 h-4 text-slate-400" />
                        {inv.created_at ? new Date(inv.created_at).toLocaleDateString('es-ES') : '—'}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-1 text-slate-200">
                        <CalendarIcon className="w-4 h-4 text-slate-400" />
                        {inv.due_date ? new Date(inv.due_date).toLocaleDateString('es-ES') : '—'}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusConfig[inv.status as InvoiceStatus]?.bg || 'bg-white/10 text-slate-100'}`}>
                        {statusConfig[inv.status as InvoiceStatus]?.label || inv.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm flex gap-2">
                      <button className="text-cyan-300 hover:text-white font-semibold flex items-center gap-1">
                        <ArrowDownTrayIcon className="w-4 h-4" />
                        Descargar
                      </button>
                      {mode === 'admin' && (
                        <button
                          onClick={() => {
                            setSelectedInvoice(inv.id)
                            setShowProof(true)
                          }}
                          className="text-emerald-300 hover:text-white font-semibold"
                        >
                          Registrar pago
                        </button>
                      )}
                    </td>
                  </motion.tr>
                ))}
                {filteredInvoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-slate-300 text-sm">
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
