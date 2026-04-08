"""
MikroTik API endpoints
"""
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import get_jwt_identity, jwt_required
from app.routes.main_routes import admin_required
from app import db
from app.models import AdminSystemSetting, MikroTikRouter, Client, Plan, Tenant, User
from app.services.mikrotik_service import MikroTikService
from app.services.mikrotik_advanced_service import MikroTikAdvancedService
from app.services.ai_diagnostic_service import AIDiagnosticService
from app.services.monitoring_service import monitoring_service
from app.services.snmp_service import SNMPRuntimeUnavailable, snmp_service
from app.tenancy import current_tenant_id, tenant_access_allowed
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
import ipaddress
import io
import re
import uuid
import zipfile
import base64
import binascii
import socket
import time
from urllib.parse import unquote_plus
import shlex
import subprocess
from urllib.parse import parse_qs, unquote, urlparse
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import x25519
import paramiko

mikrotik_bp = Blueprint('mikrotik', __name__)
logger = logging.getLogger(__name__)

# Ephemeral change-control store (router-scoped).
# For production deployments this can be moved to DB or Redis.
ENTERPRISE_CHANGELOG: Dict[str, List[Dict[str, Any]]] = {}
ENTERPRISE_CHANGE_INDEX: Dict[str, Dict[str, Any]] = {}
WIREGUARD_IMPORT_MAX_BYTES = 2 * 1024 * 1024
BTH_MANAGED_IDENTITY_SETTING_KEY = 'mikrotik_bth_managed_identity'
WG_PROFILE_ENDPOINT_SETTING_KEY = 'mikrotik_wg_endpoint'
WG_PROFILE_SERVER_PUBLIC_KEY_SETTING_KEY = 'mikrotik_wg_server_public_key'
WG_PROFILE_ALLOWED_SUBNETS_SETTING_KEY = 'mikrotik_wg_allowed_subnets'
_TENANT_SETTING_SENTINEL = object()
WG_PROFILE_ENDPOINT_DEFAULT = 'vpn.fastisp.cloud:51820'
WG_PROFILE_ALLOWED_SUBNETS_DEFAULT = '10.250.0.0/16,10.251.0.0/16'
WG_PROFILE_SERVER_PUBLIC_KEY_PLACEHOLDER = '<WIREGUARD_SERVER_PUBLIC_KEY>'
WG_VPS_SYNC_MODE_DEFAULT = 'auto'
WG_VPS_INTERFACE_DEFAULT = 'wg0'
QR_SOURCE_DEFAULT_NAME = 'wireguard-qr.txt'
WG_VPS_SYNC_PROFILE_SETTING_KEY = 'mikrotik_wg_vps_sync_profile'
MIKROTIK_ONBOARDING_PROFILE_SETTING_KEY = 'mikrotik_onboarding_profile'


def _decode_text_payload(raw_payload: bytes) -> str:
    for encoding in ('utf-8-sig', 'utf-8', 'latin-1'):
        try:
            return raw_payload.decode(encoding)
        except Exception:
            continue
    return raw_payload.decode('utf-8', errors='ignore')


def _split_csv_values(raw_value: str) -> List[str]:
    return [part.strip() for part in str(raw_value or '').split(',') if part.strip()]


def _parse_wireguard_endpoint(raw_endpoint: str) -> Dict[str, Any]:
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


def _parse_wireguard_config(config_text: str) -> Dict[str, Any]:
    section = ''
    interface: Dict[str, str] = {}
    peer: Dict[str, str] = {}
    peer_found = False

    for raw_line in str(config_text or '').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or line.startswith(';'):
            continue
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1].strip().lower()
            if section == 'peer' and not peer_found:
                peer_found = True
            continue
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        normalized_key = key.strip().lower().replace(' ', '_')
        normalized_value = value.strip()
        if section == 'interface':
            interface[normalized_key] = normalized_value
        elif section == 'peer' and peer_found:
            if normalized_key not in peer:
                peer[normalized_key] = normalized_value

    endpoint_payload = _parse_wireguard_endpoint(peer.get('endpoint', ''))
    addresses = _split_csv_values(interface.get('address', ''))
    allowed_ips = _split_csv_values(peer.get('allowedips', ''))

    has_core_fields = bool(interface.get('privatekey')) and bool(peer.get('publickey'))
    return {
        'is_wireguard_config': has_core_fields,
        'interface_private_key': interface.get('privatekey', ''),
        'interface_addresses': addresses,
        'interface_dns': _split_csv_values(interface.get('dns', '')),
        'peer_public_key': peer.get('publickey', ''),
        'peer_allowed_ips': allowed_ips,
        'peer_persistent_keepalive': peer.get('persistentkeepalive', ''),
        'endpoint': endpoint_payload.get('endpoint', ''),
        'endpoint_host': endpoint_payload.get('host', ''),
        'endpoint_port': endpoint_payload.get('port'),
    }


def _first_wireguard_interface_host(parsed_config: Dict[str, Any]) -> str:
    addresses = parsed_config.get('interface_addresses')
    if not isinstance(addresses, list):
        return ''
    for raw_address in addresses:
        candidate = str(raw_address or '').strip()
        if not candidate:
            continue
        if '/' in candidate:
            try:
                return str(ipaddress.ip_interface(candidate).ip)
            except ValueError:
                continue
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            continue
    return ''


def _first_wireguard_interface_ip(parsed_config: Dict[str, Any]) -> str:
    addresses = parsed_config.get('interface_addresses')
    if not isinstance(addresses, list):
        return ''
    for raw_address in addresses:
        normalized = _normalize_wg_allowed_ip(raw_address)
        if normalized:
            return normalized
    return ''


def _is_back_to_home_client_profile(parsed_config: Dict[str, Any]) -> bool:
    endpoint_host = str(parsed_config.get('endpoint_host') or '').strip().lower()
    if not endpoint_host:
        return False
    if endpoint_host.endswith('.vpn.mynetname.net'):
        return True
    if '.vpn.mynetname.net' in endpoint_host:
        return True
    return False


def _wireguard_config_from_uri(raw_payload: str) -> str:
    uri = str(raw_payload or '').strip()
    parsed = urlparse(uri)
    query_pairs = parse_qs(parsed.query, keep_blank_values=True)
    normalized_query: Dict[str, str] = {}
    for key, values in query_pairs.items():
        if not values:
            continue
        normalized_key = re.sub(r'[^a-z0-9]+', '', str(key).lower())
        normalized_query[normalized_key] = str(values[0] or '').strip()

    def _pick(*keys: str) -> str:
        for key in keys:
            normalized_key = re.sub(r'[^a-z0-9]+', '', str(key).lower())
            value = str(normalized_query.get(normalized_key) or '').strip()
            if value:
                return value
        return ''

    interface_private_key = _pick('private_key', 'privatekey', 'interface_private_key')
    peer_public_key = _pick('public_key', 'publickey', 'peer_public_key', 'server_public_key')
    endpoint = _pick('endpoint', 'endpoint_address', 'server')
    endpoint_port = _pick('endpoint_port', 'port')
    if endpoint and endpoint_port and ':' not in endpoint:
        endpoint = f'{endpoint}:{endpoint_port}'
    interface_address = _pick('address', 'addresses', 'interface_address')
    interface_dns = _pick('dns')
    allowed_ips = _pick('allowed_ips', 'allowedips')
    persistent_keepalive = _pick('persistent_keepalive', 'persistentkeepalive', 'keepalive')

    if not interface_private_key or not peer_public_key:
        raise ValueError('WireGuard URI is missing private/public key fields')

    lines = [
        '[Interface]',
        f'PrivateKey = {interface_private_key}',
    ]
    if interface_address:
        lines.append(f'Address = {interface_address}')
    if interface_dns:
        lines.append(f'DNS = {interface_dns}')

    lines.extend(
        [
            '',
            '[Peer]',
            f'PublicKey = {peer_public_key}',
        ]
    )
    if endpoint:
        lines.append(f'Endpoint = {endpoint}')
    if allowed_ips:
        lines.append(f'AllowedIPs = {allowed_ips}')
    if persistent_keepalive:
        lines.append(f'PersistentKeepalive = {persistent_keepalive}')
    return '\n'.join(lines) + '\n'


def _normalize_wireguard_config_text(raw_payload: str) -> str:
    payload_text = str(raw_payload or '').strip()
    if not payload_text:
        raise ValueError('WireGuard config text is empty')

    decoded = unquote(payload_text)
    candidate_texts = [decoded, payload_text]
    for candidate in candidate_texts:
        lowered = str(candidate or '').lower()
        if '[interface]' in lowered and '[peer]' in lowered:
            return str(candidate)

    uri_text = decoded if decoded.lower().startswith(('wireguard://', 'wg://')) else payload_text
    if str(uri_text).lower().startswith(('wireguard://', 'wg://')):
        return _wireguard_config_from_uri(uri_text)

    raise ValueError('WireGuard config text is not valid')


def _router_wireguard_identity_from_parsed_config(parsed_config: Dict[str, Any], router_id: Any) -> Dict[str, Any]:
    private_key = str(parsed_config.get('interface_private_key') or '').strip()
    if not private_key:
        return {'success': False, 'error': 'WireGuard config does not include interface private key'}
    try:
        public_key = _wireguard_public_key_from_private_base64(private_key)
    except Exception as exc:
        return {'success': False, 'error': f'Invalid interface private key in config: {exc}'}

    selected_peer_ip = _first_wireguard_interface_ip(parsed_config) or _safe_router_wireguard_allowed_ip(router_id)
    selected_peer_ip = _normalize_wg_allowed_ip(selected_peer_ip)
    if not selected_peer_ip:
        selected_peer_ip = _safe_router_wireguard_allowed_ip(router_id)

    addresses = parsed_config.get('interface_addresses') if isinstance(parsed_config.get('interface_addresses'), list) else []
    return {
        'success': True,
        'interface_name': 'wg-fastisp',
        'public_key': public_key,
        'addresses': addresses,
        'selected_peer_ip': selected_peer_ip,
        'source': 'wireguard_config',
    }


def _normalize_router_host(raw_value: str) -> tuple[str, Optional[int]]:
    parsed = _parse_wireguard_endpoint(raw_value)
    host = str(parsed.get('host') or raw_value or '').strip()
    port = parsed.get('port')
    return host, port


def _looks_like_placeholder(value: str) -> bool:
    token = str(value or '').strip()
    if not token:
        return False
    return token.startswith('<') or token.endswith('>') or token.startswith('${')


def _is_valid_wireguard_public_key(value: str) -> bool:
    token = str(value or '').strip()
    if not token or _looks_like_placeholder(token):
        return False
    try:
        decoded = base64.b64decode(token.encode('ascii'), validate=True)
    except (binascii.Error, ValueError):
        return False
    return len(decoded) == 32


def _normalize_wireguard_allowed_subnets(raw_value: Any) -> str:
    if isinstance(raw_value, list):
        tokens = [str(item or '').strip() for item in raw_value if str(item or '').strip()]
    else:
        tokens = _split_csv_values(str(raw_value or ''))
    return ','.join(tokens) if tokens else WG_PROFILE_ALLOWED_SUBNETS_DEFAULT


def _normalize_wireguard_endpoint(raw_value: Any) -> Dict[str, Any]:
    raw_text = str(raw_value or '').strip()
    if not raw_text:
        raw_text = WG_PROFILE_ENDPOINT_DEFAULT
    parsed = _parse_wireguard_endpoint(raw_text)
    host = str(parsed.get('host') or '').strip()
    port = parsed.get('port')
    if not host:
        host = str(_parse_wireguard_endpoint(WG_PROFILE_ENDPOINT_DEFAULT).get('host') or 'vpn.fastisp.cloud')
    if port is None:
        fallback_port = _parse_wireguard_endpoint(WG_PROFILE_ENDPOINT_DEFAULT).get('port')
        port = int(fallback_port or 51820)
    endpoint = f'{host}:{int(port)}'
    return {
        'endpoint': endpoint,
        'host': host,
        'port': int(port),
    }


def _normalize_wg_vps_sync_mode(raw_value: Any) -> str:
    token = str(raw_value or '').strip().lower()
    if token in ('auto', 'local', 'ssh', 'manual'):
        return token
    return WG_VPS_SYNC_MODE_DEFAULT


def _normalize_wg_allowed_ip(raw_value: Any) -> str:
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


def _safe_router_wireguard_allowed_ip(router_id: Any) -> str:
    try:
        token = int(router_id)
    except (TypeError, ValueError):
        token = 0
    octet = token % 250
    if octet <= 0:
        octet = 1
    return f'10.250.{octet}.2/32'


def _build_wg_set_commands(vps_interface: str, peer_public_key: str, allowed_ip: str) -> Dict[str, Any]:
    iface = str(vps_interface or WG_VPS_INTERFACE_DEFAULT).strip() or WG_VPS_INTERFACE_DEFAULT
    peer_key = str(peer_public_key or '').strip()
    allowed = str(allowed_ip or '').strip()
    argv_set = ['wg', 'set', iface, 'peer', peer_key, 'allowed-ips', allowed]
    argv_save = ['wg-quick', 'save', iface]
    shell_set = ' '.join(shlex.quote(part) for part in argv_set)
    shell_save = ' '.join(shlex.quote(part) for part in argv_save)
    return {
        'interface': iface,
        'allowed_ip': allowed,
        'peer_public_key': peer_key,
        'argv_set': argv_set,
        'argv_save': argv_save,
        'shell_set': shell_set,
        'shell_save': shell_save,
    }


def _run_local_command(argv: List[str], timeout_seconds: int = 8) -> Dict[str, Any]:
    try:
        completed = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=max(1, int(timeout_seconds)),
            check=False,
        )
    except FileNotFoundError as exc:
        return {'ok': False, 'error': str(exc), 'stdout': '', 'stderr': ''}
    except Exception as exc:
        return {'ok': False, 'error': str(exc), 'stdout': '', 'stderr': ''}
    return {
        'ok': completed.returncode == 0,
        'return_code': completed.returncode,
        'stdout': str(completed.stdout or '').strip(),
        'stderr': str(completed.stderr or '').strip(),
    }


def _register_wireguard_peer_local(commands: Dict[str, Any], persist: bool, timeout_seconds: int = 8) -> Dict[str, Any]:
    set_result = _run_local_command(commands.get('argv_set') or [], timeout_seconds=timeout_seconds)
    if not set_result.get('ok'):
        detail = set_result.get('stderr') or set_result.get('stdout') or set_result.get('error') or 'wg set failed'
        detail_text = str(detail or '')
        if 'No such file or directory' in detail_text and "'wg'" in detail_text:
            detail_text = (
                "No se encontro binario 'wg' en runtime del backend. "
                "Usa sync_mode=ssh o ejecuta el comando manual en el VPS host."
            )
        return {
            'success': False,
            'mode': 'local',
            'message': f'wg set failed: {detail_text}',
            'set_result': set_result,
        }

    save_result: Optional[Dict[str, Any]] = None
    if persist:
        save_result = _run_local_command(commands.get('argv_save') or [], timeout_seconds=timeout_seconds)
        if not save_result.get('ok'):
            detail = save_result.get('stderr') or save_result.get('stdout') or save_result.get('error') or 'wg-quick save failed'
            return {
                'success': False,
                'mode': 'local',
                'message': f'wg-quick save failed: {detail}',
                'set_result': set_result,
                'save_result': save_result,
            }

    return {
        'success': True,
        'mode': 'local',
        'message': 'Peer registrado en VPS via comando local.',
        'set_result': set_result,
        'save_result': save_result,
    }


def _run_ssh_command(
    ssh_client: paramiko.SSHClient,
    command: str,
    timeout_seconds: int = 8,
) -> Dict[str, Any]:
    try:
        _, stdout, stderr = ssh_client.exec_command(command, timeout=max(1, int(timeout_seconds)))
        exit_status = stdout.channel.recv_exit_status()
        stdout_text = stdout.read().decode('utf-8', errors='ignore').strip()
        stderr_text = stderr.read().decode('utf-8', errors='ignore').strip()
    except Exception as exc:
        return {'ok': False, 'error': str(exc), 'stdout': '', 'stderr': ''}
    return {
        'ok': exit_status == 0,
        'return_code': exit_status,
        'stdout': stdout_text,
        'stderr': stderr_text,
    }


def _register_wireguard_peer_via_ssh(
    commands: Dict[str, Any],
    persist: bool,
    ssh_host: str,
    ssh_user: str,
    ssh_port: int = 22,
    ssh_password: str = '',
    ssh_key_path: str = '',
    timeout_seconds: int = 8,
    use_sudo: bool = True,
) -> Dict[str, Any]:
    if not ssh_host or not ssh_user:
        return {
            'success': False,
            'mode': 'ssh',
            'message': 'MIKROTIK_WG_VPS_SSH_HOST y MIKROTIK_WG_VPS_SSH_USER son requeridos para modo ssh.',
        }

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    connect_kwargs: Dict[str, Any] = {
        'hostname': ssh_host,
        'username': ssh_user,
        'port': int(ssh_port or 22),
        'timeout': max(2, int(timeout_seconds)),
        'banner_timeout': max(2, int(timeout_seconds)),
        'auth_timeout': max(2, int(timeout_seconds)),
        'look_for_keys': bool(ssh_key_path),
    }
    if ssh_key_path:
        connect_kwargs['key_filename'] = ssh_key_path
    if ssh_password:
        connect_kwargs['password'] = ssh_password

    try:
        client.connect(**connect_kwargs)
    except Exception as exc:
        return {'success': False, 'mode': 'ssh', 'message': f'SSH connect failed: {exc}'}

    prefixed_set = str(commands.get('shell_set') or '').strip()
    prefixed_save = str(commands.get('shell_save') or '').strip()
    if use_sudo:
        prefixed_set = f'sudo -n {prefixed_set}'
        prefixed_save = f'sudo -n {prefixed_save}'

    try:
        set_result = _run_ssh_command(client, prefixed_set, timeout_seconds=timeout_seconds)
        if not set_result.get('ok') and use_sudo:
            stderr_lower = str(set_result.get('stderr') or '').lower()
            if 'sudo:' in stderr_lower or 'permission denied' in stderr_lower:
                set_result = _run_ssh_command(client, str(commands.get('shell_set') or ''), timeout_seconds=timeout_seconds)
        if not set_result.get('ok'):
            detail = set_result.get('stderr') or set_result.get('stdout') or set_result.get('error') or 'wg set failed'
            return {
                'success': False,
                'mode': 'ssh',
                'message': f'wg set failed por SSH: {detail}',
                'set_result': set_result,
            }

        save_result: Optional[Dict[str, Any]] = None
        if persist:
            save_result = _run_ssh_command(client, prefixed_save, timeout_seconds=timeout_seconds)
            if not save_result.get('ok') and use_sudo:
                stderr_lower = str(save_result.get('stderr') or '').lower()
                if 'sudo:' in stderr_lower or 'permission denied' in stderr_lower:
                    save_result = _run_ssh_command(client, str(commands.get('shell_save') or ''), timeout_seconds=timeout_seconds)
            if not save_result.get('ok'):
                detail = save_result.get('stderr') or save_result.get('stdout') or save_result.get('error') or 'wg-quick save failed'
                return {
                    'success': False,
                    'mode': 'ssh',
                    'message': f'wg-quick save failed por SSH: {detail}',
                    'set_result': set_result,
                    'save_result': save_result,
                }

        return {
            'success': True,
            'mode': 'ssh',
            'message': 'Peer registrado en VPS via SSH (perfil gestionado por servidor).',
            'set_result': set_result,
            'save_result': save_result,
        }
    finally:
        try:
            client.close()
        except Exception:
            pass


