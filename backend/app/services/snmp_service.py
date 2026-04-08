from __future__ import annotations

from datetime import datetime
import logging
import uuid
from typing import Any, Dict, Iterable, List, Optional, Tuple

from app import cache

logger = logging.getLogger(__name__)


DEFAULT_SNMP_THRESHOLDS = {
    "cpu_percent": 85.0,
    "mem_percent": 90.0,
    "temperature_c": 70.0,
    "voltage_v_min": 21.5,
    "signal_level_dbm_min": -30.0,
    "optical_rx_dbm_min": -30.0,
}

IF_NAME_OID = "1.3.6.1.2.1.31.1.1.1.1"
IF_ALIAS_OID = "1.3.6.1.2.1.31.1.1.1.18"
IF_HC_IN_OID = "1.3.6.1.2.1.31.1.1.1.6"
IF_HC_OUT_OID = "1.3.6.1.2.1.31.1.1.1.10"
IF_OPER_STATUS_OID = "1.3.6.1.2.1.2.2.1.8"


class SNMPRuntimeUnavailable(RuntimeError):
    pass


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(default)


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _normalize_oid(raw_value: Any) -> str:
    token = str(raw_value or "").strip()
    if not token:
        return ""
    return token.lstrip(".")


def _oid_suffix(oid_text: str) -> Tuple[int, ...]:
    token = _normalize_oid(oid_text)
    if not token:
        return tuple()
    return tuple(int(part) for part in token.split(".") if part.isdigit())


def _is_numeric_metric(metric_name: str) -> bool:
    name = str(metric_name or "").strip().lower()
    return bool(name) and not name.endswith("_state")


