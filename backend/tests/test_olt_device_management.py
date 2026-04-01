from app import db
from app.models import User


def _admin_headers(client, app):
    with app.app_context():
        user = User(email='olt-device-admin@test.local', role='admin', name='OLT Device Admin')
        user.set_password('supersecret')
        db.session.add(user)
        db.session.commit()

    response = client.post(
        '/api/auth/login',
        json={'email': 'olt-device-admin@test.local', 'password': 'supersecret'},
    )
    assert response.status_code == 200
    token = response.get_json()['token']
    return {'Authorization': f'Bearer {token}'}


def test_create_custom_olt_device_and_list(client, app):
    headers = _admin_headers(client, app)

    create_response = client.post(
        '/api/olt/devices',
        json={
            'vendor': 'zte',
            'name': 'OLT Test NOC',
            'host': '10.20.30.40',
            'transport': 'telnet',
            'port': 23,
            'username': 'admin',
            'site': 'LAB',
            'password': 'olt-pass',
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    create_payload = create_response.get_json()
    assert create_payload['success'] is True
    created_id = create_payload['device']['id']

    list_response = client.get('/api/olt/devices?vendor=zte', headers=headers)
    assert list_response.status_code == 200
    list_payload = list_response.get_json()
    assert list_payload['success'] is True

    created = next((item for item in list_payload['devices'] if item['id'] == created_id), None)
    assert created is not None
    assert created['origin'] == 'custom'
    assert 'password' not in created


def test_remote_options_returns_commands(client, app):
    headers = _admin_headers(client, app)

    response = client.get('/api/olt/devices/OLT-ZTE-001/remote-options', headers=headers)
    assert response.status_code == 200
    payload = response.get_json()

    assert payload['success'] is True
    assert payload['device']['id'] == 'OLT-ZTE-001'
    assert 'direct_login' in payload['options']
    assert 'recommendations' in payload['options']
    assert 'readiness' in payload
    assert isinstance(payload['readiness'].get('checks'), list)
    assert 'grafana' in payload
