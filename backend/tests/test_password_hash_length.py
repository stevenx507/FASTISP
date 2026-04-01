from app.models import User


def test_user_password_hash_fits_model_length():
    user = User(email='hash-length@test.local', role='admin', name='Hash Length')
    user.set_password('Ssfyber@tecno1')
    assert user.password_hash
    assert len(user.password_hash) <= 255
