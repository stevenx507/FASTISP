from datetime import datetime, timezone
from app import db
from app.lib.utils import get_fernet

class NetworkNode(db.Model):
    """Nodo de red: NAP, mufa, splitter, caja de distribución, antena, etc."""
    __tablename__ = 'network_nodes'

    id = db.Column(db.Integer, primary_key=True)
    tenant_id = db.Column(db.Integer, db.ForeignKey('tenants.id'), index=True, nullable=True)
    name = db.Column(db.String(120), nullable=False)
    node_type = db.Column(db.String(30), nullable=False, default='nap')
    technology = db.Column(db.String(20), nullable=False, default='fiber')
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)
    address = db.Column(db.String(255), nullable=True)
    zone = db.Column(db.String(80), nullable=True)
    capacity = db.Column(db.Integer, nullable=True)
    used_ports = db.Column(db.Integer, nullable=False, default=0)
    parent_node_id = db.Column(db.Integer, db.ForeignKey('network_nodes.id'), nullable=True)
    router_id = db.Column(db.Integer, db.ForeignKey('mikrotik_routers.id'), nullable=True)
    status = db.Column(db.String(20), nullable=False, default='active')
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    tenant = db.relationship('Tenant', back_populates='network_nodes')
    children = db.relationship('NetworkNode', backref=db.backref('parent', remote_side=[id]), cascade="all, delete-orphan")
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
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
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
    tenant = db.relationship('Tenant', back_populates='sstp_tunnels')

    @property
    def password(self):
        if self._password_encrypted:
            try:
                fernet = get_fernet()
                return fernet.decrypt(self._password_encrypted).decode('utf-8')
            except Exception:
                return None
        return None

    @password.setter
    def password(self, plaintext):
        if plaintext:
            fernet = get_fernet()
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
