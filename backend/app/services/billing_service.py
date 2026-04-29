import logging
from datetime import datetime, date
import stripe
from flask import current_app
from app import db
from app.models import Invoice, PaymentRecord, Client, Subscription, AuditLog
from app.services.mikrotik_service import MikroTikService

logger = logging.getLogger(__name__)

class BillingService:
    def __init__(self):
        self._stripe_initialized = False

    def _init_stripe(self):
        if not self._stripe_initialized:
            stripe.api_key = current_app.config.get('STRIPE_SECRET_KEY')
            self._stripe_initialized = True

    def create_checkout_session(self, invoice_id: int, success_url: str, cancel_url: str):
        """Crea una sesión de pago en Stripe para una factura específica."""
        self._init_stripe()
        invoice = db.session.get(Invoice, invoice_id)
        if not invoice:
            raise ValueError("Factura no encontrada")

        client = invoice.client
        
        session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': invoice.currency.lower() or 'usd',
                    'product_data': {
                        'name': f"Internet Service - {invoice.number}",
                        'description': f"Periodo: {invoice.period_start} a {invoice.period_end}",
                    },
                    'unit_amount': int(invoice.total_amount * 100), # Stripe usa centavos
                },
                'quantity': 1,
            }],
            mode='payment',
            success_url=success_url + "?session_id={CHECKOUT_SESSION_ID}",
            cancel_url=cancel_url,
            client_reference_id=str(invoice.id),
            customer_email=client.user.email if client.user else None,
            metadata={
                'invoice_id': invoice.id,
                'client_id': client.id,
                'tenant_id': invoice.tenant_id
            }
        )
        return session

    def process_stripe_webhook(self, payload, sig_header):
        """Procesa notificaciones de Stripe (webhooks)."""
        self._init_stripe()
        endpoint_secret = current_app.config.get('STRIPE_WEBHOOK_SECRET')

        try:
            event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
        except Exception as e:
            logger.error(f"Error validando webhook de Stripe: {e}")
            raise

        if event['type'] == 'checkout.session.completed':
            session = event['data']['object']
            self._handle_successful_payment(session)

        return True

    def _handle_successful_payment(self, session):
        """Registra el pago y reactiva el servicio si es necesario."""
        invoice_id = session.get('client_reference_id')
        if not invoice_id:
            logger.error("Webhook de Stripe sin client_reference_id (invoice_id)")
            return

        invoice = db.session.get(Invoice, int(invoice_id))
        if not invoice:
            logger.error(f"Factura {invoice_id} no encontrada tras pago exitoso")
            return

        if invoice.status == 'paid':
            return # Ya procesada

        # Registrar pago
        payment = PaymentRecord(
            invoice_id=invoice.id,
            amount=invoice.total_amount,
            method='stripe',
            transaction_id=session.get('id'),
            tenant_id=invoice.tenant_id,
            created_at=datetime.utcnow()
        )
        db.session.add(payment)
        
        invoice.status = 'paid'
        invoice.paid_at = datetime.utcnow()
        
        # Verificar si el cliente tiene otras deudas
        client = invoice.client
        pending_invoices = Invoice.query.filter(
            Invoice.client_id == client.id,
            Invoice.status.in_(['pending', 'past_due']),
            Invoice.id != invoice.id
        ).count()

        if pending_invoices == 0:
            # Reactivar en MikroTik
            try:
                with MikroTikService(client.router_id) as mt:
                    mt.activate_client(client)
                
                # Actualizar suscripción si existe
                sub = Subscription.query.filter_by(client_id=client.id).first()
                if sub:
                    sub.status = 'active'
            except Exception as e:
                logger.error(f"Error reactivando cliente {client.id} tras pago: {e}")

        db.session.commit()
        logger.info(f"Pago procesado exitosamente para factura {invoice.id}")

    def generate_monthly_invoices(self, tenant_id: int = None):
        """Genera facturas automáticamente para todos los clientes activos."""
        query = Client.query.filter_by(is_active=True, facturas_automaticas=True)
        if tenant_id:
            query = query.filter_by(tenant_id=tenant_id)
        
        clients = query.all()
        today = date.today()
        count = 0

        for client in clients:
            # Evitar duplicados para el mismo mes
            month_start = today.replace(day=1)
            existing = Invoice.query.filter(
                Invoice.client_id == client.id,
                Invoice.created_at >= month_start
            ).first()

            if not existing and client.plan:
                invoice = Invoice(
                    client_id=client.id,
                    tenant_id=client.tenant_id,
                    number=f"INV-{today.strftime('%Y%m')}-{client.id}",
                    total_amount=client.plan.price,
                    status='pending',
                    due_date=today + datetime.timedelta(days=5),
                    currency='USD',
                    created_at=datetime.utcnow()
                )
                db.session.add(invoice)
                count += 1
        
        db.session.commit()
        return count

billing_service = BillingService()
