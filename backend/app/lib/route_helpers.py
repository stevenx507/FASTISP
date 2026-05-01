"""
app/lib/route_helpers.py
========================
Funciones y constantes compartidas entre los distintos blueprints.

Antes estas utilidades estaban duplicadas en billing_routes.py y
support_routes.py (> 600 líneas repetidas). Centralizar aquí garantiza que
un fix se aplique a todos los módulos al mismo tiempo.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import string
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import current_app
from sqlalchemy import or_

from app import cache, db
from app.models import AdminSystemSetting, Invoice, Subscription, User


# ─── Constantes de dominio ────────────────────────────────────────────────────

STAFF_ALLOWED_ROLES: set[str] = {"admin", "tech", "support", "billing", "noc", "operator"}
PLATFORM_ADMIN_ROLE: str = "platform_admin"

TENANT_BILLING_ALLOWED_STATUS: set[str] = {
    "trial", "active", "past_due", "suspended", "cancelled"
}
TENANT_BILLING_ALLOWED_CYCLES: set[str] = {"monthly", "quarterly", "yearly"}

TENANT_PLAN_TEMPLATES: dict[str, dict] = {
    "starter": {
        "monthly_price": 8.0,
        "max_admins": 2,
        "max_routers": 5,
        "max_clients": 300,
    },
    "growth": {
        "monthly_price": 12.0,
        "max_admins": 5,
        "max_routers": 20,
        "max_clients": 800,
    },
    "pro": {
        "monthly_price": 15.0,
        "max_admins": 10,
        "max_routers": 60,
        "max_clients": 2000,
    },
    "enterprise": {
        "monthly_price": 399.0,
        "max_admins": 30,
        "max_routers": 250,
        "max_clients": 50000,
    },
}

STAFF_ALLOWED_STATUS: set[str] = {"active", "on_leave", "inactive"}
STAFF_ALLOWED_SHIFTS: set[str] = {"day", "night", "mixed"}
INSTALLATION_ALLOWED_STATUS: set[str] = {
    "pending", "scheduled", "in_progress", "completed", "cancelled"
}
SCREEN_ALERT_ALLOWED_STATUS: set[str] = {"draft", "active", "paused", "expired"}
SCREEN_ALERT_ALLOWED_SEVERITY: set[str] = {"info", "warning", "critical", "success"}
SCREEN_ALERT_ALLOWED_AUDIENCE: set[str] = {"all", "active", "overdue", "suspended"}
EXTRA_SERVICE_ALLOWED_STATUS: set[str] = {"active", "disabled"}
HOTSPOT_VOUCHER_ALLOWED_STATUS: set[str] = {
    "generated", "sold", "used", "expired", "cancelled"
}
SYSTEM_ALLOWED_JOBS: set[str] = {
    "backup",
    "cleanup_leases",
    "rotate_passwords",
    "recalc_balances",
    "enforce_billing",
    "backup_restore_drill",
    "vps_update_preflight",
}
TICKET_ALLOWED_PRIORITIES: set[str] = {"low", "medium", "high", "urgent"}
OPS_CHANGE_ALLOWED_STATUS: set[str] = {
    "requested", "approved", "scheduled", "executing",
    "done", "rolled_back", "rejected", "cancelled",
}

ROLE_BASE_PERMISSIONS: dict[str, set[str]] = {
    PLATFORM_ADMIN_ROLE: {"*"},
    "admin": {"*"},
    "noc": {
        "dashboard.read", "network.read", "network.alerts.read",
        "network.maintenance.read", "network.maintenance.write",
        "ops.preflight.read", "ops.slo.read", "ops.sops.read",
        "ops.change.read", "tickets.read",
    },
    "tech": {
        "dashboard.read", "clients.read", "installations.read",
        "installations.write", "ops.sops.read", "ops.change.read",
        "tickets.read", "tickets.write", "network.read",
    },
    "support": {
        "clients.read", "tickets.read", "tickets.write", "notifications.read",
    },
    "billing": {
        "billing.read", "billing.write", "billing.promises.read",
        "billing.promises.write", "payments.review", "clients.read",
    },
    "operator": {
        "dashboard.read", "clients.read", "tickets.read", "notifications.read",
    },
    "client": {"client.portal.read"},
}

PERMISSION_CATALOG: list[str] = sorted(
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


# ─── Parsers y utilidades básicas ─────────────────────────────────────────────

def parse_int(value) -> int | None:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def parse_bool(value) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return bool(value) if value in (0, 1) else None
    token = str(value or '').strip().lower()
    if token in {'1', 'true', 'yes', 'y', 'on'}:
        return True
    if token in {'0', 'false', 'no', 'n', 'off'}:
        return False
    return None


def parse_iso_datetime(value) -> datetime | None:
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


def metric_float(value) -> float | None:
    try:
        if value is None or str(value).strip() == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def slugify(text: str) -> str:
    return ''.join(ch.lower() if ch.isalnum() else '-' for ch in text).strip('-')


def mask_secret(value: str | None) -> str:
    token = str(value or '')
    if len(token) <= 4:
        return '*' * len(token)
    return f"{token[:2]}***{token[-2:]}"


# ─── Trial / billing helpers ──────────────────────────────────────────────────

def tenant_default_trial_days() -> int:
    default_days = 30
    try:
        configured = int(current_app.config.get('TENANT_DEFAULT_TRIAL_DAYS', default_days))
    except (TypeError, ValueError):
        configured = default_days
    return max(1, min(configured, 365))


def tenant_default_trial_ends_at() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=tenant_default_trial_days())


def password_reset_token_ttl_seconds() -> int:
    default_minutes = 30
    try:
        configured = int(current_app.config.get('PASSWORD_RESET_TOKEN_TTL_MINUTES', default_minutes))
    except (TypeError, ValueError):
        configured = default_minutes
    return max(5, min(configured, 240)) * 60


def password_reset_key(token: str) -> str:
    return f"password_reset:{token}"


def password_rotation_dry_run_enabled() -> bool:
    parsed = parse_bool(current_app.config.get('ROTATE_PASSWORDS_DRY_RUN'))
    return False if parsed is None else parsed


def password_rotation_length() -> int:
    default_length = 24
    try:
        configured = int(current_app.config.get('PASSWORD_ROTATION_LENGTH', default_length))
    except (TypeError, ValueError):
        configured = default_length
    return max(16, min(configured, 64))


def generate_router_password(length: int | None = None) -> str:
    target_length = max(16, length or password_rotation_length())
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


# ─── Sistema de configuración por tenant ──────────────────────────────────────

def tenant_cache_key(prefix: str, tenant_id) -> str:
    scoped = tenant_id if tenant_id is not None else "global"
    return f"{prefix}:{scoped}"


def system_settings_key(tenant_id) -> str:
    return tenant_cache_key("admin_system_settings", tenant_id)


def load_cached_dict(key: str) -> dict:
    return cache.get(key) or {}


def save_cached_dict(key: str, data: dict) -> None:
    cache.set(key, data, timeout=86400 * 30)


def load_cached_list(key: str) -> list[dict]:
    return cache.get(key) or []


def save_cached_list(key: str, items: list[dict], max_items: int = 500) -> None:
    cache.set(key, items[:max_items], timeout=86400 * 30)


def tenant_scoped_query(model, tenant_id):
    query = model.query
    if tenant_id is None:
        return query.filter(model.tenant_id.is_(None))
    return query.filter(model.tenant_id == tenant_id)


def load_system_settings_overrides_db(tenant_id) -> dict:
    rows = tenant_scoped_query(AdminSystemSetting, tenant_id).all()
    return {row.key: row.value for row in rows}


def effective_system_settings(tenant_id) -> dict:
    from app.lib.route_helpers import _default_system_settings  # evitar import circular
    try:
        defaults = _default_system_settings()
    except Exception:
        defaults = {}
    overrides = load_system_settings_overrides_db(tenant_id)
    if not overrides:
        overrides = load_cached_dict(system_settings_key(tenant_id))
    return {**defaults, **(overrides or {})}


def _default_system_settings() -> dict:
    """Retorna los valores por defecto del sistema. Import lazy para evitar circulares."""
    try:
        from app.routes.billing_routes import _default_system_settings as _ds
        return _ds()
    except ImportError:
        return {}


def password_policy_min_length(tenant_id) -> int:
    settings = effective_system_settings(tenant_id)
    raw_value = settings.get("password_policy_min_length", 10)
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = 10
    return max(8, min(parsed, 64))


def validate_password_policy(password: str, tenant_id) -> tuple[bool, str]:
    secret = str(password or "")
    minimum = password_policy_min_length(tenant_id)
    if len(secret) < minimum:
        return False, f"La contrasena debe tener al menos {minimum} caracteres."
    has_upper = any(ch.isupper() for ch in secret)
    has_lower = any(ch.islower() for ch in secret)
    has_digit = any(ch.isdigit() for ch in secret)
    has_symbol = any(not ch.isalnum() for ch in secret)
    if not (has_upper and has_lower and has_digit and has_symbol):
        return False, "La contrasena debe incluir mayuscula, minuscula, numero y simbolo."
    return True, ""


# ─── Backup helpers ───────────────────────────────────────────────────────────

def backup_dir_path() -> Path:
    import os
    configured = (
        current_app.config.get('BACKUP_DIR')
        or os.environ.get('BACKUP_DIR')
        or '/app/backups'
    )
    return Path(str(configured).strip() or '/app/backups').expanduser().resolve()


def ensure_backup_dir() -> Path:
    base = backup_dir_path()
    base.mkdir(parents=True, exist_ok=True)
    return base


def is_safe_backup_name(name: str | None) -> bool:
    candidate = str(name or '').strip()
    if not candidate:
        return False
    return Path(candidate).name == candidate and '/' not in candidate and '\\' not in candidate


def normalized_retention_days(raw_value, default_days: int = 14) -> int:
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = default_days
    return max(1, min(parsed, 365))


# ─── Stripe helpers ───────────────────────────────────────────────────────────

def parse_stripe_signature_header(signature_header: str) -> tuple[int | None, list[str]]:
    timestamp = None
    signatures: list[str] = []
    for part in str(signature_header or "").split(","):
        key, sep, value = part.partition("=")
        if not sep:
            continue
        key, value = key.strip(), value.strip()
        if key == "t":
            timestamp = parse_int(value)
        elif key == "v1" and value:
            signatures.append(value)
    return timestamp, signatures


def verify_stripe_signature(
    payload: bytes,
    signature_header: str,
    secret: str,
    tolerance_seconds: int = 300,
) -> bool:
    timestamp, signatures = parse_stripe_signature_header(signature_header)
    if timestamp is None or not signatures or not secret:
        return False
    if tolerance_seconds > 0 and abs(int(time.time()) - timestamp) > tolerance_seconds:
        return False
    try:
        payload_text = payload.decode('utf-8')
    except Exception:
        return False
    signed_payload = f"{timestamp}.{payload_text}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in signatures)


# ─── Invoice helpers ──────────────────────────────────────────────────────────

def client_invoice_payload(invoice: "Invoice") -> dict:
    payload = invoice.to_dict()
    payload["due"] = payload.get("due_date")
    payload["total"] = payload.get("total_amount")
    return payload


def get_user_invoice_items(user: "User", tenant_id) -> list[dict]:
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
        client_invoice_payload(invoice)
        for invoice in query.order_by(Invoice.created_at.desc()).all()
    ]
