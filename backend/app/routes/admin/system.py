from .utils import *

@admin_bp.route('/admin/backups/db', methods=['POST'])
@admin_required()
def backup_db():
    """Ejecuta pg_dump y guarda en el directorio configurado."""
    tenant_id = current_tenant_id()
    base = _ensure_backup_dir()
    ts = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    backup_name = f"db-backup-{ts}.sql"
    file_path = base / backup_name
    database_url = (
        current_app.config.get('SQLALCHEMY_DATABASE_URI')
        or os.environ.get('DATABASE_URL')
    )
    if not database_url or not str(database_url).startswith('postgres'):
        return jsonify({"error": "Backup DB requiere SQLALCHEMY_DATABASE_URI Postgres"}), 503

    pg_dump_path = current_app.config.get('PG_DUMP_PATH', 'pg_dump')
    try:
        cmd = [pg_dump_path, database_url]
        with file_path.open('w', encoding='utf-8') as f:
            subprocess.check_call(cmd, stdout=f)
        retention_days = _retention_days_for_tenant(tenant_id)
        prune_result = _prune_backup_directory(retention_days, base=base)
        return jsonify(
            {
                "success": True,
                "filename": backup_name,
                "retention_days": retention_days,
                "prune": prune_result,
            }
        ), 200
    except Exception as e:
        current_app.logger.error("No se pudo generar backup DB: %s", e, exc_info=True)
        return jsonify({"error": f"No se pudo generar backup DB: {e}"}), 500



@admin_bp.route('/admin/backups/list', methods=['GET'])
@admin_required()
def list_backups():
    tenant_id = current_tenant_id()
    base = _backup_dir_path()
    files = []
    if base.exists():
        for file_path in sorted(
            (item for item in base.iterdir() if item.is_file()),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        ):
            files.append(_backup_item_payload(file_path))
    retention_days = _retention_days_for_tenant(tenant_id)
    return jsonify(
        {
            "items": files,
            "count": len(files),
            "directory": str(base),
            "retention_days": retention_days,
        }
    ), 200



@admin_bp.route('/admin/backups/prune', methods=['POST'])
@admin_required()
def prune_backups():
    tenant_id = current_tenant_id()
    data = request.get_json(silent=True) or {}
    requested_days = data.get('retention_days')

    if requested_days is None:
        retention_days = _retention_days_for_tenant(tenant_id)
    else:
        try:
            retention_days = int(requested_days)
        except (TypeError, ValueError):
            return jsonify({"error": "retention_days debe ser entero"}), 400
        if retention_days < 1 or retention_days > 365:
            return jsonify({"error": "retention_days debe estar entre 1 y 365"}), 400

    result = _prune_backup_directory(retention_days)
    return jsonify({"success": True, "prune": result}), 200



@admin_bp.route('/admin/backups/download', methods=['GET'])
@admin_required()
def download_backup():
    name = request.args.get('name')
    if not _is_safe_backup_name(name):
        return jsonify({"error": "name requerido"}), 400
    base = _backup_dir_path()
    if not base.exists():
        return jsonify({"error": "backup no encontrado"}), 404

    file_path = (base / name).resolve()
    if file_path.parent != base or not file_path.exists() or not file_path.is_file() or file_path.is_symlink():
        return jsonify({"error": "backup no encontrado"}), 404
    return send_from_directory(directory=str(base), path=file_path.name, as_attachment=True)



@admin_bp.route('/admin/backups/verify', methods=['GET'])
@admin_required()
def verify_backups():
    base = _backup_dir_path()
    requested_name = (request.args.get('name') or '').strip()
    if requested_name and not _is_safe_backup_name(requested_name):
        return jsonify({"error": "name invalido"}), 400

    if not base.exists():
        if requested_name:
            return jsonify({"error": "backup no encontrado"}), 404
        return jsonify({"valid": True, "count": 0, "items": []}), 200

    if requested_name:
        target = (base / requested_name).resolve()
        if target.parent != base or not target.exists() or not target.is_file() or target.is_symlink():
            return jsonify({"error": "backup no encontrado"}), 404
        targets = [target]
    else:
        targets = sorted(
            (item for item in base.iterdir() if item.is_file() and not item.is_symlink()),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )

    items = []
    all_valid = True
    for file_path in targets:
        try:
            payload = _backup_item_payload(file_path, include_hash=True)
            issues = []
            if payload["size"] <= 0:
                issues.append("empty_file")
            payload["valid"] = len(issues) == 0
            payload["issues"] = issues
        except Exception as exc:
            payload = {
                "name": file_path.name,
                "valid": False,
                "issues": [f"read_error:{exc}"],
            }
        items.append(payload)
        all_valid = all_valid and bool(payload.get("valid"))

    return jsonify({"valid": all_valid, "count": len(items), "items": items}), 200


