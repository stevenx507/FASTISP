import app.routes.mikrotik as mikrotik_routes

import io
import zipfile


from app import db
from app.models import AdminSystemSetting, User


def _build_wireguard_archive(
    endpoint: str = 'edge-router.fastisp.cloud:51820',
    private_key: str = 'ABC123PRIVATE',
) -> io.BytesIO:
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            'wg/client.conf',
            '\n'.join(
                [
                    '[Interface]',
                    f'PrivateKey = {private_key}',
                    'Address = 10.66.66.2/32',
                    '',
                    '[Peer]',
                    'PublicKey = XYZ456PUBLIC',
                    f'Endpoint = {endpoint}',
                    'AllowedIPs = 0.0.0.0/0, ::/0',
                    'PersistentKeepalive = 25',
                ]
            ),
        )
    archive_buffer.seek(0)
    return archive_buffer


def _admin_headers(client, app):
    with app.app_context():
        user = User(email='mk-admin@test.local', role='admin', name='MK Admin')
        user.set_password('supersecret')
        db.session.add(user)
        db.session.commit()

    response = client.post(
        '/api/auth/login',
        json={'email': 'mk-admin@test.local', 'password': 'supersecret'},
    )
    assert response.status_code == 200
    token = response.get_json()['token']
    return {'Authorization': f'Bearer {token}'}


def test_router_crud_and_quick_connect(client, app):
    headers = _admin_headers(client, app)

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-Centro',
            'ip_address': '10.10.10.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    created_payload = create_response.get_json()
    assert created_payload['success'] is True
    router_id = str(created_payload['router']['id'])

    patch_response = client.patch(
        f'/api/mikrotik/routers/{router_id}',
        json={'name': 'Nodo-Centro-Actualizado', 'api_port': 8729},
        headers=headers,
    )
    assert patch_response.status_code == 200
    patch_payload = patch_response.get_json()
    assert patch_payload['success'] is True
    assert patch_payload['router']['name'] == 'Nodo-Centro-Actualizado'

    quick_response = client.get(f'/api/mikrotik/routers/{router_id}/quick-connect', headers=headers)
    assert quick_response.status_code == 200
    quick_payload = quick_response.get_json()
    assert quick_payload['success'] is True
    assert 'access_profile' in quick_payload
    assert 'connection_plan' in quick_payload
    assert 'direct_api_script' in quick_payload['scripts']
    assert 'wireguard_site_to_vps_script' in quick_payload['scripts']
    assert 'bth_enable_minimal_script' in quick_payload['scripts']
    assert isinstance(quick_payload['guidance']['back_to_home'], list)
    assert 'back_to_home' in quick_payload
    assert 'scripts' in quick_payload['back_to_home']
    assert 'enable_script' in quick_payload['back_to_home']['scripts']
    assert 'add_vps_user_script' in quick_payload['back_to_home']['scripts']

    delete_response = client.delete(f'/api/mikrotik/routers/{router_id}', headers=headers)
    assert delete_response.status_code == 200
    delete_payload = delete_response.get_json()
    assert delete_payload['success'] is True


def test_quick_connect_marks_private_ip_for_tunnel_first(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikQuickConnectService)

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-Privado',
            'ip_address': '10.10.99.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    quick_response = client.get(f'/api/mikrotik/routers/{router_id}/quick-connect', headers=headers)
    assert quick_response.status_code == 200
    payload = quick_response.get_json()
    profile = payload.get('access_profile') or {}
    plan = payload.get('connection_plan') or {}
    assert profile.get('effective_scope') == 'private'
    assert profile.get('recommended_transport') == 'wireguard_or_back_to_home'
    assert plan.get('status') == 'private_unreachable_needs_local_step'
    assert 'prioriza WireGuard/BTH' in str(payload['scripts']['direct_api_script'])


def test_quick_connect_allows_scope_override_to_public(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikQuickConnectService)

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-Override',
            'ip_address': '10.10.98.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    quick_response = client.get(f'/api/mikrotik/routers/{router_id}/quick-connect?ip_scope=public', headers=headers)
    assert quick_response.status_code == 200
    payload = quick_response.get_json()
    profile = payload.get('access_profile') or {}
    plan = payload.get('connection_plan') or {}
    assert profile.get('requested_scope') == 'public'
    assert profile.get('effective_scope') == 'public'
    assert profile.get('recommended_transport') == 'direct_ssh_api'
    assert plan.get('status') == 'direct_public'
    assert payload['scripts']['windows_login'].startswith('ssh ')