def _first_defined_value(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def _normalize_wg_vps_interface(raw_value: Any) -> str:
    token = str(raw_value or '').strip()
    if not token:
        return WG_VPS_INTERFACE_DEFAULT
    if not re.match(r'^[a-zA-Z0-9_.:-]+$', token):
        return WG_VPS_INTERFACE_DEFAULT
    return token


def _normalize_wg_vps_ssh_port(raw_value: Any, default: int = 22) -> int:
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = int(default or 22)
    return min(max(parsed, 1), 65535)


def _normalize_wg_vps_timeout(raw_value: Any, default: int = 8) -> int:
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = int(default or 8)
    return min(max(parsed, 2), 30)


def _managed_wg_vps_sync_runtime_from_config() -> Dict[str, Any]:
    mode = _normalize_wg_vps_sync_mode(current_app.config.get('MIKROTIK_WG_VPS_SYNC_MODE'))
    vps_interface = _normalize_wg_vps_interface(
        current_app.config.get('MIKROTIK_WG_VPS_INTERFACE') or WG_VPS_INTERFACE_DEFAULT
    )
    persist = _as_bool(current_app.config.get('MIKROTIK_WG_VPS_PERSIST'), default=True)
    ssh_host = str(current_app.config.get('MIKROTIK_WG_VPS_SSH_HOST') or '').strip()
    ssh_user = str(current_app.config.get('MIKROTIK_WG_VPS_SSH_USER') or '').strip()
    ssh_password = str(current_app.config.get('MIKROTIK_WG_VPS_SSH_PASSWORD') or '').strip()
    ssh_key_path = str(current_app.config.get('MIKROTIK_WG_VPS_SSH_KEY_PATH') or '').strip()
    ssh_port = _normalize_wg_vps_ssh_port(current_app.config.get('MIKROTIK_WG_VPS_SSH_PORT'), default=22)
    timeout_seconds = _normalize_wg_vps_timeout(
        current_app.config.get('MIKROTIK_WG_VPS_SSH_TIMEOUT_SECONDS'),
        default=8,
    )
    use_sudo = _as_bool(current_app.config.get('MIKROTIK_WG_VPS_SSH_USE_SUDO'), default=True)
    return {
        'mode': mode,
        'vps_interface': vps_interface,
        'persist': persist,
        'ssh_host': ssh_host,
        'ssh_user': ssh_user,
        'ssh_password': ssh_password,
        'ssh_key_path': ssh_key_path,
        'ssh_port': ssh_port,
        'ssh_timeout_seconds': timeout_seconds,
        'ssh_use_sudo': use_sudo,
    }


def _load_wg_vps_sync_profile() -> Dict[str, Any]:
    runtime = _managed_wg_vps_sync_runtime_from_config()
    return {
        **runtime,
        'managed': True,
        'source': 'server_managed',
        'ssh_configured': bool(runtime.get('ssh_host') and runtime.get('ssh_user')),
        'ssh_auth_configured': bool(runtime.get('ssh_password') or runtime.get('ssh_key_path')),
        'updated_at': None,
    }


def _persist_wg_vps_sync_profile(profile: Dict[str, Any]) -> Dict[str, Any]:
    logger.warning(
        'Ignoring wireguard vps sync profile update for tenant %s; profile is server-managed',
        current_tenant_id(),
    )
    return _load_wg_vps_sync_profile()


def _wg_vps_sync_profile_response(profile: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'mode': _normalize_wg_vps_sync_mode(profile.get('mode')),
        'vps_interface': _normalize_wg_vps_interface(profile.get('vps_interface')),
        'persist': _as_bool(profile.get('persist'), default=True),
        'ssh_port': _normalize_wg_vps_ssh_port(profile.get('ssh_port'), default=22),
        'ssh_timeout_seconds': _normalize_wg_vps_timeout(profile.get('ssh_timeout_seconds'), default=8),
        'ssh_use_sudo': _as_bool(profile.get('ssh_use_sudo'), default=True),
        'managed': bool(profile.get('managed', True)),
        'source': str(profile.get('source') or 'server_managed'),
        'ssh_configured': bool(profile.get('ssh_configured')),
        'ssh_auth_configured': bool(profile.get('ssh_auth_configured')),
        'updated_at': profile.get('updated_at'),
    }


def _probe_wg_vps_sync_runtime(runtime: Dict[str, Any]) -> Dict[str, Any]:
    mode = _normalize_wg_vps_sync_mode(runtime.get('mode'))
    timeout_seconds = int(runtime.get('ssh_timeout_seconds') or 8)
    checks: List[Dict[str, Any]] = []
    warnings: List[str] = []

    if mode == 'manual':
        return {
            'success': False,
            'mode': mode,
            'message': 'Modo manual: no hay automacion activa. Configura variables del backend para activar enlace rapido.',
            'checks': checks,
            'warnings': ['Ajusta MIKROTIK_WG_VPS_* en backend para habilitar automatizacion.'],
        }

    local_ok = False
    if mode in ('auto', 'local'):
        local_probe = _run_local_command(['wg', '--version'], timeout_seconds=timeout_seconds)
        local_ok = bool(local_probe.get('ok'))
        detail = (
            local_probe.get('stdout')
            or local_probe.get('stderr')
            or local_probe.get('error')
            or ('wg disponible en runtime local' if local_ok else 'wg no disponible en runtime local')
        )
        checks.append(
            {
                'id': 'local_wg_binary',
                'ok': local_ok,
                'detail': str(detail),
            }
        )
        if mode == 'local':
            return {
                'success': local_ok,
                'mode': mode,
                'message': 'Runtime local listo para sync WG.' if local_ok else 'Runtime local sin binario wg.',
                'checks': checks,
                'warnings': warnings,
            }

    ssh_ok = False
    if mode in ('auto', 'ssh'):
        ssh_host = str(runtime.get('ssh_host') or '').strip()
        ssh_user = str(runtime.get('ssh_user') or '').strip()
        if not ssh_host or not ssh_user:
            checks.append(
                {
                    'id': 'ssh_config',
                    'ok': False,
                    'detail': 'Faltan ssh_host o ssh_user.',
                }
            )
            if mode == 'ssh':
                return {
                    'success': False,
                    'mode': mode,
                    'message': 'Modo SSH requiere ssh_host y ssh_user.',
                    'checks': checks,
                    'warnings': warnings,
                }
        else:
            ssh_client = paramiko.SSHClient()
            ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            connect_kwargs: Dict[str, Any] = {
                'hostname': ssh_host,
                'username': ssh_user,
                'port': int(runtime.get('ssh_port') or 22),
                'timeout': max(2, timeout_seconds),
                'banner_timeout': max(2, timeout_seconds),
                'auth_timeout': max(2, timeout_seconds),
                'look_for_keys': bool(runtime.get('ssh_key_path')),
            }
            if runtime.get('ssh_key_path'):
                connect_kwargs['key_filename'] = str(runtime.get('ssh_key_path'))
            if runtime.get('ssh_password'):
                connect_kwargs['password'] = str(runtime.get('ssh_password'))
            try:
                ssh_client.connect(**connect_kwargs)
                checks.append(
                    {
                        'id': 'ssh_connect',
                        'ok': True,
                        'detail': 'SSH conectado (perfil gestionado por servidor)',
                    }
                )
                probe_result = _run_ssh_command(
                    ssh_client,
                    "sh -lc 'command -v wg >/dev/null 2>&1 && echo WG_OK || echo WG_MISSING'",
                    timeout_seconds=timeout_seconds,
                )
                probe_stdout = str(probe_result.get('stdout') or '').strip()
                ssh_ok = 'WG_OK' in probe_stdout
                checks.append(
                    {
                        'id': 'ssh_wg_binary',
                        'ok': ssh_ok,
                        'detail': probe_stdout or str(probe_result.get('stderr') or probe_result.get('error') or ''),
                    }
                )
                if not ssh_ok:
                    warnings.append('SSH conectado pero no se detecto binario wg en el VPS remoto.')
            except Exception as exc:
                checks.append({'id': 'ssh_connect', 'ok': False, 'detail': f'SSH error: {exc}'})
                if mode == 'ssh':
                    return {
                        'success': False,
                        'mode': mode,
                        'message': f'No se pudo conectar por SSH: {exc}',
                        'checks': checks,
                        'warnings': warnings,
                    }
            finally:
                try:
                    ssh_client.close()
                except Exception:
                    pass

    success = bool(local_ok or ssh_ok)
    message = 'VPS sync listo para automatizacion.' if success else 'No hay ruta automatica valida (local/ssh) para VPS sync.'
    if not success:
        warnings.append('Configura MIKROTIK_WG_VPS_* en backend o instala wg en runtime local.')
    return {
        'success': success,
        'mode': mode,
        'message': message,
        'checks': checks,
        'warnings': warnings,
    }


def _resolve_wg_sync_runtime(payload: Dict[str, Any]) -> Dict[str, Any]:
    _ = payload  # runtime is intentionally server-managed
    return _managed_wg_vps_sync_runtime_from_config()


def _collect_router_wireguard_identity(
    service: MikroTikService,
    interface_name: str = 'wg-fastisp',
) -> Dict[str, Any]:
    api_obj = getattr(service, 'api', None)
    if not api_obj:
        return {'success': False, 'error': 'Router API no disponible'}

    safe_interface = str(interface_name or 'wg-fastisp').strip() or 'wg-fastisp'
    try:
        interfaces_api = api_obj.get_resource('/interface/wireguard')
        rows = interfaces_api.get(name=safe_interface) or []
        interface_row = rows[0] if rows else None
        if not interface_row:
            return {'success': False, 'error': f'No existe interfaz WireGuard "{safe_interface}" en el router'}

        public_key = str(_pick_value(interface_row, 'public-key', 'public_key') or '').strip()
        if not _is_valid_wireguard_public_key(public_key):
            return {'success': False, 'error': 'No se pudo leer una public key valida del router'}

        addresses_api = api_obj.get_resource('/ip/address')
        raw_addresses = addresses_api.get(interface=safe_interface) or []
        normalized_addresses: List[str] = []
        selected_peer_ip = ''
        for row in raw_addresses:
            candidate = _normalize_wg_allowed_ip(_pick_value(row, 'address'))
            if not candidate:
                continue
            normalized_addresses.append(candidate)
            if not selected_peer_ip and '/' in candidate and candidate.count('.') == 3:
                selected_peer_ip = candidate

        return {
            'success': True,
            'interface_name': safe_interface,
            'public_key': public_key,
            'addresses': normalized_addresses,
            'selected_peer_ip': selected_peer_ip,
        }
    except Exception as exc:
        return {'success': False, 'error': f'No se pudo leer identidad WireGuard: {exc}'}


def _sync_router_peer_to_vps(
    peer_public_key: str,
    allowed_ip: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    runtime = _resolve_wg_sync_runtime(payload)
    commands = _build_wg_set_commands(runtime.get('vps_interface') or WG_VPS_INTERFACE_DEFAULT, peer_public_key, allowed_ip)
    manual_command = str(commands.get('shell_set') or '')
    if runtime.get('persist'):
        manual_command = f'{manual_command} && {commands.get("shell_save")}'

    mode = str(runtime.get('mode') or WG_VPS_SYNC_MODE_DEFAULT)
    attempts: List[Dict[str, Any]] = []

    if mode == 'manual':
        return {
            'success': False,
            'mode': mode,
            'manual_required': True,
            'message': 'Modo manual configurado; ejecuta el comando en el VPS.',
            'manual_command': manual_command,
            'runtime': runtime,
            'commands': commands,
            'attempts': attempts,
        }

    if mode in ('auto', 'local'):
        local_result = _register_wireguard_peer_local(
            commands,
            persist=bool(runtime.get('persist')),
            timeout_seconds=int(runtime.get('ssh_timeout_seconds') or 8),
        )
        attempts.append({'transport': 'local', **local_result})
        if local_result.get('success'):
            return {
                'success': True,
                'mode': 'local',
                'message': local_result.get('message') or 'Peer registrado en VPS (local).',
                'manual_command': manual_command,
                'runtime': runtime,
                'commands': commands,
                'attempts': attempts,
            }
        if mode == 'local':
            return {
                'success': False,
                'mode': 'local',
                'message': local_result.get('message') or 'No se pudo registrar peer en modo local.',
                'manual_required': True,
                'manual_command': manual_command,
                'runtime': runtime,
                'commands': commands,
                'attempts': attempts,
            }

    if mode in ('auto', 'ssh'):
        ssh_result = _register_wireguard_peer_via_ssh(
            commands,
            persist=bool(runtime.get('persist')),
            ssh_host=str(runtime.get('ssh_host') or ''),
            ssh_user=str(runtime.get('ssh_user') or ''),
            ssh_port=int(runtime.get('ssh_port') or 22),
            ssh_password=str(runtime.get('ssh_password') or ''),
            ssh_key_path=str(runtime.get('ssh_key_path') or ''),
            timeout_seconds=int(runtime.get('ssh_timeout_seconds') or 8),
            use_sudo=bool(runtime.get('ssh_use_sudo')),
        )
        attempts.append({'transport': 'ssh', **ssh_result})
        if ssh_result.get('success'):
            return {
                'success': True,
                'mode': 'ssh',
                'message': ssh_result.get('message') or 'Peer registrado en VPS (SSH).',
                'manual_command': manual_command,
                'runtime': runtime,
                'commands': commands,
                'attempts': attempts,
            }

    error_message = 'No se pudo registrar peer automaticamente en el VPS.'
    if attempts:
        last_error = next(
            (str(item.get('message') or '').strip() for item in reversed(attempts) if str(item.get('message') or '').strip()),
            '',
        )
        if last_error:
            error_message = last_error

    return {
        'success': False,
        'mode': mode,
        'message': error_message,
        'manual_required': True,
        'manual_command': manual_command,
        'runtime': runtime,
        'commands': commands,
        'attempts': attempts,
    }


def _build_bth_client_profile_name(router_id: Any) -> str:
    try:
        numeric = int(router_id)
    except (TypeError, ValueError):
        numeric = 0
    if numeric <= 0:
        numeric = abs(hash(str(router_id or 'router'))) % 99999
    return f'wg-bth-r{numeric}'


def _normalize_allowed_ips_for_bth_profile(parsed_config: Dict[str, Any], router_host: str) -> str:
    raw_allowed = parsed_config.get('peer_allowed_ips')
    tokens = [str(item or '').strip() for item in (raw_allowed or []) if str(item or '').strip()]
    lowered = {token.lower() for token in tokens}
    has_default_v4 = '0.0.0.0/0' in lowered
    has_default_v6 = '::/0' in lowered

    mgmt_allowed = _normalize_wg_allowed_ip(router_host)
    if mgmt_allowed:
        return mgmt_allowed

    if tokens and not (has_default_v4 or has_default_v6):
        return _normalize_wireguard_allowed_subnets(tokens)

    fallback = _first_wireguard_interface_ip(parsed_config)
    if fallback:
        return fallback
    return '0.0.0.0/0,::/0'


def _build_bth_client_profile_config(parsed_config: Dict[str, Any], router_host: str, interface_name: str) -> str:
    interface_private_key = str(parsed_config.get('interface_private_key') or '').strip()
    peer_public_key = str(parsed_config.get('peer_public_key') or '').strip()
    endpoint = str(parsed_config.get('endpoint') or '').strip()
    if not interface_private_key or not peer_public_key or not endpoint:
        raise ValueError('BTH profile requires interface private key, peer public key and endpoint')

    interface_address = _first_wireguard_interface_ip(parsed_config)
    if not interface_address:
        interface_address = '10.255.255.2/32'
    interface_dns_items = parsed_config.get('interface_dns') if isinstance(parsed_config.get('interface_dns'), list) else []
    interface_dns = ', '.join([str(item or '').strip() for item in interface_dns_items if str(item or '').strip()])
    allowed_ips = _normalize_allowed_ips_for_bth_profile(parsed_config, router_host)
    keepalive = str(parsed_config.get('peer_persistent_keepalive') or '').strip() or '25'

    lines = [
        '[Interface]',
        f'# {interface_name}',
        f'Address = {interface_address}',
        f'PrivateKey = {interface_private_key}',
    ]
    if interface_dns:
        lines.append(f'DNS = {interface_dns}')
    lines.extend(
        [
            '',
            '[Peer]',
            f'PublicKey = {peer_public_key}',
            f'Endpoint = {endpoint}',
            f'AllowedIPs = {allowed_ips}',
            f'PersistentKeepalive = {keepalive}',
        ]
    )
    return '\n'.join(lines) + '\n'


def _build_bth_profile_manual_command(interface_name: str, config_text: str) -> str:
    encoded = base64.b64encode(str(config_text or '').encode('utf-8')).decode('ascii')
    iface = str(interface_name or '').strip()
    return (
        f'echo {shlex.quote(encoded)} | base64 -d | sudo tee /etc/wireguard/{iface}.conf >/dev/null\n'
        f'sudo chmod 600 /etc/wireguard/{iface}.conf\n'
        f'sudo wg-quick down {iface} >/dev/null 2>&1 || true\n'
        f'sudo wg-quick up {iface}\n'
        f'sudo systemctl enable wg-quick@{iface} >/dev/null 2>&1 || true\n'
        f'sudo wg show {iface}'
    )


def _sync_bth_profile_to_vps(parsed_config: Dict[str, Any], router_host: str, router_id: Any, payload: Dict[str, Any]) -> Dict[str, Any]:
    runtime = _resolve_wg_sync_runtime(payload)
    mode = str(runtime.get('mode') or WG_VPS_SYNC_MODE_DEFAULT)
    profile_name = _build_bth_client_profile_name(router_id)
    config_text = _build_bth_client_profile_config(parsed_config, router_host=router_host, interface_name=profile_name)
    manual_command = _build_bth_profile_manual_command(profile_name, config_text)
    attempts: List[Dict[str, Any]] = []

    if mode == 'manual':
        return {
            'success': False,
            'mode': 'manual',
            'message': 'Perfil BTH detectado: ejecuta comando manual para levantar tunel WG cliente en VPS.',
            'manual_required': True,
            'manual_command': manual_command,
            'runtime': runtime,
            'attempts': attempts,
            'profile_name': profile_name,
        }

    if mode in ('auto', 'ssh'):
        ssh_host = str(runtime.get('ssh_host') or '').strip()
        ssh_user = str(runtime.get('ssh_user') or '').strip()
        if ssh_host and ssh_user:
            encoded = base64.b64encode(str(config_text or '').encode('utf-8')).decode('ascii')
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            connect_kwargs: Dict[str, Any] = {
                'hostname': ssh_host,
                'username': ssh_user,
                'port': int(runtime.get('ssh_port') or 22),
                'timeout': max(2, int(runtime.get('ssh_timeout_seconds') or 8)),
                'banner_timeout': max(2, int(runtime.get('ssh_timeout_seconds') or 8)),
                'auth_timeout': max(2, int(runtime.get('ssh_timeout_seconds') or 8)),
                'look_for_keys': bool(runtime.get('ssh_key_path')),
            }
            if runtime.get('ssh_key_path'):
                connect_kwargs['key_filename'] = str(runtime.get('ssh_key_path'))
            if runtime.get('ssh_password'):
                connect_kwargs['password'] = str(runtime.get('ssh_password'))

            try:
                client.connect(**connect_kwargs)
                cmds = [
                    f'echo {shlex.quote(encoded)} | base64 -d | sudo tee /etc/wireguard/{profile_name}.conf >/dev/null',
                    f'sudo chmod 600 /etc/wireguard/{profile_name}.conf',
                    f'sudo wg-quick down {profile_name} >/dev/null 2>&1 || true',
                    f'sudo wg-quick up {profile_name}',
                    f'sudo systemctl enable wg-quick@{profile_name} >/dev/null 2>&1 || true',
                    f'sudo wg show {profile_name}',
                ]
                last_result: Dict[str, Any] = {}
                for cmd in cmds:
                    last_result = _run_ssh_command(client, cmd, timeout_seconds=int(runtime.get('ssh_timeout_seconds') or 8))
                    attempts.append({'transport': 'ssh', 'command': cmd, **last_result})
                    if not last_result.get('ok'):
                        detail = last_result.get('stderr') or last_result.get('stdout') or last_result.get('error') or 'ssh command failed'
                        return {
                            'success': False,
                            'mode': 'ssh_bth_profile',
                            'message': f'No se pudo activar perfil BTH por SSH: {detail}',
                            'manual_required': True,
                            'manual_command': manual_command,
                            'runtime': runtime,
                            'attempts': attempts,
                            'profile_name': profile_name,
                        }
                return {
                    'success': True,
                    'mode': 'ssh_bth_profile',
                    'message': 'Perfil BTH activado en VPS por SSH (perfil gestionado por servidor).',
                    'manual_required': False,
                    'manual_command': manual_command,
                    'runtime': runtime,
                    'attempts': attempts,
                    'profile_name': profile_name,
                }
            except Exception as exc:
                attempts.append({'transport': 'ssh', 'ok': False, 'error': str(exc)})
                return {
                    'success': False,
                    'mode': 'ssh_bth_profile',
                    'message': f'No se pudo conectar por SSH al VPS: {exc}',
                    'manual_required': True,
                    'manual_command': manual_command,
                    'runtime': runtime,
                    'attempts': attempts,
                    'profile_name': profile_name,
                }
            finally:
                try:
                    client.close()
                except Exception:
                    pass

    return {
        'success': False,
        'mode': mode,
        'message': 'Perfil BTH detectado. Configura sync_mode=ssh para activacion automatica en VPS o usa comando manual.',
        'manual_required': True,
        'manual_command': manual_command,
        'runtime': runtime,
        'attempts': attempts,
        'profile_name': profile_name,
    }


def _resolve_wireguard_profile(raw_params: Dict[str, Any]) -> Dict[str, Any]:
    tenant_endpoint = ''
    tenant_public_key = ''
    tenant_allowed_subnets = ''
    endpoint_source = 'default'
    public_key_source = 'default'
    allowed_subnets_source = 'default'

    endpoint_row = _tenant_setting_row(WG_PROFILE_ENDPOINT_SETTING_KEY)
    if endpoint_row and endpoint_row.value is not None:
        tenant_endpoint = str(endpoint_row.value).strip()
        if tenant_endpoint:
            endpoint_source = 'tenant_setting'

    public_key_row = _tenant_setting_row(WG_PROFILE_SERVER_PUBLIC_KEY_SETTING_KEY)
    if public_key_row and public_key_row.value is not None:
        tenant_public_key = str(public_key_row.value).strip()
        if tenant_public_key:
            public_key_source = 'tenant_setting'

    allowed_subnets_row = _tenant_setting_row(WG_PROFILE_ALLOWED_SUBNETS_SETTING_KEY)
    if allowed_subnets_row and allowed_subnets_row.value is not None:
        tenant_allowed_subnets = _normalize_wireguard_allowed_subnets(allowed_subnets_row.value)
        if tenant_allowed_subnets:
            allowed_subnets_source = 'tenant_setting'

    env_endpoint = str(current_app.config.get('MIKROTIK_WG_ENDPOINT') or '').strip()
    env_public_key = str(current_app.config.get('MIKROTIK_WG_SERVER_PUBLIC_KEY') or '').strip()
    env_allowed_subnets_raw = current_app.config.get('MIKROTIK_WG_ALLOWED_SUBNETS')
    env_allowed_subnets = (
        _normalize_wireguard_allowed_subnets(env_allowed_subnets_raw)
        if str(env_allowed_subnets_raw or '').strip()
        else ''
    )

    request_endpoint = str(raw_params.get('wg_endpoint') or '').strip()
    request_public_key = str(raw_params.get('wg_server_public_key') or '').strip()
    request_allowed_subnets_raw = raw_params.get('wg_allowed_subnets')
    request_allowed_subnets = (
        _normalize_wireguard_allowed_subnets(request_allowed_subnets_raw)
        if str(request_allowed_subnets_raw or '').strip()
        else ''
    )

    raw_endpoint = request_endpoint or tenant_endpoint or env_endpoint or WG_PROFILE_ENDPOINT_DEFAULT
    if request_endpoint:
        endpoint_source = 'request'
    elif tenant_endpoint:
        endpoint_source = 'tenant_setting'
    elif env_endpoint:
        endpoint_source = 'env'

    raw_public_key = request_public_key or tenant_public_key or env_public_key
    if request_public_key:
        public_key_source = 'request'
    elif tenant_public_key:
        public_key_source = 'tenant_setting'
    elif env_public_key:
        public_key_source = 'env'

    raw_allowed_subnets = request_allowed_subnets or tenant_allowed_subnets or env_allowed_subnets or WG_PROFILE_ALLOWED_SUBNETS_DEFAULT
    if request_allowed_subnets:
        allowed_subnets_source = 'request'
    elif tenant_allowed_subnets:
        allowed_subnets_source = 'tenant_setting'
    elif env_allowed_subnets:
        allowed_subnets_source = 'env'

    normalized_endpoint = _normalize_wireguard_endpoint(raw_endpoint)
    public_key = str(raw_public_key or '').strip()
    allowed_subnets = _normalize_wireguard_allowed_subnets(raw_allowed_subnets)
    public_key_valid = _is_valid_wireguard_public_key(public_key)

    issues: List[str] = []
    if not public_key_valid:
        issues.append('Define una public key valida para el servidor WireGuard en perfil global.')
    if not normalized_endpoint.get('host'):
        issues.append('Define endpoint WireGuard valido (host:port).')

    return {
        'endpoint': normalized_endpoint.get('endpoint'),
        'endpoint_host': normalized_endpoint.get('host'),
        'endpoint_port': int(normalized_endpoint.get('port') or 51820),
        'server_public_key': public_key if public_key_valid else WG_PROFILE_SERVER_PUBLIC_KEY_PLACEHOLDER,
        'server_public_key_valid': public_key_valid,
        'allowed_subnets': allowed_subnets,
        'ready': public_key_valid and bool(normalized_endpoint.get('host')),
        'issues': issues,
        'source': {
            'endpoint': endpoint_source,
            'server_public_key': public_key_source,
            'allowed_subnets': allowed_subnets_source,
        },
    }


def _normalize_ip_scope_token(raw_value: Any) -> str:
    token = str(raw_value or '').strip().lower()
    if token in ('public', 'publica', 'publico'):
        return 'public'
    if token in ('private', 'privada', 'privado'):
        return 'private'
    return 'auto'


def _build_access_profile(host_value: str, requested_scope_raw: Any) -> Dict[str, Any]:
    requested_scope = _normalize_ip_scope_token(requested_scope_raw)
    host = str(host_value or '').strip()

    is_ip = False
    detected_scope = 'unknown'
    reason = 'Host/DNS requiere verificacion manual de si es publico o privado.'
    normalized_host = host

    try:
        ip_obj = ipaddress.ip_address(host)
        is_ip = True
        normalized_host = str(ip_obj)
        if ip_obj.is_global:
            detected_scope = 'public'
            reason = f'IP global enrutable detectada: {normalized_host}.'
        else:
            detected_scope = 'private'
            reason = f'IP no global/NAT detectada: {normalized_host}.'
    except ValueError:
        pass

    final_scope = detected_scope
    if requested_scope in ('public', 'private'):
        final_scope = requested_scope
        reason = f'Modo forzado por operador: {requested_scope}.'
    elif detected_scope == 'unknown':
        final_scope = 'private'
        reason = 'Sin clasificacion IP exacta; se recomienda tunel seguro (WireGuard/BTH).'

    recommended_transport = 'back_to_home_first'
    if final_scope == 'public':
        recommended_transport = 'back_to_home_first_with_direct_fallback'
    allows_direct_inbound = final_scope == 'public'

    return {
        'requested_scope': requested_scope,
        'detected_scope': detected_scope,
        'effective_scope': final_scope,
        'is_ip': is_ip,
        'host': normalized_host,
        'allows_direct_inbound': allows_direct_inbound,
        'recommended_transport': recommended_transport,
        'reason': reason,
    }


def _build_connection_plan(access_profile: Dict[str, Any], back_to_home: Dict[str, Any]) -> Dict[str, Any]:
    effective_scope = str(access_profile.get('effective_scope') or 'private')
    recommended_transport = str(access_profile.get('recommended_transport') or 'back_to_home_first')
    reachable = bool(back_to_home.get('reachable'))
    supports_bth = back_to_home.get('supported')
    supports_bth_users = back_to_home.get('bth_users_supported')

    status = 'unknown'
    title = 'Conexion Express'
    summary = 'Revisa conectividad y aplica el metodo recomendado.'
    actions: List[Dict[str, Any]] = []

    if effective_scope == 'public':
        status = 'public_bth_first'
        title = 'Conexion guiada (Back To Home primero)'
        summary = 'Aunque haya IP publica, prioriza BTH por seguridad. Acceso directo queda como contingencia.'
        actions = [
            {
                'id': 'bootstrap_bth_auto',
                'label': 'Bootstrap BTH automatico',
                'description': 'Vincula router al sistema con identidad administrada por tenant (sin key manual).',
                'requires_local_access': False,
                'auto_available': bool(supports_bth_users),
            },
            {
                'id': 'apply_direct_acl',
                'label': 'ACL directa opcional',
                'description': 'Opcional: habilita acceso directo solo para contingencia con ACL estricta.',
                'script_key': 'direct_api_script',
                'requires_local_access': False,
                'auto_available': True,
            },
            {
                'id': 'prepare_tunnel_fallback',
                'label': 'WireGuard opcional',
                'description': 'Opcional para mejorar latencia en operacion masiva.',
                'script_key': 'wireguard_site_to_vps_script',
                'requires_local_access': False,
                'auto_available': False,
            },
        ]
    else:
        if reachable:
            if supports_bth:
                status = 'private_reachable_bth_first'
                title = 'Conexion privada lista (BTH recomendado)'
                summary = 'Router accesible por API. Completa BTH automatico primero y deja WireGuard como opcional.'
                actions = [
                    {
                        'id': 'bootstrap_bth_auto',
                        'label': 'Bootstrap BTH automatico',
                        'description': 'Crear usuario BTH desde el panel con identidad administrada por tenant.',
                        'requires_local_access': False,
                        'auto_available': bool(supports_bth_users),
                    },
                    {
                        'id': 'wireguard_tunnel',
                        'label': 'WireGuard site-to-site',
                        'description': 'Opcional para NOC masivo y menor latencia.',
                        'script_key': 'wireguard_site_to_vps_script',
                        'requires_local_access': False,
                        'auto_available': True,
                    },
                ]
            else:
                status = 'private_reachable_wireguard_only'
                title = 'Conexion privada con WireGuard recomendado'
                summary = 'Back To Home no confirmado por version RouterOS; usa WireGuard dedicado.'
                actions = [
                    {
                        'id': 'wireguard_tunnel',
                        'label': 'Aplicar tunel WireGuard',
                        'description': 'Ejecuta script site-to-site y valida acceso.',
                        'script_key': 'wireguard_site_to_vps_script',
                        'requires_local_access': False,
                        'auto_available': True,
                    },
                ]
        else:
            status = 'private_unreachable_needs_local_step'
            title = 'Conexion privada requiere paso local inicial'
            summary = 'No hay acceso API aun. Usa QR BTH o script minimo local para habilitar y luego reintenta.'
            actions = [
                {
                    'id': 'local_bth_enable',
                    'label': 'Ejecutar script minimo BTH',
                    'description': 'Entra por WinBox local y ejecuta habilitacion basica BTH.',
                    'script_key': 'bth_enable_minimal_script',
                    'requires_local_access': True,
                    'auto_available': False,
                },
                {
                    'id': 'retry_probe',
                    'label': 'Reintentar conexion desde panel',
                    'description': 'Despues del paso local, refresca para validar reachability.',
                    'requires_local_access': False,
                    'auto_available': True,
                },
                {
                    'id': 'wireguard_tunnel',
                    'label': 'Alternativa WireGuard',
                    'description': 'Opcional: si BTH no aplica, usa tunel WireGuard site-to-site.',
                    'script_key': 'wireguard_site_to_vps_script',
                    'requires_local_access': True,
                    'auto_available': False,
                },
            ]

    return {
        'status': status,
        'title': title,
        'summary': summary,
        'recommended_transport': recommended_transport,
        'actions': actions,
    }


def _probe_write_access(service: MikroTikService) -> Dict[str, Any]:
    """
    Probe write permissions by creating/removing a temporary system script.
    """
    script_name = f'fastisp-write-probe-{uuid.uuid4().hex[:8]}'
    script_api = None
    try:
        script_api = service.api.get_resource('/system/script')
        script_api.add(name=script_name, source=':put "fastisp-write-probe"', comment='fastisp-write-probe')
        created = script_api.get(name=script_name) or []
        if not created:
            return {'ok': False, 'detail': 'No se pudo confirmar creacion de script temporal.', 'severity': 'critical'}
        return {'ok': True, 'detail': 'Permisos de escritura API confirmados.', 'severity': 'ok'}
    except Exception as exc:
        return {'ok': False, 'detail': f'Sin permisos de escritura API: {exc}', 'severity': 'critical'}
    finally:
        try:
            if script_api is not None:
                created = script_api.get(name=script_name) or []
                for item in created:
                    script_id = str(item.get('.id') or item.get('id') or '').strip()
                    if script_id:
                        script_api.remove(id=script_id)
        except Exception:
            pass


def _build_router_readiness_payload(service: MikroTikService, run_write_probe: bool = False) -> Dict[str, Any]:
    checks: List[Dict[str, Any]] = []
    recommendations: List[str] = []

    runtime = _collect_back_to_home_runtime(service)
    reachable = bool(runtime.get('reachable'))
    checks.append(
        {
            'id': 'api_connectivity',
            'ok': reachable,
            'detail': 'Router reachable via API.' if reachable else 'Router API unreachable from backend.',
            'severity': 'critical' if not reachable else 'ok',
        }
    )

    version_text = str(runtime.get('routeros_version') or '').strip()
    supports_bth = bool(runtime.get('supported'))
    supports_bth_users = bool(runtime.get('bth_users_supported'))
    checks.append(
        {
            'id': 'routeros_bth_support',
            'ok': supports_bth,
            'detail': f'RouterOS {version_text or "unknown"} (BTH requiere 7.12+).',
            'severity': 'warning' if not supports_bth else 'ok',
        }
    )
    checks.append(
        {
            'id': 'routeros_bth_users_support',
            'ok': supports_bth_users,
            'detail': f'BTH users API {"disponible" if supports_bth_users else "no disponible"} (7.14+ recomendado).',
            'severity': 'warning' if not supports_bth_users else 'ok',
        }
    )

    ddns_enabled = bool(runtime.get('ddns_enabled'))
    checks.append(
        {
            'id': 'cloud_ddns',
            'ok': ddns_enabled,
            'detail': 'DDNS habilitado en /ip cloud.' if ddns_enabled else 'DDNS no habilitado en /ip cloud.',
            'severity': 'warning' if not ddns_enabled else 'ok',
        }
    )

    if run_write_probe and reachable:
        write_probe = _probe_write_access(service)
        checks.append({'id': 'api_write_access', **write_probe})
    else:
        checks.append(
            {
                'id': 'api_write_access',
                'ok': False,
                'detail': 'Write probe omitido. Usa write_probe=true para validar permisos de escritura.',
                'severity': 'warning',
            }
        )

    if not reachable:
        recommendations.append('Validar ruta VPN/BTH y firewall de gestion para permitir API desde el backend.')
    if reachable and run_write_probe and not checks[-1].get('ok'):
        recommendations.append('Otorgar permisos write/policy al usuario API en MikroTik.')
    if not supports_bth:
        recommendations.append('Actualizar RouterOS a 7.12+ para soporte Back To Home.')
    if supports_bth and not supports_bth_users:
        recommendations.append('Actualizar RouterOS a 7.14+ para gestion API de usuarios BTH.')
    if not ddns_enabled:
        recommendations.append('Habilitar DDNS en /ip cloud para mejorar operacion remota.')

    critical_checks = [item for item in checks if str(item.get('severity') or '') == 'critical']
    blockers = [{'id': item.get('id'), 'detail': item.get('detail')} for item in critical_checks if not item.get('ok')]

    total_score = 0
    for item in checks:
        if item.get('ok'):
            total_score += 100
    score = int(round(total_score / max(1, len(checks))))

    return {
        'score': score,
        'checks': checks,
        'blockers': blockers,
        'recommendations': recommendations,
        'routeros_version': version_text or None,
        'runtime': runtime,
        'write_probe_enabled': bool(run_write_probe),
    }


def _read_wireguard_config_from_upload() -> tuple[str, str]:
    config_text = str((request.form or {}).get('config_text') or '').strip()
    source_name = str((request.form or {}).get('source_name') or QR_SOURCE_DEFAULT_NAME).strip() or QR_SOURCE_DEFAULT_NAME
    if config_text:
        normalized_text = _normalize_wireguard_config_text(config_text)
        if len(normalized_text.encode('utf-8')) > WIREGUARD_IMPORT_MAX_BYTES:
            raise ValueError('config_text exceeds 2MB limit')
        return normalized_text, source_name

    upload = request.files.get('archive') or request.files.get('file')
    if upload is None:
        raise ValueError('archive file or config_text is required')

    raw_payload = upload.read() or b''
    if len(raw_payload) == 0:
        raise ValueError('archive file is empty')
    if len(raw_payload) > WIREGUARD_IMPORT_MAX_BYTES:
        raise ValueError('archive exceeds 2MB limit')

    source_name = str(upload.filename or 'wireguard')
    lowered_name = source_name.lower()
    is_zip = lowered_name.endswith('.zip') or raw_payload.startswith(b'PK')

    if not is_zip:
        text_payload = _decode_text_payload(raw_payload)
        return _normalize_wireguard_config_text(text_payload), source_name

    with zipfile.ZipFile(io.BytesIO(raw_payload)) as archive:
        members = [name for name in archive.namelist() if not name.endswith('/')]
        if not members:
            raise ValueError('zip archive has no files')

        conf_candidates = [name for name in members if name.lower().endswith(('.conf', '.txt', '.cfg'))]
        ordered_members = conf_candidates + [name for name in members if name not in conf_candidates]

        for member in ordered_members:
            try:
                payload = archive.read(member)
            except Exception:
                continue
            text = _decode_text_payload(payload)
            try:
                normalized = _normalize_wireguard_config_text(text)
                return normalized, member
            except ValueError:
                continue

    raise ValueError('no WireGuard configuration found in archive')

def _describe_router_host_scope(host: str) -> Dict[str, Any]:
    normalized_host = str(host or '').strip()
    if not normalized_host:
        return {'scope': 'unknown', 'is_ip': False, 'label': 'host desconocido'}

    try:
        ip_obj = ipaddress.ip_address(normalized_host)
    except ValueError:
        return {'scope': 'hostname', 'is_ip': False, 'label': 'hostname'}

    if ip_obj.is_loopback:
        return {'scope': 'loopback', 'is_ip': True, 'label': 'loopback'}
    if ip_obj.is_link_local:
        return {'scope': 'link_local', 'is_ip': True, 'label': 'link-local'}
    if ip_obj.is_private:
        return {'scope': 'private', 'is_ip': True, 'label': 'IP privada'}
    return {'scope': 'public', 'is_ip': True, 'label': 'IP publica'}


def _sanitize_connection_error(error: Any) -> str:
    text = str(error or '').strip()
    if not text:
        return 'sin detalle'
    return text[:220]


def _classify_api_connection_error(error_message: str, default_code: Optional[str] = None) -> str:
    if default_code:
        return default_code

    normalized = str(error_message or '').strip().lower()
    if not normalized:
        return 'api_connection_failed'
    if 'invalid user' in normalized or 'invalid username' in normalized or 'invalid password' in normalized:
        return 'api_auth_failed'
    if 'authentication' in normalized or 'not logged in' in normalized or 'login failed' in normalized:
        return 'api_auth_failed'
    if 'connection refused' in normalized or 'actively refused' in normalized:
        return 'api_service_disabled'
    if 'timed out' in normalized or 'timeout' in normalized:
        return 'api_timeout'
    if 'ssl' in normalized or 'handshake' in normalized or 'wrong version number' in normalized:
        return 'api_tls_mismatch'
    if 'reset by peer' in normalized or 'broken pipe' in normalized:
        return 'api_protocol_error'
    if 'pool' in normalized and 'exhausted' in normalized:
        return 'api_pool_exhausted'
    return 'api_connection_failed'


def _build_api_failure_detail(error_code: str, host: str, api_port: int, error_message: str) -> str:
    safe_error = _sanitize_connection_error(error_message)
    if error_code == 'api_auth_failed':
        return 'El puerto API responde, pero el login fue rechazado. Revisa usuario, password y permisos del usuario API.'
    if error_code == 'api_service_disabled':
        return f'El host responde, pero el servicio API en {host}:{api_port} rechazo la sesion. Verifica /ip service api.'
    if error_code == 'api_timeout':
        return f'El puerto {api_port} no completo el handshake API a tiempo. Puede haber filtrado, NAT o alta latencia.'
    if error_code == 'api_tls_mismatch':
        return f'Hay un desajuste entre el puerto/protocolo configurado y el servicio API del router. Detalle: {safe_error}'
    if error_code == 'api_protocol_error':
        return f'El router cerro la sesion API inesperadamente. Revisa version RouterOS, servicio API y filtrado intermedio. Detalle: {safe_error}'
    if error_code == 'api_pool_exhausted':
        return 'El pool local de conexiones MikroTik se agoto temporalmente. Reintenta en unos segundos.'
    if safe_error != 'sin detalle':
        return f'No fue posible completar la sesion API. Detalle: {safe_error}'
    return 'No fue posible completar la sesion API con el router.'


def _dedupe_recommendations(recommendations: List[str]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for item in recommendations:
        normalized = str(item or '').strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return ordered


def _build_router_connection_diagnostics(router: MikroTikRouter) -> Dict[str, Any]:
    host = str(router.ip_address or '').strip()
    api_port = _to_int(getattr(router, 'api_port', 8728), default=8728) or 8728
    host_scope = _describe_router_host_scope(host)
    checks: List[Dict[str, Any]] = []
    recommendations: List[str] = []
    runtime: Dict[str, Any] = {
        'host_scope': host_scope.get('scope'),
        'host_label': host_scope.get('label'),
        'resolved_addresses': [],
    }

    if host_scope.get('scope') in ('private', 'link_local', 'loopback'):
        transport_hint = 'Usa WireGuard o Back To Home como canal principal de gestion; no dependas de API directa por WAN.'
        recommendations.append('Como el router usa direccion no publica, prioriza WireGuard o Back To Home para operacion diaria y soporte remoto.')
    else:
        transport_hint = 'Puedes usar API directa si el sitio esta publicado, pero para produccion sigue siendo mejor encapsular la gestion por VPN.'

    if api_port == 8728:
        recommendations.append('Si el router estara expuesto fuera de la LAN, evita publicar 8728 en claro; usa WireGuard/BTH o migra a API-SSL 8729.')

    try:
        resolve_started = time.perf_counter()
        resolved = socket.getaddrinfo(host, api_port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
        resolve_elapsed_ms = round((time.perf_counter() - resolve_started) * 1000, 1)
        resolved_addresses: List[str] = []
        for _family, _socktype, _proto, _canonname, sockaddr in resolved:
            address = str((sockaddr or ('',))[0] or '').strip()
            if address and address not in resolved_addresses:
                resolved_addresses.append(address)
        runtime['dns_lookup_ms'] = resolve_elapsed_ms
        runtime['resolved_addresses'] = resolved_addresses
        checks.append(
            {
                'id': 'dns_resolution',
                'ok': True,
                'detail': f'Host resuelto correctamente ({", ".join(resolved_addresses[:3]) or host}) en {resolve_elapsed_ms} ms.',
                'severity': 'ok',
            }
        )
    except socket.gaierror as exc:
        checks.append(
            {
                'id': 'dns_resolution',
                'ok': False,
                'detail': f'No se pudo resolver {host}. Detalle: {_sanitize_connection_error(exc)}',
                'severity': 'critical',
            }
        )
        recommendations.append('Corrige el hostname o habilita DDNS estable antes de automatizar conexion y soporte remoto.')
        return {
            'success': False,
            'status': 'dns_unresolved',
            'summary': f'El backend no puede resolver el host {host}.',
            'host': host,
            'api_port': api_port,
            'host_scope': host_scope.get('scope'),
            'transport_hint': transport_hint,
            'checks': checks,
            'recommendations': _dedupe_recommendations(recommendations),
            'runtime': runtime,
        }

    tcp_error: Optional[BaseException] = None
    tcp_latency_ms: Optional[float] = None
    tcp_target = ''
    for _family, _socktype, _proto, _canonname, sockaddr in resolved[:3]:
        try:
            target_host = str((sockaddr or ('',))[0] or '').strip()
            attempt_started = time.perf_counter()
            with socket.create_connection(sockaddr, timeout=3.0):
                tcp_latency_ms = round((time.perf_counter() - attempt_started) * 1000, 1)
            tcp_target = target_host or host
            break
        except OSError as exc:
            tcp_error = exc

    if tcp_latency_ms is None:
        checks.append(
            {
                'id': 'tcp_port',
                'ok': False,
                'detail': f'No fue posible abrir TCP hacia {host}:{api_port}. Detalle: {_sanitize_connection_error(tcp_error)}',
                'severity': 'critical',
            }
        )
        recommendations.append(f'Permite {api_port}/TCP desde la IP del backend o desde el tunel de gestion.')
        recommendations.append('Confirma que el servicio API este habilitado en MikroTik y asociado a la interfaz correcta.')
        return {
            'success': False,
            'status': 'tcp_unreachable',
            'summary': f'El host responde a nivel DNS/IP, pero el puerto {api_port} no es alcanzable desde el backend.',
            'host': host,
            'api_port': api_port,
            'host_scope': host_scope.get('scope'),
            'transport_hint': transport_hint,
            'checks': checks,
            'recommendations': _dedupe_recommendations(recommendations),
            'runtime': runtime,
        }

    runtime['tcp_latency_ms'] = tcp_latency_ms
    runtime['tcp_target'] = tcp_target
    checks.append(
        {
            'id': 'tcp_port',
            'ok': True,
            'detail': f'Puerto {api_port}/TCP accesible en {tcp_target}:{api_port} ({tcp_latency_ms} ms).',
            'severity': 'ok',
        }
    )

    service_error = ''
    service_error_code = ''
    api_connected = False
    try:
        with MikroTikService(router.id) as service:
            api_connected = bool(service.api)
            service_error = str(getattr(service, 'last_connection_error', '') or '').strip()
            service_error_code = str(getattr(service, 'last_connection_code', '') or '').strip()
    except Exception as exc:
        service_error = _sanitize_connection_error(exc)

    if api_connected:
        checks.append(
            {
                'id': 'api_login',
                'ok': True,
                'detail': 'Sesion API autenticada correctamente con las credenciales configuradas.',
                'severity': 'ok',
            }
        )
        return {
            'success': True,
            'status': 'connected',
            'summary': 'Conexion API operativa y lista para automatizaciones.',
            'host': host,
            'api_port': api_port,
            'host_scope': host_scope.get('scope'),
            'transport_hint': transport_hint,
            'checks': checks,
            'recommendations': _dedupe_recommendations(recommendations),
            'runtime': runtime,
        }

    error_code = _classify_api_connection_error(service_error, default_code=service_error_code or None)
    checks.append(
        {
            'id': 'api_login',
            'ok': False,
            'detail': _build_api_failure_detail(error_code, host, api_port, service_error),
            'severity': 'critical',
        }
    )

    if error_code == 'api_auth_failed':
        recommendations.append('Valida usuario, password y que el grupo tenga permisos api/read/write/policy segun el flujo que vas a ejecutar.')
    elif error_code == 'api_service_disabled':
        recommendations.append('Habilita el servicio API en MikroTik o ajusta el puerto configurado en FASTISP para que coincida con el router.')
    elif error_code == 'api_tls_mismatch':
        recommendations.append('Verifica si el router expone API simple (8728) o API-SSL (8729) y alinea la configuracion del sitio con FASTISP.')
    elif error_code in ('api_timeout', 'api_protocol_error', 'api_connection_failed'):
        recommendations.append('Si el host y el puerto responden pero la sesion API falla, revisa filtrado intermedio, NAT, version RouterOS y salud del servicio API.')
    elif error_code == 'api_pool_exhausted':
        recommendations.append('Reduce pruebas simultaneas o aumenta el pool si esperas operaciones concurrentes sobre el mismo router.')

    summary_by_code = {
        'api_auth_failed': 'El puerto responde, pero el login API fue rechazado por el router.',
        'api_service_disabled': 'El host responde, pero el servicio API no esta aceptando sesiones.',
        'api_timeout': 'El puerto responde de forma inestable y el handshake API expiro.',
        'api_tls_mismatch': 'El router responde, pero el puerto/protocolo configurado no coincide con el servicio API esperado.',
        'api_protocol_error': 'El router cierra la sesion API antes de completar la autenticacion.',
        'api_pool_exhausted': 'FASTISP agoto temporalmente su pool local de conexiones para este router.',
    }

    return {
        'success': False,
        'status': error_code,
        'summary': summary_by_code.get(error_code, 'No fue posible completar la sesion API con el router.'),
        'host': host,
        'api_port': api_port,
        'host_scope': host_scope.get('scope'),
        'transport_hint': transport_hint,
        'checks': checks,
        'recommendations': _dedupe_recommendations(recommendations),
        'runtime': runtime,
    }


def _test_router_connection(router: MikroTikRouter) -> bool:
    return bool(_build_router_connection_diagnostics(router).get('success'))

def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value)))
    except Exception:
        return default

def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    text = str(value).strip().lower()
    if text in ('1', 'true', 'yes', 'y', 'on'):
        return True
    if text in ('0', 'false', 'no', 'n', 'off'):
        return False
    return default

def _as_clean_text(value: Any) -> Optional[str]:
    text = str(value or '').strip()
    return text or None

def _parse_router_latency_ms(value: Any) -> Optional[float]:
    if value is None:
        return None
    raw = str(value).strip().lower()
    if not raw:
        return None
    if raw.endswith('ms'):
        try:
            return float(raw.replace('ms', '').strip())
        except Exception:
            return None
    if raw.count(':') == 2:
        # RouterOS can report latency as HH:MM:SS.sss
        try:
            h, m, s = raw.split(':')
            seconds = (int(h) * 3600) + (int(m) * 60) + float(s)
            return round(seconds * 1000, 2)
        except Exception:
            return None
    try:
        return float(raw)
    except Exception:
        return None


def _normalize_queue_item(queue: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'id': queue.get('id') or queue.get('.id') or '',
        'name': queue.get('name', ''),
        'target': queue.get('target', ''),
        'max_limit': queue.get('max_limit') or queue.get('max-limit') or '',
        'rate': queue.get('rate', ''),
        'packet_rate': queue.get('packet_rate') or queue.get('packet-rate') or '',
        'queued_bytes': queue.get('queued_bytes') or queue.get('queued-bytes') or '0',
        'queued_packets': queue.get('queued_packets') or queue.get('queued-packets') or '0',
        'disabled': str(queue.get('disabled', 'false')).lower() == 'true' if isinstance(queue.get('disabled'), str) else bool(queue.get('disabled', False)),
        'comment': queue.get('comment', ''),
    }

def _resolve_actor_identity() -> str:
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


def _tenant_router_query():
    tenant_id = current_tenant_id()
    query = MikroTikRouter.query
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)
    return query


