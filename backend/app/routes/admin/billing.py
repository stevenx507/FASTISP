from datetime import timezone
from .utils import *

@admin_bp.route('/admin/payments/manual', methods=['POST'])
@jwt_required()
def manual_payment():
    """Registra un pago manual (Yape/Nequi/transferencia) contra una factura."""
    user_id = _current_user_id()
    user = db.session.get(User, user_id)
    if not user or user.role != 'admin':
        return jsonify({"error": "Solo administradores pueden registrar pagos"}), 403

    data = request.get_json() or {}
    invoice_id = data.get('invoice_id')
    amount = data.get('amount')
    method = data.get('method', 'manual')
    reference = data.get('reference')
    meta = data.get('metadata')

    if not invoice_id or amount is None:
        return jsonify({"error": "invoice_id y amount son requeridos"}), 400

    invoice = db.session.get(Invoice, invoice_id)
    if not invoice:
        return jsonify({"error": "Factura no encontrada"}), 404

    tenant_id = current_tenant_id()
    if tenant_id and invoice.subscription and invoice.subscription.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Factura fuera del tenant"}), 403

    payment = PaymentRecord(
        invoice=invoice,
        method=method,
        reference=reference,
        amount=amount,
        currency=invoice.currency,
        status='paid',
        meta=meta,
    )
    invoice.status = 'paid'
    db.session.add(payment)
    db.session.commit()

    # Phase 5: Automated WhatsApp Notification
    try:
        if invoice.subscription and invoice.subscription.client and invoice.subscription.client.phone:
            client_name = invoice.subscription.client.name
            phone = invoice.subscription.client.phone
            MessagingManager.notify_payment_confirmed(tenant_id, client_name, phone, float(amount))
    except Exception as e:
        current_app.logger.error(f"Failed to send WhatsApp notification for payment {payment.id}: {e}")

    # Phase 5: Partner Commission Generation
    if invoice.subscription and invoice.subscription.client and invoice.subscription.client.partner_id:
        try:
            from app.models import Partner, PartnerCommission
            client = invoice.subscription.client
            partner = db.session.get(Partner, client.partner_id)
            if partner:
                commission_amount = float(payment.amount) * (partner.commission_percentage / 100)
                commission = PartnerCommission(
                    partner_id=partner.id,
                    client_id=client.id,
                    invoice_id=invoice.id,
                    amount=commission_amount,
                    status='pending'
                )
                db.session.add(commission)
                db.session.commit()
        except Exception as e:
            current_app.logger.error(f"Failed to generate partner commission for payment {payment.id}: {e}")

    return jsonify({"invoice": invoice.to_dict(), "payment": payment.to_dict()}), 201



