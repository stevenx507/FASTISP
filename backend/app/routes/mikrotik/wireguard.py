from flask import request, jsonify, current_app
from flask_jwt_extended import jwt_required
from app.routes.auth_routes import admin_required
from app import db, cache
from app.models import AdminSystemSetting, MikroTikRouter, Tenant
from app.services.mikrotik_service import MikroTikService
import logging
import re
import base64
import binascii
import ipaddress
import zipfile
import io
import shlex
import subprocess
import paramiko
from urllib.parse import parse_qs, unquote, urlparse
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import mikrotik_bp
from .utils import (
    TENANT_SETTING_SENTINEL,
    WG_VPS_INTERFACE_DEFAULT,
    WG_PROFILE_ALLOWED_SUBNETS_DEFAULT,
    WG_PROFILE_ENDPOINT_DEFAULT,
    WG_VPS_SYNC_MODE_DEFAULT,
    current_tenant_id,
    tenant_setting_row,
    tenant_setting_upsert,
    parse_wireguard_endpoint,
    wireguard_public_key_from_private_base64,
    normalize_wg_allowed_ip,
    safe_router_wireguard_allowed_ip,
    suggest_router_name,
    normalize_router_name_prefix,
    normalize_bth_user_name,
    pick_value,
    as_bool,
)

logger = logging.getLogger(__name__)

# Constants
WIREGUARD_IMPORT_MAX_BYTES = 2 * 1024 * 1024
WG_PROFILE_ENDPOINT_SETTING_KEY = 'mikrotik_wg_endpoint'
WG_PROFILE_SERVER_PUBLIC_KEY_SETTING_KEY = 'mikrotik_wg_server_public_key'
WG_PROFILE_ALLOWED_SUBNETS_SETTING_KEY = 'mikrotik_wg_allowed_subnets'
WG_VPS_SYNC_PROFILE_SETTING_KEY = 'mikrotik_wg_vps_sync_profile'
MIKROTIK_ONBOARDING_PROFILE_SETTING_KEY = 'mikrotik_onboarding_profile'

# --- Internal Helpers ---

def _split_csv_values(raw_value: str) -> List[str]:
    return [part.strip() for part in str(raw_value or '').split(',') if part.strip()]

def _parse_wireguard_config(config_text: str) -> Dict[str, Any]:
    section = ''
    interface: Dict[str, str] = {}
    peer: Dict[str, str] = {}
    peer_found = False
    for raw_line in str(config_text or '').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or line.startswith(';'): continue
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1].strip().lower()
            if section == 'peer' and not peer_found: peer_found = True
            continue
        if '=' not in line: continue
        key, value = line.split('=', 1)
        nk, nv = key.strip().lower().replace(' ', '_'), value.strip()
        if section == 'interface': interface[nk] = nv
        elif section == 'peer' and peer_found:
            if nk not in peer: peer[nk] = nv
    endpoint_payload = parse_wireguard_endpoint(peer.get('endpoint', ''))
    return {
        'is_wireguard_config': bool(interface.get('privatekey')) and bool(peer.get('publickey')),
        'interface_private_key': interface.get('privatekey', ''),
        'interface_addresses': _split_csv_values(interface.get('address', '')),
        'interface_dns': _split_csv_values(interface.get('dns', '')),
        'peer_public_key': peer.get('publickey', ''),
        'peer_allowed_ips': _split_csv_values(peer.get('allowedips', '')),
        'peer_persistent_keepalive': peer.get('persistentkeepalive', ''),
        'endpoint': endpoint_payload.get('endpoint', ''),
        'endpoint_host': endpoint_payload.get('host', ''),
        'endpoint_port': endpoint_payload.get('port'),
    }

def _first_wireguard_interface_host(parsed_config: Dict[str, Any]) -> str:
    addresses = parsed_config.get('interface_addresses')
    if not isinstance(addresses, list): return ''
    for raw in addresses:
        c = str(raw or '').strip()
        if not c: continue
        try:
            return str(ipaddress.ip_interface(c).ip) if '/' in c else str(ipaddress.ip_address(c))
        except ValueError: continue
    return ''

