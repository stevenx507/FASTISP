from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy.orm import joinedload
from app import db
from app.models import AdminInstallation, Client, ClientNetworkProfile, User
from app.routes.auth_routes import admin_required
from app.tenancy import current_tenant_id
from .utils import (
    _service, _audit, _parse_run_mode, _validate_live_confirm, _parse_int,
    _tenant_allows_record, _build_onu_payload, _serialize_lookup_client,
    _serialize_lookup_installation, _build_zero_touch_binding_preview,
    _resolve_actor_identity, _append_note_line
)

onus_bp = Blueprint("olt_onus", __name__)

def _run_vendor_action(device_id: str, action: str, payload: dict, run_mode: str = "simulate"):
    service = _service()
    try:
        result = service.run_action(device_id=device_id, action=action, payload=payload, run_mode=run_mode)
        return result, (200 if result.get("success") else 400)
    except Exception as exc:
        return {"success": False, "error": str(exc)}, 500

@onus_bp.route("/provisioning/lookup", methods=["GET"])
@admin_required()
def provisioning_lookup():
    term = str(request.args.get("q") or "").strip().lower()
    client_id = _parse_int(request.args.get("client_id"))
    limit = _parse_int(request.args.get("limit")) or 8
    limit = max(1, min(limit, 20))
    clients: list[Client] = []
    installations: list[AdminInstallation] = []

    if client_id is not None:
        client = db.session.get(Client, client_id)
        if client and _tenant_allows_record(client.tenant_id): clients = [client]

    if term:
        query = Client.query.options(joinedload(Client.user), joinedload(Client.plan), joinedload(Client.router), joinedload(Client.network_profile)).order_by(Client.full_name.asc())
        for row in query.all():
            if not _tenant_allows_record(row.tenant_id): continue
            haystack = (str(row.id), row.full_name, row.ip_address, row.pppoe_username, row.user.email if row.user else "", row.network_profile.onu_serial if row.network_profile else "")
            if any(term in str(candidate or "").lower() for candidate in haystack): clients.append(row)
            if len(clients) >= limit: break

    open_status = {"pending", "scheduled", "in_progress"}
    for row in AdminInstallation.query.order_by(AdminInstallation.updated_at.desc()).all():
        if not _tenant_allows_record(row.tenant_id): continue
        if str(row.status or "").lower() not in open_status: continue
        if client_id is not None and row.client_id != client_id: continue
        if term and client_id is None:
            haystack = (row.id, row.client_name, row.address, row.technician, row.notes or "")
            if not any(term in str(candidate or "").lower() for candidate in haystack): continue
        installations.append(row)
        if len(installations) >= limit: break

    return jsonify({"success": True, "clients": [_serialize_lookup_client(item) for item in clients[:limit]], "installations": [_serialize_lookup_installation(item) for item in installations[:limit]]}), 200

@onus_bp.route("/devices/<device_id>/authorize-onu", methods=["POST"])
@admin_required()
def authorize_onu(device_id):
    data = request.get_json() or {}
    run_mode = _parse_run_mode(data)
    live_guard = _validate_live_confirm(run_mode, data)
    if live_guard: return live_guard
    try: payload = _build_onu_payload(data)
    except ValueError as exc: return jsonify({"success": False, "error": str(exc)}), 400

    response, status = _run_vendor_action(device_id=device_id, action="authorize_onu", payload=payload, run_mode=run_mode)
    _audit("olt_authorize_onu", entity_type="onu", entity_id=str(payload.get("serial")), metadata={"device_id": device_id, "run_mode": run_mode, "success": response.get("success")})
    return jsonify(response), status

@onus_bp.route("/devices/<device_id>/pon-power", methods=["GET"])
@admin_required()
def pon_power(device_id):
    params = request.args.to_dict()
    run_mode = _parse_run_mode(params)
    live_guard = _validate_live_confirm(run_mode, params)
    if live_guard: return live_guard
    try: payload = _build_onu_payload(params)
    except ValueError as exc: return jsonify({"success": False, "error": str(exc)}), 400
    response, status = _run_vendor_action(device_id=device_id, action="show_optical_power", payload=payload, run_mode=run_mode)
    _audit("olt_pon_power", entity_type="olt", entity_id=device_id, metadata={"run_mode": run_mode, "success": response.get("success")})
    return jsonify(response), status

