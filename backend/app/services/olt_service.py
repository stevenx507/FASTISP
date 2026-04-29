"""
OltService - Pilar 24: Soporte Multi-Vendor (OLTs y CPEs)

Implementación base para gestión de OLTs registradas en la base de datos
(Huawei, VSOL, ZTE).  Complementa al OLTScriptService (scripts manuales)
con operaciones directas contra dispositivos del modelo MikroTikRouter
que tengan device_type en ['huawei_olt', 'vsol_olt', 'zte_olt'].
"""
from __future__ import annotations

import logging
import socket
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Mapeo de vendor normalizado
# ---------------------------------------------------------------------------

_VENDOR_ALIASES: Dict[str, str] = {
    "huawei_olt": "huawei",
    "vsol_olt":   "vsol",
    "zte_olt":    "zte",
    "huawei":     "huawei",
    "vsol":       "vsol",
    "zte":        "zte",
}

_DEFAULT_PORTS: Dict[str, int] = {
    "huawei": 22,   # SSH
    "vsol":   22,   # SSH
    "zte":    23,   # Telnet
}

_DEFAULT_TRANSPORT: Dict[str, str] = {
    "huawei": "ssh",
    "vsol":   "ssh",
    "zte":    "telnet",
}


def _normalize_vendor(raw: str) -> str:
    """Normaliza device_type o vendor string al identificador canónico."""
    return _VENDOR_ALIASES.get(raw.strip().lower(), raw.strip().lower())


# ---------------------------------------------------------------------------
# Clase OltService
# ---------------------------------------------------------------------------

