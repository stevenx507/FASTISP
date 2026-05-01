from datetime import timezone
from .utils import *

@admin_bp.route('/runbooks', methods=['GET'])
@staff_required()
def runbooks():
    books = [
        {"id": "RB-001", "title": "Cliente sin navegacion", "steps": ["Ping gateway", "Reiniciar CPE", "Verificar colas", "Abrir ticket si persiste"]},
        {"id": "RB-002", "title": "Alto uso de CPU en RouterOS", "steps": ["Export stats", "Revisar firewall rules", "Limitar conexiones", "Programar mantenimiento"]},
    ]
    return jsonify({"items": books, "count": len(books)}), 200



@admin_bp.route('/prometheus/metrics', methods=['GET'])
def prometheus_metrics():
    tenant_id = current_tenant_id()
    data = _build_network_health_payload(tenant_id)
    alerts_count = len(_build_network_alert_items(tenant_id))
    content = [
        "# HELP ispfast_network_health_score Health score",
        "# TYPE ispfast_network_health_score gauge",
        f"ispfast_network_health_score {data.get('score', 0)}",
        "# HELP ispfast_alerts_total Total alertas activas",
        "# TYPE ispfast_alerts_total gauge",
        f"ispfast_alerts_total {alerts_count}",
    ]
    return Response("\n".join(content) + "\n", mimetype="text/plain")



@admin_bp.route('/admin/extra-services', methods=['GET'])
@permission_required('catalog.read')
def admin_extra_services_list():
    tenant_id = current_tenant_id()
    key = _extra_services_key(tenant_id)
    rows = _tenant_scoped_query(AdminExtraService, tenant_id).order_by(AdminExtraService.created_at.desc()).all()
    if not rows:
        cached_items = _load_cached_list(key)
        seed_items = cached_items or _default_extra_services(tenant_id)
        for entry in seed_items:
            db.session.add(_extra_service_model_from_entry(entry, tenant_id))
        db.session.commit()
        rows = _tenant_scoped_query(AdminExtraService, tenant_id).order_by(AdminExtraService.created_at.desc()).all()
    items = [row.to_dict() for row in rows]

    status_filter = (request.args.get('status') or '').strip().lower()
    if status_filter:
        items = [item for item in items if str(item.get("status") or "").lower() == status_filter]

    summary = {
        "services_total": len(items),
        "active_services": sum(1 for item in items if item.get("status") == "active"),
        "subscribers_total": sum(int(item.get("subscribers") or 0) for item in items),
        "mrr_estimated": round(
            sum(float(item.get("monthly_price") or 0) * int(item.get("subscribers") or 0) for item in items), 2
        ),
    }
    return jsonify({"items": items, "count": len(items), "summary": summary}), 200



@admin_bp.route('/admin/extra-services', methods=['POST'])
@permission_required('catalog.write')
def admin_extra_services_create():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    actor = _current_actor_snapshot()
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "name es requerido"}), 400

    status = (data.get('status') or 'active').strip().lower()
    if status not in EXTRA_SERVICE_ALLOWED_STATUS:
        return jsonify({"error": f"status invalido. permitidos: {', '.join(sorted(EXTRA_SERVICE_ALLOWED_STATUS))}"}), 400

    entry = {
        "id": secrets.token_hex(8),
        "name": name,
        "category": (data.get('category') or 'other').strip().lower(),
        "description": (data.get('description') or '').strip(),
        "monthly_price": round(float(data.get('monthly_price') or 0), 2),
        "one_time_fee": round(float(data.get('one_time_fee') or 0), 2),
        "status": status,
        "subscribers": int(data.get('subscribers') or 0),
    }
    _apply_operational_entry_create_metadata(entry, actor=actor)
    record = _extra_service_model_from_entry(entry, tenant_id)
    db.session.add(record)
    db.session.commit()
    payload = record.to_dict()
    _save_cached_list(_extra_services_key(tenant_id), [payload], max_items=300)
    _audit("extra_service_create", entity_type="extra_service", entity_id=record.id, metadata=payload)
    return jsonify({"success": True, "service": payload}), 201