def _is_back_to_home_client_profile(parsed_config: Dict[str, Any]) -> bool:
    host = str(parsed_config.get('endpoint_host') or '').lower()
    return host.endswith('.vpn.mynetname.net') or '.vpn.mynetname.net' in host

def _wireguard_config_from_uri(raw_payload: str) -> str:
    parsed = urlparse(str(raw_payload or '').strip())
    qp = parse_qs(parsed.query, keep_blank_values=True)
    nq = {re.sub(r'[^a-z0-9]+', '', str(k).lower()): str(v[0] or '').strip() for k, v in qp.items() if v}
    def _pick(*keys: str) -> str:
        for k in keys:
            v = nq.get(re.sub(r'[^a-z0-9]+', '', str(k).lower()))
            if v: return v
        return ''
    pk, pub, end = _pick('private_key', 'privatekey'), _pick('public_key', 'publickey', 'peer_public_key'), _pick('endpoint', 'server')
    if not pk or not pub: raise ValueError('WireGuard URI missing keys')
    lines = ['[Interface]', f'PrivateKey = {pk}']
    addr, dns = _pick('address', 'addresses'), _pick('dns')
    if addr: lines.append(f'Address = {addr}')
    if dns: lines.append(f'DNS = {dns}')
    lines.extend(['', '[Peer]', f'PublicKey = {pub}'])
    if end: lines.append(f'Endpoint = {end}:{_pick("endpoint_port", "port")}' if ':' not in end and _pick('port') else f'Endpoint = {end}')
    if _pick('allowed_ips', 'allowedips'): lines.append(f'AllowedIPs = {_pick("allowed_ips", "allowedips")}')
    if _pick('persistent_keepalive', 'keepalive'): lines.append(f'PersistentKeepalive = {_pick("persistent_keepalive", "keepalive")}')
    return '\n'.join(lines) + '\n'

def _read_wireguard_config_from_upload() -> tuple[str, str]:
    if 'file' not in request.files: return _normalize_wireguard_config_text(request.get_data(as_text=True) or ''), 'manual_entry'
    up = request.files['file']
    fname = str(up.filename or 'config.conf').lower()
    content = up.read(WIREGUARD_IMPORT_MAX_BYTES + 1024)
    if len(content) > WIREGUARD_IMPORT_MAX_BYTES: raise ValueError('File too large')
    if fname.endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            conf = [n for n in zf.namelist() if n.lower().endswith('.conf')]
            if not conf: raise ValueError('No .conf in zip')
            return zf.read(conf[0]).decode('utf-8', errors='ignore'), conf[0]
    return content.decode('utf-8', errors='ignore'), fname

def _normalize_wireguard_config_text(raw: str) -> str:
    txt = str(raw or '').strip()
    if not txt: raise ValueError('Empty config')
    dec = unquote(txt)
    if '[interface]' in dec.lower() and '[peer]' in dec.lower(): return dec
    if txt.lower().startswith(('wireguard://', 'wg://')): return _wireguard_config_from_uri(txt)
    raise ValueError('Invalid config text')

def _build_wg_set_commands(vps_iface: str, pub_key: str, allowed_ip: str) -> Dict[str, Any]:
    iface = str(vps_iface or WG_VPS_INTERFACE_DEFAULT).strip()
    argv_set = ['wg', 'set', iface, 'peer', str(pub_key).strip(), 'allowed-ips', str(allowed_ip).strip()]
    argv_save = ['wg-quick', 'save', iface]
    return {
        'argv_set': argv_set, 'argv_save': argv_save,
        'shell_set': ' '.join(shlex.quote(p) for p in argv_set),
        'shell_save': ' '.join(shlex.quote(p) for p in argv_save)
    }

def _run_local_command(argv: List[str], timeout: int = 8) -> Dict[str, Any]:
    try:
        c = subprocess.run(argv, capture_output=True, text=True, timeout=max(1, timeout), check=False)
        return {'ok': c.returncode == 0, 'return_code': c.returncode, 'stdout': str(c.stdout).strip(), 'stderr': str(c.stderr).strip()}
    except Exception as e: return {'ok': False, 'error': str(e), 'stdout': '', 'stderr': ''}

