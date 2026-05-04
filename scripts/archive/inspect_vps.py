import paramiko

def inspect_vps():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect('187.77.47.232', port=22, username='root', password='Ssfyber@tecno1')
        cmd = "docker exec fastisp-backend-1 cat /app/app/services/sstp_service.py"
        stdin, stdout, stderr = ssh.exec_command(cmd)
        content = stdout.read().decode('utf-8')
        
        lines = content.split('\n')
        for i, line in enumerate(lines):
            if 'def generate_mikrotik_hub_client_script' in line:
                print(f"Found function at line {i+1}")
                for j in range(i, min(i+10, len(lines))):
                    print(lines[j])
                break
        else:
            print("Function not found in file!")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    inspect_vps()
