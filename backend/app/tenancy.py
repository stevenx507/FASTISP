"""Utilities for tenant-aware request handling."""

from __future__ import annotations

from functools import wraps
from typing import Any, Optional

from flask import current_app, g, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required, verify_jwt_in_request
from flask_jwt_extended.exceptions import JWTExtendedException, NoAuthorizationError
from jwt.exceptions import InvalidTokenError

from app import db
from app.models import Tenant, User


class TenantResolutionError(ValueError):
    """Raised when tenant information is malformed or inconsistent."""


def _coerce_tenant_id(value: Any) -> Optional[int]:
    if value in (None, ''):
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise TenantResolutionError('tenant_id must be an integer') from exc


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {'1', 'true', 'yes', 'y', 'on'}


def _hostname_without_port(raw_host: Any) -> str:
    host = str(raw_host or '').strip().lower()
    if not host:
        return ''
    return host.split(':', 1)[0]


def _resolve_tenant_id_from_host() -> Optional[int]:
    host = _hostname_without_port(request.host)
    if not host:
        return None

    root_domain = str(current_app.config.get('TENANCY_ROOT_DOMAIN') or '').strip().lower()
    if not root_domain:
        return None

    master_host = _hostname_without_port(current_app.config.get('TENANCY_MASTER_HOST'))
    api_host = _hostname_without_port(current_app.config.get('TENANCY_API_HOST'))
    excluded = {
        str(value).strip().lower()
        for value in (current_app.config.get('TENANCY_EXCLUDED_SUBDOMAINS') or [])
        if str(value).strip()
    }

    if host == root_domain or host == master_host or host == api_host:
        return None

    if not host.endswith(f'.{root_domain}'):
        if _coerce_bool(current_app.config.get('TENANCY_ENFORCE_HOST_MATCH'), default=False):
            raise TenantResolutionError('host is outside TENANCY_ROOT_DOMAIN')
        return None

    subdomain = host[: -(len(root_domain) + 1)]
    if not subdomain or '.' in subdomain or subdomain in excluded:
        return None

    tenant = Tenant.query.filter_by(slug=subdomain).first()
    if not tenant or not tenant.is_active:
        raise TenantResolutionError('tenant not found for host')
    return int(tenant.id)


def resolve_tenant_id() -> Optional[int]:
    """Resolve tenant id from header/query/JWT with consistency checks."""
    host_tenant = _resolve_tenant_id_from_host()
    request_tenant = _coerce_tenant_id(
        request.headers.get('X-Tenant-ID') or request.args.get('tenant_id')
    )

    jwt_tenant: Optional[int] = None
    try:
        verify_jwt_in_request(optional=True)
    except NoAuthorizationError:
        jwt_tenant = None
    except (JWTExtendedException, InvalidTokenError) as exc:
        raise TenantResolutionError('Invalid JWT token') from exc
    else:
        claims = get_jwt() or {}
        jwt_tenant = _coerce_tenant_id(claims.get('tenant_id'))

    if request_tenant is not None and jwt_tenant is not None and request_tenant != jwt_tenant:
        raise TenantResolutionError(
            'tenant_id from request does not match authenticated tenant'
        )

    if host_tenant is not None and request_tenant is not None and host_tenant != request_tenant:
        raise TenantResolutionError('tenant_id from host does not match request tenant')
    if host_tenant is not None and jwt_tenant is not None and host_tenant != jwt_tenant:
        raise TenantResolutionError('tenant_id from host does not match authenticated tenant')

    if request_tenant is not None:
        return request_tenant
    if host_tenant is not None:
        return host_tenant
    return jwt_tenant


def _current_user_id() -> Optional[int]:
    identity = get_jwt_identity()
    if identity in (None, ''):
        return None
    try:
        return int(identity)
    except (TypeError, ValueError) as exc:
        raise TenantResolutionError('Invalid authenticated user id') from exc


def current_tenant_id() -> Optional[int]:
    """Return tenant id resolved in request lifecycle."""
    return getattr(g, 'tenant_id', None)


def tenant_access_allowed(resource_tenant_id: Optional[int]) -> bool:
    """Validate if current request can access a resource tenant."""
    tenant_id = current_tenant_id()
    if tenant_id is None:
        return True
    if resource_tenant_id is None:
        return False
    return tenant_id == int(resource_tenant_id)


def tenant_admin_required():
    """JWT + admin role + tenant scoped access."""

    def wrapper(fn):
        @jwt_required()
        @wraps(fn)
        def decorator(*args, **kwargs):
            try:
                user_id = _current_user_id()
            except TenantResolutionError:
                return jsonify({'error': 'Token de usuario invalido.'}), 401
            if user_id is None:
                return jsonify({'error': 'Token de usuario invalido.'}), 401
            user = db.session.get(User, user_id)
            if not user or user.role != 'admin':
                return jsonify({'error': 'Acceso denegado. Se requiere rol de administrador.'}), 403

            tenant_id = current_tenant_id()
            if tenant_id is not None and user.tenant_id not in (None, tenant_id):
                return jsonify({'error': 'Acceso denegado para este tenant.'}), 403

            return fn(*args, **kwargs)

        return decorator

    return wrapper
