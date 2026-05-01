"""
Rutas para módulos nuevos:
  - Nodos de red (NAPs, mufas, splitters, antenas)
  - Reuso dinámico de ancho de banda
  - NAT remoto (acceso sin IP pública)
  - Consulta de deuda pública (sin login)
  - Perfil de red extendido del cliente
  - Descuentos de planes
"""
from __future__ import annotations

import ipaddress
import logging
from datetime import datetime, date, timezone
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import get_jwt_identity, jwt_required
from routeros_api.exceptions import RouterOsApiError

from app import db, limiter
from app.models import (
    Client,
    ClientDebtQuery,
    ClientNetworkProfile,
    Invoice,
    MikroTikRouter,
    NetworkNode,
    Plan,
    PlanBandwidthReuse,
    PlanDiscount,
    RemoteNatRule,
    Subscription,
    Tenant,
    User,
)
from app.routes.auth_routes import admin_required, staff_required, _current_user_id
from app.services.bandwidth_reuse_service import bandwidth_reuse_service, REUSE_RATIOS, QUEUE_TYPES, QUEUE_ALGORITHMS
from app.services.mikrotik_service import MikroTikService
from app.services.monitoring_service import monitoring_service
from app.tenancy import current_tenant_id, tenant_access_allowed

network_bp = Blueprint("network", __name__)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# ANALYTICS & TOPOLOGY
# ─────────────────────────────────────────────────────────────────────────────

@network_bp.route("/analytics/traffic", methods=["GET"])
@admin_required()
def get_network_traffic_analytics():
    """
    Obtiene métricas históricas de tráfico para el dashboard avanzado.
    Rango por defecto: 24h.
    """
    router_id = request.args.get("router_id")
    time_range = request.args.get("range", "-24h")
    
    tags = {}
    if router_id:
        tags["router_id"] = str(router_id)
        
    try:
        # Consultar tráfico agregado
        metrics = monitoring_service.query_metrics(
            measurement="client_traffic",
            time_range=time_range,
            tags=tags,
            fields=["download_rate", "upload_rate"]
        )
        return jsonify({"metrics": metrics})
    except Exception as e:
        logger.error(f"Error fetching traffic analytics: {e}")
        return jsonify({"error": str(e)}), 500

