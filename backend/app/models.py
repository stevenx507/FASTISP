from datetime import datetime

from cryptography.fernet import Fernet
from flask import current_app
from werkzeug.security import check_password_hash, generate_password_hash

from app import db

def _get_fernet():
    """Helper to get Fernet instance for encryption/decryption."""
    key = current_app.config['ENCRYPTION_KEY']
    # If the key is bytes, use it directly. If it's a string, encode it.
    if isinstance(key, str):
        key = key.encode('utf-8')
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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    users = db.relationship('User', back_populates='tenant')
    clients = db.relationship('Client', back_populates='tenant')
    plans = db.relationship('Plan', back_populates='tenant')
    routers = db.relationship('MikroTikRouter', back_populates='tenant')
    tickets = db.relationship('Ticket', back_populates='tenant')

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
        }


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='client')  # 'client' or 'admin'
    name = db.Column(db.String(120), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
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
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
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
    
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True)
    plan_id = db.Column(db.Integer, db.ForeignKey('plans.id'))
    router_id = db.Column(db.Integer, db.ForeignKey('mikrotik_routers.id'))
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True)

    user = db.relationship('User', back_populates='client')
    plan = db.relationship('Plan', back_populates='clients')
    router = db.relationship('MikroTikRouter', back_populates='clients')
    tenant = db.relationship('Tenant', back_populates='clients')
    subscriptions = db.relationship('Subscription', back_populates='client')
    tickets = db.relationship('Ticket', back_populates='client')

    def to_dict(self):
        """Serializes the Client object to a dictionary."""
        return {
            'id': self.id,
            'name': self.full_name,
            'ip_address': self.ip_address,
            'mac_address': self.mac_address,
            'connection_type': self.connection_type,
            'plan_name': self.plan.name if self.plan else None,
            'tenant_id': self.tenant_id,
        }


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
    last_seen = db.Column(db.DateTime)
    alert_config = db.Column(db.JSON, nullable=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True)

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
        return {
            'id': self.id,
            'name': self.name,
            'ip_address': self.ip_address,
            'api_port': self.api_port,
            'status': 'online' if self.is_active else 'offline', # Simplified status
            'tenant_id': self.tenant_id,
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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

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
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

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
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
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
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

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
