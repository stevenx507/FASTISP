import pytest
from flask_jwt_extended import create_access_token

from app import db
from app.models import Tenant
from app.tenancy import TenantResolutionError, resolve_tenant_id


def test_resolve_tenant_id_from_header(app):
    with app.test_request_context('/api/health?tenant_id=5', headers={'X-Tenant-ID': '7'}):
        assert resolve_tenant_id() == 7


def test_resolve_tenant_id_from_jwt_claim(app):
    with app.app_context():
        token = create_access_token(identity='123', additional_claims={'tenant_id': 11})

    with app.test_request_context('/api/health', headers={'Authorization': f'Bearer {token}'}):
        assert resolve_tenant_id() == 11


def test_resolve_tenant_id_rejects_jwt_and_header_mismatch(app):
    with app.app_context():
        token = create_access_token(identity='123', additional_claims={'tenant_id': 11})

    with app.test_request_context(
        '/api/health',
        headers={'Authorization': f'Bearer {token}', 'X-Tenant-ID': '12'},
    ):
        with pytest.raises(TenantResolutionError):
            resolve_tenant_id()


def test_resolve_tenant_id_from_subdomain_host(app):
    with app.app_context():
        app.config['TENANCY_ROOT_DOMAIN'] = 'fastisp.cloud'
        app.config['TENANCY_EXCLUDED_SUBDOMAINS'] = ['api', 'master', 'www']
        tenant = Tenant(slug='isp-a', name='ISP A')
        db.session.add(tenant)
        db.session.commit()
        tenant_id = tenant.id

    with app.test_request_context('/api/health', base_url='https://isp-a.fastisp.cloud'):
        assert resolve_tenant_id() == tenant_id


def test_resolve_tenant_id_rejects_unknown_subdomain_tenant(app):
    with app.app_context():
        app.config['TENANCY_ROOT_DOMAIN'] = 'fastisp.cloud'
        app.config['TENANCY_EXCLUDED_SUBDOMAINS'] = ['api', 'master', 'www']

    with app.test_request_context('/api/health', base_url='https://missing.fastisp.cloud'):
        with pytest.raises(TenantResolutionError):
            resolve_tenant_id()
