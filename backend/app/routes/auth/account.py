from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from app import db
from app.models import User
from app.lib.utils import validate_password_policy
from app.routes.admin.utils import _audit

account_bp = Blueprint("auth_account", __name__)

@account_bp.route('/auth/profile', methods=['GET'])
@jwt_required()
def get_profile():
    user_id = get_jwt_identity()
    user = db.session.get(User, user_id)
    if not user: return jsonify({"error": "No encontrado"}), 404
    return jsonify(user.to_dict()), 200

@account_bp.route('/auth/password', methods=['POST'])
@jwt_required()
def change_password():
    user_id = get_jwt_identity()
    user = db.session.get(User, user_id)
    data = request.get_json() or {}
    old_pw = data.get('old_password')
    new_pw = data.get('new_password')
    
    if not user.check_password(old_pw):
        return jsonify({"error": "Contraseña actual incorrecta"}), 401
    
    ok, msg = validate_password_policy(new_pw)
    if not ok: return jsonify({"error": msg}), 400
    
    user.set_password(new_pw)
    db.session.commit()
    _audit("password_changed")
    return jsonify({"message": "Contraseña actualizada"}), 200
