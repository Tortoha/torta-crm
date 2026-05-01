from fastapi import FastAPI, Response, HTTPException, Request, Depends
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta, timezone, time as dt_time
from contextlib import contextmanager
import sys, os, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import psycopg2
import psycopg2.errors

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:
    ZoneInfo = None
    class ZoneInfoNotFoundError(Exception): pass

def _tz(name: str):
    """Resolve an IANA timezone name (e.g. 'Asia/Almaty') to a tzinfo object,
    falling back to UTC if invalid or unavailable."""
    if not name or ZoneInfo is None:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, Exception):
        return timezone.utc

def _utcnow():
    return datetime.now(timezone.utc)
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor
import hashlib, secrets, jwt, random, re as _re, traceback, json, urllib.request, urllib.error
from hashids import Hashids
from starlette.middleware.base import BaseHTTPMiddleware
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)


# ============================================
# НАСТРОЙКА
# ============================================

SECRET_KEY            = os.getenv("SECRET_KEY",        "")
JWT_ALGORITHM         = "HS256"
# Short-lived access JWT + long-lived rotated refresh token. See CRM backend
# for the same pattern + extensive comments.
ACCESS_TOKEN_MINUTES  = int(os.getenv("ACCESS_TOKEN_MINUTES", "15"))
REFRESH_TOKEN_DAYS    = int(os.getenv("REFRESH_TOKEN_DAYS",   "30"))
JWT_HOURS             = ACCESS_TOKEN_MINUTES / 60   # legacy alias
MAGAZ_BACKEND_URL     = os.getenv("MAGAZ_BACKEND_URL", "http://localhost:8000")
CRM_BACKEND_URL       = os.getenv("CRM_BACKEND_URL",   "http://localhost:8001")
INTERNAL_API_KEY      = os.getenv("INTERNAL_API_KEY",  "torta-internal-dev-key")
SES_API_URL           = os.getenv("SES_API_URL",       "https://ses.tortacrm.com")
SES_INTERNAL_KEY      = os.getenv("SES_INTERNAL_KEY",  "")
EMAIL_FROM            = os.getenv("EMAIL_FROM",        "support@tortacrm.com")
ENVIRONMENT           = os.getenv("ENVIRONMENT", "development").lower()
IS_PRODUCTION         = ENVIRONMENT == "production"
COOKIE_SECURE         = IS_PRODUCTION   # Secure flag on auth cookies in prod
MAX_FAILED_ATTEMPTS   = 5
BLOCK_MINUTES         = 10
CODE_TTL_MINUTES      = 10
RESEND_COOLDOWN_SECONDS = 60
RESET_TTL_MINUTES     = 30
# Phone OTP rate-limiting
PHONE_SEND_MAX_PER_PHONE  = 5    # per BLOCK_MINUTES window
PHONE_SEND_MAX_PER_IP     = 20
PHONE_VERIFY_MAX_ATTEMPTS = 5    # per OTP code
import hmac as _hmac, base64 as _b64
# E.164 phone format: + followed by 1–9, then 1..14 digits (max 15 total)
_E164_RE = _re.compile(r"^\+[1-9]\d{1,14}$")

DB_CONFIG = {
    "host":     os.getenv("DB_HOST",     "localhost"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "user":     os.getenv("DB_USER",     "postgres"),
    "password": os.getenv("DB_PASSWORD", ""),
    "dbname":   os.getenv("DB_NAME",     "crmdb"),
}

hashids = Hashids(salt="qpzmrld10vsljklfgdnsdsafjkhfl526742228666777mzpqnxowhgf", min_length=6)

# Пул соединений: переиспользуем до 10 соединений вместо нового TCP-handshake на каждый запрос
_pool = ThreadedConnectionPool(1, 10, **DB_CONFIG)

def get_db():
    return _pool.getconn()

@contextmanager
def db_cursor():
    conn   = get_db()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        yield conn, cursor
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        _pool.putconn(conn)

def db_one(sql, params=()):
    with db_cursor() as (_, cur):
        cur.execute(sql, params)
        return cur.fetchone()

def db_all(sql, params=()):
    with db_cursor() as (_, cur):
        cur.execute(sql, params)
        return cur.fetchall()


app = FastAPI()




# ============================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (PER-PROJECT)
# ============================================

def get_project_email(project_id: int) -> tuple:
    row = db_one(
        "SELECT from_name, from_email FROM crm_email_domains WHERE project_id = %s AND is_verified = TRUE",
        (project_id,)
    )
    return (row["from_name"], row["from_email"]) if row else ("Torta Store", EMAIL_FROM)

def get_project_frontend_url(project_id: int) -> str | None:
    row = db_one("SELECT frontend_url FROM crm_url_config WHERE project_id = %s", (project_id,))
    url = row["frontend_url"].rstrip("/") if row and row["frontend_url"] else None
    if url and not url.startswith(("http://", "https://")):
        return None
    return url

def get_allowed_redirect_urls(project_id: int) -> list:
    rows    = db_all("SELECT url FROM crm_redirect_urls WHERE project_id = %s", (project_id,))
    allowed = [r["url"].rstrip("/") for r in rows if r["url"]]
    site    = db_one("SELECT frontend_url FROM crm_url_config WHERE project_id = %s", (project_id,))
    if site and site["frontend_url"]:
        url = site["frontend_url"].rstrip("/")
        if url not in allowed:
            allowed.append(url)
    return allowed

def get_google_credentials(project_id: int):
    row = db_one(
        "SELECT google_client_id, google_client_secret FROM crm_oauth_settings "
        "WHERE project_id = %s AND google_enabled = TRUE",
        (project_id,)
    )
    if row and row["google_client_id"] and row["google_client_secret"]:
        return row["google_client_id"], row["google_client_secret"]
    return None, None

def get_user_by_email(email: str, project_id: int):
    return db_one("SELECT * FROM users WHERE email = %s AND project_id = %s", (email, project_id))

def get_user_by_id(user_id: int, project_id: int):
    return db_one("SELECT id, name, email FROM users WHERE id = %s AND project_id = %s", (user_id, project_id))


# ============================================
# УТИЛИТЫ
# ============================================

def run_migrations():
    with db_cursor() as (conn, cur):
        # Add missing columns (PostgreSQL syntax)
        for col_sql in [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id varchar(255) DEFAULT NULL",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider varchar(40) DEFAULT NULL",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider_id varchar(255) DEFAULT NULL",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone varchar(32) DEFAULT NULL",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE",
            "ALTER TABLE favorites ADD COLUMN IF NOT EXISTS project_id int DEFAULT NULL",
            "ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS project_id int DEFAULT NULL",
        ]:
            try: cur.execute(col_sql); conn.commit()
            except Exception: conn.rollback()
        # Remove duplicate users, keeping the row with the lowest id per (email, project_id)
        try:
            cur.execute("""
                DELETE FROM users
                WHERE id IN (
                    SELECT u1.id FROM users u1
                    JOIN users u2 ON u1.email = u2.email AND u1.project_id = u2.project_id AND u1.id > u2.id
                )
            """)
            conn.commit()
        except Exception: conn.rollback()
        # Enforce uniqueness so duplicates can never form again
        try:
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_email_project ON users(email, project_id)")
            conn.commit()
        except Exception: conn.rollback()
        # Phone uniqueness per project — prevents duplicate accounts via the
        # phone OTP race condition (two concurrent verify-code requests).
        # Partial index ignores rows where phone IS NULL.
        try:
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_project "
                "ON users(phone, project_id) WHERE phone IS NOT NULL AND phone <> ''"
            )
            conn.commit()
        except Exception: conn.rollback()
        # Refresh tokens (per-user sessions, rotated on use). project_id lets
        # us scope sessions to a single store — same user logged into 2
        # different stores has 2 independent sessions.
        try:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS refresh_tokens (
                    id            SERIAL PRIMARY KEY,
                    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    project_id    INTEGER NOT NULL,
                    token_hash    VARCHAR(64) NOT NULL UNIQUE,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    expires_at    TIMESTAMPTZ NOT NULL,
                    last_used_at  TIMESTAMPTZ,
                    revoked_at    TIMESTAMPTZ,
                    revoke_reason VARCHAR(40),
                    rotated_to_id INTEGER REFERENCES refresh_tokens(id) ON DELETE SET NULL,
                    parent_id     INTEGER REFERENCES refresh_tokens(id) ON DELETE SET NULL,
                    user_agent    TEXT,
                    ip            VARCHAR(64),
                    label         VARCHAR(100)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user "
                        "ON refresh_tokens(user_id, project_id, revoked_at, expires_at)")
            conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"[migration] refresh_tokens table failed: {e}")
        # Fix reviews with NULL project_id — copy from their product
        try:
            cur.execute("""
                UPDATE product_reviews
                SET project_id = p.project_id
                FROM products p
                WHERE product_reviews.product_id = p.id
                  AND product_reviews.project_id IS NULL
            """)
            conn.commit()
        except Exception: conn.rollback()

try:
    run_migrations()
except Exception as _e:
    print(f"[migration] failed (non-fatal): {_e}")

# ── Password hashing (scrypt + legacy SHA-256 fallback) ────────────────────
# New format: "$scrypt$<base64-salt>$<base64-hash>"  (salt=16B, hash=32B)
# Legacy format: 64 hex chars (SHA-256). On successful legacy login the caller
# should re-hash with hash_password() and persist it.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2 ** 14, 8, 1

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    h    = hashlib.scrypt(password.encode(), salt=salt,
                          n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return f"$scrypt${_b64.b64encode(salt).decode()}${_b64.b64encode(h).decode()}"

def verify_password(password: str, stored: str) -> bool:
    if not stored: return False
    try:
        if stored.startswith("$scrypt$"):
            _, _, salt_b64, hash_b64 = stored.split("$", 3)
            salt = _b64.b64decode(salt_b64)
            want = _b64.b64decode(hash_b64)
            got  = hashlib.scrypt(password.encode(), salt=salt,
                                  n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
            return _hmac.compare_digest(want, got)
        # Legacy SHA-256 — constant-time compare
        legacy = hashlib.sha256(password.encode()).hexdigest()
        return _hmac.compare_digest(legacy, stored)
    except Exception:
        return False

def is_legacy_hash(stored: str) -> bool:
    return bool(stored) and not stored.startswith("$scrypt$")

# ── OTP helpers (cryptographic + hashed at rest) ───────────────────────────
def gen_otp(length: int = 6) -> str:
    return "".join(str(secrets.randbelow(10)) for _ in range(length))

def hash_otp(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()

def verify_otp(code: str, code_hash: str) -> bool:
    if not code or not code_hash: return False
    return _hmac.compare_digest(hash_otp(code), code_hash)

def sanitize(v: str) -> str:
    if not isinstance(v, str): return v
    return v.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;").replace("'","&#x27;")

def validate_password(pwd: str):
    if not pwd or " " in pwd:
        raise HTTPException(400, "Password must not contain spaces")
    if len(pwd) < 8 or len(pwd) > 24:
        raise HTTPException(400, "Password must be 8–24 characters")
    if not any(c.isalpha() for c in pwd):
        raise HTTPException(400, "Password must contain at least 1 letter")
    if not any(c.isdigit() for c in pwd):
        raise HTTPException(400, "Password must contain at least 1 digit")

def create_token(user_id: int) -> str:
    """Short-lived (15 min) access JWT. Refresh token does the long-lived part."""
    payload = {"sub": str(user_id),
               "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_MINUTES)}
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)

def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="authx_token", value=token,
        httponly=True, max_age=ACCESS_TOKEN_MINUTES * 60,
        samesite="lax", secure=COOKIE_SECURE, path="/",
    )

def set_refresh_cookie(response: Response, raw: str):
    response.set_cookie(
        key="authx_refresh", value=raw,
        httponly=True, max_age=REFRESH_TOKEN_DAYS * 86400,
        samesite="lax", secure=COOKIE_SECURE, path="/",
    )

def clear_auth_cookies(response: Response):
    response.delete_cookie("authx_token",   path="/")
    response.delete_cookie("authx_refresh", path="/")

# ── Refresh token helpers (mirror CRM backend, scoped per project) ─────
REVOKE_REASON_LOGOUT  = "logout"
REVOKE_REASON_ROTATED = "rotated"
REVOKE_REASON_REUSED  = "reuse_detected"
REVOKE_REASON_MANUAL  = "manual_revoke"

def _new_refresh_token() -> tuple:
    raw  = "rt_" + secrets.token_hex(32)
    return raw, hashlib.sha256(raw.encode()).hexdigest()

def issue_refresh_token(user_id: int, project_id: int, request: Request,
                        parent_id=None, label: str = None) -> str:
    raw, h = _new_refresh_token()
    ua = (request.headers.get("user-agent") or "")[:500] if request else ""
    ip = get_client_ip(request) if request else ""
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS)
    with db_cursor() as (conn, cur):
        cur.execute(
            """INSERT INTO refresh_tokens
                  (user_id, project_id, token_hash, expires_at, parent_id, user_agent, ip, label)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (user_id, project_id, h, expires_at, parent_id, ua, ip, label),
        )
        cur.fetchone()
        conn.commit()
    return raw

def _revoke_chain_from(cur, root_id: int, reason: str):
    visited = set(); queue = [root_id]
    while queue:
        cid = queue.pop()
        if cid in visited: continue
        visited.add(cid)
        cur.execute("""
            UPDATE refresh_tokens
               SET revoked_at = COALESCE(revoked_at, NOW()),
                   revoke_reason = COALESCE(revoke_reason, %s)
             WHERE id = %s
        """, (reason, cid))
        cur.execute(
            "SELECT id FROM refresh_tokens WHERE parent_id=%s OR rotated_to_id=%s",
            (cid, cid),
        )
        for r in cur.fetchall():
            if r["id"] not in visited: queue.append(r["id"])

def consume_refresh_token(raw: str, project_id: int, request: Request):
    """Returns (user_id, new_raw) or None. Rotates the token; revokes the
    whole chain if a previously-rotated token is presented (reuse attack)."""
    if not raw: return None
    h = hashlib.sha256(raw.encode()).hexdigest()
    with db_cursor() as (conn, cur):
        cur.execute(
            "SELECT * FROM refresh_tokens WHERE token_hash=%s AND project_id=%s FOR UPDATE",
            (h, project_id),
        )
        row = cur.fetchone()
        if not row:
            conn.commit()
            return None
        now_utc = datetime.now(timezone.utc)
        if row["revoked_at"] is not None:
            _revoke_chain_from(cur, row["id"], REVOKE_REASON_REUSED)
            conn.commit()
            return None
        if row["expires_at"] and row["expires_at"] < now_utc:
            cur.execute(
                "UPDATE refresh_tokens SET revoked_at=NOW(), revoke_reason='expired' WHERE id=%s",
                (row["id"],),
            )
            conn.commit()
            return None
        new_raw, new_h = _new_refresh_token()
        ua = (request.headers.get("user-agent") or "")[:500] if request else (row.get("user_agent") or "")
        ip = get_client_ip(request) if request else (row.get("ip") or "")
        new_expires = now_utc + timedelta(days=REFRESH_TOKEN_DAYS)
        cur.execute(
            """INSERT INTO refresh_tokens
                  (user_id, project_id, token_hash, expires_at, parent_id, user_agent, ip, label)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (row["user_id"], project_id, new_h, new_expires, row["id"], ua, ip, row.get("label")),
        )
        new_id = cur.fetchone()["id"]
        cur.execute("""
            UPDATE refresh_tokens
               SET revoked_at=NOW(), revoke_reason=%s,
                   rotated_to_id=%s, last_used_at=NOW()
             WHERE id=%s
        """, (REVOKE_REASON_ROTATED, new_id, row["id"]))
        conn.commit()
        return row["user_id"], new_raw

def revoke_refresh_by_raw(raw: str, project_id: int, reason: str = REVOKE_REASON_LOGOUT):
    if not raw: return
    h = hashlib.sha256(raw.encode()).hexdigest()
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE refresh_tokens SET revoked_at=NOW(), revoke_reason=%s "
            "WHERE token_hash=%s AND project_id=%s AND revoked_at IS NULL",
            (reason, h, project_id),
        )
        conn.commit()

def get_current_user_id(request: Request) -> int:
    token = request.cookies.get("authx_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        return int(jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])["sub"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

def try_get_current_user_id(request: Request):
    try:    return get_current_user_id(request)
    except: return None

def get_client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")

def resolve_api_key(api_key: str, request: Request) -> dict:
    record = db_one("SELECT * FROM crm_projects WHERE api_key = %s AND is_active = TRUE", (api_key,))
    if not record:
        raise HTTPException(401, "Invalid or inactive API key")
    pk_header = request.headers.get("x-publishable-key")
    if not pk_header or pk_header != record.get("publishable_key"):
        raise HTTPException(401, "Invalid publishable key")
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE crm_projects SET last_used_ip = %s, last_used_at = NOW() WHERE id = %s",
            (get_client_ip(request), record["id"])
        )
        conn.commit()
    return record

def resolve_api_key_public(api_key: str) -> dict:
    record = db_one("SELECT * FROM crm_projects WHERE api_key = %s AND is_active = TRUE", (api_key,))
    if not record:
        raise HTTPException(401, "Invalid or inactive API key")
    return record


# ============================================
# CORS MIDDLEWARE
# ============================================

_LOCALHOST_RE = _re.compile(r'^https?://localhost(:\d+)?$')

def _get_project_id_from_path(path: str):
    parts = path.strip("/").split("/")
    if not parts or not parts[0]: return None
    try:
        row = db_one("SELECT id FROM crm_projects WHERE api_key = %s AND is_active = TRUE", (parts[0],))
        return row["id"] if row else None
    except Exception:
        return None

class DynamicCORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        origin = request.headers.get("origin", "").rstrip("/")
        if not origin:
            return await call_next(request)

        # Decide if this origin is permitted. localhost is always allowed (dev).
        # Otherwise the project must exist AND the origin must match its
        # configured frontend/redirect URLs. NEVER echo an unknown origin —
        # that would let any attacker bypass CORS by guessing an API key.
        allow_origin = None
        if _LOCALHOST_RE.match(origin):
            allow_origin = origin
        else:
            project_id = _get_project_id_from_path(request.url.path)
            if project_id:
                allowed = get_allowed_redirect_urls(project_id)
                if origin in allowed:
                    allow_origin = origin

        if request.method == "OPTIONS":
            from starlette.responses import Response as StarResponse
            resp = StarResponse(status_code=204)
            if allow_origin:
                resp.headers["Access-Control-Allow-Origin"]      = allow_origin
                resp.headers["Access-Control-Allow-Credentials"] = "true"
                resp.headers["Vary"]                             = "Origin"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Publishable-Key, X-Web-Chat-Id, X-CSRF-Token"
            resp.headers["Access-Control-Max-Age"]       = "600"
            return resp

        try:
            response = await call_next(request)
        except Exception:
            from starlette.responses import Response as StarResponse
            response = StarResponse(status_code=500)
        if allow_origin:
            response.headers["Access-Control-Allow-Origin"]      = allow_origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"]                             = "Origin"
        return response

# ─── CSRF double-submit cookie ────────────────────────────────────────────
# Exempt paths:
#   /track/   — fire-and-forget analytics (visit, product-view). Anonymous
#               counters only; no user data at risk. They fire on page load
#               before the CSRF cookie is guaranteed to be set.
#   /refresh  — token rotation; the refresh token itself is the credential.
# Add webhook exemptions here when Twilio/Telegram inbound webhooks are added.
_CSRF_SAFE_METHODS   = {"GET", "HEAD", "OPTIONS", "TRACE"}
_CSRF_EXEMPT_SUFFIX  = ("/refresh",)
_CSRF_EXEMPT_SEGMENT = ("/track/",)

class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in _CSRF_SAFE_METHODS:
            return await call_next(request)
        path = request.url.path
        if (any(path.endswith(s) for s in _CSRF_EXEMPT_SUFFIX) or
                any(s in path    for s in _CSRF_EXEMPT_SEGMENT)):
            return await call_next(request)
        cookie = request.cookies.get("csrf_token", "")
        header = request.headers.get("x-csrf-token", "")
        if not cookie or not secrets.compare_digest(
            cookie.encode("utf-8"), header.encode("utf-8")
        ):
            from starlette.responses import Response as _R
            return _R(
                '{"detail":"CSRF token missing or invalid"}',
                status_code=403, media_type="application/json",
            )
        return await call_next(request)

# CSRF inner, CORS outer — 403 responses still carry CORS headers.
app.add_middleware(CSRFMiddleware)
app.add_middleware(DynamicCORSMiddleware)


# ============================================
# МОДЕЛИ
# ============================================

class SendCodeRequest(BaseModel):
    email: str; type: str; name: str = None; password: str = None

class VerifyCodeRequest(BaseModel):
    email: str; code: str

class ResendCodeRequest(BaseModel):
    email: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str; password: str; repeat_password: str

class AddToCart(BaseModel):
    product_id: int
    # variation_id and configuration_id are required for any product that has
    # variations / configurations. Old SDK versions (<2.0.0) sent `size_id`
    # which Pydantic silently dropped → caused FK NOT NULL violation = HTTP 500.
    # Now we surface a clean 422 instead. Storefronts on torta-js >= 2.0.0
    # always send the new keys.
    variation_id: int
    configuration_id: int
    quantity: int = 1

class UpdateCartQuantity(BaseModel):
    quantity: int

class AddToFavorites(BaseModel):
    product_id: int

class AddReview(BaseModel):
    product_id: int; rating: int; comment: str = ""

class ApplyPromoCode(BaseModel):
    code: str

class TrackProductView(BaseModel):
    product_id: int

class PlaceOrderRequest(BaseModel):
    recipient_name: str
    phone: Optional[str] = None
    delivery_method: str = "courier"   # courier | postal
    address: Optional[str] = None
    comment: Optional[str] = None
    payment_method: str = "card"       # card | cash
    promo_code: Optional[str] = None

class FrontReview(BaseModel):
    id: int; user_id: int; user_name: str; rating: int
    comment: str = ""; created_at: Optional[str] = None

class FrontSpecification(BaseModel):
    key: str; value: str

class FrontLayerNode(BaseModel):
    """Layer 3-5 row (deeper than configuration)."""
    id: int
    name: str = ''
    price: Optional[float] = None
    effective_price: Optional[float] = None
    stock_quantity: int = 0
    sold_quantity: int = 0
    children: List["FrontLayerNode"] = []
    specifications: List[FrontSpecification] = []

class FrontConfiguration(BaseModel):
    id: int; configuration_name: str; price: float
    effective_price: Optional[float] = None
    stock_quantity: int
    sold_quantity: int; is_in_cart: bool = False
    cart_item_id: Optional[int] = None; cart_quantity: int = 0
    children: List[FrontLayerNode] = []
    specifications: List[FrontSpecification] = []

class FrontVariation(BaseModel):
    id: int; variation_name: str; image: Optional[str] = None
    price: Optional[float] = None
    effective_price: Optional[float] = None
    stock_quantity: int = 0
    sold_quantity: int = 0
    is_in_cart: bool = False
    configurations: List[FrontConfiguration]
    specifications: List[FrontSpecification] = []

class ProductPageResponse(BaseModel):
    id: int; product_hash: str; title: str
    subtitle: Optional[str] = ""        # short tagline shown under title
    description: Optional[str] = ""     # long body text
    category_id: Optional[int]   = None
    category_name: Optional[str] = None
    category_slug: Optional[str] = None
    seo_title: Optional[str] = None; seo_description: Optional[str] = None
    seo_keywords: Optional[str] = None; custom_fields: Optional[dict] = {}
    is_authenticated: bool; current_user_id: Optional[int] = None
    is_favorite: bool; can_review: bool
    reviews_count: int; average_rating: float
    initial_variation_index: int; initial_configuration_id: Optional[int] = None
    variations: List[FrontVariation]; reviews: List[FrontReview]

class CartPageItem(BaseModel):
    cart_item_id: int; quantity: int; product_id: int; product_hash: str
    variation_id: Optional[int] = None; configuration_id: Optional[int] = None
    title: str; subtitle: Optional[str] = ""; price: float
    configuration_name: Optional[str] = None; variation_name: Optional[str] = None
    image_url: Optional[str] = None; is_favorite: bool = False

class CartPageResponse(BaseModel):
    items: List[CartPageItem]; favorites_ids: List[int]
    subtotal: float; shipping_cost: float; free_shipping_threshold: float
    amount_to_free_shipping: float; shipping_progress: float; total: float


# ============================================
# EMAIL
# ============================================

def send_email(to: str, subject: str, html: str,
               from_name: str = "Torta Store", from_email: str = EMAIL_FROM) -> bool:
    try:
        body = json.dumps({
            "to": to, "subject": subject, "html": html,
            "from_name": from_name, "from_email": from_email,
        }).encode()
        req = urllib.request.Request(
            f"{SES_API_URL}/send", data=body,
            headers={"Content-Type": "application/json", "X-API-Key": SES_INTERNAL_KEY},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read()).get("ok", False)
    except Exception as e:
        print(f"Email error: {e}"); return False

def send_code_email(email: str, code: int, project_id: int = None) -> bool:
    from_name, from_email = get_project_email(project_id) if project_id else ("Torta Store", EMAIL_FROM)
    html = f"""<div style="font-family:Arial,sans-serif;text-align:center;padding:40px">
        <h1 style="color:#333">Your verification code</h1>
        <p style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#000">{str(code)[:3]} {str(code)[3:]}</p>
        <p style="color:#666">This code expires in 10 minutes.</p></div>"""
    return send_email(email, "Verification Code", html, from_name, from_email)

def send_reset_email(email: str, token: str, project_id: int = None) -> bool:
    from_name, from_email = get_project_email(project_id) if project_id else ("Torta Store", EMAIL_FROM)
    frontend = get_project_frontend_url(project_id) if project_id else None
    if not frontend:
        print(f"send_reset_email: Site URL not configured for project_id={project_id}"); return False
    reset_url     = f"{frontend}/reset-password/{token}"
    reset_url_esc = sanitize(reset_url)   # HTML-escapes " < > & ' — prevents href injection
    html = f"""<div style="font-family:Arial,sans-serif;text-align:center;padding:40px">
        <h1 style="color:#333">Reset your password</h1>
        <p style="font-size:16px;color:#666">Click the button below to set a new password. Link expires in 30 minutes.</p>
        <a href="{reset_url_esc}" style="display:inline-block;margin-top:24px;padding:14px 32px;
            background:#0071e3;color:#fff;text-decoration:none;border-radius:16px;font-size:18px;font-weight:600">
            Reset password</a>
        <p style="margin-top:24px;color:#999;font-size:12px;word-break:break-all">{reset_url_esc}</p></div>"""
    return send_email(email, "Password Reset", html, from_name, from_email)


# ============================================
# RATE-LIMIT / VERIFICATION STORAGE
# Backed by Redis when REDIS_URL is set, falls back to in-memory dict for
# single-worker dev. See kvstore.py.
# ============================================

import kvstore

# ── Email OTP (pending verifications) ──────────────────────────────────────
# Key:  pv:<project_id>:<email>
# TTL:  CODE_TTL_MINUTES * 60
def _pv_key(project_id: int, email: str) -> str:
    return f"pv:{project_id}:{email}"
def _pv_get(project_id, email): return kvstore.get(_pv_key(project_id, email))
def _pv_set(project_id, email, value, ttl=None):
    kvstore.set(_pv_key(project_id, email), value, ttl=ttl or CODE_TTL_MINUTES * 60)
def _pv_del(project_id, email): kvstore.delete(_pv_key(project_id, email))

# ── Failed-attempt counters (logins, password reset, etc.) ────────────────
# Key:  fail:<bucket>:<id>      e.g. fail:login:ip:1.2.3.4 / fail:reset:email:foo@bar
# TTL:  BLOCK_MINUTES * 60      (auto-resets after the cool-down window)
# Uses atomic INCR; >= MAX_FAILED_ATTEMPTS = blocked. ttl() reports time left.
def _fail_key(bucket: str, ident: str) -> str:
    return f"fail:{bucket}:{ident}"
def _fail_check(bucket: str, ident: str):
    """Returns (blocked: bool, seconds_left: int). Doesn't increment."""
    key = _fail_key(bucket, ident)
    count = int(kvstore.get(key) or 0)
    if count >= MAX_FAILED_ATTEMPTS:
        return True, max(kvstore.ttl(key), 1)
    return False, 0
def _fail_record(bucket: str, ident: str):
    """Increment the failure counter. Sets TTL on first hit only."""
    return kvstore.incr(_fail_key(bucket, ident), ttl=BLOCK_MINUTES * 60)
def _fail_clear(bucket: str, ident: str):
    kvstore.delete(_fail_key(bucket, ident))

# ── Password reset tokens ──────────────────────────────────────────────────
# Key:  pw_reset:<sha256(raw_token)>
# TTL:  RESET_TTL_MINUTES * 60
def _reset_key(token_hash: str) -> str:
    return f"pw_reset:{token_hash}"
def _reset_get(token_hash):    return kvstore.get(_reset_key(token_hash))
def _reset_set(token_hash, v): kvstore.set(_reset_key(token_hash), v, ttl=RESET_TTL_MINUTES * 60)
def _reset_del(token_hash):    kvstore.delete(_reset_key(token_hash))



# ============================================
# CSRF TOKEN
# ============================================

@app.get("/{api_key}/csrf")
def get_csrf_token(api_key: str, request: Request, response: Response,
                   api_key_record: dict = Depends(resolve_api_key)):
    """Issue (or reuse) a CSRF token cookie for the store frontend.
    The SDK calls this once on init so that subsequent state-changing
    requests can include X-CSRF-Token header.
    """
    token = request.cookies.get("csrf_token", "")
    if not token:
        token = secrets.token_hex(32)
    response.set_cookie(
        "csrf_token", token,
        httponly=False,       # JS must read this to echo it as a header
        samesite="strict",
        secure=COOKIE_SECURE,
        max_age=86400,
        path="/",
    )
    return {"csrf_token": token}


# ============================================
# АУТЕНТИФИКАЦИЯ
# ============================================

