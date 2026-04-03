#!/bin/bash
# entrypoint.sh para imagen siomiz/softethervpn
# La imagen base ya inicia SoftEther automáticamente via su propio entrypoint
# Nosotros solo ejecutamos la configuración inicial encima

set -e

CONFIGURED_FLAG="/etc/softether/.configured"
SOFTETHER_MGMT_PORT="${SOFTETHER_MGMT_PORT:-5555}"
SOFTETHER_ADMIN_PASSWORD="${SOFTETHER_ADMIN_PASSWORD:-FastISP_VPN_2026!}"

echo "============================================"
echo "  FASTISP SoftEther VPN Server"
echo "  Hub: ${SOFTETHER_HUB_NAME:-FASTISP}"
echo "  SSTP Port: ${SOFTETHER_SSTP_PORT:-443}"
echo "============================================"

# Detectar dónde está vpnserver en la imagen base
if [ -f "/usr/vpnserver/vpnserver" ]; then
    VPNSERVER_BIN="/usr/vpnserver/vpnserver"
    VPNCMD_BIN="/usr/vpnserver/vpncmd"
    VPNSERVER_DIR="/usr/vpnserver"
elif [ -f "/opt/vpnserver/vpnserver" ]; then
    VPNSERVER_BIN="/opt/vpnserver/vpnserver"
    VPNCMD_BIN="/opt/vpnserver/vpncmd"
    VPNSERVER_DIR="/opt/vpnserver"
else
    echo "ERROR: vpnserver no encontrado"
    exit 1
fi

echo "VPN Server en: $VPNSERVER_DIR"

# Crear symlink para vpncmd_api.sh
ln -sf $VPNCMD_BIN /usr/local/bin/vpncmd 2>/dev/null || true

# Actualizar VPNCMD en los scripts
sed -i "s|/opt/vpnserver/vpncmd|$VPNCMD_BIN|g" /vpncmd_api.sh /configure.sh 2>/dev/null || true

# Iniciar SoftEther
echo "Iniciando SoftEther VPN Server..."
cd $VPNSERVER_DIR
$VPNSERVER_BIN start 2>/dev/null || true

# Esperar a que esté listo
echo "Esperando que SoftEther esté listo..."
sleep 8

MAX_WAIT=20
COUNT=0
while ! $VPNCMD_BIN localhost:$SOFTETHER_MGMT_PORT /SERVER /CMD About > /dev/null 2>&1; do
    sleep 3
    COUNT=$((COUNT + 1))
    echo "  Intento $COUNT/$MAX_WAIT..."
    if [ $COUNT -ge $MAX_WAIT ]; then
        echo "WARN: SoftEther tardó más de lo esperado, continuando..."
        break
    fi
done

echo "SoftEther listo"

# Configurar solo la primera vez
if [ ! -f "$CONFIGURED_FLAG" ]; then
    echo "Primera ejecución — ejecutando configuración inicial..."
    mkdir -p /etc/softether
    /configure.sh && touch "$CONFIGURED_FLAG"
    echo "Configuración completada"
else
    echo "Configuración previa detectada, saltando setup"
fi

echo ""
echo "✅ SoftEther VPN corriendo"
echo "   SSTP: puerto ${SOFTETHER_SSTP_PORT:-443}"
echo "   Mgmt: puerto $SOFTETHER_MGMT_PORT"
echo ""

# Mantener en foreground
while true; do
    if ! pgrep -f "vpnserver" > /dev/null 2>&1; then
        echo "WARN: vpnserver detenido, reiniciando..."
        cd $VPNSERVER_DIR && $VPNSERVER_BIN start 2>/dev/null || true
        sleep 5
    fi
    sleep 15
done
