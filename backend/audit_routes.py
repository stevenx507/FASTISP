"""
audit_routes.py  –  extracts all Flask route definitions from the backend.
Run: python audit_routes.py  (from the backend/ directory)
"""
import re, os, sys

ROUTES_DIR = os.path.join(os.path.dirname(__file__), 'app', 'routes')

route_re = re.compile(r"""@\w+\.route\(\s*['"]([^'"]+)['"](?:[^)]*methods\s*=\s*\[([^\]]+)\])?""")

rows = []
for fname in os.listdir(ROUTES_DIR):
    if not fname.endswith('.py'):
        continue
    path = os.path.join(ROUTES_DIR, fname)
    with open(path, encoding='utf-8', errors='replace') as f:
        src = f.read()
    for m in route_re.finditer(src):
        endpoint = m.group(1)
        methods_raw = m.group(2) or "'GET'"
        for meth in re.findall(r"'(\w+)'", methods_raw):
            rows.append(f"{meth.upper():<7} {endpoint}")

rows = sorted(set(rows))
out = '\n'.join(rows)
print(out)
print(f"\nTotal routes: {len(rows)}")
with open('backend_routes.txt', 'w', encoding='utf-8') as f:
    f.write(out + '\n')