@network_bp.route("/topology", methods=["GET"])
@admin_required()
def get_network_topology():
    """
    Genera un grafo de la topología de red (Routers -> Nodos -> Clientes).
    """
    tenant_id = current_tenant_id()
    
    # 1. Routers
    router_query = MikroTikRouter.query.filter_by(is_active=True)
    if tenant_id:
        router_query = router_query.filter_by(tenant_id=tenant_id)
    routers = router_query.all()
    
    nodes_graph = []
    edges = []
    
    for r in routers:
        nodes_graph.append({
            "id": f"router_{r.id}",
            "type": "router",
            "label": r.name,
            "status": "online" # Simplificado
        })
        
        # 2. Nodos conectados a este router
        child_nodes = NetworkNode.query.filter_by(router_id=r.id).all()
        for n in child_nodes:
            nodes_graph.append({
                "id": f"node_{n.id}",
                "type": n.node_type,
                "label": n.name,
                "status": n.status
            })
            edges.append({"from": f"router_{r.id}", "to": f"node_{n.id}"})
            
            # 3. Clientes conectados a este nodo (vía perfil de red)
            # Nota: Esto puede ser pesado si hay miles, limitamos para la vista de topología
            clients_in_node = ClientNetworkProfile.query.filter_by(nap_id=n.id).limit(20).all()
            for cp in clients_in_node:
                nodes_graph.append({
                    "id": f"client_{cp.client_id}",
                    "type": "client",
                    "label": f"C-{cp.client_id}",
                    "status": "online"
                })
                edges.append({"from": f"node_{n.id}", "to": f"client_{cp.client_id}"})
                
    return jsonify({"nodes": nodes_graph, "edges": edges})

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_int(v) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _parse_float(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _parse_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    return str(v or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _parse_date(v) -> Optional[date]:
    if not v:
        return None
    try:
        return date.fromisoformat(str(v))
    except Exception:
        return None


def _validate_ip(ip: str) -> bool:
    try:
        ipaddress.ip_address(ip)
        return True
    except ValueError:
        return False


def _validate_port(port) -> bool:
    p = _parse_int(port)
    return p is not None and 1 <= p <= 65535


# ─────────────────────────────────────────────────────────────────────────────
# MÓDULO DE RED: Nodos (NAPs, mufas, splitters, antenas)
# ─────────────────────────────────────────────────────────────────────────────

NODE_TYPES = {"nap", "mufa", "splitter", "antenna", "olt", "router", "caja", "poste", "otro"}
NODE_TECHNOLOGIES = {"fiber", "wireless", "coax", "copper"}
NODE_STATUSES = {"active", "inactive", "maintenance", "fault"}


@network_bp.route("/nodes", methods=["GET"])
@admin_required()
def list_network_nodes():
    """Lista todos los nodos de red del tenant."""
    tenant_id = current_tenant_id()
    query = NetworkNode.query
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)

    node_type = request.args.get("node_type")
    technology = request.args.get("technology")
    status = request.args.get("status")
    zone = request.args.get("zone")

    if node_type:
        query = query.filter_by(node_type=node_type)
    if technology:
        query = query.filter_by(technology=technology)
    if status:
        query = query.filter_by(status=status)
    if zone:
        query = query.filter(NetworkNode.zone.ilike(f"%{zone}%"))

    nodes = query.order_by(NetworkNode.name).all()
    return jsonify({"nodes": [n.to_dict() for n in nodes], "total": len(nodes)})


@network_bp.route("/nodes/map", methods=["GET"])
@admin_required()
def network_nodes_map():
    """
    Devuelve nodos + clientes con coordenadas para el mapa.
    Incluye estado online/offline de clientes basado en conexiones activas.
    """
    tenant_id = current_tenant_id()

    # Nodos con coordenadas
    node_query = NetworkNode.query.filter(
        NetworkNode.latitude.isnot(None),
        NetworkNode.longitude.isnot(None),
    )
    if tenant_id is not None:
        node_query = node_query.filter_by(tenant_id=tenant_id)
    nodes = [n.to_dict() for n in node_query.all()]

    # Clientes con coordenadas
    client_query = Client.query.filter(
        Client.latitude.isnot(None),
        Client.longitude.isnot(None),
    )
    if tenant_id is not None:
        client_query = client_query.filter_by(tenant_id=tenant_id)
    clients_raw = client_query.all()

    # Intentar obtener IPs activas de todos los routers del tenant
    active_ips: set = set()
    router_query = MikroTikRouter.query.filter_by(is_active=True)
    if tenant_id is not None:
        router_query = router_query.filter_by(tenant_id=tenant_id)
    for router in router_query.all():
        try:
            with MikroTikService(router_id=router.id) as svc:
                if svc.api:
                    conns = svc.get_active_connections()
                    for c in conns:
                        if c.get("address"):
                            active_ips.add(c["address"])
        except Exception:
            pass

    clients_map = []
    for c in clients_raw:
        status = "online" if c.ip_address and c.ip_address in active_ips else "offline"
        profile = c.network_profile
        clients_map.append({
            **c.to_dict(),
            "lat": c.latitude,
            "lng": c.longitude,
            "status": status,
            "access_technology": profile.access_technology if profile else "unknown",
            "nap_id": profile.nap_id if profile else None,
        })

    return jsonify({
        "nodes": nodes,
        "clients": clients_map,
        "active_ips_count": len(active_ips),
    })


@network_bp.route("/nodes", methods=["POST"])
@admin_required()
def create_network_node():
    """Crea un nuevo nodo de red."""
    tenant_id = current_tenant_id()
    data = request.get_json(silent=True) or {}

    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "El campo 'name' es requerido"}), 400

    node_type = str(data.get("node_type") or "nap").strip()
    if node_type not in NODE_TYPES:
        return jsonify({"error": f"node_type inválido. Use: {sorted(NODE_TYPES)}"}), 400

    technology = str(data.get("technology") or "fiber").strip()
    if technology not in NODE_TECHNOLOGIES:
        return jsonify({"error": f"technology inválido. Use: {sorted(NODE_TECHNOLOGIES)}"}), 400

    node = NetworkNode(
        tenant_id=tenant_id,
        name=name,
        node_type=node_type,
        technology=technology,
        latitude=_parse_float(data.get("latitude")),
        longitude=_parse_float(data.get("longitude")),
        address=str(data.get("address") or "").strip() or None,
        zone=str(data.get("zone") or "").strip() or None,
        capacity=_parse_int(data.get("capacity")),
        used_ports=_parse_int(data.get("used_ports")) or 0,
        parent_node_id=_parse_int(data.get("parent_node_id")),
        router_id=_parse_int(data.get("router_id")),
        status=str(data.get("status") or "active").strip(),
        notes=str(data.get("notes") or "").strip() or None,
        installed_at=None,
        created_by=_current_user_id(),
    )
    db.session.add(node)
    db.session.commit()
    return jsonify({"node": node.to_dict()}), 201


@network_bp.route("/nodes/<int:node_id>", methods=["GET"])
@admin_required()
def get_network_node(node_id: int):
    node = db.session.get(NetworkNode, node_id)
    if not node or not tenant_access_allowed(node.tenant_id):
        return jsonify({"error": "Nodo no encontrado"}), 404
    # Incluir hijos
    children = [c.to_dict() for c in node.children]
    return jsonify({"node": node.to_dict(), "children": children})


@network_bp.route("/nodes/<int:node_id>", methods=["PUT", "PATCH"])
@admin_required()
def update_network_node(node_id: int):
    node = db.session.get(NetworkNode, node_id)
    if not node or not tenant_access_allowed(node.tenant_id):
        return jsonify({"error": "Nodo no encontrado"}), 404

    data = request.get_json(silent=True) or {}
    if "name" in data:
        node.name = str(data["name"]).strip()
    if "node_type" in data and data["node_type"] in NODE_TYPES:
        node.node_type = data["node_type"]
    if "technology" in data and data["technology"] in NODE_TECHNOLOGIES:
        node.technology = data["technology"]
    if "latitude" in data:
        node.latitude = _parse_float(data["latitude"])
    if "longitude" in data:
        node.longitude = _parse_float(data["longitude"])
    if "address" in data:
        node.address = str(data["address"] or "").strip() or None
    if "zone" in data:
        node.zone = str(data["zone"] or "").strip() or None
    if "capacity" in data:
        node.capacity = _parse_int(data["capacity"])
    if "used_ports" in data:
        node.used_ports = _parse_int(data["used_ports"]) or 0
    if "parent_node_id" in data:
        node.parent_node_id = _parse_int(data["parent_node_id"])
    if "router_id" in data:
        node.router_id = _parse_int(data["router_id"])
    if "status" in data and data["status"] in NODE_STATUSES:
        node.status = data["status"]
    if "notes" in data:
        node.notes = str(data["notes"] or "").strip() or None

    db.session.commit()
    return jsonify({"node": node.to_dict()})


