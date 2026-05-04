import paramiko

def check_backend_health():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1')
        
        # Check container status
        stdin, stdout, stderr = ssh.exec_command("docker ps -a | grep fastisp-backend-1")
        print("Container Status:")
        print(stdout.read().decode('utf-8'))
        
        # Check logs
        print("\nLast 50 lines of logs:")
        stdin, stdout, stderr = ssh.exec_command("docker logs --tail 50 fastisp-backend-1")
        print(stdout.read().decode('utf-8'))
        print(stderr.read().decode('utf-8'))
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    check_backend_health()
