from flask import Blueprint, request, jsonify
from app.tenancy import admin_required, staff_required, current_tenant_id, tenant_access_allowed
from app.lib.utils import as_bool, parse_int as to_int
from app.models import AdminSystemSetting
from app import db

mikrotik_bp = Blueprint('mikrotik', __name__)

# Constants
WG_PROFILE_ENDPOINT_DEFAULT = 'vpn.fastisp.cloud:51820'
WG_PROFILE_ALLOWED_SUBNETS_DEFAULT = '10.250.0.0/16,10.251.0.0/16'
WG_VPS_SYNC_MODE_DEFAULT = 'auto'
WG_VPS_INTERFACE_DEFAULT = 'wg0'
TENANT_SETTING_SENTINEL = object()

def pick_value(*args):
    """Returns the first non-None value."""
    for arg in args:
        if arg is not None:
            return arg
    return None

def tenant_setting_row(key_name: str, tenant_id=TENANT_SETTING_SENTINEL):
    scoped_tenant = current_tenant_id() if tenant_id is TENANT_SETTING_SENTINEL else tenant_id
    from app.routes.admin.utils import _tenant_scoped_query
    return _tenant_scoped_query(AdminSystemSetting, scoped_tenant).filter_by(key=key_name).first()

def tenant_setting_upsert(key_name: str, value: Any, tenant_id=TENANT_SETTING_SENTINEL):
    scoped_tenant = current_tenant_id() if tenant_id is TENANT_SETTING_SENTINEL else tenant_id
    from app.routes.admin.utils import _upsert_system_setting_value
    _upsert_system_setting_value(scoped_tenant, key_name, value)
    return tenant_setting_row(key_name, scoped_tenant)

# Dummy/Helper WireGuard functions if they were in legacy
def parse_wireguard_endpoint(endpoint):
    if not endpoint: return {}
    parts = str(endpoint).split(':')
    return {'endpoint': endpoint, 'host': parts[0], 'port': parts[1] if len(parts) > 1 else None}

def wireguard_public_key_from_private_base64(priv): return "" # Placeholder
def normalize_wg_allowed_ip(ip): return str(ip).split('/')[0] + '/32'
def safe_router_wireguard_allowed_ip(router_id): return f"10.250.1.{router_id}/32"
def suggest_router_name(router): return router.name
def normalize_router_name_prefix(name): return name
def normalize_bth_user_name(name): return name
