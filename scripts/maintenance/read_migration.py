import paramiko

def read_migration():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1', timeout=60)
    stdin, stdout, stderr = ssh.exec_command("docker exec fastisp-backend-1 cat /app/migrations/versions/bec25090b394_add_status_column_to_client_and_update_.py")
    content = stdout.read().decode('utf-8')
    if content:
        with open('backend/migrations/versions/bec25090b394_add_status_column_to_client_and_update_.py', 'w') as f:
            f.write(content)
        print("Migracion descargada.")
    else:
        print("No se encontro el archivo")
        print(stderr.read().decode('utf-8'))
    ssh.close()

if __name__ == '__main__':
    read_migration()
