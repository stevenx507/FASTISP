from .utils import *

@admin_bp.route('/dashboard', methods=['GET'])
@staff_required()
def dashboard_overview():
    tenant_id = current_tenant_id()

    clients_q = Client.query
    if tenant_id is not None:
        clients_q = clients_q.filter_by(tenant_id=tenant_id)
    clients_count = clients_q.count()

    routers_q = MikroTikRouter.query
    if tenant_id is not None:
        routers_q = routers_q.filter_by(tenant_id=tenant_id)
    routers_ok = routers_q.filter_by(is_active=True).count()
    routers_down = routers_q.filter_by(is_active=False).count()

    subs_q = Subscription.query
    if tenant_id is not None:
        subs_q = subs_q.filter_by(tenant_id=tenant_id)
    paid_today = sum(float(s.amount) for s in subs_q.filter_by(status='active').all())
    pending_amount = sum(float(s.amount) for s in subs_q.filter(Subscription.status.in_(['past_due', 'trial'])).all())

    overview = {
        "uptime": "99.9%",
        "currentSpeed": f"{max(30, routers_ok*5 + 50)} Mbps",
        "totalDownload": f"{clients_count * 120:.2f} GiB",
        "totalUpload": f"{clients_count * 45:.2f} GiB"
    }
    tickets = {"today": routers_down, "pending": max(routers_down, 0), "month": routers_down * 3}
    finance = {"paid_today": round(paid_today, 2), "pending": round(pending_amount, 2)}
    _audit("dashboard_view", entity_type="dashboard", metadata={"tenant_id": tenant_id, "routers_down": routers_down})
    return jsonify({"overview": overview, "tickets": tickets, "finance": finance, "clients": clients_count, "routers": {"ok": routers_ok, "down": routers_down}}), 200



@admin_bp.route('/platform/overview', methods=['GET'])
@platform_admin_required()
def platform_overview():
    tenants_total = Tenant.query.count()
    tenants_active = Tenant.query.filter_by(is_active=True).count()
    tenants_inactive = max(0, tenants_total - tenants_active)
    tenants_trial = Tenant.query.filter_by(billing_status='trial').count()
    tenants_past_due = Tenant.query.filter_by(billing_status='past_due').count()
    tenants_suspended = Tenant.query.filter_by(billing_status='suspended').count()
    users_total = User.query.count()
    clients_total = Client.query.count()
    routers_total = MikroTikRouter.query.count()
    subscriptions_total = Subscription.query.count()
    subscriptions_active = Subscription.query.filter_by(status='active').count()
    subscriptions_overdue = Subscription.query.filter(
        Subscription.status.in_(['past_due', 'suspended'])
    ).count()
    mrr_total = round(
        sum(
            float(tenant.monthly_price or 0)
            for tenant in Tenant.query.filter(
                Tenant.billing_status.in_(['trial', 'active', 'past_due'])
            ).all()
        ),
        2,
    )

    payload = {
        "tenants_total": tenants_total,
        "tenants_active": tenants_active,
        "tenants_inactive": tenants_inactive,
        "tenants_trial": tenants_trial,
        "tenants_past_due": tenants_past_due,
        "tenants_suspended": tenants_suspended,
        "users_total": users_total,
        "clients_total": clients_total,
        "routers_total": routers_total,
        "subscriptions_total": subscriptions_total,
        "subscriptions_active": subscriptions_active,
        "subscriptions_overdue": subscriptions_overdue,
        "mrr_total": mrr_total,
    }
    return jsonify(payload), 200



@admin_bp.route('/dashboard/stats', methods=['GET'])
@jwt_required()
def get_dashboard_stats():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    tenant_id = current_tenant_id()

    query = Client.query.filter_by(user_id=current_user_id)
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)

    client = query.first_or_404()
    with MikroTikService(client.router_id) as mikrotik:
        stats = mikrotik.get_client_dashboard_stats(client)
        return jsonify(stats), 200