@network_bp.route("/nodes/<int:node_id>", methods=["DELETE"])
@admin_required()
def delete_network_node(node_id: int):
    node = db.session.get(NetworkNode, node_id)
    if not node or not tenant_access_allowed(node.tenant_id):
        return jsonify({"error": "Nodo no encontrado"}), 404
    db.session.delete(node)
    db.session.commit()
    return jsonify({"success": True})


# ─────────────────────────────────────────────────────────────────────────────
# PERFIL DE RED EXTENDIDO DEL CLIENTE
# ─────────────────────────────────────────────────────────────────────────────

ACCESS_TECHNOLOGIES = {"fiber", "wireless", "coax", "copper", "docsis"}
BILLING_TYPES = {"prepaid", "postpaid", "date_to_date"}


@network_bp.route("/clients/<int:client_id>/network-profile", methods=["GET"])
@staff_required()
def get_client_network_profile(client_id: int):
    client = db.session.get(Client, client_id)
    if not client or not tenant_access_allowed(client.tenant_id):
        return jsonify({"error": "Cliente no encontrado"}), 404
    profile = client.network_profile
    return jsonify({"profile": profile.to_dict() if profile else None})


@network_bp.route("/clients/<int:client_id>/network-profile", methods=["PUT", "POST"])
@admin_required()
def upsert_client_network_profile(client_id: int):
    """Crea o actualiza el perfil de red extendido del cliente."""
    client = db.session.get(Client, client_id)
    if not client or not tenant_access_allowed(client.tenant_id):
        return jsonify({"error": "Cliente no encontrado"}), 404

    data = request.get_json(silent=True) or {}
    profile = client.network_profile
    if not profile:
        profile = ClientNetworkProfile(
            client_id=client_id,
            tenant_id=client.tenant_id,
        )
        db.session.add(profile)

    # Tipo de acceso
    if "access_technology" in data and data["access_technology"] in ACCESS_TECHNOLOGIES:
        profile.access_technology = data["access_technology"]

    # Fibra
    for field in ["olt_id", "olt_port", "onu_serial", "onu_model", "fiber_color", "fiber_port"]:
        if field in data:
            setattr(profile, field, str(data[field] or "").strip() or None)
    if "splitter_id" in data:
        profile.splitter_id = _parse_int(data["splitter_id"])
    if "nap_id" in data:
        profile.nap_id = _parse_int(data["nap_id"])

    # Antena
    for field in ["antenna_model", "antenna_ssid", "antenna_frequency"]:
        if field in data:
            setattr(profile, field, str(data[field] or "").strip() or None)
    if "signal_level_dbm" in data:
        profile.signal_level_dbm = _parse_float(data["signal_level_dbm"])
    if "ap_node_id" in data:
        profile.ap_node_id = _parse_int(data["ap_node_id"])

    # Documento
    if "document_type" in data:
        profile.document_type = str(data["document_type"] or "").strip() or None
    if "document_number" in data:
        profile.document_number = str(data["document_number"] or "").strip() or None

    # Facturación
    if "billing_type" in data and data["billing_type"] in BILLING_TYPES:
        profile.billing_type = data["billing_type"]
    if "billing_day" in data:
        profile.billing_day = _parse_int(data["billing_day"])
    if "billing_start_date" in data:
        profile.billing_start_date = _parse_date(data["billing_start_date"])
    if "discount_percent" in data:
        try:
            profile.discount_percent = max(0, min(100, float(data["discount_percent"])))
        except (TypeError, ValueError):
            pass
    if "discount_reason" in data:
        profile.discount_reason = str(data["discount_reason"] or "").strip() or None
    if "loyalty_months" in data:
        profile.loyalty_months = _parse_int(data["loyalty_months"]) or 0

    # Notas
    if "installation_notes" in data:
        profile.installation_notes = str(data["installation_notes"] or "").strip() or None
    if "technical_notes" in data:
        profile.technical_notes = str(data["technical_notes"] or "").strip() or None
    if "internal_emails" in data and isinstance(data["internal_emails"], list):
        profile.internal_emails = data["internal_emails"]

    db.session.commit()
    return jsonify({"profile": profile.to_dict()})


# ─────────────────────────────────────────────────────────────────────────────
# REUSO DINÁMICO DE ANCHO DE BANDA
# ─────────────────────────────────────────────────────────────────────────────

