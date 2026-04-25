/**
 * DebtQuery – Consulta pública de deuda por número de documento
 * No requiere login. El cliente ingresa su cédula/RUC/DNI y ve su estado.
 */
import { useState } from 'react'
import { apiClient } from '../../lib/apiClient'

interface PendingInvoice {
  id: number
  amount: number
  due_date: string | null
  status: string
}

interface DebtResult {
  found: boolean
  message?: string
  client_name?: string
  service_status?: 'active' | 'suspended' | 'inactive'
  plan_name?: string | null
  billing_type?: string
  total_debt?: number
  currency?: string
  pending_invoices?: PendingInvoice[]
  next_charge?: string | null
}

interface Props {
  tenantSlug?: string
  /** Si es true, muestra el componente en modo embebido (sin card exterior) */
  embedded?: boolean
}

const statusLabels: Record<string, { label: string; color: string; icon: string }> = {
  active:    { label: 'Activo',    color: 'bg-emerald-500/20 text-emerald-400',  icon: '✅' },
  suspended: { label: 'Suspendido', color: 'bg-rose-500/20 text-rose-400',    icon: '🚫' },
  inactive:  { label: 'Inactivo',  color: 'bg-white/10 text-slate-400',   icon: '⚪' },
}

export default function DebtQuery({ tenantSlug, embedded = false }: Props) {
  const [document, setDocument] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DebtResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleQuery = async () => {
    const doc = document.trim()
    if (!doc || doc.length < 4) {
      setError('Ingresa un número de documento válido (mínimo 4 caracteres)')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await apiClient.request('/api/network/public/debt-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_number: doc, tenant_slug: tenantSlug || '' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Error en la consulta')
      } else {
        setResult(data)
      }
    } catch {
      setError('Error de conexión. Intenta nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  const statusInfo = result?.service_status ? statusLabels[result.service_status] : null

  const content = (
    <div className="flex flex-col gap-5">
      {/* Título */}
      <div className="text-center">
        <div className="text-4xl mb-2">💬</div>
        <h2 className="text-2xl font-bold text-white dark:text-white">Consulta tu Estado de Cuenta</h2>
        <p className="text-slate-400 text-sm mt-1">Ingresa tu número de documento para ver tus facturas pendientes</p>
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={document}
          onChange={e => setDocument(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleQuery()}
          placeholder="Ej: 1234567890"
          maxLength={30}
          className="flex-1 border-2 border-white/10 dark:border-gray-600 rounded-xl px-4 py-3 text-base
            focus:outline-none focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-colors"
        />
        <button
          onClick={handleQuery}
          disabled={loading}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              Buscando...
            </span>
          ) : 'Consultar'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-rose-500/10 dark:bg-red-900/20 border border-rose-500/30 dark:border-red-800 rounded-xl p-4 text-rose-400 dark:text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Resultado: no encontrado */}
      {result && !result.found && (
        <div className="bg-amber-500/10 dark:bg-yellow-900/20 border border-amber-500/30 dark:border-yellow-800 rounded-xl p-5 text-center">
          <div className="text-3xl mb-2">🔍</div>
          <p className="text-amber-300 dark:text-yellow-300 font-semibold">No encontrado</p>
          <p className="text-yellow-600 dark:text-yellow-400 text-sm mt-1">{result.message}</p>
        </div>
      )}

      {/* Resultado: encontrado */}
      {result && result.found && (
        <div className="flex flex-col gap-4">
          {/* Encabezado cliente */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20
            border border-blue-100 dark:border-blue-800 rounded-xl p-5">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Cliente</p>
                <p className="text-xl font-bold text-white dark:text-white">{result.client_name}</p>
                {result.plan_name && (
                  <p className="text-sm text-blue-600 dark:text-blue-400 mt-0.5">📶 Plan: {result.plan_name}</p>
                )}
                {result.billing_type && (
                  <p className="text-xs text-slate-400 mt-0.5 capitalize">
                    Facturación: {result.billing_type === 'prepaid' ? 'Prepago' : result.billing_type === 'postpaid' ? 'Postpago' : 'Fecha a fecha'}
                  </p>
                )}
              </div>
              {statusInfo && (
                <span className={`px-3 py-1.5 rounded-full text-sm font-semibold ${statusInfo.color}`}>
                  {statusInfo.icon} {statusInfo.label}
                </span>
              )}
            </div>
          </div>

          {/* Deuda total */}
          <div className={`rounded-xl p-5 text-center ${
            (result.total_debt || 0) > 0
              ? 'bg-rose-500/10 dark:bg-red-900/20 border border-rose-500/30 dark:border-red-800'
              : 'bg-emerald-500/10 dark:bg-green-900/20 border border-emerald-500/30 dark:border-green-800'
          }`}>
            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Deuda Total</p>
            <p className={`text-4xl font-bold ${(result.total_debt || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
              {result.currency} {(result.total_debt || 0).toFixed(2)}
            </p>
            {(result.total_debt || 0) === 0 && (
              <p className="text-green-600 dark:text-green-400 text-sm mt-1">✅ ¡Estás al día!</p>
            )}
          </div>

          {/* Facturas pendientes */}
          {result.pending_invoices && result.pending_invoices.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-300 dark:text-slate-400 mb-2">📄 Facturas pendientes</p>
              <div className="flex flex-col gap-2">
                {result.pending_invoices.map(inv => (
                  <div key={inv.id}
                    className="flex items-center justify-between bg-white/5 backdrop-blur-md dark:bg-gray-800 border border-white/5 dark:border-gray-700 rounded-lg px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-200 dark:text-gray-200">Factura #{inv.id}</p>
                      {inv.due_date && (
                        <p className="text-xs text-slate-400">Vence: {new Date(inv.due_date).toLocaleDateString('es-ES')}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-white dark:text-white">{result.currency} {inv.amount.toFixed(2)}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        inv.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : 'bg-rose-500/20 text-rose-400'
                      }`}>{inv.status === 'pending' ? 'Pendiente' : 'Vencida'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Próximo cobro */}
          {result.next_charge && (
            <div className="bg-blue-500/10 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-4 text-center">
              <p className="text-xs text-slate-400 dark:text-slate-500">Próximo cobro</p>
              <p className="text-blue-300 dark:text-blue-300 font-semibold">
                📅 {new Date(result.next_charge).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          )}

          {/* Botón nueva consulta */}
          <button
            onClick={() => { setResult(null); setDocument('') }}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline text-center"
          >
            ← Nueva consulta
          </button>
        </div>
      )}

      {/* Nota de privacidad */}
      <p className="text-xs text-center text-slate-500 dark:text-slate-400">
        🔒 Tu información es confidencial y solo se muestra el estado de tu cuenta.
      </p>
    </div>
  )

  if (embedded) return content

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="bg-white/5 backdrop-blur-md dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg p-8">
        {content}
      </div>
    </div>
  )
}
