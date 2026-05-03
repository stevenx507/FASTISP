"""
vpn_orchestrator.py — Pilar 1: Orquestador de usuarios VPN
===========================================================
Gestiona automáticamente los usuarios SSTP en SoftEther cuando
se registra o elimina una ISP (MikroTikRouter) en el panel.
"""

import logging
import secrets
import string
import subprocess
import os
from datetime import datetime, timezone
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
VPN_IP_POOL_BASE    = "10.100"

# ── Helpers ────────────────────────────────────────────────────────────────────

def _vpncmd(cmd: str, timeout: int = 20) -> dict:
    """Ejecuta un comando vpncmd en el contenedor SoftEther usando stdin para el password."""
    try:
        # Usamos input en subprocess.run para pasar el password de forma segura y no interactiva
        args = [
            "docker", "exec", "-i", SOFTETHER_CONTAINER,
            "/usr/vpnserver/vpncmd", f"localhost:{SOFTETHER_PORT}", "/SERVER"
        ]
        input_str = f"{SOFTETHER_ADMIN_PW}\n{cmd}\nexit\n"
        
        result = subprocess.run(
            args, input=input_str, capture_output=True, text=True, timeout=timeout
        )
        success = result.returncode == 0 or "completed successfully" in result.stdout.lower()
        return {
            "success": success,
            "output": result.stdout.strip(),
            "error": result.stderr.strip()
        }
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout ejecutando vpncmd: {cmd}")
        return {"success": False, "error": "Timeout", "output": ""}
    except FileNotFoundError:
        logger.warning(f"Docker no disponible, simulando: {cmd}")
        return {"success": True, "output": "simulated", "error": ""}
    except Exception as e:
        logger.error(f"Error inesperado en _vpncmd: {str(e)}")
        return {"success": False, "error": str(e), "output": ""}


def _vpncmd_hub(cmd: str, timeout: int = 20) -> dict:
    """Ejecuta un comando vpncmd en el hub FASTISP usando stdin para los passwords."""
    try:
        # Para comandos de Hub, vpncmd pide primero el password de Admin Server,
        # luego entra al hub y (si el hub tiene password) podría pedirlo.
        # Al usar /HUB:name /PASSWORD:hub_pass en los argumentos, vpncmd suele pedir solo el de Server Admin.
        args = [
            "docker", "exec", "-i", SOFTETHER_CONTAINER,
            "/usr/vpnserver/vpncmd", f"localhost:{SOFTETHER_PORT}", 
            "/SERVER", "/HUB:" + SOFTETHER_HUB, "/PASSWORD:" + SOFTETHER_HUB_PW
        ]
        
        # El primer prompt que encontraremos es el de Server Admin
        input_str = f"{SOFTETHER_ADMIN_PW}\n{cmd}\nexit\n"
        
        result = subprocess.run(
            args, input=input_str, capture_output=True, text=True, timeout=timeout
        )
        success = result.returncode == 0 or "completed successfully" in result.stdout.lower()
        return {
            "success": success,
            "output": result.stdout.strip(),
            "error": result.stderr.strip()
        }
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout ejecutando vpncmd_hub: {cmd}")
        return {"success": False, "error": "Timeout", "output": ""}
    except FileNotFoundError:
        logger.warning(f"Docker no disponible, simulando hub cmd: {cmd}")
        return {"success": True, "output": "simulated", "error": ""}
    except Exception as e:
        logger.error(f"Error inesperado en _vpncmd_hub: {str(e)}")
        return {"success": False, "error": str(e), "output": ""}


