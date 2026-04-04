from datetime import datetime, timedelta
from functools import wraps
import csv
import hashlib
import hmac
import io
import json
import secrets
import string
import time

from flask import Blueprint, jsonify, request, Response, current_app
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required

from app.models import (
    AdminExtraService,
    AdminHotspotVoucher,
    AdminInstallation,
    AdminScreenAlert,
    AdminSystemJob,
    AdminSystemSetting,
    AuditLog,
    BillingPromise,
    Client,
    Invoice,
    MikroTikRouter,
    NocMaintenanceWindow,
    PaymentRecord,
    Plan,
    RolePermission,
    Subscription,
    Tenant,
    Ticket,
    TicketComment,
    User,
)
from app import limiter, cache, db, mail
import pyotp
import requests
from app.services.mikrotik_service import MikroTikService
from app.services.monitoring_service import MonitoringService
from app.tenancy import current_tenant_id, tenant_access_allowed
from datetime import date
from werkzeug.exceptions import BadRequest
from sqlalchemy.orm import joinedload
from sqlalchemy import or_
import subprocess
import os
from flask_mail import Message
from flask import send_from_directory
from pathlib import Path


def _current_user_id():
    identity = get_jwt_identity()
    try:
        return int(identity)
    except (TypeError, ValueError):
        return None


def _slugify(text: str) -> str:
    return ''.join(ch.lower() if ch.isalnum() else '-' for ch in text).strip('-')


def _parse_iso_datetime(value) -> datetime | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    if raw.endswith('Z'):
        raw = raw.replace('Z', '+00:00')
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return None



def _parse_int(value) -> int | None:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def _parse_bool(value) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        if value in (0, 1):
            return bool(value)
        return None
    token = str(value or '').strip().lower()
    if token in {'1', 'true', 'yes', 'y', 'on'}:
        return True
    if token in {'0', 'false', 'no', 'n', 'off'}:
        return False
    return None


def _tenant_default_trial_days() -> int:
    default_days = 30
    try:
        configured = int(current_app.config.get('TENANT_DEFAULT_TRIAL_DAYS', default_days))
    except (TypeError, ValueError):
        configured = default_days
    return max(1, min(configured, 365))


def _tenant_default_trial_ends_at() -> datetime:
    return datetime.utcnow() + timedelta(days=_tenant_default_trial_days())


def _password_reset_token_ttl_seconds() -> int:
    default_minutes = 30
    try:
        configured = int(current_app.config.get('PASSWORD_RESET_TOKEN_TTL_MINUTES', default_minutes))
    except (TypeError, ValueError):
        configured = default_minutes
    safe_minutes = max(5, min(configured, 240))
    return safe_minutes * 60


def _password_reset_key(token: str) -> str:
    return f"password_reset:{token}"


def _password_rotation_dry_run_enabled() -> bool:
    parsed = _parse_bool(current_app.config.get('ROTATE_PASSWORDS_DRY_RUN'))
    if parsed is None:
        return False
    return parsed


def _password_rotation_length() -> int:
    default_length = 24
    try:
        configured = int(current_app.config.get('PASSWORD_ROTATION_LENGTH', default_length))
    except (TypeError, ValueError):
        configured = default_length
    return max(16, min(configured, 64))


def _effective_system_settings(tenant_id) -> dict:
    defaults = _default_system_settings()
    overrides = _load_system_settings_overrides_db(tenant_id)
    if not overrides:
        overrides = _load_cached_dict(_system_settings_key(tenant_id))
    return {**defaults, **(overrides or {})}


def _password_policy_min_length(tenant_id) -> int:
    settings = _effective_system_settings(tenant_id)
    raw_value = settings.get("password_policy_min_length", 10)
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = 10
    return max(8, min(parsed, 64))


def _validate_password_policy(password: str, tenant_id) -> tuple[bool, str]:
    secret = str(password or "")
    minimum = _password_policy_min_length(tenant_id)
    if len(secret) < minimum:
        return False, f"La contrasena debe tener al menos {minimum} caracteres."
    has_upper = any(ch.isupper() for ch in secret)
    has_lower = any(ch.islower() for ch in secret)
    has_digit = any(ch.isdigit() for ch in secret)
    has_symbol = any(not ch.isalnum() for ch in secret)
    if not (has_upper and has_lower and has_digit and has_symbol):
        return False, "La contrasena debe incluir mayuscula, minuscula, numero y simbolo."
    return True, ""


def _generate_router_password(length: int | None = None) -> str:
    target_length = length or _password_rotation_length()
    target_length = max(16, target_length)

    lowercase = string.ascii_lowercase
    uppercase = string.ascii_uppercase
    digits = string.digits
    symbols = '-_@%#'
    all_chars = lowercase + uppercase + digits + symbols

    password_chars = [
        secrets.choice(lowercase),
        secrets.choice(uppercase),
        secrets.choice(digits),
        secrets.choice(symbols),
    ]
    for _ in range(target_length - len(password_chars)):
        password_chars.append(secrets.choice(all_chars))
    secrets.SystemRandom().shuffle(password_chars)
    return ''.join(password_chars)


def _mask_secret(value: str | None) -> str:
    token = str(value or '')
    if len(token) <= 4:
        return '*' * len(token)
    return f"{token[:2]}***{token[-2:]}"


def _backup_dir_path() -> Path:
    configured = (
        current_app.config.get('BACKUP_DIR')
        or os.environ.get('BACKUP_DIR')
        or '/app/backups'
    )
    backup_dir = str(configured).strip() or '/app/backups'
    return Path(backup_dir).expanduser().resolve()


def _ensure_backup_dir() -> Path:
    base = _backup_dir_path()
    base.mkdir(parents=True, exist_ok=True)
    return base


def _is_safe_backup_name(name: str | None) -> bool:
    candidate = str(name or '').strip()
    if not candidate:
        return False
    # Reject directory traversal and nested paths explicitly.
    return Path(candidate).name == candidate and '/' not in candidate and '\\' not in candidate


def _backup_sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open('rb') as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _backup_item_payload(file_path: Path, include_hash: bool = False) -> dict:
    stat_info = file_path.stat()
    payload = {
        "name": file_path.name,
        "size": stat_info.st_size,
        "modified": datetime.utcfromtimestamp(stat_info.st_mtime).isoformat(),
    }
    if include_hash:
        payload["sha256"] = _backup_sha256(file_path)
    return payload


def _normalized_retention_days(raw_value, default_days: int = 14) -> int:
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = default_days
    return max(1, min(parsed, 365))


def _retention_days_for_tenant(tenant_id) -> int:
    defaults = {"backup_retention_days": 14}
    try:
        defaults = _default_system_settings()
    except Exception:
        pass
    overrides = _load_system_settings_overrides_db(tenant_id)
    if not overrides:
        overrides = _load_cached_dict(_system_settings_key(tenant_id))
    raw_value = overrides.get('backup_retention_days', defaults.get('backup_retention_days', 14))
    return _normalized_retention_days(raw_value, default_days=int(defaults.get('backup_retention_days', 14)))


def _prune_backup_directory(retention_days: int, base: Path | None = None) -> dict:
    safe_days = _normalized_retention_days(retention_days)
    backup_dir = base or _backup_dir_path()
    if not backup_dir.exists():
        return {
            "retention_days": safe_days,
            "cutoff": (datetime.utcnow() - timedelta(days=safe_days)).isoformat(),
            "scanned": 0,
            "removed": 0,
            "failed": 0,
            "removed_files": [],
            "errors": [],
        }

    cutoff = datetime.utcnow() - timedelta(days=safe_days)
    scanned = 0
    removed = 0
    failed = 0
    removed_files = []
    errors = []

    for file_path in backup_dir.iterdir():
        if not file_path.is_file() or file_path.is_symlink():
            continue
        scanned += 1
        try:
            modified = datetime.utcfromtimestamp(file_path.stat().st_mtime)
            if modified < cutoff:
                file_path.unlink()
                removed += 1
                removed_files.append(file_path.name)
        except Exception as exc:
            failed += 1
            errors.append({"name": file_path.name, "error": str(exc)})

    return {
        "retention_days": safe_days,
        "cutoff": cutoff.isoformat(),
        "scanned": scanned,
        "removed": removed,
        "failed": failed,
        "removed_files": removed_files,
        "errors": errors,
    }


def _parse_stripe_signature_header(signature_header: str) -> tuple[int | None, list[str]]:
    timestamp = None
    signatures: list[str] = []
    for part in str(signature_header or "").split(","):
        key, sep, value = part.partition("=")
        if not sep:
            continue
        key = key.strip()
        value = value.strip()
        if key == "t":
            timestamp = _parse_int(value)
        elif key == "v1" and value:
            signatures.append(value)
    return timestamp, signatures


def _verify_stripe_signature(payload: bytes, signature_header: str, secret: str, tolerance_seconds: int = 300) -> bool:
    timestamp, signatures = _parse_stripe_signature_header(signature_header)
    if timestamp is None or not signatures or not secret:
        return False

    now = int(time.time())
    if tolerance_seconds > 0 and abs(now - timestamp) > tolerance_seconds:
        return False

    try:
        payload_text = payload.decode('utf-8')
    except Exception:
        return False

    signed_payload = f"{timestamp}.{payload_text}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in signatures)


def _extract_webhook_payment_context(event: dict) -> dict:
    event_type = str(event.get("type") or "").strip().lower()
    data = event.get("data")
    obj = data.get("object") if isinstance(data, dict) else {}
    obj = obj if isinstance(obj, dict) else {}
    metadata = obj.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}

    invoice_id = metadata.get("invoice_id") or event.get("invoice_id")
    subscription_id = metadata.get("subscription_id") or event.get("subscription_id")
    session_id = obj.get("id")
    payment_intent = obj.get("payment_intent")
    event_id = event.get("id")
    event_status = str(event.get("status") or "").strip().lower()

    normalized_status = event_status
    if event_type in {"checkout.session.completed", "payment_intent.succeeded", "charge.succeeded"}:
        normalized_status = "paid"
    elif event_type in {"payment_intent.payment_failed", "charge.failed"}:
        normalized_status = "failed"
    elif normalized_status in {"succeeded", "success"}:
        normalized_status = "paid"

    candidate_references = []
    for ref in (payment_intent, session_id, event_id):
        token = str(ref or "").strip()
        if token and token not in candidate_references:
            candidate_references.append(token)

    return {
        "event_type": event_type,
        "normalized_status": normalized_status,
        "invoice_id": _parse_int(invoice_id),
        "subscription_id": _parse_int(subscription_id),
        "session_id": str(session_id or "").strip() or None,
        "payment_intent": str(payment_intent or "").strip() or None,
        "event_id": str(event_id or "").strip() or None,
        "candidate_references": candidate_references,
    }


def _get_plan_for_request(data, tenant_id):
    plan = None
    if data.get('plan_id'):
        plan = db.session.get(Plan, data['plan_id'])
    elif data.get('plan_name'):
        query = Plan.query.filter_by(name=data['plan_name'])
        if tenant_id is not None:
            query = query.filter_by(tenant_id=tenant_id)
        plan = query.first()
        if not plan:
            plan = Plan(
                name=data['plan_name'],
                download_speed=int(data.get('download_speed') or 50),
                upload_speed=int(data.get('upload_speed') or 10),
                price=float(data.get('plan_cost') or 0),
                tenant_id=tenant_id,
            )
    return plan


def _client_invoice_payload(invoice: Invoice) -> dict:
    payload = invoice.to_dict()
    # Backward-compatible aliases consumed by existing client portal UI.
    payload["due"] = payload.get("due_date")
    payload["total"] = payload.get("total_amount")
    return payload


def _get_user_invoice_items(user: User, tenant_id) -> list[dict]:
    query = Invoice.query.join(Subscription, Invoice.subscription_id == Subscription.id)
    if tenant_id is not None:
        query = query.filter(Subscription.tenant_id == tenant_id)

    if user.client:
        query = query.filter(
            or_(
                Subscription.client_id == user.client.id,
                Subscription.email == user.email,
            )
        )
    else:
        query = query.filter(Subscription.email == user.email)

    return [
        _client_invoice_payload(invoice)
        for invoice in query.order_by(Invoice.created_at.desc()).all()
    ]


STAFF_ALLOWED_ROLES = {"admin", "tech", "support", "billing", "noc", "operator"}
PLATFORM_ADMIN_ROLE = "platform_admin"
TENANT_BILLING_ALLOWED_STATUS = {"trial", "active", "past_due", "suspended", "cancelled"}
TENANT_BILLING_ALLOWED_CYCLES = {"monthly", "quarterly", "yearly"}
TENANT_PLAN_TEMPLATES = {
    "starter": {
        "monthly_price": 39.0,
        "max_admins": 2,
        "max_routers": 5,
        "max_clients": 400,
    },
    "growth": {
        "monthly_price": 89.0,
        "max_admins": 5,
        "max_routers": 20,
        "max_clients": 2000,
    },
    "pro": {
        "monthly_price": 179.0,
        "max_admins": 10,
        "max_routers": 60,
        "max_clients": 8000,
    },
    "enterprise": {
        "monthly_price": 399.0,
        "max_admins": 30,
        "max_routers": 250,
        "max_clients": 50000,
    },
}
STAFF_ALLOWED_STATUS = {"active", "on_leave", "inactive"}
STAFF_ALLOWED_SHIFTS = {"day", "night", "mixed"}
INSTALLATION_ALLOWED_STATUS = {"pending", "scheduled", "in_progress", "completed", "cancelled"}
SCREEN_ALERT_ALLOWED_STATUS = {"draft", "active", "paused", "expired"}
SCREEN_ALERT_ALLOWED_SEVERITY = {"info", "warning", "critical", "success"}
SCREEN_ALERT_ALLOWED_AUDIENCE = {"all", "active", "overdue", "suspended"}
EXTRA_SERVICE_ALLOWED_STATUS = {"active", "disabled"}
HOTSPOT_VOUCHER_ALLOWED_STATUS = {"generated", "sold", "used", "expired", "cancelled"}
SYSTEM_ALLOWED_JOBS = {
    "backup",
    "cleanup_leases",
    "rotate_passwords",
    "recalc_balances",
    "enforce_billing",
    "backup_restore_drill",
}
TICKET_ALLOWED_PRIORITIES = {"low", "medium", "high", "urgent"}
OPS_CHANGE_ALLOWED_STATUS = {
    "requested",
    "approved",
    "scheduled",
    "executing",
    "done",
    "rolled_back",
    "rejected",
    "cancelled",
}

ROLE_BASE_PERMISSIONS: dict[str, set[str]] = {
    PLATFORM_ADMIN_ROLE: {
        "*",
    },
    "admin": {
        "*",
    },
    "noc": {
        "dashboard.read",
        "network.read",
        "network.alerts.read",
        "network.maintenance.read",
        "network.maintenance.write",
        "ops.preflight.read",
        "ops.slo.read",
        "ops.sops.read",
        "ops.change.read",
        "tickets.read",
    },
    "tech": {
        "dashboard.read",
        "clients.read",
        "installations.read",
        "installations.write",
        "ops.sops.read",
        "ops.change.read",
        "tickets.read",
        "tickets.write",
        "network.read",
    },
    "support": {
        "clients.read",
        "tickets.read",
        "tickets.write",
        "notifications.read",
    },
    "billing": {
        "billing.read",
        "billing.write",
        "billing.promises.read",
        "billing.promises.write",
        "payments.review",
        "clients.read",
    },
    "operator": {
        "dashboard.read",
        "clients.read",
        "tickets.read",
        "notifications.read",
    },
    "client": {
        "client.portal.read",
    },
}

PERMISSION_CATALOG = sorted(
    {
        permission
        for permissions in ROLE_BASE_PERMISSIONS.values()
        for permission in permissions
        if permission != "*"
    }
    | {
        "audit.read",
        "billing.promises.read",
        "billing.promises.write",
        "catalog.read",
        "catalog.write",
        "communications.alerts.read",
        "communications.alerts.write",
        "hotspot.read",
        "hotspot.write",
        "installations.read",
        "installations.write",
        "network.maintenance.read",
        "network.maintenance.write",
        "ops.sops.read",
        "ops.sops.write",
        "ops.change.read",
        "ops.change.write",
        "ops.change.approve",
        "ops.preflight.read",
        "ops.slo.read",
        "payments.review",
        "security.permissions.read",
        "security.permissions.write",
        "system.jobs.read",
        "system.jobs.run",
        "system.settings.read",
        "system.settings.write",
    }
)


def _tenant_cache_key(prefix: str, tenant_id) -> str:
    scoped = tenant_id if tenant_id is not None else "global"
    return f"{prefix}:{scoped}"


def _staff_meta_key(tenant_id) -> str:
    return _tenant_cache_key("admin_staff_meta", tenant_id)


def _notifications_history_key(tenant_id) -> str:
    return _tenant_cache_key("admin_notifications_history", tenant_id)


def _installations_key(tenant_id) -> str:
    return _tenant_cache_key("admin_installations", tenant_id)


def _screen_alerts_key(tenant_id) -> str:
    return _tenant_cache_key("admin_screen_alerts", tenant_id)


def _extra_services_key(tenant_id) -> str:
    return _tenant_cache_key("admin_extra_services", tenant_id)


def _hotspot_vouchers_key(tenant_id) -> str:
    return _tenant_cache_key("admin_hotspot_vouchers", tenant_id)


def _system_settings_key(tenant_id) -> str:
    return _tenant_cache_key("admin_system_settings", tenant_id)


def _system_jobs_key(tenant_id) -> str:
    return _tenant_cache_key("admin_system_jobs", tenant_id)


def _ops_sops_key(tenant_id) -> str:
    return _tenant_cache_key("admin_ops_sops", tenant_id)


def _ops_change_requests_key(tenant_id) -> str:
    return _tenant_cache_key("admin_ops_change_requests", tenant_id)


def _load_staff_meta(tenant_id) -> dict:
    return cache.get(_staff_meta_key(tenant_id)) or {}


def _save_staff_meta(tenant_id, metadata: dict) -> None:
    cache.set(_staff_meta_key(tenant_id), metadata, timeout=86400 * 30)


def _load_notification_history(tenant_id) -> list[dict]:
    return cache.get(_notifications_history_key(tenant_id)) or []


def _save_notification_history(tenant_id, history: list[dict]) -> None:
    cache.set(_notifications_history_key(tenant_id), history[:200], timeout=86400 * 30)


def _load_cached_list(key: str) -> list[dict]:
    return cache.get(key) or []


def _save_cached_list(key: str, items: list[dict], max_items: int = 500) -> None:
    cache.set(key, items[:max_items], timeout=86400 * 30)


def _load_cached_dict(key: str) -> dict:
    return cache.get(key) or {}


def _save_cached_dict(key: str, data: dict) -> None:
    cache.set(key, data, timeout=86400 * 30)


def _tenant_scoped_query(model, tenant_id):
    query = model.query
    if tenant_id is None:
        return query.filter(model.tenant_id.is_(None))
    return query.filter(model.tenant_id == tenant_id)


def _load_system_settings_overrides_db(tenant_id) -> dict:
    rows = _tenant_scoped_query(AdminSystemSetting, tenant_id).all()
    return {row.key: row.value for row in rows}


def _save_system_settings_overrides_db(tenant_id, overrides: dict, updated_by=None) -> None:
    existing_rows = _tenant_scoped_query(AdminSystemSetting, tenant_id).all()
    existing_map = {row.key: row for row in existing_rows}
    for key_name, value in overrides.items():
        row = existing_map.get(key_name)
        if row is None:
            row = AdminSystemSetting(
                tenant_id=tenant_id,
                key=key_name,
                value=value,
                updated_by=updated_by,
                updated_at=datetime.utcnow(),
            )
        else:
            row.value = value
            row.updated_by = updated_by
            row.updated_at = datetime.utcnow()
        db.session.add(row)
    db.session.commit()


def _system_setting_value(tenant_id, key_name: str, default=None):
    row = _tenant_scoped_query(AdminSystemSetting, tenant_id).filter_by(key=key_name).first()
    if row is not None:
        return row.value
    cached = _load_cached_dict(_system_settings_key(tenant_id))
    if key_name in cached:
        return cached.get(key_name)
    return default


def _upsert_system_setting_value(tenant_id, key_name: str, value, updated_by=None) -> None:
    row = _tenant_scoped_query(AdminSystemSetting, tenant_id).filter_by(key=key_name).first()
    if row is None:
        row = AdminSystemSetting(
            tenant_id=tenant_id,
            key=key_name,
            value=value,
            updated_by=updated_by,
            updated_at=datetime.utcnow(),
        )
    else:
        row.value = value
        row.updated_by = updated_by
        row.updated_at = datetime.utcnow()
    db.session.add(row)
    db.session.commit()

    cached_settings = _load_cached_dict(_system_settings_key(tenant_id))
    cached_settings[key_name] = value
    _save_cached_dict(_system_settings_key(tenant_id), cached_settings)


def _default_ops_sops() -> list[dict]:
    return [
        {
            "id": "alta-cliente",
            "title": "Alta de Cliente",
            "category": "provisioning",
            "owner_role": "admin",
            "checklist": [
                {"id": "validar-documento", "label": "Validar documento e identidad", "required": True},
                {"id": "validar-cobertura", "label": "Validar cobertura tecnica", "required": True},
                {"id": "asignar-plan", "label": "Asignar plan y politica comercial", "required": True},
                {"id": "probar-activacion", "label": "Probar navegacion y throughput", "required": True},
            ],
        },
        {
            "id": "cambio-plan",
            "title": "Cambio de Plan",
            "category": "billing",
            "owner_role": "billing",
            "checklist": [
                {"id": "confirmar-saldo", "label": "Confirmar saldo y facturacion", "required": True},
                {"id": "prorrateo", "label": "Aplicar prorrateo documentado", "required": True},
                {"id": "ajuste-red", "label": "Ejecutar ajuste de velocidad en red", "required": True},
            ],
        },
        {
            "id": "ventana-mantenimiento",
            "title": "Ventana de Mantenimiento NOC",
            "category": "noc",
            "owner_role": "noc",
            "checklist": [
                {"id": "comunicacion-previa", "label": "Comunicar alcance y horario", "required": True},
                {"id": "plan-rollback", "label": "Definir plan de rollback", "required": True},
                {"id": "ticket-cambio", "label": "Registrar ticket/cambio aprobado", "required": True},
                {"id": "cierre-post", "label": "Registrar postmortem y cierre", "required": True},
            ],
        },
    ]


def _load_ops_sops(tenant_id) -> list[dict]:
    source = _system_setting_value(tenant_id, "ops_sops", default=None)
    if isinstance(source, list):
        payload = [item for item in source if isinstance(item, dict)]
        if payload:
            return payload
    cached = _load_cached_list(_ops_sops_key(tenant_id))
    if cached:
        return cached
    defaults = _default_ops_sops()
    _save_cached_list(_ops_sops_key(tenant_id), defaults, max_items=200)
    return defaults


def _save_ops_sops(tenant_id, items: list[dict], updated_by=None) -> None:
    cleaned = [item for item in items if isinstance(item, dict)]
    _upsert_system_setting_value(tenant_id, "ops_sops", cleaned, updated_by=updated_by)
    _save_cached_list(_ops_sops_key(tenant_id), cleaned, max_items=200)


def _load_ops_change_requests(tenant_id) -> list[dict]:
    source = _system_setting_value(tenant_id, "ops_change_requests", default=[])
    if isinstance(source, list):
        payload = [item for item in source if isinstance(item, dict)]
        if payload:
            return payload
    cached = _load_cached_list(_ops_change_requests_key(tenant_id))
    return [item for item in cached if isinstance(item, dict)]


def _save_ops_change_requests(tenant_id, items: list[dict], updated_by=None) -> None:
    cleaned = [item for item in items if isinstance(item, dict)]
    _upsert_system_setting_value(tenant_id, "ops_change_requests", cleaned, updated_by=updated_by)
    _save_cached_list(_ops_change_requests_key(tenant_id), cleaned, max_items=500)


def _load_system_jobs_db(tenant_id, status_filter: str = '', job_filter: str = '') -> list[dict]:
    query = _tenant_scoped_query(AdminSystemJob, tenant_id)
    if status_filter:
        query = query.filter(AdminSystemJob.status == status_filter)
    if job_filter:
        query = query.filter(AdminSystemJob.job == job_filter)
    rows = query.order_by(AdminSystemJob.started_at.desc()).all()
    return [row.to_dict() for row in rows]


def _role_permissions_with_overrides(role: str, tenant_id) -> set[str]:
    normalized_role = str(role or '').strip().lower()
    base_permissions = set(ROLE_BASE_PERMISSIONS.get(normalized_role, set()))
    if "*" in base_permissions:
        return {"*"}

    overrides = (
        _tenant_scoped_query(RolePermission, tenant_id)
        .filter_by(role=normalized_role)
        .all()
    )
    resolved = set(base_permissions)
    for entry in overrides:
        if entry.allowed:
            resolved.add(entry.permission)
        else:
            resolved.discard(entry.permission)
    return resolved


def _is_permission_allowed(user: User | None, permission: str, tenant_id) -> bool:
    if not user:
        return False
    permissions = _role_permissions_with_overrides(user.role, tenant_id)
    return "*" in permissions or permission in permissions


def _iso_utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _actor_default_name(actor_id) -> str:
    parsed = _parse_int(actor_id)
    if parsed is None:
        return "system"
    return f"user#{parsed}"


def _current_actor_snapshot() -> dict:
    actor_id = _current_user_id()
    if actor_id is None:
        return {"id": None, "name": "system", "email": None}
    user = db.session.get(User, actor_id)
    if not user:
        return {"id": actor_id, "name": _actor_default_name(actor_id), "email": None}
    display_name = (user.name or user.email or _actor_default_name(user.id)).strip()
    return {"id": user.id, "name": display_name, "email": user.email}


