import React, { useEffect, useMemo, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'

interface FinanceSummary {
  mrr: number
  arr: number
  pending_balance: number
  overdue_balance: number
  paid_this_month: number
  pending_this_month: number
  collection_rate: number
  subscriptions_total: number
  invoices_total: number
  overdue_clients: number
  suspended_clients: number
}

interface AgingBuckets {
  current: number
  days_1_30: number
  days_31_60: number
  days_61_90: number
  days_90_plus: number
}

interface CashflowRow {
  label: string
  paid: number
  pending: number
}

interface DebtorRow {
  subscription_id: number
  customer: string
  amount: number
  status: string
  next_charge?: string | null
}

interface InvoiceRow {
  id: number
  customer?: string | null
  status: string
  currency: string
  amount: number
  total_amount: number
  due_date?: string | null
  created_at?: string | null
}

const FinanceView: React.FC = () => {
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [aging, setAging] = useState<AgingBuckets | null>(null)
  const [cashflow, setCashflow] = useState<CashflowRow[]>([])
  const [debtors, setDebtors] = useState<DebtorRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [runningJob, setRunningJob] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const response = await apiClient.get('/admin/finance/summary')
      setSummary((response.summary || null) as FinanceSummary | null)
      setAging((response.aging || null) as AgingBuckets | null)
      setCashflow((response.cashflow || []) as CashflowRow[])
      setDebtors((response.top_debtors || []) as DebtorRow[])
      setInvoices((response.recent_invoices || []) as InvoiceRow[])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo cargar finanzas'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const runRecalcBalances = async () => {
    setRunningJob(true)
    try {
      await apiClient.post('/admin/system/jobs/run', { job: 'recalc_balances' })
      toast.success('Recalculo de balances lanzado')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo lanzar el job'
      toast.error(msg)
    } finally {
      setRunningJob(false)
    }
  }

  const maxCashflow = useMemo(() => {
    if (!cashflow.length) return 1
    return Math.max(...cashflow.map((row) => Math.max(row.paid, row.pending)))
  }, [cashflow])

  const agingItems = aging
    ? [
        { label: 'Current', value: aging.current },
        { label: '1-30d', value: aging.days_1_30 },
        { label: '31-60d', value: aging.days_31_60 },
        { label: '61-90d', value: aging.days_61_90 },
        { label: '90+d', value: aging.days_90_plus },
      ]
    : []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Finanzas</h2>
          <p className="text-sm text-gray-600">Cartera, cobranza, aging e indicadores operativos de facturacion.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runRecalcBalances}
            disabled={runningJob}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {runningJob ? 'Ejecutando...' : 'Recalcular balances'}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-xs font-semibold uppercase text-emerald-700">MRR</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">${summary?.mrr ?? 0}</p>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs font-semibold uppercase text-blue-700">ARR</p>
          <p className="mt-2 text-2xl font-bold text-blue-900">${summary?.arr ?? 0}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase text-amber-700">Pendiente</p>
          <p className="mt-2 text-2xl font-bold text-amber-900">${summary?.pending_balance ?? 0}</p>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-4">
          <p className="text-xs font-semibold uppercase text-red-700">Vencido</p>
          <p className="mt-2 text-2xl font-bold text-red-900">${summary?.overdue_balance ?? 0}</p>
        </div>
        <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
          <p className="text-xs font-semibold uppercase text-violet-700">Cobranza Mes</p>
          <p className="mt-2 text-2xl font-bold text-violet-900">${summary?.paid_this_month ?? 0}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase text-slate-700">Collection Rate</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{summary?.collection_rate?.toFixed(1) ?? '0.0'}%</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-gray-900">Aging de cartera</h3>
          <div className="mt-4 space-y-3">
            {agingItems.map((row) => (
              <div key={row.label} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{row.label}</span>
                <span className="font-semibold text-gray-900">${row.value.toFixed(2)}</span>
              </div>
            ))}
            {!agingItems.length && <p className="text-sm text-gray-500">Sin datos de aging.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm xl:col-span-2">
          <h3 className="font-semibold text-gray-900">Cashflow 6 meses</h3>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cashflow.map((row) => (
              <div key={row.label} className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs font-semibold uppercase text-gray-500">{row.label}</p>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-600">
                    <span>Paid</span>
                    <span>${row.paid.toFixed(2)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100">
                    <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(row.paid / maxCashflow) * 100}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-600">
                    <span>Pending</span>
                    <span>${row.pending.toFixed(2)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100">
                    <div className="h-2 rounded-full bg-amber-500" style={{ width: `${(row.pending / maxCashflow) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
            {!cashflow.length && <p className="text-sm text-gray-500">Sin datos de cashflow.</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-gray-900">Top deudores</h3>
          <div className="mt-3 space-y-2">
            {debtors.map((debtor) => (
              <div key={debtor.subscription_id} className="rounded-md border border-gray-200 p-3">
                <p className="font-medium text-gray-900">{debtor.customer}</p>
                <p className="text-xs text-gray-500">
                  #{debtor.subscription_id} | {debtor.status} | ${debtor.amount.toFixed(2)}
                </p>
              </div>
            ))}
            {!debtors.length && <p className="text-sm text-gray-500">Sin deudores en riesgo.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm xl:col-span-2">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-semibold text-gray-900">Facturas recientes</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-left">Vence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">#{invoice.id}</td>
                    <td className="px-4 py-3 text-gray-900">{invoice.customer || 'N/A'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          invoice.status === 'paid'
                            ? 'bg-emerald-100 text-emerald-700'
                            : invoice.status === 'pending'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {invoice.currency} {invoice.total_amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{invoice.due_date || '-'}</td>
                  </tr>
                ))}
                {!invoices.length && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-gray-500" colSpan={5}>
                      Sin facturas recientes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FinanceView
