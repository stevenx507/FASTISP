import requests
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required
from werkzeug.exceptions import BadRequest
from app import db, limiter
from app.models import User, Tenant, AuditLog
from app.tenancy import current_tenant_id
from app.lib.utils import parse_bool, parse_int
from app.routes.admin.utils import _audit

login_bp = Blueprint("auth_login", __name__)

def _verify_google_credential(credential: str) -> dict:
    google_client_id = (current_app.config.get('GOOGLE_CLIENT_ID') or '').strip()
    if not google_client_id:
        raise BadRequest("GOOGLE_CLIENT_ID no está configurado.")
    try:
        resp = requests.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": credential}, timeout=5)
    except requests.RequestException as exc:
        raise BadRequest(f"Error validando token Google: {exc}")
    if resp.status_code != 200:
        raise BadRequest("Token Google inválido.")
    payload = resp.json()
    if payload.get('aud') != google_client_id:
        raise BadRequest("Token aud mismatch.")
    return {"email": payload.get('email', '').lower(), "name": payload.get('name', 'Usuario Google')}

@login_bp.route('/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    data = request.get_json() or {}
    email = str(data.get('email') or '').strip().lower()
    password = str(data.get('password') or '').strip()
    
    if data.get('google_credential'):
        try:
            google_data = _verify_google_credential(data['google_credential'])
            email = google_data['email']
            user = User.query.filter_by(email=email).first()
            if not user:
                return jsonify({"error": "Usuario Google no registrado"}), 404
        except BadRequest as e:
            return jsonify({"error": str(e)}), 400
    else:
        user = User.query.filter_by(email=email).first()
        if not user or not user.check_password(password):
            _audit("login_failed", metadata={"email": email})
            return jsonify({"error": "Credenciales inválidas"}), 401

    if not user.is_active:
        return jsonify({"error": "Cuenta suspendida"}), 403

    access_token = create_access_token(identity=str(user.id))
    _audit("login_success", metadata={"user_id": user.id})
    return jsonify({
        "access_token": access_token,
        "user": user.to_dict()
    }), 200
