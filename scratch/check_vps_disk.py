import paramiko

def check():
    host = "fastisp.cloud"
    user = "root"
    password = "Ssfyber@tecno1"
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(host, username=user, password=password, timeout=10)
        print("--- DF ---")
        _, stdout, _ = ssh.exec_command("df -h")
        print(stdout.read().decode())
        print("--- DOCKER SYSTEM DF ---")
        _, stdout, _ = ssh.exec_command("docker system df")
        print(stdout.read().decode())
        ssh.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check()
