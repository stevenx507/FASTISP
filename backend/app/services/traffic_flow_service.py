"""
traffic_flow_service.py — Servicio de Traffic Flow para FASTISP
================================================================
Equivalente al "Script de Traffic Flow" de WispHub.

Arquitectura:
  MikroTik → ip traffic-flow (NetFlow v5 UDP) → FASTISP Collector (VPS)
  Collector → parsea paquetes → guarda en TrafficFlowStats (DB)
  API → consulta stats → frontend muestra consumo por cliente

Scripts generados (compatibles con WispHub):
  - RouterOS 6.x: un solo target sin src-address
  - RouterOS 7.x Opción 1: targets por IP de puerta de enlace LAN
  - RouterOS 7.x Opción 2: targets por IP de puerta de enlace WAN
"""

import os
import socket
import struct
import logging
import threading
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# ── Configuración ───────────────────────────────────────────────────────────────
COLLECTOR_IP   = os.environ.get("TRAFFIC_FLOW_COLLECTOR_IP",   "fastisp.cloud")
COLLECTOR_PORT = int(os.environ.get("TRAFFIC_FLOW_COLLECTOR_PORT", "2055"))

# NetFlow v5 packet layout
_V5_HEADER_FMT = "!HHIIIIBBH"          # 24 bytes
_V5_RECORD_FMT = "!IIIHHIIIIHHxBBBHHBBxx"  # 48 bytes
_HEADER_SIZE   = struct.calcsize(_V5_HEADER_FMT)
_RECORD_SIZE   = struct.calcsize(_V5_RECORD_FMT)


# ── Script generators ───────────────────────────────────────────────────────────

def generate_traffic_flow_script_ros6(router_name: str = "router") -> str:
    """
    Script para RouterOS 6 o inferior (sin src-address en target).
    Equivalente exacto al WispHub para ROS6.
    """
    return (
        f"# Traffic Flow FASTISP — {router_name} — RouterOS 6.x\n"
        f"do {{/ip traffic-flow set enabled=yes interfaces=all "
        f"cache-entries=2M active-flow-timeout=10m}} "
        f"on-error={{/ip traffic-flow set enabled=yes interfaces=all "
        f"cache-entries=128k active-flow-timeout=10m}};\n"
        f"/ip traffic-flow target remove [find where version=5 "
        f"and src-address=0.0.0.0 and dst-address={COLLECTOR_IP} "
        f"and port={COLLECTOR_PORT}];\n"
        f"/ip traffic-flow target add version=5 src-address=0.0.0.0 "
        f"dst-address={COLLECTOR_IP} port={COLLECTOR_PORT};"
    )


def generate_traffic_flow_script_ros7_lan(
    router_name: str = "router",
    lan_gateways: Optional[list] = None,
) -> str:
    """
    Script para RouterOS 7+ — Opción 1: targets por IP de puerta de enlace LAN.
    Equivalente al 'Ejemplo de la opción 1' de WispHub.
    """
    gateways = lan_gateways or ["<IP_Puerta_Enlace_LAN1>", "<IP_Puerta_Enlace_LAN2>"]
    header = (
        f"# Traffic Flow FASTISP — {router_name} — RouterOS 7.x (LAN gateways)\n"
        f"do {{/ip traffic-flow set enabled=yes interfaces=all "
        f"cache-entries=2M active-flow-timeout=10m}} "
        f"on-error={{/ip traffic-flow set enabled=yes interfaces=all "
        f"cache-entries=128k active-flow-timeout=10m}};\n"
        f"/ip traffic-flow target remove [find where dst-address={COLLECTOR_IP} "
        f"and port={COLLECTOR_PORT}];\n"
    )
    targets = "\n".join(
        f"/ip traffic-flow target add version=5 src-address={gw} "
        f"dst-address={COLLECTOR_IP} port={COLLECTOR_PORT};"
        for gw in gateways
    )
    return header + targets


def generate_traffic_flow_script_ros7_wan(
    router_name: str = "router",
    wan_gateways: Optional[list] = None,
) -> str:
    """
    Script para RouterOS 7+ — Opción 2: targets por IP de puerta de enlace WAN.
    Equivalente al 'Ejemplo de la opción 2' de WispHub.
    """
    gateways = wan_gateways or ["<IP_Puerta_Enlace_WAN1>", "<IP_Puerta_Enlace_WAN2>"]
    header = (
        f"# Traffic Flow FASTISP — {router_name} — RouterOS 7.x (WAN gateways)\n"
        f"do {{/ip traffic-flow set enabled=yes interfaces=all "
        f"cache-entries=2M active-flow-timeout=10m}} "
        f"on-error={{/ip traffic-flow set enabled=yes interfaces=all "
        f"cache-entries=128k active-flow-timeout=10m}};\n"
        f"/ip traffic-flow target remove [find where dst-address={COLLECTOR_IP} "
        f"and port={COLLECTOR_PORT}];\n"
    )
    targets = "\n".join(
        f"/ip traffic-flow target add version=5 src-address={gw} "
        f"dst-address={COLLECTOR_IP} port={COLLECTOR_PORT};"
        for gw in gateways
    )
    return header + targets


