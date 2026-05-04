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
                'desc': 'Arreglando archivo de migracion (agregando server_default)',
                'cmd': "cd /root/fastisp && sed -i \"s/sa.Column('status', sa.String(length=20), nullable=False)/sa.Column('status', sa.String(length=20), server_default='active', nullable=False)/g\" backend/migrations/versions/bec25090b394_add_status_column_to_client_and_update_.py"
            },
            {
                'desc': 'Aplicando migracion a DB',
                'cmd': 'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend flask db upgrade'
            },
            {
                'desc': 'Commiteando la migracion al repo en Github',
                'cmd': 'cd /root/fastisp && git add backend/migrations/versions/bec25090b394_add_status_column_to_client_and_update_.py && git commit -m "chore: add db migration for client status" && git push origin codex/mikrotik-diagnostics-mainline'
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
            if exit_status != 0 and 'Warning' not in err:
                 print("Error critico detectado. Abortando.")
                 break
                
        print("\n¡Migración de base de datos arreglada y completada!")
    except Exception as e:
        print(f"\nError durante el despliegue: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    deploy()
