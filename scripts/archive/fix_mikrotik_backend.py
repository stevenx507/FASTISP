import os

filepath = 'backend/app/routes/mikrotik.py'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix YOUR_PUBLIC_IP
old_1 = """    router_peer_ip = f'10.250.{int(router.id) % 250}.2/32'"""
new_1 = """    vps_ip = str(current_app.config.get('FASTISP_VPS_IP') or '').strip()
    if 'YOUR_PUBLIC_IP' in allowed_mgmt and vps_ip:
        allowed_mgmt = allowed_mgmt.replace('YOUR_PUBLIC_IP', vps_ip)

    router_peer_ip = f'10.250.{int(router.id) % 250}.2/32'"""

if old_1 in content:
    content = content.replace(old_1, new_1)
    print("Fixed YOUR_PUBLIC_IP logic")
else:
    print("Could not find old_1")

# Fix firewall commands (using substrings to be safe)
old_2 = 'f"/ip firewall address-list add list=fastisp-management address={allowed_mgmt} comment=\\"{_script_escape(account_label)} NOC\\""'
new_2 = 'f":do { /ip firewall address-list add list=fastisp-management address={allowed_mgmt} comment=\\"{_script_escape(account_label)} NOC\\" } on-error={}"'

if old_2 in content:
    content = content.replace(old_2, new_2)
    print("Fixed address-list command")
else:
    print("Could not find old_2")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
