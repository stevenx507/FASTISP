"""
NetworkFactory - Pilar 24: Soporte Multi-Vendor

Patrón Factory que instancia el servicio correcto según el device_type
del router/OLT registrado en la base de datos.

Tipos de dispositivo soportados:
    - 'mikrotik'   → MikroTik RouterOS (API nativa)
    - 'huawei_olt' → Huawei MA/OLT (SSH/Telnet)
    - 'vsol_olt'   → VSOL OLT (SSH)
    - 'zte_olt'    → ZTE OLT (Telnet/SSH)

Uso:
    from app.services.network_factory import NetworkFactory

    service = NetworkFactory.get_service(router)
    result = service.get_active_clients()
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Protocolo base: todo servicio de red debe implementar esta interfaz mínima
# ---------------------------------------------------------------------------

@runtime_checkable
class NetworkServiceProtocol(Protocol):
    """Interfaz mínima que cualquier driver de dispositivo debe cumplir."""

    def test_connection(self) -> Dict[str, Any]:
        """Verifica conectividad con el dispositivo."""
        ...

    def get_device_info(self) -> Dict[str, Any]:
        """Retorna información básica del dispositivo."""
        ...


# ---------------------------------------------------------------------------
# Adaptador MikroTik (envuelve el MikroTikService existente)
# ---------------------------------------------------------------------------

class MikroTikNetworkAdapter:
    """
    Adaptador para dispositivos MikroTik RouterOS.
    Delega al MikroTikService ya existente en el proyecto.
    """

    DEVICE_TYPE = "mikrotik"

    def __init__(self, router) -> None:
        self.router = router
        self._router_id = router.id

    def test_connection(self) -> Dict[str, Any]:
        try:
            from app.services.mikrotik_service import MikroTikService
            svc = MikroTikService(self.router)
            result = svc.test_connection()
            return {"success": True, "device_type": self.DEVICE_TYPE, "result": result}
        except Exception as exc:
            logger.error("MikroTikAdapter.test_connection error: %s", exc)
            return {"success": False, "device_type": self.DEVICE_TYPE, "error": str(exc)}

    def get_device_info(self) -> Dict[str, Any]:
        return {
            "device_type": self.DEVICE_TYPE,
            "id": self.router.id,
            "name": self.router.name,
            "ip_address": self.router.ip_address,
            "api_port": self.router.api_port,
        }

    def get_active_clients(self):
        from app.services.mikrotik_service import MikroTikService
        return MikroTikService(self.router).get_active_clients()

    def suspend_client(self, client):
        from app.services.mikrotik_service import MikroTikService
        return MikroTikService(self.router).suspend_client(client)

    def reactivate_client(self, client):
        from app.services.mikrotik_service import MikroTikService
        return MikroTikService(self.router).reactivate_client(client)


# ---------------------------------------------------------------------------
# Adaptador OLT Base (Huawei / VSOL / ZTE)
# ---------------------------------------------------------------------------

class OLTNetworkAdapter:
    """
    Adaptador para OLTs de Huawei, VSOL y ZTE.
    Usa el OltService para las operaciones de red óptica.
    """

    def __init__(self, router, vendor: str) -> None:
        self.router = router
        self.vendor = vendor  # 'huawei', 'vsol', 'zte'
        self.device_type = router.device_type  # ej: 'huawei_olt'

    def _get_olt_service(self):
        from app.services.olt_service import OltService
        return OltService(self.router)

    def test_connection(self) -> Dict[str, Any]:
        svc = self._get_olt_service()
        return svc.test_connection()

    def get_device_info(self) -> Dict[str, Any]:
        return {
            "device_type": self.device_type,
            "vendor": self.vendor,
            "id": self.router.id,
            "name": self.router.name,
            "ip_address": self.router.ip_address,
        }

    def authorize_onu(self, serial: str, pon_port: str, onu_id: int, **kwargs) -> Dict[str, Any]:
        svc = self._get_olt_service()
        return svc.authorize_onu(
            serial=serial,
            pon_port=pon_port,
            onu_id=onu_id,
            vendor=self.vendor,
            **kwargs
        )

    def get_optical_power(self, pon_port: str) -> Dict[str, Any]:
        svc = self._get_olt_service()
        return svc.get_optical_power(pon_port=pon_port, vendor=self.vendor)

    def list_onus(self, pon_port: Optional[str] = None) -> Dict[str, Any]:
        svc = self._get_olt_service()
        return svc.list_onus(pon_port=pon_port, vendor=self.vendor)

    def deauthorize_onu(self, pon_port: str, onu_id: int) -> Dict[str, Any]:
        svc = self._get_olt_service()
        return svc.deauthorize_onu(pon_port=pon_port, onu_id=onu_id, vendor=self.vendor)

    def reboot_onu(self, pon_port: str, onu_id: int) -> Dict[str, Any]:
        svc = self._get_olt_service()
        return svc.reboot_onu(pon_port=pon_port, onu_id=onu_id, vendor=self.vendor)

    # ── Stubs para compatibilidad con la interfaz del protocolo ──────────────
    def get_active_clients(self) -> Dict[str, Any]:
        """Las OLTs no gestionan clientes directamente; retornar lista de ONUs activas."""
        return self.list_onus()

    def suspend_client(self, client) -> Dict[str, Any]:
        """En OLTs, suspender = desautorizar ONU."""
        logger.warning(
            "OLTAdapter.suspend_client: operación de suspensión en OLT no implementada "
            "de forma automática. Se requiere pon_port y onu_id."
        )
        return {"success": False, "error": "Suspensión en OLT requiere pon_port y onu_id explícitos."}

    def reactivate_client(self, client) -> Dict[str, Any]:
        logger.warning("OLTAdapter.reactivate_client: requiere autorización manual de ONU.")
        return {"success": False, "error": "Reactivación en OLT requiere autorización manual de ONU."}


# ---------------------------------------------------------------------------
# Factory principal
# ---------------------------------------------------------------------------

# Mapa de device_type → (clase adaptadora, kwargs adicionales)
_DEVICE_TYPE_MAP: Dict[str, tuple] = {
    "mikrotik":   (MikroTikNetworkAdapter, {}),
    "huawei_olt": (OLTNetworkAdapter, {"vendor": "huawei"}),
    "vsol_olt":   (OLTNetworkAdapter, {"vendor": "vsol"}),
    "zte_olt":    (OLTNetworkAdapter, {"vendor": "zte"}),
}


class NetworkFactory:
    """
    Fábrica de servicios de red.

    Instancia el adaptador correcto según el `device_type` del router/OLT.
    Permite añadir nuevos drivers sin modificar el código existente.
    """

    @staticmethod
    def get_service(router) -> Any:
        """
        Retorna el adaptador de red adecuado para el dispositivo dado.

        Args:
            router: Instancia de MikroTikRouter (o cualquier objeto con .device_type).

        Returns:
            Instancia del adaptador correspondiente.

        Raises:
            ValueError: Si el device_type no está soportado.
        """
        device_type = (getattr(router, "device_type", None) or "mikrotik").strip().lower()

        entry = _DEVICE_TYPE_MAP.get(device_type)
        if not entry:
            supported = ", ".join(_DEVICE_TYPE_MAP.keys())
            raise ValueError(
                f"device_type '{device_type}' no soportado. "
                f"Tipos válidos: {supported}"
            )

        adapter_class, extra_kwargs = entry
        logger.debug(
            "NetworkFactory: instanciando %s para router_id=%s (device_type=%s)",
            adapter_class.__name__,
            getattr(router, "id", "?"),
            device_type,
        )
        return adapter_class(router, **extra_kwargs)

    @staticmethod
    def is_olt(router) -> bool:
        """Devuelve True si el dispositivo es una OLT (no MikroTik)."""
        device_type = (getattr(router, "device_type", None) or "mikrotik").strip().lower()
        return device_type.endswith("_olt")

    @staticmethod
    def is_mikrotik(router) -> bool:
        """Devuelve True si el dispositivo es MikroTik."""
        device_type = (getattr(router, "device_type", None) or "mikrotik").strip().lower()
        return device_type == "mikrotik"

    @staticmethod
    def supported_device_types() -> list:
        """Retorna la lista de device_types soportados."""
        return list(_DEVICE_TYPE_MAP.keys())

    @staticmethod
    def register_driver(device_type: str, adapter_class, **kwargs) -> None:
        """
        Extensión: permite registrar un driver personalizado en tiempo de ejecución.

        Args:
            device_type: Identificador del tipo de dispositivo (ej: 'cisco_router').
            adapter_class: Clase del adaptador.
            **kwargs: Argumentos adicionales que se pasarán al constructor.
        """
        _DEVICE_TYPE_MAP[device_type.strip().lower()] = (adapter_class, kwargs)
        logger.info("NetworkFactory: driver '%s' registrado → %s", device_type, adapter_class.__name__)
