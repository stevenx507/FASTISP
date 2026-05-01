"""add gis nap and fiber tables

Revision ID: add_gis_nap_fiber
Revises: a1b2c3d4e5f6
Create Date: 2026-05-01 22:15:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_gis_nap_fiber'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None

def upgrade():
    # nap_boxes
    op.create_table(
        'nap_boxes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('address', sa.String(length=255), nullable=True),
        sa.Column('latitude', sa.Float(), nullable=False),
        sa.Column('longitude', sa.Float(), nullable=False),
        sa.Column('capacity', sa.Integer(), nullable=False),
        sa.Column('used_ports', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_nap_boxes_tenant_id'), 'nap_boxes', ['tenant_id'], unique=False)

    # fiber_lines
    op.create_table(
        'fiber_lines',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('path_geojson', sa.Text(), nullable=False),
        sa.Column('color', sa.String(length=20), nullable=True),
        sa.Column('fiber_type', sa.String(length=50), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_fiber_lines_tenant_id'), 'fiber_lines', ['tenant_id'], unique=False)

def downgrade():
    op.drop_index(op.f('ix_fiber_lines_tenant_id'), table_name='fiber_lines')
    op.drop_table('fiber_lines')
    op.drop_index(op.f('ix_nap_boxes_tenant_id'), table_name='nap_boxes')
    op.drop_table('nap_boxes')
