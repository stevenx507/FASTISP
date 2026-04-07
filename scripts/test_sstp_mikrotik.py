#!/usr/bin/env python3
"""
test_sstp_mikrotik.py — Diagnóstico completo SSTP + MikroTik API
=================================================================
Simula el flujo completo sin crear datos reales en BD.

Uso (dentro del container o con PYTHONPATH=/app):
  docker exec fastisp-backend python /app/scripts/test_sstp_mikrotik.py

  # O con credenciales de un router específico:
  ROUTER_IP=192.168.1.1 ROUTER_USER=admin ROUTER_PASS=secret \
    docker exec -e ROUTER_IP -e ROUTER_USER -e ROUTER_PASS \
    fastisp-backend python /app/scripts/test_sstp_mikrotik.py
"""

import os
import sys
import subprocess
import socket
import json
import time
from datetime import datetime

# ── Colores de terminal ──────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
BLUE   = "\033[94m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def ok(msg):   print(f"  {GREEN}✔{RESET}  {msg}")
def fail(msg): print(f"  {RED}✘{RESET}  {msg}")
def warn(msg): print(f"  {YELLOW}⚠{RESET}  {msg}")
def info(msg): print(f"  {BLUE}ℹ{RESET}  {msg}")
def sep(title=""):
    line = "─" * 60
    if title:
        print(f"\n{BOLD}{line}{RESET}")
        print(f"{BOLD}  {title}{RESET}")
        print(f"{BOLD}{line}{RESET}")
    else:
        print(f"{BOLD}{line}{RESET}")

PASS = 0
FAIL = 0

def check(label, result, detail=""):
    global PASS, FAIL
    if result:
        ok(label + (f" — {detail}" if detail else ""))
        PASS += 1
    else:
        fail(label + (f" — {detail}" if detail else ""))
        FAIL += 1
    return result


# ════════════════════════════════════════════════════════════════════════════
# 1. Docker socket
# ════════════════════════════════════════════════════════════════════════════
sep("1. Docker Socket (necesario para docker exec a SoftEther)")

docker_socket = "/var/run/docker.sock"
socket_exists = os.path.exists(docker_socket)
check("Socket presente en container", socket_exists, docker_socket)

if socket_exists:
    try:
        result = subprocess.run(
            ["docker", "info", "--format", "{{.ServerVersion}}"],
            capture_output=True, text=True, timeout=10,
            stdin=subprocess.DEVNULL
        )
        docker_ok = result.returncode == 0
        check("Docker daemon accesible", docker_ok,
              result.stdout.strip() if docker_ok else result.stderr.strip()[:80])
    except FileNotFoundError:
        check("Docker CLI disponible", False, "docker binary no encontrado en container")
    except Exception as e:
        check("Docker daemon accesible", False, str(e)[:80])
else:
    warn("Sin Docker socket — docker exec a SoftEther fallará")
    warn("Agrega al backend en docker-compose.prod.yml:")
    warn("  volumes:")
    warn("    - /var/run/docker.sock:/var/run/docker.sock:ro")


# ════════════════════════════════════════════════════════════════════════════
# 2. SoftEther container
# ════════════════════════════════════════════════════════════════════════════
sep("2. SoftEther Container (fastisp-softether)")

SOFTETHER_CONTAINER = os.environ.get("SOFTETHER_CONTAINER", "fastisp-softether")

softether_running = False
try:
    r = subprocess.run(
        ["docker", "inspect", "--format", "{{.State.Running}}", SOFTETHER_CONTAINER],
        capture_output=True, text=True, timeout=10,
        stdin=subprocess.DEVNULL
    )
    softether_running = r.stdout.strip() == "true"
    check(f"Container '{SOFTETHER_CONTAINER}' corriendo", softether_running,
          r.stdout.strip() if softether_running else r.stderr.strip()[:80] or "no encontrado")