def _ensure_operational_entry_metadata(entry: dict) -> bool:
    changed = False
    if not entry.get("created_at"):
        entry["created_at"] = _iso_utc_now()
        changed = True
    if not entry.get("updated_at"):
        entry["updated_at"] = entry["created_at"]
        changed = True

    if "created_by" not in entry:
        entry["created_by"] = None
        changed = True
    if "updated_by" not in entry:
        entry["updated_by"] = entry.get("created_by")
        changed = True

    if not entry.get("created_by_name"):
        entry["created_by_name"] = _actor_default_name(entry.get("created_by"))
        changed = True
    if not entry.get("updated_by_name"):
        entry["updated_by_name"] = _actor_default_name(entry.get("updated_by"))
        changed = True
    return changed


def _apply_operational_entry_create_metadata(entry: dict, actor: dict | None = None) -> None:
    actor = actor or _current_actor_snapshot()
    now = _iso_utc_now()
    actor_name = str(actor.get("name") or _actor_default_name(actor.get("id")))
    actor_email = actor.get("email")

    entry["created_at"] = now
    entry["updated_at"] = now
    entry["created_by"] = actor.get("id")
    entry["updated_by"] = actor.get("id")
    entry["created_by_name"] = actor_name
    entry["updated_by_name"] = actor_name
    if actor_email:
        entry["created_by_email"] = actor_email
        entry["updated_by_email"] = actor_email


def _apply_operational_entry_update_metadata(entry: dict, actor: dict | None = None) -> None:
    actor = actor or _current_actor_snapshot()
    _ensure_operational_entry_metadata(entry)
    actor_name = str(actor.get("name") or _actor_default_name(actor.get("id")))
    actor_email = actor.get("email")

    entry["updated_at"] = _iso_utc_now()
    entry["updated_by"] = actor.get("id")
    entry["updated_by_name"] = actor_name
    if actor_email:
        entry["updated_by_email"] = actor_email


def _normalize_operational_items_metadata(items: list[dict]) -> bool:
    changed = False
    for item in items:
        if _ensure_operational_entry_metadata(item):
            changed = True
    return changed


def _ticket_assignee_counts(tenant_id) -> dict[str, int]:
    query = Ticket.query.filter(Ticket.status.in_(("open", "in_progress")))
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)
    counts: dict[str, int] = {}
    for ticket in query.all():
        assigned = (ticket.assigned_to or "").strip().lower()
        if not assigned:
            continue
        counts[assigned] = counts.get(assigned, 0) + 1
    return counts


def _serialize_staff_member(user: User, metadata: dict, assigned_counts: dict[str, int]) -> dict:
    zone = str(metadata.get("zone") or "general")
    status = str(metadata.get("status") or "active")
    shift = str(metadata.get("shift") or "day")
    phone = str(metadata.get("phone") or "")
    last_seen = metadata.get("last_seen_at") or (user.created_at.isoformat() if user.created_at else None)
    email_key = (user.email or "").strip().lower()
    name_key = (user.name or "").strip().lower()
    open_tickets = assigned_counts.get(email_key, 0)
    if name_key and name_key != email_key:
        open_tickets += assigned_counts.get(name_key, 0)
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "mfa_enabled": bool(user.mfa_enabled),
        "zone": zone,
        "status": status if status in STAFF_ALLOWED_STATUS else "active",
        "shift": shift if shift in STAFF_ALLOWED_SHIFTS else "day",
        "phone": phone,
        "open_tickets": open_tickets,
        "last_seen_at": last_seen,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


def _audit(action: str, entity_type: str = None, entity_id: str = None, metadata=None):
    try:
        tenant_id = current_tenant_id()
        user_id = _current_user_id()
        entry = AuditLog(
            tenant_id=tenant_id,
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            meta=metadata,
            ip_address=getattr(request, "remote_addr", None),
        )
        from app import db
        db.session.add(entry)
        db.session.commit()
    except Exception:
        pass


def _notify_incident(message: str, severity: str = "info"):
    """Send push notification to PagerDuty/Telegram if configured."""
    pd_key = current_app.config.get('PAGERDUTY_ROUTING_KEY')
    tg_token = current_app.config.get('TELEGRAM_BOT_TOKEN')
    tg_chat = current_app.config.get('TELEGRAM_CHAT_ID')
    wp_token = current_app.config.get('WONDERPUSH_ACCESS_TOKEN')
    wp_app = current_app.config.get('WONDERPUSH_APPLICATION_ID')
    if pd_key:
        try:
            import requests
            payload = {
                "routing_key": pd_key,
                "event_action": "trigger",
                "payload": {
                    "summary": message,
                    "severity": "critical" if severity == "critical" else "warning" if severity == "warning" else "info",
                    "source": "ispfast-api",
                },
            }
            requests.post("https://events.pagerduty.com/v2/enqueue", json=payload, timeout=5)
        except Exception:
            current_app.logger.warning("PagerDuty notify failed")
    if tg_token and tg_chat:
        try:
            import requests
            requests.post(f"https://api.telegram.org/bot{tg_token}/sendMessage",
                          data={"chat_id": tg_chat, "text": message[:4000]}, timeout=5)
        except Exception:
            current_app.logger.warning("Telegram notify failed")
    if wp_token and wp_app:
        try:
            import requests
            payload = {
                "targetSegmentIds": ["all"],
                "notification": {"alert": message, "url": current_app.config.get('FRONTEND_URL')}
            }
            requests.post(
                "https://api.wonderpush.com/v1/deliveries",
                params={"applicationId": wp_app},
                headers={"Authorization": f"Bearer {wp_token}"},
                json=payload,
                timeout=5
            )
        except Exception:
            current_app.logger.warning("WonderPush notify failed")

# Helper para verificar rol de admin
def admin_required():
    def wrapper(fn):
        @jwt_required()
        @wraps(fn)
        def decorator(*args, **kwargs):
            current_user_id = _current_user_id()
            if current_user_id is None:
                return jsonify({"error": "Token de usuario invalido."}), 401
            user = db.session.get(User, current_user_id)
            tenant_id = current_tenant_id()
            is_platform_admin = bool(user and user.role == PLATFORM_ADMIN_ROLE)
            if not user or (user.role != 'admin' and not is_platform_admin):
                return jsonify({"error": "Acceso denegado. Se requiere rol de administrador."}), 403
            if is_platform_admin and tenant_id is None:
                return jsonify({"error": "Platform admin debe seleccionar un tenant para entrar al panel ISP."}), 403
            if not is_platform_admin and tenant_id is not None and user.tenant_id not in (None, tenant_id):
                return jsonify({"error": "Acceso denegado para este tenant."}), 403
            if not is_platform_admin and tenant_id is None and user.tenant_id is not None:
                return jsonify({"error": "Admin ISP requiere contexto tenant valido."}), 403
            return fn(*args, **kwargs)

        return decorator

    return wrapper


def platform_admin_required():
    def wrapper(fn):
        @jwt_required()
        @wraps(fn)
        def decorator(*args, **kwargs):
            current_user_id = _current_user_id()
            if current_user_id is None:
                return jsonify({"error": "Token de usuario invalido."}), 401
            user = db.session.get(User, current_user_id)
            if not user or user.role != PLATFORM_ADMIN_ROLE:
                return jsonify({"error": "Acceso denegado. Se requiere rol platform_admin."}), 403
            tenant_id = current_tenant_id()
            if tenant_id is not None:
                return jsonify({"error": "Admin total solo disponible en host master/global."}), 403
            return fn(*args, **kwargs)

        return decorator

    return wrapper


def staff_required():
    def wrapper(fn):
        @jwt_required()
        @wraps(fn)
        def decorator(*args, **kwargs):
            current_user_id = _current_user_id()
            if current_user_id is None:
                return jsonify({"error": "Token de usuario invalido."}), 401
            user = db.session.get(User, current_user_id)
            tenant_id = current_tenant_id()
            is_platform_admin = bool(user and user.role == PLATFORM_ADMIN_ROLE)
            if not user or (user.role not in STAFF_ALLOWED_ROLES and not is_platform_admin):
                return jsonify({"error": "Acceso denegado. Se requiere rol operativo."}), 403
            if is_platform_admin and tenant_id is None:
                return jsonify({"error": "Platform admin debe seleccionar un tenant para operar modulos ISP."}), 403
            if not is_platform_admin and tenant_id is not None and user.tenant_id not in (None, tenant_id):
                return jsonify({"error": "Acceso denegado para este tenant."}), 403
            if not is_platform_admin and tenant_id is None and user.tenant_id is not None:
                return jsonify({"error": "Rol operativo requiere contexto tenant valido."}), 403
            return fn(*args, **kwargs)

        return decorator

    return wrapper


def permission_required(permission: str):
    def wrapper(fn):
        @jwt_required()
        @wraps(fn)
        def decorator(*args, **kwargs):
            current_user_id = _current_user_id()
            if current_user_id is None:
                return jsonify({"error": "Token de usuario invalido."}), 401
            user = db.session.get(User, current_user_id)
            tenant_id = current_tenant_id()
            is_platform_admin = bool(user and user.role == PLATFORM_ADMIN_ROLE)
            if not user or (user.role not in STAFF_ALLOWED_ROLES and not is_platform_admin):
                return jsonify({"error": "Acceso denegado. Se requiere rol operativo."}), 403
            if is_platform_admin and tenant_id is None:
                return jsonify({"error": "Platform admin debe seleccionar un tenant para operar modulos ISP."}), 403
            if not is_platform_admin and tenant_id is not None and user.tenant_id not in (None, tenant_id):
                return jsonify({"error": "Acceso denegado para este tenant."}), 403
            if not is_platform_admin and tenant_id is None and user.tenant_id is not None:
                return jsonify({"error": "Rol operativo requiere contexto tenant valido."}), 403
            if not _is_permission_allowed(user, permission, tenant_id):
                return jsonify({"error": f"Permiso insuficiente: {permission}"}), 403
            return fn(*args, **kwargs)

        return decorator

    return wrapper


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
        "id": tenant.id,
        "slug": tenant.slug,
        "name": tenant.name,
        "is_active": bool(tenant.is_active),
        "created_at": tenant.created_at.isoformat() if tenant.created_at else None,
        "host": tenant_host,
        "plan_code": tenant.plan_code,
        "billing_status": tenant.billing_status,
        "billing_cycle": tenant.billing_cycle,
        "monthly_price": float(tenant.monthly_price or 0),
        "max_admins": int(tenant.max_admins or 0),
        "max_routers": int(tenant.max_routers or 0),
        "max_clients": int(tenant.max_clients or 0),
        "trial_ends_at": tenant.trial_ends_at.isoformat() if tenant.trial_ends_at else None,
        "users_total": users_total,
        "admins_total": admin_total,
        "clients_total": clients_total,
        "routers_total": routers_total,
        "subscriptions_total": subs_total,
        "subscriptions_active": active_subs,
        "subscriptions_suspended": suspended_subs,
    }


def _platform_admin_exists() -> bool:
    return User.query.filter_by(role=PLATFORM_ADMIN_ROLE).first() is not None


def _normalize_tenant_plan_code(value: str | None) -> str | None:
    candidate = str(value or '').strip().lower()
    if not candidate:
        return None
    if candidate in TENANT_PLAN_TEMPLATES:
        return candidate
    return None


def _normalize_tenant_billing_status(value: str | None) -> str | None:
    candidate = str(value or '').strip().lower()
    if not candidate:
        return None
    if candidate in TENANT_BILLING_ALLOWED_STATUS:
        return candidate
    return None


def _normalize_tenant_billing_cycle(value: str | None) -> str | None:
    candidate = str(value or '').strip().lower()
    if not candidate:
        return None
    if candidate in TENANT_BILLING_ALLOWED_CYCLES:
        return candidate
    return None


def _parse_limit_int(value, min_value: int, max_value: int) -> int | None:
    if value is None or str(value).strip() == '':
        return None
    parsed = _parse_int(value)
    if parsed is None:
        return None
    return max(min_value, min(max_value, parsed))


def _parse_money_value(value) -> float | None:
    if value is None or str(value).strip() == '':
        return None
    try:
        parsed = round(float(value), 2)
    except (TypeError, ValueError):
        return None
    return max(0.0, parsed)


def _build_network_alert_items(tenant_id) -> list[dict]:
    routers_q = MikroTikRouter.query
    subs_q = Subscription.query
    if tenant_id is not None:
        routers_q = routers_q.filter_by(tenant_id=tenant_id)
        subs_q = subs_q.filter_by(tenant_id=tenant_id)

    alerts: list[dict] = []
    now_iso = _iso_utc_now()

    for router in routers_q.filter_by(is_active=False).all():
        alerts.append(
            {
                "id": f"AL-R-{router.id}",
                "severity": "critical",
                "scope": "router",
                "target": router.name,
                "message": "Router sin respuesta",
                "since": now_iso,
            }
        )

    for sub in subs_q.filter_by(status='past_due').all():
        alerts.append(
            {
                "id": f"AL-S-{sub.id}",
                "severity": "warning",
                "scope": "billing",
                "target": sub.customer,
                "message": "Suscripcion vencida",
                "since": now_iso,
            }
        )

    now_dt = datetime.utcnow()
    active_windows = (
        _tenant_scoped_query(NocMaintenanceWindow, tenant_id)
        .filter(
            NocMaintenanceWindow.mute_alerts.is_(True),
            NocMaintenanceWindow.starts_at <= now_dt,
            NocMaintenanceWindow.ends_at >= now_dt,
        )
        .all()
    )
    muted_scopes = {str(window.scope or 'all').strip().lower() for window in active_windows}
    if muted_scopes:
        if 'all' in muted_scopes:
            alerts = []
        else:
            alerts = [alert for alert in alerts if str(alert.get("scope") or "").strip().lower() not in muted_scopes]

    if not alerts:
        alerts.append(
            {
                "id": "AL-OK",
                "severity": "info",
                "scope": "network",
                "target": "Red",
                "message": "Sin alertas criticas" if not muted_scopes else "Alertas silenciadas por ventana de mantenimiento activa",
                "since": now_iso,
            }
        )
    return alerts


def _build_network_health_payload(tenant_id) -> dict:
    routers_q = MikroTikRouter.query
    if tenant_id is not None:
        routers_q = routers_q.filter_by(tenant_id=tenant_id)
    routers_ok = routers_q.filter_by(is_active=True).count()
    routers_down = routers_q.filter_by(is_active=False).count()

    clients_q = Client.query
    if tenant_id is not None:
        clients_q = clients_q.filter_by(tenant_id=tenant_id)
    clients_total = clients_q.count()

    health = {
        "routers_ok": routers_ok,
        "routers_down": routers_down,
        "clients_total": clients_total,
        "olt_ok": 4,
        "olt_alert": 1,
        "latency_ms": 12 + routers_down,
        "packet_loss": round(0.2 + routers_down * 0.3, 2),
        "last_updated": datetime.utcnow().isoformat(),
        "source": "fallback",
    }

    try:
        monitoring = MonitoringService()
        resources = monitoring.query_metrics('system_resources', time_range='-30m')
        cpu_samples = []
        mem_usage = []
        for point in resources:
            cpu = point.get('cpu_load')
            free_mem = point.get('free_memory')
            total_mem = point.get('total_memory')
            if cpu is not None:
                try:
                    cpu_samples.append(float(str(cpu).replace('%', '').strip()))
                except Exception:
                    pass
            if free_mem is not None and total_mem not in (None, 0):
                try:
                    usage = (float(total_mem) - float(free_mem)) / float(total_mem) * 100
                    mem_usage.append(usage)
                except Exception:
                    pass

        score = 95 - (routers_down * 8)
        if cpu_samples:
            cpu_avg = sum(cpu_samples) / len(cpu_samples)
            health["cpu_avg"] = round(cpu_avg, 1)
            score -= max(0, cpu_avg - 70) * 0.2
        if mem_usage:
            mem_avg = sum(mem_usage) / len(mem_usage)
            health["memory_avg"] = round(mem_avg, 1)
            score -= max(0, mem_avg - 80) * 0.15

        health["score"] = max(35, min(100, round(score, 1)))
        health["source"] = "influxdb"
    except Exception as exc:
        current_app.logger.info("Network health using fallback: %s", exc)
        health["score"] = max(40, min(100, 95 - routers_down * 5))

    return health


def _build_client_notifications(user: User, tenant_id) -> list[dict]:
    notifications: list[dict] = []
    now_iso = _iso_utc_now()

    tickets_q = Ticket.query.filter(Ticket.status.in_(("open", "in_progress")))
    if tenant_id is not None:
        tickets_q = tickets_q.filter_by(tenant_id=tenant_id)
    if user.client:
        tickets_q = tickets_q.filter_by(client_id=user.client.id)
    else:
        tickets_q = tickets_q.filter_by(user_id=user.id)
    open_tickets = tickets_q.count()
    if open_tickets:
        notifications.append(
            {
                "id": f"NT-TICKETS-{user.id}",
                "message": f"Tienes {open_tickets} ticket(s) abiertos",
                "time": now_iso,
                "read": False,
            }
        )

    today = datetime.utcnow().date()
    invoices = _get_user_invoice_items(user, tenant_id)
    overdue = 0
    pending = 0
    for invoice in invoices:
        status = str(invoice.get("status") or "").lower()
        if status not in {"pending", "overdue"}:
            continue
        pending += 1
        due_dt = _parse_iso_datetime(invoice.get("due_date") or invoice.get("due"))
        if due_dt and due_dt.date() < today:
            overdue += 1

    if overdue:
        notifications.append(
            {
                "id": f"NT-INVOICE-OVERDUE-{user.id}",
                "message": f"Tienes {overdue} factura(s) vencida(s)",
                "time": now_iso,
                "read": False,
            }
        )
    elif pending:
        notifications.append(
            {
                "id": f"NT-INVOICE-PENDING-{user.id}",
                "message": f"Tienes {pending} factura(s) pendiente(s)",
                "time": now_iso,
                "read": False,
            }
        )

    if not notifications:
        notifications.append(
            {
                "id": f"NT-INFO-{user.id}",
                "message": "Sin novedades en tu cuenta.",
                "time": now_iso,
                "read": False,
            }
        )

    return notifications[:5]


# Este Blueprint contiene las rutas principales de la API
main_bp = Blueprint('main_bp', __name__)


@main_bp.route('/health', methods=['GET'])
def api_health():
    return jsonify({'status': 'healthy', 'service': 'ispmax-backend-api'}), 200


@main_bp.route('/dashboard', methods=['GET'])
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


@main_bp.route('/billing', methods=['GET'])
@staff_required()
def billing_summary():
    tenant_id = current_tenant_id()
    subs = Subscription.query
    if tenant_id is not None:
        subs = subs.filter_by(tenant_id=tenant_id)

    invoices = []
    for s in subs.all():
        inv_total = float(s.amount) * (1 + float(s.tax_percent or 0) / 100)
        invoices.append({
            "id": f"SUB-{s.id}",
            "amount": float(s.amount),
            "tax_percent": float(s.tax_percent or 0),
            "total": round(inv_total, 2),
            "currency": s.currency,
            "due": s.next_charge.isoformat() if s.next_charge else datetime.utcnow().date().isoformat(),
            "status": "paid" if s.status == 'active' else ("overdue" if s.status == 'past_due' else "pending"),
            "method": s.method,
        })
    return jsonify({"invoices": invoices, "count": len(invoices)}), 200


@main_bp.route('/connections', methods=['GET'])
@staff_required()
def connections_summary():
    tenant_id = current_tenant_id()
    query = Client.query
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)

    items = []
    for client in query.all():
        status = 'active'
        if client.connection_type == 'pppoe':
            status = 'active'
        elif client.connection_type == 'dhcp':
            status = 'idle'
        elif client.connection_type == 'static':
            status = 'active'
        if client.router and not client.router.is_active:
            status = 'offline'

        items.append({
            "id": str(client.id),
            "ip": client.ip_address or '',
            "mac": client.mac_address or '',
            "status": status
        })
    return jsonify({"items": items, "count": len(items)}), 200


@main_bp.route('/notifications', methods=['GET'])
@jwt_required()
def notifications_feed():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401

    user = db.session.get(User, current_user_id)
    tenant_id = current_tenant_id()
    if not user:
        return jsonify({"error": "Token de usuario invalido."}), 401
    if tenant_id is not None and user.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    if user.role in STAFF_ALLOWED_ROLES:
        alerts = _build_network_alert_items(tenant_id)
        now = _iso_utc_now()
        feed = []
        for idx, alert in enumerate(alerts[:5], start=1):
            feed.append(
                {
                    "id": idx,
                    "message": f"Alerta {alert['severity']}: {alert['message']}",
                    "time": now,
                    "read": False,
                }
            )
    else:
        feed = _build_client_notifications(user, tenant_id)

    return jsonify({"notifications": feed, "count": len(feed)}), 200


@main_bp.route('/auth/login', methods=['POST'])
@limiter.limit("10/minute")
def login():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({"error": "Email y contrasena son requeridos."}), 400

    tenant_id = current_tenant_id()
    query = User.query.filter_by(email=data.get('email'))
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)

    user = query.first()
    if user and user.check_password(data.get('password')):
        settings = _effective_system_settings(tenant_id)
        admin_mfa_required = bool(settings.get("admin_mfa_required", False))
        if admin_mfa_required and user.role in STAFF_ALLOWED_ROLES.union({"admin", PLATFORM_ADMIN_ROLE}) and not user.mfa_enabled:
            return jsonify({"error": "MFA obligatorio para cuentas administrativas.", "mfa_setup_required": True}), 403

        # MFA: si esta habilitado, validar codigo
        if user.mfa_enabled:
            mfa_code = str(data.get('mfa_code') or '').strip()
            if not mfa_code:
                return jsonify({"error": "MFA requerido", "mfa_required": True}), 401
            if not user.mfa_secret:
                return jsonify({"error": "MFA no configurado correctamente"}), 500
            totp = pyotp.TOTP(user.mfa_secret)
            if not totp.verify(mfa_code, valid_window=1):
                return jsonify({"error": "Codigo MFA invalido", "mfa_required": True}), 401

        access_token = create_access_token(
            identity=str(user.id),
            additional_claims={'tenant_id': user.tenant_id},
        )
        return jsonify({"token": access_token, "user": user.to_dict()}), 200

    return jsonify({"error": "Credenciales incorrectas."}), 401