@app.post("/{api_key}/send-code")
def send_code(request: SendCodeRequest, req: Request,
              api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    email = request.email.lower().strip()
    ip    = get_client_ip(req)
    now_ts = time.time()

    # Block check (per-IP and per-email windows are independent)
    for bucket, ident in (("login", f"ip:{ip}"), ("login", f"email:{email}")):
        blocked, left = _fail_check(bucket, ident)
        if blocked:
            raise HTTPException(429, f"Too many failed attempts. Try again in {left} seconds.")

    def fail(detail: str):
        for bucket, ident in (("login", f"ip:{ip}"), ("login", f"email:{email}")):
            cnt = _fail_record(bucket, ident)
            if cnt >= MAX_FAILED_ATTEMPTS:
                left = max(kvstore.ttl(_fail_key(bucket, ident)), 1)
                raise HTTPException(429, f"Too many failed attempts. Try again in {left} seconds.")
        raise HTTPException(400, detail)

    if request.type == "register":
        if get_user_by_email(email, project_id): fail("Email already exists")
        if not request.name or not request.password: fail("Name and password required")
        validate_password(request.password)
    elif request.type == "login":
        db_user = get_user_by_email(email, project_id)
        # Generic message — don't distinguish unknown email vs wrong password
        if not db_user: fail("Invalid email or password")
        if not verify_password(request.password or "", db_user["password_hash"]):
            fail("Invalid email or password")
        # Lazy upgrade: re-hash legacy SHA-256 with scrypt
        if is_legacy_hash(db_user["password_hash"]):
            try:
                with db_cursor() as (conn, cur):
                    cur.execute("UPDATE users SET password_hash=%s WHERE id=%s",
                                (hash_password(request.password), db_user["id"]))
                    conn.commit()
            except Exception:
                pass
    else:
        raise HTTPException(400, "Invalid type")

    code = gen_otp(6)
    _pv_set(project_id, email, {
        "code_hash": hash_otp(code), "type": request.type, "name": request.name,
        "password": request.password, "project_id": project_id,
        "expires_ts":        now_ts + CODE_TTL_MINUTES * 60,
        "next_resend_at_ts": now_ts + RESEND_COOLDOWN_SECONDS,
        "attempts": 0,
    })
    if not send_code_email(email, code, project_id):
        _pv_del(project_id, email)
        raise HTTPException(500, "Failed to send email")

    _fail_clear("login", f"ip:{ip}")
    _fail_clear("login", f"email:{email}")
    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.post("/{api_key}/verify-code")
def verify_code(request: VerifyCodeRequest, response: Response, req: Request,
                api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    email  = request.email.lower().strip()
    code   = (request.code or "").replace(" ", "").strip()
    ip     = get_client_ip(req)
    now_ts = time.time()

    for bucket, ident in (("login", f"ip:{ip}"), ("login", f"email:{email}")):
        blocked, left = _fail_check(bucket, ident)
        if blocked:
            raise HTTPException(429, f"Too many failed attempts. Try again in {left} seconds.")

    def fail(detail: str):
        for bucket, ident in (("login", f"ip:{ip}"), ("login", f"email:{email}")):
            cnt = _fail_record(bucket, ident)
            if cnt >= MAX_FAILED_ATTEMPTS:
                left = max(kvstore.ttl(_fail_key(bucket, ident)), 1)
                raise HTTPException(429, f"Too many failed attempts. Try again in {left} seconds.")
        raise HTTPException(400, detail)

    pending = _pv_get(project_id, email)
    if not pending: fail("Code not found or expired")
    if now_ts > float(pending.get("expires_ts", 0)):
        _pv_del(project_id, email)
        raise HTTPException(400, "Code expired")
    # Per-OTP brute-force counter — invalidate the code after too many tries
    pending["attempts"] = int(pending.get("attempts", 0)) + 1
    _pv_set(project_id, email, pending,
            ttl=int(max(float(pending["expires_ts"]) - now_ts, 1)))
    if pending["attempts"] > MAX_FAILED_ATTEMPTS:
        _pv_del(project_id, email)
        raise HTTPException(429, "Too many invalid attempts. Request a new code.")
    if not verify_otp(code, pending.get("code_hash", "")): fail("Invalid code")

    with db_cursor() as (conn, cursor):
        if pending["type"] == "register":
            try:
                cursor.execute(
                    "INSERT INTO users (name, email, password_hash, project_id) VALUES (%s,%s,%s,%s) RETURNING id",
                    (sanitize(pending["name"]), email, hash_password(pending["password"]), project_id)
                )
                user_id = cursor.fetchone()["id"]
                conn.commit()
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                # Race: another request created the same user concurrently
                existing = get_user_by_email(email, project_id)
                if not existing:
                    raise HTTPException(500, "Registration failed")
                user_id = existing["id"]
        else:
            user_id = get_user_by_email(email, project_id)["id"]

    token = create_token(user_id)
    set_auth_cookie(response, token)
    set_refresh_cookie(response, issue_refresh_token(user_id, project_id, req, label="Email login"))
    _pv_del(project_id, email)
    _fail_clear("login", f"ip:{ip}")
    _fail_clear("login", f"email:{email}")
    return {"success": True}


@app.post("/{api_key}/resend-code")
def resend_code(request: ResendCodeRequest, api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    email  = request.email.lower().strip()
    now_ts = time.time()

    pending = _pv_get(project_id, email)
    if not pending:
        raise HTTPException(400, "No pending verification")
    if now_ts > float(pending.get("expires_ts", 0)):
        _pv_del(project_id, email); raise HTTPException(400, "Code expired. Start again.")
    if now_ts < float(pending.get("next_resend_at_ts", 0)):
        left = int(float(pending["next_resend_at_ts"]) - now_ts)
        raise HTTPException(429, f"Resend available in {left} seconds")

    code = gen_otp(6)
    pending.update({
        "code_hash":         hash_otp(code),
        "expires_ts":        now_ts + CODE_TTL_MINUTES * 60,
        "next_resend_at_ts": now_ts + RESEND_COOLDOWN_SECONDS,
        "attempts": 0,
    })
    _pv_set(project_id, email, pending)
    if not send_code_email(email, code, pending["project_id"]):
        raise HTTPException(500, "Failed to send email")
    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.get("/{api_key}/me")
def get_me(request: Request, api_key_record: dict = Depends(resolve_api_key)):
    user = get_user_by_id(get_current_user_id(request), api_key_record["id"])
    if not user: raise HTTPException(401, "User not found")
    return {"id": user["id"], "name": user["name"], "email": user["email"]}


@app.post("/{api_key}/logout")
def logout(response: Response, request: Request,
           api_key_record: dict = Depends(resolve_api_key)):
    revoke_refresh_by_raw(request.cookies.get("authx_refresh", ""), api_key_record["id"])
    clear_auth_cookies(response)
    return {"success": True}


# ============================================
# REFRESH TOKEN / SESSIONS
# ============================================

@app.post("/{api_key}/refresh")
def refresh_session(response: Response, request: Request,
                    api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    raw = request.cookies.get("authx_refresh", "")
    result = consume_refresh_token(raw, project_id, request)
    if not result:
        clear_auth_cookies(response)
        raise HTTPException(401, "Invalid or expired refresh token")
    user_id, new_raw = result
    if not db_one("SELECT 1 FROM users WHERE id=%s AND project_id=%s", (user_id, project_id)):
        clear_auth_cookies(response)
        raise HTTPException(401, "Account not found")
    set_auth_cookie(response, create_token(user_id))
    set_refresh_cookie(response, new_raw)
    return {"success": True}


@app.get("/{api_key}/sessions")
def list_sessions(request: Request, api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    cur_hash = ""
    raw = request.cookies.get("authx_refresh", "")
    if raw:
        cur_hash = hashlib.sha256(raw.encode()).hexdigest()
    rows = db_all(
        """SELECT id, created_at, last_used_at, expires_at, user_agent, ip, label, token_hash
           FROM refresh_tokens
           WHERE user_id=%s AND project_id=%s
             AND revoked_at IS NULL AND expires_at > NOW()
           ORDER BY COALESCE(last_used_at, created_at) DESC""",
        (user_id, project_id),
    )
    return [{
        "id":         r["id"],
        "is_current": r["token_hash"] == cur_hash,
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        "last_used_at": r["last_used_at"].isoformat() if r["last_used_at"] else None,
        "expires_at": r["expires_at"].isoformat() if r["expires_at"] else None,
        "user_agent": r.get("user_agent"),
        "ip":         r.get("ip"),
        "label":      r.get("label"),
    } for r in rows]


@app.delete("/{api_key}/sessions/{session_id}")
def revoke_session(session_id: int, request: Request,
                   api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE refresh_tokens SET revoked_at=NOW(), revoke_reason=%s "
            "WHERE id=%s AND user_id=%s AND project_id=%s AND revoked_at IS NULL",
            (REVOKE_REASON_MANUAL, session_id, user_id, project_id),
        )
        conn.commit()
    return {"ok": True}


@app.post("/{api_key}/logout-all")
def logout_all(response: Response, request: Request,
               api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE refresh_tokens SET revoked_at=NOW(), revoke_reason=%s "
            "WHERE user_id=%s AND project_id=%s AND revoked_at IS NULL",
            (REVOKE_REASON_MANUAL, user_id, project_id),
        )
        conn.commit()
    clear_auth_cookies(response)
    return {"ok": True}


# ============================================
# ВОССТАНОВЛЕНИЕ ПАРОЛЯ
# ============================================

@app.post("/{api_key}/forgot-password")
def forgot_password(request: ForgotPasswordRequest, req: Request,
                    api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    email = request.email.lower().strip()
    ip    = get_client_ip(req)

    for ident in (f"ip:{ip}", f"email:{email}"):
        blocked, left = _fail_check("reset", ident)
        if blocked:
            raise HTTPException(429, f"Too many requests. Try again in {left} seconds.")
        _fail_record("reset", ident)

    user = get_user_by_email(email, project_id)
    if user:
        for k in kvstore.keys_matching("pw_reset:*"):
            d = kvstore.get(k)
            if d and d.get("email") == email and d.get("project_id") == project_id:
                kvstore.delete(k)
        raw_token  = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        _reset_set(token_hash, {
            "email": email, "project_id": project_id, "used": False,
        })
        try:
            send_reset_email(email, raw_token, project_id)
        except Exception:
            pass
    return {"success": True, "message": "If the account exists, a reset email has been sent."}


@app.get("/{api_key}/reset-password/validate/{token}")
def validate_reset_token(token: str, api_key_record: dict = Depends(resolve_api_key)):
    data = _reset_get(hashlib.sha256(token.encode()).hexdigest())
    if (not data or data.get("used") or data.get("project_id") != api_key_record["id"]):
        raise HTTPException(400, "Invalid or expired reset link")
    return {"valid": True, "email": data["email"]}


@app.post("/{api_key}/reset-password")
def reset_password(request: ResetPasswordRequest, api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    if request.password != (request.repeat_password or ""):
        raise HTTPException(400, "Passwords do not match")
    validate_password(request.password)

    token_hash = hashlib.sha256((request.token or "").strip().encode()).hexdigest()
    token_data = _reset_get(token_hash)
    if (not token_data or token_data.get("used")
        or token_data.get("project_id") != project_id):
        raise HTTPException(400, "Invalid or expired reset link")

    token_data["used"] = True
    _reset_set(token_hash, token_data)
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "UPDATE users SET password_hash = %s WHERE email = %s AND project_id = %s",
            (hash_password(request.password), token_data["email"], project_id)
        )
        conn.commit()
    _reset_del(token_hash)
    return {"success": True}


# ============================================
# ПРОДУКТЫ
# ============================================

@app.get("/{api_key}/categories")
def list_categories_public(api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    rows = db_all("""
        SELECT c.id, c.name, c.slug,
               COUNT(p.id) AS products_count
          FROM product_categories c
     LEFT JOIN products p ON p.category_id = c.id
         WHERE c.project_id = %s
      GROUP BY c.id
      ORDER BY LOWER(c.name) ASC
    """, (project_id,))
    return [
        {"id": r["id"], "name": r["name"], "slug": r["slug"],
         "products_count": int(r["products_count"] or 0)}
        for r in rows
    ]


@app.get("/{api_key}/products")
def get_products(api_key_record: dict = Depends(resolve_api_key),
                 category: Optional[str] = None,
                 uncategorized: bool = False):
    project_id = api_key_record["id"]
    with db_cursor() as (_, cursor):
        where  = ["p.project_id = %s"]
        params = [project_id]
        if uncategorized:
            where.append("p.category_id IS NULL")
        elif category:
            where.append("c.slug = %s")
            params.append(category)
        cursor.execute(
            "SELECT p.id, p.title, p.seo_title, p.seo_description, p.seo_keywords, "
            "p.category_id, c.name AS category_name, c.slug AS category_slug "
            "FROM products p "
            "LEFT JOIN product_categories c ON c.id = p.category_id "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY p.id ASC",
            params
        )
        products = cursor.fetchall()
        if not products: return []

        product_ids = [p["id"] for p in products]
        fmt         = ",".join(["%s"] * len(product_ids))

        cursor.execute(
            f"SELECT product_id, MIN(id) as variation_id FROM product_configurations_l1 WHERE product_id IN ({fmt}) GROUP BY product_id",
            product_ids
        )
        first_variation = {r["product_id"]: r["variation_id"] for r in cursor.fetchall()}

        images = {}
        if first_variation:
            vids = list(first_variation.values())
            vfmt = ",".join(["%s"] * len(vids))
            cursor.execute(f"SELECT id, image_url FROM product_configurations_l1 WHERE id IN ({vfmt})", vids)
            images = {r["id"]: r["image_url"] for r in cursor.fetchall()}

        # MIN over Layer 2 prices, falling back to Layer 1 (variation) price for
        # products that haven't filled in Layer 2 yet, or where some layer-2 rows
        # have NULL price (inherit from variation).
        cursor.execute(
            f"SELECT pv.product_id, MIN(COALESCE(pc.price, pv.price)) as price"
            f" FROM product_configurations_l2 pc"
            f" JOIN product_configurations_l1 pv ON pv.id = pc.variation_id"
            f" WHERE pv.product_id IN ({fmt})"
            f" GROUP BY pv.product_id",
            product_ids
        )
        prices = {r["product_id"]: (float(r["price"]) if r["price"] is not None else 0.0)
                  for r in cursor.fetchall()}
        # Fallback: products with no Layer 2 → use Layer 1 price
        cursor.execute(
            f"SELECT product_id, MIN(price) as price FROM product_configurations_l1"
            f" WHERE product_id IN ({fmt}) AND price IS NOT NULL GROUP BY product_id",
            product_ids
        )
        for r in cursor.fetchall():
            if r["product_id"] not in prices:
                prices[r["product_id"]] = float(r["price"])

        cursor.execute(
            f"SELECT product_id, field_key, field_value FROM product_custom_fields WHERE project_id = %s AND product_id IN ({fmt})",
            [project_id] + product_ids
        )
        cf_map = {}
        for r in cursor.fetchall():
            cf_map.setdefault(r["product_id"], {})[r["field_key"]] = r["field_value"]

    return [
        {
            "id": p["id"], "hash": hashids.encode(p["id"]), "title": p["title"],
            "price": prices.get(p["id"], 0),
            "image": images.get(first_variation.get(p["id"])),
            "category_id":   p.get("category_id"),
            "category_name": p.get("category_name"),
            "category_slug": p.get("category_slug"),
            "seo_title": p["seo_title"], "seo_description": p["seo_description"],
            "seo_keywords": p["seo_keywords"], "custom_fields": cf_map.get(p["id"], {}),
        }
        for p in products
    ]


@app.get("/{api_key}/product/{product_hash}", response_model=ProductPageResponse)
def get_product_page(product_hash: str, request: Request,
                     api_key_record: dict = Depends(resolve_api_key)):
    decoded = hashids.decode(product_hash)
    if not decoded: raise HTTPException(404, "Product not found")
    product_id = decoded[0]
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)

    with db_cursor() as (_, cursor):
        cursor.execute(
            "SELECT p.id, p.title, p.subtitle, p.description, p.seo_title, p.seo_description, p.seo_keywords, "
            "p.category_id, c.name AS category_name, c.slug AS category_slug "
            "FROM products p "
            "LEFT JOIN product_categories c ON c.id = p.category_id "
            "WHERE p.id = %s AND p.project_id = %s",
            (product_id, project_id)
        )
        product = cursor.fetchone()
        if not product: raise HTTPException(404, "Product not found")

        cursor.execute(
            # Honour CRM drag-and-drop ordering via the `position` column.
            "SELECT id, product_id, variation_name, image_url, price, stock_quantity, sold_quantity "
            "FROM product_configurations_l1 "
            "WHERE product_id = %s ORDER BY position ASC, id ASC",
            (product_id,)
        )
        variations = cursor.fetchall()

        configurations = []
        layer3_by_parent = {}
        layer4_by_parent = {}
        layer5_by_parent = {}
        specifications_by_node = {}    # key: (layer, parent_id) → list[{key,value}]
        if variations:
            vids = [v["id"] for v in variations]
            vfmt = ",".join(["%s"] * len(vids))
            cursor.execute(
                f"SELECT id, product_id, variation_id, configuration_name, price, stock_quantity, sold_quantity, position "
                f"FROM product_configurations_l2 WHERE variation_id IN ({vfmt}) "
                f"ORDER BY position ASC, id ASC",
                vids
            )
            configurations = cursor.fetchall()
            l2_ids = [c["id"] for c in configurations]

            # Layers 3, 4, 5 — fetch tree depths
            if l2_ids:
                fmt3 = ",".join(["%s"] * len(l2_ids))
                cursor.execute(
                    f"SELECT id, parent_id, name, price, stock_quantity, sold_quantity, position "
                    f"FROM product_configurations_l3 WHERE parent_id IN ({fmt3}) "
                    f"ORDER BY position ASC, id ASC",
                    l2_ids
                )
                l3_rows = cursor.fetchall()
                for r in l3_rows:
                    layer3_by_parent.setdefault(r["parent_id"], []).append(r)
                l3_ids = [r["id"] for r in l3_rows]

                if l3_ids:
                    fmt4 = ",".join(["%s"] * len(l3_ids))
                    cursor.execute(
                        f"SELECT id, parent_id, name, price, stock_quantity, sold_quantity, position "
                        f"FROM product_configurations_l4 WHERE parent_id IN ({fmt4}) "
                        f"ORDER BY position ASC, id ASC",
                        l3_ids
                    )
                    l4_rows = cursor.fetchall()
                    for r in l4_rows:
                        layer4_by_parent.setdefault(r["parent_id"], []).append(r)
                    l4_ids = [r["id"] for r in l4_rows]

                    if l4_ids:
                        fmt5 = ",".join(["%s"] * len(l4_ids))
                        cursor.execute(
                            f"SELECT id, parent_id, name, price, stock_quantity, sold_quantity, position "
                            f"FROM product_configurations_l5 WHERE parent_id IN ({fmt5}) "
                            f"ORDER BY position ASC, id ASC",
                            l4_ids
                        )
                        for r in cursor.fetchall():
                            layer5_by_parent.setdefault(r["parent_id"], []).append(r)

            # Specifications: legacy variation_id (layer 1) + new layer/parent_id rows.
            cursor.execute(
                f"SELECT variation_id, layer, parent_id, spec_key, spec_value, position "
                f"FROM product_specifications "
                f"WHERE variation_id IN ({vfmt}) OR parent_id IS NOT NULL "
                f"ORDER BY position ASC, id ASC",
                vids
            )
            for row in cursor.fetchall():
                layer_v = row.get("layer") or 1
                parent_id = row.get("parent_id") if row.get("parent_id") is not None else row.get("variation_id")
                specifications_by_node.setdefault((layer_v, parent_id), []).append({
                    "key":   row["spec_key"],
                    "value": row["spec_value"],
                })

        cursor.execute(
            "SELECT pr.id, pr.user_id, pr.rating, pr.comment, pr.created_at, u.name AS user_name "
            "FROM product_reviews pr JOIN users u ON pr.user_id = u.id AND u.project_id = %s "
            "WHERE pr.product_id = %s AND pr.project_id = %s ORDER BY pr.created_at DESC",
            (project_id, product_id, project_id)
        )
        reviews_raw = cursor.fetchall()

        cursor.execute(
            "SELECT field_key, field_value FROM product_custom_fields WHERE project_id = %s AND product_id = %s",
            (project_id, product_id)
        )
        custom_fields = {r["field_key"]: r["field_value"] for r in cursor.fetchall()}

        is_favorite = False
        can_review  = False
        cart_map    = {}

        if user_id:
            cursor.execute(
                "SELECT 1 FROM favorites WHERE user_id = %s AND product_id = %s AND project_id = %s LIMIT 1",
                (user_id, product_id, project_id)
            )
            is_favorite = cursor.fetchone() is not None

            cursor.execute(
                "SELECT ci.id AS cart_item_id, ci.variation_id, ci.configuration_id, ci.quantity "
                "FROM cart_items ci JOIN carts c ON ci.cart_id = c.id "
                "WHERE c.user_id = %s AND ci.product_id = %s AND c.project_id = %s",
                (user_id, product_id, project_id)
            )
            for row in cursor.fetchall():
                cart_map[(row["variation_id"], row["configuration_id"])] = row

            cursor.execute(
                "SELECT id FROM product_reviews WHERE product_id = %s AND user_id = %s AND project_id = %s LIMIT 1",
                (product_id, user_id, project_id)
            )
            if not cursor.fetchone():
                cursor.execute(
                    "SELECT DISTINCT oh.id FROM order_history oh JOIN order_items oi ON oh.id = oi.order_id "
                    "WHERE oh.user_id = %s AND oi.product_id = %s AND oh.project_id = %s "
                    "AND oh.status IN ('delivered','returned') LIMIT 1",
                    (user_id, product_id, project_id)
                )
                can_review = cursor.fetchone() is not None

    # Build tree with effective_price walk-up. Layer 1 (variation) sets the
    # baseline; deeper layers inherit when their own price is NULL.
    def _eff(own_price, parent_eff):
        if own_price is None: return parent_eff
        return float(own_price)

    def _build_subtree(rows, by_parent_next, layer_below, parent_eff):
        """rows: items at the current layer. by_parent_next: dict id → next layer rows.
        layer_below: 3,4,5 — for spec attachment + child fetching."""
        out = []
        for r in rows:
            eff = _eff(r.get("price"), parent_eff)
            children_rows = by_parent_next.get(r["id"], []) if by_parent_next else []
            if   layer_below == 3: nested = _build_subtree(children_rows, layer4_by_parent, 4, eff)
            elif layer_below == 4: nested = _build_subtree(children_rows, layer5_by_parent, 5, eff)
            elif layer_below == 5: nested = _build_subtree(children_rows, None,             6, eff)
            else:                   nested = []
            out.append({
                "id":             r["id"],
                "name":           r.get("name") or r.get("configuration_name") or "",
                "price":          float(r["price"]) if r.get("price") is not None else None,
                "effective_price": eff,
                "stock_quantity": r.get("stock_quantity") or 0,
                "sold_quantity":  r.get("sold_quantity")  or 0,
                "children":       nested,
                "specifications": specifications_by_node.get((layer_below, r["id"]), []),
            })
        return out

    cfg_by_variation = {}
    for c in configurations:
        # Note: stock filter intentionally relaxed for multi-layer products —
        # an intermediate Layer 2 row can have stock=0 but its Layer 3+ leaves
        # carry the real stock. Frontend decides what to show.
        cart_item = cart_map.get((c["variation_id"], c["id"]))
        children_l3 = layer3_by_parent.get(c["id"], [])
        # parent_eff for layer 2 is the variation's own price (Layer 1)
        # We'll fix this per-variation below
        cfg_by_variation.setdefault(c["variation_id"], []).append({
            "_raw": c,
            "_children_l3": children_l3,
            "cart_item": cart_item,
        })

    final_variations = []
    for v in variations:
        var_eff = _eff(v.get("price"), None)
        cfg_entries = cfg_by_variation.get(v["id"], [])
        configurations_out = []
        for entry in cfg_entries:
            c = entry["_raw"]
            cart_item = entry["cart_item"]
            cfg_eff = _eff(c.get("price"), var_eff)
            l3_tree = _build_subtree(entry["_children_l3"], layer4_by_parent, 4, cfg_eff)
            # `price` field for backwards compat: float, falling back to effective if NULL.
            display_price = float(c["price"]) if c.get("price") is not None else (cfg_eff if cfg_eff is not None else 0.0)
            configurations_out.append({
                "id": c["id"], "configuration_name": c["configuration_name"],
                "price": display_price, "effective_price": cfg_eff,
                "stock_quantity": c["stock_quantity"], "sold_quantity": c["sold_quantity"],
                "is_in_cart": cart_item is not None,
                "cart_item_id": cart_item["cart_item_id"] if cart_item else None,
                "cart_quantity": cart_item["quantity"] if cart_item else 0,
                "children":       l3_tree,
                "specifications": specifications_by_node.get((2, c["id"]), []),
            })

        # Skip variations that have no Layer-2 rows AND no own-Layer-1 price/stock
        # (i.e. truly empty placeholder). Otherwise show the variation.
        has_purchasable = bool(configurations_out) or (var_eff is not None and (v.get("stock_quantity") or 0) > 0)
        if not has_purchasable: continue

        final_variations.append({
            "id": v["id"], "variation_name": v["variation_name"], "image": v["image_url"],
            "price": float(v["price"]) if v.get("price") is not None else None,
            "effective_price": var_eff,
            "stock_quantity": v.get("stock_quantity") or 0,
            "sold_quantity":  v.get("sold_quantity")  or 0,
            "is_in_cart": any(c["is_in_cart"] for c in configurations_out),
            "configurations": configurations_out,
            "specifications": specifications_by_node.get((1, v["id"]), []),
        })

    reviews = [
        {
            "id": r["id"], "user_id": r["user_id"], "user_name": r["user_name"],
            "rating": r["rating"], "comment": r["comment"] or "",
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in reviews_raw
    ]
    reviews_count  = len(reviews)
    average_rating = round(sum(r["rating"] for r in reviews) / reviews_count, 1) if reviews_count else 0.0
    initial_configuration_id = (
        final_variations[0]["configurations"][0]["id"]
        if final_variations and final_variations[0]["configurations"] else None
    )

    return {
        "id": product["id"], "product_hash": hashids.encode(product["id"]),
        "title": product["title"], "subtitle": product["subtitle"] or "",
        "description": product["description"] or "",
        "category_id":   product.get("category_id"),
        "category_name": product.get("category_name"),
        "category_slug": product.get("category_slug"),
        "seo_title": product["seo_title"], "seo_description": product["seo_description"],
        "seo_keywords": product["seo_keywords"], "custom_fields": custom_fields,
        "is_authenticated": user_id is not None, "current_user_id": user_id,
        "is_favorite": is_favorite, "can_review": can_review,
        "reviews_count": reviews_count, "average_rating": average_rating,
        "initial_variation_index": 0, "initial_configuration_id": initial_configuration_id,
        "variations": final_variations, "reviews": reviews,
    }


# ============================================
# КОРЗИНА
# ============================================

@app.post("/{api_key}/cart/add")
def add_to_cart(item: AddToCart, request: Request,
                api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    with db_cursor() as (conn, cursor):
        cursor.execute("SELECT id FROM carts WHERE user_id = %s AND project_id = %s", (user_id, project_id))
        cart = cursor.fetchone()
        if not cart:
            cursor.execute("INSERT INTO carts (user_id, project_id) VALUES (%s,%s) RETURNING id", (user_id, project_id))
            cart_id = cursor.fetchone()["id"]
            conn.commit()
        else:
            cart_id = cart["id"]

        cursor.execute("SELECT id FROM products WHERE id = %s AND project_id = %s", (item.product_id, project_id))
        if not cursor.fetchone(): raise HTTPException(403, "Product not in this store")

        cursor.execute(
            "SELECT id, quantity FROM cart_items WHERE cart_id=%s AND product_id=%s AND variation_id=%s AND configuration_id=%s",
            (cart_id, item.product_id, item.variation_id, item.configuration_id)
        )
        existing = cursor.fetchone()
        if existing:
            cursor.execute("UPDATE cart_items SET quantity=%s WHERE id=%s",
                           (existing["quantity"] + item.quantity, existing["id"]))
        else:
            cursor.execute(
                "INSERT INTO cart_items (cart_id, product_id, variation_id, configuration_id, quantity) VALUES (%s,%s,%s,%s,%s)",
                (cart_id, item.product_id, item.variation_id, item.configuration_id, item.quantity)
            )
        conn.commit()
    return {"success": True}


@app.delete("/{api_key}/cart/clear")
def clear_cart(request: Request, api_key_record: dict = Depends(resolve_api_key)):
    user_id = get_current_user_id(request)
    with db_cursor() as (conn, cursor):
        cursor.execute("SELECT id FROM carts WHERE user_id=%s AND project_id=%s", (user_id, api_key_record["id"]))
        cart = cursor.fetchone()
        if cart:
            cursor.execute("DELETE FROM cart_items WHERE cart_id=%s", (cart["id"],))
            conn.commit()
    return {"success": True}


@app.delete("/{api_key}/cart/{cart_item_id}")
def remove_from_cart(cart_item_id: int, request: Request,
                     api_key_record: dict = Depends(resolve_api_key)):
    user_id = get_current_user_id(request)
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "SELECT ci.id FROM cart_items ci JOIN carts c ON ci.cart_id=c.id "
            "WHERE ci.id=%s AND c.user_id=%s AND c.project_id=%s",
            (cart_item_id, user_id, api_key_record["id"])
        )
        if not cursor.fetchone(): raise HTTPException(404, "Cart item not found")
        cursor.execute("DELETE FROM cart_items WHERE id=%s", (cart_item_id,))
        conn.commit()
    return {"success": True}


@app.put("/{api_key}/cart/{cart_item_id}")
def update_cart_quantity(cart_item_id: int, data: UpdateCartQuantity, request: Request,
                         api_key_record: dict = Depends(resolve_api_key)):
    if data.quantity < 1: raise HTTPException(400, "Quantity must be at least 1")
    user_id = get_current_user_id(request)
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "SELECT ci.id, ci.configuration_id FROM cart_items ci JOIN carts c ON ci.cart_id=c.id "
            "WHERE ci.id=%s AND c.user_id=%s AND c.project_id=%s",
            (cart_item_id, user_id, api_key_record["id"])
        )
        item = cursor.fetchone()
        if not item: raise HTTPException(404, "Cart item not found")
        cursor.execute("SELECT stock_quantity FROM product_configurations_l2 WHERE id=%s", (item["configuration_id"],))
        cfg = cursor.fetchone()
        if cfg and data.quantity > cfg["stock_quantity"]:
            raise HTTPException(400, f"Only {cfg['stock_quantity']} items in stock")
        cursor.execute("UPDATE cart_items SET quantity=%s WHERE id=%s", (data.quantity, cart_item_id))
        conn.commit()
    return {"success": True}


@app.get("/{api_key}/cart", response_model=CartPageResponse)
def get_cart(request: Request, api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)

    with db_cursor() as (_, cursor):
        cursor.execute(
            "SELECT shipping_cost, free_shipping_threshold FROM shipping_settings WHERE project_id=%s LIMIT 1",
            (project_id,)
        )
        settings       = cursor.fetchone()
        shipping_cost  = float(settings["shipping_cost"])           if settings else 10.0
        free_threshold = float(settings["free_shipping_threshold"]) if settings else 2000.0

        cursor.execute(
            "SELECT product_id FROM favorites WHERE user_id=%s AND project_id=%s",
            (user_id, project_id)
        )
        favorites_ids = [r["product_id"] for r in cursor.fetchall()]
        favorites_set = set(favorites_ids)

        cursor.execute("SELECT id FROM carts WHERE user_id=%s AND project_id=%s", (user_id, project_id))
        cart = cursor.fetchone()
        if not cart:
            return {
                "items": [], "favorites_ids": favorites_ids, "subtotal": 0,
                "shipping_cost": shipping_cost, "free_shipping_threshold": free_threshold,
                "amount_to_free_shipping": free_threshold, "shipping_progress": 0, "total": 0,
            }

        cursor.execute(
            "SELECT ci.id as cart_item_id, ci.quantity, ci.product_id, ci.variation_id, ci.configuration_id, "
            "p.title, p.subtitle, pc.price, pc.configuration_name, pv.variation_name, pv.image_url "
            "FROM cart_items ci JOIN products p ON ci.product_id=p.id "
            "LEFT JOIN product_configurations_l1 pv ON ci.variation_id=pv.id "
            "LEFT JOIN product_configurations_l2 pc ON ci.configuration_id=pc.id "
            "WHERE ci.cart_id=%s",
            (cart["id"],)
        )
        rows = cursor.fetchall()

    items = []; subtotal = 0.0
    for row in rows:
        price = float(row["price"] or 0); subtotal += price * row["quantity"]
        items.append({**row, "price": price, "product_hash": hashids.encode(row["product_id"]),
                      "is_favorite": row["product_id"] in favorites_set})

    final_shipping    = 0.0 if subtotal >= free_threshold else shipping_cost
    shipping_progress = min((subtotal / free_threshold) * 100, 100) if free_threshold > 0 else 100
    amount_to_free    = max(free_threshold - subtotal, 0)

    return {
        "items": items, "favorites_ids": favorites_ids,
        "subtotal": round(subtotal, 2), "shipping_cost": round(final_shipping, 2),
        "free_shipping_threshold": free_threshold,
        "amount_to_free_shipping": round(amount_to_free, 2),
        "shipping_progress": round(shipping_progress, 2),
        "total": round(subtotal + final_shipping, 2),
    }


# ============================================
# ИЗБРАННОЕ
# ============================================

@app.post("/{api_key}/favorites/add")
def add_to_favorites(item: AddToFavorites, request: Request,
                     api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (item.product_id, project_id)):
        raise HTTPException(403, "Product not in this store")
    try:
        with db_cursor() as (conn, cursor):
            cursor.execute(
                "INSERT INTO favorites (user_id, product_id, project_id) VALUES (%s,%s,%s)",
                (user_id, item.product_id, project_id)
            )
            conn.commit()
    except psycopg2.errors.UniqueViolation:
        pass
    return {"success": True}


@app.get("/{api_key}/favorites")
def get_favorites(request: Request, api_key_record: dict = Depends(resolve_api_key)):
    user_id = get_current_user_id(request)
    rows = db_all(
        "SELECT f.product_id, p.title FROM favorites f JOIN products p ON f.product_id=p.id "
        "WHERE f.user_id=%s AND f.project_id=%s",
        (user_id, api_key_record["id"])
    )
    return [{**r, "hash": hashids.encode(r["product_id"])} for r in rows]


@app.delete("/{api_key}/favorites/{product_hash}")
def remove_from_favorites(product_hash: str, request: Request,
                           api_key_record: dict = Depends(resolve_api_key)):
    decoded = hashids.decode(product_hash)
    if not decoded: raise HTTPException(404, "Product not found")
    user_id = get_current_user_id(request)
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "DELETE FROM favorites WHERE product_id=%s AND user_id=%s AND project_id=%s",
            (decoded[0], user_id, api_key_record["id"])
        )
        conn.commit()
    return {"success": True}


# ============================================
# ОТЗЫВЫ
# ============================================

@app.post("/{api_key}/reviews/add")
def add_review(review: AddReview, request: Request,
               api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    if not 1 <= review.rating <= 5: raise HTTPException(400, "Rating must be between 1 and 5")
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (review.product_id, project_id)):
        raise HTTPException(403, "Product not in this store")
    try:
        with db_cursor() as (conn, cursor):
            cursor.execute(
                "INSERT INTO product_reviews (product_id, user_id, rating, comment, created_at, project_id) "
                "VALUES (%s,%s,%s,%s,NOW(),%s)",
                (review.product_id, user_id, review.rating, sanitize(review.comment), project_id)
            )
            conn.commit()
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(400, "You have already reviewed this product")
    return {"success": True}


@app.get("/{api_key}/reviews/can-review/{product_id}")
def can_user_review(product_id: int, request: Request,
                    api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    try:
        user_id = get_current_user_id(request)
    except Exception:
        return {"can_review": False, "reason": "not_authenticated"}

    if db_one("SELECT id FROM product_reviews WHERE product_id=%s AND user_id=%s AND project_id=%s",
              (product_id, user_id, project_id)):
        return {"can_review": False, "reason": "already_reviewed"}

    can = bool(db_one(
        "SELECT DISTINCT oh.id FROM order_history oh JOIN order_items oi ON oh.id=oi.order_id "
        "WHERE oh.user_id=%s AND oi.product_id=%s AND oh.project_id=%s "
        "AND oh.status IN ('delivered','returned') LIMIT 1",
        (user_id, product_id, project_id)
    ))
    return {"can_review": can} if can else {"can_review": False, "reason": "not_purchased"}


@app.delete("/{api_key}/reviews/{review_id}")
def delete_review(review_id: int, request: Request,
                  api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    review = db_one("SELECT user_id FROM product_reviews WHERE id=%s AND project_id=%s", (review_id, project_id))
    if not review:  raise HTTPException(404, "Review not found")
    if review["user_id"] != user_id: raise HTTPException(403, "Not authorized")
    with db_cursor() as (conn, cursor):
        cursor.execute("DELETE FROM product_reviews WHERE id=%s AND project_id=%s", (review_id, project_id))
        conn.commit()
    return {"success": True}


# ============================================
# ПРОМОКОДЫ
# ============================================

@app.post("/{api_key}/promo-code/apply")
def apply_promo_code(data: ApplyPromoCode, request: Request,
                     api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    now        = datetime.utcnow()

    with db_cursor() as (_, cursor):
        cursor.execute("SELECT id FROM carts WHERE user_id=%s AND project_id=%s", (user_id, project_id))
        cart = cursor.fetchone()
        if not cart: raise HTTPException(400, "Cart is empty")

        cursor.execute(
            "SELECT SUM(pc.price * ci.quantity) as subtotal FROM cart_items ci "
            "JOIN product_configurations_l2 pc ON ci.configuration_id=pc.id WHERE ci.cart_id=%s",
            (cart["id"],)
        )
        subtotal = float((cursor.fetchone() or {}).get("subtotal") or 0)
        if subtotal == 0: raise HTTPException(400, "Cart is empty")

        cursor.execute(
            "SELECT * FROM promo_codes WHERE code=%s AND project_id=%s AND is_active=TRUE",
            (data.code.strip().upper(), project_id)
        )
        promo = cursor.fetchone()
        if not promo: raise HTTPException(404, "Promo code not found")

        if promo["valid_from"]  and promo["valid_from"]  > now: raise HTTPException(400, "Promo code not yet valid")
        if promo["valid_until"] and promo["valid_until"] < now: raise HTTPException(400, "Promo code expired")
        if subtotal < float(promo["min_order_amount"]):
            raise HTTPException(400, f"Minimum order amount is {promo['min_order_amount']}")
        if promo["usage_limit"] and promo["times_used"] >= promo["usage_limit"]:
            raise HTTPException(400, "Usage limit reached")

        dv = float(promo["discount_value"])
        if promo["discount_type"] == "percentage":
            discount = subtotal * (dv / 100)
            if promo["max_discount"]: discount = min(discount, float(promo["max_discount"]))
        else:
            discount = dv

        cursor.execute(
            "SELECT shipping_cost, free_shipping_threshold FROM shipping_settings WHERE project_id=%s LIMIT 1",
            (project_id,)
        )
        settings       = cursor.fetchone()
        shipping_cost  = float(settings["shipping_cost"])           if settings else 10.0
        free_threshold = float(settings["free_shipping_threshold"]) if settings else 2000.0
        final_shipping = 0.0 if subtotal >= free_threshold else shipping_cost

    return {
        "success": True, "code": promo["code"],
        "discount": round(discount, 2),
        "discount_percent": round((discount / subtotal) * 100) if subtotal > 0 else 0,
        "subtotal": round(subtotal, 2), "shipping_cost": final_shipping,
        "total": round(subtotal + final_shipping - discount, 2),
    }


# ============================================
# ЗАКАЗЫ
# ============================================

@app.post("/{api_key}/orders")
def place_order(data: PlaceOrderRequest, request: Request,
                api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)

    rn = sanitize(data.recipient_name.strip())
    if not rn:
        raise HTTPException(400, "Recipient name is required")
    if data.delivery_method == "courier" and not (data.address or "").strip():
        raise HTTPException(400, "Address is required for courier delivery")

    with db_cursor() as (conn, cursor):
        # Корзина
        cursor.execute("SELECT id FROM carts WHERE user_id=%s AND project_id=%s", (user_id, project_id))
        cart = cursor.fetchone()
        if not cart:
            raise HTTPException(400, "Cart is empty")

        cursor.execute(
            "SELECT ci.id, ci.product_id, ci.variation_id, ci.configuration_id, ci.quantity, "
            "pc.price, pc.stock_quantity, p.title, pv.variation_name "
            "FROM cart_items ci "
            "JOIN product_configurations_l2 pc ON ci.configuration_id = pc.id "
            "JOIN products p ON ci.product_id = p.id "
            "JOIN product_configurations_l1 pv ON ci.variation_id = pv.id "
            "WHERE ci.cart_id = %s",
            (cart["id"],)
        )
        items = cursor.fetchall()
        if not items:
            raise HTTPException(400, "Cart is empty")

        # Проверяем наличие
        for it in items:
            if it["stock_quantity"] < it["quantity"]:
                raise HTTPException(400, f"Not enough stock for {it['title']}")

        subtotal = sum(float(it["price"]) * it["quantity"] for it in items)

        # РџСЂРѕРјРѕРєРѕРґ
        discount = 0.0
        if data.promo_code:
            cursor.execute(
                "SELECT * FROM promo_codes WHERE code=%s AND project_id=%s AND is_active=TRUE",
                (data.promo_code.strip().upper(), project_id)
            )
            promo = cursor.fetchone()
            if promo:
                now = datetime.utcnow()
                if (not promo["valid_from"] or promo["valid_from"] <= now) and \
                   (not promo["valid_until"] or promo["valid_until"] >= now) and \
                   subtotal >= float(promo["min_order_amount"]) and \
                   (not promo["usage_limit"] or promo["times_used"] < promo["usage_limit"]):
                    dv = float(promo["discount_value"])
                    if promo["discount_type"] == "percentage":
                        discount = subtotal * (dv / 100)
                        if promo["max_discount"]: discount = min(discount, float(promo["max_discount"]))
                    else:
                        discount = dv
                    cursor.execute(
                        "UPDATE promo_codes SET times_used = times_used + 1 WHERE id=%s", (promo["id"],)
                    )

        # Стоимость доставки
        cursor.execute(
            "SELECT shipping_cost, free_shipping_threshold FROM shipping_settings WHERE project_id=%s LIMIT 1",
            (project_id,)
        )
        ship_settings  = cursor.fetchone()
        shipping_cost  = float(ship_settings["shipping_cost"])           if ship_settings else 0.0
        free_threshold = float(ship_settings["free_shipping_threshold"]) if ship_settings else 0.0
        final_shipping = 0.0 if (data.delivery_method == "postal" or subtotal >= free_threshold) else shipping_cost

        total = round(subtotal + final_shipping - discount, 2)

        # Создаём заказ
        cursor.execute(
            """INSERT INTO order_history
               (project_id, user_id, total_amount, status,
                delivery_method, recipient_name, phone, address, comment, payment_method)
               VALUES (%s,%s,%s,'new',%s,%s,%s,%s,%s,%s) RETURNING id""",
            (project_id, user_id, round(float(total), 2),
             data.delivery_method, rn,
             sanitize(data.phone or ""), sanitize(data.address or ""),
             sanitize(data.comment or ""), data.payment_method)
        )
        order_id = cursor.fetchone()["id"]

        # Позиции заказа
        for it in items:
            cursor.execute(
                "INSERT INTO order_items (order_id, product_id, variation_id, configuration_id, quantity, price) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (order_id, it["product_id"], it["variation_id"], it["configuration_id"], it["quantity"], it["price"])
            )
            # Уменьшаем остаток
            cursor.execute(
                "UPDATE product_configurations_l2 SET stock_quantity = stock_quantity - %s WHERE id=%s",
                (it["quantity"], it["configuration_id"])
            )

        # Очищаем корзину
        cursor.execute("DELETE FROM cart_items WHERE cart_id=%s", (cart["id"],))
        conn.commit()

    # Email to customer
    user = db_one("SELECT name, email FROM users WHERE id=%s", (user_id,))
    from_name, from_email = get_project_email(project_id)
    if user and user.get("email"):
        customer_name = sanitize(user["name"] or "Customer")
        items_html = "".join(
            "<tr>"
            "<td style='padding:6px 0;color:#333'>" + sanitize(it["title"]) + " &mdash; " + sanitize(it["variation_name"]) + "</td>"
            "<td style='padding:6px 0;text-align:right;color:#333'>" + str(it["quantity"]) + " &times; " + str(int(float(it["price"]))) + "</td>"
            "</tr>"
            for it in items
        )
        shipping_row = (
            "<tr><td style='padding:6px 0;color:#888'>Shipping</td>"
            "<td style='padding:6px 0;text-align:right;color:#888'>" + str(int(final_shipping)) + "</td></tr>"
        ) if final_shipping else ""
        send_email(
            to=user["email"],
            subject="Order #" + str(order_id) + " confirmed",
            html=(
                "<div style='font-family:sans-serif;max-width:520px;margin:auto'>"
                "<h2 style='color:#0071E3'>Order #" + str(order_id) + " confirmed!</h2>"
                "<p>Hi " + customer_name + ", your order has been placed and is being processed.</p>"
                "<table style='width:100%;border-collapse:collapse'>" + items_html + shipping_row + "</table>"
                "<hr style='margin:16px 0'>"
                "<p><b>Total: $" + f"{float(total):.2f}" + "</b></p>"
                "<p>We will notify you when the status changes.</p>"
                "</div>"
            ),
            from_name=from_name,
            from_email=from_email,
        )

    return {"success": True, "order_id": order_id}


@app.get("/{api_key}/orders")
def get_my_orders(request: Request, api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    # Optional auth — return 401 if not logged in
    token = request.cookies.get("authx_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        user_id = int(jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])["sub"])
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

    orders = db_all(
        """SELECT oh.id, oh.total_amount, oh.status, oh.delivery_method,
                  oh.recipient_name, oh.address, oh.payment_method, oh.comment,
                  oh.created_at, oh.updated_at
           FROM order_history oh
           WHERE oh.user_id=%s AND oh.project_id=%s
           ORDER BY oh.created_at DESC""",
        (user_id, project_id)
    )

    result = []
    for o in orders:
        items = db_all(
            """SELECT oi.quantity, oi.price,
                      p.title, pv.variation_name, pv.image_url, pc.configuration_name
               FROM order_items oi
               JOIN products p ON oi.product_id=p.id
               JOIN product_configurations_l1 pv ON oi.variation_id=pv.id
               JOIN product_configurations_l2 pc ON oi.configuration_id=pc.id
               WHERE oi.order_id=%s""",
            (o["id"],)
        )
        result.append({
            "id":              o["id"],
            "total_amount":    o["total_amount"],
            "status":          o["status"],
            "delivery_method": o["delivery_method"],
            "recipient_name":  o["recipient_name"],
            "address":         o["address"],
            "payment_method":  o["payment_method"],
            "comment":         o["comment"],
            "created_at":      o["created_at"].isoformat() if o["created_at"] else None,
            "updated_at":      o["updated_at"].isoformat() if o["updated_at"] else None,
            "items": [
                {
                    "title":              it["title"],
                    "variation_name":     it["variation_name"],
                    "configuration_name": it["configuration_name"],
                    "image_url":          it["image_url"],
                    "quantity":           it["quantity"],
                    "price":              float(it["price"]),
                }
                for it in items
            ],
        })
    return result


# ============================================
# ТРЕКИНГ (воронка продаж)
# ============================================

@app.post("/{api_key}/track/visit")
def track_visit(request: Request, api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)
    ip         = get_client_ip(request)
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "SELECT id FROM site_visits WHERE ip=%s AND project_id=%s AND created_at >= NOW() - INTERVAL '30 seconds'",
            (ip, project_id)
        )
        if cursor.fetchone(): return {"success": True, "skipped": True}
        cursor.execute("INSERT INTO site_visits (user_id, ip, project_id) VALUES (%s,%s,%s)", (user_id, ip, project_id))
        conn.commit()
    return {"success": True}


@app.post("/{api_key}/track/product-view")
def track_product_view(data: TrackProductView, request: Request,
                       api_key_record: dict = Depends(resolve_api_key)):
    """Один человек (по IP) = одна запись в сутки для воронки продаж."""
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)
    ip         = get_client_ip(request)
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "SELECT id FROM product_page_views WHERE ip=%s AND project_id=%s AND DATE(created_at)=CURRENT_DATE",
            (ip, project_id)
        )
        if cursor.fetchone(): return {"success": True, "skipped": True}
        cursor.execute(
            "INSERT INTO product_page_views (product_id, user_id, ip, project_id) VALUES (%s,%s,%s,%s)",
            (data.product_id, user_id, ip, project_id)
        )
        conn.commit()
    return {"success": True}


# ============================================
# GOOGLE OAUTH (per-project credentials)
# ============================================

@app.get("/{api_key}/auth/google/login")
def magaz_google_login(api_key: str, api_key_record: dict = Depends(resolve_api_key_public)):
    import urllib.parse
    client_id, _ = get_google_credentials(api_key_record["id"])
    if not client_id: raise HTTPException(404, "Google OAuth not configured for this store")
    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key}/auth/google/callback"
    # CSRF protection — random state stored in short-lived cookie, validated
    # on callback. Without this an attacker can trick a victim into logging
    # into the attacker's account.
    state = secrets.token_urlsafe(32)
    params = {
        "client_id": client_id, "redirect_uri": redirect_uri,
        "response_type": "code", "scope": "openid email profile",
        "access_type": "offline", "prompt": "select_account",
        "state": state,
    }
    redirect = RedirectResponse(
        "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    )
    # path="/" so cookie reliably survives the cross-origin redirect from Google
    redirect.set_cookie(
        key="oa_state_google", value=state, httponly=True, max_age=600,
        samesite="lax", secure=COOKIE_SECURE, path="/",
    )
    return redirect


@app.get("/{api_key}/auth/google/callback")
def magaz_google_callback(api_key: str, request: Request,
                           api_key_record: dict = Depends(resolve_api_key_public),
                           code: str = None, error: str = None, state: str = None):
    project_id = api_key_record["id"]
    frontend   = get_project_frontend_url(project_id)
    if not frontend:
        return RedirectResponse("/?error=site_url_not_configured")
    cookie_state = request.cookies.get("oa_state_google", "")
    if not state or not cookie_state or not _hmac.compare_digest(state, cookie_state):
        return RedirectResponse(f"{frontend}/login?error=oauth_state_mismatch")
    try:
        return _magaz_google_callback_inner(api_key, project_id, code, error, frontend, request)
    except Exception:
        traceback.print_exc()
        return RedirectResponse(f"{frontend}/login?error=server_error")


def _magaz_google_callback_inner(api_key, project_id, code, error, frontend, request):
    import urllib.parse, json as _json

    if error or not code:
        return RedirectResponse(f"{frontend}/login?error=google_cancelled")

    client_id, client_secret = get_google_credentials(project_id)
    if not client_id:
        return RedirectResponse(f"{frontend}/login?error=google_not_configured")

    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key}/auth/google/callback"
    post_data    = urllib.parse.urlencode({
        "code": code, "client_id": client_id, "client_secret": client_secret,
        "redirect_uri": redirect_uri, "grant_type": "authorization_code",
    }).encode()

    try:
        with urllib.request.urlopen(urllib.request.Request(
            "https://oauth2.googleapis.com/token", data=post_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST"
        )) as resp:
            tokens = _json.loads(resp.read())
    except Exception:
        return RedirectResponse(f"{frontend}/login?error=google_token")

    id_token_str = tokens.get("id_token")
    if not id_token_str:
        return RedirectResponse(f"{frontend}/login?error=google_no_id_token")

    try:
        with urllib.request.urlopen(
            f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token_str}"
        ) as resp:
            idinfo = _json.loads(resp.read())
        if idinfo.get("aud") != client_id: raise ValueError("audience mismatch")
        g_id  = idinfo["sub"]
        email = idinfo["email"]
        name  = idinfo.get("name", email.split("@")[0])
    except Exception as e:
        print(f"Google verify error: {e}")
        return RedirectResponse(f"{frontend}/login?error=google_verify")

    with db_cursor() as (conn, cursor):
        cursor.execute("SELECT id FROM users WHERE google_id=%s AND project_id=%s", (g_id, project_id))
        user = cursor.fetchone()
        if not user:
            cursor.execute("SELECT id FROM users WHERE email=%s AND project_id=%s AND google_id IS NULL",
                           (email, project_id))
            user = cursor.fetchone()
            if user:
                cursor.execute("UPDATE users SET google_id=%s WHERE id=%s", (g_id, user["id"]))
                conn.commit()
        if not user:
            cursor.execute(
                "INSERT INTO users (name, email, password_hash, project_id, google_id) VALUES(%s,%s,'',%s,%s) RETURNING id",
                (sanitize(name), email, project_id, g_id)
            )
            user_id = cursor.fetchone()["id"]
            conn.commit()
        else:
            user_id = user["id"]

    token   = create_token(user_id)
    refresh = issue_refresh_token(user_id, project_id, request, label="Google login")
    redirect = RedirectResponse(f"{frontend}", status_code=302)
    redirect.set_cookie(key="authx_token", value=token, httponly=True,
                        max_age=ACCESS_TOKEN_MINUTES * 60,
                        samesite="lax", secure=COOKIE_SECURE, path="/")
    redirect.set_cookie(key="authx_refresh", value=refresh, httponly=True,
                        max_age=REFRESH_TOKEN_DAYS * 86400,
                        samesite="lax", secure=COOKIE_SECURE, path="/")
    redirect.delete_cookie("oa_state_google", path="/")
    return redirect


# ============================================
# GENERIC OAUTH PROVIDERS (per-project credentials)
# ============================================

def _basic_extract(id_field, email_field=None, name_field=None):
    def _do(info: dict) -> dict:
        return {
            "id":    str(info.get(id_field) or ""),
            "email": (info.get(email_field) if email_field else None),
            "name":  (info.get(name_field)  if name_field  else None),
        }
    return _do

OAUTH_PROVIDERS = {
    "github": {
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url":     "https://github.com/login/oauth/access_token",
        "user_info_url": "https://api.github.com/user",
        "scope":         "read:user user:email",
        "extract":       _basic_extract("id", "email", "name"),
    },
    "discord": {
        "authorize_url": "https://discord.com/api/oauth2/authorize",
        "token_url":     "https://discord.com/api/oauth2/token",
        "user_info_url": "https://discord.com/api/users/@me",
        "scope":         "identify email",
        "extract":       _basic_extract("id", "email", "global_name"),
    },
    "facebook": {
        "authorize_url": "https://www.facebook.com/v18.0/dialog/oauth",
        "token_url":     "https://graph.facebook.com/v18.0/oauth/access_token",
        "user_info_url": "https://graph.facebook.com/me?fields=id,name,email",
        "scope":         "email,public_profile",
        "extract":       _basic_extract("id", "email", "name"),
    },
    "gitlab": {
        "authorize_url": "https://gitlab.com/oauth/authorize",
        "token_url":     "https://gitlab.com/oauth/token",
        "user_info_url": "https://gitlab.com/api/v4/user",
        "scope":         "read_user",
        "extract":       _basic_extract("id", "email", "name"),
    },
    "bitbucket": {
        "authorize_url": "https://bitbucket.org/site/oauth2/authorize",
        "token_url":     "https://bitbucket.org/site/oauth2/access_token",
        "user_info_url": "https://api.bitbucket.org/2.0/user",
        "scope":         "account email",
        "extract":       _basic_extract("uuid", None, "display_name"),
    },
    "linkedin": {
        "authorize_url": "https://www.linkedin.com/oauth/v2/authorization",
        "token_url":     "https://www.linkedin.com/oauth/v2/accessToken",
        "user_info_url": "https://api.linkedin.com/v2/userinfo",
        "scope":         "openid profile email",
        "extract":       _basic_extract("sub", "email", "name"),
    },
    "twitch": {
        "authorize_url": "https://id.twitch.tv/oauth2/authorize",
        "token_url":     "https://id.twitch.tv/oauth2/token",
        "user_info_url": "https://api.twitch.tv/helix/users",
        "scope":         "user:read:email",
        # Twitch returns { "data": [ { id, email, display_name } ] }
        "extract":       lambda info: (lambda d: {
            "id":    str(d.get("id") or ""),
            "email": d.get("email"),
            "name":  d.get("display_name"),
        })((info.get("data") or [{}])[0]),
        "extra_headers": lambda client_id: {"Client-Id": client_id},
    },
    "spotify": {
        "authorize_url": "https://accounts.spotify.com/authorize",
        "token_url":     "https://accounts.spotify.com/api/token",
        "user_info_url": "https://api.spotify.com/v1/me",
        "scope":         "user-read-email user-read-private",
        "extract":       _basic_extract("id", "email", "display_name"),
    },
    "slack": {
        "authorize_url": "https://slack.com/openid/connect/authorize",
        "token_url":     "https://slack.com/api/openid.connect.token",
        "user_info_url": "https://slack.com/api/openid.connect.userInfo",
        "scope":         "openid profile email",
        "extract":       _basic_extract("sub", "email", "name"),
    },
    "notion": {
        "authorize_url": "https://api.notion.com/v1/oauth/authorize",
        "token_url":     "https://api.notion.com/v1/oauth/token",
        "user_info_url": "https://api.notion.com/v1/users/me",
        "scope":         "",
        "extra_query":   {"owner": "user"},
        "extract":       lambda info: (lambda u: {
            "id":    str(u.get("id") or ""),
            "email": ((u.get("person") or {}).get("email")),
            "name":  u.get("name"),
        })(((info.get("bot") or {}).get("owner") or {}).get("user") or info),
    },
    "figma": {
        "authorize_url": "https://www.figma.com/oauth",
        "token_url":     "https://api.figma.com/v1/oauth/token",
        "user_info_url": "https://api.figma.com/v1/me",
        "scope":         "files:read",
        "extract":       _basic_extract("id", "email", "handle"),
    },
    "zoom": {
        "authorize_url": "https://zoom.us/oauth/authorize",
        "token_url":     "https://zoom.us/oauth/token",
        "user_info_url": "https://api.zoom.us/v2/users/me",
        "scope":         "user:read",
        "extract":       _basic_extract("id", "email", "first_name"),
    },
    "azure": {
        "authorize_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url":     "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "user_info_url": "https://graph.microsoft.com/oidc/userinfo",
        "scope":         "openid profile email",
        "extract":       _basic_extract("sub", "email", "name"),
    },
    "apple": {
        "authorize_url": "https://appleid.apple.com/auth/authorize",
        "token_url":     "https://appleid.apple.com/auth/token",
        "user_info_url": None,  # Apple returns user info inline in id_token
        "scope":         "name email",
        "extra_query":   {"response_mode": "form_post"},
        "extract":       _basic_extract("sub", "email", "email"),
    },
    "x": {
        "authorize_url": "https://twitter.com/i/oauth2/authorize",
        "token_url":     "https://api.twitter.com/2/oauth2/token",
        "user_info_url": "https://api.twitter.com/2/users/me",
        "scope":         "tweet.read users.read offline.access",
        # X returns { "data": { id, username, name } } — no email by default
        "extract":       lambda info: (lambda d: {
            "id":    str(d.get("id") or ""),
            "email": None,
            "name":  d.get("username") or d.get("name"),
        })(info.get("data") or {}),
        "pkce":          True,
    },
    "vk": {
        "authorize_url": "https://oauth.vk.com/authorize",
        "token_url":     "https://oauth.vk.com/access_token",
        "user_info_url": "https://api.vk.com/method/users.get?fields=email&v=5.131",
        "scope":         "email",
        # VK returns { response: [ { id, first_name, last_name } ] } and email via token resp
        "extract":       lambda info: (lambda u: {
            "id":    str(u.get("id") or ""),
            "email": None,
            "name":  f"{u.get('first_name','')} {u.get('last_name','')}".strip(),
        })((info.get("response") or [{}])[0]),
    },
    "kakao": {
        "authorize_url": "https://kauth.kakao.com/oauth/authorize",
        "token_url":     "https://kauth.kakao.com/oauth/token",
        "user_info_url": "https://kapi.kakao.com/v2/user/me",
        "scope":         "account_email profile_nickname",
        "extract":       lambda info: {
            "id":    str(info.get("id") or ""),
            "email": (info.get("kakao_account") or {}).get("email"),
            "name":  ((info.get("kakao_account") or {}).get("profile") or {}).get("nickname"),
        },
    },
    "keycloak": {
        # KeyCloak is self-hosted — admins must override authorize_url/token_url/user_info_url
        # via env (KEYCLOAK_BASE_URL).  Defaults assume Bitnami demo.
        "authorize_url": os.getenv("KEYCLOAK_BASE_URL", "http://localhost:8080") +
                         "/realms/master/protocol/openid-connect/auth",
        "token_url":     os.getenv("KEYCLOAK_BASE_URL", "http://localhost:8080") +
                         "/realms/master/protocol/openid-connect/token",
        "user_info_url": os.getenv("KEYCLOAK_BASE_URL", "http://localhost:8080") +
                         "/realms/master/protocol/openid-connect/userinfo",
        "scope":         "openid profile email",
        "extract":       _basic_extract("sub", "email", "preferred_username"),
    },
}


def _get_oauth_credentials(project_id: int, provider: str):
    row = db_one(
        "SELECT client_id, client_secret FROM crm_auth_providers "
        "WHERE project_id=%s AND provider=%s AND is_enabled=TRUE",
        (project_id, provider),
    )
    if row and row["client_id"] and row["client_secret"]:
        return row["client_id"], row["client_secret"]
    return None, None


@app.get("/{api_key}/auth/oauth/{provider}/login")
def oauth_login(api_key: str, provider: str,
                api_key_record: dict = Depends(resolve_api_key_public)):
    import urllib.parse
    cfg = OAUTH_PROVIDERS.get(provider)
    if not cfg:
        raise HTTPException(404, f"Unknown provider: {provider}")
    client_id, _ = _get_oauth_credentials(api_key_record["id"], provider)
    if not client_id:
        raise HTTPException(404, f"{provider} OAuth not configured for this store")
    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key}/auth/oauth/{provider}/callback"
    # CSRF state — orthogonal to PKCE; needed for ALL providers
    state = secrets.token_urlsafe(32)
    params = {
        "client_id":     client_id,
        "redirect_uri":  redirect_uri,
        "response_type": "code",
        "scope":         cfg.get("scope", ""),
        "state":         state,
    }
    if cfg.get("extra_query"):
        params.update(cfg["extra_query"])
    # path="/" so cookies survive the cross-origin redirect from the provider
    cookie_path = "/"
    if cfg.get("pkce"):
        import base64, hashlib as _h
        verifier = secrets.token_urlsafe(48)
        challenge = base64.urlsafe_b64encode(_h.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        params["code_challenge"] = challenge
        params["code_challenge_method"] = "S256"
        resp = RedirectResponse(cfg["authorize_url"] + "?" + urllib.parse.urlencode(params))
        resp.set_cookie(key=f"oa_pkce_{provider}", value=verifier,
                        max_age=600, httponly=True, samesite="lax",
                        secure=COOKIE_SECURE, path=cookie_path)
        resp.set_cookie(key=f"oa_state_{provider}", value=state,
                        max_age=600, httponly=True, samesite="lax",
                        secure=COOKIE_SECURE, path=cookie_path)
        return resp
    resp = RedirectResponse(cfg["authorize_url"] + "?" + urllib.parse.urlencode(params))
    resp.set_cookie(key=f"oa_state_{provider}", value=state,
                    max_age=600, httponly=True, samesite="lax",
                    secure=COOKIE_SECURE, path=cookie_path)
    return resp


@app.get("/{api_key}/auth/oauth/{provider}/callback")
def oauth_callback(api_key: str, provider: str, request: Request,
                   api_key_record: dict = Depends(resolve_api_key_public),
                   code: str = None, error: str = None, state: str = None):
    project_id = api_key_record["id"]
    frontend   = get_project_frontend_url(project_id)
    if not frontend:
        return RedirectResponse("/?error=site_url_not_configured")

    cfg = OAUTH_PROVIDERS.get(provider)
    if not cfg:
        return RedirectResponse(f"{frontend}/login?error=unknown_provider")

    # Validate CSRF state BEFORE doing anything with the code
    cookie_state = request.cookies.get(f"oa_state_{provider}", "")
    if not state or not cookie_state or not _hmac.compare_digest(state, cookie_state):
        return RedirectResponse(f"{frontend}/login?error={provider}_state_mismatch")

    if error or not code:
        return RedirectResponse(f"{frontend}/login?error={provider}_cancelled")

    client_id, client_secret = _get_oauth_credentials(project_id, provider)
    if not client_id:
        return RedirectResponse(f"{frontend}/login?error={provider}_not_configured")

    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key}/auth/oauth/{provider}/callback"

    try:
        return _oauth_finish(provider, cfg, code, client_id, client_secret,
                             redirect_uri, project_id, frontend, request)
    except Exception:
        traceback.print_exc()
        return RedirectResponse(f"{frontend}/login?error={provider}_server_error")


def _oauth_finish(provider, cfg, code, client_id, client_secret,
                  redirect_uri, project_id, frontend, request):
    import urllib.parse, json as _json, base64

    # ── 1. Exchange code → access_token ──────────────────────────────────
    post_fields = {
        "code":          code,
        "client_id":     client_id,
        "client_secret": client_secret,
        "redirect_uri":  redirect_uri,
        "grant_type":    "authorization_code",
    }
    if cfg.get("pkce"):
        verifier = request.cookies.get(f"oa_pkce_{provider}", "")
        if verifier:
            post_fields["code_verifier"] = verifier

    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept":       "application/json",
        "User-Agent":   "torta-crm/1.0",
    }
    # Some providers want HTTP Basic auth instead of body params
    if provider in ("x", "spotify", "notion"):
        basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        headers["Authorization"] = f"Basic {basic}"
        post_fields.pop("client_id",     None)
        post_fields.pop("client_secret", None)

    try:
        req = urllib.request.Request(
            cfg["token_url"], data=urllib.parse.urlencode(post_fields).encode(),
            headers=headers, method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            tokens = _json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"[{provider}] token error: {e.read().decode(errors='replace')}")
        return RedirectResponse(f"{frontend}/login?error={provider}_token")
    except Exception as e:
        print(f"[{provider}] token error: {e}")
        return RedirectResponse(f"{frontend}/login?error={provider}_token")

    access_token = tokens.get("access_token")
    if not access_token:
        return RedirectResponse(f"{frontend}/login?error={provider}_no_token")

    # VK returns email in token response
    vk_token_email = tokens.get("email") if provider == "vk" else None

    # ── 2. Fetch user info ───────────────────────────────────────────────
    if cfg.get("user_info_url"):
        ui_headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept":        "application/json",
            "User-Agent":    "torta-crm/1.0",
        }
        if cfg.get("extra_headers"):
            ui_headers.update(cfg["extra_headers"](client_id))
        # Notion needs special version header
        if provider == "notion":
            ui_headers["Notion-Version"] = "2022-06-28"
        # VK requires access_token in query string, not bearer header
        url = cfg["user_info_url"]
        if provider == "vk":
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}access_token={access_token}"
        try:
            ui_req = urllib.request.Request(url, headers=ui_headers, method="GET")
            with urllib.request.urlopen(ui_req, timeout=15) as resp:
                user_info = _json.loads(resp.read())
        except Exception as e:
            print(f"[{provider}] user_info error: {e}")
            return RedirectResponse(f"{frontend}/login?error={provider}_user_info")
    else:
        # Apple: parse id_token JWT (no signature check for demo — production must verify)
        id_token_str = tokens.get("id_token", "")
        try:
            payload = id_token_str.split(".")[1]
            payload += "=" * (-len(payload) % 4)
            user_info = _json.loads(base64.urlsafe_b64decode(payload))
        except Exception as e:
            print(f"[{provider}] id_token decode error: {e}")
            return RedirectResponse(f"{frontend}/login?error={provider}_id_token")

    # ── 3. Extract canonical { id, email, name } ─────────────────────────
    extracted = cfg["extract"](user_info)
    oid   = extracted["id"]
    email = (extracted.get("email") or vk_token_email or "").strip().lower() or None
    name  = (extracted.get("name") or (email.split("@")[0] if email else f"{provider}_user_{oid[:8]}"))

    if not oid:
        return RedirectResponse(f"{frontend}/login?error={provider}_no_id")

    # GitHub may not return email if user has it private — fetch /user/emails
    if provider == "github" and not email:
        try:
            req2 = urllib.request.Request(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token}",
                         "Accept": "application/json", "User-Agent": "torta-crm/1.0"},
            )
            with urllib.request.urlopen(req2, timeout=10) as r2:
                emails = _json.loads(r2.read())
            primary = next((e for e in emails if e.get("primary") and e.get("verified")), None)
            if primary:
                email = primary["email"].lower()
        except Exception:
            pass

    # ── 4. Find or create user ───────────────────────────────────────────
    with db_cursor() as (conn, cursor):
        # 4a. Try by (provider, oauth_provider_id)
        cursor.execute(
            "SELECT id FROM users WHERE oauth_provider=%s AND oauth_provider_id=%s AND project_id=%s",
            (provider, oid, project_id),
        )
        user = cursor.fetchone()
        # 4b. Try linking by email if user already registered
        if not user and email:
            cursor.execute(
                "SELECT id FROM users WHERE email=%s AND project_id=%s "
                "AND oauth_provider IS NULL AND google_id IS NULL",
                (email, project_id),
            )
            user = cursor.fetchone()
            if user:
                cursor.execute(
                    "UPDATE users SET oauth_provider=%s, oauth_provider_id=%s WHERE id=%s",
                    (provider, oid, user["id"]),
                )
                conn.commit()
        # 4c. Create new user
        if not user:
            # Email may be missing (X, VK without scope) — generate a stable placeholder
            email_to_use = email or f"{provider}_{oid}@oauth.local"
            try:
                cursor.execute(
                    "INSERT INTO users (name, email, password_hash, project_id, "
                    "oauth_provider, oauth_provider_id) "
                    "VALUES (%s,%s,'',%s,%s,%s) RETURNING id",
                    (sanitize(name), email_to_use, project_id, provider, oid),
                )
                user_id = cursor.fetchone()["id"]
                conn.commit()
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                # Race: user got created between our SELECT and INSERT — re-fetch
                cursor.execute(
                    "SELECT id FROM users WHERE oauth_provider=%s AND oauth_provider_id=%s AND project_id=%s",
                    (provider, oid, project_id),
                )
                row = cursor.fetchone()
                if not row:
                    raise
                user_id = row["id"]
        else:
            user_id = user["id"]

    token   = create_token(user_id)
    refresh = issue_refresh_token(user_id, project_id, request, label=f"{provider} login")
    redirect = RedirectResponse(f"{frontend}", status_code=302)
    redirect.set_cookie(key="authx_token", value=token, httponly=True,
                        max_age=ACCESS_TOKEN_MINUTES * 60, samesite="lax",
                        secure=COOKIE_SECURE, path="/")
    redirect.set_cookie(key="authx_refresh", value=refresh, httponly=True,
                        max_age=REFRESH_TOKEN_DAYS * 86400, samesite="lax",
                        secure=COOKIE_SECURE, path="/")
    # Clean up PKCE + state cookies (cookies are now set with path="/")
    if cfg.get("pkce"):
        redirect.delete_cookie(key=f"oa_pkce_{provider}", path="/")
    redirect.delete_cookie(key=f"oa_state_{provider}", path="/")
    return redirect