@network_bp.route("/bandwidth-reuse", methods=["GET"])
@admin_required()
def list_bandwidth_reuse():
    """Resumen del estado de reuso por plan."""
    tenant_id = current_tenant_id()
    summary = bandwidth_reuse_service.get_reuse_summary(tenant_id)
    return jsonify({"reuse_configs": summary, "total": len(summary)})


@network_bp.route("/bandwidth-reuse/<int:plan_id>", methods=["GET"])
@admin_required()
def get_bandwidth_reuse(plan_id: int):
    tenant_id = current_tenant_id()
    config = bandwidth_reuse_service.get_or_create_reuse_config(plan_id, tenant_id)
    plan = db.session.get(Plan, plan_id)
    if not plan:
        return jsonify({"error": "Plan no encontrado"}), 404
    active = bandwidth_reuse_service.count_active_clients_for_plan(plan_id, tenant_id)
    from app.services.bandwidth_reuse_service import _effective_speeds
    eff_down, eff_up = _effective_speeds(
        plan.download_speed, plan.upload_speed, active, config.reuse_ratio
    )
    return jsonify({
        "config": config.to_dict(),
        "plan_name": plan.name,
        "plan_down": plan.download_speed,
        "plan_up": plan.upload_speed,
        "current_active_clients": active,
        "current_effective_down": eff_down,
        "current_effective_up": eff_up,
        "available_ratios": list(REUSE_RATIOS.keys()),
        "available_queue_types": list(QUEUE_TYPES),
        "available_algorithms": list(QUEUE_ALGORITHMS),
    })


@network_bp.route("/bandwidth-reuse/<int:plan_id>", methods=["PUT", "POST"])
@admin_required()
def update_bandwidth_reuse(plan_id: int):
    """Actualiza la configuración de reuso de un plan."""
    tenant_id = current_tenant_id()
    data = request.get_json(silent=True) or {}
    result = bandwidth_reuse_service.update_reuse_config(
        plan_id=plan_id,
        tenant_id=tenant_id,
        reuse_ratio=str(data.get("reuse_ratio") or "1:1"),
        queue_type=str(data.get("queue_type") or "simple"),
        queue_algorithm=str(data.get("queue_algorithm") or "default"),
        parent_queue_name=str(data.get("parent_queue_name") or "").strip() or None,
        auto_adjust=_parse_bool(data.get("auto_adjust", True)),
    )
    if not result.get("success"):
        return jsonify(result), 400
    return jsonify(result)


@network_bp.route("/bandwidth-reuse/<int:plan_id>/apply/<int:router_id>", methods=["POST"])
@admin_required()
def apply_bandwidth_reuse(plan_id: int, router_id: int):
    """Aplica el reuso de ancho de banda en un router para un plan."""
    tenant_id = current_tenant_id()
    data = request.get_json(silent=True) or {}
    force = _parse_bool(data.get("force", False))
    result = bandwidth_reuse_service.apply_reuse_to_router(
        router_id=router_id,
        plan_id=plan_id,
        tenant_id=tenant_id,
        force=force,
    )
    status_code = 200 if result.get("success") else 500
    return jsonify(result), status_code


@network_bp.route("/bandwidth-reuse/apply-all/<int:router_id>", methods=["POST"])
@admin_required()
def apply_all_bandwidth_reuse(router_id: int):
    """Aplica reuso para todos los planes con auto_adjust=True en un router."""
    tenant_id = current_tenant_id()
    result = bandwidth_reuse_service.apply_all_plans_on_router(router_id, tenant_id)
    return jsonify(result)


# ─────────────────────────────────────────────────────────────────────────────
# NAT REMOTO: Acceso sin IP pública
# ─────────────────────────────────────────────────────────────────────────────

PROTOCOLS = {"tcp", "udp"}


@network_bp.route("/nat-rules", methods=["GET"])
@admin_required()
def list_nat_rules():
    tenant_id = current_tenant_id()
    query = RemoteNatRule.query
    if tenant_id is not None:
        query = query.filter_by(tenant_id=tenant_id)
    router_id = _parse_int(request.args.get("router_id"))
    if router_id:
        query = query.filter_by(router_id=router_id)
    rules = query.order_by(RemoteNatRule.created_at.desc()).all()
    return jsonify({"rules": [r.to_dict() for r in rules], "total": len(rules)})