def _tenant_setting_row(key_name: str, tenant_id: Any = _TENANT_SETTING_SENTINEL) -> Optional[AdminSystemSetting]:
    scoped_tenant = current_tenant_id() if tenant_id is _TENANT_SETTING_SENTINEL else tenant_id
    query = AdminSystemSetting.query.filter_by(key=key_name)
    if scoped_tenant is None:
        query = query.filter(AdminSystemSetting.tenant_id.is_(None))
    else:
        query = query.filter(AdminSystemSetting.tenant_id == scoped_tenant)
    return query.first()


def _tenant_setting_upsert(key_name: str, value: Any, tenant_id: Any = _TENANT_SETTING_SENTINEL) -> AdminSystemSetting:
    scoped_tenant = current_tenant_id() if tenant_id is _TENANT_SETTING_SENTINEL else tenant_id
    row = _tenant_setting_row(key_name, tenant_id=scoped_tenant)
    if row is None:
        row = AdminSystemSetting(
            tenant_id=scoped_tenant,
            key=key_name,
            value=value,
            updated_by=None,
            updated_at=datetime.utcnow(),
        )
    else:
        row.value = value
        row.updated_at = datetime.utcnow()
    db.session.add(row)
    db.session.commit()
    return row


def _current_actor_user() -> Optional[User]:
    try:
        identity = get_jwt_identity()
        if not identity:
            return None
        return db.session.get(User, identity)
    except Exception:
        return None


def _tenant_context_payload() -> Dict[str, Any]:
    tenant_id = current_tenant_id()
    tenant = db.session.get(Tenant, tenant_id) if tenant_id is not None else None
    user = _current_actor_user()
    return {
        'tenant_id': tenant_id,
        'tenant_slug': str(getattr(tenant, 'slug', '') or '').strip() or None,
        'tenant_name': str(getattr(tenant, 'name', '') or '').strip() or None,
        'actor_email': str(getattr(user, 'email', '') or '').strip() or None,
        'actor_name': str(getattr(user, 'name', '') or '').strip() or None,
    }


def _slugify_scope_token(value: Any, fallback: str = 'isp') -> str:
    token = re.sub(r'[^a-z0-9]+', '-', str(value or '').strip().lower()).strip('-')
    return token[:32] or fallback


def _normalize_router_name_prefix(value: Any, fallback: str) -> str:
    normalized = re.sub(r'[^a-zA-Z0-9._ -]+', '-', str(value or '').strip()).strip()
    normalized = re.sub(r'\s+', '-', normalized).strip('-')
    return normalized[:32] or fallback[:32] or 'isp'


def _normalize_bth_user_name(value: Any, fallback: str) -> str:
    normalized = re.sub(r'[^a-zA-Z0-9._-]+', '-', str(value or '').strip()).strip('-')
    return normalized[:48] or fallback[:48] or 'noc-vps'


def _suggest_router_name(base_name: str, prefix: str) -> str:
    safe_base = re.sub(r'[^a-zA-Z0-9._ -]+', '-', str(base_name or '').strip()).strip()
    safe_base = re.sub(r'\s+', '-', safe_base).strip('-')
    safe_prefix = _normalize_router_name_prefix(prefix, fallback='isp')
    if not safe_base:
        return safe_prefix
    lowered_base = safe_base.lower()
    lowered_prefix = safe_prefix.lower()
    if lowered_base == lowered_prefix or lowered_base.startswith(f'{lowered_prefix}-'):
        return safe_base[:80]
    return f'{safe_prefix}-{safe_base}'[:80]


def _default_mikrotik_onboarding_profile() -> Dict[str, Any]:
    tenant_context = _tenant_context_payload()
    tenant_slug = str(tenant_context.get('tenant_slug') or '').strip()
    tenant_name = str(tenant_context.get('tenant_name') or '').strip()
    actor_name = str(tenant_context.get('actor_name') or '').strip()
    actor_email = str(tenant_context.get('actor_email') or '').strip()
    tenant_id = tenant_context.get('tenant_id')

    account_label = tenant_name or actor_name or actor_email or (
        f'ISP Tenant {tenant_id}' if tenant_id is not None else 'Cuenta principal'
    )
    account_slug = tenant_slug or _slugify_scope_token(account_label, fallback='isp')
    router_name_prefix = _normalize_router_name_prefix(account_slug, fallback='isp')
    default_bth_user_name = _normalize_bth_user_name(f'{account_slug}-noc', fallback='noc-vps')

    return {
        'account_label': account_label[:120],
        'account_slug': account_slug,
        'router_name_prefix': router_name_prefix,
        'default_username': 'admin',
        'default_api_port': 8728,
        'default_bth_user_name': default_bth_user_name,
        'default_allow_lan': True,
        'auto_vps_link': True,
        'auto_bootstrap_bth': False,
        'comment_prefix': account_label[:120],
        'tenant_scope': tenant_context,
    }


