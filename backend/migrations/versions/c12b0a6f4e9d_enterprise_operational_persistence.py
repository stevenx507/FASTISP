"""enterprise_operational_persistence

Revision ID: c12b0a6f4e9d
Revises: a4af9b6b0654
Create Date: 2026-02-25 12:10:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c12b0a6f4e9d'
down_revision = 'a4af9b6b0654'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'admin_installations',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('client_id', sa.Integer(), nullable=True),
        sa.Column('client_name', sa.String(length=160), nullable=False),
        sa.Column('plan', sa.String(length=120), nullable=True),
        sa.Column('router', sa.String(length=120), nullable=True),
        sa.Column('address', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=30), nullable=False),
        sa.Column('priority', sa.String(length=20), nullable=False),
        sa.Column('technician', sa.String(length=160), nullable=False),
        sa.Column('scheduled_for', sa.DateTime(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('checklist', sa.JSON(), nullable=True),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('completed_by', sa.Integer(), nullable=True),
        sa.Column('completed_by_name', sa.String(length=160), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_by_name', sa.String(length=160), nullable=True),
        sa.Column('created_by_email', sa.String(length=160), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('updated_by_name', sa.String(length=160), nullable=True),
        sa.Column('updated_by_email', sa.String(length=160), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ),
        sa.ForeignKeyConstraint(['completed_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_admin_installations_tenant_id'), 'admin_installations', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_admin_installations_client_id'), 'admin_installations', ['client_id'], unique=False)

    op.create_table(
        'admin_screen_alerts',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(length=160), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('severity', sa.String(length=20), nullable=False),
        sa.Column('audience', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('starts_at', sa.DateTime(), nullable=True),
        sa.Column('ends_at', sa.DateTime(), nullable=True),
        sa.Column('impressions', sa.Integer(), nullable=False),
        sa.Column('acknowledged', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_by_name', sa.String(length=160), nullable=True),
        sa.Column('created_by_email', sa.String(length=160), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('updated_by_name', sa.String(length=160), nullable=True),
        sa.Column('updated_by_email', sa.String(length=160), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_admin_screen_alerts_tenant_id'), 'admin_screen_alerts', ['tenant_id'], unique=False)

    op.create_table(
        'admin_extra_services',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('category', sa.String(length=80), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('monthly_price', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('one_time_fee', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('subscribers', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_by_name', sa.String(length=160), nullable=True),
        sa.Column('created_by_email', sa.String(length=160), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('updated_by_name', sa.String(length=160), nullable=True),
        sa.Column('updated_by_email', sa.String(length=160), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_admin_extra_services_tenant_id'), 'admin_extra_services', ['tenant_id'], unique=False)

    op.create_table(
        'admin_hotspot_vouchers',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('code', sa.String(length=64), nullable=False),
        sa.Column('profile', sa.String(length=80), nullable=False),
        sa.Column('duration_minutes', sa.Integer(), nullable=False),
        sa.Column('data_limit_mb', sa.Integer(), nullable=False),
        sa.Column('price', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('assigned_to', sa.String(length=160), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('used_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_by_name', sa.String(length=160), nullable=True),
        sa.Column('created_by_email', sa.String(length=160), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('updated_by_name', sa.String(length=160), nullable=True),
        sa.Column('updated_by_email', sa.String(length=160), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'code', name='uq_hotspot_voucher_tenant_code')
    )
    op.create_index(op.f('ix_admin_hotspot_vouchers_tenant_id'), 'admin_hotspot_vouchers', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_admin_hotspot_vouchers_code'), 'admin_hotspot_vouchers', ['code'], unique=False)

    op.create_table(
        'admin_system_settings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('key', sa.String(length=120), nullable=False),
        sa.Column('value', sa.JSON(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'key', name='uq_admin_system_settings_tenant_key')
    )
    op.create_index(op.f('ix_admin_system_settings_tenant_id'), 'admin_system_settings', ['tenant_id'], unique=False)

    op.create_table(
        'admin_system_jobs',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('job', sa.String(length=120), nullable=False),
        sa.Column('status', sa.String(length=40), nullable=False),
        sa.Column('requested_by', sa.Integer(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=False),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(['requested_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_admin_system_jobs_tenant_id'), 'admin_system_jobs', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_admin_system_jobs_job'), 'admin_system_jobs', ['job'], unique=False)
    op.create_index(op.f('ix_admin_system_jobs_status'), 'admin_system_jobs', ['status'], unique=False)

    op.create_table(
        'role_permissions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('role', sa.String(length=30), nullable=False),
        sa.Column('permission', sa.String(length=120), nullable=False),
        sa.Column('allowed', sa.Boolean(), nullable=False),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'role', 'permission', name='uq_role_permissions_tenant_role_perm')
    )
    op.create_index(op.f('ix_role_permissions_tenant_id'), 'role_permissions', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_role_permissions_role'), 'role_permissions', ['role'], unique=False)
    op.create_index(op.f('ix_role_permissions_permission'), 'role_permissions', ['permission'], unique=False)

    op.create_table(
        'billing_promises',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('subscription_id', sa.Integer(), nullable=False),
        sa.Column('promised_amount', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('promised_date', sa.Date(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('resolved_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('resolved_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['resolved_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['subscription_id'], ['subscriptions.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_billing_promises_tenant_id'), 'billing_promises', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_billing_promises_subscription_id'), 'billing_promises', ['subscription_id'], unique=False)

    op.create_table(
        'noc_maintenance_windows',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(length=160), nullable=False),
        sa.Column('scope', sa.String(length=40), nullable=False),
        sa.Column('starts_at', sa.DateTime(), nullable=False),
        sa.Column('ends_at', sa.DateTime(), nullable=False),
        sa.Column('mute_alerts', sa.Boolean(), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_noc_maintenance_windows_tenant_id'), 'noc_maintenance_windows', ['tenant_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_noc_maintenance_windows_tenant_id'), table_name='noc_maintenance_windows')
    op.drop_table('noc_maintenance_windows')

    op.drop_index(op.f('ix_billing_promises_subscription_id'), table_name='billing_promises')
    op.drop_index(op.f('ix_billing_promises_tenant_id'), table_name='billing_promises')
    op.drop_table('billing_promises')

    op.drop_index(op.f('ix_role_permissions_permission'), table_name='role_permissions')
    op.drop_index(op.f('ix_role_permissions_role'), table_name='role_permissions')
    op.drop_index(op.f('ix_role_permissions_tenant_id'), table_name='role_permissions')
    op.drop_table('role_permissions')

    op.drop_index(op.f('ix_admin_system_jobs_status'), table_name='admin_system_jobs')
    op.drop_index(op.f('ix_admin_system_jobs_job'), table_name='admin_system_jobs')
    op.drop_index(op.f('ix_admin_system_jobs_tenant_id'), table_name='admin_system_jobs')
    op.drop_table('admin_system_jobs')

    op.drop_index(op.f('ix_admin_system_settings_tenant_id'), table_name='admin_system_settings')
    op.drop_table('admin_system_settings')

    op.drop_index(op.f('ix_admin_hotspot_vouchers_code'), table_name='admin_hotspot_vouchers')
    op.drop_index(op.f('ix_admin_hotspot_vouchers_tenant_id'), table_name='admin_hotspot_vouchers')
    op.drop_table('admin_hotspot_vouchers')

    op.drop_index(op.f('ix_admin_extra_services_tenant_id'), table_name='admin_extra_services')
    op.drop_table('admin_extra_services')

    op.drop_index(op.f('ix_admin_screen_alerts_tenant_id'), table_name='admin_screen_alerts')
    op.drop_table('admin_screen_alerts')

    op.drop_index(op.f('ix_admin_installations_client_id'), table_name='admin_installations')
    op.drop_index(op.f('ix_admin_installations_tenant_id'), table_name='admin_installations')
    op.drop_table('admin_installations')
