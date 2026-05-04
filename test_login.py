import urllib.request
import json
data = json.dumps({'email': 'platform@ispfast.local', 'password': 'AdminFast123!'}).encode('utf-8')
req = urllib.request.Request('http://127.0.0.1:5173/api/v1/auth/login', data=data, headers={'Content-Type': 'application/json'})
try:
    response = urllib.request.urlopen(req)
    print('Status:', response.status)
    print('Body:', response.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print('HTTP Error:', e.code)
    print('Error Body:', e.read().decode('utf-8'))
except Exception as e:
    print('Exception:', e)
