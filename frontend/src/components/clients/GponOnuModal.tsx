import React, { useState } from 'react'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  SignalIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { apiClient } from '../../lib/apiClient'
import { Client, OltDevice, PendingOnu } from './types'

interface Props {
  client: Client
  oltDevices: OltDevice[]
  onClose: () => void
}

const GponOnuModal: React.FC<Props> = ({ client, oltDevices, onClose }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [deviceId, setDeviceId] = useState(oltDevices[0]?.id || '')
  const [frame, setFrame] = useState('0')
  const [slot, setSlot] = useState('1')
  const [pon, setPon] = useState('1')
  const [onu, setOnu] = useState('1')
  const [vlan, setVlan] = useState('100')
  const [wanType, setWanType] = useState('pppoe')
  const [serial, setSerial] = useState('')
  const [pendingOnus, setPendingOnus] = useState<PendingOnu[]>([])
  const [searchingOnus, setSearchingOnus] = useState(false)
  const [authorizingOnu, setAuthorizingOnu] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  const searchPendingOnus = async () => {
    if (!deviceId) { toast.error('Selecciona un dispositivo OLT'); return }
    setSearchingOnus(true)
    setPendingOnus([])
    setSerial('')
    try {
      const params = new URLSearchParams({ frame, slot, pon, run_mode: 'live' })
      const resp = (await apiClient.get(`/olt/devices/${deviceId}/autofind-onu?${params}`)) as { onus?: PendingOnu[]; onu_list?: PendingOnu[]; success?: boolean }
      const list = resp.onus || resp.onu_list || []
      setPendingOnus(list)
      setStep(2)
      if (!list.length) toast('No se encontraron ONUs pendientes en ese PON')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error buscando ONUs')
    } finally {
      setSearchingOnus(false)
    }
  }

  const authorizeOnu = async () => {
    if (!deviceId || !serial) { toast.error('Selecciona ONU y OLT'); return }
    setAuthorizingOnu(true)
    setResult(null)
    try {
      const payload = {
        serial,
        frame: Number(frame),
        slot: Number(slot),
        pon: Number(pon),
        onu: Number(onu),
        vlan: Number(vlan),
        wan_type: wanType,
        run_mode: 'live',
        live_confirm: true,
      }
      const resp = (await apiClient.post(`/olt/devices/${deviceId}/authorize-onu`, payload)) as { success?: boolean; message?: string; error?: string }
      if (resp.success) {
        setResult({ success: true, message: resp.message || 'ONU autorizada correctamente' })
        setStep(3)
        toast.success('ONU GPON autorizada')
      } else {
        setResult({ success: false, message: resp.error || resp.message || 'No se pudo autorizar la ONU' })
        toast.error(resp.error || 'Error autorizando ONU')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error autorizando ONU'
      setResult({ success: false, message: msg })
      toast.error(msg)
    } finally {
      setAuthorizingOnu(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div className="my-4 w-full max-w-2xl overflow-hidden rounded-2xl bg-white backdrop-blur-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b bg-violet-500/10 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Provisión GPON</p>
            <h3 className="text-lg font-bold text-slate-800">Autorizar ONU — {client.name}</h3>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-violet-500/20">
            <XMarkIcon className="h-5 w-5 text-slate-500" />
          </button>
        </div>
        <div className="flex border-b">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`flex-1 py-2 text-center text-xs font-semibold ${
                step === s ? 'border-b-2 border-violet-500 text-violet-700' : 'text-slate-500'
              }`}
            >
              {s === 1 ? '1. OLT + PON' : s === 2 ? '2. Seleccionar ONU' : '3. Resultado'}
            </div>
          ))}
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-6">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-600">Dispositivo OLT</label>
                <select
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700"
                >
                  <option value="">Seleccionar OLT...</option>
                  {oltDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.vendor}) {d.host ? `— ${d.host}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Frame</label>
                  <input
                    type="number"
                    min="0"
                    value={frame}
                    onChange={(e) => setFrame(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Slot</label>
                  <input
                    type="number"
                    min="0"
                    value={slot}
                    onChange={(e) => setSlot(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Puerto PON</label>
                  <input
                    type="number"
                    min="1"
                    value={pon}
                    onChange={(e) => setPon(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-slate-600">
                  Cancelar
                </button>
                <button
                  onClick={searchPendingOnus}
                  disabled={searchingOnus || !deviceId}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {searchingOnus ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <SignalIcon className="h-4 w-4" />}
                  {searchingOnus ? 'Buscando...' : 'Buscar ONUs pendientes'}
                </button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <p className="mb-2 text-sm font-semibold text-slate-600">ONUs encontradas:</p>
              {pendingOnus.length > 0 ? (
                <div className="space-y-2">
                  {pendingOnus.map((onuItem, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSerial(onuItem.serial)
                        setOnu(String(onuItem.onu || i + 1))
                      }}
                      className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition ${
                        serial === onuItem.serial ? 'border-violet-500 bg-violet-500/10' : 'border-gray-200 hover:border-violet-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-slate-700">{onuItem.serial}</span>
                        {serial === onuItem.serial && <CheckCircleIcon className="h-5 w-5 text-violet-600" />}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {onuItem.vendor && <span className="mr-3">{onuItem.vendor}</span>}
                        {onuItem.model && <span>{onuItem.model}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-sm text-slate-500">
                  No se encontraron ONUs pendientes.
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Serial ONU (manual)</label>
                <input
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder="ZTEG12345678"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm text-slate-700"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">VLAN</label>
                  <input
                    type="number"
                    value={vlan}
                    onChange={(e) => setVlan(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Tipo WAN</label>
                  <select
                    value={wanType}
                    onChange={(e) => setWanType(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="pppoe">PPPoE</option>
                    <option value="dhcp">DHCP</option>
                    <option value="static">IP Estática</option>
                    <option value="bridge">Bridge</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-between gap-2">
                <button onClick={() => setStep(1)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-slate-600">
                  ← Atrás
                </button>
                <button
                  onClick={authorizeOnu}
                  disabled={authorizingOnu || !serial}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {authorizingOnu ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <CheckCircleIcon className="h-4 w-4" />}
                  {authorizingOnu ? 'Autorizando...' : 'Autorizar ONU'}
                </button>
              </div>
            </div>
          )}
          {step === 3 && result && (
            <div className="space-y-4 text-center">
              <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${result.success ? 'bg-emerald-100' : 'bg-rose-100'}`}>
                {result.success ? <CheckCircleIcon className="h-10 w-10 text-emerald-600" /> : <XMarkIcon className="h-10 w-10 text-red-600" />}
              </div>
              <p className={`text-sm font-semibold ${result.success ? 'text-emerald-700' : 'text-rose-700'}`}>{result.message}</p>
              <button onClick={onClose} className="rounded-lg bg-violet-600 px-6 py-2 text-sm font-semibold text-white">
                Cerrar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default GponOnuModal
