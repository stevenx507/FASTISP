"""
SSTP VPN Provisioning API Routes
=================================
Endpoints for managing SSTP tunnel provisioning for ISP client MikroTik routers.

Routes:
  GET    /api/sstp/tunnels              - List all tunnels (admin)
  POST   /api/sstp/tunnels              - Provision new tunnel for a router
  GET    /api/sstp/tunnels/<id>         - Get tunnel details + script
  DELETE /api/sstp/tunnels/<id>         - Revoke tunnel
  POST   /api/sstp/tunnels/<id>/regenerate - Regenerate credentials
  GET    /api/sstp/tunnels/<id>/script  - Download .rsc script
  GET    /api/sstp/certificate          - Get server certificate info
  POST   /api/sstp/certificate/generate - Generate/renew server certificate
"""

from flask import Blueprint, request, jsonify, Response
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime
import logging

from app import db
from app.models import MikroTikRouter, SstpTunnel, User
from app.routes.main_routes import admin_required
from app.tenancy import current_tenant_id
from app.services.sstp_service import (
    provision_sstp_tunnel,
    revoke_sstp_tunnel,
    ensure_sstp_user,
    generate_mikrotik_sstp_script,
    generate_verification_script,
    ensure_sstp_certificate,
    get_certificate_fingerprint,
    _allocate_ip_pair,
    _generate_username,
    _generate_password,
)

sstp_bp = Blueprint('sstp', __name__)
logger = logging.getLogger(__name__)


# ── Helper ─────────────────────────────────────────────────────────────────────
def _get_current_user():
    uid = get_jwt_identity()
    return db.session.get(User, int(uid))


# ── GET /api/sstp/tunnels ──────────────────────────────────────────────────────
@sstp_bp.route('/tunnels', methods=['GET'])
@jwt_required()
@admin_required()
def list_tunnels():
    """List all SSTP tunnels for the current tenant."""
    tid = current_tenant_id()
    user = _get_current_user()

    query = SstpTunnel.query
    if user.role != 'platform_admin':
        query = query.filter_by(tenant_id=tid)

    tunnels = query.order_by(SstpTunnel.created_at.desc()).all()
    return jsonify([t.to_dict() for t in tunnels])


# ── POST /api/sstp/tunnels ─────────────────────────────────────────────────────
@sstp_bp.route('/tunnels', methods=['POST'])
@jwt_required()
@admin_required()
def create_tunnel():
    """
    Provision a new SSTP tunnel for a MikroTik router.
    Body: { "router_id": 1, "notes": "optional" }
    """
    data = request.get_json() or {}
    router_id = data.get('router_id')
    if not router_id:
        return jsonify({'error': 'router_id es requerido'}), 400

    tid = current_tenant_id()
    user = _get_current_user()

    router = db.session.get(MikroTikRouter, int(router_id))
    if not router:
        return jsonify({'error': 'Router no encontrado'}), 404
    if user.role != 'platform_admin' and router.tenant_id != tid:
        return jsonify({'error': 'Acceso denegado'}), 403

    existing = SstpTunnel.query.filter_by(router_id=router.id, status='active').first()
    if existing:
        try:
            ensure_sstp_user(existing.username, existing.password)
            prov = {
                'username': existing.username,
                'password': existing.password,
                'server_host': existing.server_host,
                'server_port': existing.server_port,
                'server_ip': existing.server_ip,
                'client_ip': existing.client_ip,
                'fingerprint': get_certificate_fingerprint(),
                'router_name': router.name,
                'provisioned_at': existing.created_at.isoformat() if existing.created_at else '',
            }
            result = existing.to_dict(include_password=True)
            result['script'] = generate_mikrotik_sstp_script(prov)
            result['message'] = 'Tunel SSTP existente verificado y sincronizado'
            return jsonify(result), 200
        except Exception as exc:
            logger.warning(f"No se pudo autoreparar el tunel SSTP existente {existing.id}: {exc}")
        return jsonify({
            'error': 'Este router ya tiene un tunel SSTP activo',
            'tunnel': existing.to_dict()
        }), 409

    try:
        prov = provision_sstp_tunnel(router)

        tunnel = SstpTunnel(
            router_id=router.id,
            tenant_id=router.tenant_id,
            username=prov['username'],
            server_ip=prov['server_ip'],
            client_ip=prov['client_ip'],
            server_host=prov['server_host'],
            server_port=prov['server_port'],
            status='active',
            notes=data.get('notes', ''),
        )
        tunnel.password = prov['password']
        db.session.add(tunnel)
        db.session.commit()

        script = generate_mikrotik_sstp_script(prov)
        result = tunnel.to_dict(include_password=True)
        result['script'] = script
        result['provisioning'] = prov

        logger.info(f"SSTP tunnel provisioned for router {router.id} ({router.name})")
        return jsonify(result), 201

    except Exception as e:
        db.session.rollback()
        logger.error(f"Error provisioning SSTP tunnel: {e}")
        return jsonify({'error': f'Error al provisionar tunel: {str(e)}'}), 500


