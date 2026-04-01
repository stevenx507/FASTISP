from datetime import date, timedelta

from flask_jwt_extended import create_access_token

from app import db
from app.models import Invoice, MikroTikRouter, PaymentRecord, Subscription, Tenant, User


def _admin_token(app, email: str) -> str:
    with app.app_context():
        user = User(email=email, role='admin', name='Admin Jobs')
        user.set_password('adminpass123')
        db.session.add(user)
        db.session.commit()
        return create_access_token(identity=str(user.id))


def test_system_job_recalc_balances_updates_invoice_status(client, app):
    token = _admin_token(app, 'jobs-admin-1@test.local')

    with app.app_context():
        subscription = Subscription(
            customer='Balance Customer',
            email='balance@test.local',
            plan='Mensual',
            cycle_months=1,
            amount=45.0,
            status='active',
            currency='USD',
            next_charge=date.today(),
            method='manual',
        )
        db.session.add(subscription)
        db.session.flush()

        invoice = Invoice(
            subscription_id=subscription.id,
            amount=45.0,
            currency='USD',
            tax_percent=0,
            total_amount=45.0,
            status='pending',
            due_date=date.today(),
        )
        db.session.add(invoice)
        db.session.flush()

        payment = PaymentRecord(
            invoice_id=invoice.id,
            method='manual',
            reference='job-recalc-paid',
            amount=45.0,
            currency='USD',
            status='paid',
        )
        db.session.add(payment)
        db.session.commit()
        invoice_id = invoice.id

    response = client.post(
        '/api/admin/system/jobs/run',
        json={'job': 'recalc_balances'},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['job']['status'] == 'completed'
    assert payload['job']['result']['updated'] >= 1

    with app.app_context():
        updated_invoice = db.session.get(Invoice, invoice_id)
        assert updated_invoice is not None
        assert updated_invoice.status == 'paid'


def test_ops_run_job_rotate_passwords_returns_skipped_status(client, app):
    token = _admin_token(app, 'jobs-admin-2@test.local')

    response = client.post(
        '/api/ops/run-job',
        json={'job': 'rotate_passwords'},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['job']['status'] == 'skipped'
    assert 'message' in payload['job']['result']


def test_system_jobs_history_includes_finished_result(client, app):
    token = _admin_token(app, 'jobs-admin-3@test.local')

    run_response = client.post(
        '/api/admin/system/jobs/run',
        json={'job': 'rotate_passwords'},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert run_response.status_code == 200

    history_response = client.get(
        '/api/admin/system/jobs/history?limit=5',
        headers={'Authorization': f'Bearer {token}'},
    )
    assert history_response.status_code == 200
    payload = history_response.get_json()
    assert payload['count'] >= 1
    assert payload['items'][0]['job'] == 'rotate_passwords'
    assert payload['items'][0]['status'] == 'skipped'
    assert 'finished_at' in payload['items'][0]
    assert isinstance(payload['items'][0].get('result'), dict)


def test_rotate_passwords_updates_router_credentials(client, app, monkeypatch):
    token = _admin_token(app, 'jobs-admin-rotate@test.local')

    with app.app_context():
        router = MikroTikRouter(
            name='RTR-ROTATE-1',
            ip_address='10.20.30.40',
            username='admin',
            is_active=True,
        )
        router.password = 'OldRouterPass#123'
        db.session.add(router)
        db.session.commit()
        router_id = router.id

    app.config['ROTATE_PASSWORDS_DRY_RUN'] = False
    app.config['PASSWORD_ROTATION_LENGTH'] = 20
    monkeypatch.setattr(
        'app.routes.main_routes._generate_router_password',
        lambda _length=None: 'NewRouterPass#456',
    )

    calls = []

    class _FakeMikroTikService:
        def __init__(self, rid):
            self.rid = rid

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def rotate_api_password(self, username, new_password):
            calls.append((self.rid, username, new_password))
            return {"success": True, "username": username}

    monkeypatch.setattr('app.routes.main_routes.MikroTikService', _FakeMikroTikService)

    response = client.post(
        '/api/admin/system/jobs/run',
        json={'job': 'rotate_passwords'},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['job']['status'] == 'completed'
    assert payload['job']['result']['rotated'] == 1
    assert payload['job']['result']['failed'] == 0
    assert payload['job']['result']['dry_run'] is False
    assert calls == [(router_id, 'admin', 'NewRouterPass#456')]

    with app.app_context():
        updated = db.session.get(MikroTikRouter, router_id)
        assert updated is not None
        assert updated.password == 'NewRouterPass#456'


def test_rotate_passwords_dry_run_does_not_change_password(client, app, monkeypatch):
    token = _admin_token(app, 'jobs-admin-dryrun@test.local')

    with app.app_context():
        router = MikroTikRouter(
            name='RTR-ROTATE-2',
            ip_address='10.20.30.41',
            username='admin',
            is_active=True,
        )
        router.password = 'KeepThisPass#123'
        db.session.add(router)
        db.session.commit()
        router_id = router.id

    app.config['ROTATE_PASSWORDS_DRY_RUN'] = True
    monkeypatch.setattr(
        'app.routes.main_routes._generate_router_password',
        lambda _length=None: 'DryRunRouter#789',
    )

    class _FailIfCalledService:
        def __init__(self, _rid):
            raise AssertionError('MikroTikService no debe llamarse en dry_run')

    monkeypatch.setattr('app.routes.main_routes.MikroTikService', _FailIfCalledService)

    response = client.post(
        '/api/ops/run-job',
        json={'job': 'rotate_passwords'},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['job']['status'] == 'skipped'
    assert payload['job']['result']['dry_run'] is True
    assert payload['job']['result']['rotated'] == 1
    assert payload['job']['result']['failed'] == 0

    with app.app_context():
        updated = db.session.get(MikroTikRouter, router_id)
        assert updated is not None
        assert updated.password == 'KeepThisPass#123'


def test_system_jobs_history_supports_filters_and_offset(client, app):
    token = _admin_token(app, 'jobs-admin-history-filter@test.local')

    first = client.post(
        '/api/admin/system/jobs/run',
        json={'job': 'rotate_passwords'},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert first.status_code == 200

    second = client.post(
        '/api/admin/system/jobs/run',
        json={'job': 'recalc_balances'},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert second.status_code == 200

    filtered = client.get(
        '/api/admin/system/jobs/history?status=skipped&job=rotate_passwords&limit=5',
        headers={'Authorization': f'Bearer {token}'},
    )
    assert filtered.status_code == 200
    filtered_payload = filtered.get_json()
    assert filtered_payload['total'] >= 1
    assert filtered_payload['count'] >= 1
    assert filtered_payload['items'][0]['job'] == 'rotate_passwords'
    assert filtered_payload['items'][0]['status'] == 'skipped'

    paged = client.get(
        '/api/admin/system/jobs/history?limit=1&offset=1',
        headers={'Authorization': f'Bearer {token}'},
    )
    assert paged.status_code == 200
    paged_payload = paged.get_json()
    assert paged_payload['limit'] == 1
    assert paged_payload['offset'] == 1
    assert paged_payload['count'] <= 1


def test_cleanup_leases_job_is_scoped_to_current_tenant(client, app):
    with app.app_context():
        tenant_a = Tenant(slug='tenant-a', name='Tenant A')
        tenant_b = Tenant(slug='tenant-b', name='Tenant B')
        db.session.add_all([tenant_a, tenant_b])
        db.session.flush()

        admin = User(email='tenant-cleanup-admin@test.local', role='admin', name='Tenant Cleanup', tenant_id=tenant_a.id)
        admin.set_password('adminpass123')
        db.session.add(admin)
        db.session.flush()

        sub_a = Subscription(
            customer='Tenant A Customer',
            email='a@example.com',
            plan='Mensual',
            cycle_months=1,
            amount=30.0,
            status='active',
            currency='USD',
            next_charge=date.today() - timedelta(days=1),
            method='manual',
            tenant_id=tenant_a.id,
        )
        sub_b = Subscription(
            customer='Tenant B Customer',
            email='b@example.com',
            plan='Mensual',
            cycle_months=1,
            amount=30.0,
            status='active',
            currency='USD',
            next_charge=date.today() - timedelta(days=1),
            method='manual',
            tenant_id=tenant_b.id,
        )
        db.session.add_all([sub_a, sub_b])
        db.session.commit()

        token = create_access_token(identity=str(admin.id), additional_claims={'tenant_id': tenant_a.id})
        sub_a_id = sub_a.id
        sub_b_id = sub_b.id
        tenant_a_id = tenant_a.id

    response = client.post(
        '/api/admin/system/jobs/run',
        json={'job': 'cleanup_leases'},
        headers={'Authorization': f'Bearer {token}', 'X-Tenant-ID': str(tenant_a_id)},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['job']['status'] == 'completed'
    assert payload['job']['result']['tenant_id'] == tenant_a_id
    assert payload['job']['result']['updated'] >= 1

    with app.app_context():
        updated_a = db.session.get(Subscription, sub_a_id)
        updated_b = db.session.get(Subscription, sub_b_id)
        assert updated_a is not None
        assert updated_b is not None
        assert updated_a.status == 'past_due'
        assert updated_b.status == 'active'
