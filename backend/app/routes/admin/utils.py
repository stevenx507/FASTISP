from datetime import datetime, timezone, timedelta
from flask import request, current_app, jsonify, Blueprint, Response
from flask_jwt_extended import get_jwt_identity, jwt_required
import secrets
import time
from sqlalchemy import or_

from app import db, cache, limiter
from app.models import (
    AdminSystemSetting, AuditLog, User, AdminSystemJob, 
    RolePermission, Ticket, Tenant, Client, MikroTikRouter, 
    Subscription, Invoice, BillingPromise, NapBox, FiberLine,
    AdminExtraService, AdminHotspotVoucher
)
from app.tenancy import (
    current_tenant_id, 
    admin_required, 
    staff_required, 
    platform_admin_required, 
    permission_required,
    _current_user_id
)
from app.lib.utils import parse_int, parse_bool
from app.lib.route_helpers import (
    load_staff_meta, save_staff_meta, ticket_assignee_counts,
    serialize_staff_member, sync_user_active_status,
    role_permissions_with_overrides, is_permission_allowed,
    metric_float, iso_utc_now, actor_default_name,
    current_actor_snapshot, ensure_operational_entry_metadata,
    apply_operational_entry_create_metadata,
    apply_operational_entry_update_metadata,
    notifications_history_key, screen_alerts_key,
    load_notification_history, save_notification_history,
    default_screen_alerts, screen_alert_model_from_entry,
    build_network_alert_items, build_network_health_payload
)

# Definición central del Blueprint administrativo
admin_bp = Blueprint("admin", __name__)

# --- Cache Keys ---
def _tenant_cache_key(prefix: str, tenant_id) -> str:
    scoped = tenant_id if tenant_id is not None else "global"
    return f"{prefix}:{scoped}"

def _system_settings_key(tenant_id) -> str: return _tenant_cache_key("admin_system_settings", tenant_id)
def _staff_meta_key(tenant_id) -> str: return _tenant_cache_key("admin_staff_meta", tenant_id)

# --- Generic Cache Helpers ---
def _load_cached_list(key: str) -> list[dict]: return cache.get(key) or []
def _save_cached_list(key: str, items: list[dict], max_items: int = 500) -> None: cache.set(key, items[:max_items], timeout=86400 * 30)
def _load_cached_dict(key: str) -> dict: return cache.get(key) or {}
def _save_cached_dict(key: str, data: dict) -> None: cache.set(key, data, timeout=86400 * 30)

# --- DB Helpers ---
def _tenant_scoped_query(model, tenant_id):
    query = model.query
    if tenant_id is None: return query.filter(model.tenant_id.is_(None))
    return query.filter(model.tenant_id == tenant_id)

def _audit(action: str, entity_type: str = None, entity_id: str = None, metadata=None):
    try:
        tenant_id = current_tenant_id()
        user_id = get_jwt_identity()
        entry = AuditLog(
            tenant_id=tenant_id, user_id=user_id, action=action,
            entity_type=entity_type, entity_id=str(entity_id) if entity_id is not None else None,
            meta=metadata, ip_address=getattr(request, "remote_addr", None),
        )
        db.session.add(entry)
        db.session.commit()
    except Exception: pass

# --- System Settings ---
def _system_setting_value(tenant_id, key_name: str, default=None):
    row = _tenant_scoped_query(AdminSystemSetting, tenant_id).filter_by(key=key_name).first()
    if row is not None: return row.value
    cached = _load_cached_dict(_system_settings_key(tenant_id))
    return cached.get(key_name, default)

def _upsert_system_setting_value(tenant_id, key_name: str, value, updated_by=None) -> None:
    row = _tenant_scoped_query(AdminSystemSetting, tenant_id).filter_by(key=key_name).first()
    now = datetime.now(timezone.utc)
    if row is None:
        row = AdminSystemSetting(tenant_id=tenant_id, key=key_name, value=value, updated_by=updated_by, updated_at=now)
    else:
        row.value = value
        row.updated_by = updated_by
        row.updated_at = now
    db.session.add(row)
    db.session.commit()
    cached = _load_cached_dict(_system_settings_key(tenant_id))
    cached[key_name] = value
    _save_cached_dict(_system_settings_key(tenant_id), cached)

# --- Incident Notifications ---
def _notify_incident(message: str, severity: str = "info"):
    pd_key = current_app.config.get('PAGERDUTY_ROUTING_KEY')
    tg_token = current_app.config.get('TELEGRAM_BOT_TOKEN')
    tg_chat = current_app.config.get('TELEGRAM_CHAT_ID')
    import requests
    if pd_key:
        try:
            payload = {"routing_key": pd_key, "event_action": "trigger", "payload": {"summary": message, "severity": severity, "source": "ispfast-api"}}
            requests.post("https://events.pagerduty.com/v2/enqueue", json=payload, timeout=5)
        except Exception: pass
    if tg_token and tg_chat:
        try: requests.post(f"https://api.telegram.org/bot{tg_token}/sendMessage", data={"chat_id": tg_chat, "text": message[:4000]}, timeout=5)
        except Exception: pass
from app.lib.route_helpers import (
    PLATFORM_ADMIN_ROLE, TENANT_PLAN_TEMPLATES, 
    STAFF_ALLOWED_ROLES, ROLE_BASE_PERMISSIONS
)

