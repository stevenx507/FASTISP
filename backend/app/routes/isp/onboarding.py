from datetime import datetime, timezone
from flask import jsonify
from flask_jwt_extended import jwt_required
from . import isp_bp
from app.models import MikroTikRouter, SstpTunnel
from app.services.sstp_service import generate_mikrotik_sstp_script, get_certificate_fingerprint

@isp_bp.route('/routers/<int:router_id>/onboarding-script', methods=['GET'])
@jwt_required()
def onboarding_script(router_id):
    """Genera el script de configuración inicial (Onboarding) para MikroTik."""
    router = MikroTikRouter.query.get_or_404(router_id)

    tunnel = SstpTunnel.query.filter_by(router_id=router_id, status='active').first()
    if not tunnel:
        return jsonify({"error": "Router sin SSTP nativo provisionado. Ejecutar /provision-vpn primero"}), 400
    
    vpn_username = tunnel.username
    vpn_password = tunnel.password or "REGENERAR-SSTP"

    # Desencriptado de password legacy si existe
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

    script = generate_mikrotik_sstp_script({
        "username": vpn_username,
        "password": vpn_password,
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
