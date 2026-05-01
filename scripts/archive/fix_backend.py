import paramiko

def fix_backend():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1')
        
        print("Attempting to start backend...")
        stdin, stdout, stderr = ssh.exec_command("docker start fastisp-backend-1")
        print(stdout.read().decode('utf-8'))
        print(stderr.read().decode('utf-8'))
        
        import time
        time.sleep(5)
        
        stdin, stdout, stderr = ssh.exec_command("docker ps -a | grep fastisp-backend-1")
        print("Container Status after start attempt:")
        print(stdout.read().decode('utf-8'))
        
        print("\nLogs after start attempt:")
        stdin, stdout, stderr = ssh.exec_command("docker logs --tail 50 fastisp-backend-1")
        print(stdout.read().decode('utf-8'))
        print(stderr.read().decode('utf-8'))
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    fix_backend()