def _run_ssh_command(ssh: paramiko.SSHClient, cmd: str, timeout: int = 8) -> Dict[str, Any]:
    try:
        _, stdout, stderr = ssh.exec_command(cmd, timeout=max(1, timeout))
        exit_status = stdout.channel.recv_exit_status()
        return {'ok': exit_status == 0, 'return_code': exit_status, 'stdout': stdout.read().decode('utf-8', errors='ignore').strip(), 'stderr': stderr.read().decode('utf-8', errors='ignore').strip()}
    except Exception as e: return {'ok': False, 'error': str(e), 'stdout': '', 'stderr': ''}

def _register_wireguard_peer_local(cmds: Dict[str, Any], persist: bool, timeout: int = 8) -> Dict[str, Any]:
    res = _run_local_command(cmds.get('argv_set', []), timeout=timeout)
    if not res.get('ok'): return {'success': False, 'message': f'wg set failed: {res.get("stderr") or res.get("error")}', 'set_result': res}
    if persist:
        save = _run_local_command(cmds.get('argv_save', []), timeout=timeout)
        if not save.get('ok'): return {'success': False, 'message': f'wg-quick save failed: {save.get("stderr")}', 'save_result': save}
    return {'success': True, 'message': 'Peer registrado localmente'}

def _register_wireguard_peer_via_ssh(cmds: Dict[str, Any], persist: bool, host: str, user: str, port: int = 22, pwd: str = '', key: str = '', timeout: int = 8, sudo: bool = True) -> Dict[str, Any]:
    if not host or not user: return {'success': False, 'message': 'Missing SSH config'}
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(hostname=host, username=user, port=port, password=pwd, key_filename=key or None, timeout=timeout)
        set_cmd = f'sudo -n {cmds["shell_set"]}' if sudo else cmds['shell_set']
        res = _run_ssh_command(ssh, set_cmd, timeout=timeout)
        if not res.get('ok'): return {'success': False, 'message': f'SSH wg set failed: {res.get("stderr")}', 'set_result': res}
        if persist:
            save_cmd = f'sudo -n {cmds["shell_save"]}' if sudo else cmds['shell_save']
            save = _run_ssh_command(ssh, save_cmd, timeout=timeout)
            if not save.get('ok'): return {'success': False, 'message': f'SSH wg-quick save failed: {save.get("stderr")}', 'save_result': save}
        return {'success': True, 'message': 'Peer registrado vía SSH'}
    except Exception as e: return {'success': False, 'message': f'SSH error: {e}'}
    finally: ssh.close()

def _managed_wg_vps_sync_runtime_from_config() -> Dict[str, Any]:
    cfg = current_app.config
    return {
        'mode': cfg.get('MIKROTIK_WG_VPS_SYNC_MODE', WG_VPS_SYNC_MODE_DEFAULT),
        'vps_interface': cfg.get('MIKROTIK_WG_VPS_INTERFACE', WG_VPS_INTERFACE_DEFAULT),
        'persist': as_bool(cfg.get('MIKROTIK_WG_VPS_PERSIST'), default=True),
        'ssh_host': str(cfg.get('MIKROTIK_WG_VPS_SSH_HOST') or '').strip(),
        'ssh_user': str(cfg.get('MIKROTIK_WG_VPS_SSH_USER') or '').strip(),
        'ssh_password': str(cfg.get('MIKROTIK_WG_VPS_SSH_PASSWORD') or '').strip(),
        'ssh_key_path': str(cfg.get('MIKROTIK_WG_VPS_SSH_KEY_PATH') or '').strip(),
        'ssh_port': int(cfg.get('MIKROTIK_WG_VPS_SSH_PORT') or 22),
        'ssh_timeout_seconds': int(cfg.get('MIKROTIK_WG_VPS_SSH_TIMEOUT_SECONDS') or 8),
        'ssh_use_sudo': as_bool(cfg.get('MIKROTIK_WG_VPS_SSH_USE_SUDO'), default=True),
    }

