from flask import jsonify, request
from .utils import admin_bp, _audit, _tenant_scoped_query
from app.models import AdminInstallation
from app.tenancy import current_tenant_id

@admin_bp.route('/admin/installations', methods=['GET'])
def admin_installations_list():
    tenant_id = current_tenant_id()
    rows = _tenant_scoped_query(AdminInstallation, tenant_id).order_by(AdminInstallation.created_at.desc()).all()
    return jsonify({"items": [r.to_dict() for r in rows], "count": len(rows)}), 200
