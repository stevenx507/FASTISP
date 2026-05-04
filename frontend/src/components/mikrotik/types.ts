export type {
  Health,
  HealthRouterInfo,
  LogItem,
  DhcpLease,
  WirelessClient,
  Toast,
  RouterItem,
  RouterStats,
  QueueItem,
  ConnectionItem
} from '../types'

export type EnterpriseHardeningResult = EnterpriseHardeningResponse
export type EnterpriseFailoverResult = EnterpriseFailoverReport

export interface RouterListResponse {
  success: boolean
  routers: unknown[]
}

export interface RouterCreateResponse {
  success: boolean
  router?: unknown
  connection_tested?: boolean
  reachable?: boolean | null
  diagnostics?: RouterConnectionDiagnosticsPayload | null
  onboarding_profile?: RouterOnboardingProfile | null
  tenant_scope?: TenantScopePayload | null
  error?: string
}

export interface RouterConnectionDiagnosticsPayload {
  success?: boolean
  status?: string
  summary?: string
  host?: string
  api_port?: number
  host_scope?: string
  transport_hint?: string
  checks?: RouterReadinessCheck[]
  recommendations?: string[]
  runtime?: Record<string, unknown>
}

export interface RouterConnectionActionResponse {
  success?: boolean
  error?: string
  diagnostics?: RouterConnectionDiagnosticsPayload | null
}

export interface RouterSnmpProfilePayload {
  enabled?: boolean
  label?: string
  host?: string
  port?: number
  version?: string
  community?: string
  community_configured?: boolean
  community_preview?: string
  timeout_seconds?: number
  retries?: number
  poll_interfaces?: boolean
  interface_names?: string[]
  scalar_oids?: Record<string, string | { oid?: string; scale?: number }>
  thresholds?: Record<string, number>
  trap_enabled?: boolean
  trap_port?: number
  configured?: boolean
}

export interface RouterSnmpProfileResponse {
  success?: boolean
  error?: string
  profile?: RouterSnmpProfilePayload | null
  runtime_available?: boolean
}

export interface RouterSnmpPollInterface {
  index?: number | null
  name?: string
  alias?: string | null
  rx_bytes?: number
  tx_bytes?: number
  oper_status?: number
}

export interface RouterSnmpPollResponse {
  success?: boolean
  error?: string
  persisted?: boolean
  polled_at?: string
  runtime_available?: boolean
  health_metrics?: Record<string, unknown>
  interfaces?: RouterSnmpPollInterface[]
}

export interface SstpTunnelData {
  id: number
  router_id: number
  username: string
  password?: string
  server_host: string
  server_port: number
  server_ip: string
  client_ip: string
  status: string
  script?: string
  verification_script?: string
  created_at?: string
  router_name?: string
  error?: string
}

export interface RouterConnectionSnapshot {
  diagnostics: RouterConnectionDiagnosticsPayload
  checkedAt: number
}

export interface RememberConnectionDiagnosticsOptions {
  notifyOnChange?: boolean
  routerName?: string
}

export interface RouterQuickScripts {
  direct_api_script: string
  wireguard_site_to_vps_script: string
  bth_enable_minimal_script?: string
  windows_login: string
  linux_login: string
}

export interface RouterQuickGuidance {
  back_to_home: string[]
  notes: string[]
}

export interface RouterConnectionPlanAction {
  id: string
  label: string
  description?: string
  script_key?: string
  requires_local_access?: boolean
  auto_available?: boolean
}

export interface RouterConnectionPlan {
  status?: string
  title?: string
  summary?: string
  recommended_transport?: string
  actions?: RouterConnectionPlanAction[]
}

export interface ExpressStepState {
  id: string
  label: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  detail?: string
}

export interface RouterAccessProfile {
  requested_scope?: string
  detected_scope?: string
  effective_scope?: string
  is_ip?: boolean
  host?: string
  allows_direct_inbound?: boolean
  recommended_transport?: string
  reason?: string
}

export interface RouterBackToHomeUser {
  name: string
  allow_lan: boolean
  disabled: boolean
  expires: string
}

