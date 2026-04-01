"""
OLT Script Service
Enterprise helper for OLT operations (ZTE, Huawei, VSOL).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import socket
import telnetlib
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

try:
    import paramiko
except Exception:
    paramiko = None

logger = logging.getLogger(__name__)

OLT_EXECUTION_AUDIT: List[Dict[str, Any]] = []
OLT_EXECUTION_AUDIT_MAX = 500


SUPPORTED_VENDORS = {
    "zte": {
        "label": "ZTE",
        "default_transport": "telnet",
        "default_port": 23,
        "actions": [
            "show_pon_summary",
            "show_onu_list",
            "find_onu",
            "authorize_onu",
            "deauthorize_onu",
            "reboot_onu",
            "backup_running_config",
            "show_optical_power",
            "save_config",
        ],
    },
    "huawei": {
        "label": "Huawei",
        "default_transport": "ssh",
        "default_port": 22,
        "actions": [
            "show_pon_summary",
            "show_onu_list",
            "find_onu",
            "authorize_onu",
            "deauthorize_onu",
            "reboot_onu",
            "backup_running_config",
            "show_optical_power",
            "save_config",
        ],
    },
    "vsol": {
        "label": "VSOL",
        "default_transport": "ssh",
        "default_port": 22,
        "actions": [
            "show_pon_summary",
            "show_onu_list",
            "find_onu",
            "authorize_onu",
            "deauthorize_onu",
            "reboot_onu",
            "backup_running_config",
            "show_optical_power",
            "save_config",
        ],
    },
}


DEFAULT_OLT_DEVICES = [
    {
        "id": "OLT-ZTE-001",
        "name": "ZTE Core Centro",
        "vendor": "zte",
        "model": "C320",
        "host": "10.20.0.21",
        "transport": "telnet",
        "port": 23,
        "username": "admin",
        "site": "Core-Centro",
    },
    {
        "id": "OLT-HW-001",
        "name": "Huawei Norte",
        "vendor": "huawei",
        "model": "MA5800-X7",
        "host": "10.20.10.11",
        "transport": "ssh",
        "port": 22,
        "username": "admin",
        "site": "Distribution-Norte",
    },
    {
        "id": "OLT-VSOL-001",
        "name": "VSOL Sur",
        "vendor": "vsol",
        "model": "V3600G1",
        "host": "10.20.20.31",
        "transport": "ssh",
        "port": 22,
        "username": "admin",
        "site": "Access-Sur",
    },
]


class OLTScriptService:
    def __init__(
        self,
        extra_devices: Optional[List[Dict[str, Any]]] = None,
        credentials_overrides: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> None:
        self.extra_devices = list(extra_devices or [])
        self.credentials_overrides = dict(credentials_overrides or {})
        self.devices = self._load_devices()

    def _load_devices(self) -> List[Dict[str, Any]]:
        env_value = os.environ.get("OLT_DEVICES_JSON", "").strip()
        base_devices: List[Dict[str, Any]] = list(DEFAULT_OLT_DEVICES)
        if env_value:
            try:
                parsed = json.loads(env_value)
                if isinstance(parsed, list):
                    normalized = []
                    for index, item in enumerate(parsed):
                        if not isinstance(item, dict):
                            continue
                        vendor = str(item.get("vendor", "")).strip().lower()
                        if vendor not in SUPPORTED_VENDORS:
                            continue
                        normalized.append(
                            {
                                "id": str(item.get("id") or f"OLT-{vendor.upper()}-{index+1:03d}"),
                                "name": str(item.get("name") or f"{SUPPORTED_VENDORS[vendor]['label']} OLT {index+1}"),
                                "vendor": vendor,
                                "model": str(item.get("model") or "N/D"),
                                "host": str(item.get("host") or ""),
                                "transport": str(item.get("transport") or SUPPORTED_VENDORS[vendor]["default_transport"]),
                                "port": int(item.get("port") or SUPPORTED_VENDORS[vendor]["default_port"]),
                                "username": str(item.get("username") or "admin"),
                                "site": str(item.get("site") or "N/D"),
                                "origin": str(item.get("origin") or "catalog"),
                            }
                        )
                    if normalized:
                        base_devices = normalized
            except Exception:
                base_devices = list(DEFAULT_OLT_DEVICES)

        merged: Dict[str, Dict[str, Any]] = {}
        for item in base_devices:
            if not isinstance(item, dict):
                continue
            normalized = dict(item)
            normalized["origin"] = str(normalized.get("origin") or "catalog")
            item_id = str(normalized.get("id") or "").strip()
            if not item_id:
                continue
            merged[item_id] = normalized

        for index, item in enumerate(self.extra_devices):
            if not isinstance(item, dict):
                continue
            vendor = str(item.get("vendor") or "").strip().lower()
            if vendor not in SUPPORTED_VENDORS:
                continue
            item_id = str(item.get("id") or f"OLT-{vendor.upper()}-CUSTOM-{index + 1:03d}").strip()
            if not item_id:
                continue
            merged[item_id] = {
                "id": item_id,
                "name": str(item.get("name") or f"{SUPPORTED_VENDORS[vendor]['label']} OLT"),
                "vendor": vendor,
                "model": str(item.get("model") or "N/D"),
                "host": str(item.get("host") or ""),
                "transport": str(item.get("transport") or SUPPORTED_VENDORS[vendor]["default_transport"]),
                "port": int(item.get("port") or SUPPORTED_VENDORS[vendor]["default_port"]),
                "username": str(item.get("username") or "admin"),
                "site": str(item.get("site") or "N/D"),
                "origin": "custom",
            }

        return list(merged.values())

    def list_vendors(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": key,
                "label": value["label"],
                "default_transport": value["default_transport"],
                "default_port": value["default_port"],
                "actions": value["actions"],
            }
            for key, value in SUPPORTED_VENDORS.items()
        ]

    def list_devices(self, vendor: Optional[str] = None) -> List[Dict[str, Any]]:
        if not vendor:
            source = list(self.devices)
        else:
            vendor_id = vendor.strip().lower()
            source = [item for item in self.devices if item.get("vendor") == vendor_id]

        sanitized: List[Dict[str, Any]] = []
        for item in source:
            safe = dict(item)
            safe.pop("password", None)
            safe.pop("enable_password", None)
            sanitized.append(safe)
        return sanitized

    def get_device(self, device_id: str) -> Optional[Dict[str, Any]]:
        return next((item for item in self.devices if item.get("id") == device_id), None)

    def _utcnow_iso(self) -> str:
        return datetime.utcnow().isoformat() + "Z"

    def _to_bool(self, value: Any, default: bool = False) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return default
        return str(value).strip().lower() in ("1", "true", "yes", "y", "on")

    def _get_credentials_map(self) -> Dict[str, Dict[str, Any]]:
        raw = os.environ.get("OLT_CREDENTIALS_JSON", "").strip()
        loaded: Dict[str, Dict[str, Any]] = {}
        if raw:
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    normalized: Dict[str, Dict[str, Any]] = {}
                    for key, value in parsed.items():
                        if not isinstance(value, dict):
                            continue
                        normalized[str(key)] = dict(value)
                    loaded = normalized
                elif isinstance(parsed, list):
                    normalized = {}
                    for item in parsed:
                        if not isinstance(item, dict):
                            continue
                        item_id = str(item.get("id") or item.get("device_id") or "").strip()
                        if not item_id:
                            continue
                        normalized[item_id] = dict(item)
                    loaded = normalized
            except Exception:
                logger.warning("Invalid OLT_CREDENTIALS_JSON format; ignoring credentials map.")
                loaded = {}

        for key, value in self.credentials_overrides.items():
            if not isinstance(value, dict):
                continue
            loaded[str(key)] = dict(value)
        return loaded

    def _resolve_device_credentials(self, device: Dict[str, Any]) -> Dict[str, Any]:
        credentials_map = self._get_credentials_map()
        device_id = str(device.get("id") or "")
        entry = credentials_map.get(device_id, {})

        username = str(entry.get("username") or device.get("username") or os.environ.get("OLT_DEFAULT_USERNAME", "admin"))
        password = str(
            entry.get("password")
            or device.get("password")
            or os.environ.get("OLT_DEFAULT_PASSWORD", "")
        ).strip()
        enable_password = str(
            entry.get("enable_password")
            or device.get("enable_password")
            or os.environ.get("OLT_DEFAULT_ENABLE_PASSWORD", "")
        ).strip()
        timeout = float(
            entry.get("timeout_seconds")
            or device.get("timeout_seconds")
            or os.environ.get("OLT_LIVE_TIMEOUT_SECONDS", "6")
        )
        timeout = max(2.0, min(timeout, 20.0))
        cmd_delay = float(
            entry.get("command_delay_seconds")
            or device.get("command_delay_seconds")
            or os.environ.get("OLT_COMMAND_DELAY_SECONDS", "0.2")
        )
        cmd_delay = max(0.05, min(cmd_delay, 2.0))
        shell_prompt = str(
            entry.get("shell_prompt")
            or device.get("shell_prompt")
            or os.environ.get("OLT_SHELL_PROMPT", "#")
        ).strip() or "#"

        return {
            "username": username,
            "password": password,
            "enable_password": enable_password,
            "timeout_seconds": timeout,
            "command_delay_seconds": cmd_delay,
            "shell_prompt": shell_prompt,
        }

    def _append_audit(self, entry: Dict[str, Any]) -> None:
        OLT_EXECUTION_AUDIT.insert(0, entry)
        del OLT_EXECUTION_AUDIT[OLT_EXECUTION_AUDIT_MAX:]

    def list_audit_log(self, limit: int = 50) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(limit, 200))
        return list(OLT_EXECUTION_AUDIT[:safe_limit])

    def _read_ssh_channel(self, channel: Any, timeout_seconds: float = 3.0) -> str:
        chunks: List[str] = []
        deadline = time.time() + max(0.5, timeout_seconds)
        while time.time() < deadline:
            if channel.recv_ready():
                raw = channel.recv(65535)
                if not raw:
                    break
                chunks.append(raw.decode("utf-8", errors="ignore"))
                continue
            time.sleep(0.05)
        return "".join(chunks).strip()

    def _run_ssh_live(
        self, device: Dict[str, Any], commands: List[str], creds: Dict[str, Any]
    ) -> Dict[str, Any]:
        if paramiko is None:
            raise RuntimeError("paramiko is required for live SSH execution. Install dependency 'paramiko'.")

        strict_host_key = self._to_bool(os.environ.get("OLT_STRICT_HOST_KEY"), default=False)
        max_output_chars = int(os.environ.get("OLT_MAX_OUTPUT_CHARS", "30000"))
        max_output_chars = max(5000, min(max_output_chars, 250000))

        client = paramiko.SSHClient()
        if strict_host_key:
            client.load_system_host_keys()
            client.set_missing_host_key_policy(paramiko.RejectPolicy())
        else:
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        transcript: List[str] = []
        host = str(device.get("host") or "")
        port = int(device.get("port") or 22)
        timeout_seconds = float(creds.get("timeout_seconds") or 6.0)

        client.connect(
            hostname=host,
            port=port,
            username=str(creds.get("username") or "admin"),
            password=str(creds.get("password") or ""),
            timeout=timeout_seconds,
            auth_timeout=timeout_seconds,
            banner_timeout=timeout_seconds,
            look_for_keys=False,
            allow_agent=False,
        )
        try:
            channel = client.invoke_shell(width=200, height=1000)
            time.sleep(float(creds.get("command_delay_seconds") or 0.2))
            first_chunk = self._read_ssh_channel(channel, timeout_seconds=1.2)
            if first_chunk:
                transcript.append(first_chunk[:max_output_chars])

            for index, command in enumerate(commands[:80]):
                command_clean = str(command).strip()
                if not command_clean:
                    continue
                channel.send(command_clean + "\n")
                time.sleep(float(creds.get("command_delay_seconds") or 0.2))
                output = self._read_ssh_channel(channel, timeout_seconds=timeout_seconds / 2)
                transcript.append(f"{index + 1:02d}> {command_clean}")
                if output:
                    transcript.append(output[:max_output_chars])

            channel.send("exit\n")
            time.sleep(0.1)
        finally:
            client.close()

        return {"transcript": transcript}

    def _run_telnet_live(
        self, device: Dict[str, Any], commands: List[str], creds: Dict[str, Any]
    ) -> Dict[str, Any]:
        host = str(device.get("host") or "")
        port = int(device.get("port") or 23)
        timeout_seconds = float(creds.get("timeout_seconds") or 6.0)
        cmd_delay = float(creds.get("command_delay_seconds") or 0.2)
        max_output_chars = int(os.environ.get("OLT_MAX_OUTPUT_CHARS", "30000"))
        max_output_chars = max(5000, min(max_output_chars, 250000))

        transcript: List[str] = []
        tn = telnetlib.Telnet(host=host, port=port, timeout=timeout_seconds)
        try:
            banner = tn.read_very_eager().decode("utf-8", errors="ignore").strip()
            if banner:
                transcript.append(banner[:max_output_chars])

            username = str(creds.get("username") or "").strip()
            password = str(creds.get("password") or "").strip()
            enable_password = str(creds.get("enable_password") or "").strip()
            shell_prompt = str(creds.get("shell_prompt") or "#").encode("utf-8")

            if username:
                tn.write((username + "\n").encode("utf-8"))
                time.sleep(cmd_delay)
                user_reply = tn.read_very_eager().decode("utf-8", errors="ignore").strip()
                if user_reply:
                    transcript.append(user_reply[:max_output_chars])

            if password:
                tn.write((password + "\n").encode("utf-8"))
                time.sleep(cmd_delay)
                pass_reply = tn.read_very_eager().decode("utf-8", errors="ignore").strip()
                if pass_reply:
                    transcript.append(pass_reply[:max_output_chars])

            for index, command in enumerate(commands[:80]):
                command_clean = str(command).strip()
                if not command_clean:
                    continue
                tn.write((command_clean + "\n").encode("utf-8"))
                time.sleep(cmd_delay)
                output_raw = tn.read_until(shell_prompt, timeout=max(1.0, timeout_seconds / 2))
                output = output_raw.decode("utf-8", errors="ignore").strip()
                transcript.append(f"{index + 1:02d}> {command_clean}")
                if output:
                    transcript.append(output[:max_output_chars])
                if command_clean.lower() in ("enable", "super") and enable_password:
                    tn.write((enable_password + "\n").encode("utf-8"))
                    time.sleep(cmd_delay)
                    enable_reply = tn.read_very_eager().decode("utf-8", errors="ignore").strip()
                    if enable_reply:
                        transcript.append(enable_reply[:max_output_chars])

            tn.write(b"exit\n")
            time.sleep(0.1)
        finally:
            tn.close()

        return {"transcript": transcript}

    def test_connection(self, device_id: str, timeout_seconds: float = 2.5) -> Dict[str, Any]:
        device = self.get_device(device_id)
        if not device:
            return {"success": False, "error": "OLT not found"}

        host = str(device.get("host", "")).strip()
        port = int(device.get("port") or 22)
        if not host:
            return {"success": False, "error": "OLT host is missing"}

        start = time.perf_counter()
        try:
            with socket.create_connection((host, port), timeout=timeout_seconds):
                latency_ms = round((time.perf_counter() - start) * 1000, 2)
                return {
                    "success": True,
                    "reachable": True,
                    "latency_ms": latency_ms,
                    "message": f"Conexión TCP estable a {host}:{port}",
                }
        except Exception as error:
            latency_ms = round((time.perf_counter() - start) * 1000, 2)
            return {
                "success": False,
                "reachable": False,
                "latency_ms": latency_ms,
                "error": str(error),
                "message": f"No se pudo conectar a {host}:{port}",
            }

    def generate_script(self, device_id: str, action: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = payload or {}
        device = self.get_device(device_id)
        if not device:
            return {"success": False, "error": "OLT not found"}
        vendor = str(device.get("vendor", "")).lower()
        if vendor not in SUPPORTED_VENDORS:
            return {"success": False, "error": "Unsupported vendor"}

        action_id = str(action or "").strip().lower()
        builder = {
            "zte": self._build_zte_script,
            "huawei": self._build_huawei_script,
            "vsol": self._build_vsol_script,
        }.get(vendor)
        if not builder:
            return {"success": False, "error": "Vendor builder not available"}

        commands = builder(action_id, payload)
        if not commands:
            return {"success": False, "error": "Action not supported for selected vendor"}

        quick_windows = self._build_quick_connect("windows", device, commands)
        quick_linux = self._build_quick_connect("linux", device, commands)
        return {
            "success": True,
            "device": device,
            "action": action_id,
            "commands": commands,
            "quick_connect": {
                "windows": quick_windows,
                "linux": quick_linux,
            },
        }

    def execute_script(
        self,
        device_id: str,
        commands: List[str],
        run_mode: str = "simulate",
        actor: Optional[str] = None,
        source_ip: Optional[str] = None,
    ) -> Dict[str, Any]:
        device = self.get_device(device_id)
        if not device:
            return {"success": False, "error": "OLT not found"}
        lines = [str(line).strip() for line in commands if str(line).strip()]
        if not lines:
            return {"success": False, "error": "No commands to execute"}

        mode = str(run_mode or "simulate").strip().lower()
        if mode not in ("simulate", "dry-run", "live"):
            mode = "simulate"

        started_at = self._utcnow_iso()
        connection = self.test_connection(device_id)
        transcript = [
            f"[{started_at}] Device: {device['name']} ({device['host']})",
            f"Run mode: {mode}",
            f"Reachable: {'yes' if connection.get('reachable') else 'no'}",
        ]
        execution_success = False
        error_message: Optional[str] = None

        try:
            if mode in ("simulate", "dry-run"):
                for index, line in enumerate(lines[:40]):
                    transcript.append(f"{index + 1:02d}> {line}")
                execution_success = True
            else:
                if not connection.get("reachable"):
                    raise RuntimeError(connection.get("error") or "OLT host is not reachable")

                creds = self._resolve_device_credentials(device)
                if not str(creds.get("password") or "").strip():
                    raise RuntimeError(
                        "Missing OLT credentials. Configure OLT_CREDENTIALS_JSON or OLT_DEFAULT_PASSWORD."
                    )

                transport = str(device.get("transport") or "ssh").strip().lower()
                if transport == "telnet":
                    result = self._run_telnet_live(device=device, commands=lines, creds=creds)
                else:
                    result = self._run_ssh_live(device=device, commands=lines, creds=creds)

                transcript.extend(result.get("transcript", []))
                execution_success = True
        except Exception as error:
            error_message = str(error)
            transcript.append(f"ERROR: {error_message}")
            execution_success = False

        finished_at = self._utcnow_iso()
        audit_entry = {
            "id": f"OLT-EXEC-{int(time.time() * 1000)}",
            "device_id": str(device.get("id") or ""),
            "device_name": str(device.get("name") or ""),
            "vendor": str(device.get("vendor") or ""),
            "host": str(device.get("host") or ""),
            "transport": str(device.get("transport") or ""),
            "run_mode": mode,
            "success": execution_success,
            "actor": str(actor or "system"),
            "source_ip": str(source_ip or ""),
            "commands": min(len(lines), 80),
            "started_at": started_at,
            "finished_at": finished_at,
            "error": error_message,
        }
        self._append_audit(audit_entry)

        return {
            "success": execution_success,
            "run_mode": mode,
            "executed_commands": len(lines),
            "connection": connection,
            "transcript": transcript,
            "started_at": started_at,
            "finished_at": finished_at,
            "audit_entry": audit_entry,
            "error": error_message,
            "message": (
                "Live execution completed."
                if execution_success and mode == "live"
                else "Simulated execution completed."
                if execution_success
                else "Execution failed."
            ),
        }

    def get_snapshot(self, device_id: str) -> Dict[str, Any]:
        device = self.get_device(device_id)
        if not device:
            return {"success": False, "error": "OLT not found"}

        seed_key = f"{device_id}:{datetime.utcnow().strftime('%Y-%m-%d-%H')}"
        seed_int = int(hashlib.sha256(seed_key.encode("utf-8")).hexdigest()[:8], 16)
        rng = random.Random(seed_int)

        pon_total = rng.randint(8, 16)
        pon_alert = rng.randint(0, 3)
        onu_online = rng.randint(320, 620)
        onu_offline = rng.randint(10, 80)
        cpu_load = rng.randint(18, 74)
        mem_use = rng.randint(32, 81)
        temp = rng.randint(35, 62)

        return {
            "success": True,
            "snapshot": {
                "device_id": device_id,
                "generated_at": datetime.utcnow().isoformat() + "Z",
                "pon_total": pon_total,
                "pon_alert": pon_alert,
                "onu_online": onu_online,
                "onu_offline": onu_offline,
                "cpu_load": cpu_load,
                "memory_usage": mem_use,
                "temperature_c": temp,
            },
        }

    def _build_quick_connect(self, platform: str, device: Dict[str, Any], commands: List[str]) -> str:
        host = device.get("host")
        port = int(device.get("port") or 22)
        user = device.get("username") or "admin"
        transport = str(device.get("transport") or "ssh").lower()
        command_block = "\n".join(commands)

        if platform == "windows":
            if transport == "telnet":
                entry = f"telnet {host} {port}"
            else:
                entry = f"ssh {user}@{host} -p {port}"
            return (
                f"# PowerShell quick-connect for {device.get('name')}\n"
                f"{entry}\n"
                f"# Pega luego estos comandos en la consola OLT:\n{command_block}\n"
            )

        # linux/macos
        if transport == "telnet":
            entry = f"telnet {host} {port}"
        else:
            entry = f"ssh {user}@{host} -p {port}"
        return (
            f"# Bash quick-connect for {device.get('name')}\n"
            f"{entry}\n"
            f"# Luego ejecuta en la sesión OLT:\n{command_block}\n"
        )

    def quick_login_command(self, device_id: str, platform: str = "windows") -> str:
        device = self.get_device(device_id)
        if not device:
            raise ValueError("OLT not found")
        host = device.get("host")
        port = int(device.get("port") or 22)
        user = device.get("username") or "admin"
        transport = str(device.get("transport") or "ssh").lower()
        if transport == "telnet":
            return f"telnet {host} {port}"
        return f"ssh {user}@{host} -p {port}"

    def _build_zte_script(self, action: str, payload: Dict[str, Any]) -> List[str]:
        frame = payload.get("frame", 1)
        slot = payload.get("slot", 1)
        pon = payload.get("pon", 1)
        onu = payload.get("onu", 1)
        sn = str(payload.get("serial", "ZTEG00000001")).upper()
        profile = str(payload.get("line_profile", "LINE-100M"))
        service = str(payload.get("srv_profile", "SRV-INTERNET"))
        vlan = int(payload.get("vlan", 120))

        scripts = {
            "show_pon_summary": [
                "enable",
                "show gpon olt pon",
                "show gpon onu state",
            ],
            "show_onu_list": [
                "enable",
                f"show gpon onu by-pon {frame}/{slot}/{pon}",
            ],
            "find_onu": [
                "enable",
                f"show gpon onu by sn {sn}",
            ],
            "authorize_onu": [
                "enable",
                "configure terminal",
                f"interface gpon-olt_{frame}/{slot}/{pon}",
                f"onu {onu} type ZTE-F660 sn {sn}",
                f"onu {onu} profile line {profile} remote {service}",
                f"onu {onu} service-port 1 vport 1 user-vlan {vlan} vlan {vlan}",
                "end",
                "write",
            ],
            "deauthorize_onu": [
                "enable",
                "configure terminal",
                f"interface gpon-olt_{frame}/{slot}/{pon}",
                f"no onu {onu}",
                "end",
                "write",
            ],
            "reboot_onu": [
                "enable",
                "configure terminal",
                f"interface gpon-olt_{frame}/{slot}/{pon}",
                f"onu {onu} reboot",
                "end",
            ],
            "backup_running_config": [
                "enable",
                "show running-config",
                "copy running-config startup-config",
            ],
            "show_optical_power": [
                "enable",
                f"show gpon onu optical-power {frame}/{slot}/{pon}",
                f"show gpon onu detail-info {frame}/{slot}/{pon} {onu}",
            ],
            "save_config": [
                "enable",
                "write",
            ],
        }
        return scripts.get(action, [])

    def _build_huawei_script(self, action: str, payload: Dict[str, Any]) -> List[str]:
        frame = payload.get("frame", 0)
        slot = payload.get("slot", 1)
        pon = payload.get("pon", 0)
        onu = payload.get("onu", 1)
        sn = str(payload.get("serial", "48575443ABCDEF01")).upper()
        line_profile = str(payload.get("line_profile", "line-profile_100M"))
        srv_profile = str(payload.get("srv_profile", "srv-profile_internet"))
        vlan = int(payload.get("vlan", 120))

        scripts = {
            "show_pon_summary": [
                "display board 0",
                "display ont info summary all",
            ],
            "show_onu_list": [
                f"display ont info {frame}/{slot}/{pon} all",
            ],
            "find_onu": [
                f"display ont autofind all | include {sn}",
            ],
            "authorize_onu": [
                "system-view",
                f"interface gpon {frame}/{slot}",
                f"ont add {pon} {onu} sn-auth {sn} omci ont-lineprofile-name {line_profile} ont-srvprofile-name {srv_profile}",
                f"service-port 1 vlan {vlan} gpon {frame}/{slot}/{pon} ont {onu} gemport 1 multi-service user-vlan {vlan}",
                "quit",
                "save",
            ],
            "deauthorize_onu": [
                "system-view",
                f"interface gpon {frame}/{slot}",
                f"ont delete {pon} {onu}",
                "quit",
                "save",
            ],
            "reboot_onu": [
                "system-view",
                f"interface gpon {frame}/{slot}",
                f"ont reset {pon} {onu}",
                "quit",
            ],
            "backup_running_config": [
                "display current-configuration",
                "save",
            ],
            "show_optical_power": [
                f"display ont optical-info {frame}/{slot}/{pon} {onu}",
            ],
            "save_config": [
                "save",
            ],
        }
        return scripts.get(action, [])

    def _build_vsol_script(self, action: str, payload: Dict[str, Any]) -> List[str]:
        slot = payload.get("slot", 1)
        pon = payload.get("pon", 1)
        onu = payload.get("onu", 1)
        sn = str(payload.get("serial", "VSOL00000001")).upper()
        vlan = int(payload.get("vlan", 120))

        scripts = {
            "show_pon_summary": [
                "show pon onu summary",
                "show pon onu online",
            ],
            "show_onu_list": [
                f"show pon onu list slot {slot} pon {pon}",
            ],
            "find_onu": [
                f"show pon onu by sn {sn}",
            ],
            "authorize_onu": [
                "configure terminal",
                f"pon-onu-mng gpon-onu_{slot}/{pon}:{onu}",
                f"sn-bind enable {sn}",
                f"service 1 vlan {vlan}",
                "end",
                "write",
            ],
            "deauthorize_onu": [
                "configure terminal",
                f"no pon-onu-mng gpon-onu_{slot}/{pon}:{onu}",
                "end",
                "write",
            ],
            "reboot_onu": [
                "configure terminal",
                f"pon-onu-mng gpon-onu_{slot}/{pon}:{onu}",
                "reboot",
                "end",
            ],
            "backup_running_config": [
                "show running-config",
                "write",
            ],
            "show_optical_power": [
                f"show pon onu optical-power slot {slot} pon {pon}",
                f"show pon onu info slot {slot} pon {pon} onu {onu}",
            ],
            "save_config": [
                "write",
            ],
        }
        return scripts.get(action, [])

