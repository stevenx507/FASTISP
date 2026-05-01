import paramiko

def inspect_vps_env():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1')
        cmd = "docker exec fastisp-backend-1 env | grep SSTP"
        stdin, stdout, stderr = ssh.exec_command(cmd)
        print("SSTP Environment Variables on VPS:")
        print(stdout.read().decode('utf-8'))
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    inspect_vps_env()
