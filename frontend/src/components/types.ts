// frontend/src/components/types.ts

export interface RouterItem {
  id: string;
  name: string;
  ip_address: string;
  model?: string;
  status?: string;
}

export interface HealthRouterInfo {
  cpu_load?: string;
  free_memory?: string;
  total_memory?: string;
  uptime?: string;
  model?: string;
  firmware?: string;
  serial_number?: string;
  identity?: string;
}

export interface Health {
  router?: HealthRouterInfo;
  queues?: number;
  connections?: number;
  health_score?: number;
}

export interface QueueItem {
  name: string;
  target?: string;
  max_limit?: string;
  rate?: string;
  id?: string;
  disabled?: boolean;
  comment?: string;
}

export interface ConnectionItem {
  id?: string;
  type: 'dhcp' | 'pppoe' | string;
  address?: string;
  mac_address?: string;
  host_name?: string;
  uptime?: string;
  status?: string;
}

export interface RouterStats {
  health: Health | null;
  queues: QueueItem[];
  connections: ConnectionItem[];
}

export interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

export interface LogItem {
  time?: string;
  topics?: string;
  message?: string;
}

export interface DhcpLease {
  address?: string;
  mac_address?: string;
  status?: string;
  expires_after?: string;
  'expires-after'?: string;
  'mac-address'?: string;
}

export interface WirelessClient {
  mac_address?: string;
  'mac-address'?: string;
  signal?: string;
  'tx-rate'?: string;
  'rx-rate'?: string;
  uptime?: string;
  authenticated?: boolean | string;
}
