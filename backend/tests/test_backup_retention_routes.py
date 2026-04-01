import os
import time

from flask_jwt_extended import create_access_token

from app import db
from app.models import User


def _admin_token(app, email: str) -> str:
    with app.app_context():
        user = User(email=email, role='admin', name='Admin Backup Retention')
        user.set_password('adminpass123')
        db.session.add(user)
        db.session.commit()
        return create_access_token(identity=str(user.id))


def _write_file_with_age(path, days_old: int, content: str) -> None:
    path.write_text(content, encoding='utf-8')
    ts = time.time() - (days_old * 86400)
    os.utime(path, (ts, ts))


def test_backups_prune_uses_tenant_retention_setting(client, app, tmp_path):
    token = _admin_token(app, 'retention-admin-1@test.local')
    app.config['BACKUP_DIR'] = str(tmp_path)

    old_file = tmp_path / 'old.sql'
    fresh_file = tmp_path / 'fresh.sql'
    _write_file_with_age(old_file, days_old=10, content='old backup')
    _write_file_with_age(fresh_file, days_old=1, content='fresh backup')

    settings_response = client.post(
        '/api/admin/system/settings',
        json={'settings': {'backup_retention_days': 7}},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert settings_response.status_code == 200

    response = client.post(
        '/api/admin/backups/prune',
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['prune']['retention_days'] == 7
    assert payload['prune']['removed'] == 1
    assert old_file.exists() is False
    assert fresh_file.exists() is True


def test_backup_db_returns_prune_result(client, app, monkeypatch, tmp_path):
    token = _admin_token(app, 'retention-admin-2@test.local')
    app.config['BACKUP_DIR'] = str(tmp_path)
    app.config['PG_DUMP_PATH'] = 'pg_dump_custom'
    app.config['SQLALCHEMY_DATABASE_URI'] = 'postgresql://ispmax:password@localhost/ispmax'

    stale_file = tmp_path / 'stale.sql'
    _write_file_with_age(stale_file, days_old=4, content='stale backup')

    client.post(
        '/api/admin/system/settings',
        json={'settings': {'backup_retention_days': 2}},
        headers={'Authorization': f'Bearer {token}'},
    )

    def _fake_check_call(cmd, stdout):
        assert cmd[0] == 'pg_dump_custom'
        stdout.write('-- pg dump output\n')
        return 0

    monkeypatch.setattr('app.routes.main_routes.subprocess.check_call', _fake_check_call)

    response = client.post(
        '/api/admin/backups/db',
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['retention_days'] == 2
    assert payload['prune']['removed'] >= 1
    assert stale_file.exists() is False
    assert (tmp_path / payload['filename']).exists()


def test_backups_prune_rejects_invalid_retention_days(client, app):
    token = _admin_token(app, 'retention-admin-3@test.local')

    non_int = client.post(
        '/api/admin/backups/prune',
        json={'retention_days': 'abc'},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert non_int.status_code == 400
    assert 'retention_days' in non_int.get_json()['error']

    out_of_range = client.post(
        '/api/admin/backups/prune',
        json={'retention_days': 0},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert out_of_range.status_code == 400
    assert 'entre 1 y 365' in out_of_range.get_json()['error']

