from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Client, Ticket, User

portal_bp = Blueprint("portal_main", __name__)

@portal_bp.route('/client/usage-history', methods=['GET'])
@jwt_required()
def client_usage_history():
    user_id = get_jwt_identity()
    user = db.session.get(User, user_id)
    if not user or not user.client:
        return jsonify({"error": "No eres un cliente"}), 403
    # Logic for usage history...
    return jsonify({"items": [], "total": 0}), 200

@portal_bp.route('/client/support/ai-chat', methods=['POST'])
@jwt_required()
def client_ai_chat():
    # Logic for AI chat...
    return jsonify({"response": "Hola, ¿en qué puedo ayudarte?"}), 200
