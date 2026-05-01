"""
isp_management.py — Rutas API para los 4 pilares ISP
=====================================================
Endpoints REST para:
  - Heartbeat (Pilar 2): POST /api/heartbeat, GET /api/connectivity
  - Comandos MikroTik (Pilar 4): suspend, restore, bandwidth, traffic
  - VPN Orchestrator (Pilar 1): provision, status
  - Seguridad (Pilar 3): secure_api, onboarding_script
"""

from flask import Blueprint, request, jsonify, current_app
from datetime import datetime
from flask_jwt_extended import jwt_required, get_jwt_identity

bp = Blueprint('isp_management', __name__, url_prefix='/api')


# ══════════════════════════════════════════════════════════════════════════════
# PILAR 2 — Heartbeat / Monitor de conectividad
# ══════════════════════════════════════════════════════════════════════════════

@bp.route('/heartbeat', methods=['POST'])
def receive_heartbeat():
    """
    Recibe heartbeat del MikroTik (llamado por scheduler RouterOS cada minuto).
    No requiere autenticación (viene de la red VPN interna).

    Body: { "router_id": 1, "vpn_ip": "10.100.1.10" }
    """
    # Solo aceptar desde red VPN interna (10.100.x.x), red Docker (172.16-31.x.x) o localhost
    client_ip = request.remote_addr or ""
    # Obtener IP real si viene detrás de proxy
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    
    allowed = (
        client_ip.startswith("10.100.")   # Red VPN SSTP
        or client_ip.startswith("10.0.")   # Red interna alternativa
        or client_ip.startswith("127.")    # Localhost
        or client_ip == "::1"             # Localhost IPv6
        or (client_ip.startswith("172.") and  # Solo redes Docker privadas (172.16-31.x.x)
            any(client_ip.startswith(f"172.{i}.") for i in range(16, 32)))
    )
    if not allowed:
        current_app.logger.warning(f"Heartbeat rechazado desde IP: {client_ip}")
        return jsonify({"error": "Acceso denegado"}), 403

    data = request.get_json(silent=True) or {}
    router_id = data.get("router_id")
    vpn_ip = data.get("vpn_ip")

    if not router_id:
        return jsonify({"error": "router_id requerido"}), 400

    try:
        from app.services.heartbeat_service import record_heartbeat_from_mikrotik
        result = record_heartbeat_from_mikrotik(int(router_id), vpn_ip)
        return jsonify(result), 200 if result.get("success") else 404
    except Exception as e:
        current_app.logger.error(f"Error en heartbeat: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route('/connectivity', methods=['GET'])
@jwt_required()
def get_connectivity_dashboard():
    """
    Dashboard de conectividad de todos los routers.
    Requiere autenticación de admin.
    GET /api/connectivity
    """
    try:
        from app.services.heartbeat_service import get_connectivity_dashboard
        data = get_connectivity_dashboard()
        return jsonify(data), 200
    except Exception as e:
        current_app.logger.error(f"Error en connectivity dashboard: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route('/connectivity/<int:router_id>', methods=['GET'])
@jwt_required()
def check_router_status(router_id):
    """
    Verifica el estado de un router específico en tiempo real.
    GET /api/connectivity/<router_id>
    """
    try:
        from app.models import MikroTikRouter
        from app.services.heartbeat_service import check_router_connectivity
        router = MikroTikRouter.query.get_or_404(router_id)
        result = check_router_connectivity(router)
        return jsonify(result), 200
    except Exception as e:
        current_app.logger.error(f"Error verificando router {router_id}: {e}")
        return jsonify({"error": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# PILAR 4 — Comandos MikroTik
# ══════════════════════════════════════════════════════════════════════════════

@bp.route('/routers/<int:router_id>/suspend-client', methods=['POST'])
@jwt_required()
def suspend_client(router_id):
    """
    Suspende un cliente por falta de pago (Address List morosos).
    POST /api/routers/<router_id>/suspend-client
    Body: { "client_ip": "192.168.1.100", "client_name": "Juan Pérez" }
    """
    data = request.get_json(silent=True) or {}
    client_ip = data.get("client_ip")
    client_name = data.get("client_name", "")

    if not client_ip:
        return jsonify({"error": "client_ip requerido"}), 400

    try:
        from app.services.mikrotik_commands import suspend_client_by_ip
        result = suspend_client_by_ip(router_id, client_ip, client_name)
        return jsonify(result), 200 if result.get("success") else 500
    except Exception as e:
        current_app.logger.error(f"Error suspendiendo cliente {client_ip}: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route('/routers/<int:router_id>/restore-client', methods=['POST'])
@jwt_required()
def restore_client(router_id):
    """
    Reactiva un cliente eliminándolo de la lista de morosos.
    POST /api/routers/<router_id>/restore-client
    Body: { "client_ip": "192.168.1.100" }
    """
    data = request.get_json(silent=True) or {}
    client_ip = data.get("client_ip")

    if not client_ip:
        return jsonify({"error": "client_ip requerido"}), 400

    try:
        from app.services.mikrotik_commands import restore_client_by_ip
        result = restore_client_by_ip(router_id, client_ip)
        return jsonify(result), 200 if result.get("success") else 500
    except Exception as e:
        current_app.logger.error(f"Error reactivando cliente {client_ip}: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route('/routers/<int:router_id>/set-bandwidth', methods=['POST'])
@jwt_required()
def set_bandwidth(router_id):
    """
    Configura el ancho de banda de un cliente (Simple Queue).
    POST /api/routers/<router_id>/set-bandwidth
    Body: { "client_ip": "192.168.1.100", "client_name": "Juan", "download_mbps": 10, "upload_mbps": 5 }
    """
    data = request.get_json(silent=True) or {}
    client_ip = data.get("client_ip")
    client_name = data.get("client_name", "")
    download_mbps = int(data.get("download_mbps", 10))
    upload_mbps = int(data.get("upload_mbps", 5))

    if not client_ip:
        return jsonify({"error": "client_ip requerido"}), 400

    try:
        from app.services.mikrotik_commands import set_client_bandwidth
        result = set_client_bandwidth(router_id, client_ip, client_name, download_mbps, upload_mbps)
        return jsonify(result), 200 if result.get("success") else 500
    except Exception as e:
        current_app.logger.error(f"Error configurando bandwidth para {client_ip}: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route('/routers/<int:router_id>/traffic/<client_ip>', methods=['GET'])
@jwt_required()
def get_client_traffic(router_id, client_ip):
    """
    Lee el tráfico actual de un cliente.
    GET /api/routers/<router_id>/traffic/<client_ip>
    """
    try:
        from app.services.mikrotik_commands import get_client_traffic
        result = get_client_traffic(router_id, client_ip)
        return jsonify(result), 200 if result.get("success") else 404
    except Exception as e:
        current_app.logger.error(f"Error leyendo tráfico de {client_ip}: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route('/routers/<int:router_id>/interfaces', methods=['GET'])
@jwt_required()
def get_interfaces(router_id):
    """
    Lee estadísticas de interfaces del router.
    GET /api/routers/<router_id>/interfaces
    """
    iface = request.args.get("name")
    try:
        from app.services.mikrotik_commands import get_router_interface_traffic
        result = get_router_interface_traffic(router_id, iface)
        return jsonify(result), 200 if result.get("success") else 500
    except Exception as e:
        current_app.logger.error(f"Error leyendo interfaces del router {router_id}: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route('/routers/<int:router_id>/connections', methods=['GET'])
@jwt_required()
def get_connections(router_id):
    """
    Retorna las conexiones activas del router.
    GET /api/routers/<router_id>/connections
    """
    try:
        from app.services.mikrotik_commands import get_active_connections
        result = get_active_connections(router_id)
        return jsonify(result), 200 if result.get("success") else 500
    except Exception as e:
        current_app.logger.error(f"Error leyendo conexiones del router {router_id}: {e}")
        return jsonify({"error": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# PILAR 1 — VPN Orchestrator
# ══════════════════════════════════════════════════════════════════════════════

@bp.route('/routers/<int:router_id>/provision-vpn', methods=['POST'])
@jwt_required()
def provision_vpn(router_id):
    """
    Provisiona o re-provisiona el VPN de un router.
    POST /api/routers/<router_id>/provision-vpn
    """
    try:
        from app.services.vpn_orchestrator import provision_router_vpn
        result = provision_router_vpn(router_id)
        return jsonify(result), 200 if result.get("success") else 500
    except Exception as e:
        current_app.logger.error(f"Error provisionando VPN para router {router_id}: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route('/routers/<int:router_id>/vpn-status', methods=['GET'])
@jwt_required()
def vpn_status(router_id):
    """
    Verifica el estado del usuario VPN de un router.
    GET /api/routers/<router_id>/vpn-status
    """
    try:
        from app.models import MikroTikRouter
        from app.services.vpn_orchestrator import get_vpn_user_status
        router = MikroTikRouter.query.get_or_404(router_id)
        vpn_username = getattr(router, 'vpn_username', None)
        if not vpn_username:
            return jsonify({"exists": False, "message": "Router sin SSTP nativo provisionado"}), 200
        result = get_vpn_user_status(vpn_username)
        result["vpn_ip"] = getattr(router, 'vpn_ip_address', None)
        result["provisioned_at"] = router.vpn_provisioned_at.isoformat() if router.vpn_provisioned_at else None
        return jsonify(result), 200
    except Exception as e:
        current_app.logger.error(f"Error verificando VPN del router {router_id}: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route('/vpn/sessions', methods=['GET'])
@jwt_required()
def vpn_sessions():
    """
    Lista los servidores SSTP nativos activos.
    GET /api/vpn/sessions
    """
    try:
        from app.services.vpn_orchestrator import get_connected_sessions
        result = get_connected_sessions()
        return jsonify(result), 200
    except Exception as e:
        current_app.logger.error(f"Error obteniendo sesiones VPN: {e}")
        return jsonify({"error": str(e)}), 500


# ══════════════════════════════════════════════════════════════════════════════
# PILAR 3 — Seguridad + Onboarding Script
# ══════════════════════════════════════════════════════════════════════════════

@bp.route('/routers/<int:router_id>/secure-api', methods=['POST'])
@jwt_required()
def secure_api(router_id):
    """
    Configura el MikroTik para que solo acepte API desde el servidor FASTISP.
    POST /api/routers/<router_id>/secure-api
    Body: { "allowed_ip": "10.100.0.1" }  (opcional)
    """
    data = request.get_json(silent=True) or {}
    allowed_ip = data.get("allowed_ip", "10.100.0.1")

    try:
        from app.services.mikrotik_commands import secure_mikrotik_api, add_firewall_protection
        result_api = secure_mikrotik_api(router_id, allowed_ip)
        result_fw = add_firewall_protection(router_id, allowed_ip)
        return jsonify({
            "success": result_api.get("success") and result_fw.get("success"),
            "api_security": result_api,
            "firewall": result_fw,
        }), 200
    except Exception as e:
        current_app.logger.error(f"Error asegurando API del router {router_id}: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route('/routers/<int:router_id>/onboarding-script', methods=['GET'])
@jwt_required()
def onboarding_script(router_id):
    """
    Genera el script RouterOS completo de onboarding para un router.
    GET /api/routers/<router_id>/onboarding-script
    """
    try:
        from app.models import MikroTikRouter, SstpTunnel
        from app.services.sstp_service import generate_mikrotik_sstp_script, get_certificate_fingerprint
        router = MikroTikRouter.query.get_or_404(router_id)

        tunnel = SstpTunnel.query.filter_by(router_id=router_id, status='active').first()
        if not tunnel:
            return jsonify({"error": "Router sin SSTP nativo provisionado. Ejecutar /provision-vpn primero"}), 400
        vpn_username = tunnel.username
        vpn_password = tunnel.password or "REGENERAR-SSTP"

        # Compatibilidad legacy: si existe password cifrada en el router, usarla.
        if hasattr(router, 'vpn_password_encrypted') and router.vpn_password_encrypted:
            try:
                from cryptography.fernet import Fernet
                from flask import current_app
                key = current_app.config['ENCRYPTION_KEY']
                if isinstance(key, str):
                    key = key.encode('utf-8')
                f = Fernet(key)
                vpn_password = f.decrypt(router.vpn_password_encrypted).decode('utf-8')
            except Exception:
                vpn_password = "REGENERAR-SSTP"

        if not vpn_username:
            return jsonify({"error": "Router sin SSTP nativo provisionado. Ejecutar /provision-vpn primero"}), 400

        script = generate_mikrotik_sstp_script({
            "username": vpn_username,
            "password": vpn_password or "REGENERAR-SSTP",
            "server_host": tunnel.server_host,
            "server_port": tunnel.server_port,
            "server_ip": tunnel.server_ip,
            "client_ip": tunnel.client_ip,
            "fingerprint": get_certificate_fingerprint(),
            "router_name": router.name,
            "provisioned_at": tunnel.created_at.isoformat() if tunnel.created_at else datetime.now(timezone.utc).isoformat(),
        })

        return jsonify({
            "router_id": router_id,
            "router_name": router.name,
            "vpn_username": vpn_username,
            "vpn_ip": tunnel.server_ip,
            "server_host": tunnel.server_host,
            "server_port": tunnel.server_port,
            "architecture": "mikrotik-native-sstp",
            "script": script,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }), 200

    except Exception as e:
        current_app.logger.error(f"Error generando script de onboarding para router {router_id}: {e}")
        return jsonify({"error": str(e)}), 500
