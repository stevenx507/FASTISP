"""
sstp_service.py — Servicio de provisioning SSTP nativo MikroTik
================================================================
Genera scripts para configurar MikroTik como servidor SSTP con
certificados propios, perfil PPP y secrets dinámicos.

Arquitectura (estilo Wispro):
  1. MikroTik genera CA + certificado servidor en el propio router
  2. Se habilita servidor SSTP nativo (puerto 443, MS-CHAPv2, PFS)
  3. Se gestionan /ppp secret dinamicamente via API o scripts
  4. Sin dependencia de SoftEther
"""

from __future__ import annotations

import ipaddress
import logging
import os
import secrets
import string
from datetime import datetime

from app import db

logger = logging.getLogger(__name__)

# ── Configuración ──────────────────────────────────────────────────────────────
SSTP_SERVER_PORT = int(os.environ.get("SSTP_SERVER_PORT", "8443"))
SSTP_POOL_START = os.environ.get("SSTP_POOL_START", "10.10.0.2")
SSTP_POOL_END = os.environ.get("SSTP_POOL_END", "10.10.0.254")
SSTP_LOCAL_ADDRESS = os.environ.get("SSTP_LOCAL_ADDRESS", "10.10.0.1")
SSTP_DNS_SERVERS = os.environ.get("SSTP_DNS_SERVERS", "8.8.8.8,8.8.4.4")
SSTP_TLS_VERSION = os.environ.get("SSTP_TLS_VERSION", "only-1.2")
SSTP_CIPHERS = os.environ.get("SSTP_CIPHERS", "aes256-sha")
SSTP_PFS = os.environ.get("SSTP_PFS", "required")
SSTP_PROFILE_NAME = os.environ.get("SSTP_PROFILE_NAME", "fastisp-sstp")
SSTP_POOL_NAME = os.environ.get("SSTP_POOL_NAME", "fastisp-sstp-pool")
SSTP_CA_NAME = os.environ.get("SSTP_CA_NAME", "FastISP-CA")
SSTP_CERT_NAME = os.environ.get("SSTP_CERT_NAME", "FastISP-SSTP")
SSTP_API_GROUP_NAME = os.environ.get("SSTP_API_GROUP_NAME", "fastisp")
SSTP_API_ALLOWED_SUBNET = os.environ.get("SSTP_API_ALLOWED_SUBNET", "10.10.0.0/24")
FASTISP_VPS_IP = os.environ.get("FASTISP_VPS_IP", "")  # IP publica del VPS para acceso API remoto

# Backward compat: rutas importan estos nombres
SSTP_CERT_DIR = os.environ.get("SSTP_CERT_DIR", "/tmp/sstp-certs")
SSTP_SERVER_HOST = os.environ.get("SSTP_SERVER_HOST", "fastisp.cloud")


# ── Helpers internos ───────────────────────────────────────────────────────────

def _generate_username(router_name: str = "router") -> str:
    """Genera un username único para el túnel SSTP."""
    safe_name = "".join(c for c in router_name.lower() if c.isalnum() or c == "-")[:12]
    suffix = secrets.token_hex(4)
    return f"sstp-{safe_name}-{suffix}"


def _generate_password(length: int = 20) -> str:
    """Genera una contraseña segura."""
    alphabet = string.ascii_letters + string.digits
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        # Asegurar que tiene al menos un carácter de cada tipo
        if (any(c.islower() for c in pwd) and
                any(c.isupper() for c in pwd) and
                any(c.isdigit() for c in pwd)):
            return pwd


def _allocate_ip_pair() -> tuple[str, str]:
    """Retorna un par (local_address/gateway, remote_address/primer_cliente)."""
    return (SSTP_LOCAL_ADDRESS, SSTP_POOL_START)


def _routeros_quote(value: str) -> str:
    token = str(value or "")
    return f'"{token.replace(chr(34), chr(92) + chr(34))}"'


def _coerce_ip(value: str, *, field_name: str):
    try:
        return ipaddress.ip_address(str(value).strip())
    except ValueError as exc:
        raise RuntimeError(f"{field_name} invalida: {value}") from exc


def _connect_service(router_id: int):
    from app.services.mikrotik_service import MikroTikService

    service = MikroTikService(router_id)
    if not service.api and not service.connect_to_router(router_id):
        detail = service.last_connection_error or "No se pudo conectar al router por API"
        service.disconnect()
        raise RuntimeError(detail)
    return service


