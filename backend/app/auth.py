import time
import hmac
import hashlib
from typing import Dict, List, Tuple
from fastapi import Request, HTTPException, status
from .config import settings

TOKEN_VALIDITY_SECONDS = 30 * 86400  # 30 days

class LoginRateLimiter:
    """
    In-memory IP-based brute-force protector.
    Locks an IP out for lockout_duration (10 min) after max_attempts (5) consecutive failed attempts.
    """
    def __init__(self, max_attempts: int = 5, lockout_duration: int = 600):
        self.max_attempts = max_attempts
        self.lockout_duration = lockout_duration
        self._lockouts: Dict[str, float] = {}       # ip -> lockout_until_timestamp
        self._failures: Dict[str, List[float]] = {} # ip -> list of failure timestamps

    def _purge_expired(self, now: float):
        # Clean expired lockouts
        expired_locks = [ip for ip, until in self._lockouts.items() if until <= now]
        for ip in expired_locks:
            del self._lockouts[ip]

        # Clean expired failure records (older than lockout window)
        expired_ips = []
        for ip, timestamps in self._failures.items():
            valid = [t for t in timestamps if now - t <= self.lockout_duration]
            if not valid:
                expired_ips.append(ip)
            else:
                self._failures[ip] = valid
        for ip in expired_ips:
            del self._failures[ip]

    def check_rate_limit(self, ip: str) -> Tuple[bool, int]:
        """Returns (is_locked, remaining_seconds)"""
        now = time.time()
        self._purge_expired(now)
        lockout_until = self._lockouts.get(ip, 0)
        if lockout_until > now:
            return True, int(lockout_until - now)
        return False, 0

    def record_failure(self, ip: str) -> Tuple[bool, int]:
        """Records a failed attempt. If threshold reached, triggers lockout. Returns (is_locked, remaining_seconds)."""
        now = time.time()
        self._purge_expired(now)
        timestamps = self._failures.get(ip, [])
        timestamps.append(now)
        self._failures[ip] = timestamps

        if len(timestamps) >= self.max_attempts:
            lockout_until = now + self.lockout_duration
            self._lockouts[ip] = lockout_until
            self._failures.pop(ip, None)
            return True, self.lockout_duration
        return False, 0

    def record_success(self, ip: str):
        """Resets failed attempt records on successful login."""
        self._failures.pop(ip, None)
        self._lockouts.pop(ip, None)

login_limiter = LoginRateLimiter(max_attempts=5, lockout_duration=600)

def get_client_ip(request: Request) -> str:
    """Extracts client IP, respecting reverse proxies (X-Forwarded-For, X-Real-IP)."""
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        client_ip = xff.split(",")[0].strip()
        if client_ip:
            return client_ip
    x_real_ip = request.headers.get("X-Real-IP")
    if x_real_ip:
        return x_real_ip.strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"

def create_auth_token() -> str:
    """Generates a secure timestamped HMAC token."""
    ts = str(int(time.time()))
    payload = f"{ts}:{settings.READER_PASSWORD}"
    sig = hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{ts}.{sig}"

def verify_auth_token(token: str) -> bool:
    """Verifies HMAC signature and expiration."""
    if not settings.READER_PASSWORD:
        return True
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return False
        ts_str, sig = parts
        ts = int(ts_str)
        # Check expiry
        if time.time() - ts > TOKEN_VALIDITY_SECONDS:
            return False
        # Verify HMAC
        expected_payload = f"{ts_str}:{settings.READER_PASSWORD}"
        expected_sig = hmac.new(settings.SECRET_KEY.encode(), expected_payload.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, expected_sig)
    except Exception:
        return False

def verify_api_key(api_key: str) -> bool:
    """Verifies X-Api-Key for external ingestion."""
    if not api_key:
        return False
    target = settings.READER_API_KEY or settings.READER_PASSWORD
    if not target:
        return True
    return hmac.compare_digest(api_key, target)

async def require_auth(request: Request) -> bool:
    """FastAPI dependency to protect reader API endpoints."""
    # If no password configured on server, allow all
    if not settings.READER_PASSWORD:
        return True

    # 1. Check API Key in Header (for crawlers / ingestion)
    api_key = request.headers.get("X-Api-Key")
    if api_key and verify_api_key(api_key):
        return True

    # 2. Check Authorization Header (Bearer token)
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "").strip()
        if verify_auth_token(token):
            return True

    # 3. Check custom header, cookie or query param
    custom_token = (
        request.headers.get("X-Reader-Token") 
        or request.cookies.get("reader_auth_token")
        or request.query_params.get("token")
    )
    if custom_token and verify_auth_token(custom_token):
        return True

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Unauthorized: 请先登录以访问此私人阅读器",
        headers={"WWW-Authenticate": "Bearer"},
    )
