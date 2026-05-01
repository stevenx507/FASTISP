"""
mikrotik_commands.py — Pilar 4: Plantillas de comandos MikroTik
================================================================
Funciones para ejecutar comandos en MikroTik via API RouterOS:
  - Corte por falta de pago (Address List de morosos)
  - Control de ancho de banda (Simple Queues)
  - Lectura de tráfico (interface stats)
  - Seguridad API (restricción por IP)

Todas las funciones reciben un objeto MikroTikService ya conectado
o un router_id para conectarse internamente.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ── Constantes ─────────────────────────────────────────────────────────────────
DELINQUENT_LIST = "fastisp-morosos"       # Address list de morosos
BLOCKED_LIST    = "fastisp-bloqueados"    # Address list de bloqueados permanentes
FASTISP_VPN_IP  = "10.100.0.1"           # IP del servidor FASTISP en la VPN


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_service(router_id: int = None, service=None):
    """Retorna un MikroTikService conectado."""
    if service:
        return service, False  # (service, should_close)
    from app.services.mikrotik_service import MikroTikService
    svc = MikroTikService(router_id=router_id)
    return svc, True


# ══════════════════════════════════════════════════════════════════════════════
# PILAR 4A — Corte por falta de pago
# ══════════════════════════════════════════════════════════════════════════════

def suspend_client_by_ip(router_id: int, client_ip: str, client_name: str = "") -> dict:
    """
    Agrega la IP del cliente a la Address List de morosos en MikroTik.
    El firewall del MikroTik debe tener una regla que bloquee esta lista.

    RouterOS equivalente:
      /ip firewall address-list add list=fastisp-morosos address=<ip> comment=<name>
    """
    svc, should_close = _get_service(router_id)
    try:
        if not svc.api:
            return {"success": False, "error": "No se pudo conectar al router"}

        # Verificar si ya está en la lista
        existing = svc.api.get_resource('/ip/firewall/address-list')
        entries = existing.get(list=DELINQUENT_LIST, address=client_ip)
        if entries:
            logger.info(f"IP {client_ip} ya está en lista {DELINQUENT_LIST}")
            return {"success": True, "action": "already_suspended", "ip": client_ip}

        # Agregar a la lista de morosos
        existing.add(
            list=DELINQUENT_LIST,
            address=client_ip,
            comment=f"FASTISP-MOROSO: {client_name} - {datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
            timeout=""  # Sin expiración automática
        )

        # Asegurar que existe la regla de firewall que bloquea la lista
        _ensure_firewall_rules(svc)

        logger.info(f"Cliente {client_name} ({client_ip}) suspendido en router {router_id}")
        return {"success": True, "action": "suspended", "ip": client_ip, "list": DELINQUENT_LIST}

    except Exception as e:
        logger.error(f"Error suspendiendo cliente {client_ip}: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if should_close:
            svc.disconnect()


def restore_client_by_ip(router_id: int, client_ip: str) -> dict:
    """
    Elimina la IP del cliente de la Address List de morosos.
    Reactiva el servicio del cliente.
    """
    svc, should_close = _get_service(router_id)
    try:
        if not svc.api:
            return {"success": False, "error": "No se pudo conectar al router"}

        addr_list = svc.api.get_resource('/ip/firewall/address-list')
        entries = addr_list.get(list=DELINQUENT_LIST, address=client_ip)

        if not entries:
            return {"success": True, "action": "not_in_list", "ip": client_ip}

        for entry in entries:
            addr_list.remove(id=entry['id'])

        logger.info(f"Cliente {client_ip} reactivado en router {router_id}")
        return {"success": True, "action": "restored", "ip": client_ip}

    except Exception as e:
        logger.error(f"Error reactivando cliente {client_ip}: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if should_close:
            svc.disconnect()


def _ensure_firewall_rules(svc) -> None:
    """
    Asegura que existen las reglas de firewall para bloquear la lista de morosos.
    Solo crea las reglas si no existen.
    """
    try:
        fw = svc.api.get_resource('/ip/firewall/filter')
        rules = fw.get(comment="FASTISP-BLOCK-MOROSOS")
        if not rules:
            # Regla para bloquear forward de morosos
            fw.add(
                chain="forward",
                src_address_list=DELINQUENT_LIST,
                action="drop",
                comment="FASTISP-BLOCK-MOROSOS",
                place_before=""  # Al final
            )
            logger.info("Regla de firewall FASTISP-BLOCK-MOROSOS creada")
    except Exception as e:
        logger.warning(f"No se pudo verificar reglas de firewall: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# PILAR 4B — Control de ancho de banda (Simple Queues)
# ══════════════════════════════════════════════════════════════════════════════

def set_client_bandwidth(router_id: int, client_ip: str, client_name: str,
                          download_mbps: int, upload_mbps: int) -> dict:
    """
    Crea o actualiza una Simple Queue para controlar el ancho de banda del cliente.

    RouterOS equivalente:
      /queue simple add name=<name> target=<ip> max-limit=<up>M/<down>M
    """
    svc, should_close = _get_service(router_id)
    try:
        if not svc.api:
            return {"success": False, "error": "No se pudo conectar al router"}

        queues = svc.api.get_resource('/queue/simple')
        queue_name = f"fastisp-{client_ip.replace('.', '-')}"
        max_limit = f"{upload_mbps}M/{download_mbps}M"

        existing = queues.get(name=queue_name)
        if existing:
            # Actualizar queue existente
            queues.set(id=existing[0]['id'], **{
                'max-limit': max_limit,
                'comment': f"FASTISP: {client_name} - {download_mbps}Mbps down / {upload_mbps}Mbps up"
            })
            action = "updated"
        else:
            # Crear nueva queue
            queues.add(**{
                'name': queue_name,
                'target': f"{client_ip}/32",
                'max-limit': max_limit,
                'burst-limit': f"{int(upload_mbps * 1.5)}M/{int(download_mbps * 1.5)}M",
                'burst-threshold': f"{int(upload_mbps * 0.8)}M/{int(download_mbps * 0.8)}M",
                'burst-time': "8/8",
                'comment': f"FASTISP: {client_name} - {download_mbps}Mbps down / {upload_mbps}Mbps up"
            })
            action = "created"

        logger.info(f"Queue {queue_name}: {max_limit} ({action}) en router {router_id}")
        return {
            "success": True,
            "action": action,
            "queue_name": queue_name,
            "max_limit": max_limit,
            "ip": client_ip
        }

    except Exception as e:
        logger.error(f"Error configurando queue para {client_ip}: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if should_close:
            svc.disconnect()


def remove_client_bandwidth(router_id: int, client_ip: str) -> dict:
    """Elimina la Simple Queue de un cliente."""
    svc, should_close = _get_service(router_id)
    try:
        if not svc.api:
            return {"success": False, "error": "No se pudo conectar al router"}

        queues = svc.api.get_resource('/queue/simple')
        queue_name = f"fastisp-{client_ip.replace('.', '-')}"
        existing = queues.get(name=queue_name)

        if existing:
            queues.remove(id=existing[0]['id'])
            return {"success": True, "action": "removed", "queue_name": queue_name}
        return {"success": True, "action": "not_found", "queue_name": queue_name}

    except Exception as e:
        logger.error(f"Error eliminando queue para {client_ip}: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if should_close:
            svc.disconnect()


def throttle_client(router_id: int, client_ip: str, client_name: str,
                     throttle_kbps: int = 512) -> dict:
    """
    Reduce el ancho de banda de un cliente a velocidad mínima (throttle).
    Útil para avisar de deuda sin cortar completamente.
    """
    return set_client_bandwidth(
        router_id, client_ip, client_name,
        download_mbps=throttle_kbps // 1024 or 1,
        upload_mbps=throttle_kbps // 1024 or 1
    )


# ══════════════════════════════════════════════════════════════════════════════
# PILAR 4C — Lectura de tráfico
# ══════════════════════════════════════════════════════════════════════════════

def get_client_traffic(router_id: int, client_ip: str) -> dict:
    """
    Lee el tráfico actual de un cliente desde su Simple Queue.
    Retorna bytes TX/RX y velocidad actual.
    """
    svc, should_close = _get_service(router_id)
    try:
        if not svc.api:
            return {"success": False, "error": "No se pudo conectar al router"}

        queue_name = f"fastisp-{client_ip.replace('.', '-')}"
        queues = svc.api.get_resource('/queue/simple')
        entries = queues.get(name=queue_name)

        if not entries:
            return {"success": False, "error": f"No hay queue para {client_ip}"}

        q = entries[0]
        return {
            "success": True,
            "ip": client_ip,
            "queue_name": queue_name,
            "bytes_in": int(q.get('bytes', '0/0').split('/')[0]),
            "bytes_out": int(q.get('bytes', '0/0').split('/')[1]),
            "packets_in": int(q.get('packets', '0/0').split('/')[0]),
            "packets_out": int(q.get('packets', '0/0').split('/')[1]),
            "rate_in": q.get('rate', '0/0').split('/')[0],
            "rate_out": q.get('rate', '0/0').split('/')[1],
            "max_limit": q.get('max-limit', ''),
            "disabled": q.get('disabled', 'false') == 'true',
        }

    except Exception as e:
        logger.error(f"Error leyendo tráfico de {client_ip}: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if should_close:
            svc.disconnect()


def get_router_interface_traffic(router_id: int, interface_name: str = None) -> dict:
    """
    Lee estadísticas de tráfico de interfaces del router.
    Si interface_name es None, retorna todas las interfaces activas.
    """
    svc, should_close = _get_service(router_id)
    try:
        if not svc.api:
            return {"success": False, "error": "No se pudo conectar al router"}

        ifaces = svc.api.get_resource('/interface')
        if interface_name:
            entries = ifaces.get(name=interface_name)
        else:
            entries = ifaces.get()

        result = []
        for iface in entries:
            if iface.get('running') == 'true':
                result.append({
                    "name": iface.get('name'),
                    "type": iface.get('type'),
                    "rx_bytes": int(iface.get('rx-byte', 0)),
                    "tx_bytes": int(iface.get('tx-byte', 0)),
                    "rx_packets": int(iface.get('rx-packet', 0)),
                    "tx_packets": int(iface.get('tx-packet', 0)),
                    "rx_errors": int(iface.get('rx-error', 0)),
                    "tx_errors": int(iface.get('tx-error', 0)),
                    "running": True,
                    "mac": iface.get('mac-address', ''),
                })

        return {"success": True, "interfaces": result, "count": len(result)}

    except Exception as e:
        logger.error(f"Error leyendo interfaces del router {router_id}: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if should_close:
            svc.disconnect()


def get_active_connections(router_id: int) -> dict:
    """
    Retorna las conexiones activas del router (IP connections).
    Útil para ver qué clientes están conectados en tiempo real.
    """
    svc, should_close = _get_service(router_id)
    try:
        if not svc.api:
            return {"success": False, "error": "No se pudo conectar al router"}

        connections = svc.api.get_resource('/ip/firewall/connection')
        entries = connections.get()

        # Agrupar por IP origen
        client_stats = {}
        for conn in entries[:500]:  # Limitar a 500 conexiones
            src_ip = conn.get('src-address', '').split(':')[0]
            if src_ip:
                if src_ip not in client_stats:
                    client_stats[src_ip] = {"connections": 0, "bytes": 0}
                client_stats[src_ip]["connections"] += 1
                client_stats[src_ip]["bytes"] += int(conn.get('orig-bytes', 0))

        return {
            "success": True,
            "total_connections": len(entries),
            "unique_clients": len(client_stats),
            "clients": client_stats
        }

    except Exception as e:
        logger.error(f"Error leyendo conexiones del router {router_id}: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if should_close:
            svc.disconnect()


# ══════════════════════════════════════════════════════════════════════════════
# PILAR 3 — Seguridad API REST (restricción por IP)
# ══════════════════════════════════════════════════════════════════════════════

def secure_mikrotik_api(router_id: int, allowed_ip: str = FASTISP_VPN_IP) -> dict:
    """
    Configura el MikroTik para que solo acepte conexiones API
    desde la IP interna del servidor FASTISP (via VPN).

    RouterOS equivalente:
      /ip service set api address=<allowed_ip>/32
      /ip service set api-ssl address=<allowed_ip>/32
    """
    svc, should_close = _get_service(router_id)
    try:
        if not svc.api:
            return {"success": False, "error": "No se pudo conectar al router"}

        services = svc.api.get_resource('/ip/service')

        # Restringir API (puerto 8728)
        api_entries = services.get(name='api')
        if api_entries:
            services.set(id=api_entries[0]['id'], address=f"{allowed_ip}/32")

        # Restringir API-SSL (puerto 8729)
        api_ssl_entries = services.get(name='api-ssl')
        if api_ssl_entries:
            services.set(id=api_ssl_entries[0]['id'], address=f"{allowed_ip}/32")

        # Deshabilitar servicios innecesarios (telnet, ftp)
        for svc_name in ['telnet', 'ftp']:
            entries = services.get(name=svc_name)
            if entries:
                services.set(id=entries[0]['id'], disabled='yes')

        logger.info(f"API de router {router_id} restringida a {allowed_ip}")
        return {
            "success": True,
            "action": "api_secured",
            "allowed_ip": allowed_ip,
            "router_id": router_id
        }

    except Exception as e:
        logger.error(f"Error asegurando API del router {router_id}: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if should_close:
            svc.disconnect()


def add_firewall_protection(router_id: int, server_vpn_ip: str = FASTISP_VPN_IP) -> dict:
    """
    Agrega reglas de firewall en el MikroTik para:
    1. Permitir API solo desde el servidor FASTISP
    2. Bloquear intentos de fuerza bruta en la API
    """
    svc, should_close = _get_service(router_id)
    try:
        if not svc.api:
            return {"success": False, "error": "No se pudo conectar al router"}

        fw = svc.api.get_resource('/ip/firewall/filter')
        rules_added = []

        # Regla 1: Permitir API desde servidor FASTISP
        existing = fw.get(comment="FASTISP-ALLOW-API")
        if not existing:
            fw.add(**{
                'chain': 'input',
                'protocol': 'tcp',
                'dst-port': '8728,8729',
                'src-address': f"{server_vpn_ip}/32",
                'action': 'accept',
                'comment': 'FASTISP-ALLOW-API',
                'place-before': ''
            })
            rules_added.append("FASTISP-ALLOW-API")

        # Regla 2: Bloquear API desde otras IPs
        existing2 = fw.get(comment="FASTISP-BLOCK-API-EXTERNAL")
        if not existing2:
            fw.add(**{
                'chain': 'input',
                'protocol': 'tcp',
                'dst-port': '8728,8729',
                'action': 'drop',
                'comment': 'FASTISP-BLOCK-API-EXTERNAL',
                'place-before': ''
            })
            rules_added.append("FASTISP-BLOCK-API-EXTERNAL")

        logger.info(f"Firewall de router {router_id} configurado. Reglas: {rules_added}")
        return {
            "success": True,
            "rules_added": rules_added,
            "server_vpn_ip": server_vpn_ip
        }

    except Exception as e:
        logger.error(f"Error configurando firewall del router {router_id}: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if should_close:
            svc.disconnect()


# ══════════════════════════════════════════════════════════════════════════════
# PILAR 4D — Script completo de onboarding MikroTik
# ══════════════════════════════════════════════════════════════════════════════

def generate_onboarding_script(router_id: int, vpn_username: str, vpn_password: str,
                                 server_host: str, server_port: int = 8443,
                                 server_vpn_ip: str = FASTISP_VPN_IP) -> str:
    """
    Genera el script RouterOS completo para configurar un MikroTik nuevo:
    1. Túnel SSTP hacia FASTISP
    2. Restricción de API por IP
    3. Reglas de firewall básicas
    4. Scheduler de heartbeat
    """
    from app.models import MikroTikRouter
    router = MikroTikRouter.query.get(router_id)
    router_name = router.name if router else f"router-{router_id}"

    return f"""# ============================================================
