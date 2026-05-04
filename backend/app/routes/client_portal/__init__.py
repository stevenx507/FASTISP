from flask import Blueprint
from .portal import portal_bp

client_portal_bp = Blueprint("client_portal", __name__)

client_portal_bp.register_blueprint(portal_bp)
# from .billing import portal_billing_bp
# client_portal_bp.register_blueprint(portal_billing_bp)