def _normalize_mikrotik_onboarding_profile(raw_payload: Dict[str, Any], existing: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    base = dict(existing or _default_mikrotik_onboarding_profile())
    payload = raw_payload or {}

    account_label = str(payload.get('account_label') or base.get('account_label') or '').strip()
    if not account_label:
        raise ValueError('account_label is required')

    requested_slug = str(payload.get('account_slug') or base.get('account_slug') or '').strip()
    account_slug = _slugify_scope_token(requested_slug or account_label, fallback='isp')

    requested_prefix = payload.get('router_name_prefix')
    if requested_prefix in (None, ''):
        requested_prefix = base.get('router_name_prefix') or account_slug
    router_name_prefix = _normalize_router_name_prefix(requested_prefix, fallback=account_slug)

    requested_username = str(payload.get('default_username') or base.get('default_username') or 'admin').strip()
    default_username = requested_username[:80] or 'admin'

    try:
        default_api_port = int(payload.get('default_api_port') or base.get('default_api_port') or 8728)
    except (TypeError, ValueError) as exc:
        raise ValueError('default_api_port must be integer') from exc
    if default_api_port < 1 or default_api_port > 65535:
        raise ValueError('default_api_port must be between 1 and 65535')

    requested_bth_user = payload.get('default_bth_user_name')
    if requested_bth_user in (None, ''):
        requested_bth_user = base.get('default_bth_user_name') or f'{account_slug}-noc'
    default_bth_user_name = _normalize_bth_user_name(requested_bth_user, fallback=f'{account_slug}-noc')

    requested_comment = payload.get('comment_prefix')
    if requested_comment in (None, ''):
        requested_comment = base.get('comment_prefix') or account_label
    comment_prefix = str(requested_comment or '').strip()[:120] or account_label[:120]

    return {
        'account_label': account_label[:120],
        'account_slug': account_slug,
        'router_name_prefix': router_name_prefix,
        'default_username': default_username,
        'default_api_port': default_api_port,
        'default_bth_user_name': default_bth_user_name,
        'default_allow_lan': _as_bool(payload.get('default_allow_lan'), default=bool(base.get('default_allow_lan', True))),
        'auto_vps_link': _as_bool(payload.get('auto_vps_link'), default=bool(base.get('auto_vps_link', True))),
        'auto_bootstrap_bth': _as_bool(payload.get('auto_bootstrap_bth'), default=bool(base.get('auto_bootstrap_bth', False))),
        'comment_prefix': comment_prefix,
        'tenant_scope': _tenant_context_payload(),
    }


def _resolve_mikrotik_onboarding_profile() -> Dict[str, Any]:
    defaults = _default_mikrotik_onboarding_profile()
    row = _tenant_setting_row(MIKROTIK_ONBOARDING_PROFILE_SETTING_KEY)
    stored = row.value if row and isinstance(row.value, dict) else {}
    if not isinstance(stored, dict):
        stored = {}
    return _normalize_mikrotik_onboarding_profile(stored, existing=defaults)


def _secret_fernet() -> Fernet:
    encryption_key = current_app.config.get('ENCRYPTION_KEY')
    if not encryption_key:
        raise RuntimeError('ENCRYPTION_KEY is required')
    if isinstance(encryption_key, str):
        encryption_key = encryption_key.encode('utf-8')
    return Fernet(encryption_key)


def _encrypt_secret_value(plaintext: str) -> str:
    token = _secret_fernet().encrypt(str(plaintext or '').encode('utf-8'))
    return token.decode('utf-8')


def _decrypt_secret_value(token: str) -> str:
    decrypted = _secret_fernet().decrypt(str(token or '').encode('utf-8'))
    return decrypted.decode('utf-8')


def _generate_wireguard_private_key_base64() -> str:
    private_key = x25519.X25519PrivateKey.generate()
    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return base64.b64encode(private_bytes).decode('ascii')


def _wireguard_public_key_from_private_base64(private_key_base64: str) -> str:
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


def _managed_bth_identity_metadata(identity: Dict[str, Any]) -> Dict[str, Any]:
    return {
        'enabled': bool(identity.get('private_key')),
        'source': identity.get('source') or 'tenant_managed',
        'user_name': identity.get('user_name') or 'noc-vps',
        'public_key': identity.get('public_key') or None,
        'tenant_id': identity.get('tenant_id'),
        'created_now': bool(identity.get('created_now')),
        'error': identity.get('error') or None,
    }


def _get_or_create_managed_bth_identity(
    preferred_user_name: str = 'noc-vps',
    create_if_missing: bool = True,
) -> Dict[str, Any]:
    tenant_id = current_tenant_id()
    requested_user = str(preferred_user_name or '').strip() or 'noc-vps'
    row = _tenant_setting_row(BTH_MANAGED_IDENTITY_SETTING_KEY, tenant_id=tenant_id)
    raw_value = row.value if row and isinstance(row.value, dict) else {}
    if not isinstance(raw_value, dict):
        raw_value = {}

    private_key = ''
    public_key = str(raw_value.get('public_key') or '').strip()
    encrypted_private_key = str(raw_value.get('private_key_encrypted') or '').strip()
    stored_user_name = str(raw_value.get('user_name') or '').strip() or requested_user
    created_now = False
    needs_persist = False
    error_message = ''

    if encrypted_private_key:
        try:
            private_key = _decrypt_secret_value(encrypted_private_key)
        except Exception as exc:
            logger.warning('Could not decrypt managed BTH key for tenant %s: %s', tenant_id, exc)
            error_message = 'stored_key_unreadable'
            private_key = ''
            public_key = ''
            needs_persist = True

    if private_key and not public_key:
        try:
            public_key = _wireguard_public_key_from_private_base64(private_key)
            needs_persist = True
        except Exception as exc:
            logger.warning('Could not derive public key for tenant %s: %s', tenant_id, exc)
            private_key = ''
            public_key = ''
            error_message = 'stored_key_invalid'
            needs_persist = True

    if not private_key and create_if_missing:
        private_key = _generate_wireguard_private_key_base64()
        public_key = _wireguard_public_key_from_private_base64(private_key)
        created_now = True
        needs_persist = True

    effective_user_name = stored_user_name or requested_user
    if effective_user_name != stored_user_name:
        needs_persist = True

    if needs_persist and private_key:
        payload = {
            'version': 1,
            'user_name': effective_user_name,
            'public_key': public_key,
            'private_key_encrypted': _encrypt_secret_value(private_key),
            'created_at': str(raw_value.get('created_at') or datetime.utcnow().isoformat() + 'Z'),
            'updated_at': datetime.utcnow().isoformat() + 'Z',
        }
        _tenant_setting_upsert(BTH_MANAGED_IDENTITY_SETTING_KEY, payload, tenant_id=tenant_id)

    return {
        'tenant_id': tenant_id,
        'user_name': effective_user_name,
        'private_key': private_key,
        'public_key': public_key,
        'created_now': created_now,
        'source': 'tenant_managed',
        'error': error_message,
    }


def _resolve_bth_key_for_request(
    provided_private_key: str,
    preferred_user_name: str = 'noc-vps',
) -> Dict[str, Any]:
    manual_key = str(provided_private_key or '').strip()
    if manual_key:
        return {
            'private_key': manual_key,
            'source': 'manual_override',
            'identity': _managed_bth_identity_metadata(
                {
                    'private_key': manual_key,
                    'user_name': preferred_user_name,
                    'source': 'manual_override',
                    'tenant_id': current_tenant_id(),
                }
            ),
        }

    managed_identity = _get_or_create_managed_bth_identity(preferred_user_name=preferred_user_name, create_if_missing=True)
    return {
        'private_key': str(managed_identity.get('private_key') or '').strip(),
        'source': 'tenant_managed',
        'identity': _managed_bth_identity_metadata(managed_identity),
    }


def _router_for_request(router_id: Any) -> Optional[MikroTikRouter]:
    try:
        normalized = int(router_id)
    except (TypeError, ValueError):
        return None
    router = db.session.get(MikroTikRouter, normalized)
    if not router:
        return None
    if not tenant_access_allowed(router.tenant_id):
        return None
    return router


def _tenant_setting_bool(key_name: str, default: bool = False) -> bool:
    row = _tenant_setting_row(key_name)
    if row is None:
        return default
    value = row.value
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in ('1', 'true', 'yes', 'y', 'on')


def _change_control_guard(required_default: bool = True):
    required = _tenant_setting_bool("change_control_required_for_live", default=required_default)
    if not required:
        return None

    data = request.get_json(silent=True) or {}
    form = request.form or {}
    ticket = str(
        data.get('change_ticket')
        or form.get('change_ticket')
        or request.args.get('change_ticket')
        or request.headers.get('X-Change-Ticket')
        or ''
    ).strip()
    if ticket:
        return None
    return jsonify({'success': False, 'error': 'change_ticket is required for this action'}), 400


def _preflight_guard(required_default: bool = True):
    required = _tenant_setting_bool("require_preflight_for_live", default=required_default)
    if not required:
        return None

    data = request.get_json(silent=True) or {}
    form = request.form or {}
    raw_preflight_ack = data.get('preflight_ack')
    if raw_preflight_ack in (None, ''):
        raw_preflight_ack = form.get('preflight_ack')
    preflight_ack = _as_bool(raw_preflight_ack, default=False)
    if preflight_ack:
        return None
    return jsonify({'success': False, 'error': 'preflight_ack=true is required for this action'}), 400


def _live_guard(require_preflight: bool = False, required_default: bool = True):
    change_error = _change_control_guard(required_default=required_default)
    if change_error:
        return change_error
    if not require_preflight:
        return None
    return _preflight_guard(required_default=required_default)


def _pick_value(data: Dict[str, Any], *keys: str):
    for key in keys:
        if key in data:
            return data.get(key)
        alt = key.replace('-', '_')
        if alt in data:
            return data.get(alt)
        alt = key.replace('_', '-')
        if alt in data:
            return data.get(alt)
    return None


def _parse_routeros_version(raw_version: Any) -> tuple[int, int, int]:
    text = str(raw_version or '').strip()
    if not text:
        return (0, 0, 0)
    match = re.search(r'(\d+)\.(\d+)(?:\.(\d+))?', text)
    if not match:
        return (0, 0, 0)
    major = int(match.group(1))
    minor = int(match.group(2))
    patch = int(match.group(3) or 0)
    return (major, minor, patch)


def _version_supports_back_to_home(version: tuple[int, int, int]) -> bool:
    return version >= (7, 12, 0)


def _version_supports_bth_users(version: tuple[int, int, int]) -> bool:
    return version >= (7, 14, 0)


def _get_change_log(router_id: str) -> List[Dict[str, Any]]:
    key = str(router_id)
    if key not in ENTERPRISE_CHANGELOG:
        ENTERPRISE_CHANGELOG[key] = []
    return ENTERPRISE_CHANGELOG[key]

def _build_hardening_runbook(profile: str, site_profile: str) -> Dict[str, List[str]]:
    commands = [
        ':do {/ip service set telnet disabled=yes} on-error={}',
        ':do {/ip service set ftp disabled=yes} on-error={}',
        ':do {/ip service set www disabled=yes} on-error={}',
        ':do {/ip service set api disabled=yes} on-error={}',
        ':do {/ip service set api-ssl disabled=yes} on-error={}'
    ]
    rollback_commands = [
        ':do {/ip service set telnet disabled=no} on-error={}',
        ':do {/ip service set ftp disabled=no} on-error={}',
        ':do {/ip service set www disabled=no} on-error={}',
        ':do {/ip service set api disabled=no} on-error={}',
        ':do {/ip service set api-ssl disabled=no} on-error={}'
    ]

    if profile in ('strict', 'hardened'):
        commands.extend([
            ':do {/ip service set ssh strong-crypto=yes} on-error={}',
            ':do {/ip settings set rp-filter=strict} on-error={}',
            ':do {/ip neighbor discovery-settings set discover-interface-list=none} on-error={}'
        ])
        rollback_commands.extend([
            ':do {/ip settings set rp-filter=loose} on-error={}',
            ':do {/ip neighbor discovery-settings set discover-interface-list=all} on-error={}'
        ])

    if site_profile == 'core':
        commands.extend([
            ':do {/system logging add topics=critical action=memory} on-error={}',
            ':do {/ip firewall filter add chain=input action=drop connection-state=invalid comment="auto-core-invalid"} on-error={}'
        ])
        rollback_commands.extend([
            ':do {/ip firewall filter remove [find comment="auto-core-invalid"]} on-error={}'
        ])
    elif site_profile == 'distribution':
        commands.extend([
            ':do {/ip firewall filter add chain=input action=accept protocol=icmp limit=50,5:packet comment="auto-dist-icmp"} on-error={}',
            ':do {/ip firewall filter add chain=input action=drop protocol=icmp comment="auto-dist-icmp-drop"} on-error={}'
        ])
        rollback_commands.extend([
            ':do {/ip firewall filter remove [find comment="auto-dist-icmp"]} on-error={}',
            ':do {/ip firewall filter remove [find comment="auto-dist-icmp-drop"]} on-error={}'
        ])
    elif site_profile == 'access':
        commands.extend([
            ':do {/interface ethernet switch set 0 drop-if-invalid-or-src-port-not-member-of-vlan-on-ports=yes} on-error={}',
            ':do {/ip firewall filter add chain=forward action=drop connection-state=invalid comment="auto-access-invalid"} on-error={}'
        ])
        rollback_commands.extend([
            ':do {/ip firewall filter remove [find comment="auto-access-invalid"]} on-error={}'
        ])
    elif site_profile == 'hotspot':
        commands.extend([
            ':do {/ip hotspot profile set [find default=yes] split-user-domain=no} on-error={}',
            ':do {/ip firewall filter add chain=forward action=drop protocol=tcp dst-port=25 comment="auto-hotspot-smtp"} on-error={}'
        ])
        rollback_commands.extend([
            ':do {/ip firewall filter remove [find comment="auto-hotspot-smtp"]} on-error={}'
        ])

    return {'commands': commands, 'rollback_commands': rollback_commands}

def _register_change(
    router_id: str,
    actor: str,
    category: str,
    profile: str,
    site_profile: str,
    commands: List[str],
    rollback_commands: List[str],
    status: str,
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    change_id = f"CHG-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
    entry = {
        'change_id': change_id,
        'router_id': str(router_id),
        'created_at': datetime.utcnow().isoformat() + 'Z',
        'actor': actor,
        'category': category,
        'profile': profile,
        'site_profile': site_profile,
        'status': status,
        'commands': commands,
        'rollback_commands': rollback_commands,
        'metadata': metadata or {}
    }
    log = _get_change_log(str(router_id))
    log.insert(0, entry)
    del log[250:]
    ENTERPRISE_CHANGE_INDEX[change_id] = entry
    return entry


@mikrotik_bp.route('/wireguard/import', methods=['POST'])
@admin_required()
def import_wireguard_archive():
    """
    Import a WireGuard export (zip/conf) and return quick onboarding suggestions.
    """
    try:
        config_text, source_file = _read_wireguard_config_from_upload()
        parsed = _parse_wireguard_config(config_text)
        if not parsed.get('is_wireguard_config'):
            return jsonify({'success': False, 'error': 'File is not a valid WireGuard config'}), 400

        onboarding_profile = _resolve_mikrotik_onboarding_profile()
        tunnel_host = _first_wireguard_interface_host(parsed)
        is_bth_profile = _is_back_to_home_client_profile(parsed)
        endpoint_host = str(parsed.get('endpoint_host') or '').strip()
        safe_host = re.sub(r'[^a-zA-Z0-9.-]+', '-', endpoint_host).strip('-') if endpoint_host else ''
        base_name = f'Nodo-{safe_host}'[:80] if safe_host else 'Nodo-MikroTik'
        suggested_name = _suggest_router_name(base_name, str(onboarding_profile.get('router_name_prefix') or 'isp'))

        suggestions = {
            'router_name': suggested_name,
            'router_ip_or_host': '' if is_bth_profile else (tunnel_host or endpoint_host),
            'api_port': int(onboarding_profile.get('default_api_port') or 8728),
            'bth_private_key': str(parsed.get('interface_private_key') or ''),
            'bth_user_name': str(onboarding_profile.get('default_bth_user_name') or 'noc-vps'),
            'router_tunnel_ip': tunnel_host or None,
            'router_management_ip_required': bool(is_bth_profile),
            'default_username': str(onboarding_profile.get('default_username') or 'admin'),
            'account_label': str(onboarding_profile.get('account_label') or ''),
        }

        return jsonify(
            {
                'success': True,
                'source_file': source_file,
                'wireguard': parsed,
                'suggestions': suggestions,
                'onboarding_profile': onboarding_profile,
                'tenant_scope': onboarding_profile.get('tenant_scope') or {},
            }
        ), 200
    except zipfile.BadZipFile:
        return jsonify({'success': False, 'error': 'Invalid zip archive'}), 400
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        logger.error('Error importing WireGuard archive: %s', exc, exc_info=True)
        return jsonify({'success': False, 'error': 'Could not parse WireGuard archive'}), 500


@mikrotik_bp.route('/wireguard/onboard', methods=['POST'])
@admin_required()
def onboard_router_from_wireguard_archive():
    """
    One-click onboarding:
    1) parse WireGuard export
    2) create/update router inventory
    3) run readiness checks
    4) optional Back To Home bootstrap
    """
    try:
        config_text, source_file = _read_wireguard_config_from_upload()
        parsed = _parse_wireguard_config(config_text)
        if not parsed.get('is_wireguard_config'):
            return jsonify({'success': False, 'error': 'File is not a valid WireGuard config'}), 400
    except zipfile.BadZipFile:
        return jsonify({'success': False, 'error': 'Invalid zip archive'}), 400
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        logger.error('Error parsing WireGuard archive for onboarding: %s', exc, exc_info=True)
        return jsonify({'success': False, 'error': 'Could not parse WireGuard archive'}), 500

    form = request.form or {}
    parsed_tunnel_host = _first_wireguard_interface_host(parsed)
    is_bth_profile = _is_back_to_home_client_profile(parsed)
    form_ip_address = str(form.get('ip_address') or '').strip()
    if is_bth_profile and not form_ip_address:
        return jsonify(
            {
                'success': False,
                'error': 'Para perfil Back To Home por QR debes ingresar IP de gestion del router en "IP o DNS".',
            }
        ), 400
    raw_endpoint_host = str(form_ip_address or parsed_tunnel_host or parsed.get('endpoint_host') or '').strip()
    endpoint_host, _ = _normalize_router_host(raw_endpoint_host)
    if not endpoint_host:
        return jsonify({'success': False, 'error': 'ip_address or WireGuard endpoint host is required'}), 400

    onboarding_profile = _resolve_mikrotik_onboarding_profile()
    safe_host = re.sub(r'[^a-zA-Z0-9.-]+', '-', endpoint_host).strip('-')
    suggested_name = _suggest_router_name(
        f'Nodo-{safe_host}'[:80] if safe_host else 'Nodo-MikroTik',
        str(onboarding_profile.get('router_name_prefix') or 'isp'),
    )

    name = str(form.get('name') or suggested_name).strip() or suggested_name
    username = str(form.get('username') or onboarding_profile.get('default_username') or '').strip()
    password = str(form.get('password') or '').strip()
    if not username:
        return jsonify({'success': False, 'error': 'username is required'}), 400
    if not password:
        return jsonify({'success': False, 'error': 'password is required'}), 400

    raw_api_port = form.get('api_port')
    try:
        if raw_api_port in (None, ''):
            api_port = int(onboarding_profile.get('default_api_port') or 8728)
        else:
            api_port = int(raw_api_port)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'api_port must be integer'}), 400
    if api_port < 1 or api_port > 65535:
        return jsonify({'success': False, 'error': 'api_port must be between 1 and 65535'}), 400

    update_existing = _as_bool(form.get('update_existing'), default=True)
    run_write_probe = _as_bool(form.get('write_probe'), default=True)
    auto_vps_link = _as_bool(form.get('auto_vps_link'), default=bool(onboarding_profile.get('auto_vps_link', True)))
    bootstrap_bth = _as_bool(form.get('bootstrap_bth'), default=bool(onboarding_profile.get('auto_bootstrap_bth', False)))
    requested_bth_user_name = str(form.get('bth_user_name') or '').strip()
    bth_user_name = requested_bth_user_name or str(onboarding_profile.get('default_bth_user_name') or 'noc-vps')
    provided_bth_private_key = str(form.get('bth_private_key') or parsed.get('interface_private_key') or '').strip()
    bth_key_resolution = _resolve_bth_key_for_request(provided_bth_private_key, preferred_user_name=bth_user_name)
    bth_private_key = str(bth_key_resolution.get('private_key') or '').strip()
    bth_identity = bth_key_resolution.get('identity') or {}
    if not requested_bth_user_name and isinstance(bth_identity, dict):
        bth_user_name = str(bth_identity.get('user_name') or bth_user_name).strip() or bth_user_name
    bth_allow_lan = _as_bool(form.get('bth_allow_lan'), default=bool(onboarding_profile.get('default_allow_lan', True)))
    replace_existing_user = _as_bool(form.get('replace_existing_user'), default=True)
    update_time = _as_bool(form.get('update_time'), default=True)
    ddns_enabled = _as_bool(form.get('ddns_enabled'), default=True)
    enable_vpn = _as_bool(form.get('enable_vpn'), default=True)
    default_comment = str(onboarding_profile.get('comment_prefix') or 'FastISP VPS').strip() or 'FastISP VPS'
    comment = str(form.get('comment') or f'{default_comment} | FastISP VPS').strip() or f'{default_comment} | FastISP VPS'

    if bootstrap_bth:
        guard_error = _live_guard(require_preflight=True, required_default=True)
        if guard_error:
            return guard_error
        if not bth_private_key:
            return jsonify({'success': False, 'error': 'No private key available for bootstrap (manual or managed)'}), 400

    tenant_id = current_tenant_id()
    existing = _tenant_router_query().filter_by(ip_address=endpoint_host).first()
    created = False
    reused_existing = False

    if existing:
        router = existing
        reused_existing = True
        if not update_existing:
            return jsonify({'success': False, 'error': 'Router with this IP already exists'}), 409
        router.name = name
        router.username = username
        router.password = password
        router.api_port = api_port
        router.is_active = True
        db.session.add(router)
        db.session.commit()
        try:
            from app.services.mikrotik_connection_pool import mikrotik_connection_pool
            mikrotik_connection_pool.disconnect_router(router.id)
        except Exception as _pool_exc:
            logger.warning(f"Could not evict pool for router {router.id} after credential update: {_pool_exc}")
    else:
        router = MikroTikRouter(
            name=name,
            ip_address=endpoint_host,
            username=username,
            api_port=api_port,
            is_active=True,
            tenant_id=tenant_id,
        )
        router.password = password
        db.session.add(router)
        db.session.commit()
        created = True

    readiness_payload: Dict[str, Any] = {
        'score': 0,
        'checks': [],
        'blockers': [{'id': 'api_connectivity', 'detail': 'No se pudo evaluar readiness'}],
        'recommendations': ['Validar conectividad API con el router.'],
        'runtime': {'reachable': False},
        'write_probe_enabled': run_write_probe,
    }
    bootstrap_payload: Optional[Dict[str, Any]] = None
    vps_sync_payload: Dict[str, Any] = {
        'success': False,
        'mode': None,
        'message': 'No ejecutado',
        'manual_required': False,
        'manual_command': '',
        'attempts': [],
    }
    parsed_identity = _router_wireguard_identity_from_parsed_config(parsed, router.id)

    if auto_vps_link:
        if is_bth_profile:
            try:
                sync_result = _sync_bth_profile_to_vps(parsed, router_host=endpoint_host, router_id=router.id, payload=dict(form or {}))
                vps_sync_payload = {
                    'success': bool(sync_result.get('success')),
                    'mode': sync_result.get('mode'),
                    'message': sync_result.get('message') or '',
                    'manual_required': bool(sync_result.get('manual_required')),
                    'manual_command': sync_result.get('manual_command') or '',
                    'attempts': sync_result.get('attempts') or [],
                    'runtime': sync_result.get('runtime') or {},
                }
            except Exception as sync_exc:
                vps_sync_payload = {
                    'success': False,
                    'mode': 'bth_profile',
                    'message': f'Error activando perfil BTH en VPS: {sync_exc}',
                    'manual_required': False,
                    'manual_command': '',
                    'attempts': [],
                }
        elif parsed_identity.get('success'):
            try:
                sync_result = _sync_router_peer_to_vps(
                    str(parsed_identity.get('public_key') or '').strip(),
                    str(parsed_identity.get('selected_peer_ip') or '').strip(),
                    dict(form or {}),
                )
                vps_sync_payload = {
                    'success': bool(sync_result.get('success')),
                    'mode': sync_result.get('mode'),
                    'message': sync_result.get('message') or '',
                    'manual_required': bool(sync_result.get('manual_required')),
                    'manual_command': sync_result.get('manual_command') or '',
                    'attempts': sync_result.get('attempts') or [],
                    'runtime': sync_result.get('runtime') or {},
                }
            except Exception as sync_exc:
                vps_sync_payload = {
                    'success': False,
                    'mode': 'auto',
                    'message': f'Error sincronizando peer VPS: {sync_exc}',
                    'manual_required': False,
                    'manual_command': '',
                    'attempts': [],
                }
        else:
            vps_sync_payload = {
                'success': False,
                'mode': 'skip',
                'message': str(parsed_identity.get('error') or 'No se pudo derivar identidad WG desde config'),
                'manual_required': False,
                'manual_command': '',
                'attempts': [],
            }

    try:
        with MikroTikService(router.id) as service:
            readiness_payload = _build_router_readiness_payload(service, run_write_probe=run_write_probe)

            if bootstrap_bth:
                if not service.api:
                    bootstrap_payload = {
                        'success': False,
                        'error': 'No se pudo conectar por API al router para bootstrap automatico.',
                        'user_name': bth_user_name,
                        'private_key_source': bth_key_resolution.get('source') or 'tenant_managed',
                        'managed_identity': bth_identity,
                    }
                    readiness_payload.setdefault('recommendations', []).append(
                        'Verifica conectividad API (host/IP y puerto) o desactiva bootstrap automatico para registrar primero el router.'
                    )
                else:
                    safe_name = _script_escape(bth_user_name)
                    safe_key = _script_escape(bth_private_key)
                    safe_comment = _script_escape(comment)
                    script_lines: List[str] = []
                    if ddns_enabled:
                        script_lines.append(f"/ip/cloud/set ddns-enabled=yes update-time={'yes' if update_time else 'no'}")
                    if enable_vpn:
                        script_lines.append('/ip/cloud/set back-to-home-vpn=enabled')
                    if replace_existing_user:
                        script_lines.append(f'/ip/cloud/back-to-home-users/remove [find where name="{safe_name}"]')
                    script_lines.append(
                        f'/ip/cloud/back-to-home-users/add name="{safe_name}" private-key="{safe_key}" '
                        f'allow-lan={"yes" if bth_allow_lan else "no"} comment="{safe_comment}" disabled=no'
                    )
                    script_lines.append('/ip/cloud/print')
                    script_content = '\n'.join(script_lines)

                    exec_result = service.execute_script(script_content)
                    result = exec_result if isinstance(exec_result, dict) else {'success': bool(exec_result), 'result': str(exec_result)}
                    runtime = _collect_back_to_home_runtime(service)
                    users = runtime.get('users') if isinstance(runtime.get('users'), list) else []
                    user_visible = any(str(item.get('name') or '').strip() == bth_user_name for item in users)

                    bootstrap_payload = {
                        'success': bool(result.get('success')),
                        'script': script_content,
                        'result': result,
                        'runtime': runtime,
                        'user_name': bth_user_name,
                        'user_visible_after_run': user_visible,
                        'private_key_source': bth_key_resolution.get('source') or 'tenant_managed',
                        'managed_identity': bth_identity,
                    }
    except Exception as exc:
        logger.error('Error on WireGuard onboarding for router %s: %s', router.id, exc, exc_info=True)

    payload: Dict[str, Any] = {
        'success': True,
        'created': created,
        'reused_existing': reused_existing,
        'updated_existing': bool(reused_existing and update_existing),
        'router': router.to_dict(),
        'source_file': source_file,
        'wireguard': parsed,
        'readiness': readiness_payload,
        'managed_identity': bth_identity,
        'private_key_source': bth_key_resolution.get('source') or 'tenant_managed',
        'wireguard_router_identity': parsed_identity,
        'vps_sync': vps_sync_payload,
        'onboarding_profile': onboarding_profile,
        'tenant_scope': onboarding_profile.get('tenant_scope') or {},
    }
    if bootstrap_payload is not None:
        payload['bootstrap'] = bootstrap_payload
    return jsonify(payload), 200


