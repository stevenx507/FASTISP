"""
heartbeat_service.py — Pilar 2: Monitor de Estado / Heartbeat
==============================================================
Monitorea el estado de los túneles VPN de los MikroTik remotos.

Funciones:
  - check_router_connectivity(router): ping/API check al MikroTik via VPN
  - run_heartbeat_check(): verifica todos los routers activos
  - get_connectivity_dashboard(): estado de todos los routers para el panel
  - record_heartbeat(router_id, status): guarda el estado en BD

El MikroTik envía un heartbeat cada minuto via scheduler RouterOS.
El backend también hace polling activo cada minuto via Celery Beat.
"""

import logging
import socket
import subprocess
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ── Configuración ──────────────────────────────────────────────────────────────
HEARTBEAT_TIMEOUT   = int(os.environ.get("HEARTBEAT_TIMEOUT_SEC", "5"))
OFFLINE_THRESHOLD   = int(os.environ.get("OFFLINE_THRESHOLD_MIN", "3"))   # minutos sin respuesta = offline
VPN_GATEWAY_IP      = os.environ.get("VPN_GATEWAY_IP", "10.100.0.1")


# ── Helpers ────────────────────────────────────────────────────────────────────

def _ping_ip(ip: str, timeout: int = HEARTBEAT_TIMEOUT) -> bool:
    """Hace ping a una IP. Retorna True si responde."""
    try:
        result = subprocess.run(
            ["ping", "-c", "1", "-W", str(timeout), ip],
            capture_output=True, timeout=timeout + 2
        )
        return result.returncode == 0
    except Exception:
        return False


