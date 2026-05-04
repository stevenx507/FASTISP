#!/usr/bin/env python3
"""
test_sstp_mikrotik.py — Diagnostico completo SSTP Nativo MikroTik
==================================================================
Verifica el flujo completo de conexion: backend → MikroTik API.
Arquitectura: MikroTik ES el servidor SSTP (estilo Wispro).

Uso (dentro del container o con PYTHONPATH=/app):
  docker exec fastisp-backend python /app/scripts/test_sstp_mikrotik.py

  # Con credenciales de un router especifico:
  ROUTER_IP=203.0.113.5 ROUTER_USER=admin ROUTER_PASS=secret \
    docker exec -e ROUTER_IP -e ROUTER_USER -e ROUTER_PASS \
    fastisp-backend python /app/scripts/test_sstp_mikrotik.py
"""

import os
import sys
import socket
import time
import ipaddress
from datetime import datetime

# ── Colores de terminal ──────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
BLUE   = "\033[94m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def ok(msg):   print(f"  {GREEN}OK{RESET}  {msg}")
def fail(msg): print(f"  {RED}FAIL{RESET}  {msg}")
def warn(msg): print(f"  {YELLOW}WARN{RESET}  {msg}")
def info(msg): print(f"  {BLUE}INFO{RESET}  {msg}")
def sep(title=""):
    line = "-" * 60
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
        ok(label + (f" -- {detail}" if detail else ""))
        PASS += 1
    else:
        fail(label + (f" -- {detail}" if detail else ""))
        FAIL += 1
    return result


# ════════════════════════════════════════════════════════════════════════════
# 1. Configuracion SSTP Nativo
# ════════════════════════════════════════════════════════════════════════════
sep("1. Configuracion SSTP Nativo MikroTik")

try:
    sys.path.insert(0, os.environ.get("APP_DIR", "/app"))
    from app.services.sstp_service import (
        SSTP_SERVER_PORT, SSTP_SERVER_HOST, SSTP_POOL_START, SSTP_POOL_END,
        SSTP_LOCAL_ADDRESS, SSTP_PROFILE_NAME, SSTP_POOL_NAME,
        SSTP_CA_NAME, SSTP_CERT_NAME, SSTP_API_GROUP_NAME,
        SSTP_TLS_VERSION, SSTP_CIPHERS, SSTP_PFS,
    )
    check("sstp_service importado", True)
    info(f"SSTP_SERVER_HOST = {SSTP_SERVER_HOST}")
    info(f"SSTP_SERVER_PORT = {SSTP_SERVER_PORT}")
    info(f"SSTP_POOL        = {SSTP_POOL_START} - {SSTP_POOL_END}")
    info(f"SSTP_LOCAL_ADDR  = {SSTP_LOCAL_ADDRESS}")
    info(f"SSTP_PROFILE     = {SSTP_PROFILE_NAME}")
    info(f"SSTP_TLS         = {SSTP_TLS_VERSION}, ciphers={SSTP_CIPHERS}, pfs={SSTP_PFS}")
    info(f"SSTP_CA/CERT     = {SSTP_CA_NAME} / {SSTP_CERT_NAME}")
    info(f"API_GROUP        = {SSTP_API_GROUP_NAME}")

    # Validar pool IPs
    try:
        start = ipaddress.ip_address(SSTP_POOL_START)
        end = ipaddress.ip_address(SSTP_POOL_END)
        local = ipaddress.ip_address(SSTP_LOCAL_ADDRESS)
        check("Pool IP valido", int(start) < int(end), f"{start} < {end}")
        check("Local address fuera del pool", int(local) < int(start) or int(local) > int(end),
              f"{local} no colisiona con pool")
    except Exception as e:
        check("Pool IP valido", False, str(e)[:80])

except ImportError as e:
    check("sstp_service importado", False, str(e))
    SSTP_SERVER_HOST = os.environ.get("SSTP_SERVER_HOST", "fastisp.cloud")
    SSTP_SERVER_PORT = int(os.environ.get("SSTP_SERVER_PORT", "443"))
    warn("Usando valores por defecto de env vars")


