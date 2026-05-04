import paramiko

def list_files():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1', timeout=60)
    stdin, stdout, stderr = ssh.exec_command("ls -la /root/fastisp/backend/migrations/versions/")
    print(stdout.read().decode('utf-8'))
    ssh.close()

if __name__ == '__main__':
    list_files()
