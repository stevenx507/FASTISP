from datetime import date, timedelta

from flask_jwt_extended import create_access_token

from app import db
from app.models import Client, Invoice, Plan, Subscription, User
import app.routes.main_routes as main_routes


def _auth_headers(app, user_id: int):
    with app.app_context():
        token = create_access_token(identity=str(user_id))
    return {"Authorization": f"Bearer {token}"}


def test_dashboard_stats_without_telemetry_is_deterministic(client, app):
    with app.app_context():
        user = User(email="client-stats@test.local", role="client", name="Client Stats")
        user.set_password("supersecret")
        db.session.add(user)
        db.session.flush()

        plan = Plan(name="Fibra 100", download_speed=100, upload_speed=20, price=49.9)
        db.session.add(plan)
        db.session.flush()

        customer = Client(
            full_name="Cliente Dashboard",
            user_id=user.id,
            plan_id=plan.id,
            connection_type="pppoe",
            pppoe_username="client_stats",
        )
        db.session.add(customer)
        db.session.flush()

        sub = Subscription(
            customer=customer.full_name,
            email=user.email,
            plan="Mensual",
            cycle_months=1,
            amount=59.0,
            status="active",
            currency="USD",
            next_charge=date.today() + timedelta(days=5),
            method="manual",
            client_id=customer.id,
        )
        db.session.add(sub)
        db.session.flush()

        inv = Invoice(
            subscription_id=sub.id,
            amount=59.0,
            currency="USD",
            tax_percent=18.0,
            total_amount=69.62,
            status="pending",
            due_date=date.today() + timedelta(days=5),
        )
        db.session.add(inv)
        db.session.commit()

        user_id = user.id

    response = client.get("/api/dashboard/stats", headers=_auth_headers(app, user_id))
    assert response.status_code == 200

    payload = response.get_json()
    assert payload["currentSpeed"] == "0.0/0.0 Mbps"
    assert payload["ping"] == "0.0 ms"
    assert payload["monthlyUsage"] == "0%"
    assert payload["nextBillAmount"] == "69.62 USD"
    assert isinstance(payload["nextBillDue"], str)
    assert payload["deviceCount"] == 0


def test_usage_history_fallback_returns_zeroes(client, app, monkeypatch):
    class BrokenMonitoringService:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("influx offline")

    monkeypatch.setattr(main_routes, "MonitoringService", BrokenMonitoringService)

    with app.app_context():
        user = User(email="client-usage@test.local", role="client", name="Client Usage")
        user.set_password("supersecret")
        db.session.add(user)
        db.session.flush()

        customer = Client(full_name="Cliente Uso", user_id=user.id, connection_type="dhcp")
        db.session.add(customer)
        db.session.commit()

        user_id = user.id

    response = client.get("/api/clients/usage-history?range=7d", headers=_auth_headers(app, user_id))
    assert response.status_code == 200

    payload = response.get_json()
    dataset = payload["datasets"][0]["data"]
    assert len(payload["labels"]) == 7
    assert len(dataset) == 7
    assert all(value == 0.0 for value in dataset)


def test_client_diagnostics_reports_down_session_without_router(client, app):
    with app.app_context():
        user = User(email="client-diag@test.local", role="client", name="Client Diag")
        user.set_password("supersecret")
        db.session.add(user)
        db.session.flush()

        customer = Client(
            full_name="Cliente Diagnostico",
            user_id=user.id,
            connection_type="pppoe",
            pppoe_username="diag_pppoe",
        )
        db.session.add(customer)
        db.session.commit()

        user_id = user.id

    response = client.post("/api/client/diagnostics/run", headers=_auth_headers(app, user_id))
    assert response.status_code == 200

    payload = response.get_json()
    assert payload["pppoe_session"] == "down"
    assert payload["ping_gateway_ms"] >= 0
    assert payload["ping_internet_ms"] >= 0
    assert isinstance(payload["recommendations"], list)
    assert payload["recommendations"]


def test_client_history_returns_operational_timeline(client, app):
    with app.app_context():
        admin = User(email="history-admin@test.local", role="admin", name="History Admin")
        admin.set_password("supersecret")
        db.session.add(admin)
        db.session.flush()

        customer_user = User(email="history-client@test.local", role="client", name="History Client")
        customer_user.set_password("supersecret")
        db.session.add(customer_user)
        db.session.flush()

        customer = Client(full_name="Cliente Historial", user_id=customer_user.id, connection_type="dhcp")
        db.session.add(customer)
        db.session.commit()

        admin_id = admin.id
        client_id = customer.id

    response = client.get(f"/api/clients/{client_id}/history", headers=_auth_headers(app, admin_id))
    assert response.status_code == 200

    payload = response.get_json()
    assert isinstance(payload, list)
    assert payload
    assert all("message" in item and "timestamp" in item for item in payload)