# ════════════════════════════════════════════════════════════════════════════
# 2. Generacion del script RouterOS
# ════════════════════════════════════════════════════════════════════════════
sep("2. Generacion de script RouterOS SSTP Nativo")

try:
    from app.services.sstp_service import generate_mikrotik_sstp_script

    fake_prov = {
        "username": "sstp-test-diag",
        "password": "TestDiag1234!",
        "server_host": "203.0.113.1",
        "server_port": SSTP_SERVER_PORT,
        "server_ip": SSTP_LOCAL_ADDRESS,
        "client_ip": SSTP_POOL_START,
        "router_name": "test-router-diag",
        "provisioned_at": datetime.now(timezone.utc).isoformat(),
    }
    script = generate_mikrotik_sstp_script(fake_prov)

    checks_script = [
        ("sstp-server server set enabled=yes" in script.lower() or "/interface sstp-server server" in script,
         "Habilita servidor SSTP nativo en MikroTik"),
        (SSTP_PROFILE_NAME in script,
         f"Usa perfil PPP '{SSTP_PROFILE_NAME}'"),
        (":local fUser" in script,
         "Usa :local vars para evitar errores de paste buffer"),
        ("/ppp secret add" in script,
         "Crea PPP secret de gestion"),
        ("/ip service set api" in script,
         "Habilita servicio API en MikroTik"),
        ("/certificate" in script,
         "Genera certificados CA + servidor"),
        (SSTP_CA_NAME in script,
         f"Nombre CA: {SSTP_CA_NAME}"),
    ]
    for result, label in checks_script:
        check(f"Script: {label}", result)

    info(f"Script generado ({len(script)} bytes, {len(script.splitlines())} lineas)")

except ImportError as e:
    check("Importar generate_mikrotik_sstp_script", False, str(e))
except Exception as e:
    check("Generacion de script", False, str(e))

# Verification script
try:
    from app.services.sstp_service import generate_verification_script
    vscript = generate_verification_script()
    check("Verification script generado", bool(vscript), f"{len(vscript)} bytes")
except Exception as e:
    check("Verification script", False, str(e)[:80])


# ════════════════════════════════════════════════════════════════════════════
# 3. DNS resolution del host SSTP
# ════════════════════════════════════════════════════════════════════════════
sep(f"3. Resolucion DNS de {SSTP_SERVER_HOST}")

