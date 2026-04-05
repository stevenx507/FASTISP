"""add sstp_tunnels table

Revision ID: add_sstp_tunnels
Revises: 
Create Date: 2026-04-02
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_sstp_tunnels'
down_revision = 'c12b0a6f4e9d'
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    table_names = inspector.get_table_names()

    if 'sstp_tunnels' not in table_names:
        op.create_table(
            'sstp_tunnels',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('router_id', sa.Integer(), sa.ForeignKey('mikrotik_routers.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('tenant_id', sa.Integer(), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=True, index=True),
            sa.Column('username', sa.String(120), nullable=False, unique=True),
            sa.Column('password_hash', sa.String(255), nullable=False),
            sa.Column('password_plain', sa.LargeBinary(), nullable=False),
            sa.Column('server_ip', sa.String(45), nullable=False),
            sa.Column('client_ip', sa.String(45), nullable=False),
            sa.Column('server_host', sa.String(255), nullable=False, server_default='fastisp.cloud'),
            sa.Column('server_port', sa.Integer(), nullable=False, server_default='443'),
            sa.Column('status', sa.String(20), nullable=False, server_default='active'),
            sa.Column('last_seen', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('revoked_at', sa.DateTime(), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
        )
        return

    existing_columns = {column['name'] for column in inspector.get_columns('sstp_tunnels')}

    missing_columns = [
        ('password_hash', sa.Column('password_hash', sa.String(255), nullable=True)),
        ('password_plain', sa.Column('password_plain', sa.LargeBinary(), nullable=True)),
        ('server_host', sa.Column('server_host', sa.String(255), nullable=False, server_default='fastisp.cloud')),
        ('server_port', sa.Column('server_port', sa.Integer(), nullable=False, server_default='443')),
        ('revoked_at', sa.Column('revoked_at', sa.DateTime(), nullable=True)),
        ('notes', sa.Column('notes', sa.Text(), nullable=True)),
    ]

    for column_name, column in missing_columns:
        if column_name not in existing_columns:
            op.add_column('sstp_tunnels', column)


def downgrade():
    op.drop_table('sstp_tunnels')