def _allocate_private_remote_address(service) -> str:
    """Busca la siguiente IP privada libre dentro del pool SSTP del router."""
    start_ip = _coerce_ip(SSTP_POOL_START, field_name="SSTP_POOL_START")
    end_ip = _coerce_ip(SSTP_POOL_END, field_name="SSTP_POOL_END")
    local_ip = _coerce_ip(SSTP_LOCAL_ADDRESS, field_name="SSTP_LOCAL_ADDRESS")
    if int(start_ip) > int(end_ip):
        raise RuntimeError("SSTP pool invalido: el inicio es mayor que el fin")

    secret_api = service.api.get_resource("/ppp/secret")
    used_addresses: set[str] = set()
    for secret in secret_api.get():
        remote_address = str(secret.get("remote-address") or secret.get("remote_address") or "").strip()
        if not remote_address:
            continue
        try:
            remote_ip = ipaddress.ip_address(remote_address)
        except ValueError:
            continue
        if int(start_ip) <= int(remote_ip) <= int(end_ip):
            used_addresses.add(str(remote_ip))

    for candidate_int in range(int(start_ip), int(end_ip) + 1):
        candidate = str(ipaddress.ip_address(candidate_int))
        if candidate == str(local_ip):
            continue
        if candidate not in used_addresses:
            return candidate

    raise RuntimeError("No hay direcciones privadas libres en el pool SSTP")


def _active_tunnel_payload(router) -> dict | None:
    tunnel = getattr(router, "sstp_tunnel", None)
    if not tunnel or getattr(tunnel, "status", None) != "active":
        return None
    return {
        "username": tunnel.username,
        "password": tunnel.password or "",
        "server_host": tunnel.server_host,
        "server_port": tunnel.server_port,
        "server_ip": tunnel.server_ip,
        "client_ip": tunnel.client_ip,
        "api_port": getattr(router, "api_port", 8728) or 8728,
        "fingerprint": get_certificate_fingerprint(),
        "router_name": getattr(router, "name", "mikrotik"),
        "provisioned_at": tunnel.created_at.isoformat() if tunnel.created_at else datetime.utcnow().isoformat(),
    }


def ensure_sstp_user(username: str, password: str) -> dict:
    """Compatibilidad: ahora delega a API si router disponible."""
    if not username or not password:
        raise RuntimeError("Username y password PPP requeridos")
    return {"username": username, "password": password, "action": "native_mikrotik"}


# ── API pública ────────────────────────────────────────────────────────────────

def provision_sstp_tunnel(router) -> dict:
    """Genera las credenciales base del servidor SSTP nativo."""
    username = _generate_username(router.name)
    password = _generate_password(20)
    server_ip, client_ip = _allocate_ip_pair()
    router_address = router.ip_address

    logger.info("SSTP nativo preparado para router '%s' (%s)", router.name, router_address)

    return {
        "username": username,
        "password": password,
        "server_host": router_address,
        "server_port": SSTP_SERVER_PORT,
        "server_ip": server_ip,
        "client_ip": client_ip,
        "api_port": router.api_port or 8728,
        "fingerprint": "MIKROTIK-NATIVE-CERT",
        "router_name": router.name,
        "provisioned_at": datetime.utcnow().isoformat(),
    }


def revoke_sstp_tunnel(username: str) -> bool:
    """Compatibilidad con rutas que revocan el tunel en la BD."""
    logger.info("Tunel SSTP '%s' marcado como revocado en BD", username)
    return True


def provision_sstp_tunnel_api(router, provisioning: dict | None = None) -> dict:
    """Aplica la configuracion completa del servidor SSTP en RouterOS via API."""
    from app.models import MikroTikRouter

    router_db = db.session.get(MikroTikRouter, router.id) if hasattr(router, "id") else router
    if not router_db:
        raise RuntimeError("Router no encontrado para API provisioning")

    prov = provisioning or _active_tunnel_payload(router_db) or provision_sstp_tunnel(router_db)
    script = generate_mikrotik_sstp_script(prov)

    service = _connect_service(router_db.id)
    try:
        result = service.execute_script(script)
    finally:
        service.disconnect()

    if not result.get("success"):
        error = result.get("error") or "Error desconocido ejecutando script RouterOS"
        logger.error("API SSTP provisioning failed on router %s: %s", router_db.id, error)
        raise RuntimeError(error)

    logger.info("Servidor SSTP nativo aplicado via API en router %s", router_db.name)
    return {
        **prov,
        "api_applied": True,
        "api_results": [
            f"Servidor SSTP nativo aplicado via API en {router_db.name}",
            f"Puerto {prov.get('server_port', SSTP_SERVER_PORT)} con MS-CHAPv2, PFS={SSTP_PFS} y ciphers={SSTP_CIPHERS}",
        ],
    }