@onus_bp.route("/devices/<device_id>/onu/suspend", methods=["POST"])
@admin_required()
def suspend_onu(device_id):
    data = request.get_json() or {}
    run_mode = _parse_run_mode(data)
    live_guard = _validate_live_confirm(run_mode, data)
    if live_guard: return live_guard
    try: payload = _build_onu_payload(data)
    except ValueError as exc: return jsonify({"success": False, "error": str(exc)}), 400
    response, status = _run_vendor_action(device_id=device_id, action="deauthorize_onu", payload=payload, run_mode=run_mode)
    _audit("olt_suspend_onu", entity_type="onu", entity_id=str(data.get("serial")), metadata={"device_id": device_id, "run_mode": run_mode, "success": response.get("success")})
    return jsonify(response), status

@onus_bp.route("/devices/<device_id>/onu/activate", methods=["POST"])
@admin_required()
def activate_onu(device_id):
    data = request.get_json() or {}
    run_mode = _parse_run_mode(data)
    live_guard = _validate_live_confirm(run_mode, data)
    if live_guard: return live_guard
    try: payload = _build_onu_payload(data)
    except ValueError as exc: return jsonify({"success": False, "error": str(exc)}), 400
    response, status = _run_vendor_action(device_id=device_id, action="authorize_onu", payload=payload, run_mode=run_mode)
    _audit("olt_activate_onu", entity_type="onu", entity_id=str(data.get("serial")), metadata={"device_id": device_id, "run_mode": run_mode, "success": response.get("success")})
    return jsonify(response), status

@onus_bp.route("/devices/<device_id>/onu/reboot", methods=["POST"])
@admin_required()
def reboot_onu(device_id):
    data = request.get_json() or {}
    run_mode = _parse_run_mode(data)
    live_guard = _validate_live_confirm(run_mode, data)
    if live_guard: return live_guard
    try: payload = _build_onu_payload(data)
    except ValueError as exc: return jsonify({"success": False, "error": str(exc)}), 400
    response, status = _run_vendor_action(device_id=device_id, action="reboot_onu", payload=payload, run_mode=run_mode)
    _audit("olt_reboot_onu", entity_type="onu", entity_id=str(data.get("serial")), metadata={"device_id": device_id, "run_mode": run_mode, "success": response.get("success")})
    return jsonify(response), status

@onus_bp.route("/devices/<device_id>/onu/zero-touch-provision", methods=["POST"])
@admin_required()
def zero_touch_provision(device_id):
    data = request.get_json() or {}
    run_mode = _parse_run_mode(data)
    live_guard = _validate_live_confirm(run_mode, data)
    if live_guard: return live_guard

    client_id = _parse_int(data.get("client_id"))
    if client_id is None: return jsonify({"success": False, "error": "client_id requerido"}), 400

    client = db.session.get(Client, client_id)
    if not client or not _tenant_allows_record(client.tenant_id): return jsonify({"success": False, "error": "Cliente no encontrado"}), 404

    try: payload = _build_onu_payload(data)
    except ValueError as exc: return jsonify({"success": False, "error": str(exc)}), 400

    serial = str(payload.get("serial") or "").strip().upper()
    if not serial: return jsonify({"success": False, "error": "serial requerido"}), 400
    payload["serial"] = serial

    service = _service()
    device = service.get_device(device_id)
    if not device: return jsonify({"success": False, "error": "OLT not found"}), 404

    # Simplified Zero-Touch logic for brevity in this extraction phase
    preview = _build_zero_touch_binding_preview(device_id=device_id, device=device, client=client, installation=None, payload=payload, access_technology=data.get("access_technology", "fiber"), onu_model=data.get("onu_model"), notes=data.get("notes"), actor_label=_resolve_actor_identity(), mark_installation_completed=False)
    
    response, status = _run_vendor_action(device_id=device_id, action="authorize_onu", payload=payload, run_mode=run_mode)
    
    if run_mode == "live" and response.get("success"):
        profile = client.network_profile or ClientNetworkProfile(client_id=client.id, tenant_id=client.tenant_id)
        profile.olt_id, profile.onu_serial = device_id, serial
        profile.technical_notes = _append_note_line(profile.technical_notes, preview.get("note_line"))
        db.session.add(profile)
        db.session.commit()
        response["persisted"] = True

    return jsonify(response), status
