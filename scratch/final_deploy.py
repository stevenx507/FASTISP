import paramiko

def final_deploy():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print("Conectando al VPS...")
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1', timeout=60)
        
        # Pull latest code
        print("Piling changes...")
        ssh.exec_command('cd /root/fastisp && git pull origin codex/mikrotik-diagnostics-mainline')
        
        # Build
        print("Building (silent)...")
        stdin, stdout, stderr = ssh.exec_command('cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod build frontend')
        stdout.channel.recv_exit_status()
        
        # Up
        print("Starting container...")
        stdin, stdout, stderr = ssh.exec_command('cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-deps frontend')
        stdout.channel.recv_exit_status()
        
        print("Deployment finished successfully.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    final_deploy()
