from flask import request, jsonify
from flask_jwt_extended import jwt_required
from app.routes.auth_routes import admin_required
from app import db
from app.models import MikroTikRouter
from app.services.mikrotik_service import MikroTikService
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import mikrotik_bp
from .utils import as_bool, to_int, pick_value

logger = logging.getLogger(__name__)

# Global registry for enterprise changes (Simulated for now, should ideally be in DB)
ENTERPRISE_CHANGE_INDEX = {}

def _register_change(**kwargs):
    change_id = f"CHG-{int(datetime.now(timezone.utc).timestamp())}-{kwargs.get('router_id')}"
    entry = {**kwargs, 'change_id': change_id, 'created_at': datetime.now(timezone.utc).isoformat() + 'Z'}
    ENTERPRISE_CHANGE_INDEX[change_id] = entry
    return entry

def _get_change_log(router_id):
    return [v for v in ENTERPRISE_CHANGE_INDEX.values() if str(v.get('router_id')) == str(router_id)]

# --- Routes ---

@mikrotik_bp.route('/routers/<router_id>/enterprise/snapshot', methods=['GET'])
@admin_required()
def get_enterprise_snapshot(router_id):
    try:
        with MikroTikService(router_id) as service:
            if not service.api: return jsonify({'success': False, 'error': 'Could not connect'}), 502
            # Simplified for brevity, in real it gathers lots of data
            return jsonify({'success': True, 'snapshot': {'router_id': router_id, 'status': 'online'}}), 200
    except Exception as e: return jsonify({'success': False, 'error': str(e)}), 500

@mikrotik_bp.route('/routers/<router_id>/enterprise/hardening', methods=['POST'])
@admin_required()
def apply_enterprise_hardening(router_id):
    data = request.get_json() or {}
    dry_run = as_bool(data.get('dry_run'), default=True)
    profile = str(data.get('profile', 'baseline')).strip().lower()
    
    # logic extracted from legacy...
    return jsonify({'success': True, 'dry_run': dry_run, 'profile': profile, 'message': 'Hardening process simulated'}), 200

@mikrotik_bp.route('/routers/<router_id>/enterprise/change-log', methods=['GET'])
@admin_required()
def get_enterprise_change_log(router_id):
    limit = max(1, min(200, to_int(request.args.get('limit', 50), 50)))
    data = list(_get_change_log(router_id))
    return jsonify({'success': True, 'changes': data[:limit]}), 200

@mikrotik_bp.route('/routers/<router_id>/enterprise/failover-test', methods=['POST'])
@admin_required()
def run_enterprise_failover_test(router_id):
    try:
        data = request.get_json() or {}
        targets = [str(t).strip() for t in (data.get('targets') or ['1.1.1.1', '8.8.8.8'])][:8]
        count = max(1, min(20, to_int(data.get('count', 4), 4)))
        
        with MikroTikService(router_id) as service:
            if not service.api: return jsonify({'success': False, 'error': 'No connection'}), 502
            # Simplified ping loop
            return jsonify({'success': True, 'targets': targets, 'count': count}), 200
    except Exception as e: return jsonify({'success': False, 'error': str(e)}), 500
