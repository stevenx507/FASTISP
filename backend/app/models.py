import base64
import hashlib
from datetime import datetime

from cryptography.fernet import Fernet
from flask import current_app
from werkzeug.security import check_password_hash, generate_password_hash

from app import db


def _normalize_fernet_key(raw_key) -> bytes:
    """
    Normalize any secret string into a valid Fernet key (32 url-safe base64 bytes).
    - If already a valid 44-char base64url key → use as-is.
    - Otherwise → derive via SHA-256 so any string works (plain text in .env.prod).
    """
    if isinstance(raw_key, str):
        raw_key = raw_key.strip().encode('utf-8')
    # Fernet keys are exactly 44 base64url chars (32 bytes encoded)
    if len(raw_key) == 44:
        try:
            decoded = base64.urlsafe_b64decode(raw_key + b'==')
            if len(decoded) == 32:
                return raw_key  # Already valid
        except Exception:
            pass
    # Derive a valid 32-byte key via SHA-256 then re-encode
    digest = hashlib.sha256(raw_key).digest()
    return base64.urlsafe_b64encode(digest)


def _get_fernet():
    """Helper to get Fernet instance for encryption/decryption."""
    raw = current_app.config['ENCRYPTION_KEY']
    key = _normalize_fernet_key(raw)
    return Fernet(key)


class Tenant(db.Model):
    __tablename__ = 'tenants'

    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(80), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    plan_code = db.Column(db.String(40), nullable=False, default='starter')
    billing_status = db.Column(db.String(20), nullable=False, default='active')
    billing_cycle = db.Column(db.String(20), nullable=False, default='monthly')
    monthly_price = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    max_admins = db.Column(db.Integer, nullable=False, default=3)
    max_routers = db.Column(db.Integer, nullable=False, default=3)
    max_clients = db.Column(db.Integer, nullable=False, default=300)
    trial_ends_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    
    # --- SaaS Branding (Marca Blanca) ---
    brand_name = db.Column(db.String(120), nullable=True)
    logo_url = db.Column(db.String(255), nullable=True)
    primary_color = db.Column(db.String(20), default='#3b82f6')
    secondary_color = db.Column(db.String(20), default='#1e293b')
    custom_domain = db.Column(db.String(120), unique=True, nullable=True)

    users = db.relationship('User', back_populates='tenant')
    clients = db.relationship('Client', back_populates='tenant')
    plans = db.relationship('Plan', back_populates='tenant')
    routers = db.relationship('MikroTikRouter', back_populates='tenant')
    tickets = db.relationship('Ticket', back_populates='tenant')
    product_categories = db.relationship('ProductCategory', back_populates='tenant')
    suppliers = db.relationship('Supplier', back_populates='tenant')
    products = db.relationship('Product', back_populates='tenant')
    product_units = db.relationship('ProductUnit', back_populates='tenant')
    nap_boxes = db.relationship('NapBox', back_populates='tenant')
    fiber_lines = db.relationship('FiberLine', back_populates='tenant')
    network_nodes = db.relationship('NetworkNode', back_populates='tenant')


    def to_dict(self):
        return {
            'id': self.id,
            'slug': self.slug,
            'name': self.name,
            'is_active': self.is_active,
            'plan_code': self.plan_code,
            'billing_status': self.billing_status,
            'billing_cycle': self.billing_cycle,
            'monthly_price': float(self.monthly_price or 0),
            'max_admins': self.max_admins,
            'max_routers': self.max_routers,
            'max_clients': self.max_clients,
            'trial_ends_at': self.trial_ends_at.isoformat() if self.trial_ends_at else None,
            'brand_name': self.brand_name,
            'logo_url': self.logo_url,
            'primary_color': self.primary_color,
            'secondary_color': self.secondary_color,
            'custom_domain': self.custom_domain,
        }


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='client')  # 'client' or 'admin'
    name = db.Column(db.String(120), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True)
    mfa_enabled = db.Column(db.Boolean, default=False, nullable=False)
    mfa_secret = db.Column(db.String(128))

    # Relationship to Client
    client = db.relationship('Client', back_populates='user', uselist=False, cascade="all, delete-orphan")
    tenant = db.relationship('Tenant', back_populates='users')
    tickets = db.relationship('Ticket', back_populates='user')

    def set_password(self, password):
        """Hashes and sets the user's password."""
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        """Checks if the provided password matches the stored hash."""
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        """Serializes the User object to a dictionary."""
        user_data = {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'role': self.role,
            'tenant_id': self.tenant_id,
            'mfa_enabled': self.mfa_enabled,
        }
        if self.role == 'client' and self.client and self.client.plan:
            user_data['plan'] = self.client.plan.name
            user_data['client_id'] = self.client.id
        return user_data

    def __repr__(self):
        return f'<User {self.email}>'


class Subscription(db.Model):
    __tablename__ = 'subscriptions'

    id = db.Column(db.Integer, primary_key=True)
    customer = db.Column(db.String(150), nullable=False)
    email = db.Column(db.String(150), nullable=False)
    plan = db.Column(db.String(30), nullable=False)  # Mensual, Trimestral, Semestral, Anual
    cycle_months = db.Column(db.Integer, nullable=False, default=1)
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='active')  # active, past_due, trial, suspended, cancelled
    currency = db.Column(db.String(8), nullable=False, default='USD')
    country = db.Column(db.String(4), nullable=True)
    tax_percent = db.Column(db.Numeric(5, 2), nullable=False, default=0)
    next_charge = db.Column(db.Date, nullable=False)
    method = db.Column(db.String(30), nullable=False, default='manual')
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'), index=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    client = db.relationship('Client', back_populates='subscriptions')
    invoices = db.relationship('Invoice', back_populates='subscription', cascade="all, delete-orphan")

    def to_dict(self):
        return {
            'id': self.id,
            'customer': self.customer,
            'email': self.email,
            'plan': self.plan,
            'cycle_months': self.cycle_months,
            'amount': float(self.amount),
            'status': self.status,
            'currency': self.currency,
            'country': self.country,
            'tax_percent': float(self.tax_percent),
            'next_charge': self.next_charge.isoformat() if self.next_charge else None,
            'method': self.method,
            'tenant_id': self.tenant_id,
            'client_id': self.client_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
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
            'status': self._derive_status(),
            'portal_access': self.user_id is not None,
            'email': self.user.email if self.user else None,
            'lan_interface': self.remote_address_pppoe,
        }

    def _derive_status(self) -> str:
        """Derive client status from associated subscriptions."""
        if self.status and self.status != 'active':
            return self.status
        if self.subscriptions:
            latest = max(self.subscriptions, key=lambda s: s.updated_at or s.created_at or datetime.min)
            if latest.status in ('suspended', 'cancelled'):
                return latest.status
            if latest.status == 'past_due':
                return 'past_due'
        return 'active'