class OltService:
    """
    Servicio de gestión de OLTs integrado con el modelo de base de datos.

    Recibe una instancia de MikroTikRouter cuyo device_type es una OLT
    (huawei_olt / vsol_olt / zte_olt) y expone operaciones:
      - test_connection        → ping TCP al puerto de gestión
      - list_onus              → listar ONUs por puerto PON
      - authorize_onu          → autorizar (añadir) ONU en la OLT
      - deauthorize_onu        → eliminar ONU de la OLT
      - reboot_onu             → reiniciar ONU
      - get_optical_power      → leer señales ópticas (Tx/Rx dBm)
      - get_onu_status         → estado de una ONU específica
      - generate_script        → genera script de comandos para el vendor
      - execute_commands       → ejecuta comandos vía SSH/Telnet
    """

    def __init__(self, router) -> None:
        """
        Args:
            router: Instancia de MikroTikRouter con device_type = '*_olt'.
        """
        self.router = router
        self.vendor = _normalize_vendor(router.device_type or "zte")
        self.host = router.ip_address
        self.port = router.api_port or _DEFAULT_PORTS.get(self.vendor, 22)
        self.transport = _DEFAULT_TRANSPORT.get(self.vendor, "ssh")
        self.username = router.username
        # La contraseña está cifrada en el modelo; el property .password la descifra
        self._password_property = "password"  # acceso via router.password

    @property
    def _password(self) -> str:
        try:
            return self.router.password or ""
        except Exception:
            return ""

    # -------------------------------------------------------------------------
    # Conectividad
    # -------------------------------------------------------------------------

    def test_connection(self, timeout: float = 3.0) -> Dict[str, Any]:
        """Prueba conectividad TCP al puerto de gestión de la OLT."""
        start = time.perf_counter()
        try:
            with socket.create_connection((self.host, self.port), timeout=timeout):
                latency_ms = round((time.perf_counter() - start) * 1000, 2)
                return {
                    "success": True,
                    "reachable": True,
                    "vendor": self.vendor,
                    "host": self.host,
                    "port": self.port,
                    "transport": self.transport,
                    "latency_ms": latency_ms,
                    "message": f"OLT {self.vendor.upper()} accesible en {self.host}:{self.port}",
                }
        except Exception as exc:
            latency_ms = round((time.perf_counter() - start) * 1000, 2)
            return {
                "success": False,
                "reachable": False,
                "vendor": self.vendor,
                "host": self.host,
                "port": self.port,
                "transport": self.transport,
                "latency_ms": latency_ms,
                "error": str(exc),
                "message": f"No se pudo conectar a OLT {self.vendor.upper()} en {self.host}:{self.port}",
            }

    # -------------------------------------------------------------------------
    # Generación de scripts (sin conexión real)
    # -------------------------------------------------------------------------

    def generate_script(self, action: str, **payload) -> Dict[str, Any]:
        """
        Genera los comandos para la acción solicitada según el vendor.

        Delega al OLTScriptService existente para reutilizar su lógica.
        """
        try:
            from app.services.olt_script_service import OLTScriptService

            # Crear un dispositivo virtual compatible con OLTScriptService
            virtual_device = {
                "id": f"DB-{self.router.id}",
                "name": self.router.name,
                "vendor": self.vendor,
                "host": self.host,
                "port": self.port,
                "transport": self.transport,
                "username": self.username,
            }
            svc = OLTScriptService(extra_devices=[virtual_device])
            result = svc.generate_script(
                device_id=virtual_device["id"],
                action=action,
                payload=payload,
            )
            return result
        except Exception as exc:
            logger.error("OltService.generate_script error: %s", exc)
            return {"success": False, "error": str(exc)}

    # -------------------------------------------------------------------------
    # Operaciones ONU
    # -------------------------------------------------------------------------

    def list_onus(self, pon_port: Optional[str] = None, vendor: Optional[str] = None) -> Dict[str, Any]:
        """
        Lista las ONUs de la OLT, opcionalmente filtradas por puerto PON.
        En modo sin conexión real devuelve la estructura de script generada.
        """
        v = _normalize_vendor(vendor or self.vendor)
        payload: Dict[str, Any] = {}

        if pon_port:
            # Parsear "0/1/0" → frame, slot, pon
            parts = str(pon_port).split("/")
            if len(parts) >= 3:
                payload["frame"] = int(parts[0])
                payload["slot"] = int(parts[1])
                payload["pon"] = int(parts[2])
            elif len(parts) == 2:
                payload["slot"] = int(parts[0])
                payload["pon"] = int(parts[1])

        script_result = self.generate_script("show_onu_list", **payload)
        return {
            "success": script_result.get("success", False),
            "vendor": v,
            "pon_port": pon_port,
            "commands": script_result.get("commands", []),
            "note": "Ejecuta los comandos en la OLT para obtener la lista de ONUs.",
        }

    def authorize_onu(
        self,
        serial: str,
        pon_port: str,
        onu_id: int,
        vendor: Optional[str] = None,
        line_profile: str = "LINE-100M",
        srv_profile: str = "SRV-INTERNET",
        vlan: int = 100,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        Autoriza (añade) una ONU en el puerto PON indicado.

        Args:
            serial:       Número de serie de la ONU (ej: 'ZTEG00000001').
            pon_port:     Puerto PON en formato 'frame/slot/pon' (ej: '1/1/1').
            onu_id:       ID de ONU a asignar en la OLT.
            line_profile: Nombre del perfil de línea en la OLT.
            srv_profile:  Nombre del perfil de servicio.
            vlan:         VLAN de servicio.
        """
        v = _normalize_vendor(vendor or self.vendor)
        parts = str(pon_port).split("/")
        payload: Dict[str, Any] = {
            "serial": serial.upper().strip(),
            "onu": onu_id,
            "line_profile": line_profile,
            "srv_profile": srv_profile,
            "vlan": vlan,
        }
        if len(parts) >= 3:
            payload.update({"frame": int(parts[0]), "slot": int(parts[1]), "pon": int(parts[2])})
        elif len(parts) == 2:
            payload.update({"slot": int(parts[0]), "pon": int(parts[1])})

        script_result = self.generate_script("authorize_onu", **payload)
        return {
            "success": script_result.get("success", False),
            "action": "authorize_onu",
            "vendor": v,
            "serial": serial,
            "pon_port": pon_port,
            "onu_id": onu_id,
            "commands": script_result.get("commands", []),
            "note": "Aplica los comandos en la OLT para autorizar la ONU.",
            "quick_connect": script_result.get("quick_connect"),
        }

    def deauthorize_onu(
        self,
        pon_port: str,
        onu_id: int,
        vendor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Elimina una ONU del puerto PON de la OLT."""
        v = _normalize_vendor(vendor or self.vendor)
        parts = str(pon_port).split("/")
        payload: Dict[str, Any] = {"onu": onu_id}
        if len(parts) >= 3:
            payload.update({"frame": int(parts[0]), "slot": int(parts[1]), "pon": int(parts[2])})
        elif len(parts) == 2:
            payload.update({"slot": int(parts[0]), "pon": int(parts[1])})

        script_result = self.generate_script("deauthorize_onu", **payload)
        return {
            "success": script_result.get("success", False),
            "action": "deauthorize_onu",
            "vendor": v,
            "pon_port": pon_port,
            "onu_id": onu_id,
            "commands": script_result.get("commands", []),
        }

    def reboot_onu(
        self,
        pon_port: str,
        onu_id: int,
        vendor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Reinicia una ONU en el puerto PON indicado."""
        v = _normalize_vendor(vendor or self.vendor)
        parts = str(pon_port).split("/")
        payload: Dict[str, Any] = {"onu": onu_id}
        if len(parts) >= 3:
            payload.update({"frame": int(parts[0]), "slot": int(parts[1]), "pon": int(parts[2])})
        elif len(parts) == 2:
            payload.update({"slot": int(parts[0]), "pon": int(parts[1])})

        script_result = self.generate_script("reboot_onu", **payload)
        return {
            "success": script_result.get("success", False),
            "action": "reboot_onu",
            "vendor": v,
            "pon_port": pon_port,
            "onu_id": onu_id,
            "commands": script_result.get("commands", []),
        }

    def get_optical_power(
        self,
        pon_port: str,
        vendor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Obtiene la señal óptica (Tx/Rx dBm) del puerto PON."""
        v = _normalize_vendor(vendor or self.vendor)
        parts = str(pon_port).split("/")
        payload: Dict[str, Any] = {}
        if len(parts) >= 3:
            payload.update({"frame": int(parts[0]), "slot": int(parts[1]), "pon": int(parts[2])})
        elif len(parts) == 2:
            payload.update({"slot": int(parts[0]), "pon": int(parts[1])})

        script_result = self.generate_script("show_optical_power", **payload)
        return {
            "success": script_result.get("success", False),
            "action": "show_optical_power",
            "vendor": v,
            "pon_port": pon_port,
            "commands": script_result.get("commands", []),
            "note": "Ejecuta los comandos para obtener los niveles ópticos en tiempo real.",
        }

    def get_onu_status(self, serial: str) -> Dict[str, Any]:
        """Busca una ONU por número de serie en la OLT."""
        script_result = self.generate_script("find_onu", serial=serial.upper().strip())
        return {
            "success": script_result.get("success", False),
            "action": "find_onu",
            "vendor": self.vendor,
            "serial": serial,
            "commands": script_result.get("commands", []),
        }

    # -------------------------------------------------------------------------
    # Info del dispositivo
    # -------------------------------------------------------------------------

    def get_device_info(self) -> Dict[str, Any]:
        """Retorna información básica del router/OLT registrado en la DB."""
        conn = self.test_connection(timeout=2.0)
        return {
            "id": self.router.id,
            "name": self.router.name,
            "device_type": self.router.device_type,
            "vendor": self.vendor,
            "host": self.host,
            "port": self.port,
            "transport": self.transport,
            "username": self.username,
            "is_active": self.router.is_active,
            "reachable": conn.get("reachable", False),
            "latency_ms": conn.get("latency_ms"),
        }
