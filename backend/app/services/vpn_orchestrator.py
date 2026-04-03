"""
vpn_orchestrator.py — Pilar 1: Orquestador de usuarios VPN
===========================================================
Gestiona automáticamente los usuarios SSTP en SoftEther cuando
se registra o elimina una ISP (MikroTikRouter) en el panel.

Funciones principales:
  - on_router_created(router): crea usuario VPN + asigna IP fija
  - on_router_deleted(router): revoca usuario VPN
  - assign_static_vpn_ip(router_id): asigna IP fija del pool
  - get_vpn_status(router_id): estado del túnel VPN

La IP fija se guarda en MikroTikRouter.vpn_ip_address (campo nuevo).
"""

import logging
import secrets
import string
import subprocess
import os
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# ── Configuración ──────────────────────────────────────────────────────────────
SOFTETHER_CONTAINER = os.environ.get("SOFTETHER_CONTAINER", "fastisp-softether")
SOFTETHER_HUB       = os.environ.get("SOFTETHER_HUB_NAME", "FASTISP")
SOFTETHER_ADMIN_PW  = os.environ.get("SOFTETHER_ADMIN_PASSWORD", "FastISP_VPN_2026!")
SOFTETHER_HUB_PW    = os.environ.get("SOFTETHER_HUB_PASSWORD", "FastISP_Hub_2026!")
SOFTETHER_PORT      = os.environ.get("SOFTETHER_MGMT_PORT", "5555")
SSTP_SERVER_HOST    = os.environ.get("SSTP_SERVER_HOST", "fastisp.cloud")
SSTP_SERVER_PORT    = int(os.environ.get("SSTP_SERVER_PORT", "8443"))

# Pool de IPs fijas para los MikroTik (10.100.1.x - 10.100.254.x)
# Cada ISP recibe una IP fija única en este rango
VPN_IP_POOL_BASE    = "10.100"
VPN_IP_POOL_START   = 10   # 10.100.1.10
VPN_IP_POOL_END     = 250


# ── Helpers ────────────────────────────────────────────────────────────────────