# ==================== ADMIN: STAFF / INVENTORY / NOTIFICATIONS ====================


@admin_bp.route('/admin/audit-logs', methods=['GET'])
@permission_required('audit.read')
def admin_audit_logs():
    tenant_id = current_tenant_id()
    try:
        limit = int(request.args.get('limit', 50) or 50)
    except Exception:
        limit = 50
    try:
        offset = int(request.args.get('offset', 0) or 0)
    except Exception:
        offset = 0

    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    action_filter = (request.args.get('action') or '').strip().lower()
    entity_filter = (request.args.get('entity_type') or '').strip().lower()
    entity_id_filter = (request.args.get('entity_id') or '').strip()
    actor_id_filter = _parse_int(request.args.get('user_id'))
    date_from = _parse_iso_datetime(request.args.get('from'))
    date_to = _parse_iso_datetime(request.args.get('to'))

    query = AuditLog.query.options(joinedload(AuditLog.user), joinedload(AuditLog.tenant))
    if tenant_id is not None:
        query = query.filter(AuditLog.tenant_id == tenant_id)
    if action_filter:
        query = query.filter(AuditLog.action.ilike(f"%{action_filter}%"))
    if entity_filter:
        query = query.filter(AuditLog.entity_type.ilike(f"%{entity_filter}%"))
    if entity_id_filter:
        query = query.filter(AuditLog.entity_id == entity_id_filter)
    if actor_id_filter is not None:
        query = query.filter(AuditLog.user_id == actor_id_filter)
    if date_from is not None:
        query = query.filter(AuditLog.created_at >= date_from)
    if date_to is not None:
        query = query.filter(AuditLog.created_at <= date_to)

    total = query.count()
    rows = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()

    items = []
    for row in rows:
        payload = row.to_dict()
        payload["user_name"] = row.user.name if row.user else _actor_default_name(row.user_id)
        payload["user_email"] = row.user.email if row.user else None
        payload["tenant_slug"] = row.tenant.slug if row.tenant else None
        items.append(payload)

    return jsonify(
        {
            "items": items,
            "count": len(items),
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    ), 200



@admin_bp.route('/admin/system/settings', methods=['GET'])
@permission_required('system.settings.read')
def admin_system_settings_get():
    tenant_id = current_tenant_id()
    defaults = _default_system_settings()
    overrides = _load_system_settings_overrides_db(tenant_id)
    if not overrides:
        cached_overrides = _load_cached_dict(_system_settings_key(tenant_id))
        if cached_overrides:
            _save_system_settings_overrides_db(tenant_id, cached_overrides, updated_by=None)
            overrides = cached_overrides
    settings = {**defaults, **overrides}

    routers_query = MikroTikRouter.query
    tickets_query = Ticket.query.filter(Ticket.status.in_(("open", "in_progress")))
    if tenant_id is not None:
        routers_query = routers_query.filter_by(tenant_id=tenant_id)
        tickets_query = tickets_query.filter_by(tenant_id=tenant_id)
    routers_down = routers_query.filter_by(is_active=False).count()
    routers_up = routers_query.filter_by(is_active=True).count()

    jobs = _load_system_jobs_db(tenant_id)[:20]
    if not jobs:
        jobs = _load_cached_list(_system_jobs_key(tenant_id))[:20]
    vps_update_status, vps_update_summary = _run_vps_update_preflight(tenant_id)
    vps_update_summary["status"] = vps_update_status
    return jsonify(
        {
            "settings": settings,
            "health": {
                "routers_up": routers_up,
                "routers_down": routers_down,
                "tickets_open": tickets_query.count(),
                "timestamp": _iso_utc_now(),
            },
            "jobs": jobs,
            "vps_update": vps_update_summary,
        }
    ), 200



@admin_bp.route('/admin/system/settings', methods=['POST'])
@permission_required('system.settings.write')
def admin_system_settings_update():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    incoming = data.get('settings') if isinstance(data.get('settings'), dict) else data

    allowed = {
        "portal_maintenance_mode": "bool",
        "auto_suspend_overdue": "bool",
        "notifications_push_enabled": "bool",
        "notifications_email_enabled": "bool",
        "allow_self_signup": "bool",
        "change_control_required_for_live": "bool",
        "require_preflight_for_live": "bool",
        "admin_mfa_required": "bool",
        "default_ticket_priority": "str",
        "backup_retention_days": "int",
        "metrics_poll_interval_sec": "int",
        "password_policy_min_length": "int",
        "backup_restore_drill_days": "int",
        "slo_router_availability_target": "int",
        "slo_ticket_sla_target": "int",
        "slo_provision_success_target": "int",
    }
    integer_limits = {
        "backup_retention_days": (1, 365),
        "metrics_poll_interval_sec": (15, 3600),
        "password_policy_min_length": (8, 64),
        "backup_restore_drill_days": (1, 365),
        "slo_router_availability_target": (1, 100),
        "slo_ticket_sla_target": (1, 100),
        "slo_provision_success_target": (1, 100),
    }

    overrides = _load_system_settings_overrides_db(tenant_id)
    if not overrides:
        overrides = _load_cached_dict(_system_settings_key(tenant_id))
    for key_name, key_type in allowed.items():
        if key_name not in incoming:
            continue
        raw_value = incoming.get(key_name)
        if key_type == "bool":
            parsed = _parse_bool(raw_value)
            if parsed is None:
                return jsonify({"error": f"{key_name} debe ser booleano"}), 400
            overrides[key_name] = parsed
        elif key_type == "int":
            try:
                parsed_int = int(raw_value)
            except (TypeError, ValueError):
                return jsonify({"error": f"{key_name} debe ser entero"}), 400
            minimum, maximum = integer_limits.get(key_name, (-2**31, 2**31 - 1))
            if parsed_int < minimum or parsed_int > maximum:
                return jsonify({"error": f"{key_name} debe estar entre {minimum} y {maximum}"}), 400
            overrides[key_name] = parsed_int
        else:
            text_value = str(raw_value or '').strip().lower()
            if key_name == "default_ticket_priority" and text_value not in TICKET_ALLOWED_PRIORITIES:
                return jsonify(
                    {"error": f"default_ticket_priority invalido. permitidos: {', '.join(sorted(TICKET_ALLOWED_PRIORITIES))}"}
                ), 400
            overrides[key_name] = text_value

    _save_system_settings_overrides_db(tenant_id, overrides, updated_by=_current_user_id())
    _save_cached_dict(_system_settings_key(tenant_id), overrides)
    settings = {**_default_system_settings(), **overrides}
    _audit("system_settings_update", entity_type="system_settings", metadata={"changes": list(incoming.keys())})
    return jsonify({"success": True, "settings": settings}), 200



@admin_bp.route('/admin/system/jobs/history', methods=['GET'])
@permission_required('system.jobs.read')
def admin_system_jobs_history():
    tenant_id = current_tenant_id()
    try:
        limit = int(request.args.get('limit', 50) or 50)
    except Exception:
        limit = 50
    try:
        offset = int(request.args.get('offset', 0) or 0)
    except Exception:
        offset = 0
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    status_filter = str(request.args.get('status') or '').strip().lower()
    job_filter = str(request.args.get('job') or '').strip().lower()

    filtered = _load_system_jobs_db(tenant_id, status_filter=status_filter, job_filter=job_filter)
    if not filtered:
        jobs = _load_cached_list(_system_jobs_key(tenant_id))
        filtered = jobs
        if status_filter:
            filtered = [item for item in filtered if str(item.get('status') or '').lower() == status_filter]
        if job_filter:
            filtered = [item for item in filtered if str(item.get('job') or '').lower() == job_filter]

    page = filtered[offset:offset + limit]
    return jsonify(
        {
            "items": page,
            "count": len(page),
            "total": len(filtered),
            "offset": offset,
            "limit": limit,
            "has_more": (offset + len(page)) < len(filtered),
        }
    ), 200



@admin_bp.route('/admin/system/jobs/run', methods=['POST'])
@permission_required('system.jobs.run')
def admin_system_jobs_run():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    job = (data.get('job') or '').strip().lower()
    if job not in SYSTEM_ALLOWED_JOBS:
        return jsonify({"error": f"job debe ser {' | '.join(sorted(SYSTEM_ALLOWED_JOBS))}"}), 400
    payload, code = _run_system_job_request(job, tenant_id, _current_user_id())
    return jsonify(payload), code