@main_bp.route('/auth/password/forgot', methods=['POST'])
@limiter.limit("10/minute")
def forgot_password():
    data = request.get_json() or {}
    email = str(data.get('email') or '').strip().lower()
    if not email:
        return jsonify({"error": "email es requerido"}), 400

    tenant_id = current_tenant_id()
    query = User.query.filter_by(email=email)
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)
    user = query.first()

    reset_token = None
    if user:
        reset_token = secrets.token_urlsafe(32)
        ttl_seconds = _password_reset_token_ttl_seconds()
        cache.set(
            _password_reset_key(reset_token),
            {"user_id": user.id, "tenant_id": user.tenant_id},
            timeout=ttl_seconds,
        )
        try:
            if mail and current_app.config.get('MAIL_SERVER') and user.email:
                app_name = str(current_app.config.get('APP_NAME') or 'ISPFAST').strip()
                ttl_minutes = max(1, ttl_seconds // 60)
                reset_url = f"{current_app.config.get('FRONTEND_URL') or ''}/login?reset_token={reset_token}"
                message = Message(
                    subject=f'{app_name}: recuperacion de password',
                    recipients=[user.email],
                    body=(
                        "Recibimos una solicitud para restablecer tu password.\n\n"
                        f"Token: {reset_token}\n"
                        f"Enlace: {reset_url}\n"
                        f"Este token expira en {ttl_minutes} minutos."
                    ),
                    sender=current_app.config.get('MAIL_DEFAULT_SENDER'),
                )
                mail.send(message)
        except Exception:
            current_app.logger.warning("No se pudo enviar correo de recuperacion de password")

    payload = {
        "success": True,
        "message": "Si el correo existe, enviaremos instrucciones para restablecer el acceso.",
    }
    allow_token_response = bool(
        current_app.config.get('TESTING')
        or current_app.config.get('ALLOW_INSECURE_PASSWORD_RESET_TOKEN_RESPONSE', False)
    )
    if reset_token and allow_token_response:
        payload["reset_token"] = reset_token
    return jsonify(payload), 200


@main_bp.route('/auth/password/reset', methods=['POST'])
@limiter.limit("10/minute")
def reset_password():
    data = request.get_json() or {}
    token = str(data.get('token') or '').strip()
    new_password = str(data.get('new_password') or '')

    if not token:
        return jsonify({"error": "token es requerido"}), 400
    if not new_password:
        return jsonify({"error": "new_password es requerido"}), 400
    key = _password_reset_key(token)
    token_data = cache.get(key)
    if not isinstance(token_data, dict):
        return jsonify({"error": "Token invalido o expirado."}), 400

    user_id = _parse_int(token_data.get('user_id'))
    if not user_id:
        cache.delete(key)
        return jsonify({"error": "Token invalido o expirado."}), 400

    user = db.session.get(User, user_id)
    if not user:
        cache.delete(key)
        return jsonify({"error": "Token invalido o expirado."}), 400

    tenant_id = current_tenant_id()
    token_tenant = _parse_int(token_data.get('tenant_id'))
    if tenant_id is not None and token_tenant not in (None, tenant_id):
        return jsonify({"error": "Token invalido o expirado."}), 400

    if user.check_password(new_password):
        return jsonify({"error": "La nueva contraseña debe ser diferente a la actual."}), 400

    valid_password, password_error = _validate_password_policy(new_password, user.tenant_id)
    if not valid_password:
        return jsonify({"error": password_error}), 400

    user.set_password(new_password)
    db.session.add(user)
    db.session.commit()
    cache.delete(key)
    return jsonify({"success": True}), 200


@main_bp.route('/platform/bootstrap/status', methods=['GET'])
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


@main_bp.route('/platform/bootstrap', methods=['POST'])
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


@main_bp.route('/platform/overview', methods=['GET'])
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


@main_bp.route('/platform/plans/templates', methods=['GET'])
@platform_admin_required()
def platform_plan_templates():
    return jsonify({"items": TENANT_PLAN_TEMPLATES}), 200


@main_bp.route('/platform/tenants', methods=['GET'])
@platform_admin_required()
def platform_list_tenants():
    tenants = Tenant.query.order_by(Tenant.created_at.desc()).all()
    items = [_serialize_tenant_platform_item(tenant) for tenant in tenants]
    return jsonify({"items": items, "count": len(items)}), 200


@main_bp.route('/platform/tenants', methods=['POST'])
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
    billing_status = billing_status or 'active'

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
            return jsonify({"error": "El plan del tenant no permite crear admins"}), 409
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


@main_bp.route('/platform/tenants/<int:tenant_id>', methods=['PATCH'])
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


@main_bp.route('/platform/tenants/<int:tenant_id>/admins', methods=['POST'])
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


@main_bp.route('/auth/register', methods=['POST'])
@limiter.limit("5/minute")
def register():
    """
    Registro publico: crea un usuario cliente y devuelve token inmediato.
    """
    if not current_app.config.get('ALLOW_SELF_SIGNUP', False):
        return jsonify({"error": "El registro publico esta deshabilitado. Solicite acceso al administrador."}), 403

    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if not name or not email or not password:
        return jsonify({"error": "Nombre, email y contrasena son requeridos."}), 400

    tenant_id = current_tenant_id()
    existing = User.query.filter_by(email=email).first()
    if existing:
        return jsonify({"error": "El correo ya esta registrado."}), 400

    valid_password, password_error = _validate_password_policy(password, tenant_id)
    if not valid_password:
        return jsonify({"error": password_error}), 400

    user = User(
        name=name,
        email=email,
        role='client',
        tenant_id=tenant_id,
    )
    user.set_password(password)
    from app import db

    db.session.add(user)
    db.session.commit()

    access_token = create_access_token(identity=str(user.id), additional_claims={'tenant_id': user.tenant_id})
    return jsonify({"token": access_token, "user": user.to_dict()}), 201


@main_bp.route('/admin/clients/<int:client_id>/change_plan', methods=['POST'])
@jwt_required()
def change_plan(client_id):
    """Cambio de plan con prorrateo opcional y nueva factura."""
    user_id = _current_user_id()
    user = db.session.get(User, user_id)
    if not user or user.role != 'admin':
        return jsonify({"error": "Solo administradores pueden cambiar planes"}), 403

    client = db.session.get(Client, client_id)
    if not client:
        return jsonify({"error": "Cliente no encontrado"}), 404
    tenant_id = current_tenant_id()
    if tenant_id and client.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Cliente fuera del tenant"}), 403

    data = request.get_json() or {}
    plan_id = data.get('plan_id')
    apply_proration = _parse_bool(data.get('prorate', True))
    if not plan_id:
        return jsonify({"error": "plan_id es requerido"}), 400
    if apply_proration is None:
        return jsonify({"error": "prorate debe ser booleano"}), 400

    new_plan = db.session.get(Plan, plan_id)
    if not new_plan:
        return jsonify({"error": "Plan no encontrado"}), 404

    # Buscar suscripción activa
    subscription = Subscription.query.filter_by(client_id=client.id).order_by(Subscription.created_at.desc()).first()
    today = date.today()
    proration_amount = 0.0
    tax_percent = float(subscription.tax_percent) if subscription else 0.0

    if subscription:
        # calcular prorrateo simple basado en días restantes del ciclo
        days_in_cycle = max(subscription.cycle_months * 30, 1)
        days_left = max((subscription.next_charge - today).days if subscription.next_charge else 0, 0)
        delta = (new_plan.price or 0) - float(subscription.amount)
        proration_amount = round(delta * days_left / days_in_cycle, 2) if apply_proration else 0.0

        # actualizar suscripción al nuevo plan/precio
        subscription.plan = new_plan.name
        subscription.amount = new_plan.price or 0
        subscription.currency = subscription.currency or 'USD'
        subscription.updated_at = datetime.utcnow()
    else:
        # crear suscripción si no existe
        subscription = Subscription(
            customer=client.full_name,
            email=user.email,
            plan=new_plan.name,
            cycle_months=1,
            amount=new_plan.price or 0,
            status='active',
            currency='USD',
            tax_percent=0,
            next_charge=today,
            method='manual',
            client_id=client.id,
            tenant_id=client.tenant_id,
        )
        db.session.add(subscription)

    # Cambiar plan del cliente
    client.plan_id = new_plan.id

    invoice_total = (float(new_plan.price or 0) + (proration_amount if proration_amount > 0 else 0))
    invoice = Invoice(
        subscription=subscription,
        amount=invoice_total,
        currency=subscription.currency or 'USD',
        tax_percent=tax_percent,
        total_amount=invoice_total * (1 + tax_percent / 100),
        status='pending' if invoice_total > 0 else 'paid',
        due_date=today,
        country=subscription.country,
    )
    db.session.add(invoice)
    db.session.flush()

    if proration_amount != 0:
        payment = PaymentRecord(
            invoice=invoice,
            method='proration',
            reference=f'proration-{client.id}-{invoice.id}',
            amount=abs(proration_amount),
            currency=invoice.currency,
            status='pending' if proration_amount > 0 else 'paid',
            meta={'delta': proration_amount},
        )
        db.session.add(payment)

    db.session.commit()

    return jsonify({
        "client": client.to_dict(),
        "subscription": subscription.to_dict(),
        "invoice": invoice.to_dict(),
        "proration_amount": proration_amount,
    }), 200


@main_bp.route('/admin/payments/manual', methods=['POST'])
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

    return jsonify({"invoice": invoice.to_dict(), "payment": payment.to_dict()}), 201


def _verify_google_credential(credential: str) -> dict:
    google_client_id = (current_app.config.get('GOOGLE_CLIENT_ID') or '').strip()
    if not google_client_id:
        raise BadRequest("GOOGLE_CLIENT_ID no está configurado en el backend.")

    try:
        resp = requests.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": credential},
            timeout=5,
        )
    except requests.RequestException as exc:
        raise BadRequest(f"No se pudo validar el token de Google: {exc}") from exc

    if resp.status_code != 200:
        raise BadRequest("Token de Google inválido o expirado.")

    payload = resp.json()
    aud = (payload.get('aud') or '').strip()
    issuer = (payload.get('iss') or '').strip()
    email = (payload.get('email') or '').strip().lower()
    email_verified = str(payload.get('email_verified') or '').strip().lower()
    name = (payload.get('name') or payload.get('given_name') or 'Usuario Google').strip()

    if aud != google_client_id:
        raise BadRequest("El token no corresponde al GOOGLE_CLIENT_ID configurado.")
    if issuer not in {'accounts.google.com', 'https://accounts.google.com'}:
        raise BadRequest("Issuer de Google inválido.")
    if email_verified not in {'true', '1'}:
        raise BadRequest("La cuenta de Google no está verificada.")
    if not email:
        raise BadRequest("No se pudo obtener email desde el token de Google.")

    return {"email": email, "name": name}


@main_bp.route('/auth/google', methods=['POST'])
def google_login():
    """Google login with server-side ID token verification."""
    if not current_app.config.get('ALLOW_GOOGLE_LOGIN', True):
        return jsonify({"error": "El login con Google está deshabilitado en este entorno."}), 403

    data = request.get_json() or {}
    credential = (data.get('credential') or '').strip()

    try:
        if credential:
            payload = _verify_google_credential(credential)
            email = payload["email"]
            name = payload["name"]
        elif current_app.config.get('ALLOW_INSECURE_GOOGLE_LOGIN', False):
            email = (data.get('email') or '').strip().lower()
            name = (data.get('name') or 'Usuario Google').strip()
        else:
            return jsonify({"error": "Credential de Google requerida."}), 400
    except BadRequest as exc:
        return jsonify({"error": str(exc)}), 400

    if not email:
        return jsonify({"error": "Email es requerido."}), 400

    tenant_id = current_tenant_id()
    user = User.query.filter_by(email=email).first()
    if not user:
        # crea un usuario cliente por defecto
        user = User(
          name=name or 'Usuario Google',
          email=email,
          role='client',
          tenant_id=tenant_id,
        )
        user.set_password(secrets.token_hex(8))
        from app import db

        db.session.add(user)
        db.session.commit()

    # si el usuario pertenece a otro tenant, denegar
    if tenant_id is not None and user.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    access_token = create_access_token(identity=str(user.id), additional_claims={'tenant_id': user.tenant_id})
    return jsonify({"token": access_token, "user": user.to_dict(), "provider": "google"}), 200


@main_bp.route('/auth/profile', methods=['PUT'])
@jwt_required()
def update_profile():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401

    data = request.get_json() or {}
    name = data.get('name', '').strip()
    email = data.get('email', '').strip().lower()

    if not name or not email:
        return jsonify({"error": "Nombre y correo son requeridos."}), 400

    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado."}), 404
    tenant_id = current_tenant_id()
    if tenant_id is not None and user.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    # Verificar colision de correo
    existing = User.query.filter(User.email == email, User.id != user.id).first()
    if existing:
        return jsonify({"error": "El correo ya esta en uso."}), 400

    user.name = name
    user.email = email
    # Guardar cambios
    from app import db

    db.session.add(user)
    db.session.commit()

    return jsonify({"user": user.to_dict(), "success": True}), 200


@main_bp.route('/auth/password', methods=['POST'])
@jwt_required()
def update_password():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401

    data = request.get_json() or {}
    current_password = str(data.get('current_password') or '')
    new_password = str(data.get('new_password') or '')

    if not current_password or not new_password:
        return jsonify({"error": "Contraseña actual y nueva contraseña son requeridas."}), 400

    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado."}), 404
    tenant_id = current_tenant_id()
    if tenant_id is not None and user.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    if not user.check_password(current_password):
        return jsonify({"error": "La contraseña actual es incorrecta."}), 400
    if user.check_password(new_password):
        return jsonify({"error": "La nueva contraseña debe ser diferente a la actual."}), 400

    valid_password, password_error = _validate_password_policy(new_password, user.tenant_id)
    if not valid_password:
        return jsonify({"error": password_error}), 400

    user.set_password(new_password)
    db.session.add(user)
    db.session.commit()
    return jsonify({"success": True}), 200


@main_bp.route('/auth/mfa/setup', methods=['GET'])
@jwt_required()
def mfa_setup():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado."}), 404
    secret = user.mfa_secret or pyotp.random_base32()
    issuer = "ISPFAST"
    provisioning_uri = pyotp.totp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=issuer)
    return jsonify({"secret": secret, "provisioning_uri": provisioning_uri, "issuer": issuer}), 200


@main_bp.route('/auth/mfa/enable', methods=['POST'])
@jwt_required()
def mfa_enable():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    data = request.get_json() or {}
    code = str(data.get('code') or '').strip()
    secret = str(data.get('secret') or '').strip()
    if not code or not secret:
        return jsonify({"error": "Secret y codigo son requeridos."}), 400
    totp = pyotp.TOTP(secret)
    if not totp.verify(code, valid_window=1):
        return jsonify({"error": "Codigo invalido."}), 400
    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado."}), 404
    tenant_id = current_tenant_id()
    if tenant_id is not None and user.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403
    user.mfa_secret = secret
    user.mfa_enabled = True
    from app import db
    db.session.add(user)
    db.session.commit()
    return jsonify({"success": True}), 200


@main_bp.route('/auth/mfa/disable', methods=['POST'])
@jwt_required()
def mfa_disable():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    data = request.get_json() or {}
    code = str(data.get('code') or '').strip()
    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado."}), 404
    if user.mfa_enabled:
        totp = pyotp.TOTP(user.mfa_secret)
        if not code or not totp.verify(code, valid_window=1):
            return jsonify({"error": "Codigo invalido o faltante."}), 400
    user.mfa_enabled = False
    user.mfa_secret = None
    from app import db
    db.session.add(user)
    db.session.commit()
    return jsonify({"success": True}), 200


@main_bp.route('/subscriptions', methods=['GET'])
@staff_required()
def list_subscriptions():
    tenant_id = current_tenant_id()
    query = Subscription.query
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)
    items = [s.to_dict() for s in query.order_by(Subscription.next_charge.asc()).all()]
    return jsonify({"items": items, "count": len(items)}), 200


@main_bp.route('/plans', methods=['GET'])
@staff_required()
def list_plans():
    tenant_id = current_tenant_id()
    query = Plan.query
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)
    plans = [
        {
            "id": p.id,
            "name": p.name,
            "download_speed": p.download_speed,
            "upload_speed": p.upload_speed,
            "price": p.price
        }
        for p in query.order_by(Plan.name.asc()).all()
    ]
    return jsonify({"items": plans, "count": len(plans)}), 200


@main_bp.route('/plans', methods=['POST'])
@admin_required()
def create_plan():
    data = request.get_json() or {}
    required = ['name', 'download_speed', 'upload_speed']
    missing = [k for k in required if not data.get(k)]
    if missing:
        return jsonify({"error": f"Faltan campos: {', '.join(missing)}"}), 400
    tenant_id = current_tenant_id()
    plan = Plan(
        name=data['name'],
        download_speed=int(data['download_speed']),
        upload_speed=int(data['upload_speed']),
        price=float(data.get('price') or 0),
        tenant_id=tenant_id
    )
    from app import db
    db.session.add(plan)
    db.session.commit()
    return jsonify({"plan": plan.to_dict(), "success": True}), 201


@main_bp.route('/clients', methods=['POST'])
@admin_required()
def create_client():
    data = request.get_json() or {}
    required = ['name', 'email', 'connection_type']
    missing = [k for k in required if not data.get(k)]
    if missing:
        return jsonify({"error": f"Faltan campos: {', '.join(missing)}"}), 400

    tenant_id = current_tenant_id()
    if User.query.filter_by(email=data['email']).first():
        return jsonify({"error": "El correo ya esta registrado."}), 400

    plan = _get_plan_for_request(data, tenant_id)

    # Crear usuario
    user = User(
        name=data['name'],
        email=data['email'],
        role='client',
        tenant_id=tenant_id,
    )
    password = data.get('password') or secrets.token_hex(4)
    user.set_password(password)

    connection_type = data.get('connection_type', 'dhcp')
    ppp_user = data.get('pppoe_username')
    ppp_pass = data.get('pppoe_password')
    if connection_type == 'pppoe':
        base = _slugify(data['name']) or 'cliente'
        if not ppp_user:
            ppp_user = f"{base[:12]}{secrets.randbelow(9999):04d}"
        if not ppp_pass:
            ppp_pass = secrets.token_hex(4)

    client = Client(
        full_name=data['name'],
        ip_address=data.get('ip_address'),
        mac_address=data.get('mac_address'),
        connection_type=connection_type,
        pppoe_username=ppp_user,
        pppoe_password=ppp_pass,
        latitude=data.get('latitude'),
        longitude=data.get('longitude'),
        plan=plan,
        router_id=data.get('router_id'),
        tenant_id=tenant_id,
        user=user
    )
    from app import db
    db.session.add(user)
    db.session.add(client)
    if plan and plan.id is None:
        db.session.add(plan)
    db.session.commit()

    provision_result = None
    if data.get('provision') and client.router_id and plan:
        with MikroTikService(client.router_id) as mk:
            if mk.api or mk.connect_to_router(client.router_id):
                provision_result = mk.provision_client(client, plan, data.get('config') or {})
            else:
                provision_result = {"success": False, "error": "No se pudo conectar al router."}

    payload = {"client": client.to_dict(), "user": user.to_dict(), "success": True, "password": password}
    if provision_result:
        payload["provision"] = provision_result
    return jsonify(payload), 201


@main_bp.route('/subscriptions', methods=['POST'])
@admin_required()
def create_subscription():
    data = request.get_json() or {}
    required = ['customer', 'email', 'plan', 'cycle_months', 'amount', 'next_charge', 'method']
    missing = [k for k in required if k not in data or data[k] in (None, '')]
    if missing:
        return jsonify({"error": f"Faltan campos: {', '.join(missing)}"}), 400

    tenant_id = current_tenant_id()
    subscription = Subscription(
        customer=data['customer'],
        email=data['email'],
        plan=data['plan'],
        cycle_months=int(data['cycle_months']),
        amount=float(data['amount']),
        status=data.get('status', 'active'),
        next_charge=datetime.fromisoformat(data['next_charge']).date(),
        method=data['method'],
        client_id=int(data['client_id']) if data.get('client_id') else None,
        tenant_id=tenant_id,
    )
    from app import db

    db.session.add(subscription)
    db.session.commit()
    return jsonify({"subscription": subscription.to_dict(), "success": True}), 201


@main_bp.route('/subscriptions/<int:subscription_id>', methods=['PUT', 'PATCH'])
@admin_required()
def update_subscription(subscription_id):
    data = request.get_json() or {}
    sub = db.session.get(Subscription, subscription_id)
    if not sub:
        return jsonify({"error": "Suscripcion no encontrada"}), 404
    tenant_id = current_tenant_id()
    if tenant_id is not None and sub.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403
    prev_status = sub.status
    for field in ['customer', 'email', 'plan', 'method', 'status']:
        if field in data:
            setattr(sub, field, data[field])
    if 'cycle_months' in data:
        sub.cycle_months = int(data['cycle_months'])
    if 'amount' in data:
        sub.amount = float(data['amount'])
    if 'next_charge' in data:
        sub.next_charge = datetime.fromisoformat(data['next_charge']).date()

    from app import db

    db.session.add(sub)
    db.session.commit()

    # Sincronizar estado con router si hay cliente asociado
    client = sub.client or (db.session.get(Client, sub.client_id) if sub.client_id else None)
    if client and client.router_id and sub.status != prev_status:
        with MikroTikService(client.router_id) as mk:
            if sub.status == 'active':
                mk.activate_client(client)
            elif sub.status in ('past_due', 'suspended'):
                mk.suspend_client(client, reason='billing')

    return jsonify({"subscription": sub.to_dict(), "success": True}), 200


@main_bp.route('/subscriptions/<int:subscription_id>/charge', methods=['POST'])
@admin_required()
def charge_subscription(subscription_id):
    sub = db.session.get(Subscription, subscription_id)
    if not sub:
        return jsonify({"error": "Suscripcion no encontrada"}), 404
    tenant_id = current_tenant_id()
    if tenant_id is not None and sub.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403
    sub.status = 'active'
    # avanzar proxima fecha segun ciclo
    days = sub.cycle_months * 30
    sub.next_charge = sub.next_charge + timedelta(days=days)
    from app import db

    db.session.add(sub)
    db.session.commit()
    client = sub.client or (db.session.get(Client, sub.client_id) if sub.client_id else None)
    if client and client.router_id:
        with MikroTikService(client.router_id) as mk:
            mk.activate_client(client)
    return jsonify({"subscription": sub.to_dict(), "success": True}), 200


@main_bp.route('/subscriptions/run-reminders', methods=['POST'])
@admin_required()
def run_subscription_reminders():
    today = datetime.utcnow().date()
    tenant_id = current_tenant_id()
    query = Subscription.query
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)

    updated = []
    for sub in query.all():
        days_overdue = (today - sub.next_charge).days if sub.next_charge else 0
        if sub.next_charge < today and sub.status == 'active':
            sub.status = 'past_due'
            updated.append(sub.to_dict())
        # autosuspender si lleva mas de 10 dias vencido
        if days_overdue >= 10 and sub.status == 'past_due':
            sub.status = 'suspended'
            updated.append(sub.to_dict())
            client = sub.client or (db.session.get(Client, sub.client_id) if sub.client_id else None)
            if client and client.router_id:
                with MikroTikService(client.router_id) as mk:
                    mk.suspend_client(client, reason='billing')
    if updated:
        from app import db
        db.session.commit()
    return jsonify({"updated": updated, "count": len(updated)}), 200


@main_bp.route('/subscriptions/auto-enforce', methods=['POST'])
@admin_required()
def enforce_subscription_status():
    """Suspende suscripciones vencidas y reactiva pagadas."""
    tenant_id = current_tenant_id()
    today = datetime.utcnow().date()
    query = Subscription.query
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)

    suspended = 0
    reactivated = 0
    for sub in query.all():
        days_overdue = (today - sub.next_charge).days if sub.next_charge else 0
        if sub.status == 'past_due' and days_overdue >= 10:
            sub.status = 'suspended'
            suspended += 1
        if sub.status in ('past_due', 'suspended') and days_overdue <= 0:
            sub.status = 'active'
            reactivated += 1
    from app import db
    db.session.commit()
    _audit("subscriptions_auto_enforce", entity_type="subscription", metadata={"suspended": suspended, "reactivated": reactivated})
    return jsonify({"success": True, "suspended": suspended, "reactivated": reactivated}), 200


@main_bp.route('/network/health', methods=['GET'])
@staff_required()
def network_health():
    tenant_id = current_tenant_id()
    return jsonify(_build_network_health_payload(tenant_id)), 200


@main_bp.route('/monitoring/metrics', methods=['GET'])
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


@main_bp.route('/network/alerts', methods=['GET'])
@staff_required()
def network_alerts():
    tenant_id = current_tenant_id()
    alerts = _build_network_alert_items(tenant_id)
    _audit("network_alerts", entity_type="network", metadata={"count": len(alerts)})
    return jsonify({"alerts": alerts, "count": len(alerts)}), 200


@main_bp.route('/network/noc-summary', methods=['GET'])
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


@main_bp.route('/client/portal', methods=['GET'])
@jwt_required()
def client_portal_overview():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404
    client = user.client
    if not client:
        return jsonify({"error": "No existe cliente asociado."}), 404
    tenant_id = current_tenant_id()
    if tenant_id is not None and client.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    invoices = _get_user_invoice_items(user, tenant_id)

    overview = {
        "plan": client.plan.name if client.plan else None,
        "router": client.router.name if client.router else None,
        "connection_type": client.connection_type,
        "ip_address": client.ip_address,
        "status": "active",
        "invoices": invoices,
        "support_links": {
            "open_ticket": "/client/tickets",
            "diagnostics": "/client/diagnostics/run"
        }
    }
    _audit("client_portal", entity_type="client_portal", entity_id=client.id, metadata={"invoices": len(invoices)})
    return jsonify(overview), 200


@main_bp.route('/client/invoices', methods=['GET'])
@jwt_required()
def client_invoices():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404
    tenant_id = current_tenant_id()
    invoices = _get_user_invoice_items(user, tenant_id)
    return jsonify({"items": invoices, "count": len(invoices)}), 200


@main_bp.route('/client/tickets', methods=['GET'])
@jwt_required()
def client_tickets_list():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    tenant_id = current_tenant_id()
    query = Ticket.query.filter_by(user_id=current_user_id)
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)
    tickets = query.order_by(Ticket.created_at.desc()).all()
    return jsonify({"items": [t.to_dict() for t in tickets], "count": len(tickets)}), 200


@main_bp.route('/client/tickets', methods=['POST'])
@jwt_required()
@limiter.limit("20/hour")
def client_tickets_create():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    data = request.get_json() or {}
    subject = (data.get('subject') or '').strip()
    description = (data.get('description') or '').strip()
    priority = (data.get('priority') or 'medium').strip().lower()
    if not subject or not description:
        return jsonify({"error": "Asunto y descripción requeridos."}), 400
    tenant_id = current_tenant_id()
    client = Client.query.filter_by(user_id=current_user_id).first()
    ticket = Ticket(
        tenant_id=tenant_id,
        user_id=current_user_id,
        client_id=client.id if client else None,
        subject=subject,
        description=description,
        priority=priority if priority in {'low', 'medium', 'high', 'urgent'} else 'medium',
        status='open',
        sla_due_at=datetime.utcnow() + timedelta(hours=24 if priority != 'urgent' else 4),
    )
    from app import db

    db.session.add(ticket)
    db.session.commit()
    _notify_incident(f"Nuevo ticket #{ticket.id}: {subject}", severity="warning")
    return jsonify({"ticket": ticket.to_dict(), "success": True}), 201


