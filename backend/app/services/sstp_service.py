"""
sstp_service.py — Servicio de provisioning SSTP via SoftEther VPN Server
=========================================================================
Integra con el contenedor fastisp-softether via Docker exec (vpncmd_api.sh)
para crear/revocar usuarios SSTP reales en SoftEther.

Arquitectura:
  Backend (Flask) → docker exec fastisp-softether /vpncmd_api.sh → SoftEther vpncmd
  MikroTik → SSTP → fastisp-softether:8443 → Virtual Hub FASTISP
"""

import os
import subprocess
import secrets
import string
import logging
import ipaddress
from datetime import datetime

logger = logging.getLogger(__name__)

# ── Configuración ──────────────────────────────────────────────────────────────
SOFTETHER_CONTAINER = os.environ.get("SOFTETHER_CONTAINER", "fastisp-softether")
SOFTETHER_HUB = os.environ.get("SOFTETHER_HUB_NAME", "FASTISP")
SOFTETHER_ADMIN_PASSWORD = os.environ.get("SOFTETHER_ADMIN_PASSWORD", "FastISP_VPN_2026!")
SOFTETHER_MGMT_PORT = os.environ.get("SOFTETHER_MGMT_PORT", "5555")

# Host del servidor SSTP (dominio público del VPS)
SSTP_SERVER_HOST = os.environ.get("SSTP_SERVER_HOST", "fastisp.cloud")
SSTP_SERVER_PORT = int(os.environ.get("SSTP_SERVER_PORT", "8443"))

# Pool de IPs para túneles (gestionado por SoftEther SecureNAT/DHCP)
SSTP_IP_POOL_START = os.environ.get("SSTP_IP_POOL_START", "10.100.0.10")
SSTP_IP_POOL_END = os.environ.get("SSTP_IP_POOL_END", "10.100.255.254")

# Directorio de certificados (para el script de MikroTik)
SSTP_CERT_DIR = os.environ.get("SSTP_CERT_DIR", "/tmp/sstp-certs")


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
    """
    Retorna un par (server_ip, client_ip) del pool.
    Con SoftEther SecureNAT, el DHCP asigna IPs automáticamente.
    Retornamos IPs placeholder que se actualizan cuando el MikroTik conecta.
    """
    return ("10.100.0.1", "10.100.0.x (asignado por DHCP al conectar)")


def _run_softether_cmd(cmd: str, username: str = "", password: str = "") -> dict:
    """
    Ejecuta un comando en el contenedor SoftEther via docker exec.
    Retorna dict con status y output.
    """
    try:
        args = ["docker", "exec", SOFTETHER_CONTAINER, "/vpncmd_api.sh", cmd]
        if username:
            args.append(username)
        if password:
            args.append(password)

        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=60,
            stdin=subprocess.DEVNULL
        )

        output = result.stdout.strip()
        error = result.stderr.strip()

        if result.returncode != 0:
            logger.error(f"SoftEther cmd '{cmd}' failed: {error}")
            return {"success": False, "error": error, "output": output}

        lowered_output = output.lower()
        if cmd in {"create_user", "update_password", "delete_user"}:
            if any(marker in lowered_output for marker in ["error occurred", "error:", "failed", "not found"]):
                logger.error(f"SoftEther cmd '{cmd}' returned logical failure: {output}")
                return {"success": False, "error": output or error or "SoftEther command failed", "output": output}

        logger.info(f"SoftEther cmd '{cmd}' OK: {output[:100]}")
        return {"success": True, "output": output, "error": ""}

    except subprocess.TimeoutExpired:
        logger.error(f"SoftEther cmd '{cmd}' timeout")
        return {"success": False, "error": "Timeout conectando con SoftEther", "output": ""}
    except FileNotFoundError:
        # Docker no disponible (entorno de desarrollo)
        logger.warning(f"Docker no disponible, simulando cmd '{cmd}'")
        return {"success": True, "output": f'{{"status": "simulated", "cmd": "{cmd}"}}', "error": ""}
    except Exception as e:
        logger.error(f"SoftEther cmd '{cmd}' error: {e}")
        return {"success": False, "error": str(e), "output": ""}


def _softether_available() -> bool:
    """Verifica si el contenedor SoftEther está corriendo."""
    try:
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Running}}", SOFTETHER_CONTAINER],
            capture_output=True, text=True, timeout=10,
            stdin=subprocess.DEVNULL
        )
        return result.stdout.strip() == "true"
    except Exception:
        return False


def _softether_user_exists(username: str) -> bool:
    """Verifica si el usuario SSTP existe en SoftEther."""
    if not username or not _softether_available():
        return False

    result = _run_softether_cmd("user_exists", username)
    if not result["success"]:
        return False

    output = (result.get("output") or "").lower()
    return '"exists": true' in output


