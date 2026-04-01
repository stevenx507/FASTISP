from flask_jwt_extended import create_access_token

from app import db
from app.models import Client, Plan, User


def _token_for_user(app, user_id: int) -> str:
    with app.app_context():
        return create_access_token(identity=str(user_id))


def _create_admin(app, email: str = 'admin-bool@test.local') -> tuple[User, str]:
    with app.app_context():
        user = User(email=email, role='admin', name='Admin Bool')
        user.set_password('adminpass123')
        db.session.add(user)
        db.session.commit()
        token = _token_for_user(app, user.id)
        return user, token


def test_change_plan_rejects_invalid_prorate_value(client, app):
    with app.app_context():
        admin = User(email='admin-prorate@test.local', role='admin', name='Admin Prorate')
        admin.set_password('adminpass123')
        db.session.add(admin)
        db.session.flush()

        customer = Client(full_name='Plan Customer', connection_type='dhcp')
        db.session.add(customer)
        db.session.flush()

        plan = Plan(name='Pro 100', download_speed=100, upload_speed=20, price=39.9)
        db.session.add(plan)
        db.session.commit()

        token = _token_for_user(app, admin.id)
        client_id = customer.id
        plan_id = plan.id

    response = client.post(
        f'/api/admin/clients/{client_id}/change_plan',
        json={'plan_id': plan_id, 'prorate': 'not-bool'},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 400
    assert 'prorate' in response.get_json()['error']


def test_client_notification_preferences_parse_boolean_strings(client, app):
    with app.app_context():
        user = User(email='prefs-bool@test.local', role='client', name='Prefs Bool')
        user.set_password('clientpass123')
        db.session.add(user)
        db.session.commit()
        token = _token_for_user(app, user.id)

    post_response = client.post(
        '/api/client/notifications/preferences',
        json={'email': 'false', 'whatsapp': '1', 'push': 'off'},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert post_response.status_code == 200
    post_payload = post_response.get_json()
    assert post_payload['preferences']['email'] is False
    assert post_payload['preferences']['whatsapp'] is True
    assert post_payload['preferences']['push'] is False

    get_response = client.get(
        '/api/client/notifications/preferences',
        headers={'Authorization': f'Bearer {token}'},
    )
    assert get_response.status_code == 200
    get_payload = get_response.get_json()
    assert get_payload['preferences'] == post_payload['preferences']


def test_client_notification_preferences_reject_invalid_boolean(client, app):
    with app.app_context():
        user = User(email='prefs-invalid@test.local', role='client', name='Prefs Invalid')
        user.set_password('clientpass123')
        db.session.add(user)
        db.session.commit()
        token = _token_for_user(app, user.id)

    response = client.post(
        '/api/client/notifications/preferences',
        json={'email': 'maybe'},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert response.status_code == 400
    assert 'booleano' in response.get_json()['error']


def test_admin_staff_create_rejects_invalid_mfa_enabled(client, app):
    _, token = _create_admin(app, email='admin-staff-create@test.local')

    response = client.post(
        '/api/admin/staff',
        json={
            'name': 'Tech One',
            'email': 'tech-one@test.local',
            'role': 'tech',
            'mfa_enabled': 'enabled-maybe',
        },
        headers={'Authorization': f'Bearer {token}'},
    )
    assert response.status_code == 400
    assert 'mfa_enabled' in response.get_json()['error']


def test_admin_staff_update_parses_string_false_for_mfa(client, app):
    _, token = _create_admin(app, email='admin-staff-update@test.local')

    with app.app_context():
        staff = User(
            email='staff-mfa@test.local',
            role='tech',
            name='Staff MFA',
            mfa_enabled=True,
            mfa_secret='BASE32SECRET',
        )
        staff.set_password('staffpass123')
        db.session.add(staff)
        db.session.commit()
        staff_id = staff.id

    response = client.patch(
        f'/api/admin/staff/{staff_id}',
        json={'mfa_enabled': 'false'},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert response.status_code == 200
    assert response.get_json()['staff']['mfa_enabled'] is False

    with app.app_context():
        updated = db.session.get(User, staff_id)
        assert updated is not None
        assert updated.mfa_enabled is False
        assert updated.mfa_secret is None


def test_installation_checklist_rejects_invalid_boolean_values(client, app):
    _, token = _create_admin(app, email='admin-installation@test.local')

    create_response = client.post(
        '/api/admin/installations',
        json={'client_name': 'Checklist Client', 'status': 'scheduled'},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert create_response.status_code == 201
    installation_id = create_response.get_json()['installation']['id']

    patch_response = client.patch(
        f'/api/admin/installations/{installation_id}',
        json={'checklist': {'onu_registered': 'not-bool'}},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert patch_response.status_code == 400
    assert 'checklist.onu_registered' in patch_response.get_json()['error']