def _sync_router_peer_to_vps(pub_key: str, allowed_ip: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    rt = _managed_wg_vps_sync_runtime_from_config()
    cmds = _build_wg_set_commands(rt['vps_interface'], pub_key, allowed_ip)
    mode = rt['mode']
    if mode == 'manual': return {'success': False, 'mode': mode, 'manual_required': True, 'manual_command': f'{cmds["shell_set"]} && {cmds["shell_save"]}' if rt['persist'] else cmds['shell_set']}
    if mode in ('auto', 'local'):
        res = _register_wireguard_peer_local(cmds, rt['persist'], rt['ssh_timeout_seconds'])
        if res['success'] or mode == 'local': return {**res, 'mode': 'local', 'runtime': rt}
    if mode in ('auto', 'ssh'):
        res = _register_wireguard_peer_via_ssh(cmds, rt['persist'], rt['ssh_host'], rt['ssh_user'], rt['ssh_port'], rt['ssh_password'], rt['ssh_key_path'], rt['ssh_timeout_seconds'], rt['ssh_use_sudo'])
        return {**res, 'mode': 'ssh', 'runtime': rt}
    return {'success': False, 'message': 'No sync mode available'}

# --- Routes ---

@mikrotik_bp.route('/wireguard/import', methods=['POST'])
@jwt_required()
@admin_required()
def import_wireguard_archive():
    try:
        txt, src = _read_wireguard_config_from_upload()
        parsed = _parse_wireguard_config(txt)
        if not parsed['is_wireguard_config']: return jsonify({'success': False, 'error': 'Invalid WireGuard config'}), 400
        return jsonify({'success': True, 'wireguard': parsed, 'source_file': src})
    except Exception as e: return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/wireguard/register-peer', methods=['POST'])
@jwt_required()
@admin_required()
def register_router_wireguard_peer(router_id):
    router = db.session.get(MikroTikRouter, router_id)
    if not router or (current_tenant_id() and router.tenant_id != current_tenant_id()): return jsonify({'success': False, 'error': 'Router not found'}), 404
    data = request.get_json(silent=True) or {}
    iface = str(data.get('router_interface') or 'wg-fastisp').strip()
    try:
        with MikroTikService(router.id) as svc:
            if not svc.api: return jsonify({'success': False, 'error': 'No API connection'}), 502
            res = svc.api.get_resource('/interface/wireguard').get(name=iface)
            if not res: return jsonify({'success': False, 'error': 'Interface not found'}), 404
            pub = str(res[0].get('public-key') or '').strip()
            addr_res = svc.api.get_resource('/ip/address').get(interface=iface)
            addrs = [str(a.get('address')) for a in addr_res]
            sel_ip = normalize_wg_allowed_ip(addrs[0]) if addrs else safe_router_wireguard_allowed_ip(router.id)
    except Exception as e: return jsonify({'success': False, 'error': str(e)}), 500
    
    sync = _sync_router_peer_to_vps(pub, sel_ip, data)
    return jsonify({'success': sync['success'], 'vps_sync': sync}), 200 if sync['success'] else 502

@mikrotik_bp.route('/wireguard/profile', methods=['GET'])
@jwt_required()
@admin_required()
def get_wireguard_profile_settings():
    tid = current_tenant_id()
    return jsonify({
        'endpoint': pick_value(tenant_setting_row(WG_PROFILE_ENDPOINT_SETTING_KEY, tid), 'value', default=WG_PROFILE_ENDPOINT_DEFAULT),
        'server_public_key': pick_value(tenant_setting_row(WG_PROFILE_SERVER_PUBLIC_KEY_SETTING_KEY, tid), 'value', default=''),
        'allowed_subnets': pick_value(tenant_setting_row(WG_PROFILE_ALLOWED_SUBNETS_SETTING_KEY, tid), 'value', default=WG_PROFILE_ALLOWED_SUBNETS_DEFAULT),
    })