@network_bp.route("/nat-rules", methods=["POST"])
@admin_required()
def create_nat_rule():
    """
    Crea una regla NAT en MikroTik para acceso remoto a un nodo sin IP pública.
    Ejemplo: puerto 2222 del router → 192.168.1.10:22 (SSH a nodo interno)
    """
    tenant_id = current_tenant_id()
    data = request.get_json(silent=True) or {}

    router_id = _parse_int(data.get("router_id"))
    if not router_id:
        return jsonify({"error": "router_id es requerido"}), 400

    router = db.session.get(MikroTikRouter, router_id)
    if not router or not tenant_access_allowed(router.tenant_id):
        return jsonify({"error": "Router no encontrado"}), 404

    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "El campo 'name' es requerido"}), 400

    protocol = str(data.get("protocol") or "tcp").lower()
    if protocol not in PROTOCOLS:
        return jsonify({"error": f"Protocolo inválido. Use: {sorted(PROTOCOLS)}"}), 400

    src_port = _parse_int(data.get("src_port"))
    dst_port = _parse_int(data.get("dst_port"))
    dst_address = str(data.get("dst_address") or "").strip()

    if not src_port or not _validate_port(src_port):
        return jsonify({"error": "src_port inválido (1-65535)"}), 400
    if not dst_port or not _validate_port(dst_port):
        return jsonify({"error": "dst_port inválido (1-65535)"}), 400
    if not dst_address or not _validate_ip(dst_address):
        return jsonify({"error": "dst_address debe ser una IP válida"}), 400

    # Aplicar regla en MikroTik
    mikrotik_rule_id = None
    apply_error = None
    try:
        with MikroTikService(router_id=router_id) as svc:
            if svc.api:
                nat_api = svc.api.get_resource("/ip/firewall/nat")
                result = nat_api.add(
                    chain="dstnat",
                    protocol=protocol,
                    **{"dst-port": str(src_port)},
                    action="dst-nat",
                    **{"to-addresses": dst_address, "to-ports": str(dst_port)},
                    comment=f"[remote-access] {name}",
                    disabled="no",
                )
                mikrotik_rule_id = result.get("id") if isinstance(result, dict) else None
            else:
                apply_error = "No se pudo conectar al router; regla guardada sin aplicar"
    except (RouterOsApiError, Exception) as exc:
        apply_error = str(exc)

    rule = RemoteNatRule(
        tenant_id=tenant_id,
        router_id=router_id,
        name=name,
        protocol=protocol,
        src_port=src_port,
        dst_address=dst_address,
        dst_port=dst_port,
        description=str(data.get("description") or "").strip() or None,
        is_active=True,
        mikrotik_rule_id=mikrotik_rule_id,
        created_by=_current_user_id(),
    )
    db.session.add(rule)
    db.session.commit()

    response = {"rule": rule.to_dict(), "applied": apply_error is None}
    if apply_error:
        response["warning"] = apply_error
    return jsonify(response), 201


@network_bp.route("/nat-rules/<int:rule_id>", methods=["DELETE"])
@admin_required()
def delete_nat_rule(rule_id: int):
    """Elimina una regla NAT de la BD y del router MikroTik."""
    rule = db.session.get(RemoteNatRule, rule_id)
    if not rule or not tenant_access_allowed(rule.tenant_id):
        return jsonify({"error": "Regla no encontrada"}), 404

    remove_error = None
    if rule.mikrotik_rule_id:
        try:
            with MikroTikService(router_id=rule.router_id) as svc:
                if svc.api:
                    nat_api = svc.api.get_resource("/ip/firewall/nat")
                    nat_api.remove(id=rule.mikrotik_rule_id)
        except (RouterOsApiError, Exception) as exc:
            remove_error = str(exc)

    db.session.delete(rule)
    db.session.commit()
    response: Dict[str, Any] = {"success": True}
    if remove_error:
        response["warning"] = f"Regla eliminada de BD pero error en router: {remove_error}"
    return jsonify(response)


@network_bp.route("/nat-rules/<int:rule_id>/toggle", methods=["POST"])
@admin_required()
def toggle_nat_rule(rule_id: int):
    """Habilita o deshabilita una regla NAT."""
    rule = db.session.get(RemoteNatRule, rule_id)
    if not rule or not tenant_access_allowed(rule.tenant_id):
        return jsonify({"error": "Regla no encontrada"}), 404

    rule.is_active = not rule.is_active
    toggle_error = None

    if rule.mikrotik_rule_id:
        try:
            with MikroTikService(router_id=rule.router_id) as svc:
                if svc.api:
                    nat_api = svc.api.get_resource("/ip/firewall/nat")
                    nat_api.set(
                        id=rule.mikrotik_rule_id,
                        disabled="no" if rule.is_active else "yes",
                    )
        except (RouterOsApiError, Exception) as exc:
            toggle_error = str(exc)

    db.session.commit()
    response = {"rule": rule.to_dict()}
    if toggle_error:
        response["warning"] = toggle_error
    return jsonify(response)


@network_bp.route("/nat-rules/test-access", methods=["POST"])
@admin_required()
def test_nat_access():
    """
    Prueba de conectividad: intenta abrir socket TCP al puerto NAT del router.
    Útil para verificar que el acceso remoto funciona.
    """
    import socket as sock_module
    data = request.get_json(silent=True) or {}
    router_id = _parse_int(data.get("router_id"))
    src_port = _parse_int(data.get("src_port"))

    if not router_id or not src_port:
        return jsonify({"error": "router_id y src_port son requeridos"}), 400

    router = db.session.get(MikroTikRouter, router_id)
    if not router or not tenant_access_allowed(router.tenant_id):
        return jsonify({"error": "Router no encontrado"}), 404

    host = router.ip_address
    timeout = 3
    try:
        s = sock_module.create_connection((host, src_port), timeout=timeout)
        s.close()
        reachable = True
        error = None
    except Exception as exc:
        reachable = False
        error = str(exc)

    return jsonify({
        "host": host,
        "port": src_port,
        "reachable": reachable,
        "error": error,
    })


# ─────────────────────────────────────────────────────────────────────────────
# CONSULTA DE DEUDA PÚBLICA (sin login, rate-limited)
# ─────────────────────────────────────────────────────────────────────────────

