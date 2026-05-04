from .utils import (
    admin_bp, limiter, current_tenant_id, _platform_admin_exists, 
    _validate_password_policy, PLATFORM_ADMIN_ROLE, User, db, 
    platform_admin_required, TENANT_PLAN_TEMPLATES, Tenant, 
    _serialize_tenant_platform_item, _slugify, _normalize_tenant_plan_code, 
    _parse_bool, _normalize_tenant_billing_status, _normalize_tenant_billing_cycle, 
    _parse_money_value, _parse_limit_int, _parse_iso_datetime, 
    _tenant_default_trial_ends_at, _generate_router_password
)
from flask_jwt_extended import jwt_required, get_jwt_identity
from flask import request, jsonify, current_app
import hmac

@admin_bp.route('/platform/bootstrap/status', methods=['GET'])
@limiter.limit("30/minute")
def platform_bootstrap_status():
    tenant_id = current_tenant_id()
    platform_admin_exists = _platform_admin_exists()
    token_configured = bool(str(current_app.config.get('PLATFORM_BOOTSTRAP_TOKEN') or '').strip())
    master_context = tenant_id is None
    bootstrap_allowed = master_context and token_configured and not platform_admin_exists
    return jsonify(
        {
            "master_context": master_context,
            "token_configured": token_configured,
            "platform_admin_exists": platform_admin_exists,
            "bootstrap_allowed": bootstrap_allowed,
        }
    ), 200



