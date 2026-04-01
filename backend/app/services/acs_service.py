"""ACS (TR-069) integration helpers."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


def _as_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _normalize_base_url(raw: Any) -> str:
    token = str(raw or "").strip()
    return token.rstrip("/")


def _normalize_path(raw: Any, default: str = "/api/v1/tr069/reprovision") -> str:
    token = str(raw or "").strip()
    if not token:
        token = default
    if not token.startswith("/"):
        token = f"/{token}"
    return token


@dataclass
class ACSConfig:
    base_url: str
    api_key: str
    default_host: str
    reprovision_path: str
    timeout_seconds: float
    verify_tls: bool

    @property
    def configured(self) -> bool:
        return bool(self.base_url)


class ACSService:
    """Simple HTTP client for ACS reprovision workflows."""

    def __init__(self, config: ACSConfig):
        self.config = config

    @classmethod
    def from_app_config(cls, app_config: dict[str, Any]) -> "ACSService":
        try:
            timeout_seconds = float(app_config.get("ACS_TIMEOUT_SECONDS", 8.0))
        except (TypeError, ValueError):
            timeout_seconds = 8.0
        timeout_seconds = max(2.0, min(timeout_seconds, 60.0))

        config = ACSConfig(
            base_url=_normalize_base_url(app_config.get("ACS_BASE_URL")),
            api_key=str(app_config.get("ACS_API_KEY") or "").strip(),
            default_host=str(app_config.get("ACS_DEFAULT_HOST") or "").strip(),
            reprovision_path=_normalize_path(app_config.get("ACS_REPROVISION_PATH")),
            timeout_seconds=timeout_seconds,
            verify_tls=_as_bool(app_config.get("ACS_VERIFY_TLS"), default=True),
        )
        return cls(config=config)

    def build_url(self) -> str:
        if not self.config.base_url:
            return self.config.reprovision_path
        return f"{self.config.base_url}{self.config.reprovision_path}"

    def build_payload(
        self,
        *,
        device_id: str,
        host: str | None,
        serial: str | None,
        run_mode: str,
        tenant_id: int | None,
        requested_by: str,
    ) -> dict[str, Any]:
        target_host = str(host or "").strip() or self.config.default_host
        return {
            "device_id": str(device_id or "").strip(),
            "host": target_host,
            "serial": str(serial or "").strip() or None,
            "run_mode": str(run_mode or "").strip().lower() or "live",
            "tenant_id": tenant_id,
            "requested_by": requested_by,
        }

    def _headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    def reprovision(self, payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
        if not self.config.configured:
            return {
                "success": False,
                "error": "ACS_BASE_URL no configurado",
            }, 503

        host = str(payload.get("host") or "").strip()
        if not host:
            return {
                "success": False,
                "error": "host is required",
            }, 400

        url = self.build_url()
        try:
            response = requests.post(
                url,
                json=payload,
                headers=self._headers(),
                timeout=self.config.timeout_seconds,
                verify=self.config.verify_tls,
            )
        except Exception as exc:
            return {
                "success": False,
                "error": f"ACS request failed: {exc}",
                "acs_url": url,
            }, 502

        try:
            body: Any = response.json()
        except ValueError:
            body = {"raw": response.text}

        ok = 200 <= int(response.status_code) < 300
        result = {
            "success": ok,
            "acs_url": url,
            "acs_status": int(response.status_code),
            "response": body,
        }
        if not ok:
            result["error"] = (
                str(body.get("error") or body.get("message") or "ACS rejected request")
                if isinstance(body, dict)
                else "ACS rejected request"
            )
        return result, (200 if ok else 502)

