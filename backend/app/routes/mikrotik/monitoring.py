from flask import request, jsonify
from flask_jwt_extended import jwt_required
# auth_routes removed
from app import db
from app.models import MikroTikRouter, TrafficFlowStats
from app.tenancy import current_tenant_id, tenant_access_allowed
from app.services.snmp_service import snmp_service, SNMPRuntimeUnavailable
from app.services.monitoring_service import monitoring_service
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import func

from .utils import mikrotik_bp, admin_required, staff_required, as_bool, to_int

logger = logging.getLogger(__name__)

def _resolve_router_for_snmp(router_id: int):
    router = db.session.get(MikroTikRouter, router_id)
    if not router or not tenant_access_allowed(router.tenant_id):
        return None
    return router

# --- Traffic Flow (NetFlow v5) ---

@mikrotik_bp.route('/routers/<int:router_id>/traffic-flow/script', methods=['GET'])
@jwt_required()
@admin_required()
def get_traffic_flow_script(router_id):
    try:
        from app.services.traffic_flow_service import (
            generate_traffic_flow_script_ros6,
            generate_traffic_flow_script_ros7_lan,
            generate_traffic_flow_script_ros7_wan,
            COLLECTOR_IP, COLLECTOR_PORT,
        )

        router = db.session.get(MikroTikRouter, router_id)
        if not router:
            return jsonify({'success': False, 'error': 'Router no encontrado'}), 404

        lan_gw_raw = request.args.get('lan_gateways', '')
        wan_gw_raw = request.args.get('wan_gateways', '')
        lan_gateways = [g.strip() for g in lan_gw_raw.split(',') if g.strip()] or None
        wan_gateways = [g.strip() for g in wan_gw_raw.split(',') if g.strip()] or None

        return jsonify({
            'success': True,
            'collector_ip': COLLECTOR_IP,
            'collector_port': COLLECTOR_PORT,
            'router_name': router.name,
            'scripts': {
                'ros6': generate_traffic_flow_script_ros6(router.name),
                'ros7_lan': generate_traffic_flow_script_ros7_lan(router.name, lan_gateways),
                'ros7_wan': generate_traffic_flow_script_ros7_wan(router.name, wan_gateways),
            },
        }), 200
    except Exception as e:
        logger.error(f"Error generating traffic flow script: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/traffic-flow/stats', methods=['GET'])
@jwt_required()
@admin_required()
def get_traffic_flow_stats():
    try:
        tid = current_tenant_id()
        router_id = request.args.get('router_id', type=int)
        hours     = request.args.get('hours', 24, type=int)
        limit     = min(request.args.get('limit', 50, type=int), 200)

        since = datetime.now(timezone.utc) - timedelta(hours=hours)

        agg = (
            db.session.query(
                TrafficFlowStats.src_ip,
                TrafficFlowStats.router_id,
                func.sum(TrafficFlowStats.bytes_total).label('bytes_total'),
                func.sum(TrafficFlowStats.packets_total).label('packets_total'),
                func.max(TrafficFlowStats.bucket).label('last_seen'),
            )
            .filter(
                TrafficFlowStats.tenant_id == tid,
                TrafficFlowStats.bucket >= since,
                *([TrafficFlowStats.router_id == router_id] if router_id else []),
            )
            .group_by(TrafficFlowStats.src_ip, TrafficFlowStats.router_id)
            .order_by(func.sum(TrafficFlowStats.bytes_total).desc())
            .limit(limit)
            .all()
        )

        result = [
            {
                'src_ip': r.src_ip,
                'router_id': r.router_id,
                'bytes_total': r.bytes_total or 0,
                'mb_total': round((r.bytes_total or 0) / 1_048_576, 2),
                'packets_total': r.packets_total or 0,
                'last_seen': r.last_seen.isoformat() if r.last_seen else None,
            }
            for r in agg
        ]

        return jsonify({'success': True, 'stats': result, 'hours': hours}), 200
    except Exception as e:
        logger.error(f"Error fetching traffic stats: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# --- SNMP ---

@mikrotik_bp.route('/routers/<int:router_id>/snmp-profile', methods=['GET'])
@jwt_required()
@admin_required()
def get_router_snmp_profile(router_id: int):
    router = _resolve_router_for_snmp(router_id)
    if not router: return jsonify({'success': False, 'error': 'Router no encontrado'}), 404
    profile = snmp_service.router_profile(router)
    return jsonify({
        'success': True,
        'profile': snmp_service.sanitize_profile(profile),
        'runtime_available': snmp_service.is_available(),
    }), 200

@mikrotik_bp.route('/routers/<int:router_id>/snmp-profile', methods=['PUT', 'PATCH'])
@jwt_required()
@admin_required()
def upsert_router_snmp_profile(router_id: int):
    router = _resolve_router_for_snmp(router_id)
    if not router: return jsonify({'success': False, 'error': 'Router no encontrado'}), 404
    payload = request.get_json(silent=True) or {}
    normalized = snmp_service.store_router_profile(router, payload)
    db.session.add(router)
    db.session.commit()
    return jsonify({
        'success': True,
        'profile': snmp_service.sanitize_profile(normalized),
    }), 200

@mikrotik_bp.route('/routers/<int:router_id>/snmp/poll', methods=['POST'])
@jwt_required()
@admin_required()
def poll_router_snmp(router_id: int):
    router = _resolve_router_for_snmp(router_id)
    if not router: return jsonify({'success': False, 'error': 'Router no encontrado'}), 404
    payload = request.get_json(silent=True) or {}
    overrides = payload.get('profile') if isinstance(payload.get('profile'), dict) else {}
    persist = as_bool(payload.get('persist'), default=False)
    profile = snmp_service.router_profile(router)
    if overrides: profile.update(overrides)
    try:
        result = snmp_service.poll_router_profile(profile)
        if persist:
            snmp_service.persist_router_poll(monitoring_service, router, result)
        return jsonify({'success': True, 'persisted': persist, **result}), 200
    except SNMPRuntimeUnavailable as e: return jsonify({'success': False, 'error': str(e)}), 503
    except Exception as e:
        logger.error(f'Error polling SNMP: {e}', exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 502