@admin_bp.route('/admin/extra-services/<string:service_id>', methods=['PATCH'])
@permission_required('catalog.write')
def admin_extra_services_update(service_id):
    tenant_id = current_tenant_id()
    record = _tenant_scoped_query(AdminExtraService, tenant_id).filter_by(id=service_id).first()
    if not record:
        return jsonify({"error": "Servicio no encontrado"}), 404

    actor = _current_actor_snapshot()
    entry = record.to_dict()
    _ensure_operational_entry_metadata(entry)
    data = request.get_json() or {}
    if 'name' in data:
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({"error": "name no puede estar vacio"}), 400
        entry['name'] = name
    if 'category' in data:
        entry['category'] = str(data.get('category') or 'other').strip().lower() or 'other'
    if 'description' in data:
        entry['description'] = str(data.get('description') or '').strip()
    if 'monthly_price' in data:
        entry['monthly_price'] = round(float(data.get('monthly_price') or 0), 2)
    if 'one_time_fee' in data:
        entry['one_time_fee'] = round(float(data.get('one_time_fee') or 0), 2)
    if 'subscribers' in data:
        entry['subscribers'] = max(0, int(data.get('subscribers') or 0))
    if 'status' in data:
        status = str(data.get('status') or '').strip().lower()
        if status not in EXTRA_SERVICE_ALLOWED_STATUS:
            return jsonify({"error": f"status invalido. permitidos: {', '.join(sorted(EXTRA_SERVICE_ALLOWED_STATUS))}"}), 400
        entry['status'] = status

    _apply_operational_entry_update_metadata(entry, actor=actor)
    record.name = entry.get('name')
    record.category = entry.get('category')
    record.description = entry.get('description')
    record.monthly_price = round(float(entry.get('monthly_price') or 0), 2)
    record.one_time_fee = round(float(entry.get('one_time_fee') or 0), 2)
    record.status = entry.get('status')
    record.subscribers = max(0, int(entry.get('subscribers') or 0))
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
    _save_cached_list(_extra_services_key(tenant_id), [record.to_dict()], max_items=300)
    _audit("extra_service_update", entity_type="extra_service", entity_id=service_id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "service": record.to_dict()}), 200



@admin_bp.route('/admin/hotspot/vouchers', methods=['GET'])
@permission_required('hotspot.read')
def admin_hotspot_vouchers_list():
    tenant_id = current_tenant_id()
    key = _hotspot_vouchers_key(tenant_id)
    rows = _tenant_scoped_query(AdminHotspotVoucher, tenant_id).order_by(AdminHotspotVoucher.created_at.desc()).all()
    if not rows:
        cached_items = _load_cached_list(key)
        if cached_items:
            for entry in cached_items:
                db.session.add(_hotspot_voucher_model_from_entry(entry, tenant_id))
            db.session.commit()
            rows = _tenant_scoped_query(AdminHotspotVoucher, tenant_id).order_by(AdminHotspotVoucher.created_at.desc()).all()
    items = [row.to_dict() for row in rows]

    status_filter = (request.args.get('status') or '').strip().lower()
    if status_filter:
        items = [item for item in items if str(item.get("status") or "").lower() == status_filter]

    summary = {status: 0 for status in HOTSPOT_VOUCHER_ALLOWED_STATUS}
    revenue_estimated = 0.0
    for item in items:
        state = str(item.get("status") or "generated")
        summary[state] = summary.get(state, 0) + 1
        if state in {"sold", "used"}:
            revenue_estimated += float(item.get("price") or 0)
    return jsonify(
        {
            "items": items[:300],
            "count": len(items),
            "summary": summary,
            "revenue_estimated": round(revenue_estimated, 2),
        }
    ), 200



@admin_bp.route('/admin/hotspot/vouchers', methods=['POST'])
@permission_required('hotspot.write')
def admin_hotspot_vouchers_create():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    actor = _current_actor_snapshot()

    try:
        quantity = int(data.get('quantity') or 1)
    except Exception:
        quantity = 1
    quantity = max(1, min(quantity, 200))

    profile = (data.get('profile') or 'basic').strip().lower() or 'basic'
    duration_minutes = max(5, int(data.get('duration_minutes') or 60))
    data_limit_mb = max(0, int(data.get('data_limit_mb') or 0))
    price = round(float(data.get('price') or 0), 2)
    expires_days = max(1, int(data.get('expires_days') or 7))
    now = datetime.now(timezone.utc).replace(microsecond=0)

    key = _hotspot_vouchers_key(tenant_id)
    items = []
    created = []
    for _ in range(quantity):
        code_prefix = ''.join(ch for ch in profile.upper() if ch.isalnum())[:3] or 'VCH'
        code = f"{code_prefix}-{secrets.token_hex(3).upper()}"
        entry = {
            "id": secrets.token_hex(8),
            "code": code,
            "profile": profile,
            "duration_minutes": duration_minutes,
            "data_limit_mb": data_limit_mb,
            "price": price,
            "status": "generated",
            "assigned_to": None,
            "expires_at": (now + timedelta(days=expires_days)).isoformat() + "Z",
            "used_at": None,
        }
        _apply_operational_entry_create_metadata(entry, actor=actor)
        record = _hotspot_voucher_model_from_entry(entry, tenant_id)
        db.session.add(record)
        payload = record.to_dict()
        items.append(payload)
        created.append(payload)

    db.session.commit()
    _save_cached_list(key, created, max_items=1000)
    _audit(
        "hotspot_vouchers_create",
        entity_type="hotspot_voucher",
        metadata={"quantity": quantity, "profile": profile, "price": price},
    )
    return jsonify({"success": True, "items": created, "count": len(created)}), 201



