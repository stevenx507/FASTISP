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
            capture_output=True, text=True, timeout=5
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
        capture_output=True, text=True, timeout=5
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
            capture_output=True, text=True, timeout=5
        )
        script_ok = r.returncode == 0
        check("vpncmd_api.sh ejecutable en container", script_ok,
              "OK" if script_ok else "Falta — reconstruye con: docker compose build softether-vpn")
    except Exception as e:
        check("vpncmd_api.sh ejecutable en container", False, str(e)[:80])

    # Verificar que vpncmd binario existe
    try:
        r = subprocess.run(
            ["docker", "exec", SOFTETHER_CONTAINER, "sh", "-c",
             "ls /usr/vpnserver/vpncmd /opt/vpnserver/vpncmd 2>/dev/null | head -1"],
            capture_output=True, text=True, timeout=5
        )
        vpncmd_path = r.stdout.strip()
        check("vpncmd binario encontrado en container", bool(vpncmd_path),
              vpncmd_path or "No encontrado en /usr/vpnserver ni /opt/vpnserver")
    except Exception as e:
        check("vpncmd binario encontrado", False, str(e)[:80])

    # Test server_status via vpncmd_api.sh
    try:
        r = subprocess.run(
            ["docker", "exec", SOFTETHER_CONTAINER, "/vpncmd_api.sh", "server_status"],
            capture_output=True, text=True, timeout=15
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
        (f"connect-to={SSTP_HOST}:{SSTP_PORT}" in script,
         f"connect-to usa host:port ({SSTP_HOST}:{SSTP_PORT})"),
        ("address=" not in script.split("/ip service set api")[1].split("\n")[0]
         if "/ip service set api" in script else True,
         "API sin restriccion address= (no bloquea acceso antes del tunel)"),
        (":do {" in script,
         "Limpieza con :do {} on-error={} (no aborta si falta objeto)"),
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
# 5. MikroTik API (si se pasan ROUTER_IP / ROUTER_USER / ROUTER_PASS)
# ════════════════════════════════════════════════════════════════════════════
ROUTER_IP   = os.environ.get("ROUTER_IP", "")
ROUTER_USER = os.environ.get("ROUTER_USER", "admin")
ROUTER_PASS = os.environ.get("ROUTER_PASS", "")
ROUTER_PORT = int(os.environ.get("ROUTER_PORT", "8728"))

sep(f"5. MikroTik API ({ROUTER_IP or 'saltado — pasa ROUTER_IP=<ip>'})")

if not ROUTER_IP:
    warn("Pasa ROUTER_IP, ROUTER_USER y ROUTER_PASS para probar la conexión real")
    warn("Ejemplo:")
    warn(f"  docker exec -e ROUTER_IP=x.x.x.x -e ROUTER_USER=admin -e ROUTER_PASS=secret \\")
    warn(f"    fastisp-backend python /app/scripts/test_sstp_mikrotik.py")
else:
    # TCP reachability
    try:
        s = socket.create_connection((ROUTER_IP, ROUTER_PORT), timeout=5)
        s.close()
        check(f"TCP {ROUTER_IP}:{ROUTER_PORT} alcanzable", True)
    except OSError as e:
        check(f"TCP {ROUTER_IP}:{ROUTER_PORT} alcanzable", False, str(e))
        warn("Puede ser que /ip service set api address= esté restringido")
        warn("Desde WinBox ejecuta: /ip service set api address=\"\"")

    # API login
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
        check("RouterOS version leída", True, f"version={ver}")

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
