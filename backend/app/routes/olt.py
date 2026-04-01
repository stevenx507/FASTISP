"""
OLT enterprise API endpoints (ZTE, Huawei, VSOL).
"""
from __future__ import annotations

import socket
import ssl
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity

from app import cache
from app.models import AdminSystemSetting, AuditLog, User
from app.routes.main_routes import admin_required
from app.services.acs_service import ACSService
from app.services.olt_script_service import OLTScriptService, SUPPORTED_VENDORS
from app.tenancy import current_tenant_id

olt_bp = Blueprint("olt", __name__)

# Service profile templates used by authorize-onu flows.
SERVICE_TEMPLATES = {
    "zte": [
        {
            "id": "zte-line-100m",
            "label": "ZTE 100M",
            "line_profile": "LINE-100M",
            "srv_profile": "SRV-INTERNET",
        },
        {
            "id": "zte-line-200m",
            "label": "ZTE 200M",
            "line_profile": "LINE-200M",
            "srv_profile": "SRV-INTERNET",
        },
    ],
    "huawei": [
        {
            "id": "hw-100m",
            "label": "Huawei 100M",
            "line_profile": "line-profile_100M",
            "srv_profile": "srv-profile_internet",
        },
        {
            "id": "hw-300m",
            "label": "Huawei 300M",
            "line_profile": "line-profile_300M",
            "srv_profile": "srv-profile_internet",
        },
    ],
    "vsol": [
        {
            "id": "vsol-50m",
            "label": "VSOL 50M",
            "line_profile": "VSOL50M",
            "srv_profile": "Internet",
        },
        {
            "id": "vsol-100m",
            "label": "VSOL 100M",
            "line_profile": "VSOL100M",
            "srv_profile": "Internet",
        },
    ],
}


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
        from app import db

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
        from app import db

        db.session.add(log)
        db.session.commit()
    except Exception:
        # Auditing should not break user flows.
        pass


def _parse_run_mode(data, default: str = "simulate") -> str:
    run_mode = str((data or {}).get("run_mode", default)).strip().lower()
    if run_mode not in {"simulate", "dry-run", "live"}:
        return "simulate"
    return run_mode


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


def _build_onu_payload(data) -> dict:
    data = data or {}
    payload: dict = {}

    for field in ("frame", "slot", "pon", "onu", "vlan"):
        value = data.get(field)
        if value in (None, ""):
            continue
        try:
            payload[field] = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"{field} must be integer")

    for field in ("serial", "line_profile", "srv_profile"):
        value = data.get(field)
        if value in (None, ""):
            continue
        payload[field] = str(value).strip()

    profile = data.get("profile")
    if profile and "line_profile" not in payload:
        payload["line_profile"] = str(profile).strip()

    return payload


def _tenant_key(prefix: str) -> str:
    tenant_id = current_tenant_id()
    scoped = tenant_id if tenant_id is not None else "global"
    return f"olt:{prefix}:{scoped}"


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
    if raw_port in (None, "") and transport == "telnet":
        return 23
    if raw_port in (None, "") and transport == "ssh":
        return 22
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
    if not name:
        return None, "name is required"
    if not host:
        return None, "host is required"

    transport = _normalize_device_transport(vendor, payload.get("transport"))
    try:
        port = _normalize_device_port(vendor, transport, payload.get("port"))
    except ValueError as exc:
        return None, str(exc)

    device = {
        "id": device_id,
        "name": name,
        "vendor": vendor,
        "model": str(payload.get("model") or "N/D").strip() or "N/D",
        "host": host,
        "transport": transport,
        "port": port,
        "username": str(payload.get("username") or "admin").strip() or "admin",
        "site": str(payload.get("site") or "N/D").strip() or "N/D",
        "origin": "custom",
    }
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
        if prompt:
            credentials["shell_prompt"] = prompt
    for key in ("timeout_seconds", "command_delay_seconds"):
        if key not in payload:
            continue
        try:
            credentials[key] = float(payload.get(key))
        except (TypeError, ValueError):
            continue
    return credentials


def _service() -> OLTScriptService:
    extra_devices = _load_custom_devices()
    credentials_overrides = _load_custom_credentials()
    try:
        return OLTScriptService(
            extra_devices=extra_devices,
            credentials_overrides=credentials_overrides,
        )
    except TypeError:
        # Backward-compatible fallback for tests monkeypatching OLTScriptService with minimal stubs.
        return OLTScriptService()


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


