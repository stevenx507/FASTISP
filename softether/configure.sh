#!/bin/bash
# configure.sh - Configuración inicial de SoftEther VPN Server
# Se ejecuta solo la primera vez que arranca el contenedor

VPNCMD="/opt/vpnserver/vpncmd"
HOST="localhost:${SOFTETHER_MGMT_PORT:-5555}"
ADMIN_PASS="${SOFTETHER_ADMIN_PASSWORD:-FastISP_VPN_2026!}"
HUB="${SOFTETHER_HUB_NAME:-FASTISP}"
HUB_PASS="${SOFTETHER_HUB_PASSWORD:-FastISP_Hub_2026!}"
SSTP_PORT="${SOFTETHER_SSTP_PORT:-443}"

echo "[configure.sh] Iniciando configuración de SoftEther..."

# ── 1. Establecer password de administrador ────────────────────────────────────
echo "[1/8] Configurando password de administrador..."
$VPNCMD $HOST /SERVER /CMD ServerPasswordSet "$ADMIN_PASS" 2>&1 || true

# ── 2. Configurar puertos de escucha ──────────────────────────────────────────
echo "[2/8] Configurando puertos..."
# Eliminar puertos por defecto y agregar los nuestros
$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /CMD ListenerList 2>&1 | grep -oP '(?<=TCP/IP Port: )\d+' | while read port; do
    $VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /CMD ListenerDelete /PORT:$port 2>&1 || true
done

# Puerto SSTP principal
$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /CMD ListenerCreate /PORT:$SSTP_PORT 2>&1 || true
# Puerto de gestión
$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /CMD ListenerCreate /PORT:5555 2>&1 || true
# Puerto alternativo SSTP
$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /CMD ListenerCreate /PORT:992 2>&1 || true

# ── 3. Habilitar SSTP ─────────────────────────────────────────────────────────
echo "[3/8] Habilitando protocolo SSTP..."
$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /CMD SstpEnable /ENABLE:yes 2>&1 || true

# ── 4. Crear Virtual Hub ──────────────────────────────────────────────────────
echo "[4/8] Creando Virtual Hub '$HUB'..."
$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /CMD HubCreate "$HUB" /PASSWORD:"$HUB_PASS" 2>&1 || true

# ── 5. Configurar SecureNAT (DHCP interno) ────────────────────────────────────
echo "[5/8] Configurando SecureNAT y DHCP..."
$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" /CMD SecureNatEnable 2>&1 || true

$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" /CMD NatSet \
    /MTU:1500 \
    /TCPTIMEOUT:3600 \
    /UDPTIMEOUT:60 \
    /LOG:no 2>&1 || true

$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" /CMD DhcpSet \
    /START:"${SOFTETHER_DHCP_START:-10.100.0.10}" \
    /END:"${SOFTETHER_DHCP_END:-10.100.255.254}" \
    /MASK:"${SOFTETHER_DHCP_MASK:-255.255.0.0}" \
    /EXPIRE:7200 \
    /GW:"${SOFTETHER_DHCP_GW:-10.100.0.1}" \
    /DNS:"${SOFTETHER_DHCP_DNS:-8.8.8.8}" \
    /DNS2:8.8.4.4 \
    /DOMAIN:fastisp.local \
    /LOG:yes 2>&1 || true

# ── 6. Configurar autenticación RADIUS (opcional) ─────────────────────────────
echo "[6/8] Configurando modo de autenticación..."
# Usar autenticación local (usuarios en SoftEther)
$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" /CMD SetHubRadius \
    /SERVER:none 2>&1 || true

# ── 7. Crear usuario administrador del hub ────────────────────────────────────
echo "[7/8] Creando usuario admin del hub..."
$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" /CMD UserCreate \
    fastisp-admin \
    /GROUP:none \
    /REALNAME:"FASTISP Admin" \
    /NOTE:"Sistema FASTISP" 2>&1 || true

$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" /CMD UserPasswordSet \
    fastisp-admin \
    /PASSWORD:"$ADMIN_PASS" 2>&1 || true

# ── 8. Configurar logs ────────────────────────────────────────────────────────
echo "[8/8] Configurando logs..."
$VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" /CMD LogSet \
    /PACKET_LOG:no \
    /PACKET_LOG_SWITCH_CYCLE:day \
    /SECURITY_LOG:yes \
    /SECURITY_LOG_SWITCH_CYCLE:day 2>&1 || true

echo ""
echo "============================================"
echo "  SoftEther configurado exitosamente"
echo "  Hub: $HUB"
echo "  Puerto SSTP: $SSTP_PORT"
echo "  Pool IP: ${SOFTETHER_DHCP_START} - ${SOFTETHER_DHCP_END}"
echo "============================================"
