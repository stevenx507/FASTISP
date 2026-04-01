from datetime import date, datetime, timedelta

from flask_jwt_extended import create_access_token

from app import db
from app.models import AdminInstallation, AdminSystemSetting, BillingPromise, Invoice, MikroTikRouter, Subscription, User


def _create_user(app, email: str, role: str, name: str = 'User') -> tuple[User, str]:
    with app.app_context():
        user = User(email=email, role=role, name=name)
        user.set_password('pass123456')
        db.session.add(user)
        db.session.commit()
        token = create_access_token(identity=str(user.id))
        return user, token


def _auth(token: str) -> dict:
    return {'Authorization': f'Bearer {token}'}


def test_installation_is_persisted_in_database(client, app):
    _, token = _create_user(app, 'admin-persist-install@test.local', 'admin', 'Admin Persist')

    response = client.post(
        '/api/admin/installations',
        json={'client_name': 'Persist Cliente', 'status': 'scheduled'},
        headers=_auth(token),
    )
    assert response.status_code == 201
    installation_id = response.get_json()['installation']['id']

    with app.app_context():
        row = db.session.get(AdminInstallation, installation_id)
        assert row is not None
        assert row.client_name == 'Persist Cliente'
        assert row.status == 'scheduled'


def test_system_settings_are_persisted_in_database(client, app):
    _, token = _create_user(app, 'admin-settings-db@test.local', 'admin', 'Admin Settings')

    post_response = client.post(
        '/api/admin/system/settings',
        json={'settings': {'auto_suspend_overdue': False, 'backup_retention_days': 21}},
        headers=_auth(token),
    )
    assert post_response.status_code == 200

    get_response = client.get('/api/admin/system/settings', headers=_auth(token))
    assert get_response.status_code == 200
    payload = get_response.get_json()
    assert payload['settings']['auto_suspend_overdue'] is False
    assert payload['settings']['backup_retention_days'] == 21

    with app.app_context():
        auto_suspend = (
            AdminSystemSetting.query
            .filter_by(tenant_id=None, key='auto_suspend_overdue')
            .first()
        )
        retention = (
            AdminSystemSetting.query
            .filter_by(tenant_id=None, key='backup_retention_days')
            .first()
        )
        assert auto_suspend is not None
        assert auto_suspend.value is False
        assert retention is not None
        assert retention.value == 21


def test_permissions_override_can_block_staff_access(client, app):
    _, admin_token = _create_user(app, 'admin-perm-owner@test.local', 'admin', 'Admin Perm')
    _, tech_token = _create_user(app, 'tech-perm-user@test.local', 'tech', 'Tech Perm')

    baseline = client.get('/api/admin/installations', headers=_auth(tech_token))
    assert baseline.status_code == 200

    deny_response = client.post(
        '/api/admin/permissions',
        json={'role': 'tech', 'permission': 'installations.read', 'allowed': False},
        headers=_auth(admin_token),
    )
    assert deny_response.status_code == 200

    blocked = client.get('/api/admin/installations', headers=_auth(tech_token))
    assert blocked.status_code == 403
    assert 'Permiso insuficiente' in blocked.get_json()['error']


def test_enforce_billing_honors_pending_payment_promises(client, app):
    _, token = _create_user(app, 'admin-promise-job@test.local', 'admin', 'Admin Promise')

    with app.app_context():
        subscription = Subscription(
            customer='Cliente Promesa',
            email='cliente.promesa@test.local',
            plan='Mensual',
            cycle_months=1,
            amount=32.0,
            status='active',
            currency='USD',
            next_charge=date.today() - timedelta(days=2),
            method='manual',
        )
        db.session.add(subscription)
        db.session.flush()

        invoice = Invoice(
            subscription_id=subscription.id,
            amount=32.0,
            currency='USD',
            tax_percent=0,
            total_amount=32.0,
            status='pending',
            due_date=date.today() - timedelta(days=1),
        )
        db.session.add(invoice)
        db.session.commit()
        subscription_id = subscription.id

    promise_response = client.post(
        '/api/admin/billing/promises',
        json={
            'subscription_id': subscription_id,
            'promised_amount': 32.0,
            'promised_date': (date.today() + timedelta(days=2)).isoformat(),
            'notes': 'Pago en dos dias',
        },
        headers=_auth(token),
    )
    assert promise_response.status_code == 201

    run_response = client.post(
        '/api/admin/system/jobs/run',
        json={'job': 'enforce_billing'},
        headers=_auth(token),
    )
    assert run_response.status_code == 200
    payload = run_response.get_json()
    assert payload['job']['status'] == 'completed'
    assert payload['job']['result']['skipped_by_promise'] >= 1

    with app.app_context():
        updated = db.session.get(Subscription, subscription_id)
        assert updated is not None
        assert updated.status == 'past_due'
        pending_promises = BillingPromise.query.filter_by(subscription_id=subscription_id, status='pending').count()
        assert pending_promises >= 1


def test_maintenance_windows_can_silence_router_alerts(client, app):
    _, token = _create_user(app, 'admin-maintenance@test.local', 'admin', 'Admin NOC')

    with app.app_context():
        router = MikroTikRouter(
            name='Router Caido',
            ip_address='10.10.10.10',
            username='admin',
            is_active=False,
        )
        router.password = 'Secret#Router01'
        db.session.add(router)
        db.session.commit()

    baseline = client.get('/api/network/alerts', headers=_auth(token))
    assert baseline.status_code == 200
    baseline_payload = baseline.get_json()
    assert any(alert['severity'] == 'critical' for alert in baseline_payload['alerts'])

    now = datetime.utcnow().replace(microsecond=0)
    create_window = client.post(
        '/api/admin/network/maintenance',
        json={
            'title': 'Mantenimiento Router',
            'scope': 'router',
            'starts_at': (now - timedelta(minutes=5)).isoformat(),
            'ends_at': (now + timedelta(minutes=30)).isoformat(),
            'mute_alerts': True,
        },
        headers=_auth(token),
    )
    assert create_window.status_code == 201

    muted = client.get('/api/network/alerts', headers=_auth(token))
    assert muted.status_code == 200
    muted_payload = muted.get_json()
    assert muted_payload['alerts'][0]['severity'] == 'info'
    assert 'mantenimiento' in muted_payload['alerts'][0]['message'].lower()
