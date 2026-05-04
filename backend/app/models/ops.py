from datetime import datetime, timezone
from app import db

class AuditLog(db.Model):
    __tablename__ = 'audit_logs'
    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), nullable=True, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True, index=True)
    action = db.Column(db.String(120), nullable=False)
    entity_type = db.Column(db.String(120), nullable=True)
    entity_id = db.Column(db.String(120), nullable=True)
    meta = db.Column('metadata', db.JSON, nullable=True)
    ip_address = db.Column(db.String(64), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    user = db.relationship('User')
    tenant = db.relationship('Tenant', back_populates='audit_logs')

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
            "scheduled_for": self.scheduled_for.isoformat() if self.scheduled_for else None,
            "notes": self.notes or "",
            "checklist": self.checklist or {},
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "completed_by": self.completed_by,
            "completed_by_name": self.completed_by_name,
            "created_by": self.created_by,
            "created_by_name": self.created_by_name,
            "created_by_email": self.created_by_email,
            "updated_by": self.updated_by,
            "updated_by_name": self.updated_by_name,
            "updated_by_email": self.updated_by_email,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
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
            "starts_at": self.starts_at.isoformat() if self.starts_at else None,
            "ends_at": self.ends_at.isoformat() if self.ends_at else None,
            "impressions": int(self.impressions or 0),
            "acknowledged": int(self.acknowledged or 0),
            "created_by": self.created_by,
            "created_by_name": self.created_by_name,
            "created_by_email": self.created_by_email,
            "updated_by": self.updated_by,
            "updated_by_name": self.updated_by_name,
            "updated_by_email": self.updated_by_email,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
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
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "result": self.result or {},
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
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
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
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

class NocMaintenanceWindow(db.Model):
    __tablename__ = 'noc_maintenance_windows'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    title = db.Column(db.String(255), nullable=False)
    scope = db.Column(db.String(30), nullable=False, default='all')  # all, router, billing, network
    starts_at = db.Column(db.DateTime, nullable=False)
    ends_at = db.Column(db.DateTime, nullable=False)
    mute_alerts = db.Column(db.Boolean, default=True)
    note = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "title": self.title,
            "scope": self.scope,
            "starts_at": self.starts_at.isoformat() if self.starts_at else None,
            "ends_at": self.ends_at.isoformat() if self.ends_at else None,
            "mute_alerts": self.mute_alerts,
            "note": self.note,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
