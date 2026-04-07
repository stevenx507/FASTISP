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

import os
import secrets
import string
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

# ── Configuración ──────────────────────────────────────────────────────────────
SSTP_SERVER_PORT = int(os.environ.get("SSTP_SERVER_PORT", "443"))
SSTP_POOL_START = os.environ.get("SSTP_POOL_START", "10.10.0.2")
SSTP_POOL_END = os.environ.get("SSTP_POOL_END", "10.10.0.254")
SSTP_LOCAL_ADDRESS = os.environ.get("SSTP_LOCAL_ADDRESS", "10.10.0.1")
SSTP_DNS_SERVERS = os.environ.get("SSTP_DNS_SERVERS", "8.8.8.8,8.8.4.4")

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


def ensure_sstp_user(username: str, password: str) -> dict:
    """
    En la arquitectura nativa MikroTik, los secrets PPP se gestionan
    directamente en el router. Stub de compatibilidad.
    """
    if not username or not password:
        raise RuntimeError("Username y password PPP requeridos")
    return {"username": username, "password": password, "action": "native_mikrotik"}


# ── API pública ────────────────────────────────────────────────────────────────

def provision_sstp_tunnel(router) -> dict:
    """
    Provisiona servidor SSTP nativo en un router MikroTik.
    Genera credenciales de management y retorna datos para el script.
    """
    username = _generate_username(router.name)
    password = _generate_password(20)
    server_ip, client_ip = _allocate_ip_pair()
    router_address = router.ip_address

    logger.info(f"SSTP nativo provisionado para router '{router.name}' ({router_address})")

    return {
        "username": username,
        "password": password,
        "server_host": router_address,
        "server_port": SSTP_SERVER_PORT,
        "server_ip": server_ip,
        "client_ip": client_ip,
        "fingerprint": "MIKROTIK-NATIVE-CERT",
        "router_name": router.name,
        "provisioned_at": datetime.utcnow().isoformat(),
    }


def revoke_sstp_tunnel(username: str) -> bool:
    """
    Revoca un secret PPP. La eliminación real se hace via MikroTik API
    cuando el router está accesible.
    """
    logger.info(f"PPP secret '{username}' marcado como revocado en BD")
    return True


def get_certificate_fingerprint() -> str:
    """En MikroTik nativo, el certificado se genera en el router."""
    return "MIKROTIK-NATIVE-CERT"


def ensure_sstp_certificate() -> dict:
    """Certificado se genera en el MikroTik, no en el VPS."""
    return {
        "exists": True,
        "fingerprint": "MIKROTIK-NATIVE-CERT",
        "cert_path": "/certificate",
        "server_host": "MikroTik nativo",
        "managed_by": "MikroTik RouterOS (certificado generado en el router)",
    }