export interface RouterBackToHomeScripts {
  enable_script: string
  add_vps_user_script: string
  generate_private_key_hint: string
}

export interface RouterBackToHomeStatus {
  reachable?: boolean
  routeros_version?: string | null
  supported?: boolean | null
  bth_users_supported?: boolean | null
  ddns_enabled?: boolean | null
  back_to_home_vpn?: string | null
  vpn_status?: string | null
  vpn_dns_name?: string | null
  vpn_interface?: string | null
  vpn_port?: string | null
  users?: RouterBackToHomeUser[]
  users_error?: string
  scripts?: RouterBackToHomeScripts
  managed_identity?: {
    enabled?: boolean
    source?: string
    key_source?: string
    user_name?: string
    public_key?: string | null
    tenant_id?: number | null
    created_now?: boolean
    error?: string | null
  }
  limitations?: string[]
  error?: string
}

export interface RouterWireGuardProfile {
  endpoint?: string
  endpoint_host?: string
  endpoint_port?: number
  server_public_key?: string
  server_public_key_valid?: boolean
  allowed_subnets?: string
  ready?: boolean
  issues?: string[]
  source?: {
    endpoint?: string
    server_public_key?: string
    allowed_subnets?: string
  }
}

export interface RouterQuickConnectResponse {
  success: boolean
  access_profile?: RouterAccessProfile
  connection_plan?: RouterConnectionPlan
  wireguard_profile?: RouterWireGuardProfile
  onboarding_profile?: RouterOnboardingProfile | null
  tenant_scope?: TenantScopePayload | null
  scripts?: RouterQuickScripts
  guidance?: RouterQuickGuidance
  back_to_home?: RouterBackToHomeStatus
}

export interface RouterWireGuardRegisterAttempt {
  transport?: string
  success?: boolean
  mode?: string
  message?: string
}

export interface RouterWireGuardRegisterVpsSync {
  success?: boolean
  mode?: string
  message?: string
  manual_required?: boolean
  manual_command?: string
  attempts?: RouterWireGuardRegisterAttempt[]
}

export interface RouterWireGuardRegisterResponse {
  success?: boolean
  error?: string
  vps_sync?: RouterWireGuardRegisterVpsSync
}

export interface RouterBackToHomeBootstrapData {
  success?: boolean
  error?: string
  user_name?: string
  allow_lan?: boolean
  user_visible_after_run?: boolean
  operational?: boolean
  state?: string
  message?: string
  missing?: string[]
  next_steps?: string[]
  step?: string
  qr_text?: string
}

export interface RouterBackToHomeBootstrapResponse {
  success?: boolean
  error?: string
  bootstrap?: RouterBackToHomeBootstrapData
  vps_sync?: RouterWireGuardRegisterVpsSync
}

export interface EnterpriseProfileOption {
  id: string
  label: string
  description?: string
}

export interface EnterpriseProfilesPayload {
  router_profiles?: EnterpriseProfileOption[]
  site_profiles?: EnterpriseProfileOption[]
}

export interface EnterpriseProfilesResponse {
  success?: boolean
  profiles?: EnterpriseProfilesPayload
  error?: string
}

export interface EnterpriseHardeningResponse {
  success?: boolean
  dry_run?: boolean
  profile?: string
  site_profile?: string
  change_id?: string
  message?: string
  error?: string
  commands?: string[]
  rollback_commands?: string[]
  result?: string
  rollback_result?: Record<string, unknown> | null
}

export interface EnterpriseFailoverTarget {
  target: string
  total_probes: number
  success_probes: number
  packet_loss: number
  avg_latency_ms: number | null
  status: 'ok' | 'warning' | 'critical'
  error?: string
}

export interface EnterpriseFailoverReport {
  generated_at?: string
  overall_status?: 'ok' | 'warning' | 'critical'
  targets?: EnterpriseFailoverTarget[]
}

export interface EnterpriseFailoverResponse {
  success?: boolean
  report?: EnterpriseFailoverReport
  error?: string
}