class Plan(db.Model):
    __tablename__ = 'plans'
    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'name', name='uq_plan_tenant_name'),
    )

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    download_speed = db.Column(db.Integer, nullable=False) # In Mbps
    upload_speed = db.Column(db.Integer, nullable=False) # In Mbps
    price = db.Column(db.Float)
    features = db.Column(db.JSON)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True)

    tenant = db.relationship('Tenant', back_populates='plans')
    clients = db.relationship('Client', back_populates='plan')
    bandwidth_reuse = db.relationship('PlanBandwidthReuse', back_populates='plan', uselist=False)
    discounts = db.relationship('PlanDiscount', back_populates='plan')


    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'download_speed': self.download_speed,
            'upload_speed': self.upload_speed,
            'price': self.price,
            'tenant_id': self.tenant_id,
        }


class MikroTikRouter(db.Model):
    __tablename__ = 'mikrotik_routers'
    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'ip_address', name='uq_router_tenant_ip'),
    )

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    ip_address = db.Column(db.String(45), nullable=False)
    username = db.Column(db.String(80), nullable=False)
    _password_encrypted = db.Column(db.LargeBinary, nullable=False, name='password') # Stored as encrypted bytes
    api_port = db.Column(db.Integer, default=8728)
    is_active = db.Column(db.Boolean, default=True)
    device_type = db.Column(db.String(20), default='mikrotik') # mikrotik, huawei_olt, vsol_olt, etc.
    last_seen = db.Column(db.DateTime)
    alert_config = db.Column(db.JSON, nullable=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True)
    # ── Campos VPN (Pilar 1: Orquestador) ──────────────────────────────────
    vpn_username = db.Column(db.String(120), nullable=True, unique=True, index=True)
    vpn_password_encrypted = db.Column(db.LargeBinary, nullable=True)
    vpn_ip_address = db.Column(db.String(45), nullable=True)
    vpn_provisioned_at = db.Column(db.DateTime, nullable=True)
    # ── Campos extendidos ────────────────────────────────────────────────────
    wan_port              = db.Column(db.Integer, default=80, nullable=True)
    lan_interface         = db.Column(db.String(40), default='ether1', nullable=True)
    ip_ranges             = db.Column(db.Text, nullable=True)
    ros_version           = db.Column(db.String(10), default='7', nullable=True)
    coordinates           = db.Column(db.String(80), nullable=True)
    comments              = db.Column(db.Text, nullable=True)
    use_sstp_script       = db.Column(db.Boolean, default=True, nullable=True)
    historial_trafico     = db.Column(db.Boolean, default=False, nullable=True)
    control_pppoe         = db.Column(db.Boolean, default=False, nullable=True)
    control_queue         = db.Column(db.Boolean, default=False, nullable=True)
    control_ap            = db.Column(db.Boolean, default=False, nullable=True)
    control_dhcp          = db.Column(db.Boolean, default=False, nullable=True)
    control_hotspot       = db.Column(db.Boolean, default=False, nullable=True)
    traffic_flow_enabled  = db.Column(db.Boolean, default=False, nullable=True)

    tenant = db.relationship('Tenant', back_populates='routers')
    clients = db.relationship('Client', back_populates='router')

    @property
    def password(self):
        """Decrypts and returns the router's password."""
        if self._password_encrypted:
            try:
                fernet = _get_fernet()
                return fernet.decrypt(self._password_encrypted).decode('utf-8')
            except Exception as e:
                current_app.logger.error(f"Error decrypting MikroTik router password for {self.name}: {e}")
                return None
        return None

    @password.setter
    def password(self, plaintext_password):
        """Encrypts the plaintext password and stores it."""
        if plaintext_password:
            fernet = _get_fernet()
            self._password_encrypted = fernet.encrypt(plaintext_password.encode('utf-8'))
        else:
            self._password_encrypted = None

    def to_dict(self):
        sstp = getattr(self, 'sstp_tunnel', None)
        return {
            'id': self.id,
            'name': self.name,
            'ip_address': self.ip_address,
            'username': self.username,
            'api_port': self.api_port or 8728,
            'wan_port': self.wan_port or 80,
            'lan_interface': self.lan_interface or 'ether1',
            'ip_ranges': self.ip_ranges,
            'ros_version': self.ros_version or '7',
            'coordinates': self.coordinates,
            'comments': self.comments,
            'use_sstp_script': bool(self.use_sstp_script),
            'historial_trafico': bool(self.historial_trafico),
            'control_pppoe': bool(self.control_pppoe),
            'control_queue': bool(self.control_queue),
            'control_ap': bool(self.control_ap),
            'control_dhcp': bool(self.control_dhcp),
            'control_hotspot': bool(self.control_hotspot),
            'traffic_flow_enabled': bool(self.traffic_flow_enabled),
            'status': 'online' if self.is_active else 'offline',
            'device_type': self.device_type,
            'tenant_id': self.tenant_id,
            'vpn_ip': self.vpn_ip_address,
            'vpn_username': self.vpn_username,
            'sstp_active': sstp is not None and getattr(sstp, 'status', None) == 'active',
            'sstp_username': sstp.username if sstp else None,
            'last_seen': self.last_seen.isoformat() if self.last_seen else None,
        }


