from flask import request, jsonify, current_app
from flask_jwt_extended import jwt_required
from . import isp_bp

def _is_ip_allowed(ip_address):
    """Verifica si la IP de origen está permitida para heartbeats."""
    if not ip_address:
        return False
    
    # Redes permitidas: VPN interna, Docker interna, Localhost
    return (
        ip_address.startswith("10.100.")   # Red VPN SSTP
        or ip_address.startswith("10.0.")   # Red interna alternativa
        or ip_address.startswith("127.")    # Localhost
        or ip_address == "::1"             # Localhost IPv6
        or (ip_address.startswith("172.") and  
            any(ip_address.startswith(f"172.{i}.") for i in range(16, 32)))
    )

@isp_bp.route('/heartbeat', methods=['POST'])
def receive_heartbeat():
    """Recibe heartbeat del MikroTik."""
    client_ip = request.remote_addr or ""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    
    if not _is_ip_allowed(client_ip):
        current_app.logger.warning(f"Heartbeat rechazado desde IP: {client_ip}")
        return jsonify({"error": "Acceso denegado"}), 403

    data = request.get_json(silent=True) or {}
    router_id = data.get("router_id")
    vpn_ip = data.get("vpn_ip")

    if not router_id:
        return jsonify({"error": "router_id requerido"}), 400

    from app.services.heartbeat_service import record_heartbeat_from_mikrotik
    result = record_heartbeat_from_mikrotik(int(router_id), vpn_ip)
    return jsonify(result), 200 if result.get("success") else 404

@isp_bp.route('/connectivity', methods=['GET'])
@jwt_required()
def get_connectivity_dashboard():
    """Dashboard de conectividad global."""
    from app.services.heartbeat_service import get_connectivity_dashboard
    data = get_connectivity_dashboard()
    return jsonify(data), 200

@isp_bp.route('/connectivity/<int:router_id>', methods=['GET'])
@jwt_required()
def check_router_status(router_id):
    """Estado de conectividad de un router específico."""
    from app.models import MikroTikRouter
    from app.services.heartbeat_service import check_router_connectivity
    router = MikroTikRouter.query.get_or_404(router_id)
    result = check_router_connectivity(router)
    return jsonify(result), 200