except Exception as e:
    check(f"Container '{SOFTETHER_CONTAINER}' corriendo", False, str(e)[:80])

if softether_running:
    # Verificar que vpncmd_api.sh existe en el container
    try:
        r = subprocess.run(
            ["docker", "exec", SOFTETHER_CONTAINER, "test", "-x", "/vpncmd_api.sh"],
            capture_output=True, text=True, timeout=15,
            stdin=subprocess.DEVNULL
        )
        script_ok = r.returncode == 0
        check("vpncmd_api.sh ejecutable en container", script_ok,
              "OK" if script_ok else "Falta — reconstruye con: docker compose build softether-vpn")
    except Exception as e:
        check("vpncmd_api.sh ejecutable en container", False, str(e)[:80])

    # Verificar que vpncmd binario existe (test -f avoids sh -c pipe hangs)
    vpncmd_found = False
    for vpncmd_candidate in ["/usr/vpnserver/vpncmd", "/opt/vpnserver/vpncmd"]:
        try:
            r = subprocess.run(
                ["docker", "exec", SOFTETHER_CONTAINER, "test", "-x", vpncmd_candidate],
                capture_output=True, text=True, timeout=15,
                stdin=subprocess.DEVNULL
            )
            if r.returncode == 0:
                vpncmd_found = True
                check("vpncmd binario encontrado en container", True, vpncmd_candidate)
                break
        except Exception:
            pass
    if not vpncmd_found:
        check("vpncmd binario encontrado en container", False,
              "No encontrado en /usr/vpnserver ni /opt/vpnserver")

    # Test server_status via vpncmd_api.sh (give vpncmd time to warm up)
    time.sleep(2)
    try:
        r = subprocess.run(
            ["docker", "exec", SOFTETHER_CONTAINER, "/vpncmd_api.sh", "server_status"],
            capture_output=True, text=True, timeout=60,
            stdin=subprocess.DEVNULL
        )
        status_ok = r.returncode == 0 and '"status"' in r.stdout
        check("vpncmd_api.sh server_status responde", status_ok,
              r.stdout.strip()[:100] if status_ok else (r.stderr.strip() or r.stdout.strip())[:100])
    except Exception as e:
        check("vpncmd_api.sh server_status", False, str(e)[:80])


# ════════════════════════════════════════════════════════════════════════════
# 3. Puerto SSTP 8443 accesible desde internet
# ════════════════════════════════════════════════════════════════════════════
sep("3. Puerto SSTP 8443 (lo ve el MikroTik desde afuera)")

SSTP_HOST = os.environ.get("SSTP_SERVER_HOST", "fastisp.cloud")
SSTP_PORT = int(os.environ.get("SSTP_SERVER_PORT", "8443"))

try:
    s = socket.create_connection((SSTP_HOST, SSTP_PORT), timeout=5)
    s.close()
    check(f"Puerto {SSTP_HOST}:{SSTP_PORT} alcanzable", True)
except OSError as e:
    check(f"Puerto {SSTP_HOST}:{SSTP_PORT} alcanzable", False, str(e))


# ════════════════════════════════════════════════════════════════════════════
# 4. Generación del script MikroTik
# ════════════════════════════════════════════════════════════════════════════
sep("4. Generación de script MikroTik SSTP")