def test_quick_connect_includes_managed_identity_when_private_key_not_provided(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikQuickConnectService)
    monkeypatch.setattr(
        mikrotik_routes,
        '_generate_wireguard_private_key_base64',
        lambda: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
    )

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-Managed-Key',
            'ip_address': '10.10.97.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    quick_response = client.get(f'/api/mikrotik/routers/{router_id}/quick-connect', headers=headers)
    assert quick_response.status_code == 200
    payload = quick_response.get_json()
    managed = payload.get('back_to_home', {}).get('managed_identity', {})
    assert managed.get('enabled') is True
    assert managed.get('key_source') == 'tenant_managed'
    assert 'private-key="' in str(payload.get('back_to_home', {}).get('scripts', {}).get('add_vps_user_script', ''))


def test_wireguard_profile_routes_and_quick_connect_use_tenant_profile(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikQuickConnectService)

    set_profile_response = client.post(
        '/api/mikrotik/wireguard/profile',
        json={
            'endpoint': '187.77.47.232:51820',
            'server_public_key': 'UkoIc1YP0iCZ0b/NGp39zhaLU02HfKI8aU+C2jp591M=',
            'allowed_subnets': '10.250.0.1/32',
        },
        headers=headers,
    )
    assert set_profile_response.status_code == 200
    set_payload = set_profile_response.get_json()
    assert set_payload['success'] is True
    assert set_payload['profile']['ready'] is True
    assert set_payload['profile']['endpoint'] == '187.77.47.232:51820'

    get_profile_response = client.get('/api/mikrotik/wireguard/profile', headers=headers)
    assert get_profile_response.status_code == 200
    get_payload = get_profile_response.get_json()
    assert get_payload['success'] is True
    assert get_payload['profile']['server_public_key_valid'] is True

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-WG-Profile',
            'ip_address': '10.10.97.2',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    quick_response = client.get(f'/api/mikrotik/routers/{router_id}/quick-connect', headers=headers)
    assert quick_response.status_code == 200
    quick_payload = quick_response.get_json()
    wg_profile = quick_payload.get('wireguard_profile') or {}
    assert wg_profile.get('ready') is True
    assert wg_profile.get('endpoint') == '187.77.47.232:51820'
    assert 'endpoint-address=187.77.47.232' in str(quick_payload['scripts']['wireguard_site_to_vps_script'])
    assert 'public-key="UkoIc1YP0iCZ0b/NGp39zhaLU02HfKI8aU+C2jp591M="' in str(quick_payload['scripts']['wireguard_site_to_vps_script'])


class _DummyRouterOsResource:
    def __init__(self, rows):
        self.rows = list(rows or [])

    def get(self, **kwargs):
        if not kwargs:
            return list(self.rows)
        matched = []
        for row in self.rows:
            row_data = row or {}
            ok = True
            for key, value in kwargs.items():
                direct = row_data.get(key)
                alt_dash = row_data.get(str(key).replace('_', '-'))
                alt_underscore = row_data.get(str(key).replace('-', '_'))
                row_value = direct if direct is not None else alt_dash if alt_dash is not None else alt_underscore
                if str(row_value) != str(value):
                    ok = False
                    break
            if ok:
                matched.append(row_data)
        return matched


class _DummyRouterOsApi:
    def __init__(self):
        self.resources = {
            '/interface/wireguard': _DummyRouterOsResource(
                [
                    {
                        'name': 'wg-fastisp',
                        'public-key': '+pWAE0GglDtysNZ4+qR7vTRbT6A8JS14bPmsyRK4a20=',
                    }
                ]
            ),
            '/ip/address': _DummyRouterOsResource(
                [
                    {
                        'interface': 'wg-fastisp',
                        'address': '10.250.8.2/32',
                    }
                ]
            ),
        }

    def get_resource(self, path):
        return self.resources[path]


