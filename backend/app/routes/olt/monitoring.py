import time
import socket
import ipaddress
from flask import Blueprint, jsonify, request, current_app
from app.routes.auth_routes import admin_required
from app.services.snmp_service import snmp_service
from app.services.monitoring_service import monitoring_service
from .utils import _service, _audit, _sanitize_olt_device, _as_bool, _resolve_olt_credentials, _parse_run_mode, _validate_live_confirm, _resolve_actor_identity
from app.services.acs_service import ACSService
from app.tenancy import current_tenant_id

monitoring_bp = Blueprint("olt_monitoring", __name__)

def _probe_tcp(host: str, port: int, timeout_seconds: float = 2.5) -> dict:
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout_seconds):
            latency_ms = round((time.perf_counter() - started) * 1000, 2)
            return {"reachable": True, "latency_ms": latency_ms, "error": None}
    except Exception as exc:
        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        return {"reachable": False, "latency_ms": latency_ms, "error": str(exc)}

def _classify_management_host(host: str) -> dict:
    host = str(host or "").strip()
    if not host:
        return {"kind": "missing", "label": "Sin host", "detail": "Define host o IP de gestion para habilitar pruebas remotas.", "recommended_path": "configure_host", "vpn_recommended": True}
    try:
        parsed = ipaddress.ip_address(host)
    except ValueError:
        return {"kind": "hostname", "label": "Hostname / DDNS", "detail": "Gestion por nombre. Verifica DNS o DDNS desde el backend.", "recommended_path": "resolve_dns", "vpn_recommended": False}
    if parsed.is_loopback:
        return {"kind": "loopback_ip", "label": "Loopback", "detail": "La IP apunta al loopback y no sirve para gestionar la OLT desde la VPS.", "recommended_path": "fix_host", "vpn_recommended": False}
    if parsed.is_link_local:
        return {"kind": "link_local_ip", "label": "Link-local", "detail": "La IP es link-local y normalmente solo sirve dentro del mismo segmento.", "recommended_path": "vpn_or_jump_host", "vpn_recommended": True}
    if parsed.is_private:
        return {"kind": "private_ip", "label": "IP privada", "detail": "La OLT usa direccion privada. La gestion remota requiere VPN, ACL o jump host.", "recommended_path": "vpn_or_jump_host", "vpn_recommended": True}
    return {"kind": "public_ip", "label": "IP publica", "detail": "La OLT es alcanzable por IP publica. Mantener ACL y preferir SSH.", "recommended_path": "direct_or_vpn", "vpn_recommended": False}

def _summarize_olt_readiness(readiness: dict | None) -> dict:
    readiness = readiness or {}
    checks = readiness.get("checks") if isinstance(readiness.get("checks"), list) else []
    score = int(readiness.get("score") or 0)
    failed_critical = any(isinstance(check, dict) and not check.get("ok") and str(check.get("severity") or "") == "critical" for check in checks)
    failed_warning = any(isinstance(check, dict) and not check.get("ok") for check in checks)
    if failed_critical: return {"status": "blocked", "label": "Bloqueado", "summary": "La OLT no esta lista para ejecucion live desde backend."}
    if failed_warning or score < 85: return {"status": "degraded", "label": "Degradado", "summary": "La OLT responde, pero todavia hay guardrails o mejoras pendientes."}
    return {"status": "ready", "label": "Listo", "summary": "La OLT esta lista para operacion remota controlada."}

def _build_remote_readiness(service, device: dict, timeout_seconds: float = 2.5) -> dict:
    host = str(device.get("host") or "").strip()
    port = int(device.get("port") or 22)
    transport = str(device.get("transport") or "ssh").strip().lower()
    host_analysis = _classify_management_host(host)
    credentials = _resolve_olt_credentials(service, device)
    username = str(credentials.get("username") or "").strip()
    has_password = bool(str(credentials.get("password") or "").strip())
    tcp_probe = {"reachable": False, "latency_ms": None, "error": "Host is empty"}
    if host: tcp_probe = _probe_tcp(host=host, port=port, timeout_seconds=timeout_seconds)

    checks = [
        {"id": "host_configured", "label": "Host OLT configurado", "ok": bool(host), "detail": host or "Define host/IP para habilitar pruebas remotas.", "severity": "critical" if not host else "ok"},
        {"id": "tcp_reachable", "label": "Puerto de gestion accesible desde backend", "ok": bool(host) and bool(tcp_probe.get("reachable")), "detail": f"{host}:{port} reachable ({tcp_probe.get('latency_ms')} ms)" if host and tcp_probe.get("reachable") else str(tcp_probe.get("error") or "No se pudo abrir socket TCP."), "severity": "critical" if not tcp_probe.get("reachable") else "ok"},
        {"id": "transport_security", "label": "Transporte seguro", "ok": transport == "ssh", "detail": "SSH activo." if transport == "ssh" else "Telnet detectado. Solo recomendado dentro de VPN privada.", "severity": "warning" if transport != "ssh" else "ok"},
        {"id": "credentials_ready", "label": "Credenciales listas para live mode", "ok": bool(username) and has_password, "detail": f'Usuario "{username}" con password cargado.' if bool(username) and has_password else "Falta username/password.", "severity": "critical" if not has_password else "ok"},
        {"id": "live_guardrail", "label": "Guardrail de ejecucion live", "ok": True, "detail": "El backend exige run_mode=live + live_confirm=true para ejecutar comandos reales.", "severity": "ok"},
    ]
    score = sum(20 if item["ok"] else 0 for item in checks) # Simplified weighting
    missing = []
    if not host: missing.append("Registrar host/IP de la OLT.")
    if host and not tcp_probe.get("reachable"): missing.append("Abrir ruta TCP desde backend/VPS hacia OLT (ACL + VPN).")
    if transport != "ssh": missing.append("Migrar gestion a SSH o aislar Telnet dentro de tunel privado.")
    if not has_password: missing.append("Definir credenciales OLT.")
    
    readiness_summary = _summarize_olt_readiness({"checks": checks, "score": score})
    return {"score": score, "checks": checks, "tcp_probe": tcp_probe, "missing": missing, "host_analysis": host_analysis, "status": readiness_summary["status"], "status_label": readiness_summary["label"], "summary": readiness_summary["summary"], "checked_at": int(time.time())}