@network_bp.route("/public/debt-query", methods=["POST"])
@limiter.limit("10 per minute")
def public_debt_query():
    """
    Consulta pública de deuda por número de documento.
    No requiere autenticación. Rate-limited a 10 req/min por IP.
    """
    data = request.get_json(silent=True) or {}
    document_number = str(data.get("document_number") or "").strip()
    tenant_slug = str(data.get("tenant_slug") or "").strip()

    if not document_number:
        return jsonify({"error": "El número de documento es requerido"}), 400
    if len(document_number) < 4 or len(document_number) > 30:
        return jsonify({"error": "Número de documento inválido"}), 400

    # Resolver tenant
    tenant_id = None
    if tenant_slug:
        tenant = Tenant.query.filter_by(slug=tenant_slug, is_active=True).first()
        if tenant:
            tenant_id = tenant.id

    # Buscar perfil de red por documento
    profile_query = ClientNetworkProfile.query.filter_by(document_number=document_number)
    if tenant_id is not None:
        profile_query = profile_query.filter_by(tenant_id=tenant_id)
    profile = profile_query.first()

    result_found = profile is not None

    # Registrar consulta para auditoría
    query_log = ClientDebtQuery(
        tenant_id=tenant_id,
        document_number=document_number,
        ip_address=request.headers.get("X-Forwarded-For", request.remote_addr),
        result_found=result_found,
    )
    db.session.add(query_log)
    db.session.commit()

    if not result_found:
        return jsonify({
            "found": False,
            "message": "No se encontró información para el documento ingresado.",
        })

    client = db.session.get(Client, profile.client_id)
    if not client:
        return jsonify({"found": False, "message": "Cliente no encontrado."})

    # Obtener facturas pendientes
    invoices_query = (
        Invoice.query
        .join(Subscription, Invoice.subscription_id == Subscription.id)
        .filter(Subscription.client_id == client.id)
        .filter(Invoice.status.in_(["pending", "past_due"]))
        .order_by(Invoice.due_date.asc())
    )
    pending_invoices = invoices_query.all()

    # Obtener suscripción activa
    active_sub = Subscription.query.filter_by(
        client_id=client.id, status="active"
    ).first()
    suspended_sub = Subscription.query.filter_by(
        client_id=client.id, status="suspended"
    ).first()

    service_status = "active"
    if suspended_sub:
        service_status = "suspended"
    elif not active_sub:
        service_status = "inactive"

    total_debt = sum(float(inv.total_amount or 0) for inv in pending_invoices)

    return jsonify({
        "found": True,
        "client_name": client.full_name,
        "service_status": service_status,
        "plan_name": client.plan.name if client.plan else None,
        "billing_type": profile.billing_type,
        "total_debt": round(total_debt, 2),
        "currency": active_sub.currency if active_sub else "USD",
        "pending_invoices": [
            {
                "id": inv.id,
                "amount": float(inv.total_amount or 0),
                "due_date": inv.due_date.isoformat() if inv.due_date else None,
                "status": inv.status,
            }
            for inv in pending_invoices[:5]  # Máximo 5 facturas
        ],
        "next_charge": active_sub.next_charge.isoformat() if active_sub and active_sub.next_charge else None,
    })


# ─────────────────────────────────────────────────────────────────────────────
# DESCUENTOS DE PLANES
# ─────────────────────────────────────────────────────────────────────────────

@network_bp.route("/plans/<int:plan_id>/discounts", methods=["GET"])
@admin_required()
def list_plan_discounts(plan_id: int):
    tenant_id = current_tenant_id()
    plan = db.session.get(Plan, plan_id)
    if not plan or not tenant_access_allowed(plan.tenant_id):
        return jsonify({"error": "Plan no encontrado"}), 404
    discounts = PlanDiscount.query.filter_by(plan_id=plan_id).all()
    return jsonify({"discounts": [d.to_dict() for d in discounts]})