def _tcp_check(ip: str, port: int, timeout: int = HEARTBEAT_TIMEOUT) -> bool:
    """Verifica si un puerto TCP está abierto."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((ip, port))
        sock.close()
        return result == 0
    except Exception:
        return False


def _check_mikrotik_api(ip: str, port: int = 8728, timeout: int = HEARTBEAT_TIMEOUT) -> bool:
    """Verifica si la API de MikroTik responde en la IP VPN."""
    return _tcp_check(ip, port, timeout)


# ── API pública ────────────────────────────────────────────────────────────────

def check_router_connectivity(router) -> dict:
    """
    Verifica la conectividad de un router MikroTik via VPN.
    Intenta:
    1. Ping a la IP VPN del router
    2. TCP check al puerto API (8728)
    3. Verificar last_seen en BD

    Returns:
        dict con status, latency_ms, method, checked_at
    """
    from app import db

    vpn_ip = getattr(router, 'vpn_ip_address', None)
    router_ip = router.ip_address  # IP pública o VPN

    # Determinar IP a verificar (preferir VPN)
    check_ip = vpn_ip if vpn_ip else router_ip
    status = "unknown"
    method = "none"
    latency_ms = None

    if check_ip and check_ip not in ("", "0.0.0.0"):
        # Intentar ping
        import time
        start = time.time()
        ping_ok = _ping_ip(check_ip)
        latency_ms = round((time.time() - start) * 1000, 1)

        if ping_ok:
            status = "online"
            method = "ping"
        else:
            # Intentar TCP check en puerto API
            api_ok = _check_mikrotik_api(check_ip, router.api_port or 8728)
            if api_ok:
                status = "online"
                method = "tcp_api"
                latency_ms = None
            else:
                status = "offline"
                method = "ping+tcp_failed"
                latency_ms = None
    else:
        status = "no_vpn_ip"
        method = "no_ip_configured"

    # Actualizar last_seen en BD si está online
    now = datetime.now(timezone.utc)
    if status == "online":
        try:
            router.last_seen = now
            router.is_active = True
            db.session.add(router)
            db.session.commit()
        except Exception as e:
            logger.warning(f"No se pudo actualizar last_seen del router {router.id}: {e}")
            db.session.rollback()
    elif status == "offline":
        # Verificar si lleva más de OFFLINE_THRESHOLD minutos sin responder
        last_seen = router.last_seen
        if last_seen and (now - last_seen) > timedelta(minutes=OFFLINE_THRESHOLD):
            try:
                router.is_active = False
                db.session.add(router)
                db.session.commit()
            except Exception:
                db.session.rollback()

    return {
        "router_id": router.id,
        "router_name": router.name,
        "check_ip": check_ip,
        "vpn_ip": vpn_ip,
        "status": status,
        "method": method,
        "latency_ms": latency_ms,
        "last_seen": router.last_seen.isoformat() if router.last_seen else None,
        "checked_at": now.isoformat(),
    }


def run_heartbeat_check() -> dict:
    """
    Verifica todos los routers activos.
    Llamado por Celery Beat cada minuto.

    Returns:
        dict con resumen: online, offline, unknown, total
    """
    from app.models import MikroTikRouter

    routers = MikroTikRouter.query.all()
    results = []
    online = 0
    offline = 0
    unknown = 0

    for router in routers:
        try:
            result = check_router_connectivity(router)
            results.append(result)

            if result["status"] == "online":
                online += 1
            elif result["status"] == "offline":
                offline += 1
                # Generar alerta si acaba de caerse
                _trigger_offline_alert(router, result)
            else:
                unknown += 1

        except Exception as e:
            logger.error(f"Error verificando router {router.id}: {e}")
            unknown += 1

    summary = {
        "total": len(routers),
        "online": online,
        "offline": offline,
        "unknown": unknown,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
    logger.info(f"Heartbeat check: {summary}")
    return summary


def _trigger_offline_alert(router, check_result: dict) -> None:
    """
    Genera una alerta cuando un router se detecta offline.
    Guarda en AdminScreenAlert para mostrar en el panel.
    """
    try:
        from app import db
        from app.models import AdminScreenAlert
        import uuid

        # Verificar si ya existe una alerta activa para este router
        existing = AdminScreenAlert.query.filter_by(
            tenant_id=router.tenant_id,
            status='active'
        ).filter(
            AdminScreenAlert.title.like(f"%{router.name}%")
        ).first()

        if existing:
            return  # Ya hay alerta activa

        alert = AdminScreenAlert(
            id=str(uuid.uuid4()),
            tenant_id=router.tenant_id,
            title=f"MikroTik Offline: {router.name}",
            message=(
                f"El router '{router.name}' no responde desde hace "
                f"{OFFLINE_THRESHOLD}+ minutos. "
                f"IP VPN: {check_result.get('vpn_ip', 'N/A')}. "
                f"Último contacto: {check_result.get('last_seen', 'Desconocido')}. "
                f"Verificar el túnel SSTP en el MikroTik."
            ),
            severity='critical',
            audience='admin',
            status='active',
            starts_at=datetime.now(timezone.utc),
        )
        db.session.add(alert)
        db.session.commit()
        logger.warning(f"Alerta generada: MikroTik Offline - {router.name}")

        # Emitir via WebSockets para el panel administrativo
        try:
            from app import socketio
            socketio.emit('noc_alert', {
                'id': alert.id,
                'router_id': router.id,
                'router_name': router.name,
                'title': alert.title,
                'message': alert.message,
                'severity': alert.severity,
                'timestamp': alert.starts_at.isoformat()
            })
        except Exception as ws_err:
            logger.error(f"Error emitting socketio alert: {ws_err}")

    except Exception as e:
        logger.error(f"Error generando alerta offline para router {router.id}: {e}")


def get_connectivity_dashboard() -> dict:
    """
    Retorna el estado de conectividad de todos los routers para el panel.
    Incluye: status, last_seen, vpn_ip, latency.
    """
    from app.models import MikroTikRouter

    routers = MikroTikRouter.query.all()
    now = datetime.now(timezone.utc)
    dashboard = []

    for router in routers:
        last_seen = router.last_seen
        vpn_ip = getattr(router, 'vpn_ip_address', None)

        # Determinar status basado en last_seen
        if last_seen:
            minutes_ago = (now - last_seen).total_seconds() / 60
            if minutes_ago <= OFFLINE_THRESHOLD:
                status = "online"
            elif minutes_ago <= 15:
                status = "warning"
            else:
                status = "offline"
        else:
            status = "never_connected"

        dashboard.append({
            "router_id": router.id,
            "router_name": router.name,
            "tenant_id": router.tenant_id,
            "status": status,
            "vpn_ip": vpn_ip,
            "last_seen": last_seen.isoformat() if last_seen else None,
            "minutes_since_seen": round((now - last_seen).total_seconds() / 60, 1) if last_seen else None,
            "is_active": router.is_active,
            "api_port": router.api_port,
        })

    online_count = sum(1 for r in dashboard if r["status"] == "online")
    offline_count = sum(1 for r in dashboard if r["status"] == "offline")

    return {
        "routers": dashboard,
        "summary": {
            "total": len(dashboard),
            "online": online_count,
            "offline": offline_count,
            "warning": sum(1 for r in dashboard if r["status"] == "warning"),
            "never_connected": sum(1 for r in dashboard if r["status"] == "never_connected"),
        },
        "generated_at": now.isoformat(),
    }


def record_heartbeat_from_mikrotik(router_id: int, vpn_ip: str = None) -> dict:
    """
    Endpoint llamado por el scheduler del MikroTik cada minuto.
    Actualiza last_seen del router.

    URL: POST /api/heartbeat
    Body: { "router_id": 1, "vpn_ip": "10.100.1.10" }
    """
    from app import db
    from app.models import MikroTikRouter

    router = MikroTikRouter.query.get(router_id)
    if not router:
        return {"success": False, "error": "Router no encontrado"}

    now = datetime.now(timezone.utc)
    router.last_seen = now
    router.is_active = True

    # Actualizar IP VPN si se envió
    if vpn_ip and hasattr(router, 'vpn_ip_address'):
        router.vpn_ip_address = vpn_ip

    try:
        db.session.add(router)
        db.session.commit()
        logger.debug(f"Heartbeat recibido de router {router_id} ({router.name})")
        return {
            "success": True,
            "router_id": router_id,
            "router_name": router.name,
            "recorded_at": now.isoformat(),
        }
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error guardando heartbeat del router {router_id}: {e}")
        return {"success": False, "error": str(e)}
