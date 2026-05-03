from flask import Blueprint, jsonify, request
from app import cache
from app.routes.auth_routes import admin_required
from app.services.olt_script_service import OLTScriptService, SUPPORTED_VENDORS
from app.services.snmp_service import snmp_service
from .utils import _audit, _tenant_key, _tenant_allows_record, _service, _sanitize_olt_device

management_bp = Blueprint("olt_management", __name__)

SERVICE_TEMPLATES = {
    "zte": [
        {"id": "zte-line-100m", "label": "ZTE 100M", "line_profile": "LINE-100M", "srv_profile": "SRV-INTERNET"},
        {"id": "zte-line-200m", "label": "ZTE 200M", "line_profile": "LINE-200M", "srv_profile": "SRV-INTERNET"},
    ],
    "huawei": [
        {"id": "hw-100m", "label": "Huawei 100M", "line_profile": "line-profile_100M", "srv_profile": "srv-profile_internet"},
        {"id": "hw-300m", "label": "Huawei 300M", "line_profile": "line-profile_300M", "srv_profile": "srv-profile_internet"},
    ],
    "vsol": [
        {"id": "vsol-50m", "label": "VSOL 50M", "line_profile": "VSOL50M", "srv_profile": "Internet"},
        {"id": "vsol-100m", "label": "VSOL 100M", "line_profile": "VSOL100M", "srv_profile": "Internet"},
    ],
}

def _devices_cache_key() -> str:
    return _tenant_key("custom_devices")

def _credentials_cache_key() -> str:
    return _tenant_key("custom_credentials")

def _templates_cache_key() -> str:
    return _tenant_key("custom_service_templates")

def _load_custom_devices() -> list[dict]:
    raw = cache.get(_devices_cache_key()) or []
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    return []

def _save_custom_devices(devices: list[dict]) -> None:
    cache.set(_devices_cache_key(), devices, timeout=86400 * 30)

def _load_custom_credentials() -> dict:
    raw = cache.get(_credentials_cache_key()) or {}
    if isinstance(raw, dict):
        return {str(key): value for key, value in raw.items() if isinstance(value, dict)}
    return {}

def _save_custom_credentials(credentials: dict) -> None:
    cache.set(_credentials_cache_key(), credentials, timeout=86400 * 30)

def _load_custom_service_templates() -> dict:
    raw = cache.get(_templates_cache_key()) or {}
    if not isinstance(raw, dict):
        return {}
    payload: dict[str, list[dict]] = {}
    for vendor, templates in raw.items():
        if not isinstance(templates, list):
            continue
        payload[str(vendor)] = [item for item in templates if isinstance(item, dict)]
    return payload

def _save_custom_service_templates(templates: dict) -> None:
    cache.set(_templates_cache_key(), templates, timeout=86400 * 30)

def _normalize_device_transport(vendor: str, transport: str | None) -> str:
    default_transport = str(SUPPORTED_VENDORS[vendor]["default_transport"])
    candidate = str(transport or default_transport).strip().lower()
    return candidate if candidate in ("ssh", "telnet") else default_transport

def _normalize_device_port(vendor: str, transport: str, raw_port) -> int:
    fallback = int(SUPPORTED_VENDORS[vendor]["default_port"])
    try:
        parsed = int(raw_port if raw_port not in (None, "") else fallback)
    except (TypeError, ValueError):
        parsed = fallback
    if parsed < 1 or parsed > 65535:
        raise ValueError("port must be between 1 and 65535")
    if raw_port in (None, "") and transport == "telnet": return 23
    if raw_port in (None, "") and transport == "ssh": return 22
    return parsed