@main_bp.route('/client/diagnostics/run', methods=['POST'])
@jwt_required()
def client_diagnostics():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    tenant_id = current_tenant_id()

    client_query = Client.query.filter_by(user_id=current_user_id)
    if tenant_id is not None:
        client_query = client_query.filter_by(tenant_id=tenant_id)
    client = client_query.first_or_404("Cliente no encontrado.")

    ping_gateway_ms = None
    ping_internet_ms = None
    packet_loss_pct = 0.0
    connection_up = False
    router_online = bool(client.router.is_active) if client.router else True

    if client.router_id:
        with MikroTikService(client.router_id) as mikrotik:
            if mikrotik.api:
                active_connections = mikrotik.get_active_connections()
                for conn in active_connections:
                    ctype = str(conn.get('type') or '').lower()
                    addr = str(conn.get('address') or '')
                    mac = str(conn.get('mac_address') or '').lower()
                    name = str(conn.get('name') or '')

                    if client.connection_type == 'pppoe' and client.pppoe_username:
                        if ctype == 'pppoe' and name == client.pppoe_username:
                            connection_up = True
                            break
                    elif client.ip_address and addr == client.ip_address:
                        connection_up = True
                        break
                    elif client.mac_address and mac and mac == client.mac_address.lower():
                        connection_up = True
                        break

        try:
            monitoring = MonitoringService()
            tags = {'router_id': str(client.router_id)}
            latest_router = monitoring.latest_point('router_stats', tags=tags)

            if latest_router:
                for key in ('ping_gateway_ms', 'gateway_latency_ms', 'latency_ms', 'ping_ms'):
                    if latest_router.get(key) is not None:
                        ping_gateway_ms = float(latest_router.get(key))
                        break
                for key in ('ping_internet_ms', 'wan_latency_ms', 'latency_ms', 'ping_ms'):
                    if latest_router.get(key) is not None:
                        ping_internet_ms = float(latest_router.get(key))
                        break
                for key in ('packet_loss_pct', 'loss_pct'):
                    if latest_router.get(key) is not None:
                        packet_loss_pct = float(latest_router.get(key))
                        break
        except Exception as exc:
            current_app.logger.info("Client diagnostics telemetry fallback: %s", exc)

    if ping_gateway_ms is None:
        ping_gateway_ms = 8.0 if router_online else 0.0
    if ping_internet_ms is None:
        ping_internet_ms = 30.0 if router_online else 0.0

    recommendations = []
    if not router_online:
        recommendations.append("El router principal aparece fuera de linea. Verifica energia y enlace uplink.")
    if not connection_up:
        recommendations.append("No se detecta sesion activa del cliente. Reinicia CPE y valida PPPoE/DHCP.")
    if packet_loss_pct > 2:
        recommendations.append("Hay perdida de paquetes elevada. Prueba conexion por cable y revisa interferencia WiFi.")
    if ping_internet_ms > 120:
        recommendations.append("Latencia alta hacia internet. Ejecuta speedtest y abre ticket con captura de resultados.")
    if not recommendations:
        recommendations.append("Enlace estable. Si percibes cortes, abre ticket y adjunta hora exacta del incidente.")

    payload = {
        "ping_gateway_ms": round(float(ping_gateway_ms), 1),
        "ping_internet_ms": round(float(ping_internet_ms), 1),
        "packet_loss_pct": round(max(0.0, float(packet_loss_pct)), 2),
        "pppoe_session": "up" if connection_up else "down",
        "recommendations": recommendations,
    }
    return jsonify(payload), 200


@main_bp.route('/tickets', methods=['GET'])
@admin_required()
def tickets_admin_list():
    tenant_id = current_tenant_id()
    status = (request.args.get('status') or '').strip().lower()
    priority = (request.args.get('priority') or '').strip().lower()
    try:
        limit = int(request.args.get('limit', 100) or 100)
    except Exception:
        limit = 100
    limit = max(1, min(limit, 200))

    query = Ticket.query
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)
    if status:
        query = query.filter_by(status=status)
    if priority:
        query = query.filter_by(priority=priority)

    tickets = query.order_by(Ticket.created_at.desc()).limit(limit).all()
    return jsonify({"items": [t.to_dict() for t in tickets], "count": len(tickets)}), 200


@main_bp.route('/tickets/<int:ticket_id>', methods=['PATCH'])
@admin_required()
def tickets_admin_update(ticket_id):
    tenant_id = current_tenant_id()
    ticket = db.session.get(Ticket, ticket_id)
    if not ticket:
        return jsonify({"error": "Ticket no encontrado"}), 404
    if tenant_id is not None and ticket.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    data = request.get_json() or {}
    status = (data.get('status') or ticket.status).strip().lower()
    priority = (data.get('priority') or ticket.priority).strip().lower()
    assigned_to = (data.get('assigned_to') or ticket.assigned_to or '').strip() or None

    if status not in {'open', 'in_progress', 'resolved', 'closed'}:
        return jsonify({"error": "status inválido"}), 400
    if priority not in {'low', 'medium', 'high', 'urgent'}:
        return jsonify({"error": "priority inválido"}), 400

    ticket.status = status
    ticket.priority = priority
    ticket.assigned_to = assigned_to
    if 'sla_due_at' in data:
        try:
            ticket.sla_due_at = datetime.fromisoformat(data['sla_due_at'])
        except Exception:
            pass

    from app import db

    db.session.add(ticket)
    db.session.commit()
    _notify_incident(f"Ticket #{ticket.id} actualizado: status={status}, assigned={assigned_to}", severity="info")
    return jsonify({"ticket": ticket.to_dict(), "success": True}), 200


@main_bp.route('/tickets/<int:ticket_id>/comments', methods=['POST'])
@jwt_required()
def ticket_add_comment(ticket_id):
    ticket = db.session.get(Ticket, ticket_id)
    if not ticket:
        return jsonify({"error": "Ticket no encontrado"}), 404
    tenant_id = current_tenant_id()
    if tenant_id is not None and ticket.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403
    data = request.get_json() or {}
    text = (data.get('comment') or '').strip()
    if not text:
        return jsonify({"error": "El comentario es requerido."}), 400
    comment = TicketComment(ticket_id=ticket_id, user_id=_current_user_id(), comment=text)
    from app import db
    db.session.add(comment)
    db.session.commit()
    _notify_incident(f"Nuevo comentario en ticket #{ticket.id}", severity="info")
    return jsonify({"comment": comment.to_dict(), "success": True}), 201


@main_bp.route('/tickets/<int:ticket_id>/comments', methods=['GET'])
@jwt_required()
def ticket_list_comments(ticket_id):
    ticket = db.session.get(Ticket, ticket_id)
    if not ticket:
        return jsonify({"error": "Ticket no encontrado"}), 404
    tenant_id = current_tenant_id()
    if tenant_id is not None and ticket.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    current_user_id = _current_user_id()
    user = db.session.get(User, current_user_id) if current_user_id else None
    if user and user.role != 'admin' and ticket.user_id not in (None, current_user_id):
        return jsonify({"error": "No tienes permiso para ver los comentarios de este ticket."}), 403

    comments = (
        TicketComment.query
        .filter_by(ticket_id=ticket_id)
        .order_by(TicketComment.created_at.desc())
        .limit(100)
        .all()
    )
    return jsonify({"items": [c.to_dict() for c in comments], "count": len(comments)}), 200


@main_bp.route('/client/notifications/preferences', methods=['GET', 'POST'])
@jwt_required()
def client_notification_preferences():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    key = f"notif_pref_{current_user_id}"
    if request.method == 'POST':
        data = request.get_json() or {}
        defaults = {"email": True, "whatsapp": False, "push": False}
        prefs = {}
        for channel, default_value in defaults.items():
            parsed = _parse_bool(data.get(channel, default_value))
            if parsed is None:
                return jsonify({"error": f"{channel} debe ser booleano"}), 400
            prefs[channel] = parsed
        cache.set(key, prefs, timeout=86400)
        return jsonify({"success": True, "preferences": prefs}), 200
    prefs = cache.get(key) or {"email": True, "whatsapp": False, "push": False}
    return jsonify({"preferences": prefs}), 200


@main_bp.route('/ops/run-job', methods=['POST'])
@admin_required()
def run_background_job():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    job = (data.get('job') or '').strip().lower()
    if job not in SYSTEM_ALLOWED_JOBS:
        return jsonify({"error": "job debe ser backup | cleanup_leases | rotate_passwords | recalc_balances"}), 400
    payload, code = _run_system_job_request(job, tenant_id, _current_user_id())
    return jsonify(payload), code


@main_bp.route('/payments/checkout', methods=['POST'])
@limiter.limit("20/hour")
@jwt_required()
def payments_checkout():
    data = request.get_json() or {}
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"error": "Usuario no autenticado."}), 401

    amount = float(data.get('amount') or 0)
    currency = (data.get('currency') or 'USD').upper()
    method = (data.get('method') or 'stripe').lower()
    description = data.get('description') or 'Pago ISPFAST'
    invoice_id = _parse_int(data.get('invoice_id'))
    stripe_secret = current_app.config.get('STRIPE_SECRET_KEY')
    frontend_url = current_app.config.get('FRONTEND_URL') or request.headers.get('Origin') or 'http://localhost:3000'

    if method in {'stripe', 'yape', 'nequi', 'transfer'} and not invoice_id:
        return jsonify({"error": "invoice_id es requerido para este metodo de pago"}), 400

    if not invoice_id and amount <= 0:
        return jsonify({"error": "Monto inválido"}), 400

    invoice = None
    if invoice_id:
        invoice = db.session.get(Invoice, invoice_id)
        if not invoice:
            return jsonify({"error": "Factura no encontrada"}), 404
        tenant_id = current_tenant_id()
        sub_tenant = invoice.subscription.tenant_id if invoice.subscription else None
        if tenant_id is not None and sub_tenant not in (None, tenant_id):
            return jsonify({"error": "Acceso denegado para este tenant."}), 403
        if user.role != 'admin':
            user_client_id = user.client.id if user.client else None
            sub_client_id = invoice.subscription.client_id if invoice.subscription else None
            sub_email = (invoice.subscription.email if invoice.subscription else '') or ''
            if user_client_id and sub_client_id == user_client_id:
                pass
            elif sub_email.strip().lower() == (user.email or '').strip().lower():
                pass
            else:
                return jsonify({"error": "No tienes permiso para pagar esta factura"}), 403
        amount = float(invoice.total_amount)
        currency = invoice.currency

    if amount <= 0:
        return jsonify({"error": "Monto inválido"}), 400

    if method == 'stripe':
        if not stripe_secret:
            return jsonify({"error": "Stripe no configurado"}), 503

        try:
            import stripe
            stripe.api_key = stripe_secret
            session = stripe.checkout.Session.create(
                payment_method_types=["card"],
                line_items=[
                    {
                        "price_data": {
                            "currency": currency.lower(),
                            "unit_amount": int(amount * 100),
                            "product_data": {"name": description},
                        },
                        "quantity": 1,
                    }
                ],
                mode="payment",
                success_url=f"{frontend_url}/pagos/exito?session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{frontend_url}/pagos/cancelado",
                metadata={"invoice_id": invoice_id or "", "tenant_id": current_tenant_id() or "public"},
            )
            pay_rec = PaymentRecord(invoice_id=invoice_id, method='stripe', amount=amount, currency=currency, status='pending', reference=session.id)
            db.session.add(pay_rec)
            db.session.commit()
            return jsonify({"success": True, "session_id": session.id, "payment_url": session.url}), 200
        except Exception as exc:
            current_app.logger.error("Stripe checkout error: %s", exc, exc_info=True)
            return jsonify({"error": "No se pudo iniciar el checkout con Stripe"}), 502

    if method in {'yape', 'nequi', 'transfer'}:
        pay_rec = PaymentRecord(
            invoice_id=invoice_id,
            method=method,
            amount=amount,
            currency=currency,
            status='pending',
            reference=data.get('reference'),
            meta={"note": "Pago por transferencia registrado, pendiente de conciliacion."},
        )
        db.session.add(pay_rec)
        db.session.commit()
        return jsonify({"success": True, "mode": method, "message": "Pago registrado, pendiente de confirmación."}), 201

    return jsonify({"error": "Método de pago no soportado"}), 400

@main_bp.route('/payments/webhook', methods=['POST'])
def payments_webhook():
    webhook_secret = (current_app.config.get('STRIPE_WEBHOOK_SECRET') or '').strip()
    if not webhook_secret:
        return jsonify({"success": False, "error": "Stripe webhook secret no configurado"}), 503

    payload = request.get_data(cache=False, as_text=False) or b""
    signature_header = request.headers.get('Stripe-Signature', '')
    if not _verify_stripe_signature(payload, signature_header, webhook_secret):
        return jsonify({"success": False, "error": "Firma de webhook invalida"}), 400

    try:
        event = json.loads(payload.decode('utf-8'))
    except Exception:
        return jsonify({"success": False, "error": "Payload JSON invalido"}), 400
    if not isinstance(event, dict):
        return jsonify({"success": False, "error": "Evento de webhook invalido"}), 400

    ctx = _extract_webhook_payment_context(event)
    status = ctx.get("normalized_status")
    invoice_id = ctx.get("invoice_id")
    sub_id = ctx.get("subscription_id")
    candidate_refs = ctx.get("candidate_references") or []

    if status in {'paid', 'succeeded'} and sub_id:
        sub = db.session.get(Subscription, sub_id)
        if sub:
            sub.status = 'active'
            sub.next_charge = (sub.next_charge or datetime.utcnow().date()) + timedelta(days=sub.cycle_months * 30)
            db.session.add(sub)

    invoice = db.session.get(Invoice, invoice_id) if invoice_id else None
    payment = None
    if candidate_refs:
        payment = (
            PaymentRecord.query
            .filter(
                PaymentRecord.method == 'stripe',
                PaymentRecord.reference.in_(candidate_refs),
            )
            .order_by(PaymentRecord.created_at.desc())
            .first()
        )

    reference = (
        ctx.get("payment_intent")
        or ctx.get("session_id")
        or ctx.get("event_id")
    )

    if invoice and status in {'paid', 'succeeded'}:
        invoice.status = 'paid'
        db.session.add(invoice)

        if payment:
            if payment.status != 'paid':
                payment.status = 'paid'
            if reference and payment.reference != reference:
                payment.reference = reference
            if payment.invoice_id != invoice.id:
                payment.invoice_id = invoice.id
            db.session.add(payment)
        else:
            payment = PaymentRecord(
                invoice_id=invoice.id,
                method='stripe',
                amount=invoice.total_amount,
                currency=invoice.currency,
                status='paid',
                reference=reference,
                meta={
                    "event_id": ctx.get("event_id"),
                    "event_type": ctx.get("event_type"),
                    "source": "webhook",
                },
            )
            db.session.add(payment)

    db.session.commit()
    return jsonify(
        {
            "success": True,
            "event_type": ctx.get("event_type"),
            "invoice_found": bool(invoice),
            "payment_record_id": payment.id if payment else None,
        }
    ), 200


@main_bp.route('/billing/electronic/send', methods=['POST'])
@admin_required()
def billing_electronic_send():
    data = request.get_json() or {}
    invoice_id = data.get('invoice_id')
    if not invoice_id:
        return jsonify({"error": "invoice_id es requerido."}), 400

    invoice = db.session.get(Invoice, invoice_id)
    if not invoice:
        return jsonify({"error": "Factura no encontrada."}), 404

    tenant_id = current_tenant_id()
    sub_tenant = invoice.subscription.tenant_id if invoice.subscription else None
    if tenant_id is not None and sub_tenant not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    country = (data.get('country') or 'PE').upper()
    if country not in {'PE', 'CO', 'MX', 'CL'}:
        return jsonify({"error": "Pais no soportado para facturacion electronica."}), 400

    invoice.country = country
    db.session.add(invoice)
    db.session.commit()

    status = "accepted" if invoice.status == "paid" else ("rejected" if invoice.status == "cancelled" else "processing")
    response = {
        "invoice_id": invoice.id,
        "country": country,
        "status": status,
        "message": "Factura electronica aceptada" if status == "accepted" else (
            "Factura electronica en proceso" if status == "processing" else "Factura electronica rechazada"
        ),
    }
    return jsonify(response), 200


@main_bp.route('/billing/electronic/status', methods=['GET'])
@staff_required()
def billing_electronic_status():
    invoice_id = request.args.get('invoice_id')
    if not invoice_id:
        return jsonify({"error": "invoice_id es requerido."}), 400

    invoice = db.session.get(Invoice, invoice_id)
    if not invoice:
        return jsonify({"error": "Factura no encontrada."}), 404

    tenant_id = current_tenant_id()
    sub_tenant = invoice.subscription.tenant_id if invoice.subscription else None
    if tenant_id is not None and sub_tenant not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    status = "accepted" if invoice.status == "paid" else ("rejected" if invoice.status == "cancelled" else "processing")
    return jsonify(
        {
            "invoice_id": invoice.id,
            "country": invoice.country or (invoice.subscription.country if invoice.subscription else None),
            "status": status,
            "message": "Factura electronica aceptada" if status == "accepted" else (
                "Factura electronica en proceso" if status == "processing" else "Factura electronica rechazada"
            ),
        }
    ), 200


@main_bp.route('/runbooks', methods=['GET'])
@staff_required()
def runbooks():
    books = [
        {"id": "RB-001", "title": "Cliente sin navegacion", "steps": ["Ping gateway", "Reiniciar CPE", "Verificar colas", "Abrir ticket si persiste"]},
        {"id": "RB-002", "title": "Alto uso de CPU en RouterOS", "steps": ["Export stats", "Revisar firewall rules", "Limitar conexiones", "Programar mantenimiento"]},
    ]
    return jsonify({"items": books, "count": len(books)}), 200


@main_bp.route('/prometheus/metrics', methods=['GET'])
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


@main_bp.route('/dashboard/stats', methods=['GET'])
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


@main_bp.route('/clients/map-data', methods=['GET'])
@staff_required()
def get_clients_for_map():
    mikrotik = MikroTikService()
    client_data = mikrotik.get_all_clients_with_location()
    return jsonify(client_data), 200


@main_bp.route('/clients/<int:client_id>/reboot-cpe', methods=['POST'])
@jwt_required()
def reboot_client_cpe(client_id):
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"error": "Usuario no autenticado."}), 401

    client = db.session.get(Client, client_id)
    if not client:
        return jsonify({"error": "Cliente no encontrado"}), 404
    if not tenant_access_allowed(client.tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    if user.role != 'admin' and client.user_id != current_user_id:
        return jsonify({"error": "No tienes permiso para reiniciar este equipo."}), 403

    if not client.router_id:
        return jsonify({"error": "El cliente no tiene un router asociado."}), 400

    with MikroTikService(client.router_id) as mikrotik:
        success, message = mikrotik.reboot_client_cpe(client)
        if success:
            return jsonify({"success": True, "message": message}), 200
        return jsonify({"error": message}), 400


@main_bp.route('/clients/<int:client_id>/history', methods=['GET'])
@admin_required()
def get_client_history(client_id):
    with MikroTikService() as mikrotik:
        history = mikrotik.get_client_event_history(client_id)
        return jsonify(sorted(history, key=lambda x: x['timestamp'], reverse=True)), 200


@main_bp.route('/clients/usage-history', methods=['GET'])
@jwt_required()
def get_usage_history():
    current_user_id = _current_user_id()
    if current_user_id is None:
        return jsonify({"error": "Token de usuario invalido."}), 401
    tenant_id = current_tenant_id()

    query = Client.query.filter_by(user_id=current_user_id)
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)
    query.first_or_404("Cliente no encontrado.")

    range_str = request.args.get('range', '30d')
    days = 30
    if range_str == '7d':
        days = 7
    elif range_str == '90d':
        days = 90

    today = datetime.utcnow().date()
    labels = [(today - timedelta(days=i)).strftime('%b %d') for i in range(days - 1, -1, -1)]

    data_points = [0.0] * days
    try:
        client = query.first()
        tags = {}
        if client and client.router_id:
            tags['router_id'] = str(client.router_id)
        monitoring = MonitoringService()
        series = monitoring.query_metrics('interface_traffic', time_range=f'-{days}d', tags=tags or None)
        # Aggregate bytes to GB per day if available
        for point in series:
            ts = point.get('_time') or point.get('time')
            rx = float(point.get('rx_bytes', 0) or 0)
            tx = float(point.get('tx_bytes', 0) or 0)
            total_gb = (rx + tx) / (1024**3)
            parsed_ts = _parse_iso_datetime(ts)
            if parsed_ts:
                day_idx = (today - parsed_ts.date()).days
                if 0 <= day_idx < days:
                    data_points[days - 1 - day_idx] += total_gb
    except Exception as exc:
        current_app.logger.info("Uso histórico usando fallback: %s", exc)
        data_points = [0.0] * days

    usage_data = {
        "labels": labels,
        "datasets": [
            {
                "label": "Uso de Datos (GB)",
                "data": [round(v, 2) for v in data_points],
                "borderColor": 'rgb(54, 162, 235)',
                "backgroundColor": 'rgba(54, 162, 235, 0.2)',
                "fill": True,
            }
        ],
    }
    return jsonify(usage_data), 200


@main_bp.route('/admin/routers/usage', methods=['GET'])
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

    result = list(router_map.values())
    return jsonify({"items": result, "count": len(result)}), 200


@main_bp.route('/admin/clients', methods=['GET'])
@admin_required()
def admin_list_clients():
    tenant_id = current_tenant_id()
    term = (request.args.get('q') or '').strip()
    status_filter = (request.args.get('status') or '').strip().lower() or None
    plan_id_raw = request.args.get('plan_id')
    plan_id = _parse_int(plan_id_raw) if plan_id_raw is not None else None
    if plan_id_raw is not None and plan_id is None:
        return jsonify({"error": "plan_id invalido"}), 400
    clients = _collect_admin_clients(tenant_id, term=term, status_filter=status_filter, plan_id=plan_id)
    return jsonify({"items": clients, "count": len(clients)}), 200


def _client_status(client: Client) -> str:
    subs = client.subscriptions or []
    return str(subs[0].status if subs else 'active')


def _serialize_admin_client(client: Client) -> dict:
    return {
        "id": client.id,
        "name": client.full_name,
        "ip_address": client.ip_address,
        "plan": client.plan.name if client.plan else None,
        "plan_id": client.plan_id,
        "router_id": client.router_id,
        "router_name": client.router.name if client.router else None,
        "status": _client_status(client),
        "email": client.user.email if client.user else None,
        "portal_access": bool(client.user_id),
        "connection_type": client.connection_type,
        "pppoe_username": client.pppoe_username,
    }


def _collect_admin_clients(tenant_id, term: str | None = None, status_filter: str | None = None, plan_id: int | None = None) -> list[dict]:
    query = Client.query.options(
        joinedload(Client.plan),
        joinedload(Client.user),
        joinedload(Client.router),
        joinedload(Client.subscriptions),
    )
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)
    if plan_id is not None:
        query = query.filter_by(plan_id=plan_id)

    normalized_term = str(term or '').strip().lower()
    normalized_status = str(status_filter or '').strip().lower()
    items: list[dict] = []
    for row in query.order_by(Client.id.asc()).all():
        payload = _serialize_admin_client(row)
        if normalized_status and payload["status"] != normalized_status:
            continue
        if normalized_term:
            haystack = [
                str(payload.get("id") or "").lower(),
                str(payload.get("name") or "").lower(),
                str(payload.get("ip_address") or "").lower(),
                str(payload.get("email") or "").lower(),
                str(payload.get("plan") or "").lower(),
            ]
            if not any(normalized_term in candidate for candidate in haystack):
                continue
        items.append(payload)
    return items


@main_bp.route('/admin/clients/export', methods=['GET'])
@admin_required()
def admin_export_clients():
    tenant_id = current_tenant_id()
    term = (request.args.get('q') or '').strip()
    status_filter = (request.args.get('status') or '').strip().lower() or None
    plan_id_raw = request.args.get('plan_id')
    plan_id = _parse_int(plan_id_raw) if plan_id_raw is not None else None
    if plan_id_raw is not None and plan_id is None:
        return jsonify({"error": "plan_id invalido"}), 400

    export_format = (request.args.get('format') or 'csv').strip().lower()
    items = _collect_admin_clients(tenant_id, term=term, status_filter=status_filter, plan_id=plan_id)
    if export_format == 'json':
        return jsonify({"items": items, "count": len(items)}), 200
    if export_format != 'csv':
        return jsonify({"error": "format invalido"}), 400

    columns = [
        "id",
        "name",
        "email",
        "status",
        "plan",
        "plan_id",
        "router_id",
        "router_name",
        "ip_address",
        "connection_type",
        "portal_access",
        "pppoe_username",
    ]
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=columns)
    writer.writeheader()
    for item in items:
        writer.writerow({column: item.get(column) for column in columns})

    _audit(
        "clients_export",
        entity_type="client",
        metadata={
            "format": export_format,
            "count": len(items),
            "status_filter": status_filter,
            "plan_id": plan_id,
        },
    )
    timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
    response = Response(stream.getvalue(), mimetype='text/csv; charset=utf-8')
    response.headers['Content-Disposition'] = f'attachment; filename=clients-{timestamp}.csv'
    return response, 200


