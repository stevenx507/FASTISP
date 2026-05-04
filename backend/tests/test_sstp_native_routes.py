from app import db
from app.models import MikroTikRouter, SstpTunnel, Tenant, User

import app.routes.sstp as sstp_routes


def _admin_headers(client, app):
    with app.app_context():
        tenant = Tenant(slug='isp-sstp', name='ISP SSTP')
        db.session.add(tenant)
        db.session.flush()

        user = User(email='sstp-admin@test.local', role='admin', name='SSTP Admin', tenant_id=tenant.id)
        user.set_password('supersecret')
        db.session.add(user)
        db.session.commit()

    response = client.post(
        '/api/auth/login',
        json={'email': 'sstp-admin@test.local', 'password': 'supersecret'},
        headers={'X-Tenant-ID': '1'},
    )
    assert response.status_code == 200
    token = response.get_json()['token']
    return {'Authorization': f'Bearer {token}', 'X-Tenant-ID': '1'}


def _router(app, *, name='Nodo-SSTP', ip='10.10.10.1'):
    with app.app_context():
        router = MikroTikRouter(
            name=name,
            ip_address=ip,
            username='api-admin',
            api_port=8728,
            tenant_id=1,
        )
        router.password = 'router-pass'
        db.session.add(router)
        db.session.commit()
        return router.id


def test_create_tunnel_reuses_same_credentials_for_api_apply(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    router_id = _router(app)

    captured = {}

    def _fake_apply(router, provisioning=None):
        captured.update(provisioning or {})
        return {'api_applied': True, 'api_results': ['ok']}

    monkeypatch.setattr(sstp_routes, 'provision_sstp_tunnel_api', _fake_apply)

    response = client.post(
        '/api/sstp/tunnels',
        json={'router_id': router_id},
        headers=headers,
    )

    assert response.status_code == 201
    payload = response.get_json()
    assert payload['server_port'] == 443
    assert payload['api_applied'] is True
    assert captured['username'] == payload['username']
    assert captured['password'] == payload['password']
    assert payload['message'] == 'Servidor SSTP nativo configurado via API'


def test_add_ppp_secret_allows_auto_private_ip_and_requires_public_ip(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    router_id = _router(app, name='Nodo-PPP', ip='10.10.10.2')

    captured = {}

    def _fake_add(router_id, client_name, password, remote_address=None, is_public=False, lan_interface='bridge'):
        captured.update(
            {
                'router_id': router_id,
                'client_name': client_name,
                'password': password,
                'remote_address': remote_address,
                'is_public': is_public,
                'lan_interface': lan_interface,
            }
        )
        return {
            'success': True,
            'remote_address': '10.10.0.23',
            'results': ['PPP secret creado: juan-perez'],
        }

    monkeypatch.setattr(sstp_routes, 'add_ppp_secret_api', _fake_add)

    response = client.post(
        '/api/sstp/ppp-secrets',
        json={
            'router_id': router_id,
            'client_name': 'juan-perez',
            'password': 'Secret123',
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert captured['remote_address'] is None
    assert payload['remote_address'] == '10.10.0.23'

    public_response = client.post(
        '/api/sstp/ppp-secrets',
        json={
            'router_id': router_id,
            'client_name': 'cliente-publico',
            'password': 'Secret123',
            'is_public': True,
        },
        headers=headers,
    )
    assert public_response.status_code == 400
    assert 'remote_address es requerido' in public_response.get_json()['error']


def test_onboarding_script_route_returns_native_sstp_script(client, app):
    headers = _admin_headers(client, app)
    router_id = _router(app, name='Nodo-Script', ip='198.51.100.20')

    with app.app_context():
        tunnel = SstpTunnel(
            router_id=router_id,
            tenant_id=1,
            username='sstp-nodo-script',
            server_ip='10.10.0.1',
            client_ip='10.10.0.2',
            server_host='198.51.100.20',
            server_port=443,
            status='active',
        )
        tunnel.password = 'Secret123ABC'
        db.session.add(tunnel)
        db.session.commit()

    response = client.get(f'/api/routers/{router_id}/onboarding-script', headers=headers)

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['architecture'] == 'mikrotik-native-sstp'
    assert payload['server_port'] == 443
    assert payload['vpn_username'] == 'sstp-nodo-script'
    assert '/interface sstp-server server set enabled=yes port=443' in payload['script']
    assert '/certificate add name=FastISP-CA' in payload['script']
