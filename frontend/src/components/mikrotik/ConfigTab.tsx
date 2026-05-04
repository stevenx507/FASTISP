import React from 'react'
import { 
  ShieldCheckIcon, 
  ChartBarIcon, 
  ServerIcon, 
  CogIcon 
} from '@heroicons/react/24/outline'
import { 
  RouterItem, 
  RouterQuickConnectResponse, 
  RouterReadinessPayload, 
  RouterConnectionDiagnosticsPayload,
  RouterSnmpProfilePayload,
  RouterSnmpFormState,
  RouterBackToHomeBootstrapData,
  ExpressStepState,
  RouterOnboardingProfile,
  RouterConnectionSnapshot,
  SstpTunnelData,
  RouterSnmpPollResponse,
  RouterQuickScripts
} from './types'
import { 
  describeHostScope, 
  getConnectionStatusLabel, 
  getConnectionStatusTone, 
  formatConnectionCheckedAt,
  formatSnmpMetric 
} from './helpers'

interface ConfigTabProps {
  selectedRouter: RouterItem
  onboardingProfile: RouterOnboardingProfile | null
  tenantContextId: string | number | null
  quickConnect: RouterQuickConnectResponse | null
  quickConnectScope: 'auto' | 'public' | 'private'
  setQuickConnectScope: (scope: 'auto' | 'public' | 'private') => void
  loadQuickConnect: (id: string, scope: 'auto' | 'public' | 'private') => Promise<void>
  quickLoading: boolean
  activeConnectionDiagnostics: RouterConnectionDiagnosticsPayload | null
  activeConnectionSnapshot: RouterConnectionSnapshot | null
  CONNECTION_POLL_INTERVAL_MS: number
  
  // SNMP
  routerSnmpProfile: RouterSnmpProfilePayload | null
  routerSnmpRuntimeAvailable: boolean | null
  routerSnmpLoading: boolean
  routerSnmpForm: RouterSnmpFormState
  setRouterSnmpForm: React.Dispatch<React.SetStateAction<RouterSnmpFormState>>
  routerSnmpSaving: boolean
  saveRouterSnmpProfile: () => Promise<void>
  routerSnmpPolling: boolean
  runRouterSnmpPoll: (persist: boolean) => Promise<void>
  routerSnmpPollResult: RouterSnmpPollResponse | null

  // Readiness
  routerReadiness: RouterReadinessPayload | null
  readinessLoading: boolean
  loadRouterReadiness: (id: string, writeProbe?: boolean) => Promise<void>

  // VPN / Tunneling
  vpnMode: 'hub' | 'native'
  setVpnMode: (mode: 'hub' | 'native') => void
  sstpLoadingForRouter: string | null
  hubScript: string | null
  hubData: any | null
  hubProvisioning: boolean
  provisionHubForRouter: () => Promise<void>
  sstpTunnel: SstpTunnelData | null
  sstpScript: string | null
  sstpProvisioning: boolean
  provisionSstpForRouter: () => Promise<void>
  copyToClipboard: (text: string) => Promise<boolean>
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void
  runWizardValidation: () => Promise<void>
  
  // Express Wizard
  expressSteps: ExpressStepState[]
  showAdvancedScripts: boolean
  setShowAdvancedScripts: React.Dispatch<React.SetStateAction<boolean>>
  resolveQuickScript: (scripts: RouterQuickScripts | undefined, key?: string) => string
  copyScript: (label: string, script: string) => void
}