@main_bp.route('/admin/clients', methods=['POST'])
@admin_required()
def admin_create_client():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    ip = (data.get('ip_address') or '').strip() or None
    connection_type = (data.get('connection_type') or 'pppoe').strip().lower()
    plan_id = data.get('plan_id')
    router_id = data.get('router_id')
    email = (data.get('email') or '').strip().lower()
    requested_password = str(data.get('password') or '').strip()
    create_portal_access = _parse_bool(data.get('create_portal_access'))
    if create_portal_access is None:
        create_portal_access = bool(email)
    if not name:
        return jsonify({"error": "name es requerido"}), 400
    if connection_type not in {'pppoe', 'dhcp', 'static'}:
        return jsonify({"error": "connection_type invalido"}), 400
    if not plan_id:
        return jsonify({"error": "plan_id es requerido"}), 400
    plan = db.session.get(Plan, plan_id)
    if not plan:
        return jsonify({"error": "Plan no encontrado"}), 404
    router = db.session.get(MikroTikRouter, router_id) if router_id else None
    tenant_id = current_tenant_id()
    if tenant_id:
        if router and router.tenant_id not in (None, tenant_id):
            return jsonify({"error": "Router fuera del tenant"}), 403
        if plan.tenant_id not in (None, tenant_id):
            return jsonify({"error": "Plan fuera del tenant"}), 403

    user = None
    generated_password = None
    if create_portal_access:
        if not email:
            return jsonify({"error": "email es requerido cuando create_portal_access=true"}), 400
        if User.query.filter_by(email=email).first():
            return jsonify({"error": "email ya existe"}), 409
        generated_password = requested_password or _generate_router_password()
        user = User(
            name=name,
            email=email,
            role='client',
            tenant_id=tenant_id,
        )
        user.set_password(generated_password)
        db.session.add(user)

    pppoe_username = (data.get('pppoe_username') or '').strip() or None
    pppoe_password = (data.get('pppoe_password') or '').strip() or None
    if connection_type == 'pppoe':
        base = _slugify(name) or 'cliente'
        if not pppoe_username:
            pppoe_username = f"{base[:12]}{secrets.randbelow(9999):04d}"
        if not pppoe_password:
            pppoe_password = secrets.token_hex(4)

    def _s(key, maxlen=None):
        v = str(data.get(key) or '').strip() or None
        if v and maxlen:
            v = v[:maxlen]
        return v

    def _b(key, default=True):
        raw = data.get(key)
        if raw is None:
            return default
        return str(raw).lower() in ('1', 'true', 'yes', 'si', 'on')

    def _i(key, default=None):
        try:
            return int(data[key])
        except (KeyError, TypeError, ValueError):
            return default

    def _f(key, default=0.0):
        try:
            return float(data[key])
        except (KeyError, TypeError, ValueError):
            return default

    # Coordinates from "lat,lng" string or separate fields
    lat = _f('latitude') or None
    lng = _f('longitude') or None
    coords_str = _s('coordinates')
    if coords_str and not lat:
        try:
            parts = coords_str.split(',')
            lat, lng = float(parts[0].strip()), float(parts[1].strip())
        except Exception:
            pass

    client = Client(
        full_name=name,
        ip_address=ip,
        mac_address=_s('mac_address', 17),
        connection_type=connection_type,
        plan_id=plan.id,
        router_id=router.id if router else None,
        tenant_id=tenant_id,
        pppoe_username=pppoe_username,
        pppoe_password=pppoe_password,
        user=user,
        latitude=lat,
        longitude=lng,
        # Datos de Conexión
        remote_address_pppoe=_s('remote_address_pppoe', 45),
        local_address_pppoe=_s('local_address_pppoe', 45),
        sectorial_nap=_s('sectorial_nap', 80),
        # Datos del Cliente
        apellido=_s('apellido', 80),
        dni=_s('dni', 40),
        phone=_s('phone', 30),
        address=_s('address'),
        barrio=_s('barrio', 80),
        ciudad=_s('ciudad', 80),
        codigo_postal=_s('codigo_postal', 20),
        forma_contratacion=_s('forma_contratacion', 30),
        external_id=_s('external_id', 80),
        # Facturación
        tipo_cliente=_s('tipo_cliente', 20) or 'prepago',
        dia_corte=_i('dia_corte', 8),
        dia_factura=_i('dia_factura', 1),
        dia_pago=_i('dia_pago', 3),
        impuestos=_f('impuestos', 0.0),
        avisos_pantalla=_b('avisos_pantalla', True),
        notificaciones_push=_b('notificaciones_push', True),
        suspender_facturas=_i('suspender_facturas', 1),
        corte_automatico=_b('corte_automatico', True),
        facturas_automaticas=_b('facturas_automaticas', True),
        correo_corte=_b('correo_corte', True),
        correo_facturas=_b('correo_facturas', True),
        # Configuración Avanzada
        firewall_enabled=_b('firewall_enabled', True),
        sistema_id=_s('sistema_id', 80),
        modelo_antena=_s('modelo_antena', 80),
        password_antena=_s('password_antena', 80),
        protocolo_conexion=_s('protocolo_conexion', 40),
        ip_router_wifi=_s('ip_router_wifi', 45),
        modelo_router_wifi=_s('modelo_router_wifi', 80),
        usuario_router_wifi=_s('usuario_router_wifi', 80),
        password_router_wifi=_s('password_router_wifi', 80),
        ssid_router_wifi=_s('ssid_router_wifi', 80),
        password_ssid_wifi=_s('password_ssid_wifi', 80),
        mac_router_wifi=_s('mac_router_wifi', 17),
        comentarios=_s('comentarios'),
        razon_social=_s('razon_social', 120),
        ruc_nit=_s('ruc_nit', 40),
    )
    db.session.add(client)
    db.session.commit()
    payload = {"client": client.to_dict()}
    if user:
        payload["user"] = user.to_dict()
        payload["password"] = generated_password
    return jsonify(payload), 201


def _resolve_plan_reference(plan_id_raw, plan_name_raw, tenant_id) -> tuple[Plan | None, str | None]:
    plan_id = _parse_int(plan_id_raw)
    plan_name = str(plan_name_raw or '').strip()
    plan = db.session.get(Plan, plan_id) if plan_id else None

    if plan is None and plan_name:
        candidates = Plan.query.all()
        lower_name = plan_name.lower()
        for candidate in candidates:
            if str(candidate.name or '').strip().lower() != lower_name:
                continue
            if tenant_id is None or candidate.tenant_id in (None, tenant_id):
                plan = candidate
                break

    if plan is None:
        return None, "Plan no encontrado"
    if tenant_id is not None and plan.tenant_id not in (None, tenant_id):
        return None, "Plan fuera del tenant"
    return plan, None


def _resolve_router_reference(router_id_raw, router_name_raw, tenant_id) -> tuple[MikroTikRouter | None, str | None]:
    router_id = _parse_int(router_id_raw)
    router_name = str(router_name_raw or '').strip()
    router = db.session.get(MikroTikRouter, router_id) if router_id else None

    if router is None and router_name:
        candidates = MikroTikRouter.query.all()
        lower_name = router_name.lower()
        for candidate in candidates:
            if str(candidate.name or '').strip().lower() != lower_name:
                continue
            if tenant_id is None or candidate.tenant_id in (None, tenant_id):
                router = candidate
                break

    if router is None:
        return None, None
    if tenant_id is not None and router.tenant_id not in (None, tenant_id):
        return None, "Router fuera del tenant"
    return router, None


def _normalize_bulk_client_row(raw_row, tenant_id, seen_emails: set[str]) -> tuple[dict | None, str | None]:
    if not isinstance(raw_row, dict):
        return None, "Fila invalida (debe ser objeto)"

    name = str(raw_row.get('name') or raw_row.get('full_name') or '').strip()
    if not name:
        return None, "name es requerido"

    connection_type = str(raw_row.get('connection_type') or 'pppoe').strip().lower()
    if connection_type not in {'pppoe', 'dhcp', 'static'}:
        return None, "connection_type invalido"

    plan, plan_error = _resolve_plan_reference(
        raw_row.get('plan_id'),
        raw_row.get('plan_name') or raw_row.get('plan'),
        tenant_id,
    )
    if plan_error:
        return None, plan_error
    if plan is None:
        return None, "Plan no encontrado"

    router, router_error = _resolve_router_reference(
        raw_row.get('router_id'),
        raw_row.get('router_name'),
        tenant_id,
    )
    if router_error:
        return None, router_error

    email = str(raw_row.get('email') or '').strip().lower()
    requested_password = str(raw_row.get('password') or '').strip()
    create_portal_access = _parse_bool(raw_row.get('create_portal_access'))
    if create_portal_access is None:
        create_portal_access = bool(email)

    if create_portal_access:
        if not email:
            return None, "email es requerido cuando create_portal_access=true"
        if email in seen_emails:
            return None, "email duplicado en el lote"
        if User.query.filter_by(email=email).first():
            return None, "email ya existe"
        seen_emails.add(email)

    ip = str(raw_row.get('ip_address') or '').strip() or None
    pppoe_username = str(raw_row.get('pppoe_username') or '').strip() or None
    pppoe_password = str(raw_row.get('pppoe_password') or '').strip() or None
    if connection_type == 'pppoe':
        base = _slugify(name) or 'cliente'
        if not pppoe_username:
            pppoe_username = f"{base[:12]}{secrets.randbelow(9999):04d}"
        if not pppoe_password:
            pppoe_password = secrets.token_hex(4)

    return (
        {
            "name": name,
            "connection_type": connection_type,
            "ip_address": ip,
            "plan": plan,
            "router": router,
            "email": email,
            "create_portal_access": create_portal_access,
            "requested_password": requested_password,
            "pppoe_username": pppoe_username,
            "pppoe_password": pppoe_password,
        },
        None,
    )


def _create_client_from_payload(payload: dict, tenant_id) -> tuple[Client, User | None, str | None]:
    user = None
    generated_password = None

    if payload["create_portal_access"]:
        generated_password = payload["requested_password"] or _generate_router_password()
        user = User(
            name=payload["name"],
            email=payload["email"],
            role='client',
            tenant_id=tenant_id,
        )
        user.set_password(generated_password)
        db.session.add(user)

    router = payload.get("router")
    client = Client(
        full_name=payload["name"],
        ip_address=payload["ip_address"],
        connection_type=payload["connection_type"],
        plan_id=payload["plan"].id,
        router_id=router.id if router else None,
        tenant_id=tenant_id,
        pppoe_username=payload["pppoe_username"],
        pppoe_password=payload["pppoe_password"],
        user=user,
    )
    db.session.add(client)
    db.session.commit()
    return client, user, generated_password


def _resolve_bulk_update_client(raw_row, tenant_id) -> tuple[Client | None, str | None]:
    client_id = _parse_int(raw_row.get('client_id'))
    client = db.session.get(Client, client_id) if client_id else None
    if client is None:
        lookup_email = str(raw_row.get('client_email') or raw_row.get('email_lookup') or '').strip().lower()
        if lookup_email:
            user = User.query.filter_by(email=lookup_email).first()
            client = user.client if user and user.client else None
    if client is None:
        return None, "cliente no encontrado (use client_id o client_email)"
    if tenant_id is not None and client.tenant_id not in (None, tenant_id):
        return None, "Cliente fuera del tenant"
    return client, None


def _normalize_bulk_update_row(raw_row, tenant_id, seen_target_emails: set[str]) -> tuple[dict | None, str | None]:
    if not isinstance(raw_row, dict):
        return None, "Fila invalida (debe ser objeto)"

    client, client_error = _resolve_bulk_update_client(raw_row, tenant_id)
    if client_error:
        return None, client_error
    if client is None:
        return None, "cliente no encontrado"

    plan = None
    plan_input_present = bool(raw_row.get('plan_id') or str(raw_row.get('plan_name') or raw_row.get('plan') or '').strip())
    if plan_input_present:
        plan, plan_error = _resolve_plan_reference(
            raw_row.get('plan_id'),
            raw_row.get('plan_name') or raw_row.get('plan'),
            tenant_id,
        )
        if plan_error:
            return None, plan_error

    router = None
    router_input_present = bool(raw_row.get('router_id') or str(raw_row.get('router_name') or '').strip())
    if router_input_present:
        router, router_error = _resolve_router_reference(
            raw_row.get('router_id'),
            raw_row.get('router_name'),
            tenant_id,
        )
        if router_error:
            return None, router_error

    connection_type = None
    if 'connection_type' in raw_row:
        connection_type = str(raw_row.get('connection_type') or '').strip().lower()
        if connection_type and connection_type not in {'pppoe', 'dhcp', 'static'}:
            return None, "connection_type invalido"
        if not connection_type:
            connection_type = None

    ip_address_present = 'ip_address' in raw_row
    ip_address = str(raw_row.get('ip_address') or '').strip() if ip_address_present else None
    ip_address = ip_address or None

    portal_email = str(raw_row.get('portal_email') or raw_row.get('email') or '').strip().lower()
    portal_password = str(raw_row.get('portal_password') or raw_row.get('password') or '').strip()
    parsed_create_portal = _parse_bool(raw_row.get('create_portal_access'))
    reset_portal_password = _parse_bool(raw_row.get('reset_portal_password'))
    if reset_portal_password is None:
        reset_portal_password = bool(portal_password)

    create_portal_access = parsed_create_portal if parsed_create_portal is not None else bool(portal_email or portal_password)
    existing_user = client.user
    portal_mode = None
    if existing_user is None and create_portal_access:
        if not portal_email:
            return None, "portal_email es requerido para crear acceso portal"
        existing_email_user = User.query.filter_by(email=portal_email).first()
        if existing_email_user:
            return None, "portal_email ya existe"
        if portal_email in seen_target_emails:
            return None, "portal_email duplicado en el lote"
        seen_target_emails.add(portal_email)
        portal_mode = 'create'
    elif existing_user is not None:
        if portal_email and portal_email != existing_user.email:
            duplicate = User.query.filter(User.email == portal_email, User.id != existing_user.id).first()
            if duplicate:
                return None, "portal_email ya existe"
            if portal_email in seen_target_emails:
                return None, "portal_email duplicado en el lote"
            seen_target_emails.add(portal_email)
            portal_mode = 'update_email'
        if reset_portal_password:
            portal_mode = portal_mode or 'reset_password'
    elif existing_user is None and (portal_email or portal_password or reset_portal_password):
        return None, "cliente sin acceso portal; use create_portal_access=true"

    changes: list[str] = []
    if plan is not None and plan.id != client.plan_id:
        changes.append("plan")
    if router_input_present and (router.id if router else None) != client.router_id:
        changes.append("router")
    if connection_type is not None and connection_type != str(client.connection_type or '').strip().lower():
        changes.append("connection_type")
    if ip_address_present and ip_address != client.ip_address:
        changes.append("ip_address")
    if portal_mode == 'create':
        changes.append("portal_access")
    if portal_mode == 'update_email':
        changes.append("portal_email")
    if reset_portal_password:
        changes.append("portal_password")

    if not changes:
        return None, "fila sin cambios"

    return (
        {
            "client": client,
            "plan": plan,
            "router": router,
            "router_input_present": router_input_present,
            "connection_type": connection_type,
            "ip_address_present": ip_address_present,
            "ip_address": ip_address,
            "portal_mode": portal_mode,
            "portal_email": portal_email,
            "portal_password": portal_password,
            "reset_portal_password": bool(reset_portal_password),
            "changes": changes,
        },
        None,
    )


def _apply_bulk_update_payload(payload: dict, tenant_id) -> dict:
    client: Client = payload["client"]
    changed_fields: list[str] = []

    plan = payload.get("plan")
    if plan is not None and plan.id != client.plan_id:
        client.plan_id = plan.id
        changed_fields.append("plan")

    if payload.get("router_input_present"):
        target_router = payload.get("router")
        target_router_id = target_router.id if target_router else None
        if target_router_id != client.router_id:
            client.router_id = target_router_id
            changed_fields.append("router")

    connection_type = payload.get("connection_type")
    if connection_type is not None and connection_type != str(client.connection_type or '').strip().lower():
        client.connection_type = connection_type
        changed_fields.append("connection_type")

    if payload.get("ip_address_present"):
        target_ip = payload.get("ip_address")
        if target_ip != client.ip_address:
            client.ip_address = target_ip
            changed_fields.append("ip_address")

    generated_password = None
    user = client.user
    portal_mode = payload.get("portal_mode")
    if portal_mode == 'create':
        generated_password = payload.get("portal_password") or _generate_router_password()
        user = User(
            name=client.full_name or 'Cliente',
            email=payload.get("portal_email"),
            role='client',
            tenant_id=tenant_id if tenant_id is not None else client.tenant_id,
        )
        user.set_password(generated_password)
        client.user = user
        db.session.add(user)
        changed_fields.append("portal_access")
    elif user is not None:
        portal_email = str(payload.get("portal_email") or '').strip().lower()
        if portal_email and portal_email != user.email:
            user.email = portal_email
            changed_fields.append("portal_email")
        user.name = user.name or client.full_name or 'Cliente'
        user.role = 'client'
        if tenant_id is not None:
            user.tenant_id = tenant_id
        elif client.tenant_id is not None:
            user.tenant_id = client.tenant_id

    if user is not None and payload.get("reset_portal_password"):
        generated_password = payload.get("portal_password") or _generate_router_password()
        user.set_password(generated_password)
        changed_fields.append("portal_password")

    db.session.add(client)
    db.session.commit()
    response = {
        "client_id": client.id,
        "name": client.full_name,
        "changes": changed_fields,
    }
    if user is not None:
        response["user_id"] = user.id
        response["email"] = user.email
    if generated_password:
        response["password"] = generated_password
    return response


@main_bp.route('/admin/clients/bulk-create', methods=['POST'])
@admin_required()
def admin_bulk_create_clients():
    data = request.get_json() or {}
    rows = data.get('rows')
    if not isinstance(rows, list) or not rows:
        return jsonify({"error": "rows es requerido y debe ser una lista"}), 400
    if len(rows) > 500:
        return jsonify({"error": "maximo 500 filas por lote"}), 400

    parsed_dry_run = _parse_bool(data.get('dry_run'))
    dry_run = True if parsed_dry_run is None else parsed_dry_run
    tenant_id = current_tenant_id()

    results: list[dict] = []
    normalized_rows: list[tuple[int, dict]] = []
    seen_emails: set[str] = set()

    for index, row in enumerate(rows, start=1):
        payload, error = _normalize_bulk_client_row(row, tenant_id, seen_emails)
        if error:
            results.append({"row": index, "success": False, "error": error})
            continue
        assert payload is not None
        normalized_rows.append((index, payload))
        if dry_run:
            results.append(
                {
                    "row": index,
                    "success": True,
                    "preview": {
                        "name": payload["name"],
                        "email": payload["email"] or None,
                        "plan_id": payload["plan"].id,
                        "plan_name": payload["plan"].name,
                        "router_id": payload["router"].id if payload["router"] else None,
                        "connection_type": payload["connection_type"],
                        "portal_access": bool(payload["create_portal_access"]),
                    },
                }
            )

    if not dry_run:
        for index, payload in normalized_rows:
            try:
                created_client, created_user, password = _create_client_from_payload(payload, tenant_id)
                result_payload = {
                    "row": index,
                    "success": True,
                    "client_id": created_client.id,
                    "name": created_client.full_name,
                }
                if created_user:
                    result_payload["user_id"] = created_user.id
                    result_payload["email"] = created_user.email
                    result_payload["password"] = password
                results.append(result_payload)
            except Exception as exc:
                db.session.rollback()
                current_app.logger.error("Error en importacion de cliente fila %s: %s", index, exc, exc_info=True)
                results.append({"row": index, "success": False, "error": "No se pudo crear el cliente"})

    success_count = len([item for item in results if item.get("success") is True])
    failed_count = len(results) - success_count
    _audit(
        "clients_bulk_create",
        entity_type="client",
        metadata={
            "dry_run": dry_run,
            "requested": len(rows),
            "success": success_count,
            "failed": failed_count,
        },
    )

    return jsonify(
        {
            "success": True,
            "dry_run": dry_run,
            "requested": len(rows),
            "success_count": success_count,
            "failed_count": failed_count,
            "results": results,
        }
    ), 200


@main_bp.route('/admin/clients/bulk-update', methods=['POST'])
@admin_required()
def admin_bulk_update_clients():
    data = request.get_json() or {}
    rows = data.get('rows')
    if not isinstance(rows, list) or not rows:
        return jsonify({"error": "rows es requerido y debe ser una lista"}), 400
    if len(rows) > 500:
        return jsonify({"error": "maximo 500 filas por lote"}), 400

    parsed_dry_run = _parse_bool(data.get('dry_run'))
    dry_run = True if parsed_dry_run is None else parsed_dry_run
    tenant_id = current_tenant_id()

    results: list[dict] = []
    normalized_rows: list[tuple[int, dict]] = []
    seen_target_emails: set[str] = set()

    for index, row in enumerate(rows, start=1):
        payload, error = _normalize_bulk_update_row(row, tenant_id, seen_target_emails)
        if error:
            results.append({"row": index, "success": False, "error": error})
            continue
        assert payload is not None
        normalized_rows.append((index, payload))
        if dry_run:
            client_row: Client = payload["client"]
            preview = {
                "client_id": client_row.id,
                "name": client_row.full_name,
                "changes": payload.get("changes") or [],
            }
            if payload.get("plan") is not None:
                preview["plan_id"] = payload["plan"].id
                preview["plan_name"] = payload["plan"].name
            if payload.get("router_input_present"):
                preview["router_id"] = payload["router"].id if payload.get("router") else None
            if payload.get("portal_mode") == 'create':
                preview["portal_email"] = payload.get("portal_email")
            if payload.get("reset_portal_password"):
                preview["password"] = payload.get("portal_password") or "[auto]"
            results.append({"row": index, "success": True, "preview": preview})

    if not dry_run:
        for index, payload in normalized_rows:
            try:
                updated = _apply_bulk_update_payload(payload, tenant_id)
                results.append({"row": index, "success": True, **updated})
            except Exception as exc:
                db.session.rollback()
                current_app.logger.error("Error en actualizacion masiva de cliente fila %s: %s", index, exc, exc_info=True)
                results.append({"row": index, "success": False, "error": "No se pudo actualizar el cliente"})

    success_count = len([item for item in results if item.get("success") is True])
    failed_count = len(results) - success_count
    _audit(
        "clients_bulk_update",
        entity_type="client",
        metadata={
            "dry_run": dry_run,
            "requested": len(rows),
            "success": success_count,
            "failed": failed_count,
        },
    )

    return jsonify(
        {
            "success": True,
            "dry_run": dry_run,
            "requested": len(rows),
            "success_count": success_count,
            "failed_count": failed_count,
            "results": results,
        }
    ), 200


@main_bp.route('/admin/clients/<int:client_id>/portal-access', methods=['POST'])
@admin_required()
def admin_manage_client_portal_access(client_id):
    client = db.session.get(Client, client_id)
    if not client:
        return jsonify({"error": "Cliente no encontrado"}), 404

    tenant_id = current_tenant_id()
    if tenant_id is not None and client.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Cliente fuera del tenant"}), 403

    data = request.get_json() or {}
    email = str(data.get('email') or '').strip().lower()
    requested_password = str(data.get('password') or '').strip()

    user = client.user
    created = False
    if user is None:
        if not email:
            return jsonify({"error": "email es requerido para crear acceso al portal"}), 400
        if User.query.filter_by(email=email).first():
            return jsonify({"error": "email ya existe"}), 409
        user = User(
            name=client.full_name or 'Cliente',
            email=email,
            role='client',
            tenant_id=tenant_id if tenant_id is not None else client.tenant_id,
        )
        client.user = user
        db.session.add(user)
        created = True
    else:
        if email and email != user.email:
            duplicate = User.query.filter(User.email == email, User.id != user.id).first()
            if duplicate:
                return jsonify({"error": "email ya existe"}), 409
            user.email = email
        user.name = user.name or client.full_name or 'Cliente'
        user.role = 'client'
        if tenant_id is not None:
            user.tenant_id = tenant_id
        elif client.tenant_id is not None:
            user.tenant_id = client.tenant_id

    generated_password = requested_password or secrets.token_urlsafe(12)
    user.set_password(generated_password)

    db.session.add(client)
    db.session.commit()

    payload = {
        "success": True,
        "created": created,
        "client_id": client.id,
        "user": user.to_dict(),
        "password": generated_password,
    }
    return jsonify(payload), 201 if created else 200


def _apply_network_action_to_client(client: Client, action: str) -> tuple[bool, str | None]:
    action_name = str(action or '').strip().lower()
    if action_name not in {'suspend', 'activate'}:
        return False, "accion invalida"
    if not client.router_id:
        return False, "Cliente sin router asociado"

    plan = client.plan or (db.session.get(Plan, client.plan_id) if client.plan_id else None)
    try:
        with MikroTikService(client.router_id) as mikrotik:
            if action_name == 'suspend':
                ok = mikrotik.suspend_client(client)
            else:
                ok = mikrotik.activate_client(client, plan)
    except Exception as exc:
        current_app.logger.error("Error aplicando accion %s en cliente %s: %s", action_name, client.id, exc, exc_info=True)
        return False, "Error conectando con MikroTik"

    if not ok:
        return False, f"No se pudo {action_name} en MikroTik"

    if client.subscriptions:
        client.subscriptions[0].status = 'suspended' if action_name == 'suspend' else 'active'
    if action_name == 'suspend':
        _notify_incident(f"Suspendido cliente {client.full_name}", severity="warning")
        _notify_client(client, "Aviso de suspensión", "Tu servicio ha sido suspendido por pago pendiente. Regulariza para reactivarlo.")
    else:
        _notify_incident(f"Reactivado cliente {client.full_name}", severity="info")
        _notify_client(client, "Servicio reactivado", "Tu servicio ha sido reactivado. Gracias por ponerte al día.")
    return True, None


@main_bp.route('/admin/clients/bulk-action', methods=['POST'])
@admin_required()
def admin_bulk_client_action():
    data = request.get_json() or {}
    action = str(data.get('action') or '').strip().lower()
    if action not in {'suspend', 'activate'}:
        return jsonify({"error": "action invalida. Use suspend o activate"}), 400

    raw_client_ids = data.get('client_ids')
    if not isinstance(raw_client_ids, list) or not raw_client_ids:
        return jsonify({"error": "client_ids es requerido y debe ser una lista"}), 400

    unique_ids: list[int] = []
    for raw in raw_client_ids:
        parsed = _parse_int(raw)
        if parsed is None:
            continue
        if parsed not in unique_ids:
            unique_ids.append(parsed)
    if not unique_ids:
        return jsonify({"error": "client_ids no contiene IDs validos"}), 400
    if len(unique_ids) > 200:
        return jsonify({"error": "maximo 200 clientes por lote"}), 400

    tenant_id = current_tenant_id()
    results: list[dict] = []
    success_count = 0

    for client_id in unique_ids:
        client = db.session.get(Client, client_id)
        if not client:
            results.append({"client_id": client_id, "success": False, "error": "Cliente no encontrado"})
            continue
        if tenant_id is not None and client.tenant_id not in (None, tenant_id):
            results.append({"client_id": client_id, "success": False, "error": "Cliente fuera del tenant"})
            continue

        ok, error = _apply_network_action_to_client(client, action)
        if not ok:
            db.session.rollback()
            results.append({"client_id": client_id, "success": False, "error": error})
            continue

        try:
            db.session.commit()
            success_count += 1
            results.append({"client_id": client_id, "success": True})
        except Exception as exc:
            db.session.rollback()
            current_app.logger.error("Error guardando accion masiva de cliente %s: %s", client_id, exc, exc_info=True)
            results.append({"client_id": client_id, "success": False, "error": "No se pudo guardar el cambio"})

    _audit(
        "clients_bulk_action",
        entity_type="client",
        metadata={
            "action": action,
            "requested": len(unique_ids),
            "success": success_count,
            "failed": len(unique_ids) - success_count,
        },
    )
    return jsonify(
        {
            "success": True,
            "action": action,
            "requested": len(unique_ids),
            "success_count": success_count,
            "failed_count": len(unique_ids) - success_count,
            "results": results,
        }
    ), 200


