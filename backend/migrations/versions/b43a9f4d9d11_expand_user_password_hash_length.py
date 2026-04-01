"""expand_user_password_hash_length

Revision ID: b43a9f4d9d11
Revises: 17e09d3c4a16
Create Date: 2026-02-24 17:05:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b43a9f4d9d11'
down_revision = '17e09d3c4a16'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column(
            'password_hash',
            existing_type=sa.String(length=128),
            type_=sa.String(length=255),
            existing_nullable=False,
        )


def downgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column(
            'password_hash',
            existing_type=sa.String(length=255),
            type_=sa.String(length=128),
            existing_nullable=False,
        )