@mikrotik_bp.route('/routers/<router_id>/readiness', methods=['GET'])
@admin_required()
def router_readiness(router_id):
    router = _router_for_request(router_id)
    if not router:
        return jsonify({'success': False, 'error': 'Router not found'}), 404

    run_write_probe = _as_bool(request.args.get('write_probe'), default=False)
    try:
        with MikroTikService(router.id) as service:
            readiness = _build_router_readiness_payload(service, run_write_probe=run_write_probe)
        return jsonify({'success': True, 'router': router.to_dict(), 'readiness': readiness}), 200
    except Exception as exc:
        logger.error('Error calculating readiness for router %s: %s', router_id, exc, exc_info=True)
        return jsonify({'success': False, 'error': str(exc)}), 500


@mikrotik_bp.route('/routers', methods=['GET'])
@admin_required()
def get_routers():
    """Get all MikroTik routers"""
    try:
        routers = _tenant_router_query().order_by(MikroTikRouter.name.asc()).all()
        return jsonify({
            'success': True,
            'routers': [r.to_dict() for r in routers]
        }), 200
    except Exception as e:
        logger.error(f"Error getting routers: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/routers', methods=['POST'])
@admin_required()
def create_router():
    try:
        data = request.get_json() or {}
        onboarding_profile = _resolve_mikrotik_onboarding_profile()
        name = str(data.get('name') or '').strip()
        raw_ip_address = str(data.get('ip_address') or '').strip()
        ip_address, parsed_ip_port = _normalize_router_host(raw_ip_address)
        username = str(data.get('username') or onboarding_profile.get('default_username') or '').strip()
        password = str(data.get('password') or '').strip()

        if not name:
            return jsonify({'success': False, 'error': 'name is required'}), 400
        if not ip_address:
            return jsonify({'success': False, 'error': 'ip_address is required'}), 400
        if not username:
            return jsonify({'success': False, 'error': 'username is required'}), 400
        if not password:
            return jsonify({'success': False, 'error': 'password is required'}), 400

        raw_api_port = data.get('api_port')
        try:
            if raw_api_port in (None, ''):
                api_port = int(parsed_ip_port or onboarding_profile.get('default_api_port') or 8728)
            else:
                api_port = int(raw_api_port)
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'api_port must be integer'}), 400
        if api_port < 1 or api_port > 65535:
            return jsonify({'success': False, 'error': 'api_port must be between 1 and 65535'}), 400

        duplicate = _tenant_router_query().filter_by(ip_address=ip_address).first()
        if duplicate:
            return jsonify({'success': False, 'error': 'A router with this IP already exists'}), 409

        router = MikroTikRouter(
            name=name,
            ip_address=ip_address,
            username=username,
            api_port=api_port,
            is_active=_as_bool(data.get('is_active'), default=True),
            tenant_id=current_tenant_id(),
            wan_port=_to_int(data.get('wan_port'), 80),
            lan_interface=_as_clean_text(data.get('lan_interface')) or 'ether1',
            ip_ranges=_as_clean_text(data.get('ip_ranges')),
            ros_version=_as_clean_text(data.get('ros_version')) or '7',
            coordinates=_as_clean_text(data.get('coordinates')),
            comments=_as_clean_text(data.get('comments')),
            use_sstp_script=_as_bool(data.get('use_sstp_script'), default=True),
            historial_trafico=_as_bool(data.get('historial_trafico'), default=False),
            control_pppoe=_as_bool(data.get('control_pppoe'), default=False),
            control_queue=_as_bool(data.get('control_queue'), default=False),
            control_ap=_as_bool(data.get('control_ap'), default=False),
            control_dhcp=_as_bool(data.get('control_dhcp'), default=False),
            control_hotspot=_as_bool(data.get('control_hotspot'), default=False),
            traffic_flow_enabled=_as_bool(data.get('traffic_flow_enabled'), default=False),
        )
        router.password = password
        db.session.add(router)
        db.session.commit()

        test_connection = _as_bool(data.get('test_connection'), default=True)
        diagnostics = _build_router_connection_diagnostics(router) if test_connection else None
        reachable = diagnostics.get('success') if diagnostics else None
        return jsonify(
            {
                'success': True,
                'router': router.to_dict(),
                'connection_tested': test_connection,
                'reachable': reachable,
                'diagnostics': diagnostics,
                'onboarding_profile': onboarding_profile,
                'tenant_scope': onboarding_profile.get('tenant_scope') or {},
            }
        ), 201
    except Exception as exc:
        db.session.rollback()
        logger.error('Error creating router: %s', exc, exc_info=True)
        return jsonify({'success': False, 'error': str(exc)}), 500


@mikrotik_bp.route('/routers/<router_id>', methods=['GET'])
@admin_required()
def get_router(router_id):
    """Get specific router details"""
    try:
        router = _router_for_request(router_id)
        if not router:
            return jsonify({'success': False, 'error': 'Router not found'}), 404

        router_info = None
        interface_stats = None
        api_reachable = False
        try:
            with MikroTikService(router_id) as service:
                if service.api:
                    router_info = service.get_router_info()
                    interface_stats = service.get_interface_stats()
                    api_reachable = True
        except Exception as api_exc:
            logger.warning(f"Could not reach API for router {router_id}: {api_exc}")

        return jsonify({
            'success': True,
            'router': router.to_dict(),
            'info': router_info,
            'interfaces': interface_stats,
            'api_reachable': api_reachable,
        }), 200
    except Exception as e:
        logger.error(f"Error getting router {router_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/routers/<router_id>', methods=['PATCH'])
@admin_required()
def update_router(router_id):
    router = _router_for_request(router_id)
    if not router:
        return jsonify({'success': False, 'error': 'Router not found'}), 404

    data = request.get_json() or {}
    changed = []

    if 'name' in data:
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({'success': False, 'error': 'name cannot be empty'}), 400
        router.name = name
        changed.append('name')

    if 'ip_address' in data:
        raw_ip_address = str(data.get('ip_address') or '').strip()
        ip_address, _parsed_ip_port = _normalize_router_host(raw_ip_address)
        if not ip_address:
            return jsonify({'success': False, 'error': 'ip_address cannot be empty'}), 400
        duplicate = _tenant_router_query().filter(
            MikroTikRouter.ip_address == ip_address,
            MikroTikRouter.id != router.id,
        ).first()
        if duplicate:
            return jsonify({'success': False, 'error': 'A router with this IP already exists'}), 409
        router.ip_address = ip_address
        changed.append('ip_address')

    if 'username' in data:
        username = str(data.get('username') or '').strip()
        if not username:
            return jsonify({'success': False, 'error': 'username cannot be empty'}), 400
        router.username = username
        changed.append('username')

    if 'password' in data:
        password = str(data.get('password') or '').strip()
        if password:
            router.password = password
            changed.append('password')

    if 'api_port' in data:
        try:
            api_port = int(data.get('api_port'))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'api_port must be integer'}), 400
        if api_port < 1 or api_port > 65535:
            return jsonify({'success': False, 'error': 'api_port must be between 1 and 65535'}), 400
        router.api_port = api_port
        changed.append('api_port')

    if 'is_active' in data:
        router.is_active = _as_bool(data.get('is_active'), default=True)
        changed.append('is_active')

    if 'wan_port' in data:
        router.wan_port = _to_int(data.get('wan_port'), 80)
        changed.append('wan_port')

    if 'lan_interface' in data:
        router.lan_interface = _as_clean_text(data.get('lan_interface')) or 'ether1'
        changed.append('lan_interface')

    if 'ip_ranges' in data:
        router.ip_ranges = _as_clean_text(data.get('ip_ranges'))
        changed.append('ip_ranges')

    if 'ros_version' in data:
        router.ros_version = _as_clean_text(data.get('ros_version')) or '7'
        changed.append('ros_version')

    if 'coordinates' in data:
        router.coordinates = _as_clean_text(data.get('coordinates'))
        changed.append('coordinates')

    if 'comments' in data:
        router.comments = _as_clean_text(data.get('comments'))
        changed.append('comments')

    if 'use_sstp_script' in data:
        router.use_sstp_script = _as_bool(data.get('use_sstp_script'), default=True)
        changed.append('use_sstp_script')

    if 'historial_trafico' in data:
        router.historial_trafico = _as_bool(data.get('historial_trafico'), default=False)
        changed.append('historial_trafico')

    if 'control_pppoe' in data:
        router.control_pppoe = _as_bool(data.get('control_pppoe'), default=False)
        changed.append('control_pppoe')

    if 'control_queue' in data:
        router.control_queue = _as_bool(data.get('control_queue'), default=False)
        changed.append('control_queue')

    if 'control_ap' in data:
        router.control_ap = _as_bool(data.get('control_ap'), default=False)
        changed.append('control_ap')

    if 'control_dhcp' in data:
        router.control_dhcp = _as_bool(data.get('control_dhcp'), default=False)
        changed.append('control_dhcp')

    if 'control_hotspot' in data:
        router.control_hotspot = _as_bool(data.get('control_hotspot'), default=False)
        changed.append('control_hotspot')

    if 'traffic_flow_enabled' in data:
        router.traffic_flow_enabled = _as_bool(data.get('traffic_flow_enabled'), default=False)
        changed.append('traffic_flow_enabled')

    db.session.add(router)
    db.session.commit()

    if any(f in changed for f in ('ip_address', 'username', 'password', 'api_port')):
        try:
            from app.services.mikrotik_connection_pool import mikrotik_connection_pool
            mikrotik_connection_pool.disconnect_router(router.id)
        except Exception as pool_exc:
            logger.warning(f"Could not evict pool for router {router.id}: {pool_exc}")

    return jsonify({'success': True, 'router': router.to_dict(), 'updated_fields': changed}), 200


@mikrotik_bp.route('/routers/<router_id>', methods=['DELETE'])
@admin_required()
def delete_router(router_id):
    router = _router_for_request(router_id)
    if not router:
        return jsonify({'success': False, 'error': 'Router not found'}), 404

    clients_query = Client.query.filter_by(router_id=router.id)
    tenant_id = current_tenant_id()
    if tenant_id is not None:
        clients_query = clients_query.filter_by(tenant_id=tenant_id)
    linked_clients = clients_query.count()
    if linked_clients > 0:
        return jsonify(
            {
                'success': False,
                'error': 'Router has linked clients and cannot be deleted',
                'linked_clients': linked_clients,
            }
        ), 409

    router_id_int = router.id
    db.session.delete(router)
    db.session.commit()
    try:
        from app.services.mikrotik_connection_pool import mikrotik_connection_pool
        mikrotik_connection_pool.disconnect_router(router_id_int)
    except Exception as pool_exc:
        logger.warning(f"Could not evict pool for deleted router {router_id_int}: {pool_exc}")
    return jsonify({'success': True, 'deleted_id': str(router_id_int)}), 200


@mikrotik_bp.route('/onboarding/profile', methods=['GET'])
@admin_required()
def get_mikrotik_onboarding_profile():
    try:
        profile = _resolve_mikrotik_onboarding_profile()
        return jsonify({'success': True, 'profile': profile, 'tenant_scope': profile.get('tenant_scope') or {}}), 200
    except Exception as exc:
        logger.error('Error loading onboarding profile: %s', exc, exc_info=True)
        return jsonify({'success': False, 'profile': {}, 'error': str(exc)}), 500


@mikrotik_bp.route('/onboarding/profile', methods=['POST'])
@admin_required()
def update_mikrotik_onboarding_profile():
    payload = request.get_json(silent=True) or {}
    existing = _resolve_mikrotik_onboarding_profile()
    try:
        profile = _normalize_mikrotik_onboarding_profile(payload, existing=existing)
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400

    _tenant_setting_upsert(MIKROTIK_ONBOARDING_PROFILE_SETTING_KEY, profile)
    stored = _resolve_mikrotik_onboarding_profile()
    return jsonify({'success': True, 'profile': stored, 'tenant_scope': stored.get('tenant_scope') or {}}), 200


@mikrotik_bp.route('/wireguard/profile', methods=['GET'])
@admin_required()
def get_wireguard_profile():
    profile = _resolve_wireguard_profile({})
    return jsonify({'success': True, 'profile': profile}), 200


@mikrotik_bp.route('/wireguard/profile', methods=['POST'])
@admin_required()
def update_wireguard_profile():
    payload = request.get_json(silent=True) or {}
    endpoint = str(payload.get('endpoint') or '').strip()
    server_public_key = str(payload.get('server_public_key') or '').strip()
    allowed_subnets = payload.get('allowed_subnets')

    if endpoint:
        normalized_endpoint = _normalize_wireguard_endpoint(endpoint)
        endpoint_host = str(normalized_endpoint.get('host') or '').strip()
        endpoint_port = int(normalized_endpoint.get('port') or 0)
        if not endpoint_host or endpoint_port < 1 or endpoint_port > 65535:
            return jsonify({'success': False, 'error': 'endpoint must be valid host:port'}), 400
        _tenant_setting_upsert(WG_PROFILE_ENDPOINT_SETTING_KEY, normalized_endpoint['endpoint'])

    if server_public_key:
        if not _is_valid_wireguard_public_key(server_public_key):
            return jsonify({'success': False, 'error': 'server_public_key is not a valid WireGuard public key'}), 400
        _tenant_setting_upsert(WG_PROFILE_SERVER_PUBLIC_KEY_SETTING_KEY, server_public_key)

    if allowed_subnets is not None:
        normalized_subnets = _normalize_wireguard_allowed_subnets(allowed_subnets)
        if not normalized_subnets:
            return jsonify({'success': False, 'error': 'allowed_subnets cannot be empty'}), 400
        _tenant_setting_upsert(WG_PROFILE_ALLOWED_SUBNETS_SETTING_KEY, normalized_subnets)

    profile = _resolve_wireguard_profile({})
    return jsonify({'success': True, 'profile': profile}), 200


@mikrotik_bp.route('/wireguard/vps-sync-profile', methods=['GET'])
@admin_required()
def get_wireguard_vps_sync_profile():
    profile = _load_wg_vps_sync_profile()
    response_profile = _wg_vps_sync_profile_response(profile)
    return jsonify({'success': True, 'profile': response_profile}), 200


@mikrotik_bp.route('/wireguard/vps-sync-profile', methods=['POST'])
@admin_required()
def update_wireguard_vps_sync_profile():
    profile = _load_wg_vps_sync_profile()
    response_profile = _wg_vps_sync_profile_response(profile)
    return (
        jsonify(
            {
                'success': False,
                'error': (
                    'Perfil VPS Sync es gestionado por servidor. '
                    'Configura variables MIKROTIK_WG_VPS_* en el backend; no se acepta configuracion por panel.'
                ),
                'profile': response_profile,
            }
        ),
        403,
    )


@mikrotik_bp.route('/wireguard/vps-sync-profile/test', methods=['POST'])
@admin_required()
def test_wireguard_vps_sync_profile():
    runtime = _resolve_wg_sync_runtime({})
    probe = _probe_wg_vps_sync_runtime(runtime)
    return jsonify({'success': bool(probe.get('success')), 'probe': probe}), 200