@network_bp.route("/plans/<int:plan_id>/discounts", methods=["POST"])
@admin_required()
def create_plan_discount(plan_id: int):
    tenant_id = current_tenant_id()
    plan = db.session.get(Plan, plan_id)
    if not plan or not tenant_access_allowed(plan.tenant_id):
        return jsonify({"error": "Plan no encontrado"}), 404

    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "El campo 'name' es requerido"}), 400

    discount_type = str(data.get("discount_type") or "percent")
    if discount_type not in {"percent", "fixed"}:
        return jsonify({"error": "discount_type debe ser 'percent' o 'fixed'"}), 400

    try:
        discount_value = float(data.get("discount_value") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": "discount_value inválido"}), 400

    discount = PlanDiscount(
        tenant_id=tenant_id,
        plan_id=plan_id,
        name=name,
        discount_type=discount_type,
        discount_value=discount_value,
        min_loyalty_months=_parse_int(data.get("min_loyalty_months")) or 0,
        valid_from=_parse_date(data.get("valid_from")),
        valid_until=_parse_date(data.get("valid_until")),
        is_active=_parse_bool(data.get("is_active", True)),
    )
    db.session.add(discount)
    db.session.commit()
    return jsonify({"discount": discount.to_dict()}), 201


@network_bp.route("/plans/discounts/<int:discount_id>", methods=["PUT", "PATCH"])
@admin_required()
def update_plan_discount(discount_id: int):
    discount = db.session.get(PlanDiscount, discount_id)
    if not discount or not tenant_access_allowed(discount.tenant_id):
        return jsonify({"error": "Descuento no encontrado"}), 404

    data = request.get_json(silent=True) or {}
    if "name" in data:
        discount.name = str(data["name"]).strip()
    if "discount_type" in data and data["discount_type"] in {"percent", "fixed"}:
        discount.discount_type = data["discount_type"]
    if "discount_value" in data:
        try:
            discount.discount_value = float(data["discount_value"])
        except (TypeError, ValueError):
            pass
    if "min_loyalty_months" in data:
        discount.min_loyalty_months = _parse_int(data["min_loyalty_months"]) or 0
    if "valid_from" in data:
        discount.valid_from = _parse_date(data["valid_from"])
    if "valid_until" in data:
        discount.valid_until = _parse_date(data["valid_until"])
    if "is_active" in data:
        discount.is_active = _parse_bool(data["is_active"])

    db.session.commit()
    return jsonify({"discount": discount.to_dict()})


@network_bp.route("/plans/discounts/<int:discount_id>", methods=["DELETE"])
@admin_required()
def delete_plan_discount(discount_id: int):
    discount = db.session.get(PlanDiscount, discount_id)
    if not discount or not tenant_access_allowed(discount.tenant_id):
        return jsonify({"error": "Descuento no encontrado"}), 404
    db.session.delete(discount)
    db.session.commit()
    return jsonify({"success": True})


# ─────────────────────────────────────────────────────────────────────────────
# TICKETS: Vista por estado (hoy, vencidos, resueltos)
# ─────────────────────────────────────────────────────────────────────────────

@network_bp.route("/tickets/dashboard", methods=["GET"])
@staff_required()
def tickets_dashboard():
    """
    Resumen de tickets agrupados por estado para el panel de técnicos.
    Incluye: hoy, vencidos (SLA), en progreso, resueltos hoy.
    """
    from app.models import Ticket
    tenant_id = current_tenant_id()
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    base = Ticket.query
    if tenant_id is not None:
        base = base.filter_by(tenant_id=tenant_id)

    # Tickets abiertos hoy
    today_tickets = base.filter(
        Ticket.status.in_(["open", "in_progress"]),
        Ticket.created_at >= today_start,
    ).order_by(Ticket.priority.desc(), Ticket.created_at.asc()).all()

    # Tickets vencidos (SLA expirado y no resueltos)
    overdue_tickets = base.filter(
        Ticket.status.in_(["open", "in_progress"]),
        Ticket.sla_due_at < now,
        Ticket.sla_due_at.isnot(None),
    ).order_by(Ticket.sla_due_at.asc()).all()

    # Tickets en progreso
    in_progress = base.filter(
        Ticket.status == "in_progress"
    ).order_by(Ticket.updated_at.desc()).limit(20).all()

    # Resueltos hoy
    resolved_today = base.filter(
        Ticket.status.in_(["resolved", "closed"]),
        Ticket.updated_at >= today_start,
    ).order_by(Ticket.updated_at.desc()).all()

    # Totales por prioridad (abiertos)
    open_tickets = base.filter(Ticket.status.in_(["open", "in_progress"])).all()
    priority_counts = {"low": 0, "medium": 0, "high": 0, "urgent": 0}
    for t in open_tickets:
        if t.priority in priority_counts:
            priority_counts[t.priority] += 1

    return jsonify({
        "today": [t.to_dict() for t in today_tickets],
        "overdue": [t.to_dict() for t in overdue_tickets],
        "in_progress": [t.to_dict() for t in in_progress],
        "resolved_today": [t.to_dict() for t in resolved_today],
        "summary": {
            "today_count": len(today_tickets),
            "overdue_count": len(overdue_tickets),
            "in_progress_count": len(in_progress),
            "resolved_today_count": len(resolved_today),
            "open_total": len(open_tickets),
            "by_priority": priority_counts,
        },
    })


# ─────────────────────────────────────────────────────────────────────────────
# ALERTAS DE RED
# ─────────────────────────────────────────────────────────────────────────────

@network_bp.route("/alerts", methods=["GET"])
@staff_required()
def network_alerts():
    """
    Genera alertas de red en tiempo real a partir de:
      - Routers sin heartbeat reciente (offline)
      - Nodos de red en estado fault/maintenance
      - Facturas vencidas (alerta financiera)
    Respuesta: { alerts: [{ id, severity, message, scope?, target?, since? }] }
    """
    from datetime import timedelta
    tenant_id = current_tenant_id()
    now = datetime.now(timezone.utc)
    alerts: List[Dict[str, Any]] = []

    # --- 1. Routers offline (sin heartbeat en últimos 10 min) ---
    try:
        routers_q = MikroTikRouter.query
        if tenant_id is not None:
            routers_q = routers_q.filter_by(tenant_id=tenant_id)
        routers = routers_q.filter_by(is_active=True).all()
        offline_threshold = now - timedelta(minutes=10)
        for r in routers:
            if r.last_seen is None or r.last_seen < offline_threshold:
                since = r.last_seen.isoformat() if r.last_seen else None
                alerts.append({
                    "id": f"router-offline-{r.id}",
                    "severity": "critical",
                    "scope": "router",
                    "target": r.name or f"Router #{r.id}",
                    "message": f"Router '{r.name or r.id}' sin respuesta desde {r.last_seen.strftime('%H:%M') if r.last_seen else 'nunca'}",
                    "since": since,
                })
    except Exception as exc:
        logger.warning("Error generando alertas de routers: %s", exc)

    # --- 2. Nodos de red en estado fault o maintenance ---
    try:
        fault_nodes = NetworkNode.query.filter(
            NetworkNode.status.in_(("fault", "maintenance"))
        )
        if tenant_id is not None:
            fault_nodes = fault_nodes.filter_by(tenant_id=tenant_id)
        for node in fault_nodes.all():
            sev = "critical" if node.status == "fault" else "warning"
            alerts.append({
                "id": f"node-{node.status}-{node.id}",
                "severity": sev,
                "scope": "infrastructure",
                "target": node.name or f"Nodo #{node.id}",
                "message": f"Nodo '{node.name or node.id}' en estado {node.status}",
                "since": node.updated_at.isoformat() if getattr(node, "updated_at", None) else None,
            })
    except Exception as exc:
        logger.warning("Error generando alertas de nodos: %s", exc)

    # --- 3. Facturas vencidas (resumen) ---
    try:
        overdue_q = (
            Invoice.query
            .join(Subscription, Invoice.subscription_id == Subscription.id)
            .filter(Invoice.status == "pending", Invoice.due_date < date.today())
        )
        if tenant_id is not None:
            overdue_q = overdue_q.filter(Subscription.tenant_id == tenant_id)
        overdue_count = overdue_q.count()
        if overdue_count > 0:
            alerts.append({
                "id": "billing-overdue",
                "severity": "warning",
                "scope": "billing",
                "target": "Facturación",
                "message": f"{overdue_count} factura(s) vencida(s) sin cobrar",
            })
    except Exception as exc:
        logger.warning("Error generando alertas de facturación: %s", exc)

    # Ordenar: critical primero, luego warning, luego info
    severity_order = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: severity_order.get(a.get("severity", "info"), 9))

    return jsonify({"alerts": alerts, "count": len(alerts)})


