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
