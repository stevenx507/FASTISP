from app import db
from app.models import User


def test_platform_bootstrap_status_allows_first_setup(client, app):
    with app.app_context():
        app.config['PLATFORM_BOOTSTRAP_TOKEN'] = 'bootstrap-secret'

    response = client.get('/api/platform/bootstrap/status')
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['master_context'] is True
    assert payload['token_configured'] is True
    assert payload['platform_admin_exists'] is False
    assert payload['bootstrap_allowed'] is True


def test_platform_bootstrap_creates_first_platform_admin(client, app):
    with app.app_context():
        app.config['PLATFORM_BOOTSTRAP_TOKEN'] = 'bootstrap-secret'

    create_response = client.post(
        '/api/platform/bootstrap',
        json={
            'token': 'bootstrap-secret',
            'name': 'Root Platform',
            'email': 'root@platform.local',
            'password': 'SuperSecure123',
        },
    )
    assert create_response.status_code == 201
    create_payload = create_response.get_json()
    assert create_payload['success'] is True
    assert create_payload['user']['role'] == 'platform_admin'

    second_response = client.post(
        '/api/platform/bootstrap',
        json={
            'token': 'bootstrap-secret',
            'name': 'Another Root',
            'email': 'root2@platform.local',
            'password': 'SuperSecure123',
        },
    )
    assert second_response.status_code == 409

    status_response = client.get('/api/platform/bootstrap/status')
    status_payload = status_response.get_json()
    assert status_payload['platform_admin_exists'] is True
    assert status_payload['bootstrap_allowed'] is False

    with app.app_context():
        created = User.query.filter_by(email='root@platform.local').first()
        assert created is not None
        assert created.role == 'platform_admin'


def test_platform_bootstrap_rejects_invalid_token(client, app):
    with app.app_context():
        app.config['PLATFORM_BOOTSTRAP_TOKEN'] = 'bootstrap-secret'

    response = client.post(
        '/api/platform/bootstrap',
        json={
            'token': 'wrong-token',
            'name': 'Root Platform',
            'email': 'root@platform.local',
            'password': 'SuperSecure123',
        },
    )
    assert response.status_code == 403


def test_platform_bootstrap_rejects_tenant_scoped_context(client, app):
    with app.app_context():
        app.config['PLATFORM_BOOTSTRAP_TOKEN'] = 'bootstrap-secret'

    response = client.post(
        '/api/platform/bootstrap',
        json={
            'token': 'bootstrap-secret',
            'name': 'Root Platform',
            'email': 'root@platform.local',
            'password': 'SuperSecure123',
        },
        headers={'X-Tenant-ID': '44'},
    )
    assert response.status_code == 403
