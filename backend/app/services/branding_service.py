"""
BrandingService - Pilar 23: SaaS Whitelabeling (Sistema Camaleón)

Recupera la configuración de marca (brand_name, logo_url, colors)
según el tenant_id o el Host header (subdominio).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from flask import current_app, request

logger = logging.getLogger(__name__)

# Campos públicos del branding (sin datos sensibles)
BRANDING_FIELDS = ("brand_name", "logo_url", "primary_color", "secondary_color", "custom_domain")

# Configuración de marca por defecto de la plataforma
DEFAULT_BRANDING: Dict[str, Any] = {
    "brand_name": "ISPMAX",
    "logo_url": None,
    "primary_color": "#3b82f6",
    "secondary_color": "#1e293b",
    "custom_domain": None,
}


class BrandingService:
    """Servicio de marca blanca multi-tenant."""

    # --------------------------------------------------------------------------
    # Resolución de tenant desde Host header
    # --------------------------------------------------------------------------

    @staticmethod
    def resolve_tenant_id_from_host(host: Optional[str] = None) -> Optional[int]:
        """
        Intenta resolver el tenant_id a partir del Host header.
        Estrategia:
          1. Si el host coincide con `Tenant.custom_domain` → usar ese tenant.
          2. Si el host es un subdominio <slug>.domain.tld → buscar por slug.
          3. Si no se resuelve → devuelve None (se usará el default).
        """
        try:
            from app.models import Tenant
            raw_host = (host or "").strip().lower().split(":")[0]  # quitar puerto

            if not raw_host:
                return None

            # 1. Buscar por custom_domain exacto
            by_domain = Tenant.query.filter(
                Tenant.custom_domain == raw_host,
                Tenant.is_active == True  # noqa: E712
            ).first()
            if by_domain:
                return by_domain.id

            # 2. Extraer subdominio (primera parte antes del primer punto)
            parts = raw_host.split(".")
            if len(parts) >= 3:
                slug_candidate = parts[0]
                by_slug = Tenant.query.filter(
                    Tenant.slug == slug_candidate,
                    Tenant.is_active == True  # noqa: E712
                ).first()
                if by_slug:
                    return by_slug.id

        except Exception as exc:
            logger.debug("BrandingService.resolve_tenant_id_from_host error: %s", exc)

        return None

    # --------------------------------------------------------------------------
    # Obtener configuración de branding
    # --------------------------------------------------------------------------

    @staticmethod
    def get_config(tenant_id: Optional[int] = None, host: Optional[str] = None) -> Dict[str, Any]:
        """
        Devuelve la configuración de branding del tenant.
        Orden de resolución:
          1. tenant_id explícito
          2. host / subdominio
          3. primer tenant activo (fallback single-tenant)
          4. defaults de plataforma
        """
        try:
            from app.models import Tenant

            resolved_id = tenant_id

            # 2. Intentar resolver por host si no hay tenant_id
            if not resolved_id and host:
                resolved_id = BrandingService.resolve_tenant_id_from_host(host)

            # 3. Fallback: primer tenant activo
            if not resolved_id:
                first = Tenant.query.filter_by(is_active=True).first()
                resolved_id = first.id if first else None

            if resolved_id:
                tenant = Tenant.query.get(resolved_id)
                if tenant:
                    return {
                        "tenant_id": tenant.id,
                        "brand_name": tenant.brand_name or tenant.name,
                        "logo_url": tenant.logo_url,
                        "primary_color": tenant.primary_color or DEFAULT_BRANDING["primary_color"],
                        "secondary_color": tenant.secondary_color or DEFAULT_BRANDING["secondary_color"],
                        "custom_domain": tenant.custom_domain,
                    }
        except Exception as exc:
            logger.warning("BrandingService.get_config error: %s", exc)

        # 4. Defaults de plataforma
        return dict(DEFAULT_BRANDING)

    # --------------------------------------------------------------------------
    # Actualizar configuración de branding de un tenant
    # --------------------------------------------------------------------------

    @staticmethod
    def update_config(tenant_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Actualiza los campos de branding del tenant.
        Devuelve el branding actualizado.
        """
        from app import db
        from app.models import Tenant

        tenant = Tenant.query.get(tenant_id)
        if not tenant:
            raise ValueError(f"Tenant {tenant_id} no encontrado")

        allowed_fields = {
            "brand_name": str,
            "logo_url": str,
            "primary_color": str,
            "secondary_color": str,
            "custom_domain": str,
        }

        for field, cast in allowed_fields.items():
            if field in data:
                value = data[field]
                setattr(tenant, field, cast(value).strip() if value is not None else None)

        db.session.add(tenant)
        db.session.commit()

        return BrandingService.get_config(tenant_id=tenant_id)

    # --------------------------------------------------------------------------
    # Helper: config desde request actual (para uso en rutas Flask)
    # --------------------------------------------------------------------------

    @staticmethod
    def get_config_from_request(tenant_id_override: Optional[int] = None) -> Dict[str, Any]:
        """
        Conveniencia: resuelve branding desde el request Flask actual.
        Primero respeta tenant_id_override; si no, usa Host header.
        """
        host = None
        try:
            host = request.host
        except RuntimeError:
            pass  # fuera de contexto de request

        return BrandingService.get_config(tenant_id=tenant_id_override, host=host)

    @staticmethod
    def get_default_config() -> Dict[str, Any]:
        """Alias para compatibilidad con código legado."""
        return dict(DEFAULT_BRANDING)
