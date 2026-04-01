from datetime import date
import hashlib
import hmac
import json
import time

from flask_jwt_extended import create_access_token, decode_token

from app import db
from app.models import Client, Invoice, PaymentRecord, Subscription, Tenant, User


def _token_for_user(app, user_id: int) -> str:
    with app.app_context():
        return create_access_token(identity=str(user_id))


def _stripe_signature(payload: str, secret: str, timestamp: int | None = None) -> str:
    ts = timestamp or int(time.time())
    signed_payload = f"{ts}.{payload}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={signature}"


def test_health_endpoint(client):
    response = client.get('/health')

    assert response.status_code == 200
    payload = response.get_json()
    assert payload == {'status': 'healthy', 'service': 'ispmax-backend'}


def test_versioned_api_health_endpoint(client):
    response = client.get('/api/v1/health')
    assert response.status_code == 200
    payload = response.get_json()
    assert payload == {'status': 'healthy', 'service': 'ispmax-backend-api'}


def test_login_success_returns_token_and_user(client, app):
    with app.app_context():
        tenant = Tenant(slug='isp-a', name='ISP A')
        db.session.add(tenant)
        db.session.flush()

        user = User(email='admin@test.local', role='admin', name='Admin Test', tenant_id=tenant.id)
        user.set_password('supersecret')
        db.session.add(user)
        db.session.commit()

    response = client.post(
        '/api/auth/login',
        json={'email': 'admin@test.local', 'password': 'supersecret'},
        headers={'X-Tenant-ID': '1'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert 'token' in payload
    assert payload['user']['email'] == 'admin@test.local'
    assert payload['user']['role'] == 'admin'
    with app.app_context():
        claims = decode_token(payload['token'])
    assert claims.get('tenant_id') == 1


def test_v1_login_alias_works(client, app):
    with app.app_context():
        user = User(email='v1@test.local', role='admin', name='V1 Admin')
        user.set_password('supersecret')
        db.session.add(user)
        db.session.commit()

    response = client.post(
        '/api/v1/auth/login',
        json={'email': 'v1@test.local', 'password': 'supersecret'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert 'token' in payload


def test_login_rejects_invalid_credentials(client):
    response = client.post(
        '/api/auth/login',
        json={'email': 'missing@test.local', 'password': 'bad-password'},
    )

    assert response.status_code == 401
    payload = response.get_json()
    assert payload['error'] == 'Credenciales incorrectas.'


def test_login_requires_email_and_password(client):
    response = client.post('/api/auth/login', json={'email': ''})

    assert response.status_code == 400
    payload = response.get_json()
    assert payload['error'] == 'Email y contrasena son requeridos.'


def test_login_rejects_tenant_mismatch(client, app):
    with app.app_context():
        tenant = Tenant(slug='isp-b', name='ISP B')
        db.session.add(tenant)
        db.session.flush()
        user = User(email='tenant@test.local', role='admin', name='Tenant Admin', tenant_id=tenant.id)
        user.set_password('supersecret')
        db.session.add(user)
        db.session.commit()

    response = client.post(
        '/api/auth/login',
        json={'email': 'tenant@test.local', 'password': 'supersecret'},
        headers={'X-Tenant-ID': '999'},
    )

    assert response.status_code == 401


def test_update_password_success(client, app):
    with app.app_context():
        user = User(email='password@test.local', role='admin', name='Password Admin')
        user.set_password('oldpassword123')
        db.session.add(user)
        db.session.commit()
        user_id = user.id

    with app.app_context():
        auth_token = create_access_token(identity=str(user_id))

    response = client.post(
        '/api/auth/password',
        json={'current_password': 'oldpassword123', 'new_password': 'newpassword123'},
        headers={'Authorization': f'Bearer {auth_token}'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True

    with app.app_context():
        updated = db.session.get(User, user_id)
        assert updated is not None
        assert updated.check_password('newpassword123')


def test_update_password_rejects_wrong_current_password(client, app):
    with app.app_context():
        user = User(email='password-fail@test.local', role='admin', name='Password Fail')
        user.set_password('correctpassword')
        db.session.add(user)
        db.session.commit()
        user_id = user.id
        auth_token = create_access_token(identity=str(user_id))

    response = client.post(
        '/api/auth/password',
        json={'current_password': 'wrongpassword', 'new_password': 'anothernewpassword'},
        headers={'Authorization': f'Bearer {auth_token}'},
    )

    assert response.status_code == 400
    payload = response.get_json()
    assert 'incorrecta' in payload['error']


def test_clients_map_data_requires_authenticated_staff(client):
    response = client.get('/api/clients/map-data')
    assert response.status_code == 401


def test_clients_map_data_rejects_client_role(client, app):
    with app.app_context():
        user = User(email='portal-client@test.local', role='client', name='Portal Client')
        user.set_password('clientpass123')
        db.session.add(user)
        db.session.commit()
        token = _token_for_user(app, user.id)

    response = client.get('/api/clients/map-data', headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == 403


def test_notifications_endpoint_returns_client_feed(client, app):
    with app.app_context():
        user = User(email='notif-client@test.local', role='client', name='Notif Client')
        user.set_password('clientpass123')
        db.session.add(user)
        db.session.commit()
        token = _token_for_user(app, user.id)

    response = client.get('/api/notifications', headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['count'] >= 1
    assert isinstance(payload['notifications'], list)


def test_stripe_checkout_requires_configured_secret(client, app):
    with app.app_context():
        user = User(email='payment-client@test.local', role='client', name='Payment Client')
        user.set_password('clientpass123')
        db.session.add(user)
        db.session.flush()

        customer = Client(full_name='Payment Customer', user_id=user.id, connection_type='dhcp')
        db.session.add(customer)
        db.session.flush()

        subscription = Subscription(
            customer=customer.full_name,
            email=user.email,
            plan='Mensual',
            cycle_months=1,
            amount=25.0,
            status='active',
            currency='USD',
            next_charge=date.today(),
            method='manual',
            client_id=customer.id,
        )
        db.session.add(subscription)
        db.session.flush()

        invoice = Invoice(
            subscription_id=subscription.id,
            amount=25.0,
            currency='USD',
            tax_percent=0,
            total_amount=25.0,
            status='pending',
            due_date=date.today(),
        )
        db.session.add(invoice)
        db.session.commit()
        token = _token_for_user(app, user.id)
        invoice_id = invoice.id

    response = client.post(
        '/api/payments/checkout',
        json={'amount': 25.0, 'currency': 'USD', 'method': 'stripe', 'invoice_id': invoice_id},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 503
    payload = response.get_json()
    assert 'Stripe no configurado' in payload['error']


def test_checkout_rejects_invoice_from_another_client(client, app):
    with app.app_context():
        owner = User(email='invoice-owner@test.local', role='client', name='Invoice Owner')
        owner.set_password('ownerpass123')
        db.session.add(owner)
        db.session.flush()

        owner_client = Client(full_name='Owner Customer', user_id=owner.id, connection_type='dhcp')
        db.session.add(owner_client)
        db.session.flush()

        owner_sub = Subscription(
            customer=owner_client.full_name,
            email=owner.email,
            plan='Mensual',
            cycle_months=1,
            amount=30.0,
            status='active',
            currency='USD',
            next_charge=date.today(),
            method='manual',
            client_id=owner_client.id,
        )
        db.session.add(owner_sub)
        db.session.flush()

        owner_invoice = Invoice(
            subscription_id=owner_sub.id,
            amount=30.0,
            currency='USD',
            tax_percent=0,
            total_amount=30.0,
            status='pending',
            due_date=date.today(),
        )
        db.session.add(owner_invoice)

        outsider = User(email='outsider@test.local', role='client', name='Outsider')
        outsider.set_password('outsiderpass123')
        db.session.add(outsider)
        db.session.flush()

        outsider_client = Client(full_name='Outsider Customer', user_id=outsider.id, connection_type='dhcp')
        db.session.add(outsider_client)
        db.session.commit()

        outsider_token = _token_for_user(app, outsider.id)
        owner_invoice_id = owner_invoice.id

    response = client.post(
        '/api/payments/checkout',
        json={'amount': 30.0, 'currency': 'USD', 'method': 'stripe', 'invoice_id': owner_invoice_id},
        headers={'Authorization': f'Bearer {outsider_token}'},
    )

    assert response.status_code == 403
    payload = response.get_json()
    assert 'permiso' in payload['error']


def test_checkout_requires_invoice_id_for_stripe(client, app):
    with app.app_context():
        user = User(email='invoice-required@test.local', role='client', name='Invoice Required')
        user.set_password('requiredpass123')
        db.session.add(user)
        db.session.commit()
        token = _token_for_user(app, user.id)

    response = client.post(
        '/api/payments/checkout',
        json={'amount': 10.0, 'currency': 'USD', 'method': 'stripe'},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 400
    assert 'invoice_id' in response.get_json()['error']


def test_billing_electronic_status_requires_invoice_id(client, app):
    with app.app_context():
        user = User(email='billing-admin@test.local', role='admin', name='Billing Admin')
        user.set_password('adminpass123')
        db.session.add(user)
        db.session.commit()
        token = _token_for_user(app, user.id)

    missing_response = client.get(
        '/api/billing/electronic/status',
        headers={'Authorization': f'Bearer {token}'},
    )
    assert missing_response.status_code == 400

    not_found_response = client.get(
        '/api/billing/electronic/status?invoice_id=9999',
        headers={'Authorization': f'Bearer {token}'},
    )
    assert not_found_response.status_code == 404


def test_payments_webhook_requires_secret(client):
    payload = json.dumps({"id": "evt_missing_secret", "type": "checkout.session.completed"})
    response = client.post(
        '/api/payments/webhook',
        data=payload,
        content_type='application/json',
    )
    assert response.status_code == 503
    assert response.get_json()['success'] is False


def test_payments_webhook_rejects_invalid_signature(client, app):
    app.config['STRIPE_WEBHOOK_SECRET'] = 'whsec_test'
    payload = json.dumps({"id": "evt_invalid_sig", "type": "checkout.session.completed"})
    response = client.post(
        '/api/payments/webhook',
        data=payload,
        content_type='application/json',
        headers={'Stripe-Signature': 't=123,v1=deadbeef'},
    )
    assert response.status_code == 400
    assert 'invalida' in response.get_json()['error']


def test_payments_webhook_marks_invoice_paid_idempotently(client, app):
    secret = 'whsec_live_test'
    app.config['STRIPE_WEBHOOK_SECRET'] = secret

    with app.app_context():
        subscription = Subscription(
            customer='Webhook Customer',
            email='billing@webhook.test',
            plan='Mensual',
            cycle_months=1,
            amount=59.0,
            status='past_due',
            currency='USD',
            next_charge=date.today(),
            method='stripe',
        )
        db.session.add(subscription)
        db.session.flush()

        invoice = Invoice(
            subscription_id=subscription.id,
            amount=59.0,
            currency='USD',
            tax_percent=0,
            total_amount=59.0,
            status='pending',
            due_date=date.today(),
        )
        db.session.add(invoice)
        db.session.commit()
        invoice_id = invoice.id
        subscription_id = subscription.id

    event = {
        "id": "evt_checkout_paid",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_test_123",
                "payment_intent": "pi_test_123",
                "metadata": {
                    "invoice_id": str(invoice_id),
                    "subscription_id": str(subscription_id),
                },
            }
        },
    }
    payload = json.dumps(event, separators=(',', ':'))
    signature = _stripe_signature(payload, secret)

    first = client.post(
        '/api/payments/webhook',
        data=payload,
        content_type='application/json',
        headers={'Stripe-Signature': signature},
    )
    second = client.post(
        '/api/payments/webhook',
        data=payload,
        content_type='application/json',
        headers={'Stripe-Signature': signature},
    )

    assert first.status_code == 200
    assert second.status_code == 200

    with app.app_context():
        updated_invoice = db.session.get(Invoice, invoice_id)
        updated_subscription = db.session.get(Subscription, subscription_id)
        payment_records = PaymentRecord.query.filter_by(method='stripe', reference='pi_test_123').all()

        assert updated_invoice is not None
        assert updated_invoice.status == 'paid'
        assert updated_subscription is not None
        assert updated_subscription.status == 'active'
        assert len(payment_records) == 1

