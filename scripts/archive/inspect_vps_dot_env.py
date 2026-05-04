import paramiko

def inspect_vps_dot_env():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1')
        cmd = "cat /root/fastisp/.env.prod"
        stdin, stdout, stderr = ssh.exec_command(cmd)
        print(".env.prod content on VPS:")
        print(stdout.read().decode('utf-8'))
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    inspect_vps_dot_env()
