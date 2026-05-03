import re
import base64
import binascii
import ipaddress
import logging
import shlex
import subprocess
import paramiko
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from flask import current_app
from flask_jwt_extended import get_jwt_identity
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import x25519

from app import db
from app.models import AdminSystemSetting, MikroTikRouter, Tenant, User
from app.tenancy import current_tenant_id
from app.lib.utils import as_bool, parse_bool, parse_int, parse_float, slugify

logger = logging.getLogger(__name__)

TENANT_SETTING_SENTINEL = object()
WG_VPS_INTERFACE_DEFAULT = 'wg0'
WG_PROFILE_ALLOWED_SUBNETS_DEFAULT = '10.250.0.0/16,10.251.0.0/16'
WG_PROFILE_ENDPOINT_DEFAULT = 'vpn.fastisp.cloud:51820'
WG_VPS_SYNC_MODE_DEFAULT = 'auto'

# --- Generic Helpers ---

def resolve_actor_identity() -> str:
    try:
        identity = get_jwt_identity()
        user = db.session.get(User, identity) if identity else None
        if user:
            name = user.name or f"user-{user.id}"
            if user.email:
                return f"{name} <{user.email}>"
            return name
    except Exception:
        pass
    return "admin"

def current_actor_user() -> Optional[User]:
    try:
        identity = get_jwt_identity()
        if not identity:
            return None
        return db.session.get(User, identity)
    except Exception:
        return None

def tenant_context_payload() -> Dict[str, Any]:
    tenant_id = current_tenant_id()
    tenant = db.session.get(Tenant, tenant_id) if tenant_id is not None else None
    user = current_actor_user()
    return {
        'tenant_id': tenant_id,
        'tenant_slug': str(getattr(tenant, 'slug', '') or '').strip() or None,
        'tenant_name': str(getattr(tenant, 'name', '') or '').strip() or None,
        'actor_email': str(getattr(user, 'email', '') or '').strip() or None,
        'actor_name': str(getattr(user, 'name', '') or '').strip() or None,
    }

# --- Settings Helpers ---

def tenant_setting_row(key_name: str, tenant_id: Any = TENANT_SETTING_SENTINEL) -> Optional[AdminSystemSetting]:
    scoped_tenant = current_tenant_id() if tenant_id is TENANT_SETTING_SENTINEL else tenant_id
    query = AdminSystemSetting.query.filter_by(key=key_name)
    if scoped_tenant is None:
        query = query.filter(AdminSystemSetting.tenant_id.is_(None))
    else:
        query = query.filter(AdminSystemSetting.tenant_id == scoped_tenant)
    return query.first()

def tenant_setting_upsert(key_name: str, value: Any, tenant_id: Any = TENANT_SETTING_SENTINEL) -> AdminSystemSetting:
    scoped_tenant = current_tenant_id() if tenant_id is TENANT_SETTING_SENTINEL else tenant_id
    row = tenant_setting_row(key_name, tenant_id=scoped_tenant)
    if row is None:
        row = AdminSystemSetting(
            tenant_id=scoped_tenant,
            key=key_name,
            value=value,
            updated_by=None,
            updated_at=datetime.now(timezone.utc),
        )
    else:
        row.value = value
        row.updated_at = datetime.now(timezone.utc)
    db.session.add(row)
    db.session.commit()
    return row

# --- Encryption Helpers ---

def secret_fernet() -> Fernet:
    encryption_key = current_app.config.get('ENCRYPTION_KEY')
    if not encryption_key:
        raise RuntimeError('ENCRYPTION_KEY is required')
    if isinstance(encryption_key, str):
        encryption_key = encryption_key.encode('utf-8')
    return Fernet(encryption_key)

def encrypt_secret_value(plaintext: str) -> str:
    token = secret_fernet().encrypt(str(plaintext or '').encode('utf-8'))
    return token.decode('utf-8')

# --- Normalization Helpers ---

def slugify_scope_token(value: Any, fallback: str = 'isp') -> str:
    token = re.sub(r'[^a-z0-9]+', '-', str(value or '').strip().lower()).strip('-')
    return token[:32] or fallback

