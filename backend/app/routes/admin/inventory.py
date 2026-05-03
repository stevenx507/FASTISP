from flask import jsonify, request
from .utils import admin_bp, _audit, _tenant_scoped_query, _iso_utc_now
from app.models import Client, MikroTikRouter
from app.tenancy import current_tenant_id
from sqlalchemy.orm import joinedload

@admin_bp.route('/admin/inventory/summary', methods=['GET'])
def admin_inventory_summary():
    tenant_id = current_tenant_id()
    clients = _tenant_scoped_query(Client, tenant_id).options(joinedload(Client.plan)).all()
    routers_count = _tenant_scoped_query(MikroTikRouter, tenant_id).count()
    
    # Static data for demo as in original code
    items = [
        {"sku": "ONU-GPON", "name": "ONU GPON", "available": 50, "status": "ok"},
        {"sku": "CPE-DUAL", "name": "Router CPE Dual Band", "available": 30, "status": "ok"},
    ]
    
    return jsonify({
        "summary": {"clients_total": len(clients), "routers_total": routers_count},
        "items": items,
        "updated_at": _iso_utc_now()
    }), 200
