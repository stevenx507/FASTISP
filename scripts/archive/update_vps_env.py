import paramiko

def update_vps_env():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1')
        
        # Cambiar SSTP_SERVER_PORT de 443 a 8443
        cmd = "sed -i 's/SSTP_SERVER_PORT=443/SSTP_SERVER_PORT=8443/g' /root/fastisp/.env.prod"
        ssh.exec_command(cmd)
        
        # Verificar cambio
        stdin, stdout, stderr = ssh.exec_command("grep SSTP_SERVER_PORT /root/fastisp/.env.prod")
        print("Updated .env.prod line:")
        print(stdout.read().decode('utf-8'))
        
        # Reiniciar backend para tomar el cambio
        print("Restarting backend...")
        ssh.exec_command("cd /root/fastisp && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-deps backend celery-worker celery-beat")
        print("Backend restarted.")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    update_vps_env()
