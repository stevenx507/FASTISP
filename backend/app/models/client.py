from datetime import datetime, timezone
from app import db

class Client(db.Model):
    __tablename__ = 'clients'
    __table_args__ = (
        db.Index('ix_clients_tenant_router', 'tenant_id', 'router_id'),
    )

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(120), nullable=False)
    ip_address = db.Column(db.String(45))
    mac_address = db.Column(db.String(17))
    connection_type = db.Column(db.String(20), default='dhcp') # dhcp, pppoe, static
    pppoe_username = db.Column(db.String(80))
    pppoe_password = db.Column(db.String(80))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)

    # ── Datos de Conexión ───────────────────────────────────────────────────
    remote_address_pppoe  = db.Column(db.String(45),  nullable=True)
    local_address_pppoe   = db.Column(db.String(45),  nullable=True)
    sectorial_nap         = db.Column(db.String(80),  nullable=True)
    
    # ── Datos de Estado ─────────────────────────────────────────────────────
    status = db.Column(db.String(20), default='active', nullable=False) # active, suspended, cancelled

    # ── Datos del Cliente ───────────────────────────────────────────────────
    apellido              = db.Column(db.String(80),  nullable=True)
    dni                   = db.Column(db.String(40),  nullable=True)
    phone                 = db.Column(db.String(30),  nullable=True)
    address               = db.Column(db.Text,        nullable=True)
    barrio                = db.Column(db.String(80),  nullable=True)
    ciudad                = db.Column(db.String(80),  nullable=True)
    codigo_postal         = db.Column(db.String(20),  nullable=True)
    forma_contratacion    = db.Column(db.String(30),  nullable=True)
    external_id           = db.Column(db.String(80),  nullable=True)

    # ── Facturación ─────────────────────────────────────────────────────────
    tipo_cliente          = db.Column(db.String(20),  default='prepago',  nullable=True)
    dia_corte             = db.Column(db.Integer,     default=8,          nullable=True)
    dia_factura           = db.Column(db.Integer,     default=1,          nullable=True)
    dia_pago              = db.Column(db.Integer,     default=3,          nullable=True)
    impuestos             = db.Column(db.Float,       default=0.0,        nullable=True)
    avisos_pantalla       = db.Column(db.Boolean,     default=True,       nullable=True)
    notificaciones_push   = db.Column(db.Boolean,     default=True,       nullable=True)
    suspender_facturas    = db.Column(db.Integer,     default=1,          nullable=True)
    # Tareas periódicas
    corte_automatico      = db.Column(db.Boolean,     default=True,       nullable=True)
    facturas_automaticas  = db.Column(db.Boolean,     default=True,       nullable=True)
    correo_corte          = db.Column(db.Boolean,     default=True,       nullable=True)
    correo_facturas       = db.Column(db.Boolean,     default=True,       nullable=True)

    # ── Configuración Avanzada ──────────────────────────────────────────────
    firewall_enabled      = db.Column(db.Boolean,     default=True,       nullable=True)
    sistema_id            = db.Column(db.String(80),  nullable=True)
    modelo_antena         = db.Column(db.String(80),  nullable=True)
    password_antena       = db.Column(db.String(80),  nullable=True)
    protocolo_conexion    = db.Column(db.String(40),  nullable=True)
    ip_router_wifi        = db.Column(db.String(45),  nullable=True)
    modelo_router_wifi    = db.Column(db.String(80),  nullable=True)
    usuario_router_wifi   = db.Column(db.String(80),  nullable=True)
    password_router_wifi  = db.Column(db.String(80),  nullable=True)
    ssid_router_wifi      = db.Column(db.String(80),  nullable=True)
    password_ssid_wifi    = db.Column(db.String(80),  nullable=True)
    mac_router_wifi       = db.Column(db.String(17),  nullable=True)
    comentarios           = db.Column(db.Text,        nullable=True)
    # Datos fiscales
    razon_social          = db.Column(db.String(120), nullable=True)
    ruc_nit               = db.Column(db.String(40),  nullable=True)

    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True)
    plan_id = db.Column(db.Integer, db.ForeignKey('plans.id'))
    router_id = db.Column(db.Integer, db.ForeignKey('mikrotik_routers.id'))
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True)
    partner_id = db.Column(db.Integer, db.ForeignKey('partners.id'), nullable=True)

    user = db.relationship('User', back_populates='client')
    plan = db.relationship('Plan', back_populates='clients')
    router = db.relationship('MikroTikRouter', back_populates='clients')
    tenant = db.relationship('Tenant', back_populates='clients')
    partner = db.relationship('Partner', backref='referred_clients')
    subscriptions = db.relationship('Subscription', back_populates='client')
    tickets = db.relationship('Ticket', back_populates='client')
    assigned_units = db.relationship('ProductUnit', backref='assigned_client')
    network_profile = db.relationship('ClientNetworkProfile', back_populates='client', uselist=False, cascade='all, delete-orphan')

    def to_dict(self):
        """Serializes the Client object to a dictionary."""
        return {
            'id': self.id,
            'name': self.full_name,
            'apellido': self.apellido,
            'dni': self.dni,
            'phone': self.phone,
            'ip_address': self.ip_address,
            'mac_address': self.mac_address,
            'username': self.pppoe_username,
            'connection_type': self.connection_type,
            'pppoe_username': self.pppoe_username,
            'pppoe_password': '••••••••' if self.pppoe_password else None,
            'remote_address_pppoe': self.remote_address_pppoe,
            'local_address_pppoe': self.local_address_pppoe,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'sectorial_nap': self.sectorial_nap,
            'address': self.address,
            'barrio': self.barrio,
            'ciudad': self.ciudad,
            'codigo_postal': self.codigo_postal,
            'forma_contratacion': self.forma_contratacion,
            'external_id': self.external_id,
            'tipo_cliente': self.tipo_cliente,
            'dia_corte': self.dia_corte,
            'dia_factura': self.dia_factura,
            'dia_pago': self.dia_pago,
            'impuestos': self.impuestos,
            'avisos_pantalla': bool(self.avisos_pantalla),
            'notificaciones_push': bool(self.notificaciones_push),
            'suspender_facturas': self.suspender_facturas,
            'corte_automatico': bool(self.corte_automatico),
            'facturas_automaticas': bool(self.facturas_automaticas),
            'correo_corte': bool(self.correo_corte),
            'correo_facturas': bool(self.correo_facturas),
            'firewall_enabled': bool(self.firewall_enabled),
            'sistema_id': self.sistema_id,
            'modelo_antena': self.modelo_antena,
            'password_antena': self.password_antena,
            'protocolo_conexion': self.protocolo_conexion,
            'ip_router_wifi': self.ip_router_wifi,
            'modelo_router_wifi': self.modelo_router_wifi,
            'usuario_router_wifi': self.usuario_router_wifi,
            'password_router_wifi': self.password_router_wifi,
            'ssid_router_wifi': self.ssid_router_wifi,
            'password_ssid_wifi': self.password_ssid_wifi,
            'mac_router_wifi': self.mac_router_wifi,
            'comentarios': self.comentarios,
            'razon_social': self.razon_social,
            'ruc_nit': self.ruc_nit,
            'plan_id': self.plan_id,
            'plan': self.plan.name if self.plan else None,
            'plan_name': self.plan.name if self.plan else None,
            'router_id': self.router_id,
            'router_name': self.router.name if self.router else None,
            'tenant_id': self.tenant_id,
            'status': self.status,
            'portal_access': self.user_id is not None,
            'email': self.user.email if self.user else None,
            'lan_interface': self.remote_address_pppoe,
        }

