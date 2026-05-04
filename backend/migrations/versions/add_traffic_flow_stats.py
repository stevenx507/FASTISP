"""add traffic_flow_stats table

Revision ID: add_traffic_flow_stats
Revises: add_vpn_fields_routers
Create Date: 2026-04-04
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_traffic_flow_stats'
down_revision = 'add_vpn_fields_routers'
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect
    conn = op.get_bind()
    if 'traffic_flow_stats' in inspect(conn).get_table_names():
        return
    op.create_table(
        'traffic_flow_stats',
        sa.Column('id',            sa.Integer(),    nullable=False),
        sa.Column('router_id',     sa.Integer(),    nullable=True),
        sa.Column('tenant_id',     sa.Integer(),    nullable=True),
        sa.Column('router_ip',     sa.String(45),   nullable=True),
        sa.Column('src_ip',        sa.String(45),   nullable=False),
        sa.Column('dst_ip',        sa.String(45),   nullable=True),
        sa.Column('bytes_total',   sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('packets_total', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('bucket',        sa.DateTime(),   nullable=False),
        sa.Column('created_at',    sa.DateTime(),   nullable=False, server_default=sa.text('NOW()')),
        sa.ForeignKeyConstraint(['router_id'], ['mikrotik_routers.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'],          ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('router_id', 'src_ip', 'bucket', name='uq_traffic_flow_router_src_bucket'),
    )
    op.create_index('ix_traffic_flow_bucket',  'traffic_flow_stats', ['bucket'])
    op.create_index('ix_traffic_flow_router',  'traffic_flow_stats', ['router_id'])
    op.create_index('ix_traffic_flow_src_ip',  'traffic_flow_stats', ['src_ip'])
    op.create_index('ix_traffic_flow_tenant',  'traffic_flow_stats', ['tenant_id'])


def downgrade():
    op.drop_index('ix_traffic_flow_tenant',  'traffic_flow_stats')
    op.drop_index('ix_traffic_flow_src_ip',  'traffic_flow_stats')
    op.drop_index('ix_traffic_flow_router',  'traffic_flow_stats')
    op.drop_index('ix_traffic_flow_bucket',  'traffic_flow_stats')
    op.drop_table('traffic_flow_stats')