@admin_bp.route('/admin/finance/summary', methods=['GET'])
@permission_required('billing.read')
def admin_finance_summary():
    tenant_id = current_tenant_id()
    now = datetime.now(timezone.utc)
    today = now.date()

    subscriptions_query = Subscription.query
    invoices_query = Invoice.query.join(Subscription, Invoice.subscription_id == Subscription.id)
    payments_query = PaymentRecord.query.join(Invoice, PaymentRecord.invoice_id == Invoice.id).join(
        Subscription, Invoice.subscription_id == Subscription.id
    )

    if tenant_id is not None:
        subscriptions_query = subscriptions_query.filter(Subscription.tenant_id == tenant_id)
        invoices_query = invoices_query.filter(Subscription.tenant_id == tenant_id)
        payments_query = payments_query.filter(Subscription.tenant_id == tenant_id)

    subscriptions = subscriptions_query.all()
    invoices = invoices_query.order_by(Invoice.created_at.desc()).all()
    payments = payments_query.order_by(PaymentRecord.created_at.desc()).all()

    active_status = {"active", "trial"}
    mrr = round(sum(float(sub.amount or 0) for sub in subscriptions if sub.status in active_status), 2)
    arr = round(mrr * 12, 2)

    pending_invoices = [invoice for invoice in invoices if invoice.status == 'pending']
    overdue_invoices = [invoice for invoice in pending_invoices if invoice.due_date and invoice.due_date < today]
    pending_balance = round(sum(float(invoice.total_amount or 0) for invoice in pending_invoices), 2)
    overdue_balance = round(sum(float(invoice.total_amount or 0) for invoice in overdue_invoices), 2)

    paid_this_month = round(
        sum(
            float(payment.amount or 0)
            for payment in payments
            if payment.status == 'paid'
            and payment.created_at
            and payment.created_at.year == now.year
            and payment.created_at.month == now.month
        ),
        2,
    )
    pending_this_month = round(
        sum(
            float(invoice.total_amount or 0)
            for invoice in pending_invoices
            if invoice.due_date and invoice.due_date.year == now.year and invoice.due_date.month == now.month
        ),
        2,
    )
    denominator = paid_this_month + pending_this_month
    collection_rate = round((paid_this_month / denominator) * 100, 2) if denominator > 0 else 100.0

    overdue_clients = [sub for sub in subscriptions if sub.status == 'past_due']
    suspended_clients = [sub for sub in subscriptions if sub.status == 'suspended']
    top_debtors = [
        {
            "subscription_id": sub.id,
            "customer": sub.customer,
            "amount": float(sub.amount or 0),
            "status": sub.status,
            "next_charge": sub.next_charge.isoformat() if sub.next_charge else None,
        }
        for sub in sorted(overdue_clients + suspended_clients, key=lambda row: float(row.amount or 0), reverse=True)[:10]
    ]

    aging = {
        "current": 0.0,
        "days_1_30": 0.0,
        "days_31_60": 0.0,
        "days_61_90": 0.0,
        "days_90_plus": 0.0,
    }
    for invoice in pending_invoices:
        amount = float(invoice.total_amount or 0)
        if not invoice.due_date:
            aging["current"] += amount
            continue
        days_overdue = (today - invoice.due_date).days
        if days_overdue <= 0:
            aging["current"] += amount
        elif days_overdue <= 30:
            aging["days_1_30"] += amount
        elif days_overdue <= 60:
            aging["days_31_60"] += amount
        elif days_overdue <= 90:
            aging["days_61_90"] += amount
        else:
            aging["days_90_plus"] += amount
    aging = {bucket: round(value, 2) for bucket, value in aging.items()}

    cursor = date(today.year, today.month, 1)
    months: list[date] = []
    for _ in range(6):
        months.append(cursor)
        prev_year = cursor.year
        prev_month = cursor.month - 1
        if prev_month == 0:
            prev_month = 12
            prev_year -= 1
        cursor = date(prev_year, prev_month, 1)
    months.reverse()

    cashflow_map: dict[str, dict] = {}
    for month_point in months:
        key = month_point.strftime('%Y-%m')
        cashflow_map[key] = {"label": month_point.strftime('%b %Y'), "paid": 0.0, "pending": 0.0}

    for payment in payments:
        if payment.status != 'paid' or not payment.created_at:
            continue
        key = payment.created_at.strftime('%Y-%m')
        if key in cashflow_map:
            cashflow_map[key]["paid"] += float(payment.amount or 0)

    for invoice in pending_invoices:
        if not invoice.due_date:
            continue
        key = invoice.due_date.strftime('%Y-%m')
        if key in cashflow_map:
            cashflow_map[key]["pending"] += float(invoice.total_amount or 0)

    cashflow = [
        {"label": row["label"], "paid": round(row["paid"], 2), "pending": round(row["pending"], 2)}
        for row in cashflow_map.values()
    ]

    recent_invoices = []
    for invoice in invoices[:20]:
        subscription = invoice.subscription
        recent_invoices.append(
            {
                "id": invoice.id,
                "customer": subscription.customer if subscription else None,
                "status": invoice.status,
                "currency": invoice.currency,
                "amount": float(invoice.amount or 0),
                "total_amount": float(invoice.total_amount or 0),
                "due_date": invoice.due_date.isoformat() if invoice.due_date else None,
                "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
            }
        )

    summary = {
        "mrr": mrr,
        "arr": arr,
        "pending_balance": pending_balance,
        "overdue_balance": overdue_balance,
        "paid_this_month": paid_this_month,
        "pending_this_month": pending_this_month,
        "collection_rate": collection_rate,
        "subscriptions_total": len(subscriptions),
        "invoices_total": len(invoices),
        "overdue_clients": len(overdue_clients),
        "suspended_clients": len(suspended_clients),
        "updated_at": _iso_utc_now(),
    }

    _audit("finance_summary", entity_type="finance", metadata=summary)
    return jsonify(
        {
            "summary": summary,
            "aging": aging,
            "cashflow": cashflow,
            "top_debtors": top_debtors,
            "recent_invoices": recent_invoices,
        }
    ), 200