const ConfigTab: React.FC<ConfigTabProps> = ({
  selectedRouter,
  onboardingProfile,
  tenantContextId,
  quickConnect,
  quickConnectScope,
  setQuickConnectScope,
  loadQuickConnect,
  quickLoading,
  activeConnectionDiagnostics,
  activeConnectionSnapshot,
  CONNECTION_POLL_INTERVAL_MS,
  routerSnmpProfile,
  routerSnmpRuntimeAvailable,
  routerSnmpLoading,
  routerSnmpForm,
  setRouterSnmpForm,
  routerSnmpSaving,
  saveRouterSnmpProfile,
  routerSnmpPolling,
  runRouterSnmpPoll,
  routerSnmpPollResult,
  routerReadiness,
  readinessLoading,
  loadRouterReadiness,
  vpnMode,
  setVpnMode,
  sstpLoadingForRouter,
  hubScript,
  hubData,
  hubProvisioning,
  provisionHubForRouter,
  sstpTunnel,
  sstpScript,
  sstpProvisioning,
  provisionSstpForRouter,
  copyToClipboard,
  addToast,
  runWizardValidation,
  expressSteps,
  showAdvancedScripts,
  setShowAdvancedScripts,
  resolveQuickScript,
  copyScript
}) => {
  return (
    <div className="space-y-4">
      <h4 className="text-lg font-semibold text-slate-800">Conexion remota guiada</h4>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-emerald-800">Aislamiento por cuenta ISP</p>
            <p className="text-xs text-emerald-700">
              Perfil activo: <strong>{quickConnect?.onboarding_profile?.account_label || onboardingProfile?.account_label || 'Cuenta actual'}</strong>
              {' '}| prefijo routers: <strong>{quickConnect?.onboarding_profile?.router_name_prefix || onboardingProfile?.router_name_prefix || '-'}</strong>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest border ${
              selectedRouter.status === 'reachable' 
                ? 'bg-emerald-100 text-emerald-700 border-emerald-200' 
                : 'bg-rose-100 text-rose-700 border-rose-200'
            }`}>
              {selectedRouter.status === 'reachable' ? 'En línea' : 'Desconectado'}
            </span>
            <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-700 border border-indigo-200">
              tenant {quickConnect?.tenant_scope?.tenant_slug || onboardingProfile?.tenant_scope?.tenant_slug || tenantContextId || 'global'}
            </span>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-700">Perfil de acceso WAN</p>
          <div className="flex items-center gap-2">
            <select
              value={quickConnectScope}
              onChange={(e) => setQuickConnectScope(e.target.value as 'auto' | 'public' | 'private')}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
            >
              <option value="auto">Auto detectar</option>
              <option value="public">Forzar publica</option>
              <option value="private">Forzar privada</option>
            </select>
            <button
              onClick={() => selectedRouter && void loadQuickConnect(selectedRouter.id, quickConnectScope)}
              disabled={quickLoading}
              className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-60"
            >
              Aplicar
            </button>
          </div>
        </div>
        {quickConnect?.access_profile && (
          <div className="mt-2 space-y-1 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-600 border border-slate-200">
                detectado: {quickConnect.access_profile.detected_scope || 'unknown'}
              </span>
              <span className="rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-600 border border-blue-100">
                efectivo: {quickConnect.access_profile.effective_scope || 'unknown'}
              </span>
              <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-600 border border-emerald-100">
                recomendado: {quickConnect.access_profile.recommended_transport || '-'}
              </span>
            </div>
            <p className="text-slate-600">{quickConnect.access_profile.reason || '-'}</p>
          </div>
        )}
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-700">Diagnostico de conexion API</p>
            <p className="text-xs text-slate-600">Muestra la causa real del ultimo test: DNS, puerto, login API y ruta sugerida para el operador.</p>
            <p className="text-[11px] text-slate-600">
              Monitoreo automatico cada {Math.round(CONNECTION_POLL_INTERVAL_MS / 1000)}s mientras esta abierta esta pestaña.
              Ultimo check: {formatConnectionCheckedAt(activeConnectionSnapshot?.checkedAt)}
            </p>
          </div>
          {activeConnectionDiagnostics && (
            <span
              className={`rounded-full px-2 py-1 text-xs font-semibold ${
                getConnectionStatusTone(activeConnectionDiagnostics)
              }`}
            >
              {getConnectionStatusLabel(activeConnectionDiagnostics)}
            </span>
          )}
        </div>

        {/* NAT Warning */}
        {quickConnect?.access_profile?.effective_scope === 'private' && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex gap-2">
              <span className="text-amber-500 font-bold">⚠️ NAT detectado:</span>
              <div className="text-xs text-amber-800 space-y-1">
                <p>El router tiene una IP privada o está tras CGNAT. El acceso directo por puerto 8728 fallará.</p>
                <p className="font-semibold">Solución recomendada:</p>
                <ul className="list-disc list-inside">
                  <li>Usa <strong>SSTP Nativo</strong> (más fácil) o <strong>WireGuard</strong>.</li>
                  <li>Si el router soporta <strong>Back To Home (BTH)</strong>, es la opción más robusta.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {!activeConnectionDiagnostics && (
          <p className="text-xs text-slate-600">Todavia no hay un diagnostico guardado para este router. Usa "Probar conexion" o la validacion del wizard.</p>
        )}
        {activeConnectionDiagnostics && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
               <span
                className={`rounded-full px-2 py-1 text-xs font-semibold border ${
                  activeConnectionDiagnostics.success 
                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
                    : 'bg-amber-50 text-amber-600 border-amber-200'
                }`}
              >
                {activeConnectionDiagnostics.summary || 'Sin resumen'}
              </span>
              {activeConnectionDiagnostics.transport_hint && (
                <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-600 border border-sky-200">
                  Ruta sugerida: {activeConnectionDiagnostics.transport_hint}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-700">
              Host <strong>{activeConnectionDiagnostics.host || selectedRouter.ip_address}</strong>:{' '}
              <strong>{activeConnectionDiagnostics.api_port || '-'}</strong> | tipo:{' '}
              <strong>{describeHostScope(activeConnectionDiagnostics.host_scope)}</strong>
            </p>
            <ul className="space-y-1 text-xs text-slate-800">
              {(activeConnectionDiagnostics.checks || []).map((check) => {
                const severity = check.severity || (check.ok ? 'ok' : 'warning')
                const toneClass =
                  severity === 'critical'
                    ? 'bg-rose-50 text-rose-600 border-rose-200'
                    : severity === 'warning'
                      ? 'bg-amber-50 text-amber-600 border-amber-200'
                      : 'bg-emerald-50 text-emerald-600 border-emerald-200'
                return (
                  <li key={check.id} className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 font-semibold ${toneClass}`}>{check.id}</span>
                    <span>{check.detail || '-'}</span>
                  </li>
                )
              })}
            </ul>
            {(activeConnectionDiagnostics.recommendations || []).length > 0 && (
              <div className="rounded border border-sky-200 bg-sky-50 p-2">
                <p className="text-xs font-semibold uppercase text-sky-700">Mejoras sugeridas</p>
                <ul className="mt-1 space-y-1 text-xs text-sky-800">
                  {(activeConnectionDiagnostics.recommendations || []).map((item, idx) => (
                    <li key={`${item}-${idx}`}>- {item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-700">Monitoreo SNMP</p>
            <p className="text-xs text-slate-600">
              Configura sondeo para CPU, memoria, temperatura, voltaje, senal u optica desde esta misma vista.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-1 text-xs font-semibold border ${
                routerSnmpProfile?.enabled 
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              }`}
            >
              {routerSnmpProfile?.enabled ? 'SNMP activo' : 'SNMP inactivo'}
            </span>
            <span
              className={`rounded-full px-2 py-1 text-xs font-semibold border ${
                routerSnmpRuntimeAvailable === false 
                  ? 'bg-amber-50 text-amber-600 border-amber-200' 
                  : 'bg-blue-50 text-blue-600 border-blue-200'
              }`}
            >
              {routerSnmpRuntimeAvailable === false ? 'Backend sin runtime SNMP' : 'Backend listo'}
            </span>
          </div>
        </div>
        {routerSnmpLoading ? (
          <p className="text-xs text-slate-500">Cargando perfil SNMP...</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
              <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <span className="mb-1 block font-semibold text-slate-700">Host</span>
                <input
                  value={routerSnmpForm.host}
                  onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, host: e.target.value }))}
                  placeholder={selectedRouter.ip_address}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                />
              </label>
              <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <span className="mb-1 block font-semibold text-slate-700">Community</span>
                <input
                  value={routerSnmpForm.community}
                  onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, community: e.target.value }))}
                  placeholder={routerSnmpProfile?.community_preview || 'public'}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                />
                <span className="mt-1 block text-[11px] text-slate-600">
                  {routerSnmpProfile?.community_configured ? `Actual: ${routerSnmpProfile.community_preview || 'configurada'}` : 'Escribe una nueva para guardarla.'}
                </span>
              </label>
              <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <span className="mb-1 block font-semibold text-slate-700">Puerto / timeout / retries</span>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    value={routerSnmpForm.port}
                    onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, port: e.target.value }))}
                    className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                  />
                  <input
                    value={routerSnmpForm.timeout_seconds}
                    onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, timeout_seconds: e.target.value }))}
                    className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                  />
                  <input
                    value={routerSnmpForm.retries}
                    onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, retries: e.target.value }))}
                    className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                  />
                </div>
              </label>
              <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <span className="mb-2 block font-semibold text-slate-700">Switches</span>
                <div className="space-y-2">
                  <label className="flex items-center justify-between gap-2">
                    <span>SNMP habilitado</span>
                    <input
                      type="checkbox"
                      checked={routerSnmpForm.enabled}
                      onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span>Leer interfaces</span>
                    <input
                      type="checkbox"
                      checked={routerSnmpForm.poll_interfaces}
                      onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, poll_interfaces: e.target.checked }))}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span>Esperar traps</span>
                    <input
                      type="checkbox"
                      checked={routerSnmpForm.trap_enabled}
                      onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, trap_enabled: e.target.checked }))}
                    />
                  </label>
                </div>
              </div>
            </div>

            <label className="block rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
              <span className="mb-1 block font-semibold text-slate-700">Interfaces a graficar</span>
              <input
                value={routerSnmpForm.interface_names}
                onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, interface_names: e.target.value }))}
                placeholder="ether1, sfp1, bridge"
                className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
              />
              <span className="mt-1 block text-[11px] text-slate-600">
                Dejalo vacio para leer todas las interfaces expuestas por SNMP.
              </span>
            </label>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {[
                { key: 'cpu_oid', label: 'CPU %', scaleKey: '' },
                { key: 'mem_oid', label: 'Memoria %', scaleKey: '' },
                { key: 'temperature_oid', label: 'Temperatura C', scaleKey: 'temperature_scale' },
                { key: 'voltage_oid', label: 'Voltaje V', scaleKey: 'voltage_scale' },
                { key: 'signal_oid', label: 'Senal dBm', scaleKey: 'signal_scale' },
                { key: 'optical_oid', label: 'Optica RX dBm', scaleKey: 'optical_scale' },
                { key: 'onu_online_oid', label: 'ONU online', scaleKey: '' },
                { key: 'onu_offline_oid', label: 'ONU offline', scaleKey: '' },
              ].map((field) => {
                const currentValue = routerSnmpForm[field.key as keyof RouterSnmpFormState] as string
                const currentScale = field.scaleKey
                  ? (routerSnmpForm[field.scaleKey as keyof RouterSnmpFormState] as string)
                  : ''
                return (
                  <div key={field.key} className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                    <span className="mb-1 block font-semibold text-slate-700">{field.label}</span>
                    <div className={`grid gap-2 ${field.scaleKey ? 'grid-cols-[minmax(0,1fr)_88px]' : 'grid-cols-1'}`}>
                      <input
                        value={currentValue}
                        onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder="OID"
                        className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                      />
                      {field.scaleKey && (
                        <input
                          value={currentScale}
                          onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, [field.scaleKey]: e.target.value }))}
                          placeholder="scale"
                          className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <span className="mb-1 block font-semibold text-slate-700">Temp. critica C</span>
                <input
                  value={routerSnmpForm.threshold_temperature}
                  onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, threshold_temperature: e.target.value }))}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                />
              </label>
              <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <span className="mb-1 block font-semibold text-slate-700">Voltaje minimo</span>
                <input
                  value={routerSnmpForm.threshold_voltage_min}
                  onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, threshold_voltage_min: e.target.value }))}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                />
              </label>
              <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <span className="mb-1 block font-semibold text-slate-700">Senal minima dBm</span>
                <input
                  value={routerSnmpForm.threshold_signal_min}
                  onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, threshold_signal_min: e.target.value }))}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                />
              </label>
              <label className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <span className="mb-1 block font-semibold text-slate-700">Optica minima dBm</span>
                <input
                  value={routerSnmpForm.threshold_optical_min}
                  onChange={(e) => setRouterSnmpForm((prev) => ({ ...prev, threshold_optical_min: e.target.value }))}
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-800"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void saveRouterSnmpProfile()}
                disabled={routerSnmpSaving}
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {routerSnmpSaving ? 'Guardando...' : 'Guardar perfil SNMP'}
              </button>
              <button
                onClick={() => void runRouterSnmpPoll(false)}
                disabled={routerSnmpPolling}
                className="rounded bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-60"
              >
                {routerSnmpPolling ? 'Consultando...' : 'Probar SNMP'}
              </button>
              <button
                onClick={() => void runRouterSnmpPoll(true)}
                disabled={routerSnmpPolling}
                className="rounded border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-60"
              >
                Probar + persistir
              </button>
            </div>

            {routerSnmpPollResult && (
              <div className="rounded border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">Ultima lectura SNMP</p>
                  <span>{routerSnmpPollResult.polled_at || '-'}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div className="rounded bg-white backdrop-blur-md px-2 py-2">CPU: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.cpu_percent, '%')}</strong></div>
                  <div className="rounded bg-white backdrop-blur-md px-2 py-2">Mem: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.mem_percent, '%')}</strong></div>
                  <div className="rounded bg-white backdrop-blur-md px-2 py-2">Temp: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.temperature_c, ' C')}</strong></div>
                  <div className="rounded bg-white backdrop-blur-md px-2 py-2">Volt: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.voltage_v, ' V')}</strong></div>
                  <div className="rounded bg-white backdrop-blur-md px-2 py-2">Senal: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.signal_level_dbm, ' dBm')}</strong></div>
                  <div className="rounded bg-white backdrop-blur-md px-2 py-2">Optica: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.optical_rx_dbm, ' dBm')}</strong></div>
                  <div className="rounded bg-white backdrop-blur-md px-2 py-2">ONU on: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.onu_online)}</strong></div>
                  <div className="rounded bg-white backdrop-blur-md px-2 py-2">ONU off: <strong>{formatSnmpMetric(routerSnmpPollResult.health_metrics?.onu_offline)}</strong></div>
                </div>
                {(routerSnmpPollResult.interfaces || []).length > 0 && (
                  <div className="mt-2 rounded border border-sky-100 bg-white backdrop-blur-md p-2">
                    <p className="font-semibold text-sky-800">Interfaces leidas</p>
                    <div className="mt-1 grid grid-cols-1 gap-1 text-[11px] text-sky-900">
                      {(routerSnmpPollResult.interfaces || []).slice(0, 4).map((iface: any) => (
                        <div key={`${iface.name}-${iface.index ?? 'idx'}`} className="rounded bg-sky-50 px-2 py-1">
                          <strong>{iface.name || 'if'}</strong> | RX {formatSnmpMetric(iface.rx_bytes)} | TX {formatSnmpMetric(iface.tx_bytes)} | estado {formatSnmpMetric(iface.oper_status)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-700">Readiness remoto del router</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => selectedRouter && void loadRouterReadiness(selectedRouter.id)}
              disabled={readinessLoading}
              className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-60"
            >
              Refrescar
            </button>
            <button
              onClick={() => selectedRouter && void loadRouterReadiness(selectedRouter.id, true)}
              disabled={readinessLoading}
              className="rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              Refrescar + write probe
            </button>
          </div>
        </div>
        {readinessLoading && <p className="text-xs text-slate-500">Evaluando readiness...</p>}
        {!readinessLoading && !routerReadiness && (
          <p className="text-xs text-slate-500">Sin datos de readiness para este router.</p>
        )}
        {!readinessLoading && routerReadiness && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-blue-500/20 px-2 py-1 text-xs font-semibold text-blue-400">
                Score {routerReadiness.score ?? 0}%
              </span>
              <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">
                Blockers {(routerReadiness.blockers || []).length}
              </span>
            </div>
            <ul className="space-y-1 text-xs text-slate-600">
              {(routerReadiness.checks || []).map((check) => {
                const severity = check.severity || (check.ok ? 'ok' : 'warning')
                const toneClass =
                  severity === 'critical'
                    ? 'bg-rose-50 text-rose-600 border-rose-200'
                    : severity === 'warning'
                      ? 'bg-amber-50 text-amber-600 border-amber-200'
                      : 'bg-emerald-50 text-emerald-600 border-emerald-200'
                return (
                  <li key={check.id} className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 font-semibold ${toneClass}`}>{check.id}</span>
                    <span>{check.detail || '-'}</span>
                  </li>
                )
              })}
            </ul>
            {(routerReadiness.recommendations || []).length > 0 && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2">
                <p className="text-xs font-semibold uppercase text-amber-600">Recomendaciones</p>
                <ul className="mt-1 space-y-1 text-xs text-amber-700">
                  {(routerReadiness.recommendations || []).map((item, idx) => (
                    <li key={`${item}-${idx}`}>- {item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {quickLoading && <p className="text-sm text-slate-500">Cargando scripts...</p>}
      {!quickLoading && !quickConnect?.scripts && (
        <p className="text-sm text-rose-600 font-bold">No se pudieron cargar scripts para este router.</p>
      )}
      {quickConnect?.scripts && (
        <>
          {quickConnect.connection_plan && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-emerald-600">
                    {quickConnect.connection_plan.title || 'Conexion Express'}
                  </p>
                  <p className="text-xs text-emerald-700">
                    {quickConnect.connection_plan.summary || 'Sigue los pasos recomendados.'}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-600 border border-emerald-500/30">
                  {quickConnect.connection_plan.recommended_transport || '-'}
                </span>
              </div>
              {/* ── VPN Connection Mode Selector ── */}
              <div className="mt-2 space-y-4">
                <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
                  <button
                    onClick={() => setVpnMode('hub')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                      vpnMode === 'hub'
                        ? 'bg-white text-emerald-600 shadow-sm border border-emerald-100'
                        : 'text-slate-500 hover:bg-white/50'
                    }`}
                  >
                    Túnel Hub (Estilo WispHub)
                  </button>
                  <button
                    onClick={() => setVpnMode('native')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                      vpnMode === 'native'
                        ? 'bg-white text-blue-600 shadow-sm border border-blue-100'
                        : 'text-slate-500 hover:bg-white/50'
                    }`}
                  >
                    Servidor Nativo (Router con IP)
                  </button>
                </div>

                {/* Loading Common */}
                {sstpLoadingForRouter === String(selectedRouter?.id) && (
                  <div className="py-8 text-center">
                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-600"></div>
                    <p className="mt-2 text-xs text-slate-500">Verificando estado del túnel...</p>
                  </div>
                )}

                {!sstpLoadingForRouter && (
                  <>
                    {/* MODE: HUB (WispHub Style) */}
                    {vpnMode === 'hub' && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        {!hubScript ? (
                          <div className="text-center py-6 px-4 bg-emerald-50/50 rounded-2xl border border-emerald-100">
                            <div className="mx-auto w-14 h-14 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm border border-emerald-100">
                              <ServerIcon className="w-7 h-7 text-emerald-500" />
                            </div>
                            <p className="text-sm font-bold text-slate-800">Túnel Centralizado (Recomendado)</p>
                            <p className="text-xs text-slate-500 mt-2 max-w-xs mx-auto leading-relaxed">
                              Ideal para routers con <strong>NAT</strong> o sin IP pública. 
                              El MikroTik se conecta a tu VPS automáticamente.
                            </p>
                            <button
                              onClick={() => void provisionHubForRouter()}
                              disabled={hubProvisioning}
                              className="mt-6 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-8 py-3 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-60 transition shadow-lg shadow-emerald-600/20"
                            >
                              {hubProvisioning ? (
                                <><svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Generando...</>
                              ) : (
                                <>⚡ Generar Script de Conexión</>
                              )}
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between px-1">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                <p className="text-sm font-bold text-emerald-800 uppercase tracking-tight">Túnel Hub Configurado</p>
                              </div>
                              <button 
                                onClick={() => void provisionHubForRouter()}
                                className="text-[10px] text-slate-500 font-bold hover:text-emerald-600 transition"
                              >
                                Regenerar
                              </button>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3 p-4 bg-white border border-emerald-100 rounded-2xl shadow-sm text-xs">
                               <div className="flex flex-col gap-0.5">
                                 <span className="text-slate-500 font-medium">VPN Management IP</span>
                                 <strong className="text-emerald-700 font-mono text-sm">{hubData?.vpn_ip || 'Pendiente'}</strong>
                               </div>
                               <div className="flex flex-col gap-0.5">
                                 <span className="text-slate-500 font-medium">PPP User</span>
                                 <strong className="text-emerald-700 font-mono text-sm">{hubData?.vpn_username || 'admin'}</strong>
                               </div>
                            </div>

                            <div className="rounded-2xl border border-gray-200 bg-slate-950 overflow-hidden shadow-xl ring-1 ring-white/5">
                              <div className="flex items-center justify-between px-4 py-3 bg-gray-100 border-b border-gray-200">
                                <div className="flex items-center gap-2">
                                  <div className="flex gap-1">
                                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500/20 border border-rose-500/40" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/20 border border-amber-500/40" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/20 border border-emerald-500/40" />
                                  </div>
                                  <span className="text-[10px] font-bold text-slate-500 ml-2 uppercase tracking-widest">RouterOS Terminal</span>
                                </div>
                                <button
                                  onClick={async () => {
                                    await copyToClipboard(hubScript || '')
                                    addToast('success', 'Script copiado al portapapeles!')
                                  }}
                                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-lg text-[11px] font-bold transition shadow-sm"
                                >
                                  Copiar Script
                                </button>
                              </div>
                              <div className="p-5 font-mono text-[11px] leading-relaxed overflow-x-auto">
                                <pre className="text-emerald-400/90 whitespace-pre scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent max-h-[300px]">
                                  {hubScript}
                                </pre>
                              </div>
                            </div>
                            
                            <div className="flex gap-2">
                              <button
                                onClick={() => void runWizardValidation()}
                                className="flex-1 rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-200 transition shadow-sm"
                              >
                                Validar Conexión
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* MODE: NATIVE (Router as Server) */}
                    {vpnMode === 'native' && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        {!sstpTunnel ? (
                          <div className="text-center py-6 px-4 bg-blue-50/50 rounded-2xl border border-blue-100">
                            <div className="mx-auto w-14 h-14 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm border border-blue-100">
                              <CogIcon className="w-7 h-7 text-blue-500" />
                            </div>
                            <p className="text-sm font-bold text-slate-800">Servidor SSTP en MikroTik</p>
                            <p className="text-xs text-slate-500 mt-2 max-w-xs mx-auto leading-relaxed">
                              El MikroTik actúa como servidor. Requiere <strong>IP Pública</strong> y puerto 443/8443 abierto.
                            </p>
                            <button
                              onClick={() => void provisionSstpForRouter()}
                              disabled={sstpProvisioning}
                              className="mt-6 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 py-3 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-60 transition shadow-lg shadow-blue-600/20"
                            >
                              {sstpProvisioning ? 'Provisionando...' : '⚡ Configurar Servidor'}
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between px-1">
                              <div className="flex items-center gap-2">
                                <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-400 animate-pulse shadow-lg shadow-blue-400/50" />
                                <p className="text-sm font-bold text-blue-800 uppercase tracking-tight">Servidor Nativo Activo</p>
                              </div>
                              <button 
                                onClick={() => void provisionSstpForRouter()}
                                className="text-[10px] text-slate-500 font-bold hover:text-blue-600 transition"
                              >
                                Regenerar
                              </button>
                            </div>

                            <div className="grid grid-cols-2 gap-3 p-4 bg-white border border-blue-100 rounded-2xl shadow-sm text-xs">
                               <div className="flex flex-col gap-0.5">
                                 <span className="text-slate-500 font-medium">User</span>
                                 <strong className="text-blue-700 font-mono text-sm">{sstpTunnel.username}</strong>
                               </div>
                               <div className="flex flex-col gap-0.5">
                                 <span className="text-slate-500 font-medium">Server Host</span>
                                 <strong className="text-blue-700 font-mono text-sm">{sstpTunnel.server_host}</strong>
                               </div>
                            </div>

                            {sstpScript && (
                              <div className="rounded-2xl border border-gray-200 bg-slate-950 overflow-hidden shadow-xl ring-1 ring-white/5">
                                <div className="flex items-center justify-between px-4 py-3 bg-gray-100 border-b border-gray-200">
                                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">RouterOS Terminal</span>
                                  <button
                                    onClick={async () => {
                                      await copyToClipboard(sstpScript || '')
                                      addToast('success', 'Script copiado!')
                                    }}
                                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg text-[11px] font-bold transition shadow-sm"
                                  >
                                    Copiar Script
                                  </button>
                                </div>
                                <div className="p-5 font-mono text-[11px] leading-relaxed overflow-x-auto">
                                  <pre className="text-blue-400/90 whitespace-pre scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent max-h-[300px]">
                                    {sstpScript}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {expressSteps.length > 0 && (
                <div className="mt-2 space-y-1">
                  {expressSteps.map((step) => {
                    const toneClass =
                      step.status === 'success'
                        ? 'bg-emerald-500/20 text-emerald-600 border border-emerald-500/30'
                        : step.status === 'failed'
                          ? 'bg-rose-500/20 text-rose-600 border border-rose-500/30'
                          : step.status === 'running'
                            ? 'bg-blue-500/20 text-blue-600 border border-blue-500/30'
                            : step.status === 'skipped'
                              ? 'bg-slate-100 text-slate-500 border border-slate-200'
                              : 'bg-white backdrop-blur-md text-slate-500'
                    return (
                      <div key={step.id} className={`rounded px-2 py-1 text-xs border ${toneClass}`}>
                        <strong>{step.label}</strong>
                        {step.detail ? `: ${step.detail}` : ''}
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="mt-2 flex items-center justify-between rounded border border-emerald-200 bg-white backdrop-blur-md p-2">
                <p className="text-xs text-emerald-800">Modo avanzado (scripts/manual)</p>
                <button
                  onClick={() => setShowAdvancedScripts((prev) => !prev)}
                  className="rounded bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-800"
                >
                  {showAdvancedScripts ? 'Ocultar avanzado' : 'Mostrar avanzado'}
                </button>
              </div>

              {(quickConnect.connection_plan.actions || []).length > 0 && (
                <div className="mt-2 space-y-2">
                  {(quickConnect.connection_plan.actions || []).map((action) => {
                    const scriptValue = resolveQuickScript(quickConnect.scripts, action.script_key)
                    return (
                      <div key={action.id} className="rounded border border-emerald-200 bg-white backdrop-blur-md p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-emerald-900">{action.label}</p>
                            <p className="text-xs text-emerald-800">{action.description || '-'}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            {action.requires_local_access && (
                              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-600 border border-amber-500/30">
                                vía script local
                              </span>
                            )}
                            {action.auto_available && (
                              <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold text-blue-600 border border-blue-500/30">
                                auto
                              </span>
                            )}
                            {scriptValue && (
                              <button
                                onClick={() => copyScript(`script ${action.label}`, scriptValue)}
                                className="rounded bg-emerald-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-800"
                              >
                                Copiar script
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {showAdvancedScripts && (
            <>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Script acceso directo API/SSH</p>
              <button
                onClick={() => copyScript('script API', quickConnect.scripts?.direct_api_script || '')}
                className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Copiar
              </button>
            </div>
            <pre className="max-h-52 overflow-auto rounded bg-slate-950 p-3 text-xs text-emerald-400">
              {quickConnect.scripts.direct_api_script}
            </pre>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs font-semibold uppercase text-slate-500">Login Windows/Linux</p>
            <p className="mt-2 rounded bg-white px-2 py-1 text-xs text-slate-800 border border-gray-100">{quickConnect.scripts.windows_login}</p>
            <p className="mt-2 rounded bg-white px-2 py-1 text-xs text-slate-800 border border-gray-100">{quickConnect.scripts.linux_login}</p>
          </div>
          </>
          )}
        </>
      )}
    </div>
  )
}

export default ConfigTab