@admin_bp.route('/platform/bootstrap', methods=['POST'])
@limiter.limit("5/minute")
def platform_bootstrap():
    if current_tenant_id() is not None:
        return jsonify({"error": "Bootstrap solo disponible en host master/global."}), 403

    configured_token = str(current_app.config.get('PLATFORM_BOOTSTRAP_TOKEN') or '').strip()
    if not configured_token:
        return jsonify({"error": "PLATFORM_BOOTSTRAP_TOKEN no configurado en servidor."}), 403

    if _platform_admin_exists():
        return jsonify({"error": "Ya existe un platform_admin. Bootstrap cerrado."}), 409

    data = request.get_json() or {}
    provided_token = str(
        data.get('token')
        or request.headers.get('X-Platform-Bootstrap-Token')
        or ''
    ).strip()
    if not provided_token or not hmac.compare_digest(provided_token, configured_token):
        return jsonify({"error": "Token de bootstrap invalido."}), 403

    name = str(data.get('name') or '').strip()
    email = str(data.get('email') or '').strip().lower()
    password = str(data.get('password') or '')
    if not name or not email or not password:
        return jsonify({"error": "name, email y password son requeridos."}), 400
    valid_password, password_error = _validate_password_policy(password, tenant_id=None)
    if not valid_password:
        return jsonify({"error": password_error}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({"error": "email ya existe."}), 409

    user = User(
        name=name,
        email=email,
        role=PLATFORM_ADMIN_ROLE,
        tenant_id=None,
    )
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    return jsonify(
        {
            "success": True,
            "message": "Platform admin creado correctamente.",
            "user": {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "role": user.role,
                "tenant_id": user.tenant_id,
            },
        }
    ), 201



@admin_bp.route('/platform/plans/templates', methods=['GET'])
@platform_admin_required()
def platform_plan_templates():
    return jsonify({"items": TENANT_PLAN_TEMPLATES}), 200



@admin_bp.route('/platform/tenants', methods=['GET'])
@platform_admin_required()
def platform_list_tenants():
    tenants = Tenant.query.order_by(Tenant.created_at.desc()).all()
    items = [_serialize_tenant_platform_item(tenant) for tenant in tenants]
    return jsonify({"items": items, "count": len(items)}), 200



@admin_bp.route('/platform/tenants', methods=['POST'])
@platform_admin_required()
def platform_create_tenant():
    data = request.get_json() or {}
    name = str(data.get('name') or '').strip()
    slug_raw = str(data.get('slug') or '').strip().lower()

    if not name:
        return jsonify({"error": "name es requerido"}), 400

    slug = _slugify(slug_raw or name)
    if not slug:
        return jsonify({"error": "slug invalido"}), 400

    duplicate = Tenant.query.filter_by(slug=slug).first()
    if duplicate:
        return jsonify({"error": "slug ya existe"}), 409

    plan_code = _normalize_tenant_plan_code(data.get('plan_code'))
    if 'plan_code' in data and not plan_code:
        return jsonify({"error": "plan_code invalido"}), 400
    plan_code = plan_code or 'starter'
    template = TENANT_PLAN_TEMPLATES[plan_code]

    is_active = _parse_bool(data.get('is_active'))
    billing_status = _normalize_tenant_billing_status(data.get('billing_status'))
    if 'billing_status' in data and not billing_status:
        return jsonify({"error": "billing_status invalido"}), 400
    billing_status = billing_status or 'trial'

    billing_cycle = _normalize_tenant_billing_cycle(data.get('billing_cycle'))
    if 'billing_cycle' in data and not billing_cycle:
        return jsonify({"error": "billing_cycle invalido"}), 400
    billing_cycle = billing_cycle or 'monthly'
    monthly_price = _parse_money_value(data.get('monthly_price'))
    max_admins = _parse_limit_int(data.get('max_admins'), min_value=1, max_value=100)
    max_routers = _parse_limit_int(data.get('max_routers'), min_value=1, max_value=100000)
    max_clients = _parse_limit_int(data.get('max_clients'), min_value=10, max_value=1000000)

    raw_trial_ends_at = data.get('trial_ends_at')
    trial_ends_at = _parse_iso_datetime(raw_trial_ends_at)
    raw_trial_token = str(raw_trial_ends_at or '').strip()
    if raw_trial_token and trial_ends_at is None:
        return jsonify({"error": "trial_ends_at invalido. Use formato ISO 8601."}), 400
    if trial_ends_at is None and billing_status == 'trial':
        trial_ends_at = _tenant_default_trial_ends_at()

    tenant = Tenant(
        slug=slug,
        name=name,
        is_active=True if is_active is None else bool(is_active),
        plan_code=plan_code,
        billing_status=billing_status,
        billing_cycle=billing_cycle,
        monthly_price=monthly_price if monthly_price is not None else template['monthly_price'],
        max_admins=max_admins if max_admins is not None else template['max_admins'],
        max_routers=max_routers if max_routers is not None else template['max_routers'],
        max_clients=max_clients if max_clients is not None else template['max_clients'],
        trial_ends_at=trial_ends_at,
    )
    db.session.add(tenant)
    db.session.flush()

    created_admin = None
    admin_email = str(data.get('admin_email') or '').strip().lower()
    admin_name = str(data.get('admin_name') or 'Admin ISP').strip() or 'Admin ISP'
    if admin_email:
        if User.query.filter_by(email=admin_email).first():
            db.session.rollback()
            return jsonify({"error": "admin_email ya existe"}), 409
        if int(tenant.max_admins or 0) < 1:
            db.session.rollback()
            return jsonify({"error": "El plan del usuario no permite crear admins"}), 409
        admin_password = str(data.get('admin_password') or '').strip() or _generate_router_password()
        admin_user = User(
            name=admin_name,
            email=admin_email,
            role='admin',
            tenant_id=tenant.id,
        )
        admin_user.set_password(admin_password)
        db.session.add(admin_user)
        created_admin = {
            "email": admin_email,
            "name": admin_name,
            "role": "admin",
            "password": admin_password,
        }

    db.session.commit()
    payload = {
        "success": True,
        "tenant": _serialize_tenant_platform_item(tenant),
    }
    if created_admin:
        payload["admin"] = created_admin
    return jsonify(payload), 201



@admin_bp.route('/platform/tenants/<int:tenant_id>', methods=['PATCH'])
@platform_admin_required()
def platform_update_tenant(tenant_id):
    tenant = db.session.get(Tenant, tenant_id)
    if not tenant:
        return jsonify({"error": "Tenant no encontrado"}), 404

    data = request.get_json() or {}
    changed = False

    if 'name' in data:
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({"error": "name invalido"}), 400
        tenant.name = name
        changed = True

    if 'slug' in data:
        slug = _slugify(str(data.get('slug') or '').strip().lower())
        if not slug:
            return jsonify({"error": "slug invalido"}), 400
        duplicate = Tenant.query.filter(Tenant.id != tenant.id, Tenant.slug == slug).first()
        if duplicate:
            return jsonify({"error": "slug ya existe"}), 409
        tenant.slug = slug
        changed = True

    if 'is_active' in data:
        parsed = _parse_bool(data.get('is_active'))
        if parsed is None:
            return jsonify({"error": "is_active debe ser booleano"}), 400
        tenant.is_active = parsed
        changed = True

    if 'plan_code' in data:
        plan_code = _normalize_tenant_plan_code(data.get('plan_code'))
        if not plan_code:
            return jsonify({"error": "plan_code invalido"}), 400
        tenant.plan_code = plan_code
        changed = True

    if 'billing_status' in data:
        billing_status = _normalize_tenant_billing_status(data.get('billing_status'))
        if not billing_status:
            return jsonify({"error": "billing_status invalido"}), 400
        tenant.billing_status = billing_status
        changed = True

    if 'billing_cycle' in data:
        billing_cycle = _normalize_tenant_billing_cycle(data.get('billing_cycle'))
        if not billing_cycle:
            return jsonify({"error": "billing_cycle invalido"}), 400
        tenant.billing_cycle = billing_cycle
        changed = True

    if 'monthly_price' in data:
        monthly_price = _parse_money_value(data.get('monthly_price'))
        if monthly_price is None:
            return jsonify({"error": "monthly_price invalido"}), 400
        tenant.monthly_price = monthly_price
        changed = True

    if 'max_admins' in data:
        max_admins = _parse_limit_int(data.get('max_admins'), min_value=1, max_value=100)
        if max_admins is None:
            return jsonify({"error": "max_admins invalido"}), 400
        tenant.max_admins = max_admins
        changed = True

    if 'max_routers' in data:
        max_routers = _parse_limit_int(data.get('max_routers'), min_value=1, max_value=100000)
        if max_routers is None:
            return jsonify({"error": "max_routers invalido"}), 400
        tenant.max_routers = max_routers
        changed = True

    if 'max_clients' in data:
        max_clients = _parse_limit_int(data.get('max_clients'), min_value=10, max_value=1000000)
        if max_clients is None:
            return jsonify({"error": "max_clients invalido"}), 400
        tenant.max_clients = max_clients
        changed = True

    if 'trial_ends_at' in data:
        raw_trial_ends_at = data.get('trial_ends_at')
        parsed_trial_ends_at = _parse_iso_datetime(raw_trial_ends_at)
        raw_value = str(raw_trial_ends_at or '').strip()
        if raw_value and parsed_trial_ends_at is None:
            return jsonify({"error": "trial_ends_at invalido. Use formato ISO 8601."}), 400
        tenant.trial_ends_at = parsed_trial_ends_at
        changed = True

    if changed:
        db.session.add(tenant)
        db.session.commit()

    return jsonify({"success": True, "tenant": _serialize_tenant_platform_item(tenant)}), 200



@admin_bp.route('/platform/tenants/<int:tenant_id>/admins', methods=['POST'])
@platform_admin_required()
def platform_create_tenant_admin(tenant_id):
    tenant = db.session.get(Tenant, tenant_id)
    if not tenant:
        return jsonify({"error": "Tenant no encontrado"}), 404

    current_admins = User.query.filter_by(tenant_id=tenant.id, role='admin').count()
    if current_admins >= int(tenant.max_admins or 0):
        return jsonify({"error": "Limite de admins alcanzado para este tenant"}), 409

    data = request.get_json() or {}
    email = str(data.get('email') or '').strip().lower()
    name = str(data.get('name') or 'Admin ISP').strip() or 'Admin ISP'
    if not email:
        return jsonify({"error": "email es requerido"}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({"error": "email ya existe"}), 409

    password = str(data.get('password') or '').strip() or _generate_router_password()
    valid_password, password_error = _validate_password_policy(password, tenant.id)
    if not valid_password:
        return jsonify({"error": password_error}), 400
    user = User(
        name=name,
        email=email,
        role='admin',
        tenant_id=tenant.id,
    )
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    return jsonify({
        "success": True,
        "tenant_id": tenant.id,
        "admin": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "password": password,
        },
    }), 201



@admin_bp.route('/platform/tenants/<int:tenant_id>', methods=['DELETE'])
@platform_admin_required()
def platform_delete_tenant(tenant_id):
    tenant = db.session.get(Tenant, tenant_id)
    if not tenant:
        return jsonify({"error": "Tenant no encontrado"}), 404

    db.session.delete(tenant)
    db.session.commit()
    return jsonify({"success": True, "message": "Tenant eliminado correctamente"}), 200
