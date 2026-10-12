import time
import hmac
import hashlib
from fastapi import Request, HTTPException, status
from .config import settings

TOKEN_VALIDITY_SECONDS = 30 * 86400  # 30 days

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
