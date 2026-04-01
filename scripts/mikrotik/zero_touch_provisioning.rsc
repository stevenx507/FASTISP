# =============================================
# ZERO-TOUCH PROVISIONING SCRIPT
# For new MikroTik routers - Auto Configuration
# =============================================

:log info "Starting ISPMAX Zero-Touch Provisioning"

# ==================== BASIC SYSTEM ====================
/system identity
set name="ISPMAX-CPE"

/system clock
set time-zone-name=America/Mexico_City

/system ntp client
set enabled=yes primary-ntp=0.pool.ntp.org secondary-ntp=1.pool.ntp.org

# ==================== SECURITY ====================
# Change default password
/user set [find name=admin] password="ISPMAX_Secure_2024!"

# Disable unnecessary services
/ip service
set telnet disabled=yes
set ftp disabled=yes
set www disabled=no
set ssh disabled=yes
set www-ssl disabled=no port=443
set api disabled=no port=8728
set winbox disabled=no port=8291

# ==================== NETWORK INTERFACES ====================
# Create bridge for LAN
/interface bridge
add name=bridge-local comment="LAN Bridge"

# Add interfaces to bridge
/interface bridge port
add bridge=bridge-local interface=ether2
add bridge=bridge-local interface=ether3
add bridge=bridge-local interface=ether4
add bridge=bridge-local interface=ether5

# Configure IP addresses
/ip address
add address=192.168.88.1/24 interface=bridge-local network=192.168.88.0

# ==================== DHCP SERVER ====================
/ip pool
add name=dhcp_pool ranges=192.168.88.100-192.168.88.200

/ip dhcp-server
add address-pool=dhcp_pool disabled=no interface=bridge-local name=dhcp1

/ip dhcp-server network
add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=8.8.8.8,1.1.1.1

# ==================== DNS ====================
/ip dns
set servers=8.8.8.8,1.1.1.1
set allow-remote-requests=yes

# ==================== WIFI CONFIGURATION ====================
# Check if wireless interface exists
:local hasWlan1 [/interface find name="wlan1"]
:if ($hasWlan1 != "") do={
    /interface wireless
    set [find name="wlan1"] disabled=no mode=ap-bridge ssid="ISPMAX-WIFI" band=2ghz-b/g/n
    
    /interface wireless security-profiles
    add authentication-types=wpa2-psk mode=dynamic-keys name=wifi-profile wpa2-pre-shared-key="SecurePass123"
    
    /interface wireless
    set [find name="wlan1"] security-profile=wifi-profile
}

# Check for 5GHz interface
:local hasWlan2 [/interface find name="wlan2"]
:if ($hasWlan2 != "") do={
    /interface wireless
    set [find name="wlan2"] disabled=no mode=ap-bridge ssid="ISPMAX-5G" band=5ghz-a/n/ac
    
    /interface wireless security-profiles
    add authentication-types=wpa2-psk mode=dynamic-keys name=wifi-profile-5g wpa2-pre-shared-key="SecurePass123"
    
    /interface wireless
    set [find name="wlan2"] security-profile=wifi-profile-5g
}

# ==================== FIREWALL ====================
# Basic firewall rules
/ip firewall filter
add chain=input connection-state=established,related action=accept comment="Allow established"
add chain=input connection-state=invalid action=drop comment="Drop invalid"
add chain=input protocol=icmp action=accept comment="Allow ICMP"
add chain=input dst-port=8291,8728,8729 action=accept comment="Allow management"
add chain=input action=drop comment="Drop everything else"

add chain=forward connection-state=established,related action=accept
add chain=forward connection-state=invalid action=drop
add chain=forward action=accept comment="Allow LAN to WAN"

# NAT for internet access
/ip firewall nat
add chain=srcnat out-interface=ether1 action=masquerade comment="Masquerade LAN"

# ==================== QUEUE SIMPLE (QoS) ====================
# Basic QoS for fair usage
/queue type
add name="PCQ-Download" kind=pcq pcq-rate=0 pcq-limit=50 pcq-classifier=dst-address
add name="PCQ-Upload" kind=pcq pcq-rate=0 pcq-limit=50 pcq-classifier=src-address

/queue simple
add name="Default-Queue" target=192.168.88.0/24 max-limit=10M/2M queue=PCQ-Download/PCQ-Upload comment="Default client queue"

# ==================== SCHEDULER FOR MAINTENANCE ====================
/system scheduler
add name="Daily-Backup" interval=1d start-time=02:00:00 on-event="/system backup save name=config-\$[/system clock get date]"
add name="Weekly-Reboot" interval=7d start-time=03:00:00 on-event="/system reboot"

# ==================== API ACCESS FOR ISPMAX ====================
/ip firewall filter
add chain=input dst-port=8728 protocol=tcp action=accept comment="Allow ISPMAX API"

# ==================== FINAL MESSAGE ====================
:log info "ISPMA
