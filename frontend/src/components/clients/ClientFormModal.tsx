import React from 'react'
import {
  ArrowPathIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { ClientForm, Plan, Router } from './types'

interface Props {
  show: boolean
  onClose: () => void
  form: ClientForm
  setForm: React.Dispatch<React.SetStateAction<ClientForm>>
  tab: 1 | 2 | 3 | 4
  setTab: (tab: 1 | 2 | 3 | 4) => void
  plans: Plan[]
  routers: Router[]
  saving: boolean
  onSubmit: () => void
  isEdit?: boolean
}

const ClientFormModal: React.FC<Props> = ({
  show,
  onClose,
  form,
  setForm,
  tab,
  setTab,
  plans,
  routers,
  saving,
  onSubmit,
  isEdit = false,
}) => {
  if (!show) return null

  const tabs = [
    { id: 1, name: 'Conexión' },
    { id: 2, name: 'Cliente' },
    { id: 3, name: 'Facturación' },
    { id: 4, name: 'Avanzado' },
  ]

  const Toggle = ({ label, val, field }: { label: string; val: boolean; field: keyof ClientForm }) => (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <button
        type="button"
        onClick={() => setForm((p) => ({ ...p, [field]: !val }))}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${val ? 'bg-blue-500' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white backdrop-blur-md shadow transition-transform ${val ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div className="my-4 w-full max-w-4xl overflow-hidden rounded-2xl bg-white backdrop-blur-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b bg-slate-50 px-6 py-4">
          <h2 className="text-xl font-bold text-slate-800">{isEdit ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-white">
            <XMarkIcon className="h-6 w-6 text-slate-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b bg-slate-50/50">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as 1 | 2 | 3 | 4)}
              className={`flex-1 py-3 text-sm font-bold transition-all ${
                tab === t.id ? 'border-b-2 border-blue-600 bg-white text-blue-700' : 'text-slate-500 hover:bg-white/50'
              }`}
            >
              {t.id}. {t.name}
            </button>
          ))}
        </div>

        {/* Form Body */}
        <div className="max-h-[70vh] overflow-y-auto">
          {tab === 1 && (
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label-ws text-slate-700">Nombre del cliente (Visible en el Router)</label>
                  <input
                    className="input-ws text-slate-800 border-gray-200"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej: Juan Perez"
                  />
                </div>
                <div>
                  <label className="label-ws text-slate-700">Plan de Internet</label>
                  <select
                    className="input-ws text-slate-800 border-gray-200"
                    value={form.plan_id}
                    onChange={(e) => setForm({ ...form, plan_id: e.target.value })}
                  >
                    <option value="">Seleccione plan...</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label-ws text-slate-700">Router / Zona</label>
                  <select
                    className="input-ws text-slate-800 border-gray-200"
                    value={form.router_id}
                    onChange={(e) => setForm({ ...form, router_id: e.target.value })}
                  >
                    <option value="">Seleccione router...</option>
                    {routers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label-ws text-slate-700">Tipo de conexión</label>
                  <select
                    className="input-ws text-slate-800 border-gray-200"
                    value={form.connection_type}
                    onChange={(e) => setForm({ ...form, connection_type: e.target.value })}
                  >
                    <option value="pppoe">PPPoE</option>
                    <option value="dhcp">Hotspot / DHCP</option>
                    <option value="static">IP Estática / PCQ</option>
                  </select>
                </div>
                <div>
                  <label className="label-ws text-slate-700">Usuario PPPoE / Radio</label>
                  <input
                    className="input-ws text-slate-800 border-gray-200"
                    value={form.pppoe_username}
                    onChange={(e) => setForm({ ...form, pppoe_username: e.target.value })}
                    placeholder="juan.perez"
                  />
                </div>
              </div>
            </div>
          )}

          {tab === 2 && (
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="label-ws text-slate-700">Nombre completo</label>
                  <input className="input-ws text-slate-800 border-gray-200" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Juan" />
                </div>
                <div>
                  <label className="label-ws text-slate-700">Apellido</label>
                  <input className="input-ws text-slate-800 border-gray-200" value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} placeholder="Perez" />
                </div>
                <div>
                  <label className="label-ws text-slate-700">Email</label>
                  <input className="input-ws text-slate-800 border-gray-200" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="juan@gmail.com" />
                </div>
                <div>
                  <label className="label-ws text-slate-700">Teléfono / WhatsApp</label>
                  <input className="input-ws text-slate-800 border-gray-200" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+52 1..." />
                </div>
                <div className="sm:col-span-2">
                  <label className="label-ws text-slate-700">Dirección</label>
                  <textarea className="input-ws text-slate-800 border-gray-200 resize-none" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Calle, número..." />
                </div>
              </div>
            </div>
          )}

          {tab === 3 && (
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="label-ws text-slate-700">Día de corte</label>
                  <select className="input-ws text-slate-800 border-gray-200" value={form.dia_corte} onChange={(e) => setForm({ ...form, dia_corte: e.target.value })}>
                    {Array.from({ length: 28 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        Día {i + 1}
                      </option>
                    ))}
                  </select>
                </div>
                <Toggle label="Corte Automático" val={form.corte_automatico} field="corte_automatico" />
                <Toggle label="Facturas Automáticas" val={form.facturas_automaticas} field="facturas_automaticas" />
                <Toggle label="Avisos en Pantalla" val={form.avisos_pantalla} field="avisos_pantalla" />
              </div>
            </div>
          )}

          {tab === 4 && (
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="label-ws text-slate-700">Modelo Antena / CPE</label>
                  <input className="input-ws text-slate-800 border-gray-200" value={form.modelo_antena} onChange={(e) => setForm({ ...form, modelo_antena: e.target.value })} />
                </div>
                <div>
                  <label className="label-ws text-slate-700">SSID WiFi</label>
                  <input className="input-ws text-slate-800 border-gray-200" value={form.ssid_router_wifi} onChange={(e) => setForm({ ...form, ssid_router_wifi: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="label-ws text-slate-700">Comentarios</label>
                  <textarea className="input-ws text-slate-800 border-gray-200 resize-none" rows={3} value={form.comentarios} onChange={(e) => setForm({ ...form, comentarios: e.target.value })} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t bg-slate-50 px-6 py-4">
          <div className="flex gap-2">
            {tab > 1 && (
              <button
                type="button"
                onClick={() => setTab((tab - 1) as 1 | 2 | 3 | 4)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-gray-50"
              >
                ← Anterior
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-gray-50">
              Cancelar
            </button>
            {tab < 4 ? (
              <button
                type="button"
                onClick={() => setTab((tab + 1) as 1 | 2 | 3 | 4)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Siguiente →
              </button>
            ) : (
              <button
                onClick={onSubmit}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-green-500 px-5 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-60"
              >
                {saving ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : null}
                {isEdit ? 'Actualizar Cliente' : 'Guardar Cliente'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ClientFormModal
