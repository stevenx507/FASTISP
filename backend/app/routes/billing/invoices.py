from flask import jsonify, request, send_file
from flask_jwt_extended import jwt_required
from app.models import Invoice
from app import db
from app.tenancy import current_tenant_id, admin_required, staff_required
from app.services.pdf_service import PDFService
from . import billing_bp

@billing_bp.route('/billing/invoices/<int:invoice_id>/pdf', methods=['GET'])
@jwt_required()
def download_invoice_pdf(invoice_id):
    """Genera y descarga el PDF de una factura."""
    invoice = db.session.get(Invoice, invoice_id)
    if not invoice:
        return jsonify({"error": "Factura no encontrada"}), 404
        
    tenant_id = current_tenant_id()
    sub_tenant = invoice.subscription.tenant_id if invoice.subscription else None
    if tenant_id is not None and sub_tenant not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado"}), 403

    pdf_buffer = PDFService.generate_invoice_pdf(invoice)
    return send_file(
        pdf_buffer,
        mimetype='application/pdf',
        as_attachment=True,
        download_name=f"Factura_{invoice.number}.pdf"
    )

@billing_bp.route('/billing/electronic/send', methods=['POST'])
@admin_required()
def billing_electronic_send():
    data = request.get_json() or {}
    invoice_id = data.get('invoice_id')
    if not invoice_id:
        return jsonify({"error": "invoice_id es requerido."}), 400

    invoice = db.session.get(Invoice, invoice_id)
    if not invoice:
        return jsonify({"error": "Factura no encontrada."}), 404

    tenant_id = current_tenant_id()
    sub_tenant = invoice.subscription.tenant_id if invoice.subscription else None
    if tenant_id is not None and sub_tenant not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    country = (data.get('country') or 'PE').upper()
    if country not in {'PE', 'CO', 'MX', 'CL'}:
        return jsonify({"error": "Pais no soportado para facturacion electronica."}), 400

    invoice.country = country
    db.session.add(invoice)
    db.session.commit()

    status = "accepted" if invoice.status == "paid" else ("rejected" if invoice.status == "cancelled" else "processing")
    response = {
        "invoice_id": invoice.id,
        "country": country,
        "status": status,
        "message": "Factura electronica aceptada" if status == "accepted" else (
            "Factura electronica en proceso" if status == "processing" else "Factura electronica rechazada"
        ),
    }
    return jsonify(response), 200

@billing_bp.route('/billing/electronic/status', methods=['GET'])
@staff_required()
def billing_electronic_status():
    invoice_id = request.args.get('invoice_id')
    if not invoice_id:
        return jsonify({"error": "invoice_id es requerido."}), 400

    invoice = db.session.get(Invoice, invoice_id)
    if not invoice:
        return jsonify({"error": "Factura no encontrada."}), 404

    tenant_id = current_tenant_id()
    sub_tenant = invoice.subscription.tenant_id if invoice.subscription else None
    if tenant_id is not None and sub_tenant not in (None, tenant_id):
        return jsonify({"error": "Acceso denegado para este tenant."}), 403

    status = "accepted" if invoice.status == "paid" else ("rejected" if invoice.status == "cancelled" else "processing")
    return jsonify(
        {
            "invoice_id": invoice.id,
            "country": invoice.country or (invoice.subscription.country if invoice.subscription else None),
            "status": status,
            "message": "Factura electronica aceptada" if status == "accepted" else (
                "Factura electronica en proceso" if status == "processing" else "Factura electronica rechazada"
            ),
        }
    ), 200
