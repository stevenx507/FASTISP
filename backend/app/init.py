"""
ISPMAX Backend Application
Main application factory
"""
import json
import logging
import os
import time
import uuid

from flask import Flask, g, jsonify, request
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_mail import Mail
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_caching import Cache
from flask_socketio import SocketIO
from prometheus_flask_exporter import PrometheusMetrics
from celery import Celery

# Initialize extensions (at top level but not bound to app yet)
db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()
mail = Mail()
limiter = Limiter(key_func=get_remote_address)
metrics = PrometheusMetrics.for_app_factory()
cache = Cache()
socketio = SocketIO(cors_allowed_origins="*")
celery = Celery(__name__)

def create_app(config_name_or_class='development'):
    """Application factory"""
    app = Flask(__name__)
    
    # Load configuration
    from app.config import config as config_map, Config
    if isinstance(config_name_or_class, str):
        config_cls = config_map.get(config_name_or_class, config_map['default'])
    else:
        config_cls = config_name_or_class
    app.config.from_object(config_cls)
    
    if hasattr(config_cls, 'validate'):
        config_cls.validate()
    
    # Update Celery config
    celery.conf.update(app.config)
    
    # Initialize extensions with app
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    mail.init_app(app)
    limiter.init_app(app)
    metrics.init_app(app)
    cache.init_app(app)
    socketio.init_app(app)

    # Register error handlers
    from app.errors import register_error_handlers
    register_error_handlers(app)

    # CORS Configuration
    allowed_origins = app.config.get('CORS_ORIGINS') or []
    if isinstance(allowed_origins, str):
        allowed_origins = [o.strip() for o in allowed_origins.split(',') if o.strip()]
    origins = allowed_origins if allowed_origins else ["*"]
    
    CORS(app, resources={
        r"/api/*": {
            "origins": origins,
            "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization", "X-Requested-With", "X-Tenant-ID"],
            "supports_credentials": True
        }
    })

    @app.before_request
    def setup_request_context():
        from app.tenancy import resolve_tenant_id, ExpiredTenantTokenError, InvalidTenantTokenError, TenantResolutionError
        g.request_id = request.headers.get('X-Request-ID') or str(uuid.uuid4())
        g.request_started_at = time.perf_counter()
        
        if request.method == 'OPTIONS' or request.path in ('/api/health', '/health'):
            g.tenant_id = None
            return None

        try:
            g.tenant_id = resolve_tenant_id()
        except (ExpiredTenantTokenError, InvalidTenantTokenError, TenantResolutionError) as exc:
            # Only enforce tenant on protected routes, or return error if malformed
            if not request.path.startswith('/api/auth/'):
                return jsonify({'error': str(exc)}), 400
            g.tenant_id = None

    # Register blueprints at the VERY END to avoid circular imports during initialization
    from app.routes.auth import auth_bp
    from app.routes.admin import admin_bp
    from app.routes.client_portal import client_portal_bp
    from app.routes.billing import billing_bp
    from app.routes.isp import isp_bp
    from app.routes.support_routes import support_bp
    from app.routes.misc_routes import misc_bp
    from app.routes.network import network_bp
    from app.routes.olt import olt_bp
    from app.routes.mikrotik import mikrotik_bp
    from app.routes.sstp import sstp_bp
    
    app.register_blueprint(auth_bp, url_prefix='/api')
    app.register_blueprint(admin_bp, url_prefix='/api')
    app.register_blueprint(client_portal_bp, url_prefix='/api')
    app.register_blueprint(billing_bp, url_prefix='/api')
    app.register_blueprint(isp_bp)
    app.register_blueprint(support_bp, url_prefix='/api')
    app.register_blueprint(misc_bp, url_prefix='/api')
    app.register_blueprint(network_bp, url_prefix='/api/network')
    app.register_blueprint(olt_bp, url_prefix='/api/olt')
    app.register_blueprint(mikrotik_bp, url_prefix='/api/mikrotik')
    app.register_blueprint(sstp_bp, url_prefix='/api/sstp')

    @app.route('/api/health')
    def health():
        return jsonify({'status': 'healthy', 'service': 'ispfast-backend'})

    return app
