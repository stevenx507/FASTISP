from datetime import datetime, timezone
from app import db

class RemoteNatRule(db.Model):
    __tablename__ = 'remote_nat_rules'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    router_id = db.Column(db.Integer, db.ForeignKey('mikrotik_routers.id'), index=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    protocol = db.Column(db.String(10), nullable=False, default='tcp')
    src_port = db.Column(db.Integer, nullable=False)
    dst_address = db.Column(db.String(45), nullable=False)
    dst_port = db.Column(db.Integer, nullable=False)
    description = db.Column(db.String(255), nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    mikrotik_rule_id = db.Column(db.String(40), nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "router_id": self.router_id,
            "name": self.name,
            "protocol": self.protocol,
            "src_port": self.src_port,
            "dst_address": self.dst_address,
            "dst_port": self.dst_port,
            "description": self.description,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

class ClientDebtQuery(db.Model):
    __tablename__ = 'client_debt_queries'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    document_number = db.Column(db.String(40), nullable=False)
    ip_address = db.Column(db.String(45), nullable=True)
    result_found = db.Column(db.Boolean, default=False)
    queried_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, name='queried_at')

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "document_number": self.document_number,
            "ip_address": self.ip_address,
            "result_found": self.result_found,
            "queried_at": self.queried_at.isoformat() if self.queried_at else None,
        }