def _normalize_custom_device_payload(data, existing_ids: set[str] | None = None) -> tuple[dict | None, str | None]:
    payload = data or {}
    vendor = str(payload.get("vendor") or "").strip().lower()
    if vendor not in SUPPORTED_VENDORS:
        return None, "vendor is required and must be one of: zte, huawei, vsol"

    existing_ids = existing_ids or set()
    requested_id = str(payload.get("id") or "").strip()
    if requested_id:
        device_id = requested_id
    else:
        suffix = 1
        candidate = f"OLT-{vendor.upper()}-CUSTOM-{suffix:03d}"
        while candidate in existing_ids:
            suffix += 1
            candidate = f"OLT-{vendor.upper()}-CUSTOM-{suffix:03d}"
        device_id = candidate

    name = str(payload.get("name") or "").strip()
    host = str(payload.get("host") or "").strip()
    if not name: return None, "name is required"
    if not host: return None, "host is required"

    transport = _normalize_device_transport(vendor, payload.get("transport"))
    try:
        port = _normalize_device_port(vendor, transport, payload.get("port"))
    except ValueError as exc: return None, str(exc)

    device = {
        "id": device_id, "name": name, "vendor": vendor,
        "model": str(payload.get("model") or "N/D").strip() or "N/D",
        "host": host, "transport": transport, "port": port,
        "username": str(payload.get("username") or "admin").strip() or "admin",
        "site": str(payload.get("site") or "N/D").strip() or "N/D",
        "origin": "custom",
    }
    if "snmp" in payload:
        if payload.get("snmp") is not None and not isinstance(payload.get("snmp"), dict):
            return None, "snmp must be an object"
        device["snmp"] = snmp_service.normalize_profile(
            payload.get("snmp"), default_host=host, default_label=name,
        )
    return device, None

def _extract_credentials_payload(data) -> dict:
    payload = data or {}
    credentials: dict = {}
    if "password" in payload:
        credentials["password"] = str(payload.get("password") or "").strip()
    if "enable_password" in payload:
        credentials["enable_password"] = str(payload.get("enable_password") or "").strip()
    if "shell_prompt" in payload:
        prompt = str(payload.get("shell_prompt") or "").strip()
        if prompt: credentials["shell_prompt"] = prompt
    for key in ("timeout_seconds", "command_delay_seconds"):
        if key not in payload: continue
        try:
            credentials[key] = float(payload.get(key))
        except (TypeError, ValueError): continue
    return credentials


@management_bp.route("/devices", methods=["GET"])
@admin_required()
def list_devices():
    vendor = request.args.get("vendor")
    service = _service()
    devices = [_sanitize_olt_device(item) for item in service.list_devices(vendor=vendor)]
    return jsonify({"success": True, "devices": devices}), 200

@management_bp.route("/devices", methods=["POST"])
@admin_required()
def create_device():
    data = request.get_json() or {}
    service = _service()
    existing_ids = {str(item.get("id") or "") for item in service.list_devices()}
    device, error = _normalize_custom_device_payload(data, existing_ids=existing_ids)
    if error: return jsonify({"success": False, "error": error}), 400

    assert device is not None
    custom_devices = _load_custom_devices()
    custom_devices.insert(0, device)
    _save_custom_devices(custom_devices)

    incoming_credentials = _extract_credentials_payload(data)
    if incoming_credentials:
        credentials = _load_custom_credentials()
        credentials[device["id"]] = incoming_credentials
        _save_custom_credentials(credentials)

    _audit("olt_device_create", entity_type="olt_device", entity_id=device["id"],
           metadata={"vendor": device["vendor"], "host": device["host"], "origin": "custom"})
    return jsonify({"success": True, "device": _sanitize_olt_device(device)}), 201

@management_bp.route("/devices/<device_id>", methods=["PATCH"])
@admin_required()
def update_device(device_id):
    updates = request.get_json() or {}
    devices = _load_custom_devices()
    target = next((item for item in devices if str(item.get("id") or "") == str(device_id)), None)
    if not target: return jsonify({"success": False, "error": "Custom OLT not found"}), 404

    payload = {**target, **updates, "id": device_id, "origin": "custom"}
    normalized, error = _normalize_custom_device_payload(payload, existing_ids={str(device_id)})
    if error: return jsonify({"success": False, "error": error}), 400

    for idx, item in enumerate(devices):
        if str(item.get("id") or "") == str(device_id):
            devices[idx] = normalized
            break
    _save_custom_devices(devices)

    credential_updates = _extract_credentials_payload(updates)
    if credential_updates:
        credentials = _load_custom_credentials()
        current = dict(credentials.get(device_id) or {})
        for key, value in credential_updates.items():
            if key in ("password", "enable_password") and not str(value).strip():
                current.pop(key, None)
                continue
            current[key] = value
        if current: credentials[device_id] = current
        else: credentials.pop(device_id, None)
        _save_custom_credentials(credentials)

    _audit("olt_device_update", entity_type="olt_device", entity_id=device_id,
           metadata={"fields": sorted(list(updates.keys()))})
    return jsonify({"success": True, "device": _sanitize_olt_device(normalized)}), 200

