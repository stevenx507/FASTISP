export type ClientStatus = 'active' | 'inactive' | 'suspended' | 'past_due' | 'trial' | string

export interface OltDevice {
  id: string
  name: string
  vendor: string
  host?: string
}

export interface PendingOnu {
  serial: string
  frame?: number | string
  slot?: number | string
  pon?: number | string
  onu?: number | string
  vendor?: string
  model?: string
  status?: string
}

export interface Client {
  id: number
  name: string
  ip_address?: string | null
  username?: string | null
  plan?: string | null
  plan_id?: number | null
  router_id?: number | null
  router_name?: string | null
  status: ClientStatus
  email?: string | null
  phone?: string | null
  portal_access?: boolean
  lan_interface?: string | null
  dia_corte?: number | null
  avisos_pantalla?: boolean
}

export interface Plan {
  id: number
  name: string
  download_speed?: number
  upload_speed?: number
}

export interface Router {
  id: number
  name: string
  ip_address?: string
}

export const emptyClientForm = {
  // Tab 1: Datos de Conexión
  name: '',
  pppoe_username: '',
  pppoe_password: '',
  remote_address_pppoe: '',
  local_address_pppoe: '',
  mac_address: '',
  coordinates: '',
  ip_address: '',
  connection_type: 'pppoe',
  plan_id: '',
  router_id: '',
  sectorial_nap: '',
  // Tab 2: Datos del Cliente
  full_name: '',
  apellido: '',
  dni: '',
  email: '',
  external_id: '',
  address: '',
  barrio: '',
  ciudad: '',
  codigo_postal: '',
  phone: '',
  forma_contratacion: '',
  // Tab 3: Facturación
  tipo_cliente: 'prepago',
  dia_corte: '8',
  dia_factura: '1',
  dia_pago: '3',
  impuestos: '0',
  avisos_pantalla: true,
  notificaciones_push: true,
  suspender_facturas: '1',
  corte_automatico: true,
  facturas_automaticas: true,
  correo_corte: true,
  correo_facturas: true,
  // Tab 4: Configuración Avanzada
  password: '',
  create_portal_access: true,
  firewall_enabled: true,
  sistema_id: '',
  modelo_antena: '',
  password_antena: '',
  protocolo_conexion: '',
  ip_router_wifi: '',
  modelo_router_wifi: '',
  usuario_router_wifi: '',
  password_router_wifi: '',
  ssid_router_wifi: '',
  password_ssid_wifi: '',
  mac_router_wifi: '',
  comentarios: '',
  razon_social: '',
  ruc_nit: '',
}

export type ClientForm = typeof emptyClientForm
