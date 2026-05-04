import paramiko
import sys

def deploy():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print("Conectando al VPS...")
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1', timeout=60)
        
        commands = [
            {
                'desc': 'Sincronizando codigo (git pull)',
                'cmd': 'cd /root/fastisp && git pull origin codex/mikrotik-diagnostics-mainline'
            },
            {
                'desc': 'Reconstruyendo backend',
                'cmd': 'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod build backend celery-worker celery-beat'
            },
            {
                'desc': 'Reiniciando backend',
                'cmd': 'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-deps backend celery-worker celery-beat'
            },
            {
                'desc': 'Generando migracion Alembic',
                'cmd': 'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend flask db migrate -m "Add status column to Client and update datetimes"'
            },
            {
                'desc': 'Aplicando migracion a DB',
                'cmd': 'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend flask db upgrade'
            }
        ]
        
        for item in commands:
            print(f"\n--- {item['desc']} ---")
            stdin, stdout, stderr = ssh.exec_command(item['cmd'])
            
            # Read output in real-time
            while True:
                line = stdout.readline()
                if not line:
                    break
                sys.stdout.write(line)
                sys.stdout.flush()
            
            err = stderr.read().decode('utf-8').strip()
            if err: print(f"Info/Error: {err}")
            
            exit_status = stdout.channel.recv_exit_status()
            print(f"Estado de salida: {exit_status}")
            if exit_status != 0 and 'git' not in item['cmd'] and 'Warning' not in err:
                 print("Error critico detectado. Abortando.")
                 break
                
        print("\n¡Migración de base de datos completada con éxito!")
    except Exception as e:
        print(f"\nError durante el despliegue: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    deploy()