def _generate_vpn_password(length: int = 16) -> str:
    """Genera una contraseña segura para el usuario VPN."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _get_next_available_ip(tenant_id: int, router_id: int) -> str:
    """
    Asigna una IP fija única del pool VPN.
    Usa tenant_id y router_id para generar una IP determinista y única.
    """
    octet3 = (tenant_id % 254) + 1      # 1-254
    octet4 = (router_id % 240) + 10     # 10-249
    return f"{VPN_IP_POOL_BASE}.{octet3}.{octet4}"


# ── API pública ────────────────────────────────────────────────────────────────

def on_router_created(router, mode: str = "native") -> dict:
    """
    Provisiona la conectividad del router.
    Soporta dos arquitecturas:
      - 'native': MikroTik es el Servidor SSTP (Requiere IP Pública).
      - 'hub': MikroTik es el Cliente SSTP (Estilo WispHub, recomendado para NAT).
    """
    from app import db
    from app.models import SstpTunnel, _get_fernet
    from app.services.sstp_service import provision_sstp_tunnel, provision_sstp_tunnel_api

    if mode == "native":
        tunnel = SstpTunnel.query.filter_by(router_id=router.id, status='active').first()
        if not tunnel:
            provisioning = provision_sstp_tunnel(router)
            tunnel = SstpTunnel(
                router_id=router.id,
                tenant_id=router.tenant_id,
                username=provisioning["username"],
                server_ip=provisioning["server_ip"],
                client_ip=provisioning["client_ip"],
                server_host=provisioning["server_host"],
                server_port=provisioning["server_port"],
                status="active",
            )
            tunnel.password = provisioning["password"]
            db.session.add(tunnel)
        else:
            provisioning = {
                "username": tunnel.username,
                "password": tunnel.password or "",
                "server_host": tunnel.server_host,
                "server_port": tunnel.server_port,
                "server_ip": tunnel.server_ip,
                "client_ip": tunnel.client_ip,
            }

        router.vpn_username = provisioning["username"]
        router.vpn_ip_address = provisioning["server_ip"]
        router.vpn_password_encrypted = _get_fernet().encrypt(provisioning["password"].encode("utf-8"))
        router.vpn_provisioned_at = datetime.now(timezone.utc)
        db.session.add(router)
        db.session.commit()

        return {
            "success": True,
            "mode": "native",
            "vpn_username": provisioning["username"],
            "vpn_password": provisioning["password"],
            "vpn_ip": provisioning["server_ip"],
            "sstp_url": f"sstp://{provisioning['server_host']}:{provisioning['server_port']}",
            "provisioned_at": datetime.now(timezone.utc).isoformat(),
        }

    else:
        # Modo HUB: SoftEther centralizado
        safe_name = "".join(c for c in router.name.lower() if c.isalnum() or c == "-")[:10]
        vpn_username = f"hub-{safe_name}-{secrets.token_hex(3)}"
        vpn_password = _generate_vpn_password(16)
        vpn_ip = _get_next_available_ip(router.tenant_id or 1, router.id)

        _vpncmd_hub(f"UserCreate {vpn_username} /GROUP:none /REALNAME:{router.name} /NOTE:tenant-{router.tenant_id}")
        _vpncmd_hub(f"UserPasswordSet {vpn_username} /PASSWORD:{vpn_password}")

        router.vpn_username = vpn_username
        router.vpn_ip_address = vpn_ip
        router.vpn_password_encrypted = _get_fernet().encrypt(vpn_password.encode("utf-8"))
        router.vpn_provisioned_at = datetime.now(timezone.utc)
        db.session.add(router)
        db.session.commit()

        return {
            "success": True,
            "mode": "hub",
            "vpn_username": vpn_username,
            "vpn_password": vpn_password,
            "vpn_ip": vpn_ip,
            "server_host": SSTP_SERVER_HOST,
            "server_port": SSTP_SERVER_PORT,
            "sstp_url": f"sstp://{SSTP_SERVER_HOST}:{SSTP_SERVER_PORT}",
            "provisioned_at": datetime.now(timezone.utc).isoformat(),
        }


def on_router_deleted(router) -> bool:
    """Elimina las credenciales VPN y el usuario en SoftEther (si existe)."""
    from app import db
    from app.models import SstpTunnel

    # Limpieza modo Nativo
    tunnel = SstpTunnel.query.filter_by(router_id=router.id, status='active').first()
    if tunnel:
        tunnel.status = 'revoked'
        tunnel.revoked_at = datetime.now(timezone.utc)
        db.session.add(tunnel)

    # Limpieza modo Hub
    if router.vpn_username and router.vpn_username.startswith("hub-"):
        _vpncmd_hub(f"UserDelete {router.vpn_username}")

    router.vpn_username = None
    router.vpn_password_encrypted = None
    router.vpn_ip_address = None
    router.vpn_provisioned_at = None
    db.session.add(router)
    db.session.commit()
    return True


def get_vpn_user_status(vpn_username: str) -> dict:
    """Retorna el estado de conexión del usuario."""
    # Primero buscamos en modo Nativo
    from app.models import SstpTunnel
    tunnel = SstpTunnel.query.filter_by(username=vpn_username).order_by(SstpTunnel.created_at.desc()).first()
    if tunnel:
        return {
            "exists": tunnel.status == "active",
            "username": vpn_username,
            "vpn_ip": tunnel.server_ip,
            "status": tunnel.status,
            "architecture": "mikrotik-native-sstp",
        }

    # Si no, buscamos en SoftEther (Hub)
    result = _vpncmd_hub(f"UserGet {vpn_username}")
    if result["success"]:
        return {
            "exists": True,
            "username": vpn_username,
            "architecture": "softether-hub",
        }

    return {"exists": False, "username": vpn_username}


def get_connected_sessions() -> dict:
    """Retorna lista de sesiones activas en el Hub."""
    result = _vpncmd_hub("SessionList")
    sessions = []
    if result["success"]:
        lines = result.get("output", "").split("\n")
        current = {}
        for line in lines:
            if "Session Name" in line:
                if current: sessions.append(current)
                current = {"name": line.split("|")[-1].strip() if "|" in line else ""}
            elif "Username" in line and "|" in line:
                current["username"] = line.split("|")[-1].strip()
            elif "IP Address" in line and "|" in line:
                current["ip"] = line.split("|")[-1].strip()
        if current: sessions.append(current)

    return {
        "success": True,
        "sessions": sessions,
        "count": len(sessions),
        "hub": SOFTETHER_HUB
    }


def provision_router_vpn(router_id: int) -> dict:
    """Provisiona el VPN por defecto (Nativo) para compatibilidad."""
    from app.models import MikroTikRouter
    router = MikroTikRouter.query.get(router_id)
    if not router: return {"success": False, "error": "Router no encontrado"}
    return on_router_created(router, mode="native")
