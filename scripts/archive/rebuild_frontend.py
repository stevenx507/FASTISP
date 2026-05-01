import paramiko
import sys

def rebuild():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print("Conectando al VPS...")
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1', timeout=10)
        
        # Build the frontend container
        print("Reconstruyendo el contenedor frontend (esto tomara unos minutos)...")
        stdin, stdout, stderr = ssh.exec_command('cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod build frontend')
        for line in iter(stdout.readline, ""):
            sys.stdout.write(line)
            
        err = stderr.read().decode('utf-8')
        if err:
            print("STDERR:", err)
            
        # Recreate the container
        print("\nRecreando el contenedor frontend...")
        stdin, stdout, stderr = ssh.exec_command('cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-deps frontend')
        print(stdout.read().decode('utf-8').strip())
        err = stderr.read().decode('utf-8')
        if err:
            print("STDERR:", err)
            
        print("\n¡Frontend actualizado!")
    finally:
        ssh.close()

if __name__ == '__main__':
    rebuild()