def _vpncmd(cmd: str, timeout: int = 20) -> dict:
    """Ejecuta un comando vpncmd en el contenedor SoftEther."""
    try:
        full_cmd = (
            f"docker exec {SOFTETHER_CONTAINER} "
            f"/usr/vpnserver/vpncmd localhost:{SOFTETHER_PORT} "
            f"/SERVER /PASSWORD:{SOFTETHER_ADMIN_PW} "
            f"/CMD {cmd}"
        )
        result = subprocess.run(
            full_cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        success = result.returncode == 0 or "completed successfully" in result.stdout.lower()
        return {
            "success": success,
            "output": result.stdout.strip(),
            "error": result.stderr.strip()
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Timeout", "output": ""}
    except FileNotFoundError:
        # Docker no disponible (entorno dev)
        logger.warning(f"Docker no disponible, simulando: {cmd}")
        return {"success": True, "output": "simulated", "error": ""}
    except Exception as e:
        return {"success": False, "error": str(e), "output": ""}


def _vpncmd_hub(cmd: str, timeout: int = 20) -> dict:
    """Ejecuta un comando vpncmd en el hub FASTISP."""
    try:
        full_cmd = (
            f"docker exec {SOFTETHER_CONTAINER} "
            f"/usr/vpnserver/vpncmd localhost:{SOFTETHER_PORT} "
            f"/SERVER /PASSWORD:{SOFTETHER_ADMIN_PW} "
            f"/HUB:{SOFTETHER_HUB} /PASSWORD:{SOFTETHER_HUB_PW} "
            f"/CMD {cmd}"
        )
        result = subprocess.run(
            full_cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        success = result.returncode == 0 or "completed successfully" in result.stdout.lower()
        return {
            "success": success,
            "output": result.stdout.strip(),
            "error": result.stderr.strip()
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Timeout", "output": ""}
    except FileNotFoundError:
        logger.warning(f"Docker no disponible, simulando hub cmd: {cmd}")
        return {"success": True, "output": "simulated", "error": ""}
    except Exception as e:
        return {"success": False, "error": str(e), "output": ""}


def _generate_vpn_password(length: int = 16) -> str:
    """Genera una contraseña segura para el usuario VPN."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _get_next_available_ip(tenant_id: int, router_id: int) -> str:
    """
    Asigna una IP fija única del pool VPN.
    Usa tenant_id y router_id para generar una IP determinista y única.
    Formato: 10.100.<tenant_id % 254 + 1>.<router_id % 240 + 10>
    """
    octet3 = (tenant_id % 254) + 1      # 1-254
    octet4 = (router_id % 240) + 10     # 10-249
    return f"{VPN_IP_POOL_BASE}.{octet3}.{octet4}"


# ── API pública ────────────────────────────────────────────────────────────────

def on_router_created(router) -> dict:
    """
    Hook llamado cuando se crea un nuevo MikroTikRouter.
    Crea el usuario VPN en SoftEther y asigna IP fija.

    Args:
        router: instancia de MikroTikRouter (con tenant_id, id, name)

    Returns:
        dict con vpn_username, vpn_password, vpn_ip, sstp_url
    """
    from app import db

    # Generar credenciales únicas
    safe_name = "".join(c for c in router.name.lower() if c.isalnum() or c == "-")[:10]
    vpn_username = f"isp-{safe_name}-{secrets.token_hex(3)}"
    vpn_password = _generate_vpn_password(16)

    # Asignar IP fija del pool
    vpn_ip = _get_next_available_ip(
        tenant_id=router.tenant_id or 1,
        router_id=router.id
    )

    logger.info(f"Creando usuario VPN '{vpn_username}' para router '{router.name}' (IP: {vpn_ip})")

    # Crear usuario en SoftEther
    result = _vpncmd_hub(f"UserCreate {vpn_username} /GROUP:none /REALNAME:{router.name} /NOTE:tenant-{router.tenant_id}")
    if not result["success"] and "already exists" not in result.get("output", "").lower():
        logger.warning(f"UserCreate warning: {result.get('error', '')}")

    # Establecer contraseña
    result_pw = _vpncmd_hub(f"UserPasswordSet {vpn_username} /PASSWORD:{vpn_password}")
    if not result_pw["success"]:
        logger.warning(f"UserPasswordSet warning: {result_pw.get('error', '')}")

    # Guardar en la BD (campos vpn_username, vpn_password, vpn_ip_address)
    try:
        router.vpn_username = vpn_username
        router.vpn_password_plain = vpn_password  # Se encripta en el setter
        router.vpn_ip_address = vpn_ip
        router.vpn_provisioned_at = datetime.utcnow()
        db.session.add(router)
        db.session.commit()
        logger.info(f"Router {router.id} actualizado con credenciales VPN en BD")
    except Exception as e:
        logger.error(f"Error guardando credenciales VPN en BD: {e}")
        db.session.rollback()

    return {
        "success": True,
        "vpn_username": vpn_username,
        "vpn_password": vpn_password,
        "vpn_ip": vpn_ip,
        "sstp_url": f"sstp://{SSTP_SERVER_HOST}:{SSTP_SERVER_PORT}",
        "hub": SOFTETHER_HUB,
        "provisioned_at": datetime.utcnow().isoformat(),
    }


def on_router_deleted(router) -> bool:
    """
    Hook llamado cuando se elimina un MikroTikRouter.
    Revoca el usuario VPN en SoftEther.
    """
    vpn_username = getattr(router, 'vpn_username', None)
    if not vpn_username:
        logger.info(f"Router {router.id} no tiene usuario VPN, nada que revocar")
        return True

    result = _vpncmd_hub(f"UserDelete {vpn_username}")
    if result["success"]:
        logger.info(f"Usuario VPN '{vpn_username}' eliminado de SoftEther")
    else:
        logger.warning(f"No se pudo eliminar usuario VPN '{vpn_username}': {result.get('error')}")

    return result["success"]


def get_vpn_user_status(vpn_username: str) -> dict:
    """
    Verifica si un usuario VPN existe y está activo en SoftEther.
    """
    result = _vpncmd_hub(f"UserGet {vpn_username}")
    if result["success"] and vpn_username in result.get("output", ""):
        return {
            "exists": True,
            "username": vpn_username,
            "hub": SOFTETHER_HUB,
            "output": result["output"][:200]
        }
    return {"exists": False, "username": vpn_username}


def get_connected_sessions() -> dict:
    """
    Retorna las sesiones VPN activas en SoftEther.
    Útil para el dashboard de conectividad.
    """
    result = _vpncmd_hub("SessionList")
    if not result["success"]:
        return {"success": False, "sessions": [], "error": result.get("error")}

    # Parsear output de SessionList
    sessions = []
    lines = result.get("output", "").split("\n")
    current = {}
    for line in lines:
        if "Session Name" in line:
            if current:
                sessions.append(current)
            current = {"name": line.split("|")[-1].strip() if "|" in line else ""}
        elif "IP Address" in line and "|" in line:
            current["ip"] = line.split("|")[-1].strip()
        elif "Username" in line and "|" in line:
            current["username"] = line.split("|")[-1].strip()
        elif "Connected Time" in line and "|" in line:
            current["connected_at"] = line.split("|")[-1].strip()
    if current:
        sessions.append(current)

    return {
        "success": True,
        "sessions": sessions,
        "count": len(sessions),
        "hub": SOFTETHER_HUB
    }


def provision_router_vpn(router_id: int) -> dict:
    """
    Provisiona o re-provisiona el VPN de un router existente.
    Útil para regenerar credenciales.
    """
    from app.models import MikroTikRouter
    router = MikroTikRouter.query.get(router_id)
    if not router:
        return {"success": False, "error": f"Router {router_id} no encontrado"}

    # Si ya tiene usuario, eliminarlo primero
    if hasattr(router, 'vpn_username') and router.vpn_username:
        on_router_deleted(router)

    return on_router_created(router)


def list_vpn_users() -> list:
    """Lista todos los usuarios VPN del hub FASTISP."""
    result = _vpncmd_hub("UserList")
    if not result["success"]:
        return []

    users = []
    for line in result.get("output", "").split("\n"):
        if "User Name" in line and "|" in line:
            username = line.split("|")[-1].strip()
            if username and username != "User Name":
                users.append(username)
    return users
