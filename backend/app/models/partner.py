from datetime import datetime, timezone
from app import db

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

    user = db.relationship('User', back_populates='partner_profile')
    tenant = db.relationship('Tenant', back_populates='partners')
    commissions = db.relationship('PartnerCommission', back_populates='partner', cascade="all, delete-orphan")

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

    partner = db.relationship('Partner', back_populates='commissions')
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
