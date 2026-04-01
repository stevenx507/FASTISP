import hashlib

from flask_jwt_extended import create_access_token

from app import db
from app.models import User


def _admin_token(app, email: str) -> str:
    with app.app_context():
        user = User(email=email, role='admin', name='Admin User')
        user.set_password('adminpass123')
        db.session.add(user)
        db.session.commit()
        return create_access_token(identity=str(user.id))


def test_backups_list_download_and_verify_use_configured_directory(client, app, tmp_path):
    token = _admin_token(app, 'backup-admin-1@test.local')
    app.config['BACKUP_DIR'] = str(tmp_path)

    backup_name = 'db-backup-20260224.sql'
    backup_content = '-- sample backup\nSELECT 1;\n'
    (tmp_path / backup_name).write_text(backup_content, encoding='utf-8')

    list_response = client.get(
        '/api/admin/backups/list',
        headers={'Authorization': f'Bearer {token}'},
    )
    assert list_response.status_code == 200
    list_payload = list_response.get_json()
    assert list_payload['count'] == 1
    assert list_payload['items'][0]['name'] == backup_name

    download_response = client.get(
        '/api/admin/backups/download',
        query_string={'name': backup_name},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert download_response.status_code == 200
    assert download_response.data.decode('utf-8').replace('\r\n', '\n') == backup_content

    verify_response = client.get(
        '/api/admin/backups/verify',
        query_string={'name': backup_name},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert verify_response.status_code == 200
    verify_payload = verify_response.get_json()
    assert verify_payload['valid'] is True
    assert verify_payload['items'][0]['name'] == backup_name
    assert verify_payload['items'][0]['sha256'] == hashlib.sha256(
        (tmp_path / backup_name).read_bytes()
    ).hexdigest()


def test_backup_download_rejects_unsafe_name(client, app):
    token = _admin_token(app, 'backup-admin-2@test.local')
    response = client.get(
        '/api/admin/backups/download',
        query_string={'name': '../secret.sql'},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert response.status_code == 400
    assert 'name' in response.get_json()['error']


def test_backup_verify_flags_empty_file(client, app, tmp_path):
    token = _admin_token(app, 'backup-admin-3@test.local')
    app.config['BACKUP_DIR'] = str(tmp_path)
    (tmp_path / 'empty.sql').touch()

    response = client.get(
        '/api/admin/backups/verify',
        query_string={'name': 'empty.sql'},
        headers={'Authorization': f'Bearer {token}'},
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['valid'] is False
    assert payload['items'][0]['valid'] is False
    assert 'empty_file' in payload['items'][0]['issues']


def test_backup_db_uses_configured_directory_and_pg_dump_path(client, app, monkeypatch, tmp_path):
    token = _admin_token(app, 'backup-admin-4@test.local')
    app.config['BACKUP_DIR'] = str(tmp_path)
    app.config['PG_DUMP_PATH'] = 'custom_pg_dump'
    app.config['SQLALCHEMY_DATABASE_URI'] = 'postgresql://ispmax:password@localhost/ispmax'

    captured = {}

    def _fake_check_call(cmd, stdout):
        captured['cmd'] = cmd
        stdout.write('-- pg_dump output\n')
        return 0

    monkeypatch.setattr('app.routes.main_routes.subprocess.check_call', _fake_check_call)

    response = client.post(
        '/api/admin/backups/db',
        headers={'Authorization': f'Bearer {token}'},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    assert payload['filename'].startswith('db-backup-')
    assert captured['cmd'][0] == 'custom_pg_dump'
    assert captured['cmd'][1] == app.config['SQLALCHEMY_DATABASE_URI']
    assert (tmp_path / payload['filename']).exists()
