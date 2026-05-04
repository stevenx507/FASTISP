from flask import Blueprint

isp_bp = Blueprint('isp_management', __name__, url_prefix='/api')

from . import heartbeat, mikrotik, vpn, onboarding
