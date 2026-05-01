import paramiko

def deploy_silent():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print("Conectando al VPS...")
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1', timeout=120)
        
        commands = [
            'cd /root/fastisp && git pull origin codex/mikrotik-diagnostics-mainline',
            'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod build frontend',
            'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-deps frontend',
            'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod restart backend'
        ]
        
        for cmd in commands:
            print(f"Ejecutando: {cmd}")
            stdin, stdout, stderr = ssh.exec_command(cmd)
            exit_status = stdout.channel.recv_exit_status()
            print(f"Estado: {exit_status}")
            if exit_status != 0:
                print(stderr.read().decode('utf-8'))
                
        print("\n¡Despliegue completado y servicios reiniciados!")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    deploy_silent()
