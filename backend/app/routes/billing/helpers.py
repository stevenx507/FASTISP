import csv
import hashlib
import hmac
import io
import json
import secrets
import string
import time
import uuid
from datetime import datetime, timedelta, timezone, date
from pathlib import Path
import requests
from flask import current_app, request, jsonify
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import or_

from app import db, cache, mail
from app.models import (
    User, Tenant, Client, Plan, Subscription, Invoice, 
    PaymentRecord, BillingPromise, AdminSystemSetting, 
    AdminSystemJob, AdminInstallation, AdminScreenAlert,
    AdminExtraService, AdminHotspotVoucher, Ticket,
    AuditLog, MikroTikRouter, NocMaintenanceWindow
)

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

def _parse_money_value(value) -> float | None:
    if value is None or str(value).strip() == '':
        return None
    try:
        parsed = round(float(value), 2)
    except (TypeError, ValueError):
        return None
    return max(0.0, parsed)

def _iso_utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat() + "Z"

def _mask_secret(value: str | None) -> str:
    token = str(value or '')
    if len(token) <= 4:
        return '*' * len(token)
    return f"{token[:2]}***{token[-2:]}"

def _generate_router_password(length: int | None = None) -> str:
    from flask import current_app
    default_length = 24
    try:
        configured = int(current_app.config.get('PASSWORD_ROTATION_LENGTH', default_length))
    except (TypeError, ValueError):
        configured = default_length
    target_length = length or configured
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

def _tenant_cache_key(prefix: str, tenant_id) -> str:
    scoped = tenant_id if tenant_id is not None else "global"
    return f"{prefix}:{scoped}"

def _system_settings_key(tenant_id) -> str:
    return _tenant_cache_key("admin_system_settings", tenant_id)

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
            updated_at=datetime.now(timezone.utc),
        )
    else:
        row.value = value
        row.updated_by = updated_by
        row.updated_at = datetime.now(timezone.utc)
    db.session.add(row)
    db.session.commit()

    cached_settings = _load_cached_dict(_system_settings_key(tenant_id))
    cached_settings[key_name] = value
    _save_cached_dict(_system_settings_key(tenant_id), cached_settings)

def _audit(action: str, entity_type: str = None, entity_id: str = None, metadata=None):
    from app.tenancy import current_tenant_id
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
        db.session.add(entry)
        db.session.commit()
    except Exception:
        pass

def _notify_incident(message: str, severity: str = "info"):
    pd_key = current_app.config.get('PAGERDUTY_ROUTING_KEY')
    tg_token = current_app.config.get('TELEGRAM_BOT_TOKEN')
    tg_chat = current_app.config.get('TELEGRAM_CHAT_ID')
    wp_token = current_app.config.get('WONDERPUSH_ACCESS_TOKEN')
    wp_app = current_app.config.get('WONDERPUSH_APPLICATION_ID')
    if pd_key:
        try:
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
            requests.post(f"https://api.telegram.org/bot{tg_token}/sendMessage",
                          data={"chat_id": tg_chat, "text": message[:4000]}, timeout=5)
        except Exception:
            current_app.logger.warning("Telegram notify failed")
    if wp_token and wp_app:
        try:
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

def _notify_client(client: Client, subject: str, body: str):
    # Mock implementation of client notification (email/sms/whatsapp)
    if client.user and client.user.email:
        try:
            from flask_mail import Message
            msg = Message(subject, recipients=[client.user.email], body=body)
            mail.send(msg)
        except Exception:
            current_app.logger.warning("Email notification to client %s failed", client.id)

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