def _probe_tcp(host: str, port: int, timeout_seconds: float = 2.5) -> dict:
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds):
            latency_ms = round((time.perf_counter() - started) * 1000, 2)
            return {"reachable": True, "latency_ms": latency_ms, "error": None}
    except Exception as exc:
        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        return {"reachable": False, "latency_ms": latency_ms, "error": str(exc)}


def _resolve_olt_credentials(service: OLTScriptService, device: dict) -> dict:
    resolver = getattr(service, "_resolve_device_credentials", None)
    if callable(resolver):
        try:
            resolved = resolver(device) or {}
            if isinstance(resolved, dict):
                return resolved
        except Exception:
            pass
    return {
        "username": str(device.get("username") or "admin"),
        "password": "",
        "enable_password": "",
    }


def _build_remote_readiness(service: OLTScriptService, device: dict) -> dict:
    host = str(device.get("host") or "").strip()
    port = int(device.get("port") or 22)
    transport = str(device.get("transport") or "ssh").strip().lower()

    credentials = _resolve_olt_credentials(service, device)
    username = str(credentials.get("username") or "").strip()
    has_password = bool(str(credentials.get("password") or "").strip())

    tcp_probe = {"reachable": False, "latency_ms": None, "error": "Host is empty"}
    if host:
        tcp_probe = _probe_tcp(host=host, port=port, timeout_seconds=2.5)

    checks = [
        {
            "id": "host_configured",
            "label": "Host OLT configurado",
            "ok": bool(host),
            "detail": host or "Define host/IP para habilitar pruebas remotas.",
            "severity": "critical" if not host else "ok",
        },
        {
            "id": "tcp_reachable",
            "label": "Puerto de gestion accesible desde backend",
            "ok": bool(host) and bool(tcp_probe.get("reachable")),
            "detail": (
                f"{host}:{port} reachable ({tcp_probe.get('latency_ms')} ms)"
                if host and tcp_probe.get("reachable")
                else str(tcp_probe.get("error") or "No se pudo abrir socket TCP.")
            ),
            "severity": "critical" if not tcp_probe.get("reachable") else "ok",
        },
        {
            "id": "transport_security",
            "label": "Transporte seguro",
            "ok": transport == "ssh",
            "detail": "SSH activo." if transport == "ssh" else "Telnet detectado. Solo recomendado dentro de VPN privada.",
            "severity": "warning" if transport != "ssh" else "ok",
        },
        {
            "id": "credentials_ready",
            "label": "Credenciales listas para live mode",
            "ok": bool(username) and has_password,
            "detail": (
                f'Usuario "{username}" con password cargado.'
                if bool(username) and has_password
                else "Falta username/password (OLT_CREDENTIALS_JSON o OLT_DEFAULT_PASSWORD)."
            ),
            "severity": "critical" if not has_password else "ok",
        },
        {
            "id": "live_guardrail",
            "label": "Guardrail de ejecucion live",
            "ok": True,
            "detail": "El backend exige run_mode=live + live_confirm=true para ejecutar comandos reales.",
            "severity": "ok",
        },
    ]

    score_weights = {
        "host_configured": 20,
        "tcp_reachable": 30,
        "transport_security": 15,
        "credentials_ready": 30,
        "live_guardrail": 5,
    }
    score = 0
    for item in checks:
        if item["ok"]:
            score += score_weights.get(str(item["id"]), 0)

    missing = []
    if not host:
        missing.append("Registrar host/IP de la OLT.")
    if host and not tcp_probe.get("reachable"):
        missing.append("Abrir ruta TCP desde backend/VPS hacia OLT (ACL + VPN).")
    if transport != "ssh":
        missing.append("Migrar gestion a SSH o aislar Telnet dentro de tunel privado.")
    if not has_password:
        missing.append("Definir credenciales OLT en OLT_CREDENTIALS_JSON u OLT_DEFAULT_PASSWORD.")

    recommendations = [
        "Usar WireGuard/IPsec entre POP y VPS para gestion OLT.",
        "Restringir acceso por ACL al origen del backend y jump host.",
        "Probar primero en run_mode=simulate/dry-run antes de activar live.",
    ]
    if host and not tcp_probe.get("reachable"):
        recommendations.append("Verificar NAT/forwarding y route policy entre VPS y red de acceso.")
    if transport != "ssh":
        recommendations.append("Priorizar SSH para auditoria y seguridad operacional.")

    return {
        "score": max(0, min(100, int(score))),
        "checks": checks,
        "tcp_probe": tcp_probe,
        "missing": missing,
        "recommendations": recommendations,
    }