# ============================================
# PHONE / SMS AUTHENTICATION
# Customer brings their own SMS provider — Twilio, MessageBird, Textlocal,
# Vonage, or Twilio Verify. We just route the OTP through them.
# ============================================

# Phone OTPs — kvstore-backed. Same as email OTPs; stores SHA-256 hash so
# a memory/Redis dump can't leak the live code.
def _phone_otp_key(project_id, phone): return f"phone_otp:{project_id}:{phone}"
def _phone_otp_get(project_id, phone): return kvstore.get(_phone_otp_key(project_id, phone))
def _phone_otp_set(project_id, phone, value, ttl):
    kvstore.set(_phone_otp_key(project_id, phone), value, ttl=ttl)
def _phone_otp_del(project_id, phone): kvstore.delete(_phone_otp_key(project_id, phone))

# Phone send-code rate limit buckets — atomic counters with TTL = block window.
def _phone_send_check_and_record(project_id: int, phone: str, ip: str):
    """Raise 429 if either per-phone or per-IP limit exceeded; else record."""
    limits = (
        (f"phone:{project_id}:{phone}", PHONE_SEND_MAX_PER_PHONE),
        (f"ip:{ip}",                    PHONE_SEND_MAX_PER_IP),
    )
    # Pre-check (don't increment if already over)
    for ident, lim in limits:
        cur = int(kvstore.get(_fail_key("phone_send", ident)) or 0)
        if cur >= lim:
            left = max(kvstore.ttl(_fail_key("phone_send", ident)), 1)
            raise HTTPException(429, f"Too many requests. Try again in {left} seconds.")
    # Record
    for ident, lim in limits:
        new_val = kvstore.incr(_fail_key("phone_send", ident), ttl=BLOCK_MINUTES * 60)
        if new_val > lim:
            left = max(kvstore.ttl(_fail_key("phone_send", ident)), 1)
            raise HTTPException(429, f"Too many requests. Try again in {left} seconds.")


