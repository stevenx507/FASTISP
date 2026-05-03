from flask import Blueprint
from .login import login_bp
from .account import account_bp
from .tenants import tenants_bp

# Blueprint principal de autenticación
auth_bp = Blueprint("auth", __name__)

# Registramos los sub-blueprints. 
# Si app/__init__.py registra esto con /api, las rutas serán /api/auth/login, etc.
auth_bp.register_blueprint(login_bp)
auth_bp.register_blueprint(account_bp)
auth_bp.register_blueprint(tenants_bp)