class AuditLog(db.Model):
    __tablename__ = 'audit_logs'
    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), nullable=True, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True, index=True)
    action = db.Column(db.String(120), nullable=False)
    entity_type = db.Column(db.String(120), nullable=True)
    entity_id = db.Column(db.String(120), nullable=True)
    # "metadata" is reserved in SQLAlchemy Declarative; keep column name but expose as meta
    meta = db.Column('metadata', db.JSON, nullable=True)
    ip_address = db.Column(db.String(64), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    user = db.relationship('User')
    tenant = db.relationship('Tenant')

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "user_id": self.user_id,
            "action": self.action,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "metadata": self.meta,
            "ip_address": self.ip_address,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Ticket(db.Model):
    __tablename__ = 'tickets'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), index=True, nullable=True)
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'), index=True, nullable=True)
    subject = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(20), default='open', nullable=False)  # open, in_progress, resolved, closed
    priority = db.Column(db.String(20), default='medium', nullable=False)  # low, medium, high, urgent
    assigned_to = db.Column(db.String(120), nullable=True)
    sla_due_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    tenant = db.relationship('Tenant', back_populates='tickets')
    user = db.relationship('User', back_populates='tickets')
    client = db.relationship('Client', back_populates='tickets')
    comments = db.relationship('TicketComment', back_populates='ticket', cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "user_id": self.user_id,
            "client_id": self.client_id,
            "subject": self.subject,
            "description": self.description,
            "status": self.status,
            "priority": self.priority,
            "assigned_to": self.assigned_to,
            "sla_due_at": self.sla_due_at.isoformat() if self.sla_due_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class TicketComment(db.Model):
    __tablename__ = 'ticket_comments'
    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey('tickets.id'), index=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    comment = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    ticket = db.relationship('Ticket', back_populates='comments')
    user = db.relationship('User')

    def to_dict(self):
        return {
            "id": self.id,
            "ticket_id": self.ticket_id,
            "user_id": self.user_id,
            "comment": self.comment,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "author": self.user.email if self.user else None,
        }


class Invoice(db.Model):
    __tablename__ = 'invoices'

    id = db.Column(db.Integer, primary_key=True)
    subscription_id = db.Column(db.Integer, db.ForeignKey('subscriptions.id'), index=True, nullable=False)
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    currency = db.Column(db.String(8), nullable=False, default='USD')
    tax_percent = db.Column(db.Numeric(5, 2), nullable=False, default=0)
    total_amount = db.Column(db.Numeric(10, 2), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='pending')  # pending, paid, cancelled
    due_date = db.Column(db.Date, nullable=False)
    country = db.Column(db.String(4), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    subscription = db.relationship('Subscription', back_populates='invoices')
    payments = db.relationship('PaymentRecord', back_populates='invoice', cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "subscription_id": self.subscription_id,
            "amount": float(self.amount),
            "currency": self.currency,
            "tax_percent": float(self.tax_percent),
            "total_amount": float(self.total_amount),
            "status": self.status,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "country": self.country,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class PaymentRecord(db.Model):
    __tablename__ = 'payments'

    id = db.Column(db.Integer, primary_key=True)
    invoice_id = db.Column(db.Integer, db.ForeignKey('invoices.id'), index=True, nullable=False)
    method = db.Column(db.String(30), nullable=False, default='manual')  # stripe, yape, nequi, transfer
    reference = db.Column(db.String(120), nullable=True)
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    currency = db.Column(db.String(8), nullable=False, default='USD')
    status = db.Column(db.String(20), nullable=False, default='pending')  # pending, paid, failed
    meta = db.Column('metadata', db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    invoice = db.relationship('Invoice', back_populates='payments')

    def to_dict(self):
        return {
            "id": self.id,
            "invoice_id": self.invoice_id,
            "method": self.method,
            "reference": self.reference,
            "amount": float(self.amount),
            "currency": self.currency,
            "status": self.status,
            "metadata": self.meta,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


def _iso_datetime(value):
    return value.isoformat() if value else None


class AdminInstallation(db.Model):
    __tablename__ = 'admin_installations'

    id = db.Column(db.String(64), primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'), index=True, nullable=True)
    client_name = db.Column(db.String(160), nullable=False)
    plan = db.Column(db.String(120), nullable=True)
    router = db.Column(db.String(120), nullable=True)
    address = db.Column(db.String(255), nullable=False, default='Sin direccion')
    status = db.Column(db.String(30), nullable=False, default='pending')
    priority = db.Column(db.String(20), nullable=False, default='normal')
    technician = db.Column(db.String(160), nullable=False, default='pendiente@ispfast.local')
    scheduled_for = db.Column(db.DateTime, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    checklist = db.Column(db.JSON, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)
    completed_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    completed_by_name = db.Column(db.String(160), nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_by_name = db.Column(db.String(160), nullable=True)
    created_by_email = db.Column(db.String(160), nullable=True)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_by_name = db.Column(db.String(160), nullable=True)
    updated_by_email = db.Column(db.String(160), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "client_id": self.client_id,
            "client_name": self.client_name,
            "plan": self.plan,
            "router": self.router,
            "address": self.address,
            "status": self.status,
            "priority": self.priority,
            "technician": self.technician,
            "scheduled_for": _iso_datetime(self.scheduled_for),
            "notes": self.notes or "",
            "checklist": self.checklist or {},
            "completed_at": _iso_datetime(self.completed_at),
            "completed_by": self.completed_by,
            "completed_by_name": self.completed_by_name,
            "created_by": self.created_by,
            "created_by_name": self.created_by_name,
            "created_by_email": self.created_by_email,
            "updated_by": self.updated_by,
            "updated_by_name": self.updated_by_name,
            "updated_by_email": self.updated_by_email,
            "created_at": _iso_datetime(self.created_at),
            "updated_at": _iso_datetime(self.updated_at),
        }


class AdminScreenAlert(db.Model):
    __tablename__ = 'admin_screen_alerts'

    id = db.Column(db.String(64), primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    title = db.Column(db.String(160), nullable=False)
    message = db.Column(db.Text, nullable=False)
    severity = db.Column(db.String(20), nullable=False, default='info')
    audience = db.Column(db.String(20), nullable=False, default='all')
    status = db.Column(db.String(20), nullable=False, default='draft')
    starts_at = db.Column(db.DateTime, nullable=True)
    ends_at = db.Column(db.DateTime, nullable=True)
    impressions = db.Column(db.Integer, nullable=False, default=0)
    acknowledged = db.Column(db.Integer, nullable=False, default=0)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_by_name = db.Column(db.String(160), nullable=True)
    created_by_email = db.Column(db.String(160), nullable=True)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_by_name = db.Column(db.String(160), nullable=True)
    updated_by_email = db.Column(db.String(160), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "title": self.title,
            "message": self.message,
            "severity": self.severity,
            "audience": self.audience,
            "status": self.status,
            "starts_at": _iso_datetime(self.starts_at),
            "ends_at": _iso_datetime(self.ends_at),
            "impressions": int(self.impressions or 0),
            "acknowledged": int(self.acknowledged or 0),
            "created_by": self.created_by,
            "created_by_name": self.created_by_name,
            "created_by_email": self.created_by_email,
            "updated_by": self.updated_by,
            "updated_by_name": self.updated_by_name,
            "updated_by_email": self.updated_by_email,
            "created_at": _iso_datetime(self.created_at),
            "updated_at": _iso_datetime(self.updated_at),
        }


class AdminExtraService(db.Model):
    __tablename__ = 'admin_extra_services'

    id = db.Column(db.String(64), primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    name = db.Column(db.String(160), nullable=False)
    category = db.Column(db.String(80), nullable=False, default='other')
    description = db.Column(db.Text, nullable=True)
    monthly_price = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    one_time_fee = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    status = db.Column(db.String(20), nullable=False, default='active')
    subscribers = db.Column(db.Integer, nullable=False, default=0)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_by_name = db.Column(db.String(160), nullable=True)
    created_by_email = db.Column(db.String(160), nullable=True)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_by_name = db.Column(db.String(160), nullable=True)
    updated_by_email = db.Column(db.String(160), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "name": self.name,
            "category": self.category,
            "description": self.description or "",
            "monthly_price": float(self.monthly_price or 0),
            "one_time_fee": float(self.one_time_fee or 0),
            "status": self.status,
            "subscribers": int(self.subscribers or 0),
            "created_by": self.created_by,
            "created_by_name": self.created_by_name,
            "created_by_email": self.created_by_email,
            "updated_by": self.updated_by,
            "updated_by_name": self.updated_by_name,
            "updated_by_email": self.updated_by_email,
            "created_at": _iso_datetime(self.created_at),
            "updated_at": _iso_datetime(self.updated_at),
        }


class AdminHotspotVoucher(db.Model):
    __tablename__ = 'admin_hotspot_vouchers'

    id = db.Column(db.String(64), primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    code = db.Column(db.String(64), nullable=False, index=True)
    profile = db.Column(db.String(80), nullable=False, default='basic')
    duration_minutes = db.Column(db.Integer, nullable=False, default=60)
    data_limit_mb = db.Column(db.Integer, nullable=False, default=0)
    price = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    status = db.Column(db.String(20), nullable=False, default='generated')
    assigned_to = db.Column(db.String(160), nullable=True)
    expires_at = db.Column(db.DateTime, nullable=True)
    used_at = db.Column(db.DateTime, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_by_name = db.Column(db.String(160), nullable=True)
    created_by_email = db.Column(db.String(160), nullable=True)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_by_name = db.Column(db.String(160), nullable=True)
    updated_by_email = db.Column(db.String(160), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'code', name='uq_hotspot_voucher_tenant_code'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "code": self.code,
            "profile": self.profile,
            "duration_minutes": int(self.duration_minutes or 0),
            "data_limit_mb": int(self.data_limit_mb or 0),
            "price": float(self.price or 0),
            "status": self.status,
            "assigned_to": self.assigned_to,
            "expires_at": _iso_datetime(self.expires_at),
            "used_at": _iso_datetime(self.used_at),
            "created_by": self.created_by,
            "created_by_name": self.created_by_name,
            "created_by_email": self.created_by_email,
            "updated_by": self.updated_by,
            "updated_by_name": self.updated_by_name,
            "updated_by_email": self.updated_by_email,
            "created_at": _iso_datetime(self.created_at),
            "updated_at": _iso_datetime(self.updated_at),
        }


class AdminSystemSetting(db.Model):
    __tablename__ = 'admin_system_settings'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    key = db.Column(db.String(120), nullable=False)
    value = db.Column(db.JSON, nullable=True)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'key', name='uq_admin_system_settings_tenant_key'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "key": self.key,
            "value": self.value,
            "updated_by": self.updated_by,
            "updated_at": _iso_datetime(self.updated_at),
        }


class AdminSystemJob(db.Model):
    __tablename__ = 'admin_system_jobs'

    id = db.Column(db.String(64), primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    job = db.Column(db.String(120), nullable=False, index=True)
    status = db.Column(db.String(40), nullable=False, index=True)
    requested_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    started_at = db.Column(db.DateTime, nullable=False)
    finished_at = db.Column(db.DateTime, nullable=True)
    result = db.Column(db.JSON, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "job": self.job,
            "status": self.status,
            "requested_by": self.requested_by,
            "started_at": _iso_datetime(self.started_at),
            "finished_at": _iso_datetime(self.finished_at),
            "result": self.result or {},
        }


class RolePermission(db.Model):
    __tablename__ = 'role_permissions'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    role = db.Column(db.String(30), nullable=False, index=True)
    permission = db.Column(db.String(120), nullable=False, index=True)
    allowed = db.Column(db.Boolean, nullable=False, default=True)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'role', 'permission', name='uq_role_permissions_tenant_role_perm'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "role": self.role,
            "permission": self.permission,
            "allowed": bool(self.allowed),
            "updated_by": self.updated_by,
            "updated_at": _iso_datetime(self.updated_at),
        }


class BillingPromise(db.Model):
    __tablename__ = 'billing_promises'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    subscription_id = db.Column(db.Integer, db.ForeignKey('subscriptions.id'), index=True, nullable=False)
    promised_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    promised_date = db.Column(db.Date, nullable=False)
    status = db.Column(db.String(20), nullable=False, default='pending')  # pending, kept, broken, cancelled
    notes = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    resolved_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    resolved_at = db.Column(db.DateTime, nullable=True)

    subscription = db.relationship('Subscription')

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "subscription_id": self.subscription_id,
            "promised_amount": float(self.promised_amount or 0),
            "promised_date": self.promised_date.isoformat() if self.promised_date else None,
            "status": self.status,
            "notes": self.notes or "",
            "created_by": self.created_by,
            "resolved_by": self.resolved_by,
            "created_at": _iso_datetime(self.created_at),
            "resolved_at": _iso_datetime(self.resolved_at),
        }


class NocMaintenanceWindow(db.Model):
    __tablename__ = 'noc_maintenance_windows'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    title = db.Column(db.String(160), nullable=False)
    scope = db.Column(db.String(40), nullable=False, default='all')  # all, router, billing, network
    starts_at = db.Column(db.DateTime, nullable=False)
    ends_at = db.Column(db.DateTime, nullable=False)
    mute_alerts = db.Column(db.Boolean, nullable=False, default=True)
    note = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "title": self.title,
            "scope": self.scope,
            "starts_at": _iso_datetime(self.starts_at),
            "ends_at": _iso_datetime(self.ends_at),
            "mute_alerts": bool(self.mute_alerts),
            "note": self.note or "",
            "created_by": self.created_by,
            "created_at": _iso_datetime(self.created_at),
        }


# Gestión de Almacén - Modelos para productos, categorías, proveedores y movimientos de inventario

class ProductCategory(db.Model):
    __tablename__ = 'product_categories'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)

    tenant = db.relationship('Tenant', back_populates='product_categories')
    products = db.relationship('Product', back_populates='category')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'tenant_id': self.tenant_id,
        }


class Supplier(db.Model):
    __tablename__ = 'suppliers'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    contact_email = db.Column(db.String(120), nullable=True)
    contact_phone = db.Column(db.String(20), nullable=True)
    address = db.Column(db.Text, nullable=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)

    tenant = db.relationship('Tenant', back_populates='suppliers')
    products = db.relationship('Product', back_populates='supplier')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'contact_email': self.contact_email,
            'contact_phone': self.contact_phone,
            'address': self.address,
            'tenant_id': self.tenant_id,
        }


class Product(db.Model):
    __tablename__ = 'products'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=True)
    sku = db.Column(db.String(50), unique=True, nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey('product_categories.id'), nullable=True)
    supplier_id = db.Column(db.Integer, db.ForeignKey('suppliers.id'), nullable=True)
    unit_cost = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    unit_price = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    stock_quantity = db.Column(db.Integer, nullable=False, default=0)
    min_stock_level = db.Column(db.Integer, nullable=False, default=0)
    max_stock_level = db.Column(db.Integer, nullable=True)
    location = db.Column(db.String(120), nullable=True)  # Ubicación en almacén
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)

    tenant = db.relationship('Tenant', back_populates='products')
    category = db.relationship('ProductCategory', back_populates='products')
    supplier = db.relationship('Supplier', back_populates='products')
    inventory_movements = db.relationship('InventoryMovement', back_populates='product')
    units = db.relationship('ProductUnit', back_populates='product')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'sku': self.sku,
            'category_id': self.category_id,
            'supplier_id': self.supplier_id,
            'unit_cost': float(self.unit_cost or 0),
            'unit_price': float(self.unit_price or 0),
            'stock_quantity': self.stock_quantity,
            'min_stock_level': self.min_stock_level,
            'max_stock_level': self.max_stock_level,
            'location': self.location,
            'tenant_id': self.tenant_id,
        }


class InventoryMovement(db.Model):
    __tablename__ = 'inventory_movements'

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    movement_type = db.Column(db.String(20), nullable=False)  # 'in', 'out', 'adjustment'
    quantity = db.Column(db.Integer, nullable=False)
    reason = db.Column(db.String(120), nullable=True)
    reference = db.Column(db.String(120), nullable=True)  # Número de orden, factura, etc.
    unit_cost = db.Column(db.Numeric(10, 2), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    product = db.relationship('Product', back_populates='inventory_movements')
    user = db.relationship('User')

    def to_dict(self):
        return {
            'id': self.id,
            'product_id': self.product_id,
            'movement_type': self.movement_type,
            'quantity': self.quantity,
            'reason': self.reason,
            'reference': self.reference,
            'unit_cost': float(self.unit_cost or 0),
            'notes': self.notes,
            'created_by': self.created_by,
            'tenant_id': self.tenant_id,
            'created_at': _iso_datetime(self.created_at),
        }




# ─────────────────────────────────────────────────────────────────────────────
# Módulo de Red: NAPs, mufas, splitters, nodos de infraestructura
# ─────────────────────────────────────────────────────────────────────────────

class NetworkNode(db.Model):
    """Nodo de red: NAP, mufa, splitter, caja de distribución, antena, etc."""
    __tablename__ = 'network_nodes'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    name = db.Column(db.String(120), nullable=False)
    node_type = db.Column(db.String(30), nullable=False, default='nap')
    # node_type: nap | mufa | splitter | antenna | olt | router | caja | poste | otro
    technology = db.Column(db.String(20), nullable=False, default='fiber')
    # technology: fiber | wireless | coax | copper
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    address = db.Column(db.String(255), nullable=True)
    zone = db.Column(db.String(80), nullable=True)
    capacity = db.Column(db.Integer, nullable=True)          # puertos / clientes máx
    used_ports = db.Column(db.Integer, nullable=False, default=0)
    parent_node_id = db.Column(db.Integer, db.ForeignKey('network_nodes.id'), nullable=True)
    router_id = db.Column(db.Integer, db.ForeignKey('mikrotik_routers.id'), nullable=True)
    status = db.Column(db.String(20), nullable=False, default='active')
    # status: active | inactive | maintenance | fault
    notes = db.Column(db.Text, nullable=True)
    installed_at = db.Column(db.DateTime, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    tenant = db.relationship('Tenant', back_populates='network_nodes')
    parent = db.relationship('NetworkNode', remote_side=[id], backref='children')
    router = db.relationship('MikroTikRouter')

    def to_dict(self):
        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'name': self.name,
            'node_type': self.node_type,
            'technology': self.technology,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'address': self.address or '',
            'zone': self.zone or '',
            'capacity': self.capacity,
            'used_ports': self.used_ports,
            'parent_node_id': self.parent_node_id,
            'router_id': self.router_id,
            'status': self.status,
            'notes': self.notes or '',
            'installed_at': _iso_datetime(self.installed_at),
            'created_by': self.created_by,
            'created_at': _iso_datetime(self.created_at),
            'updated_at': _iso_datetime(self.updated_at),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Módulo de Reuso de Ancho de Banda por Plan
# ─────────────────────────────────────────────────────────────────────────────

class PlanBandwidthReuse(db.Model):
    """Configuración de reuso de ancho de banda por plan (1:1, 1:2, 1:4, 1:8)."""
    __tablename__ = 'plan_bandwidth_reuse'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    plan_id = db.Column(db.Integer, db.ForeignKey('plans.id'), index=True, nullable=False)
    reuse_ratio = db.Column(db.String(10), nullable=False, default='1:1')
    # reuse_ratio: 1:1 | 1:2 | 1:4 | 1:8
    queue_type = db.Column(db.String(20), nullable=False, default='simple')
    # queue_type: simple | tree | mangle_tree
    queue_algorithm = db.Column(db.String(20), nullable=False, default='default')
    # queue_algorithm: default | pcq | cake
    parent_queue_name = db.Column(db.String(80), nullable=True)
    # Nombre de la cola padre en Queue Tree (si aplica)
    auto_adjust = db.Column(db.Boolean, nullable=False, default=True)
    # Si True, recalcula límites automáticamente cuando cambia el nº de clientes activos
    last_adjusted_at = db.Column(db.DateTime, nullable=True)
    last_active_clients = db.Column(db.Integer, nullable=True)
    last_effective_down = db.Column(db.Integer, nullable=True)  # Mbps efectivos tras reuso
    last_effective_up = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    plan = db.relationship('Plan', back_populates='bandwidth_reuse')

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'plan_id', name='uq_plan_bandwidth_reuse_tenant_plan'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'plan_id': self.plan_id,
            'reuse_ratio': self.reuse_ratio,
            'queue_type': self.queue_type,
            'queue_algorithm': self.queue_algorithm,
            'parent_queue_name': self.parent_queue_name or '',
            'auto_adjust': bool(self.auto_adjust),
            'last_adjusted_at': _iso_datetime(self.last_adjusted_at),
            'last_active_clients': self.last_active_clients,
            'last_effective_down': self.last_effective_down,
            'last_effective_up': self.last_effective_up,
            'created_at': _iso_datetime(self.created_at),
            'updated_at': _iso_datetime(self.updated_at),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Módulo de Consulta de Deuda Pública (sin login)
# ─────────────────────────────────────────────────────────────────────────────

class ClientDebtQuery(db.Model):
    """Registro de consultas de deuda realizadas por clientes (auditoría)."""
    __tablename__ = 'client_debt_queries'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    document_number = db.Column(db.String(30), nullable=False, index=True)
    ip_address = db.Column(db.String(64), nullable=True)
    result_found = db.Column(db.Boolean, nullable=False, default=False)
    queried_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'document_number': self.document_number,
            'ip_address': self.ip_address,
            'result_found': bool(self.result_found),
            'queried_at': _iso_datetime(self.queried_at),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Extensiones de Client: tipo de red, documento, historial técnico
# ─────────────────────────────────────────────────────────────────────────────

class ClientNetworkProfile(db.Model):
    """Perfil de red extendido del cliente (fibra óptica, antena, etc.)."""
    __tablename__ = 'client_network_profiles'

    id = db.Column(db.Integer, primary_key=True)
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'), unique=True, nullable=False)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)

    # Tipo de acceso
    access_technology = db.Column(db.String(20), nullable=False, default='fiber')
    # access_technology: fiber | wireless | coax | copper | docsis

    # Fibra óptica
    olt_id = db.Column(db.String(80), nullable=True)
    olt_port = db.Column(db.String(40), nullable=True)
    onu_serial = db.Column(db.String(80), nullable=True)
    onu_model = db.Column(db.String(80), nullable=True)
    splitter_id = db.Column(db.Integer, db.ForeignKey('network_nodes.id'), nullable=True)
    nap_id = db.Column(db.Integer, db.ForeignKey('network_nodes.id'), nullable=True)
    fiber_color = db.Column(db.String(30), nullable=True)   # color del hilo de fibra
    fiber_port = db.Column(db.String(10), nullable=True)

    # Antena / Wireless
    antenna_model = db.Column(db.String(80), nullable=True)
    antenna_ssid = db.Column(db.String(80), nullable=True)
    antenna_frequency = db.Column(db.String(20), nullable=True)  # 2.4GHz, 5GHz, 60GHz
    signal_level_dbm = db.Column(db.Float, nullable=True)
    ap_node_id = db.Column(db.Integer, db.ForeignKey('network_nodes.id'), nullable=True)

    # Documento de identidad (para consulta de deuda)
    document_type = db.Column(db.String(20), nullable=True)   # CC, RUC, DNI, NIT, etc.
    document_number = db.Column(db.String(30), nullable=True, index=True)

    # Facturación
    billing_type = db.Column(db.String(20), nullable=False, default='postpaid')
    # billing_type: prepaid | postpaid | date_to_date
    billing_day = db.Column(db.Integer, nullable=True)        # día del mes para cobro
    billing_start_date = db.Column(db.Date, nullable=True)    # para date_to_date
    discount_percent = db.Column(db.Numeric(5, 2), nullable=False, default=0)
    discount_reason = db.Column(db.String(120), nullable=True)
    loyalty_months = db.Column(db.Integer, nullable=False, default=0)

    # Notas técnicas e historial
    installation_notes = db.Column(db.Text, nullable=True)
    technical_notes = db.Column(db.Text, nullable=True)
    internal_emails = db.Column(db.JSON, nullable=True)  # lista de correos internos

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    client = db.relationship('Client', back_populates='network_profile')
    splitter = db.relationship('NetworkNode', foreign_keys=[splitter_id])
    nap = db.relationship('NetworkNode', foreign_keys=[nap_id])
    ap_node = db.relationship('NetworkNode', foreign_keys=[ap_node_id])

    def to_dict(self):
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
            'created_at': _iso_datetime(self.created_at),
            'updated_at': _iso_datetime(self.updated_at),
        }


# ─────────────────────────────────────────────────────────────────────────────
# NAT Remoto: reglas de redirección para acceso sin IP pública
# ─────────────────────────────────────────────────────────────────────────────

class RemoteNatRule(db.Model):
    """Regla NAT para acceso remoto a nodos sin IP pública."""
    __tablename__ = 'remote_nat_rules'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    router_id = db.Column(db.Integer, db.ForeignKey('mikrotik_routers.id'), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    protocol = db.Column(db.String(10), nullable=False, default='tcp')
    src_port = db.Column(db.Integer, nullable=False)          # Puerto externo en el router principal
    dst_address = db.Column(db.String(45), nullable=False)    # IP interna del nodo destino
    dst_port = db.Column(db.Integer, nullable=False)          # Puerto en el nodo destino
    description = db.Column(db.String(255), nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    mikrotik_rule_id = db.Column(db.String(20), nullable=True)  # ID de la regla en RouterOS
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    router = db.relationship('MikroTikRouter')

    def to_dict(self):
        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'router_id': self.router_id,
            'name': self.name,
            'protocol': self.protocol,
            'src_port': self.src_port,
            'dst_address': self.dst_address,
            'dst_port': self.dst_port,
            'description': self.description or '',
            'is_active': bool(self.is_active),
            'mikrotik_rule_id': self.mikrotik_rule_id,
            'created_by': self.created_by,
            'created_at': _iso_datetime(self.created_at),
            'updated_at': _iso_datetime(self.updated_at),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Extensiones de Plan: descuentos, tipo de facturación
# ─────────────────────────────────────────────────────────────────────────────

class PlanDiscount(db.Model):
    """Descuentos y promociones aplicables a un plan."""
    __tablename__ = 'plan_discounts'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    plan_id = db.Column(db.Integer, db.ForeignKey('plans.id'), index=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    discount_type = db.Column(db.String(20), nullable=False, default='percent')
    # discount_type: percent | fixed
    discount_value = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    min_loyalty_months = db.Column(db.Integer, nullable=False, default=0)
    # Meses mínimos de fidelidad para aplicar el descuento
    valid_from = db.Column(db.Date, nullable=True)
    valid_until = db.Column(db.Date, nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    plan = db.relationship('Plan', back_populates='discounts')

    def to_dict(self):
        return {
            'id': self.id,
            'tenant_id': self.tenant_id,
            'plan_id': self.plan_id,
            'name': self.name,
            'discount_type': self.discount_type,
            'discount_value': float(self.discount_value or 0),
            'min_loyalty_months': self.min_loyalty_months,
            'valid_from': self.valid_from.isoformat() if self.valid_from else None,
            'valid_until': self.valid_until.isoformat() if self.valid_until else None,
            'is_active': bool(self.is_active),
            'created_at': _iso_datetime(self.created_at),
        }


# NOTE: All model relationships are now defined inside their respective classes.
# The following legacy re-declarations have been removed to avoid confusion:
#   - Tenant.network_nodes (defined in class Tenant, L75)
#   - Plan.bandwidth_reuse (defined in class Plan, L372)
#   - Plan.discounts (defined in class Plan, L373)
#   - Client.network_profile (defined in class Client, L288)


# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# SstpTunnel - SSTP VPN tunnel provisioning per MikroTik router
# ─────────────────────────────────────────────────────────────────────────────

class SstpTunnel(db.Model):
    """Stores SSTP tunnel credentials and state for each ISP client MikroTik."""
    __tablename__ = 'sstp_tunnels'

    id = db.Column(db.Integer, primary_key=True)
    router_id = db.Column(db.Integer, db.ForeignKey('mikrotik_routers.id', ondelete='CASCADE'), nullable=False, index=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True, index=True)
    username = db.Column(db.String(120), nullable=False, unique=True)
    _password_encrypted = db.Column(db.LargeBinary, nullable=False, name='password_plain')
    server_ip = db.Column(db.String(45), nullable=False)
    client_ip = db.Column(db.String(45), nullable=False)
    server_host = db.Column(db.String(255), nullable=False, default='fastisp.cloud')
    server_port = db.Column(db.Integer, nullable=False, default=443)
    status = db.Column(db.String(20), nullable=False, default='active')
    last_seen = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    revoked_at = db.Column(db.DateTime, nullable=True)
    notes = db.Column(db.Text, nullable=True)

    router = db.relationship('MikroTikRouter', backref=db.backref('sstp_tunnel', uselist=False))
    tenant = db.relationship('Tenant')

    @property
    def password(self):
        if self._password_encrypted:
            try:
                fernet = _get_fernet()
                return fernet.decrypt(self._password_encrypted).decode('utf-8')
            except Exception:
                return None
        return None

    @password.setter
    def password(self, plaintext):
        if plaintext:
            fernet = _get_fernet()
            self._password_encrypted = fernet.encrypt(plaintext.encode('utf-8'))
        else:
            self._password_encrypted = None

    def to_dict(self, include_password=False):
        d = {
            'id': self.id,
            'router_id': self.router_id,
            'tenant_id': self.tenant_id,
            'username': self.username,
            'server_ip': self.server_ip,
            'client_ip': self.client_ip,
            'server_host': self.server_host,
            'server_port': self.server_port,
            'status': self.status,
            'last_seen': self.last_seen.isoformat() if self.last_seen else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'revoked_at': self.revoked_at.isoformat() if self.revoked_at else None,
            'router_name': self.router.name if self.router else None,
        }
        if include_password:
            d['password'] = self.password
        return d


class TrafficFlowStats(db.Model):
    """Aggregated NetFlow v5 traffic stats per source IP per hour bucket."""
    __tablename__ = 'traffic_flow_stats'
    __table_args__ = (
        db.UniqueConstraint('router_id', 'src_ip', 'bucket', name='uq_traffic_flow_router_src_bucket'),
        db.Index('ix_traffic_flow_bucket', 'bucket'),
        db.Index('ix_traffic_flow_router', 'router_id'),
        db.Index('ix_traffic_flow_src_ip', 'src_ip'),
    )

    id            = db.Column(db.Integer, primary_key=True)
    router_id     = db.Column(db.Integer, db.ForeignKey('mikrotik_routers.id', ondelete='SET NULL'), nullable=True, index=True)
    tenant_id     = db.Column(db.Integer, db.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True, index=True)
    router_ip     = db.Column(db.String(45), nullable=True)
    src_ip        = db.Column(db.String(45), nullable=False)
    dst_ip        = db.Column(db.String(45), nullable=True)
    bytes_total   = db.Column(db.BigInteger, nullable=False, default=0)
    packets_total = db.Column(db.BigInteger, nullable=False, default=0)
    bucket        = db.Column(db.DateTime, nullable=False)
    created_at    = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    router = db.relationship('MikroTikRouter')
    tenant = db.relationship('Tenant')

    def to_dict(self):
        mb = round(self.bytes_total / 1_048_576, 2) if self.bytes_total else 0
        return {
            'id':            self.id,
            'router_id':     self.router_id,
            'router_ip':     self.router_ip,
            'router_name':   self.router.name if self.router else None,
            'src_ip':        self.src_ip,
            'dst_ip':        self.dst_ip,
            'bytes_total':   self.bytes_total,
            'mb_total':      mb,
            'packets_total': self.packets_total,
            'bucket':        self.bucket.isoformat() if self.bucket else None,
        }


class ProductUnit(db.Model):
    __tablename__ = 'product_units'

    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey('products.id'), nullable=False)
    serial_number = db.Column(db.String(100), unique=True, nullable=False, index=True)
    mac_address = db.Column(db.String(20), nullable=True, index=True)
    status = db.Column(db.String(20), default='available', nullable=False)
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'), nullable=True)
    
    # Phase 4: Cable Reel Management (Bobinas)
    total_length = db.Column(db.Float, nullable=True) # in meters
    remaining_length = db.Column(db.Float, nullable=True)
    
    notes = db.Column(db.Text, nullable=True)

    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    product = db.relationship('Product', back_populates='units')
    tenant = db.relationship('Tenant', back_populates='product_units')

    def to_dict(self):
        return {
            'id': self.id,
            'product_id': self.product_id,
            'serial_number': self.serial_number,
            'mac_address': self.mac_address,
            'status': self.status,
            'client_id': self.client_id,
            'notes': self.notes,
            'total_length': self.total_length,
            'remaining_length': self.remaining_length,
            'tenant_id': self.tenant_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }



class NapBox(db.Model):
    __tablename__ = 'nap_boxes'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    address = db.Column(db.String(255), nullable=True)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    capacity = db.Column(db.Integer, default=16, nullable=False)
    used_ports = db.Column(db.Integer, default=0, nullable=False)
    status = db.Column(db.String(20), default='active', nullable=False)
    notes = db.Column(db.Text, nullable=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    tenant = db.relationship('Tenant', back_populates='nap_boxes')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'address': self.address,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'capacity': self.capacity,
            'used_ports': self.used_ports,
            'status': self.status,
            'notes': self.notes,
            'tenant_id': self.tenant_id,
        }


class FiberLine(db.Model):
    __tablename__ = 'fiber_lines'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    path_geojson = db.Column(db.Text, nullable=False)
    color = db.Column(db.String(20), default='#3b82f6')
    fiber_type = db.Column(db.String(50), nullable=True)
    status = db.Column(db.String(20), default='active', nullable=False)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    tenant = db.relationship('Tenant', back_populates='fiber_lines')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'path': self.path_geojson,
            'color': self.color,
            'fiber_type': self.fiber_type,
            'status': self.status,
            'tenant_id': self.tenant_id,
        }




class Partner(db.Model):
    __tablename__ = 'partners'
    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True)
    company_name = db.Column(db.String(120))
    contact_phone = db.Column(db.String(30))
    commission_percentage = db.Column(db.Float, default=10.0)
    status = db.Column(db.String(20), default='active')
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    user = db.relationship('User', backref=db.backref('partner_profile', uselist=False))
    tenant = db.relationship('Tenant', backref='partners')

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.user.name if self.user else self.company_name,
            "company_name": self.company_name,
            "commission_percentage": self.commission_percentage,
            "status": self.status,
            "created_at": self.created_at.isoformat()
        }

class PartnerCommission(db.Model):
    __tablename__ = 'partner_commissions'
    id = db.Column(db.Integer, primary_key=True)
    partner_id = db.Column(db.Integer, db.ForeignKey('partners.id'), index=True)
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'))
    invoice_id = db.Column(db.Integer, db.ForeignKey('invoices.id'))
    amount = db.Column(db.Numeric(10, 2))
    status = db.Column(db.String(20), default='pending') # pending, paid
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    partner = db.relationship('Partner', backref='commissions')
    client = db.relationship('Client')
    invoice = db.relationship('Invoice')

    def to_dict(self):
        return {
            "id": self.id,
            "partner_id": self.partner_id,
            "client_name": self.client.full_name if self.client else "Unknown",
            "amount": float(self.amount),
            "status": self.status,
            "created_at": self.created_at.isoformat()
        }
