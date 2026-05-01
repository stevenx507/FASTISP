import paramiko

def add_column_via_sql():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1', timeout=60)
    
    # Run the SQL command inside the backend container using Flask app context
    sql_command = "from app import create_app, db; from sqlalchemy import text; app = create_app(); app.app_context().push(); db.session.execute(text('ALTER TABLE clients ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT \\'active\\' NOT NULL')); db.session.commit()"
    cmd = f"docker exec fastisp-backend-1 python -c \"{sql_command}\""
    
    print(f"Executing: {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    
    print("STDOUT:", stdout.read().decode('utf-8'))
    print("STDERR:", stderr.read().decode('utf-8'))
    
    # Also delete the bad migration inside the backend container if it exists
    ssh.exec_command('docker exec fastisp-backend-1 rm -f /app/migrations/versions/bec25090b394_*.py')
    
    ssh.close()

if __name__ == '__main__':
    add_column_via_sql()
