import paramiko

def run_long(ssh, cmd, timeout=90):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors='replace').strip()
    err = stderr.read().decode(errors='replace').strip()
    print(f"$ {cmd[:80]}")
    if out: print(out)
    if err: print("STDERR:", err)
    print()
    return out

def rebuild():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print("Conectando al VPS...")
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1', timeout=10)
        
        print("=== Iniciando Build ===")
        # Build without cache to force UI updates
        run_long(ssh, 'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod build --no-cache frontend 2>&1', timeout=600)
        
        print("\n=== Recreando Contenedor ===")
        run_long(ssh, 'cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-deps frontend 2>&1', timeout=60)
            
        print("\n¡Frontend actualizado!")
    finally:
        ssh.close()

if __name__ == '__main__':
    rebuild()
