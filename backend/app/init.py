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
from celery.schedules import crontab

from app.config import config as config_map, Config

# Initialize extensions
db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()
mail = Mail()
limiter = Limiter(key_func=get_remote_address)
metrics = PrometheusMetrics.for_app_factory()
cache = Cache()
socketio = SocketIO(cors_allowed_origins="*", message_queue=os.environ.get('REDIS_URL') or 'redis://localhost:6379/0')
celery = Celery(__name__, broker=Config.CELERY_BROKER_URL, backend=Config.CELERY_RESULT_BACKEND)

def create_app(config_name_or_class='development'):
    """Application factory"""
    app = Flask(__name__)
    from app.tenancy import (
        ExpiredTenantTokenError,
        InvalidTenantTokenError,
        TenantResolutionError,
        resolve_tenant_id,
    )
    
    # Load configuration (accepts a config class or a key name)
    if isinstance(config_name_or_class, str):
        config_cls = config_map.get(config_name_or_class, config_map['default'])
    else:
        config_cls = config_name_or_class
    app.config.from_object(config_cls)
    if hasattr(config_cls, 'validate'):
        config_cls.validate()
    
    # Update Celery config
    celery.conf.update(app.config)
    celery.conf.beat_schedule = {
        'poll-metrics-every-minute': {
            'task': 'app.tasks.poll_mikrotik_metrics',
            'schedule': 60.0,  # Run every 60 seconds
        },
        'evaluate-noc-alerts-every-5-minutes': {
            'task': 'app.tasks.evaluate_noc_alerts',
            'schedule': 300.0,
        },
        'daily-network-kpis': {
            'task': 'app.tasks.compute_daily_network_kpis',
            'schedule': crontab(minute=5, hour=0),
        },
        'enforce-billing-status-every-15min': {
            'task': 'app.tasks.enforce_billing_status',
            'schedule': 900.0,
        },
        'daily-backups': {
            'task': 'app.tasks.run_backups',
            'schedule': crontab(minute=0, hour=2),
        },
        # Pilar 2: Heartbeat — verifica conectividad VPN cada minuto
        'heartbeat-check-every-minute': {
            'task': 'app.tasks.heartbeat_check',
            'schedule': 60.0,
        },
        'ai-predictive-diagnostic-every-4h': {
            'task': 'app.tasks.scheduled_ai_diagnostic',
            'schedule': crontab(minute=0, hour='*/4'),
        },
        'monthly-invoice-generation': {
            'task': 'app.tasks.generate_monthly_invoices_task',
            'schedule': crontab(minute=0, hour=0, day_of_month=1),
        },
        'enforce-tenant-billing-hourly': {
            'task': 'app.tasks.enforce_tenant_billing',
            'schedule': 3600.0, # Cada hora
        },
    }

    # Define the Celery task context
    class ContextTask(celery.Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)
    celery.Task = ContextTask

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    mail.init_app(app)
    limiter.init_app(app)
    metrics.init_app(app)
    cache.init_app(app)
    socketio.init_app(app)

    @jwt.expired_token_loader
    def handle_expired_jwt(jwt_header, jwt_payload):
        return jsonify({'error': 'JWT token expired'}), 401

    @jwt.invalid_token_loader
    def handle_invalid_jwt(error_message):
        return jsonify({'error': 'Invalid JWT token'}), 401

    @jwt.unauthorized_loader
    def handle_missing_jwt(error_message):
        return jsonify({'error': 'Authorization token is required'}), 401

    @jwt.revoked_token_loader
    def handle_revoked_jwt(jwt_header, jwt_payload):
        return jsonify({'error': 'JWT token revoked'}), 401

    # --- CORS: allow frontend -> API with proper preflight handling ---
    allowed_origins = app.config.get('CORS_ORIGINS') or []
    if isinstance(allowed_origins, str):
        allowed_origins = [o.strip() for o in allowed_origins.split(',') if o.strip()]
    
    # FIX #6: Evitar "*" si supports_credentials=True. Usar fallback seguro.
    origins = allowed_origins if allowed_origins else ["http://localhost:5173", "http://127.0.0.1:5173"]
    
    cors_resources = {
        r"/api/*": {
            "origins": origins,
            "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization", "X-Requested-With"],
            "supports_credentials": True,
            "max_age": 600,
        }
    }
    CORS(app, resources=cors_resources)

    @app.before_request
    def setup_request_context():
        g.request_id = request.headers.get('X-Request-ID') or str(uuid.uuid4())
        g.request_started_at = time.perf_counter()
        # Short-circuit for CORS preflight: no auth/tenant resolution needed
        if request.method == 'OPTIONS':
            return None

        # Short-circuit for health check: no tenant resolution needed
        if request.path in ('/api/health', '/health', '/api/v1/health'):
            g.tenant_id = None
            return None

        # GeoIP allowlist based on upstream header (e.g., from Traefik/Cloudflare)
        allowed_countries = app.config.get('GEOIP_ALLOWLIST') or []
        if allowed_countries:
            country = request.headers.get('X-Country-Code') or request.headers.get('CF-IPCountry')
            if country and country.upper() not in [c.upper() for c in allowed_countries]:
                return jsonify({'error': 'GeoIP blocked'}), 451
        try:
            g.tenant_id = resolve_tenant_id()
        except ExpiredTenantTokenError as exc:
            return jsonify({'error': str(exc)}), 401
        except InvalidTenantTokenError as exc:
            return jsonify({'error': str(exc)}), 401
        except TenantResolutionError as exc:
            return jsonify({'error': str(exc)}), 400

    @app.after_request
    def enrich_response(response):
        response.headers['X-Request-ID'] = getattr(g, 'request_id', '')
        started = getattr(g, 'request_started_at', None)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2) if started else 0
        response.headers['X-Response-Time-Ms'] = str(elapsed_ms)

        log_payload = {
            'request_id': getattr(g, 'request_id', None),
            'tenant_id': getattr(g, 'tenant_id', None),
            'method': request.method,
            'path': request.path,
            'status_code': response.status_code,
            'duration_ms': elapsed_ms,
            'remote_addr': request.headers.get('X-Forwarded-For', request.remote_addr),
        }
        app.logger.info(json.dumps(log_payload, ensure_ascii=True))
        return response
    
    # Configure logging
    log_level = app.config.get('LOG_LEVEL', 'INFO')
    if not app.debug:
        gunicorn_logger = logging.getLogger('gunicorn.error')
        app.logger.handlers = gunicorn_logger.handlers
        app.logger.setLevel(gunicorn_logger.level)
    # Ensure desired log level is set
    app.logger.setLevel(getattr(logging, log_level, logging.INFO))
    
    # Register blueprints (prefijo único /api/* — sin duplicados /api/v1/*)
    # FIX #3: Registrar cada blueprint UNA sola vez para evitar rutas fantasma,
    # rate-limit doble y colisiones de nombre en url_for().
    from app.routes.auth_routes import auth_bp
    from app.routes.billing_routes import billing_bp
    from app.routes.client_routes import client_bp
    from app.routes.admin import admin_bp
    from app.routes.support_routes import support_bp
    from app.routes.misc_routes import misc_bp
    from app.routes.mikrotik import mikrotik_bp
    from app.routes.olt import olt_bp
    from app.routes.network import network_bp
    from app.routes.sstp import sstp_bp
    from app.routes.isp_management import bp as isp_management_bp
    app.register_blueprint(auth_bp, url_prefix='/api')
    app.register_blueprint(billing_bp, url_prefix='/api')
    app.register_blueprint(client_bp, url_prefix='/api')
    app.register_blueprint(admin_bp, url_prefix='/api')
    app.register_blueprint(support_bp, url_prefix='/api')
    app.register_blueprint(misc_bp, url_prefix='/api')
    app.register_blueprint(mikrotik_bp, url_prefix='/api/mikrotik')
    app.register_blueprint(olt_bp, url_prefix='/api/olt')
    app.register_blueprint(sstp_bp, url_prefix='/api/sstp')
    app.register_blueprint(network_bp, url_prefix='/api/network')
    # Pilar 1-4: ISP Management (heartbeat, VPN, comandos MikroTik, seguridad)
    app.register_blueprint(isp_management_bp)

    # Explicit OPTIONS responder so CORS preflights never 404/405
    @app.route('/api/<path:any_path>', methods=['OPTIONS'])
    def api_options(any_path):
        return ('', 204)
    
    # Health check endpoint
    @app.route('/health')
    def health():
        return jsonify({'status': 'healthy', 'service': 'ispmax-backend'})
    
    # Error handlers
    @app.errorhandler(404)
    def not_found(error):
        return jsonify({'error': 'Not found'}), 404

    @app.errorhandler(500)
    def internal_error(error):
        import traceback as _tb
        app.logger.error(f'Server Error: {error}\n{_tb.format_exc()}')
        db.session.rollback()
        return jsonify({'error': 'Internal server error'}), 500
    
    @app.errorhandler(429)
    def ratelimit_handler(e):
        return jsonify({'error': 'Rate limit exceeded'}), 429

    # ── NetFlow v5 collector (Traffic Flow) ───────────────────────────────────
    # Only start in the web/gunicorn process, not in celery workers.
    import os as _os
    if not _os.environ.get('CELERY_WORKER_RUNNING'):
        try:
            from app.services.traffic_flow_service import start_collector
            start_collector(app)
            app.logger.info("NetFlow v5 collector started.")
        except Exception as _tf_err:
            app.logger.warning(f"NetFlow collector could not start: {_tf_err}")

    return app
