from app import db
from app.models import User


def _admin_headers(client, app, email: str = 'ops-admin@test.local'):
    with app.app_context():
        user = User.query.filter_by(email=email).first()
        if user is None:
            user = User(email=email, role='admin', name='Ops Admin')
            user.set_password('Super$ecret123')
            db.session.add(user)
            db.session.commit()

    response = client.post(
        '/api/auth/login',
        json={'email': email, 'password': 'Super$ecret123'},
    )
    assert response.status_code == 200
    token = response.get_json()['token']
    return {'Authorization': f'Bearer {token}'}


def test_ops_sops_and_change_request_flow(client, app):
    headers = _admin_headers(client, app, email='ops-admin-flow@test.local')

    sops_response = client.get('/api/admin/ops/sops', headers=headers)
    assert sops_response.status_code == 200
    sops_payload = sops_response.get_json()
    assert isinstance(sops_payload.get('items'), list)

    create_response = client.post(
        '/api/admin/ops/change-requests',
        json={
            'title': 'Cambio controlado laboratorio',
            'scope': 'network',
            'risk_level': 'low',
            'ticket_ref': 'CHG-OPS-001',
            'status': 'requested',
        },
        headers=headers,
    )
    assert create_response.status_code == 201
    change_id = create_response.get_json()['item']['id']

    update_response = client.patch(
        f'/api/admin/ops/change-requests/{change_id}',
        json={'status': 'approved'},
        headers=headers,
    )
    assert update_response.status_code == 200
    updated_payload = update_response.get_json()
    assert updated_payload['item']['status'] == 'approved'


def test_ops_preflight_and_slo_summary(client, app):
    headers = _admin_headers(client, app, email='ops-admin-kpi@test.local')

    preflight_response = client.get('/api/admin/ops/preflight/summary', headers=headers)
    assert preflight_response.status_code == 200
    preflight_payload = preflight_response.get_json()
    assert 'score' in preflight_payload
    assert isinstance(preflight_payload.get('checks'), list)

    slo_response = client.get('/api/admin/ops/slo-summary', headers=headers)
    assert slo_response.status_code == 200
    slo_payload = slo_response.get_json()
    assert 'metrics' in slo_payload
    assert 'targets' in slo_payload
