FROM siomiz/softethervpn:latest

LABEL maintainer="FASTISP"
LABEL description="SoftEther VPN Server with SSTP support for ISP MikroTik provisioning"

# Copiar scripts de gestión (sin instalar paquetes adicionales)
COPY vpncmd_api.sh /vpncmd_api.sh
COPY configure.sh /configure.sh
COPY entrypoint.sh /entrypoint.sh

# Strip Windows CRLF line endings and set executable
RUN sed -i 's/\r$//' /vpncmd_api.sh /configure.sh /entrypoint.sh && \
    chmod +x /vpncmd_api.sh /configure.sh /entrypoint.sh

# Puertos:
# 443  - SSTP/HTTPS
# 992  - SSTP alternativo
# 1194 - OpenVPN
# 5555 - Management API
EXPOSE 443 992 1194 5555

ENTRYPOINT ["/entrypoint.sh"]