def _build_grafana_status() -> dict:
    raw_dashboard_url = str(
        current_app.config.get("GRAFANA_URL")
        or current_app.config.get("VITE_GRAFANA_URL")
        or ""
    ).strip()
    datasource_uid = str(current_app.config.get("GRAFANA_DATASOURCE_UID") or "").strip() or None
    health_path = str(current_app.config.get("GRAFANA_HEALTHCHECK_PATH") or "/api/health").strip() or "/api/health"

    status = {
        "configured": bool(raw_dashboard_url),
        "dashboard_url": raw_dashboard_url or None,
        "health_url": None,
        "reachable": None,
        "status_code": None,
        "response_time_ms": None,
        "datasource_uid": datasource_uid,
        "error": None,
        "recommendations": [],
    }

    if not raw_dashboard_url:
        status["recommendations"] = [
            "Define GRAFANA_URL (o VITE_GRAFANA_URL) en .env.prod con dashboard embebible.",
            "Publica Grafana por HTTPS detras de Traefik y habilita dashboard kiosk.",
            "Configura datasource de metricas (InfluxDB/Prometheus) con permisos de solo lectura.",
        ]
        return status

    parsed = urlparse(raw_dashboard_url)
    if not parsed.scheme or not parsed.netloc:
        status["error"] = "Invalid GRAFANA_URL format."
        status["recommendations"] = ["Usa URL completa, por ejemplo https://grafana.fastisp.cloud/d/ispfast/overview"]
        return status

    base_origin = f"{parsed.scheme}://{parsed.netloc}"
    if not health_path.startswith("/"):
        health_path = f"/{health_path}"
    health_url = f"{base_origin}{health_path}"
    status["health_url"] = health_url

    timeout_raw = current_app.config.get("GRAFANA_TIMEOUT_SECONDS", 4)
    try:
        timeout_seconds = max(1.0, min(float(timeout_raw), 12.0))
    except (TypeError, ValueError):
        timeout_seconds = 4.0
    verify_tls = bool(current_app.config.get("GRAFANA_VERIFY_TLS", True))

    request_obj = Request(health_url, headers={"User-Agent": "fastisp-backend/1.0"})
    tls_context = ssl.create_default_context() if verify_tls else ssl._create_unverified_context()

    started = time.perf_counter()
    try:
        with urlopen(request_obj, timeout=timeout_seconds, context=tls_context) as response:
            status["status_code"] = int(getattr(response, "status", 200))
            status["reachable"] = True
    except HTTPError as http_exc:
        status["status_code"] = int(http_exc.code)
        # HTTPError still means DNS/TCP/TLS are operational.
        status["reachable"] = True
        status["error"] = f"Grafana responded with HTTP {http_exc.code}."
    except URLError as url_exc:
        status["reachable"] = False
        status["error"] = str(getattr(url_exc, "reason", url_exc))
    except Exception as exc:
        status["reachable"] = False
        status["error"] = str(exc)
    finally:
        status["response_time_ms"] = round((time.perf_counter() - started) * 1000, 2)

    recommendations = [
        "Mantener panel Grafana en modo solo lectura para NOC.",
        "Versionar dashboards y alertas para despliegues reproducibles.",
        "Revisar retencion y cardinalidad de metricas para evitar sobrecarga.",
    ]
    if status["reachable"] is False:
        recommendations.append("Verificar DNS/TLS/firewall entre backend y Grafana.")
    if not datasource_uid:
        recommendations.append("Configura GRAFANA_DATASOURCE_UID para validar datasource objetivo del dashboard.")
    status["recommendations"] = recommendations
    return status


