from datetime import timezone
from .utils import *

@admin_bp.route('/admin/staff', methods=['GET'])
@admin_required()
def admin_staff_list():
    tenant_id = current_tenant_id()
    query = User.query.filter(User.role != 'client')
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)
    users = query.order_by(User.name.asc()).all()

    metadata_map = _load_staff_meta(tenant_id)
    assigned_counts = _ticket_assignee_counts(tenant_id)

    items = []
    for user in users:
        meta = metadata_map.get(str(user.id), {})
        items.append(_serialize_staff_member(user, meta, assigned_counts))

    role_filter = (request.args.get('role') or '').strip().lower()
    status_filter = (request.args.get('status') or '').strip().lower()
    search = (request.args.get('q') or '').strip().lower()

    if role_filter:
        items = [item for item in items if str(item.get("role", "")).lower() == role_filter]
    if status_filter:
        items = [item for item in items if str(item.get("status", "")).lower() == status_filter]
    if search:
        items = [
            item for item in items
            if search in str(item.get("name", "")).lower()
            or search in str(item.get("email", "")).lower()
            or search in str(item.get("zone", "")).lower()
        ]

    _audit("staff_list", entity_type="staff", metadata={"count": len(items), "tenant_id": tenant_id})
    return jsonify({"items": items, "count": len(items)}), 200



