import paramiko
import sys

def check():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1', timeout=10)
        
        print("=== Docker PS ===")
        stdin, stdout, stderr = ssh.exec_command('docker ps -a | grep fastisp-frontend', timeout=10)
        print(stdout.read().decode('utf-8').strip())
        
        print("=== OOM ===")
        stdin, stdout, stderr = ssh.exec_command('dmesg -T | grep -i oom | tail -n 10', timeout=10)
        print(stdout.read().decode('utf-8').strip())
        
        print("=== Build logs ===")
        # check if build is running by checking process list
        stdin, stdout, stderr = ssh.exec_command('ps aux | grep "docker compose" | grep build', timeout=10)
        print(stdout.read().decode('utf-8').strip())
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    check()