def _sms_settings(project_id: int):
    return db_one("SELECT * FROM crm_sms_settings WHERE project_id=%s AND is_enabled=TRUE", (project_id,))


def _normalize_phone(p: str) -> str:
    """
    STRICT E.164 normalisation. Strips display formatting (spaces, dashes,
    parens) but REQUIRES the result to be a valid E.164 number. Rejects
    inputs that have no leading '+', leading zero after '+', or invalid
    length. Returns "" on rejection so the caller raises 400.
    """
    if not p: return ""
    s = p.strip()
    # Drop common display chars
    cleaned = "".join(ch for ch in s if ch.isdigit() or ch == "+")
    # Must explicitly start with '+' — no auto-prefixing (it allowed bypass
    # variants like "1234567890" в†’ "+1234567890" matching "+1 234..." etc.)
    if not cleaned.startswith("+"):
        return ""
    if not _E164_RE.match(cleaned):
        return ""
    return cleaned


def _gen_otp(length: int) -> str:
    """Cryptographically secure OTP via secrets module."""
    return "".join(str(secrets.randbelow(10)) for _ in range(length))


def _parse_test_numbers(s: str) -> dict:
    """'+1=789012, +77071234567=000000' в†’ {'+1': '789012', '+77071234567': '000000'}"""
    out = {}
    for pair in (s or "").split(","):
        pair = pair.strip()
        if "=" in pair:
            phone, code = pair.split("=", 1)
            out[_normalize_phone(phone.strip())] = code.strip()
    return out


