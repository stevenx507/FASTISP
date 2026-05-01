from datetime import timezone
from .utils import *

@admin_bp.route('/admin/notifications/history', methods=['GET'])
@admin_required()
def admin_notifications_history():
    tenant_id = current_tenant_id()
    try:
        limit = int(request.args.get('limit', 50) or 50)
    except Exception:
        limit = 50
    limit = max(1, min(limit, 200))
    history = _load_notification_history(tenant_id)
    return jsonify({"items": history[:limit], "count": min(len(history), limit)}), 200



@admin_bp.route('/admin/notifications/send', methods=['POST'])
@admin_required()
def admin_notifications_send():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    title = (data.get('title') or '').strip()
    message = (data.get('message') or '').strip()
    if not title or not message:
        return jsonify({"error": "title y message son requeridos"}), 400

    channel = (data.get('channel') or 'push').strip().lower()
    if channel not in {'push', 'email', 'whatsapp', 'system'}:
        return jsonify({"error": "channel invalido: push | email | whatsapp | system"}), 400

    audience = (data.get('audience') or 'all').strip().lower()
    if audience not in {'all', 'active', 'overdue', 'suspended'}:
        return jsonify({"error": "audience invalido: all | active | overdue | suspended"}), 400

    router_id_raw = data.get('router_id')
    router_id = None
    if router_id_raw not in (None, ''):
        try:
            router_id = int(router_id_raw)
        except Exception:
            return jsonify({"error": "router_id debe ser numerico"}), 400
    plan_name = (data.get('plan') or '').strip().lower()

    clients_query = Client.query.options(joinedload(Client.plan), joinedload(Client.subscriptions))
    if tenant_id is not None:
        clients_query = clients_query.filter_by(tenant_id=tenant_id)
    if router_id:
        clients_query = clients_query.filter_by(router_id=router_id)

    selected_clients = []
    for client in clients_query.all():
        if plan_name:
            client_plan = (client.plan.name if client.plan else "").strip().lower()
            if client_plan != plan_name:
                continue
        status = "active"
        if client.subscriptions:
            status = (client.subscriptions[0].status or "active").strip().lower()
        if audience == 'active' and status not in {'active', 'trial'}:
            continue
        if audience == 'overdue' and status != 'past_due':
            continue
        if audience == 'suspended' and status != 'suspended':
            continue
        selected_clients.append(client)

    actor = _current_actor_snapshot()
    entry = {
        "id": secrets.token_hex(8),
        "title": title,
        "message": message,
        "channel": channel,
        "audience": audience,
        "plan": plan_name or None,
        "router_id": router_id,
        "target_count": len(selected_clients),
        "status": "sent",
        "created_by": actor.get("id"),
        "created_by_name": actor.get("name"),
        "sent_at": _iso_utc_now(),
    }

    history = _load_notification_history(tenant_id)
    history.insert(0, entry)
    _save_notification_history(tenant_id, history)
    _notify_incident(f"Notificacion masiva ({channel}) enviada: {title} -> {len(selected_clients)} destinos", severity="info")
    _audit("notification_send", entity_type="notification", entity_id=entry["id"], metadata=entry)

    return jsonify({"success": True, "notification": entry}), 201


# ==================== ADMIN: FINANCE / INSTALLATIONS / CONTENT / SYSTEM ====================


@admin_bp.route('/admin/screen-alerts', methods=['GET'])
@permission_required('communications.alerts.read')
def admin_screen_alerts_list():
    tenant_id = current_tenant_id()
    key = _screen_alerts_key(tenant_id)
    rows = _tenant_scoped_query(AdminScreenAlert, tenant_id).order_by(AdminScreenAlert.created_at.desc()).all()
    if not rows:
        cached_items = _load_cached_list(key)
        seed_items = cached_items or _default_screen_alerts()
        for entry in seed_items:
            db.session.add(_screen_alert_model_from_entry(entry, tenant_id))
        db.session.commit()
        rows = _tenant_scoped_query(AdminScreenAlert, tenant_id).order_by(AdminScreenAlert.created_at.desc()).all()
    items = [row.to_dict() for row in rows]

    status_filter = (request.args.get('status') or '').strip().lower()
    if status_filter:
        items = [item for item in items if str(item.get("status") or "").lower() == status_filter]

    summary = {status: 0 for status in SCREEN_ALERT_ALLOWED_STATUS}
    for item in items:
        state = str(item.get("status") or "draft")
        summary[state] = summary.get(state, 0) + 1

    return jsonify({"items": items, "count": len(items), "summary": summary}), 200