class _DummyMikrotikWireGuardIdentityService:
    def __init__(self, router_id):
        self.router_id = router_id
        self.api = _DummyRouterOsApi()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_register_wireguard_peer_endpoint_syncs_vps_peer(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikWireGuardIdentityService)

    call_trace = {}

    def _fake_sync(peer_public_key, allowed_ip, payload):
        call_trace['peer_public_key'] = peer_public_key
        call_trace['allowed_ip'] = allowed_ip
        call_trace['payload'] = payload
        return {
            'success': True,
            'mode': 'ssh',
            'message': 'Peer registrado en VPS por SSH.',
            'manual_command': 'wg set wg0 peer ...',
            'runtime': {'mode': 'ssh', 'vps_interface': 'wg0'},
            'attempts': [{'transport': 'ssh', 'success': True}],
        }

    monkeypatch.setattr(mikrotik_routes, '_sync_router_peer_to_vps', _fake_sync)

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-WG-Sync',
            'ip_address': '10.10.91.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    response = client.post(
        f'/api/mikrotik/routers/{router_id}/wireguard/register-peer',
        json={
            'change_ticket': 'CHG-WG-001',
            'preflight_ack': True,
        },
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['router_wireguard']['interface'] == 'wg-fastisp'
    assert payload['router_wireguard']['public_key'] == '+pWAE0GglDtysNZ4+qR7vTRbT6A8JS14bPmsyRK4a20='
    assert payload['router_wireguard']['selected_allowed_ip'] == '10.250.8.2/32'
    assert payload['vps_sync']['mode'] == 'ssh'
    assert call_trace['peer_public_key'] == '+pWAE0GglDtysNZ4+qR7vTRbT6A8JS14bPmsyRK4a20='
    assert call_trace['allowed_ip'] == '10.250.8.2/32'


def test_register_wireguard_peer_endpoint_returns_manual_command_on_failure(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikWireGuardIdentityService)
    monkeypatch.setattr(
        mikrotik_routes,
        '_sync_router_peer_to_vps',
        lambda _key, _ip, _payload: {
            'success': False,
            'mode': 'auto',
            'message': 'No se pudo registrar peer automaticamente en el VPS.',
            'manual_required': True,
            'manual_command': 'wg set wg0 peer +pWAE... allowed-ips 10.250.8.2/32',
            'runtime': {'mode': 'auto'},
            'attempts': [{'transport': 'local', 'success': False}],
        },
    )

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-WG-Manual',
            'ip_address': '10.10.92.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    response = client.post(
        f'/api/mikrotik/routers/{router_id}/wireguard/register-peer',
        json={
            'change_ticket': 'CHG-WG-002',
            'preflight_ack': True,
        },
        headers=headers,
    )
    assert response.status_code == 502
    payload = response.get_json()
    assert payload['success'] is False
    assert payload['vps_sync']['manual_required'] is True
    assert 'wg set wg0 peer' in str(payload['vps_sync']['manual_command'])


def test_register_wireguard_peer_endpoint_can_configure_router_before_vps_sync(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikWireGuardIdentityService)

    ensure_trace = {'called': False}

    def _fake_ensure(service, router, payload):
        ensure_trace['called'] = True
        ensure_trace['router_id'] = getattr(router, 'id', None)
        ensure_trace['payload'] = payload
        return {
            'success': True,
            'router_interface': 'wg-fastisp',
            'router_allowed_ip': '10.250.8.2/32',
            'endpoint_host': '187.77.47.232',
            'endpoint_port': 51820,
        }

    monkeypatch.setattr(mikrotik_routes, '_ensure_router_wireguard_site_peer', _fake_ensure)
    monkeypatch.setattr(
        mikrotik_routes,
        '_sync_router_peer_to_vps',
        lambda _key, _ip, _payload: {
            'success': True,
            'mode': 'ssh',
            'message': 'ok',
            'manual_command': 'wg set wg0 peer ...',
            'runtime': {'mode': 'ssh'},
            'attempts': [],
        },
    )

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-WG-Autolink',
            'ip_address': '10.10.93.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    response = client.post(
        f'/api/mikrotik/routers/{router_id}/wireguard/register-peer',
        json={
            'configure_router_peer': True,
            'change_ticket': 'CHG-WG-003',
            'preflight_ack': True,
        },
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert ensure_trace['called'] is True
    assert payload['router_config']['router_allowed_ip'] == '10.250.8.2/32'


class _DummyMikrotikService:
    scripts = []

    def __init__(self, router_id):
        self.router_id = router_id
        self.api = object()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute_script(self, script_content):
        self.__class__.scripts.append(str(script_content))
        return {'success': True, 'result': 'ok'}


