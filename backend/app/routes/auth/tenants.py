from flask import Blueprint, jsonify, request
from app import db
from app.models import Tenant, User
from app.lib.utils import get_tenant_trial_ends_at
from app.routes.admin.utils import _audit

tenants_bp = Blueprint("auth_tenants", __name__)

@tenants_bp.route('/register-tenant', methods=['POST'])
def register_tenant():
    data = request.get_json() or {}
    name = data.get('name')
    email = data.get('email')
    password = data.get('password')
    
    if Tenant.query.filter_by(name=name).first():
        return jsonify({"error": "Nombre de empresa ya registrado"}), 400
    
    tenant = Tenant(name=name, status="trial", trial_ends_at=get_tenant_trial_ends_at())
    db.session.add(tenant)
    db.session.flush()
    
    user = User(email=email, role="admin", tenant_id=tenant.id)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    
    _audit("tenant_registered", entity_type="tenant", entity_id=str(tenant.id))
    return jsonify({"message": "Registro exitoso", "tenant_id": tenant.id}), 201
