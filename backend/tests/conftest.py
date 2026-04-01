import pytest

from app import create_app, db


class TestConfig:
    TESTING = True
    SECRET_KEY = "test-secret-key-with-at-least-32-bytes"
    JWT_SECRET_KEY = "test-jwt-secret-key-with-at-least-32-bytes"
    ENCRYPTION_KEY = "itTQ-n1WYoDTC_iw8glZpwkfxAknjNtz85t-6xeUkso="
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    REDIS_URL = "redis://localhost:6379/0"
    CORS_ORIGINS = ["http://localhost:3000"]
    RATELIMIT_STORAGE_URI = "memory://"
    CACHE_TYPE = "SimpleCache"
    CACHE_DEFAULT_TIMEOUT = 30


@pytest.fixture()
def app():
    flask_app = create_app(TestConfig)

    with flask_app.app_context():
        db.create_all()

    yield flask_app

    with flask_app.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()