def test_back_to_home_actions_execute_scripts(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    _DummyMikrotikService.scripts = []
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikService)

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-BTH',
            'ip_address': '10.10.20.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    enable_response = client.post(
        f'/api/mikrotik/routers/{router_id}/back-to-home/enable',
        json={'confirm': True, 'change_ticket': 'CHG-BTH-001', 'preflight_ack': True},
        headers=headers,
    )
    assert enable_response.status_code == 200
    assert enable_response.get_json()['success'] is True

    add_user_response = client.post(
        f'/api/mikrotik/routers/{router_id}/back-to-home/users/add',
        json={
            'confirm': True,
            'user_name': 'noc-vps',
            'private_key': 'base64-private-key',
            'allow_lan': True,
            'change_ticket': 'CHG-BTH-001',
            'preflight_ack': True,
        },
        headers=headers,
    )
    assert add_user_response.status_code == 200
    assert add_user_response.get_json()['success'] is True

    remove_user_response = client.post(
        f'/api/mikrotik/routers/{router_id}/back-to-home/users/remove',
        json={'confirm': True, 'user_name': 'noc-vps', 'change_ticket': 'CHG-BTH-001', 'preflight_ack': True},
        headers=headers,
    )
    assert remove_user_response.status_code == 200
    assert remove_user_response.get_json()['success'] is True

    assert any('/ip/cloud/set back-to-home-vpn=enabled' in script for script in _DummyMikrotikService.scripts)
    assert any('/ip/cloud/back-to-home-users/add' in script for script in _DummyMikrotikService.scripts)
    assert any('/ip/cloud/back-to-home-users/remove' in script for script in _DummyMikrotikService.scripts)


def test_back_to_home_add_user_uses_managed_key_when_private_missing(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    _DummyMikrotikService.scripts = []
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikService)
    monkeypatch.setattr(
        mikrotik_routes,
        '_generate_wireguard_private_key_base64',
        lambda: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
    )

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-BTH-Managed',
            'ip_address': '10.10.21.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    add_user_response = client.post(
        f'/api/mikrotik/routers/{router_id}/back-to-home/users/add',
        json={
            'confirm': True,
            'user_name': 'noc-vps',
            'allow_lan': True,
            'change_ticket': 'CHG-BTH-AUTO-001',
            'preflight_ack': True,
        },
        headers=headers,
    )
    assert add_user_response.status_code == 200
    payload = add_user_response.get_json()
    assert payload['success'] is True
    assert payload['private_key_source'] == 'tenant_managed'
    assert payload['managed_identity']['enabled'] is True
    assert any('private-key="AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="' in script for script in _DummyMikrotikService.scripts)

    with app.app_context():
        row = (
            AdminSystemSetting.query
            .filter(AdminSystemSetting.tenant_id.is_(None))
            .filter_by(key='mikrotik_bth_managed_identity')
            .first()
        )
        assert row is not None
        assert isinstance(row.value, dict)
        assert str((row.value or {}).get('private_key_encrypted') or '').strip() != ''


def test_back_to_home_actions_require_confirmation(client, app):
    headers = _admin_headers(client, app)

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-BTH-Confirm',
            'ip_address': '10.10.30.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    enable_response = client.post(
        f'/api/mikrotik/routers/{router_id}/back-to-home/enable',
        json={'change_ticket': 'CHG-BTH-002', 'preflight_ack': True},
        headers=headers,
    )
    assert enable_response.status_code == 400

    add_user_response = client.post(
        f'/api/mikrotik/routers/{router_id}/back-to-home/users/add',
        json={'confirm': True, 'user_name': 'noc-vps', 'change_ticket': 'CHG-BTH-002', 'preflight_ack': True},
        headers=headers,
    )
    assert add_user_response.status_code == 400


def test_back_to_home_bootstrap_runs_single_flow(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    _DummyMikrotikService.scripts = []
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikService)

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-BTH-Bootstrap',
            'ip_address': '10.10.40.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    bootstrap_response = client.post(
        f'/api/mikrotik/routers/{router_id}/back-to-home/bootstrap',
        json={
            'confirm': True,
            'user_name': 'noc-vps',
            'private_key': 'base64-private-key',
            'allow_lan': True,
            'change_ticket': 'CHG-BTH-003',
            'preflight_ack': True,
        },
        headers=headers,
    )
    assert bootstrap_response.status_code == 200
    payload = bootstrap_response.get_json()
    assert payload['success'] is True
    assert payload['bootstrap']['user_name'] == 'noc-vps'
    assert any('/ip/cloud/set back-to-home-vpn=enabled' in script for script in _DummyMikrotikService.scripts)
    assert any('/ip/cloud/back-to-home-users/add' in script for script in _DummyMikrotikService.scripts)