# --- Serialization Helpers ---
def _serialize_tenant_platform_item(tenant: Tenant) -> dict:
    users_total = User.query.filter_by(tenant_id=tenant.id).count()
    admin_total = User.query.filter_by(tenant_id=tenant.id, role='admin').count()
    clients_total = Client.query.filter_by(tenant_id=tenant.id).count()
    routers_total = MikroTikRouter.query.filter_by(tenant_id=tenant.id).count()
    subs_total = Subscription.query.filter_by(tenant_id=tenant.id).count()
    active_subs = Subscription.query.filter_by(tenant_id=tenant.id, status='active').count()
    suspended_subs = Subscription.query.filter_by(tenant_id=tenant.id, status='suspended').count()
    root_domain = str(current_app.config.get('TENANCY_ROOT_DOMAIN') or '').strip().lower()
    tenant_host = f"{tenant.slug}.{root_domain}" if root_domain else tenant.slug
    return {
        "id": tenant.id, "slug": tenant.slug, "name": tenant.name,
        "is_active": bool(tenant.is_active),
        "created_at": tenant.created_at.isoformat() if tenant.created_at else None,
        "host": tenant_host, "plan_code": tenant.plan_code,
        "billing_status": tenant.billing_status, "billing_cycle": tenant.billing_cycle,
        "monthly_price": float(tenant.monthly_price or 0),
        "max_admins": int(tenant.max_admins or 0),
        "max_routers": int(tenant.max_routers or 0),
        "max_clients": int(tenant.max_clients or 0),
        "trial_ends_at": tenant.trial_ends_at.isoformat() if tenant.trial_ends_at else None,
        "users_total": users_total, "admins_total": admin_total,
        "clients_total": clients_total, "routers_total": routers_total,
        "subscriptions_total": subs_total, "subscriptions_active": active_subs,
        "subscriptions_suspended": suspended_subs,
    }

def _platform_admin_exists() -> bool:
    return User.query.filter_by(role=PLATFORM_ADMIN_ROLE).first() is not None

# --- Normalization Helpers ---
def _normalize_tenant_plan_code(value: str | None) -> str | None:
    candidate = str(value or '').strip().lower()
    return candidate if candidate in TENANT_PLAN_TEMPLATES else None

def _normalize_tenant_billing_status(value: str | None) -> str | None:
    candidate = str(value or '').strip().lower()
    allowed = {'trial', 'active', 'past_due', 'suspended', 'cancelled'}
    return candidate if candidate in allowed else None

def _normalize_tenant_billing_cycle(value: str | None) -> str | None:
    candidate = str(value or '').strip().lower()
    allowed = {'monthly', 'quarterly', 'yearly'}
    return candidate if candidate in allowed else None

# --- Parsing Helpers ---
def _parse_limit_int(value, min_value: int, max_value: int) -> int | None:
    try:
        iv = int(value)
        return max(min_value, min(iv, max_value))
    except (TypeError, ValueError): return None

def _parse_money_value(value) -> float | None:
    try: return float(value)
    except (TypeError, ValueError): return None

def _parse_bool(value) -> bool | None:
    from app.lib.utils import parse_bool
    return parse_bool(value)

def _parse_iso_datetime(value) -> datetime | None:
    from app.lib.utils import parse_iso_datetime
    return parse_iso_datetime(value)

def _slugify(text: str) -> str:
    from app.lib.utils import slugify
    return slugify(text)

def _generate_router_password(length: int = 24) -> str:
    import secrets, string
    alphabet = string.ascii_letters + string.digits + "-_@#"
    return "".join(secrets.choice(alphabet) for _ in range(length))

def _validate_password_policy(password: str, tenant_id=None) -> tuple[bool, str]:
    from app.lib.route_helpers import validate_password_policy
    return validate_password_policy(password, tenant_id)

def _tenant_default_trial_ends_at() -> datetime:
    from app.lib.route_helpers import tenant_default_trial_ends_at
    return tenant_default_trial_ends_at()

def _iso_utc_now() -> str:
    return iso_utc_now()

def _metric_float(value) -> float | None:
    return metric_float(value)

def _actor_default_name(actor_id) -> str:
    return actor_default_name(actor_id)

def _current_actor_snapshot() -> dict:
    return current_actor_snapshot(_current_user_id)

def _ensure_operational_entry_metadata(entry: dict) -> bool:
    return ensure_operational_entry_metadata(entry)

def _apply_operational_entry_create_metadata(entry: dict, actor: dict | None = None) -> None:
    apply_operational_entry_create_metadata(entry, actor)

def _apply_operational_entry_update_metadata(entry: dict, actor: dict | None = None) -> None:
    apply_operational_entry_update_metadata(entry, actor)

def _notifications_history_key(tenant_id) -> str:
    return notifications_history_key(tenant_id)

def _screen_alerts_key(tenant_id) -> str:
    return screen_alerts_key(tenant_id)

def _load_notification_history(tenant_id) -> list[dict]:
    return load_notification_history(tenant_id)

def _save_notification_history(tenant_id, history: list[dict]) -> None:
    save_notification_history(tenant_id, history)

def _default_screen_alerts() -> list[dict]:
    return default_screen_alerts()

def _screen_alert_model_from_entry(entry: dict, tenant_id) -> AdminScreenAlert:
    return screen_alert_model_from_entry(entry, tenant_id)

def _build_network_alert_items(tenant_id) -> list[dict]:
    return build_network_alert_items(tenant_id)

def _build_network_health_payload(tenant_id) -> dict:
    return build_network_health_payload(tenant_id)
