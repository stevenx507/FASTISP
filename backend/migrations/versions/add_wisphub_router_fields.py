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
    with op.batch_alter_table('mikrotik_routers') as batch_op:
        batch_op.add_column(sa.Column('wan_port',             sa.Integer(),     nullable=True, server_default='80'))
        batch_op.add_column(sa.Column('lan_interface',        sa.String(40),    nullable=True, server_default='ether1'))
        batch_op.add_column(sa.Column('ip_ranges',            sa.Text(),        nullable=True))
        batch_op.add_column(sa.Column('ros_version',          sa.String(10),    nullable=True, server_default='7'))
        batch_op.add_column(sa.Column('coordinates',          sa.String(80),    nullable=True))
        batch_op.add_column(sa.Column('comments',             sa.Text(),        nullable=True))
        batch_op.add_column(sa.Column('use_sstp_script',      sa.Boolean(),     nullable=True, server_default=sa.true()))
        batch_op.add_column(sa.Column('historial_trafico',    sa.Boolean(),     nullable=True, server_default=sa.false()))
        batch_op.add_column(sa.Column('control_pppoe',        sa.Boolean(),     nullable=True, server_default=sa.false()))
        batch_op.add_column(sa.Column('control_queue',        sa.Boolean(),     nullable=True, server_default=sa.false()))
        batch_op.add_column(sa.Column('control_ap',           sa.Boolean(),     nullable=True, server_default=sa.false()))
        batch_op.add_column(sa.Column('control_dhcp',         sa.Boolean(),     nullable=True, server_default=sa.false()))
        batch_op.add_column(sa.Column('control_hotspot',      sa.Boolean(),     nullable=True, server_default=sa.false()))
        batch_op.add_column(sa.Column('traffic_flow_enabled', sa.Boolean(),     nullable=True, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table('mikrotik_routers') as batch_op:
        for col in [
            'wan_port', 'lan_interface', 'ip_ranges', 'ros_version',
            'coordinates', 'comments', 'use_sstp_script', 'historial_trafico',
            'control_pppoe', 'control_queue', 'control_ap', 'control_dhcp',
            'control_hotspot', 'traffic_flow_enabled',
        ]:
            batch_op.drop_column(col)