def _run_vendor_action(device_id: str, action: str, payload: dict, run_mode: str):
    service = _service()
    generated = service.generate_script(device_id=device_id, action=action, payload=payload)
    if not generated.get("success"):
        return generated, 400

    commands = generated.get("commands", [])
    result = service.execute_script(
        device_id=device_id,
        commands=commands,
        run_mode=run_mode,
        actor=_resolve_actor_identity(),
        source_ip=request.remote_addr,
    )

    response = {
        "success": bool(result.get("success")),
        "device_id": device_id,
        "device": generated.get("device"),
        "action": action,
        "run_mode": run_mode,
        "payload": payload,
        "commands": commands,
        "execution": result,
        "message": result.get("message"),
    }
    if not result.get("success"):
        response["error"] = result.get("error") or "execution_failed"

    status = 200 if result.get("success") else (502 if run_mode == "live" else 400)
    return response, status


@olt_bp.route("/vendors", methods=["GET"])
@admin_required()
def list_vendors():
    service = _service()
    return jsonify({"success": True, "vendors": service.list_vendors()}), 200


@olt_bp.route("/service-templates", methods=["GET"])
@admin_required()
def service_templates():
    vendor = (request.args.get("vendor") or "").strip().lower()
    custom_templates = _load_custom_service_templates()
    merged = {
        vendor_name: [*SERVICE_TEMPLATES.get(vendor_name, []), *(custom_templates.get(vendor_name, []))]
        for vendor_name in SUPPORTED_VENDORS.keys()
    }
    if vendor:
        if vendor not in merged:
            return jsonify({"success": False, "error": "vendor invalido"}), 400
        return jsonify({"success": True, "vendor": vendor, "templates": merged[vendor]}), 200
    return jsonify({"success": True, "templates": merged}), 200


@olt_bp.route("/service-templates", methods=["POST"])
@admin_required()
def create_service_template():
    data = request.get_json() or {}
    vendor = str(data.get("vendor") or "").strip().lower()
    if vendor not in SUPPORTED_VENDORS:
        return jsonify({"success": False, "error": "vendor invalido"}), 400

    label = str(data.get("label") or "").strip()
    line_profile = str(data.get("line_profile") or "").strip()
    srv_profile = str(data.get("srv_profile") or "").strip()
    template_id = str(data.get("id") or "").strip() or f"{vendor}-custom-{int(time.time())}"

    if not label or not line_profile or not srv_profile:
        return jsonify({"success": False, "error": "label, line_profile y srv_profile son requeridos"}), 400

    custom_templates = _load_custom_service_templates()
    vendor_templates = custom_templates.get(vendor, [])
    if any(str(item.get("id") or "") == template_id for item in vendor_templates):
        return jsonify({"success": False, "error": "id de template ya existe"}), 409

    payload = {
        "id": template_id,
        "label": label,
        "line_profile": line_profile,
        "srv_profile": srv_profile,
        "origin": "custom",
    }
    vendor_templates.insert(0, payload)
    custom_templates[vendor] = vendor_templates[:100]
    _save_custom_service_templates(custom_templates)

    _audit(
        "olt_service_template_create",
        entity_type="olt_service_template",
        entity_id=template_id,
        metadata={"vendor": vendor, "line_profile": line_profile, "srv_profile": srv_profile},
    )
    return jsonify({"success": True, "template": payload}), 201


@olt_bp.route("/service-templates/<vendor>/<template_id>", methods=["DELETE"])
@admin_required()
def delete_service_template(vendor, template_id):
    vendor = str(vendor or "").strip().lower()
    if vendor not in SUPPORTED_VENDORS:
        return jsonify({"success": False, "error": "vendor invalido"}), 400

    custom_templates = _load_custom_service_templates()
    vendor_templates = custom_templates.get(vendor, [])
    initial = len(vendor_templates)
    vendor_templates = [item for item in vendor_templates if str(item.get("id") or "") != str(template_id)]
    if len(vendor_templates) == initial:
        return jsonify({"success": False, "error": "template custom no encontrado"}), 404

    custom_templates[vendor] = vendor_templates
    _save_custom_service_templates(custom_templates)
    _audit(
        "olt_service_template_delete",
        entity_type="olt_service_template",
        entity_id=str(template_id),
        metadata={"vendor": vendor},
    )
    return jsonify({"success": True}), 200


@olt_bp.route("/devices", methods=["GET"])
@admin_required()
def list_devices():
    vendor = request.args.get("vendor")
    service = _service()
    return jsonify({"success": True, "devices": service.list_devices(vendor=vendor)}), 200


