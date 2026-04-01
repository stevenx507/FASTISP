import React, { useEffect, useState } from 'react'
import { billingApi } from '../../lib/billingApi'
import { apiClient } from '../../lib/apiClient'
import toast from 'react-hot-toast'

type Plan = { id: number; name: string; price: number }

interface Props {
  clientId: number
  open: boolean
  onClose: () => void
  onChanged: () => void
}

const PlanChangeModal: React.FC<Props> = ({ clientId, open, onClose, onChanged }) => {
  const [plans, setPlans] = useState<Plan[]>([])
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null)
  const [prorate, setProrate] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    apiClient
      .get('/plans')
      .then((resp: any) => setPlans(resp.items || []))
      .catch((err) => toast.error(err?.message || 'No se pudieron cargar los planes'))
  }, [open])

  const submit = async () => {
    if (!selectedPlan) {
      toast.error('Selecciona un plan')
      return
    }
    setLoading(true)
    try {
      await billingApi.changePlan(clientId, selectedPlan, prorate)
      toast.success('Plan actualizado')
      onChanged()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cambiar el plan')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur">
      <div className="bg-slate-900/90 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg p-6 text-slate-50">
        <h3 className="text-xl font-semibold mb-4">Cambiar plan</h3>
        <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
          {plans.map((p) => (
            <label
              key={p.id}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 cursor-pointer ${
                selectedPlan === p.id ? 'border-cyan-400 bg-white/5' : 'border-white/10 hover:border-white/20'
              }`}
            >
              <div>
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm text-slate-300">${p.price?.toFixed(2) ?? '0.00'}</p>
              </div>
              <input type="radio" name="plan" value={p.id} checked={selectedPlan === p.id} onChange={() => setSelectedPlan(p.id)} />
            </label>
          ))}
          {plans.length === 0 && <p className="text-sm text-slate-300">No hay planes configurados.</p>}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <input id="prorate" type="checkbox" className="h-4 w-4" checked={prorate} onChange={(e) => setProrate(e.target.checked)} />
          <label htmlFor="prorate" className="text-sm text-slate-200">
            Aplicar prorrateo en este ciclo
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/10 text-slate-200 hover:bg-white/20">
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-cyan-500 text-white font-semibold hover:bg-cyan-400 disabled:opacity-50"
          >
            {loading ? 'Guardando...' : 'Cambiar plan'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PlanChangeModal
