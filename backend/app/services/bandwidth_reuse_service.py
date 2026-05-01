"""
Servicio de Reuso Dinámico de Ancho de Banda
Soporta Queue Simple, Queue Tree y Queue Mangle+Tree con algoritmos CAKE, PCQ y default.
Recalcula límites automáticamente según la cantidad de clientes activos por plan.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from flask import current_app
from routeros_api.exceptions import RouterOsApiError

from app import db
from app.models import Client, MikroTikRouter, Plan, PlanBandwidthReuse
from app.services.mikrotik_service import MikroTikService

logger = logging.getLogger(__name__)

# Ratios de reuso soportados
REUSE_RATIOS: Dict[str, int] = {
    "1:1": 1,
    "1:2": 2,
    "1:4": 4,
    "1:8": 8,
}

QUEUE_ALGORITHMS = {"default", "pcq", "cake"}
QUEUE_TYPES = {"simple", "tree", "mangle_tree"}


def _parse_reuse_ratio(ratio: str) -> int:
    """Devuelve el divisor numérico del ratio (ej. '1:4' → 4)."""
    return REUSE_RATIOS.get(str(ratio or "1:1").strip(), 1)


def _effective_speeds(
    plan_down: int,
    plan_up: int,
    active_clients: int,
    reuse_ratio: str,
) -> Tuple[int, int]:
    """
    Calcula velocidades efectivas por cliente aplicando reuso.
    Ejemplo: plan 100/20 Mbps, 4 clientes activos, ratio 1:4
      → pool = 100/4 = 25 Mbps down, 20/4 = 5 Mbps up por cliente
    Nunca baja de 1 Mbps.
    """
    divisor = _parse_reuse_ratio(reuse_ratio)
    if active_clients <= 0 or divisor <= 1:
        return plan_down, plan_up

    # Velocidad del pool compartido
    pool_down = plan_down  # Mbps totales del plan
    pool_up = plan_up

    # Velocidad efectiva por cliente = pool / clientes_activos * ratio
    # Con ratio 1:4 y 4 clientes → cada uno recibe plan_down/4
    # Con ratio 1:4 y 2 clientes → cada uno recibe plan_down/2 (mejor que el ratio)
    effective_down = max(1, math.floor(pool_down / min(active_clients, divisor)))
    effective_up = max(1, math.floor(pool_up / min(active_clients, divisor)))
    return effective_down, effective_up


class BandwidthReuseService:
    """Gestiona el reuso dinámico de ancho de banda en MikroTik."""

    def get_or_create_reuse_config(
        self, plan_id: int, tenant_id: Optional[int]
    ) -> PlanBandwidthReuse:
        """Obtiene o crea la configuración de reuso para un plan."""
        config = PlanBandwidthReuse.query.filter_by(
            plan_id=plan_id, tenant_id=tenant_id
        ).first()
        if not config:
            config = PlanBandwidthReuse(
                plan_id=plan_id,
                tenant_id=tenant_id,
                reuse_ratio="1:1",
                queue_type="simple",
                queue_algorithm="default",
                auto_adjust=True,
            )
            db.session.add(config)
            db.session.commit()
        return config

    def update_reuse_config(
        self,
        plan_id: int,
        tenant_id: Optional[int],
        reuse_ratio: str = "1:1",
        queue_type: str = "simple",
        queue_algorithm: str = "default",
        parent_queue_name: Optional[str] = None,
        auto_adjust: bool = True,
    ) -> Dict[str, Any]:
        """Actualiza la configuración de reuso de un plan."""
        if reuse_ratio not in REUSE_RATIOS:
            return {"success": False, "error": f"Ratio inválido. Use: {list(REUSE_RATIOS.keys())}"}
        if queue_type not in QUEUE_TYPES:
            return {"success": False, "error": f"Tipo de cola inválido. Use: {list(QUEUE_TYPES)}"}
        if queue_algorithm not in QUEUE_ALGORITHMS:
            return {"success": False, "error": f"Algoritmo inválido. Use: {list(QUEUE_ALGORITHMS)}"}

        config = self.get_or_create_reuse_config(plan_id, tenant_id)
        config.reuse_ratio = reuse_ratio
        config.queue_type = queue_type
        config.queue_algorithm = queue_algorithm
        config.parent_queue_name = parent_queue_name
        config.auto_adjust = auto_adjust
        config.updated_at = datetime.now(timezone.utc)
        db.session.commit()
        return {"success": True, "config": config.to_dict()}

    def count_active_clients_for_plan(
        self, plan_id: int, tenant_id: Optional[int]
    ) -> int:
        """Cuenta clientes activos con un plan dado."""
        query = Client.query.filter_by(plan_id=plan_id)
        if tenant_id is not None:
            query = query.filter_by(tenant_id=tenant_id)
        return query.count()

    def apply_reuse_to_router(
        self,
        router_id: int,
        plan_id: int,
        tenant_id: Optional[int],
        force: bool = False,
    ) -> Dict[str, Any]:
        """
        Aplica/actualiza las colas en el router MikroTik según la configuración de reuso.
        Soporta Queue Simple, Queue Tree y Mangle+Tree.
        """
        plan = db.session.get(Plan, plan_id)
        if not plan:
            return {"success": False, "error": "Plan no encontrado"}

        config = self.get_or_create_reuse_config(plan_id, tenant_id)
        active_clients = self.count_active_clients_for_plan(plan_id, tenant_id)

        # Si no cambió el número de clientes y no es forzado, omitir
        if (
            not force
            and config.last_active_clients == active_clients
            and config.last_adjusted_at is not None
        ):
            return {
                "success": True,
                "skipped": True,
                "reason": "Sin cambios en clientes activos",
                "active_clients": active_clients,
                "config": config.to_dict(),
            }

        eff_down, eff_up = _effective_speeds(
            plan.download_speed,
            plan.upload_speed,
            active_clients,
            config.reuse_ratio,
        )

        result: Dict[str, Any] = {
            "plan_id": plan_id,
            "plan_name": plan.name,
            "active_clients": active_clients,
            "reuse_ratio": config.reuse_ratio,
            "queue_type": config.queue_type,
            "queue_algorithm": config.queue_algorithm,
            "effective_down_mbps": eff_down,
            "effective_up_mbps": eff_up,
            "updated_queues": [],
            "errors": [],
        }

        # Obtener clientes del plan en este router
        clients = Client.query.filter_by(
            plan_id=plan_id, router_id=router_id
        )
        if tenant_id is not None:
            clients = clients.filter_by(tenant_id=tenant_id)
        clients = clients.all()

        with MikroTikService(router_id=router_id) as svc:
            if not svc.api:
                return {"success": False, "error": "No se pudo conectar al router"}

            if config.queue_type == "simple":
                updated = self._apply_simple_queues(
                    svc, clients, eff_down, eff_up, config.queue_algorithm
                )
            elif config.queue_type == "tree":
                updated = self._apply_queue_tree(
                    svc, plan, clients, eff_down, eff_up,
                    config.queue_algorithm, config.parent_queue_name
                )
            elif config.queue_type == "mangle_tree":
                updated = self._apply_mangle_tree(
                    svc, plan, clients, eff_down, eff_up, config.queue_algorithm
                )
            else:
                updated = {"updated": [], "errors": ["Tipo de cola no soportado"]}

            result["updated_queues"] = updated.get("updated", [])
            result["errors"] = updated.get("errors", [])

        # Actualizar registro de reuso
        config.last_active_clients = active_clients
        config.last_effective_down = eff_down
        config.last_effective_up = eff_up
        config.last_adjusted_at = datetime.now(timezone.utc)
        db.session.commit()

        result["success"] = len(result["errors"]) == 0
        return result

    def _apply_simple_queues(
        self,
        svc: MikroTikService,
        clients: List[Client],
        eff_down: int,
        eff_up: int,
        algorithm: str,
    ) -> Dict[str, Any]:
        """Actualiza Queue Simple para cada cliente."""
        updated = []
        errors = []
        queue_api = svc.api.get_resource("/queue/simple")

        for client in clients:
            if not client.ip_address:
                continue
            queue_name = f"client_{client.id}"
            try:
                existing = queue_api.get(name=queue_name)
                limit = f"{eff_down}M/{eff_up}M"
                queue_params: Dict[str, Any] = {
                    "max-limit": limit,
                    "comment": f"[reuso] {client.full_name} | {eff_down}/{eff_up}M",
                }
                if algorithm == "cake":
                    queue_params["queue"] = "cake/cake"
                elif algorithm == "pcq":
                    queue_params["queue"] = "PCQ_Download/PCQ_Upload"

                if existing:
                    queue_api.set(id=existing[0][".id"], **queue_params)
                    updated.append({"client_id": client.id, "name": queue_name, "limit": limit})
                else:
                    # Crear cola si no existe
                    queue_params.update({
                        "name": queue_name,
                        "target": client.ip_address,
                    })
                    queue_api.add(**queue_params)
                    updated.append({"client_id": client.id, "name": queue_name, "limit": limit, "created": True})
            except (RouterOsApiError, Exception) as exc:
                errors.append({"client_id": client.id, "error": str(exc)})

        return {"updated": updated, "errors": errors}

    def _apply_queue_tree(
        self,
        svc: MikroTikService,
        plan: Plan,
        clients: List[Client],
        eff_down: int,
        eff_up: int,
        algorithm: str,
        parent_queue_name: Optional[str],
    ) -> Dict[str, Any]:
        """
        Aplica Queue Tree:
        1. Crea/actualiza cola padre del plan con el ancho de banda total del plan.
        2. Crea/actualiza colas hijas por cliente con el límite efectivo.
        """
        updated = []
        errors = []

        try:
            tree_api = svc.api.get_resource("/queue/tree")
            parent_name = parent_queue_name or f"plan_{plan.id}_{plan.name.replace(' ', '_')}"
            total_down = plan.download_speed
            total_up = plan.upload_speed

            # Cola padre (download)
            parent_down = f"{parent_name}_down"
            existing_parent = tree_api.get(name=parent_down)
            parent_params_down: Dict[str, Any] = {
                "max-limit": f"{total_down}M",
                "parent": "global",
                "comment": f"Plan {plan.name} - DOWN pool",
            }
            if algorithm == "cake":
                parent_params_down["queue"] = "cake"
            if existing_parent:
                tree_api.set(id=existing_parent[0][".id"], **parent_params_down)
            else:
                tree_api.add(name=parent_down, **parent_params_down)

            # Cola padre (upload)
            parent_up_name = f"{parent_name}_up"
            existing_parent_up = tree_api.get(name=parent_up_name)
            parent_params_up: Dict[str, Any] = {
                "max-limit": f"{total_up}M",
                "parent": "global",
                "comment": f"Plan {plan.name} - UP pool",
            }
            if algorithm == "cake":
                parent_params_up["queue"] = "cake"
            if existing_parent_up:
                tree_api.set(id=existing_parent_up[0][".id"], **parent_params_up)
            else:
                tree_api.add(name=parent_up_name, **parent_params_up)

            updated.append({"type": "parent_queue", "name": parent_down, "limit": f"{total_down}M"})
            updated.append({"type": "parent_queue", "name": parent_up_name, "limit": f"{total_up}M"})

            # Colas hijas por cliente
            for client in clients:
                if not client.ip_address:
                    continue
                child_down = f"c{client.id}_down"
                child_up = f"c{client.id}_up"
                try:
                    child_params_down: Dict[str, Any] = {
                        "max-limit": f"{eff_down}M",
                        "parent": parent_down,
                        "packet-mark": f"client_{client.id}_down",
                        "comment": f"[reuso] {client.full_name} DOWN",
                    }
                    child_params_up: Dict[str, Any] = {
                        "max-limit": f"{eff_up}M",
                        "parent": parent_up_name,
                        "packet-mark": f"client_{client.id}_up",
                        "comment": f"[reuso] {client.full_name} UP",
                    }
                    for child_name, child_params in [
                        (child_down, child_params_down),
                        (child_up, child_params_up),
                    ]:
                        existing_child = tree_api.get(name=child_name)
                        if existing_child:
                            tree_api.set(id=existing_child[0][".id"], **child_params)
                        else:
                            tree_api.add(name=child_name, **child_params)
                    updated.append({
                        "client_id": client.id,
                        "down_queue": child_down,
                        "up_queue": child_up,
                        "limit": f"{eff_down}/{eff_up}M",
                    })
                except (RouterOsApiError, Exception) as exc:
                    errors.append({"client_id": client.id, "error": str(exc)})

        except (RouterOsApiError, Exception) as exc:
            errors.append({"error": f"Error en Queue Tree: {exc}"})

        return {"updated": updated, "errors": errors}

    def _apply_mangle_tree(
        self,
        svc: MikroTikService,
        plan: Plan,
        clients: List[Client],
        eff_down: int,
        eff_up: int,
        algorithm: str,
    ) -> Dict[str, Any]:
        """
        Aplica Mangle + Queue Tree:
        1. Crea reglas mangle para marcar tráfico por cliente.
        2. Crea Queue Tree con las marcas.
        """
        updated = []
        errors = []

        try:
            mangle_api = svc.api.get_resource("/ip/firewall/mangle")
            tree_api = svc.api.get_resource("/queue/tree")

            for client in clients:
                if not client.ip_address:
                    continue
                mark_down = f"client_{client.id}_down"
                mark_up = f"client_{client.id}_up"

                try:
                    # Mangle: marcar paquetes de descarga (dst-address = IP cliente)
                    existing_mangle_down = mangle_api.get(
                        chain="forward",
                        action="mark-packet",
                        **{"new-packet-mark": mark_down},
                    )
                    if not existing_mangle_down:
                        mangle_api.add(
                            chain="forward",
                            **{"dst-address": client.ip_address},
                            action="mark-packet",
                            **{"new-packet-mark": mark_down, "passthrough": "yes"},
                            comment=f"[reuso] DOWN {client.full_name}",
                        )

                    # Mangle: marcar paquetes de subida (src-address = IP cliente)
                    existing_mangle_up = mangle_api.get(
                        chain="forward",
                        action="mark-packet",
                        **{"new-packet-mark": mark_up},
                    )
                    if not existing_mangle_up:
                        mangle_api.add(
                            chain="forward",
                            **{"src-address": client.ip_address},
                            action="mark-packet",
                            **{"new-packet-mark": mark_up, "passthrough": "yes"},
                            comment=f"[reuso] UP {client.full_name}",
                        )

                    # Queue Tree hija para este cliente
                    child_name = f"c{client.id}_mangle"
                    existing_tree = tree_api.get(name=child_name)
                    tree_params: Dict[str, Any] = {
                        "max-limit": f"{eff_down}M",
                        "parent": "global",
                        "packet-mark": mark_down,
                        "comment": f"[mangle-reuso] {client.full_name}",
                    }
                    if algorithm == "cake":
                        tree_params["queue"] = "cake"
                    elif algorithm == "pcq":
                        tree_params["queue"] = "PCQ_Download"

                    if existing_tree:
                        tree_api.set(id=existing_tree[0][".id"], **tree_params)
                    else:
                        tree_api.add(name=child_name, **tree_params)

                    updated.append({
                        "client_id": client.id,
                        "mark_down": mark_down,
                        "mark_up": mark_up,
                        "limit": f"{eff_down}/{eff_up}M",
                    })
                except (RouterOsApiError, Exception) as exc:
                    errors.append({"client_id": client.id, "error": str(exc)})

        except (RouterOsApiError, Exception) as exc:
            errors.append({"error": f"Error en Mangle+Tree: {exc}"})

        return {"updated": updated, "errors": errors}

    def apply_all_plans_on_router(
        self, router_id: int, tenant_id: Optional[int]
    ) -> Dict[str, Any]:
        """Aplica reuso para todos los planes con auto_adjust=True en un router."""
        configs = PlanBandwidthReuse.query.filter_by(
            auto_adjust=True, tenant_id=tenant_id
        ).all()
        results = []
        for cfg in configs:
            res = self.apply_reuse_to_router(router_id, cfg.plan_id, tenant_id)
            results.append(res)
        return {
            "router_id": router_id,
            "plans_processed": len(results),
            "results": results,
        }

    def get_reuse_summary(self, tenant_id: Optional[int]) -> List[Dict[str, Any]]:
        """Resumen del estado de reuso por plan."""
        configs = PlanBandwidthReuse.query
        if tenant_id is not None:
            configs = configs.filter_by(tenant_id=tenant_id)
        configs = configs.all()

        summary = []
        for cfg in configs:
            plan = db.session.get(Plan, cfg.plan_id)
            if not plan:
                continue
            active = self.count_active_clients_for_plan(cfg.plan_id, tenant_id)
            eff_down, eff_up = _effective_speeds(
                plan.download_speed, plan.upload_speed, active, cfg.reuse_ratio
            )
            summary.append({
                **cfg.to_dict(),
                "plan_name": plan.name,
                "plan_down": plan.download_speed,
                "plan_up": plan.upload_speed,
                "current_active_clients": active,
                "current_effective_down": eff_down,
                "current_effective_up": eff_up,
            })
        return summary


bandwidth_reuse_service = BandwidthReuseService()
