from flask import jsonify, request
from app.models import Plan
from app import db
from app.tenancy import current_tenant_id, admin_required
from . import billing_bp
from .helpers import _parse_int

@billing_bp.route('/plans', methods=['GET'])
@admin_required()
def list_plans():
    tenant_id = current_tenant_id()
    query = Plan.query
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)
    
    plans = [
        {
            "id": p.id,
            "name": p.name,
            "download_speed": p.download_speed,
            "upload_speed": p.upload_speed,
            "price": p.price
        }
        for p in query.order_by(Plan.name.asc()).all()
    ]
    return jsonify({"items": plans, "count": len(plans)}), 200

@billing_bp.route('/plans', methods=['POST'])
@admin_required()
def create_plan():
    data = request.get_json() or {}
    required = ['name', 'download_speed', 'upload_speed']
    missing = [k for k in required if not data.get(k)]
    if missing:
        return jsonify({"error": f"Faltan campos: {', '.join(missing)}"}), 400
    
    tenant_id = current_tenant_id()
    plan = Plan(
        name=data['name'],
        download_speed=int(data['download_speed']),
        upload_speed=int(data['upload_speed']),
        price=float(data.get('price') or 0),
        tenant_id=tenant_id
    )
    db.session.add(plan)
    db.session.commit()
    return jsonify({"plan": plan.to_dict(), "success": True}), 201
