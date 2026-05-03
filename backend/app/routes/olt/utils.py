from __future__ import annotations
import time
from datetime import datetime, timezone
from flask import current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity
from app import cache, db
from app.models import AuditLog, User, AdminSystemSetting
from app.tenancy import current_tenant_id

def _as_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in ("1", "true", "yes", "y", "on")

def _resolve_actor_identity() -> str:
    current_identity = get_jwt_identity()
    if current_identity is None:
        return "system"
    try:
        user = db.session.get(User, current_identity)
    except Exception:
        user = None
    if user:
        return user.email or f"user:{user.id}"
    return f"user:{current_identity}"

def _audit(action: str, entity_type: str | None = None, entity_id: str | None = None, metadata=None):
    try:
        tenant_id = current_tenant_id()
        user_id = get_jwt_identity()
        log = AuditLog(
            tenant_id=tenant_id,
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            meta=metadata,
            ip_address=getattr(request, "remote_addr", None),
        )
        db.session.add(log)
        db.session.commit()
    except Exception:
        pass

def _parse_run_mode(data, default: str = "simulate") -> str:
    run_mode = str((data or {}).get("run_mode", default)).strip().lower()
    if run_mode not in {"simulate", "dry-run", "live"}:
        return "simulate"
    return run_mode

def _tenant_setting_bool(key_name: str, default: bool = False) -> bool:
    tenant_id = current_tenant_id()
    query = AdminSystemSetting.query.filter_by(key=key_name)
    if tenant_id is None:
        query = query.filter(AdminSystemSetting.tenant_id.is_(None))
    else:
        query = query.filter(AdminSystemSetting.tenant_id == tenant_id)
    row = query.first()
    if row is None:
        return default
    value = row.value
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}

def _validate_live_confirm(run_mode: str, data):
    if run_mode != "live":
        return None
    if _as_bool((data or {}).get("live_confirm")):
        if _tenant_setting_bool("change_control_required_for_live", default=True):
            change_ticket = str((data or {}).get("change_ticket") or "").strip()
            if not change_ticket:
                return jsonify({"success": False, "error": "change_ticket is required when live mode is enabled"}), 400
        if _tenant_setting_bool("require_preflight_for_live", default=True):
            preflight_ack = _as_bool((data or {}).get("preflight_ack"))
            if not preflight_ack:
                return jsonify({"success": False, "error": "preflight_ack=true is required for live mode"}), 400
        return None
    return jsonify({"success": False, "error": "live_confirm is required for live mode"}), 400

def _tenant_key(prefix: str) -> str:
    tenant_id = current_tenant_id()
    scoped = tenant_id if tenant_id is not None else "global"
    return f"olt:{prefix}:{scoped}"

def _parse_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None

def _tenant_allows_record(record_tenant_id) -> bool:
    tenant_id = current_tenant_id()
    return tenant_id is None or record_tenant_id in (None, tenant_id)

def _build_onu_payload(data) -> dict:
    data = data or {}
    payload: dict = {}
    for field in ("frame", "slot", "pon", "onu", "vlan"):
        value = data.get(field)
        if value in (None, ""): continue
        try: payload[field] = int(value)
        except (TypeError, ValueError): raise ValueError(f"{field} must be integer")
    for field in ("serial", "line_profile", "srv_profile"):
        value = data.get(field)
        if value in (None, ""): continue
        payload[field] = str(value).strip()
    profile = data.get("profile")
    if profile and "line_profile" not in payload: payload["line_profile"] = str(profile).strip()
    return payload

def _build_olt_port_label(payload: dict) -> str | None:
    if not isinstance(payload, dict): return None
    frame, slot, pon = payload.get("frame"), payload.get("slot"), payload.get("pon")
    if frame in (None, "") or slot in (None, "") or pon in (None, ""): return None
    return f"{frame}/{slot}/{pon}"

