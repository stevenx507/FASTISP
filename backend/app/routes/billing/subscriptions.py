from datetime import datetime, timedelta, timezone
from flask import jsonify, request
from app.models import Subscription, Client
from app import db
from app.tenancy import current_tenant_id, admin_required
from app.services.mikrotik_service import MikroTikService
from . import billing_bp
from .helpers import _audit

@billing_bp.route('/subscriptions', methods=['POST'])
@admin_required()
def create_subscription():
    data = request.get_json() or {}
    required = ['customer', 'email', 'plan', 'cycle_months', 'amount', 'next_charge', 'method']
    missing = [k for k in required if k not in data or data[k] in (None, '')]
    if missing:
        return jsonify({"error": f"Faltan campos: {', '.join(missing)}"}), 400

    tenant_id = current_tenant_id()
    subscription = Subscription(
        customer=data['customer'],
        email=data['email'],
        plan=data['plan'],
        cycle_months=int(data['cycle_months']),
        amount=float(data['amount']),
        status=data.get('status', 'active'),
        next_charge=datetime.fromisoformat(data['next_charge']).date(),
        method=data['method'],
        client_id=int(data['client_id']) if data.get('client_id') else None,
        tenant_id=tenant_id,
    )
    db.session.add(subscription)
    db.session.commit()
    return jsonify({"subscription": subscription.to_dict(), "success": True}), 201

@billing_bp.route('/subscriptions/<int:subscription_id>', methods=['PUT', 'PATCH'])
@admin_required()
def update_subscription(subscription_id):
    data = request.get_json() or {}
    sub = db.session.get(Subscription, subscription_id)
    if not sub:
        return jsonify({"error": "Suscripcion no encontrada"}), 404
    
    tenant_id = current_tenant_id()
    if tenant_id is not None and sub.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403
    
    prev_status = sub.status
    for field in ['customer', 'email', 'plan', 'method', 'status']:
        if field in data:
            setattr(sub, field, data[field])
    
    if 'cycle_months' in data:
        sub.cycle_months = int(data['cycle_months'])
    if 'amount' in data:
        sub.amount = float(data['amount'])
    if 'next_charge' in data:
        sub.next_charge = datetime.fromisoformat(data['next_charge']).date()

    db.session.add(sub)
    db.session.commit()

    # Sincronizar estado con router y denormalizar en cliente
    client = sub.client or (db.session.get(Client, sub.client_id) if sub.client_id else None)
    if client:
        client.status = sub.status
        db.session.add(client)
        
        if client.router_id and sub.status != prev_status:
            try:
                with MikroTikService(client.router_id) as mk:
                    if sub.status == 'active':
                        mk.activate_client(client)
                    elif sub.status in ('past_due', 'suspended'):
                        mk.suspend_client(client)
            except Exception:
                pass

    return jsonify({"subscription": sub.to_dict(), "success": True}), 200

@billing_bp.route('/subscriptions/<int:subscription_id>/charge', methods=['POST'])
@admin_required()
def charge_subscription(subscription_id):
    sub = db.session.get(Subscription, subscription_id)
    if not sub:
        return jsonify({"error": "Suscripcion no encontrada"}), 404
    
    tenant_id = current_tenant_id()
    if tenant_id is not None and sub.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403
    
    sub.status = 'active'
    # avanzar proxima fecha segun ciclo
    days = sub.cycle_months * 30
    sub.next_charge = sub.next_charge + timedelta(days=days)
    
    db.session.add(sub)
    db.session.commit()
    
    client = sub.client or (db.session.get(Client, sub.client_id) if sub.client_id else None)
    if client:
        client.status = 'active'
        db.session.add(client)
        if client.router_id:
            try:
                with MikroTikService(client.router_id) as mk:
                    mk.activate_client(client)
            except Exception:
                pass
            
    return jsonify({"subscription": sub.to_dict(), "success": True}), 200

@billing_bp.route('/subscriptions/auto-enforce', methods=['POST'])
@admin_required()
def enforce_subscription_status():
    """Suspende suscripciones vencidas y reactiva pagadas."""
    tenant_id = current_tenant_id()
    today = datetime.now(timezone.utc).date()
    query = Subscription.query
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)

    suspended = 0
    reactivated = 0
    for sub in query.all():
        days_overdue = (today - sub.next_charge).days if sub.next_charge else 0
        if sub.status == 'past_due' and days_overdue >= 10:
            sub.status = 'suspended'
            suspended += 1
            # Actualizar router si hay cliente
            client = sub.client or (db.session.get(Client, sub.client_id) if sub.client_id else None)
            if client:
                client.status = 'suspended'
                db.session.add(client)
                if client.router_id:
                    try:
                        with MikroTikService(client.router_id) as mk:
                            mk.suspend_client(client)
                    except Exception:
                        pass
        
        if sub.status in ('past_due', 'suspended') and days_overdue <= 0:
            sub.status = 'active'
            reactivated += 1
            # Actualizar router si hay cliente
            client = sub.client or (db.session.get(Client, sub.client_id) if sub.client_id else None)
            if client:
                client.status = 'active'
                db.session.add(client)
                if client.router_id:
                    try:
                        with MikroTikService(client.router_id) as mk:
                            mk.activate_client(client)
                    except Exception:
                        pass

    db.session.commit()
    _audit("subscriptions_auto_enforce", entity_type="subscription", metadata={"suspended": suspended, "reactivated": reactivated})
    return jsonify({"success": True, "suspended": suspended, "reactivated": reactivated}), 200
