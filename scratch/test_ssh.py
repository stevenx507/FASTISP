import paramiko
import sys

def test():
    host = "fastisp.cloud"
    password = "Ssfyber@tecno1"
    
    for user in ["root", "noc"]:
        print(f"Trying {user}...", flush=True)
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            ssh.connect(host, username=user, password=password, timeout=5)
            print(f"SUCCESS_{user.upper()}", flush=True)
            ssh.close()
            return
        except Exception as e:
            print(f"FAILED {user}: {e}", flush=True)

if __name__ == "__main__":
    test()
