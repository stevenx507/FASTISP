from datetime import date, datetime, timezone
from flask import jsonify, request
from app.models import BillingPromise, Subscription
from app import db
from app.tenancy import current_tenant_id, permission_required
from . import billing_bp
from .helpers import _current_user_id, _parse_int, _parse_money_value, _audit, _tenant_scoped_query

@billing_bp.route('/admin/billing/promises', methods=['GET'])
@permission_required('billing.promises.read')
def admin_billing_promises_list():
    tenant_id = current_tenant_id()
    status_filter = str(request.args.get('status') or '').strip().lower()
    subscription_id = _parse_int(request.args.get('subscription_id'))

    query = _tenant_scoped_query(BillingPromise, tenant_id)
    if status_filter:
        query = query.filter(BillingPromise.status == status_filter)
    if subscription_id is not None:
        query = query.filter(BillingPromise.subscription_id == subscription_id)

    items = [row.to_dict() for row in query.order_by(BillingPromise.created_at.desc()).limit(300).all()]
    summary = {
        "pending": sum(1 for row in items if row.get("status") == "pending"),
        "kept": sum(1 for row in items if row.get("status") == "kept"),
        "broken": sum(1 for row in items if row.get("status") == "broken"),
        "cancelled": sum(1 for row in items if row.get("status") == "cancelled"),
    }
    return jsonify({"items": items, "count": len(items), "summary": summary}), 200

@billing_bp.route('/admin/billing/promises', methods=['POST'])
@permission_required('billing.promises.write')
def admin_billing_promises_create():
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    data = request.get_json() or {}

    subscription_id = _parse_int(data.get('subscription_id'))
    promised_amount = _parse_money_value(data.get('promised_amount'))
    promised_date_raw = str(data.get('promised_date') or '').strip()
    notes = str(data.get('notes') or '').strip()

    if subscription_id is None:
        return jsonify({"error": "subscription_id es requerido"}), 400
    if promised_amount is None or promised_amount <= 0:
        return jsonify({"error": "promised_amount debe ser mayor a 0"}), 400
    if not promised_date_raw:
        return jsonify({"error": "promised_date es requerido (YYYY-MM-DD)"}), 400
    try:
        promised_date = date.fromisoformat(promised_date_raw)
    except Exception:
        return jsonify({"error": "promised_date invalido (YYYY-MM-DD)"}), 400

    subscription = db.session.get(Subscription, subscription_id)
    if not subscription:
        return jsonify({"error": "Suscripcion no encontrada"}), 404
    if tenant_id is not None and subscription.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Suscripcion fuera del tenant"}), 403

    promise = BillingPromise(
        tenant_id=tenant_id,
        subscription_id=subscription_id,
        promised_amount=promised_amount,
        promised_date=promised_date,
        status='pending',
        notes=notes,
        created_by=actor_id,
    )
    db.session.add(promise)
    db.session.commit()
    payload = promise.to_dict()
    _audit("billing_promise_create", entity_type="billing_promise", entity_id=promise.id, metadata=payload)
    return jsonify({"success": True, "promise": payload}), 201

@billing_bp.route('/admin/billing/promises/<int:promise_id>', methods=['PATCH'])
@permission_required('billing.promises.write')
def admin_billing_promises_update(promise_id):
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    promise = _tenant_scoped_query(BillingPromise, tenant_id).filter_by(id=promise_id).first()
    if not promise:
        return jsonify({"error": "Promesa no encontrada"}), 404

    data = request.get_json() or {}
    if 'status' in data:
        status = str(data.get('status') or '').strip().lower()
        if status not in {'pending', 'kept', 'broken', 'cancelled'}:
            return jsonify({"error": "status invalido"}), 400
        promise.status = status
        if status in {'kept', 'broken', 'cancelled'}:
            promise.resolved_by = actor_id
            promise.resolved_at = datetime.now(timezone.utc)
    
    if 'promised_amount' in data:
        promised_amount = _parse_money_value(data.get('promised_amount'))
        if promised_amount:
            promise.promised_amount = promised_amount
    
    if 'promised_date' in data:
        try:
            promise.promised_date = date.fromisoformat(data['promised_date'])
        except Exception:
            return jsonify({"error": "promised_date invalido"}), 400
            
    if 'notes' in data:
        promise.notes = str(data['notes']).strip()

    db.session.add(promise)
    db.session.commit()
    return jsonify({"success": True, "promise": promise.to_dict()}), 200