@admin_bp.route('/admin/staff', methods=['POST'])
@admin_required()
def admin_staff_create():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip().lower()
    role = (data.get('role') or 'tech').strip().lower()

    if not name or not email:
        return jsonify({"error": "name y email son requeridos"}), 400
    if role not in STAFF_ALLOWED_ROLES:
        return jsonify({"error": f"role invalido. permitidos: {', '.join(sorted(STAFF_ALLOWED_ROLES))}"}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({"error": "Ya existe un usuario con ese email"}), 409

    supplied_password = (data.get('password') or '').strip()
    temporary_password = supplied_password or _generate_router_password()
    valid_password, password_error = _validate_password_policy(temporary_password, tenant_id)
    if not valid_password:
        return jsonify({"error": password_error}), 400

    mfa_enabled = _parse_bool(data.get('mfa_enabled', False))
    if mfa_enabled is None:
        return jsonify({"error": "mfa_enabled debe ser booleano"}), 400

    user = User(
        name=name,
        email=email,
        role=role,
        tenant_id=tenant_id,
        mfa_enabled=mfa_enabled,
    )
    if user.mfa_enabled:
        user.mfa_secret = pyotp.random_base32()
    user.set_password(temporary_password)

    db.session.add(user)
    db.session.commit()

    status = str(data.get('status') or 'active').strip().lower()
    shift = str(data.get('shift') or 'day').strip().lower()
    metadata_map = _load_staff_meta(tenant_id)
    metadata_map[str(user.id)] = {
        "zone": str(data.get('zone') or 'general').strip() or 'general',
        "phone": str(data.get('phone') or '').strip(),
        "status": status if status in STAFF_ALLOWED_STATUS else "active",
        "shift": shift if shift in STAFF_ALLOWED_SHIFTS else "day",
        "last_seen_at": _iso_utc_now(),
    }
    _save_staff_meta(tenant_id, metadata_map)

    item = _serialize_staff_member(user, metadata_map[str(user.id)], {})
    response = {"staff": item, "success": True}
    if not supplied_password:
        response["temporary_password"] = temporary_password
    _audit("staff_create", entity_type="staff", entity_id=user.id, metadata={"email": user.email, "role": user.role})
    return jsonify(response), 201



@admin_bp.route('/admin/staff/<int:staff_id>', methods=['PATCH'])
@admin_required()
def admin_staff_update(staff_id):
    tenant_id = current_tenant_id()
    user = db.session.get(User, staff_id)
    if not user:
        return jsonify({"error": "Usuario de staff no encontrado"}), 404
    if tenant_id is not None and user.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    data = request.get_json() or {}
    if 'name' in data:
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({"error": "name no puede estar vacio"}), 400
        user.name = name

    if 'role' in data:
        role = str(data.get('role') or '').strip().lower()
        if role not in STAFF_ALLOWED_ROLES:
            return jsonify({"error": f"role invalido. permitidos: {', '.join(sorted(STAFF_ALLOWED_ROLES))}"}), 400
        user.role = role

    if 'mfa_enabled' in data:
        mfa_enabled = _parse_bool(data.get('mfa_enabled'))
        if mfa_enabled is None:
            return jsonify({"error": "mfa_enabled debe ser booleano"}), 400
        user.mfa_enabled = mfa_enabled
        if mfa_enabled and not user.mfa_secret:
            user.mfa_secret = pyotp.random_base32()
        if not mfa_enabled:
            user.mfa_secret = None

    if data.get('password'):
        proposed_password = str(data.get('password') or '')
        valid_password, password_error = _validate_password_policy(proposed_password, tenant_id)
        if not valid_password:
            return jsonify({"error": password_error}), 400
        user.set_password(proposed_password)

    metadata_map = _load_staff_meta(tenant_id)
    current_meta = metadata_map.get(str(user.id), {})
    if 'zone' in data:
        current_meta['zone'] = str(data.get('zone') or '').strip() or 'general'
    if 'phone' in data:
        current_meta['phone'] = str(data.get('phone') or '').strip()
    if 'status' in data:
        status = str(data.get('status') or '').strip().lower()
        if status not in STAFF_ALLOWED_STATUS:
            return jsonify({"error": f"status invalido. permitidos: {', '.join(sorted(STAFF_ALLOWED_STATUS))}"}), 400
        current_meta['status'] = status
    if 'shift' in data:
        shift = str(data.get('shift') or '').strip().lower()
        if shift not in STAFF_ALLOWED_SHIFTS:
            return jsonify({"error": f"shift invalido. permitidos: {', '.join(sorted(STAFF_ALLOWED_SHIFTS))}"}), 400
        current_meta['shift'] = shift
    if data.get('touch_last_seen'):
        current_meta['last_seen_at'] = _iso_utc_now()

    metadata_map[str(user.id)] = current_meta
    _save_staff_meta(tenant_id, metadata_map)

    db.session.add(user)
    db.session.commit()

    item = _serialize_staff_member(user, current_meta, _ticket_assignee_counts(tenant_id))
    _audit("staff_update", entity_type="staff", entity_id=user.id, metadata={"changes": list(data.keys())})
    return jsonify({"staff": item, "success": True}), 200



@admin_bp.route('/admin/permissions', methods=['GET'])
@admin_required()
def admin_permissions_list():
    tenant_id = current_tenant_id()
    current_user_id = _current_user_id()
    current_user = db.session.get(User, current_user_id) if current_user_id else None
    if not _is_permission_allowed(current_user, 'security.permissions.read', tenant_id):
        return jsonify({"error": "Permiso insuficiente: security.permissions.read"}), 403

    rows = (
        _tenant_scoped_query(RolePermission, tenant_id)
        .order_by(RolePermission.role.asc(), RolePermission.permission.asc())
        .all()
    )
    overrides = [row.to_dict() for row in rows]
    roles = sorted(set(STAFF_ALLOWED_ROLES | {"admin", "client", PLATFORM_ADMIN_ROLE}))
    role_matrix = []
    for role in roles:
        resolved = _role_permissions_with_overrides(role, tenant_id)
        role_matrix.append(
            {
                "role": role,
                "wildcard": "*" in resolved,
                "permissions": sorted(permission for permission in resolved if permission != "*"),
            }
        )

    return jsonify(
        {
            "catalog": PERMISSION_CATALOG,
            "roles": role_matrix,
            "overrides": overrides,
            "count": len(overrides),
        }
    ), 200



@admin_bp.route('/admin/permissions', methods=['POST'])
@admin_required()
def admin_permissions_upsert():
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    actor = db.session.get(User, actor_id) if actor_id else None
    if not _is_permission_allowed(actor, 'security.permissions.write', tenant_id):
        return jsonify({"error": "Permiso insuficiente: security.permissions.write"}), 403

    data = request.get_json() or {}
    role = str(data.get('role') or '').strip().lower()
    permission = str(data.get('permission') or '').strip()
    allowed = _parse_bool(data.get('allowed'))

    allowed_roles = set(STAFF_ALLOWED_ROLES | {"admin", "client", PLATFORM_ADMIN_ROLE})
    if role not in allowed_roles:
        return jsonify({"error": f"role invalido. permitidos: {', '.join(sorted(allowed_roles))}"}), 400
    if not permission:
        return jsonify({"error": "permission es requerido"}), 400
    if allowed is None:
        return jsonify({"error": "allowed debe ser booleano"}), 400

    row = (
        _tenant_scoped_query(RolePermission, tenant_id)
        .filter_by(role=role, permission=permission)
        .first()
    )
    if row is None:
        row = RolePermission(
            tenant_id=tenant_id,
            role=role,
            permission=permission,
        )
    row.allowed = bool(allowed)
    row.updated_by = actor_id
    row.updated_at = datetime.now(timezone.utc)
    db.session.add(row)
    db.session.commit()

    resolved = _role_permissions_with_overrides(role, tenant_id)
    payload = row.to_dict()
    payload["resolved_permissions"] = sorted(permission_name for permission_name in resolved if permission_name != "*")
    payload["wildcard"] = "*" in resolved
    _audit("permission_upsert", entity_type="role_permission", entity_id=row.id, metadata=payload)
    return jsonify({"success": True, "item": payload}), 200