# FASTISP — Script de Onboarding Completo
# Router: {router_name}
# Generado: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}
# ============================================================

# ── 1. Túnel SSTP hacia FASTISP ──────────────────────────
/interface sstp-client
remove [find name="sstp-fastisp"]
add name="sstp-fastisp" \\
    connect-to={server_host} \\
    port={server_port} \\
    user="{vpn_username}" \\
    password="{vpn_password}" \\
    verify-server-certificate=no \\
    disabled=no \\
    comment="FASTISP VPN - {router_name}"

# ── 2. Esperar conexión VPN ──────────────────────────────
:delay 8s
:local vpnRunning [/interface sstp-client get sstp-fastisp running]
:if ($vpnRunning = false) do={{
    :log error "FASTISP: Tunel SSTP no conectado. Verificar credenciales."
    :error "SSTP no conectado"
}}
:log info "FASTISP: Tunel SSTP conectado exitosamente"

# ── 3. Ruta hacia servidor FASTISP via VPN ───────────────
/ip route
remove [find comment="FASTISP-MGMT-ROUTE"]
add dst-address={server_vpn_ip}/32 \\
    gateway=sstp-fastisp \\
    comment="FASTISP-MGMT-ROUTE"

# ── 4. Restringir API solo a servidor FASTISP ────────────
/ip service
set api address={server_vpn_ip}/32 disabled=no
set api-ssl address={server_vpn_ip}/32 disabled=no
set telnet disabled=yes
set ftp disabled=yes
set www disabled=no