class SNMPService:
    def _runtime(self) -> Dict[str, Any]:
        try:
            from pysnmp.hlapi import (  # type: ignore
                CommunityData,
                ContextData,
                ObjectIdentity,
                ObjectType,
                SnmpEngine,
                UdpTransportTarget,
                getCmd,
                nextCmd,
            )
        except Exception as exc:  # pragma: no cover - depends on optional runtime package
            raise SNMPRuntimeUnavailable(
                "SNMP runtime unavailable. Install pysnmp to enable polling."
            ) from exc

        return {
            "CommunityData": CommunityData,
            "ContextData": ContextData,
            "ObjectIdentity": ObjectIdentity,
            "ObjectType": ObjectType,
            "SnmpEngine": SnmpEngine,
            "UdpTransportTarget": UdpTransportTarget,
            "getCmd": getCmd,
            "nextCmd": nextCmd,
        }

    def is_available(self) -> bool:
        try:
            self._runtime()
            return True
        except SNMPRuntimeUnavailable:
            return False

    def normalize_profile(
        self,
        raw_profile: Optional[Dict[str, Any]],
        *,
        default_host: str = "",
        default_label: str = "",
    ) -> Dict[str, Any]:
        payload = dict(raw_profile or {})
        scalar_metrics: Dict[str, Dict[str, Any]] = {}
        for metric_name, raw_spec in dict(payload.get("scalar_oids") or {}).items():
            normalized = self._normalize_metric_spec(metric_name, raw_spec)
            if normalized:
                scalar_metrics[str(metric_name)] = normalized

        interface_names = payload.get("interface_names")
        if isinstance(interface_names, list):
            normalized_interfaces = [str(item).strip() for item in interface_names if str(item).strip()]
        else:
            normalized_interfaces = []

        thresholds = dict(DEFAULT_SNMP_THRESHOLDS)
        raw_thresholds = payload.get("thresholds")
        if isinstance(raw_thresholds, dict):
            for key, value in raw_thresholds.items():
                try:
                    thresholds[str(key)] = float(value)
                except (TypeError, ValueError):
                    continue

        profile = {
            "enabled": _as_bool(payload.get("enabled"), default=False),
            "label": str(payload.get("label") or default_label or "SNMP device").strip(),
            "host": str(payload.get("host") or default_host or "").strip(),
            "port": min(max(_as_int(payload.get("port"), 161), 1), 65535),
            "version": "2c" if str(payload.get("version") or "2c").strip() != "1" else "1",
            "community": str(payload.get("community") or "").strip(),
            "timeout_seconds": min(max(_as_float(payload.get("timeout_seconds"), 2.0), 0.5), 15.0),
            "retries": min(max(_as_int(payload.get("retries"), 1), 0), 5),
            "poll_interfaces": _as_bool(payload.get("poll_interfaces"), default=True),
            "interface_names": normalized_interfaces,
            "scalar_oids": scalar_metrics,
            "thresholds": thresholds,
            "trap_enabled": _as_bool(payload.get("trap_enabled"), default=False),
            "trap_port": min(max(_as_int(payload.get("trap_port"), 162), 1), 65535),
        }
        profile["configured"] = bool(profile["host"] and profile["community"])
        return profile

    def sanitize_profile(self, profile: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        normalized = self.normalize_profile(profile)
        safe = dict(normalized)
        community = str(normalized.get("community") or "")
        safe["community_configured"] = bool(community)
        safe["community_preview"] = self._mask_secret(community)
        safe.pop("community", None)
        return safe

    def router_profile(self, router: Any) -> Dict[str, Any]:
        alert_config = dict(getattr(router, "alert_config", None) or {})
        return self.normalize_profile(
            alert_config.get("snmp"),
            default_host=str(getattr(router, "ip_address", "") or ""),
            default_label=str(getattr(router, "name", "") or "Router"),
        )

    def store_router_profile(self, router: Any, raw_profile: Dict[str, Any]) -> Dict[str, Any]:
        existing = self.router_profile(router)
        merged = dict(existing)
        merged.update(dict(raw_profile or {}))
        if not str(dict(raw_profile or {}).get("community") or "").strip():
            merged["community"] = str(existing.get("community") or "").strip()
        normalized = self.normalize_profile(
            merged,
            default_host=str(getattr(router, "ip_address", "") or ""),
            default_label=str(getattr(router, "name", "") or "Router"),
        )
        config = dict(getattr(router, "alert_config", None) or {})
        config["snmp"] = normalized
        router.alert_config = config
        return normalized

    def poll_router_profile(self, profile: Dict[str, Any]) -> Dict[str, Any]:
        normalized = self.normalize_profile(profile)
        self._ensure_profile_ready(normalized)

        health_metrics = self._poll_scalar_metrics(normalized)
        interfaces = self._poll_interfaces(normalized) if normalized.get("poll_interfaces") else []
        return {
            "success": True,
            "profile": self.sanitize_profile(normalized),
            "health_metrics": health_metrics,
            "interfaces": interfaces,
            "polled_at": datetime.utcnow().isoformat() + "Z",
            "source": "snmp",
            "runtime_available": True,
        }

    def poll_device_profile(
        self,
        raw_profile: Dict[str, Any],
        *,
        default_host: str = "",
        default_label: str = "",
    ) -> Dict[str, Any]:
        normalized = self.normalize_profile(
            raw_profile,
            default_host=default_host,
            default_label=default_label,
        )
        return self.poll_router_profile(normalized)

    def persist_router_poll(self, monitoring_service: Any, router: Any, poll_result: Dict[str, Any]) -> None:
        tags_base = {
            "router_id": str(getattr(router, "id", "")),
            "router_name": str(getattr(router, "name", "")),
            "source": "snmp",
        }
        tenant_id = getattr(router, "tenant_id", None)
        if tenant_id is not None:
            tags_base["tenant_id"] = str(tenant_id)

        for iface in list(poll_result.get("interfaces") or []):
            interface_name = str(iface.get("name") or "").strip()
            if not interface_name:
                continue
            tags = dict(tags_base)
            tags["interface_name"] = interface_name
            monitoring_service.write_metric(
                "interface_traffic",
                {
                    "rx_bytes": int(iface.get("rx_bytes", 0) or 0),
                    "tx_bytes": int(iface.get("tx_bytes", 0) or 0),
                    "oper_status": int(iface.get("oper_status", 0) or 0),
                },
                tags,
            )

        health = dict(poll_result.get("health_metrics") or {})
        if not health:
            return

        stats_fields = {}
        for source_key, target_key in (
            ("cpu_percent", "cpu_percent"),
            ("mem_percent", "mem_percent"),
            ("temperature_c", "temperature_c"),
            ("voltage_v", "voltage_v"),
            ("signal_level_dbm", "signal_level_dbm"),
            ("optical_rx_dbm", "optical_rx_dbm"),
            ("onu_online", "onu_online"),
            ("onu_offline", "onu_offline"),
        ):
            if health.get(source_key) is not None:
                stats_fields[target_key] = health.get(source_key)

        if stats_fields:
            monitoring_service.write_metric("router_stats", stats_fields, dict(tags_base))

        monitoring_service.write_metric("snmp_device_health", health, dict(tags_base))

    def persist_device_poll(
        self,
        monitoring_service: Any,
        *,
        device_tags: Dict[str, Any],
        poll_result: Dict[str, Any],
        measurement: str = "snmp_device_health",
    ) -> None:
        tags = {str(key): str(value) for key, value in dict(device_tags or {}).items() if value not in (None, "")}
        tags.setdefault("source", "snmp")
        health = dict(poll_result.get("health_metrics") or {})
        if health:
            monitoring_service.write_metric(measurement, health, tags)

        for iface in list(poll_result.get("interfaces") or []):
            interface_name = str(iface.get("name") or "").strip()
            if not interface_name:
                continue
            iface_tags = dict(tags)
            iface_tags["interface_name"] = interface_name
            monitoring_service.write_metric(
                "interface_traffic",
                {
                    "rx_bytes": int(iface.get("rx_bytes", 0) or 0),
                    "tx_bytes": int(iface.get("tx_bytes", 0) or 0),
                    "oper_status": int(iface.get("oper_status", 0) or 0),
                },
                iface_tags,
            )

    def normalize_trap_event(self, raw_event: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        payload = dict(raw_event or {})
        event = {
            "id": str(payload.get("id") or f"TRAP-{uuid.uuid4().hex[:12]}"),
            "severity": str(payload.get("severity") or "warning").strip().lower() or "warning",
            "scope": str(payload.get("scope") or "snmp").strip().lower() or "snmp",
            "source": str(payload.get("source") or payload.get("host") or "").strip(),
            "target": str(payload.get("target") or payload.get("device_name") or payload.get("device_id") or "").strip(),
            "message": str(payload.get("message") or "SNMP trap recibido").strip() or "SNMP trap recibido",
            "trap_oid": _normalize_oid(payload.get("trap_oid")),
            "device_id": str(payload.get("device_id") or "").strip(),
            "received_at": str(payload.get("received_at") or datetime.utcnow().isoformat() + "Z").strip(),
            "raw": payload.get("raw"),
        }
        return event

    def record_trap_event(self, tenant_id: Any, raw_event: Dict[str, Any]) -> Dict[str, Any]:
        event = self.normalize_trap_event(raw_event)
        cache_key = self._trap_cache_key(tenant_id)
        existing = cache.get(cache_key) or []
        if not isinstance(existing, list):
            existing = []
        existing.insert(0, event)
        cache.set(cache_key, existing[:100], timeout=86400 * 7)
        return event

    def list_recent_traps(self, tenant_id: Any, limit: int = 20) -> List[Dict[str, Any]]:
        cache_key = self._trap_cache_key(tenant_id)
        items = cache.get(cache_key) or []
        if not isinstance(items, list):
            return []
        safe_limit = max(1, min(int(limit or 20), 100))
        return [dict(item) for item in items[:safe_limit] if isinstance(item, dict)]

    def _trap_cache_key(self, tenant_id: Any) -> str:
        scoped = tenant_id if tenant_id is not None else "global"
        return f"snmp:traps:{scoped}"

    def _mask_secret(self, raw_value: str) -> str:
        token = str(raw_value or "")
        if not token:
            return ""
        if len(token) <= 2:
            return "*" * len(token)
        return f"{token[0]}{'*' * max(len(token) - 2, 1)}{token[-1]}"

    def _normalize_metric_spec(self, metric_name: str, raw_spec: Any) -> Optional[Dict[str, Any]]:
        if isinstance(raw_spec, str):
            oid = _normalize_oid(raw_spec)
            if not oid:
                return None
            return {"oid": oid, "scale": 1.0}

        if not isinstance(raw_spec, dict):
            return None

        oid = _normalize_oid(raw_spec.get("oid"))
        if not oid:
            return None

        return {
            "oid": oid,
            "scale": _as_float(raw_spec.get("scale"), 1.0),
        }

    def _ensure_profile_ready(self, profile: Dict[str, Any]) -> None:
        if not _as_bool(profile.get("enabled"), default=False):
            raise ValueError("SNMP profile is disabled")
        if not str(profile.get("host") or "").strip():
            raise ValueError("SNMP host is required")
        if not str(profile.get("community") or "").strip():
            raise ValueError("SNMP community is required")
        self._runtime()

    def _community_data(self, runtime: Dict[str, Any], profile: Dict[str, Any]) -> Any:
        mp_model = 0 if str(profile.get("version") or "2c") == "1" else 1
        return runtime["CommunityData"](str(profile.get("community") or ""), mpModel=mp_model)

    def _transport_target(self, runtime: Dict[str, Any], profile: Dict[str, Any]) -> Any:
        return runtime["UdpTransportTarget"](
            (str(profile.get("host") or ""), int(profile.get("port") or 161)),
            timeout=float(profile.get("timeout_seconds") or 2.0),
            retries=int(profile.get("retries") or 1),
        )

    def _poll_scalar_metrics(self, profile: Dict[str, Any]) -> Dict[str, Any]:
        scalar_oids = dict(profile.get("scalar_oids") or {})
        if not scalar_oids:
            return {}

        runtime = self._runtime()
        metric_names = list(scalar_oids.keys())
        object_types = [
            runtime["ObjectType"](runtime["ObjectIdentity"](scalar_oids[name]["oid"]))
            for name in metric_names
        ]
        iterator = runtime["getCmd"](
            runtime["SnmpEngine"](),
            self._community_data(runtime, profile),
            self._transport_target(runtime, profile),
            runtime["ContextData"](),
            *object_types,
        )
        error_indication, error_status, error_index, var_binds = next(iterator)
        if error_indication:
            raise RuntimeError(str(error_indication))
        if error_status:
            raise RuntimeError(
                f"SNMP GET failed at index {error_index}: {error_status.prettyPrint()}"
            )

        result: Dict[str, Any] = {}
        for metric_name, var_bind in zip(metric_names, var_binds):
            spec = scalar_oids.get(metric_name) or {}
            raw_value = self._coerce_snmp_value(var_bind[1])
            if raw_value is None:
                continue
            scale = _as_float(spec.get("scale"), 1.0)
            if _is_numeric_metric(metric_name):
                try:
                    raw_value = float(raw_value) * scale
                    raw_value = round(raw_value, 3)
                except (TypeError, ValueError):
                    continue
            result[str(metric_name)] = raw_value
        return result

    def _poll_interfaces(self, profile: Dict[str, Any]) -> List[Dict[str, Any]]:
        runtime = self._runtime()
        name_map = self._walk_column(runtime, profile, IF_NAME_OID)
        alias_map = self._walk_column(runtime, profile, IF_ALIAS_OID)
        rx_map = self._walk_column(runtime, profile, IF_HC_IN_OID)
        tx_map = self._walk_column(runtime, profile, IF_HC_OUT_OID)
        oper_map = self._walk_column(runtime, profile, IF_OPER_STATUS_OID)

        all_indexes = set(name_map) | set(alias_map) | set(rx_map) | set(tx_map) | set(oper_map)
        selected_names = {str(item).strip() for item in list(profile.get("interface_names") or []) if str(item).strip()}

        result: List[Dict[str, Any]] = []
        for index in sorted(all_indexes):
            interface_name = str(name_map.get(index) or alias_map.get(index) or f"ifIndex-{index[-1] if index else 0}")
            if selected_names and interface_name not in selected_names:
                continue
            result.append(
                {
                    "index": index[-1] if index else None,
                    "name": interface_name,
                    "alias": str(alias_map.get(index) or "").strip() or None,
                    "rx_bytes": int(float(rx_map.get(index) or 0)),
                    "tx_bytes": int(float(tx_map.get(index) or 0)),
                    "oper_status": int(float(oper_map.get(index) or 0)),
                }
            )
        return result

    def _walk_column(self, runtime: Dict[str, Any], profile: Dict[str, Any], oid: str) -> Dict[Tuple[int, ...], Any]:
        base_oid = _normalize_oid(oid)
        prefix = _oid_suffix(base_oid)
        rows: Dict[Tuple[int, ...], Any] = {}
        iterator = runtime["nextCmd"](
            runtime["SnmpEngine"](),
            self._community_data(runtime, profile),
            self._transport_target(runtime, profile),
            runtime["ContextData"](),
            runtime["ObjectType"](runtime["ObjectIdentity"](base_oid)),
            lexicographicMode=False,
        )
        for error_indication, error_status, error_index, var_binds in iterator:
            if error_indication:
                raise RuntimeError(str(error_indication))
            if error_status:
                raise RuntimeError(
                    f"SNMP WALK failed at index {error_index}: {error_status.prettyPrint()}"
                )
            if not var_binds:
                continue
            oid_text = _normalize_oid(var_binds[0][0].prettyPrint())
            current_suffix = _oid_suffix(oid_text)
            if prefix and current_suffix[: len(prefix)] != prefix:
                break
            row_index = current_suffix[len(prefix):]
            rows[row_index] = self._coerce_snmp_value(var_binds[0][1])
        return rows

    def _coerce_snmp_value(self, raw_value: Any) -> Any:
        if raw_value is None:
            return None
        if isinstance(raw_value, (int, float, bool)):
            return raw_value
        text = ""
        try:
            text = raw_value.prettyPrint()
        except Exception:
            text = str(raw_value)
        token = str(text or "").strip()
        if token == "":
            return None
        try:
            if "." in token:
                return float(token)
            return int(token)
        except ValueError:
            return token


snmp_service = SNMPService()
