from datetime import timezone
from .utils import *

@admin_bp.route('/network/health', methods=['GET'])
@staff_required()
def network_health():
    tenant_id = current_tenant_id()
    return jsonify(_build_network_health_payload(tenant_id)), 200



@admin_bp.route('/monitoring/metrics', methods=['GET'])
@staff_required()
def monitoring_metrics():
    """
    Devuelve series de InfluxDB para dashboards (mediante medicion y rango).
    Ejemplo: /monitoring/metrics?measurement=system_resources&range=-2h&router_id=1
    """
    measurement = (request.args.get('measurement') or '').strip()
    if not measurement:
        return jsonify({"error": "measurement is required"}), 400

    time_range = request.args.get('range') or '-1h'
    tags = {}
    for key in ('router_id', 'interface_name', 'site'):
        if request.args.get(key):
            tags[key] = request.args.get(key)

    try:
        monitoring = MonitoringService()
        series = monitoring.query_metrics(measurement, time_range=time_range, tags=tags or None)
        latest = monitoring.latest_point(measurement, tags=tags or None)
        return jsonify({
            "success": True,
            "measurement": measurement,
            "time_range": time_range,
            "tags": tags,
            "latest": latest,
            "series": series,
        }), 200
    except Exception as exc:
        current_app.logger.error("Error consultando metricas: %s", exc)
        return jsonify({"success": False, "error": "No se pudieron recuperar metricas"}), 502



@admin_bp.route('/network/alerts', methods=['GET'])
@staff_required()
def network_alerts():
    tenant_id = current_tenant_id()
    alerts = _build_network_alert_items(tenant_id)
    _audit("network_alerts", entity_type="network", metadata={"count": len(alerts)})
    return jsonify({"alerts": alerts, "count": len(alerts)}), 200



@admin_bp.route('/network/snmp/traps', methods=['POST'])
def receive_snmp_trap():
    configured_token = str(current_app.config.get('SNMP_TRAP_WEBHOOK_TOKEN') or '').strip()
    supplied_token = str(request.headers.get('X-SNMP-Trap-Token') or '').strip()
    authorized = bool(configured_token and supplied_token and hmac.compare_digest(supplied_token, configured_token))

    if not authorized:
        try:
            verify_jwt_in_request()
            user_id = _current_user_id()
            user = db.session.get(User, user_id) if user_id is not None else None
            authorized = bool(user and user.role in {'admin', 'superadmin', 'platform_admin'})
        except Exception:
            authorized = False

    if not authorized:
        return jsonify({"success": False, "error": "No autorizado para registrar traps SNMP"}), 403

    payload = request.get_json(silent=True) or {}
    tenant_id = payload.get('tenant_id')
    if tenant_id in (None, ""):
        tenant_id = current_tenant_id()

    event = snmp_service.record_trap_event(tenant_id, payload)
    return jsonify({"success": True, "trap": event}), 202



@admin_bp.route('/network/noc-summary', methods=['GET'])
@staff_required()
def network_noc_summary():
    tenant_id = current_tenant_id()
    routers_q = MikroTikRouter.query
    subs_q = Subscription.query
    tickets_q = Ticket.query
    if tenant_id is not None:
        routers_q = routers_q.filter_by(tenant_id=tenant_id)
        subs_q = subs_q.filter_by(tenant_id=tenant_id)
        tickets_q = tickets_q.filter_by(tenant_id=tenant_id)

    ok = routers_q.filter_by(is_active=True).count()
    down = routers_q.filter_by(is_active=False).count()
    suspended = subs_q.filter(Subscription.status.in_(('suspended', 'past_due'))).count()
    tickets_open = tickets_q.filter(Ticket.status.in_(('open', 'in_progress'))).count()

    active_alerts = down + suspended
    uptime = max(95.0, 99.9 - down * 0.5)

    return jsonify({
        "uptime": f"{uptime:.2f}%",
        "routers": {"ok": ok, "down": down},
        "suspended_clients": suspended,
        "active_alerts": active_alerts,
        "tickets_open": tickets_open,
    }), 200