# ── 5. Reglas de firewall para proteger la API ───────────
/ip firewall filter
remove [find comment="FASTISP-ALLOW-API"]
remove [find comment="FASTISP-BLOCK-API-EXTERNAL"]
add chain=input protocol=tcp dst-port=8728,8729 \\
    src-address={server_vpn_ip}/32 action=accept \\
    comment="FASTISP-ALLOW-API" place-before=0
add chain=input protocol=tcp dst-port=8728,8729 \\
    action=drop \\
    comment="FASTISP-BLOCK-API-EXTERNAL"

# ── 6. Address list para morosos (vacía inicialmente) ────
/ip firewall address-list
remove [find list="fastisp-morosos"]
/ip firewall filter
remove [find comment="FASTISP-BLOCK-MOROSOS"]
add chain=forward src-address-list=fastisp-morosos \\
    action=drop \\
    comment="FASTISP-BLOCK-MOROSOS"

# ── 7. Scheduler de heartbeat (ping al servidor) ─────────
/system scheduler
remove [find name="fastisp-heartbeat"]
add name="fastisp-heartbeat" \\
    interval=1m \\
    on-event="/tool fetch url=\\"http://{server_vpn_ip}:5000/api/heartbeat\\" keep-result=no" \\
    comment="FASTISP Heartbeat"

# ── 8. Verificación final ────────────────────────────────
:delay 3s
:put "============================================"
:put "FASTISP Onboarding completado"
:put ("VPN: " . [/interface sstp-client get sstp-fastisp running])
:put ("IP VPN: " . [/ip address get [find interface=sstp-fastisp] address])
:put "============================================"
:log info "FASTISP: Onboarding completado para {router_name}"
"""
