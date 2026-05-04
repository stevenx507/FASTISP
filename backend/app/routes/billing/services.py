from flask import jsonify
from flask_jwt_extended import jwt_required
from app.tenancy import current_tenant_id
from app.services.billing_service import billing_service
from . import billing_bp

@billing_bp.route('/admin/billing/generate-batch', methods=['POST'])
@jwt_required()
def admin_generate_invoices():
    """Trigger manual para generación de facturas del mes."""
    tenant_id = current_tenant_id()
    count = billing_service.generate_monthly_invoices(tenant_id)
    return jsonify({'success': True, 'generated_count': count}), 200
