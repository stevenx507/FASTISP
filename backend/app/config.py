"""
Configuration settings for different environments
"""
import os
from datetime import timedelta


def _as_bool(raw_value: str | None, default: bool = False) -> bool:
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {'1', 'true', 'yes', 'y', 'on'}

DEV_ENCRYPTION_KEY = "itTQ-n1WYoDTC_iw8glZpwkfxAknjNtz85t-6xeUkso="


def _split_csv(raw_value: str) -> list[str]:
    return [value.strip() for value in raw_value.split(',') if value.strip()]


class Config:
    """Base configuration"""
    # Security
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-me'
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY') or SECRET_KEY
    # Stable fallback for local development to avoid boot-time crashes.
    ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY') or DEV_ENCRYPTION_KEY
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=1)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)
    
    # Database
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'postgresql://ispmax:password@localhost/ispmax'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Redis
    REDIS_URL = os.environ.get('REDIS_URL') or 'redis://localhost:6379/0'

    # InfluxDB
    INFLUXDB_URL = os.environ.get('INFLUXDB_URL', 'http://localhost:8086')
    INFLUXDB_TOKEN = os.environ.get('DOCKER_INFLUXDB_INIT_ADMIN_TOKEN', 'my-super-secret-token')
    INFLUXDB_ORG = os.environ.get('DOCKER_INFLUXDB_INIT_ORG', 'ispfast')
    INFLUXDB_BUCKET = os.environ.get('DOCKER_INFLUXDB_INIT_BUCKET', 'metrics')
    
    # CORS
    CORS_ORIGINS = _split_csv(os.environ.get('CORS_ORIGINS', 'http://localhost:3000'))
    
    # Rate limiting
    RATELIMIT_DEFAULT = "200 per minute"
    RATELIMIT_STORAGE_URI = REDIS_URL
    RATELIMIT_STORAGE_URL = REDIS_URL  # Backward compatibility with existing config

    # Cache
    CACHE_TYPE = os.environ.get('CACHE_TYPE', 'SimpleCache')
    CACHE_DEFAULT_TIMEOUT = int(os.environ.get('CACHE_DEFAULT_TIMEOUT', 300))
    CACHE_REDIS_URL = REDIS_URL

    # Frontend + access toggles
    FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:3000')
    ALLOW_SELF_SIGNUP = _as_bool(os.environ.get('ALLOW_SELF_SIGNUP'), default=True)
    ALLOW_GOOGLE_LOGIN = _as_bool(os.environ.get('ALLOW_GOOGLE_LOGIN'), default=True)
    ALLOW_INSECURE_GOOGLE_LOGIN = _as_bool(
        os.environ.get('ALLOW_INSECURE_GOOGLE_LOGIN'), default=False
    )
    GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
    GEOIP_ALLOWLIST = _split_csv(os.environ.get('GEOIP_ALLOWLIST', ''))
    TENANCY_ROOT_DOMAIN = (os.environ.get('TENANCY_ROOT_DOMAIN') or '').strip().lower()
    TENANCY_MASTER_HOST = (os.environ.get('TENANCY_MASTER_HOST') or '').strip().lower()
    TENANCY_API_HOST = (os.environ.get('TENANCY_API_HOST') or '').strip().lower()
    TENANCY_EXCLUDED_SUBDOMAINS = _split_csv(
        os.environ.get('TENANCY_EXCLUDED_SUBDOMAINS', 'api,master,www')
    )
    TENANCY_ENFORCE_HOST_MATCH = _as_bool(
        os.environ.get('TENANCY_ENFORCE_HOST_MATCH'),
        default=False,
    )
    PLATFORM_BOOTSTRAP_TOKEN = (os.environ.get('PLATFORM_BOOTSTRAP_TOKEN') or '').strip()
    TENANT_DEFAULT_TRIAL_DAYS = os.environ.get('TENANT_DEFAULT_TRIAL_DAYS', '30')

    # Observability & Alerts
    PAGERDUTY_ROUTING_KEY = os.environ.get('PAGERDUTY_ROUTING_KEY')
    TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
    TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID')
    WONDERPUSH_ACCESS_TOKEN = os.environ.get('WONDERPUSH_ACCESS_TOKEN')
    WONDERPUSH_APPLICATION_ID = os.environ.get('WONDERPUSH_APPLICATION_ID')
    GRAFANA_URL = os.environ.get('GRAFANA_URL') or os.environ.get('VITE_GRAFANA_URL', '')
    GRAFANA_HEALTHCHECK_PATH = os.environ.get('GRAFANA_HEALTHCHECK_PATH', '/api/health')
    GRAFANA_VERIFY_TLS = _as_bool(os.environ.get('GRAFANA_VERIFY_TLS'), default=True)
    GRAFANA_TIMEOUT_SECONDS = os.environ.get('GRAFANA_TIMEOUT_SECONDS', '4')
    GRAFANA_DATASOURCE_UID = os.environ.get('GRAFANA_DATASOURCE_UID', '')

    # Backups
    PG_DUMP_PATH = os.environ.get('PG_DUMP_PATH', 'pg_dump')
    BACKUP_DIR = os.environ.get('BACKUP_DIR', '/app/backups')
    BACKUP_RETENTION_DAYS = os.environ.get('BACKUP_RETENTION_DAYS', '14')
    BACKUP_BUCKET = os.environ.get('BACKUP_BUCKET')  # optional external storage

    # Email
    MAIL_SERVER = os.environ.get('MAIL_SERVER', 'smtp.gmail.com')
    MAIL_PORT = int(os.environ.get('MAIL_PORT', 587))
    MAIL_USE_TLS = os.environ.get('MAIL_USE_TLS', 'true').lower() in ('true', '1', 't')
    MAIL_USERNAME = os.environ.get('MAIL_USERNAME')
    MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD')
    MAIL_DEFAULT_SENDER = os.environ.get('MAIL_DEFAULT_SENDER', 'noreply@ispmax.com')
    
    # Twilio (WhatsApp/SMS)
    TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID')
    TWILIO_AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN')
    TWILIO_PHONE_NUMBER = os.environ.get('TWILIO_PHONE_NUMBER')
    
    # OpenAI
    OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')

    # ACS / TR-069
    ACS_BASE_URL = os.environ.get('ACS_BASE_URL', '')
    ACS_API_KEY = os.environ.get('ACS_API_KEY', '')
    ACS_DEFAULT_HOST = os.environ.get('ACS_DEFAULT_HOST', '')
    ACS_REPROVISION_PATH = os.environ.get('ACS_REPROVISION_PATH', '/api/v1/tr069/reprovision')
    ACS_TIMEOUT_SECONDS = os.environ.get('ACS_TIMEOUT_SECONDS', '8')
    ACS_VERIFY_TLS = _as_bool(os.environ.get('ACS_VERIFY_TLS'), default=True)
    
    # Celery
    CELERY_BROKER_URL = REDIS_URL
    CELERY_RESULT_BACKEND = REDIS_URL
    
    # MikroTik
    MIKROTIK_DEFAULT_USERNAME = os.environ.get('MIKROTIK_DEFAULT_USERNAME', 'admin')
    MIKROTIK_DEFAULT_PASSWORD = os.environ.get('MIKROTIK_DEFAULT_PASSWORD', '')
    MIKROTIK_WG_ENDPOINT = os.environ.get('MIKROTIK_WG_ENDPOINT', 'vpn.fastisp.cloud:51820')
    MIKROTIK_WG_SERVER_PUBLIC_KEY = os.environ.get('MIKROTIK_WG_SERVER_PUBLIC_KEY', '')
    MIKROTIK_WG_ALLOWED_SUBNETS = os.environ.get('MIKROTIK_WG_ALLOWED_SUBNETS', '10.250.0.0/16,10.251.0.0/16')
    MIKROTIK_WG_VPS_SYNC_MODE = os.environ.get('MIKROTIK_WG_VPS_SYNC_MODE', 'auto')
    MIKROTIK_WG_VPS_INTERFACE = os.environ.get('MIKROTIK_WG_VPS_INTERFACE', 'wg0')
    MIKROTIK_WG_VPS_PERSIST = _as_bool(os.environ.get('MIKROTIK_WG_VPS_PERSIST'), default=True)
    MIKROTIK_WG_VPS_SSH_HOST = os.environ.get('MIKROTIK_WG_VPS_SSH_HOST', '')
    MIKROTIK_WG_VPS_SSH_PORT = os.environ.get('MIKROTIK_WG_VPS_SSH_PORT', '22')
    MIKROTIK_WG_VPS_SSH_USER = os.environ.get('MIKROTIK_WG_VPS_SSH_USER', '')
    MIKROTIK_WG_VPS_SSH_PASSWORD = os.environ.get('MIKROTIK_WG_VPS_SSH_PASSWORD', '')
    MIKROTIK_WG_VPS_SSH_KEY_PATH = os.environ.get('MIKROTIK_WG_VPS_SSH_KEY_PATH', '')
    MIKROTIK_WG_VPS_SSH_TIMEOUT_SECONDS = os.environ.get('MIKROTIK_WG_VPS_SSH_TIMEOUT_SECONDS', '8')
    MIKROTIK_WG_VPS_SSH_USE_SUDO = _as_bool(os.environ.get('MIKROTIK_WG_VPS_SSH_USE_SUDO'), default=True)
    ROTATE_PASSWORDS_DRY_RUN = _as_bool(os.environ.get('ROTATE_PASSWORDS_DRY_RUN'), default=False)
    PASSWORD_ROTATION_LENGTH = os.environ.get('PASSWORD_ROTATION_LENGTH', '24')
    
    # Logging
    LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')

    @classmethod
    def validate(cls) -> None:
        """Hook for environment validation in specific config classes."""
        return None