@olt_bp.route("/devices", methods=["POST"])
@admin_required()
def create_device():
    data = request.get_json() or {}
    service = _service()
    existing_ids = {str(item.get("id") or "") for item in service.list_devices()}
    device, error = _normalize_custom_device_payload(data, existing_ids=existing_ids)
    if error:
        return jsonify({"success": False, "error": error}), 400

    assert device is not None
    custom_devices = _load_custom_devices()
    custom_devices.insert(0, device)
    _save_custom_devices(custom_devices)

    incoming_credentials = _extract_credentials_payload(data)
    if incoming_credentials:
        credentials = _load_custom_credentials()
        credentials[device["id"]] = incoming_credentials
        _save_custom_credentials(credentials)

    _audit(
        "olt_device_create",
        entity_type="olt_device",
        entity_id=device["id"],
        metadata={"vendor": device["vendor"], "host": device["host"], "origin": "custom"},
    )
    return jsonify({"success": True, "device": device}), 201


@olt_bp.route("/devices/<device_id>", methods=["PATCH"])
@admin_required()
def update_device(device_id):
    updates = request.get_json() or {}
    devices = _load_custom_devices()
    target = next((item for item in devices if str(item.get("id") or "") == str(device_id)), None)
    if not target:
        return jsonify({"success": False, "error": "Custom OLT not found"}), 404

    payload = {**target, **updates, "id": device_id, "origin": "custom"}
    normalized, error = _normalize_custom_device_payload(payload, existing_ids={str(device_id)})
    if error:
        return jsonify({"success": False, "error": error}), 400
    assert normalized is not None

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
        if current:
            credentials[device_id] = current
        else:
            credentials.pop(device_id, None)
        _save_custom_credentials(credentials)

    _audit(
        "olt_device_update",
        entity_type="olt_device",
        entity_id=device_id,
        metadata={"fields": sorted(list(updates.keys()))},
    )
    return jsonify({"success": True, "device": normalized}), 200


@olt_bp.route("/devices/<device_id>", methods=["DELETE"])
@admin_required()
def delete_device(device_id):
    devices = _load_custom_devices()
    next_devices = [item for item in devices if str(item.get("id") or "") != str(device_id)]
    if len(next_devices) == len(devices):
        return jsonify({"success": False, "error": "Custom OLT not found"}), 404
    _save_custom_devices(next_devices)

    credentials = _load_custom_credentials()
    if str(device_id) in credentials:
        credentials.pop(str(device_id), None)
        _save_custom_credentials(credentials)

    _audit("olt_device_delete", entity_type="olt_device", entity_id=device_id)
    return jsonify({"success": True, "deleted_id": device_id}), 200


@olt_bp.route("/devices/<device_id>/snapshot", methods=["GET"])
@admin_required()
def get_snapshot(device_id):
    service = _service()
    result = service.get_snapshot(device_id)
    _audit("olt_snapshot", entity_type="olt", entity_id=device_id, metadata={"success": result.get("success")})
    return jsonify(result), (200 if result.get("success") else 404)


@olt_bp.route("/devices/test-connection", methods=["POST"])
@admin_required()
def test_connection():
    data = request.get_json() or {}
    device_id = str(data.get("device_id", "")).strip()
    if not device_id:
        return jsonify({"success": False, "error": "device_id is required"}), 400

    try:
        timeout = float(data.get("timeout", 2.5) or 2.5)
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "timeout must be numeric"}), 400
    timeout = max(0.5, min(timeout, 10.0))

    service = _service()
    result = service.test_connection(device_id=device_id, timeout_seconds=timeout)
    _audit(
        "olt_test_connection",
        entity_type="olt",
        entity_id=device_id,
        metadata={"success": result.get("success"), "latency_ms": result.get("latency_ms")},
    )
    return jsonify(result), (200 if result.get("success") else 502)


@olt_bp.route("/devices/<device_id>/script/generate", methods=["POST"])
@admin_required()
def generate_script(device_id):
    data = request.get_json() or {}
    action = str(data.get("action", "")).strip().lower()
    if not action:
        return jsonify({"success": False, "error": "action is required"}), 400
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}

    service = _service()
    result = service.generate_script(device_id=device_id, action=action, payload=payload)
    _audit(
        "olt_generate_script",
        entity_type="olt",
        entity_id=device_id,
        metadata={"action": action, "success": result.get("success")},
    )
    return jsonify(result), (200 if result.get("success") else 400)


