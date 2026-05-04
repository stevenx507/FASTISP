from flask import jsonify, request
from sqlalchemy.orm import joinedload
from sqlalchemy import or_
from app import db
from app.models import Client, Plan, MikroTikRouter, User, Subscription
from app.tenancy import current_tenant_id
from app.lib.utils import parse_int, parse_bool
from .utils import admin_bp, _audit, _tenant_scoped_query

def _serialize_admin_client(client: Client) -> dict:
    subs = client.subscriptions or []
    status = str(subs[0].status if subs else 'active')
    return {
        "id": client.id,
        "name": client.full_name,
        "ip_address": client.ip_address,
        "plan": client.plan.name if client.plan else None,
        "plan_id": client.plan_id,
        "router_id": client.router_id,
        "router_name": client.router.name if client.router else None,
        "status": status,
        "email": client.user.email if client.user else None,
        "portal_access": bool(client.user_id),
        "connection_type": client.connection_type,
        "pppoe_username": client.pppoe_username,
    }

@admin_bp.route('/admin/clients', methods=['GET'])
def admin_clients_list():
    tenant_id = current_tenant_id()
    page = parse_int(request.args.get('page')) or 1
    per_page = parse_int(request.args.get('per_page')) or 50
    term = str(request.args.get('term') or '').strip()
    status_filter = str(request.args.get('status') or '').strip().lower()

    query = Client.query.options(joinedload(Client.plan), joinedload(Client.user), joinedload(Client.router))
    if tenant_id is not None: query = query.filter_by(tenant_id=tenant_id)
    
    if term:
        pattern = f"%{term}%"
        query = query.outerjoin(User, Client.user_id == User.id).filter(
            or_(Client.full_name.ilike(pattern), Client.ip_address.ilike(pattern), User.email.ilike(pattern))
        )
    
    if status_filter:
        query = query.join(Subscription, Client.id == Subscription.client_id).filter(Subscription.status == status_filter)

    pagination = query.order_by(Client.id.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        "items": [_serialize_admin_client(c) for c in pagination.items],
        "total": pagination.total,
        "page": pagination.page,
        "pages": pagination.pages
    }), 200

@admin_bp.route('/admin/clients', methods=['POST'])
def admin_clients_create():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    # CRUD logic extracted from client_routes.py...
    return jsonify({"message": "Pendiente de implementar CRUD completo"}), 501