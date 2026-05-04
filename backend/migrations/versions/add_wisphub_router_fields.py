"""add WispHub-extended fields to mikrotik_routers

Revision ID: add_wisphub_router_fields
Revises: add_traffic_flow_stats
Create Date: 2026-04-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_wisphub_router_fields'
down_revision = 'add_traffic_flow_stats'
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    existing = [c['name'] for c in inspector.get_columns('mikrotik_routers')]
    cols = [
        sa.Column('vpn_username',         sa.String(120), nullable=True),
        sa.Column('vpn_password_encrypted', sa.LargeBinary(), nullable=True),
        sa.Column('vpn_ip_address',       sa.String(45), nullable=True),
        sa.Column('vpn_provisioned_at',   sa.DateTime(), nullable=True),
        sa.Column('wan_port',             sa.Integer(),  nullable=True, server_default='80'),
        sa.Column('lan_interface',        sa.String(40), nullable=True, server_default='ether1'),
        sa.Column('ip_ranges',            sa.Text(),     nullable=True),
        sa.Column('ros_version',          sa.String(10), nullable=True, server_default='7'),
        sa.Column('coordinates',          sa.String(80), nullable=True),
        sa.Column('comments',             sa.Text(),     nullable=True),
        sa.Column('use_sstp_script',      sa.Boolean(),  nullable=True, server_default=sa.true()),
        sa.Column('historial_trafico',    sa.Boolean(),  nullable=True, server_default=sa.false()),
        sa.Column('control_pppoe',        sa.Boolean(),  nullable=True, server_default=sa.false()),
        sa.Column('control_queue',        sa.Boolean(),  nullable=True, server_default=sa.false()),
        sa.Column('control_ap',           sa.Boolean(),  nullable=True, server_default=sa.false()),
        sa.Column('control_dhcp',         sa.Boolean(),  nullable=True, server_default=sa.false()),
        sa.Column('control_hotspot',      sa.Boolean(),  nullable=True, server_default=sa.false()),
        sa.Column('traffic_flow_enabled', sa.Boolean(),  nullable=True, server_default=sa.false()),
    ]
    with op.batch_alter_table('mikrotik_routers') as batch_op:
        for col in cols:
            if col.name not in existing:
                batch_op.add_column(col)

    existing_idx = [i['name'] for i in inspector.get_indexes('mikrotik_routers')]
    if 'ix_mikrotik_routers_vpn_username' not in existing_idx:
        with op.batch_alter_table('mikrotik_routers') as batch_op:
            batch_op.create_index('ix_mikrotik_routers_vpn_username', ['vpn_username'], unique=True)


def downgrade():
    with op.batch_alter_table('mikrotik_routers') as batch_op:
        for col in [
            'vpn_provisioned_at', 'vpn_ip_address', 'vpn_password_encrypted', 'vpn_username',
            'wan_port', 'lan_interface', 'ip_ranges', 'ros_version',
            'coordinates', 'comments', 'use_sstp_script', 'historial_trafico',
            'control_pppoe', 'control_queue', 'control_ap', 'control_dhcp',
            'control_hotspot', 'traffic_flow_enabled',
        ]:
            batch_op.drop_column(col)