@management_bp.route("/devices/<device_id>", methods=["DELETE"])
@admin_required()
def delete_device(device_id):
    devices = _load_custom_devices()
    next_devices = [item for item in devices if str(item.get("id") or "") != str(device_id)]
    if len(next_devices) == len(devices): return jsonify({"success": False, "error": "Custom OLT not found"}), 404
    _save_custom_devices(next_devices)

    credentials = _load_custom_credentials()
    if str(device_id) in credentials:
        credentials.pop(str(device_id), None)
        _save_custom_credentials(credentials)

    _audit("olt_device_delete", entity_type="olt_device", entity_id=device_id)
    return jsonify({"success": True, "deleted_id": device_id}), 200

@management_bp.route("/service-templates", methods=["GET"])
@admin_required()
def list_service_templates():
    vendor = request.args.get("vendor")
    custom = _load_custom_service_templates()
    if vendor:
        return jsonify({"success": True, "vendor": vendor,
                        "templates": SERVICE_TEMPLATES.get(vendor, []) + custom.get(vendor, [])}), 200
    
    all_templates = {}
    for v in SUPPORTED_VENDORS:
        all_templates[v] = SERVICE_TEMPLATES.get(v, []) + custom.get(v, [])
    return jsonify({"success": True, "vendors": all_templates}), 200

@management_bp.route("/service-templates", methods=["POST"])
@admin_required()
def create_service_template():
    data = request.get_json() or {}
    vendor = str(data.get("vendor") or "").strip().lower()
    if vendor not in SUPPORTED_VENDORS: return jsonify({"success": False, "error": "vendor invalido"}), 400

    template_id = str(data.get("id") or f"custom-{vendor}-{int(time.time())}").strip()
    label = str(data.get("label") or template_id).strip()
    line_profile = str(data.get("line_profile") or "").strip()
    srv_profile = str(data.get("srv_profile") or "").strip()

    if not line_profile or not srv_profile:
        return jsonify({"success": False, "error": "line_profile y srv_profile requeridos"}), 400

    payload = {"id": template_id, "label": label, "line_profile": line_profile, "srv_profile": srv_profile, "origin": "custom"}
    custom_templates = _load_custom_service_templates()
    vendor_templates = custom_templates.get(vendor, [])
    vendor_templates.insert(0, payload)
    custom_templates[vendor] = vendor_templates[:100]
    _save_custom_service_templates(custom_templates)

    _audit("olt_service_template_create", entity_type="olt_service_template", entity_id=template_id,
           metadata={"vendor": vendor, "line_profile": line_profile, "srv_profile": srv_profile})
    return jsonify({"success": True, "template": payload}), 201

@management_bp.route("/service-templates/<vendor>/<template_id>", methods=["DELETE"])
@admin_required()
def delete_service_template(vendor, template_id):
    vendor = str(vendor or "").strip().lower()
    if vendor not in SUPPORTED_VENDORS: return jsonify({"success": False, "error": "vendor invalido"}), 400

    custom_templates = _load_custom_service_templates()
    vendor_templates = custom_templates.get(vendor, [])
    initial = len(vendor_templates)
    vendor_templates = [item for item in vendor_templates if str(item.get("id") or "") != str(template_id)]
    if len(vendor_templates) == initial: return jsonify({"success": False, "error": "template custom no encontrado"}), 404

    custom_templates[vendor] = vendor_templates
    _save_custom_service_templates(custom_templates)
    _audit("olt_service_template_delete", entity_type="olt_service_template", entity_id=str(template_id), metadata={"vendor": vendor})
    return jsonify({"success": True}), 200
