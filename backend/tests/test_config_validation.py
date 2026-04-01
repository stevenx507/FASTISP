import pytest

from app.config import ProductionConfig


REQUIRED_PROD_KEYS = [
    'SECRET_KEY',
    'JWT_SECRET_KEY',
    'DATABASE_URL',
    'REDIS_URL',
    'ENCRYPTION_KEY',
    'MIKROTIK_DEFAULT_USERNAME',
    'MIKROTIK_DEFAULT_PASSWORD',
    'CORS_ORIGINS',
]


def test_production_validate_requires_environment_variables(monkeypatch):
    for key in REQUIRED_PROD_KEYS:
        monkeypatch.delenv(key, raising=False)

    with pytest.raises(ValueError) as excinfo:
        ProductionConfig.validate()

    message = str(excinfo.value)
    assert 'DATABASE_URL' in message
    assert 'REDIS_URL' in message
    assert 'ENCRYPTION_KEY' in message
    assert 'SECRET_KEY' in message
    assert 'JWT_SECRET_KEY' in message


def test_production_validate_passes_with_required_environment(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 's' * 40)
    monkeypatch.setenv('JWT_SECRET_KEY', 'j' * 40)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://ispmax:password@localhost/ispmax')
    monkeypatch.setenv('REDIS_URL', 'redis://localhost:6379/0')
    monkeypatch.setenv('ENCRYPTION_KEY', 'itTQ-n1WYoDTC_iw8glZpwkfxAknjNtz85t-6xeUkso=')
    monkeypatch.setenv('MIKROTIK_DEFAULT_USERNAME', 'admin')
    monkeypatch.setenv('MIKROTIK_DEFAULT_PASSWORD', 'adminpass')
    monkeypatch.setenv('CORS_ORIGINS', 'https://app.example.com')
    monkeypatch.setenv('ALLOW_GOOGLE_LOGIN', 'false')

    ProductionConfig.validate()


def test_production_validate_rejects_weak_secret_keys(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 'short')
    monkeypatch.setenv('JWT_SECRET_KEY', 'short')
    monkeypatch.setenv('DATABASE_URL', 'postgresql://ispmax:password@localhost/ispmax')
    monkeypatch.setenv('REDIS_URL', 'redis://localhost:6379/0')
    monkeypatch.setenv('ENCRYPTION_KEY', 'itTQ-n1WYoDTC_iw8glZpwkfxAknjNtz85t-6xeUkso=')
    monkeypatch.setenv('MIKROTIK_DEFAULT_USERNAME', 'admin')
    monkeypatch.setenv('MIKROTIK_DEFAULT_PASSWORD', 'adminpass')
    monkeypatch.setenv('CORS_ORIGINS', 'https://app.example.com')
    monkeypatch.setenv('ALLOW_GOOGLE_LOGIN', 'false')

    with pytest.raises(ValueError) as excinfo:
        ProductionConfig.validate()

    assert 'at least 32 characters' in str(excinfo.value)


def test_production_validate_requires_google_client_id_when_google_login_enabled(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 's' * 40)
    monkeypatch.setenv('JWT_SECRET_KEY', 'j' * 40)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://ispmax:password@localhost/ispmax')
    monkeypatch.setenv('REDIS_URL', 'redis://localhost:6379/0')
    monkeypatch.setenv('ENCRYPTION_KEY', 'itTQ-n1WYoDTC_iw8glZpwkfxAknjNtz85t-6xeUkso=')
    monkeypatch.setenv('MIKROTIK_DEFAULT_USERNAME', 'admin')
    monkeypatch.setenv('MIKROTIK_DEFAULT_PASSWORD', 'adminpass')
    monkeypatch.setenv('CORS_ORIGINS', 'https://app.example.com')
    monkeypatch.setenv('ALLOW_GOOGLE_LOGIN', 'true')
    monkeypatch.delenv('GOOGLE_CLIENT_ID', raising=False)

    with pytest.raises(ValueError) as excinfo:
        ProductionConfig.validate()

    assert 'GOOGLE_CLIENT_ID' in str(excinfo.value)


def test_production_validate_requires_stripe_webhook_secret_when_stripe_enabled(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 's' * 40)
    monkeypatch.setenv('JWT_SECRET_KEY', 'j' * 40)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://ispmax:password@localhost/ispmax')
    monkeypatch.setenv('REDIS_URL', 'redis://localhost:6379/0')
    monkeypatch.setenv('ENCRYPTION_KEY', 'itTQ-n1WYoDTC_iw8glZpwkfxAknjNtz85t-6xeUkso=')
    monkeypatch.setenv('MIKROTIK_DEFAULT_USERNAME', 'admin')
    monkeypatch.setenv('MIKROTIK_DEFAULT_PASSWORD', 'adminpass')
    monkeypatch.setenv('CORS_ORIGINS', 'https://app.example.com')
    monkeypatch.setenv('ALLOW_GOOGLE_LOGIN', 'false')
    monkeypatch.setenv('STRIPE_SECRET_KEY', 'sk_test_secret')
    monkeypatch.delenv('STRIPE_WEBHOOK_SECRET', raising=False)

    with pytest.raises(ValueError) as excinfo:
        ProductionConfig.validate()

    assert 'STRIPE_WEBHOOK_SECRET' in str(excinfo.value)


