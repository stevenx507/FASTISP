import os

filepath = 'backend/app/routes/admin_routes.py'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix YOUR_PUBLIC_IP in admin_routes
old_admin = 'address=YOUR_PUBLIC_IP/32'
new_admin = 'vps_ip = current_app.config.get("FASTISP_VPS_IP", "YOUR_PUBLIC_IP")\n    address = f"{vps_ip}/32" if vps_ip != "YOUR_PUBLIC_IP" else "YOUR_PUBLIC_IP/32"\n    # ... (patching will be more precise below)'

# Let's do a more robust patch for the function router_remote_script
import re

pattern = r'script = f"""/ip service set api disabled=no port=\{api_port\}\n/ip service set ssh disabled=no port=\{ssh_port\}\n/user add name="\{api_user\}" password="\{api_pass\}" group=full comment="Acceso remoto FastISP" disabled=no\n/ip firewall address-list add list=fastisp-remote address=YOUR_PUBLIC_IP/32 comment="Autorizar IP de gestión"\n/ip firewall filter add chain=input action=accept protocol=tcp dst-port=\{api_port\} src-address-list=fastisp-remote comment="API FastISP"\n/ip firewall filter add chain=input action=accept protocol=tcp dst-port=\{ssh_port\} src-address-list=fastisp-remote comment="SSH FastISP"\n"""'

replacement = r'''vps_ip = current_app.config.get('FASTISP_VPS_IP') or 'YOUR_PUBLIC_IP'
    allowed_mgmt = f"{vps_ip}/32"
    script = f"""/ip service set api disabled=no port={api_port}
/ip service set ssh disabled=no port={ssh_port}
/user add name="{api_user}" password="{api_pass}" group=full comment="Acceso remoto FastISP" disabled=no
/ip firewall address-list add list=fastisp-remote address={allowed_mgmt} comment="Autorizar IP de gestión"
/ip firewall filter add chain=input action=accept protocol=tcp dst-port={api_port} src-address-list=fastisp-remote comment="API FastISP"
/ip firewall filter add chain=input action=accept protocol=tcp dst-port={ssh_port} src-address-list=fastisp-remote comment="SSH FastISP"
"""'''

# Use simple string replacement for reliability
old_block = '''    script = f"""/ip service set api disabled=no port={api_port}
/ip service set ssh disabled=no port={ssh_port}
/user add name="{api_user}" password="{api_pass}" group=full comment="Acceso remoto FastISP" disabled=no
/ip firewall address-list add list=fastisp-remote address=YOUR_PUBLIC_IP/32 comment="Autorizar IP de gestión"
/ip firewall filter add chain=input action=accept protocol=tcp dst-port={api_port} src-address-list=fastisp-remote comment="API FastISP"
/ip firewall filter add chain=input action=accept protocol=tcp dst-port={ssh_port} src-address-list=fastisp-remote comment="SSH FastISP"
"""'''

new_block = '''    vps_ip = current_app.config.get('FASTISP_VPS_IP') or 'YOUR_PUBLIC_IP'
    allowed_mgmt = f"{vps_ip}/32"
    script = f"""/ip service set api disabled=no port={api_port}
/ip service set ssh disabled=no port={ssh_port}
/user add name="{api_user}" password="{api_pass}" group=full comment="Acceso remoto FastISP" disabled=no
/ip firewall address-list add list=fastisp-remote address={allowed_mgmt} comment="Autorizar IP de gestión"
/ip firewall filter add chain=input action=accept protocol=tcp dst-port={api_port} src-address-list=fastisp-remote comment="API FastISP"
/ip firewall filter add chain=input action=accept protocol=tcp dst-port={ssh_port} src-address-list=fastisp-remote comment="SSH FastISP"
"""'''

if old_block in content:
    content = content.replace(old_block, new_block)
    print("Fixed YOUR_PUBLIC_IP in admin_routes.py")
else:
    print("Could not find old_block in admin_routes.py")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("Finished patching admin_routes")