@admin_bp.route('/admin/hotspot/vouchers/<string:voucher_id>', methods=['PATCH'])
@permission_required('hotspot.write')
def admin_hotspot_vouchers_update(voucher_id):
    tenant_id = current_tenant_id()
    record = _tenant_scoped_query(AdminHotspotVoucher, tenant_id).filter_by(id=voucher_id).first()
    if not record:
        return jsonify({"error": "Voucher no encontrado"}), 404

    actor = _current_actor_snapshot()
    entry = record.to_dict()
    _ensure_operational_entry_metadata(entry)
    data = request.get_json() or {}
    if 'status' in data:
        status = str(data.get('status') or '').strip().lower()
        if status not in HOTSPOT_VOUCHER_ALLOWED_STATUS:
            return jsonify({"error": f"status invalido. permitidos: {', '.join(sorted(HOTSPOT_VOUCHER_ALLOWED_STATUS))}"}), 400
        entry['status'] = status
        if status == 'used':
            entry['used_at'] = entry.get('used_at') or _iso_utc_now()
    if 'assigned_to' in data:
        entry['assigned_to'] = str(data.get('assigned_to') or '').strip() or None
    if 'expires_at' in data:
        entry['expires_at'] = data.get('expires_at')

    _apply_operational_entry_update_metadata(entry, actor=actor)
    record.code = str(entry.get('code') or record.code).upper()
    record.profile = str(entry.get('profile') or 'basic').lower()
    record.duration_minutes = max(1, int(entry.get('duration_minutes') or 60))
    record.data_limit_mb = max(0, int(entry.get('data_limit_mb') or 0))
    record.price = round(float(entry.get('price') or 0), 2)
    record.status = str(entry.get('status') or 'generated').lower()
    record.assigned_to = str(entry.get('assigned_to') or '').strip() or None
    record.expires_at = _parse_iso_datetime(entry.get('expires_at'))
    record.used_at = _parse_iso_datetime(entry.get('used_at'))
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
    _save_cached_list(_hotspot_vouchers_key(tenant_id), [record.to_dict()], max_items=1000)
    _audit("hotspot_voucher_update", entity_type="hotspot_voucher", entity_id=voucher_id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "voucher": record.to_dict()}), 200



@admin_bp.route('/admin/ops/sops', methods=['GET'])
@permission_required('ops.sops.read')
def admin_ops_sops_list():
    tenant_id = current_tenant_id()
    sops = _load_ops_sops(tenant_id)
    return jsonify({"items": sops, "count": len(sops)}), 200



@admin_bp.route('/admin/ops/sops', methods=['POST'])
@permission_required('ops.sops.write')
def admin_ops_sops_upsert():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    incoming = data.get("items") if isinstance(data.get("items"), list) else data.get("sops")
    if not isinstance(incoming, list):
        return jsonify({"error": "items (lista) es requerido"}), 400

    normalized = []
    for index, row in enumerate(incoming):
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        checklist_raw = row.get("checklist")
        checklist = []
        if isinstance(checklist_raw, list):
            for item_index, item in enumerate(checklist_raw):
                if isinstance(item, dict):
                    label = str(item.get("label") or "").strip()
                    if not label:
                        continue
                    checklist.append(
                        {
                            "id": str(item.get("id") or _slugify(label) or f"item-{item_index + 1}"),
                            "label": label,
                            "required": bool(item.get("required", True)),
                        }
                    )
                else:
                    label = str(item or "").strip()
                    if not label:
                        continue
                    checklist.append(
                        {
                            "id": _slugify(label) or f"item-{item_index + 1}",
                            "label": label,
                            "required": True,
                        }
                    )
        normalized.append(
            {
                "id": str(row.get("id") or _slugify(title) or f"sop-{index + 1}"),
                "title": title,
                "category": str(row.get("category") or "general").strip().lower(),
                "owner_role": str(row.get("owner_role") or "admin").strip().lower(),
                "checklist": checklist,
                "updated_at": _iso_utc_now(),
            }
        )

    if not normalized:
        return jsonify({"error": "No se enviaron SOPs validos"}), 400

    _save_ops_sops(tenant_id, normalized, updated_by=_current_user_id())
    _audit("ops_sops_upsert", entity_type="ops_sops", metadata={"count": len(normalized)})
    return jsonify({"success": True, "items": normalized, "count": len(normalized)}), 200



