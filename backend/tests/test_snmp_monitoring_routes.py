from app import cache, db
from app.models import MikroTikRouter, User

import app.routes.main_routes as main_routes
import app.routes.mikrotik as mikrotik_routes
import app.routes.olt as olt_routes


def _admin_headers(client, app):
    with app.app_context():
        user = User(email='snmp-admin@test.local', role='admin', name='SNMP Admin')
        user.set_password('supersecret')
        db.session.add(user)
        db.session.commit()

    response = client.post(
        '/api/auth/login',
        json={'email': 'snmp-admin@test.local', 'password': 'supersecret'},
    )
    assert response.status_code == 200
    token = response.get_json()['token']
    return {'Authorization': f'Bearer {token}'}


def _router(app, *, name='Router SNMP', ip='10.10.20.1', alert_config=None):
    with app.app_context():
        router = MikroTikRouter(
            name=name,
            ip_address=ip,
            username='api-admin',
            api_port=8728,
            is_active=True,
            alert_config=alert_config or {},
        )
        router.password = 'router-pass'
        db.session.add(router)
        db.session.commit()
        return router.id


def test_router_snmp_profile_roundtrip_and_manual_poll(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    router_id = _router(app)

    monkeypatch.setattr(mikrotik_routes.snmp_service, 'is_available', lambda: True)
    monkeypatch.setattr(
        mikrotik_routes.snmp_service,
        'poll_router_profile',
        lambda profile: {
            'success': True,
            'profile': mikrotik_routes.snmp_service.sanitize_profile(profile),
            'health_metrics': {'cpu_percent': 42.5, 'temperature_c': 51.2},
            'interfaces': [{'name': 'ether1', 'rx_bytes': 1000, 'tx_bytes': 2000, 'oper_status': 1}],
            'polled_at': '2026-04-08T15:00:00Z',
            'source': 'snmp',
            'runtime_available': True,
        },
    )

    put_response = client.put(
        f'/api/mikrotik/routers/{router_id}/snmp-profile',
        json={
            'enabled': True,
            'host': '10.10.20.1',
            'community': 'public',
            'interface_names': ['ether1'],
            'scalar_oids': {
                'cpu_percent': '1.3.6.1.4.1.14988.1.1.3.10.0',
                'temperature_c': {'oid': '1.3.6.1.4.1.14988.1.1.3.100.0', 'scale': 0.1},
            },
        },
        headers=headers,
    )
    assert put_response.status_code == 200
    put_payload = put_response.get_json()
    assert put_payload['profile']['enabled'] is True
    assert put_payload['profile']['community_configured'] is True
    assert put_payload['profile']['community_preview']
    assert 'community' not in put_payload['profile']

    get_response = client.get(f'/api/mikrotik/routers/{router_id}/snmp-profile', headers=headers)
    assert get_response.status_code == 200
    get_payload = get_response.get_json()
    assert get_payload['profile']['host'] == '10.10.20.1'
    assert get_payload['profile']['interface_names'] == ['ether1']

    poll_response = client.post(f'/api/mikrotik/routers/{router_id}/snmp/poll', json={}, headers=headers)
    assert poll_response.status_code == 200
    poll_payload = poll_response.get_json()
    assert poll_payload['health_metrics']['cpu_percent'] == 42.5
    assert poll_payload['interfaces'][0]['name'] == 'ether1'

    with app.app_context():
        router = db.session.get(MikroTikRouter, router_id)
        assert router is not None
        assert router.alert_config['snmp']['community'] == 'public'
        assert router.alert_config['snmp']['enabled'] is True


def test_router_snmp_profile_update_preserves_existing_community_when_omitted(client, app):
    headers = _admin_headers(client, app)
    router_id = _router(
        app,
        alert_config={
            'snmp': {
                'enabled': True,
                'host': '10.10.20.1',
                'community': 'secret-community',
                'scalar_oids': {
                    'cpu_percent': '1.3.6.1.4.1.14988.1.1.3.10.0',
                },
            }
        },
    )

    response = client.put(
        f'/api/mikrotik/routers/{router_id}/snmp-profile',
        json={
            'enabled': True,
            'host': '10.10.20.55',
            'scalar_oids': {
                'temperature_c': '1.3.6.1.4.1.14988.1.1.3.100.0',
            },
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['profile']['community_configured'] is True

    with app.app_context():
        router = db.session.get(MikroTikRouter, router_id)
        assert router is not None
        assert router.alert_config['snmp']['community'] == 'secret-community'
        assert router.alert_config['snmp']['host'] == '10.10.20.55'


def test_olt_custom_device_accepts_snmp_profile_and_manual_poll(client, app, monkeypatch):
    headers = _admin_headers(client, app)

    with app.app_context():
        cache.clear()

    monkeypatch.setattr(
        olt_routes.snmp_service,
        'poll_device_profile',
        lambda profile, default_host='', default_label='': {
            'success': True,
            'profile': olt_routes.snmp_service.sanitize_profile(
                olt_routes.snmp_service.normalize_profile(profile, default_host=default_host, default_label=default_label)
            ),
            'health_metrics': {'optical_rx_dbm': -27.5, 'onu_online': 64},
            'interfaces': [],
            'polled_at': '2026-04-08T15:10:00Z',
            'source': 'snmp',
            'runtime_available': True,
        },
    )

    create_response = client.post(
        '/api/olt/devices',
        json={
            'vendor': 'zte',
            'name': 'OLT SNMP',
            'host': '10.20.30.40',
            'transport': 'telnet',
            'port': 23,
            'username': 'admin',
            'site': 'LAB',
            'snmp': {
                'enabled': True,
                'community': 'public',
                'scalar_oids': {
                    'optical_rx_dbm': {'oid': '1.3.6.1.4.1.1.0', 'scale': 0.1},
                    'onu_online': '1.3.6.1.4.1.1.1',
                },
            },
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    create_payload = create_response.get_json()
    device_id = create_payload['device']['id']
    assert create_payload['device']['snmp']['community_configured'] is True
    assert 'community' not in create_payload['device']['snmp']

    list_response = client.get('/api/olt/devices?vendor=zte', headers=headers)
    assert list_response.status_code == 200
    listed = next(item for item in list_response.get_json()['devices'] if item['id'] == device_id)
    assert listed['snmp']['enabled'] is True
    assert listed['snmp']['community_configured'] is True
    assert 'community' not in listed['snmp']

    poll_response = client.post(f'/api/olt/devices/{device_id}/snmp/poll', json={}, headers=headers)
    assert poll_response.status_code == 200
    poll_payload = poll_response.get_json()
    assert poll_payload['health_metrics']['optical_rx_dbm'] == -27.5
    assert poll_payload['device']['id'] == device_id


def test_network_alerts_include_snmp_health_and_trap_events(client, app, monkeypatch):
    headers = _admin_headers(client, app)
    router_id = _router(
        app,
        name='Router Ambiente',
        ip='10.10.30.1',
        alert_config={
            'snmp': {
                'enabled': True,
                'host': '10.10.30.1',
                'community': 'public',
                'thresholds': {
                    'temperature_c': 70,
                    'voltage_v_min': 21.5,
                },
            }
        },
    )

    class FakeMonitoring:
        def latest_point(self, measurement, tags=None):
            assert measurement == 'snmp_device_health'
            assert tags == {'router_id': str(router_id)}
            return {
                '_time': '2026-04-08T15:30:00Z',
                'temperature_c': 75.4,
                'voltage_v': 20.8,
            }

    monkeypatch.setattr(main_routes, 'MonitoringService', lambda: FakeMonitoring())

    with app.app_context():
        cache.clear()
    app.config['SNMP_TRAP_WEBHOOK_TOKEN'] = 'trap-secret'

    trap_response = client.post(
        '/api/network/snmp/traps',
        json={
            'source': '10.10.30.1',
            'target': 'Router Ambiente',
            'severity': 'critical',
            'message': 'Trap SNMP: enlace SFP caido',
        },
        headers={'X-SNMP-Trap-Token': 'trap-secret'},
    )
    assert trap_response.status_code == 202

    alerts_response = client.get('/api/network/alerts', headers=headers)
    assert alerts_response.status_code == 200
    payload = alerts_response.get_json()
    messages = [alert['message'] for alert in payload['alerts']]
    assert any('Temperatura alta por SNMP' in message for message in messages)
    assert any('Voltaje bajo por SNMP' in message for message in messages)
    assert any('Trap SNMP: enlace SFP caido' in message for message in messages)