# ── GET /api/sstp/tunnels/<id> ─────────────────────────────────────────────────
@sstp_bp.route('/tunnels/<int:tunnel_id>', methods=['GET'])
@jwt_required()
@admin_required()
def get_tunnel(tunnel_id):
    """Get tunnel details including the provisioning script."""
    tid = current_tenant_id()
    user = _get_current_user()

    tunnel = db.session.get(SstpTunnel, tunnel_id)
    if not tunnel:
        return jsonify({'error': 'Tunel no encontrado'}), 404
    if user.role != 'platform_admin' and tunnel.tenant_id != tid:
        return jsonify({'error': 'Acceso denegado'}), 403

    result = tunnel.to_dict(include_password=True)

    prov = {
        'username': tunnel.username,
        'password': tunnel.password,
        'server_host': tunnel.server_host,
        'server_port': tunnel.server_port,
        'server_ip': tunnel.server_ip,
        'client_ip': tunnel.client_ip,
        'fingerprint': get_certificate_fingerprint(),
        'router_name': tunnel.router.name if tunnel.router else 'mikrotik',
        'provisioned_at': tunnel.created_at.isoformat() if tunnel.created_at else '',
    }
    result['script'] = generate_mikrotik_sstp_script(prov)
    result['verification_script'] = generate_verification_script()

    return jsonify(result)