def test_back_to_home_bootstrap_uses_managed_key_when_private_missing(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    _DummyMikrotikService.scripts = []
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikService)
    monkeypatch.setattr(
        mikrotik_routes,
        '_generate_wireguard_private_key_base64',
        lambda: 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=',
    )

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-BTH-Bootstrap-Auto',
            'ip_address': '10.10.41.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    bootstrap_response = client.post(
        f'/api/mikrotik/routers/{router_id}/back-to-home/bootstrap',
        json={
            'confirm': True,
            'user_name': 'noc-vps',
            'allow_lan': True,
            'change_ticket': 'CHG-BTH-004',
            'preflight_ack': True,
        },
        headers=headers,
    )
    assert bootstrap_response.status_code == 200
    payload = bootstrap_response.get_json()
    assert payload['success'] is True
    assert payload['private_key_source'] == 'tenant_managed'
    assert any('private-key="AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM="' in script for script in _DummyMikrotikService.scripts)


class _DummyMikrotikRiskService:
    def __init__(self, router_id):
        self.router_id = router_id
        self.api = object()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def reboot_router(self):
        return True

    def execute_script(self, _script_content):
        return {'success': True, 'result': 'ok'}


class _DummyMikrotikOnboardService:
    scripts = []

    def __init__(self, router_id):
        self.router_id = router_id
        self.api = object()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute_script(self, script_content):
        self.__class__.scripts.append(str(script_content))
        return {'success': True, 'result': 'ok'}


class _DummyMikrotikQuickConnectService:
    def __init__(self, router_id):
        self.router_id = router_id
        self.api = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _DummyMikrotikOnboardNoApiService:
    def __init__(self, router_id):
        self.router_id = router_id
        self.api = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute_script(self, _script_content):
        return {'success': False, 'result': 'unreachable'}


def test_change_ticket_guard_required_for_high_risk_mikrotik_actions(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikRiskService)

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-Risk-Guard',
            'ip_address': '10.10.50.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    reboot_response = client.post(
        f'/api/mikrotik/routers/{router_id}/reboot',
        json={},
        headers=headers,
    )
    assert reboot_response.status_code == 400
    assert 'change_ticket' in str(reboot_response.get_json().get('error', ''))

    reboot_preflight_response = client.post(
        f'/api/mikrotik/routers/{router_id}/reboot',
        json={'change_ticket': 'CHG-RISK-001'},
        headers=headers,
    )
    assert reboot_preflight_response.status_code == 400
    assert 'preflight_ack' in str(reboot_preflight_response.get_json().get('error', ''))

    execute_response = client.post(
        f'/api/mikrotik/routers/{router_id}/execute-script',
        json={'script': '/system identity print'},
        headers=headers,
    )
    assert execute_response.status_code == 400
    assert 'change_ticket' in str(execute_response.get_json().get('error', ''))

    hardening_live_response = client.post(
        f'/api/mikrotik/routers/{router_id}/enterprise/hardening',
        json={'dry_run': False, 'profile': 'baseline', 'site_profile': 'access'},
        headers=headers,
    )
    assert hardening_live_response.status_code == 400
    assert 'change_ticket' in str(hardening_live_response.get_json().get('error', ''))

    failover_response = client.post(
        f'/api/mikrotik/routers/{router_id}/enterprise/failover-test',
        json={'targets': ['1.1.1.1']},
        headers=headers,
    )
    assert failover_response.status_code == 400
    assert 'change_ticket' in str(failover_response.get_json().get('error', ''))


def test_change_ticket_guard_allows_dry_run_without_ticket(client, app):
    headers = _admin_headers(client, app)

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-Hardening-DryRun',
            'ip_address': '10.10.60.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    hardening_dry_response = client.post(
        f'/api/mikrotik/routers/{router_id}/enterprise/hardening',
        json={'dry_run': True, 'profile': 'baseline', 'site_profile': 'access'},
        headers=headers,
    )
    assert hardening_dry_response.status_code == 200
    payload = hardening_dry_response.get_json()
    assert payload['success'] is True
    assert payload['dry_run'] is True