def generate_mikrotik_sstp_script(prov: dict) -> str:
    """
    Genera el script .rsc para configurar MikroTik como servidor SSTP nativo.

    Incluye:
    1. Generacion de certificados (CA + servidor)
    2. Servidor SSTP (puerto 443, MS-CHAPv2, PFS, TLS 1.2)
    3. Pool de IPs + Perfil PPP
    4. Secret PPP para gestion FastISP
    5. Usuario API + grupo de permisos
    6. API restringida al pool VPN
    7. Regla firewall para SSTP entrante
    """
    username = prov.get("username", "")
    password = prov.get("password", "")
    router_name = prov.get("router_name", "mikrotik")
    router_address = prov.get("server_host", "0.0.0.0")
    provisioned_at = prov.get("provisioned_at", datetime.utcnow().isoformat())

    pool_range = f"{SSTP_POOL_START}-{SSTP_POOL_END}"
    local_addr = SSTP_LOCAL_ADDRESS
    sstp_port = SSTP_SERVER_PORT
    dns = SSTP_DNS_SERVERS
    profile_name = "fastisp-sstp"
    pool_name = "fastisp-sstp-pool"
    ca_name = "FastISP-CA"
    cert_name = "FastISP-SSTP"
    group_name = "fastisp"

    script = f"""# FastISP — Servidor SSTP Nativo — {router_name}
# Generado: {provisioned_at}
# =====================================================================
# Este script configura el router MikroTik como servidor SSTP.
# Los clientes VPN se conectan directamente al router.
# =====================================================================

# --- Limpieza previa ---
/ppp secret remove [find where comment~"FastISP"]
/ppp profile remove [find where name="{profile_name}"]
/ip pool remove [find where name="{pool_name}"]
/interface sstp-server server set enabled=no
/certificate remove [find where name="{cert_name}"]
/certificate remove [find where name="{ca_name}"]
/user remove [find where name~"sstp-"]
/user group remove [find where name~"{group_name}"]
/ip firewall filter remove [find where comment~"FastISP"]

# --- 1. Generacion de Certificados ---
/certificate add name={ca_name} common-name=FastISP-CA days-valid=3650 key-usage=key-cert-sign,crl-sign
/certificate sign {ca_name} name={ca_name}
:delay 5s
:log info "FastISP: CA generado y firmado"
/certificate add name={cert_name} common-name={router_address} days-valid=3650 key-usage=digital-signature,key-encipherment,tls-server
/certificate sign {cert_name} ca={ca_name} name={cert_name}
:delay 5s
:log info "FastISP: Certificado servidor SSTP firmado"

# --- 2. Pool de IPs para clientes VPN ---
/ip pool add name={pool_name} ranges={pool_range}

# --- 3. Perfil PPP ---
/ppp profile add name="{profile_name}" local-address={local_addr} remote-address={pool_name} dns-server={dns} use-encryption=yes comment="FastISP SSTP Profile"

# --- 4. Servidor SSTP (MS-CHAPv2, PFS, Force AES) ---
/interface sstp-server server set enabled=yes certificate={cert_name} port={sstp_port} authentication=mschap2 pfs=yes tls-version=only-1.2
:log info "FastISP: Servidor SSTP habilitado en puerto {sstp_port}"

# --- 5. Secret PPP (gestion FastISP) ---
/ppp secret add name="{username}" password="{password}" service=sstp profile="{profile_name}" remote-address={SSTP_POOL_START} comment="FastISP Management"

# --- 6. Usuario y grupo de API ---
/user group add name={group_name} policy="local,ftp,reboot,read,write,policy,test,password,sniff,api,romon,sensitive"
/user add name="{username}" password="{password}" group={group_name} comment="FastISP API user"

# --- 7. Habilitar API (restringida al pool VPN) ---
/ip service set api port=8728 disabled=no address={local_addr}/24

# --- 8. Firewall — permitir SSTP entrante ---
/ip firewall filter add chain=input protocol=tcp dst-port={sstp_port} action=accept comment="FastISP: Permitir SSTP" place-before=0

# --- Listo ---
:log info "FastISP: Servidor SSTP configurado para {router_name}. Generado: {provisioned_at}"
"""
    return script


def generate_ppp_secret_script(client_name: str, password: str,
                                remote_address: str, is_public: bool = False,
                                lan_interface: str = "bridge") -> str:
    """
    Genera script para agregar un secret PPP (cliente SSTP).

    Para IPs Privadas: remote-address del pool interno.
    Para IPs Publicas: remote-address = IP publica + proxy-arp en LAN.
    """
    profile_name = "fastisp-sstp"
    script = f'/ppp secret add name="{client_name}" password="{password}" service=sstp profile="{profile_name}" remote-address={remote_address} comment="FastISP Client"'

    if is_public:
        script += f'\n/interface set [find where name="{lan_interface}"] arp=proxy-arp'
        script += f'\n:log info "FastISP: Proxy-ARP activado en {lan_interface} para IP publica {remote_address}"'

    return script


def generate_verification_script() -> str:
    """Genera un script de verificacion del servidor SSTP en MikroTik."""
    return """# Script de verificacion SSTP Server FastISP
:put "=== FastISP SSTP Server Status ==="
:put ("Servidor SSTP: " . [/interface sstp-server server get enabled])
:put ("Puerto: " . [/interface sstp-server server get port])
:put ("Certificado: " . [/interface sstp-server server get certificate])
:put ""
:put "=== Certificados ==="
/certificate print where name~"FastISP"
:put ""
:put "=== PPP Secrets ==="
/ppp secret print where comment~"FastISP"
:put ""
:put "=== Clientes SSTP Conectados ==="
/interface sstp-server print
:put ""
:put "=== Pool de IPs ==="
/ip pool print where name~"fastisp"
"""