@olt_bp.route("/devices/<device_id>/script/execute", methods=["POST"])
@admin_required()
def execute_script(device_id):
    data = request.get_json() or {}
    commands = data.get("commands")
    if not isinstance(commands, list):
        return jsonify({"success": False, "error": "commands must be an array"}), 400

    run_mode = _parse_run_mode(data)
    live_guard = _validate_live_confirm(run_mode, data)
    if live_guard:
        return live_guard

    service = _service()
    result = service.execute_script(
        device_id=device_id,
        commands=commands,
        run_mode=run_mode,
        actor=_resolve_actor_identity(),
        source_ip=request.remote_addr,
    )
    _audit(
        "olt_execute_script",
        entity_type="olt",
        entity_id=device_id,
        metadata={"run_mode": run_mode, "success": result.get("success"), "commands": len(commands)},
    )
    if result.get("success"):
        return jsonify(result), 200
    return jsonify(result), (502 if run_mode == "live" else 400)


@olt_bp.route("/audit-log", methods=["GET"])
@admin_required()
def get_audit_log():
    try:
        limit = int(request.args.get("limit", 50) or 50)
    except Exception:
        limit = 50
    limit = max(1, min(200, limit))
    service = _service()
    return jsonify({"success": True, "entries": service.list_audit_log(limit=limit)}), 200


@olt_bp.route("/devices/<device_id>/quick-connect-script", methods=["POST"])
@admin_required()
def quick_connect_script(device_id):
    data = request.get_json() or {}
    action = str(data.get("action", "show_pon_summary")).strip().lower()
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    platform = str(data.get("platform", "windows")).strip().lower()
    if platform not in ("windows", "linux"):
        platform = "windows"

    service = _service()
    generated = service.generate_script(device_id=device_id, action=action, payload=payload)
    if not generated.get("success"):
        return jsonify(generated), 400

    quick = generated.get("quick_connect", {})
    script = quick.get(platform) or quick.get("windows") or ""
    return jsonify(
        {
            "success": True,
            "device": generated.get("device"),
            "action": action,
            "platform": platform,
            "script": script,
            "commands": generated.get("commands", []),
        }
    ), 200


@olt_bp.route("/devices/<device_id>/autofind-onu", methods=["GET"])
@admin_required()
def autofind_onu(device_id):
    params = request.args.to_dict()
    run_mode = _parse_run_mode(params)
    live_guard = _validate_live_confirm(run_mode, params)
    if live_guard:
        return live_guard

    serial = str(params.get("serial") or "").strip()
    action = "find_onu" if serial else "show_onu_list"
    try:
        payload = _build_onu_payload(params)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    response, status = _run_vendor_action(device_id=device_id, action=action, payload=payload, run_mode=run_mode)

    _audit(
        "olt_autofind_onu",
        entity_type="olt",
        entity_id=device_id,
        metadata={"success": response.get("success"), "action": action, "run_mode": run_mode},
    )
    return jsonify(response), status


@olt_bp.route("/devices/<device_id>/authorize-onu", methods=["POST"])
@admin_required()
def authorize_onu(device_id):
    data = request.get_json() or {}
    run_mode = _parse_run_mode(data)
    live_guard = _validate_live_confirm(run_mode, data)
    if live_guard:
        return live_guard

    serial = str(data.get("serial") or "").strip()
    if not serial:
        return jsonify({"success": False, "error": "serial requerido"}), 400

    try:
        payload = _build_onu_payload(data)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    response, status = _run_vendor_action(
        device_id=device_id, action="authorize_onu", payload=payload, run_mode=run_mode
    )
    _audit(
        "olt_authorize_onu",
        entity_type="onu",
        entity_id=serial,
        metadata={"device_id": device_id, "run_mode": run_mode, "success": response.get("success")},
    )
    return jsonify(response), status


@olt_bp.route("/devices/<device_id>/pon-power", methods=["GET"])
@admin_required()
def pon_power(device_id):
    params = request.args.to_dict()
    run_mode = _parse_run_mode(params)
    live_guard = _validate_live_confirm(run_mode, params)
    if live_guard:
        return live_guard

    try:
        payload = _build_onu_payload(params)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    response, status = _run_vendor_action(
        device_id=device_id, action="show_optical_power", payload=payload, run_mode=run_mode
    )
    _audit(
        "olt_pon_power",
        entity_type="olt",
        entity_id=device_id,
        metadata={"run_mode": run_mode, "success": response.get("success")},
    )
    return jsonify(response), status