def test_production_validate_rejects_empty_backup_dir(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 's' * 40)
    monkeypatch.setenv('JWT_SECRET_KEY', 'j' * 40)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://ispmax:password@localhost/ispmax')
    monkeypatch.setenv('REDIS_URL', 'redis://localhost:6379/0')
    monkeypatch.setenv('ENCRYPTION_KEY', 'itTQ-n1WYoDTC_iw8glZpwkfxAknjNtz85t-6xeUkso=')
    monkeypatch.setenv('MIKROTIK_DEFAULT_USERNAME', 'admin')
    monkeypatch.setenv('MIKROTIK_DEFAULT_PASSWORD', 'adminpass')
    monkeypatch.setenv('CORS_ORIGINS', 'https://app.example.com')
    monkeypatch.setenv('ALLOW_GOOGLE_LOGIN', 'false')
    monkeypatch.setenv('BACKUP_DIR', '   ')

    with pytest.raises(ValueError) as excinfo:
        ProductionConfig.validate()

    assert 'BACKUP_DIR' in str(excinfo.value)


def test_production_validate_rejects_non_integer_password_rotation_length(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 's' * 40)
    monkeypatch.setenv('JWT_SECRET_KEY', 'j' * 40)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://ispmax:password@localhost/ispmax')
    monkeypatch.setenv('REDIS_URL', 'redis://localhost:6379/0')
    monkeypatch.setenv('ENCRYPTION_KEY', 'itTQ-n1WYoDTC_iw8glZpwkfxAknjNtz85t-6xeUkso=')
    monkeypatch.setenv('MIKROTIK_DEFAULT_USERNAME', 'admin')
    monkeypatch.setenv('MIKROTIK_DEFAULT_PASSWORD', 'adminpass')
    monkeypatch.setenv('CORS_ORIGINS', 'https://app.example.com')
    monkeypatch.setenv('ALLOW_GOOGLE_LOGIN', 'false')
    monkeypatch.setenv('PASSWORD_ROTATION_LENGTH', 'abc')

    with pytest.raises(ValueError) as excinfo:
        ProductionConfig.validate()

    assert 'PASSWORD_ROTATION_LENGTH' in str(excinfo.value)


def test_production_validate_rejects_out_of_range_password_rotation_length(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 's' * 40)
    monkeypatch.setenv('JWT_SECRET_KEY', 'j' * 40)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://ispmax:password@localhost/ispmax')
    monkeypatch.setenv('REDIS_URL', 'redis://localhost:6379/0')
    monkeypatch.setenv('ENCRYPTION_KEY', 'itTQ-n1WYoDTC_iw8glZpwkfxAknjNtz85t-6xeUkso=')
    monkeypatch.setenv('MIKROTIK_DEFAULT_USERNAME', 'admin')
    monkeypatch.setenv('MIKROTIK_DEFAULT_PASSWORD', 'adminpass')
    monkeypatch.setenv('CORS_ORIGINS', 'https://app.example.com')
    monkeypatch.setenv('ALLOW_GOOGLE_LOGIN', 'false')
    monkeypatch.setenv('PASSWORD_ROTATION_LENGTH', '8')

    with pytest.raises(ValueError) as excinfo:
        ProductionConfig.validate()

    assert 'between 16 and 64' in str(excinfo.value)


def test_production_validate_rejects_invalid_backup_retention_days(monkeypatch):
    monkeypatch.setenv('SECRET_KEY', 's' * 40)
    monkeypatch.setenv('JWT_SECRET_KEY', 'j' * 40)
    monkeypatch.setenv('DATABASE_URL', 'postgresql://ispmax:password@localhost/ispmax')
    monkeypatch.setenv('REDIS_URL', 'redis://localhost:6379/0')
    monkeypatch.setenv('ENCRYPTION_KEY', 'itTQ-n1WYoDTC_iw8glZpwkfxAknjNtz85t-6xeUkso=')
    monkeypatch.setenv('MIKROTIK_DEFAULT_USERNAME', 'admin')
    monkeypatch.setenv('MIKROTIK_DEFAULT_PASSWORD', 'adminpass')
    monkeypatch.setenv('CORS_ORIGINS', 'https://app.example.com')
    monkeypatch.setenv('ALLOW_GOOGLE_LOGIN', 'false')
    monkeypatch.setenv('BACKUP_RETENTION_DAYS', '0')

    with pytest.raises(ValueError) as excinfo:
        ProductionConfig.validate()

    assert 'BACKUP_RETENTION_DAYS' in str(excinfo.value)
