"""add vpn fields to mikrotik_routers

Revision ID: add_vpn_fields_routers
Revises: add_sstp_tunnels
Create Date: 2026-04-03

Agrega campos VPN al modelo MikroTikRouter:
  - vpn_username: usuario SSTP en SoftEther
  - vpn_password_encrypted: contraseña encriptada
  - vpn_ip_address: IP fija asignada en la VPN (10.100.x.x)
  - vpn_provisioned_at: fecha de provisioning
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_vpn_fields_routers'
down_revision = 'add_sstp_tunnels'
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect
    conn = op.get_bind()
    existing = [c['name'] for c in inspect(conn).get_columns('mikrotik_routers')]
    with op.batch_alter_table('mikrotik_routers', schema=None) as batch_op:
        if 'vpn_username' not in existing:
            batch_op.add_column(sa.Column('vpn_username', sa.String(120), nullable=True))
        if 'vpn_password_encrypted' not in existing:
            batch_op.add_column(sa.Column('vpn_password_encrypted', sa.LargeBinary(), nullable=True))
        if 'vpn_ip_address' not in existing:
            batch_op.add_column(sa.Column('vpn_ip_address', sa.String(45), nullable=True))
        if 'vpn_provisioned_at' not in existing:
            batch_op.add_column(sa.Column('vpn_provisioned_at', sa.DateTime(), nullable=True))
    existing_idx = [i['name'] for i in inspect(conn).get_indexes('mikrotik_routers')]
    if 'ix_mikrotik_routers_vpn_username' not in existing_idx:
        with op.batch_alter_table('mikrotik_routers', schema=None) as batch_op:
            batch_op.create_index('ix_mikrotik_routers_vpn_username', ['vpn_username'], unique=True)


def downgrade():
    with op.batch_alter_table('mikrotik_routers', schema=None) as batch_op:
        batch_op.drop_index('ix_mikrotik_routers_vpn_username')
        batch_op.drop_column('vpn_provisioned_at')
        batch_op.drop_column('vpn_ip_address')
        batch_op.drop_column('vpn_password_encrypted')
        batch_op.drop_column('vpn_username')