try:
    sys.path.insert(0, "/app")
    from app.services.sstp_service import generate_mikrotik_sstp_script, generate_verification_script

    fake_prov = {
        "username": "sstp-test-diag",
        "password": "TestDiag1234",
        "server_host": SSTP_HOST,
        "server_port": SSTP_PORT,
        "server_ip": "10.100.0.1",
        "client_ip": "10.100.0.x",
        "router_name": "test-router",
        "provisioned_at": datetime.utcnow().isoformat(),
    }
    script = generate_mikrotik_sstp_script(fake_prov)

    # Verificaciones del script generado
    checks_script = [
        (f"connect-to={SSTP_HOST}" in script and f"port={SSTP_PORT}" in script,
         f"connect-to={SSTP_HOST} port={SSTP_PORT} (ROS 7 separados)"),
        ("address=" not in script.split("/ip service set api")[1].split("\n")[0]
         if "/ip service set api" in script else True,
         "API sin restriccion address= (no bloquea acceso antes del tunel)"),
        ("authentication=mschap2" in script and "keepalive-timeout=60" in script,
         "authentication + keepalive (config WispHub probada)"),
        ("verify-server-certificate=no" in script,
         "verify-server-certificate=no"),
    ]
    for result, label in checks_script:
        check(f"Script: {label}", result)

    # Verificar verification script
    vscript = generate_verification_script()
    check("Verification script: usa FastISPVPN", "FastISPVPN" in vscript)

    info(f"Script generado ({len(script)} bytes)")

except ImportError as e:
    check("Importar sstp_service", False, str(e))
except Exception as e:
    check("Generación de script", False, str(e))


# ════════════════════════════════════════════════════════════════════════════
# 5. Sesiones activas en SoftEther (VPN IPs asignadas)
# ════════════════════════════════════════════════════════════════════════════
sep("5. Sesiones SSTP activas en SoftEther")

if softether_running:
    time.sleep(2)
    try:
        r = subprocess.run(
            ["docker", "exec", SOFTETHER_CONTAINER, "/vpncmd_api.sh", "list_sessions"],
            capture_output=True, text=True, timeout=60,
            stdin=subprocess.DEVNULL
        )
        lines = [l for l in (r.stdout or "").strip().splitlines() if l.strip()]
        session_lines = [l for l in lines if "SES" in l or "sstp" in l.lower() or "VPN" in l]
        if session_lines:
            check("Sesiones SSTP activas", True, f"{len(session_lines)} sesion(es)")
            for s in session_lines[:5]:
                info(f"  {s.strip()}")
        else:
            check("Consulta de sesiones SoftEther", True,
                  "0 sesiones — ningún MikroTik conectado aún")
    except Exception as e:
        check("Consulta de sesiones", False, str(e)[:80])

    # Listar usuarios en SoftEther
    time.sleep(2)
    try:
        r = subprocess.run(
            ["docker", "exec", SOFTETHER_CONTAINER, "/vpncmd_api.sh", "list_users"],
            capture_output=True, text=True, timeout=60,
            stdin=subprocess.DEVNULL
        )
        if r.returncode == 0:
            try:
                data = json.loads(r.stdout)
                users = data.get("users", [])
                check("Usuarios SSTP en SoftEther", True,
                      f"{len(users)} usuario(s): {', '.join(users[:5]) if users else 'ninguno'}")
            except json.JSONDecodeError:
                info(f"list_users raw: {r.stdout.strip()[:120]}")
    except Exception as e:
        check("Lista de usuarios SoftEther", False, str(e)[:80])
else:
    warn("SoftEther no disponible — no se pueden listar sesiones")


# ════════════════════════════════════════════════════════════════════════════
# 6. MikroTik API (si se pasan ROUTER_IP / ROUTER_USER / ROUTER_PASS)
# ════════════════════════════════════════════════════════════════════════════
ROUTER_IP   = os.environ.get("ROUTER_IP", "")
ROUTER_USER = os.environ.get("ROUTER_USER", "admin")
ROUTER_PASS = os.environ.get("ROUTER_PASS", "")
ROUTER_PORT = int(os.environ.get("ROUTER_PORT", "8728"))


def _is_private_ip(ip: str) -> bool:
    try:
        import ipaddress
        return ipaddress.ip_address(ip).is_private
    except Exception:
        return False


sep(f"6. MikroTik API ({ROUTER_IP or 'saltado — pasa ROUTER_IP=<ip>'}")