@mikrotik_bp.route('/routers/<router_id>/quick-connect', methods=['GET'])
@admin_required()
def router_quick_connect(router_id):
    router = _router_for_request(router_id)
    if not router:
        return jsonify({'success': False, 'error': 'Router not found'}), 404

    onboarding_profile = _resolve_mikrotik_onboarding_profile()
    ip_scope = request.args.get('ip_scope')
    default_allowed_mgmt = str(current_app.config.get('MIKROTIK_MANAGEMENT_ALLOWED_CIDR') or 'YOUR_PUBLIC_IP/32').strip() or 'YOUR_PUBLIC_IP/32'
    allowed_mgmt = str(request.args.get('allowed_mgmt') or default_allowed_mgmt).strip() or default_allowed_mgmt
    wireguard_profile = _resolve_wireguard_profile(dict(request.args or {}))
    wg_endpoint = str(wireguard_profile.get('endpoint') or WG_PROFILE_ENDPOINT_DEFAULT).strip() or WG_PROFILE_ENDPOINT_DEFAULT
    wg_server_public_key = str(
        wireguard_profile.get('server_public_key') or WG_PROFILE_SERVER_PUBLIC_KEY_PLACEHOLDER
    ).strip() or WG_PROFILE_SERVER_PUBLIC_KEY_PLACEHOLDER
    wg_allowed_subnets = str(
        wireguard_profile.get('allowed_subnets') or WG_PROFILE_ALLOWED_SUBNETS_DEFAULT
    ).strip() or WG_PROFILE_ALLOWED_SUBNETS_DEFAULT
    requested_bth_user = str(request.args.get('bth_user') or '').strip()
    bth_user = requested_bth_user or str(onboarding_profile.get('default_bth_user_name') or 'noc-vps')
    bth_allow_lan = _as_bool(request.args.get('bth_allow_lan'), default=bool(onboarding_profile.get('default_allow_lan', True)))
    requested_bth_private_key = str(request.args.get('bth_private_key') or '').strip()
    bth_key_resolution = _resolve_bth_key_for_request(requested_bth_private_key, preferred_user_name=bth_user)
    bth_private_key = str(bth_key_resolution.get('private_key') or '').strip() or '<BASE64_WG_PRIVATE_KEY>'
    bth_identity = bth_key_resolution.get('identity') or {}
    if not requested_bth_user and isinstance(bth_identity, dict):
        bth_user = str(bth_identity.get('user_name') or bth_user).strip() or bth_user
    access_profile = _build_access_profile(router.ip_address, ip_scope)

    wg_endpoint_host = str(wireguard_profile.get('endpoint_host') or '')
    wg_endpoint_port = int(wireguard_profile.get('endpoint_port') or 51820)
    account_label = str(onboarding_profile.get('account_label') or 'Cuenta ISP').strip() or 'Cuenta ISP'
    comment_prefix = str(onboarding_profile.get('comment_prefix') or account_label).strip() or account_label

    router_peer_ip = f'10.250.{int(router.id) % 250}.2/32'
    public_reachable = bool(access_profile.get('allows_direct_inbound'))
    direct_script_title = (
        f'# Cuenta ISP: {account_label}\n# Perfil publico: habilitar acceso directo con ACL estricta.\n'
        if public_reachable
        else f'# Cuenta ISP: {account_label}\n# Perfil privado/NAT: acceso directo WAN puede no funcionar; prioriza WireGuard/BTH.\n'
    )
    wg_script_header = (
        f'# Cuenta ISP: {account_label}\n# Perfil WireGuard listo: aplica tunel FastISP.\n'
        if bool(wireguard_profile.get('ready'))
        else f'# Cuenta ISP: {account_label}\n# Perfil WireGuard incompleto: configura endpoint/public key en /api/mikrotik/wireguard/profile antes de ejecutar.\n'
    )
    scripts = {
        'direct_api_script': (
            direct_script_title
            + f"/ip service set api disabled=no port={router.api_port}\n"
            + "/ip service set ssh disabled=no port=22\n"
            + f"/ip firewall address-list add list=fastisp-management address={allowed_mgmt} comment=\"{_script_escape(account_label)} NOC\"\n"
            + f"/ip firewall filter add chain=input action=accept protocol=tcp dst-port={router.api_port},22 src-address-list=fastisp-management comment=\"{_script_escape(account_label)} remote access\"\n"
            + "/ip firewall filter add chain=input action=drop protocol=tcp dst-port=22,8728,8729 in-interface-list=WAN comment=\"Drop unmanaged remote\"\n"
        ),
        'wireguard_site_to_vps_script': (
            wg_script_header
            + ':local wgName "wg-fastisp"\n'
            + f':local wgAddress "{router_peer_ip}"\n'
            + f':local wgServerKey "{wg_server_public_key}"\n'
            + f':local wgEndpoint "{wg_endpoint_host}"\n'
            + f':local wgPort "{wg_endpoint_port}"\n'
            + f':local wgAllowed "{wg_allowed_subnets}"\n'
            + ':if ([:len $wgServerKey] = 0 || [:find $wgServerKey "<"] != nil) do={:error "WG server public key no configurada en FASTISP"}\n'
            + ':if ([:len [/interface/wireguard/find where name=$wgName]] = 0) do={/interface/wireguard/add name=$wgName listen-port=13231 comment="FastISP NOC tunnel"}\n'
            + ':if ([:len [/ip/address/find where interface=$wgName and address=$wgAddress]] = 0) do={/ip/address/add address=$wgAddress interface=$wgName comment="FastISP tunnel"}\n'
            + '/interface/wireguard/peers/remove [find where interface=$wgName and comment="FastISP NOC peer"]\n'
            + '/interface/wireguard/peers/add interface=$wgName public-key=$wgServerKey endpoint-address=$wgEndpoint endpoint-port=$wgPort allowed-address=$wgAllowed persistent-keepalive=25s comment="FastISP NOC peer"\n'
            + ':if ([:len [/ip/firewall/filter/find where chain="input" action="accept" protocol="udp" dst-port="13231" comment="Allow WireGuard"]] = 0) do={/ip/firewall/filter/add chain=input action=accept protocol=udp dst-port=13231 comment="Allow WireGuard"}\n'
        ),
        'windows_login': (
            f"ssh {router.username}@{router.ip_address} -p 22"
            if public_reachable
            else f"# Requiere tunel: ssh {router.username}@{router.ip_address} -p 22 (via WG/BTH)"
        ),
        'linux_login': (
            f"ssh {router.username}@{router.ip_address} -p 22"
            if public_reachable
            else f"# Requiere tunel: ssh {router.username}@{router.ip_address} -p 22 (via WG/BTH)"
        ),
        'windows_tunnel_login': (
            f"ssh -J {str(current_app.config.get('VPS_PUBLIC_SSH_USER') or 'noc')}@{str(current_app.config.get('VPS_PUBLIC_HOST') or 'YOUR_VPS_HOST')}:{int(current_app.config.get('VPS_PUBLIC_SSH_PORT') or 22)} {router.username}@{router.ip_address} -p 22"
            if not public_reachable
            else ''
        ),
        'linux_tunnel_login': (
            f"ssh -J {str(current_app.config.get('VPS_PUBLIC_SSH_USER') or 'noc')}@{str(current_app.config.get('VPS_PUBLIC_HOST') or 'YOUR_VPS_HOST')}:{int(current_app.config.get('VPS_PUBLIC_SSH_PORT') or 22)} {router.username}@{router.ip_address} -p 22"
            if not public_reachable
            else ''
        ),
        'bth_enable_minimal_script': (
            '/ip/cloud/set ddns-enabled=yes update-time=yes\n'
            '/ip/cloud/set back-to-home-vpn=enabled\n'
            '/ip/cloud/print\n'
        ),
    }

    back_to_home = {
        'reachable': False,
        'routeros_version': None,
        'supported': None,
        'bth_users_supported': None,
        'ddns_enabled': None,
        'back_to_home_vpn': None,
        'vpn_status': None,
        'vpn_dns_name': None,
        'vpn_interface': None,
        'vpn_port': None,
        'users': [],
        'scripts': {
            'enable_script': (
                '/ip/cloud/set ddns-enabled=yes update-time=yes\n'
                '/ip/cloud/set back-to-home-vpn=enabled\n'
                '/ip/cloud/print\n'
            ),
            'add_vps_user_script': (
                f'/ip/cloud/back-to-home-users/add name="{bth_user}" private-key="{bth_private_key}" '
                f'allow-lan={"yes" if bth_allow_lan else "no"} comment="{_script_escape(comment_prefix)} | FastISP VPS" disabled=no\n'
                f'/interface/wireguard/peers/show-client-config {bth_user}\n'
            ),
            'generate_private_key_hint': 'wg genkey | base64 -w0',
        },
        'managed_identity': {
            **(bth_identity if isinstance(bth_identity, dict) else {}),
            'key_source': bth_key_resolution.get('source') or 'tenant_managed',
            'user_name': bth_user,
        },
        'limitations': [
            'Back To Home por relay puede tener mas latencia que un túnel WireGuard sitio-a-sitio.',
            'Para administracion masiva de routers desde VPS, WireGuard dedicado sigue siendo recomendado.',
        ],
    }

    try:
        with MikroTikService(router.id) as service:
            if service.api:
                back_to_home['reachable'] = True
                router_info = service.get_router_info() or {}
                version_text = (
                    _pick_value(router_info, 'firmware', 'version', 'routeros_version')
                    or _pick_value(router_info, 'routeros-version', 'routeros_version')
                    or ''
                )
                version_tuple = _parse_routeros_version(version_text)
                supports_bth = _version_supports_back_to_home(version_tuple)
                supports_bth_users = _version_supports_bth_users(version_tuple)
                back_to_home['routeros_version'] = str(version_text or '') or None
                back_to_home['supported'] = supports_bth
                back_to_home['bth_users_supported'] = supports_bth_users

                cloud_rows = service.api.get_resource('/ip/cloud').get()
                cloud_info = cloud_rows[0] if isinstance(cloud_rows, list) and cloud_rows else {}
                back_to_home['ddns_enabled'] = _as_bool(_pick_value(cloud_info, 'ddns-enabled', 'ddns_enabled'), default=False)
                back_to_home['back_to_home_vpn'] = str(
                    _pick_value(cloud_info, 'back-to-home-vpn', 'back_to_home_vpn') or ''
                ).strip() or None
                back_to_home['vpn_status'] = str(
                    _pick_value(cloud_info, 'back-to-home-vpn-status', 'back_to_home_vpn_status') or ''
                ).strip() or None
                back_to_home['vpn_dns_name'] = str(
                    _pick_value(cloud_info, 'dns-name', 'dns_name', 'back-to-home-dns-name', 'back_to_home_dns_name') or ''
                ).strip() or None
                back_to_home['vpn_interface'] = str(
                    _pick_value(cloud_info, 'back-to-home-interface', 'back_to_home_interface') or ''
                ).strip() or None
                back_to_home['vpn_port'] = str(
                    _pick_value(cloud_info, 'back-to-home-vpn-port', 'back_to_home_vpn_port') or ''
                ).strip() or None

                if supports_bth_users:
                    try:
                        users_api = service.api.get_resource('/ip/cloud/back-to-home-users')
                        raw_users = users_api.get()
                        normalized_users = []
                        for item in (raw_users or [])[:30]:
                            normalized_users.append(
                                {
                                    'name': str(_pick_value(item, 'name') or ''),
                                    'allow_lan': _as_bool(_pick_value(item, 'allow-lan', 'allow_lan'), default=False),
                                    'disabled': _as_bool(_pick_value(item, 'disabled'), default=False),
                                    'expires': str(_pick_value(item, 'expires') or ''),
                                }
                            )
                        back_to_home['users'] = normalized_users
                    except Exception as users_exc:
                        back_to_home['users_error'] = str(users_exc)
                else:
                    back_to_home['scripts']['add_vps_user_script'] = (
                        '# RouterOS < 7.14: crea el peer Back To Home desde la app MikroTik\n'
                        '# e importa el perfil WireGuard en tu VPS para acceso remoto.\n'
                    )
    except Exception as exc:
        back_to_home['error'] = str(exc)

    if public_reachable:
        guidance_back_to_home = [
            'IP publica detectada: puedes operar por SSH/API directo con ACL estricta.',
            'Mantener WireGuard/BTH como contingencia si el proveedor cambia a CGNAT.',
            'No abrir API/SSH a internet completa; restringe por IP de NOC.',
        ]
    else:
        guidance_back_to_home = [
            'IP privada/NAT detectada: priorizar WireGuard site-to-site o Back To Home.',
            'Back To Home funciona detras de NAT por relay MikroTik.',
            'Para NOC masivo y menor latencia, preferir WireGuard dedicado cuando sea posible.',
        ]

    guidance = {
        'back_to_home': guidance_back_to_home,
        'notes': [
            str(access_profile.get('reason') or ''),
            'No expongas API/SSH sin ACL. Usa solo IPs de gestion o VPN privada.',
            'Registra cada cambio en auditoria antes de activar modo live.',
        ],
    }
    profile_issues = wireguard_profile.get('issues') if isinstance(wireguard_profile.get('issues'), list) else []
    for issue in profile_issues:
        guidance['notes'].append(f'WireGuard profile: {issue}')
    connection_plan = _build_connection_plan(access_profile, back_to_home)
    return jsonify(
        {
            'success': True,
            'router': router.to_dict(),
            'access_profile': access_profile,
            'connection_plan': connection_plan,
            'wireguard_profile': wireguard_profile,
            'onboarding_profile': onboarding_profile,
            'tenant_scope': onboarding_profile.get('tenant_scope') or {},
            'scripts': scripts,
            'guidance': guidance,
            'back_to_home': back_to_home,
        }
    ), 200


@mikrotik_bp.route('/routers/<router_id>/wireguard/register-peer', methods=['POST'])
@admin_required()
def register_router_wireguard_peer(router_id):
    router = _router_for_request(router_id)
    if not router:
        return jsonify({'success': False, 'error': 'Router not found'}), 404

    guard_error = _live_guard(require_preflight=True, required_default=True)
    if guard_error:
        return guard_error

    data = request.get_json(silent=True) or {}
    router_interface = str(data.get('router_interface') or data.get('router_wg_interface') or 'wg-fastisp').strip() or 'wg-fastisp'
    requested_allowed_ip = _normalize_wg_allowed_ip(data.get('allowed_ip') or data.get('allowed_ips') or data.get('peer_ip'))
    fallback_allowed_ip = _safe_router_wireguard_allowed_ip(router.id)

    try:
        with MikroTikService(router.id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router API'}), 502
            router_identity = _collect_router_wireguard_identity(service, interface_name=router_interface)
    except Exception as exc:
        return jsonify({'success': False, 'error': f'Error reading router WireGuard identity: {exc}'}), 500

    if not router_identity.get('success'):
        return jsonify({'success': False, 'error': router_identity.get('error') or 'WireGuard interface not ready'}), 400

    peer_public_key = str(router_identity.get('public_key') or '').strip()
    if not _is_valid_wireguard_public_key(peer_public_key):
        return jsonify({'success': False, 'error': 'Router WireGuard public key is invalid'}), 400

    router_peer_ip = str(router_identity.get('selected_peer_ip') or '').strip()
    allowed_ip = requested_allowed_ip or router_peer_ip or fallback_allowed_ip
    allowed_ip = _normalize_wg_allowed_ip(allowed_ip)
    if not allowed_ip:
        return jsonify({'success': False, 'error': 'No valid allowed_ip available for peer registration'}), 400

    sync_result = _sync_router_peer_to_vps(peer_public_key, allowed_ip, data)
    payload = {
        'success': bool(sync_result.get('success')),
        'router': router.to_dict(),
        'router_wireguard': {
            'interface': router_identity.get('interface_name') or router_interface,
            'public_key': peer_public_key,
            'addresses': router_identity.get('addresses') or [],
            'selected_allowed_ip': allowed_ip,
        },
        'vps_sync': {
            'success': bool(sync_result.get('success')),
            'mode': sync_result.get('mode'),
            'message': sync_result.get('message'),
            'manual_required': bool(sync_result.get('manual_required')),
            'manual_command': sync_result.get('manual_command') or '',
            'runtime': sync_result.get('runtime') or {},
            'attempts': sync_result.get('attempts') or [],
        },
    }
    return jsonify(payload), 200 if sync_result.get('success') else 502


def _script_escape(value: Any) -> str:
    token = str(value or '')
    return token.replace('\\', '\\\\').replace('"', '\\"')


def _execute_router_script(router: MikroTikRouter, script_content: str) -> Dict[str, Any]:
    with MikroTikService(router.id) as service:
        if not service.api:
            return {'success': False, 'error': 'Could not connect to router'}
        result = service.execute_script(script_content)
    if isinstance(result, dict):
        return result
    return {'success': bool(result), 'result': str(result)}


def _collect_back_to_home_runtime(service: MikroTikService) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        'reachable': False,
        'routeros_version': None,
        'supported': None,
        'bth_users_supported': None,
        'ddns_enabled': None,
        'back_to_home_vpn': None,
        'vpn_status': None,
        'vpn_dns_name': None,
        'vpn_interface': None,
        'vpn_port': None,
        'users': [],
    }

    api_obj = getattr(service, 'api', None)
    if not api_obj:
        return payload

    payload['reachable'] = True

    version_tuple = (0, 0, 0)
    try:
        router_info = service.get_router_info() or {}
        version_text = (
            _pick_value(router_info, 'firmware', 'version', 'routeros_version')
            or _pick_value(router_info, 'routeros-version', 'routeros_version')
            or ''
        )
        version_tuple = _parse_routeros_version(version_text)
        payload['routeros_version'] = str(version_text or '') or None
        payload['supported'] = _version_supports_back_to_home(version_tuple)
        payload['bth_users_supported'] = _version_supports_bth_users(version_tuple)
    except Exception as version_exc:
        payload['version_error'] = str(version_exc)

    try:
        cloud_rows = api_obj.get_resource('/ip/cloud').get()
        cloud_info = cloud_rows[0] if isinstance(cloud_rows, list) and cloud_rows else {}
        payload['ddns_enabled'] = _as_bool(_pick_value(cloud_info, 'ddns-enabled', 'ddns_enabled'), default=False)
        payload['back_to_home_vpn'] = str(
            _pick_value(cloud_info, 'back-to-home-vpn', 'back_to_home_vpn') or ''
        ).strip() or None
        payload['vpn_status'] = str(
            _pick_value(cloud_info, 'back-to-home-vpn-status', 'back_to_home_vpn_status') or ''
        ).strip() or None
        payload['vpn_dns_name'] = str(
            _pick_value(cloud_info, 'dns-name', 'dns_name', 'back-to-home-dns-name', 'back_to_home_dns_name') or ''
        ).strip() or None
        payload['vpn_interface'] = str(
            _pick_value(cloud_info, 'back-to-home-interface', 'back_to_home_interface') or ''
        ).strip() or None
        payload['vpn_port'] = str(
            _pick_value(cloud_info, 'back-to-home-vpn-port', 'back_to_home_vpn_port') or ''
        ).strip() or None
    except Exception as cloud_exc:
        payload['cloud_error'] = str(cloud_exc)

    supports_users = payload.get('bth_users_supported')
    if supports_users is False:
        return payload

    try:
        users_api = api_obj.get_resource('/ip/cloud/back-to-home-users')
        raw_users = users_api.get()
        normalized_users = []
        for item in (raw_users or [])[:30]:
            normalized_users.append(
                {
                    'name': str(_pick_value(item, 'name') or ''),
                    'allow_lan': _as_bool(_pick_value(item, 'allow-lan', 'allow_lan'), default=False),
                    'disabled': _as_bool(_pick_value(item, 'disabled'), default=False),
                    'expires': str(_pick_value(item, 'expires') or ''),
                }
            )
        payload['users'] = normalized_users
        if supports_users is None and version_tuple >= (7, 14, 0):
            payload['bth_users_supported'] = True
    except Exception as users_exc:
        payload['users_error'] = str(users_exc)

    return payload


@mikrotik_bp.route('/routers/<router_id>/back-to-home/enable', methods=['POST'])
@admin_required()
def enable_back_to_home(router_id):
    router = _router_for_request(router_id)
    if not router:
        return jsonify({'success': False, 'error': 'Router not found'}), 404

    guard_error = _live_guard(require_preflight=True, required_default=True)
    if guard_error:
        return guard_error

    data = request.get_json() or {}
    if not _as_bool(data.get('confirm'), default=False):
        return jsonify({'success': False, 'error': 'confirm=true is required'}), 400

    update_time = _as_bool(data.get('update_time'), default=True)
    ddns_enabled = _as_bool(data.get('ddns_enabled'), default=True)
    enable_vpn = _as_bool(data.get('enable_vpn'), default=True)

    commands = []
    if ddns_enabled:
        commands.append(f"/ip/cloud/set ddns-enabled=yes update-time={'yes' if update_time else 'no'}")
    if enable_vpn:
        commands.append("/ip/cloud/set back-to-home-vpn=enabled")
    commands.append("/ip/cloud/print")
    script_content = '\n'.join(commands)

    try:
        result = _execute_router_script(router, script_content)
        status_code = 200 if result.get('success') else 502
        return jsonify(
            {
                'success': bool(result.get('success')),
                'router': router.to_dict(),
                'script': script_content,
                'result': result,
            }
        ), status_code
    except Exception as exc:
        logger.error("Error enabling Back To Home for router %s: %s", router_id, exc, exc_info=True)
        return jsonify({'success': False, 'error': str(exc)}), 500


@mikrotik_bp.route('/routers/<router_id>/back-to-home/users/add', methods=['POST'])
@admin_required()
def add_back_to_home_user(router_id):
    router = _router_for_request(router_id)
    if not router:
        return jsonify({'success': False, 'error': 'Router not found'}), 404

    guard_error = _live_guard(require_preflight=True, required_default=True)
    if guard_error:
        return guard_error

    data = request.get_json() or {}
    if not _as_bool(data.get('confirm'), default=False):
        return jsonify({'success': False, 'error': 'confirm=true is required'}), 400

    user_name = str(data.get('user_name') or data.get('name') or '').strip() or 'noc-vps'
    key_resolution = _resolve_bth_key_for_request(str(data.get('private_key') or ''), preferred_user_name=user_name)
    private_key = str(key_resolution.get('private_key') or '').strip()
    if not private_key:
        return jsonify({'success': False, 'error': 'No private key available (manual or managed)'}), 400

    allow_lan = _as_bool(data.get('allow_lan'), default=True)
    comment = str(data.get('comment') or 'FastISP VPS').strip() or 'FastISP VPS'

    safe_name = _script_escape(user_name)
    safe_key = _script_escape(private_key)
    safe_comment = _script_escape(comment)
    script_content = (
        f'/ip/cloud/back-to-home-users/add name="{safe_name}" private-key="{safe_key}" '
        f'allow-lan={"yes" if allow_lan else "no"} comment="{safe_comment}" disabled=no'
    )

    try:
        result = _execute_router_script(router, script_content)
        status_code = 200 if result.get('success') else 502
        return jsonify(
            {
                'success': bool(result.get('success')),
                'router': router.to_dict(),
                'user_name': user_name,
                'allow_lan': allow_lan,
                'private_key_source': key_resolution.get('source') or 'tenant_managed',
                'managed_identity': key_resolution.get('identity') or {},
                'script': script_content,
                'result': result,
            }
        ), status_code
    except Exception as exc:
        logger.error("Error adding Back To Home user for router %s: %s", router_id, exc, exc_info=True)
        return jsonify({'success': False, 'error': str(exc)}), 500


@mikrotik_bp.route('/routers/<router_id>/back-to-home/users/remove', methods=['POST'])
@admin_required()
def remove_back_to_home_user(router_id):
    router = _router_for_request(router_id)
    if not router:
        return jsonify({'success': False, 'error': 'Router not found'}), 404

    guard_error = _live_guard(require_preflight=True, required_default=True)
    if guard_error:
        return guard_error

    data = request.get_json() or {}
    if not _as_bool(data.get('confirm'), default=False):
        return jsonify({'success': False, 'error': 'confirm=true is required'}), 400

    user_name = str(data.get('user_name') or data.get('name') or '').strip()
    if not user_name:
        return jsonify({'success': False, 'error': 'user_name is required'}), 400

    safe_name = _script_escape(user_name)
    script_content = f'/ip/cloud/back-to-home-users/remove [find where name="{safe_name}"]'
    try:
        result = _execute_router_script(router, script_content)
        status_code = 200 if result.get('success') else 502
        return jsonify(
            {
                'success': bool(result.get('success')),
                'router': router.to_dict(),
                'user_name': user_name,
                'script': script_content,
                'result': result,
            }
        ), status_code
    except Exception as exc:
        logger.error("Error removing Back To Home user for router %s: %s", router_id, exc, exc_info=True)
        return jsonify({'success': False, 'error': str(exc)}), 500