@admin_bp.route('/admin/payments/<int:payment_id>/review', methods=['PATCH'])
@permission_required('payments.review')
def admin_payments_review(payment_id):
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    payment = db.session.get(PaymentRecord, payment_id)
    if not payment:
        return jsonify({"error": "Pago no encontrado"}), 404
    invoice = payment.invoice
    if not invoice:
        return jsonify({"error": "Pago sin factura asociada"}), 409
    subscription = invoice.subscription
    if tenant_id is not None and subscription and subscription.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Pago fuera del tenant"}), 403

    data = request.get_json() or {}
    status = str(data.get('status') or '').strip().lower()
    if status not in {'paid', 'failed', 'pending'}:
        return jsonify({"error": "status invalido. permitidos: paid | failed | pending"}), 400
    note = str(data.get('note') or '').strip()

    payment.status = status
    meta = payment.meta if isinstance(payment.meta, dict) else {}
    meta['reviewed_by'] = actor_id
    meta['reviewed_at'] = _iso_utc_now()
    if note:
        meta['review_note'] = note
    payment.meta = meta

    if status == 'paid':
        invoice.status = 'paid'
        if subscription and subscription.status in {'past_due', 'suspended'}:
            subscription.status = 'active'
            db.session.add(subscription)
    elif status == 'failed' and invoice.status == 'paid':
        invoice.status = 'pending'

    db.session.add(payment)
    db.session.add(invoice)
    db.session.commit()
    payload = {"payment": payment.to_dict(), "invoice": invoice.to_dict()}
    _audit("payment_review", entity_type="payment", entity_id=payment.id, metadata={"status": status, "invoice_id": invoice.id})
    return jsonify({"success": True, **payload}), 200

@admin_bp.route('/admin/billing/generate-batch', methods=['POST'])
@jwt_required()
def admin_billing_generate_batch():
    """Triggers the monthly invoice generation batch job via Celery."""
    user_id = _current_user_id()
    user = db.session.get(User, user_id)
    if not user or user.role not in ('admin', 'platform_admin', 'billing'):
        return jsonify({"error": "No tienes permisos para generar facturas masivas"}), 403

    tenant_id = current_tenant_id()
    
    # Try to trigger via Celery if available
    try:
        from app.tasks import generate_monthly_invoices_task
        task = generate_monthly_invoices_task.delay(tenant_id=tenant_id)
        
        _audit("generate_batch_started", entity_type="billing", metadata={"task_id": task.id})
        return jsonify({
            "success": True, 
            "message": "Generacion masiva iniciada en segundo plano",
            "task_id": task.id,
            "generated_count": 0 # The frontend expects a generated_count, we return 0 for async
        }), 202
    except Exception as e:
        current_app.logger.error(f"Failed to trigger generate_monthly_invoices_task: {e}")
        return jsonify({"error": f"Error al iniciar generacion masiva: {str(e)}"}), 500