try:
    t0 = time.perf_counter()
    resolved = socket.getaddrinfo(SSTP_SERVER_HOST, SSTP_SERVER_PORT,
                                   type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
    dns_ms = round((time.perf_counter() - t0) * 1000, 1)
    addrs = list(set(str(sa[0]) for _, _, _, _, sa in resolved if sa))
    check(f"DNS resuelto: {SSTP_SERVER_HOST}", bool(addrs),
          f"{', '.join(addrs[:3])} ({dns_ms}ms)")
except socket.gaierror as e:
    check(f"DNS resuelto: {SSTP_SERVER_HOST}", False, str(e))
    warn("El MikroTik no podra resolver el host SSTP. Verifica DNS o usa IP directa.")


# ════════════════════════════════════════════════════════════════════════════
# 4. MikroTik API — conexion real (requiere ROUTER_IP)
# ════════════════════════════════════════════════════════════════════════════
ROUTER_IP   = os.environ.get("ROUTER_IP", "")
ROUTER_USER = os.environ.get("ROUTER_USER", "admin")
ROUTER_PASS = os.environ.get("ROUTER_PASS", "")
ROUTER_PORT = int(os.environ.get("ROUTER_PORT", "8728"))

sep(f"4. MikroTik API ({ROUTER_IP or 'omitido -- pasa ROUTER_IP=<ip>'})")

if not ROUTER_IP:
    warn("Pasa ROUTER_IP, ROUTER_USER y ROUTER_PASS para probar conexion real")
    print()
    info("Ejemplo:")
    info("  docker exec \\")
    info("    -e ROUTER_IP=203.0.113.5 \\")
    info("    -e ROUTER_USER=admin \\")
    info("    -e ROUTER_PASS=TuPassword \\")
    info("    fastisp-backend python /app/scripts/test_sstp_mikrotik.py")
    print()
    info("Si el router tiene IP privada, primero debes:")
    info("  1. Provisionar SSTP desde el panel")
    info("  2. Pegar el script en Winbox New Terminal")
    info("  3. Esperar que el PPP secret se active")
    info("  4. Usar la IP publica/DDNS del router para la API")
else:
    try:
        ip_obj = ipaddress.ip_address(ROUTER_IP)
        is_private = ip_obj.is_private
        is_loopback = ip_obj.is_loopback
    except ValueError:
        is_private = False
        is_loopback = False

    if is_loopback:
        warn(f"ROUTER_IP={ROUTER_IP} es loopback -- no se puede alcanzar un router real")
    elif is_private:
        warn(f"ROUTER_IP={ROUTER_IP} es IP privada")
        info("El backend en VPS solo puede alcanzar IPs privadas si:")
        info("  - Estan en la misma red (VPN, WireGuard, BTH)")
        info("  - O hay port forwarding/NAT desde IP publica")
        print()

    # 4a. TCP port reachable
    info(f"Probando TCP {ROUTER_IP}:{ROUTER_PORT}...")
    tcp_ok = False
    try:
        t0 = time.perf_counter()
        s = socket.create_connection((ROUTER_IP, ROUTER_PORT), timeout=5)
        tcp_ms = round((time.perf_counter() - t0) * 1000, 1)
        s.close()
        tcp_ok = True
        check(f"TCP {ROUTER_IP}:{ROUTER_PORT} alcanzable", True, f"{tcp_ms}ms")
    except OSError as e:
        check(f"TCP {ROUTER_IP}:{ROUTER_PORT} alcanzable", False, str(e))
        warn("Verifica que:")
        warn(f"  1. El servicio API este habilitado: /ip service set api port={ROUTER_PORT} disabled=no")
        warn(f"  2. El firewall no bloquee el puerto {ROUTER_PORT} desde la IP del backend")
        warn(f"  3. Si usas API-SSL (8729), pasa ROUTER_PORT=8729")

    # 4b. API login
    if tcp_ok:
        info(f"Intentando API login como '{ROUTER_USER}'...")
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

            # Identity
            identity = api.get_resource("/system/identity").get()
            name = identity[0].get("name", "?") if identity else "?"
            check("API login exitoso", True, f"identity={name}")

            # RouterOS version
            res_info = api.get_resource("/system/resource").get()
            ver = res_info[0].get("version", "?") if res_info else "?"
            arch = res_info[0].get("architecture-name", "?") if res_info else "?"
            board = res_info[0].get("board-name", "?") if res_info else "?"
            check("RouterOS info", True, f"v{ver} {arch} ({board})")

            # Check if API service is enabled
            api_svc = api.get_resource("/ip/service").get()
            api_entry = next((s for s in api_svc if s.get("name") == "api"), None)
            if api_entry:
                api_disabled = api_entry.get("disabled", "false") == "true"
                api_port = api_entry.get("port", "8728")
                api_address = api_entry.get("address", "")
                check("Servicio API habilitado", not api_disabled,
                      f"port={api_port}" + (f", address={api_address}" if api_address else ", sin restriccion address"))
                if api_address:
                    warn(f"API tiene restriccion address={api_address}")
                    warn("Asegurate que la IP del backend/VPS este incluida")

            # Check SSTP server status
            try:
                sstp_svc = api.get_resource("/interface/sstp-server/server").get()
                if sstp_svc:
                    sstp = sstp_svc[0]
                    sstp_enabled = sstp.get("enabled", "false") == "true"
                    sstp_port = sstp.get("port", "443")
                    sstp_cert = sstp.get("certificate", "none")
                    check("Servidor SSTP nativo", sstp_enabled,
                          f"port={sstp_port}, cert={sstp_cert}")
                    if not sstp_enabled:
                        info("Servidor SSTP no habilitado -- ejecuta el script de provisioning primero")
                else:
                    info("No se pudo leer configuracion SSTP server")
            except Exception:
                info("SSTP server info no disponible (puede requerir RouterOS 6.x+)")

            # Check PPP secrets (FastISP)
            try:
                ppp_secrets = api.get_resource("/ppp/secret").get()
                fastisp_secrets = [s for s in ppp_secrets
                                   if "fastisp" in (s.get("comment", "") or "").lower()
                                   or (s.get("name", "") or "").startswith("sstp-")]
                check("PPP secrets FastISP", True,
                      f"{len(fastisp_secrets)} secret(s) de gestion" if fastisp_secrets
                      else "0 secrets -- provisiona primero")
                for sec in fastisp_secrets[:3]:
                    info(f"  secret: {sec.get('name', '?')} service={sec.get('service', '?')} "
                         f"profile={sec.get('profile', '?')}")
            except Exception:
                info("No se pudieron leer PPP secrets (permisos?)")

            # Check PPP active sessions
            try:
                ppp_active = api.get_resource("/ppp/active").get()
                sstp_active = [s for s in ppp_active if s.get("service") == "sstp"]
                check("Sesiones PPP/SSTP activas", True,
                      f"{len(sstp_active)} sesion(es) SSTP de {len(ppp_active)} total")
            except Exception:
                info("No se pudieron leer sesiones PPP activas")

            pool.disconnect()

        except ImportError:
            check("routeros_api disponible", False,
                  "pip install routeros_api -- necesario para conexion API")
        except Exception as e:
            error_str = str(e)[:120]
            check("API login", False, error_str)
            if "invalid user" in error_str.lower() or "cannot log" in error_str.lower():
                warn("Credenciales incorrectas. Verifica ROUTER_USER y ROUTER_PASS")
                warn(f"Usuario: {ROUTER_USER}")
            elif "timed out" in error_str.lower():
                warn("Timeout en handshake API -- el puerto responde pero no completa la sesion")
                warn("Posibles causas: API-SSL en puerto no-SSL, firewall intermedio, RouterOS colgado")


# ════════════════════════════════════════════════════════════════════════════
# 5. SSTP port (443) accesible en el router
# ════════════════════════════════════════════════════════════════════════════
if ROUTER_IP:
    SSTP_CHECK_PORT = int(os.environ.get("SSTP_SERVER_PORT", "443"))
    sep(f"5. Puerto SSTP {SSTP_CHECK_PORT} en router {ROUTER_IP}")

    try:
        t0 = time.perf_counter()
        s = socket.create_connection((ROUTER_IP, SSTP_CHECK_PORT), timeout=5)
        ms = round((time.perf_counter() - t0) * 1000, 1)
        s.close()
        check(f"SSTP {ROUTER_IP}:{SSTP_CHECK_PORT} accesible", True, f"{ms}ms")
    except OSError as e:
        check(f"SSTP {ROUTER_IP}:{SSTP_CHECK_PORT} accesible", False, str(e))
        info("Si el servidor SSTP aun no esta provisionado, esto es esperado.")
        info("Ejecuta primero el script de provisioning en Winbox.")


# ════════════════════════════════════════════════════════════════════════════
# Resumen
# ════════════════════════════════════════════════════════════════════════════
sep("Resumen")
total = PASS + FAIL
print(f"\n  {GREEN}{PASS}/{total} checks pasaron{RESET}   {RED}{FAIL} fallaron{RESET}\n")

if FAIL == 0:
    print(f"  {GREEN}{BOLD}Todo OK -- el flujo SSTP nativo MikroTik esta listo{RESET}\n")
else:
    print(f"  {RED}{BOLD}Hay {FAIL} problema(s) que resolver{RESET}\n")

sys.exit(0 if FAIL == 0 else 1)
