import os

filepath = 'backend/app/routes/mikrotik.py'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix WireGuard endpoint usage
old_3 = '+ f\':local wgEndpoint "{wg_endpoint_host}"\\n\''
new_3 = '+ f\':local wgEndpoint "{normalized_endpoint.get(\'host\')}"\\n\''
# Actually, wg_endpoint_host is already defined in the function
# Wait, let's look at the function again.
# wg_endpoint_host = str(wireguard_profile.get('endpoint_host') or '')
# So it SHOULD work if wireguard_profile has it.

# Let's check why it was empty in the screenshot.
# It's because wireguard_profile comes from _resolve_wireguard_profile.
# If no endpoint is configured in settings or env, it uses WG_PROFILE_ENDPOINT_DEFAULT.
# WG_PROFILE_ENDPOINT_DEFAULT = 'vpn.fastisp.cloud:51820'
# _normalize_wireguard_endpoint('vpn.fastisp.cloud:51820') should return host='vpn.fastisp.cloud'

# I'll add a fix for YOUR_PUBLIC_IP in SSTP service too.
filepath_sstp = 'backend/app/services/sstp_service.py'
with open(filepath_sstp, 'r', encoding='utf-8') as f:
    sstp_content = f.read()

sstp_content = sstp_content.replace(
    'api_addresses = SSTP_API_ALLOWED_SUBNET',
    'vps_ip = FASTISP_VPS_IP.strip()\n    if vps_ip:\n        api_addresses = f"{SSTP_API_ALLOWED_SUBNET},{vps_ip}/32"\n    else:\n        api_addresses = SSTP_API_ALLOWED_SUBNET'
)

# Fix group already exists in SSTP
sstp_content = sstp_content.replace(
    '/user group add name={SSTP_API_GROUP_NAME}',
    ':do { /user group add name={SSTP_API_GROUP_NAME} policy="local,ftp,reboot,read,write,policy,test,password,sniff,api,romon,sensitive" } on-error={}'
)

with open(filepath_sstp, 'w', encoding='utf-8') as f:
    f.write(sstp_content)

print("Finished patching SSTP")
