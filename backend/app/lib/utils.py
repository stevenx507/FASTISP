import re
import string
import secrets
import hashlib
import hmac
import time
import base64
from cryptography.fernet import Fernet
from datetime import datetime, timedelta, timezone
from pathlib import Path
from flask import current_app

# --- Formatting & Parsing ---

def parse_bool(value) -> bool | None:
    if isinstance(value, bool): return value
    if isinstance(value, int):
        if value in (0, 1): return bool(value)
        return None
    token = str(value or '').strip().lower()
    if token in {'1', 'true', 'yes', 'y', 'on'}: return True
    if token in {'0', 'false', 'no', 'n', 'off'}: return False
    return None

def parse_int(value) -> int | None:
    try: return int(str(value))
    except (TypeError, ValueError): return None

def parse_float(value) -> float | None:
    try:
        if value is None or str(value).strip() == "": return None
        return float(value)
    except (TypeError, ValueError): return None

def slugify(text: str) -> str:
    return ''.join(ch.lower() if ch.isalnum() else '-' for ch in text).strip('-')

def parse_iso_datetime(value) -> datetime | None:
    if value is None: return None
    raw = str(value).strip()
    if not raw: return None
    if raw.endswith('Z'): raw = raw.replace('Z', '+00:00')
    try: return datetime.fromisoformat(raw)
    except Exception: return None

def as_bool(raw_value: str | None, default: bool = False) -> bool:
    if raw_value is None: return default
    return raw_value.strip().lower() in {'1', 'true', 'yes', 'y', 'on'}

def mask_secret(value: str | None) -> str:
    token = str(value or '')
    if len(token) <= 4: return '*' * len(token)
    return f"{token[:2]}***{token[-2:]}"

# --- Security & Passwords ---

def validate_password_policy(password: str, min_length: int = 10) -> tuple[bool, str]:
    secret = str(password or "")
    if len(secret) < min_length: return False, f"La contrasena debe tener al menos {min_length} caracteres."
    has_upper = any(ch.isupper() for ch in secret)
    has_lower = any(ch.islower() for ch in secret)
    has_digit = any(ch.isdigit() for ch in secret)
    has_symbol = any(not ch.isalnum() for ch in secret)
    if not (has_upper and has_lower and has_digit and has_symbol):
        return False, "La contrasena debe incluir mayuscula, minuscula, numero y simbolo."
    return True, ""

def generate_random_password(length: int = 24) -> str:
    length = max(16, length)
    lowercase, uppercase, digits, symbols = string.ascii_lowercase, string.ascii_uppercase, string.digits, '-_@%#'
    all_chars = lowercase + uppercase + digits + symbols
    password_chars = [secrets.choice(lowercase), secrets.choice(uppercase), secrets.choice(digits), secrets.choice(symbols)]
    for _ in range(length - len(password_chars)):
        password_chars.append(secrets.choice(all_chars))
    secrets.SystemRandom().shuffle(password_chars)
    return ''.join(password_chars)

# --- Backups & Files ---

def is_safe_filename(name: str | None) -> bool:
    candidate = str(name or '').strip()
    if not candidate: return False
    return Path(candidate).name == candidate and '/' not in candidate and '\\' not in candidate

def calculate_sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open('rb') as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk: break
            digest.update(chunk)
    return digest.hexdigest()

# --- Tenant & Trial Helpers ---

def get_tenant_trial_days() -> int:
    default_days = 30
    try: configured = int(current_app.config.get('TENANT_DEFAULT_TRIAL_DAYS', default_days))
    except (TypeError, ValueError): configured = default_days
    return max(1, min(configured, 365))

def get_tenant_trial_ends_at() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=get_tenant_trial_days())

# --- Stripe / Webhooks ---

def verify_stripe_signature(payload: bytes, signature_header: str, secret: str, tolerance_seconds: int = 300) -> bool:
    timestamp, signatures = None, []
    for part in str(signature_header or "").split(","):
        key, sep, value = part.partition("=")
        if not sep: continue
        if key.strip() == "t": timestamp = parse_int(value)
        elif key.strip() == "v1" and value.strip(): signatures.append(value.strip())
    
    if timestamp is None or not signatures or not secret: return False
    if tolerance_seconds > 0 and abs(int(time.time()) - timestamp) > tolerance_seconds: return False
    
    try: payload_text = payload.decode('utf-8')
    except Exception: return False
    
    signed_payload = f"{timestamp}.{payload_text}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in signatures)

# --- Encryption Helpers ---

def normalize_fernet_key(raw_key) -> bytes:
    """
    Normalize any secret string into a valid Fernet key (32 url-safe base64 bytes).
    """
    if isinstance(raw_key, str):
        raw_key = raw_key.strip().encode('utf-8')
    if len(raw_key) == 44:
        try:
            decoded = base64.urlsafe_b64decode(raw_key + b'==')
            if len(decoded) == 32:
                return raw_key
        except Exception:
            pass
    digest = hashlib.sha256(raw_key).digest()
    return base64.urlsafe_b64encode(digest)

def get_fernet():
    """Helper to get Fernet instance for encryption/decryption."""
    raw = current_app.config['ENCRYPTION_KEY']
    key = normalize_fernet_key(raw)
    return Fernet(key)