class DevelopmentConfig(Config):
    """Development configuration"""
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or 'sqlite:///dev.db'


class TestingConfig(Config):
    """Testing configuration"""
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    JWT_SECRET_KEY = 'test-secret-key'
    SECRET_KEY = 'test-secret-key'


class ProductionConfig(Config):
    """Production configuration"""
    DEBUG = False
    # Use environment variables in production
    # Tokens más longevos para evitar expiraciones frecuentes en portal admin
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(days=7)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)

    # Environment-provided production values (validated at runtime)
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL')
    REDIS_URL = os.environ.get('REDIS_URL')
    CORS_ORIGINS = _split_csv(os.environ.get('CORS_ORIGINS', ''))
    RATELIMIT_STORAGE_URI = REDIS_URL
    RATELIMIT_STORAGE_URL = REDIS_URL
    CACHE_TYPE = os.environ.get('CACHE_TYPE', 'SimpleCache')
    CACHE_REDIS_URL = os.environ.get('CACHE_REDIS_URL', REDIS_URL)

    FRONTEND_URL = os.environ.get('FRONTEND_URL')
    ALLOW_SELF_SIGNUP = _as_bool(os.environ.get('ALLOW_SELF_SIGNUP'), default=True)
    ALLOW_GOOGLE_LOGIN = _as_bool(os.environ.get('ALLOW_GOOGLE_LOGIN'), default=True)
    ALLOW_INSECURE_GOOGLE_LOGIN = _as_bool(
        os.environ.get('ALLOW_INSECURE_GOOGLE_LOGIN'), default=False
    )
    GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
    TENANCY_ROOT_DOMAIN = (os.environ.get('TENANCY_ROOT_DOMAIN') or '').strip().lower()
    TENANCY_MASTER_HOST = (os.environ.get('TENANCY_MASTER_HOST') or '').strip().lower()
    TENANCY_API_HOST = (os.environ.get('TENANCY_API_HOST') or '').strip().lower()
    TENANCY_EXCLUDED_SUBDOMAINS = _split_csv(
        os.environ.get('TENANCY_EXCLUDED_SUBDOMAINS', 'api,master,www')
    )
    TENANCY_ENFORCE_HOST_MATCH = _as_bool(
        os.environ.get('TENANCY_ENFORCE_HOST_MATCH'),
        default=False,
    )
    PLATFORM_BOOTSTRAP_TOKEN = (os.environ.get('PLATFORM_BOOTSTRAP_TOKEN') or '').strip()

    MIKROTIK_DEFAULT_USERNAME = os.environ.get('MIKROTIK_DEFAULT_USERNAME')
    MIKROTIK_DEFAULT_PASSWORD = os.environ.get('MIKROTIK_DEFAULT_PASSWORD')

    @classmethod
    def validate(cls) -> None:
        required_env = [
            'SECRET_KEY',
            'JWT_SECRET_KEY',
            'DATABASE_URL',
            'REDIS_URL',
            'ENCRYPTION_KEY',
            'MIKROTIK_DEFAULT_USERNAME',
            'MIKROTIK_DEFAULT_PASSWORD',
        ]
        missing = [key for key in required_env if not os.environ.get(key)]
        if missing:
            missing_keys = ', '.join(missing)
            raise ValueError(
                f"Missing required production environment variables: {missing_keys}"
            )

        cors_origins = _split_csv(os.environ.get('CORS_ORIGINS', ''))
        if not cors_origins:
            raise ValueError(
                "CORS_ORIGINS must be set in production and contain at least one origin."
            )

        if _as_bool(os.environ.get('ALLOW_GOOGLE_LOGIN'), default=True) and not os.environ.get('GOOGLE_CLIENT_ID'):
            raise ValueError(
                "GOOGLE_CLIENT_ID must be set when ALLOW_GOOGLE_LOGIN=true in production."
            )

        if os.environ.get('STRIPE_SECRET_KEY') and not os.environ.get('STRIPE_WEBHOOK_SECRET'):
            raise ValueError(
                "STRIPE_WEBHOOK_SECRET must be set when STRIPE_SECRET_KEY is configured in production."
            )

        if not str(os.environ.get('BACKUP_DIR', '/app/backups')).strip():
            raise ValueError("BACKUP_DIR cannot be empty in production.")

        retention_raw = os.environ.get('BACKUP_RETENTION_DAYS', '14')
        try:
            retention_days = int(retention_raw)
        except (TypeError, ValueError):
            raise ValueError("BACKUP_RETENTION_DAYS must be an integer in production.")
        if retention_days < 1 or retention_days > 365:
            raise ValueError("BACKUP_RETENTION_DAYS must be between 1 and 365 in production.")

        rotation_raw = os.environ.get('PASSWORD_ROTATION_LENGTH', '24')
        try:
            rotation_length = int(rotation_raw)
        except (TypeError, ValueError):
            raise ValueError("PASSWORD_ROTATION_LENGTH must be an integer in production.")
        if rotation_length < 16 or rotation_length > 64:
            raise ValueError("PASSWORD_ROTATION_LENGTH must be between 16 and 64 in production.")

        weak_keys = [
            key
            for key in ('SECRET_KEY', 'JWT_SECRET_KEY')
            if len(os.environ.get(key, '')) < 32
        ]
        if weak_keys:
            weak = ', '.join(weak_keys)
            raise ValueError(
                f"Production keys must be at least 32 characters long: {weak}"
            )


config = {
    'development': DevelopmentConfig,
    'testing': TestingConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}