# ─────────────────────────────────────────────────────────────────────────────
# FINANZAS: Estadísticas avanzadas
# ─────────────────────────────────────────────────────────────────────────────

@network_bp.route("/finance/stats", methods=["GET"])
@admin_required()
def finance_stats():
    """
    Estadísticas financieras: ingresos por servicio, cliente y fecha.
    Parámetros: ?from=YYYY-MM-DD&to=YYYY-MM-DD&group_by=plan|client|month
    """
    from sqlalchemy import func
    tenant_id = current_tenant_id()

    date_from = _parse_date(request.args.get("from"))
    date_to = _parse_date(request.args.get("to"))
    group_by = str(request.args.get("group_by") or "month")

    inv_query = (
        Invoice.query
        .join(Subscription, Invoice.subscription_id == Subscription.id)
    )
    if tenant_id is not None:
        inv_query = inv_query.filter(Subscription.tenant_id == tenant_id)
    if date_from:
        inv_query = inv_query.filter(Invoice.due_date >= date_from)
    if date_to:
        inv_query = inv_query.filter(Invoice.due_date <= date_to)

    invoices = inv_query.all()

    # Totales generales
    total_billed = sum(float(i.total_amount or 0) for i in invoices)
    total_paid = sum(float(i.total_amount or 0) for i in invoices if i.status == "paid")
    total_pending = sum(float(i.total_amount or 0) for i in invoices if i.status == "pending")
    total_overdue = sum(
        float(i.total_amount or 0)
        for i in invoices
        if i.status == "pending" and i.due_date and i.due_date < date.today()
    )

    # Agrupación por mes
    by_month: Dict[str, Dict[str, float]] = {}
    for inv in invoices:
        if not inv.due_date:
            continue
        key = inv.due_date.strftime("%Y-%m")
        if key not in by_month:
            by_month[key] = {"billed": 0.0, "paid": 0.0, "pending": 0.0}
        by_month[key]["billed"] += float(inv.total_amount or 0)
        if inv.status == "paid":
            by_month[key]["paid"] += float(inv.total_amount or 0)
        elif inv.status == "pending":
            by_month[key]["pending"] += float(inv.total_amount or 0)

    # Agrupación por plan
    by_plan: Dict[str, float] = {}
    for inv in invoices:
        sub = inv.subscription
        plan_name = str(sub.plan if sub else "Sin plan")
        by_plan[plan_name] = by_plan.get(plan_name, 0.0) + float(inv.total_amount or 0)

    return jsonify({
        "summary": {
            "total_billed": round(total_billed, 2),
            "total_paid": round(total_paid, 2),
            "total_pending": round(total_pending, 2),
            "total_overdue": round(total_overdue, 2),
            "collection_rate": round((total_paid / total_billed * 100) if total_billed > 0 else 0, 1),
            "invoice_count": len(invoices),
        },
        "by_month": [
            {"month": k, **v} for k, v in sorted(by_month.items())
        ],
        "by_plan": [
            {"plan": k, "total": round(v, 2)} for k, v in sorted(by_plan.items(), key=lambda x: -x[1])
        ],
    })
