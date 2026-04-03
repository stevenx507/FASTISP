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
    with op.batch_alter_table('mikrotik_routers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('vpn_username', sa.String(120), nullable=True))
        batch_op.add_column(sa.Column('vpn_password_encrypted', sa.LargeBinary(), nullable=True))
        batch_op.add_column(sa.Column('vpn_ip_address', sa.String(45), nullable=True))
        batch_op.add_column(sa.Column('vpn_provisioned_at', sa.DateTime(), nullable=True))
        batch_op.create_index('ix_mikrotik_routers_vpn_username', ['vpn_username'], unique=True)


def downgrade():
    with op.batch_alter_table('mikrotik_routers', schema=None) as batch_op:
        batch_op.drop_index('ix_mikrotik_routers_vpn_username')
        batch_op.drop_column('vpn_provisioned_at')
        batch_op.drop_column('vpn_ip_address')
        batch_op.drop_column('vpn_password_encrypted')
        batch_op.drop_column('vpn_username')