@olt_bp.route("/devices/<device_id>/onu/suspend", methods=["POST"])
@admin_required()
def suspend_onu(device_id):
    data = request.get_json() or {}
    run_mode = _parse_run_mode(data)
    live_guard = _validate_live_confirm(run_mode, data)
    if live_guard:
        return live_guard

    serial = str(data.get("serial") or "").strip()
    if not serial:
        return jsonify({"success": False, "error": "serial requerido"}), 400

    try:
        payload = _build_onu_payload(data)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    response, status = _run_vendor_action(
        device_id=device_id, action="deauthorize_onu", payload=payload, run_mode=run_mode
    )
    _audit(
        "olt_suspend_onu",
        entity_type="onu",
        entity_id=serial,
        metadata={"device_id": device_id, "run_mode": run_mode, "success": response.get("success")},
    )
    return jsonify(response), status


@olt_bp.route("/devices/<device_id>/onu/activate", methods=["POST"])
@admin_required()
def activate_onu(device_id):
    data = request.get_json() or {}
    run_mode = _parse_run_mode(data)
    live_guard = _validate_live_confirm(run_mode, data)
    if live_guard:
        return live_guard

    serial = str(data.get("serial") or "").strip()
    if not serial:
        return jsonify({"success": False, "error": "serial requerido"}), 400

    try:
        payload = _build_onu_payload(data)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    response, status = _run_vendor_action(
        device_id=device_id, action="authorize_onu", payload=payload, run_mode=run_mode
    )
    _audit(
        "olt_activate_onu",
        entity_type="onu",
        entity_id=serial,
        metadata={"device_id": device_id, "run_mode": run_mode, "success": response.get("success")},
    )
    return jsonify(response), status


@olt_bp.route("/devices/<device_id>/onu/reboot", methods=["POST"])
@admin_required()
def reboot_onu(device_id):
    data = request.get_json() or {}
    run_mode = _parse_run_mode(data)
    live_guard = _validate_live_confirm(run_mode, data)
    if live_guard:
        return live_guard

    serial = str(data.get("serial") or "").strip()
    if not serial:
        return jsonify({"success": False, "error": "serial requerido"}), 400

    try:
        payload = _build_onu_payload(data)
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    response, status = _run_vendor_action(
        device_id=device_id, action="reboot_onu", payload=payload, run_mode=run_mode
    )
    _audit(
        "olt_reboot_onu",
        entity_type="onu",
        entity_id=serial,
        metadata={"device_id": device_id, "run_mode": run_mode, "success": response.get("success")},
    )
    return jsonify(response), status


@olt_bp.route("/devices/<device_id>/tr069/reprovision", methods=["POST"])
@admin_required()
def tr069_reprovision(device_id):
    data = request.get_json() or {}
    run_mode = _parse_run_mode(data)
    live_guard = _validate_live_confirm(run_mode, data)
    if live_guard:
        return live_guard

    host = str(data.get("host") or "").strip()
    serial = str(data.get("serial") or "").strip() or None
    service = ACSService.from_app_config(current_app.config)

    payload = service.build_payload(
        device_id=device_id,
        host=host,
        serial=serial,
        run_mode=run_mode,
        tenant_id=current_tenant_id(),
        requested_by=_resolve_actor_identity(),
    )
    if not str(payload.get("host") or "").strip():
        return jsonify({"success": False, "error": "host is required"}), 400

    if run_mode in {"simulate", "dry-run"}:
        simulated = {
            "success": True,
            "device_id": device_id,
            "run_mode": run_mode,
            "acs_configured": service.config.configured,
            "acs_url": service.build_url(),
            "payload": payload,
            "message": "TR-069 reprovision simulado. Cambia run_mode=live para ejecutar en ACS.",
        }
        _audit(
            "olt_tr069_reprovision",
            entity_type="olt",
            entity_id=device_id,
            metadata={
                "acs": payload.get("host"),
                "run_mode": run_mode,
                "supported": bool(service.config.configured),
                "simulated": True,
            },
        )
        return jsonify(simulated), 200

    result, status = service.reprovision(payload)
    result.update(
        {
            "device_id": device_id,
            "run_mode": run_mode,
            "payload": payload,
        }
    )
    _audit(
        "olt_tr069_reprovision",
        entity_type="olt",
        entity_id=device_id,
        metadata={
            "acs": payload.get("host"),
            "run_mode": run_mode,
            "supported": bool(service.config.configured),
            "success": bool(result.get("success")),
            "acs_status": result.get("acs_status"),
        },
    )
    return jsonify(result), status