def add_ppp_secret_api(
    router_id: int,
    client_name: str,
    password: str,
    remote_address: str | None = None,
    is_public: bool = False,
    lan_interface: str = "bridge",
) -> dict:
    """Agrega o actualiza un secret PPP SSTP via API."""
    service = _connect_service(router_id)
    try:
        secret_api = service.api.get_resource("/ppp/secret")
        target_remote = str(remote_address or "").strip() or None

        if is_public:
            if not target_remote:
                raise RuntimeError("remote_address es requerido para clientes con IP publica")
            public_ip = _coerce_ip(target_remote, field_name="remote_address")
            if public_ip.is_private:
                raise RuntimeError("remote_address debe ser una IP publica cuando is_public=true")
        else:
            if not target_remote:
                target_remote = _allocate_private_remote_address(service)
            _coerce_ip(target_remote, field_name="remote_address")

        existing = secret_api.get(name=client_name)
        payload = {
            "password": password,
            "service": "sstp",
            "profile": SSTP_PROFILE_NAME,
            "remote-address": target_remote,
            "comment": "FastISP Client",
            "disabled": "no",
        }

        results: list[str] = []
        if existing:
            secret_id = existing[0].get(".id") or existing[0].get("id")
            secret_api.set(id=secret_id, **payload)
            action = "updated"
            results.append(f"PPP secret actualizado: {client_name}")
        else:
            secret_api.add(name=client_name, **payload)
            action = "created"
            results.append(f"PPP secret creado: {client_name}")

        if is_public:
            interface_api = service.api.get_resource("/interface")
            interfaces = interface_api.get(name=lan_interface)
            if not interfaces:
                raise RuntimeError(f"Interfaz LAN no encontrada: {lan_interface}")
            iface_id = interfaces[0].get(".id") or interfaces[0].get("id")
            interface_api.set(id=iface_id, arp="proxy-arp")
            results.append(f"Proxy-ARP habilitado en {lan_interface} para {target_remote}")

        return {
            "success": True,
            "results": results,
            "action": action,
            "remote_address": target_remote,
        }
    except Exception as exc:
        logger.error("Error agregando PPP secret en router %s: %s", router_id, exc)
        return {"success": False, "error": str(exc)}
    finally:
        service.disconnect()


def revoke_ppp_secret_api(router_id: int, client_name: str) -> dict:
    """Elimina un secret PPP SSTP via API."""
    service = _connect_service(router_id)
    try:
        secret_api = service.api.get_resource("/ppp/secret")
        existing = secret_api.get(name=client_name)
        if not existing:
            return {"success": True, "results": [f"PPP secret no existia: {client_name}"], "action": "not_found"}

        for secret in existing:
            secret_id = secret.get(".id") or secret.get("id")
            secret_api.remove(id=secret_id)

        return {"success": True, "results": [f"PPP secret eliminado: {client_name}"], "action": "removed"}
    except Exception as exc:
        logger.error("Error eliminando PPP secret en router %s: %s", router_id, exc)
        return {"success": False, "error": str(exc)}
    finally:
        service.disconnect()


def get_certificate_fingerprint() -> str:
    """En MikroTik nativo, el certificado vive y se firma en el router."""
    return "MIKROTIK-NATIVE-CERT"


def ensure_sstp_certificate() -> dict:
    """Compatibilidad: ya no se genera un certificado global en el VPS."""
    return {
        "exists": True,
        "fingerprint": get_certificate_fingerprint(),
        "cert_path": "/certificate",
        "server_host": "MikroTik nativo",
        "managed_by": "MikroTik RouterOS (certificado generado en el router)",
    }


