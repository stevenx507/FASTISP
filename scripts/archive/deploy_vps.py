import paramiko
import sys

def deploy():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print("Conectando al VPS...")
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1', timeout=30)
        
        # 1. Git Pull
        print("Sincronizando codigo (git pull)...")
        stdin, stdout, stderr = ssh.exec_command('cd /root/fastisp && git pull origin codex/mikrotik-diagnostics-mainline')
        print(stdout.read().decode('utf-8').strip())
        print(stderr.read().decode('utf-8').strip())
            
        # 2. Build the frontend container
        print("\nReconstruyendo el contenedor frontend (esto tomara unos minutos)...")
        stdin, stdout, stderr = ssh.exec_command('cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod build frontend')
        
        # Read output in real-time
        while True:
            line = stdout.readline()
            if not line:
                break
            sys.stdout.write(line)
            sys.stdout.flush()
            
        err = stderr.read().decode('utf-8')
        if err:
            print("\nSTDERR:", err)
            
        # 3. Recreate the container
        print("\nRecreando el contenedor frontend...")
        stdin, stdout, stderr = ssh.exec_command('cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-deps frontend')
        print(stdout.read().decode('utf-8').strip())
        print(stderr.read().decode('utf-8').strip())
            
        print("\n¡Despliegue completado exitosamente!")
    except Exception as e:
        print(f"\nError durante el despliegue: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    deploy()
