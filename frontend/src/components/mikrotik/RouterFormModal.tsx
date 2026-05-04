import React from 'react'
import { ServerIcon, ShieldCheckIcon, ChartBarIcon } from '@heroicons/react/24/outline'
import { RouterFormState } from './types'

interface RouterFormModalProps {
  isOpen: boolean
  onClose: () => void
  editingRouter: any | null
  routerForm: RouterFormState
  setRouterForm: React.Dispatch<React.SetStateAction<RouterFormState>>
  routerModalTab: 'general' | 'sstp' | 'traffic'
  setRouterModalTab: (tab: 'general' | 'sstp' | 'traffic') => void
  onSubmit: () => Promise<void>
  isSaving: boolean
}

const RouterFormModal: React.FC<RouterFormModalProps> = ({
  isOpen,
  onClose,
  editingRouter,
  routerForm,
  setRouterForm,
  routerModalTab,
  setRouterModalTab,
  onSubmit,
  isSaving
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-white/80 backdrop-blur-sm py-10 px-4 sm:px-6">
      <div 
        className="w-full max-w-3xl rounded-3xl bg-white backdrop-blur-md shadow-2xl ring-1 ring-white/10 overflow-hidden transform transition-all" 
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Moderno con Gradiente */}
        <div className="flex items-center justify-between bg-gradient-to-r from-emerald-600 to-teal-600 px-8 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
              <ServerIcon className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">
                {editingRouter ? `Editar Router — ${editingRouter.name}` : 'Añadir Nuevo Router'}
              </h3>
              <p className="text-emerald-100 text-xs font-medium opacity-80">
                Integra tu equipo a ISPMAX para gestión centralizada
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="rounded-full p-2 text-emerald-100 hover:bg-white/10 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Pestañas (Tabs) Estilizadas */}
        <div className="flex border-b border-white/5 bg-slate-50/50 px-6 pt-2">
          {[
            { id: 'general', label: '1. Parámetros Básicos' },
            { id: 'sstp',    label: '2. Equipos NAT / VPN' },
            { id: 'traffic', label: '3. Integración NetFlow' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setRouterModalTab(t.id as any)}
              className={`px-5 py-3 text-sm font-semibold border-b-2 transition-all ${
                routerModalTab === t.id
                  ? 'border-teal-500 text-teal-700 bg-white backdrop-blur-md shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)] rounded-t-xl'
                  : 'border-transparent text-slate-500 hover:text-slate-600 hover:bg-white/10/50 rounded-t-xl'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {/* ─── Tab: Parámetros Básicos ─── */}
          {routerModalTab === 'general' && (
            <div className="space-y-8">
              {/* Sección: Identificación y Acceso */}
              <div className="space-y-4">
                <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-teal-700">
                  <span className="h-px flex-1 bg-teal-100"></span>
                  Identidad y Acceso
                  <span className="h-px flex-1 bg-teal-100"></span>
                </h4>
                
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Nombre del Router *</label>
                    <input
                      value={routerForm.name}
                      onChange={(e) => setRouterForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Ej. Torre Principal"
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-teal-500 focus:bg-white backdrop-blur-md focus:ring-2 focus:ring-teal-200 transition-all outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">IP Pública (WAN) *</label>
                    <input
                      value={routerForm.ip_address}
                      onChange={(e) => setRouterForm((p) => ({ ...p, ip_address: e.target.value }))}
                      placeholder="Si tienes NAT, déjalo vacío"
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-mono text-slate-900 focus:border-teal-500 focus:bg-white backdrop-blur-md focus:ring-2 focus:ring-teal-200 transition-all outline-none placeholder:font-sans placeholder:text-slate-500"
                    />
                    <p className="mt-1.5 text-[10px] text-slate-500 font-medium">
                      ¿No tienes IP Pública? Usa la pestaña <strong className="text-teal-600">Equipos NAT / VPN</strong> para conectar.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Usuario API *</label>
                    <input
                      value={routerForm.username}
                      onChange={(e) => setRouterForm((p) => ({ ...p, username: e.target.value }))}
                      placeholder="admin"
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-teal-500 focus:bg-white backdrop-blur-md focus:ring-2 focus:ring-teal-200 transition-all outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Contraseña API *</label>
                    <input
                      type="password"
                      value={routerForm.password}
                      onChange={(e) => setRouterForm((p) => ({ ...p, password: e.target.value }))}
                      placeholder="••••••••"
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-teal-500 focus:bg-white backdrop-blur-md focus:ring-2 focus:ring-teal-200 transition-all outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Sección: Puertos y Red */}
              <div className="space-y-4">
                <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-teal-700">
                  <span className="h-px flex-1 bg-teal-100"></span>
                  Configuración de Red
                  <span className="h-px flex-1 bg-teal-100"></span>
                </h4>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Puerto API</label>
                    <input
                      value={routerForm.api_port}
                      onChange={(e) => setRouterForm((p) => ({ ...p, api_port: e.target.value }))}
                      placeholder="8728"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-teal-500 focus:bg-white backdrop-blur-md transition-all outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Versión ROS</label>
                    <select
                      value={routerForm.ros_version}
                      onChange={(e) => setRouterForm((p) => ({ ...p, ros_version: e.target.value as '6' | '7' }))}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:bg-white backdrop-blur-md transition-all outline-none appearance-none"
                    >
                      <option value="7">v7 o superior</option>
                      <option value="6">v6 o inferior</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">Interfaz LAN</label>
                    <input
                      value={routerForm.lan_interface}
                      onChange={(e) => setRouterForm((p) => ({ ...p, lan_interface: e.target.value }))}
                      placeholder="ether1"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-teal-500 focus:bg-white backdrop-blur-md transition-all outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Feature toggles modernizados */}
              <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-teal-50/50 p-5">
                <p className="mb-4 text-xs font-bold text-emerald-800 uppercase tracking-wide">Módulos Activos en ISPMAX</p>
                <div className="grid grid-cols-2 gap-y-4 gap-x-6 sm:grid-cols-3">
                  {[
                    { key: 'use_sstp_script',     label: 'Túnel SSTP/VPN' },
                    { key: 'control_pppoe',        label: 'Gestión PPPoE' },
                    { key: 'control_queue',        label: 'Simple Queues' },
                    { key: 'control_dhcp',         label: 'DHCP Leases' },
                    { key: 'control_hotspot',      label: 'Portal HotSpot' },
                    { key: 'traffic_flow_enabled', label: 'Monitor NetFlow' },
                  ].map(({ key, label }) => {
                    const val = routerForm[key as keyof RouterFormState] as boolean
                    return (
                      <div key={key} className="flex items-center gap-3 group cursor-pointer" onClick={() => setRouterForm((p) => ({ ...p, [key]: !val }))}>
                        <div className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-all duration-300 ease-in-out ${
                            val ? 'bg-teal-500 shadow-inner' : 'bg-slate-300'
                          }`}
                        >
                          <span className={`inline-block h-5 w-5 transform rounded-full bg-white backdrop-blur-md shadow-md transition-transform duration-300 ease-in-out ${
                            val ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </div>
                        <span className={`text-sm font-semibold transition-colors duration-200 ${ val ? 'text-teal-800' : 'text-slate-500 group-hover:text-slate-700'}`}>{label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ─── Tab: Script de Conexión ─── */}
          {routerModalTab === 'sstp' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-r from-blue-50 to-indigo-50 p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0 rounded-full bg-blue-500/20 p-1">
                    <ShieldCheckIcon className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-blue-800">Solución para CGNAT e IPs Privadas</h4>
                    <p className="mt-1 text-xs text-blue-600 leading-relaxed">
                      Si tu MikroTik no es accesible directamente desde internet, ISPMAX puede crear un túnel reverso. 
                      Guarda el router y luego ve a la pestaña <strong>Script de Conexión</strong> del router seleccionado para obtener el comando que debes pegar en el New Terminal de tu equipo.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="rounded-2xl border border-gray-100 bg-white backdrop-blur-md p-5 shadow-sm ring-1 ring-white/10">
                <div className="flex items-center gap-4 group cursor-pointer" onClick={() => setRouterForm((p) => ({ ...p, use_sstp_script: !p.use_sstp_script }))}>
                  <div className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-all duration-300 ease-in-out ${
                      routerForm.use_sstp_script ? 'bg-teal-500 shadow-inner' : 'bg-slate-300'
                    }`}
                  >
                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white backdrop-blur-md shadow-md transition-transform duration-300 ease-in-out ${
                      routerForm.use_sstp_script ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </div>
                  <div>
                    <span className="text-base font-bold text-slate-800">Habilitar Auto-Aprovisionamiento de VPN</span>
                    <p className="text-xs text-slate-500 mt-0.5">ISPMAX preparará la IP de túnel y credenciales automáticamente.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── Tab: Script de Traffic Flow ─── */}
          {routerModalTab === 'traffic' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0 rounded-full bg-amber-500/20 p-1 border border-amber-500/30">
                    <ChartBarIcon className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-amber-600">Monitor de Tráfico Avanzado</h4>
                    <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                      Analiza el tráfico detallado de tus clientes. Guarda el router primero y luego obtén los scripts NetFlow en el panel de gestión del router.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white backdrop-blur-md p-5 shadow-sm ring-1 ring-white/10">
                <div className="flex items-center gap-4 group cursor-pointer" onClick={() => setRouterForm((p) => ({ ...p, traffic_flow_enabled: !p.traffic_flow_enabled }))}>
                  <div className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-all duration-300 ease-in-out ${
                      routerForm.traffic_flow_enabled ? 'bg-teal-500 shadow-inner' : 'bg-slate-300'
                    }`}
                  >
                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white backdrop-blur-md shadow-md transition-transform duration-300 ease-in-out ${
                      routerForm.traffic_flow_enabled ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </div>
                  <div>
                    <span className="text-base font-bold text-slate-800">Recopilar Estadísticas NetFlow</span>
                    <p className="text-xs text-slate-500 mt-0.5">Compatible con RouterOS {routerForm.ros_version === '6' ? 'v6' : 'v7'} de forma nativa.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Moderno */}
        <div className="flex items-center justify-between rounded-b-3xl border-t border-gray-100 bg-slate-50 px-8 py-5">
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 shadow-sm hover:bg-gray-50 transition-all"
          >
            Cancelar
          </button>
          <div className="flex gap-3">
            <button
              onClick={() => {
                if (routerModalTab === 'general') setRouterModalTab('sstp')
                else if (routerModalTab === 'sstp') setRouterModalTab('traffic')
              }}
              disabled={routerModalTab === 'traffic'}
              className="rounded-xl px-5 py-2.5 text-sm font-bold text-teal-600 hover:bg-teal-50 disabled:opacity-40 transition-colors"
            >
              Siguiente Paso ➔
            </button>
            <button
              onClick={() => void onSubmit()}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/30 hover:scale-105 hover:shadow-emerald-500/50 disabled:opacity-60 disabled:hover:scale-100 transition-all duration-300"
            >
              {isSaving ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Conectando...
                </span>
              ) : (
                '✔ Guardar Router'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default RouterFormModal