@admin_bp.route('/admin/screen-alerts', methods=['POST'])
@permission_required('communications.alerts.write')
def admin_screen_alerts_create():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    actor = _current_actor_snapshot()
    title = (data.get('title') or '').strip()
    message = (data.get('message') or '').strip()
    if not title or not message:
        return jsonify({"error": "title y message son requeridos"}), 400

    severity = (data.get('severity') or 'info').strip().lower()
    if severity not in SCREEN_ALERT_ALLOWED_SEVERITY:
        return jsonify({"error": f"severity invalido. permitidos: {', '.join(sorted(SCREEN_ALERT_ALLOWED_SEVERITY))}"}), 400

    audience = (data.get('audience') or 'all').strip().lower()
    if audience not in SCREEN_ALERT_ALLOWED_AUDIENCE:
        return jsonify({"error": f"audience invalido. permitidos: {', '.join(sorted(SCREEN_ALERT_ALLOWED_AUDIENCE))}"}), 400

    status = (data.get('status') or 'draft').strip().lower()
    if status not in SCREEN_ALERT_ALLOWED_STATUS:
        return jsonify({"error": f"status invalido. permitidos: {', '.join(sorted(SCREEN_ALERT_ALLOWED_STATUS))}"}), 400

    entry = {
        "id": secrets.token_hex(8),
        "title": title,
        "message": message,
        "severity": severity,
        "audience": audience,
        "status": status,
        "starts_at": (data.get('starts_at') or _iso_utc_now()),
        "ends_at": data.get('ends_at'),
        "impressions": 0,
        "acknowledged": 0,
    }
    _apply_operational_entry_create_metadata(entry, actor=actor)
    record = _screen_alert_model_from_entry(entry, tenant_id)
    db.session.add(record)
    db.session.commit()
    payload = record.to_dict()
    _save_cached_list(_screen_alerts_key(tenant_id), [payload], max_items=400)
    _audit("screen_alert_create", entity_type="screen_alert", entity_id=record.id, metadata=payload)
    return jsonify({"success": True, "alert": payload}), 201



@admin_bp.route('/admin/screen-alerts/<string:alert_id>', methods=['PATCH'])
@permission_required('communications.alerts.write')
def admin_screen_alerts_update(alert_id):
    tenant_id = current_tenant_id()
    record = _tenant_scoped_query(AdminScreenAlert, tenant_id).filter_by(id=alert_id).first()
    if not record:
        return jsonify({"error": "Alerta no encontrada"}), 404

    actor = _current_actor_snapshot()
    entry = record.to_dict()
    _ensure_operational_entry_metadata(entry)
    data = request.get_json() or {}
    if 'title' in data:
        title = str(data.get('title') or '').strip()
        if not title:
            return jsonify({"error": "title no puede estar vacio"}), 400
        entry['title'] = title
    if 'message' in data:
        message = str(data.get('message') or '').strip()
        if not message:
            return jsonify({"error": "message no puede estar vacio"}), 400
        entry['message'] = message
    if 'severity' in data:
        severity = str(data.get('severity') or '').strip().lower()
        if severity not in SCREEN_ALERT_ALLOWED_SEVERITY:
            return jsonify({"error": f"severity invalido. permitidos: {', '.join(sorted(SCREEN_ALERT_ALLOWED_SEVERITY))}"}), 400
        entry['severity'] = severity
    if 'audience' in data:
        audience = str(data.get('audience') or '').strip().lower()
        if audience not in SCREEN_ALERT_ALLOWED_AUDIENCE:
            return jsonify({"error": f"audience invalido. permitidos: {', '.join(sorted(SCREEN_ALERT_ALLOWED_AUDIENCE))}"}), 400
        entry['audience'] = audience
    if 'status' in data:
        status = str(data.get('status') or '').strip().lower()
        if status not in SCREEN_ALERT_ALLOWED_STATUS:
            return jsonify({"error": f"status invalido. permitidos: {', '.join(sorted(SCREEN_ALERT_ALLOWED_STATUS))}"}), 400
        entry['status'] = status
    if 'starts_at' in data:
        entry['starts_at'] = data.get('starts_at')
    if 'ends_at' in data:
        entry['ends_at'] = data.get('ends_at')
    if 'impressions_delta' in data:
        entry['impressions'] = max(0, int(entry.get('impressions') or 0) + int(data.get('impressions_delta') or 0))
    if 'acknowledged_delta' in data:
        entry['acknowledged'] = max(0, int(entry.get('acknowledged') or 0) + int(data.get('acknowledged_delta') or 0))

    _apply_operational_entry_update_metadata(entry, actor=actor)
    record.title = entry.get('title')
    record.message = entry.get('message')
    record.severity = entry.get('severity')
    record.audience = entry.get('audience')
    record.status = entry.get('status')
    record.starts_at = _parse_iso_datetime(entry.get('starts_at'))
    record.ends_at = _parse_iso_datetime(entry.get('ends_at'))
    record.impressions = int(entry.get('impressions') or 0)
    record.acknowledged = int(entry.get('acknowledged') or 0)
    record.created_by = _parse_int(entry.get('created_by'))
    record.created_by_name = entry.get('created_by_name')
    record.created_by_email = entry.get('created_by_email')
    record.updated_by = _parse_int(entry.get('updated_by'))
    record.updated_by_name = entry.get('updated_by_name')
    record.updated_by_email = entry.get('updated_by_email')
    record.created_at = _parse_iso_datetime(entry.get('created_at')) or record.created_at
    record.updated_at = _parse_iso_datetime(entry.get('updated_at')) or datetime.now(timezone.utc)
    db.session.add(record)
    db.session.commit()
    _save_cached_list(_screen_alerts_key(tenant_id), [record.to_dict()], max_items=400)
    _audit("screen_alert_update", entity_type="screen_alert", entity_id=alert_id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "alert": record.to_dict()}), 200