def _build_grafana_status() -> dict:
    raw_dashboard_url = str(current_app.config.get("GRAFANA_URL") or "").strip()
    datasource_uid = str(current_app.config.get("GRAFANA_DATASOURCE_UID") or "").strip() or None
    return {"configured": bool(raw_dashboard_url), "dashboard_url": raw_dashboard_url or None, "datasource_uid": datasource_uid}

@monitoring_bp.route("/devices/<device_id>/snapshot", methods=["GET"])
@admin_required()
def get_snapshot(device_id):
    service = _service()
    result = service.get_snapshot(device_id)
    _audit("olt_snapshot", entity_type="olt", entity_id=device_id, metadata={"success": result.get("success")})
    return jsonify(result), (200 if result.get("success") else 404)

@monitoring_bp.route("/devices/<device_id>/snmp/poll", methods=["POST"])
@admin_required()
def poll_olt_snmp(device_id):
    service = _service()
    device = service.get_device(device_id)
    if not device: return jsonify({"success": False, "error": "OLT not found"}), 404
    payload = request.get_json(silent=True) or {}
    overrides = payload.get("profile") if isinstance(payload.get("profile"), dict) else {}
    persist = _as_bool(payload.get("persist"))
    profile = dict(device.get("snmp") or {})
    if overrides: profile.update(overrides)

    result = snmp_service.poll_device_profile(profile, default_host=str(device.get("host") or ""), default_label=str(device.get("name") or device_id))
    if persist:
        snmp_service.persist_device_poll(monitoring_service, device_tags={"device_id": str(device.get("id") or ""), "device_name": str(device.get("name") or "")}, result=result)
    return jsonify(result), (200 if result.get("success") else 500)

@monitoring_bp.route("/devices/<device_id>/diagnostics", methods=["GET"])
@admin_required()
def get_diagnostics(device_id):
    service = _service()
    device = service.get_device(device_id)
    if not device: return jsonify({"success": False, "error": "OLT not found"}), 404
    readiness = _build_remote_readiness(service=service, device=device)
    return jsonify({"success": True, "device": _sanitize_olt_device(device), "readiness": readiness}), 200

@monitoring_bp.route("/external/grafana/status", methods=["GET"])
@admin_required()
def get_grafana_status():
    return jsonify({"success": True, "grafana": _build_grafana_status()}), 200

@monitoring_bp.route("/devices/<device_id>/tr069/reprovision", methods=["POST"])
@admin_required()
def tr069_reprovision(device_id):
    data = request.get_json() or {}
    run_mode = _parse_run_mode(data)
    live_guard = _validate_live_confirm(run_mode, data)
    if live_guard: return live_guard
    host, serial = str(data.get("host") or "").strip(), str(data.get("serial") or "").strip() or None
    service = ACSService.from_app_config(current_app.config)
    payload = service.build_payload(device_id=device_id, host=host, serial=serial, run_mode=run_mode, tenant_id=current_tenant_id(), requested_by=_resolve_actor_identity())
    if not str(payload.get("host") or "").strip(): return jsonify({"success": False, "error": "host is required"}), 400
    if run_mode != "live":
        return jsonify({"success": True, "message": "Simulado", "payload": payload}), 200
    result, status = service.reprovision(payload)
    return jsonify(result), status

@monitoring_bp.route("/devices/<device_id>/quick-login", methods=["GET"])
@admin_required()
def quick_login(device_id):
    platform = str(request.args.get("platform", "windows")).strip().lower()
    if platform not in ("windows", "linux"): platform = "windows"
    service = _service()
    try:
        connect = service.quick_login_command(device_id=device_id, platform=platform)
        return jsonify({"success": True, "platform": platform, "command": connect}), 200
    except ValueError as exc: return jsonify({"success": False, "error": str(exc)}), 404

@monitoring_bp.route("/devices/<device_id>/remote-options", methods=["GET"])
@admin_required()
def remote_options(device_id):
    service = _service()
    device = service.get_device(device_id)
    if not device: return jsonify({"success": False, "error": "OLT not found"}), 404
    readiness = _build_remote_readiness(service=service, device=device)
    grafana = _build_grafana_status()
    return jsonify({"success": True, "device": _sanitize_olt_device(device), "readiness": readiness, "grafana": grafana}), 200

@monitoring_bp.route("/tr064/test", methods=["POST"])
@admin_required()
def tr064_test():
    data = request.get_json() or {}
    host = str(data.get("host", "")).strip()
    if not host: return jsonify({"success": False, "message": "Host requerido"}), 400
    try: port = int(data.get("port") or 7547)
    except (TypeError, ValueError): return jsonify({"success": False, "message": "Port invalido"}), 400
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=2.5):
            latency_ms = round((time.perf_counter() - started) * 1000, 2)
            return jsonify({"success": True, "latency_ms": latency_ms}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 502
