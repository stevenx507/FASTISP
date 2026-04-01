from flask_jwt_extended import create_access_token

from app import db
from app.models import Client, Plan, Tenant, User


def _platform_token(app, user_id: int) -> str:
    with app.app_context():
        return create_access_token(identity=str(user_id), additional_claims={'tenant_id': None})


def test_platform_admin_can_access_admin_clients_when_tenant_selected(client, app):
    with app.app_context():
        tenant = Tenant(slug='isp-platform-mode', name='ISP Platform Mode')
        db.session.add(tenant)
        db.session.flush()

        plan = Plan(
            name='Plan Tenant',
            download_speed=100,
            upload_speed=20,
            price=35.0,
            tenant_id=tenant.id,
        )
        db.session.add(plan)
        db.session.flush()

        db.session.add(
            Client(
                full_name='Cliente Tenant',
                connection_type='dhcp',
                tenant_id=tenant.id,
                plan_id=plan.id,
            )
        )

        root = User(email='platform-mode@test.local', role='platform_admin', name='Platform Mode', tenant_id=None)
        root.set_password('supersecret')
        db.session.add(root)
        db.session.commit()

        root_id = root.id
        tenant_id = tenant.id

    token = _platform_token(app, root_id)
    response = client.get(
        '/api/admin/clients',
        headers={'Authorization': f'Bearer {token}', 'X-Tenant-ID': str(tenant_id)},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['count'] == 1
    assert payload['items'][0]['name'] == 'Cliente Tenant'


def test_platform_admin_admin_panel_requires_tenant_context(client, app):
    with app.app_context():
        root = User(email='platform-no-tenant@test.local', role='platform_admin', name='Platform No Tenant')
        root.set_password('supersecret')
        db.session.add(root)
        db.session.commit()
        root_id = root.id

    token = _platform_token(app, root_id)
    response = client.get('/api/admin/clients', headers={'Authorization': f'Bearer {token}'})

    assert response.status_code == 403
    assert 'seleccionar un tenant' in response.get_json()['error']


def test_platform_admin_can_use_staff_routes_when_tenant_selected(client, app):
    with app.app_context():
        tenant = Tenant(slug='isp-platform-staff', name='ISP Platform Staff')
        db.session.add(tenant)
        db.session.flush()

        db.session.add(
            Plan(
                name='Plan Staff',
                download_speed=60,
                upload_speed=10,
                price=19.9,
                tenant_id=tenant.id,
            )
        )

        root = User(email='platform-staff@test.local', role='platform_admin', name='Platform Staff')
        root.set_password('supersecret')
        db.session.add(root)
        db.session.commit()

        root_id = root.id
        tenant_id = tenant.id

    token = _platform_token(app, root_id)
    response = client.get(
        '/api/plans',
        headers={'Authorization': f'Bearer {token}', 'X-Tenant-ID': str(tenant_id)},
    )

    assert response.status_code == 200
    assert response.get_json()['count'] == 1