def _append_note_line(existing: str | None, line: str | None) -> str | None:
    safe_line = str(line or "").strip()
    if not safe_line: return existing or None
    if not existing: return safe_line
    base = str(existing).rstrip()
    if safe_line in base: return base
    return f"{base}\n{safe_line}"

def _serialize_lookup_client(client) -> dict:
    profile = client.network_profile
    return {
        "id": client.id, "name": client.full_name,
        "email": client.user.email if client.user else None,
        "plan": client.plan.name if client.plan else None,
        "router_name": client.router.name if client.router else None,
        "ip_address": client.ip_address, "connection_type": client.connection_type,
        "pppoe_username": client.pppoe_username, "network_profile": profile.to_dict() if profile else None,
    }

def _serialize_lookup_installation(installation) -> dict:
    return {
        "id": installation.id, "client_id": installation.client_id, "client_name": installation.client_name,
        "status": installation.status, "priority": installation.priority, "technician": installation.technician,
        "scheduled_for": installation.scheduled_for.isoformat() if installation.scheduled_for else None,
        "notes": installation.notes or "", "checklist": installation.checklist or {}, "address": installation.address,
    }

def _build_zero_touch_binding_preview(**kwargs) -> dict:
    import time
    device_id, device, client, installation, payload = kwargs.get("device_id"), kwargs.get("device"), kwargs.get("client"), kwargs.get("installation"), kwargs.get("payload")
    access_technology, onu_model, notes, actor_label, mark_completed = kwargs.get("access_technology"), kwargs.get("onu_model"), kwargs.get("notes"), kwargs.get("actor_label"), kwargs.get("mark_installation_completed")
    
    profile = client.network_profile
    port_label = _build_olt_port_label(payload)
    onu_id, vlan = payload.get("onu"), payload.get("vlan")
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    automation_note = f"[{timestamp}] Zero-touch OLT {device_id} {port_label or 'sin puerto'} ONU {onu_id or '-'} serial {payload.get('serial')} VLAN {vlan or '-'} por {actor_label}."
    if notes: automation_note = f"{automation_note} {notes}"

    profile_updates = {
        "access_technology": access_technology or (profile.access_technology if profile else "fiber"),
        "olt_id": device_id, "olt_port": port_label, "onu_serial": payload.get("serial"),
        "onu_model": onu_model or (profile.onu_model if profile else None),
        "fiber_port": str(onu_id) if onu_id not in (None, "") else (profile.fiber_port if profile else None),
        "technical_notes_append": automation_note,
    }

    installation_updates = None
    if installation:
        checklist = dict(installation.checklist or {})
        checklist["onu_registered"] = True
        next_status = installation.status
        if mark_completed: next_status = "completed"
        elif installation.status in {"pending", "scheduled"}: next_status = "in_progress"
        installation_updates = {"id": installation.id, "status": next_status, "checklist": checklist, "notes_append": automation_note}

    return {"device": {"id": device_id, "name": str((device or {}).get("name") or device_id), "vendor": (device or {}).get("vendor")}, "client_id": client.id, "client_name": client.full_name, "olt_port": port_label, "onu_id": onu_id, "vlan": vlan, "profile_updates": profile_updates, "installation_updates": installation_updates, "note_line": automation_note}

def _service():
    from .management import _load_custom_devices, _load_custom_credentials
    from app.services.olt_script_service import OLTScriptService
    extra_devices = _load_custom_devices()
    credentials_overrides = _load_custom_credentials()
    return OLTScriptService(extra_devices=extra_devices, credentials_overrides=credentials_overrides)

def _sanitize_olt_device(device: dict | None) -> dict:
    from app.services.snmp_service import snmp_service
    safe_device = dict(device or {})
    safe_device.pop("password", None)
    safe_device.pop("enable_password", None)
    if "snmp" in safe_device:
        safe_device["snmp"] = snmp_service.sanitize_profile(safe_device.get("snmp"))
    return safe_device
