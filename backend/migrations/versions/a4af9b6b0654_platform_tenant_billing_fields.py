"""platform_tenant_billing_fields

Revision ID: a4af9b6b0654
Revises: b43a9f4d9d11
Create Date: 2026-02-24 18:15:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a4af9b6b0654'
down_revision = 'b43a9f4d9d11'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('tenants', schema=None) as batch_op:
        batch_op.add_column(sa.Column('plan_code', sa.String(length=40), nullable=False, server_default='starter'))
        batch_op.add_column(sa.Column('billing_status', sa.String(length=20), nullable=False, server_default='active'))
        batch_op.add_column(sa.Column('billing_cycle', sa.String(length=20), nullable=False, server_default='monthly'))
        batch_op.add_column(sa.Column('monthly_price', sa.Numeric(precision=10, scale=2), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('max_admins', sa.Integer(), nullable=False, server_default='3'))
        batch_op.add_column(sa.Column('max_routers', sa.Integer(), nullable=False, server_default='3'))
        batch_op.add_column(sa.Column('max_clients', sa.Integer(), nullable=False, server_default='300'))
        batch_op.add_column(sa.Column('trial_ends_at', sa.DateTime(), nullable=True))

        batch_op.alter_column('plan_code', server_default=None)
        batch_op.alter_column('billing_status', server_default=None)
        batch_op.alter_column('billing_cycle', server_default=None)
        batch_op.alter_column('monthly_price', server_default=None)
        batch_op.alter_column('max_admins', server_default=None)
        batch_op.alter_column('max_routers', server_default=None)
        batch_op.alter_column('max_clients', server_default=None)


def downgrade():
    with op.batch_alter_table('tenants', schema=None) as batch_op:
        batch_op.drop_column('trial_ends_at')
        batch_op.drop_column('max_clients')
        batch_op.drop_column('max_routers')
        batch_op.drop_column('max_admins')
        batch_op.drop_column('monthly_price')
        batch_op.drop_column('billing_cycle')
        batch_op.drop_column('billing_status')
        batch_op.drop_column('plan_code')