def normalize_router_name_prefix(value: Any, fallback: str) -> str:
    normalized = re.sub(r'[^a-zA-Z0-9._ -]+', '-', str(value or '').strip()).strip()
    normalized = re.sub(r'\s+', '-', normalized).strip('-')
    return normalized[:32] or fallback[:32] or 'isp'

def normalize_bth_user_name(value: Any, fallback: str) -> str:
    normalized = re.sub(r'[^a-zA-Z0-9._-]+', '-', str(value or '').strip()).strip('-')
    return normalized[:48] or fallback[:48] or 'noc-vps'

def suggest_router_name(base_name: str, prefix: str) -> str:
    safe_base = re.sub(r'[^a-zA-Z0-9._ -]+', '-', str(base_name or '').strip()).strip()
    safe_base = re.sub(r'\s+', '-', safe_base).strip('-')
    safe_prefix = normalize_router_name_prefix(prefix, fallback='isp')
    if not safe_base:
        return safe_prefix
    lowered_base = safe_base.lower()
    lowered_prefix = safe_prefix.lower()
    if lowered_base == lowered_prefix or lowered_base.startswith(f'{lowered_prefix}-'):
        return safe_base[:80]
    return f'{safe_prefix}-{safe_base}'[:80]

# --- WireGuard Specific Helpers ---

def parse_wireguard_endpoint(raw_endpoint: str) -> Dict[str, Any]:
    endpoint = str(raw_endpoint or '').strip()
    if not endpoint:
        return {'endpoint': '', 'host': '', 'port': None}
    host = endpoint
    port: Optional[int] = None
    ipv6_match = re.match(r'^\[(?P<host>.+)\](?::(?P<port>\d{1,5}))?$', endpoint)
    if ipv6_match:
        host = str(ipv6_match.group('host') or '').strip()
        raw_port = ipv6_match.group('port')
        if raw_port:
            try:
                parsed = int(raw_port)
                if 1 <= parsed <= 65535:
                    port = parsed
            except Exception:
                pass
        return {'endpoint': endpoint, 'host': host, 'port': port}
    if ':' in endpoint:
        possible_host, possible_port = endpoint.rsplit(':', 1)
        if possible_port.isdigit():
            parsed = int(possible_port)
            if 1 <= parsed <= 65535:
                host = possible_host.strip()
                port = parsed
    return {'endpoint': endpoint, 'host': host.strip(), 'port': port}

def wireguard_public_key_from_private_base64(private_key_base64: str) -> str:
    try:
        raw_private = base64.b64decode(str(private_key_base64 or '').encode('ascii'), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError('invalid base64 private key') from exc
    if len(raw_private) != 32:
        raise ValueError('invalid WireGuard private key length')
    private_key = x25519.X25519PrivateKey.from_private_bytes(raw_private)
    public_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return base64.b64encode(public_bytes).decode('ascii')

def normalize_wg_allowed_ip(raw_value: Any) -> str:
    candidate = str(raw_value or '').strip()
    if not candidate:
        return ''
    if '/' in candidate:
        try:
            iface = ipaddress.ip_interface(candidate)
            return f'{iface.ip}/{iface.network.prefixlen}'
        except ValueError:
            return ''
    try:
        ip_obj = ipaddress.ip_address(candidate)
        return f'{ip_obj}/32' if ip_obj.version == 4 else f'{ip_obj}/128'
    except ValueError:
        return ''

def safe_router_wireguard_allowed_ip(router_id: Any) -> str:
    try:
        token = int(router_id)
    except (TypeError, ValueError):
        token = 0
    octet = token % 250
    if octet <= 0:
        octet = 1
    return f'10.250.{octet}.2/32'

# --- Formatting Helpers ---

def pick_value(data: Any, *keys: str, default: Any = None) -> Any:
    if not isinstance(data, dict):
        return default
    for key in keys:
        if key in data and data[key] not in (None, ''):
            return data[key]
    return default

def to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default

def as_clean_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    token = str(value).strip()
    return token if token else None

def as_clean_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [part.strip() for part in value.split(',') if part.strip()]
    return []
