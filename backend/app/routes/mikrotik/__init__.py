from flask import Blueprint

mikrotik_bp = Blueprint('mikrotik', __name__)

# Import modules to register routes on the blueprint
from . import legacy
from . import wireguard
from . import monitoring
from . import enterprise
