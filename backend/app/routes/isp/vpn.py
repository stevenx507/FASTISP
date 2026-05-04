from flask import jsonify
from flask_jwt_extended import jwt_required
from . import isp_bp
from app.models import MikroTikRouter
from app.services import vpn_orchestrator

@isp_bp.route('/routers/<int:router_id>/provision-vpn', methods=['POST'])
@jwt_required()
def provision_vpn(router_id):
    """Provisiona el túnel VPN para un router."""
    result = vpn_orchestrator.provision_router_vpn(router_id)
    return jsonify(result), 200 if result.get("success") else 500

@isp_bp.route('/routers/<int:router_id>/vpn-status', methods=['GET'])
@jwt_required()
def vpn_status(router_id):
    """Consulta el estado del túnel VPN."""
    router = MikroTikRouter.query.get_or_404(router_id)
    vpn_username = getattr(router, 'vpn_username', None)
    if not vpn_username:
        return jsonify({"exists": False, "message": "Router sin SSTP nativo provisionado"}), 200
    
    result = vpn_orchestrator.get_vpn_user_status(vpn_username)
    result["vpn_ip"] = getattr(router, 'vpn_ip_address', None)
    result["provisioned_at"] = router.vpn_provisioned_at.isoformat() if router.vpn_provisioned_at else None
    return jsonify(result), 200

@isp_bp.route('/vpn/sessions', methods=['GET'])
@jwt_required()
def vpn_sessions():
    """Lista todas las sesiones VPN activas."""
    result = vpn_orchestrator.get_connected_sessions()
    return jsonify(result), 200