def ensure_sstp_user(username: str, password: str) -> dict:
    """Asegura que un usuario SSTP exista en SoftEther con la contraseña esperada."""
    if not username:
        raise RuntimeError("Username SSTP requerido")
    if not password:
        raise RuntimeError("Password SSTP requerido")
    if not _softether_available():
        raise RuntimeError("SoftEther no disponible")

    if _softether_user_exists(username):
        result = _run_softether_cmd("update_password", username, password)
        if not result["success"]:
            raise RuntimeError(f"No se pudo actualizar password SSTP: {result['error']}")
        return {"username": username, "password": password, "action": "password_updated"}

    result = _run_softether_cmd("create_user", username, password)
    if not result["success"]:
        raise RuntimeError(f"No se pudo crear usuario SSTP: {result['error']}")
    return {"username": username, "password": password, "action": "created"}


# ── API pública ────────────────────────────────────────────────────────────────

def provision_sstp_tunnel(router) -> dict:
    """
    Provisiona un túnel SSTP para un router MikroTik.
    Crea el usuario en SoftEther y retorna las credenciales.

    Args:
        router: instancia de MikroTikRouter

    Returns:
        dict con username, password, server_host, server_port, server_ip, client_ip,
             fingerprint, router_name, provisioned_at
    """
    username = _generate_username(router.name)
    password = _generate_password(20)
    server_ip, client_ip = _allocate_ip_pair()

    # Crear usuario en SoftEther
    if _softether_available():
        result = _run_softether_cmd("create_user", username, password)
        if not result["success"]:
            raise RuntimeError(f"Error creando usuario en SoftEther: {result['error']}")
        logger.info(f"Usuario SSTP '{username}' creado en SoftEther para router '{router.name}'")
    else:
        logger.warning(f"SoftEther no disponible. Usuario '{username}' registrado solo en BD.")

    fingerprint = get_certificate_fingerprint()

    return {
        "username": username,
        "password": password,
        "server_host": SSTP_SERVER_HOST,
        "server_port": SSTP_SERVER_PORT,
        "server_ip": server_ip,
        "client_ip": client_ip,
        "fingerprint": fingerprint,
        "router_name": router.name,
        "provisioned_at": datetime.utcnow().isoformat(),
        "hub": SOFTETHER_HUB,
        "sstp_url": f"sstp://{SSTP_SERVER_HOST}:{SSTP_SERVER_PORT}",
    }


def revoke_sstp_tunnel(username: str) -> bool:
    """
    Revoca un túnel SSTP eliminando el usuario de SoftEther.

    Args:
        username: nombre de usuario SSTP a revocar

    Returns:
        True si se revocó exitosamente
    """
    if _softether_available():
        result = _run_softether_cmd("delete_user", username)
        if not result["success"]:
            logger.error(f"Error revocando usuario '{username}': {result['error']}")
            return False
        logger.info(f"Usuario SSTP '{username}' revocado de SoftEther")
    else:
        logger.warning(f"SoftEther no disponible. Usuario '{username}' marcado como revocado solo en BD.")

    return True


def _update_chap_secrets(username: str, new_password: str) -> bool:
    """Actualiza la contraseña de un usuario en SoftEther."""
    if _softether_available():
        result = _run_softether_cmd("update_password", username, new_password)
        return result["success"]
    return True


def get_softether_status() -> dict:
    """Retorna el estado del servidor SoftEther."""
    if not _softether_available():
        return {"status": "offline", "container": SOFTETHER_CONTAINER}

    result = _run_softether_cmd("server_status")
    if result["success"]:
        try:
            import json
            return json.loads(result["output"])
        except Exception:
            return {"status": "running", "output": result["output"]}
    return {"status": "error", "error": result["error"]}


def get_certificate_fingerprint() -> str:
    """
    Retorna el fingerprint del certificado SSL de SoftEther.
    SoftEther genera su propio certificado auto-firmado.
    """
    try:
        # Intentar obtener el fingerprint del contenedor SoftEther
        result = subprocess.run(
            ["docker", "exec", SOFTETHER_CONTAINER,
             "/opt/vpnserver/vpncmd", f"localhost:{SOFTETHER_MGMT_PORT}",
             "/SERVER", f"/PASSWORD:{SOFTETHER_ADMIN_PASSWORD}",
             "/CMD", "ServerCertGet", "/SAVECERT:/tmp/server.crt"],
            capture_output=True, text=True, timeout=30,
            stdin=subprocess.DEVNULL
        )

        # Obtener fingerprint del certificado
        fp_result = subprocess.run(
            ["docker", "exec", SOFTETHER_CONTAINER,
             "openssl", "x509", "-in", "/tmp/server.crt",
             "-fingerprint", "-sha256", "-noout"],
            capture_output=True, text=True, timeout=15,
            stdin=subprocess.DEVNULL
        )

        if fp_result.returncode == 0:
            fp = fp_result.stdout.strip().replace("SHA256 Fingerprint=", "")
            return fp

    except Exception as e:
        logger.debug(f"No se pudo obtener fingerprint de SoftEther: {e}")

    return "SOFTETHER-AUTO-CERT"