@mikrotik_bp.route('/routers/<router_id>/back-to-home/bootstrap', methods=['POST'])
@admin_required()
def bootstrap_back_to_home(router_id):
    router = _router_for_request(router_id)
    if not router:
        return jsonify({'success': False, 'error': 'Router not found'}), 404

    guard_error = _live_guard(require_preflight=True, required_default=True)
    if guard_error:
        return guard_error

    data = request.get_json() or {}
    if not _as_bool(data.get('confirm'), default=False):
        return jsonify({'success': False, 'error': 'confirm=true is required'}), 400

    user_name = str(data.get('user_name') or data.get('name') or '').strip() or 'noc-vps'
    key_resolution = _resolve_bth_key_for_request(str(data.get('private_key') or ''), preferred_user_name=user_name)
    private_key = str(key_resolution.get('private_key') or '').strip()
    if not private_key:
        return jsonify({'success': False, 'error': 'No private key available (manual or managed)'}), 400

    allow_lan = _as_bool(data.get('allow_lan'), default=True)
    replace_existing_user = _as_bool(data.get('replace_existing_user'), default=False)
    update_time = _as_bool(data.get('update_time'), default=True)
    ddns_enabled = _as_bool(data.get('ddns_enabled'), default=True)
    enable_vpn = _as_bool(data.get('enable_vpn'), default=True)
    fast_link_vps = _as_bool(data.get('fast_link_vps'), default=True)
    comment = str(data.get('comment') or 'FastISP VPS').strip() or 'FastISP VPS'

    safe_name = _script_escape(user_name)
    safe_key = _script_escape(private_key)
    safe_comment = _script_escape(comment)

    script_lines: List[str] = []
    if ddns_enabled:
        script_lines.append(f"/ip/cloud/set ddns-enabled=yes update-time={'yes' if update_time else 'no'}")
    if enable_vpn:
        script_lines.append("/ip/cloud/set back-to-home-vpn=enabled")
    if replace_existing_user:
        script_lines.append(f'/ip/cloud/back-to-home-users/remove [find where name="{safe_name}"]')
    script_lines.append(
        f'/ip/cloud/back-to-home-users/add name="{safe_name}" private-key="{safe_key}" '
        f'allow-lan={"yes" if allow_lan else "no"} comment="{safe_comment}" disabled=no'
    )
    script_lines.append('/ip/cloud/print')
    script_content = '\n'.join(script_lines)

    vps_sync: Dict[str, Any] = {
        'success': False,
        'mode': None,
        'message': 'No ejecutado',
        'manual_required': False,
        'manual_command': '',
        'attempts': [],
    }

    try:
        with MikroTikService(router.id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 502

            exec_result = service.execute_script(script_content)
            result = exec_result if isinstance(exec_result, dict) else {'success': bool(exec_result), 'result': str(exec_result)}
            observed = _collect_back_to_home_runtime(service)

            if bool(result.get('success')) and fast_link_vps:
                try:
                    router_identity = _collect_router_wireguard_identity(service, interface_name='wg-fastisp')
                    if bool(router_identity.get('success')):
                        peer_public_key = str(router_identity.get('public_key') or '').strip()
                        selected_ip = _normalize_wg_allowed_ip(
                            router_identity.get('selected_peer_ip') or _safe_router_wireguard_allowed_ip(router.id)
                        )
                        if _is_valid_wireguard_public_key(peer_public_key) and selected_ip:
                            sync_result = _sync_router_peer_to_vps(peer_public_key, selected_ip, data)
                            vps_sync = {
                                'success': bool(sync_result.get('success')),
                                'mode': sync_result.get('mode'),
                                'message': sync_result.get('message'),
                                'manual_required': bool(sync_result.get('manual_required')),
                                'manual_command': sync_result.get('manual_command') or '',
                                'attempts': sync_result.get('attempts') or [],
                            }
                        else:
                            vps_sync = {
                                'success': False,
                                'mode': 'skip',
                                'message': 'No se pudo derivar public key o IP de tunel para sync VPS.',
                                'manual_required': False,
                                'manual_command': '',
                                'attempts': [],
                            }
                    else:
                        vps_sync = {
                            'success': False,
                            'mode': 'skip',
                            'message': str(router_identity.get('error') or 'Interfaz wg-fastisp no lista para sync VPS'),
                            'manual_required': False,
                            'manual_command': '',
                            'attempts': [],
                        }
                except Exception as sync_exc:
                    vps_sync = {
                        'success': False,
                        'mode': 'auto',
                        'message': f'Error sincronizando peer VPS: {sync_exc}',
                        'manual_required': False,
                        'manual_command': '',
                        'attempts': [],
                    }
    except Exception as exc:
        logger.error("Error executing Back To Home bootstrap for router %s: %s", router_id, exc, exc_info=True)
        return jsonify({'success': False, 'error': str(exc)}), 500

    users = observed.get('users') if isinstance(observed.get('users'), list) else []
    user_exists = any(str(item.get('name') or '').strip() == user_name for item in users)

    missing: List[str] = []
    if observed.get('supported') is False:
        missing.append('RouterOS version does not confirm Back To Home support (requires 7.12+).')
    if observed.get('bth_users_supported') is False:
        missing.append('RouterOS version does not expose BTH users API (requires 7.14+).')
    if observed.get('ddns_enabled') is False:
        missing.append('DDNS is not enabled on /ip cloud.')
    if not observed.get('vpn_dns_name'):
        missing.append('Router did not return Back To Home DNS name yet.')
    if observed.get('bth_users_supported') is True and not user_exists:
        missing.append(f'Back To Home user "{user_name}" was not visible after bootstrap.')

    vpn_status_text = str(observed.get('vpn_status') or '').strip().lower()
    vpn_running = not vpn_status_text or 'running' in vpn_status_text or 'connected' in vpn_status_text
    bth_ok = (
        bool(result.get('success'))
        and observed.get('ddns_enabled') is not False
        and bool(observed.get('vpn_dns_name'))
        and vpn_running
    )
    if observed.get('bth_users_supported') is True:
        bth_ok = bth_ok and user_exists

    state = 'operational' if bth_ok else 'partial'
    summary_message = (
        'Back To Home operativo y vinculado.'
        if bth_ok
        else 'Bootstrap aplicado, pero faltan validaciones para quedar operativo.'
    )

    next_steps = [
        f'/interface/wireguard/peers/show-client-config {user_name}',
        'Validar trafico por BTH desde NOC antes de acciones live.',
    ]
    if not vps_sync.get('success') and str(vps_sync.get('manual_command') or '').strip():
        next_steps.append(f'Ejecuta comando VPS manual: {vps_sync.get("manual_command")}')
    elif vps_sync.get('success'):
        next_steps.append('Peer WireGuard de VPS sincronizado automaticamente.')
    if observed.get('vpn_dns_name'):
        next_steps.append(
            f'Use DNS "{observed.get("vpn_dns_name")}" for operational inventory and runbook references.'
        )

    ok = bool(result.get('success'))
    status_code = 200 if ok else 502
    return jsonify(
        {
            'success': ok,
            'router': router.to_dict(),
            'script': script_content,
            'result': result,
            'back_to_home': observed,
            'private_key_source': key_resolution.get('source') or 'tenant_managed',
            'managed_identity': key_resolution.get('identity') or {},
            'vps_sync': vps_sync,
            'bootstrap': {
                'user_name': user_name,
                'allow_lan': allow_lan,
                'user_visible_after_run': user_exists,
                'operational': bth_ok,
                'state': state,
                'message': summary_message,
                'missing': missing,
                'next_steps': next_steps,
            },
        }
    ), status_code

@mikrotik_bp.route('/validate-config', methods=['POST'])
@admin_required()
def validate_config():
    """Validate client and plan configuration prior to provisioning"""
    try:
        data = request.get_json()
        client_id = data.get('client_id')
        router_id = data.get('router_id')
        plan_id = data.get('plan_id')
        issues = []

        client = db.session.get(Client, client_id) if client_id else None
        router = db.session.get(MikroTikRouter, router_id) if router_id else None
        plan = db.session.get(Plan, plan_id) if plan_id else (client.plan if client else None)

        if not client:
            issues.append('Client not found')
        if not router:
            issues.append('Router not found')
        if not plan:
            issues.append('Plan not found')

        if client and client.connection_type not in ['dhcp', 'pppoe', 'static']:
            issues.append('Invalid connection type')
        if client and client.connection_type in ['dhcp', 'static'] and not client.ip_address:
            issues.append('Missing client IP address for DHCP/Static')
        if client and client.connection_type == 'pppoe' and not (client.pppoe_username and client.pppoe_password):
            issues.append('Missing PPPoE credentials')

        ok = len(issues) == 0
        return jsonify({'success': ok, 'issues': issues}), (200 if ok else 400)
    except Exception as e:
        logger.error(f"Error validating config: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/provision', methods=['POST'])
@admin_required()
def provision_client():
    """Provision a new client on MikroTik"""
    try:
        data = request.get_json()
        client_id = data.get('client_id')
        router_id = data.get('router_id')
        
        if not client_id or not router_id:
            return jsonify({'success': False, 'error': 'Missing client_id or router_id'}), 400
        
        client = db.session.get(Client, client_id)
        router = db.session.get(MikroTikRouter, router_id)
        
        if not client:
            return jsonify({'success': False, 'error': 'Client not found'}), 404
        if not router:
            return jsonify({'success': False, 'error': 'Router not found'}), 404
        
        with MikroTikService(router_id) as service:
            results = service.provision_client(client, client.plan, data.get('config', {}))
        
        if results.get('success'):
            client.status = 'active'
            db.session.commit()
        
        return jsonify(results), (200 if results.get('success') else 500)
    except Exception as e:
        logger.error(f"Error provisioning client: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/clients/<client_id>/suspend', methods=['POST'])
@admin_required()
def suspend_client(client_id):
    """Suspend client access"""
    try:
        data = request.get_json()
        reason = data.get('reason', 'non-payment')
        
        client = db.session.get(Client, client_id)
        if not client:
            return jsonify({'success': False, 'error': 'Client not found'}), 404
        
        if not client.router_id:
            return jsonify({'success': False, 'error': 'Client does not have an associated router'}), 400

        router = db.session.get(MikroTikRouter, client.router_id)
        if not router or not router.is_active:
            return jsonify({'success': False, 'error': 'No active router found for this client'}), 404
        
        with MikroTikService(router.id) as service:
            success = service.suspend_client(client, reason)
        
        if success:
            client.status = 'suspended'
            db.session.commit()
            return jsonify({'success': True, 'message': f'Client suspended: {reason}'}), 200
        else:
            return jsonify({'success': False, 'error': 'Failed to suspend client'}), 500
    except Exception as e:
        logger.error(f"Error suspending client: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/clients/<client_id>/activate', methods=['POST'])
@admin_required()
def activate_client(client_id):
    """Activate suspended client"""
    try:
        client = db.session.get(Client, client_id)
        if not client:
            return jsonify({'success': False, 'error': 'Client not found'}), 404
        
        if not client.router_id:
            return jsonify({'success': False, 'error': 'Client does not have an associated router'}), 400

        router = db.session.get(MikroTikRouter, client.router_id)
        if not router or not router.is_active:
            return jsonify({'success': False, 'error': 'No active router found for this client'}), 404
        
        with MikroTikService(router.id) as service:
            success = service.activate_client(client)
        
        if success:
            client.status = 'active'
            db.session.commit()
            return jsonify({'success': True, 'message': 'Client activated'}), 200
        else:
            return jsonify({'success': False, 'error': 'Failed to activate client'}), 500
    except Exception as e:
        logger.error(f"Error activating client: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/clients/<client_id>/update-speed', methods=['POST'])
@admin_required()
def update_client_speed(client_id):
    """Update client speed/plan"""
    try:
        data = request.get_json()
        plan_id = data.get('plan_id')
        
        client = db.session.get(Client, client_id)
        if not client:
            return jsonify({'success': False, 'error': 'Client not found'}), 404
        
        new_plan = db.session.get(Plan, plan_id)
        if not new_plan:
            return jsonify({'success': False, 'error': 'Plan not found'}), 404
        
        if not client.router_id:
            return jsonify({'success': False, 'error': 'Client does not have an associated router'}), 400

        router = db.session.get(MikroTikRouter, client.router_id)
        if not router or not router.is_active:
            return jsonify({'success': False, 'error': 'No active router found for this client'}), 404
        
        with MikroTikService(router.id) as service:
            success = service.update_client_speed(client, new_plan)
        
        if success:
            client.plan_id = plan_id
            db.session.commit()
            return jsonify({'success': True, 'message': f'Speed updated to {new_plan.name}'}), 200
        else:
            return jsonify({'success': False, 'error': 'Failed to update speed'}), 500
    except Exception as e:
        logger.error(f"Error updating client speed: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/health', methods=['GET'])
@admin_required()
def get_router_health(router_id):
    """Get router health status"""
    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            health = service.get_system_health()
        return jsonify({'success': True, 'health': health}), 200
    except Exception as e:
        logger.error(f"Error getting router health: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/queues', methods=['GET'])
@admin_required()
def get_router_queues(router_id):
    """Get router queue statistics"""
    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            queues = service.get_queue_stats()
        return jsonify({'success': True, 'queues': queues}), 200
    except Exception as e:
        logger.error(f"Error getting router queues: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/routers/<router_id>/queues/toggle', methods=['POST'])
@admin_required()
def toggle_router_queue(router_id):
    data = request.get_json() or {}
    queue_id = str(data.get('id') or '').strip()
    disable = _as_bool(data.get('disable'), default=False)
    if not queue_id:
        return jsonify({'success': False, 'error': 'Queue id is required'}), 400

    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            success = service.toggle_queue_status(queue_id, disable)
        if not success:
            return jsonify({'success': False, 'error': 'Queue not found or update failed'}), 404
        return jsonify({'success': True, 'queue_id': queue_id, 'disabled': disable}), 200
    except Exception as e:
        logger.error(f"Error toggling queue status: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/routers/<router_id>/queues/update-limit', methods=['PUT'])
@admin_required()
def update_router_queue_limit(router_id):
    data = request.get_json() or {}
    queue_id = str(data.get('id') or '').strip()
    download = str(data.get('download') or '').strip()
    upload = str(data.get('upload') or '').strip()
    if not queue_id or not download or not upload:
        return jsonify({'success': False, 'error': 'id, download and upload are required'}), 400

    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            success = service.update_queue_limit(queue_id, download, upload)
        if not success:
            return jsonify({'success': False, 'error': 'Queue not found or update failed'}), 404
        return jsonify({'success': True, 'queue_id': queue_id, 'max_limit': f'{upload}M/{download}M'}), 200
    except Exception as e:
        logger.error(f"Error updating queue limit: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/routers/<router_id>/queues/update-comment', methods=['PUT'])
@admin_required()
def update_router_queue_comment(router_id):
    data = request.get_json() or {}
    queue_id = str(data.get('id') or '').strip()
    comment = '' if data.get('comment') is None else str(data.get('comment'))
    if not queue_id:
        return jsonify({'success': False, 'error': 'Queue id is required'}), 400

    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            success = service.update_queue_comment(queue_id, comment)
        if not success:
            return jsonify({'success': False, 'error': 'Queue not found or update failed'}), 404
        return jsonify({'success': True, 'queue_id': queue_id, 'comment': comment}), 200
    except Exception as e:
        logger.error(f"Error updating queue comment: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/routers/<router_id>/queues', methods=['POST'])
@admin_required()
def create_router_queue(router_id):
    data = request.get_json() or {}
    name = str(data.get('name') or '').strip()
    target = str(data.get('target') or '').strip()
    download = str(data.get('download') or '').strip()
    upload = str(data.get('upload') or '').strip()
    if not name or not target or not download or not upload:
        return jsonify({'success': False, 'error': 'name, target, download and upload are required'}), 400

    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            result = service.create_simple_queue(name=name, target=target, download_speed=download, upload_speed=upload)
        if not result.get('success'):
            return jsonify({'success': False, 'error': result.get('error') or 'Queue creation failed'}), 400
        queue = _normalize_queue_item(result.get('queue') or {})
        return jsonify({'success': True, 'queue': queue}), 201
    except Exception as e:
        logger.error(f"Error creating queue: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/routers/<router_id>/queues', methods=['DELETE'])
@admin_required()
def delete_router_queue(router_id):
    data = request.get_json() or {}
    queue_id = str(data.get('id') or '').strip()
    if not queue_id:
        return jsonify({'success': False, 'error': 'Queue id is required'}), 400

    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            success = service.delete_queue(queue_id)
        if not success:
            return jsonify({'success': False, 'error': 'Queue not found or delete failed'}), 404
        return jsonify({'success': True, 'queue_id': queue_id}), 200
    except Exception as e:
        logger.error(f"Error deleting queue: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/connections', methods=['GET'])
@admin_required()
def get_router_connections(router_id):
    """Get active connections"""
    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            connections = service.get_active_connections()
        return jsonify({'success': True, 'connections': connections}), 200
    except Exception as e:
        logger.error(f"Error getting connections: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/backup', methods=['POST'])
@admin_required()
def backup_router(router_id):
    """Backup router configuration"""
    try:
        data = request.get_json()
        backup_name = data.get('name')
        
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            result = service.backup_configuration(backup_name)
        return jsonify(result), 200 if result.get('success') else 500
    except Exception as e:
        logger.error(f"Error backing up router: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/test-connection', methods=['GET'])
@admin_required()
def test_connection(router_id):
    """Test connectivity to specified router"""
    try:
        router = _router_for_request(router_id)
        if not router:
            return jsonify({'success': False, 'error': 'Router not found'}), 404
        diagnostics = _build_router_connection_diagnostics(router)
        ok = bool(diagnostics.get('success'))
        payload = {'success': ok, 'diagnostics': diagnostics}
        if not ok:
            payload['error'] = diagnostics.get('summary') or 'No se pudo conectar al router'
        return jsonify(payload), (200 if ok else 502)
    except Exception as e:
        logger.error(f"Error testing connection: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/reboot', methods=['POST'])
@admin_required()
def reboot_router(router_id):
    """Reboot MikroTik router"""
    try:
        guard_error = _live_guard(require_preflight=True, required_default=True)
        if guard_error:
            return guard_error
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            success = service.reboot_router()
        return jsonify({'success': success}), 200 if success else 500
    except Exception as e:
        logger.error(f"Error rebooting router: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/arp', methods=['GET'])
@jwt_required()
@admin_required()
def list_arp(router_id):
    """Return ARP table from MikroTik router (Lista ARP)."""
    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'No se pudo conectar al router'}), 500
            arp_res = service.api.get_resource('/ip/arp')
            entries = arp_res.get()
            result = []
            for e in entries:
                result.append({
                    'address': e.get('address', ''),
                    'mac_address': e.get('mac-address', ''),
                    'interface': e.get('interface', ''),
                    'status': e.get('status', ''),
                    'complete': e.get('complete', 'false'),
                    'disabled': e.get('disabled', 'false'),
                    'invalid': e.get('invalid', 'false'),
                    'dynamic': e.get('dynamic', 'false'),
                })
        return jsonify({'success': True, 'arp': result, 'total': len(result)}), 200
    except Exception as e:
        logger.error(f"Error getting ARP list for router {router_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/routers/<router_id>/ppp/active', methods=['GET'])
@jwt_required()
@admin_required()
def list_ppp_active(router_id):
    """Return active PPP sessions from MikroTik router (PPP Active Connections)."""
    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'No se pudo conectar al router'}), 500
            ppp_res = service.api.get_resource('/ppp/active')
            sessions = ppp_res.get()
            result = []
            for s in sessions:
                result.append({
                    'name': s.get('name', ''),
                    'service': s.get('service', ''),
                    'caller_id': s.get('caller-id', ''),
                    'address': s.get('address', ''),
                    'uptime': s.get('uptime', ''),
                    'encoding': s.get('encoding', ''),
                    'session_id': s.get('session-id', ''),
                    'limit_bytes_in': s.get('limit-bytes-in', ''),
                    'limit_bytes_out': s.get('limit-bytes-out', ''),
                    'radius': s.get('radius', 'false'),
                })
        return jsonify({'success': True, 'sessions': result, 'total': len(result)}), 200
    except Exception as e:
        logger.error(f"Error getting PPP active sessions for router {router_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/routers/<router_id>/execute-script', methods=['POST'])
@admin_required()
def execute_script(router_id):
    """Execute script on router"""
    try:
        guard_error = _live_guard(require_preflight=True, required_default=True)
        if guard_error:
            return guard_error
        data = request.get_json() or {}
        script_content = data.get('script')
        
        if not script_content:
            return jsonify({'success': False, 'error': 'No script provided'}), 400
        
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            result = service.execute_script(script_content)
        return jsonify(result), (200 if result.get('success') else 500)
    except Exception as e:
        logger.error(f"Error executing script: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/hotspot', methods=['POST'])
@admin_required()
def configure_hotspot(router_id):
    """Configure hotspot on router"""
    try:
        data = request.get_json()
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            success = service.configure_hotspot(data)
        return jsonify({'success': success}), 200 if success else 500
    except Exception as e:
        logger.error(f"Error configuring hotspot: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/multi-wan', methods=['POST'])
@admin_required()
def configure_multi_wan(router_id):
    """Configure multi-WAN on router"""
    try:
        data = request.get_json()
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            success = service.configure_multi_wan(data)
        return jsonify({'success': success}), 200 if success else 500
    except Exception as e:
        logger.error(f"Error configuring multi-WAN: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/wireless/clients', methods=['GET'])
@admin_required()
def get_wireless_clients(router_id):
    """List wireless registration-table clients"""
    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            reg = service.api.get_resource('/interface/wireless/registration-table')
            clients = reg.get()
        # Normalize boolean strings
        for c in clients:
            if 'authenticated' in c:
                c['authenticated'] = (c.get('authenticated') == 'true')
        return jsonify({'success': True, 'clients': clients}), 200
    except Exception as e:
        logger.error(f"Error getting wireless clients: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/dhcp/leases', methods=['GET'])
@admin_required()
def get_dhcp_leases(router_id):
    """List DHCP leases"""
    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            dhcp_api = service.api.get_resource('/ip/dhcp-server/lease')
            leases = dhcp_api.get()
        return jsonify({'success': True, 'leases': leases}), 200
    except Exception as e:
        logger.error(f"Error getting DHCP leases: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/interfaces/<interface_name>/toggle', methods=['POST'])
@admin_required()
def toggle_interface(router_id, interface_name):
    """Enable/disable an interface"""
    try:
        data = request.get_json() or {}
        enabled = data.get('enabled')
        if enabled is None:
            return jsonify({'success': False, 'error': 'Missing enabled flag'}), 400
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            iface_api = service.api.get_resource('/interface')
            matches = iface_api.get(name=interface_name)
            if not matches:
                return jsonify({'success': False, 'error': 'Interface not found'}), 404
            iface_id = matches[0].get('.id') or matches[0].get('id')
            iface_api.set(id=iface_id, disabled='no' if enabled else 'yes')
        return jsonify({'success': True, 'interface': interface_name, 'enabled': bool(enabled)}), 200
    except Exception as e:
        logger.error(f"Error toggling interface: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/ping', methods=['POST'])
@admin_required()
def ping_host(router_id):
    """Run ping from router to target host"""
    try:
        data = request.get_json() or {}
        target = data.get('target')
        count = int(data.get('count', 4))
        if not target:
            return jsonify({'success': False, 'error': 'Missing target'}), 400
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            ping_api = service.api.get_resource('/tool/ping')
            # Some API clients require call, others support get with params
            try:
                result = ping_api.call('ping', {'address': target, 'count': str(count)})
            except Exception:
                result = ping_api.get(address=target, count=str(count))
        return jsonify({'success': True, 'result': result}), 200
    except Exception as e:
        logger.error(f"Error running ping: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/logs', methods=['GET'])
@admin_required()
def get_logs(router_id):
    """Fetch router logs with optional topic and limit"""
    try:
        topic = request.args.get('topic')
        limit = request.args.get('limit', 100, type=int)

        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            
            logs = service.get_logs(topic=topic, limit=limit)

        return jsonify({'success': True, 'logs': logs}), 200
    except Exception as e:
        logger.error(f"Error fetching logs for router {router_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<int:router_id>/ai-diagnose', methods=['GET'])
@admin_required()
def get_ai_diagnosis(router_id):
    """Get an AI-powered network diagnosis for a specific router."""
    try:
        # Verificar que el router existe
        router = db.session.get(MikroTikRouter, router_id)
        if not router:
            return jsonify({'success': False, 'error': 'Router not found'}), 404

        # Instanciar y ejecutar el servicio de diagnostico
        ai_service = AIDiagnosticService(router_id=router_id)
        diagnosis_result = ai_service.run_diagnosis()

        if "error" in diagnosis_result:
            return jsonify({'success': False, 'error': diagnosis_result['error']}), 500

        return jsonify({'success': True, 'diagnosis': diagnosis_result}), 200

    except ValueError as ve:
        logger.warning(f"Value error during AI diagnosis for router {router_id}: {ve}")
        return jsonify({'success': False, 'error': str(ve)}), 404
    except Exception as e:
        logger.error(f"Error getting AI diagnosis for router {router_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/routers/<router_id>/resources', methods=['GET'])
@admin_required()
def get_resources(router_id):
    """Get system resource info (identity, model, memory, cpu, etc.)"""
    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            info = service.get_router_info()
        return jsonify({'success': True, 'info': info}), 200
    except Exception as e:
        logger.error(f"Error getting resources: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Disabled: discovery service not implemented
# @mikrotik_bp.route('/discover', methods=['GET'])
# @jwt_required()
# def discover_routers():
#     """Discover MikroTik routers in network"""
#     try:
#         from app.services.autoprovision_service import AutoProvisionService
#         service = AutoProvisionService()
#         routers = service.discover_mikrotik_network()
#         
#         return jsonify({
#             'success': True,
#             'routers': routers,
#             'count': len(routers)
#         }), 200
#     except Exception as e:
#         logger.error(f"Error discovering routers: {e}")
#         return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/advanced/provision', methods=['POST'])
@admin_required()
def advanced_provision():
    """Advanced provisioning with v6/v7 support"""
    try:
        data = request.get_json()
        router_id = data.get('router_id')
        client_id = data.get('client_id')
        
        if not router_id or not client_id:
            return jsonify({'success': False, 'error': 'Missing router_id or client_id'}), 400
        
        router = db.session.get(MikroTikRouter, router_id)
        client = db.session.get(Client, client_id)
        
        if not router:
            return jsonify({'success': False, 'error': 'Router not found'}), 404
        if not client:
            return jsonify({'success': False, 'error': 'Client not found'}), 404
        
        # Use advanced service
        with MikroTikAdvancedService(router.id) as service:
            results = service.provision_client(client, client.plan)
        
        if results.get('success'):
            client.status = 'active'
            db.session.commit()
        
        return jsonify(results), (200 if results.get('success') else 500)
    except Exception as e:
        logger.error(f"Error in advanced provisioning: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<int:router_id>/metrics', methods=['GET'])
@admin_required()
def get_router_metrics(router_id):
    """
    Get historical metrics for a specific router from InfluxDB.
    Query params:
    - measurement: The name of the measurement (e.g., 'system_resources', 'interface_traffic'). Required.
    - range: The time range to query (e.g., '-1h', '-6h', '-24h'). Defaults to '-1h'.
    - interface: The name of the interface to filter by (for 'interface_traffic' measurement).
    """
    try:
        # Check if router exists
        router = db.session.get(MikroTikRouter, router_id)
        if not router:
            return jsonify({'success': False, 'error': 'Router not found'}), 404

        # Get and validate query parameters
        measurement = request.args.get('measurement')
        if not measurement:
            return jsonify({'success': False, 'error': 'Query parameter "measurement" is required.'}), 400
        
        time_range = request.args.get('range', '-1h')
        interface_name = request.args.get('interface')

        # Build tags for the query
        tags = {'router_id': str(router_id)}
        if interface_name and measurement == 'interface_traffic':
            tags['interface_name'] = interface_name
        
        # Query InfluxDB
        metrics_data = monitoring_service.query_metrics(
            measurement=measurement,
            time_range=time_range,
            tags=tags
        )

        return jsonify({'success': True, 'metrics': metrics_data}), 200

    except Exception as e:
        logger.error(f"Error getting historical metrics for router {router_id}: {e}", exc_info=True)
        return jsonify({'success': False, 'error': 'An internal error occurred while fetching metrics.'}), 500

@mikrotik_bp.route('/routers/<router_id>/enterprise/snapshot', methods=['GET'])
@admin_required()
def get_enterprise_snapshot(router_id):
    """
    Enterprise snapshot for NOC/SRE use cases.
    Returns a consolidated health, security and capacity report.
    """
    try:
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500

            router_info = service.get_router_info()
            health = service.get_system_health()
            interfaces = service.get_interface_stats()
            queues = service.get_queue_stats()
            connections = service.get_active_connections()
            filter_rules = service.get_firewall_rules()
            nat_rules = service.get_nat_rules()
            mangle_rules = service.get_mangle_rules()
            recent_logs = service.get_logs(limit=40)

            ip_services: List[Dict[str, Any]] = []
            try:
                ip_service_api = service.api.get_resource('/ip/service')
                for item in ip_service_api.get():
                    ip_services.append({
                        'name': item.get('name', 'unknown'),
                        'port': str(item.get('port', '')),
                        'disabled': str(item.get('disabled', 'false')).lower() == 'true',
                        'address': item.get('address', ''),
                        'certificate': item.get('certificate', '')
                    })
            except Exception as service_error:
                logger.warning(f"Could not get /ip/service for router {router_id}: {service_error}")

            dhcp_summary = {'total': 0, 'bound': 0, 'waiting': 0}
            try:
                leases = service.api.get_resource('/ip/dhcp-server/lease').get()
                dhcp_summary['total'] = len(leases)
                for lease in leases:
                    status = str(lease.get('status', '')).lower()
                    if status == 'bound':
                        dhcp_summary['bound'] += 1
                    if status in ('waiting', 'offered'):
                        dhcp_summary['waiting'] += 1
            except Exception as dhcp_error:
                logger.warning(f"Could not get DHCP leases for router {router_id}: {dhcp_error}")

            ppp_summary = {'active': 0}
            try:
                ppp_active = service.api.get_resource('/ppp/active').get()
                ppp_summary['active'] = len(ppp_active)
            except Exception as ppp_error:
                logger.warning(f"Could not get PPP active sessions for router {router_id}: {ppp_error}")

            scheduler_summary = {'total': 0, 'backup_jobs': 0}
            try:
                schedulers = service.api.get_resource('/system/scheduler').get()
                scheduler_summary['total'] = len(schedulers)
                scheduler_summary['backup_jobs'] = len([
                    s for s in schedulers
                    if 'backup' in str(s.get('name', '')).lower() or 'backup' in str(s.get('on-event', '')).lower()
                ])
            except Exception as scheduler_error:
                logger.warning(f"Could not get scheduler data for router {router_id}: {scheduler_error}")

        enriched_interfaces = []
        for item in interfaces:
            rx = _to_int(item.get('rx_bytes'))
            tx = _to_int(item.get('tx_bytes'))
            enriched_interfaces.append({
                'name': item.get('name', 'unknown'),
                'type': item.get('type', 'unknown'),
                'running': bool(item.get('running')),
                'rx_bytes': rx,
                'tx_bytes': tx,
                'traffic_bytes': rx + tx
            })
        top_interfaces = sorted(enriched_interfaces, key=lambda x: x['traffic_bytes'], reverse=True)[:8]
        interface_summary = {
            'total': len(enriched_interfaces),
            'running': len([i for i in enriched_interfaces if i.get('running')]),
            'down': len([i for i in enriched_interfaces if not i.get('running')])
        }

        busy_queues = []
        for queue in queues:
            rate = str(queue.get('rate', '')).strip().lower()
            is_disabled = bool(queue.get('disabled'))
            if is_disabled:
                continue
            if rate and rate not in ('0', '0/0', '0/0bps', '0bps/0bps'):
                busy_queues.append(queue)

        queue_summary = {
            'total': len(queues),
            'active': len([q for q in queues if not q.get('disabled')]),
            'disabled': len([q for q in queues if q.get('disabled')]),
            'busy': len(busy_queues)
        }

        connection_summary = {
            'total': len(connections),
            'dhcp': len([c for c in connections if c.get('type') == 'dhcp']),
            'pppoe': len([c for c in connections if c.get('type') == 'pppoe'])
        }

        firewall_summary = {
            'filter_total': len(filter_rules),
            'filter_disabled': len([r for r in filter_rules if str(r.get('disabled', 'false')).lower() == 'true']),
            'nat_total': len(nat_rules),
            'nat_disabled': len([r for r in nat_rules if str(r.get('disabled', 'false')).lower() == 'true']),
            'mangle_total': len(mangle_rules),
            'mangle_disabled': len([r for r in mangle_rules if str(r.get('disabled', 'false')).lower() == 'true'])
        }

        insecure_service_names = {'telnet', 'ftp', 'www', 'api', 'api-ssl'}
        insecure_services = [
            svc.get('name')
            for svc in ip_services
            if svc.get('name') in insecure_service_names and not svc.get('disabled')
        ]

        health_score = _to_int((health or {}).get('health_score'), 0)
        recommendations: List[str] = []
        if health_score < 85:
            recommendations.append('El health score esta por debajo de 85. Revisar CPU, memoria e interfaces.')
        if interface_summary['down'] > 0:
            recommendations.append(f'Hay {interface_summary["down"]} interfaces caidas. Validar enlaces criticos.')
        if len(insecure_services) > 0:
            recommendations.append('Se detectaron servicios de gestion inseguros habilitados. Aplicar hardening.')
        if scheduler_summary['backup_jobs'] == 0:
            recommendations.append('No hay tareas de backup automaticas detectadas en /system scheduler.')
        if dhcp_summary['waiting'] > 20:
            recommendations.append('Hay muchas leases DHCP en estado waiting/offered. Revisar pool y conflictos.')
        if queue_summary['busy'] > 30:
            recommendations.append('Numero alto de colas ocupadas. Considerar optimizacion de QoS/PCQ.')

        normalized_logs = [
            {
                'time': entry.get('time', ''),
                'topics': entry.get('topics', ''),
                'message': entry.get('message', '')
            }
            for entry in recent_logs[:20]
        ]

        snapshot = {
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'router': router_info,
            'health_score': health_score,
            'issues': (health or {}).get('issues', []),
            'interface_summary': interface_summary,
            'queue_summary': queue_summary,
            'connection_summary': connection_summary,
            'firewall_summary': firewall_summary,
            'dhcp_summary': dhcp_summary,
            'ppp_summary': ppp_summary,
            'scheduler_summary': scheduler_summary,
            'insecure_services': insecure_services,
            'services': ip_services,
            'top_interfaces': top_interfaces,
            'recent_logs': normalized_logs,
            'recommendations': recommendations
        }
        return jsonify({'success': True, 'snapshot': snapshot}), 200
    except Exception as e:
        logger.error(f"Error getting enterprise snapshot for router {router_id}: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/enterprise/hardening', methods=['POST'])
@admin_required()
def apply_enterprise_hardening(router_id):
    """
    Apply security hardening runbook to router management services.
    """
    try:
        data = request.get_json() or {}
        dry_run = _as_bool(data.get('dry_run'), default=True)
        profile = str(data.get('profile', 'baseline')).strip().lower()
        if profile not in ('baseline', 'strict', 'hardened'):
            profile = 'baseline'
        site_profile = str(data.get('site_profile', 'access')).strip().lower()
        if site_profile not in ('core', 'distribution', 'access', 'hotspot'):
            site_profile = 'access'
        auto_rollback = _as_bool(data.get('auto_rollback'), default=True)

        if not dry_run:
            guard_error = _live_guard(require_preflight=True, required_default=True)
            if guard_error:
                return guard_error

        runbook = _build_hardening_runbook(profile, site_profile)
        commands = runbook['commands']
        rollback_commands = runbook['rollback_commands']
        actor = _resolve_actor_identity()
        dry_status = 'dry-run'

        if dry_run:
            change = _register_change(
                router_id=router_id,
                actor=actor,
                category='hardening',
                profile=profile,
                site_profile=site_profile,
                commands=commands,
                rollback_commands=rollback_commands,
                status=dry_status,
                metadata={'auto_rollback': auto_rollback}
            )
            return jsonify({
                'success': True,
                'dry_run': True,
                'profile': profile,
                'site_profile': site_profile,
                'commands': commands,
                'rollback_commands': rollback_commands,
                'change_id': change['change_id'],
                'message': 'Dry-run generado. No se aplicaron cambios.'
            }), 200

        change = _register_change(
            router_id=router_id,
            actor=actor,
            category='hardening',
            profile=profile,
            site_profile=site_profile,
            commands=commands,
            rollback_commands=rollback_commands,
            status='in-progress',
            metadata={'auto_rollback': auto_rollback}
        )

        rollback_result = None
        with MikroTikService(router_id) as service:
            if not service.api:
                change['status'] = 'failed'
                change['metadata']['error'] = 'Could not connect to router'
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            result = service.execute_script('\n'.join(commands))
            success = bool(result.get('success'))
            if success:
                change['status'] = 'applied'
            else:
                change['status'] = 'failed'
                change['metadata']['error'] = result.get('error')
                if auto_rollback:
                    rollback_result = service.execute_script('\n'.join(rollback_commands))
                    rollback_ok = bool(rollback_result.get('success'))
                    change['status'] = 'rolled-back' if rollback_ok else 'rollback-failed'
                    change['metadata']['rollback_result'] = rollback_result

        return jsonify({
            'success': success,
            'dry_run': False,
            'profile': profile,
            'site_profile': site_profile,
            'commands': commands,
            'rollback_commands': rollback_commands,
            'change_id': change['change_id'],
            'result': result.get('result', ''),
            'error': result.get('error'),
            'rollback_result': rollback_result,
            'message': 'Hardening aplicado correctamente.' if success else 'No se pudo aplicar hardening.'
        }), (200 if success else 500)
    except Exception as e:
        logger.error(f"Error applying hardening for router {router_id}: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/enterprise/hardening/profiles', methods=['GET'])
@admin_required()
def get_hardening_profiles(router_id):
    """
    Return available hardening profiles by router/site role.
    """
    try:
        profiles = {
            'router_profiles': [
                {'id': 'baseline', 'label': 'Baseline', 'description': 'Desactiva servicios inseguros de gestion.'},
                {'id': 'strict', 'label': 'Strict', 'description': 'Baseline + cifrado fuerte y aislamiento de descubrimiento.'},
                {'id': 'hardened', 'label': 'Hardened', 'description': 'Perfil reforzado para produccion critica.'}
            ],
            'site_profiles': [
                {'id': 'core', 'label': 'Core', 'description': 'Nucleo de red con mayor control de proteccion.'},
                {'id': 'distribution', 'label': 'Distribution', 'description': 'Enlaces de distribucion con politica de ICMP controlada.'},
                {'id': 'access', 'label': 'Access', 'description': 'Nodos de acceso para clientes finales.'},
                {'id': 'hotspot', 'label': 'Hotspot', 'description': 'Portal cautivo y control de trafico de acceso publico.'}
            ]
        }
        return jsonify({'success': True, 'profiles': profiles, 'router_id': str(router_id)}), 200
    except Exception as e:
        logger.error(f"Error getting hardening profiles for router {router_id}: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/enterprise/change-log', methods=['GET'])
@admin_required()
def get_enterprise_change_log(router_id):
    """
    Get enterprise change log for a router.
    """
    try:
        limit = max(1, min(200, _to_int(request.args.get('limit', 50), 50)))
        status_filter = str(request.args.get('status', '')).strip().lower()
        data = list(_get_change_log(router_id))
        if status_filter:
            data = [item for item in data if str(item.get('status', '')).lower() == status_filter]
        return jsonify({'success': True, 'changes': data[:limit]}), 200
    except Exception as e:
        logger.error(f"Error getting change-log for router {router_id}: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/enterprise/rollback/<change_id>', methods=['POST'])
@admin_required()
def rollback_enterprise_change(router_id, change_id):
    """
    Rollback a previously registered enterprise change.
    """
    try:
        guard_error = _live_guard(require_preflight=True, required_default=True)
        if guard_error:
            return guard_error
        entry = ENTERPRISE_CHANGE_INDEX.get(change_id)
        if not entry or str(entry.get('router_id')) != str(router_id):
            return jsonify({'success': False, 'error': 'Change not found for this router'}), 404

        rollback_commands = entry.get('rollback_commands') or []
        if not rollback_commands:
            return jsonify({'success': False, 'error': 'Rollback commands not available for this change'}), 400

        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500
            result = service.execute_script('\n'.join(rollback_commands))

        ok = bool(result.get('success'))
        entry['status'] = 'rolled-back' if ok else 'rollback-failed'
        entry['rolled_back_at'] = datetime.utcnow().isoformat() + 'Z'
        entry['rolled_back_by'] = _resolve_actor_identity()
        entry['metadata'] = entry.get('metadata', {})
        entry['metadata']['manual_rollback_result'] = result

        return jsonify({
            'success': ok,
            'change_id': change_id,
            'status': entry['status'],
            'result': result.get('result', ''),
            'error': result.get('error')
        }), (200 if ok else 500)
    except Exception as e:
        logger.error(f"Error rolling back change {change_id} for router {router_id}: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/enterprise/failover-test', methods=['POST'])
@admin_required()
def run_enterprise_failover_test(router_id):
    """
    Execute failover test by pinging multiple targets from the router.
    """
    try:
        guard_error = _live_guard(require_preflight=True, required_default=True)
        if guard_error:
            return guard_error
        data = request.get_json() or {}
        raw_targets = data.get('targets') or ['1.1.1.1', '8.8.8.8', '9.9.9.9']
        if not isinstance(raw_targets, list):
            raw_targets = [str(raw_targets)]
        targets = [str(t).strip() for t in raw_targets if str(t).strip()][:8]
        if len(targets) == 0:
            return jsonify({'success': False, 'error': 'No valid targets provided'}), 400

        count = max(1, min(20, _to_int(data.get('count', 4), 4)))

        probe_results: List[Dict[str, Any]] = []
        with MikroTikService(router_id) as service:
            if not service.api:
                return jsonify({'success': False, 'error': 'Could not connect to router'}), 500

            ping_api = service.api.get_resource('/tool/ping')
            for target in targets:
                try:
                    try:
                        result = ping_api.call('ping', {'address': target, 'count': str(count)})
                    except Exception:
                        result = ping_api.get(address=target, count=str(count))

                    if not isinstance(result, list):
                        result = [result]

                    success_probes = 0
                    latency_values: List[float] = []
                    for row in result:
                        row_text = str(row.get('status', '') or row.get('time', '')).lower()
                        timeout = 'timeout' in row_text
                        if not timeout:
                            success_probes += 1
                        latency_ms = _parse_router_latency_ms(row.get('time'))
                        if latency_ms is not None:
                            latency_values.append(latency_ms)

                    packet_loss = round(((count - success_probes) / float(count)) * 100, 2)
                    avg_latency = round(sum(latency_values) / len(latency_values), 2) if latency_values else None
                    status = 'ok' if packet_loss <= 20 else ('warning' if packet_loss <= 50 else 'critical')

                    probe_results.append({
                        'target': target,
                        'total_probes': count,
                        'success_probes': success_probes,
                        'packet_loss': packet_loss,
                        'avg_latency_ms': avg_latency,
                        'status': status
                    })
                except Exception as probe_error:
                    probe_results.append({
                        'target': target,
                        'total_probes': count,
                        'success_probes': 0,
                        'packet_loss': 100,
                        'avg_latency_ms': None,
                        'status': 'critical',
                        'error': str(probe_error)
                    })

        critical_count = len([r for r in probe_results if r.get('status') == 'critical'])
        warning_count = len([r for r in probe_results if r.get('status') == 'warning'])
        overall_status = 'ok'
        if critical_count > 0:
            overall_status = 'critical'
        elif warning_count > 0:
            overall_status = 'warning'

        return jsonify({
            'success': True,
            'report': {
                'generated_at': datetime.utcnow().isoformat() + 'Z',
                'overall_status': overall_status,
                'targets': probe_results
            }
        }), 200
    except Exception as e:
        logger.error(f"Error running failover test for router {router_id}: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


# ── SSTP tunnel shortcuts (avoid sstp_bp double-registration 405 bug) ────────

@mikrotik_bp.route('/routers/<int:router_id>/sstp/status', methods=['GET'])
@jwt_required()
@admin_required()
def get_sstp_status(router_id):
    """Return active SSTP tunnel for this router, with decrypted password and script."""
    try:
        from app.models import SstpTunnel
        from app.services.sstp_service import generate_mikrotik_sstp_script
        from app.tenancy import current_tenant_id
        from flask_jwt_extended import get_jwt_identity

        tid = current_tenant_id()
        uid = get_jwt_identity()
        from app.models import User
        user = db.session.get(User, int(uid))

        router = db.session.get(MikroTikRouter, router_id)
        if not router:
            return jsonify({'success': False, 'error': 'Router no encontrado'}), 404
        if user and user.role != 'platform_admin' and router.tenant_id != tid:
            return jsonify({'success': False, 'error': 'Acceso denegado'}), 403

        tunnel = SstpTunnel.query.filter_by(router_id=router_id, status='active').first()
        if not tunnel:
            return jsonify({'success': False, 'tunnel': None}), 200

        result = tunnel.to_dict(include_password=True)
        try:
            prov = {
                'username': tunnel.username,
                'password': tunnel.password or '',
                'server_host': tunnel.server_host,
                'server_port': tunnel.server_port,
                'server_ip': tunnel.server_ip,
                'client_ip': tunnel.client_ip,
                'router_name': router.name,
                'provisioned_at': tunnel.created_at.isoformat() if tunnel.created_at else '',
                'hub': 'FASTISP',
                'fingerprint': '',
                'sstp_url': f"sstp://{tunnel.server_host}:{tunnel.server_port}",
            }
            result['script'] = generate_mikrotik_sstp_script(prov)
        except Exception:
            result['script'] = ''

        return jsonify({'success': True, 'tunnel': result}), 200
    except Exception as e:
        logger.error(f"Error getting SSTP status for router {router_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/routers/<int:router_id>/sstp/provision', methods=['POST'])
@jwt_required()
@admin_required()
def provision_sstp_for_router(router_id):
    """Provision or return existing SSTP tunnel for this router."""
    try:
        from app.models import SstpTunnel
        from app.services.sstp_service import (
            provision_sstp_tunnel,
            provision_sstp_tunnel_api,
            generate_mikrotik_sstp_script,
        )
        from app.tenancy import current_tenant_id
        from flask_jwt_extended import get_jwt_identity

        tid = current_tenant_id()
        uid = get_jwt_identity()
        from app.models import User
        user = db.session.get(User, int(uid))

        router = db.session.get(MikroTikRouter, router_id)
        if not router:
            return jsonify({'success': False, 'error': 'Router no encontrado'}), 404
        if user and user.role != 'platform_admin' and router.tenant_id != tid:
            return jsonify({'success': False, 'error': 'Acceso denegado'}), 403

        existing = SstpTunnel.query.filter_by(router_id=router_id, status='active').first()
        if existing:
            result = existing.to_dict(include_password=True)
            try:
                prov = {
                    'username': existing.username,
                    'password': existing.password or '',
                    'server_host': existing.server_host,
                    'server_port': existing.server_port,
                    'server_ip': existing.server_ip,
                    'client_ip': existing.client_ip,
                    'router_name': router.name,
                    'provisioned_at': existing.created_at.isoformat() if existing.created_at else '',
                    'hub': 'FASTISP',
                    'fingerprint': '',
                    'sstp_url': f"sstp://{existing.server_host}:{existing.server_port}",
                }
                result['script'] = generate_mikrotik_sstp_script(prov)
            except Exception:
                result['script'] = ''
            return jsonify(result), 200

        prov = provision_sstp_tunnel(router)
        tunnel = SstpTunnel(
            router_id=router.id,
            tenant_id=router.tenant_id,
            username=prov['username'],
            server_ip=prov['server_ip'],
            client_ip=prov['client_ip'],
            server_host=prov['server_host'],
            server_port=prov['server_port'],
            status='active',
        )
        tunnel.password = prov['password']
        db.session.add(tunnel)
        db.session.commit()

        script = generate_mikrotik_sstp_script(prov)
        result = tunnel.to_dict(include_password=True)
        result['script'] = script
        result['provisioning'] = prov
        try:
            api_result = provision_sstp_tunnel_api(router, provisioning=prov)
            result['api_applied'] = api_result.get('api_applied', False)
            result['api_results'] = api_result.get('api_results', [])
        except Exception as api_err:
            result['api_applied'] = False
            result['api_results'] = [str(api_err)]
        logger.info(f"SSTP tunnel provisioned via mikrotik_bp for router {router_id}")
        return jsonify(result), 201
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error provisioning SSTP for router {router_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ── Traffic Flow (NetFlow v5) — WispHub-equivalent ────────────────────────────

@mikrotik_bp.route('/routers/<int:router_id>/traffic-flow/script', methods=['GET'])
@jwt_required()
@admin_required()
def get_traffic_flow_script(router_id):
    """
    Return Traffic Flow configuration scripts for this router.
    RouterOS 6.x and 7.x variants (LAN/WAN gateways).
    Equivalent to WispHub's 'Script de Traffic Flow' tab.
    """
    try:
        from app.services.traffic_flow_service import (
            generate_traffic_flow_script_ros6,
            generate_traffic_flow_script_ros7_lan,
            generate_traffic_flow_script_ros7_wan,
            COLLECTOR_IP, COLLECTOR_PORT,
        )

        router = db.session.get(MikroTikRouter, router_id)
        if not router:
            return jsonify({'success': False, 'error': 'Router no encontrado'}), 404

        # Optional gateway hints from query params
        lan_gw_raw = request.args.get('lan_gateways', '')
        wan_gw_raw = request.args.get('wan_gateways', '')
        lan_gateways = [g.strip() for g in lan_gw_raw.split(',') if g.strip()] or None
        wan_gateways = [g.strip() for g in wan_gw_raw.split(',') if g.strip()] or None

        return jsonify({
            'success': True,
            'collector_ip': COLLECTOR_IP,
            'collector_port': COLLECTOR_PORT,
            'router_name': router.name,
            'scripts': {
                'ros6': generate_traffic_flow_script_ros6(router.name),
                'ros7_lan': generate_traffic_flow_script_ros7_lan(router.name, lan_gateways),
                'ros7_wan': generate_traffic_flow_script_ros7_wan(router.name, wan_gateways),
            },
        }), 200
    except Exception as e:
        logger.error(f"Error generating traffic flow script for router {router_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/traffic-flow/stats', methods=['GET'])
@jwt_required()
@admin_required()
def get_traffic_flow_stats():
    """
    Return aggregated NetFlow stats.
    Query params:
      router_id  — filter by router
      hours      — lookback window in hours (default 24)
      limit      — top N IPs (default 50)
    """
    try:
        from app.models import TrafficFlowStats
        from app.tenancy import current_tenant_id
        from sqlalchemy import func

        tid = current_tenant_id()
        router_id = request.args.get('router_id', type=int)
        hours     = request.args.get('hours', 24, type=int)
        limit     = min(request.args.get('limit', 50, type=int), 200)

        since = datetime.utcnow() - timedelta(hours=hours)

        q = TrafficFlowStats.query.filter(
            TrafficFlowStats.tenant_id == tid,
            TrafficFlowStats.bucket >= since,
        )
        if router_id:
            q = q.filter(TrafficFlowStats.router_id == router_id)

        # Aggregate by src_ip
        agg = (
            db.session.query(
                TrafficFlowStats.src_ip,
                TrafficFlowStats.router_id,
                func.sum(TrafficFlowStats.bytes_total).label('bytes_total'),
                func.sum(TrafficFlowStats.packets_total).label('packets_total'),
                func.max(TrafficFlowStats.bucket).label('last_seen'),
            )
            .filter(
                TrafficFlowStats.tenant_id == tid,
                TrafficFlowStats.bucket >= since,
                *([TrafficFlowStats.router_id == router_id] if router_id else []),
            )
            .group_by(TrafficFlowStats.src_ip, TrafficFlowStats.router_id)
            .order_by(func.sum(TrafficFlowStats.bytes_total).desc())
            .limit(limit)
            .all()
        )

        result = []
        for row in agg:
            mb = round((row.bytes_total or 0) / 1_048_576, 2)
            result.append({
                'src_ip':        row.src_ip,
                'router_id':     row.router_id,
                'bytes_total':   row.bytes_total or 0,
                'mb_total':      mb,
                'packets_total': row.packets_total or 0,
                'last_seen':     row.last_seen.isoformat() if row.last_seen else None,
            })

        return jsonify({
            'success': True,
            'stats': result,
            'total': len(result),
            'hours': hours,
        }), 200
    except Exception as e:
        logger.error(f"Error fetching traffic flow stats: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@mikrotik_bp.route('/traffic-flow/stats/router/<int:router_id>', methods=['GET'])
@jwt_required()
@admin_required()
def get_router_traffic_flow_stats(router_id):
    """Top consumers for a specific router in the last N hours."""
    try:
        from app.models import TrafficFlowStats
        from sqlalchemy import func

        hours = request.args.get('hours', 24, type=int)
        limit = min(request.args.get('limit', 50, type=int), 200)
        since = datetime.utcnow() - timedelta(hours=hours)

        router = db.session.get(MikroTikRouter, router_id)
        if not router:
            return jsonify({'success': False, 'error': 'Router no encontrado'}), 404

        agg = (
            db.session.query(
                TrafficFlowStats.src_ip,
                func.sum(TrafficFlowStats.bytes_total).label('bytes_total'),
                func.sum(TrafficFlowStats.packets_total).label('packets_total'),
                func.max(TrafficFlowStats.bucket).label('last_seen'),
            )
            .filter(
                TrafficFlowStats.router_id == router_id,
                TrafficFlowStats.bucket >= since,
            )
            .group_by(TrafficFlowStats.src_ip)
            .order_by(func.sum(TrafficFlowStats.bytes_total).desc())
            .limit(limit)
            .all()
        )

        result = [
            {
                'src_ip':        r.src_ip,
                'bytes_total':   r.bytes_total or 0,
                'mb_total':      round((r.bytes_total or 0) / 1_048_576, 2),
                'packets_total': r.packets_total or 0,
                'last_seen':     r.last_seen.isoformat() if r.last_seen else None,
            }
            for r in agg
        ]

        return jsonify({
            'success': True,
            'router_name': router.name,
            'stats': result,
            'total': len(result),
            'hours': hours,
        }), 200
    except Exception as e:
        logger.error(f"Error fetching traffic stats for router {router_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _resolve_router_for_snmp(router_id: int):
    router = db.session.get(MikroTikRouter, router_id)
    if not router or not tenant_access_allowed(router.tenant_id):
        return None
    return router


@mikrotik_bp.route('/routers/<int:router_id>/snmp-profile', methods=['GET'])
@jwt_required()
@admin_required()
def get_router_snmp_profile(router_id: int):
    router = _resolve_router_for_snmp(router_id)
    if not router:
        return jsonify({'success': False, 'error': 'Router no encontrado'}), 404

    profile = snmp_service.router_profile(router)
    return jsonify(
        {
            'success': True,
            'router_id': router.id,
            'router_name': router.name,
            'profile': snmp_service.sanitize_profile(profile),
            'runtime_available': snmp_service.is_available(),
        }
    ), 200


@mikrotik_bp.route('/routers/<int:router_id>/snmp-profile', methods=['PUT', 'PATCH'])
@jwt_required()
@admin_required()
def upsert_router_snmp_profile(router_id: int):
    router = _resolve_router_for_snmp(router_id)
    if not router:
        return jsonify({'success': False, 'error': 'Router no encontrado'}), 404

    payload = request.get_json(silent=True) or {}
    normalized = snmp_service.store_router_profile(router, payload)
    db.session.add(router)
    db.session.commit()

    return jsonify(
        {
            'success': True,
            'router_id': router.id,
            'router_name': router.name,
            'profile': snmp_service.sanitize_profile(normalized),
            'runtime_available': snmp_service.is_available(),
        }
    ), 200


@mikrotik_bp.route('/routers/<int:router_id>/snmp/poll', methods=['POST'])
@jwt_required()
@admin_required()
def poll_router_snmp(router_id: int):
    router = _resolve_router_for_snmp(router_id)
    if not router:
        return jsonify({'success': False, 'error': 'Router no encontrado'}), 404

    payload = request.get_json(silent=True) or {}
    overrides = payload.get('profile') if isinstance(payload.get('profile'), dict) else {}
    persist = _as_bool(payload.get('persist'), default=False)

    profile = snmp_service.router_profile(router)
    if overrides:
        profile.update(overrides)

    try:
        result = snmp_service.poll_router_profile(profile)
        if persist:
            snmp_service.persist_router_poll(monitoring_service, router, result)
        return jsonify(
            {
                'success': True,
                'router_id': router.id,
                'router_name': router.name,
                'persisted': persist,
                **result,
            }
        ), 200
    except SNMPRuntimeUnavailable as exc:
        return jsonify({'success': False, 'error': str(exc)}), 503
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        logger.error('Error polling SNMP for router %s: %s', router_id, exc, exc_info=True)
        return jsonify({'success': False, 'error': str(exc)}), 502