def generate_mikrotik_sstp_script(prov: dict) -> str:
    """Genera el script RouterOS para configurar el servidor SSTP nativo."""
    username = prov.get("username", "")
    password = prov.get("password", "")
    api_port = prov.get("api_port") or 8728
    router_name = prov.get("router_name", "mikrotik")
    router_address = prov.get("server_host", "0.0.0.0")
    provisioned_at = prov.get("provisioned_at", datetime.utcnow().isoformat())
    first_client_ip = prov.get("client_ip") or SSTP_POOL_START
    pool_range = f"{SSTP_POOL_START}-{SSTP_POOL_END}"

    # Construir address list para API: pool SSTP + IP del VPS si existe
    vps_ip = FASTISP_VPS_IP.strip()
    if vps_ip:
        api_addresses = f"{SSTP_API_ALLOWED_SUBNET},{vps_ip}/32"
    else:
        api_addresses = SSTP_API_ALLOWED_SUBNET

    # Firewall rules: RouterOS src-address NO acepta listas separadas por coma,
    # hay que generar una regla por cada origen.
    fw_api_rules = f'/ip firewall filter add chain=input protocol=tcp dst-port={api_port} src-address={SSTP_API_ALLOWED_SUBNET} action=accept comment="FastISP: Permitir API" place-before=0'
    if vps_ip:
        fw_api_rules += f'\n/ip firewall filter add chain=input protocol=tcp dst-port={api_port} src-address={vps_ip}/32 action=accept comment="FastISP: Permitir API VPS" place-before=0'

    return f"""# FastISP - Servidor SSTP Nativo - {router_name}
# Generado: {provisioned_at}
# ================================================================
# Arquitectura:
#   1. CA y certificado generados en el MikroTik
#   2. SSTP nativo en {SSTP_SERVER_PORT}/TCP con MS-CHAPv2
#   3. Perfil PPP + pool interno
#   4. Secret de gestion FastISP y usuario API
#   5. API abierta para: {api_addresses}
# ================================================================

# --- Limpieza previa controlada ---
/ppp secret remove [find where comment="FastISP Management"]
/ppp profile remove [find where name={_routeros_quote(SSTP_PROFILE_NAME)}]
/ip pool remove [find where name={_routeros_quote(SSTP_POOL_NAME)}]
/interface sstp-server server set enabled=no
/certificate remove [find where name={_routeros_quote(SSTP_CERT_NAME)}]
/certificate remove [find where name={_routeros_quote(SSTP_CA_NAME)}]
/user remove [find where name={_routeros_quote(username)}]
/user group remove [find where name={_routeros_quote(SSTP_API_GROUP_NAME)}]
/ip firewall filter remove [find where comment~"FastISP"]

# --- 1. Certificados locales del router ---
/certificate add name={SSTP_CA_NAME} common-name=FastISP-CA days-valid=3650 key-usage=key-cert-sign,crl-sign
/certificate sign {SSTP_CA_NAME} name={SSTP_CA_NAME}
:delay 5s
/certificate add name={SSTP_CERT_NAME} common-name={router_address} days-valid=3650 key-usage=digital-signature,key-encipherment,tls-server
/certificate sign {SSTP_CERT_NAME} ca={SSTP_CA_NAME} name={SSTP_CERT_NAME}
:delay 5s

# --- 2. Pool privado para clientes SSTP ---
/ip pool add name={SSTP_POOL_NAME} ranges={pool_range}

# --- 3. Perfil PPP del servidor SSTP ---
/ppp profile add name={_routeros_quote(SSTP_PROFILE_NAME)} local-address={SSTP_LOCAL_ADDRESS} remote-address={SSTP_POOL_NAME} dns-server={SSTP_DNS_SERVERS} use-encryption=yes comment="FastISP SSTP Profile"

# --- 4. Servidor SSTP nativo ---
/interface sstp-server server set enabled=yes port={SSTP_SERVER_PORT} default-profile={_routeros_quote(SSTP_PROFILE_NAME)} authentication=mschap2 certificate={SSTP_CERT_NAME} pfs={SSTP_PFS} tls-version={SSTP_TLS_VERSION} ciphers={SSTP_CIPHERS}

# --- 5. Secret PPP de gestion ---
/ppp secret add name={_routeros_quote(username)} password={_routeros_quote(password)} service=sstp profile={_routeros_quote(SSTP_PROFILE_NAME)} remote-address={first_client_ip} comment="FastISP Management"

# --- 6. Usuario API FastISP ---
:do {{ /user group add name={SSTP_API_GROUP_NAME} policy="local,ftp,reboot,read,write,policy,test,password,sniff,api,romon,sensitive" }} on-error={{}}
/user add name={_routeros_quote(username)} password={_routeros_quote(password)} group={SSTP_API_GROUP_NAME} comment="FastISP API user"

# --- 7. API habilitada (VPS + pool SSTP) ---
/ip service set api port={api_port} disabled=no address="{api_addresses}"

# --- 8. Firewall de entrada para SSTP y API ---
/ip firewall filter add chain=input protocol=tcp dst-port={SSTP_SERVER_PORT} action=accept comment="FastISP: Permitir SSTP" place-before=0
{fw_api_rules}

:log info "FastISP: Servidor SSTP nativo configurado para {router_name}"
"""


