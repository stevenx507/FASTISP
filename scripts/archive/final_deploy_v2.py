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
                'desc': 'Reconstruyendo frontend (esto tomara unos minutos)',
                'cmd': 'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod build frontend'
            },
            {
                'desc': 'Reiniciando frontend',
                'cmd': 'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-deps frontend'
            },
            {
                'desc': 'Reiniciando backend para aplicar parches',
                'cmd': 'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod restart backend'
            }
        ]
        
        for item in commands:
            print(f"\n--- {item['desc']} ---")
            stdin, stdout, stderr = ssh.exec_command(item['cmd'])
            
            # Read output in real-time for build
            if 'build' in item['cmd']:
                while True:
                    line = stdout.readline()
                    if not line:
                        break
                    sys.stdout.write(line)
                    sys.stdout.flush()
            else:
                out = stdout.read().decode('utf-8').strip()
                if out: print(out)
            
            err = stderr.read().decode('utf-8').strip()
            if err: print(f"Info/Error: {err}")
            
            exit_status = stdout.channel.recv_exit_status()
            print(f"Estado de salida: {exit_status}")
            if exit_status != 0 and 'git' not in item['cmd']:
                 print("Error critico detectado. Abortando.")
                 break
                
        print("\n¡Despliegue completo y servicios reiniciados!")
    except Exception as e:
        print(f"\nError durante el despliegue: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    deploy()
