"""add_wisphub_client_fields

Revision ID: add_wisphub_client_fields
Revises: add_wisphub_router_fields
Create Date: 2025-04-04

"""
from alembic import op
import sqlalchemy as sa

revision = 'add_wisphub_client_fields'
down_revision = 'add_wisphub_router_fields'
branch_labels = None
depends_on = None


def upgrade():
    from sqlalchemy import inspect
    conn = op.get_bind()
    existing = [c['name'] for c in inspect(conn).get_columns('clients')]
    with op.batch_alter_table('clients') as batch_op:
        # Datos de Conexión
        new_cols = [
            sa.Column('remote_address_pppoe', sa.String(45), nullable=True),
            sa.Column('local_address_pppoe',  sa.String(45), nullable=True),
            sa.Column('sectorial_nap',        sa.String(80), nullable=True),
            sa.Column('apellido',             sa.String(80), nullable=True),
            sa.Column('dni',                  sa.String(40), nullable=True),
            sa.Column('phone',                sa.String(30), nullable=True),
            sa.Column('address',              sa.Text,       nullable=True),
            sa.Column('barrio',               sa.String(80), nullable=True),
            sa.Column('ciudad',               sa.String(80), nullable=True),
            sa.Column('codigo_postal',        sa.String(20), nullable=True),
            sa.Column('forma_contratacion',   sa.String(30), nullable=True),
            sa.Column('external_id',          sa.String(80), nullable=True),
            sa.Column('tipo_cliente',         sa.String(20), nullable=True, server_default='prepago'),
            sa.Column('dia_corte',            sa.Integer,    nullable=True, server_default='8'),
            sa.Column('dia_factura',          sa.Integer,    nullable=True, server_default='1'),
            sa.Column('dia_pago',             sa.Integer,    nullable=True, server_default='3'),
            sa.Column('impuestos',            sa.Float,      nullable=True, server_default='0'),
            sa.Column('avisos_pantalla',      sa.Boolean,    nullable=True, server_default='1'),
            sa.Column('notificaciones_push',  sa.Boolean,    nullable=True, server_default='1'),
            sa.Column('suspender_facturas',   sa.Integer,    nullable=True, server_default='1'),
            sa.Column('corte_automatico',     sa.Boolean,    nullable=True, server_default='1'),
            sa.Column('facturas_automaticas', sa.Boolean,    nullable=True, server_default='1'),
            sa.Column('correo_corte',         sa.Boolean,    nullable=True, server_default='1'),
            sa.Column('correo_facturas',      sa.Boolean,    nullable=True, server_default='1'),
            sa.Column('firewall_enabled',     sa.Boolean,    nullable=True, server_default='1'),
            sa.Column('sistema_id',           sa.String(80), nullable=True),
            sa.Column('modelo_antena',        sa.String(80), nullable=True),
            sa.Column('password_antena',      sa.String(80), nullable=True),
            sa.Column('protocolo_conexion',   sa.String(40), nullable=True),
            sa.Column('ip_router_wifi',       sa.String(45), nullable=True),
            sa.Column('modelo_router_wifi',   sa.String(80), nullable=True),
            sa.Column('usuario_router_wifi',  sa.String(80), nullable=True),
            sa.Column('password_router_wifi', sa.String(80), nullable=True),
            sa.Column('ssid_router_wifi',     sa.String(80), nullable=True),
            sa.Column('password_ssid_wifi',   sa.String(80), nullable=True),
            sa.Column('mac_router_wifi',      sa.String(17), nullable=True),
            sa.Column('comentarios',          sa.Text,       nullable=True),
            sa.Column('razon_social',         sa.String(120),nullable=True),
            sa.Column('ruc_nit',              sa.String(40), nullable=True),
        ]
        for col in new_cols:
            if col.name not in existing:
                batch_op.add_column(col)


def downgrade():
    drop_cols = [
        'remote_address_pppoe', 'local_address_pppoe', 'sectorial_nap',
        'apellido', 'dni', 'phone', 'address', 'barrio', 'ciudad',
        'codigo_postal', 'forma_contratacion', 'external_id',
        'tipo_cliente', 'dia_corte', 'dia_factura', 'dia_pago',
        'impuestos', 'avisos_pantalla', 'notificaciones_push',
        'suspender_facturas', 'corte_automatico', 'facturas_automaticas',
        'correo_corte', 'correo_facturas',
        'firewall_enabled', 'sistema_id', 'modelo_antena', 'password_antena',
        'protocolo_conexion', 'ip_router_wifi', 'modelo_router_wifi',
        'usuario_router_wifi', 'password_router_wifi', 'ssid_router_wifi',
        'password_ssid_wifi', 'mac_router_wifi', 'comentarios',
        'razon_social', 'ruc_nit',
    ]
    with op.batch_alter_table('clients') as batch_op:
        for col in drop_cols:
            batch_op.drop_column(col)
