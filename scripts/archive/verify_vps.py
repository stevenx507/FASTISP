import paramiko

def verify():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1', timeout=10)
        
        # Check git log
        print("=== GIT LOG EN EL VPS ===")
        _, stdout, _ = ssh.exec_command('cd /root/fastisp && git log -n 1 --oneline')
        print(stdout.read().decode('utf-8').strip())
        
        # Check docker status
        print("\n=== CONTENEDORES ===")
        _, stdout, _ = ssh.exec_command('docker ps --format "table {{.Names}}\t{{.Status}}" | grep fastisp')
        print(stdout.read().decode('utf-8').strip())
        
    finally:
        ssh.close()

if __name__ == '__main__':
    verify()