@olt_bp.route("/devices/<device_id>/quick-login", methods=["GET"])
@admin_required()
def quick_login(device_id):
    platform = str(request.args.get("platform", "windows")).strip().lower()
    if platform not in ("windows", "linux"):
        platform = "windows"

    service = _service()
    try:
        connect = service.quick_login_command(device_id=device_id, platform=platform)
        return jsonify({"success": True, "platform": platform, "command": connect}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 404


@olt_bp.route("/devices/<device_id>/remote-options", methods=["GET"])
@admin_required()
def remote_options(device_id):
    service = _service()
    device = service.get_device(device_id)
    if not device:
        return jsonify({"success": False, "error": "OLT not found"}), 404

    host = str(device.get("host") or "").strip()
    port = int(device.get("port") or 22)
    user = str(device.get("username") or "admin").strip() or "admin"
    transport = str(device.get("transport") or "ssh").strip().lower()
    login = f"telnet {host} {port}" if transport == "telnet" else f"ssh {user}@{host} -p {port}"

    options = {
        "direct_login": login,
        "tcp_probe_windows": f"Test-NetConnection -ComputerName {host} -Port {port}",
        "tcp_probe_linux": f"nc -vz {host} {port}",
        "jump_host_ssh": (
            f"ssh -J noc@YOUR_VPS_PUBLIC_IP {user}@{host} -p {port}"
            if transport == "ssh"
            else f"ssh -J noc@YOUR_VPS_PUBLIC_IP -L 2323:{host}:{port} noc@YOUR_VPS_PUBLIC_IP"
        ),
        "reverse_tunnel_template": (
            f"ssh -N -R 22{port}:{host}:{port} noc@YOUR_VPS_PUBLIC_IP"
            if transport == "ssh"
            else f"ssh -N -R 23{port}:{host}:{port} noc@YOUR_VPS_PUBLIC_IP"
        ),
        "recommendations": [
            "Preferir enlace privado VPN (WireGuard/IPsec) entre POP y VPS para gestion OLT.",
            "Permitir acceso solo desde ACL de gestion y no exponer puertos OLT a internet.",
            "Usar usuario tecnico dedicado con privilegios minimos para operaciones remotas.",
        ],
    }
    readiness = _build_remote_readiness(service=service, device=device)
    grafana = _build_grafana_status()

    safe_device = dict(device)
    safe_device.pop("password", None)
    safe_device.pop("enable_password", None)
    return jsonify(
        {
            "success": True,
            "device": safe_device,
            "options": options,
            "readiness": readiness,
            "grafana": grafana,
        }
    ), 200


@olt_bp.route("/tr064/test", methods=["POST"])
@admin_required()
def tr064_test():
    data = request.get_json() or {}
    host = str(data.get("host", "")).strip()
    if not host:
        return jsonify({"success": False, "message": "Host requerido"}), 400

    try:
        port = int(data.get("port") or 7547)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Port invalido"}), 400
    if port < 1 or port > 65535:
        return jsonify({"success": False, "message": "Port invalido"}), 400

    try:
        timeout = float(data.get("timeout") or 2.5)
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Timeout invalido"}), 400
    timeout = max(0.5, min(timeout, 10.0))

    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            latency_ms = round((time.perf_counter() - started) * 1000, 2)
            return (
                jsonify(
                    {
                        "success": True,
                        "message": "TR-064 reachable",
                        "host": host,
                        "port": port,
                        "latency_ms": latency_ms,
                    }
                ),
                200,
            )
    except Exception as exc:
        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        return (
            jsonify(
                {
                    "success": False,
                    "message": "TR-064 unreachable",
                    "host": host,
                    "port": port,
                    "latency_ms": latency_ms,
                    "error": str(exc),
                }
            ),
            502,
        )