class TrafficHistory(db.Model):
    __tablename__ = 'traffic_history'
    
    id = db.Column(db.Integer, primary_key=True)
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'), index=True)
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    download_bytes = db.Column(db.BigInteger, default=0)
    upload_bytes = db.Column(db.BigInteger, default=0)
    download_speed = db.Column(db.Float, default=0) # Mbps
    upload_speed = db.Column(db.Float, default=0) # Mbps
    
    client = db.relationship('Client', backref=db.backref('traffic_history_entries', lazy='dynamic'))

    def to_dict(self):
        return {
            'timestamp': self.timestamp.isoformat(),
            'download_speed': self.download_speed,
            'upload_speed': self.upload_speed,
            'download_bytes': self.download_bytes,
            'upload_bytes': self.upload_bytes
        }

class ClientNetworkProfile(db.Model):
    __tablename__ = 'client_network_profiles'

    id = db.Column(db.Integer, primary_key=True)
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'), unique=True, nullable=False)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    access_technology = db.Column(db.String(20), nullable=False, default='fiber')
    olt_id = db.Column(db.String(80), nullable=True)
    olt_port = db.Column(db.String(40), nullable=True)
    onu_serial = db.Column(db.String(80), nullable=True)
    onu_model = db.Column(db.String(80), nullable=True)
    splitter_id = db.Column(db.Integer, db.ForeignKey('network_nodes.id'), nullable=True)
    nap_id = db.Column(db.Integer, db.ForeignKey('network_nodes.id'), nullable=True)
    fiber_color = db.Column(db.String(30), nullable=True)
    fiber_port = db.Column(db.String(10), nullable=True)
    antenna_model = db.Column(db.String(80), nullable=True)
    antenna_ssid = db.Column(db.String(80), nullable=True)
    antenna_frequency = db.Column(db.String(20), nullable=True)
    signal_level_dbm = db.Column(db.Float, nullable=True)
    ap_node_id = db.Column(db.Integer, db.ForeignKey('network_nodes.id'), nullable=True)
    document_type = db.Column(db.String(20), nullable=True)
    document_number = db.Column(db.String(30), nullable=True, index=True)
    billing_type = db.Column(db.String(20), nullable=False, default='postpaid')
    billing_day = db.Column(db.Integer, nullable=True)
    billing_start_date = db.Column(db.Date, nullable=True)
    discount_percent = db.Column(db.Numeric(5, 2), nullable=False, default=0)
    discount_reason = db.Column(db.String(120), nullable=True)
    loyalty_months = db.Column(db.Integer, nullable=False, default=0)
    installation_notes = db.Column(db.Text, nullable=True)
    technical_notes = db.Column(db.Text, nullable=True)
    internal_emails = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    client = db.relationship('Client', back_populates='network_profile')
    splitter = db.relationship('NetworkNode', foreign_keys=[splitter_id])
    nap = db.relationship('NetworkNode', foreign_keys=[nap_id])
    ap_node = db.relationship('NetworkNode', foreign_keys=[ap_node_id])

    def to_dict(self):
        from app.lib.utils import parse_iso_datetime
        return {
            'id': self.id,
            'client_id': self.client_id,
            'tenant_id': self.tenant_id,
            'access_technology': self.access_technology,
            'olt_id': self.olt_id,
            'olt_port': self.olt_port,
            'onu_serial': self.onu_serial,
            'onu_model': self.onu_model,
            'splitter_id': self.splitter_id,
            'nap_id': self.nap_id,
            'fiber_color': self.fiber_color,
            'fiber_port': self.fiber_port,
            'antenna_model': self.antenna_model,
            'antenna_ssid': self.antenna_ssid,
            'antenna_frequency': self.antenna_frequency,
            'signal_level_dbm': self.signal_level_dbm,
            'ap_node_id': self.ap_node_id,
            'document_type': self.document_type,
            'document_number': self.document_number,
            'billing_type': self.billing_type,
            'billing_day': self.billing_day,
            'billing_start_date': self.billing_start_date.isoformat() if self.billing_start_date else None,
            'discount_percent': float(self.discount_percent or 0),
            'discount_reason': self.discount_reason or '',
            'loyalty_months': self.loyalty_months,
            'installation_notes': self.installation_notes or '',
            'technical_notes': self.technical_notes or '',
            'internal_emails': self.internal_emails or [],
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
