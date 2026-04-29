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
import uuid

from flask import Blueprint, jsonify, request, Response, current_app, send_file
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required, verify_jwt_in_request

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
from app.services.ai_diagnostic_service import AIDiagnosticService
from app.services.ai_support_service import AISupportService
from app.services.pdf_service import PDFService
from app.services.billing_service import billing_service
from app.services.mikrotik_service import MikroTikService
from app.services.branding_service import BrandingService
from app.services.monitoring_service import MonitoringService
from app.services.snmp_service import snmp_service
from app.lib.messaging import MessagingManager
from app.tenancy import current_tenant_id, tenant_access_allowed
from datetime import date
from werkzeug.exceptions import BadRequest
from sqlalchemy.orm import joinedload
from sqlalchemy import or_
import subprocess
import os
import shutil
import shlex
from flask_mail import Message
from flask import send_from_directory
from pathlib import Path




auth_bp = Blueprint('auth', __name__)

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


def _metric_float(value) -> float | None:
    try:
        if value is None or str(value).strip() == "":
            return None
        return float(value)
    except (TypeError, ValueError):
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
    "vps_update_preflight",
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

    monitoring = None
    for router in routers_q.filter_by(is_active=True).all():
        profile = snmp_service.router_profile(router)
        if not profile.get("enabled"):
            continue
        try:
            if monitoring is None:
                monitoring = MonitoringService()
            latest = monitoring.latest_point('snmp_device_health', tags={'router_id': str(router.id)})
        except Exception:
            latest = {}
        if not latest:
            continue

        thresholds = dict(profile.get("thresholds") or {})
        temperature_c = _metric_float(latest.get("temperature_c"))
        if temperature_c is not None and temperature_c >= float(thresholds.get("temperature_c", 70.0)):
            alerts.append(
                {
                    "id": f"AL-SNMP-TEMP-{router.id}",
                    "severity": "critical",
                    "scope": "snmp",
                    "target": router.name,
                    "message": f"Temperatura alta por SNMP: {temperature_c:.1f} C",
                    "since": str(latest.get("_time") or now_iso),
                }
            )

        voltage_v = _metric_float(latest.get("voltage_v"))
        min_voltage = _metric_float(thresholds.get("voltage_v_min"))
        if voltage_v is not None and min_voltage is not None and voltage_v <= min_voltage:
            alerts.append(
                {
                    "id": f"AL-SNMP-VOLT-{router.id}",
                    "severity": "warning",
                    "scope": "snmp",
                    "target": router.name,
                    "message": f"Voltaje bajo por SNMP: {voltage_v:.2f} V",
                    "since": str(latest.get("_time") or now_iso),
                }
            )

        optical_rx_dbm = _metric_float(latest.get("optical_rx_dbm"))
        optical_min = _metric_float(thresholds.get("optical_rx_dbm_min"))
        if optical_rx_dbm is not None and optical_min is not None and optical_rx_dbm <= optical_min:
            alerts.append(
                {
                    "id": f"AL-SNMP-OPTICS-{router.id}",
                    "severity": "warning",
                    "scope": "fiber",
                    "target": router.name,
                    "message": f"Potencia optica degradada: {optical_rx_dbm:.1f} dBm",
                    "since": str(latest.get("_time") or now_iso),
                }
            )

        signal_level_dbm = _metric_float(latest.get("signal_level_dbm"))
        signal_min = _metric_float(thresholds.get("signal_level_dbm_min"))
        if signal_level_dbm is not None and signal_min is not None and signal_level_dbm <= signal_min:
            alerts.append(
                {
                    "id": f"AL-SNMP-SIGNAL-{router.id}",
                    "severity": "warning",
                    "scope": "wireless",
                    "target": router.name,
                    "message": f"Senal degradada por SNMP: {signal_level_dbm:.1f} dBm",
                    "since": str(latest.get("_time") or now_iso),
                }
            )

    for trap in snmp_service.list_recent_traps(tenant_id, limit=10):
        alerts.append(
            {
                "id": str(trap.get("id") or f"AL-SNMP-TRAP-{uuid.uuid4().hex[:8]}"),
                "severity": str(trap.get("severity") or "warning"),
                "scope": str(trap.get("scope") or "snmp"),
                "target": str(trap.get("target") or trap.get("source") or "SNMP"),
                "message": str(trap.get("message") or "Trap SNMP recibido"),
                "since": str(trap.get("received_at") or now_iso),
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


def _collect_admin_clients(tenant_id, term: str | None = None, status_filter: str | None = None, plan_id: int | None = None, page: int = 1, per_page: int = 50) -> dict:
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

    # Nota: El filtrado por status y term sigue siendo en Python por la complejidad de subscriptions[0].status
    # pero ahora solo devolvemos una pagina.
    # TODO: Refactorizar status a un campo denormalizado en Client para filtrado SQL real.
    
    normalized_term = str(term or '').strip().lower()
    normalized_status = str(status_filter or '').strip().lower()
    
    all_items: list[dict] = []
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
        all_items.append(payload)
    
    total = len(all_items)
    start = (page - 1) * per_page
    end = start + per_page
    
    return {
        "items": all_items[start:end],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page
    }


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


def _resolve_deploy_path(project_root: Path, configured: str | None, fallback: str) -> Path:
    raw = str(configured or fallback).strip() or fallback
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = project_root / candidate
    return candidate


def _run_vps_update_preflight(tenant_id) -> tuple[str, dict]:
    settings = _effective_system_settings(tenant_id)
    project_root_raw = str(current_app.config.get('DEPLOY_PROJECT_ROOT') or '/root/fastisp').strip() or '/root/fastisp'
    project_root = Path(project_root_raw).expanduser()
    compose_path = _resolve_deploy_path(
        project_root,
        current_app.config.get('DEPLOY_COMPOSE_FILE'),
        'docker-compose.prod.yml',
    )
    env_path = _resolve_deploy_path(
        project_root,
        current_app.config.get('DEPLOY_ENV_FILE'),
        '.env.prod',
    )
    services = current_app.config.get('DEPLOY_SERVICES') or ['backend', 'celery-worker', 'celery-beat', 'frontend']
    if isinstance(services, str):
        services = [item.strip() for item in services.split(',') if item.strip()]
    services = [str(item).strip() for item in services if str(item).strip()]
    if not services:
        services = ['backend', 'celery-worker', 'celery-beat', 'frontend']

    try:
        min_disk_gb = float(current_app.config.get('VPS_UPDATE_MIN_DISK_GB', '2') or 2)
    except (TypeError, ValueError):
        min_disk_gb = 2.0
    min_disk_gb = max(0.5, min(min_disk_gb, 200.0))

    try:
        max_backup_age_hours = float(current_app.config.get('VPS_UPDATE_MAX_BACKUP_AGE_HOURS', '24') or 24)
    except (TypeError, ValueError):
        max_backup_age_hours = 24.0
    max_backup_age_hours = max(1.0, min(max_backup_age_hours, 24 * 30))

    checks: list[dict] = []
    blockers: list[dict] = []

    checks.append(
        {
            "id": "project_root",
            "ok": project_root.exists() and project_root.is_dir(),
            "detail": f"Proyecto esperado en {project_root}",
            "severity": "critical" if not (project_root.exists() and project_root.is_dir()) else "ok",
        }
    )
    checks.append(
        {
            "id": "compose_file",
            "ok": compose_path.exists() and compose_path.is_file(),
            "detail": f"Compose esperado en {compose_path}",
            "severity": "critical" if not (compose_path.exists() and compose_path.is_file()) else "ok",
        }
    )
    checks.append(
        {
            "id": "env_file",
            "ok": env_path.exists() and env_path.is_file(),
            "detail": f"Env esperado en {env_path}",
            "severity": "warning" if not (env_path.exists() and env_path.is_file()) else "ok",
        }
    )

    migrations_path = project_root / 'backend' / 'migrations'
    checks.append(
        {
            "id": "alembic_migrations",
            "ok": migrations_path.exists() and migrations_path.is_dir(),
            "detail": f"Migraciones detectadas en {migrations_path}",
            "severity": "critical" if not (migrations_path.exists() and migrations_path.is_dir()) else "ok",
        }
    )

    disk_probe = project_root if project_root.exists() else Path.cwd()
    try:
        usage = shutil.disk_usage(disk_probe)
        free_gb = round(usage.free / (1024 ** 3), 2)
        total_gb = round(usage.total / (1024 ** 3), 2)
        disk_ok = free_gb >= min_disk_gb
        checks.append(
            {
                "id": "disk_free_space",
                "ok": disk_ok,
                "detail": f"Libre {free_gb} GB de {total_gb} GB (min {min_disk_gb} GB)",
                "severity": "critical" if not disk_ok else "ok",
            }
        )
    except Exception as exc:
        checks.append(
            {
                "id": "disk_free_space",
                "ok": False,
                "detail": f"No se pudo medir espacio libre: {exc}",
                "severity": "warning",
            }
        )

    artifacts = _backup_artifacts_summary()
    latest = artifacts.get("latest")
    if latest and latest.get("modified_ts"):
        age_hours = round((time.time() - float(latest["modified_ts"])) / 3600, 2)
        backup_ok = age_hours <= max_backup_age_hours
        checks.append(
            {
                "id": "backup_recency",
                "ok": backup_ok,
                "detail": f"Ultimo backup hace {age_hours}h (max {max_backup_age_hours}h)",
                "severity": "critical" if not backup_ok else "ok",
            }
        )
    else:
        age_hours = None
        checks.append(
            {
                "id": "backup_recency",
                "ok": False,
                "detail": "No se detectaron backups recientes para rollback.",
                "severity": "critical",
            }
        )

    db_files = [f for f in artifacts.get("files", []) if str(f.get("name", "")).startswith("db_")]
    checks.append(
        {
            "id": "db_backup_available",
            "ok": len(db_files) > 0,
            "detail": f"Backups DB detectados: {len(db_files)}",
            "severity": "critical" if len(db_files) == 0 else "ok",
        }
    )

    docker_bin = shutil.which('docker')
    docker_ok = bool(docker_bin)
    docker_compose_version = ''
    if docker_ok:
        try:
            version_cmd = subprocess.run(
                [docker_bin, 'compose', 'version'],
                capture_output=True,
                text=True,
                timeout=6,
                check=False,
            )
            docker_compose_version = str(version_cmd.stdout or version_cmd.stderr or '').strip()
            docker_ok = version_cmd.returncode == 0
        except Exception as exc:
            docker_ok = False
            docker_compose_version = str(exc)
    checks.append(
        {
            "id": "docker_compose_runtime",
            "ok": docker_ok,
            "detail": docker_compose_version or 'docker compose no disponible en este runtime',
            "severity": "warning" if not docker_ok else "ok",
        }
    )

    health = _build_network_health_payload(tenant_id)
    health_score = float(health.get('score') or 0)
    health_ok = health_score >= 60
    checks.append(
        {
            "id": "network_health",
            "ok": health_ok,
            "detail": f"Network health score {health_score}/100",
            "severity": "ok" if health_score >= 60 else "warning" if health_score >= 40 else "critical",
        }
    )

    change_control_required = bool(settings.get('change_control_required_for_live', True))
    approved_changes = [
        item for item in _load_ops_change_requests(tenant_id)
        if str(item.get('status') or '').lower() in {'approved', 'scheduled', 'executing'}
    ]
    change_ok = (not change_control_required) or bool(approved_changes)
    checks.append(
        {
            "id": "change_window",
            "ok": change_ok,
            "detail": (
                f"Cambios aprobados/scheduled disponibles: {len(approved_changes)}"
                if change_control_required
                else 'Control de cambios live deshabilitado para este tenant.'
            ),
            "severity": "warning" if not change_ok else "ok",
        }
    )

    for item in checks:
        if not item.get('ok') and item.get('severity') == 'critical':
            blockers.append({"id": str(item.get('id')), "detail": str(item.get('detail') or '')})

    quoted_project = shlex.quote(str(project_root))
    quoted_compose = shlex.quote(str(compose_path))
    quoted_env = shlex.quote(str(env_path))
    services_args = ' '.join(shlex.quote(service) for service in services)
    commands = [
        f"cd {quoted_project}",
        f"docker compose -f {quoted_compose} --env-file {quoted_env} pull {services_args}".strip(),
        f"docker compose -f {quoted_compose} --env-file {quoted_env} up -d --build {services_args}".strip(),
        f"docker compose -f {quoted_compose} --env-file {quoted_env} exec backend flask db upgrade",
        f"docker compose -f {quoted_compose} --env-file {quoted_env} exec -T backend curl -fsS http://localhost:5000/api/health",
    ]

    repo_root = Path(__file__).resolve().parents[3]

    score = _ops_score_from_checks(checks)
    passed = len(blockers) == 0
    status = 'completed' if passed else 'completed_with_errors'
    summary = {
        "tenant_id": tenant_id,
        "timestamp": _iso_utc_now(),
        "score": score,
        "passed": passed,
        "checks": checks,
        "blockers": blockers,
        "deployment": {
            "project_root": str(project_root),
            "compose_file": str(compose_path),
            "env_file": str(env_path),
            "services": services,
            "docker_available": bool(docker_bin),
            "docker_runtime_ok": docker_ok,
            "commands": commands,
            "scripts": [
                {"name": "deploy_fastisp.py", "path": str((repo_root.parent / 'deploy_fastisp.py').resolve())},
                {"name": "push_to_vps.py", "path": str((repo_root.parent / 'push_to_vps.py').resolve())},
            ],
        },
        "artifacts": {
            "backup_dir": artifacts.get("backup_dir"),
            "latest": latest,
            "db_backups": len(db_files),
            "latest_backup_age_hours": age_hours,
        },
        "health": health,
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
        if job == 'vps_update_preflight':
            return _run_vps_update_preflight(tenant_id)
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


def _ops_score_from_checks(checks: list[dict]) -> int:
    if not checks:
        return 0
    total = 0
    count = 0
    for item in checks:
        count += 1
        total += 100 if item.get("ok") else 0
    return int(round(total / max(1, count)))


def _sla_due(priority: str) -> datetime:
    now = datetime.utcnow()
    if priority == 'urgent':
        return now + timedelta(hours=2)
    if priority == 'high':
        return now + timedelta(hours=4)
    if priority == 'medium':
        return now + timedelta(hours=24)
    return now + timedelta(hours=48)


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




# --- ROUTES ---

@auth_bp.route('/auth/login', methods=['POST'])
@limiter.limit("5 per minute")
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



@auth_bp.route('/auth/password/forgot', methods=['POST'])
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



@auth_bp.route('/auth/password/reset', methods=['POST'])
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



@auth_bp.route('/auth/register', methods=['POST'])
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



@auth_bp.route('/auth/google', methods=['POST'])
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



@auth_bp.route('/auth/profile', methods=['PUT'])
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



@auth_bp.route('/auth/password', methods=['POST'])
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



@auth_bp.route('/auth/mfa/setup', methods=['GET'])
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



@auth_bp.route('/auth/mfa/enable', methods=['POST'])
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



@auth_bp.route('/auth/mfa/disable', methods=['POST'])
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



