from app import db
from app.models import User


def test_password_forgot_and_reset_flow(client, app):
    with app.app_context():
        user = User(email='reset-flow@test.local', role='client', name='Reset Flow')
        user.set_password('old-password-123')
        db.session.add(user)
        db.session.commit()

    forgot_response = client.post(
        '/api/auth/password/forgot',
        json={'email': 'reset-flow@test.local'},
    )
    assert forgot_response.status_code == 200
    forgot_payload = forgot_response.get_json()
    assert forgot_payload['success'] is True
    assert forgot_payload.get('reset_token')

    reset_response = client.post(
        '/api/auth/password/reset',
        json={'token': forgot_payload['reset_token'], 'new_password': 'new-password-123'},
    )
    assert reset_response.status_code == 200
    assert reset_response.get_json()['success'] is True

    login_response = client.post(
        '/api/auth/login',
        json={'email': 'reset-flow@test.local', 'password': 'new-password-123'},
    )
    assert login_response.status_code == 200
    assert login_response.get_json().get('token')


def test_password_forgot_does_not_disclose_unknown_email(client):
    response = client.post(
        '/api/auth/password/forgot',
        json={'email': 'missing-user@test.local'},
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert 'reset_token' not in payload


def test_password_reset_rejects_invalid_or_reused_token(client, app):
    with app.app_context():
        user = User(email='reset-invalid@test.local', role='client', name='Reset Invalid')
        user.set_password('old-password-123')
        db.session.add(user)
        db.session.commit()

    invalid_response = client.post(
        '/api/auth/password/reset',
        json={'token': 'not-a-real-token', 'new_password': 'new-password-123'},
    )
    assert invalid_response.status_code == 400

    forgot_response = client.post(
        '/api/auth/password/forgot',
        json={'email': 'reset-invalid@test.local'},
    )
    token = forgot_response.get_json()['reset_token']

    first_reset = client.post(
        '/api/auth/password/reset',
        json={'token': token, 'new_password': 'new-password-123'},
    )
    assert first_reset.status_code == 200

    second_reset = client.post(
        '/api/auth/password/reset',
        json={'token': token, 'new_password': 'another-password-123'},
    )
    assert second_reset.status_code == 400
