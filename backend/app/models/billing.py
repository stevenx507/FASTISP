from datetime import datetime, timezone
from app import db

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

class Subscription(db.Model):
    __tablename__ = 'subscriptions'

    id = db.Column(db.Integer, primary_key=True)
    customer = db.Column(db.String(150), nullable=False)
    email = db.Column(db.String(150), nullable=False)
    plan = db.Column(db.String(30), nullable=False)
    cycle_months = db.Column(db.Integer, nullable=False, default=1)
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='active')
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

class Invoice(db.Model):
    __tablename__ = 'invoices'

    id = db.Column(db.Integer, primary_key=True)
    subscription_id = db.Column(db.Integer, db.ForeignKey('subscriptions.id'), index=True, nullable=False)
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    currency = db.Column(db.String(8), nullable=False, default='USD')
    tax_percent = db.Column(db.Numeric(5, 2), nullable=False, default=0)
    total_amount = db.Column(db.Numeric(10, 2), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='pending')
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
    method = db.Column(db.String(30), nullable=False, default='manual')
    reference = db.Column(db.String(120), nullable=True)
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    currency = db.Column(db.String(8), nullable=False, default='USD')
    status = db.Column(db.String(20), nullable=False, default='pending')
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

class BillingPromise(db.Model):
    __tablename__ = 'billing_promises'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    subscription_id = db.Column(db.Integer, db.ForeignKey('subscriptions.id'), index=True, nullable=False)
    promised_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    promised_date = db.Column(db.Date, nullable=False)
    status = db.Column(db.String(20), nullable=False, default='pending')
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
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
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
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
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
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "used_at": self.used_at.isoformat() if self.used_at else None,
            "created_by": self.created_by,
            "created_by_name": self.created_by_name,
            "created_by_email": self.created_by_email,
            "updated_by": self.updated_by,
            "updated_by_name": self.updated_by_name,
            "updated_by_email": self.updated_by_email,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

class PlanBandwidthReuse(db.Model):
    __tablename__ = 'plan_bandwidth_reuse'
    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    plan_id = db.Column(db.Integer, db.ForeignKey('plans.id'), index=True, nullable=False)
    reuse_ratio = db.Column(db.String(10), nullable=False, default='1:1')
    queue_type = db.Column(db.String(20), nullable=False, default='simple')
    queue_algorithm = db.Column(db.String(20), nullable=False, default='default')
    parent_queue_name = db.Column(db.String(80), nullable=True)
    auto_adjust = db.Column(db.Boolean, nullable=False, default=True)
    last_adjusted_at = db.Column(db.DateTime, nullable=True)
    last_active_clients = db.Column(db.Integer, nullable=True)
    last_effective_down = db.Column(db.Integer, nullable=True)
    last_effective_up = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    plan = db.relationship('Plan', back_populates='bandwidth_reuse')
    __table_args__ = (db.UniqueConstraint('tenant_id', 'plan_id', name='uq_plan_bandwidth_reuse_tenant_plan'),)

class PlanDiscount(db.Model):
    __tablename__ = 'plan_discounts'
    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    plan_id = db.Column(db.Integer, db.ForeignKey('plans.id'), index=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    discount_type = db.Column(db.String(20), nullable=False, default='percent')
    discount_value = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    min_loyalty_months = db.Column(db.Integer, nullable=False, default=0)
    valid_from = db.Column(db.Date, nullable=True)
    valid_until = db.Column(db.Date, nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    plan = db.relationship('Plan', back_populates='discounts')
