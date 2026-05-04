from datetime import datetime, timezone
from flask import current_app
from app import db
from app.lib.utils import get_fernet

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
                fernet = get_fernet()
                return fernet.decrypt(self._password_encrypted).decode('utf-8')
            except Exception as e:
                current_app.logger.error(f"Error decrypting MikroTik router password for {self.name}: {e}")
                return None
        return None

    @password.setter
    def password(self, plaintext_password):
        """Encrypts the plaintext password and stores it."""
        if plaintext_password:
            fernet = get_fernet()
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
