import os

filepath = 'backend/app/routes/mikrotik.py'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix address-list
old_2 = 'f"/ip firewall address-list add list=fastisp-management address={allowed_mgmt} comment=\\"{_script_escape(account_label)} NOC\\""'
# Try without escaping the inner quotes if it failed
if old_2 not in content:
    old_2 = 'f"/ip firewall address-list add list=fastisp-management address={allowed_mgmt} comment=\\"{_script_escape(account_label)} NOC\\""'
    # Actually, let's just match a substring
    substring = 'f"/ip firewall address-list add list=fastisp-management'
    if substring in content:
        print("Found substring, replacing...")
        content = content.replace(
            'f"/ip firewall address-list add list=fastisp-management address={allowed_mgmt} comment=\\"{_script_escape(account_label)} NOC\\"',
            'f":do { /ip firewall address-list add list=fastisp-management address={allowed_mgmt} comment=\\"{_script_escape(account_label)} NOC\\" } on-error={}"'
        )

# Fix filter rules
content = content.replace(
    'f"/ip firewall filter add chain=input action=accept protocol=tcp dst-port={router.api_port},22 src-address-list=fastisp-management comment=\\"{_script_escape(account_label)} remote access\\"',
    'f":do { /ip firewall filter add chain=input action=accept protocol=tcp dst-port={router.api_port},22 src-address-list=fastisp-management comment=\\"{_script_escape(account_label)} remote access\\" place-before=0 } on-error={}"'
)

content = content.replace(
    'f"/ip firewall filter add chain=input action=drop protocol=tcp dst-port=22,8728,8729 in-interface-list=WAN comment=\\"Drop unmanaged remote\\"',
    f'f":do {{ /ip firewall filter add chain=input action=drop protocol=tcp dst-port=22,{{router.api_port}},8729 in-interface-list=WAN comment=\\"Drop unmanaged remote\\" }} on-error={{}}"'
)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("Finished patching")