def test_change_ticket_guard_can_be_disabled_by_setting(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikRiskService)

    with app.app_context():
        db.session.add(
            AdminSystemSetting(
                tenant_id=None,
                key='change_control_required_for_live',
                value=False,
            )
        )
        db.session.commit()

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-No-Guard',
            'ip_address': '10.10.70.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    reboot_response = client.post(
        f'/api/mikrotik/routers/{router_id}/reboot',
        json={'preflight_ack': True},
        headers=headers,
    )
    assert reboot_response.status_code == 200
    assert reboot_response.get_json()['success'] is True


def test_wireguard_zip_import_returns_onboarding_suggestions(client, app):
    headers = _admin_headers(client, app)
    archive_buffer = _build_wireguard_archive()

    response = client.post(
        '/api/mikrotik/wireguard/import',
        data={'archive': (archive_buffer, 'wireguard-export.zip')},
        headers=headers,
        content_type='multipart/form-data',
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['wireguard']['endpoint_host'] == 'edge-router.fastisp.cloud'
    assert payload['wireguard']['endpoint_port'] == 51820
    assert payload['suggestions']['router_ip_or_host'] == 'edge-router.fastisp.cloud'
    assert payload['suggestions']['bth_private_key'] == 'ABC123PRIVATE'


def test_wireguard_zip_import_requires_archive_file(client, app):
    headers = _admin_headers(client, app)
    response = client.post(
        '/api/mikrotik/wireguard/import',
        data={},
        headers=headers,
        content_type='multipart/form-data',
    )
    assert response.status_code == 400
    assert 'archive file is required' in str(response.get_json().get('error', ''))


def test_router_readiness_endpoint_returns_payload(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-Readiness',
            'ip_address': '10.10.80.1',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    router_id = str(create_response.get_json()['router']['id'])

    call_trace = {'write_probe': False}

    def _fake_build_readiness(service, run_write_probe=False):
        call_trace['write_probe'] = bool(run_write_probe)
        return {
            'score': 84,
            'checks': [{'id': 'api_connectivity', 'ok': True, 'severity': 'ok'}],
            'blockers': [],
            'recommendations': [],
            'runtime': {'reachable': True},
            'write_probe_enabled': bool(run_write_probe),
        }

    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikOnboardService)
    monkeypatch.setattr(mikrotik_routes, '_build_router_readiness_payload', _fake_build_readiness)

    response = client.get(f'/api/mikrotik/routers/{router_id}/readiness?write_probe=true', headers=headers)
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['readiness']['score'] == 84
    assert payload['readiness']['write_probe_enabled'] is True
    assert call_trace['write_probe'] is True


def test_wireguard_onboard_creates_router_and_bootstraps_bth(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    _DummyMikrotikOnboardService.scripts = []
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikOnboardService)
    monkeypatch.setattr(
        mikrotik_routes,
        '_build_router_readiness_payload',
        lambda _service, run_write_probe=False: {
            'score': 92,
            'checks': [{'id': 'api_connectivity', 'ok': True, 'severity': 'ok'}],
            'blockers': [],
            'recommendations': [],
            'runtime': {'reachable': True},
            'write_probe_enabled': bool(run_write_probe),
        },
    )
    monkeypatch.setattr(
        mikrotik_routes,
        '_collect_back_to_home_runtime',
        lambda _service: {
            'reachable': True,
            'supported': True,
            'bth_users_supported': True,
            'ddns_enabled': True,
            'users': [{'name': 'noc-vps', 'allow-lan': True, 'disabled': False}],
        },
    )

    response = client.post(
        '/api/mikrotik/wireguard/onboard',
        data={
            'archive': (_build_wireguard_archive(), 'wireguard-export.zip'),
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': '8728',
            'write_probe': 'true',
            'bootstrap_bth': 'true',
            'bth_user_name': 'noc-vps',
            'change_ticket': 'CHG-ONBOARD-001',
            'preflight_ack': 'true',
        },
        headers=headers,
        content_type='multipart/form-data',
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['created'] is True
    assert payload['router']['ip_address'] == 'edge-router.fastisp.cloud'
    assert payload['readiness']['score'] == 92
    assert payload['bootstrap']['user_name'] == 'noc-vps'
    assert payload['bootstrap']['success'] is True
    assert any('/ip/cloud/back-to-home-users/add' in script for script in _DummyMikrotikOnboardService.scripts)


def test_wireguard_onboard_updates_existing_router(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    _DummyMikrotikOnboardService.scripts = []
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikOnboardService)
    monkeypatch.setattr(
        mikrotik_routes,
        '_build_router_readiness_payload',
        lambda _service, run_write_probe=False: {
            'score': 75,
            'checks': [{'id': 'api_connectivity', 'ok': True, 'severity': 'ok'}],
            'blockers': [],
            'recommendations': [],
            'runtime': {'reachable': True},
            'write_probe_enabled': bool(run_write_probe),
        },
    )

    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-Existente',
            'ip_address': 'edge-router.fastisp.cloud',
            'username': 'old-user',
            'password': 'old-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201

    response = client.post(
        '/api/mikrotik/wireguard/onboard',
        data={
            'archive': (_build_wireguard_archive(), 'wireguard-export.zip'),
            'name': 'Nodo-Actualizado',
            'username': 'new-user',
            'password': 'new-pass',
            'update_existing': 'true',
            'write_probe': 'false',
        },
        headers=headers,
        content_type='multipart/form-data',
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['created'] is False
    assert payload['reused_existing'] is True
    assert payload['updated_existing'] is True
    assert payload['router']['name'] == 'Nodo-Actualizado'


def test_wireguard_onboard_returns_conflict_if_router_exists_and_update_disabled(client, app):
    headers = _admin_headers(client, app)
    create_response = client.post(
        '/api/mikrotik/routers',
        json={
            'name': 'Nodo-Existente-Conflict',
            'ip_address': 'edge-router.fastisp.cloud',
            'username': 'old-user',
            'password': 'old-pass',
            'api_port': 8728,
            'test_connection': False,
        },
        headers=headers,
    )
    assert create_response.status_code == 201

    response = client.post(
        '/api/mikrotik/wireguard/onboard',
        data={
            'archive': (_build_wireguard_archive(), 'wireguard-export.zip'),
            'username': 'new-user',
            'password': 'new-pass',
            'update_existing': 'false',
        },
        headers=headers,
        content_type='multipart/form-data',
    )
    assert response.status_code == 409
    assert 'already exists' in str(response.get_json().get('error', ''))


def test_wireguard_onboard_normalizes_ip_with_port(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikOnboardService)
    monkeypatch.setattr(
        mikrotik_routes,
        '_build_router_readiness_payload',
        lambda _service, run_write_probe=False: {
            'score': 70,
            'checks': [],
            'blockers': [],
            'recommendations': [],
            'runtime': {'reachable': True},
            'write_probe_enabled': bool(run_write_probe),
        },
    )

    response = client.post(
        '/api/mikrotik/wireguard/onboard',
        data={
            'archive': (_build_wireguard_archive(), 'wireguard-export.zip'),
            'ip_address': '172.16.0.1:9090',
            'username': 'api-admin',
            'password': 'router-pass',
            'api_port': '8728',
        },
        headers=headers,
        content_type='multipart/form-data',
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['router']['ip_address'] == '172.16.0.1'
    assert payload['router']['api_port'] == 8728


def test_wireguard_onboard_keeps_router_when_bootstrap_unreachable(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    monkeypatch.setattr(mikrotik_routes, 'MikroTikService', _DummyMikrotikOnboardNoApiService)
    monkeypatch.setattr(
        mikrotik_routes,
        '_build_router_readiness_payload',
        lambda _service, run_write_probe=False: {
            'score': 20,
            'checks': [{'id': 'api_connectivity', 'ok': False, 'severity': 'critical'}],
            'blockers': [{'id': 'api_connectivity', 'detail': 'Router API unreachable from backend.'}],
            'recommendations': [],
            'runtime': {'reachable': False},
            'write_probe_enabled': bool(run_write_probe),
        },
    )

    response = client.post(
        '/api/mikrotik/wireguard/onboard',
        data={
            'archive': (_build_wireguard_archive(), 'wireguard-export.zip'),
            'username': 'api-admin',
            'password': 'router-pass',
            'bootstrap_bth': 'true',
            'bth_user_name': 'noc-vps',
            'change_ticket': 'CHG-ONBOARD-UNREACHABLE',
            'preflight_ack': 'true',
        },
        headers=headers,
        content_type='multipart/form-data',
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['created'] is True
    assert payload['bootstrap']['success'] is False
    assert 'No se pudo conectar por API' in str(payload['bootstrap'].get('error', ''))