@admin_bp.route('/admin/routers/usage', methods=['GET'])
@admin_required()
def admin_router_usage():
    """
    Métricas resumidas por router (requiere Influx con measurement 'interface_traffic' y tag router_id).
    Devuelve rx/tx en Mbps y, si existe 'router_stats', cpu/mem.
    """
    tenant_id = current_tenant_id()
    monitoring = MonitoringService()

    traffic = monitoring.query_metrics(
        'interface_traffic',
        time_range='-15m',
        tags={'tenant_id': str(tenant_id)} if tenant_id else None,
    )

    router_map = {}
    for point in traffic:
        rid = point.get('router_id') or point.get('router')
        if not rid:
            continue
        rx = float(point.get('rx_bytes', 0) or 0)
        tx = float(point.get('tx_bytes', 0) or 0)
        entry = router_map.setdefault(rid, {'router_id': rid, 'rx_mbps': 0.0, 'tx_mbps': 0.0})
        entry['rx_mbps'] += rx * 8 / 1_000_000
        entry['tx_mbps'] += tx * 8 / 1_000_000

    stats = monitoring.query_metrics(
        'router_stats',
        time_range='-15m',
        tags={'tenant_id': str(tenant_id)} if tenant_id else None,
    )
    for point in stats:
        rid = point.get('router_id') or point.get('router')
        if not rid:
            continue
        entry = router_map.setdefault(rid, {'router_id': rid, 'rx_mbps': 0.0, 'tx_mbps': 0.0})
        if point.get('cpu') is not None:
            entry['cpu'] = point.get('cpu')
        if point.get('cpu_percent') is not None:
            entry['cpu'] = point.get('cpu_percent')
        if point.get('mem') is not None:
            entry['mem'] = point.get('mem')
        if point.get('mem_percent') is not None:
            entry['mem'] = point.get('mem_percent')
        if point.get('temperature_c') is not None:
            entry['temperature_c'] = point.get('temperature_c')
        if point.get('voltage_v') is not None:
            entry['voltage_v'] = point.get('voltage_v')
        if point.get('signal_level_dbm') is not None:
            entry['signal_level_dbm'] = point.get('signal_level_dbm')
        if point.get('optical_rx_dbm') is not None:
            entry['optical_rx_dbm'] = point.get('optical_rx_dbm')
        if point.get('onu_online') is not None:
            entry['onu_online'] = point.get('onu_online')
        if point.get('onu_offline') is not None:
            entry['onu_offline'] = point.get('onu_offline')

    result = list(router_map.values())
    return jsonify({"items": result, "count": len(result)}), 200



@admin_bp.route('/admin/routers/<int:router_id>/backup', methods=['POST'])
@admin_required()
def backup_router(router_id):
    with MikroTikService(router_id) as mikrotik:
        filename = mikrotik.export_backup()
    if not filename:
        return jsonify({"error": "No se pudo generar backup"}), 500
    return jsonify({"success": True, "filename": filename}), 200



@admin_bp.route('/admin/network/maintenance', methods=['GET'])
@permission_required('network.maintenance.read')
def admin_network_maintenance_list():
    tenant_id = current_tenant_id()
    status_filter = str(request.args.get('status') or '').strip().lower()
    now_dt = datetime.now(timezone.utc)
    query = _tenant_scoped_query(NocMaintenanceWindow, tenant_id)
    rows = query.order_by(NocMaintenanceWindow.starts_at.desc()).limit(200).all()
    items = []
    for row in rows:
        payload = row.to_dict()
        if row.ends_at < now_dt:
            payload['status'] = 'finished'
        elif row.starts_at > now_dt:
            payload['status'] = 'scheduled'
        else:
            payload['status'] = 'active'
        items.append(payload)

    if status_filter:
        items = [item for item in items if item.get('status') == status_filter]

    return jsonify({"items": items, "count": len(items)}), 200



@admin_bp.route('/admin/network/maintenance', methods=['POST'])
@permission_required('network.maintenance.write')
def admin_network_maintenance_create():
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    data = request.get_json() or {}
    title = str(data.get('title') or '').strip()
    scope = str(data.get('scope') or 'all').strip().lower() or 'all'
    starts_at = _parse_iso_datetime(data.get('starts_at'))
    ends_at = _parse_iso_datetime(data.get('ends_at'))
    mute_alerts = _parse_bool(data.get('mute_alerts'))
    note = str(data.get('note') or '').strip()

    if not title:
        return jsonify({"error": "title es requerido"}), 400
    if scope not in {'all', 'router', 'billing', 'network'}:
        return jsonify({"error": "scope invalido. permitidos: all | router | billing | network"}), 400
    if starts_at is None or ends_at is None:
        return jsonify({"error": "starts_at y ends_at son requeridos (ISO datetime)"}), 400
    if ends_at <= starts_at:
        return jsonify({"error": "ends_at debe ser mayor a starts_at"}), 400

    row = NocMaintenanceWindow(
        tenant_id=tenant_id,
        title=title,
        scope=scope,
        starts_at=starts_at,
        ends_at=ends_at,
        mute_alerts=bool(True if mute_alerts is None else mute_alerts),
        note=note,
        created_by=actor_id,
    )
    db.session.add(row)
    db.session.commit()
    payload = row.to_dict()
    _audit("maintenance_window_create", entity_type="maintenance_window", entity_id=row.id, metadata=payload)
    return jsonify({"success": True, "item": payload}), 201



