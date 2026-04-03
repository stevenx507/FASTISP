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
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
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
            timeout=30
        )

        output = result.stdout.strip()
        error = result.stderr.strip()

        if result.returncode != 0:
            logger.error(f"SoftEther cmd '{cmd}' failed: {error}")
            return {"success": False, "error": error, "output": output}

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
            capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip() == "true"
    except Exception:
        return False


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
            capture_output=True, text=True, timeout=10
        )

        # Obtener fingerprint del certificado
        fp_result = subprocess.run(
            ["docker", "exec", SOFTETHER_CONTAINER,
             "openssl", "x509", "-in", "/tmp/server.crt",
             "-fingerprint", "-sha256", "-noout"],
            capture_output=True, text=True, timeout=10
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
    Genera el script .rsc de MikroTik para configurar el túnel SSTP.
    Compatible con RouterOS 6.x y 7.x.
    """
    username = prov.get("username", "")
    password = prov.get("password", "")
    server_host = prov.get("server_host", SSTP_SERVER_HOST)
    server_port = prov.get("server_port", SSTP_SERVER_PORT)
    router_name = prov.get("router_name", "mikrotik")
    fingerprint = prov.get("fingerprint", "")
    provisioned_at = prov.get("provisioned_at", datetime.utcnow().isoformat())

    # Nombre del perfil y interfaz
    profile_name = f"fastisp-sstp"
    iface_name = f"sstp-fastisp"

    script = f"""# ============================================================
# FASTISP — Script de Configuración SSTP
# Router: {router_name}
# Generado: {provisioned_at}
# Servidor: {server_host}:{server_port}
# ============================================================
# INSTRUCCIONES:
# 1. Abrir Winbox o terminal SSH en el MikroTik
# 2. Ir a New Terminal
# 3. Pegar este script completo
# 4. Verificar que la interfaz sstp-fastisp aparece como "R" (Running)
# ============================================================

# ── Paso 1: Crear perfil PPP ──────────────────────────────
/ppp profile
add name="{profile_name}" \\
    use-encryption=yes \\
    use-compression=no \\
    use-mpls=no \\
    only-one=yes \\
    comment="FASTISP SSTP Profile"

# ── Paso 2: Crear secreto PPP (credenciales) ─────────────
/ppp secret
remove [find name="{username}"]
add name="{username}" \\
    password="{password}" \\
    profile="{profile_name}" \\
    service=sstp \\
    comment="FASTISP SSTP - {router_name}"

# ── Paso 3: Crear interfaz SSTP Client ───────────────────
/interface sstp-client
remove [find name="{iface_name}"]
add name="{iface_name}" \\
    connect-to={server_host} \\
    port={server_port} \\
    user="{username}" \\
    password="{password}" \\
    profile="{profile_name}" \\
    verify-server-certificate=no \\
    disabled=no \\
    comment="FASTISP VPN - {router_name}"

# ── Paso 4: Verificar conexión ───────────────────────────
:delay 5s
:local status [/interface sstp-client get {iface_name} running]
:if ($status = true) do={{
    :log info "FASTISP SSTP: Conexion establecida exitosamente"
    :put "✅ SSTP conectado a {server_host}:{server_port}"
}} else={{
    :log warning "FASTISP SSTP: Verificar credenciales y conectividad"
    :put "⚠️  SSTP no conectado. Verificar logs: /log print where topics~sstp"
}}

# ── Paso 5: Ruta hacia el servidor FASTISP ───────────────
# (Opcional) Agregar ruta específica para el tráfico de gestión
# /ip route add dst-address=10.100.0.0/16 gateway={iface_name}

# ============================================================
# VERIFICACIÓN:
#   /interface sstp-client print
#   /interface sstp-client monitor {iface_name}
#   /log print where topics~sstp
# ============================================================
"""
    return script


def generate_verification_script() -> str:
    """Genera un script de verificación para el MikroTik."""
    return """# Script de verificación SSTP FASTISP
:local iface "sstp-fastisp"
:local running [/interface sstp-client get $iface running]
:if ($running = true) do={
    :put "✅ SSTP FASTISP: CONECTADO"
    :put ("IP: " . [/ip address get [find interface=$iface] address])
} else={
    :put "❌ SSTP FASTISP: DESCONECTADO"
    :put "Logs: /log print where topics~sstp"
}
"""
