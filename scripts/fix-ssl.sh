#!/bin/bash
# ============================================================
# fix-ssl.sh — Diagnóstico y reparación SSL para fastisp.cloud
# Ejecutar en el VPS: bash fix-ssl.sh
# ============================================================
set -euo pipefail

DOMAIN="${1:-fastisp.cloud}"
API_DOMAIN="api.${DOMAIN}"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"
ACME_FILE="./letsencrypt/acme.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }

echo ""
echo "============================================================"
echo "  FASTISP SSL Diagnostic & Repair — ${DOMAIN}"
echo "============================================================"
echo ""

# ── 1. Verificar puertos ──────────────────────────────────────
info "Verificando puertos 80 y 443..."
if ss -tlnp | grep -q ':80 '; then
    ok "Puerto 80 escuchando"
else
    error "Puerto 80 NO está escuchando — Traefik no puede completar el HTTP challenge"
fi

if ss -tlnp | grep -q ':443 '; then
    ok "Puerto 443 escuchando"
else
    error "Puerto 443 NO está escuchando — HTTPS no disponible"
fi

# ── 2. Verificar firewall ─────────────────────────────────────
info "Verificando firewall (ufw/iptables)..."
if command -v ufw &>/dev/null; then
    UFW_STATUS=$(ufw status 2>/dev/null || echo "inactive")
    echo "  UFW: $UFW_STATUS"
    if echo "$UFW_STATUS" | grep -q "Status: active"; then
        if ! ufw status | grep -qE "443.*ALLOW|HTTPS.*ALLOW"; then
            warn "Puerto 443 puede estar bloqueado por UFW"
            echo ""
            echo "  Ejecuta para abrir:"
            echo "    sudo ufw allow 80/tcp"
            echo "    sudo ufw allow 443/tcp"
            echo "    sudo ufw reload"
        else
            ok "UFW permite 443"
        fi
    fi
fi

# ── 3. Verificar Traefik corriendo ────────────────────────────
info "Verificando contenedor Traefik..."
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qi traefik; then
    ok "Traefik está corriendo"
    TRAEFIK_CONTAINER=$(docker ps --format '{{.Names}}' | grep -i traefik | head -1)
    echo ""
    info "Últimas líneas de logs de Traefik:"
    docker logs "$TRAEFIK_CONTAINER" --tail 30 2>&1 | grep -iE "error|acme|certificate|tls|level=error|msg=" || true
else
    error "Traefik NO está corriendo"
    echo "  Ejecuta: docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} up -d traefik"
fi

# ── 4. Verificar acme.json ────────────────────────────────────
echo ""
info "Verificando certificados Let's Encrypt (acme.json)..."
if [ -f "$ACME_FILE" ]; then
    ACME_SIZE=$(stat -c%s "$ACME_FILE" 2>/dev/null || echo 0)
    ACME_PERMS=$(stat -c%a "$ACME_FILE" 2>/dev/null || echo "???")
    echo "  Tamaño: ${ACME_SIZE} bytes | Permisos: ${ACME_PERMS}"

    if [ "$ACME_PERMS" != "600" ]; then
        warn "Permisos incorrectos en acme.json (debe ser 600)"
        echo "  Corrigiendo..."
        chmod 600 "$ACME_FILE"
        ok "Permisos corregidos a 600"
    else
        ok "Permisos de acme.json correctos (600)"
    fi

    if [ "$ACME_SIZE" -lt 100 ]; then
        warn "acme.json está vacío o muy pequeño — el certificado aún no se ha emitido"
        echo ""
        echo "  Posibles causas:"
        echo "  1. El dominio ${DOMAIN} no apunta a la IP de este servidor"
        echo "  2. El puerto 80 está bloqueado (necesario para HTTP challenge)"
        echo "  3. Rate limit de Let's Encrypt (espera 1 hora)"
        echo ""
        echo "  Verifica que el DNS apunta aquí:"
        echo "    dig +short ${DOMAIN}"
        echo "    curl -s http://${DOMAIN}/.well-known/acme-challenge/test"
    else
        ok "acme.json tiene contenido (${ACME_SIZE} bytes)"
        # Verificar si el dominio está en el certificado
        if command -v python3 &>/dev/null; then
            python3 -c "
import json, sys
try:
    with open('${ACME_FILE}') as f:
        data = json.load(f)
    certs = []
    for resolver in data.values():
        for cert in resolver.get('Certificates', []):
            domain = cert.get('domain', {}).get('main', '')
            sans = cert.get('domain', {}).get('sans', [])
            certs.append(domain)
            certs.extend(sans)
    if '${DOMAIN}' in certs or 'fastisp.cloud' in str(certs):
        print('  [OK] Certificado para ${DOMAIN} encontrado en acme.json')
    else:
        print('  [WARN] ${DOMAIN} NO encontrado en acme.json. Dominios actuales:', certs[:5])