# ── NetFlow v5 parser ──────────────────────────────────────────────────────────

def _int_to_ip(n: int) -> str:
    return socket.inet_ntoa(struct.pack("!I", n))


def parse_netflow_v5(data: bytes) -> list:
    """
    Parsea un paquete UDP NetFlow v5.
    Retorna lista de dicts con los campos de cada flow record.
    """
    if len(data) < _HEADER_SIZE:
        return []

    header = struct.unpack(_V5_HEADER_FMT, data[:_HEADER_SIZE])
    version   = header[0]
    count     = header[1]
    unix_secs = header[3]

    if version != 5:
        logger.debug(f"NetFlow version {version} ignorada (solo v5 soportada)")
        return []

    records = []
    offset = _HEADER_SIZE
    for _ in range(count):
        if offset + _RECORD_SIZE > len(data):
            break
        rec = struct.unpack(_V5_RECORD_FMT, data[offset: offset + _RECORD_SIZE])
        records.append({
            "src_ip":    _int_to_ip(rec[0]),
            "dst_ip":    _int_to_ip(rec[1]),
            "packets":   rec[5],
            "bytes":     rec[6],
            "src_port":  rec[9],
            "dst_port":  rec[10],
            "protocol":  rec[11],
            "tos":       rec[13],
            "timestamp": datetime.utcfromtimestamp(unix_secs),
        })
        offset += _RECORD_SIZE

    return records


# ── NetFlow UDP Collector ──────────────────────────────────────────────────────

class NetFlowCollector:
    """
    Receptor UDP de paquetes NetFlow v5.
    Corre en un thread aparte y persiste stats en la DB via Flask app context.
    """

    def __init__(self, host: str = "0.0.0.0", port: int = COLLECTOR_PORT):
        self.host = host
        self.port = port
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self, flask_app):
        """Arranca el receptor en background."""
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            args=(flask_app,),
            daemon=True,
            name="netflow-collector",
        )
        self._thread.start()
        logger.info(f"NetFlow collector iniciado en {self.host}:{self.port}")

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3)

    def _run(self, flask_app):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind((self.host, self.port))
            sock.settimeout(1.0)
            logger.info(f"NetFlow UDP socket escuchando en {self.host}:{self.port}")
        except OSError as e:
            logger.error(f"No se pudo abrir UDP {self.host}:{self.port}: {e}")
            return

        with flask_app.app_context():
            while not self._stop_event.is_set():
                try:
                    data, addr = sock.recvfrom(65535)
                    records = parse_netflow_v5(data)
                    if records:
                        self._persist(records, router_ip=addr[0])
                except socket.timeout:
                    continue
                except Exception as exc:
                    logger.warning(f"Error procesando paquete NetFlow: {exc}")

        sock.close()
        logger.info("NetFlow collector detenido.")

    def _persist(self, records: list, router_ip: str):
        """Acumula los bytes/paquetes por (router_id, src_ip) en TrafficFlowStats."""
        try:
            from app import db
            from app.models import TrafficFlowStats, MikroTikRouter

            # Buscar el router por IP
            router = MikroTikRouter.query.filter_by(ip_address=router_ip).first()
            router_id  = router.id        if router else None
            tenant_id  = router.tenant_id if router else None

            now = datetime.utcnow()
            bucket = now.replace(minute=0, second=0, microsecond=0)  # por hora

            # Agrupar records por src_ip
            agg: dict = {}
            for r in records:
                key = r["src_ip"]
                if key not in agg:
                    agg[key] = {"bytes": 0, "packets": 0, "dst_ip": r["dst_ip"]}
                agg[key]["bytes"]   += r["bytes"]
                agg[key]["packets"] += r["packets"]

            for src_ip, vals in agg.items():
                stat = TrafficFlowStats.query.filter_by(
                    router_id=router_id,
                    src_ip=src_ip,
                    bucket=bucket,
                ).first()
                if stat:
                    stat.bytes_total   += vals["bytes"]
                    stat.packets_total += vals["packets"]
                else:
                    stat = TrafficFlowStats(
                        router_id=router_id,
                        tenant_id=tenant_id,
                        src_ip=src_ip,
                        dst_ip=vals["dst_ip"],
                        bytes_total=vals["bytes"],
                        packets_total=vals["packets"],
                        bucket=bucket,
                        router_ip=router_ip,
                    )
                    db.session.add(stat)

            db.session.commit()
        except Exception as exc:
            logger.error(f"Error persistiendo NetFlow records: {exc}")
            try:
                from app import db
                db.session.rollback()
            except Exception:
                pass


# Singleton collector (iniciado desde create_app)
_collector: Optional[NetFlowCollector] = None


def get_collector() -> NetFlowCollector:
    global _collector
    if _collector is None:
        _collector = NetFlowCollector()
    return _collector


def start_collector(flask_app):
    get_collector().start(flask_app)
