from flask_jwt_extended import create_access_token

from app import db
from app.models import User


def _admin_token(app, email: str) -> str:
    with app.app_context():
        user = User(email=email, role='admin', name='Admin Settings')
        user.set_password('adminpass123')
        db.session.add(user)
        db.session.commit()
        return create_access_token(identity=str(user.id))


def test_system_settings_update_parses_boolean_strings(client, app):
    token = _admin_token(app, 'settings-admin-1@test.local')

    response = client.post(
        '/api/admin/system/settings',
        json={
            "settings": {
                "portal_maintenance_mode": "false",
                "auto_suspend_overdue": "1",
            }
        },
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['settings']['portal_maintenance_mode'] is False
    assert payload['settings']['auto_suspend_overdue'] is True


def test_system_settings_update_rejects_invalid_boolean_value(client, app):
    token = _admin_token(app, 'settings-admin-2@test.local')

    response = client.post(
        '/api/admin/system/settings',
        json={"settings": {"notifications_email_enabled": "maybe"}},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 400
    assert 'booleano' in response.get_json()['error']


def test_system_settings_update_rejects_invalid_or_out_of_range_integers(client, app):
    token = _admin_token(app, 'settings-admin-3@test.local')

    invalid_int = client.post(
        '/api/admin/system/settings',
        json={"settings": {"backup_retention_days": "abc"}},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert invalid_int.status_code == 400
    assert 'entero' in invalid_int.get_json()['error']

    out_of_range = client.post(
        '/api/admin/system/settings',
        json={"settings": {"metrics_poll_interval_sec": 5}},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert out_of_range.status_code == 400
    assert 'entre' in out_of_range.get_json()['error']


def test_system_settings_update_rejects_invalid_ticket_priority(client, app):
    token = _admin_token(app, 'settings-admin-4@test.local')

    response = client.post(
        '/api/admin/system/settings',
        json={"settings": {"default_ticket_priority": "critical"}},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 400
    assert 'default_ticket_priority' in response.get_json()['error']