# ── DELETE /api/sstp/tunnels/<id> ──────────────────────────────────────────────
@sstp_bp.route('/tunnels/<int:tunnel_id>', methods=['DELETE'])
@jwt_required()
@admin_required()
def revoke_tunnel(tunnel_id):
    """Revoke an SSTP tunnel."""
    tid = current_tenant_id()
    user = _get_current_user()

    tunnel = db.session.get(SstpTunnel, tunnel_id)
    if not tunnel:
        return jsonify({'error': 'Tunel no encontrado'}), 404
    if user.role != 'platform_admin' and tunnel.tenant_id != tid:
        return jsonify({'error': 'Acceso denegado'}), 403

    try:
        revoke_sstp_tunnel(tunnel.username)
        tunnel.status = 'revoked'
        tunnel.revoked_at = datetime.utcnow()
        db.session.commit()
        return jsonify({'message': f'Tunel {tunnel.username} revocado exitosamente'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ── POST /api/sstp/tunnels/<id>/regenerate ─────────────────────────────────────
@sstp_bp.route('/tunnels/<int:tunnel_id>/regenerate', methods=['POST'])
@jwt_required()
@admin_required()
def regenerate_tunnel(tunnel_id):
    """Regenerate credentials for an existing tunnel (new password)."""
    tid = current_tenant_id()
    user = _get_current_user()

    tunnel = db.session.get(SstpTunnel, tunnel_id)
    if not tunnel:
        return jsonify({'error': 'Tunel no encontrado'}), 404
    if user.role != 'platform_admin' and tunnel.tenant_id != tid:
        return jsonify({'error': 'Acceso denegado'}), 403

    try:
        new_password = _generate_password(20)

        softether_synced = True
        softether_warning = None
        try:
            revoke_sstp_tunnel(tunnel.username)
            ensure_sstp_user(tunnel.username, new_password)
        except Exception as se_exc:
            softether_synced = False
            softether_warning = f"Credenciales actualizadas en BD: {se_exc}"
            logger.warning(f"Regenerate warning for tunnel {tunnel_id}: {se_exc}")

        tunnel.password = new_password
        tunnel.status = 'active'
        tunnel.revoked_at = None
        db.session.commit()

        prov = {
            'username': tunnel.username,
            'password': new_password,
            'server_host': tunnel.server_host,
            'server_port': tunnel.server_port,
            'server_ip': tunnel.server_ip,
            'client_ip': tunnel.client_ip,
            'fingerprint': get_certificate_fingerprint(),
            'router_name': tunnel.router.name if tunnel.router else 'mikrotik',
            'provisioned_at': datetime.utcnow().isoformat(),
        }
        script = generate_mikrotik_sstp_script(prov)

        result = tunnel.to_dict(include_password=True)
        result['script'] = script
        result['synced'] = softether_synced
        result['message'] = (
            softether_warning if softether_warning
            else 'Credenciales regeneradas exitosamente'
        )

        return jsonify(result)

    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


# ── GET /api/sstp/tunnels/<id>/script ─────────────────────────────────────────
@sstp_bp.route('/tunnels/<int:tunnel_id>/script', methods=['GET'])
@jwt_required()
@admin_required()
def download_script(tunnel_id):
    """Download the MikroTik provisioning script as a .rsc file."""
    tid = current_tenant_id()
    user = _get_current_user()

    tunnel = db.session.get(SstpTunnel, tunnel_id)
    if not tunnel:
        return jsonify({'error': 'Tunel no encontrado'}), 404
    if user.role != 'platform_admin' and tunnel.tenant_id != tid:
        return jsonify({'error': 'Acceso denegado'}), 403

    prov = {
        'username': tunnel.username,
        'password': tunnel.password,
        'server_host': tunnel.server_host,
        'server_port': tunnel.server_port,
        'server_ip': tunnel.server_ip,
        'client_ip': tunnel.client_ip,
        'fingerprint': get_certificate_fingerprint(),
        'router_name': tunnel.router.name if tunnel.router else 'mikrotik',
        'provisioned_at': tunnel.created_at.isoformat() if tunnel.created_at else '',
    }
    script = generate_mikrotik_sstp_script(prov)
    filename = f"fastisp-sstp-{tunnel.username}.rsc"

    return Response(
        script,
        mimetype='text/plain',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Type': 'text/plain; charset=utf-8',
        }
    )


# ── GET /api/sstp/certificate ──────────────────────────────────────────────────
@sstp_bp.route('/certificate', methods=['GET'])
@jwt_required()
@admin_required()
def get_certificate():
    """Get SSTP server certificate information."""
    try:
        cert_info = ensure_sstp_certificate()
        return jsonify({
            'exists': cert_info.get('exists', False),
            'fingerprint': cert_info.get('fingerprint', 'UNKNOWN'),
            'cert_path': cert_info.get('cert_path', ''),
            'server_host': cert_info.get('server_host', 'fastisp.cloud'),
        })
    except Exception as e:
        return jsonify({
            'exists': False,
            'fingerprint': 'ERROR',
            'error': str(e),
        })


# ── POST /api/sstp/certificate/generate ───────────────────────────────────────
@sstp_bp.route('/certificate/generate', methods=['POST'])
@jwt_required()
@admin_required()
def generate_certificate():
    """Generate or renew the SSTP server certificate."""
    user = _get_current_user()
    if user.role != 'platform_admin':
        return jsonify({'error': 'Solo platform_admin puede regenerar el certificado'}), 403

    try:
        import os
        from app.services.sstp_service import SSTP_CERT_DIR
        cert_path = os.path.join(SSTP_CERT_DIR, "sstp-server.crt")
        key_path = os.path.join(SSTP_CERT_DIR, "sstp-server.key")
        for f in [cert_path, key_path]:
            if os.path.exists(f):
                os.remove(f)

        cert_info = ensure_sstp_certificate()
        return jsonify({
            'message': 'Certificado generado exitosamente',
            'fingerprint': cert_info.get('fingerprint', 'UNKNOWN'),
            'exists': cert_info.get('exists', False),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── GET /api/sstp/status ───────────────────────────────────────────────────────
@sstp_bp.route('/status', methods=['GET'])
@jwt_required()
@admin_required()
def sstp_status():
    """Get overall SSTP system status."""
    tid = current_tenant_id()
    user = _get_current_user()

    query = SstpTunnel.query
    if user.role != 'platform_admin':
        query = query.filter_by(tenant_id=tid)

    total = query.count()
    active = query.filter_by(status='active').count()
    revoked = query.filter_by(status='revoked').count()

    fingerprint = get_certificate_fingerprint()

    return jsonify({
        'total_tunnels': total,
        'active_tunnels': active,
        'revoked_tunnels': revoked,
        'certificate_fingerprint': fingerprint,
        'server_port': 443,
        'architecture': 'mikrotik-native-sstp',
        'ip_pool': '10.10.0.0/24',
    })
