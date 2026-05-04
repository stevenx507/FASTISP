from flask import request, jsonify
from flask_jwt_extended import jwt_required
from . import isp_bp
from app.services import mikrotik_commands

@isp_bp.route('/routers/<int:router_id>/suspend-client', methods=['POST'])
@jwt_required()
def suspend_client(router_id):
    """Suspende un cliente en el MikroTik."""
    data = request.get_json(silent=True) or {}
    client_ip = data.get("client_ip")
    client_name = data.get("client_name", "")

    if not client_ip:
        return jsonify({"error": "client_ip requerido"}), 400

    result = mikrotik_commands.suspend_client_by_ip(router_id, client_ip, client_name)
    return jsonify(result), 200 if result.get("success") else 500

@isp_bp.route('/routers/<int:router_id>/restore-client', methods=['POST'])
@jwt_required()
def restore_client(router_id):
    """Restaura un cliente en el MikroTik."""
    data = request.get_json(silent=True) or {}
    client_ip = data.get("client_ip")

    if not client_ip:
        return jsonify({"error": "client_ip requerido"}), 400

    result = mikrotik_commands.restore_client_by_ip(router_id, client_ip)
    return jsonify(result), 200 if result.get("success") else 500

@isp_bp.route('/routers/<int:router_id>/set-bandwidth', methods=['POST'])
@jwt_required()
def set_bandwidth(router_id):
    """Configura el ancho de banda (Simple Queue)."""
    data = request.get_json(silent=True) or {}
    client_ip = data.get("client_ip")
    client_name = data.get("client_name", "")
    download_mbps = int(data.get("download_mbps", 10))
    upload_mbps = int(data.get("upload_mbps", 5))

    if not client_ip:
        return jsonify({"error": "client_ip requerido"}), 400

    result = mikrotik_commands.set_client_bandwidth(router_id, client_ip, client_name, download_mbps, upload_mbps)
    return jsonify(result), 200 if result.get("success") else 500

@isp_bp.route('/routers/<int:router_id>/traffic/<client_ip>', methods=['GET'])
@jwt_required()
def get_client_traffic(router_id, client_ip):
    """Consulta el tráfico de un cliente específico."""
    result = mikrotik_commands.get_client_traffic(router_id, client_ip)
    return jsonify(result), 200 if result.get("success") else 404

@isp_bp.route('/routers/<int:router_id>/interfaces', methods=['GET'])
@jwt_required()
def get_interfaces(router_id):
    """Lista las interfaces del router."""
    iface = request.args.get("name")
    result = mikrotik_commands.get_router_interface_traffic(router_id, iface)
    return jsonify(result), 200 if result.get("success") else 500

@isp_bp.route('/routers/<int:router_id>/connections', methods=['GET'])
@jwt_required()
def get_connections(router_id):
    """Lista las conexiones activas en el router."""
    result = mikrotik_commands.get_active_connections(router_id)
    return jsonify(result), 200 if result.get("success") else 500

@isp_bp.route('/routers/<int:router_id>/secure-api', methods=['POST'])
@jwt_required()
def secure_api(router_id):
    """Configura seguridad en la API del MikroTik."""
    data = request.get_json(silent=True) or {}
    allowed_ip = data.get("allowed_ip", "10.100.0.1")

    result_api = mikrotik_commands.secure_mikrotik_api(router_id, allowed_ip)
    result_fw = mikrotik_commands.add_firewall_protection(router_id, allowed_ip)
    
    return jsonify({
        "success": result_api.get("success") and result_fw.get("success"),
        "api_security": result_api,
        "firewall": result_fw,
    }), 200