@admin_bp.route('/admin/ops/change-requests', methods=['GET'])
@permission_required('ops.change.read')
def admin_ops_change_requests_list():
    tenant_id = current_tenant_id()
    status_filter = str(request.args.get("status") or "").strip().lower()
    requests_list = _load_ops_change_requests(tenant_id)
    if status_filter:
        requests_list = [item for item in requests_list if str(item.get("status") or "").lower() == status_filter]
    requests_list = sorted(requests_list, key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return jsonify({"items": requests_list[:300], "count": len(requests_list)}), 200



@admin_bp.route('/admin/ops/change-requests', methods=['POST'])
@permission_required('ops.change.write')
def admin_ops_change_requests_create():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    title = str(data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title es requerido"}), 400

    window_start = _parse_iso_datetime(data.get("window_start"))
    window_end = _parse_iso_datetime(data.get("window_end"))
    if window_start and window_end and window_end <= window_start:
        return jsonify({"error": "window_end debe ser mayor a window_start"}), 400

    status = str(data.get("status") or "requested").strip().lower()
    if status not in OPS_CHANGE_ALLOWED_STATUS:
        return jsonify({"error": f"status invalido. permitidos: {', '.join(sorted(OPS_CHANGE_ALLOWED_STATUS))}"}), 400

    checklist = data.get("checklist")
    if not isinstance(checklist, list):
        checklist = []

    actor_user = db.session.get(User, _current_user_id()) if _current_user_id() else None
    created = {
        "id": f"chg-{secrets.token_hex(6)}",
        "title": title,
        "scope": str(data.get("scope") or "network").strip().lower(),
        "risk_level": str(data.get("risk_level") or "medium").strip().lower(),
        "status": status,
        "ticket_ref": str(data.get("ticket_ref") or "").strip(),
        "window_start": window_start.isoformat() if window_start else None,
        "window_end": window_end.isoformat() if window_end else None,
        "rollback_plan": str(data.get("rollback_plan") or "").strip(),
        "execution_plan": str(data.get("execution_plan") or "").strip(),
        "checklist": checklist[:100],
        "created_at": _iso_utc_now(),
        "updated_at": _iso_utc_now(),
        "created_by": _current_user_id(),
        "created_by_name": actor_user.name if actor_user else None,
        "created_by_email": actor_user.email if actor_user else None,
    }

    entries = _load_ops_change_requests(tenant_id)
    entries.insert(0, created)
    _save_ops_change_requests(tenant_id, entries[:500], updated_by=_current_user_id())
    _audit("ops_change_request_create", entity_type="ops_change_request", entity_id=created["id"], metadata=created)
    return jsonify({"success": True, "item": created}), 201



@admin_bp.route('/admin/ops/change-requests/<change_id>', methods=['PATCH'])
@permission_required('ops.change.write')
def admin_ops_change_requests_update(change_id):
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    entries = _load_ops_change_requests(tenant_id)
    index = next((idx for idx, item in enumerate(entries) if str(item.get("id")) == str(change_id)), None)
    if index is None:
        return jsonify({"error": "change_request no encontrado"}), 404

    row = dict(entries[index])
    if "title" in data:
        title = str(data.get("title") or "").strip()
        if not title:
            return jsonify({"error": "title no puede estar vacio"}), 400
        row["title"] = title
    if "status" in data:
        status = str(data.get("status") or "").strip().lower()
        if status not in OPS_CHANGE_ALLOWED_STATUS:
            return jsonify({"error": f"status invalido. permitidos: {', '.join(sorted(OPS_CHANGE_ALLOWED_STATUS))}"}), 400
        row["status"] = status
    if "ticket_ref" in data:
        row["ticket_ref"] = str(data.get("ticket_ref") or "").strip()
    if "rollback_plan" in data:
        row["rollback_plan"] = str(data.get("rollback_plan") or "").strip()
    if "execution_plan" in data:
        row["execution_plan"] = str(data.get("execution_plan") or "").strip()
    if "window_start" in data:
        start = _parse_iso_datetime(data.get("window_start"))
        row["window_start"] = start.isoformat() if start else None
    if "window_end" in data:
        end = _parse_iso_datetime(data.get("window_end"))
        row["window_end"] = end.isoformat() if end else None
    if "checklist" in data and isinstance(data.get("checklist"), list):
        row["checklist"] = data.get("checklist")[:100]

    row["updated_at"] = _iso_utc_now()
    row["updated_by"] = _current_user_id()
    entries[index] = row
    _save_ops_change_requests(tenant_id, entries[:500], updated_by=_current_user_id())
    _audit("ops_change_request_update", entity_type="ops_change_request", entity_id=change_id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "item": row}), 200



@admin_bp.route('/admin/ops/change-requests/<change_id>/approve', methods=['POST'])
@permission_required('ops.change.approve')
def admin_ops_change_requests_approve(change_id):
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    approved = _parse_bool(data.get("approved", True))
    if approved is None:
        approved = True
    entries = _load_ops_change_requests(tenant_id)
    index = next((idx for idx, item in enumerate(entries) if str(item.get("id")) == str(change_id)), None)
    if index is None:
        return jsonify({"error": "change_request no encontrado"}), 404
    row = dict(entries[index])
    row["status"] = "approved" if approved else "rejected"
    row["approval_note"] = str(data.get("note") or "").strip()
    row["approved_by"] = _current_user_id()
    row["approved_at"] = _iso_utc_now()
    row["updated_at"] = _iso_utc_now()
    entries[index] = row
    _save_ops_change_requests(tenant_id, entries[:500], updated_by=_current_user_id())
    _audit("ops_change_request_approve", entity_type="ops_change_request", entity_id=change_id, metadata={"approved": approved})
    return jsonify({"success": True, "item": row}), 200



@admin_bp.route('/admin/ops/preflight/summary', methods=['GET'])
@permission_required('ops.preflight.read')
def admin_ops_preflight_summary():
    tenant_id = current_tenant_id()
    settings = _effective_system_settings(tenant_id)
    checks = []

    change_required = bool(settings.get("change_control_required_for_live", True))
    requests_list = _load_ops_change_requests(tenant_id)
    approved_changes = [
        item for item in requests_list
        if str(item.get("status") or "").lower() in {"approved", "scheduled", "executing"}
    ]
    checks.append(
        {
            "id": "change_control",
            "ok": (not change_required) or len(approved_changes) > 0,
            "detail": (
                f"Cambios aprobados disponibles: {len(approved_changes)}"
                if change_required
                else "Control de cambios opcional por configuracion."
            ),
            "severity": "critical" if change_required and len(approved_changes) == 0 else "ok",
        }
    )

    staff_q = User.query.filter(User.role.in_(("admin", "noc", "tech", "support", "billing", "operator")))
    if tenant_id is not None:
        staff_q = staff_q.filter_by(tenant_id=tenant_id)
    staff = staff_q.all()
    mfa_enabled = [user for user in staff if bool(user.mfa_enabled)]
    mfa_ratio = round((len(mfa_enabled) / max(1, len(staff))) * 100, 1)
    enforce_admin_mfa = bool(settings.get("admin_mfa_required", False))
    checks.append(
        {
            "id": "mfa_coverage",
            "ok": mfa_ratio >= 100 if enforce_admin_mfa else mfa_ratio >= 60,
            "detail": f"Cobertura MFA staff: {mfa_ratio}% ({len(mfa_enabled)}/{len(staff)})",
            "severity": "critical" if enforce_admin_mfa and mfa_ratio < 100 else ("warning" if mfa_ratio < 60 else "ok"),
        }
    )

    backup_drill_days = int(settings.get("backup_restore_drill_days", 30) or 30)
    backup_drill_days = max(1, min(backup_drill_days, 365))
    artifacts = _backup_artifacts_summary()
    latest = artifacts.get("latest")
    backup_ok = False
    if latest and latest.get("modified_ts"):
        age_hours = round((time.time() - float(latest["modified_ts"])) / 3600, 2)
        backup_ok = age_hours <= (backup_drill_days * 24)
        backup_detail = f"Ultimo backup hace {age_hours}h."
    else:
        backup_detail = "No se detectaron backups."
    checks.append(
        {
            "id": "backup_recency",
            "ok": backup_ok,
            "detail": backup_detail,
            "severity": "critical" if not backup_ok else "ok",
        }
    )

    routers_q = MikroTikRouter.query
    if tenant_id is not None:
        routers_q = routers_q.filter_by(tenant_id=tenant_id)
    routers_down = routers_q.filter_by(is_active=False).count()
    checks.append(
        {
            "id": "routers_health",
            "ok": routers_down == 0,
            "detail": f"Routers down: {routers_down}",
            "severity": "warning" if routers_down > 0 else "ok",
        }
    )

    score = _ops_score_from_checks(checks)
    blockers = [item for item in checks if (not item.get("ok")) and item.get("severity") == "critical"]
    return jsonify(
        {
            "score": score,
            "checks": checks,
            "blockers": blockers,
            "settings": {
                "change_control_required_for_live": change_required,
                "require_preflight_for_live": bool(settings.get("require_preflight_for_live", True)),
                "admin_mfa_required": enforce_admin_mfa,
                "backup_restore_drill_days": backup_drill_days,
            },
            "approved_changes": approved_changes[:50],
        }
    ), 200



@admin_bp.route('/admin/ops/slo-summary', methods=['GET'])
@permission_required('ops.slo.read')
def admin_ops_slo_summary():
    tenant_id = current_tenant_id()
    settings = _effective_system_settings(tenant_id)

    try:
        days = int(request.args.get("days", 7) or 7)
    except (TypeError, ValueError):
        days = 7
    days = max(1, min(days, 30))
    since = datetime.now(timezone.utc) - timedelta(days=days)

    routers_q = MikroTikRouter.query
    if tenant_id is not None:
        routers_q = routers_q.filter_by(tenant_id=tenant_id)
    total_routers = routers_q.count()
    routers_up = routers_q.filter_by(is_active=True).count()
    router_availability = round((routers_up / max(1, total_routers)) * 100, 2)

    tickets_q = Ticket.query.filter(Ticket.created_at >= since)
    if tenant_id is not None:
        tickets_q = tickets_q.filter_by(tenant_id=tenant_id)
    resolved = tickets_q.filter(Ticket.status.in_(("resolved", "closed"))).all()
    resolved_in_sla = 0
    for ticket in resolved:
        due = ticket.sla_due_at
        finished = ticket.updated_at or ticket.created_at
        if due is None or (finished and finished <= due):
            resolved_in_sla += 1
    ticket_sla = round((resolved_in_sla / max(1, len(resolved))) * 100, 2)

    audit_q = AuditLog.query.filter(AuditLog.created_at >= since).filter(
        or_(AuditLog.action.like("olt_%"), AuditLog.action.like("mikrotik_%"))
    )
    if tenant_id is not None:
        audit_q = audit_q.filter(AuditLog.tenant_id == tenant_id)
    operations = audit_q.order_by(AuditLog.created_at.desc()).limit(2000).all()
    total_ops = len(operations)
    success_ops = 0
    for entry in operations:
        metadata = entry.meta if isinstance(entry.meta, dict) else {}
        success = metadata.get("success")
        if success is None:
            success_ops += 1
        elif bool(success):
            success_ops += 1
    provision_success = round((success_ops / max(1, total_ops)) * 100, 2)

    targets = {
        "router_availability": int(settings.get("slo_router_availability_target", 99) or 99),
        "ticket_sla": int(settings.get("slo_ticket_sla_target", 95) or 95),
        "provision_success": int(settings.get("slo_provision_success_target", 98) or 98),
    }
    metrics = {
        "router_availability": router_availability,
        "ticket_sla": ticket_sla,
        "provision_success": provision_success,
    }
    checks = [
        {
            "id": "router_availability",
            "value": router_availability,
            "target": targets["router_availability"],
            "ok": router_availability >= targets["router_availability"],
        },
        {
            "id": "ticket_sla",
            "value": ticket_sla,
            "target": targets["ticket_sla"],
            "ok": ticket_sla >= targets["ticket_sla"],
        },
        {
            "id": "provision_success",
            "value": provision_success,
            "target": targets["provision_success"],
            "ok": provision_success >= targets["provision_success"],
        },
    ]
    score = _ops_score_from_checks([{"ok": item["ok"]} for item in checks])
    return jsonify(
        {
            "window_days": days,
            "since": since.isoformat() + "Z",
            "targets": targets,
            "metrics": metrics,
            "checks": checks,
            "score": score,
            "samples": {
                "routers_total": total_routers,
                "tickets_resolved": len(resolved),
                "provision_operations": total_ops,
            },
        }
    ), 200



@admin_bp.route('/admin/ops/collections-summary', methods=['GET'])
@permission_required('billing.promises.read')
def admin_ops_collections_summary():
    tenant_id = current_tenant_id()
    subs_q = Subscription.query
    invoices_q = Invoice.query
    promises_q = BillingPromise.query
    if tenant_id is not None:
        subs_q = subs_q.filter_by(tenant_id=tenant_id)
        invoices_q = invoices_q.join(Subscription, Invoice.subscription_id == Subscription.id).filter(Subscription.tenant_id == tenant_id)
        promises_q = promises_q.filter_by(tenant_id=tenant_id)

    payload = {
        "subscriptions": {
            "active": subs_q.filter_by(status='active').count(),
            "past_due": subs_q.filter_by(status='past_due').count(),
            "suspended": subs_q.filter_by(status='suspended').count(),
        },
        "invoices": {
            "pending": invoices_q.filter_by(status='pending').count(),
            "paid": invoices_q.filter_by(status='paid').count(),
            "cancelled": invoices_q.filter_by(status='cancelled').count(),
        },
        "promises": {
            "pending": promises_q.filter_by(status='pending').count(),
            "kept": promises_q.filter_by(status='kept').count(),
            "broken": promises_q.filter_by(status='broken').count(),
            "cancelled": promises_q.filter_by(status='cancelled').count(),
        },
        "generated_at": _iso_utc_now(),
    }
    return jsonify(payload), 200



@admin_bp.route('/admin/ops/support-sla-summary', methods=['GET'])
@permission_required('tickets.read')
def admin_ops_support_sla_summary():
    tenant_id = current_tenant_id()
    now_dt = datetime.now(timezone.utc)
    tickets_q = Ticket.query
    if tenant_id is not None:
        tickets_q = tickets_q.filter_by(tenant_id=tenant_id)

    open_q = tickets_q.filter(Ticket.status.in_(('open', 'in_progress')))
    open_count = open_q.count()
    overdue_count = open_q.filter(Ticket.sla_due_at.isnot(None), Ticket.sla_due_at < now_dt).count()
    next_four_hours = now_dt + timedelta(hours=4)
    due_soon_count = open_q.filter(
        Ticket.sla_due_at.isnot(None),
        Ticket.sla_due_at >= now_dt,
        Ticket.sla_due_at <= next_four_hours,
    ).count()
    payload = {
        "open": open_count,
        "overdue": overdue_count,
        "due_soon_4h": due_soon_count,
        "sla_compliance_estimate": round(((open_count - overdue_count) / max(1, open_count)) * 100, 2),
        "generated_at": _iso_utc_now(),
    }
    return jsonify(payload), 200


# ==================== TICKETS CON SLA ====================


@admin_bp.route('/admin/gis/naps', methods=['GET'])
@jwt_required()
def admin_gis_list_naps():
    tenant_id = current_tenant_id()
    naps = _tenant_scoped_query(NapBox, tenant_id).all()
    return jsonify({"items": [n.to_dict() for n in naps]}), 200



@admin_bp.route('/admin/gis/naps', methods=['POST'])
@permission_required('network.write')
def admin_gis_create_nap():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    
    nap = NapBox(
        name=data.get('name'),
        address=data.get('address'),
        latitude=data.get('latitude'),
        longitude=data.get('longitude'),
        capacity=data.get('capacity', 16),
        status=data.get('status', 'active'),
        notes=data.get('notes'),
        tenant_id=tenant_id
    )
    db.session.add(nap)
    db.session.commit()
    return jsonify(nap.to_dict()), 201



@admin_bp.route('/admin/gis/lines', methods=['GET'])
@jwt_required()
def admin_gis_list_lines():
    tenant_id = current_tenant_id()
    lines = _tenant_scoped_query(FiberLine, tenant_id).all()
    return jsonify({"items": [l.to_dict() for l in lines]}), 200



@admin_bp.route('/admin/gis/lines', methods=['POST'])
@permission_required('network.write')
def admin_gis_create_line():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    
    line = FiberLine(
        name=data.get('name'),
        path_geojson=data.get('path'),
        color=data.get('color', '#3b82f6'),
        fiber_type=data.get('fiber_type'),
        status=data.get('status', 'active'),
        tenant_id=tenant_id
    )
    db.session.add(line)
    db.session.commit()
    return jsonify(line.to_dict()), 201



@admin_bp.route('/admin/analytics/business', methods=['GET'])
@permission_required('audit.read')
def admin_analytics_business():
    from app.services.analytics_service import AnalyticsService
    tenant_id = current_tenant_id()
    metrics = AnalyticsService.build_business_metrics(tenant_id)
    return jsonify(metrics), 200



@admin_bp.route('/partner/stats', methods=['GET'])
@jwt_required()
def partner_stats():
    user_id = _current_user_id()
    from app.models import Partner, PartnerCommission
    partner = Partner.query.filter_by(user_id=user_id).first()
    if not partner:
        return jsonify({"error": "No eres un aliado registrado"}), 403
    
    total_commissions = db.session.query(db.func.sum(PartnerCommission.amount)).filter_by(partner_id=partner.id, status='paid').scalar() or 0
    pending_commissions = db.session.query(db.func.sum(PartnerCommission.amount)).filter_by(partner_id=partner.id, status='pending').scalar() or 0
    total_sales = len(partner.referred_clients)
    
    return jsonify({
        "name": partner.company_name or partner.user.name,
        "balance": float(pending_commissions),
        "total_paid": float(total_commissions),
        "totalSales": total_sales,
        "rank": "Gold" if total_sales > 10 else "Silver",
        "commission_rate": partner.commission_percentage
    }), 200



@admin_bp.route('/partner/commissions', methods=['GET'])
@jwt_required()
def partner_commissions_list():
    user_id = _current_user_id()
    from app.models import Partner, PartnerCommission
    partner = Partner.query.filter_by(user_id=user_id).first()
    if not partner:
        return jsonify({"error": "Acceso denegado"}), 403
    
    commissions = PartnerCommission.query.filter_by(partner_id=partner.id).order_by(PartnerCommission.created_at.desc()).all()
    return jsonify([c.to_dict() for c in commissions]), 200



@admin_bp.route('/partner/prospects', methods=['POST'])
@jwt_required()
def partner_register_prospect():
    user_id = _current_user_id()
    from app.models import Partner, Client
    partner = Partner.query.filter_by(user_id=user_id).first()
    if not partner:
        return jsonify({"error": "Acceso denegado"}), 403
    
    data = request.get_json() or {}
    name = data.get('name')
    phone = data.get('phone')
    address = data.get('address')
    
    if not name or not phone:
        return jsonify({"error": "Nombre y teléfono son requeridos"}), 400
        
    prospect = Client(
        full_name=name,
        phone=phone,
        address=address,
        tenant_id=partner.tenant_id,
        partner_id=partner.id,
        tipo_cliente='prepago',
        comentarios=f"Registrado por aliado: {partner.company_name}"
    )
    db.session.add(prospect)
    db.session.commit()
    
    return jsonify({"success": True, "client_id": prospect.id}), 201



@admin_bp.route('/branding/config', methods=['GET'])
def get_branding_config():
    """
    Public endpoint to get branding configuration for the UI.
    Resuelve el tenant por:
      1. Query param ?tenant_id=X
      2. Host header (subdominio o custom_domain)
      3. Primer tenant activo (fallback)
    """
    tenant_id = request.args.get('tenant_id', type=int)
    host = request.host if not tenant_id else None
    config = BrandingService.get_config(tenant_id=tenant_id, host=host)
    return jsonify(config), 200



@admin_bp.route('/branding/config', methods=['PATCH'])
@admin_required()
def update_branding_config():
    """
    Admin endpoint para actualizar la configuración de marca blanca del tenant.
    Campos permitidos: brand_name, logo_url, primary_color, secondary_color, custom_domain.
    """
    tenant_id = current_tenant_id()
    if not tenant_id:
        return jsonify({"error": "No se pudo determinar el tenant actual"}), 400

    data = request.get_json() or {}
    allowed = {"brand_name", "logo_url", "primary_color", "secondary_color", "custom_domain"}
    filtered = {k: v for k, v in data.items() if k in allowed}

    if not filtered:
        return jsonify({"error": "No se proporcionaron campos de branding válidos"}), 400

    try:
        updated = BrandingService.update_config(tenant_id=tenant_id, data=filtered)
        _audit(
            "branding_update",
            entity_type="tenant",
            entity_id=tenant_id,
            metadata={"fields_updated": list(filtered.keys())},
        )
        return jsonify({"success": True, "branding": updated}), 200
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        current_app.logger.error("Error actualizando branding: %s", exc)
        return jsonify({"error": "Error interno actualizando branding"}), 500