except Exception as e:
    print('  [WARN] No se pudo parsear acme.json:', e)
" 2>/dev/null || true
        fi
    fi
else
    warn "acme.json no existe en ${ACME_FILE}"
    echo "  Creando directorio y archivo vacío con permisos correctos..."
    mkdir -p ./letsencrypt
    touch ./letsencrypt/acme.json
    chmod 600 ./letsencrypt/acme.json
    ok "Creado ./letsencrypt/acme.json con permisos 600"
fi

# ── 5. Verificar DNS ──────────────────────────────────────────
echo ""
info "Verificando DNS para ${DOMAIN}..."
SERVER_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo "desconocida")
DNS_IP=$(dig +short "${DOMAIN}" 2>/dev/null | tail -1 || nslookup "${DOMAIN}" 2>/dev/null | grep 'Address:' | tail -1 | awk '{print $2}' || echo "no resuelto")
echo "  IP del servidor: ${SERVER_IP}"
echo "  IP en DNS:       ${DNS_IP}"
if [ "$SERVER_IP" = "$DNS_IP" ]; then
    ok "DNS apunta correctamente a este servidor"
else
    warn "DNS (${DNS_IP}) NO coincide con IP del servidor (${SERVER_IP})"
    echo "  Actualiza el registro A de ${DOMAIN} a ${SERVER_IP} en tu proveedor DNS"
fi

# ── 6. Verificar redirect HTTP→HTTPS ─────────────────────────
echo ""
info "Verificando redirect HTTP → HTTPS..."
HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}" --max-time 5 "http://${DOMAIN}" 2>/dev/null || echo "timeout")
echo "  HTTP response: ${HTTP_RESPONSE}"
if echo "$HTTP_RESPONSE" | grep -q "301\|302"; then
    ok "Redirect HTTP→HTTPS funcionando"
else
    warn "No hay redirect HTTP→HTTPS — Traefik puede no estar configurado correctamente"
fi

# ── 7. Verificar HTTPS ────────────────────────────────────────
echo ""
info "Verificando HTTPS en ${DOMAIN}..."
HTTPS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${DOMAIN}" 2>/dev/null || echo "timeout/error")
if [ "$HTTPS_CODE" = "200" ] || [ "$HTTPS_CODE" = "301" ] || [ "$HTTPS_CODE" = "302" ]; then
    ok "HTTPS responde con código ${HTTPS_CODE}"
else
    error "HTTPS no responde correctamente (código: ${HTTPS_CODE})"
fi

# ── 8. Solución automática: forzar renovación ─────────────────
echo ""
echo "============================================================"
echo "  ACCIONES RECOMENDADAS"
echo "============================================================"
echo ""
echo "  Si el certificado no se emitió, ejecuta en orden:"
echo ""
echo "  1) Asegúrate que el DNS apunta a este servidor"
echo "     dig +short ${DOMAIN}"
echo ""
echo "  2) Abre los puertos en el firewall:"
echo "     sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw reload"
echo ""
echo "  3) Borra el acme.json para forzar re-emisión:"
echo "     sudo rm -f ./letsencrypt/acme.json"
echo "     sudo touch ./letsencrypt/acme.json"
echo "     sudo chmod 600 ./letsencrypt/acme.json"
echo ""
echo "  4) Reinicia Traefik:"
echo "     docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} restart traefik"
echo ""
echo "  5) Espera 30-60 segundos y verifica:"
echo "     docker compose -f ${COMPOSE_FILE} logs -f traefik 2>&1 | grep -i acme"
echo ""
echo "  6) Si hay rate limit de Let's Encrypt, usa staging primero:"
echo "     Agrega en docker-compose.prod.yml en traefik command:"
echo "     - --certificatesresolvers.myresolver.acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory"
echo ""
echo "  7) Verifica que TRAEFIK_ACME_EMAIL esté configurado en .env.prod"
echo ""

# ── 9. Verificar variable TRAEFIK_ACME_EMAIL ─────────────────
if [ -f "$ENV_FILE" ]; then
    if grep -q "TRAEFIK_ACME_EMAIL" "$ENV_FILE"; then
        ACME_EMAIL=$(grep "TRAEFIK_ACME_EMAIL" "$ENV_FILE" | cut -d= -f2 | tr -d '"' | tr -d "'")
        if [ -z "$ACME_EMAIL" ] || [ "$ACME_EMAIL" = "" ]; then
            error "TRAEFIK_ACME_EMAIL está vacío en ${ENV_FILE}"
        else
            ok "TRAEFIK_ACME_EMAIL configurado: ${ACME_EMAIL}"
        fi
    else
        error "TRAEFIK_ACME_EMAIL no está en ${ENV_FILE}"
        echo "  Agrega: TRAEFIK_ACME_EMAIL=tu@email.com"
    fi
fi

echo ""
echo "============================================================"
echo "  Script completado. Revisa los [ERROR] y [WARN] arriba."
echo "============================================================"
echo ""
