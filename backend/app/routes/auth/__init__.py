from flask import Blueprint
from .login import login_bp
from .account import account_bp
from .tenants import tenants_bp

auth_bp = Blueprint("auth", __name__)

auth_bp.register_blueprint(login_bp)
auth_bp.register_blueprint(account_bp)
auth_bp.register_blueprint(tenants_bp)
