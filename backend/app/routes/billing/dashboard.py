from flask import jsonify
from app.models import Subscription, Invoice
from app.tenancy import current_tenant_id, staff_required
from . import billing_bp

@billing_bp.route('/billing', methods=['GET'])
@staff_required()
def billing_dashboard():
    tenant_id = current_tenant_id()
    
    # Simple summary for dashboard
    query_sub = Subscription.query
    query_inv = Invoice.query
    if tenant_id is not None:
        query_sub = query_sub.filter_by(tenant_id=tenant_id)
        query_inv = query_inv.join(Subscription).filter(Subscription.tenant_id == tenant_id)
        
    active_subs = query_sub.filter_by(status='active').count()
    past_due_subs = query_sub.filter_by(status='past_due').count()
    pending_invoices = query_inv.filter_by(status='pending').count()
    
    return jsonify({
        "summary": {
            "active_subscriptions": active_subs,
            "past_due_subscriptions": past_due_subs,
            "pending_invoices": pending_invoices
        }
    }), 200