@admin_bp.route('/admin/network/maintenance/<int:window_id>', methods=['PATCH'])
@permission_required('network.maintenance.write')
def admin_network_maintenance_update(window_id):
    tenant_id = current_tenant_id()
    row = _tenant_scoped_query(NocMaintenanceWindow, tenant_id).filter_by(id=window_id).first()
    if not row:
        return jsonify({"error": "Ventana de mantenimiento no encontrada"}), 404

    data = request.get_json() or {}
    if 'title' in data:
        title = str(data.get('title') or '').strip()
        if not title:
            return jsonify({"error": "title no puede estar vacio"}), 400
        row.title = title
    if 'scope' in data:
        scope = str(data.get('scope') or '').strip().lower()
        if scope not in {'all', 'router', 'billing', 'network'}:
            return jsonify({"error": "scope invalido. permitidos: all | router | billing | network"}), 400
        row.scope = scope
    if 'starts_at' in data:
        starts_at = _parse_iso_datetime(data.get('starts_at'))
        if starts_at is None:
            return jsonify({"error": "starts_at invalido"}), 400
        row.starts_at = starts_at
    if 'ends_at' in data:
        ends_at = _parse_iso_datetime(data.get('ends_at'))
        if ends_at is None:
            return jsonify({"error": "ends_at invalido"}), 400
        row.ends_at = ends_at
    if row.ends_at <= row.starts_at:
        return jsonify({"error": "ends_at debe ser mayor a starts_at"}), 400
    if 'mute_alerts' in data:
        mute_alerts = _parse_bool(data.get('mute_alerts'))
        if mute_alerts is None:
            return jsonify({"error": "mute_alerts debe ser booleano"}), 400
        row.mute_alerts = mute_alerts
    if 'note' in data:
        row.note = str(data.get('note') or '').strip()

    db.session.add(row)
    db.session.commit()
    payload = row.to_dict()
    _audit("maintenance_window_update", entity_type="maintenance_window", entity_id=row.id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "item": payload}), 200



@admin_bp.route('/admin/routers/<int:router_id>/remote-script', methods=['GET'])
@admin_required()
def router_remote_script(router_id):
    """Devuelve un script rápido para habilitar acceso remoto seguro (API/SSH) en MikroTik."""
    router = db.session.get(MikroTikRouter, router_id)
    if not router:
        return jsonify({"error": "Router no encontrado"}), 404
    api_user = f"fastisp-{router_id}"
    api_pass = f"{router.password or 'CambiarEstaClave'}"
    api_port = 8728
    ssh_port = 22
    vps_ip = current_app.config.get('FASTISP_VPS_IP') or 'YOUR_PUBLIC_IP'
    allowed_mgmt = f"{vps_ip}/32"
    script = f"""/ip service set api disabled=no port={api_port}
/ip service set ssh disabled=no port={ssh_port}
/user add name="{api_user}" password="{api_pass}" group=full comment="Acceso remoto FastISP" disabled=no
/ip firewall address-list add list=fastisp-remote address={allowed_mgmt} comment="Autorizar IP de gestión"
/ip firewall filter add chain=input action=accept protocol=tcp dst-port={api_port} src-address-list=fastisp-remote comment="API FastISP"
/ip firewall filter add chain=input action=accept protocol=tcp dst-port={ssh_port} src-address-list=fastisp-remote comment="SSH FastISP"
"""
    return jsonify({
        "router": {
            "id": router.id,
            "name": router.name,
            "ip": router.ip_address,
            "api_user": api_user,
            "api_port": api_port,
            "ssh_port": ssh_port,
        },
        "script": script,
        "note": "Reemplaza YOUR_PUBLIC_IP/32 por la IP de gestión permitida antes de ejecutar en MikroTik."
    }), 200


# ==================== INVENTORY MANAGEMENT ====================