# ==================== RED: SUSPENDER / ACTIVAR / CAMBIAR VELOCIDAD ====================

@main_bp.route('/admin/clients/<int:client_id>/suspend', methods=['POST'])
@admin_required()
def suspend_client(client_id):
    client = db.session.get(Client, client_id)
    if not client:
        return jsonify({"error": "Cliente no encontrado"}), 404
    tenant_id = current_tenant_id()
    if tenant_id and client.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Cliente fuera del tenant"}), 403
    ok, error = _apply_network_action_to_client(client, 'suspend')
    if not ok:
        db.session.rollback()
        if error == "Cliente sin router asociado":
            return jsonify({"error": error}), 400
        return jsonify({"error": error or "No se pudo suspender en MikroTik"}), 500
    db.session.commit()
    return jsonify({"success": True}), 200


@main_bp.route('/admin/clients/<int:client_id>/activate', methods=['POST'])
@admin_required()
def activate_client(client_id):
    client = db.session.get(Client, client_id)
    if not client:
        return jsonify({"error": "Cliente no encontrado"}), 404
    tenant_id = current_tenant_id()
    if tenant_id and client.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Cliente fuera del tenant"}), 403
    ok, error = _apply_network_action_to_client(client, 'activate')
    if not ok:
        db.session.rollback()
        if error == "Cliente sin router asociado":
            return jsonify({"error": error}), 400
        return jsonify({"error": error or "No se pudo activar en MikroTik"}), 500
    db.session.commit()
    return jsonify({"success": True}), 200


@main_bp.route('/admin/clients/<int:client_id>/speed', methods=['POST'])
@admin_required()
def change_client_speed(client_id):
    data = request.get_json() or {}
    plan_id = data.get('plan_id')
    if not plan_id:
        raise BadRequest("plan_id es requerido")
    client = db.session.get(Client, client_id)
    if not client:
        return jsonify({"error": "Cliente no encontrado"}), 404
    tenant_id = current_tenant_id()
    if tenant_id and client.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Cliente fuera del tenant"}), 403
    plan = db.session.get(Plan, plan_id)
    if not plan:
        return jsonify({"error": "Plan no encontrado"}), 404
    if not client.router_id:
        return jsonify({"error": "Cliente sin router asociado"}), 400
    with MikroTikService(client.router_id) as mikrotik:
        ok = mikrotik.change_speed(client, plan)
    return (jsonify({"success": True}), 200) if ok else (jsonify({"error": "No se pudo cambiar velocidad"}), 500)


@main_bp.route('/admin/clients/<int:client_id>/scripts', methods=['GET'])
@admin_required()
def get_client_scripts(client_id):
    client = db.session.get(Client, client_id)
    if not client:
        return jsonify({"error": "Cliente no encontrado"}), 404
    plan = client.plan or (db.session.get(Plan, client.plan_id) if client.plan_id else None)
    if not plan:
        return jsonify({"error": "Plan no encontrado"}), 400
    ppp_profile = f"profile_{plan.name.lower().replace(' ','_')}"
    scripts = {
        "provision_pppoe": f"""/ppp/profile/add name={ppp_profile} rate-limit={plan.download_speed}M/{plan.upload_speed}M
/ppp/secret/add name={client.pppoe_username or f'user{client.id}'} password={client.pppoe_password or 'changeme'} service=pppoe profile={ppp_profile} comment=\"{client.full_name}\"
""",
        "suspend": f"""/ppp/secret/set [find name={client.pppoe_username or f'user{client.id}'}] disabled=yes comment=\"suspended\"
/ip/firewall/address-list/add list=suspended address={client.ip_address or '0.0.0.0'} comment=\"{client.full_name}\"
""",
        "activate": f"""/ppp/secret/set [find name={client.pppoe_username or f'user{client.id}'}] disabled=no comment=\"{client.full_name}\"
/ip/firewall/address-list/remove [find list=suspended address={client.ip_address or '0.0.0.0'}]
""",
    }
    return jsonify({"client": client.to_dict(), "scripts": scripts}), 200


@main_bp.route('/admin/routers/<int:router_id>/backup', methods=['POST'])
@admin_required()
def backup_router(router_id):
    with MikroTikService(router_id) as mikrotik:
        filename = mikrotik.export_backup()
    if not filename:
        return jsonify({"error": "No se pudo generar backup"}), 500
    return jsonify({"success": True, "filename": filename}), 200


@main_bp.route('/admin/backups/db', methods=['POST'])
@admin_required()
def backup_db():
    """Ejecuta pg_dump y guarda en el directorio configurado."""
    tenant_id = current_tenant_id()
    base = _ensure_backup_dir()
    ts = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
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


@main_bp.route('/admin/backups/list', methods=['GET'])
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


@main_bp.route('/admin/backups/prune', methods=['POST'])
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


@main_bp.route('/admin/backups/download', methods=['GET'])
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


@main_bp.route('/admin/backups/verify', methods=['GET'])
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

@main_bp.route('/admin/staff', methods=['GET'])
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


@main_bp.route('/admin/staff', methods=['POST'])
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


@main_bp.route('/admin/staff/<int:staff_id>', methods=['PATCH'])
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


@main_bp.route('/admin/inventory/summary', methods=['GET'])
@admin_required()
def admin_inventory_summary():
    tenant_id = current_tenant_id()

    clients_query = Client.query.options(joinedload(Client.plan))
    routers_query = MikroTikRouter.query
    if tenant_id is not None:
        clients_query = clients_query.filter_by(tenant_id=tenant_id)
        routers_query = routers_query.filter_by(tenant_id=tenant_id)

    clients = clients_query.all()
    routers_count = routers_query.count()
    clients_count = len(clients)

    defaults = [
        {
            "sku": "ONU-GPON",
            "name": "ONU GPON",
            "category": "onu",
            "total": max(30, clients_count + 20),
            "assigned": clients_count,
            "reorder_point": 15,
            "unit": "units",
        },
        {
            "sku": "CPE-DUAL",
            "name": "Router CPE Dual Band",
            "category": "cpe",
            "total": max(40, clients_count + 35),
            "assigned": clients_count,
            "reorder_point": 20,
            "unit": "units",
        },
        {
            "sku": "ROUTER-CORE",
            "name": "MikroTik Core Router",
            "category": "router",
            "total": max(8, routers_count + 3),
            "assigned": routers_count,
            "reorder_point": 3,
            "unit": "units",
        },
        {
            "sku": "FIBER-SM",
            "name": "Fibra Monomodo",
            "category": "fiber",
            "total": max(80.0, round(clients_count * 0.11 + 40.0, 1)),
            "assigned": round(clients_count * 0.065, 1),
            "reorder_point": 25.0,
            "unit": "km",
        },
    ]

    items = []
    alerts = []
    for raw in defaults:
        available = round(max(0, raw["total"] - raw["assigned"]), 1 if raw["unit"] == "km" else 0)
        if available <= raw["reorder_point"] * 0.5:
            level = "critical"
        elif available <= raw["reorder_point"]:
            level = "warning"
        else:
            level = "ok"
        item = {
            **raw,
            "available": available,
            "status": level,
            "updated_at": _iso_utc_now(),
        }
        items.append(item)
        if level != "ok":
            alerts.append({
                "sku": raw["sku"],
                "name": raw["name"],
                "level": level,
                "available": available,
                "reorder_point": raw["reorder_point"],
            })

    plan_distribution_map: dict[str, int] = {}
    for client in clients:
        plan_name = client.plan.name if client.plan else "Sin plan"
        plan_distribution_map[plan_name] = plan_distribution_map.get(plan_name, 0) + 1
    plan_distribution = [
        {"plan": plan, "clients": count}
        for plan, count in sorted(plan_distribution_map.items(), key=lambda item: item[1], reverse=True)[:8]
    ]

    summary = {
        "clients_total": clients_count,
        "routers_total": routers_count,
        "stock_items": len(items),
        "low_stock_items": len(alerts),
        "available_units": round(sum(float(item["available"]) for item in items), 1),
        "updated_at": _iso_utc_now(),
    }
    _audit("inventory_summary", entity_type="inventory", metadata=summary)
    return jsonify({
        "summary": summary,
        "items": items,
        "alerts": alerts,
        "plan_distribution": plan_distribution,
    }), 200


@main_bp.route('/admin/notifications/history', methods=['GET'])
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


@main_bp.route('/admin/audit-logs', methods=['GET'])
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


@main_bp.route('/admin/permissions', methods=['GET'])
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


@main_bp.route('/admin/permissions', methods=['POST'])
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
    row.updated_at = datetime.utcnow()
    db.session.add(row)
    db.session.commit()

    resolved = _role_permissions_with_overrides(role, tenant_id)
    payload = row.to_dict()
    payload["resolved_permissions"] = sorted(permission_name for permission_name in resolved if permission_name != "*")
    payload["wildcard"] = "*" in resolved
    _audit("permission_upsert", entity_type="role_permission", entity_id=row.id, metadata=payload)
    return jsonify({"success": True, "item": payload}), 200


@main_bp.route('/admin/notifications/send', methods=['POST'])
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

@main_bp.route('/admin/finance/summary', methods=['GET'])
@permission_required('billing.read')
def admin_finance_summary():
    tenant_id = current_tenant_id()
    now = datetime.utcnow()
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


@main_bp.route('/admin/billing/promises', methods=['GET'])
@permission_required('billing.promises.read')
def admin_billing_promises_list():
    tenant_id = current_tenant_id()
    status_filter = str(request.args.get('status') or '').strip().lower()
    subscription_id = _parse_int(request.args.get('subscription_id'))

    query = _tenant_scoped_query(BillingPromise, tenant_id)
    if status_filter:
        query = query.filter(BillingPromise.status == status_filter)
    if subscription_id is not None:
        query = query.filter(BillingPromise.subscription_id == subscription_id)

    items = [row.to_dict() for row in query.order_by(BillingPromise.created_at.desc()).limit(300).all()]
    summary = {
        "pending": sum(1 for row in items if row.get("status") == "pending"),
        "kept": sum(1 for row in items if row.get("status") == "kept"),
        "broken": sum(1 for row in items if row.get("status") == "broken"),
        "cancelled": sum(1 for row in items if row.get("status") == "cancelled"),
    }
    return jsonify({"items": items, "count": len(items), "summary": summary}), 200


@main_bp.route('/admin/billing/promises', methods=['POST'])
@permission_required('billing.promises.write')
def admin_billing_promises_create():
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    data = request.get_json() or {}

    subscription_id = _parse_int(data.get('subscription_id'))
    promised_amount = _parse_money_value(data.get('promised_amount'))
    promised_date_raw = str(data.get('promised_date') or '').strip()
    notes = str(data.get('notes') or '').strip()

    if subscription_id is None:
        return jsonify({"error": "subscription_id es requerido"}), 400
    if promised_amount is None or promised_amount <= 0:
        return jsonify({"error": "promised_amount debe ser mayor a 0"}), 400
    if not promised_date_raw:
        return jsonify({"error": "promised_date es requerido (YYYY-MM-DD)"}), 400
    try:
        promised_date = date.fromisoformat(promised_date_raw)
    except Exception:
        return jsonify({"error": "promised_date invalido (YYYY-MM-DD)"}), 400

    subscription = db.session.get(Subscription, subscription_id)
    if not subscription:
        return jsonify({"error": "Suscripcion no encontrada"}), 404
    if tenant_id is not None and subscription.tenant_id not in (None, tenant_id):
        return jsonify({"error": "Suscripcion fuera del tenant"}), 403

    promise = BillingPromise(
        tenant_id=tenant_id,
        subscription_id=subscription_id,
        promised_amount=promised_amount,
        promised_date=promised_date,
        status='pending',
        notes=notes,
        created_by=actor_id,
    )
    db.session.add(promise)
    db.session.commit()
    payload = promise.to_dict()
    _audit("billing_promise_create", entity_type="billing_promise", entity_id=promise.id, metadata=payload)
    return jsonify({"success": True, "promise": payload}), 201


@main_bp.route('/admin/billing/promises/<int:promise_id>', methods=['PATCH'])
@permission_required('billing.promises.write')
def admin_billing_promises_update(promise_id):
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    promise = _tenant_scoped_query(BillingPromise, tenant_id).filter_by(id=promise_id).first()
    if not promise:
        return jsonify({"error": "Promesa no encontrada"}), 404

    data = request.get_json() or {}
    if 'status' in data:
        status = str(data.get('status') or '').strip().lower()
        if status not in {'pending', 'kept', 'broken', 'cancelled'}:
            return jsonify({"error": "status invalido. permitidos: pending | kept | broken | cancelled"}), 400
        promise.status = status
        if status in {'kept', 'broken', 'cancelled'}:
            promise.resolved_by = actor_id
            promise.resolved_at = datetime.utcnow()
    if 'promised_amount' in data:
        promised_amount = _parse_money_value(data.get('promised_amount'))
        if promised_amount is None or promised_amount <= 0:
            return jsonify({"error": "promised_amount debe ser mayor a 0"}), 400
        promise.promised_amount = promised_amount
    if 'promised_date' in data:
        promised_date_raw = str(data.get('promised_date') or '').strip()
        if not promised_date_raw:
            return jsonify({"error": "promised_date no puede estar vacio"}), 400
        try:
            promise.promised_date = date.fromisoformat(promised_date_raw)
        except Exception:
            return jsonify({"error": "promised_date invalido (YYYY-MM-DD)"}), 400
    if 'notes' in data:
        promise.notes = str(data.get('notes') or '').strip()

    db.session.add(promise)
    db.session.commit()
    payload = promise.to_dict()
    _audit("billing_promise_update", entity_type="billing_promise", entity_id=promise.id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "promise": payload}), 200


@main_bp.route('/admin/payments/<int:payment_id>/review', methods=['PATCH'])
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


@main_bp.route('/admin/network/maintenance', methods=['GET'])
@permission_required('network.maintenance.read')
def admin_network_maintenance_list():
    tenant_id = current_tenant_id()
    status_filter = str(request.args.get('status') or '').strip().lower()
    now_dt = datetime.utcnow()
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


@main_bp.route('/admin/network/maintenance', methods=['POST'])
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


@main_bp.route('/admin/network/maintenance/<int:window_id>', methods=['PATCH'])
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


def _installation_model_from_entry(entry: dict, tenant_id) -> AdminInstallation:
    scheduled_for = _parse_iso_datetime(entry.get("scheduled_for"))
    completed_at = _parse_iso_datetime(entry.get("completed_at"))
    created_at = _parse_iso_datetime(entry.get("created_at")) or datetime.utcnow()
    updated_at = _parse_iso_datetime(entry.get("updated_at")) or created_at
    return AdminInstallation(
        id=str(entry.get("id") or secrets.token_hex(8)),
        tenant_id=tenant_id,
        client_id=_parse_int(entry.get("client_id")),
        client_name=str(entry.get("client_name") or "").strip() or "Cliente",
        plan=(str(entry.get("plan") or "").strip() or None),
        router=(str(entry.get("router") or "").strip() or None),
        address=str(entry.get("address") or "Sin direccion").strip() or "Sin direccion",
        status=str(entry.get("status") or "pending").strip().lower(),
        priority=str(entry.get("priority") or "normal").strip().lower() or "normal",
        technician=str(entry.get("technician") or "pendiente@ispfast.local").strip() or "pendiente@ispfast.local",
        scheduled_for=scheduled_for,
        notes=str(entry.get("notes") or "").strip(),
        checklist=entry.get("checklist") if isinstance(entry.get("checklist"), dict) else {},
        completed_at=completed_at,
        completed_by=_parse_int(entry.get("completed_by")),
        completed_by_name=(str(entry.get("completed_by_name") or "").strip() or None),
        created_by=_parse_int(entry.get("created_by")),
        created_by_name=(str(entry.get("created_by_name") or "").strip() or None),
        created_by_email=(str(entry.get("created_by_email") or "").strip() or None),
        updated_by=_parse_int(entry.get("updated_by")),
        updated_by_name=(str(entry.get("updated_by_name") or "").strip() or None),
        updated_by_email=(str(entry.get("updated_by_email") or "").strip() or None),
        created_at=created_at,
        updated_at=updated_at,
    )


def _screen_alert_model_from_entry(entry: dict, tenant_id) -> AdminScreenAlert:
    starts_at = _parse_iso_datetime(entry.get("starts_at"))
    ends_at = _parse_iso_datetime(entry.get("ends_at"))
    created_at = _parse_iso_datetime(entry.get("created_at")) or datetime.utcnow()
    updated_at = _parse_iso_datetime(entry.get("updated_at")) or created_at
    return AdminScreenAlert(
        id=str(entry.get("id") or secrets.token_hex(8)),
        tenant_id=tenant_id,
        title=str(entry.get("title") or "").strip() or "Alerta",
        message=str(entry.get("message") or "").strip() or "-",
        severity=str(entry.get("severity") or "info").strip().lower(),
        audience=str(entry.get("audience") or "all").strip().lower(),
        status=str(entry.get("status") or "draft").strip().lower(),
        starts_at=starts_at,
        ends_at=ends_at,
        impressions=int(entry.get("impressions") or 0),
        acknowledged=int(entry.get("acknowledged") or 0),
        created_by=_parse_int(entry.get("created_by")),
        created_by_name=(str(entry.get("created_by_name") or "").strip() or None),
        created_by_email=(str(entry.get("created_by_email") or "").strip() or None),
        updated_by=_parse_int(entry.get("updated_by")),
        updated_by_name=(str(entry.get("updated_by_name") or "").strip() or None),
        updated_by_email=(str(entry.get("updated_by_email") or "").strip() or None),
        created_at=created_at,
        updated_at=updated_at,
    )


def _extra_service_model_from_entry(entry: dict, tenant_id) -> AdminExtraService:
    created_at = _parse_iso_datetime(entry.get("created_at")) or datetime.utcnow()
    updated_at = _parse_iso_datetime(entry.get("updated_at")) or created_at
    return AdminExtraService(
        id=str(entry.get("id") or secrets.token_hex(8)),
        tenant_id=tenant_id,
        name=str(entry.get("name") or "").strip() or "Servicio",
        category=str(entry.get("category") or "other").strip().lower() or "other",
        description=str(entry.get("description") or "").strip(),
        monthly_price=round(float(entry.get("monthly_price") or 0), 2),
        one_time_fee=round(float(entry.get("one_time_fee") or 0), 2),
        status=str(entry.get("status") or "active").strip().lower(),
        subscribers=max(0, int(entry.get("subscribers") or 0)),
        created_by=_parse_int(entry.get("created_by")),
        created_by_name=(str(entry.get("created_by_name") or "").strip() or None),
        created_by_email=(str(entry.get("created_by_email") or "").strip() or None),
        updated_by=_parse_int(entry.get("updated_by")),
        updated_by_name=(str(entry.get("updated_by_name") or "").strip() or None),
        updated_by_email=(str(entry.get("updated_by_email") or "").strip() or None),
        created_at=created_at,
        updated_at=updated_at,
    )


def _hotspot_voucher_model_from_entry(entry: dict, tenant_id) -> AdminHotspotVoucher:
    expires_at = _parse_iso_datetime(entry.get("expires_at"))
    used_at = _parse_iso_datetime(entry.get("used_at"))
    created_at = _parse_iso_datetime(entry.get("created_at")) or datetime.utcnow()
    updated_at = _parse_iso_datetime(entry.get("updated_at")) or created_at
    return AdminHotspotVoucher(
        id=str(entry.get("id") or secrets.token_hex(8)),
        tenant_id=tenant_id,
        code=str(entry.get("code") or "").strip().upper() or f"VCH-{secrets.token_hex(3).upper()}",
        profile=str(entry.get("profile") or "basic").strip().lower() or "basic",
        duration_minutes=max(1, int(entry.get("duration_minutes") or 60)),
        data_limit_mb=max(0, int(entry.get("data_limit_mb") or 0)),
        price=round(float(entry.get("price") or 0), 2),
        status=str(entry.get("status") or "generated").strip().lower(),
        assigned_to=(str(entry.get("assigned_to") or "").strip() or None),
        expires_at=expires_at,
        used_at=used_at,
        created_by=_parse_int(entry.get("created_by")),
        created_by_name=(str(entry.get("created_by_name") or "").strip() or None),
        created_by_email=(str(entry.get("created_by_email") or "").strip() or None),
        updated_by=_parse_int(entry.get("updated_by")),
        updated_by_name=(str(entry.get("updated_by_name") or "").strip() or None),
        updated_by_email=(str(entry.get("updated_by_email") or "").strip() or None),
        created_at=created_at,
        updated_at=updated_at,
    )


def _default_installations(tenant_id) -> list[dict]:
    clients_query = Client.query.options(joinedload(Client.plan), joinedload(Client.router))
    if tenant_id is not None:
        clients_query = clients_query.filter_by(tenant_id=tenant_id)
    clients = clients_query.order_by(Client.id.asc()).limit(12).all()

    staff_query = User.query.filter(User.role.in_(("tech", "support", "admin", "noc")))
    if tenant_id is not None:
        staff_query = staff_query.filter_by(tenant_id=tenant_id)
    technicians = [user.email for user in staff_query.order_by(User.name.asc()).all()]
    if not technicians:
        technicians = ["pendiente@ispfast.local"]

    statuses = ["pending", "scheduled", "in_progress", "completed"]
    now = datetime.utcnow()
    system_actor = {"id": None, "name": "system", "email": None}
    items: list[dict] = []
    for index, client in enumerate(clients, start=1):
        status = statuses[index % len(statuses)]
        scheduled_at = (now + timedelta(days=index % 6, hours=(index % 4) * 2)).replace(microsecond=0)
        checklist = {
            "onu_registered": status == "completed",
            "cpe_configured": status in {"in_progress", "completed"},
            "signal_validated": status == "completed",
            "speedtest_ok": status == "completed",
        }
        entry = {
            "id": f"inst-{client.id}",
            "client_id": client.id,
            "client_name": client.full_name,
            "plan": client.plan.name if client.plan else None,
            "router": client.router.name if client.router else None,
            "address": client.ip_address or "Sin direccion",
            "status": status,
            "priority": "high" if index % 5 == 0 else "normal",
            "technician": technicians[index % len(technicians)],
            "scheduled_for": scheduled_at.isoformat() + "Z",
            "notes": "Instalacion programada automaticamente",
            "checklist": checklist,
        }
        _apply_operational_entry_create_metadata(entry, actor=system_actor)
        items.append(entry)
    return items


@main_bp.route('/admin/installations', methods=['GET'])
@permission_required('installations.read')
def admin_installations_list():
    tenant_id = current_tenant_id()
    key = _installations_key(tenant_id)
    rows = _tenant_scoped_query(AdminInstallation, tenant_id).order_by(AdminInstallation.created_at.desc()).all()
    if not rows:
        cached_items = _load_cached_list(key)
        seed_items = cached_items or _default_installations(tenant_id)
        for entry in seed_items:
            db.session.add(_installation_model_from_entry(entry, tenant_id))
        db.session.commit()
        rows = _tenant_scoped_query(AdminInstallation, tenant_id).order_by(AdminInstallation.created_at.desc()).all()
    items = [row.to_dict() for row in rows]

    status_filter = (request.args.get('status') or '').strip().lower()
    technician_filter = (request.args.get('technician') or '').strip().lower()
    if status_filter:
        items = [item for item in items if str(item.get("status", "")).lower() == status_filter]
    if technician_filter:
        items = [
            item for item in items if technician_filter in str(item.get("technician", "")).lower()
        ]

    summary = {status: 0 for status in INSTALLATION_ALLOWED_STATUS}
    for item in items:
        state = str(item.get("status") or "pending")
        summary[state] = summary.get(state, 0) + 1
    return jsonify({"items": items, "count": len(items), "summary": summary}), 200


