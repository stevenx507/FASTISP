from datetime import date, timedelta

from flask_jwt_extended import create_access_token

from app import db
from app.models import Subscription, User


def _create_admin(app, email: str, name: str) -> tuple[int, str]:
    with app.app_context():
        admin = User(email=email, role='admin', name=name)
        admin.set_password('adminpass123')
        db.session.add(admin)
        db.session.commit()
        token = create_access_token(identity=str(admin.id))
        return admin.id, token


def _auth(token: str) -> dict:
    return {'Authorization': f'Bearer {token}'}


def test_installation_create_and_update_include_actor_metadata(client, app):
    admin_id, token = _create_admin(app, 'admin-meta-install@test.local', 'Admin Metadata')

    create_response = client.post(
        '/api/admin/installations',
        json={'client_name': 'Cliente Metadata', 'status': 'scheduled'},
        headers=_auth(token),
    )
    assert create_response.status_code == 201
    installation = create_response.get_json()['installation']
    installation_id = installation['id']

    assert installation['created_by'] == admin_id
    assert installation['updated_by'] == admin_id
    assert installation['created_by_name'] == 'Admin Metadata'
    assert installation['updated_by_name'] == 'Admin Metadata'
    assert installation['created_at'] is not None
    assert installation['updated_at'] is not None

    update_response = client.patch(
        f'/api/admin/installations/{installation_id}',
        json={'status': 'completed'},
        headers=_auth(token),
    )
    assert update_response.status_code == 200
    updated = update_response.get_json()['installation']
    assert updated['updated_by'] == admin_id
    assert updated['updated_by_name'] == 'Admin Metadata'
    assert updated['completed_by'] == admin_id
    assert updated['completed_by_name'] == 'Admin Metadata'
    assert updated['completed_at'] is not None


def test_extra_service_and_hotspot_creation_include_actor_metadata(client, app):
    admin_id, token = _create_admin(app, 'admin-meta-commercial@test.local', 'Admin Comercial')

    service_response = client.post(
        '/api/admin/extra-services',
        json={'name': 'Servicio Metadata', 'monthly_price': 7.5, 'status': 'active'},
        headers=_auth(token),
    )
    assert service_response.status_code == 201
    service = service_response.get_json()['service']
    assert service['created_by'] == admin_id
    assert service['updated_by'] == admin_id
    assert service['created_by_name'] == 'Admin Comercial'
    assert service['updated_by_name'] == 'Admin Comercial'
    assert service['created_at'] is not None

    vouchers_response = client.post(
        '/api/admin/hotspot/vouchers',
        json={'quantity': 1, 'profile': 'basic', 'duration_minutes': 60, 'price': 1.0},
        headers=_auth(token),
    )
    assert vouchers_response.status_code == 201
    item = vouchers_response.get_json()['items'][0]
    assert item['created_by'] == admin_id
    assert item['updated_by'] == admin_id
    assert item['created_by_name'] == 'Admin Comercial'
    assert item['updated_by_name'] == 'Admin Comercial'
    assert item['created_at'] is not None


def test_admin_audit_logs_returns_entries_with_actor_data(client, app):
    _, token = _create_admin(app, 'admin-audit-log@test.local', 'Admin Auditor')

    create_response = client.post(
        '/api/admin/installations',
        json={'client_name': 'Cliente Auditoria', 'status': 'scheduled'},
        headers=_auth(token),
    )
    assert create_response.status_code == 201

    logs_response = client.get(
        '/api/admin/audit-logs?action=installation_create&limit=5',
        headers=_auth(token),
    )
    assert logs_response.status_code == 200
    payload = logs_response.get_json()
    assert payload['count'] >= 1
    item = payload['items'][0]
    assert item['action'] == 'installation_create'
    assert item['user_name'] == 'Admin Auditor'
    assert item['user_email'] == 'admin-audit-log@test.local'
    assert item['created_at'] is not None


def test_enforce_billing_job_respects_auto_suspend_setting(client, app):
    _, token = _create_admin(app, 'admin-billing-job@test.local', 'Admin Billing')

    with app.app_context():
        subscription = Subscription(
            customer='Cliente Vencido',
            email='cliente-vencido@test.local',
            plan='Basico',
            cycle_months=1,
            amount=30.0,
            status='active',
            currency='USD',
            next_charge=date.today() - timedelta(days=3),
            method='manual',
        )
        db.session.add(subscription)
        db.session.commit()
        subscription_id = subscription.id

    disable_response = client.post(
        '/api/admin/system/settings',
        json={'settings': {'auto_suspend_overdue': False}},
        headers=_auth(token),
    )
    assert disable_response.status_code == 200

    skipped_job = client.post(
        '/api/admin/system/jobs/run',
        json={'job': 'enforce_billing'},
        headers=_auth(token),
    )
    assert skipped_job.status_code == 200
    skipped_payload = skipped_job.get_json()
    assert skipped_payload['success'] is True
    assert skipped_payload['job']['status'] == 'skipped'
    assert skipped_payload['job']['result']['auto_suspend_overdue'] is False

    with app.app_context():
        unchanged = db.session.get(Subscription, subscription_id)
        assert unchanged is not None
        assert unchanged.status == 'active'

    enable_response = client.post(
        '/api/admin/system/settings',
        json={'settings': {'auto_suspend_overdue': True}},
        headers=_auth(token),
    )
    assert enable_response.status_code == 200

    completed_job = client.post(
        '/api/admin/system/jobs/run',
        json={'job': 'enforce_billing'},
        headers=_auth(token),
    )
    assert completed_job.status_code == 200
    completed_payload = completed_job.get_json()
    assert completed_payload['success'] is True
    assert completed_payload['job']['status'] == 'completed'

    with app.app_context():
        updated = db.session.get(Subscription, subscription_id)
        assert updated is not None
        assert updated.status == 'past_due'
