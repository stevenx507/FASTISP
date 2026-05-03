import paramiko
import time

def deploy():
    host = "fastisp.cloud"
    user = "root"
    password = "Ssfyber@tecno1"

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        print(f"Connecting to {host}...", flush=True)
        ssh.connect(host, username=user, password=password, timeout=15)
        print("Connected!", flush=True)

        # Buscar la carpeta del proyecto
        print("Locating project folder...", flush=True)
        # Buscamos archivos que solo el proyecto tendria
        stdin, stdout, stderr = ssh.exec_command("find / -name docker-compose.prod.yml -maxdepth 4 2>/dev/null | head -n 1")
        found = stdout.read().decode().strip()
        
        if not found:
            print("Trying common paths manually...", flush=True)
            for p in ["/root/FASTISP", "/home/noc/FASTISP", "/var/www/FASTISP", "/root/ispfast"]:
                _, stdout_p, _ = ssh.exec_command(f"ls {p}/docker-compose.prod.yml 2>/dev/null")
                if stdout_p.channel.recv_exit_status() == 0:
                    found = f"{p}/docker-compose.prod.yml"
                    break
        
        if not found:
            print("Error: Could not find project root on VPS.", flush=True)
            ssh.close()
            return

        project_path = found.replace("/docker-compose.prod.yml", "")
        print(f"Project found at: {project_path}", flush=True)

        commands = [
            f"cd {project_path} && git fetch origin codex/mikrotik-diagnostics-mainline",
            f"cd {project_path} && git reset --hard origin/codex/mikrotik-diagnostics-mainline",
            f"cd {project_path} && docker compose -f docker-compose.prod.yml up -d --build"
        ]

        for cmd in commands:
            print(f"Executing: {cmd}", flush=True)
            stdin, stdout, stderr = ssh.exec_command(cmd)
            
            # Usar un loop para leer la salida mientras el comando corre
            while not stdout.channel.exit_status_ready():
                if stdout.channel.recv_ready():
                    data = stdout.channel.recv(1024).decode()
                    print(data, end="", flush=True)
                if stdout.channel.recv_stderr_ready():
                    data = stdout.channel.recv_stderr(1024).decode()
                    print(data, end="", flush=True)
                time.sleep(0.1)
            
            # Leer lo que quede
            print(stdout.read().decode(), end="", flush=True)
            print(stderr.read().decode(), end="", flush=True)
            
            exit_status = stdout.channel.recv_exit_status()
            if exit_status != 0:
                print(f"Command failed with status {exit_status}", flush=True)
                break
        
        ssh.close()
        print("Deployment finished.", flush=True)

    except Exception as e:
        print(f"Error: {e}", flush=True)

if __name__ == "__main__":
    deploy()