@main_bp.route('/admin/installations', methods=['POST'])
@permission_required('installations.write')
def admin_installations_create():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    actor = _current_actor_snapshot()

    client_id = data.get('client_id')
    client_name = (data.get('client_name') or '').strip()
    client = None
    if client_id:
        client = db.session.get(Client, client_id)
        if not client:
            return jsonify({"error": "Cliente no encontrado"}), 404
        if tenant_id is not None and client.tenant_id not in (None, tenant_id):
            return jsonify({"error": "Cliente fuera del tenant"}), 403
        client_name = client.full_name

    if not client_name:
        return jsonify({"error": "client_name o client_id es requerido"}), 400

    status = (data.get('status') or 'scheduled').strip().lower()
    if status not in INSTALLATION_ALLOWED_STATUS:
        return jsonify({"error": f"status invalido. permitidos: {', '.join(sorted(INSTALLATION_ALLOWED_STATUS))}"}), 400

    raw_scheduled = (data.get('scheduled_for') or '').strip()
    if raw_scheduled:
        try:
            scheduled_for = datetime.fromisoformat(raw_scheduled.replace('Z', '+00:00')).replace(microsecond=0)
        except Exception:
            return jsonify({"error": "scheduled_for debe ser ISO date-time"}), 400
    else:
        scheduled_for = datetime.utcnow().replace(microsecond=0) + timedelta(days=1)

    entry = {
        "id": secrets.token_hex(8),
        "client_id": client.id if client else None,
        "client_name": client_name,
        "plan": client.plan.name if client and client.plan else (data.get('plan') or None),
        "router": client.router.name if client and client.router else (data.get('router') or None),
        "address": (data.get('address') or (client.ip_address if client else '') or 'Sin direccion').strip(),
        "status": status,
        "priority": (data.get('priority') or 'normal').strip().lower(),
        "technician": (data.get('technician') or '').strip() or "pendiente@ispfast.local",
        "scheduled_for": scheduled_for.isoformat() + "Z",
        "notes": (data.get('notes') or '').strip(),
        "checklist": {
            "onu_registered": False,
            "cpe_configured": False,
            "signal_validated": False,
            "speedtest_ok": False,
        },
    }
    _apply_operational_entry_create_metadata(entry, actor=actor)
    record = _installation_model_from_entry(entry, tenant_id)
    db.session.add(record)
    db.session.commit()
    payload = record.to_dict()
    _save_cached_list(_installations_key(tenant_id), [payload], max_items=400)
    _audit("installation_create", entity_type="installation", entity_id=record.id, metadata=payload)
    return jsonify({"success": True, "installation": payload}), 201


@main_bp.route('/admin/installations/<string:installation_id>', methods=['PATCH'])
@permission_required('installations.write')
def admin_installations_update(installation_id):
    tenant_id = current_tenant_id()
    record = _tenant_scoped_query(AdminInstallation, tenant_id).filter_by(id=installation_id).first()
    if not record:
        return jsonify({"error": "Instalacion no encontrada"}), 404

    actor = _current_actor_snapshot()
    entry = record.to_dict()
    _ensure_operational_entry_metadata(entry)
    data = request.get_json() or {}
    if 'status' in data:
        status = str(data.get('status') or '').strip().lower()
        if status not in INSTALLATION_ALLOWED_STATUS:
            return jsonify({"error": f"status invalido. permitidos: {', '.join(sorted(INSTALLATION_ALLOWED_STATUS))}"}), 400
        entry['status'] = status
    if 'priority' in data:
        entry['priority'] = str(data.get('priority') or 'normal').strip().lower() or 'normal'
    if 'technician' in data:
        entry['technician'] = str(data.get('technician') or '').strip() or "pendiente@ispfast.local"
    if 'address' in data:
        entry['address'] = str(data.get('address') or '').strip() or entry.get('address')
    if 'notes' in data:
        entry['notes'] = str(data.get('notes') or '').strip()
    if 'scheduled_for' in data:
        raw_scheduled = str(data.get('scheduled_for') or '').strip()
        if raw_scheduled:
            try:
                scheduled_for = datetime.fromisoformat(raw_scheduled.replace('Z', '+00:00')).replace(microsecond=0)
            except Exception:
                return jsonify({"error": "scheduled_for debe ser ISO date-time"}), 400
            entry['scheduled_for'] = scheduled_for.isoformat() + "Z"
    if 'checklist' in data and isinstance(data.get('checklist'), dict):
        checklist = entry.get('checklist') or {}
        for key_name, value in data['checklist'].items():
            parsed = _parse_bool(value)
            if parsed is None:
                return jsonify({"error": f"checklist.{key_name} debe ser booleano"}), 400
            checklist[str(key_name)] = parsed
        entry['checklist'] = checklist

    if entry.get('status') == 'completed':
        entry['completed_at'] = entry.get('completed_at') or _iso_utc_now()
        entry['completed_by'] = entry.get('completed_by') if entry.get('completed_by') is not None else actor.get("id")
        entry['completed_by_name'] = entry.get('completed_by_name') or str(actor.get("name") or _actor_default_name(actor.get("id")))
    _apply_operational_entry_update_metadata(entry, actor=actor)
    record.client_id = _parse_int(entry.get('client_id'))
    record.client_name = entry.get('client_name')
    record.plan = entry.get('plan')
    record.router = entry.get('router')
    record.address = entry.get('address')
    record.status = entry.get('status')
    record.priority = entry.get('priority')
    record.technician = entry.get('technician')
    record.scheduled_for = _parse_iso_datetime(entry.get('scheduled_for'))
    record.notes = entry.get('notes')
    record.checklist = entry.get('checklist') if isinstance(entry.get('checklist'), dict) else {}
    record.completed_at = _parse_iso_datetime(entry.get('completed_at'))
    record.completed_by = _parse_int(entry.get('completed_by'))
    record.completed_by_name = entry.get('completed_by_name')
    record.created_by = _parse_int(entry.get('created_by'))
    record.created_by_name = entry.get('created_by_name')
    record.created_by_email = entry.get('created_by_email')
    record.updated_by = _parse_int(entry.get('updated_by'))
    record.updated_by_name = entry.get('updated_by_name')
    record.updated_by_email = entry.get('updated_by_email')
    record.created_at = _parse_iso_datetime(entry.get('created_at')) or record.created_at
    record.updated_at = _parse_iso_datetime(entry.get('updated_at')) or datetime.utcnow()
    db.session.add(record)
    db.session.commit()
    _save_cached_list(_installations_key(tenant_id), [record.to_dict()], max_items=400)
    _audit("installation_update", entity_type="installation", entity_id=installation_id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "installation": record.to_dict()}), 200


def _default_screen_alerts() -> list[dict]:
    now = _iso_utc_now()
    system_actor = {"id": None, "name": "system", "email": None}
    items = [
        {
            "id": secrets.token_hex(8),
            "title": "Mantenimiento programado",
            "message": "Habra ventana de mantenimiento de 01:00 a 02:00.",
            "severity": "info",
            "audience": "all",
            "status": "active",
            "starts_at": now,
            "ends_at": None,
            "impressions": 0,
            "acknowledged": 0,
        },
        {
            "id": secrets.token_hex(8),
            "title": "Recordatorio de pago",
            "message": "Clientes con saldo pendiente evitaran corte regularizando hoy.",
            "severity": "warning",
            "audience": "overdue",
            "status": "draft",
            "starts_at": now,
            "ends_at": None,
            "impressions": 0,
            "acknowledged": 0,
        },
    ]
    for entry in items:
        _apply_operational_entry_create_metadata(entry, actor=system_actor)
    return items


@main_bp.route('/admin/screen-alerts', methods=['GET'])
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


@main_bp.route('/admin/screen-alerts', methods=['POST'])
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


@main_bp.route('/admin/screen-alerts/<string:alert_id>', methods=['PATCH'])
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
    record.updated_at = _parse_iso_datetime(entry.get('updated_at')) or datetime.utcnow()
    db.session.add(record)
    db.session.commit()
    _save_cached_list(_screen_alerts_key(tenant_id), [record.to_dict()], max_items=400)
    _audit("screen_alert_update", entity_type="screen_alert", entity_id=alert_id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "alert": record.to_dict()}), 200


def _default_extra_services(tenant_id) -> list[dict]:
    clients_query = Client.query
    if tenant_id is not None:
        clients_query = clients_query.filter_by(tenant_id=tenant_id)
    clients_count = clients_query.count()
    system_actor = {"id": None, "name": "system", "email": None}
    items = [
        {
            "id": "svc-iptv",
            "name": "IPTV Premium",
            "category": "tv",
            "description": "Canales HD y catch-up basico",
            "monthly_price": 9.9,
            "one_time_fee": 0.0,
            "status": "active",
            "subscribers": max(0, round(clients_count * 0.22)),
        },
        {
            "id": "svc-voip",
            "name": "Linea VoIP",
            "category": "voice",
            "description": "Numero fijo virtual con llamadas locales",
            "monthly_price": 5.5,
            "one_time_fee": 8.0,
            "status": "active",
            "subscribers": max(0, round(clients_count * 0.13)),
        },
        {
            "id": "svc-ipfixa",
            "name": "IP Publica Fija",
            "category": "ip",
            "description": "Direccion IP estatica para negocios",
            "monthly_price": 14.0,
            "one_time_fee": 20.0,
            "status": "active",
            "subscribers": max(0, round(clients_count * 0.09)),
        },
        {
            "id": "svc-backup4g",
            "name": "Backup LTE",
            "category": "redundancy",
            "description": "Failover movil para continuidad basica",
            "monthly_price": 17.5,
            "one_time_fee": 25.0,
            "status": "disabled",
            "subscribers": max(0, round(clients_count * 0.04)),
        },
    ]
    for entry in items:
        _apply_operational_entry_create_metadata(entry, actor=system_actor)
    return items


@main_bp.route('/admin/extra-services', methods=['GET'])
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


@main_bp.route('/admin/extra-services', methods=['POST'])
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


@main_bp.route('/admin/extra-services/<string:service_id>', methods=['PATCH'])
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
    record.updated_at = _parse_iso_datetime(entry.get('updated_at')) or datetime.utcnow()
    db.session.add(record)
    db.session.commit()
    _save_cached_list(_extra_services_key(tenant_id), [record.to_dict()], max_items=300)
    _audit("extra_service_update", entity_type="extra_service", entity_id=service_id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "service": record.to_dict()}), 200


@main_bp.route('/admin/hotspot/vouchers', methods=['GET'])
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


@main_bp.route('/admin/hotspot/vouchers', methods=['POST'])
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
    now = datetime.utcnow().replace(microsecond=0)

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


@main_bp.route('/admin/hotspot/vouchers/<string:voucher_id>', methods=['PATCH'])
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
    record.updated_at = _parse_iso_datetime(entry.get('updated_at')) or datetime.utcnow()
    db.session.add(record)
    db.session.commit()
    _save_cached_list(_hotspot_vouchers_key(tenant_id), [record.to_dict()], max_items=1000)
    _audit("hotspot_voucher_update", entity_type="hotspot_voucher", entity_id=voucher_id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "voucher": record.to_dict()}), 200


def _default_system_settings() -> dict:
    return {
        "portal_maintenance_mode": False,
        "auto_suspend_overdue": True,
        "notifications_push_enabled": bool(current_app.config.get('WONDERPUSH_ACCESS_TOKEN')),
        "notifications_email_enabled": bool(current_app.config.get('MAIL_SERVER')),
        "allow_self_signup": bool(current_app.config.get('ALLOW_SELF_SIGNUP', False)),
        "default_ticket_priority": "medium",
        "backup_retention_days": 14,
        "metrics_poll_interval_sec": 60,
        "change_control_required_for_live": True,
        "require_preflight_for_live": True,
        "admin_mfa_required": False,
        "password_policy_min_length": 10,
        "backup_restore_drill_days": 30,
        "slo_router_availability_target": 99,
        "slo_ticket_sla_target": 95,
        "slo_provision_success_target": 98,
    }


def _recalculate_invoice_balances(tenant_id) -> dict:
    invoices_q = Invoice.query.options(
        joinedload(Invoice.payments),
        joinedload(Invoice.subscription),
    )
    if tenant_id is not None:
        invoices_q = invoices_q.join(Subscription, Invoice.subscription_id == Subscription.id).filter(
            Subscription.tenant_id == tenant_id
        )

    scanned = 0
    updated = 0
    for invoice in invoices_q.all():
        if str(invoice.status or '').lower() == 'cancelled':
            continue

        paid_total = 0.0
        for payment in invoice.payments:
            if str(payment.status or '').lower() == 'paid':
                paid_total += float(payment.amount or 0)

        expected_status = 'paid' if paid_total >= float(invoice.total_amount or 0) else 'pending'
        if invoice.status != expected_status:
            invoice.status = expected_status
            updated += 1
        scanned += 1

    db.session.commit()
    return {"scanned": scanned, "updated": updated, "timestamp": _iso_utc_now()}


def _cleanup_leases_for_tenant(tenant_id) -> dict:
    today = date.today()
    subscriptions_q = Subscription.query
    if tenant_id is not None:
        subscriptions_q = subscriptions_q.filter_by(tenant_id=tenant_id)

    scanned = 0
    updated = 0
    failed = 0
    reactivated = 0
    skipped_by_promise = 0
    promises_marked_kept = 0
    promises_marked_broken = 0
    overdue_invoices_total = 0
    changes = []

    for sub in subscriptions_q.all():
        scanned += 1
        original_status = sub.status

        overdue_invoice_exists = (
            Invoice.query.filter(
                Invoice.subscription_id == sub.id,
                Invoice.status == 'pending',
                Invoice.due_date < today,
            ).first()
            is not None
        )
        overdue_next_charge = bool(sub.next_charge and sub.next_charge < today)
        is_overdue = overdue_invoice_exists or overdue_next_charge
        if overdue_invoice_exists:
            overdue_invoices_total += 1

        if is_overdue and sub.status == 'active':
            sub.status = 'past_due'

        pending_promises_q = BillingPromise.query.filter(
            BillingPromise.subscription_id == sub.id,
            BillingPromise.status == 'pending',
        )
        valid_promise = (
            pending_promises_q
            .filter(BillingPromise.promised_date >= today)
            .order_by(BillingPromise.promised_date.asc())
            .first()
        )
        expired_promises = (
            pending_promises_q
            .filter(BillingPromise.promised_date < today)
            .all()
        )
        for promise in expired_promises:
            promise.status = 'broken'
            promise.resolved_at = datetime.utcnow()
            db.session.add(promise)
            promises_marked_broken += 1

        client = sub.client or (db.session.get(Client, sub.client_id) if sub.client_id else None)
        if sub.status in ('past_due', 'suspended') and not is_overdue:
            sub.status = 'active'
        if sub.status in ('past_due', 'suspended') and is_overdue and valid_promise is not None:
            skipped_by_promise += 1
        elif sub.status in ('past_due', 'suspended') and is_overdue and client and client.router_id:
            try:
                with MikroTikService(client.router_id) as service:
                    service.suspend_client(client)
                sub.status = 'suspended'
            except Exception:
                failed += 1
        elif sub.status == 'active' and client and client.router_id:
            try:
                with MikroTikService(client.router_id) as service:
                    service.activate_client(client)
            except Exception:
                failed += 1

        if sub.status == 'active' and original_status in ('past_due', 'suspended'):
            reactivated += 1
            kept_promises = BillingPromise.query.filter(
                BillingPromise.subscription_id == sub.id,
                BillingPromise.status == 'pending',
            ).all()
            for promise in kept_promises:
                promise.status = 'kept'
                promise.resolved_at = datetime.utcnow()
                db.session.add(promise)
                promises_marked_kept += 1

        if sub.status != original_status:
            updated += 1
            changes.append({"subscription_id": sub.id, "from": original_status, "to": sub.status})
        db.session.add(sub)

    db.session.commit()
    return {
        "tenant_id": tenant_id,
        "scanned": scanned,
        "updated": updated,
        "reactivated": reactivated,
        "failed": failed,
        "overdue_invoices": overdue_invoices_total,
        "skipped_by_promise": skipped_by_promise,
        "promises_marked_kept": promises_marked_kept,
        "promises_marked_broken": promises_marked_broken,
        "changes": changes[:200],
        "timestamp": _iso_utc_now(),
    }


def _rotate_mikrotik_passwords(tenant_id) -> tuple[str, dict]:
    routers_q = MikroTikRouter.query.filter_by(is_active=True)
    if tenant_id is not None:
        routers_q = routers_q.filter_by(tenant_id=tenant_id)
    routers = routers_q.order_by(MikroTikRouter.id.asc()).all()

    if not routers:
        return 'skipped', {
            "message": "No hay routers activos para rotar password.",
            "total": 0,
            "rotated": 0,
            "failed": 0,
            "items": [],
        }

    dry_run = _password_rotation_dry_run_enabled()
    results = []
    rotated = 0
    failed = 0
    length = _password_rotation_length()
    default_username = str(current_app.config.get('MIKROTIK_DEFAULT_USERNAME') or '').strip()

    for router in routers:
        username = str(router.username or default_username).strip()
        if not username:
            failed += 1
            results.append(
                {
                    "router_id": router.id,
                    "router_name": router.name,
                    "status": "failed",
                    "error": "username no configurado",
                }
            )
            continue

        new_password = _generate_router_password(length)
        if dry_run:
            rotated += 1
            results.append(
                {
                    "router_id": router.id,
                    "router_name": router.name,
                    "username": username,
                    "status": "dry_run",
                    "preview": _mask_secret(new_password),
                }
            )
            continue

        try:
            with MikroTikService(router.id) as service:
                outcome = service.rotate_api_password(username=username, new_password=new_password)
        except Exception as exc:
            outcome = {"success": False, "error": str(exc)}

        if outcome.get("success"):
            router.password = new_password
            db.session.add(router)
            db.session.commit()
            rotated += 1
            results.append(
                {
                    "router_id": router.id,
                    "router_name": router.name,
                    "username": username,
                    "status": "rotated",
                }
            )
        else:
            db.session.rollback()
            failed += 1
            results.append(
                {
                    "router_id": router.id,
                    "router_name": router.name,
                    "username": username,
                    "status": "failed",
                    "error": str(outcome.get("error") or "unknown_error"),
                }
            )

    summary = {
        "total": len(routers),
        "rotated": rotated,
        "failed": failed,
        "dry_run": dry_run,
        "items": results,
    }

    if dry_run:
        summary["message"] = "Rotacion ejecutada en modo dry_run. No se aplicaron cambios."
        return 'skipped', summary

    if failed > 0 and rotated == 0:
        return 'failed', summary
    if failed > 0:
        return 'completed_with_errors', summary
    return 'completed', summary


def _enforce_billing_for_tenant(tenant_id) -> tuple[str, dict]:
    defaults = _default_system_settings()
    overrides = _load_system_settings_overrides_db(tenant_id)
    if not overrides:
        overrides = _load_cached_dict(_system_settings_key(tenant_id))
    auto_suspend_overdue = bool(overrides.get("auto_suspend_overdue", defaults.get("auto_suspend_overdue", True)))
    if not auto_suspend_overdue:
        return 'skipped', {
            "tenant_id": tenant_id,
            "auto_suspend_overdue": False,
            "message": "auto_suspend_overdue deshabilitado en ajustes de sistema.",
            "timestamp": _iso_utc_now(),
        }

    summary = _cleanup_leases_for_tenant(tenant_id)
    summary["auto_suspend_overdue"] = True
    return 'completed', summary


def _backup_artifacts_summary() -> dict:
    backup_dir = current_app.config.get('BACKUP_DIR') or os.environ.get('BACKUP_DIR', '/app/backups')
    path = Path(str(backup_dir))
    if not path.exists() or not path.is_dir():
        return {"backup_dir": str(path), "exists": False, "files": [], "latest": None}

    files = []
    for file_path in path.iterdir():
        if not file_path.is_file():
            continue
        try:
            stat = file_path.stat()
            files.append(
                {
                    "name": file_path.name,
                    "size": int(stat.st_size),
                    "modified_at": datetime.utcfromtimestamp(stat.st_mtime).isoformat() + "Z",
                    "modified_ts": float(stat.st_mtime),
                }
            )
        except Exception:
            continue
    files.sort(key=lambda item: item.get("modified_ts", 0), reverse=True)
    latest = files[0] if files else None
    return {"backup_dir": str(path), "exists": True, "files": files[:200], "latest": latest}


def _run_backup_restore_drill(tenant_id) -> tuple[str, dict]:
    settings = _effective_system_settings(tenant_id)
    max_days = int(settings.get("backup_restore_drill_days", 30) or 30)
    max_days = max(1, min(max_days, 365))
    max_age_hours = max_days * 24

    artifacts = _backup_artifacts_summary()
    checks = []

    latest = artifacts.get("latest")
    if latest and latest.get("modified_ts"):
        age_hours = round((time.time() - float(latest["modified_ts"])) / 3600, 2)
        checks.append(
            {
                "id": "latest_backup_age",
                "ok": age_hours <= max_age_hours,
                "detail": f"Ultimo backup hace {age_hours}h (max {max_age_hours}h)",
                "severity": "critical" if age_hours > max_age_hours else "ok",
            }
        )
    else:
        checks.append(
            {
                "id": "latest_backup_age",
                "ok": False,
                "detail": "No se encontraron archivos de backup.",
                "severity": "critical",
            }
        )

    db_files = [f for f in artifacts.get("files", []) if str(f.get("name", "")).startswith("db_")]
    olt_files = [f for f in artifacts.get("files", []) if str(f.get("name", "")).startswith("olt_")]
    checks.append(
        {
            "id": "db_backup_present",
            "ok": len(db_files) > 0,
            "detail": f"Backups DB detectados: {len(db_files)}",
            "severity": "critical" if len(db_files) == 0 else "ok",
        }
    )
    checks.append(
        {
            "id": "olt_backup_present",
            "ok": len(olt_files) > 0,
            "detail": f"Backups OLT detectados: {len(olt_files)}",
            "severity": "warning" if len(olt_files) == 0 else "ok",
        }
    )

    latest_db = db_files[0] if db_files else None
    if latest_db:
        db_backup_path = Path(str(artifacts.get("backup_dir") or "")) / str(latest_db.get("name"))
        content_ok = False
        sample = ""
        try:
            with open(db_backup_path, "r", encoding="utf-8", errors="ignore") as fh:
                sample = fh.read(2048)
            markers = ("postgresql", "create table", "insert into", "set search_path")
            content_ok = any(marker in sample.lower() for marker in markers)
        except Exception:
            content_ok = False
        checks.append(
            {
                "id": "db_backup_readable",
                "ok": content_ok,
                "detail": "Cabecera SQL valida para restore drill." if content_ok else "No se pudo validar cabecera SQL del backup DB.",
                "severity": "critical" if not content_ok else "ok",
            }
        )

    passed = all(bool(item.get("ok")) for item in checks if item.get("severity") == "critical")
    status = "completed" if passed else "completed_with_errors"
    summary = {
        "tenant_id": tenant_id,
        "timestamp": _iso_utc_now(),
        "max_backup_age_hours": max_age_hours,
        "checks": checks,
        "artifacts": {
            "backup_dir": artifacts.get("backup_dir"),
            "total_files": len(artifacts.get("files", [])),
            "latest": artifacts.get("latest"),
        },
        "passed": passed,
    }
    return status, summary


def _execute_system_job(job: str, tenant_id) -> tuple[str, dict]:
    try:
        if job == 'backup':
            from app.services.backup_service import run_backups as run_full_backups
            return 'completed', run_full_backups()
        if job == 'cleanup_leases':
            return 'completed', _cleanup_leases_for_tenant(tenant_id)
        if job == 'enforce_billing':
            return _enforce_billing_for_tenant(tenant_id)
        if job == 'recalc_balances':
            return 'completed', _recalculate_invoice_balances(tenant_id)
        if job == 'rotate_passwords':
            return _rotate_mikrotik_passwords(tenant_id)
        if job == 'backup_restore_drill':
            return _run_backup_restore_drill(tenant_id)
        return 'failed', {"error": f"job no soportado: {job}"}
    except Exception as exc:
        current_app.logger.error("System job execution failed for %s: %s", job, exc, exc_info=True)
        return 'failed', {"error": str(exc)}


def _run_system_job_request(job: str, tenant_id, requested_by) -> tuple[dict, int]:
    started_at = datetime.utcnow().replace(microsecond=0)
    entry = {
        "id": secrets.token_hex(8),
        "job": job,
        "status": "started",
        "requested_by": requested_by,
        "started_at": started_at.isoformat(),
    }

    status, result = _execute_system_job(job, tenant_id)
    finished_at = datetime.utcnow().replace(microsecond=0)
    entry["status"] = status
    entry["finished_at"] = finished_at.isoformat()
    entry["result"] = result

    job_row = AdminSystemJob(
        id=entry["id"],
        tenant_id=tenant_id,
        job=job,
        status=status,
        requested_by=requested_by,
        started_at=started_at,
        finished_at=finished_at,
        result=result,
    )
    db.session.add(job_row)
    db.session.commit()

    key = _system_jobs_key(tenant_id)
    jobs = _load_cached_list(key)
    jobs.insert(0, entry)
    _save_cached_list(key, jobs, max_items=200)

    severity_map = {
        "completed": "info",
        "skipped": "info",
        "completed_with_errors": "warning",
        "failed": "critical",
    }
    severity = severity_map.get(status, "warning")
    _notify_incident(f"Job administrativo ejecutado: {job} -> {status}", severity=severity)
    _audit("system_job_run", entity_type="system_job", entity_id=entry["id"], metadata=entry)

    if status == 'failed':
        return {"success": False, "job": entry}, 500
    return {"success": True, "job": entry}, 200


@main_bp.route('/admin/system/settings', methods=['GET'])
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
        }
    ), 200


@main_bp.route('/admin/system/settings', methods=['POST'])
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


@main_bp.route('/admin/system/jobs/history', methods=['GET'])
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


@main_bp.route('/admin/system/jobs/run', methods=['POST'])
@permission_required('system.jobs.run')
def admin_system_jobs_run():
    tenant_id = current_tenant_id()
    data = request.get_json() or {}
    job = (data.get('job') or '').strip().lower()
    if job not in SYSTEM_ALLOWED_JOBS:
        return jsonify({"error": f"job debe ser {' | '.join(sorted(SYSTEM_ALLOWED_JOBS))}"}), 400
    payload, code = _run_system_job_request(job, tenant_id, _current_user_id())
    return jsonify(payload), code


