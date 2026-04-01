from datetime import datetime, timedelta
import os
import secrets

from app import db
from app.models import Client, MikroTikRouter, Plan, Subscription, Tenant, User


def seed_data():
    """Seeds the database with initial sample data."""

    print("Deleting old data...")
    db.session.query(Client).delete()
    db.session.query(User).delete()
    db.session.query(Plan).delete()
    db.session.query(MikroTikRouter).delete()
    db.session.query(Subscription).delete()
    db.session.query(Tenant).delete()
    print("Old data deleted.")

    print("Creating new sample data...")

    default_tenant = Tenant(slug="default", name="Default ISP Tenant")
    db.session.add(default_tenant)
    db.session.commit()
    print(f"Created tenant: {default_tenant.slug}")

    router1 = MikroTikRouter(
        name="Router Principal",
        ip_address="192.168.88.1",
        username="admin",
        password="your_router_password",
        api_port=8728,
        is_active=True,
        tenant_id=default_tenant.id,
    )
    router2 = MikroTikRouter(
        name="Nodo Secundario",
        ip_address="192.168.89.1",
        username="admin",
        password="your_router_password",
        api_port=8728,
        is_active=False,
        tenant_id=default_tenant.id,
    )
    db.session.add_all([router1, router2])
    db.session.commit()

    plan_basic = Plan(
        name="Basico 20M",
        download_speed=20,
        upload_speed=5,
        price=19.99,
        tenant_id=default_tenant.id,
    )
    plan_pro = Plan(
        name="Pro 50M",
        download_speed=50,
        upload_speed=10,
        price=29.99,
        tenant_id=default_tenant.id,
    )
    plan_gamer = Plan(
        name="Gamer 100M",
        download_speed=100,
        upload_speed=20,
        price=49.99,
        features={"gaming": True},
        tenant_id=default_tenant.id,
    )
    db.session.add_all([plan_basic, plan_pro, plan_gamer])
    db.session.commit()

    admin_password = secrets.token_urlsafe(12)
    platform_admin_password = secrets.token_urlsafe(12)
    client_1_password = secrets.token_urlsafe(12)
    client_2_password = secrets.token_urlsafe(12)

    create_platform_admin = str(os.environ.get("SEED_CREATE_PLATFORM_ADMIN", "true")).strip().lower() in {"1", "true", "yes", "on"}
    platform_admin_email = str(os.environ.get("SEED_PLATFORM_ADMIN_EMAIL", "platform@ispfast.local")).strip().lower() or "platform@ispfast.local"

    if create_platform_admin:
        platform_admin_user = User(
            name="Platform Admin",
            email=platform_admin_email,
            role="platform_admin",
            tenant_id=None,
        )
        platform_admin_user.set_password(platform_admin_password)
        db.session.add(platform_admin_user)

    admin_user = User(
        name="Admin Principal",
        email="admin@ispfast.local",
        role="admin",
        tenant_id=default_tenant.id,
    )
    admin_user.set_password(admin_password)
    db.session.add(admin_user)

    client_user_1 = User(
        name="Cliente Base",
        email="cliente@ispfast.local",
        role="client",
        tenant_id=default_tenant.id,
    )
    client_user_1.set_password(client_1_password)

    client_1 = Client(
        full_name="Juan Perez",
        ip_address="192.168.88.10",
        mac_address="00:1A:2B:3C:4D:5E",
        connection_type="dhcp",
        latitude=19.4326,
        longitude=-99.1332,
        user=client_user_1,
        plan=plan_gamer,
        router=router1,
        tenant_id=default_tenant.id,
    )
    db.session.add(client_user_1)
    db.session.add(client_1)

    client_user_2 = User(
        name="Ana Gomez",
        email="ana.gomez@example.com",
        role="client",
        tenant_id=default_tenant.id,
    )
    client_user_2.set_password(client_2_password)

    client_2 = Client(
        full_name="Ana Gomez",
        ip_address="192.168.88.11",
        mac_address="00:AA:BB:CC:DD:EE",
        connection_type="pppoe",
        pppoe_username="anag",
        pppoe_password="securepassword",
        latitude=19.4350,
        longitude=-99.1350,
        user=client_user_2,
        plan=plan_pro,
        router=router1,
        tenant_id=default_tenant.id,
    )
    db.session.add(client_user_2)
    db.session.add(client_2)

    # Subscriptions (SaaS)
    sub1 = Subscription(
        customer="ISP Norte",
        email="ops@ispnorte.pe",
        plan="Mensual",
        cycle_months=1,
        amount=120,
        status="active",
        next_charge=datetime.utcnow().date() + timedelta(days=15),
        method="Stripe",
        tenant_id=default_tenant.id,
    )
    sub2 = Subscription(
        customer="Fibra Andina",
        email="admin@fibraandina.pe",
        plan="Trimestral",
        cycle_months=3,
        amount=320,
        status="past_due",
        next_charge=datetime.utcnow().date() - timedelta(days=2),
        method="Transferencia",
        tenant_id=default_tenant.id,
    )
    sub3 = Subscription(
        customer="Red Sur",
        email="cto@redsur.pe",
        plan="Semestral",
        cycle_months=6,
        amount=640,
        status="trial",
        next_charge=datetime.utcnow().date() + timedelta(days=30),
        method="Stripe",
        tenant_id=default_tenant.id,
    )
    sub4 = Subscription(
        customer="WispCloud",
        email="billing@wispcloud.com",
        plan="Anual",
        cycle_months=12,
        amount=1200,
        status="active",
        next_charge=datetime.utcnow().date() + timedelta(days=320),
        method="Stripe",
        tenant_id=default_tenant.id,
    )
    db.session.add_all([sub1, sub2, sub3, sub4])

    db.session.commit()
    print("Sample data has been successfully seeded to the database!")
    print("Seed credentials (store securely):")
    if create_platform_admin:
        print(f"  {platform_admin_email} / {platform_admin_password} (platform_admin)")
    print(f"  admin@ispfast.local / {admin_password}")
    print(f"  cliente@ispfast.local / {client_1_password}")
    print(f"  ana.gomez@example.com / {client_2_password}")