export interface EnterpriseChangeLogEntry {
  change_id: string
  status: string
  category?: string
  actor?: string
  profile?: string
  site_profile?: string
  created_at?: string
  rolled_back_at?: string
}

export interface EnterpriseChangeLogResponse {
  success?: boolean
  changes?: EnterpriseChangeLogEntry[]
  error?: string
}

export interface WireGuardImportData {
  endpoint?: string
  endpoint_host?: string
  endpoint_port?: number | null
  interface_addresses?: string[]
  interface_private_key?: string
  peer_allowed_ips?: string[]
}

export interface WireGuardImportSuggestions {
  router_name?: string
  router_ip_or_host?: string
  api_port?: number
  default_username?: string
  bth_private_key?: string
  bth_user_name?: string
  router_tunnel_ip?: string | null
  router_management_ip_required?: boolean
  account_label?: string
}

export interface WireGuardImportResponse {
  success?: boolean
  error?: string
  source_file?: string
  wireguard?: WireGuardImportData
  suggestions?: WireGuardImportSuggestions
  onboarding_profile?: RouterOnboardingProfile | null
  tenant_scope?: TenantScopePayload | null
}

export interface RouterReadinessCheck {
  id: string
  ok: boolean
  detail?: string
  severity?: string
}

export interface RouterReadinessBlocker {
  id: string
  detail?: string
}

export interface RouterReadinessPayload {
  score?: number
  checks?: RouterReadinessCheck[]
  blockers?: RouterReadinessBlocker[]
  recommendations?: string[]
  write_probe_enabled?: boolean
}

export interface RouterReadinessResponse {
  success?: boolean
  error?: string
  readiness?: RouterReadinessPayload
}

export interface WireGuardOnboardResponse {
  success?: boolean
  error?: string
  created?: boolean
  reused_existing?: boolean
  updated_existing?: boolean
  source_file?: string
  wireguard?: WireGuardImportData
  router?: unknown
  readiness?: RouterReadinessPayload
  bootstrap?: RouterBackToHomeBootstrapData
  vps_sync?: RouterWireGuardRegisterVpsSync
  onboarding_profile?: RouterOnboardingProfile | null
  tenant_scope?: TenantScopePayload | null
}

export interface TenantScopePayload {
  tenant_id?: number | null
  tenant_slug?: string | null
  tenant_name?: string | null
  actor_email?: string | null
  actor_name?: string | null
}

export interface RouterOnboardingProfile {
  account_label?: string
  account_slug?: string
  router_name_prefix?: string
  default_username?: string
  default_api_port?: number
  default_bth_user_name?: string
  default_allow_lan?: boolean
  auto_vps_link?: boolean
  auto_bootstrap_bth?: boolean
  comment_prefix?: string
  tenant_scope?: TenantScopePayload | null
}

export interface RouterOnboardingProfileResponse {
  success?: boolean
  error?: string
  profile?: RouterOnboardingProfile | null
  tenant_scope?: TenantScopePayload | null
}

export interface RouterSnmpFormState {
  enabled: boolean
  host: string
  port: string
  community: string
  timeout_seconds: string
  retries: string
  poll_interfaces: boolean
  interface_names: string
  trap_enabled: boolean
  trap_port: string
  cpu_oid: string
  mem_oid: string
  temperature_oid: string
  temperature_scale: string
  voltage_oid: string
  voltage_scale: string
  signal_oid: string
  signal_scale: string
  optical_oid: string
  optical_scale: string
  onu_online_oid: string
  onu_offline_oid: string
  threshold_temperature: string
  threshold_voltage_min: string
  threshold_signal_min: string
  threshold_optical_min: string
}

export interface RouterFormState {
  name: string
  ip_address: string
  username: string
  password: string
  api_port: string
  wan_port: string
  lan_interface: string
  ip_ranges: string
  ros_version: '6' | '7'
  coordinates: string
  comments: string
  use_sstp_script: boolean
  historial_trafico: boolean
  control_pppoe: boolean
  control_queue: boolean
  control_ap: boolean
  control_dhcp: boolean
  control_hotspot: boolean
  traffic_flow_enabled: boolean
}
