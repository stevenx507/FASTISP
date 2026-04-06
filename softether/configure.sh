#!/bin/bash
# configure.sh - Configuración inicial de SoftEther VPN Server
# Se ejecuta solo la primera vez que arranca el contenedor

VPNCMD="/opt/vpnserver/vpncmd"
HOST="localhost:${SOFTETHER_MGMT_PORT:-5555}"
ADMIN_PASS="${SOFTETHER_ADMIN_PASSWORD:-FastISP_VPN_2026!}"
HUB="${SOFTETHER_HUB_NAME:-FASTISP}"
HUB_PASS="${SOFTETHER_HUB_PASSWORD:-FastISP_Hub_2026!}"
SSTP_PORT="${SOFTETHER_SSTP_PORT:-443}"
T=15

# Helper: run vpncmd server-level command with timeout + forced exit
sv() { printf '%s\nexit\n' "$1" | timeout $T $VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" 2>&1 || true; }
# Helper: run vpncmd hub-level command with timeout + forced exit
hb() { printf '%s\nexit\n' "$1" | timeout $T $VPNCMD $HOST /SERVER /PASSWORD:"$ADMIN_PASS" /HUB:"$HUB" /PASSWORD:"$HUB_PASS" 2>&1 || true; }

echo "[configure.sh] Iniciando configuracion de SoftEther..."

# ── 1. Establecer password de administrador ────────────────────────────────────
echo "[1/8] Configurando password de administrador..."
sv "ServerPasswordSet $ADMIN_PASS"

# ── 2. Configurar puertos de escucha ──────────────────────────────────────────
echo "[2/8] Configurando puertos..."
sv "ListenerCreate /PORT:$SSTP_PORT"
sv "ListenerCreate /PORT:5555"
sv "ListenerCreate /PORT:992"

# ── 3. Habilitar SSTP ─────────────────────────────────────────────────────────
echo "[3/8] Habilitando protocolo SSTP..."
sv "SstpEnable /ENABLE:yes"

# ── 4. Crear Virtual Hub ──────────────────────────────────────────────────────
echo "[4/8] Creando Virtual Hub '$HUB'..."
sv "HubCreate $HUB /PASSWORD:$HUB_PASS"

# ── 5. Configurar SecureNAT (DHCP interno) ────────────────────────────────────
echo "[5/8] Configurando SecureNAT y DHCP..."
hb "SecureNatEnable"
hb "NatSet /MTU:1500 /TCPTIMEOUT:3600 /UDPTIMEOUT:60 /LOG:no"
hb "DhcpSet /START:${SOFTETHER_DHCP_START:-10.100.0.10} /END:${SOFTETHER_DHCP_END:-10.100.255.254} /MASK:${SOFTETHER_DHCP_MASK:-255.255.0.0} /EXPIRE:7200 /GW:${SOFTETHER_DHCP_GW:-10.100.0.1} /DNS:${SOFTETHER_DHCP_DNS:-8.8.8.8} /DNS2:8.8.4.4 /DOMAIN:fastisp.local /LOG:yes"

# ── 6. Configurar autenticacion RADIUS (opcional) ─────────────────────────────
echo "[6/8] Configurando modo de autenticacion..."
hb "SetHubRadius /SERVER:none"

# ── 7. Crear usuario administrador del hub ────────────────────────────────────
echo "[7/8] Creando usuario admin del hub..."
hb "UserCreate fastisp-admin /GROUP:none /REALNAME:FASTISP_Admin /NOTE:Sistema_FASTISP"
hb "UserPasswordSet fastisp-admin /PASSWORD:$ADMIN_PASS"

# ── 8. Configurar logs ────────────────────────────────────────────────────────
echo "[8/8] Configurando logs..."
hb "LogSet /PACKET_LOG:no /PACKET_LOG_SWITCH_CYCLE:day /SECURITY_LOG:yes /SECURITY_LOG_SWITCH_CYCLE:day"

echo ""
echo "============================================"
echo "  SoftEther configurado exitosamente"
echo "  Hub: $HUB"
echo "  Puerto SSTP: $SSTP_PORT"
echo "  Pool IP: ${SOFTETHER_DHCP_START} - ${SOFTETHER_DHCP_END}"
echo "============================================"
