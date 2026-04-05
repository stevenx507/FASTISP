"""add network_nodes, nat_rules, bandwidth_reuse tables

Revision ID: a1b2c3d4e5f6
Revises: 
Create Date: 2026-04-02

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = 'add_wisphub_client_fields'
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect
    conn = op.get_bind()
    inspector = inspect(conn)
    existing_tables = inspector.get_table_names()

    # ── network_nodes ──────────────────────────────────────────────────────
    if 'network_nodes' not in existing_tables:
        op.create_table(
            'network_nodes',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('tenant_id', sa.String(64), nullable=False, index=True),
            sa.Column('name', sa.String(128), nullable=False),
            sa.Column('node_type', sa.String(32), nullable=False, server_default='nap'),
            sa.Column('technology', sa.String(32), nullable=False, server_default='fiber'),
            sa.Column('latitude', sa.Float(), nullable=True),
            sa.Column('longitude', sa.Float(), nullable=True),
            sa.Column('address', sa.String(256), nullable=True),
            sa.Column('zone', sa.String(128), nullable=True),
            sa.Column('capacity', sa.Integer(), nullable=True),
            sa.Column('used_ports', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('status', sa.String(32), nullable=False, server_default='active'),
            sa.Column('parent_node_id', sa.Integer(), nullable=True),
            sa.Column('router_id', sa.Integer(), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()')),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()'), onupdate=sa.text('NOW()')),
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['parent_node_id'], ['network_nodes.id'], ondelete='SET NULL'),
        )
    # Crear índices solo si no existen
    existing_indexes_nn = [idx['name'] for idx in inspector.get_indexes('network_nodes')] if 'network_nodes' in existing_tables else []
    if 'ix_network_nodes_tenant_id' not in existing_indexes_nn:
        op.create_index('ix_network_nodes_tenant_id', 'network_nodes', ['tenant_id'])
    if 'ix_network_nodes_node_type' not in existing_indexes_nn:
        op.create_index('ix_network_nodes_node_type', 'network_nodes', ['node_type'])
    if 'ix_network_nodes_status' not in existing_indexes_nn:
        op.create_index('ix_network_nodes_status', 'network_nodes', ['status'])

    # ── nat_rules ──────────────────────────────────────────────────────────
    if 'nat_rules' not in existing_tables:
        op.create_table(
            'nat_rules',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('tenant_id', sa.String(64), nullable=False, index=True),
            sa.Column('router_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(128), nullable=False),
            sa.Column('protocol', sa.String(8), nullable=False, server_default='tcp'),
            sa.Column('src_port', sa.Integer(), nullable=False),
            sa.Column('dst_address', sa.String(64), nullable=False),
            sa.Column('dst_port', sa.Integer(), nullable=False),
            sa.Column('description', sa.String(256), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('mikrotik_rule_id', sa.String(64), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()')),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()'), onupdate=sa.text('NOW()')),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('tenant_id', 'router_id', 'src_port', name='uq_nat_rules_tenant_router_port'),
        )
    existing_indexes_nr = [idx['name'] for idx in inspector.get_indexes('nat_rules')] if 'nat_rules' in existing_tables else []
    if 'ix_nat_rules_tenant_id' not in existing_indexes_nr:
        op.create_index('ix_nat_rules_tenant_id', 'nat_rules', ['tenant_id'])
    if 'ix_nat_rules_router_id' not in existing_indexes_nr:
        op.create_index('ix_nat_rules_router_id', 'nat_rules', ['router_id'])

    # ── bandwidth_reuse_configs ────────────────────────────────────────────
    if 'bandwidth_reuse_configs' not in existing_tables:
        op.create_table(
            'bandwidth_reuse_configs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('tenant_id', sa.String(64), nullable=False, index=True),
            sa.Column('plan_id', sa.Integer(), nullable=False),
            sa.Column('reuse_ratio', sa.String(8), nullable=False, server_default='1:1'),
            sa.Column('queue_type', sa.String(32), nullable=False, server_default='simple'),
            sa.Column('queue_algorithm', sa.String(32), nullable=False, server_default='default'),
            sa.Column('parent_queue_name', sa.String(128), nullable=True),
            sa.Column('auto_adjust', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('current_active_clients', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('current_effective_down', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('current_effective_up', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('last_adjusted_at', sa.DateTime(), nullable=True),
            sa.Column('last_active_clients', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()')),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('NOW()'), onupdate=sa.text('NOW()')),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('tenant_id', 'plan_id', name='uq_bandwidth_reuse_tenant_plan'),
        )
    existing_indexes_brc = [idx['name'] for idx in inspector.get_indexes('bandwidth_reuse_configs')] if 'bandwidth_reuse_configs' in existing_tables else []
    if 'ix_bandwidth_reuse_configs_tenant_id' not in existing_indexes_brc:
        op.create_index('ix_bandwidth_reuse_configs_tenant_id', 'bandwidth_reuse_configs', ['tenant_id'])
    if 'ix_bandwidth_reuse_configs_plan_id' not in existing_indexes_brc:
        op.create_index('ix_bandwidth_reuse_configs_plan_id', 'bandwidth_reuse_configs', ['plan_id'])

    # ── Columna nap_id en clients (si existe la tabla) ─────────────────────
    # Agrega nap_id a la tabla de clientes para vincular cliente → NAP
    try:
        existing_cols = [c['name'] for c in inspector.get_columns('clients')]
        if 'nap_id' not in existing_cols:
            op.add_column('clients', sa.Column('nap_id', sa.Integer(), nullable=True))
            op.create_foreign_key(
                'fk_clients_nap_id',
                'clients', 'network_nodes',
                ['nap_id'], ['id'],
                ondelete='SET NULL'
            )
    except Exception:
        pass  # La columna ya existe o la tabla tiene otro nombre


def downgrade():
    # Eliminar FK de clients
    try:
        op.drop_constraint('fk_clients_nap_id', 'clients', type_='foreignkey')
        op.drop_column('clients', 'nap_id')
    except Exception:
        pass

    op.drop_index('ix_bandwidth_reuse_configs_plan_id', table_name='bandwidth_reuse_configs')
    op.drop_index('ix_bandwidth_reuse_configs_tenant_id', table_name='bandwidth_reuse_configs')
    op.drop_table('bandwidth_reuse_configs')

    op.drop_index('ix_nat_rules_router_id', table_name='nat_rules')
    op.drop_index('ix_nat_rules_tenant_id', table_name='nat_rules')
    op.drop_table('nat_rules')

    op.drop_index('ix_network_nodes_status', table_name='network_nodes')
    op.drop_index('ix_network_nodes_node_type', table_name='network_nodes')
    op.drop_index('ix_network_nodes_tenant_id', table_name='network_nodes')
    op.drop_table('network_nodes')