def _ops_score_from_checks(checks: list[dict]) -> int:
    if not checks:
        return 0
    total = 0
    count = 0
    for item in checks:
        count += 1
        total += 100 if item.get("ok") else 0
    return int(round(total / max(1, count)))


@main_bp.route('/admin/ops/sops', methods=['GET'])
@permission_required('ops.sops.read')
def admin_ops_sops_list():
    tenant_id = current_tenant_id()
    sops = _load_ops_sops(tenant_id)
    return jsonify({"items": sops, "count": len(sops)}), 200


@main_bp.route('/admin/ops/sops', methods=['POST'])
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


@main_bp.route('/admin/ops/change-requests', methods=['GET'])
@permission_required('ops.change.read')
def admin_ops_change_requests_list():
    tenant_id = current_tenant_id()
    status_filter = str(request.args.get("status") or "").strip().lower()
    requests_list = _load_ops_change_requests(tenant_id)
    if status_filter:
        requests_list = [item for item in requests_list if str(item.get("status") or "").lower() == status_filter]
    requests_list = sorted(requests_list, key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return jsonify({"items": requests_list[:300], "count": len(requests_list)}), 200


@main_bp.route('/admin/ops/change-requests', methods=['POST'])
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


@main_bp.route('/admin/ops/change-requests/<change_id>', methods=['PATCH'])
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


@main_bp.route('/admin/ops/change-requests/<change_id>/approve', methods=['POST'])
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


@main_bp.route('/admin/ops/preflight/summary', methods=['GET'])
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


@main_bp.route('/admin/ops/slo-summary', methods=['GET'])
@permission_required('ops.slo.read')
def admin_ops_slo_summary():
    tenant_id = current_tenant_id()
    settings = _effective_system_settings(tenant_id)

    try:
        days = int(request.args.get("days", 7) or 7)
    except (TypeError, ValueError):
        days = 7
    days = max(1, min(days, 30))
    since = datetime.utcnow() - timedelta(days=days)

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


@main_bp.route('/admin/ops/collections-summary', methods=['GET'])
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


@main_bp.route('/admin/ops/support-sla-summary', methods=['GET'])
@permission_required('tickets.read')
def admin_ops_support_sla_summary():
    tenant_id = current_tenant_id()
    now_dt = datetime.utcnow()
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

def _sla_due(priority: str) -> datetime:
    now = datetime.utcnow()
    if priority == 'urgent':
        return now + timedelta(hours=2)
    if priority == 'high':
        return now + timedelta(hours=4)
    if priority == 'medium':
        return now + timedelta(hours=24)
    return now + timedelta(hours=48)


@main_bp.route('/tickets', methods=['POST'])
@jwt_required()
def create_ticket():
    data = request.get_json() or {}
    subject = (data.get('subject') or '').strip()
    description = (data.get('description') or '').strip()
    priority = (data.get('priority') or 'medium').lower()
    if not subject or not description:
        return jsonify({"error": "subject y description son requeridos"}), 400
    user_id = _current_user_id()
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404
    tenant_id = current_tenant_id()
    ticket = Ticket(
        subject=subject,
        description=description,
        priority=priority,
        status='open',
        user_id=user_id,
        client_id=user.client.id if user.client else None,
        tenant_id=tenant_id,
        sla_due_at=_sla_due(priority),
    )
    db.session.add(ticket)
    db.session.commit()
    _notify_incident(f"Nuevo ticket: {subject}", severity="warning")
    return jsonify({"ticket": ticket.to_dict()}), 201


def _notify_client(client: Client, subject: str, body: str):
    """Envía correo y push si hay configuración."""
    try:
        mail = current_app.extensions.get('mail')
        if mail and client.user and client.user.email:
            msg = Message(subject=subject, recipients=[client.user.email], body=body, sender=current_app.config.get('MAIL_DEFAULT_SENDER'))
            mail.send(msg)
    except Exception:
        current_app.logger.warning("No se pudo enviar correo al cliente")

    wp_token = current_app.config.get('WONDERPUSH_ACCESS_TOKEN')
    wp_app = current_app.config.get('WONDERPUSH_APPLICATION_ID')
    if wp_token and wp_app:
        try:
            import requests
            payload = {
                "targetSegmentIds": ["all"],
                "notification": {"alert": body[:120], "url": current_app.config.get('FRONTEND_URL')}
            }
            requests.post(
                "https://api.wonderpush.com/v1/deliveries",
                params={"applicationId": wp_app},
                headers={"Authorization": f"Bearer {wp_token}"},
                json=payload,
                timeout=5
            )
        except Exception:
            current_app.logger.warning("No se pudo enviar push al cliente")


@main_bp.route('/admin/routers/<int:router_id>/remote-script', methods=['GET'])
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
    script = f"""/ip service set api disabled=no port={api_port}
/ip service set ssh disabled=no port={ssh_port}
/user add name="{api_user}" password="{api_pass}" group=full comment="Acceso remoto FastISP" disabled=no
/ip firewall address-list add list=fastisp-remote address=YOUR_PUBLIC_IP/32 comment="Autorizar IP de gestión"
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

@main_bp.route('/admin/inventory/categories', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_categories_list():
    tenant_id = current_tenant_id()
    query = _tenant_scoped_query(ProductCategory, tenant_id)
    items = [row.to_dict() for row in query.order_by(ProductCategory.name.asc()).all()]
    return jsonify({"items": items, "count": len(items)}), 200


@main_bp.route('/admin/inventory/categories', methods=['POST'])
@permission_required('inventory.write')
def admin_inventory_categories_create():
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    data = request.get_json() or {}

    name = str(data.get('name') or '').strip()
    description = str(data.get('description') or '').strip()

    if not name:
        return jsonify({"error": "name es requerido"}), 400

    # Check for duplicate name
    existing = _tenant_scoped_query(ProductCategory, tenant_id).filter_by(name=name).first()
    if existing:
        return jsonify({"error": "Ya existe una categoria con ese nombre"}), 409

    category = ProductCategory(
        tenant_id=tenant_id,
        name=name,
        description=description,
        created_by=actor_id,
    )
    db.session.add(category)
    db.session.commit()
    payload = category.to_dict()
    _audit("inventory_category_create", entity_type="inventory_category", entity_id=category.id, metadata=payload)
    return jsonify({"success": True, "category": payload}), 201


@main_bp.route('/admin/inventory/categories/<int:category_id>', methods=['PATCH'])
@permission_required('inventory.write')
def admin_inventory_categories_update(category_id):
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    category = _tenant_scoped_query(ProductCategory, tenant_id).filter_by(id=category_id).first()
    if not category:
        return jsonify({"error": "Categoria no encontrada"}), 404

    data = request.get_json() or {}
    if 'name' in data:
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({"error": "name no puede estar vacio"}), 400
        # Check for duplicate name
        existing = _tenant_scoped_query(ProductCategory, tenant_id).filter_by(name=name).filter(ProductCategory.id != category_id).first()
        if existing:
            return jsonify({"error": "Ya existe una categoria con ese nombre"}), 409
        category.name = name
    if 'description' in data:
        category.description = str(data.get('description') or '').strip()

    db.session.add(category)
    db.session.commit()
    payload = category.to_dict()
    _audit("inventory_category_update", entity_type="inventory_category", entity_id=category.id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "category": payload}), 200


@main_bp.route('/admin/inventory/categories/<int:category_id>', methods=['DELETE'])
@permission_required('inventory.write')
def admin_inventory_categories_delete(category_id):
    tenant_id = current_tenant_id()
    category = _tenant_scoped_query(ProductCategory, tenant_id).filter_by(id=category_id).first()
    if not category:
        return jsonify({"error": "Categoria no encontrada"}), 404

    # Check if category is used by products
    products_count = _tenant_scoped_query(Product, tenant_id).filter_by(category_id=category_id).count()
    if products_count > 0:
        return jsonify({"error": f"No se puede eliminar categoria con {products_count} productos asociados"}), 409

    payload = category.to_dict()
    db.session.delete(category)
    db.session.commit()
    _audit("inventory_category_delete", entity_type="inventory_category", entity_id=category_id, metadata=payload)
    return jsonify({"success": True}), 200


@main_bp.route('/admin/inventory/suppliers', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_suppliers_list():
    tenant_id = current_tenant_id()
    query = _tenant_scoped_query(Supplier, tenant_id)
    items = [row.to_dict() for row in query.order_by(Supplier.name.asc()).all()]
    return jsonify({"items": items, "count": len(items)}), 200


@main_bp.route('/admin/inventory/suppliers', methods=['POST'])
@permission_required('inventory.write')
def admin_inventory_suppliers_create():
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    data = request.get_json() or {}

    name = str(data.get('name') or '').strip()
    contact_name = str(data.get('contact_name') or '').strip()
    email = str(data.get('email') or '').strip()
    phone = str(data.get('phone') or '').strip()
    address = str(data.get('address') or '').strip()
    notes = str(data.get('notes') or '').strip()

    if not name:
        return jsonify({"error": "name es requerido"}), 400

    # Check for duplicate name
    existing = _tenant_scoped_query(Supplier, tenant_id).filter_by(name=name).first()
    if existing:
        return jsonify({"error": "Ya existe un proveedor con ese nombre"}), 409

    supplier = Supplier(
        tenant_id=tenant_id,
        name=name,
        contact_name=contact_name,
        email=email,
        phone=phone,
        address=address,
        notes=notes,
        created_by=actor_id,
    )
    db.session.add(supplier)
    db.session.commit()
    payload = supplier.to_dict()
    _audit("inventory_supplier_create", entity_type="inventory_supplier", entity_id=supplier.id, metadata=payload)
    return jsonify({"success": True, "supplier": payload}), 201


@main_bp.route('/admin/inventory/suppliers/<int:supplier_id>', methods=['PATCH'])
@permission_required('inventory.write')
def admin_inventory_suppliers_update(supplier_id):
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    supplier = _tenant_scoped_query(Supplier, tenant_id).filter_by(id=supplier_id).first()
    if not supplier:
        return jsonify({"error": "Proveedor no encontrado"}), 404

    data = request.get_json() or {}
    if 'name' in data:
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({"error": "name no puede estar vacio"}), 400
        # Check for duplicate name
        existing = _tenant_scoped_query(Supplier, tenant_id).filter_by(name=name).filter(Supplier.id != supplier_id).first()
        if existing:
            return jsonify({"error": "Ya existe un proveedor con ese nombre"}), 409
        supplier.name = name
    if 'contact_name' in data:
        supplier.contact_name = str(data.get('contact_name') or '').strip()
    if 'email' in data:
        supplier.email = str(data.get('email') or '').strip()
    if 'phone' in data:
        supplier.phone = str(data.get('phone') or '').strip()
    if 'address' in data:
        supplier.address = str(data.get('address') or '').strip()
    if 'notes' in data:
        supplier.notes = str(data.get('notes') or '').strip()

    db.session.add(supplier)
    db.session.commit()
    payload = supplier.to_dict()
    _audit("inventory_supplier_update", entity_type="inventory_supplier", entity_id=supplier.id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "supplier": payload}), 200


@main_bp.route('/admin/inventory/suppliers/<int:supplier_id>', methods=['DELETE'])
@permission_required('inventory.write')
def admin_inventory_suppliers_delete(supplier_id):
    tenant_id = current_tenant_id()
    supplier = _tenant_scoped_query(Supplier, tenant_id).filter_by(id=supplier_id).first()
    if not supplier:
        return jsonify({"error": "Proveedor no encontrado"}), 404

    # Check if supplier is used by products
    products_count = _tenant_scoped_query(Product, tenant_id).filter_by(supplier_id=supplier_id).count()
    if products_count > 0:
        return jsonify({"error": f"No se puede eliminar proveedor con {products_count} productos asociados"}), 409

    payload = supplier.to_dict()
    db.session.delete(supplier)
    db.session.commit()
    _audit("inventory_supplier_delete", entity_type="inventory_supplier", entity_id=supplier_id, metadata=payload)
    return jsonify({"success": True}), 200


@main_bp.route('/admin/inventory/products', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_products_list():
    tenant_id = current_tenant_id()
    category_id = _parse_int(request.args.get('category_id'))
    supplier_id = _parse_int(request.args.get('supplier_id'))
    low_stock = _parse_bool(request.args.get('low_stock'))

    query = _tenant_scoped_query(Product, tenant_id).options(joinedload(Product.category), joinedload(Product.supplier))
    if category_id is not None:
        query = query.filter_by(category_id=category_id)
    if supplier_id is not None:
        query = query.filter_by(supplier_id=supplier_id)
    if low_stock:
        query = query.filter(Product.current_stock <= Product.min_stock_level)

    items = [row.to_dict() for row in query.order_by(Product.name.asc()).all()]
    return jsonify({"items": items, "count": len(items)}), 200


@main_bp.route('/admin/inventory/products', methods=['POST'])
@permission_required('inventory.write')
def admin_inventory_products_create():
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    data = request.get_json() or {}

    name = str(data.get('name') or '').strip()
    sku = str(data.get('sku') or '').strip()
    category_id = _parse_int(data.get('category_id'))
    supplier_id = _parse_int(data.get('supplier_id'))
    description = str(data.get('description') or '').strip()
    unit_cost = _parse_money_value(data.get('unit_cost'))
    unit_price = _parse_money_value(data.get('unit_price'))
    current_stock = _parse_int(data.get('current_stock')) or 0
    min_stock_level = _parse_int(data.get('min_stock_level')) or 0
    max_stock_level = _parse_int(data.get('max_stock_level')) or 0
    location = str(data.get('location') or '').strip()

    if not name:
        return jsonify({"error": "name es requerido"}), 400
    if category_id is not None:
        category = _tenant_scoped_query(ProductCategory, tenant_id).filter_by(id=category_id).first()
        if not category:
            return jsonify({"error": "Categoria no encontrada"}), 404
    if supplier_id is not None:
        supplier = _tenant_scoped_query(Supplier, tenant_id).filter_by(id=supplier_id).first()
        if not supplier:
            return jsonify({"error": "Proveedor no encontrado"}), 404

    # Check for duplicate SKU
    if sku:
        existing = _tenant_scoped_query(Product, tenant_id).filter_by(sku=sku).first()
        if existing:
            return jsonify({"error": "Ya existe un producto con ese SKU"}), 409

    product = Product(
        tenant_id=tenant_id,
        name=name,
        sku=sku,
        category_id=category_id,
        supplier_id=supplier_id,
        description=description,
        unit_cost=unit_cost,
        unit_price=unit_price,
        current_stock=current_stock,
        min_stock_level=min_stock_level,
        max_stock_level=max_stock_level,
        location=location,
        created_by=actor_id,
    )
    db.session.add(product)
    db.session.commit()
    payload = product.to_dict()
    _audit("inventory_product_create", entity_type="inventory_product", entity_id=product.id, metadata=payload)
    return jsonify({"success": True, "product": payload}), 201


@main_bp.route('/admin/inventory/products/<int:product_id>', methods=['PATCH'])
@permission_required('inventory.write')
def admin_inventory_products_update(product_id):
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    product = _tenant_scoped_query(Product, tenant_id).filter_by(id=product_id).first()
    if not product:
        return jsonify({"error": "Producto no encontrado"}), 404

    data = request.get_json() or {}
    if 'name' in data:
        name = str(data.get('name') or '').strip()
        if not name:
            return jsonify({"error": "name no puede estar vacio"}), 400
        product.name = name
    if 'sku' in data:
        sku = str(data.get('sku') or '').strip()
        if sku:
            # Check for duplicate SKU
            existing = _tenant_scoped_query(Product, tenant_id).filter_by(sku=sku).filter(Product.id != product_id).first()
            if existing:
                return jsonify({"error": "Ya existe un producto con ese SKU"}), 409
        product.sku = sku
    if 'category_id' in data:
        category_id = _parse_int(data.get('category_id'))
        if category_id is not None:
            category = _tenant_scoped_query(ProductCategory, tenant_id).filter_by(id=category_id).first()
            if not category:
                return jsonify({"error": "Categoria no encontrada"}), 404
        product.category_id = category_id
    if 'supplier_id' in data:
        supplier_id = _parse_int(data.get('supplier_id'))
        if supplier_id is not None:
            supplier = _tenant_scoped_query(Supplier, tenant_id).filter_by(id=supplier_id).first()
            if not supplier:
                return jsonify({"error": "Proveedor no encontrado"}), 404
        product.supplier_id = supplier_id
    if 'description' in data:
        product.description = str(data.get('description') or '').strip()
    if 'unit_cost' in data:
        product.unit_cost = _parse_money_value(data.get('unit_cost'))
    if 'unit_price' in data:
        product.unit_price = _parse_money_value(data.get('unit_price'))
    if 'current_stock' in data:
        product.current_stock = _parse_int(data.get('current_stock')) or 0
    if 'min_stock_level' in data:
        product.min_stock_level = _parse_int(data.get('min_stock_level')) or 0
    if 'max_stock_level' in data:
        product.max_stock_level = _parse_int(data.get('max_stock_level')) or 0
    if 'location' in data:
        product.location = str(data.get('location') or '').strip()

    db.session.add(product)
    db.session.commit()
    payload = product.to_dict()
    _audit("inventory_product_update", entity_type="inventory_product", entity_id=product.id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "product": payload}), 200


@main_bp.route('/admin/inventory/products/<int:product_id>', methods=['DELETE'])
@permission_required('inventory.write')
def admin_inventory_products_delete(product_id):
    tenant_id = current_tenant_id()
    product = _tenant_scoped_query(Product, tenant_id).filter_by(id=product_id).first()
    if not product:
        return jsonify({"error": "Producto no encontrado"}), 404

    # Check if product has movements
    movements_count = _tenant_scoped_query(InventoryMovement, tenant_id).filter_by(product_id=product_id).count()
    if movements_count > 0:
        return jsonify({"error": f"No se puede eliminar producto con {movements_count} movimientos asociados"}), 409

    payload = product.to_dict()
    db.session.delete(product)
    db.session.commit()
    _audit("inventory_product_delete", entity_type="inventory_product", entity_id=product_id, metadata=payload)
    return jsonify({"success": True}), 200


@main_bp.route('/admin/inventory/movements', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_movements_list():
    tenant_id = current_tenant_id()
    product_id = _parse_int(request.args.get('product_id'))
    movement_type = str(request.args.get('type') or '').strip().lower()
    start_date = _parse_iso_datetime(request.args.get('start_date'))
    end_date = _parse_iso_datetime(request.args.get('end_date'))

    query = _tenant_scoped_query(InventoryMovement, tenant_id).options(joinedload(InventoryMovement.product))
    if product_id is not None:
        query = query.filter_by(product_id=product_id)
    if movement_type and movement_type in {'in', 'out', 'adjustment'}:
        query = query.filter_by(movement_type=movement_type)
    if start_date:
        query = query.filter(InventoryMovement.created_at >= start_date)
    if end_date:
        query = query.filter(InventoryMovement.created_at <= end_date)

    items = [row.to_dict() for row in query.order_by(InventoryMovement.created_at.desc()).limit(500).all()]
    return jsonify({"items": items, "count": len(items)}), 200


@main_bp.route('/admin/inventory/movements', methods=['POST'])
@permission_required('inventory.write')
def admin_inventory_movements_create():
    tenant_id = current_tenant_id()
    actor_id = _current_user_id()
    data = request.get_json() or {}

    product_id = _parse_int(data.get('product_id'))
    movement_type = str(data.get('movement_type') or '').strip().lower()
    quantity = _parse_int(data.get('quantity'))
    unit_cost = _parse_money_value(data.get('unit_cost'))
    notes = str(data.get('notes') or '').strip()

    if product_id is None:
        return jsonify({"error": "product_id es requerido"}), 400
    if movement_type not in {'in', 'out', 'adjustment'}:
        return jsonify({"error": "movement_type debe ser 'in', 'out' o 'adjustment'"}), 400
    if quantity is None or quantity <= 0:
        return jsonify({"error": "quantity debe ser mayor a 0"}), 400

    product = _tenant_scoped_query(Product, tenant_id).filter_by(id=product_id).first()
    if not product:
        return jsonify({"error": "Producto no encontrado"}), 404

    # Calculate new stock
    if movement_type == 'in':
        new_stock = product.current_stock + quantity
    elif movement_type == 'out':
        if product.current_stock < quantity:
            return jsonify({"error": f"Stock insuficiente. Disponible: {product.current_stock}"}), 409
        new_stock = product.current_stock - quantity
    else:  # adjustment
        new_stock = quantity

    movement = InventoryMovement(
        tenant_id=tenant_id,
        product_id=product_id,
        movement_type=movement_type,
        quantity=quantity,
        previous_stock=product.current_stock,
        new_stock=new_stock,
        unit_cost=unit_cost,
        notes=notes,
        created_by=actor_id,
    )
    product.current_stock = new_stock

    db.session.add(movement)
    db.session.add(product)
    db.session.commit()
    payload = movement.to_dict()
    _audit("inventory_movement_create", entity_type="inventory_movement", entity_id=movement.id, metadata=payload)
    return jsonify({"success": True, "movement": payload, "product": product.to_dict()}), 201


@main_bp.route('/admin/inventory/movements/<int:movement_id>', methods=['PATCH'])
@permission_required('inventory.write')
def admin_inventory_movements_update(movement_id):
    tenant_id = current_tenant_id()
    movement = _tenant_scoped_query(InventoryMovement, tenant_id).filter_by(id=movement_id).first()
    if not movement:
        return jsonify({"error": "Movimiento no encontrado"}), 404

    data = request.get_json() or {}
    if 'notes' in data:
        movement.notes = str(data.get('notes') or '').strip()

    db.session.add(movement)
    db.session.commit()
    payload = movement.to_dict()
    _audit("inventory_movement_update", entity_type="inventory_movement", entity_id=movement.id, metadata={"changes": list(data.keys())})
    return jsonify({"success": True, "movement": payload}), 200


@main_bp.route('/admin/inventory/movements/<int:movement_id>', methods=['DELETE'])
@permission_required('inventory.write')
def admin_inventory_movements_delete(movement_id):
    tenant_id = current_tenant_id()
    movement = _tenant_scoped_query(InventoryMovement, tenant_id).filter_by(id=movement_id).first()
    if not movement:
        return jsonify({"error": "Movimiento no encontrado"}), 404

    # Reverse the stock change
    product = _tenant_scoped_query(Product, tenant_id).filter_by(id=movement.product_id).first()
    if product:
        if movement.movement_type == 'in':
            product.current_stock -= movement.quantity
        elif movement.movement_type == 'out':
            product.current_stock += movement.quantity
        else:  # adjustment
            product.current_stock = movement.previous_stock
        db.session.add(product)

    payload = movement.to_dict()
    db.session.delete(movement)
    db.session.commit()
    _audit("inventory_movement_delete", entity_type="inventory_movement", entity_id=movement_id, metadata=payload)
    return jsonify({"success": True}), 200


@main_bp.route('/admin/inventory/reports/low-stock', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_reports_low_stock():
    tenant_id = current_tenant_id()
    query = _tenant_scoped_query(Product, tenant_id).options(joinedload(Product.category), joinedload(Product.supplier))
    query = query.filter(Product.current_stock <= Product.min_stock_level)

    items = [row.to_dict() for row in query.order_by((Product.min_stock_level - Product.current_stock).desc()).all()]
    summary = {
        "total_low_stock": len(items),
        "critical_count": sum(1 for item in items if item.get('current_stock', 0) == 0),
        "warning_count": sum(1 for item in items if 0 < item.get('current_stock', 0) <= item.get('min_stock_level', 0)),
    }
    return jsonify({"items": items, "count": len(items), "summary": summary}), 200


@main_bp.route('/admin/inventory/reports/stock-value', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_reports_stock_value():
    tenant_id = current_tenant_id()
    products = _tenant_scoped_query(Product, tenant_id).options(joinedload(Product.category)).all()

    total_value = 0.0
    items = []
    for product in products:
        value = float(product.current_stock or 0) * float(product.unit_cost or 0)
        total_value += value
        items.append({
            "product_id": product.id,
            "product_name": product.name,
            "sku": product.sku,
            "category": product.category.name if product.category else None,
            "current_stock": product.current_stock,
            "unit_cost": product.unit_cost,
            "total_value": round(value, 2),
        })

    items.sort(key=lambda x: x['total_value'], reverse=True)
    return jsonify({
        "items": items,
        "count": len(items),
        "summary": {
            "total_value": round(total_value, 2),
            "total_products": len(products),
            "products_with_stock": sum(1 for p in products if p.current_stock > 0),
        }
    }), 200


@main_bp.route('/admin/inventory/reports/movements-summary', methods=['GET'])
@permission_required('inventory.read')
def admin_inventory_reports_movements_summary():
    tenant_id = current_tenant_id()
    start_date = _parse_iso_datetime(request.args.get('start_date'))
    end_date = _parse_iso_datetime(request.args.get('end_date'))

    if not start_date:
        start_date = datetime.utcnow().replace(day=1)  # First day of current month
    if not end_date:
        end_date = datetime.utcnow()

    query = _tenant_scoped_query(InventoryMovement, tenant_id)
    query = query.filter(InventoryMovement.created_at >= start_date, InventoryMovement.created_at <= end_date)

    movements = query.all()
    summary = {
        "period": {
            "start_date": start_date.isoformat() + "Z",
            "end_date": end_date.isoformat() + "Z",
        },
        "totals": {
            "in": sum(m.quantity for m in movements if m.movement_type == 'in'),
            "out": sum(m.quantity for m in movements if m.movement_type == 'out'),
            "adjustments": sum(m.quantity for m in movements if m.movement_type == 'adjustment'),
        },
        "movements_count": len(movements),
        "products_affected": len(set(m.product_id for m in movements)),
    }
    return jsonify(summary), 200




