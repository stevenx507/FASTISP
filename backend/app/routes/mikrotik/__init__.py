from .utils import mikrotik_bp

# Import modules to register routes on the blueprint
from . import legacy
from . import wireguard
from . import monitoring
from . import enterprise
