from datetime import datetime, timezone
from app import db

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
    tenant = db.relationship('Tenant', back_populates='traffic_flow_stats')

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
