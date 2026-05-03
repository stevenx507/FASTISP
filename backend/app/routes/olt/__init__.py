from flask import Blueprint
from .management import management_bp
from .monitoring import monitoring_bp
from .onus import onus_bp

olt_bp = Blueprint("olt", __name__)

# Register sub-blueprints
olt_bp.register_blueprint(management_bp)
olt_bp.register_blueprint(monitoring_bp)
olt_bp.register_blueprint(onus_bp)