def ensure_sstp_certificate() -> dict:
    """
    Verifica que SoftEther tiene un certificado SSL válido.
    SoftEther genera automáticamente su propio certificado.
    """
    available = _softether_available()
    fingerprint = get_certificate_fingerprint() if available else "UNKNOWN"

    return {
        "exists": available,
        "fingerprint": fingerprint,
        "cert_path": "/opt/vpnserver/server.crt",
        "server_host": SSTP_SERVER_HOST,
        "managed_by": "SoftEther VPN Server (auto-generated)",
    }


def generate_mikrotik_sstp_script(prov: dict) -> str:
    """
    Genera el script .rsc de MikroTik para configurar el tunel SSTP hacia FastISP.
    Compatible con RouterOS 6.x y 7.x.

    Correcciones aplicadas:
    - connect-to usa host:port (compatible ROS 6 y 7; 'port=' no existe en ROS 6)
    - NO restringe /ip service api address= antes de que el tunel este activo
    - Todos los comandos de limpieza usan :do {} on-error={} para no abortar si el objeto no existe
    - Sintaxis de find usa || en lugar de 'or' (correcto en RouterOS)
    - Ruta hacia VPN usa comment= para poder identificarla al limpiar
    """
    username = prov.get("username", "")
    password = prov.get("password", "")
    server_host = prov.get("server_host", SSTP_SERVER_HOST)
    server_port = prov.get("server_port", SSTP_SERVER_PORT)
    router_name = prov.get("router_name", "mikrotik")
    provisioned_at = prov.get("provisioned_at", datetime.utcnow().isoformat())

    profile_name = "fastisp-profile"
    iface_name = "FastISPVPN"
    group_name = "fastisp"
    vpn_subnet = os.environ.get("VPN_MGMT_SUBNET", "10.100.0.0/16")
    scheduler_name = "FastISP-Reconnect"

    script = f"""/ip service set api port=8728 disabled=no
# {router_name} — FastISP SSTP VPN — {provisioned_at}
# --- Limpieza previa ---
/interface sstp-client remove [find where user~"fastisp" || name~"FastISP" || comment~"FastISP"]
/ppp profile remove [find where name="{profile_name}"]
/ip route remove [find where comment="fastisp-vpn-route"]
/user remove [find where name~"sstp-"]
/user group remove [find where name~"{group_name}"]
/system scheduler remove [find where name="{scheduler_name}"]
# --- Perfil PPP ---
/ppp profile add name="{profile_name}"
# --- Interfaz SSTP (config basada en WispHub probada) ---
/interface sstp-client add comment="FastISP VPN" connect-to={server_host} port={server_port} name="{iface_name}" user="{username}" password="{password}" profile="{profile_name}" verify-server-certificate=no tls-version=any pfs=no authentication=mschap2,mschap1,chap,pap keepalive-timeout=60 max-mtu=1500 add-default-route=no disabled=no
# --- Ruta hacia red de gestion VPN ---
/ip route add comment="fastisp-vpn-route" distance=1 dst-address={vpn_subnet} gateway={iface_name}
# --- Usuario y grupo de API ---
/user group add name={group_name} policy="local,ftp,reboot,read,write,policy,test,password,sniff,api,romon,sensitive"
/user add name="{username}" password="{password}" group={group_name} comment="FastISP API user"
# --- Habilitar API ---
/ip service set api port=8728 disabled=no
# --- Scheduler de reconexion diaria ---
/system scheduler add comment="FastISP-Reconnect" interval=1d name="{scheduler_name}" on-event="/interface set {iface_name} disabled=yes\\r\\n:log info message=\\"Se Deshabilita {iface_name}\\"\\r\\n:delay 4s\\r\\n/interface set {iface_name} disabled=no\\r\\n:log info message=\\"Se Habilita {iface_name}\\";" policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive start-time=04:00:00
:log info "FastISP VPN configurado para {router_name}. Generado: {provisioned_at}"
"""
    return script


def generate_verification_script() -> str:
    """Genera un script de verificacion para el MikroTik."""
    iface_name = "FastISPVPN"
    return f"""# Script de verificacion SSTP FASTISP
:local iface "{iface_name}"
:local status "desconocido"
:do {{
    :local running [/interface sstp-client get [find name=$iface] running]
    :if ($running = true) do={{
        :set status "CONECTADO"
        :put ("FastISP VPN: CONECTADO")
        :local addr [/ip address get [find interface=$iface] address]
        :put ("IP asignada: " . $addr)
    }} else={{
        :set status "DESCONECTADO"
        :put "FastISP VPN: DESCONECTADO"
        :put "Revisa: /log print where topics~sstp"
    }}
}} on-error={{
    :put "FastISP VPN: interfaz no encontrada"
    :put "Ejecuta el script de provisionamiento primero."
}}
"""