def _send_sms(settings: dict, phone: str, message: str) -> tuple[bool, str]:
    """
    Dispatch SMS via the configured provider.
    Returns (ok, error_message).
    """
    import urllib.parse, base64, json as _json
    provider = settings.get("provider", "twilio")

    # ── Twilio (Programmable Messaging) ────────────────────────────────
    if provider == "twilio":
        sid   = settings.get("twilio_account_sid")
        token = settings.get("twilio_auth_token")
        msvc  = settings.get("twilio_message_service_sid")
        if not (sid and token and msvc):
            return False, "Twilio credentials incomplete"
        url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
        body = urllib.parse.urlencode({
            "MessagingServiceSid": msvc,
            "To":   phone,
            "Body": message,
        }).encode()
        basic = base64.b64encode(f"{sid}:{token}".encode()).decode()
        try:
            req = urllib.request.Request(url, data=body, method="POST", headers={
                "Authorization": f"Basic {basic}",
                "Content-Type":  "application/x-www-form-urlencoded",
            })
            with urllib.request.urlopen(req, timeout=15) as r:
                _ = r.read()
            return True, ""
        except urllib.error.HTTPError as e:
            return False, f"Twilio error: {e.read().decode(errors='replace')[:200]}"
        except Exception as e:
            return False, f"Twilio error: {e}"

    # ── Twilio Verify (handles its own OTP) ───────────────────────────
    if provider == "twilio_verify":
        sid     = settings.get("twilio_account_sid")
        token   = settings.get("twilio_auth_token")
        verify  = settings.get("twilio_verify_service_sid")
        if not (sid and token and verify):
            return False, "Twilio Verify credentials incomplete"
        url = f"https://verify.twilio.com/v2/Services/{verify}/Verifications"
        body = urllib.parse.urlencode({"To": phone, "Channel": "sms"}).encode()
        basic = base64.b64encode(f"{sid}:{token}".encode()).decode()
        try:
            req = urllib.request.Request(url, data=body, method="POST", headers={
                "Authorization": f"Basic {basic}",
                "Content-Type":  "application/x-www-form-urlencoded",
            })
            with urllib.request.urlopen(req, timeout=15) as r:
                _ = r.read()
            return True, ""
        except Exception as e:
            return False, f"Twilio Verify error: {e}"

    # ── MessageBird ───────────────────────────────────────────────────
    if provider == "messagebird":
        key = settings.get("messagebird_access_key")
        org = settings.get("messagebird_originator")
        if not (key and org):
            return False, "MessageBird credentials incomplete"
        url = "https://rest.messagebird.com/messages"
        payload = {"recipients": phone, "originator": org, "body": message}
        try:
            req = urllib.request.Request(url,
                data=urllib.parse.urlencode(payload).encode(),
                method="POST",
                headers={
                    "Authorization": f"AccessKey {key}",
                    "Content-Type":  "application/x-www-form-urlencoded",
                })
            with urllib.request.urlopen(req, timeout=15) as r:
                _ = r.read()
            return True, ""
        except Exception as e:
            return False, f"MessageBird error: {e}"

    # ── Textlocal ─────────────────────────────────────────────────────
    if provider == "textlocal":
        key    = settings.get("textlocal_api_key")
        sender = settings.get("textlocal_sender") or "TXTLCL"
        if not key:
            return False, "Textlocal API key required"
        url = "https://api.textlocal.in/send/"
        payload = {
            "apikey":   key,
            "numbers":  phone.lstrip("+"),
            "message":  message,
            "sender":   sender,
        }
        try:
            req = urllib.request.Request(url,
                data=urllib.parse.urlencode(payload).encode(),
                method="POST",
                headers={"Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=15) as r:
                resp = _json.loads(r.read())
            if resp.get("status") == "success":
                return True, ""
            return False, f"Textlocal: {resp}"
        except Exception as e:
            return False, f"Textlocal error: {e}"

    # ── Vonage ─────────────────────────────────────────────────────────
    if provider == "vonage":
        key    = settings.get("vonage_api_key")
        secret = settings.get("vonage_api_secret")
        sender = settings.get("vonage_from_number")
        if not (key and secret and sender):
            return False, "Vonage credentials incomplete"
        url = "https://rest.nexmo.com/sms/json"
        payload = {
            "api_key":    key,
            "api_secret": secret,
            "from":       sender,
            "to":         phone.lstrip("+"),
            "text":       message,
        }
        try:
            req = urllib.request.Request(url,
                data=urllib.parse.urlencode(payload).encode(),
                method="POST",
                headers={"Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=15) as r:
                resp = _json.loads(r.read())
            messages = resp.get("messages") or [{}]
            if messages[0].get("status") == "0":
                return True, ""
            return False, f"Vonage: {messages[0].get('error-text', resp)}"
        except Exception as e:
            return False, f"Vonage error: {e}"

    # ── AWS SNS ────────────────────────────────────────────────────────
    if provider == "aws_sns":
        akey   = settings.get("aws_access_key_id")
        secret = settings.get("aws_secret_access_key")
        region = settings.get("aws_region") or "us-east-1"
        if not (akey and secret):
            return False, "AWS credentials incomplete"
        try:
            import boto3
        except ImportError:
            return False, "boto3 not installed on the server"
        try:
            client = boto3.client("sns",
                region_name=region,
                aws_access_key_id=akey,
                aws_secret_access_key=secret,
            )
            client.publish(
                PhoneNumber=phone, Message=message,
                MessageAttributes={
                    "AWS.SNS.SMS.SMSType": {
                        "DataType": "String", "StringValue": "Transactional",
                    },
                },
            )
            return True, ""
        except Exception as e:
            return False, f"AWS SNS error: {e}"

    # ── Plivo ──────────────────────────────────────────────────────────
    if provider == "plivo":
        auth_id     = settings.get("plivo_auth_id")
        auth_token  = settings.get("plivo_auth_token")
        from_number = settings.get("plivo_from_number")
        if not (auth_id and auth_token and from_number):
            return False, "Plivo credentials incomplete"
        url = f"https://api.plivo.com/v1/Account/{auth_id}/Message/"
        body = _json.dumps({"src": from_number, "dst": phone, "text": message}).encode()
        basic = base64.b64encode(f"{auth_id}:{auth_token}".encode()).decode()
        try:
            req = urllib.request.Request(url, data=body, method="POST", headers={
                "Authorization": f"Basic {basic}",
                "Content-Type":  "application/json",
            })
            with urllib.request.urlopen(req, timeout=15) as r:
                _ = r.read()
            return True, ""
        except urllib.error.HTTPError as e:
            return False, f"Plivo error: {e.read().decode(errors='replace')[:200]}"
        except Exception as e:
            return False, f"Plivo error: {e}"

    # ── SMSC.ru (Russia / CIS) ─────────────────────────────────────────
    if provider == "smsc":
        login    = settings.get("smsc_login")
        password = settings.get("smsc_password")
        sender   = settings.get("smsc_sender") or ""
        if not (login and password):
            return False, "SMSC.ru credentials incomplete"
        params = {
            "login":   login,
            "psw":     password,
            "phones":  phone,
            "mes":     message,
            "fmt":     "3",   # JSON response
            "charset": "utf-8",
        }
        if sender:
            params["sender"] = sender
        url = "https://smsc.ru/sys/send.php?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                resp = _json.loads(r.read())
            if resp.get("error"):
                return False, f"SMSC: {resp.get('error')}"
            return True, ""
        except Exception as e:
            return False, f"SMSC error: {e}"

    # ── SMS.ru (Russia) ────────────────────────────────────────────────
    if provider == "sms_ru":
        api_id = settings.get("smsru_api_id")
        sender = settings.get("smsru_from") or ""
        if not api_id:
            return False, "SMS.ru API ID required"
        params = {
            "api_id": api_id,
            "to":     phone.lstrip("+"),
            "msg":    message,
            "json":   "1",
        }
        if sender:
            params["from"] = sender
        url = "https://sms.ru/sms/send?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                resp = _json.loads(r.read())
            if resp.get("status") == "OK":
                return True, ""
            return False, f"SMS.ru: {resp.get('status_text', resp)}"
        except Exception as e:
            return False, f"SMS.ru error: {e}"

    # ── Mobizon.kz (Kazakhstan) ────────────────────────────────────────
    if provider == "mobizon":
        api_key = settings.get("mobizon_api_key")
        alpha   = settings.get("mobizon_alpha") or ""
        if not api_key:
            return False, "Mobizon API key required"
        params = {
            "recipient": phone.lstrip("+"),
            "text":      message,
            "apiKey":    api_key,
        }
        if alpha:
            params["from"] = alpha
        url = "https://api.mobizon.kz/service/message/sendsmsmessage?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                resp = _json.loads(r.read())
            if resp.get("code") == 0:
                return True, ""
            return False, f"Mobizon: {resp.get('message', resp)}"
        except Exception as e:
            return False, f"Mobizon error: {e}"

    # ── Telegram Gateway (free OTP via Telegram) ───────────────────────
    if provider == "telegram_gateway":
        token = settings.get("telegram_gateway_token")
        if not token:
            return False, "Telegram Gateway token required"
        # Telegram Gateway uses /sendVerificationMessage endpoint
        url  = "https://gatewayapi.telegram.org/sendVerificationMessage"
        body = _json.dumps({
            "phone_number": phone,
            "code":         message.strip().split()[-1] if message else "",
            "ttl":          settings.get("otp_expiry_seconds", 60),
        }).encode()
        try:
            req = urllib.request.Request(url, data=body, method="POST", headers={
                "Authorization": f"Bearer {token}",
                "Content-Type":  "application/json",
            })
            with urllib.request.urlopen(req, timeout=15) as r:
                resp = _json.loads(r.read())
            if resp.get("ok"):
                return True, ""
            return False, f"Telegram Gateway: {resp.get('error', resp)}"
        except urllib.error.HTTPError as e:
            return False, f"Telegram Gateway error: {e.read().decode(errors='replace')[:200]}"
        except Exception as e:
            return False, f"Telegram Gateway error: {e}"

    return False, f"Unknown SMS provider: {provider}"


class PhoneSendCodeRequest(BaseModel):
    phone: str
    name:  Optional[str] = None  # for new registrations


class PhoneVerifyCodeRequest(BaseModel):
    phone: str
    code:  str


@app.post("/{api_key}/auth/phone/send-code")
def phone_send_code(req: PhoneSendCodeRequest, api_key: str, request: Request,
                    api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    settings   = _sms_settings(project_id)
    if not settings:
        raise HTTPException(404, "Phone authentication not enabled for this store")

    phone = _normalize_phone(req.phone)
    if not phone:
        raise HTTPException(400, "Invalid phone number (use E.164, e.g. +12025550123)")

    # Hard rate limit (per-phone + per-IP) — prevents SMS bombing & DoS
    _phone_send_check_and_record(project_id, phone, get_client_ip(request))

    otp_length = int(settings.get("otp_length") or 6)
    if otp_length < 4 or otp_length > 10: otp_length = 6
    expiry     = int(settings.get("otp_expiry_seconds") or 60)
    if expiry < 30 or expiry > 600: expiry = 60
    template   = settings.get("message_template") or "Your code is {{ .Code }}"
    test_map   = _parse_test_numbers(settings.get("test_phone_numbers", ""))

    # Twilio Verify generates the code itself; for everyone else we generate it
    if settings.get("provider") == "twilio_verify":
        ok, err = _send_sms(settings, phone, "")
        if not ok:
            raise HTTPException(502, err or "SMS provider failed")
        _phone_otp_set(project_id, phone, {
            "code_hash":     "",
            "twilio_verify": True,
            "expires_ts":    time.time() + expiry,
            "name":          (req.name or "").strip()[:200],
            "attempts":      0,
        }, ttl=expiry)
        return {"ok": True, "delivery": "twilio_verify"}

    # Test numbers — bypass SMS provider but still hash the code at rest
    if phone in test_map:
        code = test_map[phone]
    else:
        code = _gen_otp(otp_length)
        msg  = template.replace("{{ .Code }}", code).replace("{{.Code}}", code)
        ok, err = _send_sms(settings, phone, msg)
        if not ok:
            raise HTTPException(502, err or "SMS provider failed")

    _phone_otp_set(project_id, phone, {
        "code_hash":     hash_otp(code),
        "twilio_verify": False,
        "expires_ts":    time.time() + expiry,
        "name":          (req.name or "").strip()[:200],
        "attempts":      0,
    }, ttl=expiry)
    return {"ok": True, "delivery": "sms"}


@app.post("/{api_key}/auth/phone/verify-code")
def phone_verify_code(req: PhoneVerifyCodeRequest, api_key: str,
                      response: Response, request: Request,
                      api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    settings   = _sms_settings(project_id)
    if not settings:
        raise HTTPException(404, "Phone authentication not enabled for this store")

    phone = _normalize_phone(req.phone)
    if not phone:
        raise HTTPException(400, "Invalid phone number")

    pending = _phone_otp_get(project_id, phone)
    if not pending:
        raise HTTPException(400, "No code requested for this number")
    now_ts = time.time()
    if now_ts > float(pending.get("expires_ts", 0)):
        _phone_otp_del(project_id, phone)
        raise HTTPException(400, "Code expired")

    # Per-OTP brute-force counter — kill the code after MAX attempts so the
    # attacker can't grind through 10^6 combinations
    pending["attempts"] = int(pending.get("attempts", 0)) + 1
    _phone_otp_set(project_id, phone, pending,
                   ttl=int(max(float(pending["expires_ts"]) - now_ts, 1)))
    if pending["attempts"] > PHONE_VERIFY_MAX_ATTEMPTS:
        _phone_otp_del(project_id, phone)
        raise HTTPException(429, "Too many invalid attempts. Request a new code.")

    code_in = (req.code or "").strip()

    # Twilio Verify — delegate validation to Twilio
    if pending.get("twilio_verify"):
        import urllib.parse, base64
        sid    = settings.get("twilio_account_sid")
        token  = settings.get("twilio_auth_token")
        verify = settings.get("twilio_verify_service_sid")
        url   = f"https://verify.twilio.com/v2/Services/{verify}/VerificationCheck"
        body  = urllib.parse.urlencode({"To": phone, "Code": code_in}).encode()
        basic = base64.b64encode(f"{sid}:{token}".encode()).decode()
        try:
            r = urllib.request.Request(url, data=body, method="POST", headers={
                "Authorization": f"Basic {basic}",
                "Content-Type":  "application/x-www-form-urlencoded",
            })
            with urllib.request.urlopen(r, timeout=15) as rr:
                resp = json.loads(rr.read())
            if resp.get("status") != "approved":
                raise HTTPException(400, "Invalid code")
        except urllib.error.HTTPError:
            raise HTTPException(400, "Invalid code")
    else:
        if not verify_otp(code_in, pending.get("code_hash", "")):
            raise HTTPException(400, "Invalid code")

    # ── Find or create user (race-safe) ───────────────────────────────
    name = pending.get("name") or f"User {phone[-4:]}"
    with db_cursor() as (conn, cur):
        cur.execute(
            "SELECT id FROM users WHERE phone=%s AND project_id=%s",
            (phone, project_id),
        )
        user = cur.fetchone()
        if user:
            cur.execute("UPDATE users SET phone_verified=TRUE WHERE id=%s", (user["id"],))
            user_id = user["id"]
        else:
            try:
                cur.execute(
                    "INSERT INTO users (name, email, password_hash, project_id, phone, phone_verified) "
                    "VALUES (%s, %s, '', %s, %s, TRUE) RETURNING id",
                    (sanitize(name), f"phone_{phone}@phone.local", project_id, phone),
                )
                user_id = cur.fetchone()["id"]
            except psycopg2.errors.UniqueViolation:
                # Concurrent INSERT won the race — find the existing row
                conn.rollback()
                cur.execute(
                    "SELECT id FROM users WHERE phone=%s AND project_id=%s",
                    (phone, project_id),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(500, "Authentication failed")
                user_id = row["id"]
        conn.commit()

    _phone_otp_del(project_id, phone)
    # Reset send-rate buckets on successful verify so legit users aren't punished
    kvstore.delete(_fail_key("phone_send", f"phone:{project_id}:{phone}"))

    token = create_token(user_id)
    set_auth_cookie(response, token)
    set_refresh_cookie(response, issue_refresh_token(user_id, project_id, request, label="Phone login"))
    return {"ok": True, "user_id": user_id}


# ============================================
# WEB CHAT (support widget on the client's site)
# ============================================
#


class WebChatMessageRequest(BaseModel):
    text:        str
    web_chat_id: str

class WebChatBootstrapResponse(BaseModel):
    enabled:     bool
    project_id:  int
    web_chat_id: str

def _new_web_chat_id() -> str:
    return secrets.token_hex(12)

def _is_webchat_enabled(project_id: int) -> bool:
    row = db_one(
        "SELECT 1 FROM crm_chat_integrations WHERE project_id=%s AND channel='webchat' AND is_active=TRUE",
        (project_id,)
    )
    return bool(row)


@app.get("/{api_key}/chat/bootstrap")
def webchat_bootstrap(request: Request,
                      api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    incoming   = request.headers.get("x-web-chat-id", "").strip()
    return {
        "enabled":     _is_webchat_enabled(project_id),
        "project_id":  project_id,
        "web_chat_id": incoming or _new_web_chat_id(),
    }


@app.post("/{api_key}/chat/messages")
def webchat_send(body: WebChatMessageRequest, request: Request,
                 api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    if not _is_webchat_enabled(project_id):
        raise HTTPException(403, "Web chat is not enabled for this project")

    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "Empty message")
    if len(text) > 4000:
        raise HTTPException(400, "Message too long")
    web_chat_id = (body.web_chat_id or "").strip() or _new_web_chat_id()

    payload = json.dumps({
        "project_id":  project_id,
        "web_chat_id": web_chat_id,
        "text":        text,
    }).encode()
    req = urllib.request.Request(
        f"{CRM_BACKEND_URL}/api/chat/internal/inbound",
        data=payload, method="POST", headers={
            "Content-Type":   "application/json",
            "X-Internal-Key": INTERNAL_API_KEY,
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except Exception as e:
        raise HTTPException(503, f"CRM unreachable: {e}")
    return {"ok": True, "web_chat_id": web_chat_id}


@app.get("/{api_key}/chat/messages")
def webchat_list(request: Request, web_chat_id: str = "", since_id: int = 0,
                 api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    web_chat_id = (web_chat_id or "").strip()
    if not web_chat_id:
        return {"messages": [], "web_chat_id": ""}

    conv = db_one(
        """SELECT id FROM crm_chat_conversations
           WHERE project_id=%s AND channel='webchat' AND external_chat_id=%s""",
        (project_id, web_chat_id)
    )
    if not conv:
        return {"messages": [], "web_chat_id": web_chat_id, "conversation_id": None}

    rows = db_all(
        """SELECT id, direction, text, created_at
           FROM crm_chat_messages
           WHERE conversation_id=%s AND id > %s
           ORDER BY id ASC""",
        (conv["id"], int(since_id or 0))
    )
    return {
        "messages": [{
            "id":         r["id"],
            "direction":  r["direction"],   # 'in' = visitor; 'out' = operator
            "text":       r["text"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        } for r in rows],
        "web_chat_id":     web_chat_id,
        "conversation_id": conv["id"],
    }


# ============================================
# BOOKING — public (customer-facing) endpoints
# ============================================
#
# Mirror of the CRM booking module, exposed to the storefront via the SDK.
# All routes prefixed with /{api_key}/booking/...
#
# Slot calculation:
#   1. Pick the relevant working hours for the date:
#        • requires_staff service + staff_id  → that staff's hours
#        • no staff (or service.requires_staff=false) → project-wide hours
#   2. Walk the day in slot_interval_minutes (from settings) increments.
#   3. A slot is "available" when:
#        • (slot_start + service.duration) ≤ working window end
#        • Existing concurrent bookings count < capacity
#        • Slot is in the future (respecting min_advance_minutes)
#   4. Return list of "HH:MM" times.

BOOKING_STATUSES_PUB = ("pending", "confirmed", "cancelled", "completed", "no_show")
_DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

def _booking_settings(project_id: int) -> dict:
    row = db_one("SELECT * FROM booking_settings WHERE project_id=%s", (project_id,))
    return row or {
        "slot_interval_minutes": 15, "min_advance_minutes": 60,
        "max_advance_days": 60, "cancellation_window_minutes": 1440,
        "auto_confirm": True, "default_status": "confirmed", "timezone": "UTC",
    }

def _hours_for(project_id: int, staff_id: Optional[int]) -> dict:
    """Return dict {day_of_week: [(open_time, close_time), …]}."""
    if staff_id is None:
        rows = db_all(
            "SELECT day_of_week, open_time, close_time FROM booking_hours "
            "WHERE project_id=%s AND staff_id IS NULL ORDER BY day_of_week",
            (project_id,)
        )
    else:
        rows = db_all(
            "SELECT day_of_week, open_time, close_time FROM booking_hours "
            "WHERE project_id=%s AND staff_id=%s ORDER BY day_of_week",
            (project_id, staff_id)
        )
    out: dict = {}
    for r in rows:
        out.setdefault(r["day_of_week"], []).append((r["open_time"], r["close_time"]))
    return out

class PublicCreateBookingRequest(BaseModel):
    service_id:     int
    staff_id:       Optional[int] = None
    starts_at:      str
    customer_name:  str = ""
    customer_phone: str = ""
    customer_email: str = ""
    notes:          str = ""

@app.get("/{api_key}/booking/services")
def public_list_services(api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    rows = db_all(
        "SELECT * FROM booking_services WHERE project_id=%s AND is_active=TRUE ORDER BY id ASC",
        (project_id,)
    )
    if not rows: return []
    sids = db_all(
        """SELECT bss.service_id, bss.staff_id, st.name AS staff_name, st.avatar_url
           FROM booking_staff_services bss
           JOIN booking_staff st ON st.id = bss.staff_id
           WHERE st.project_id=%s AND st.is_active=TRUE""",
        (project_id,)
    )
    by_service: dict = {}
    for r in sids:
        by_service.setdefault(r["service_id"], []).append({
            "id": r["staff_id"], "name": r["staff_name"], "avatar_url": r["avatar_url"]
        })
    out = []
    for s in rows:
        out.append({
            "id": s["id"], "name": s["name"], "description": s["description"],
            "duration_minutes": s["duration_minutes"],
            "price": float(s["price"]) if s["price"] is not None else 0.0,
            "image_url": s["image_url"],
            "requires_staff": s["requires_staff"], "capacity": s["capacity"],
            "staff": by_service.get(s["id"], []),
        })
    return out

@app.get("/{api_key}/booking/services/{service_id}")
def public_get_service(service_id: int, api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    s = db_one(
        "SELECT * FROM booking_services WHERE id=%s AND project_id=%s AND is_active=TRUE",
        (service_id, project_id)
    )
    if not s: raise HTTPException(404, "Service not found")
    sids = db_all(
        """SELECT bss.staff_id, st.name AS staff_name, st.avatar_url
           FROM booking_staff_services bss
           JOIN booking_staff st ON st.id = bss.staff_id
           WHERE bss.service_id=%s AND st.is_active=TRUE""",
        (service_id,)
    )
    return {
        "id": s["id"], "name": s["name"], "description": s["description"],
        "duration_minutes": s["duration_minutes"],
        "price": float(s["price"]) if s["price"] is not None else 0.0,
        "image_url": s["image_url"],
        "requires_staff": s["requires_staff"], "capacity": s["capacity"],
        "staff": [{"id": r["staff_id"], "name": r["staff_name"], "avatar_url": r["avatar_url"]} for r in sids],
    }

@app.get("/{api_key}/booking/services/{service_id}/slots")
def public_get_slots(service_id: int,
                     date: str,                                  # "YYYY-MM-DD" — local date in business TZ
                     staff_id: Optional[int] = None,
                     api_key_record: dict = Depends(resolve_api_key)):
    """
    Returns slots for `date` in the BUSINESS's local timezone — that's how the
    customer thinks about it ("any slot on Friday" not "any slot on Friday UTC").
    Slot strings are local "HH:MM" (e.g. "14:30" Almaty time). Internally we
    convert to UTC for DB queries against TIMESTAMPTZ bookings.
    """
    project_id = api_key_record["id"]
    svc = db_one(
        "SELECT * FROM booking_services WHERE id=%s AND project_id=%s AND is_active=TRUE",
        (service_id, project_id)
    )
    if not svc: raise HTTPException(404, "Service not found")
    if svc["requires_staff"] and not staff_id:
        raise HTTPException(400, "This service requires staff_id")

    try:
        day = datetime.strptime(date, "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(400, "Invalid date (expected YYYY-MM-DD)")

    settings = _booking_settings(project_id)
    interval = int(settings["slot_interval_minutes"])
    min_adv  = int(settings["min_advance_minutes"])
    max_days = int(settings["max_advance_days"])
    duration = int(svc["duration_minutes"])
    capacity = int(svc["capacity"]) if not staff_id else 1
    tz       = _tz(settings.get("timezone") or "UTC")

    # Compare LOCAL business dates (not UTC) — otherwise a Tokyo shop's
    # "today" rolls over while New York is still on yesterday.
    today_local = datetime.now(tz).date()
    if day < today_local: return {"date": date, "slots": []}
    if (day - today_local).days > max_days: return {"date": date, "slots": []}

    # Working hours — LOCAL to the business (input by owner in CRM as wall-clock time)
    hrs = _hours_for(project_id, staff_id if svc["requires_staff"] else None)
    dow = day.weekday()  # 0=Mon, computed from local date
    windows = hrs.get(dow, [])
    if not windows: return {"date": date, "slots": []}

    # For DB query, compute the UTC range covering the entire local day
    day_start_utc = datetime.combine(day, dt_time(0, 0), tzinfo=tz).astimezone(timezone.utc)
    day_end_utc   = day_start_utc + timedelta(days=1)

    blocking_states = ("pending", "confirmed")
    if staff_id:
        existing = db_all(
            """SELECT starts_at, ends_at FROM bookings
               WHERE project_id=%s AND staff_id=%s
                 AND status = ANY(%s)
                 AND starts_at >= %s AND starts_at < %s""",
            (project_id, staff_id, list(blocking_states), day_start_utc, day_end_utc)
        )
    else:
        existing = db_all(
            """SELECT starts_at, ends_at FROM bookings
               WHERE project_id=%s AND service_id=%s
                 AND status = ANY(%s)
                 AND starts_at >= %s AND starts_at < %s""",
            (project_id, service_id, list(blocking_states), day_start_utc, day_end_utc)
        )

    now_utc  = _utcnow()
    earliest = now_utc + timedelta(minutes=min_adv)
    out_slots = []
    for (open_t, close_t) in windows:
        # Build aware datetimes in the business TZ, then convert to UTC for compare
        slot_local       = datetime.combine(day, open_t,  tzinfo=tz)
        window_end_local = datetime.combine(day, close_t, tzinfo=tz)
        while slot_local + timedelta(minutes=duration) <= window_end_local:
            slot_utc     = slot_local.astimezone(timezone.utc)
            slot_end_utc = slot_utc + timedelta(minutes=duration)
            if slot_utc >= earliest:
                overlap = sum(
                    1 for b in existing
                    if not (b["ends_at"] <= slot_utc or b["starts_at"] >= slot_end_utc)
                )
                if overlap < capacity:
                    out_slots.append(slot_local.strftime("%H:%M"))
            slot_local += timedelta(minutes=interval)
    return {"date": date, "slots": out_slots, "timezone": settings.get("timezone") or "UTC"}

_EMAIL_RE = _re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

@app.post("/{api_key}/booking/bookings")
def public_create_booking(req: PublicCreateBookingRequest,
                          request: Request,
                          api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)

    svc = db_one(
        "SELECT * FROM booking_services WHERE id=%s AND project_id=%s AND is_active=TRUE",
        (req.service_id, project_id)
    )
    if not svc: raise HTTPException(404, "Service not found")
    if svc["requires_staff"] and not req.staff_id:
        raise HTTPException(400, "This service requires selecting a staff member")
    if req.staff_id:
        st = db_one("SELECT id FROM booking_staff WHERE id=%s AND project_id=%s AND is_active=TRUE",
                    (req.staff_id, project_id))
        if not st: raise HTTPException(404, "Staff not found")

    settings = _booking_settings(project_id)
    biz_tz   = _tz(settings.get("timezone") or "UTC")

    # Parse incoming ISO 8601. Frontend SHOULD send with a TZ offset
    # ("2026-04-26T14:30:00+05:00"). If it sends naive ("…T14:30:00"),
    # interpret as the business's local timezone (most user-friendly default).
    try:
        starts = datetime.fromisoformat(req.starts_at.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "Invalid starts_at (expected ISO 8601)")
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=biz_tz)
    starts = starts.astimezone(timezone.utc)
    ends = starts + timedelta(minutes=svc["duration_minutes"])

    # Reject bookings in the past or beyond max-advance
    now_utc = _utcnow()
    if starts < now_utc - timedelta(minutes=1):
        raise HTTPException(400, "Cannot book in the past")
    max_days = int(settings.get("max_advance_days") or 60)
    if (starts - now_utc).days > max_days:
        raise HTTPException(400, f"Cannot book more than {max_days} days ahead")

    # Validate customer-provided contact info (best-effort, prevents garbage)
    if req.customer_email:
        if not _EMAIL_RE.match(req.customer_email.strip()):
            raise HTTPException(400, "Invalid email address")
    if req.customer_phone:
        # Looser than auth: allow display chars; just disallow injection
        if not _re.match(r"^[0-9+\s\-()]{4,32}$", req.customer_phone.strip()):
            raise HTTPException(400, "Invalid phone number")

    blocking_states = ("pending", "confirmed")
    initial_status = settings["default_status"] if settings.get("auto_confirm", True) else "pending"

    # If user is logged in, use their stored name/email
    name  = sanitize(req.customer_name or "")[:200]
    phone = sanitize(req.customer_phone or "")[:64]
    email = sanitize(req.customer_email or "")[:200]
    if user_id:
        u = db_one("SELECT name, email, phone FROM users WHERE id=%s AND project_id=%s",
                   (user_id, project_id))
        if u:
            if not name  and u["name"]:  name  = u["name"]
            if not email and u["email"]: email = u["email"]
            if not phone and u.get("phone"): phone = u["phone"]

    if not name: raise HTTPException(400, "Name is required")

    # ── Atomic capacity check + insert ─────────────────────────────────
    # PostgreSQL advisory lock keyed by (project_id, staff_id, service_id)
    # serialises concurrent bookings for the same resource. Lock is auto-
    # released at COMMIT/ROLLBACK. Bigint composite fits 1M projects Г—
    # 1M staff Г— 1M services without collision.
    lock_key = (project_id * 10**12
                + (req.staff_id or 0) * 10**6
                + (req.service_id or 0))
    with db_cursor() as (conn, cur):
        cur.execute("SELECT pg_advisory_xact_lock(%s::bigint)", (lock_key,))
        if req.staff_id:
            cur.execute(
                """SELECT COUNT(*) AS n FROM bookings
                   WHERE project_id=%s AND staff_id=%s AND status = ANY(%s)
                     AND NOT (ends_at <= %s OR starts_at >= %s)""",
                (project_id, req.staff_id, list(blocking_states), starts, ends)
            )
            if cur.fetchone()["n"] >= 1:
                conn.rollback()
                raise HTTPException(409, "This time slot is no longer available")
        else:
            cur.execute(
                """SELECT COUNT(*) AS n FROM bookings
                   WHERE project_id=%s AND service_id=%s AND status = ANY(%s)
                     AND NOT (ends_at <= %s OR starts_at >= %s)""",
                (project_id, req.service_id, list(blocking_states), starts, ends)
            )
            if cur.fetchone()["n"] >= int(svc["capacity"]):
                conn.rollback()
                raise HTTPException(409, "This time slot is no longer available")

        cur.execute(
            """INSERT INTO bookings
                  (project_id, service_id, staff_id, user_id, starts_at, ends_at,
                   status, customer_name, customer_phone, customer_email, notes)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (project_id, req.service_id, req.staff_id, user_id, starts, ends,
             initial_status, name, phone, email, sanitize(req.notes or "")[:2000])
        )
        bid = cur.fetchone()["id"]
        conn.commit()
    return {"id": bid, "status": initial_status,
            "starts_at": starts.isoformat(), "ends_at": ends.isoformat()}

@app.get("/{api_key}/booking/bookings/my")
def public_list_my_bookings(request: Request,
                            api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    rows = db_all(
        """SELECT b.*, s.name AS service_name, s.duration_minutes, s.price AS service_price,
                  st.name AS staff_name, st.avatar_url AS staff_avatar
           FROM bookings b
           JOIN booking_services s ON s.id = b.service_id
           LEFT JOIN booking_staff st ON st.id = b.staff_id
           WHERE b.project_id=%s AND b.user_id=%s
           ORDER BY b.starts_at DESC""",
        (project_id, user_id)
    )
    return [{
        "id": r["id"], "service_id": r["service_id"], "staff_id": r["staff_id"],
        "service_name": r["service_name"], "staff_name": r["staff_name"],
        "staff_avatar": r["staff_avatar"],
        "service_price": float(r["service_price"]) if r["service_price"] is not None else 0.0,
        "duration_minutes": r["duration_minutes"],
        "starts_at": r["starts_at"].isoformat() if r["starts_at"] else None,
        "ends_at":   r["ends_at"].isoformat()   if r["ends_at"]   else None,
        "status": r["status"], "notes": r["notes"],
    } for r in rows]

@app.delete("/{api_key}/booking/bookings/{bid}")
def public_cancel_booking(bid: int, request: Request,
                          api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    row = db_one("SELECT * FROM bookings WHERE id=%s AND project_id=%s AND user_id=%s",
                 (bid, project_id, user_id))
    if not row: raise HTTPException(404, "Booking not found")
    if row["status"] in ("cancelled", "completed"):
        return {"ok": True, "status": row["status"]}

    settings = _booking_settings(project_id)
    cancel_window = int(settings["cancellation_window_minutes"])
    now_utc = _utcnow()
    starts  = row["starts_at"]
    # PG TIMESTAMPTZ в†’ datetime is already aware. Old naive rows fall back to UTC.
    if starts.tzinfo is None: starts = starts.replace(tzinfo=timezone.utc)
    if (starts - now_utc).total_seconds() / 60 < cancel_window:
        raise HTTPException(400, "Too late to cancel this booking")

    with db_cursor() as (conn, cur):
        cur.execute("UPDATE bookings SET status='cancelled' WHERE id=%s", (bid,))
        conn.commit()
    return {"ok": True, "status": "cancelled"}