def generate_ppp_secret_script(
    client_name: str,
    password: str,
    remote_address: str,
    is_public: bool = False,
    lan_interface: str = "bridge",
) -> str:
    """Genera el script RouterOS para un PPP secret SSTP."""
    script = (
        f'/ppp secret add name={_routeros_quote(client_name)} '
        f'password={_routeros_quote(password)} service=sstp '
        f'profile={_routeros_quote(SSTP_PROFILE_NAME)} remote-address={remote_address} '
        f'comment="FastISP Client"'
    )
    if is_public:
        script += f'\n/interface set [find where name={_routeros_quote(lan_interface)}] arp=proxy-arp'
        script += f'\n:log info "FastISP: Proxy-ARP activado en {lan_interface} para IP publica {remote_address}"'
    return script


def generate_mikrotik_hub_client_script(provisioning: dict) -> str:
    """
    Genera un script RouterOS para conectar un MikroTik como CLIENTE SSTP al VPS (Modo Hub).
    Estilo WispHub.
    """
    username = provisioning.get("username", "admin")
    password = provisioning.get("password", "")
    server_host = provisioning.get("server_host", "fastisp.cloud")
    server_port = provisioning.get("server_port", 8443)
    api_port = provisioning.get("api_port", 8728)

    script = f"""# ========================================================
# ISPFAST: Script de Conexion via Tunel (Modo Hub)
# ========================================================
# Este script conecta su MikroTik al VPS central.
# No requiere apertura de puertos ni IP publica.

:log info "ISPFAST: Iniciando configuracion de Tunel Hub..."

# 1. Limpieza de conexiones previas de ISPFAST
:do {{ /interface sstp-client remove [find where comment~"ISPFAST"] }} on-error={{}}
:do {{ /ppp profile remove [find where name="ispfast-hub"] }} on-error={{}}

# 2. Perfil PPP para el cliente
/ppp profile add name="ispfast-hub" comment="ISPFAST Hub Profile" use-encryption=yes

# 3. Configuracion del cliente SSTP
/interface sstp-client add name="ispfast-hub-vpn" \\
    connect-to={_routeros_quote(server_host)} \\
    port={server_port} \\
    user={_routeros_quote(username)} \\
    password={_routeros_quote(password)} \\
    profile="ispfast-hub" \\
    certificate=none \\
    verify-server-certificate=no \\
    disabled=no \\
    comment="ISPFAST Hub Connection"

# 4. Usuario API local para el panel
:do {{ /user group add name="ispfast" policy="local,ftp,reboot,read,write,policy,test,password,sniff,api,romon,sensitive" }} on-error={{}}
:do {{ /user remove [find name={_routeros_quote(username)}] }} on-error={{}}
/user add name={_routeros_quote(username)} password={_routeros_quote(password)} group="ispfast" comment="ISPFAST API User"

# 5. Habilitar API en el puerto correcto (permitiendo el rango del tunel)
/ip service set api port={api_port} disabled=no address="10.100.0.0/16"

# 6. Programador para asegurar que la conexion se reinicie si falla
:do {{ /system scheduler remove [find name="ISPFAST-KeepAlive"] }} on-error={{}}
/system scheduler add name="ISPFAST-KeepAlive" interval=10m start-time=startup \\
    on-event="/interface sstp-client {{ :if ([get [find name=\\\"ispfast-hub-vpn\\\"] running] = false) do={{ disable [find name=\\\"ispfast-hub-vpn\\\"]; :delay 5s; enable [find name=\\\"ispfast-hub-vpn\\\"]; :log info \\\"ISPFAST: Reiniciando tunel caido\\\" }} }}"

:log info "ISPFAST: Configuracion completada con exito."
"""
    return script


def generate_verification_script() -> str:
    """Genera un script de verificacion del servidor SSTP en MikroTik."""
    return f"""# Script de verificacion SSTP Server FastISP
:put "=== FastISP SSTP Server Status ==="
:put ("Servidor SSTP: " . [/interface sstp-server server get enabled])
:put ("Puerto: " . [/interface sstp-server server get port])
:put ("Certificado: " . [/interface sstp-server server get certificate])
:put ""
:put "=== Certificados ==="
/certificate print where name~"FastISP"
:put ""
:put "=== PPP Secrets ==="
/ppp secret print where profile={_routeros_quote(SSTP_PROFILE_NAME)}
:put ""
:put "=== Clientes SSTP Conectados ==="
/ppp active print where service="sstp"
:put ""
:put "=== Pool de IPs ==="
/ip pool print where name={_routeros_quote(SSTP_POOL_NAME)}
"""