if not ROUTER_IP:
    warn("Pasa ROUTER_IP, ROUTER_USER y ROUTER_PASS para probar la conexion real")
    print()
    print("  Si el router tiene IP PRIVADA (192.168.x / 172.x / 10.x):")
    print("    El backend NO puede alcanzarlo directamente.")
    print("    Debes pasar el VPN IP que SoftEther asignó (10.100.0.X)")
    print()
    print("  Ejemplo con VPN IP:")
    print(f"    docker exec \\")
    print(f"      -e ROUTER_IP=10.100.0.50 \\")
    print(f"      -e ROUTER_USER=sstp-turouter-xxxx \\")
    print(f"      -e ROUTER_PASS=TuPasswordSSTP \\")
    print(f"      fastisp-backend python /app/scripts/test_sstp_mikrotik.py")
else:
    is_private = _is_private_ip(ROUTER_IP)
    vpn_subnet  = os.environ.get("VPN_MGMT_SUBNET", "10.100.0.0/16")

    if is_private and not ROUTER_IP.startswith("10.100."):
        # IP privada que no es de la subred VPN
        print()
        print(f"  {YELLOW}{BOLD}⚠  ROUTER_IP {ROUTER_IP} es IP privada{RESET}")
        print(f"  El backend en el VPS NO puede alcanzarla directamente.")
        print(f"  Flujo correcto para router con IP privada:")
        print(f"    1. Aplica el script SSTP en WinBox (conexion local)")
        print(f"    2. Espera que el tunel SSTP conecte (~10s)")
        print(f"    3. Revisa el VPN IP en WinBox:")
        print(f"         /ip address print where interface=FastISPVPN")
        print(f"    4. Actualiza la IP del router en el sistema al VPN IP (10.100.0.X)")
        print(f"    5. Vuelve a correr este script con ROUTER_IP=10.100.0.X")
        print()
        warn("Saltando test de API (IP privada no alcanzable desde VPS)")
        FAIL += 1
    else:
        # IP pública o VPN IP — probar conexión
        try:
            s = socket.create_connection((ROUTER_IP, ROUTER_PORT), timeout=5)
            s.close()
            check(f"TCP {ROUTER_IP}:{ROUTER_PORT} alcanzable", True)
        except OSError as e:
            check(f"TCP {ROUTER_IP}:{ROUTER_PORT} alcanzable", False, str(e))
            if ROUTER_IP.startswith("10.100."):
                warn("Tunel SSTP no conectado aun — verifica que el MikroTik ejecuto el script")
            else:
                warn("Verifica firewall y que /ip service api no tenga address= restringido")

        try:
            import routeros_api
            pool = routeros_api.RouterOsApiPool(
                host=ROUTER_IP,
                username=ROUTER_USER,
                password=ROUTER_PASS,
                port=ROUTER_PORT,
                plaintext_login=True,
                use_ssl=False,
                timeout=8,
            )
            api = pool.get_api()
            identity = api.get_resource("/system/identity").get()
            name = identity[0].get("name", "?") if identity else "?"
            check("MikroTik API login exitoso", True, f"identity={name}")

            version_info = api.get_resource("/system/resource").get()
            ver = version_info[0].get("version", "?") if version_info else "?"
            check("RouterOS version leida", True, f"version={ver}")

            pool.disconnect()
        except Exception as e:
            check("MikroTik API login", False, str(e)[:120])


# ════════════════════════════════════════════════════════════════════════════
# Resumen
# ════════════════════════════════════════════════════════════════════════════
sep("Resumen")
total = PASS + FAIL
print(f"\n  {GREEN}{PASS}/{total} checks pasaron{RESET}   {RED}{FAIL} fallaron{RESET}\n")

if FAIL == 0:
    print(f"  {GREEN}{BOLD}✔ Todo OK — el flujo SSTP+MikroTik debería funcionar{RESET}\n")
else:
    print(f"  {RED}{BOLD}✘ Hay {FAIL} problema(s) que resolver antes de que funcione{RESET}\n")

sys.exit(0 if FAIL == 0 else 1)
