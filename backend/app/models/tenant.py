from datetime import datetime, timezone
from app import db

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

    users = db.relationship('User', back_populates='tenant', cascade="all, delete-orphan")
    clients = db.relationship('Client', back_populates='tenant', cascade="all, delete-orphan")
    plans = db.relationship('Plan', back_populates='tenant', cascade="all, delete-orphan")
    routers = db.relationship('MikroTikRouter', back_populates='tenant', cascade="all, delete-orphan")
    tickets = db.relationship('Ticket', back_populates='tenant', cascade="all, delete-orphan")
    
    # Relationships for other modules (Forward references will be resolved by SQLAlchemy)
    audit_logs = db.relationship('AuditLog', back_populates='tenant', cascade="all, delete-orphan")
    admin_installations = db.relationship('AdminInstallation', backref='tenant', cascade="all, delete-orphan")
    admin_screen_alerts = db.relationship('AdminScreenAlert', backref='tenant', cascade="all, delete-orphan")
    admin_extra_services = db.relationship('AdminExtraService', backref='tenant', cascade="all, delete-orphan")
    admin_hotspot_vouchers = db.relationship('AdminHotspotVoucher', backref='tenant', cascade="all, delete-orphan")
    admin_system_settings = db.relationship('AdminSystemSetting', backref='tenant', cascade="all, delete-orphan")
    admin_system_jobs = db.relationship('AdminSystemJob', backref='tenant', cascade="all, delete-orphan")
    role_permissions = db.relationship('RolePermission', backref='tenant', cascade="all, delete-orphan")
    billing_promises = db.relationship('BillingPromise', backref='tenant', cascade="all, delete-orphan")
    noc_maintenance_windows = db.relationship('NocMaintenanceWindow', backref='tenant', cascade="all, delete-orphan")
    sstp_tunnels = db.relationship('SstpTunnel', back_populates='tenant', cascade="all, delete-orphan")
    partners = db.relationship('Partner', back_populates='tenant', cascade="all, delete-orphan")
    nap_boxes = db.relationship('NapBox', back_populates='tenant', cascade="all, delete-orphan")
    fiber_lines = db.relationship('FiberLine', back_populates='tenant', cascade="all, delete-orphan")
    product_categories = db.relationship('ProductCategory', back_populates='tenant', cascade="all, delete-orphan")
    suppliers = db.relationship('Supplier', back_populates='tenant', cascade="all, delete-orphan")
    products = db.relationship('Product', back_populates='tenant', cascade="all, delete-orphan")
    product_units = db.relationship('ProductUnit', back_populates='tenant', cascade="all, delete-orphan")
    network_nodes = db.relationship('NetworkNode', back_populates='tenant', cascade="all, delete-orphan")
    traffic_flow_stats = db.relationship('TrafficFlowStats', back_populates='tenant', cascade="all, delete-orphan")

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
