from fastapi import FastAPI, Response, HTTPException, Request, Depends, BackgroundTasks, Query
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
    """Resolve IANA timezone name to tzinfo, falling back to UTC if invalid."""
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


# ── НАСТРОЙКА ────────────────────────────────────────────

SECRET_KEY            = os.getenv("SECRET_KEY",        "")
JWT_ALGORITHM         = "HS256"
# Short-lived access JWT + long-lived rotated refresh token (see CRM backend).
ACCESS_TOKEN_MINUTES  = int(os.getenv("ACCESS_TOKEN_MINUTES", "15"))
REFRESH_TOKEN_DAYS    = int(os.getenv("REFRESH_TOKEN_DAYS",   "30"))
JWT_HOURS             = ACCESS_TOKEN_MINUTES / 60   # legacy alias
MAGAZ_BACKEND_URL     = os.getenv("MAGAZ_BACKEND_URL", "http://localhost:8000")
CRM_BACKEND_URL       = os.getenv("CRM_BACKEND_URL",   "http://localhost:8001")
INTERNAL_API_KEY      = os.getenv("INTERNAL_API_KEY",  "torta-internal-dev-key")
SES_API_URL           = os.getenv("SES_API_URL",       "https://ses.tortacrm.com")
SES_INTERNAL_KEY      = os.getenv("SES_INTERNAL_KEY",  "")
EMAIL_FROM            = os.getenv("EMAIL_FROM",        "support@tortacrm.com")
# Stripe (optional). When STRIPE_SECRET_KEY is unset, /booking/payment-intent returns 501; project owners enable on demand.
STRIPE_SECRET_KEY     = os.getenv("STRIPE_SECRET_KEY",  "")
STRIPE_API_BASE       = os.getenv("STRIPE_API_BASE",   "https://api.stripe.com/v1")
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


# ── VALIDATION-ERROR FORMATTER ───────────────────────────
# FastAPI's default 422 response is {"detail": [{"type", "loc", "msg", "input"}, ...]}
# — an array of objects. Storefronts and CRM frontends typically do `setError(json.detail)`
# then render `<p>{error}</p>`, which crashes React with "Objects are not valid as a
# React child". We override the handler to flatten to a single human-readable string,
# so EVERY endpoint is safe regardless of what the frontend does.

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse as _JSON

@app.exception_handler(RequestValidationError)
async def _format_validation_error(request: Request, exc: RequestValidationError):
    errors = exc.errors() or []
    if not errors:
        return _JSON({"detail": "Invalid request"}, status_code=422)
    parts = []
    for e in errors:
        loc = e.get("loc") or ()
        # Skip "body" prefix that FastAPI prepends to body-validation errors
        field = ".".join(str(x) for x in loc if x != "body") or "input"
        msg = e.get("msg") or "Invalid value"
        parts.append(f"{field}: {msg}")
    return _JSON({"detail": "; ".join(parts)}, status_code=422)


# ── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (PER-PROJECT) ────────────────

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


# ── УТИЛИТЫ ──────────────────────────────────────────────

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
        # Phone uniqueness per project (partial index ignores NULL) — prevents OTP race-condition duplicates.
        try:
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_phone_project "
                "ON users(phone, project_id) WHERE phone IS NOT NULL AND phone <> ''"
            )
            conn.commit()
        except Exception: conn.rollback()
        # Refresh tokens (per-user sessions, rotated on use); project_id scopes sessions per store.
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
    """Returns (user_id, new_raw) or None. Rotates token; revokes chain on reuse attack."""
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

def _eff_price(own_price, parent_eff):
    if own_price is None: return parent_eff
    return float(own_price)


def _build_layer_subtree(rows, layer, parent_eff,
                         layer4_by_parent, layer5_by_parent,
                         specifications_by_node):
    if not rows: return []
    next_layer = layer + 1
    by_parent_below = (layer4_by_parent if layer == 3
                       else layer5_by_parent if layer == 4
                       else None)
    out = []
    for r in rows:
        own_price = r.get("price")
        eff = _eff_price(own_price, parent_eff)
        children_rows = by_parent_below.get(r["id"], []) if by_parent_below else []
        nested = (_build_layer_subtree(children_rows, next_layer, eff,
                                       layer4_by_parent, layer5_by_parent,
                                       specifications_by_node)
                  if children_rows and next_layer <= 5 else [])
        node = {
            "id":              r["id"],
            "name":            r.get("name") or r.get("configuration_name") or "",
            "price":           float(own_price) if own_price is not None else None,
            "effective_price": eff,
            "stock_quantity":  r.get("stock_quantity") or 0,
            "sold_quantity":   r.get("sold_quantity")  or 0,
            "specifications":  specifications_by_node.get((layer, r["id"]), []),
        }
        if nested: node[f"conf_layer_{next_layer}"] = nested
        out.append(node)
    return out


def _split_keywords(value):
    # DB stores comma-separated string; API returns a clean array.
    if not value: return []
    return [t.strip() for t in str(value).split(",") if t.strip()]


def _media_type(url):
    """Classify URL ext as video/model/image (default 'image') for storefront rendering."""
    if not url: return "image"
    u = str(url).lower().split("?", 1)[0]   # drop query string
    if u.endswith((".mp4", ".webm", ".mov", ".m4v")): return "video"
    if u.endswith((".glb", ".usdz", ".gltf")):       return "model"
    return "image"


# Trusted external embed hosts for video URLs — keep narrow (SSRF/clickjack risk).
SAFE_VIDEO_HOSTS = (
    "youtube.com", "www.youtube.com", "youtu.be",
    "vimeo.com",   "player.vimeo.com",
)

def _is_safe_media_url(url):
    """True if URL is our S3 bucket or https on SAFE_VIDEO_HOSTS whitelist."""
    if not url: return False
    u = str(url).lower()
    if u.startswith("https://torta-crm.s3.") or "/torta-crm." in u:
        return True
    try:
        from urllib.parse import urlparse
        p = urlparse(u)
    except Exception:
        return False
    if p.scheme != "https": return False
    return p.hostname in SAFE_VIDEO_HOSTS


def _resolve_active_sale(now, *layers):
    """Walk-up sale resolver: first (sale_type, sale_value, starts, ends) layer with open window wins."""
    for layer in layers:
        if not layer: continue
        st, sv, ss, se = layer
        if not st or sv is None: continue
        if isinstance(ss, str): ss = datetime.fromisoformat(ss.replace('Z', '+00:00'))
        if isinstance(se, str): se = datetime.fromisoformat(se.replace('Z', '+00:00'))
        if ss is not None and ss > now: continue
        if se is not None and se < now: continue
        return (st, float(sv), ss, se)
    return (None, None, None, None)


def _apply_sale(base_price, sale_type, sale_value):
    if not sale_type or sale_value is None or base_price is None: return base_price
    bp = float(base_price)
    if sale_type == 'percent': return max(0.0, round(bp * (1 - sale_value / 100), 2))
    if sale_type == 'amount':  return max(0.0, round(bp - sale_value, 2))
    if sale_type == 'fixed':   return max(0.0, round(sale_value, 2))
    return bp


def _fetch_tier_pricing(sku_ids):
    """One query → dict { sku_id → [{min_qty, price}, ...] sorted by min_qty }."""
    if not sku_ids: return {}
    try:
        rows = db_all(
            "SELECT sku_id, min_qty, price FROM product_tier_pricing"
            " WHERE sku_id = ANY(%s) ORDER BY sku_id ASC, min_qty ASC",
            (list(sku_ids),)
        )
    except Exception:
        return {}
    out = {}
    for r in rows:
        out.setdefault(r["sku_id"], []).append({
            "min_qty": int(r["min_qty"]),
            "price":   float(r["price"] or 0),
        })
    return out


def _assemble_product_payload(
    product, *,
    variations,
    cfg_by_variation_id,
    layer3_by_parent,
    layer4_by_parent,
    layer5_by_parent,
    specifications_by_node,
    cart_map,
    is_favorite, can_review,
    custom_fields, reviews_raw,
    user_id,
    modifier_groups=None,    # list of pre-shaped groups for THIS product (or None)
    tier_pricing_by_sku=None,  # { l2_id → [{min_qty, price}, ...] } pre-fetched
):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    # Product-level sale tuple — used as the lowest-priority fallback for every L2.
    prod_sale = (
        product.get("sale_type"), product.get("sale_value"),
        product.get("sale_starts_at"), product.get("sale_ends_at"),
    )

    final_variations = []
    for v in variations:
        var_eff = _eff_price(v.get("price"), None)
        # L1-level sale tuple (for this variation specifically).
        var_sale = (
            v.get("sale_type"), v.get("sale_value"),
            v.get("sale_starts_at"), v.get("sale_ends_at"),
        )
        cfg_rows = cfg_by_variation_id.get(v["id"], [])
        conf_2_out = []
        for c in cfg_rows:
            cart_item = cart_map.get((c["variation_id"], c["id"]))
            cfg_eff = _eff_price(c.get("price"), var_eff)
            l3_rows = layer3_by_parent.get(c["id"], [])
            l3_tree = _build_layer_subtree(
                l3_rows, 3, cfg_eff,
                layer4_by_parent, layer5_by_parent, specifications_by_node)
            # `price` on L2 falls back to effective when own price is NULL.
            display_price = (float(c["price"]) if c.get("price") is not None
                             else (cfg_eff if cfg_eff is not None else 0.0))
            # Sale resolution: L2 own (new sale_type/value, then legacy sale_price)
            # → L1 own → product own. First active window wins.
            l2_sale = (c.get("sale_type"), c.get("sale_value"),
                       c.get("sale_starts_at"), c.get("sale_ends_at"))
            # Legacy fallback: l2.sale_price counts as a 'fixed' L2-level sale if
            # the new sale_type/sale_value haven't been set yet.
            if not l2_sale[0] and c.get("sale_price") is not None:
                l2_sale = ('fixed', float(c["sale_price"]),
                           c.get("sale_starts_at"), c.get("sale_ends_at"))
            st, sv, _ss, _se = _resolve_active_sale(now, l2_sale, var_sale, prod_sale)
            sale_active = st is not None and sv is not None

            compare_at = c.get("compare_at_price")
            if sale_active:
                effective_compare = display_price                  # original = pre-sale effective
                final_price       = _apply_sale(display_price, st, sv)
            else:
                effective_compare = float(compare_at) if compare_at is not None else None
                final_price       = display_price

            node_l2 = {
                "id": c["id"], "name": c["configuration_name"],
                "price": final_price, "effective_price": cfg_eff,
                "compare_at_price": effective_compare,                   # for strikethrough; None = no discount
                "on_sale":          sale_active,
                "sku_code":         c.get("sku_code") or "",
                "barcode":          c.get("barcode")  or "",             # per-SKU EAN-13 / UPC
                "cost_price":       float(c["cost_price"]) if c.get("cost_price") is not None else None,
                "tier_pricing":     (tier_pricing_by_sku or {}).get(c["id"], []),
                "weight_g":         float(c["weight_g"])  if c.get("weight_g")  is not None else None,
                "length_cm":        float(c["length_cm"]) if c.get("length_cm") is not None else None,
                "width_cm":         float(c["width_cm"])  if c.get("width_cm")  is not None else None,
                "height_cm":        float(c["height_cm"]) if c.get("height_cm") is not None else None,
                "stock_quantity": c["stock_quantity"], "sold_quantity": c["sold_quantity"],
                "is_in_cart":   cart_item is not None,
                "cart_item_id": cart_item["cart_item_id"] if cart_item else None,
                "cart_quantity": cart_item["quantity"]    if cart_item else 0,
                "specifications": specifications_by_node.get((2, c["id"]), []),
            }
            if l3_tree: node_l2["conf_layer_3"] = l3_tree
            conf_2_out.append(node_l2)

        # Skip variations with no L2 rows AND no own L1 price/stock (placeholder).
        has_purchasable = bool(conf_2_out) or (
            var_eff is not None and (v.get("stock_quantity") or 0) > 0)
        if not has_purchasable: continue

        images = list(v.get("images") or [])
        media_alt = list(v.get("media_alt") or [])
        # Build typed media[] array — storefront renders video/model differently from image.
        media_typed = [
            {
                "url":  u,
                "type": _media_type(u),
                "alt":  (media_alt[i] if i < len(media_alt) else "") or "",
            }
            for i, u in enumerate(images)
        ]
        node_l1 = {
            "id": v["id"], "name": v["variation_name"],
            "images": images,                    # full per-variation gallery
            "media":  media_typed,               # typed — { url, type, alt } per slot
            "image":  images[0] if images else None,   # cover (back-compat alias for clients using `image`)
            "price": float(v["price"]) if v.get("price") is not None else None,
            "effective_price": var_eff,
            "stock_quantity": v.get("stock_quantity") or 0,
            "sold_quantity":  v.get("sold_quantity")  or 0,
            "is_in_cart": any(c["is_in_cart"] for c in conf_2_out),
            "specifications": specifications_by_node.get((1, v["id"]), []),
        }
        if conf_2_out: node_l1["conf_layer_2"] = conf_2_out
        final_variations.append(node_l1)

    reviews = [
        {
            "id": r["id"], "user_id": r["user_id"], "user_name": r["user_name"],
            "rating": r["rating"], "comment": r["comment"] or "",
            "created_at":     r["created_at"].isoformat() if r.get("created_at") else None,
            # Phase 3 — photos, helpful votes, merchant reply.
            "photos":         r.get("photos") or [],
            "helpful_count":   r.get("helpful_count")   or 0,
            "unhelpful_count": r.get("unhelpful_count") or 0,
            "merchant_reply":      r.get("merchant_reply"),
            "merchant_reply_at":   r["merchant_reply_at"].isoformat()
                                   if r.get("merchant_reply_at") else None,
        }
        for r in reviews_raw
    ]
    reviews_count  = len(reviews)
    average_rating = round(sum(r["rating"] for r in reviews) / reviews_count, 1) if reviews_count else 0.0

    first_l2 = (final_variations[0].get("conf_layer_2") if final_variations else None) or []
    initial_configuration_id = first_l2[0]["id"] if first_l2 else None

    # Storefront cover (= cover of first variation). Aggregated full gallery
    # is also surfaced as `images` so a Products card can show the photo stack.
    summary_image = final_variations[0]["image"] if final_variations else None
    aggregated_images = []
    seen_imgs = set()
    for v in final_variations:
        for u in (v.get("images") or []):
            if u and u not in seen_imgs:
                aggregated_images.append(u); seen_imgs.add(u)
    # Summary uses first leaf SKU's resolved price; compare_at + discount_percent only when on sale.
    if first_l2:
        summary_price       = first_l2[0]["price"]
        summary_compare_at  = first_l2[0].get("compare_at_price")
        summary_on_sale     = bool(first_l2[0].get("on_sale"))
    else:
        summary_price       = (final_variations[0]["effective_price"] if final_variations else 0) or 0
        summary_compare_at  = None
        summary_on_sale     = False
    summary_discount_pct = None
    if summary_on_sale and summary_compare_at and summary_compare_at > 0:
        summary_discount_pct = round((1 - summary_price / summary_compare_at) * 100)

    product_hash = hashids.encode(product["id"])
    return {
        "id": product["id"],
        "product_hash": product_hash,
        "hash": product_hash,                 # legacy alias for storefront grid cards
        "title": product["title"],
        "subtitle":    product.get("subtitle")    or "",
        "description": product.get("description") or "",
        "product_type": product.get("product_type") or "physical",   # physical | digital | service | event
        "category_id":   product.get("category_id"),
        "category_name": product.get("category_name"),
        "category_slug": product.get("category_slug"),
        "seo_title":       product.get("seo_title"),
        "seo_description": product.get("seo_description"),
        "seo_keywords":    _split_keywords(product.get("seo_keywords")),
        "custom_fields":   custom_fields,
        "is_authenticated": user_id is not None, "current_user_id": user_id,
        "is_favorite": is_favorite, "can_review": can_review,
        "reviews_count": reviews_count, "average_rating": average_rating,
        "initial_variation_index": 0, "initial_configuration_id": initial_configuration_id,
        "image":  summary_image,                                      # back-compat: cover URL
        "images": aggregated_images,                                  # full union of all variation galleries
        "price":  summary_price,
        # Sale summary — populated only when the first SKU is currently on sale.
        "compare_at_price": summary_compare_at,                       # null when not on sale
        "on_sale":          summary_on_sale,                          # bool
        "discount_percent": summary_discount_pct,                     # int 1..99, or null
        "modifier_groups": modifier_groups or [],                     # checkbox/radio add-on groups
        # ── Phase 1: SaaS-grade physical fields exposed to storefront ──
        "sku":                   product.get("sku") or "",
        "barcode":               product.get("barcode") or "",
        "brand":                 product.get("brand") or "",
        "manufacturer":          product.get("manufacturer") or "",
        "country_of_origin":     product.get("country_of_origin") or "",
        "og_image_url":          product.get("og_image_url"),
        "requires_shipping":     bool(product.get("requires_shipping", True)),
        "ships_internationally": bool(product.get("ships_internationally")),
        "shipping_class":        product.get("shipping_class") or "standard",
        "lead_time_days":        int(product.get("lead_time_days") or 0),
        "continue_selling_oos":  bool(product.get("continue_selling_oos")),
        "moq":                   int(product.get("moq") or 1),
        "order_increment":       int(product.get("order_increment") or 1),
        "low_stock_threshold":   int(product.get("low_stock_threshold") or 0),
        "is_pre_order":          bool(product.get("is_pre_order")),
        "pre_order_release_at":  product["pre_order_release_at"].isoformat() if product.get("pre_order_release_at") else None,
        "tax": {
            "category_id":   product.get("tax_category_id"),
            "category_name": product.get("tax_category_name"),
            "rate":          float(product.get("tax_rate") or 0),
        } if product.get("tax_category_id") else None,
        "conf_layer_1": final_variations,
        "reviews": reviews,
    }


# ── Modifier groups: shared fetch helper used by both list and single endpoints ────
def _fetch_modifier_groups_for_products(product_ids):
    """Returns dict: { product_id → [ {group fields + items[]} ] } sorted by position."""
    if not product_ids: return {}
    try:
        groups = db_all(
            "SELECT id, product_id, name, control_type, min_select, max_select,"
            "       is_required, default_item_id, position"
            "  FROM product_modifier_groups WHERE product_id = ANY(%s)"
            " ORDER BY position ASC, id ASC",
            (list(product_ids),)
        )
    except Exception as e:
        print(f"[modifier-groups] fetch failed (table missing?): {e}")
        return {pid: [] for pid in product_ids}
    if not groups:
        return {pid: [] for pid in product_ids}
    gids = [g["id"] for g in groups]
    items = db_all(
        "SELECT id, group_id, name, price_delta, position"
        "  FROM product_modifier_items WHERE group_id = ANY(%s)"
        " ORDER BY position ASC, id ASC",
        (gids,)
    )
    items_by_group: dict = {}
    for r in items:
        items_by_group.setdefault(r["group_id"], []).append({
            "id":          r["id"],
            "name":        r["name"],
            "price_delta": float(r["price_delta"] or 0),
            "position":    r["position"],
        })
    by_product: dict = {pid: [] for pid in product_ids}
    for g in groups:
        by_product[g["product_id"]].append({
            "id":              g["id"],
            "name":            g["name"],
            "control_type":    g["control_type"],
            "min_select":      g["min_select"],
            "max_select":      g["max_select"],
            "is_required":     bool(g["is_required"]),
            "default_item_id": g["default_item_id"],
            "position":        g["position"],
            "items":           items_by_group.get(g["id"], []),
        })
    return by_product


def _validate_modifier_selection(product_id, selected_item_ids):
    """Validate selected_item_ids vs group constraints; returns (deduped_ids, item_rows)."""
    selected = sorted(set(int(x) for x in (selected_item_ids or []) if x is not None))
    if not selected:
        # Still need to verify required groups have selections — fetch groups regardless.
        groups = db_all(
            "SELECT id, control_type, min_select, is_required FROM product_modifier_groups"
            " WHERE product_id=%s", (product_id,)
        )
        for g in groups:
            if g["is_required"] and (g["min_select"] or 0) > 0:
                raise HTTPException(400, f"Group '{g['id']}' requires at least {g['min_select']} selection(s)")
        return [], []

    # Pull every selected item with its group context. ANY-array filter avoids N queries.
    items = db_all(
        "SELECT i.id, i.name, i.price_delta, i.group_id,"
        "       g.control_type, g.min_select, g.max_select, g.is_required, g.product_id"
        "  FROM product_modifier_items i"
        "  JOIN product_modifier_groups g ON i.group_id = g.id"
        " WHERE i.id = ANY(%s) AND g.product_id = %s",
        (selected, product_id)
    )
    found_ids = {it["id"] for it in items}
    bad = [x for x in selected if x not in found_ids]
    if bad:
        raise HTTPException(400, f"Modifier item(s) {bad} do not belong to this product")

    # Group counts (selected) and constraint check.
    by_group: dict = {}
    for it in items:
        by_group.setdefault(it["group_id"], []).append(it)

    # Need ALL product groups (not just selected ones) to check is_required + min_select.
    all_groups = db_all(
        "SELECT id, control_type, min_select, max_select, is_required"
        "  FROM product_modifier_groups WHERE product_id=%s",
        (product_id,)
    )
    for g in all_groups:
        gid = g["id"]
        picked = by_group.get(gid, [])
        n = len(picked)
        if g["control_type"] == "radio" and n > 1:
            raise HTTPException(400, f"Radio group {gid} accepts at most 1 selection (got {n})")
        if g["max_select"] is not None and n > g["max_select"]:
            raise HTTPException(400, f"Group {gid} accepts at most {g['max_select']} selection(s) (got {n})")
        if g["is_required"] and n < (g["min_select"] or 0):
            raise HTTPException(400, f"Group {gid} requires at least {g['min_select']} selection(s)")
        if not g["is_required"] and n > 0 and n < (g["min_select"] or 0):
            raise HTTPException(400, f"Group {gid} requires at least {g['min_select']} selection(s) when picked")

    # Snapshot rows for cart line display + order history.
    snapshot = [
        {"id": it["id"], "name": it["name"],
         "price_delta": float(it["price_delta"] or 0),
         "group_id": it["group_id"]}
        for it in items
    ]
    return selected, snapshot

# ── CORS MIDDLEWARE ──────────────────────────────────────

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

app.add_middleware(CSRFMiddleware)
app.add_middleware(DynamicCORSMiddleware)


# ── МОДЕЛИ ───────────────────────────────────────────────

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
    variation_id: int
    configuration_id: int
    quantity: int = 1
    # IDs of selected product_modifier_items. Server validates each id belongs to a
    # group of this product and that the per-group min/max/required constraints hold.
    selected_modifier_item_ids: List[int] = []

class UpdateCartQuantity(BaseModel):
    quantity: int
    # Optional — when present, replaces the cart line's modifier selection.
    # When absent, modifiers stay as-is (quantity-only edit).
    selected_modifier_item_ids: Optional[List[int]] = None

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
    # Strict-mode checkout: when the org has a configured payment provider, POST /orders
    # MUST be preceded by a successful POST /orders/init-payment that returned an intent_id.
    # The intent must be in `succeeded` (Stripe) / CONFIRMED (Tinkoff) / etc. state when
    # /orders is called. We re-verify by fetching the intent server-to-server.
    payment_intent_id: Optional[str] = None

class FrontReview(BaseModel):
    id: int; user_id: int; user_name: str; rating: int
    comment: str = ""; created_at: Optional[str] = None

class FrontSpecification(BaseModel):
    key: str; value: str

class FrontConfNode(BaseModel):
    id: int
    name: str = ''
    price: Optional[float] = None
    effective_price: Optional[float] = None
    stock_quantity: int = 0
    sold_quantity: int = 0
    specifications: List[FrontSpecification] = []
    image: Optional[str] = None
    is_in_cart: bool = False
    cart_item_id: Optional[int] = None
    cart_quantity: int = 0
    # L1-only — full gallery + typed media (image / video / model)
    images: Optional[List[str]] = None
    media:  Optional[List[dict]] = None
    # L2-only — per-SKU physical attributes + sale/cost pricing
    sku_code:         Optional[str]   = None
    barcode:          Optional[str]   = None
    compare_at_price: Optional[float] = None
    cost_price:       Optional[float] = None
    on_sale:          Optional[bool]  = None
    weight_g:         Optional[float] = None
    length_cm:        Optional[float] = None
    width_cm:         Optional[float] = None
    height_cm:        Optional[float] = None
    tier_pricing:     Optional[List[dict]] = None  # [{min_qty, price}, ...] sorted asc
    conf_layer_2: Optional[List["FrontConfNode"]] = None
    conf_layer_3: Optional[List["FrontConfNode"]] = None
    conf_layer_4: Optional[List["FrontConfNode"]] = None
    conf_layer_5: Optional[List["FrontConfNode"]] = None

class ProductPageResponse(BaseModel):
    id: int; product_hash: str; title: str
    hash: Optional[str] = None          # legacy alias, same value as product_hash
    subtitle: Optional[str] = ""        # short tagline shown under title
    description: Optional[str] = ""     # long body text
    product_type: str = "physical"      # physical | digital | service | event
    category_id: Optional[int]   = None
    category_name: Optional[str] = None
    category_slug: Optional[str] = None
    seo_title: Optional[str] = None; seo_description: Optional[str] = None
    seo_keywords: List[str] = []; custom_fields: Optional[dict] = {}
    is_authenticated: bool; current_user_id: Optional[int] = None
    is_favorite: bool; can_review: bool
    reviews_count: int; average_rating: float
    initial_variation_index: int; initial_configuration_id: Optional[int] = None
    image: Optional[str] = None         # cover URL (= images[0]); back-compat
    images: List[str] = []              # union of all variation galleries
    price: float = 0                    # summary price (sale-applied if active)
    compare_at_price: Optional[float] = None   # original price when on_sale = True
    on_sale: bool = False
    discount_percent: Optional[int] = None     # for storefront badges
    modifier_groups: List[dict] = []    # checkbox/radio add-on groups with items
    # Phase 1: SaaS-grade physical fields exposed to storefront.
    sku: str = ""
    barcode: str = ""
    brand: str = ""
    manufacturer: str = ""
    country_of_origin: str = ""
    og_image_url: Optional[str] = None
    requires_shipping: bool = True
    ships_internationally: bool = False
    shipping_class: str = "standard"
    lead_time_days: int = 0
    continue_selling_oos: bool = False
    moq: int = 1
    order_increment: int = 1
    low_stock_threshold: int = 0
    is_pre_order: bool = False
    pre_order_release_at: Optional[str] = None
    tax: Optional[dict] = None
    conf_layer_1: List[FrontConfNode]; reviews: List[FrontReview]

class CartPageItem(BaseModel):
    cart_item_id: int; quantity: int; product_id: int; product_hash: str
    variation_id: Optional[int] = None; configuration_id: Optional[int] = None
    title: str; subtitle: Optional[str] = ""; price: float
    base_price: Optional[float] = None     # SKU price w/o modifiers (for UI breakdown)
    tier_price: Optional[float] = None     # set when wholesale tier kicked in (< base_price)
    compare_at_price: Optional[float] = None  # original price when tier or sale active (strikethrough)
    on_sale: bool = False                  # true when an active sale was applied on top
    configuration_name: Optional[str] = None; variation_name: Optional[str] = None
    image_url: Optional[str] = None; is_favorite: bool = False
    modifiers: List[dict] = []             # [{id, name, price_delta, group_id, group_name}]

class CartPageResponse(BaseModel):
    items: List[CartPageItem]; favorites_ids: List[int]
    subtotal: float; shipping_cost: float; free_shipping_threshold: float
    amount_to_free_shipping: float; shipping_progress: float; total: float


# ── EMAIL ────────────────────────────────────────────────

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


# WEBHOOK DISPATCHER — mirrors CRM/backend; fire-and-forget via BackgroundTasks at call sites.

def _build_slack_message(event: str, data: dict) -> dict:
    label_map = {
        "order.created":     "🆕 New order",     "order.paid":        "💰 Order paid",
        "order.shipped":     "🚚 Order shipped", "order.delivered":   "✅ Order delivered",
        "order.cancelled":   "🚫 Order cancelled","order.returned":    "↩ Order returned",
        "booking.created":   "📅 New booking",   "booking.confirmed": "✅ Booking confirmed",
        "booking.completed": "🏁 Booking completed", "booking.cancelled": "🚫 Booking cancelled",
        "booking.no_show":   "👻 No-show",
        "customer.created":  "👤 New customer",  "payment.received":  "💸 Payment received",
        "product.created":   "🆕 Product added", "product.updated":   "✏ Product updated",
    }
    title = label_map.get(event, event)
    fields = []
    if "order_id" in data:    fields.append({"title": "Order #", "value": str(data["order_id"]), "short": True})
    if "booking_id" in data:  fields.append({"title": "Booking #", "value": str(data["booking_id"]), "short": True})
    if data.get("amount") is not None:
        fields.append({"title": "Amount",
                       "value": f"{data.get('currency', 'USD')} {data['amount']}", "short": True})
    cust = data.get("customer") or {}
    if cust.get("name"):  fields.append({"title": "Customer", "value": cust["name"], "short": True})
    if cust.get("email"): fields.append({"title": "Email",    "value": cust["email"], "short": True})
    if data.get("service_name"): fields.append({"title": "Service",   "value": data["service_name"], "short": True})
    if data.get("starts_at"):    fields.append({"title": "Starts at", "value": data["starts_at"], "short": True})
    return {"text": title, "attachments": [{"color": "#0071E3", "fields": fields}]}


def _build_discord_message(event: str, data: dict) -> dict:
    title_map = {
        "order.created":     "🆕 New order",     "order.paid":        "💰 Order paid",
        "order.shipped":     "🚚 Order shipped", "order.delivered":   "✅ Order delivered",
        "order.cancelled":   "🚫 Order cancelled","order.returned":    "↩ Order returned",
        "booking.created":   "📅 New booking",   "booking.confirmed": "✅ Booking confirmed",
        "booking.completed": "🏁 Booking completed", "booking.cancelled": "🚫 Booking cancelled",
        "booking.no_show":   "👻 No-show",
        "customer.created":  "👤 New customer",  "payment.received":  "💸 Payment received",
        "product.created":   "🆕 Product added", "product.updated":   "✏ Product updated",
    }
    title = title_map.get(event, event)
    fields = []
    if "order_id" in data:    fields.append({"name": "Order #", "value": str(data["order_id"]), "inline": True})
    if "booking_id" in data:  fields.append({"name": "Booking #", "value": str(data["booking_id"]), "inline": True})
    if data.get("amount") is not None:
        fields.append({"name": "Amount", "value": f"{data.get('currency', 'USD')} {data['amount']}", "inline": True})
    cust = data.get("customer") or {}
    if cust.get("name"):  fields.append({"name": "Customer", "value": cust["name"], "inline": True})
    if cust.get("email"): fields.append({"name": "Email",    "value": cust["email"], "inline": True})
    return {"embeds": [{"title": title, "color": 0x0071E3, "fields": fields,
                        "timestamp": _utcnow().isoformat()}]}


def _post_webhook_one(sub: dict, event: str, data: dict, attempt: int = 1) -> dict:
    sub_type = sub["type"]
    if sub_type == "slack":
        body_obj = _build_slack_message(event, data)
        body     = json.dumps(body_obj).encode()
        headers  = {"Content-Type": "application/json"}
    elif sub_type == "discord":
        body_obj = _build_discord_message(event, data)
        body     = json.dumps(body_obj).encode()
        headers  = {"Content-Type": "application/json"}
    else:
        body_obj = {"event": event, "project_id": sub["project_id"],
                    "occurred_at": _utcnow().isoformat(), "data": data}
        body = json.dumps(body_obj, default=str).encode()
        sig  = hashlib.sha256()  # placeholder — real sig below
        import hmac as _hmac_local
        sig  = _hmac_local.new(sub["secret"].encode(), body, hashlib.sha256).hexdigest()
        headers = {
            "Content-Type":      "application/json",
            "X-Torta-Event":     event,
            "X-Torta-Signature": f"sha256={sig}",
            "X-Torta-Timestamp": str(int(time.time())),
            "User-Agent":        "Torta-Webhooks/1.0",
        }

    t0 = time.time()
    out = {"subscription_id": sub["id"], "project_id": sub["project_id"],
           "event": event, "payload": json.dumps(body_obj, default=str),
           "attempt": attempt}
    try:
        req = urllib.request.Request(sub["url"], data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            text = resp.read(4096).decode("utf-8", errors="replace")
            out.update({"status": "success" if 200 <= resp.status < 300 else "failed",
                        "http_code": resp.status, "response_body": text[:2000],
                        "duration_ms": int((time.time() - t0) * 1000)})
    except urllib.error.HTTPError as e:
        try:    txt = e.read(4096).decode("utf-8", errors="replace")
        except Exception: txt = str(e)
        out.update({"status": "failed", "http_code": e.code,
                    "response_body": txt[:2000],
                    "duration_ms": int((time.time() - t0) * 1000)})
    except Exception as e:
        out.update({"status": "failed", "http_code": None,
                    "response_body": str(e)[:2000],
                    "duration_ms": int((time.time() - t0) * 1000)})
    return out


def dispatch_event(project_id: int, event: str, data: dict):
    """Fire active webhook subs for (project_id, event), log to crm_webhook_deliveries. Never raises."""
    try:
        rows = db_all(
            "SELECT * FROM crm_webhook_subscriptions WHERE project_id=%s AND is_active=TRUE",
            (project_id,)
        )
    except Exception as e:
        print(f"[webhook] subs query failed: {e}"); return
    for sub in rows:
        events = sub.get("events") or []
        if events and event not in events:
            continue
        try:
            out = _post_webhook_one(dict(sub), event, data)
            with db_cursor() as (conn, cur):
                cur.execute(
                    """INSERT INTO crm_webhook_deliveries
                          (subscription_id, project_id, event, payload, status,
                           http_code, response_body, duration_ms, attempt)
                       VALUES (%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s)""",
                    (out["subscription_id"], out["project_id"], out["event"],
                     out["payload"], out["status"], out.get("http_code"),
                     out.get("response_body", ""), out.get("duration_ms"),
                     out["attempt"])
                )
                cur.execute(
                    "UPDATE crm_webhook_subscriptions SET last_status=%s, last_error=%s, last_event_at=NOW() WHERE id=%s",
                    (out["status"],
                     out.get("response_body", "")[:500] if out["status"] != "success" else "",
                     sub["id"])
                )
                conn.commit()
        except Exception as e:
            print(f"[webhook] dispatch failed for sub {sub.get('id')}: {e}")


# ── RATE-LIMIT / VERIFICATION STORAGE ────────────────────

# ── Inlined: kvstore (Redis-backed K/V with in-memory fallback) ──
import os, time, json, threading, fnmatch
from typing import Any, Iterable

REDIS_URL = os.getenv("REDIS_URL", "").strip()

_redis = None
_backend_name = "memory"

if REDIS_URL:
    try:
        import redis  # type: ignore
        _redis = redis.from_url(
            REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        _redis.ping()
        _backend_name = "redis"
        print(f"[kvstore] Connected to Redis: {REDIS_URL.split('@')[-1]}")
    except ImportError:
        print("[kvstore] redis-py not installed — falling back to in-memory store")
        _redis = None
    except Exception as e:
        print(f"[kvstore] Redis unreachable ({e}) — falling back to in-memory store")
        _redis = None

def backend() -> str:
    """Returns 'redis' or 'memory'. Useful for /health endpoints."""
    return _backend_name

# ── Inlined: pdf_documents (reportlab PDF renderer for invoices/tickets/etc.) ──
from io import BytesIO
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER

# ── Style preset palette ──────────────────────────────────────────────

def _palette(style: str, accent: str):
    accent_color = HexColor(accent or "#0071E3")
    if style == "classic":
        return {
            "title_font":   "Times-Bold",
            "body_font":    "Times-Roman",
            "heading_size": 22,
            "accent":       HexColor("#1f1f1f"),
            "subtle":       HexColor("#7a7a7a"),
            "rule":         HexColor("#1f1f1f"),
            "table_head_bg": HexColor("#f3f3f3"),
            "show_band":    False,
            "align":        "center",
        }
    if style == "minimal":
        return {
            "title_font":   "Helvetica-Bold",
            "body_font":    "Helvetica",
            "heading_size": 20,
            "accent":       HexColor("#111111"),
            "subtle":       HexColor("#9b9b9b"),
            "rule":         HexColor("#e5e5e5"),
            "table_head_bg": white,
            "show_band":    False,
            "align":        "left",
        }
    # modern (default)
    return {
        "title_font":   "Helvetica-Bold",
        "body_font":    "Helvetica",
        "heading_size": 24,
        "accent":       accent_color,
        "subtle":       HexColor("#666666"),
        "rule":         accent_color,
        "table_head_bg": accent_color,
        "show_band":    True,
        "align":        "left",
    }


def _money(amount, currency="USD"):
    sym = {"USD": "$", "EUR": "€", "KZT": "₸", "RUB": "₽", "GBP": "£"}.get(currency, "")
    if sym in ("$", "€", "£"):
        return f"{sym}{amount:,.2f}"
    return f"{amount:,.2f} {currency}"


def _safe(v):
    return "" if v is None else str(v)


# ── Page banner / header / footer ─────────────────────────────────────

def _draw_band(c: canvas.Canvas, palette, page_width, page_height):
    if not palette["show_band"]:
        return
    c.setFillColor(palette["accent"])
    c.rect(0, page_height - 12 * mm, page_width, 12 * mm, fill=1, stroke=0)


def _draw_footer(c: canvas.Canvas, palette, branding, page_width):
    note = (branding.get("footer_note") or "").strip()
    if not note: return
    c.setFont(palette["body_font"], 8)
    c.setFillColor(palette["subtle"])
    c.drawCentredString(page_width / 2, 12 * mm, note[:200])


# ── Top-of-document header (logo + company info) ─────────────────────

def _build_header(branding, palette):
    """Returns a flowable Table for the document header."""
    company = branding.get("company_name") or "Your Company"
    address = (branding.get("address") or "").replace("\n", "<br/>")
    tax_label = branding.get("tax_id_label") or "Tax ID"
    tax_id    = branding.get("tax_id") or ""
    contact_email = branding.get("contact_email") or ""
    contact_phone = branding.get("contact_phone") or ""

    body_style = ParagraphStyle(
        "company_body", fontName=palette["body_font"], fontSize=9,
        leading=12, textColor=palette["subtle"],
        alignment=TA_RIGHT if palette["align"] == "left" else TA_CENTER,
    )
    name_style = ParagraphStyle(
        "company_name", fontName=palette["title_font"], fontSize=12,
        leading=14, textColor=palette["accent"],
        alignment=TA_RIGHT if palette["align"] == "left" else TA_CENTER,
    )

    info_html = f"<b>{company}</b><br/>"
    if address:        info_html += address + "<br/>"
    if tax_id:         info_html += f"{tax_label}: {tax_id}<br/>"
    if contact_email:  info_html += contact_email + "<br/>"
    if contact_phone:  info_html += contact_phone

    info_para = Paragraph(info_html, body_style)
    name_para = Paragraph(company, name_style)

    # Logo cell (left), name+info (right)
    logo_url = branding.get("logo_url") or ""
    logo_cell = ""
    if logo_url and logo_url.startswith(("http://", "https://", "/")):
        try:
            from urllib.request import urlopen
            from urllib.parse import urlparse
            if logo_url.startswith("/"):
                # locally hosted via External/static; skip — external can serve later
                logo_cell = ""
            else:
                # 5-second fetch budget; on failure fall back silently
                with urlopen(logo_url, timeout=5) as r:
                    logo_bytes = r.read(2_000_000)
                logo_cell = Image(BytesIO(logo_bytes), width=28*mm, height=28*mm,
                                   kind="proportional")
        except Exception:
            logo_cell = ""

    if palette["align"] == "center":
        # Classic centered layout — name above details, no logo column.
        return [
            Paragraph(f"<para alignment='center'>{company}</para>", name_style),
            Paragraph(f"<para alignment='center'>{info_html}</para>", body_style),
        ]
    # modern / minimal — logo left, info right
    table = Table([[logo_cell or "", info_para]], colWidths=[40*mm, None])
    table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (0, 0), "LEFT"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return [table]


def _build_title_block(palette, doc_title, doc_subtitle):
    title_style = ParagraphStyle(
        "doc_title", fontName=palette["title_font"], fontSize=palette["heading_size"],
        leading=palette["heading_size"] * 1.1, textColor=palette["accent"],
        spaceBefore=10, spaceAfter=4,
        alignment=TA_CENTER if palette["align"] == "center" else TA_LEFT,
    )
    sub_style = ParagraphStyle(
        "doc_sub", fontName=palette["body_font"], fontSize=10,
        leading=14, textColor=palette["subtle"], spaceAfter=10,
        alignment=TA_CENTER if palette["align"] == "center" else TA_LEFT,
    )
    out = [Paragraph(doc_title, title_style)]
    if doc_subtitle:
        out.append(Paragraph(doc_subtitle, sub_style))
    return out


def _build_items_table(items, palette, currency="USD"):
    """items: [{title, qty, price, total?}, …]"""
    head_color = white if palette["show_band"] else palette["accent"]
    rows = [[Paragraph(f"<b>Description</b>", _para(palette, color=head_color)),
             Paragraph(f"<b>Qty</b>",        _para(palette, color=head_color, align="right")),
             Paragraph(f"<b>Price</b>",      _para(palette, color=head_color, align="right")),
             Paragraph(f"<b>Total</b>",      _para(palette, color=head_color, align="right"))]]
    for it in items:
        qty   = it.get("qty", 1)
        price = float(it.get("price", 0))
        total = it.get("total", qty * price)
        rows.append([
            Paragraph(_safe(it.get("title")) +
                      (f"<br/><font size=8 color='#888'>{_safe(it.get('variation'))}</font>"
                       if it.get("variation") else ""),
                      _para(palette)),
            Paragraph(str(qty),                   _para(palette, align="right")),
            Paragraph(_money(price, currency),    _para(palette, align="right")),
            Paragraph(_money(total, currency),    _para(palette, align="right")),
        ])
    table = Table(rows, colWidths=[None, 18*mm, 30*mm, 30*mm])
    style = [
        ("VALIGN",    (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND",(0, 0), (-1, 0), palette["table_head_bg"]),
        ("BOX",       (0, 0), (-1, -1), 0.4, palette["rule"]),
        ("INNERGRID", (0, 0), (-1, -1), 0.2, palette["rule"]),
        ("LEFTPADDING",  (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING",   (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 8),
    ]
    table.setStyle(TableStyle(style))
    return table


def _para(palette, color=None, align="left"):
    return ParagraphStyle(
        "cell", fontName=palette["body_font"], fontSize=10,
        leading=13, textColor=color or palette["accent"],
        alignment={"left": TA_LEFT, "right": TA_RIGHT, "center": TA_CENTER}[align],
    )


def _build_totals(subtotal, shipping, discount, total, palette, currency="USD"):
    style_label = ParagraphStyle(
        "tot_label", fontName=palette["body_font"], fontSize=10,
        leading=14, textColor=palette["subtle"], alignment=TA_RIGHT,
    )
    style_value = ParagraphStyle(
        "tot_value", fontName=palette["body_font"], fontSize=10,
        leading=14, textColor=palette["accent"], alignment=TA_RIGHT,
    )
    style_total_l = ParagraphStyle(
        "tot_total_l", fontName=palette["title_font"], fontSize=12,
        leading=16, textColor=palette["accent"], alignment=TA_RIGHT,
    )
    rows = []
    if subtotal is not None:
        rows.append([Paragraph("Subtotal", style_label),
                     Paragraph(_money(subtotal, currency), style_value)])
    if shipping:
        rows.append([Paragraph("Shipping", style_label),
                     Paragraph(_money(shipping, currency), style_value)])
    if discount:
        rows.append([Paragraph("Discount", style_label),
                     Paragraph("-" + _money(discount, currency), style_value)])
    rows.append([Paragraph("<b>Total</b>", style_total_l),
                 Paragraph(f"<b>{_money(total, currency)}</b>", style_total_l)])
    table = Table(rows, colWidths=[None, 36*mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEABOVE", (0, -1), (-1, -1), 1.2, palette["rule"]),
        ("TOPPADDING", (0, -1), (-1, -1), 8),
    ]))
    return table


# ── Public API ────────────────────────────────────────────────────────

def render_document(doc_type: str, style: str, branding: dict, data: dict) -> bytes:
    """
    doc_type: 'invoice' | 'act' | 'receipt' | 'ticket'
    style:    'modern' | 'classic' | 'minimal'
    branding: dict matching crm_document_settings columns
    data:     content shape varies per doc_type (see callers)
    """
    palette = _palette(style or "modern", branding.get("accent_color") or "#0071E3")
    buf = BytesIO()

    def _on_page(c, _doc):
        _draw_band(c, palette, A4[0], A4[1])
        _draw_footer(c, palette, branding, A4[0])

    sd = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=24*mm if palette["show_band"] else 18*mm,
        bottomMargin=20*mm,
        title=f"{doc_type.title()} {data.get('number','')}",
    )
    flow = []
    flow.extend(_build_header(branding, palette))
    flow.append(Spacer(1, 8*mm))

    if doc_type == "invoice":
        title = f"Invoice #{data.get('number','')}"
        sub   = (f"Issued {data.get('issued_at','')} · "
                 f"To: {data.get('customer',{}).get('name','')}").strip(" ·")
        flow.extend(_build_title_block(palette, title, sub))
        flow.append(_build_items_table(data.get("items", []), palette, data.get("currency","USD")))
        flow.append(Spacer(1, 6*mm))
        flow.append(_build_totals(
            data.get("subtotal"), data.get("shipping", 0),
            data.get("discount", 0), data.get("total", 0),
            palette, data.get("currency", "USD")))

    elif doc_type == "act":
        title = f"Act of services #{data.get('number','')}"
        sub   = (f"Performed {data.get('performed_at','')} · "
                 f"Customer: {data.get('customer',{}).get('name','')}").strip(" ·")
        flow.extend(_build_title_block(palette, title, sub))
        flow.append(_build_items_table(data.get("items", []), palette, data.get("currency","USD")))
        flow.append(Spacer(1, 6*mm))
        flow.append(_build_totals(
            data.get("subtotal"), 0, 0, data.get("total", 0),
            palette, data.get("currency", "USD")))
        flow.append(Spacer(1, 16*mm))
        sig_style = ParagraphStyle("sig", fontName=palette["body_font"], fontSize=10,
                                    leading=20, textColor=palette["subtle"])
        flow.append(Paragraph("_____________________________________ &nbsp; "
                              "_____________________________________<br/>"
                              "<font size=9 color='#888'>Service provider</font>"
                              "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
                              "<font size=9 color='#888'>Customer</font>",
                              sig_style))

    elif doc_type == "receipt":
        title = f"Receipt #{data.get('number','')}"
        sub   = f"Paid {data.get('paid_at','')}"
        flow.extend(_build_title_block(palette, title, sub))
        flow.append(_build_items_table(data.get("items", []), palette, data.get("currency","USD")))
        flow.append(Spacer(1, 6*mm))
        flow.append(_build_totals(
            data.get("subtotal"), 0, 0, data.get("total", 0),
            palette, data.get("currency", "USD")))
        if data.get("downloads"):
            flow.append(Spacer(1, 8*mm))
            dl_style = ParagraphStyle("dl", fontName=palette["body_font"], fontSize=10,
                                       leading=14, textColor=palette["accent"])
            flow.append(Paragraph("<b>Your downloads</b>", dl_style))
            for d in data["downloads"]:
                flow.append(Paragraph(f"• {d.get('label','')}: <font color='#0071E3'>{d.get('url','')}</font>",
                                       _para(palette)))

    elif doc_type == "ticket":
        title = f"Event ticket"
        sub   = data.get("event_name", "")
        flow.extend(_build_title_block(palette, title, sub))
        info_style = ParagraphStyle("info", fontName=palette["body_font"], fontSize=11,
                                    leading=16, textColor=palette["accent"])
        when  = data.get("starts_at", "")
        venue = data.get("venue", "")
        seat  = data.get("seat", "")
        attendee = (data.get("attendee", {}) or {}).get("name", "")
        info_html = ""
        if when:    info_html += f"<b>When:</b> {when}<br/>"
        if venue:   info_html += f"<b>Venue:</b> {venue}<br/>"
        if seat:    info_html += f"<b>Seat:</b> {seat}<br/>"
        if attendee:info_html += f"<b>Attendee:</b> {attendee}<br/>"
        flow.append(Paragraph(info_html, info_style))
        flow.append(Spacer(1, 6*mm))
        # QR code if `qr_url` provided — uses reportlab.graphics.barcode
        qr_data = data.get("qr_data") or data.get("qr_url")
        if qr_data:
            try:
                from reportlab.graphics.barcode.qr import QrCodeWidget
                from reportlab.graphics.shapes import Drawing
                qr = QrCodeWidget(qr_data, barLevel="M")
                bounds = qr.getBounds()
                w_qr = bounds[2] - bounds[0]
                h_qr = bounds[3] - bounds[1]
                d = Drawing(60*mm, 60*mm, transform=[60*mm/w_qr, 0, 0, 60*mm/h_qr, 0, 0])
                d.add(qr)
                flow.append(d)
            except Exception:
                pass
        flow.append(Spacer(1, 8*mm))
        flow.append(Paragraph(f"<font color='#888' size=9>"
                              f"Ticket #{data.get('number','')} · "
                              f"Order #{data.get('order_id','')}"
                              f"</font>", _para(palette)))

    else:
        flow.extend(_build_title_block(palette, doc_type.title(),
                                       f"Generated {datetime.utcnow().isoformat(timespec='seconds')}Z"))

    sd.build(flow, onFirstPage=_on_page, onLaterPages=_on_page)
    return buf.getvalue()


# ─── In-memory fallback ─────────────────────────────────────────────────────
_mem: dict[str, Any] = {}
_mem_expires: dict[str, float] = {}
_mem_lock = threading.RLock()

def _mem_purge_expired():
    """Best-effort sweep — called on every read so memory doesn't bloat."""
    now = time.time()
    expired = [k for k, t in _mem_expires.items() if t <= now]
    for k in expired:
        _mem.pop(k, None)
        _mem_expires.pop(k, None)

# ─── Public API ─────────────────────────────────────────────────────────────

def _kv_get(key: str) -> Any | None:
    """Returns the deserialised JSON value, or None if missing/expired."""
    if _redis:
        v = _redis.get(key)
        if v is None: return None
        try:    return json.loads(v)
        except Exception: return None
    with _mem_lock:
        _mem_purge_expired()
        return _mem.get(key)

def _kv_set(key: str, value: Any, ttl: int | None = None) -> None:
    """Set a JSON value. ttl in seconds (None = no expiry)."""
    if _redis:
        payload = json.dumps(value)
        if ttl: _redis.setex(key, int(ttl), payload)
        else:   _redis.set(key, payload)
        return
    with _mem_lock:
        _mem[key] = value
        if ttl is not None:
            _mem_expires[key] = time.time() + int(ttl)
        else:
            _mem_expires.pop(key, None)

def _kv_delete(key: str) -> None:
    if _redis:
        _redis.delete(key)
        return
    with _mem_lock:
        _mem.pop(key, None)
        _mem_expires.pop(key, None)

def _kv_exists(key: str) -> bool:
    if _redis:
        return bool(_redis.exists(key))
    with _mem_lock:
        _mem_purge_expired()
        return key in _mem

def _kv_incr(key: str, ttl: int | None = None) -> int:
    """
    Atomically increment an integer counter and return the new value.
    If the key didn't exist, it's created with value=1 and TTL applied.
    If the key already had a TTL, it is NOT extended — the window stays
    fixed (so a sliding-window attack can't keep the key alive forever).
    """
    if _redis:
        # Pipeline: INCR + (EXPIRE NX) — only set TTL on first increment.
        # The NX flag (Redis 7+) is the cleanest way; for older versions we
        # check ttl<0 and conditionally EXPIRE.
        with _redis.pipeline() as p:
            p.incr(key)
            results = p.execute()
        new_val = int(results[0])
        if ttl is not None and new_val == 1:
            try:
                _redis.expire(key, int(ttl))
            except Exception:
                pass
        return new_val
    with _mem_lock:
        _mem_purge_expired()
        cur = int(_mem.get(key, 0)) + 1
        _mem[key] = cur
        if ttl is not None and key not in _mem_expires:
            _mem_expires[key] = time.time() + int(ttl)
        return cur

def _kv_ttl(key: str) -> int:
    """Returns seconds remaining until expiry. -1 if no TTL, -2 if missing."""
    if _redis:
        return int(_redis.ttl(key))
    with _mem_lock:
        if key not in _mem: return -2
        if key not in _mem_expires: return -1
        left = int(_mem_expires[key] - time.time())
        return max(left, 0)

def _kv_keys_matching(pattern: str) -> list[str]:
    """
    Glob-style key pattern (e.g. 'pw_reset:*'). Used for sweep-and-delete
    operations like 'invalidate all reset tokens for this email'. Avoid in
    hot paths — Redis SCAN is O(N) over keyspace.
    """
    if _redis:
        return list(_redis.scan_iter(match=pattern))
    with _mem_lock:
        _mem_purge_expired()
        return [k for k in list(_mem.keys()) if fnmatch.fnmatch(k, pattern)]


# ── Email OTP (pending verifications) ──────────────────────────────────────
def _pv_key(project_id: int, email: str) -> str:
    return f"pv:{project_id}:{email}"
def _pv_get(project_id, email): return _kv_get(_pv_key(project_id, email))
def _pv_set(project_id, email, value, ttl=None):
    _kv_set(_pv_key(project_id, email), value, ttl=ttl or CODE_TTL_MINUTES * 60)
def _pv_del(project_id, email): _kv_delete(_pv_key(project_id, email))

# Failed-attempt counters: atomic INCR per fail:<bucket>:<id>, TTL=BLOCK_MINUTES*60; >=MAX_FAILED_ATTEMPTS = blocked.
def _fail_key(bucket: str, ident: str) -> str:
    return f"fail:{bucket}:{ident}"
def _fail_check(bucket: str, ident: str):
    key = _fail_key(bucket, ident)
    count = int(_kv_get(key) or 0)
    if count >= MAX_FAILED_ATTEMPTS:
        return True, max(_kv_ttl(key), 1)
    return False, 0
def _fail_record(bucket: str, ident: str):
    return _kv_incr(_fail_key(bucket, ident), ttl=BLOCK_MINUTES * 60)
def _fail_clear(bucket: str, ident: str):
    _kv_delete(_fail_key(bucket, ident))

# Password reset tokens: pw_reset:<sha256(raw_token)>, TTL=RESET_TTL_MINUTES*60.
def _reset_key(token_hash: str) -> str:
    return f"pw_reset:{token_hash}"
def _reset_get(token_hash):    return _kv_get(_reset_key(token_hash))
def _reset_set(token_hash, v): _kv_set(_reset_key(token_hash), v, ttl=RESET_TTL_MINUTES * 60)
def _reset_del(token_hash):    _kv_delete(_reset_key(token_hash))



# ── CSRF TOKEN ───────────────────────────────────────────

@app.get("/{api_key}/csrf")
def get_csrf_token(api_key: str, request: Request, response: Response,
                   api_key_record: dict = Depends(resolve_api_key)):
    """Issue (or reuse) a CSRF token cookie for the store frontend (SDK calls once on init)."""
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


# ── АУТЕНТИФИКАЦИЯ ───────────────────────────────────────

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
                left = max(_kv_ttl(_fail_key(bucket, ident)), 1)
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
                left = max(_kv_ttl(_fail_key(bucket, ident)), 1)
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


# ── REFRESH TOKEN / SESSIONS ─────────────────────────────

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


# ── ВОССТАНОВЛЕНИЕ ПАРОЛЯ ────────────────────────────────

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
        for k in _kv_keys_matching("pw_reset:*"):
            d = _kv_get(k)
            if d and d.get("email") == email and d.get("project_id") == project_id:
                _kv_delete(k)
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


# ── ПРОДУКТЫ ─────────────────────────────────────────────

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
def get_products(request: Request,
                 api_key_record: dict = Depends(resolve_api_key),
                 category: Optional[str] = None,
                 uncategorized: bool = False):
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)

    with db_cursor() as (_, cursor):
        # ── 1. Products (with category filter) — archived/paused hidden from storefront.
        where  = ["p.project_id = %s",
                  "COALESCE(p.is_archived, FALSE) = FALSE",
                  "COALESCE(p.is_paused, FALSE) = FALSE"]
        params = [project_id]
        if uncategorized:
            where.append("p.category_id IS NULL")
        elif category:
            where.append("c.slug = %s")
            params.append(category)
        cursor.execute(
            "SELECT p.id, p.title, p.subtitle, p.description, p.product_type, "
            "p.seo_title, p.seo_description, p.seo_keywords, "
            "p.category_id, c.name AS category_name, c.slug AS category_slug, "
            "p.sku, p.barcode, p.brand, p.manufacturer, p.vendor, "
            "p.country_of_origin, p.hs_code, p.og_image_url, "
            "p.requires_shipping, p.ships_internationally, p.shipping_class, p.lead_time_days, "
            "p.continue_selling_oos, p.moq, p.order_increment, p.low_stock_threshold, "
            "p.is_pre_order, p.pre_order_release_at, p.tax_category_id, "
            "p.sale_type, p.sale_value, p.sale_starts_at, p.sale_ends_at, "
            "tc.name AS tax_category_name, tc.rate AS tax_rate "
            "FROM products p "
            "LEFT JOIN product_categories c ON c.id = p.category_id "
            "LEFT JOIN product_tax_categories tc ON tc.id = p.tax_category_id "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY p.id ASC",
            params
        )
        products = cursor.fetchall()
        if not products: return []

        product_ids = [p["id"] for p in products]
        fmt = ",".join(["%s"] * len(product_ids))

        # ── 2. Layer 1 (variations) for ALL products ───────────────────
        cursor.execute(
            f"SELECT id, product_id, variation_name, images, price, stock_quantity, sold_quantity, position, "
            f"       sale_type, sale_value, sale_starts_at, sale_ends_at "
            f"FROM product_configurations_l1 WHERE product_id IN ({fmt}) "
            f"ORDER BY position ASC, id ASC",
            product_ids
        )
        l1_rows = cursor.fetchall()
        variations_by_product = {}
        for v in l1_rows:
            variations_by_product.setdefault(v["product_id"], []).append(v)
        l1_ids = [v["id"] for v in l1_rows]

        # ── 3. Layer 2 ────────────────────────────────────────────────
        cfg_by_variation_id = {}
        l2_ids = []
        if l1_ids:
            l1fmt = ",".join(["%s"] * len(l1_ids))
            cursor.execute(
                f"SELECT id, variation_id, configuration_name, price, stock_quantity, sold_quantity, position, "
                f"       sku_code, barcode, compare_at_price, cost_price, sale_price, sale_starts_at, sale_ends_at,"
                f"       weight_g, length_cm, width_cm, height_cm "
                f"FROM product_configurations_l2 WHERE variation_id IN ({l1fmt}) "
                f"ORDER BY position ASC, id ASC",
                l1_ids
            )
            for c in cursor.fetchall():
                cfg_by_variation_id.setdefault(c["variation_id"], []).append(c)
                l2_ids.append(c["id"])

        # ── 4. Layers 3, 4, 5 (chained by parent_id) ──────────────────
        layer3_by_parent, layer4_by_parent, layer5_by_parent = {}, {}, {}
        l3_ids, l4_ids, l5_ids = [], [], []
        if l2_ids:
            l2fmt = ",".join(["%s"] * len(l2_ids))
            cursor.execute(
                f"SELECT id, parent_id, name, price, stock_quantity, sold_quantity, position "
                f"FROM product_configurations_l3 WHERE parent_id IN ({l2fmt}) "
                f"ORDER BY position ASC, id ASC",
                l2_ids
            )
            for r in cursor.fetchall():
                layer3_by_parent.setdefault(r["parent_id"], []).append(r)
                l3_ids.append(r["id"])
        if l3_ids:
            l3fmt = ",".join(["%s"] * len(l3_ids))
            cursor.execute(
                f"SELECT id, parent_id, name, price, stock_quantity, sold_quantity, position "
                f"FROM product_configurations_l4 WHERE parent_id IN ({l3fmt}) "
                f"ORDER BY position ASC, id ASC",
                l3_ids
            )
            for r in cursor.fetchall():
                layer4_by_parent.setdefault(r["parent_id"], []).append(r)
                l4_ids.append(r["id"])
        if l4_ids:
            l4fmt = ",".join(["%s"] * len(l4_ids))
            cursor.execute(
                f"SELECT id, parent_id, name, price, stock_quantity, sold_quantity, position "
                f"FROM product_configurations_l5 WHERE parent_id IN ({l4fmt}) "
                f"ORDER BY position ASC, id ASC",
                l4_ids
            )
            for r in cursor.fetchall():
                layer5_by_parent.setdefault(r["parent_id"], []).append(r)
                l5_ids.append(r["id"])

        # ── 5. Specifications scoped to OUR layer ids ──────────────────
        specifications_by_node = {}
        spec_clauses, spec_params = [], []
        if l1_ids:
            l1fmt = ",".join(["%s"] * len(l1_ids))
            spec_clauses.append(f"variation_id IN ({l1fmt})")
            spec_params.extend(l1_ids)
        for layer_n, ids in ((2, l2_ids), (3, l3_ids), (4, l4_ids), (5, l5_ids)):
            if ids:
                idsfmt = ",".join(["%s"] * len(ids))
                spec_clauses.append(f"(layer = {layer_n} AND parent_id IN ({idsfmt}))")
                spec_params.extend(ids)
        if spec_clauses:
            cursor.execute(
                f"SELECT variation_id, layer, parent_id, spec_key, spec_value, position "
                f"FROM product_specifications WHERE {' OR '.join(spec_clauses)} "
                f"ORDER BY position ASC, id ASC",
                spec_params
            )
            for row in cursor.fetchall():
                # Phase 1: skip placeholder rows (empty value).
                if not (row.get("spec_value") or "").strip():
                    continue
                layer_v = row.get("layer") or 1
                parent_id = row["parent_id"] if row.get("parent_id") is not None else row["variation_id"]
                specifications_by_node.setdefault((layer_v, parent_id), []).append({
                    "key": row["spec_key"], "value": row["spec_value"],
                })

        # ── 6. Reviews per product ────────────────────────────────────
        cursor.execute(
            f"SELECT pr.id, pr.user_id, pr.product_id, pr.rating, pr.comment, pr.created_at, "
            f"u.name AS user_name FROM product_reviews pr "
            f"JOIN users u ON pr.user_id = u.id AND u.project_id = %s "
            f"WHERE pr.product_id IN ({fmt}) AND pr.project_id = %s "
            f"ORDER BY pr.created_at DESC",
            [project_id] + product_ids + [project_id]
        )
        reviews_by_product = {}
        for r in cursor.fetchall():
            reviews_by_product.setdefault(r["product_id"], []).append(r)

        # ── 7. Custom fields per product ──────────────────────────────
        cursor.execute(
            f"SELECT product_id, field_key, field_value FROM product_custom_fields "
            f"WHERE project_id = %s AND product_id IN ({fmt})",
            [project_id] + product_ids
        )
        cf_by_product = {}
        for r in cursor.fetchall():
            cf_by_product.setdefault(r["product_id"], {})[r["field_key"]] = r["field_value"]

        # ── 8. User-scoped data (favorites, cart, can_review) ─────────
        favorites_set, cart_map_global, can_review_set = set(), {}, set()
        if user_id:
            cursor.execute(
                f"SELECT product_id FROM favorites WHERE user_id = %s "
                f"AND project_id = %s AND product_id IN ({fmt})",
                [user_id, project_id] + product_ids
            )
            favorites_set = {r["product_id"] for r in cursor.fetchall()}

            cursor.execute(
                f"SELECT ci.id AS cart_item_id, ci.product_id, ci.variation_id, "
                f"ci.configuration_id, ci.quantity FROM cart_items ci "
                f"JOIN carts c ON ci.cart_id = c.id "
                f"WHERE c.user_id = %s AND c.project_id = %s "
                f"AND ci.product_id IN ({fmt})",
                [user_id, project_id] + product_ids
            )
            for row in cursor.fetchall():
                # Keys are unique across products (variation_id and configuration_id are global PKs).
                cart_map_global[(row["variation_id"], row["configuration_id"])] = row

            # can_review: ordered ('delivered' or 'returned') AND not yet reviewed.
            cursor.execute(
                f"SELECT DISTINCT product_id FROM product_reviews "
                f"WHERE user_id = %s AND project_id = %s "
                f"AND product_id IN ({fmt})",
                [user_id, project_id] + product_ids
            )
            already_reviewed = {r["product_id"] for r in cursor.fetchall()}
            cursor.execute(
                f"SELECT DISTINCT oi.product_id FROM order_history oh "
                f"JOIN order_items oi ON oh.id = oi.order_id "
                f"WHERE oh.user_id = %s AND oh.project_id = %s "
                f"AND oh.status IN ('delivered','returned') "
                f"AND oi.product_id IN ({fmt})",
                [user_id, project_id] + product_ids
            )
            for r in cursor.fetchall():
                if r["product_id"] not in already_reviewed:
                    can_review_set.add(r["product_id"])

    modifier_groups_by_product = _fetch_modifier_groups_for_products(product_ids)
    # Tier pricing — single batched query for every L2 SKU across the whole list.
    tier_pricing_by_sku = _fetch_tier_pricing(l2_ids)

    return [
        _assemble_product_payload(
            p,
            variations=variations_by_product.get(p["id"], []),
            cfg_by_variation_id=cfg_by_variation_id,
            layer3_by_parent=layer3_by_parent,
            layer4_by_parent=layer4_by_parent,
            layer5_by_parent=layer5_by_parent,
            specifications_by_node=specifications_by_node,
            cart_map=cart_map_global,
            is_favorite=p["id"] in favorites_set,
            can_review=p["id"] in can_review_set,
            custom_fields=cf_by_product.get(p["id"], {}),
            reviews_raw=reviews_by_product.get(p["id"], []),
            user_id=user_id,
            modifier_groups=modifier_groups_by_product.get(p["id"], []),
            tier_pricing_by_sku=tier_pricing_by_sku,
        )
        for p in products
    ]


@app.get("/{api_key}/product/{product_hash}",
         response_model=ProductPageResponse,
         response_model_exclude_none=True)
def get_product_page(product_hash: str, request: Request,
                     api_key_record: dict = Depends(resolve_api_key)):
    decoded = hashids.decode(product_hash)
    if not decoded: raise HTTPException(404, "Product not found")
    product_id = decoded[0]
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)

    with db_cursor() as (_, cursor):
        cursor.execute(
            "SELECT p.id, p.title, p.subtitle, p.description, p.product_type, "
            "p.seo_title, p.seo_description, p.seo_keywords, "
            "p.category_id, c.name AS category_name, c.slug AS category_slug, "
            "p.sku, p.barcode, p.brand, p.manufacturer, p.vendor, "
            "p.country_of_origin, p.hs_code, p.og_image_url, "
            "p.requires_shipping, p.ships_internationally, p.shipping_class, p.lead_time_days, "
            "p.continue_selling_oos, p.moq, p.order_increment, p.low_stock_threshold, "
            "p.is_pre_order, p.pre_order_release_at, p.tax_category_id, "
            "p.sale_type, p.sale_value, p.sale_starts_at, p.sale_ends_at, "
            "tc.name AS tax_category_name, tc.rate AS tax_rate "
            "FROM products p "
            "LEFT JOIN product_categories c ON c.id = p.category_id "
            "LEFT JOIN product_tax_categories tc ON tc.id = p.tax_category_id "
            "WHERE p.id = %s AND p.project_id = %s "
            "  AND COALESCE(p.is_archived, FALSE) = FALSE "
            "  AND COALESCE(p.is_paused, FALSE) = FALSE",
            (product_id, project_id)
        )
        product = cursor.fetchone()
        if not product: raise HTTPException(404, "Product not found")

        cursor.execute(
            # Honour CRM drag-and-drop ordering via the `position` column.
            "SELECT id, product_id, variation_name, images, price, stock_quantity, sold_quantity, "
            "       sale_type, sale_value, sale_starts_at, sale_ends_at "
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
                f"SELECT id, product_id, variation_id, configuration_name, price, stock_quantity, sold_quantity, position, "
                f"       sku_code, barcode, compare_at_price, cost_price, sale_price, sale_starts_at, sale_ends_at,"
                f"       weight_g, length_cm, width_cm, height_cm "
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
                # Phase 1: skip placeholder rows (empty value) — they're seed
                # suggestions rendered in CRM only; storefront never sees blanks.
                if not (row.get("spec_value") or "").strip():
                    continue
                layer_v = row.get("layer") or 1
                parent_id = row.get("parent_id") if row.get("parent_id") is not None else row.get("variation_id")
                specifications_by_node.setdefault((layer_v, parent_id), []).append({
                    "key":   row["spec_key"],
                    "value": row["spec_value"],
                })

        cursor.execute(
            "SELECT pr.id, pr.user_id, pr.rating, pr.comment, pr.created_at, "
            "       pr.merchant_reply, pr.merchant_reply_at, u.name AS user_name "
            "FROM product_reviews pr JOIN users u ON pr.user_id = u.id AND u.project_id = %s "
            "WHERE pr.product_id = %s AND pr.project_id = %s ORDER BY pr.created_at DESC",
            (project_id, product_id, project_id)
        )
        reviews_raw = cursor.fetchall()
        # Phase 3: bulk-fetch photos + vote tallies for these reviews (avoids N+1).
        rids = [r["id"] for r in reviews_raw]
        photos_by_review = {}
        votes_by_review  = {}
        if rids:
            cursor.execute(
                "SELECT review_id, url, position FROM product_review_photos"
                " WHERE review_id = ANY(%s) ORDER BY position ASC, id ASC",
                (rids,)
            )
            for ph in cursor.fetchall():
                photos_by_review.setdefault(ph["review_id"], []).append(ph["url"])
            cursor.execute(
                "SELECT review_id,"
                "       SUM(CASE WHEN is_helpful THEN 1 ELSE 0 END) AS helpful,"
                "       SUM(CASE WHEN is_helpful THEN 0 ELSE 1 END) AS unhelpful"
                "  FROM product_review_votes WHERE review_id = ANY(%s)"
                " GROUP BY review_id",
                (rids,)
            )
            for v in cursor.fetchall():
                votes_by_review[v["review_id"]] = {
                    "helpful":   int(v["helpful"]   or 0),
                    "unhelpful": int(v["unhelpful"] or 0),
                }
        # Attach to each review row for downstream payload assembly.
        for r in reviews_raw:
            r["photos"]       = photos_by_review.get(r["id"], [])
            v                 = votes_by_review.get(r["id"], {"helpful": 0, "unhelpful": 0})
            r["helpful_count"]   = v["helpful"]
            r["unhelpful_count"] = v["unhelpful"]

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

    # Group L2 rows by their L1 parent for the assembler.
    cfg_by_variation_id = {}
    for c in configurations:
        cfg_by_variation_id.setdefault(c["variation_id"], []).append(c)

    modifier_groups = _fetch_modifier_groups_for_products([product_id]).get(product_id, [])
    tier_pricing_by_sku = _fetch_tier_pricing([c["id"] for c in configurations])

    return _assemble_product_payload(
        product,
        variations=variations,
        cfg_by_variation_id=cfg_by_variation_id,
        layer3_by_parent=layer3_by_parent,
        layer4_by_parent=layer4_by_parent,
        layer5_by_parent=layer5_by_parent,
        specifications_by_node=specifications_by_node,
        cart_map=cart_map,
        is_favorite=is_favorite, can_review=can_review,
        custom_fields=custom_fields, reviews_raw=reviews_raw,
        user_id=user_id,
        modifier_groups=modifier_groups,
        tier_pricing_by_sku=tier_pricing_by_sku,
    )


# ── КОРЗИНА ──────────────────────────────────────────────

# ── Tier pricing helper ─────────────────────────────────────────────
def _resolve_unit_price(cursor, sku_id, base_price, quantity):
    """Apply tier pricing (highest min_qty ≤ quantity); base_price if no tier matches."""
    cursor.execute(
        "SELECT min_qty, price FROM product_tier_pricing"
        " WHERE sku_id=%s AND min_qty<=%s ORDER BY min_qty DESC LIMIT 1",
        (sku_id, max(1, int(quantity)))
    )
    row = cursor.fetchone()
    if row and row.get("price") is not None:
        return float(row["price"])
    return float(base_price or 0)


def _resolve_sku_sale_walkup(cursor, sku_id, now):
    """Walk-up sale resolver for a SKU: L2 → L1 → product. Pricing: base → tier → sale → modifiers."""
    cursor.execute(
        "SELECT c.sale_type AS c_st, c.sale_value AS c_sv,"
        "       c.sale_starts_at AS c_ss, c.sale_ends_at AS c_se,"
        "       c.sale_price AS c_sp,"
        "       v.sale_type AS v_st, v.sale_value AS v_sv,"
        "       v.sale_starts_at AS v_ss, v.sale_ends_at AS v_se,"
        "       p.sale_type AS p_st, p.sale_value AS p_sv,"
        "       p.sale_starts_at AS p_ss, p.sale_ends_at AS p_se"
        "  FROM product_configurations_l2 c"
        "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
        "  JOIN products p ON v.product_id = p.id"
        " WHERE c.id = %s",
        (sku_id,)
    )
    row = cursor.fetchone() or {}
    l2_sale  = (row.get("c_st"), row.get("c_sv"), row.get("c_ss"), row.get("c_se"))
    # Legacy l2.sale_price fallback when new sale_type/value haven't been set.
    if not l2_sale[0] and row.get("c_sp") is not None:
        l2_sale = ('fixed', float(row["c_sp"]), row.get("c_ss"), row.get("c_se"))
    var_sale = (row.get("v_st"), row.get("v_sv"), row.get("v_ss"), row.get("v_se"))
    prod_sale= (row.get("p_st"), row.get("p_sv"), row.get("p_ss"), row.get("p_se"))
    return _resolve_active_sale(now, l2_sale, var_sale, prod_sale)


# Stock reservation TTL: window during which a cart line soft-locks the SKU for the buyer.
RESERVATION_TTL_MINUTES = 15

def _release_expired_reservations(cursor):
    """Free reservations older than TTL_MINUTES (called opportunistically); returns rows freed."""
    cursor.execute(
        "UPDATE cart_items SET reserved_until = NULL"
        " WHERE reserved_until IS NOT NULL AND reserved_until < NOW()"
    )
    return cursor.rowcount

def _available_stock(cursor, sku_id, exclude_cart_id=None):
    """Returns (stock_quantity, available) where available = stock - reserved on OTHER carts."""
    cursor.execute("SELECT stock_quantity FROM product_configurations_l2 WHERE id=%s", (sku_id,))
    row = cursor.fetchone()
    if not row: return 0, 0
    total = int(row["stock_quantity"] or 0)
    cursor.execute(
        "SELECT COALESCE(SUM(quantity), 0) AS reserved"
        "  FROM cart_items"
        " WHERE configuration_id=%s"
        "   AND reserved_until IS NOT NULL AND reserved_until > NOW()"
        + ("   AND cart_id <> %s" if exclude_cart_id else ""),
        (sku_id, exclude_cart_id) if exclude_cart_id else (sku_id,)
    )
    reserved = int(cursor.fetchone()["reserved"] or 0)
    return total, max(0, total - reserved)


@app.post("/{api_key}/cart/add")
def add_to_cart(item: AddToCart, request: Request,
                api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    # Validate product belongs + fetch flags relevant to inventory checks.
    product_row = db_one(
        "SELECT id, continue_selling_oos, moq, order_increment, is_paused, is_archived"
        "  FROM products WHERE id=%s AND project_id=%s",
        (item.product_id, project_id)
    )
    if not product_row: raise HTTPException(403, "Product not in this store")
    if product_row.get("is_paused") or product_row.get("is_archived"):
        raise HTTPException(403, "Product not currently for sale")
    # IDOR guard: variation_id MUST belong to product, configuration_id MUST belong to variation.
    # Without this, place_order's per-WH stock writes would mutate another store's counters.
    if not db_one(
        "SELECT 1 FROM product_configurations_l1 v"
        "  JOIN product_configurations_l2 c ON c.variation_id = v.id"
        " WHERE v.product_id=%s AND v.id=%s AND c.id=%s",
        (item.product_id, item.variation_id, item.configuration_id)
    ):
        raise HTTPException(404, "Variation / configuration not found for this product")
    # DOS guard: hard cap to keep cart sums + reservation math sane.
    if item.quantity > 10000:
        raise HTTPException(400, "Quantity per line is capped at 10000")
    # Phase 8 — B2B validation: MOQ + order increment.
    moq = int(product_row.get("moq") or 1)
    inc = int(product_row.get("order_increment") or 1)
    if item.quantity < moq:
        raise HTTPException(400, f"Minimum order quantity is {moq}")
    if inc > 1 and (item.quantity - moq) % inc != 0:
        raise HTTPException(400, f"Quantity must be {moq} or {moq}+{inc}, {moq}+{2*inc}, ...")
    # Validate selected modifier ids belong to this product and respect group rules.
    sel_ids, _ = _validate_modifier_selection(item.product_id, item.selected_modifier_item_ids)
    sel_ids_sorted = sorted(sel_ids)

    with db_cursor() as (conn, cursor):
        # Step 1: opportunistic cleanup of expired reservations — keeps the
        # available_stock calculation accurate without a separate cron job.
        _release_expired_reservations(cursor)

        cursor.execute("SELECT id FROM carts WHERE user_id = %s AND project_id = %s", (user_id, project_id))
        cart = cursor.fetchone()
        if not cart:
            cursor.execute("INSERT INTO carts (user_id, project_id) VALUES (%s,%s) RETURNING id", (user_id, project_id))
            cart_id = cursor.fetchone()["id"]
            conn.commit()
        else:
            cart_id = cart["id"]

        # Step 2: enforce stock availability EXCEPT when continue_selling_oos
        # is set on the product (made-to-order or backorder allowed).
        if not product_row.get("continue_selling_oos"):
            total, avail = _available_stock(cursor, item.configuration_id, exclude_cart_id=cart_id)
            if avail < item.quantity:
                raise HTTPException(400, f"Only {avail} item(s) available right now (others reserved by active checkouts)")

        # Merge with existing line ONLY if modifier selection matches exactly (sorted comparison).
        cursor.execute(
            "SELECT id, quantity, selected_modifier_item_ids FROM cart_items"
            " WHERE cart_id=%s AND product_id=%s AND variation_id=%s AND configuration_id=%s",
            (cart_id, item.product_id, item.variation_id, item.configuration_id)
        )
        existing = None
        for row in cursor.fetchall():
            if sorted(row["selected_modifier_item_ids"] or []) == sel_ids_sorted:
                existing = row
                break

        # Reservation window: (NOW() + RESERVATION_TTL_MINUTES). Every add_to_cart
        # extends the timer so an active shopper doesn't lose their hold mid-checkout.
        if existing:
            cursor.execute(
                "UPDATE cart_items SET quantity=%s,"
                "       reserved_until = NOW() + INTERVAL '%s minutes' WHERE id=%s",
                (existing["quantity"] + item.quantity, RESERVATION_TTL_MINUTES, existing["id"])
            )
        else:
            cursor.execute(
                "INSERT INTO cart_items"
                "  (cart_id, product_id, variation_id, configuration_id, quantity,"
                "   selected_modifier_item_ids, reserved_until)"
                " VALUES (%s,%s,%s,%s,%s,%s, NOW() + INTERVAL '%s minutes')",
                (cart_id, item.product_id, item.variation_id, item.configuration_id,
                 item.quantity, sel_ids_sorted, RESERVATION_TTL_MINUTES)
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
            "SELECT ci.id, ci.product_id, ci.configuration_id FROM cart_items ci JOIN carts c ON ci.cart_id=c.id "
            "WHERE ci.id=%s AND c.user_id=%s AND c.project_id=%s",
            (cart_item_id, user_id, api_key_record["id"])
        )
        item = cursor.fetchone()
        if not item: raise HTTPException(404, "Cart item not found")
        cursor.execute("SELECT stock_quantity FROM product_configurations_l2 WHERE id=%s", (item["configuration_id"],))
        cfg = cursor.fetchone()
        if cfg and data.quantity > cfg["stock_quantity"]:
            raise HTTPException(400, f"Only {cfg['stock_quantity']} items in stock")
        # Optional modifier-set replacement (when client sends selected_modifier_item_ids).
        # Absent = quantity-only edit.
        if data.selected_modifier_item_ids is not None:
            sel_ids, _ = _validate_modifier_selection(item["product_id"], data.selected_modifier_item_ids)
            cursor.execute(
                "UPDATE cart_items SET quantity=%s, selected_modifier_item_ids=%s WHERE id=%s",
                (data.quantity, sorted(sel_ids), cart_item_id)
            )
        else:
            cursor.execute("UPDATE cart_items SET quantity=%s WHERE id=%s",
                           (data.quantity, cart_item_id))
        conn.commit()
    return {"success": True}


@app.get("/{api_key}/cart", response_model=CartPageResponse)
def get_cart(request: Request, api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)

    with db_cursor() as (_, cursor):
        # Phase 2: opportunistic cleanup of expired reservations on every cart load.
        _release_expired_reservations(cursor)
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
            "ci.selected_modifier_item_ids, "
            "p.title, p.subtitle, p.product_type, pc.price, pc.configuration_name, pv.variation_name, "
            "(pv.images)[1] AS image_url "
            "FROM cart_items ci JOIN products p ON ci.product_id=p.id "
            "LEFT JOIN product_configurations_l1 pv ON ci.variation_id=pv.id "
            "LEFT JOIN product_configurations_l2 pc ON ci.configuration_id=pc.id "
            "WHERE ci.cart_id=%s",
            (cart["id"],)
        )
        rows = cursor.fetchall()

        # Bulk-fetch all modifier item snapshots referenced by any cart line — single query.
        all_mod_ids = {mid for r in rows for mid in (r["selected_modifier_item_ids"] or [])}
        mod_meta = {}
        if all_mod_ids:
            cursor.execute(
                "SELECT i.id, i.name, i.price_delta, i.group_id, g.name AS group_name"
                "  FROM product_modifier_items i"
                "  JOIN product_modifier_groups g ON i.group_id = g.id"
                " WHERE i.id = ANY(%s)",
                (list(all_mod_ids),)
            )
            for m in cursor.fetchall():
                mod_meta[m["id"]] = {
                    "id":          m["id"],
                    "name":        m["name"],
                    "price_delta": float(m["price_delta"] or 0),
                    "group_id":    m["group_id"],
                    "group_name":  m["group_name"],
                }

    # Pricing layer for each cart line: base → tier → sale → modifiers.
    # All resolved in a single helper cursor so we don't N+1 over rows.
    from datetime import timezone as _tz
    _cart_now = datetime.now(_tz.utc)
    line_pricing = {}  # cart_item_id → { tier_price, after_sale, on_sale }
    if rows:
        with db_cursor() as (_, c2):
            for r in rows:
                sku_id   = r.get("configuration_id")
                sku_base = float(r["price"] or 0)
                if not sku_id:
                    line_pricing[r["cart_item_id"]] = (sku_base, sku_base, False)
                    continue
                tier   = _resolve_unit_price(c2, sku_id, sku_base, r["quantity"])
                after  = tier
                on_sl  = False
                st, sv, _, _ = _resolve_sku_sale_walkup(c2, sku_id, _cart_now)
                if st:
                    after = _apply_sale(tier, st, sv)
                    on_sl = True
                line_pricing[r["cart_item_id"]] = (tier, after, on_sl)

    items = []; subtotal = 0.0
    for row in rows:
        mods = [mod_meta[mid] for mid in (row["selected_modifier_item_ids"] or []) if mid in mod_meta]
        mods_total = sum(m["price_delta"] for m in mods)
        sku_base   = float(row["price"] or 0)
        tier_unit, after_sale, on_sale = line_pricing.get(row["cart_item_id"], (sku_base, sku_base, False))
        line_unit  = after_sale + mods_total
        subtotal  += line_unit * row["quantity"]
        items.append({
            **row,
            "price":            line_unit,                                            # unit (tier + sale + mods)
            "base_price":       sku_base,                                             # raw SKU price
            "tier_price":       tier_unit if tier_unit < sku_base else None,          # set when tier kicked in
            "compare_at_price": sku_base if (on_sale or tier_unit < sku_base) else None,  # for strikethrough
            "on_sale":          on_sale,
            "modifiers":        mods,
            "product_hash":     hashids.encode(row["product_id"]),
            "is_favorite":      row["product_id"] in favorites_set,
        })

    # Digital-only carts skip shipping (no physical address required).
    requires_shipping = any(it.get("product_type") in (None, "physical") for it in items)
    final_shipping    = 0.0 if (subtotal >= free_threshold or not requires_shipping) else shipping_cost
    shipping_progress = min((subtotal / free_threshold) * 100, 100) if free_threshold > 0 else 100
    amount_to_free    = max(free_threshold - subtotal, 0)

    return {
        "items": items, "favorites_ids": favorites_ids,
        "subtotal": round(subtotal, 2), "shipping_cost": round(final_shipping, 2),
        "free_shipping_threshold": free_threshold,
        "amount_to_free_shipping": round(amount_to_free, 2),
        "shipping_progress": round(shipping_progress, 2),
        "total": round(subtotal + final_shipping, 2),
        "requires_shipping": requires_shipping,
    }


# ── ИЗБРАННОЕ ────────────────────────────────────────────

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


# ── ОТЗЫВЫ ───────────────────────────────────────────────

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


# ── ОТЗЫВЫ — Phase 3 enhancements: photos, votes ────────────

class AttachReviewPhoto(BaseModel):
    review_id: int
    url: str

@app.post("/{api_key}/reviews/photos")
def attach_review_photo(data: AttachReviewPhoto, request: Request,
                         api_key_record: dict = Depends(resolve_api_key)):
    """Attach S3 photo URL to user's own review (rejects external URLs via _is_safe_media_url)."""
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    review = db_one(
        "SELECT id, user_id FROM product_reviews WHERE id=%s AND project_id=%s",
        (data.review_id, project_id)
    )
    if not review:                  raise HTTPException(404, "Review not found")
    if review["user_id"] != user_id: raise HTTPException(403, "Not authorized")
    if not _is_safe_media_url(data.url):
        raise HTTPException(400, "Photo URL must be from this storefront's S3 bucket")
    # Cross-project info-disclosure guard: the URL must point at THIS project's S3 prefix.
    if f"/projects/{project_id}/" not in data.url:
        raise HTTPException(400, "Photo URL must be in this project's S3 prefix")
    with db_cursor() as (conn, cursor):
        # Cap at 5 photos per review (typical product page limit).
        cursor.execute("SELECT COUNT(*) AS n FROM product_review_photos WHERE review_id=%s", (data.review_id,))
        if int(cursor.fetchone()["n"]) >= 5:
            raise HTTPException(400, "Max 5 photos per review")
        cursor.execute("SELECT COALESCE(MAX(position), -1)+1 AS p FROM product_review_photos WHERE review_id=%s",
                       (data.review_id,))
        pos = cursor.fetchone()["p"]
        cursor.execute(
            "INSERT INTO product_review_photos (review_id, url, position)"
            " VALUES (%s, %s, %s) RETURNING id",
            (data.review_id, data.url, pos)
        )
        new_id = cursor.fetchone()["id"]
        conn.commit()
    return {"id": new_id, "url": data.url, "position": pos}


@app.delete("/{api_key}/reviews/photos/{photo_id}")
def delete_review_photo(photo_id: int, request: Request,
                         api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    row = db_one(
        "SELECT p.id, p.url, r.user_id"
        "  FROM product_review_photos p JOIN product_reviews r ON p.review_id = r.id"
        " WHERE p.id=%s AND r.project_id=%s",
        (photo_id, project_id)
    )
    if not row:                  raise HTTPException(404, "Photo not found")
    if row["user_id"] != user_id: raise HTTPException(403, "Not authorized")
    with db_cursor() as (conn, cursor):
        cursor.execute("DELETE FROM product_review_photos WHERE id=%s", (photo_id,))
        conn.commit()
    s3_delete_url(row["url"], f"projects/{project_id}/reviews/")  # best-effort
    return {"success": True}


class VoteReview(BaseModel):
    review_id: int
    is_helpful: bool

@app.post("/{api_key}/reviews/vote")
def vote_review(data: VoteReview, request: Request,
                 api_key_record: dict = Depends(resolve_api_key)):
    """Cast/change a helpful vote on another user's review (one user = one vote per review)."""
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    review = db_one(
        "SELECT id, user_id FROM product_reviews WHERE id=%s AND project_id=%s",
        (data.review_id, project_id)
    )
    if not review: raise HTTPException(404, "Review not found")
    if review["user_id"] == user_id:
        raise HTTPException(400, "Cannot vote on your own review")
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "INSERT INTO product_review_votes (review_id, user_id, is_helpful)"
            " VALUES (%s, %s, %s)"
            " ON CONFLICT (review_id, user_id)"
            " DO UPDATE SET is_helpful = EXCLUDED.is_helpful",
            (data.review_id, user_id, bool(data.is_helpful))
        )
        conn.commit()
    return {"success": True}


@app.delete("/{api_key}/reviews/vote/{review_id}")
def unvote_review(review_id: int, request: Request,
                   api_key_record: dict = Depends(resolve_api_key)):
    user_id = get_current_user_id(request)
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "DELETE FROM product_review_votes WHERE review_id=%s AND user_id=%s",
            (review_id, user_id)
        )
        conn.commit()
    return {"success": True}


# ── Q&A ─────────────────────────────────────────────────────

class AskQuestion(BaseModel):
    product_id: int
    question: str

@app.post("/{api_key}/questions")
def post_question(data: AskQuestion, request: Request,
                   api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s",
                  (data.product_id, project_id)):
        raise HTTPException(403, "Product not in this store")
    q = sanitize(data.question.strip())[:1000]
    if not q: raise HTTPException(400, "Question cannot be empty")
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "INSERT INTO product_questions (project_id, product_id, user_id, question)"
            " VALUES (%s, %s, %s, %s) RETURNING id",
            (project_id, data.product_id, user_id, q)
        )
        new_id = cursor.fetchone()["id"]
        conn.commit()
    return {"id": new_id}


# ── Restock waitlist ────────────────────────────────────────

class RequestReturnItem(BaseModel):
    order_item_id: int
    quantity: int = 1

class RequestReturnBody(BaseModel):
    reason: str = "other"
    customer_message: str = ""
    items: List[RequestReturnItem]
    customer_photos: List[str] = []

class RestockSubscription(BaseModel):
    product_id: int
    sku_id: Optional[int] = None
    email: Optional[str] = None      # required when not authenticated

@app.post("/{api_key}/restock/subscribe")
def subscribe_restock(data: RestockSubscription, request: Request,
                       api_key_record: dict = Depends(resolve_api_key)):
    """Add visitor (anon or logged in) to restock waitlist; dedupes on (product_id, sku_id, email)."""
    project_id = api_key_record["id"]
    user_id = try_get_current_user_id(request)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s",
                  (data.product_id, project_id)):
        raise HTTPException(403, "Product not in this store")
    # IDOR guard: when sku_id is supplied, verify it belongs to this product.
    if data.sku_id is not None:
        if not db_one(
            "SELECT 1 FROM product_configurations_l2 c"
            "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
            " WHERE c.id=%s AND v.product_id=%s",
            (data.sku_id, data.product_id)
        ):
            raise HTTPException(404, "SKU not found for this product")
    email = (data.email or '').strip().lower()
    if user_id and not email:
        # Logged-in users — pull email from users table.
        u = db_one("SELECT email FROM users WHERE id=%s", (user_id,))
        if u: email = (u.get("email") or '').strip().lower()
    if not email or '@' not in email:
        raise HTTPException(400, "Email is required")
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "SELECT id FROM product_restock_subscriptions"
            " WHERE product_id=%s AND COALESCE(sku_id, 0)=COALESCE(%s, 0)"
            "   AND email=%s AND notified_at IS NULL",
            (data.product_id, data.sku_id, email)
        )
        if cursor.fetchone():
            return {"success": True, "deduped": True}
        cursor.execute(
            "INSERT INTO product_restock_subscriptions"
            "  (project_id, product_id, sku_id, email, user_id)"
            " VALUES (%s, %s, %s, %s, %s)",
            (project_id, data.product_id, data.sku_id, email, user_id)
        )
        conn.commit()
    return {"success": True}


# ── ПРОМОКОДЫ ────────────────────────────────────────────

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

        # Phase 1 — per-user usage limit (anonymous users can't be tracked, so
        # per_user_limit only applies to authenticated checkouts).
        per_user = promo.get("per_user_limit")
        if per_user is not None:
            user_id_for_check = try_get_current_user_id(request)
            if user_id_for_check:
                cursor.execute(
                    "SELECT COUNT(*) AS n FROM promo_code_uses WHERE promo_id=%s AND user_id=%s",
                    (promo["id"], user_id_for_check)
                )
                used_by_user = int((cursor.fetchone() or {}).get("n") or 0)
                if used_by_user >= int(per_user):
                    raise HTTPException(400, f"You've already used this code {used_by_user} time(s) — limit reached")

        # Phase 1 — category restriction: if category_ids set, every cart item must belong to one.
        cat_ids = list(promo.get("category_ids") or [])
        if cat_ids:
            cursor.execute(
                "SELECT DISTINCT p.category_id FROM cart_items ci"
                "  JOIN products p ON ci.product_id = p.id"
                " WHERE ci.cart_id=%s",
                (cart["id"],)
            )
            cart_cat_ids = {r["category_id"] for r in cursor.fetchall()}
            # Cart must have NO uncovered categories AND no NULL-category items.
            if None in cart_cat_ids or not cart_cat_ids.issubset(set(cat_ids)):
                raise HTTPException(400, "This code only applies to specific categories — your cart has items outside that scope")

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


# ── ЗАКАЗЫ ───────────────────────────────────────────────

# Variant A — direct merchant payment. CRM never touches money.
# Storefront flow:
#   1. POST /{api_key}/orders/init-payment → creates provider PaymentIntent, returns client_secret/redirect_url
#   2. Customer pays on provider side (Stripe.js / Stripe Checkout / YooKassa redirect / etc.)
#   3. POST /{api_key}/orders {payment_intent_id} → backend re-verifies intent status with provider,
#      validates amount matches current cart, creates the order. STRICT — if provider rejects, no order.
#   4. Provider webhook → POST /{api_key}/webhooks/{provider} → independent confirmation +
#      handles late events (refunds initiated from provider dashboard, disputes, etc.)
# ── Inlined: payment_crypto (shared with CRM; same Fernet key in .env) ──

import json
import os
from typing import Any

from cryptography.fernet import Fernet, InvalidToken


_ENV_KEY = "PAYMENT_ENCRYPTION_KEY"


def _load_fernet() -> Fernet | None:
    raw = os.getenv(_ENV_KEY, "").strip()
    if not raw:
        return None
    try:
        return Fernet(raw.encode())
    except (ValueError, TypeError):
        return None


def is_encryption_configured() -> bool:
    """True if the master key is set and valid (use in /health checks)."""
    return _load_fernet() is not None


def encrypt_credentials(data: dict[str, Any]) -> str:
    """Serialize a credentials dict to JSON, encrypt with Fernet, return as str.

    Raises RuntimeError if PAYMENT_ENCRYPTION_KEY is missing or malformed —
    never silently store plaintext.
    """
    f = _load_fernet()
    if f is None:
        raise RuntimeError(
            f"{_ENV_KEY} is not configured. Set it in the backend .env "
            "(generate via: python -c 'from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())')"
        )
    if not isinstance(data, dict):
        raise TypeError("encrypt_credentials expects a dict")
    raw = json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return f.encrypt(raw).decode("ascii")


def decrypt_credentials(token: str) -> dict[str, Any]:
    """Decrypt a Fernet token and parse the JSON payload.

    Raises RuntimeError if the key is unset.
    Raises ValueError if the token is malformed, tampered with, or not the
    expected JSON shape — callers should treat that as a credential being broken.
    """
    f = _load_fernet()
    if f is None:
        raise RuntimeError(f"{_ENV_KEY} is not configured")
    if not token:
        return {}
    try:
        raw = f.decrypt(token.encode("ascii"))
    except (InvalidToken, ValueError) as e:
        raise ValueError(f"Credentials decryption failed: {e}") from e
    try:
        out = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Decrypted payload is not JSON: {e}") from e
    if not isinstance(out, dict):
        raise ValueError("Decrypted payload is not a dict")
    return out


def mask_secret(value: str | None, keep: int = 4) -> str:
    """Returns "••••••••1234" — only last `keep` chars exposed.

    Use anywhere a secret would otherwise be in an API response.
    Never includes the original value in the masked form's length.
    """
    if not value:
        return ""
    s = str(value)
    if len(s) <= keep:
        return "•" * len(s)
    return "•" * 8 + s[-keep:]

# ── Inlined: payment_providers (External-side: create_intent + webhook handling) ──

import base64
import hashlib
import hmac
import ipaddress
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


PROVIDER_FIELDS: dict[str, list[dict]] = {
    "stripe": [
        {"key": "publishable_key", "secret": False, "required": True},
        {"key": "secret_key",      "secret": True,  "required": True},
        {"key": "webhook_secret",  "secret": True,  "required": False},
    ],
    "tinkoff": [
        {"key": "terminal_key", "secret": False, "required": True},
        {"key": "password",     "secret": True,  "required": True},
    ],
    "cloudpayments": [
        {"key": "public_id",  "secret": False, "required": True},
        {"key": "api_secret", "secret": True,  "required": True},
    ],
    "yookassa": [
        {"key": "shop_id",    "secret": False, "required": True},
        {"key": "secret_key", "secret": True,  "required": True},
    ],
    "paypal": [
        {"key": "client_id",     "secret": False, "required": True},
        {"key": "client_secret", "secret": True,  "required": True},
        {"key": "webhook_id",    "secret": False, "required": False},
    ],
    "adyen": [
        {"key": "api_key",          "secret": True,  "required": True},
        {"key": "merchant_account", "secret": False, "required": True},
        {"key": "client_key",       "secret": False, "required": False},
        {"key": "hmac_key",         "secret": True,  "required": False},
    ],
    "braintree": [
        {"key": "merchant_id", "secret": False, "required": True},
        {"key": "public_key",  "secret": False, "required": True},
        {"key": "private_key", "secret": True,  "required": True},
    ],
    "square": [
        {"key": "access_token",          "secret": True,  "required": True},
        {"key": "application_id",        "secret": False, "required": True},
        {"key": "location_id",           "secret": False, "required": True},
        {"key": "webhook_signature_key", "secret": True,  "required": False},
    ],
    "mollie": [
        {"key": "api_key", "secret": True, "required": True},
    ],
    "razorpay": [
        {"key": "key_id",         "secret": False, "required": True},
        {"key": "key_secret",     "secret": True,  "required": True},
        {"key": "webhook_secret", "secret": True,  "required": False},
    ],
    "paddle": [
        {"key": "api_key",        "secret": True, "required": True},
        {"key": "webhook_secret", "secret": True, "required": False},
    ],
    "paybox": [
        {"key": "merchant_id", "secret": False, "required": True},
        {"key": "secret_key",  "secret": True,  "required": True},
    ],
    "manual": [],
    "other":  [],
}


_TIMEOUT = 15
_WEBHOOK_REPLAY_TOLERANCE = 5 * 60   # 5 minutes


def _ok(data: dict, raw: dict | None = None) -> dict:
    return {"ok": True, "data": data, "error": "", "raw": raw or {}}


def _err(message: str, raw: dict | None = None) -> dict:
    return {"ok": False, "data": {}, "error": message, "raw": raw or {}}


def _http_request(method: str, url: str, *, headers: dict | None = None,
                   body: bytes | None = None, basic_auth: tuple[str, str] | None = None,
                   bearer: str | None = None) -> dict:
    req = urllib.request.Request(url, method=method, data=body)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if basic_auth:
        token = base64.b64encode(f"{basic_auth[0]}:{basic_auth[1]}".encode()).decode("ascii")
        req.add_header("Authorization", f"Basic {token}")
    if bearer:
        req.add_header("Authorization", f"Bearer {bearer}")
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed: Any = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = raw
            return {"status": resp.status, "body": parsed}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = raw
        return {"status": e.code, "body": parsed}
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        return {"status": 0, "body": {"error": str(e)}}


# ── Stripe ─────────────────────────────────────────────────────────────────

_STRIPE_BASE = "https://api.stripe.com/v1"


def stripe_create_intent(creds: dict, amount_cents: int, currency: str,
                          *, order_metadata: dict, idempotency_key: str,
                          stripe_account_id: str = "") -> dict:
    sk = creds.get("secret_key", "").strip()
    if not sk:
        return _err("Missing secret_key")
    payload = {
        "amount":   str(amount_cents),
        "currency": currency.lower(),
        "automatic_payment_methods[enabled]": "true",
    }
    for k, v in order_metadata.items():
        payload[f"metadata[{k}]"] = str(v)[:500]
    body = urllib.parse.urlencode(payload).encode("utf-8")
    headers = {"Content-Type": "application/x-www-form-urlencoded",
               "Idempotency-Key": idempotency_key}
    if stripe_account_id:
        headers["Stripe-Account"] = stripe_account_id
    r = _http_request("POST", f"{_STRIPE_BASE}/payment_intents",
                       headers=headers, body=body, bearer=sk)
    if r["status"] == 200 and isinstance(r["body"], dict):
        return _ok({
            "intent_id":     r["body"].get("id", ""),
            "client_secret": r["body"].get("client_secret", ""),
            "status":        r["body"].get("status", ""),
            "publishable_key": creds.get("publishable_key", ""),
        }, r["body"])
    msg = (r["body"] or {}).get("error", {}).get("message", "") if isinstance(r["body"], dict) else ""
    return _err(msg or f"Stripe intent failed (HTTP {r['status']})",
                r["body"] if isinstance(r["body"], dict) else {})


def stripe_get_intent(creds: dict, intent_id: str, stripe_account_id: str = "") -> dict:
    sk = creds.get("secret_key", "").strip()
    if not sk:
        return _err("Missing secret_key")
    headers: dict = {}
    if stripe_account_id:
        headers["Stripe-Account"] = stripe_account_id
    r = _http_request("GET", f"{_STRIPE_BASE}/payment_intents/{intent_id}",
                       headers=headers, bearer=sk)
    if r["status"] == 200 and isinstance(r["body"], dict):
        latest = r["body"].get("latest_charge", "") or ""
        return _ok({
            "intent_id":  r["body"].get("id", ""),
            "status":     r["body"].get("status", ""),
            "amount":     r["body"].get("amount", 0),
            "currency":   r["body"].get("currency", ""),
            "charge_id":  latest if isinstance(latest, str) else (latest.get("id", "") if isinstance(latest, dict) else ""),
            "metadata":   r["body"].get("metadata", {}) or {},
        }, r["body"])
    msg = (r["body"] or {}).get("error", {}).get("message", "") if isinstance(r["body"], dict) else ""
    return _err(msg or f"Stripe intent fetch failed (HTTP {r['status']})",
                r["body"] if isinstance(r["body"], dict) else {})


def stripe_verify_webhook(payload_bytes: bytes, signature_header: str,
                            webhook_secret: str,
                            tolerance: int = _WEBHOOK_REPLAY_TOLERANCE) -> tuple[bool, str]:
    """Validates Stripe-Signature header per
    https://stripe.com/docs/webhooks/signatures#verify-manually.
    Returns (valid, error_message)."""
    if not webhook_secret:
        return False, "Webhook secret not configured"
    if not signature_header:
        return False, "Missing Stripe-Signature header"
    parts = {}
    for kv in signature_header.split(","):
        if "=" in kv:
            k, v = kv.split("=", 1)
            parts.setdefault(k.strip(), []).append(v.strip())
    timestamp = (parts.get("t") or [""])[0]
    sigs      = parts.get("v1") or []
    if not timestamp or not sigs:
        return False, "Malformed signature header"
    try:
        ts = int(timestamp)
    except ValueError:
        return False, "Bad timestamp"
    # Replay protection: reject events older than tolerance
    if abs(time.time() - ts) > tolerance:
        return False, f"Timestamp outside tolerance ({tolerance}s)"
    signed_payload = f"{timestamp}.".encode() + payload_bytes
    expected = hmac.new(webhook_secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    if any(hmac.compare_digest(expected, s) for s in sigs):
        return True, ""
    return False, "Signature mismatch"


def stripe_parse_event(raw_body: bytes) -> dict:
    """Returns canonical event {type, intent_id, charge_id, status, amount, currency, event_id, raw_type}."""
    try:
        event = json.loads(raw_body.decode("utf-8"))
    except json.JSONDecodeError:
        return {"type": "unknown", "raw_type": "", "event_id": "", "intent_id": "",
                "charge_id": "", "status": "", "amount": 0, "currency": "", "metadata": {}, "raw": {}}
    obj = (event.get("data") or {}).get("object") or {}
    raw_type = event.get("type", "")
    canonical = "unknown"
    if raw_type == "payment_intent.succeeded":      canonical = "payment.succeeded"
    elif raw_type == "payment_intent.payment_failed": canonical = "payment.failed"
    elif raw_type == "charge.refunded":               canonical = "refund.succeeded"
    elif raw_type == "charge.refund.updated":         canonical = "refund.updated"
    elif raw_type == "charge.dispute.created":        canonical = "dispute.created"
    # intent_id may live on obj.id (for payment_intent events) or obj.payment_intent (for charge events)
    intent_id = obj.get("id", "") if raw_type.startswith("payment_intent.") else (obj.get("payment_intent") or "")
    return {
        "type":     canonical,
        "raw_type": raw_type,
        "event_id": event.get("id", ""),
        "intent_id": intent_id or "",
        "charge_id": obj.get("id", "") if raw_type.startswith("charge.") else (obj.get("latest_charge") or ""),
        "status":   obj.get("status", ""),
        "amount":   obj.get("amount", 0) or obj.get("amount_total", 0) or 0,
        "amount_refunded": obj.get("amount_refunded", 0) or 0,
        "currency": obj.get("currency", "") or "",
        "metadata": obj.get("metadata", {}) or {},
        "raw":      event,
    }


# ── Tinkoff ────────────────────────────────────────────────────────────────

_TINKOFF_BASE = "https://securepay.tinkoff.ru/v2"


def _tinkoff_sign(params: dict, password: str) -> str:
    items = {k: v for k, v in params.items() if not isinstance(v, (dict, list))}
    items["Password"] = password
    concat = "".join(str(items[k]) for k in sorted(items))
    return hashlib.sha256(concat.encode("utf-8")).hexdigest()


def tinkoff_create_intent(creds: dict, amount_kopecks: int, currency: str,
                            *, order_metadata: dict, idempotency_key: str) -> dict:
    tk = creds.get("terminal_key", "").strip()
    pw = creds.get("password", "").strip()
    if not tk or not pw:
        return _err("Missing terminal_key or password")
    payload = {
        "TerminalKey": tk,
        "Amount":      amount_kopecks,
        "OrderId":     str(order_metadata.get("order_pending_id") or idempotency_key),
        "Description": (order_metadata.get("description") or "")[:250],
    }
    payload = {k: v for k, v in payload.items() if v not in ("", None)}
    payload["Token"] = _tinkoff_sign(payload, pw)
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_TINKOFF_BASE}/Init",
                       headers={"Content-Type": "application/json"}, body=body)
    if r["status"] == 200 and isinstance(r["body"], dict) and r["body"].get("Success") is True:
        return _ok({
            "intent_id":     str(r["body"].get("PaymentId", "")),
            "client_secret": "",
            "redirect_url":  r["body"].get("PaymentURL", ""),
            "status":        r["body"].get("Status", ""),
        }, r["body"])
    msg = (r["body"] or {}).get("Message", "") if isinstance(r["body"], dict) else ""
    return _err(msg or f"Tinkoff Init failed (HTTP {r['status']})",
                r["body"] if isinstance(r["body"], dict) else {})


def tinkoff_get_intent(creds: dict, payment_id: str) -> dict:
    tk = creds.get("terminal_key", "").strip()
    pw = creds.get("password", "").strip()
    if not tk or not pw:
        return _err("Missing terminal_key or password")
    payload = {"TerminalKey": tk, "PaymentId": payment_id}
    payload["Token"] = _tinkoff_sign(payload, pw)
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_TINKOFF_BASE}/GetState",
                       headers={"Content-Type": "application/json"}, body=body)
    if r["status"] == 200 and isinstance(r["body"], dict) and r["body"].get("Success") is True:
        status = r["body"].get("Status", "")
        return _ok({
            "intent_id":  payment_id,
            "status":     status,
            "amount":     r["body"].get("Amount", 0),
            "currency":   "RUB",
            "charge_id":  payment_id,
            "metadata":   {},
        }, r["body"])
    msg = (r["body"] or {}).get("Message", "") if isinstance(r["body"], dict) else ""
    return _err(msg or f"Tinkoff GetState failed", r["body"] if isinstance(r["body"], dict) else {})


def tinkoff_verify_webhook(payload_bytes: bytes, password: str) -> tuple[bool, str]:
    """Tinkoff webhook body is JSON. The Token field in the body is the signature
    over all other top-level fields. We re-sign and compare."""
    try:
        body = json.loads(payload_bytes.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return False, "Malformed webhook body"
    token = body.pop("Token", "")
    if not token:
        return False, "Missing Token in body"
    expected = _tinkoff_sign(body, password)
    if hmac.compare_digest(token.lower(), expected.lower()):
        return True, ""
    return False, "Signature mismatch"


def tinkoff_parse_event(raw_body: bytes) -> dict:
    try:
        body = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"type": "unknown", "raw_type": "", "event_id": "", "intent_id": "",
                "charge_id": "", "status": "", "amount": 0, "currency": "RUB",
                "metadata": {}, "raw": {}}
    status = body.get("Status", "")
    canonical = "unknown"
    if status == "CONFIRMED": canonical = "payment.succeeded"
    elif status == "REJECTED": canonical = "payment.failed"
    elif status in ("REFUNDED", "PARTIAL_REFUNDED"): canonical = "refund.succeeded"
    return {
        "type":      canonical,
        "raw_type":  status,
        "event_id":  str(body.get("PaymentId", "")),  # Tinkoff has no event_id — PaymentId+Status is unique
        "intent_id": str(body.get("PaymentId", "")),
        "charge_id": str(body.get("PaymentId", "")),
        "status":    status,
        "amount":    body.get("Amount", 0),
        "currency":  "RUB",
        "metadata":  {"OrderId": body.get("OrderId", "")},
        "raw":       body,
    }


# ── CloudPayments ──────────────────────────────────────────────────────────

_CLOUDPAYMENTS_BASE = "https://api.cloudpayments.ru"


def cloudpayments_create_intent(creds: dict, amount: float, currency: str,
                                  *, order_metadata: dict, idempotency_key: str) -> dict:
    """CloudPayments uses widget-based checkout — merchant embeds widget on storefront
    with public_id, amount, etc. We don't pre-create an intent server-side; instead
    we return the public_id and amount so the storefront can launch the widget."""
    pid = creds.get("public_id", "").strip()
    if not pid:
        return _err("Missing public_id")
    return _ok({
        "intent_id":     "cp_" + idempotency_key,
        "public_id":     pid,
        "amount":        round(float(amount) / 100.0, 2) if currency.upper() != "RUB" else round(float(amount), 2),
        "currency":      currency or "RUB",
        "invoice_id":    str(order_metadata.get("order_pending_id") or idempotency_key),
        "description":   order_metadata.get("description", ""),
    })


def cloudpayments_get_intent(creds: dict, transaction_id: str) -> dict:
    """POST /payments/get — fetches status by TransactionId."""
    pid = creds.get("public_id", "").strip()
    sec = creds.get("api_secret", "").strip()
    if not pid or not sec:
        return _err("Missing public_id or api_secret")
    body = json.dumps({"TransactionId": int(transaction_id)}).encode("utf-8")
    r = _http_request("POST", f"{_CLOUDPAYMENTS_BASE}/payments/get",
                       headers={"Content-Type": "application/json"},
                       body=body, basic_auth=(pid, sec))
    if r["status"] == 200 and isinstance(r["body"], dict) and r["body"].get("Success") is True:
        m = r["body"].get("Model") or {}
        return _ok({
            "intent_id":  str(m.get("TransactionId", "")),
            "status":     m.get("Status", ""),
            "amount":     m.get("Amount", 0),
            "currency":   m.get("Currency", "RUB"),
            "charge_id":  str(m.get("TransactionId", "")),
            "metadata":   {"InvoiceId": m.get("InvoiceId", "")},
        }, r["body"])
    return _err("CloudPayments status fetch failed", r["body"] if isinstance(r["body"], dict) else {})


def cloudpayments_verify_webhook(payload_bytes: bytes, signature_header: str,
                                   api_secret: str) -> tuple[bool, str]:
    """Header Content-HMAC = base64(HMAC-SHA256(body, api_secret))."""
    if not signature_header:
        return False, "Missing Content-HMAC header"
    expected = base64.b64encode(
        hmac.new(api_secret.encode(), payload_bytes, hashlib.sha256).digest()
    ).decode("ascii")
    if hmac.compare_digest(expected, signature_header):
        return True, ""
    return False, "Signature mismatch"


def cloudpayments_parse_event(raw_body: bytes) -> dict:
    """CloudPayments sends form-encoded notifications (Pay/Fail/Refund/Cancel/Receipt)."""
    parsed = urllib.parse.parse_qs(raw_body.decode("utf-8", errors="replace"))
    flat = {k: v[0] if v else "" for k, v in parsed.items()}
    status = flat.get("Status", "")
    operation = flat.get("OperationType", "")
    canonical = "unknown"
    if status == "Completed" and operation == "Payment": canonical = "payment.succeeded"
    elif status == "Declined": canonical = "payment.failed"
    elif operation == "Refund": canonical = "refund.succeeded"
    return {
        "type":      canonical,
        "raw_type":  f"{operation}.{status}",
        "event_id":  flat.get("TransactionId", ""),
        "intent_id": flat.get("TransactionId", ""),
        "charge_id": flat.get("TransactionId", ""),
        "status":    status,
        "amount":    float(flat.get("Amount", 0) or 0) * 100,
        "currency":  flat.get("Currency", "RUB"),
        "metadata":  {"InvoiceId": flat.get("InvoiceId", "")},
        "raw":       flat,
    }


# ── YooKassa ───────────────────────────────────────────────────────────────

_YOOKASSA_BASE = "https://api.yookassa.ru/v3"

# YooKassa sends webhooks from a fixed IP range. They don't sign webhooks.
# Source: https://yookassa.ru/developers/using-api/webhooks#ip
_YOOKASSA_IPS = [
    ipaddress.ip_network("185.71.76.0/27"),
    ipaddress.ip_network("185.71.77.0/27"),
    ipaddress.ip_network("77.75.153.0/25"),
    ipaddress.ip_network("77.75.154.128/25"),
    ipaddress.ip_network("2a02:5180::/32"),
]


def yookassa_create_intent(creds: dict, amount: float, currency: str,
                             *, order_metadata: dict, idempotency_key: str,
                             return_url: str = "") -> dict:
    shop = creds.get("shop_id", "").strip()
    sec  = creds.get("secret_key", "").strip()
    if not shop or not sec:
        return _err("Missing shop_id or secret_key")
    payload = {
        "amount":      {"value": f"{round(float(amount), 2):.2f}", "currency": currency or "RUB"},
        "capture":     True,
        "description": (order_metadata.get("description") or "")[:128],
        "metadata":    {k: str(v)[:255] for k, v in order_metadata.items()},
    }
    if return_url:
        payload["confirmation"] = {"type": "redirect", "return_url": return_url}
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_YOOKASSA_BASE}/payments",
                       headers={"Content-Type": "application/json",
                                "Idempotence-Key": idempotency_key},
                       body=body, basic_auth=(shop, sec))
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        confirm = r["body"].get("confirmation") or {}
        return _ok({
            "intent_id":    r["body"].get("id", ""),
            "redirect_url": confirm.get("confirmation_url", ""),
            "status":       r["body"].get("status", ""),
            "amount":       r["body"].get("amount", {}).get("value", "0"),
            "currency":     r["body"].get("amount", {}).get("currency", currency),
        }, r["body"])
    desc = (r["body"] or {}).get("description", "") if isinstance(r["body"], dict) else ""
    return _err(desc or f"YooKassa /payments failed", r["body"] if isinstance(r["body"], dict) else {})


def yookassa_get_intent(creds: dict, payment_id: str) -> dict:
    shop = creds.get("shop_id", "").strip()
    sec  = creds.get("secret_key", "").strip()
    if not shop or not sec:
        return _err("Missing shop_id or secret_key")
    r = _http_request("GET", f"{_YOOKASSA_BASE}/payments/{payment_id}",
                       basic_auth=(shop, sec))
    if r["status"] == 200 and isinstance(r["body"], dict):
        return _ok({
            "intent_id":  r["body"].get("id", ""),
            "status":     r["body"].get("status", ""),
            "amount":     r["body"].get("amount", {}).get("value", "0"),
            "currency":   r["body"].get("amount", {}).get("currency", ""),
            "charge_id":  r["body"].get("id", ""),
            "metadata":   r["body"].get("metadata", {}) or {},
        }, r["body"])
    return _err(f"YooKassa fetch failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def yookassa_verify_webhook(payload_bytes: bytes, signature_header: str,
                              source_ip: str) -> tuple[bool, str]:
    """YooKassa doesn't sign webhooks. Instead they whitelist IP.
    We accept events from the documented IP range only."""
    if not source_ip:
        return False, "Source IP unavailable"
    try:
        ip = ipaddress.ip_address(source_ip.split(",")[0].strip())
    except ValueError:
        return False, f"Invalid IP: {source_ip}"
    for net in _YOOKASSA_IPS:
        if ip in net:
            return True, ""
    return False, f"IP {ip} not in YooKassa whitelist"


def yookassa_parse_event(raw_body: bytes) -> dict:
    try:
        event = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"type": "unknown", "raw_type": "", "event_id": "", "intent_id": "",
                "charge_id": "", "status": "", "amount": 0, "currency": "RUB",
                "metadata": {}, "raw": {}}
    raw_type = event.get("event", "")
    obj = event.get("object") or {}
    canonical = "unknown"
    if raw_type == "payment.succeeded": canonical = "payment.succeeded"
    elif raw_type == "payment.canceled": canonical = "payment.failed"
    elif raw_type == "refund.succeeded": canonical = "refund.succeeded"
    return {
        "type":      canonical,
        "raw_type":  raw_type,
        # YooKassa has no event_id — use (payment_id + event_type) for idempotency
        "event_id":  f"{obj.get('id', '')}.{raw_type}",
        "intent_id": obj.get("id", "") if raw_type.startswith("payment.") else (obj.get("payment_id") or ""),
        "charge_id": obj.get("id", ""),
        "status":    obj.get("status", ""),
        "amount":    int(float(obj.get("amount", {}).get("value", 0) or 0) * 100),
        "currency":  obj.get("amount", {}).get("currency", "RUB"),
        "metadata":  obj.get("metadata", {}) or {},
        "raw":       event,
    }


# ── PayPal ─────────────────────────────────────────────────────────────────

_PAYPAL_BASE_LIVE    = "https://api-m.paypal.com"
_PAYPAL_BASE_SANDBOX = "https://api-m.sandbox.paypal.com"


def _paypal_base(is_test: bool) -> str:
    return _PAYPAL_BASE_SANDBOX if is_test else _PAYPAL_BASE_LIVE


def _paypal_token(creds: dict, is_test: bool) -> tuple[str, str]:
    cid  = creds.get("client_id", "").strip()
    csec = creds.get("client_secret", "").strip()
    if not cid or not csec:
        return "", "Missing client_id or client_secret"
    r = _http_request("POST", f"{_paypal_base(is_test)}/v1/oauth2/token",
                       headers={"Content-Type": "application/x-www-form-urlencoded"},
                       body=b"grant_type=client_credentials",
                       basic_auth=(cid, csec))
    if r["status"] == 200 and isinstance(r["body"], dict):
        return r["body"].get("access_token", ""), ""
    return "", f"PayPal token failed (HTTP {r['status']})"


def paypal_create_intent(creds: dict, amount: float, currency: str,
                          *, order_metadata: dict, idempotency_key: str,
                          is_test: bool = True) -> dict:
    token, err = _paypal_token(creds, is_test)
    if err:
        return _err(err)
    payload = {
        "intent": "CAPTURE",
        "purchase_units": [{
            "reference_id":  str(order_metadata.get("order_pending_id") or idempotency_key)[:255],
            "amount":        {"value": f"{round(float(amount), 2):.2f}", "currency_code": (currency or "USD").upper()},
            "description":   (order_metadata.get("description") or "")[:127],
        }],
    }
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_paypal_base(is_test)}/v2/checkout/orders",
                       headers={"Content-Type": "application/json",
                                "PayPal-Request-Id": idempotency_key},
                       body=body, bearer=token)
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        approve_url = ""
        for link in (r["body"].get("links") or []):
            if link.get("rel") == "approve":
                approve_url = link.get("href", "")
                break
        return _ok({
            "intent_id":    r["body"].get("id", ""),
            "redirect_url": approve_url,
            "status":       r["body"].get("status", ""),
        }, r["body"])
    msg = (r["body"] or {}).get("message", "") if isinstance(r["body"], dict) else ""
    return _err(msg or f"PayPal create failed (HTTP {r['status']})",
                r["body"] if isinstance(r["body"], dict) else {})


def paypal_get_intent(creds: dict, order_id: str, is_test: bool = True) -> dict:
    token, err = _paypal_token(creds, is_test)
    if err:
        return _err(err)
    r = _http_request("GET", f"{_paypal_base(is_test)}/v2/checkout/orders/{order_id}",
                       bearer=token)
    if r["status"] == 200 and isinstance(r["body"], dict):
        pu = (r["body"].get("purchase_units") or [{}])[0]
        cap = (pu.get("payments", {}).get("captures") or [{}])[0]
        return _ok({
            "intent_id":  r["body"].get("id", ""),
            "status":     r["body"].get("status", ""),
            "amount":     pu.get("amount", {}).get("value", "0"),
            "currency":   pu.get("amount", {}).get("currency_code", ""),
            "charge_id":  cap.get("id", ""),
            "metadata":   {"reference_id": pu.get("reference_id", "")},
        }, r["body"])
    return _err(f"PayPal fetch failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def paypal_verify_webhook(creds: dict, headers: dict, raw_body: bytes,
                            webhook_id: str, is_test: bool = True) -> tuple[bool, str]:
    """Calls PayPal's verify-webhook-signature endpoint — they do the actual cert
    chain validation server-side. Safer than implementing RSA + cert chain locally."""
    if not webhook_id:
        return False, "Webhook ID not configured"
    token, err = _paypal_token(creds, is_test)
    if err:
        return False, err
    try:
        event_body = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return False, "Malformed webhook body"
    payload = {
        "auth_algo":         headers.get("paypal-auth-algo", ""),
        "cert_url":          headers.get("paypal-cert-url", ""),
        "transmission_id":   headers.get("paypal-transmission-id", ""),
        "transmission_sig":  headers.get("paypal-transmission-sig", ""),
        "transmission_time": headers.get("paypal-transmission-time", ""),
        "webhook_id":        webhook_id,
        "webhook_event":     event_body,
    }
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_paypal_base(is_test)}/v1/notifications/verify-webhook-signature",
                       headers={"Content-Type": "application/json"},
                       body=body, bearer=token)
    if r["status"] == 200 and isinstance(r["body"], dict):
        if r["body"].get("verification_status") == "SUCCESS":
            return True, ""
        return False, "PayPal verification_status = " + str(r["body"].get("verification_status", "FAIL"))
    return False, f"PayPal verify call failed (HTTP {r['status']})"


def paypal_parse_event(raw_body: bytes) -> dict:
    try:
        event = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"type": "unknown", "raw_type": "", "event_id": "", "intent_id": "",
                "charge_id": "", "status": "", "amount": 0, "currency": "USD",
                "metadata": {}, "raw": {}}
    raw_type = event.get("event_type", "")
    res = event.get("resource") or {}
    canonical = "unknown"
    if raw_type in ("PAYMENT.CAPTURE.COMPLETED", "CHECKOUT.ORDER.COMPLETED"):
        canonical = "payment.succeeded"
    elif raw_type == "PAYMENT.CAPTURE.DENIED":
        canonical = "payment.failed"
    elif raw_type in ("PAYMENT.CAPTURE.REFUNDED", "PAYMENT.SALE.REFUNDED"):
        canonical = "refund.succeeded"
    elif raw_type == "CUSTOMER.DISPUTE.CREATED":
        canonical = "dispute.created"
    amt = float((res.get("amount") or {}).get("value", 0) or 0)
    return {
        "type":      canonical,
        "raw_type":  raw_type,
        "event_id":  event.get("id", ""),
        "intent_id": res.get("supplementary_data", {}).get("related_ids", {}).get("order_id", "") or "",
        "charge_id": res.get("id", ""),
        "status":    res.get("status", ""),
        "amount":    int(amt * 100),
        "currency":  (res.get("amount") or {}).get("currency_code", "USD"),
        "metadata":  {"custom_id": res.get("custom_id", "")},
        "raw":       event,
    }


# ── Adyen ──────────────────────────────────────────────────────────────────

def _adyen_base(is_test: bool) -> str:
    return "https://checkout-test.adyen.com/v71" if is_test else "https://checkout-live.adyen.com/v71"


def adyen_create_intent(creds: dict, amount_minor: int, currency: str,
                          *, order_metadata: dict, idempotency_key: str,
                          is_test: bool = True, return_url: str = "") -> dict:
    """POST /sessions — Adyen's hosted-Drop-in session (frontend uses Web Components SDK)."""
    api_key = creds.get("api_key", "").strip()
    mac     = creds.get("merchant_account", "").strip()
    if not api_key or not mac:
        return _err("Missing api_key or merchant_account")
    payload = {
        "amount":          {"value": amount_minor, "currency": (currency or "USD").upper()},
        "merchantAccount": mac,
        "reference":       str(order_metadata.get("order_pending_id") or idempotency_key)[:80],
        "returnUrl":       return_url or "https://example.com/return",
    }
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_adyen_base(is_test)}/sessions",
                       headers={"X-API-Key": api_key, "Content-Type": "application/json",
                                "Idempotency-Key": idempotency_key}, body=body)
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        return _ok({
            "intent_id":     r["body"].get("id", ""),
            "session_data":  r["body"].get("sessionData", ""),  # required by Drop-in
            "client_key":    creds.get("client_key", ""),
            "status":        "pending",
        }, r["body"])
    msg = (r["body"] or {}).get("message", "") if isinstance(r["body"], dict) else ""
    return _err(msg or f"Adyen session failed (HTTP {r['status']})",
                r["body"] if isinstance(r["body"], dict) else {})


def adyen_get_intent(creds: dict, session_id: str, is_test: bool = True) -> dict:
    """GET /sessions/{id} — fetches the session + linked payments."""
    api_key = creds.get("api_key", "").strip()
    if not api_key or not session_id:
        return _err("Missing api_key or session_id")
    r = _http_request("GET", f"{_adyen_base(is_test)}/sessions/{session_id}",
                       headers={"X-API-Key": api_key})
    if r["status"] == 200 and isinstance(r["body"], dict):
        status = r["body"].get("status", "")
        amount = (r["body"].get("amount") or {}).get("value", 0)
        return _ok({"intent_id": session_id, "status": status,
                     "amount": amount,
                     "currency": (r["body"].get("amount") or {}).get("currency", ""),
                     "charge_id": session_id, "metadata": {}}, r["body"])
    return _err(f"Adyen fetch failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def adyen_verify_webhook(raw_body: bytes, hmac_key: str) -> tuple[bool, str]:
    """Adyen signs each notification item separately. HMAC over:
       pspReference:originalReference:merchantAccountCode:merchantReference:value:currency:eventCode:success
       — encoded bytes → HMAC-SHA256 → base64. Compared to notificationItems[].additionalData.hmacSignature.
    See: https://docs.adyen.com/development-resources/webhooks/verify-hmac-signatures
    """
    if not hmac_key:
        return False, "HMAC key not configured"
    try:
        obj = json.loads(raw_body.decode("utf-8"))
        items = obj.get("notificationItems") or []
        if not items:
            return False, "No notificationItems in body"
        item = (items[0] or {}).get("NotificationRequestItem") or {}
        sig_provided = (item.get("additionalData") or {}).get("hmacSignature", "")
        if not sig_provided:
            return False, "Missing hmacSignature"
        amount = item.get("amount") or {}
        signed = ":".join([
            str(item.get("pspReference", "")),
            str(item.get("originalReference", "")),
            str(item.get("merchantAccountCode", "")),
            str(item.get("merchantReference", "")),
            str(amount.get("value", "")),
            str(amount.get("currency", "")),
            str(item.get("eventCode", "")),
            str(item.get("success", "")),
        ])
        try:
            key_bytes = bytes.fromhex(hmac_key)
        except ValueError:
            key_bytes = hmac_key.encode()
        expected = base64.b64encode(
            hmac.new(key_bytes, signed.encode("utf-8"), hashlib.sha256).digest()
        ).decode("ascii")
        if hmac.compare_digest(expected, sig_provided):
            return True, ""
        return False, "Signature mismatch"
    except (json.JSONDecodeError, UnicodeDecodeError, KeyError) as e:
        return False, f"Malformed body: {e}"


def adyen_parse_event(raw_body: bytes) -> dict:
    try:
        obj = json.loads(raw_body.decode("utf-8"))
        items = obj.get("notificationItems") or []
        item = (items[0] or {}).get("NotificationRequestItem") or {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"type": "unknown", "raw_type": "", "event_id": "", "intent_id": "",
                "charge_id": "", "status": "", "amount": 0, "currency": "",
                "metadata": {}, "raw": {}}
    code = item.get("eventCode", "")
    success = str(item.get("success", "")).lower() == "true"
    canonical = "unknown"
    if code == "AUTHORISATION" and success:    canonical = "payment.succeeded"
    elif code == "AUTHORISATION":              canonical = "payment.failed"
    elif code == "REFUND" and success:         canonical = "refund.succeeded"
    elif code == "NOTIFICATION_OF_CHARGEBACK": canonical = "dispute.created"
    amt = (item.get("amount") or {}).get("value", 0) or 0
    return {
        "type":      canonical,
        "raw_type":  code,
        "event_id":  item.get("pspReference", ""),
        "intent_id": item.get("originalReference", "") or item.get("pspReference", ""),
        "charge_id": item.get("pspReference", ""),
        "status":    "succeeded" if success else "failed",
        "amount":    int(amt),
        "currency":  (item.get("amount") or {}).get("currency", ""),
        "metadata":  {"merchantReference": item.get("merchantReference", "")},
        "raw":       item,
    }


# ── Braintree ──────────────────────────────────────────────────────────────

def _braintree_url(is_test: bool) -> str:
    return ("https://payments.sandbox.braintree-api.com/graphql" if is_test
            else "https://payments.braintree-api.com/graphql")


def braintree_create_intent(creds: dict, amount_cents: int, currency: str,
                              *, order_metadata: dict, idempotency_key: str,
                              is_test: bool = True) -> dict:
    """Create a client-token via GraphQL `createClientToken` mutation.
    Frontend uses this token to initialise Drop-in UI."""
    pub = creds.get("public_key", "").strip()
    pri = creds.get("private_key", "").strip()
    if not pub or not pri:
        return _err("Missing public_key or private_key")
    body = json.dumps({
        "query": "mutation t($i: CreateClientTokenInput) { createClientToken(input: $i) { clientToken } }",
        "variables": {"i": {}},
    }).encode("utf-8")
    r = _http_request("POST", _braintree_url(is_test),
                       headers={"Content-Type": "application/json",
                                "Braintree-Version": "2019-01-01"},
                       body=body, basic_auth=(pub, pri))
    if r["status"] == 200 and isinstance(r["body"], dict) and not r["body"].get("errors"):
        token = r["body"].get("data", {}).get("createClientToken", {}).get("clientToken", "")
        return _ok({
            "intent_id":     "bt_" + idempotency_key,
            "client_secret": token,
            "amount":        amount_cents,
            "currency":      currency.upper(),
            "status":        "pending",
        }, r["body"])
    err = (r["body"] or {}).get("errors", [{}])[0].get("message", "") if isinstance(r["body"], dict) else ""
    return _err(err or f"Braintree intent failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def braintree_get_intent(creds: dict, transaction_id: str, is_test: bool = True) -> dict:
    """Query the transaction status by ID."""
    pub = creds.get("public_key", "").strip()
    pri = creds.get("private_key", "").strip()
    if not pub or not pri:
        return _err("Missing public_key or private_key")
    body = json.dumps({
        "query": "query t($i: ID!) { node(id: $i) { ... on Transaction { id status amount { value currencyCode } } } }",
        "variables": {"i": transaction_id},
    }).encode("utf-8")
    r = _http_request("POST", _braintree_url(is_test),
                       headers={"Content-Type": "application/json",
                                "Braintree-Version": "2019-01-01"},
                       body=body, basic_auth=(pub, pri))
    if r["status"] == 200 and isinstance(r["body"], dict):
        tx = r["body"].get("data", {}).get("node") or {}
        amt = tx.get("amount", {}) or {}
        return _ok({
            "intent_id": tx.get("id", ""),
            "status":    tx.get("status", ""),
            "amount":    float(amt.get("value", 0) or 0),
            "currency":  amt.get("currencyCode", ""),
            "charge_id": tx.get("id", ""),
            "metadata":  {},
        }, r["body"])
    return _err(f"Braintree fetch failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def braintree_verify_webhook(payload_form: dict, private_key: str) -> tuple[bool, str]:
    """Braintree webhooks POST form-encoded {bt_signature, bt_payload}.
    bt_signature is "publicKey|signature". Verify HMAC-SHA1 of bt_payload with private_key
    (matches the part after the pipe).
    """
    sig = payload_form.get("bt_signature", "")
    pl  = payload_form.get("bt_payload", "")
    if not sig or not pl:
        return False, "Missing bt_signature or bt_payload"
    parts = sig.split("|", 1)
    if len(parts) != 2:
        return False, "Malformed bt_signature"
    expected = hmac.new(private_key.encode(),
                          pl.encode("utf-8"),
                          hashlib.sha1).hexdigest()
    if hmac.compare_digest(expected, parts[1]):
        return True, ""
    return False, "Signature mismatch"


def braintree_parse_event(raw_body: bytes) -> dict:
    """Braintree webhooks are form-encoded with bt_payload = base64(XML).
    We don't parse the XML here — just return a stub canonical event."""
    try:
        parsed = urllib.parse.parse_qs(raw_body.decode("utf-8"))
        bt_payload = (parsed.get("bt_payload") or [""])[0]
        decoded = base64.b64decode(bt_payload + "=" * (-len(bt_payload) % 4)).decode("utf-8", errors="replace")
    except Exception:
        decoded = ""
    # Best-effort kind-detection by string match
    canonical = "unknown"
    if "transaction_settled"   in decoded: canonical = "payment.succeeded"
    elif "transaction_settlement_declined" in decoded: canonical = "payment.failed"
    elif "transaction_disbursed" in decoded: canonical = "payment.succeeded"
    elif "disputes_opened"     in decoded: canonical = "dispute.created"
    elif "subscription_charged_successfully" in decoded: canonical = "payment.succeeded"
    return {
        "type": canonical, "raw_type": "braintree_xml_payload",
        "event_id": hashlib.sha256(decoded.encode()).hexdigest()[:24] if decoded else "",
        "intent_id": "", "charge_id": "",
        "status": "", "amount": 0, "currency": "",
        "metadata": {}, "raw": {"xml_preview": decoded[:500]},
    }


# ── Square ─────────────────────────────────────────────────────────────────

def _square_base(is_test: bool) -> str:
    return "https://connect.squareupsandbox.com/v2" if is_test else "https://connect.squareup.com/v2"


def square_create_intent(creds: dict, amount_minor: int, currency: str,
                          *, order_metadata: dict, idempotency_key: str,
                          is_test: bool = True, return_url: str = "") -> dict:
    """POST /v2/online-checkout/payment-links — returns a hosted checkout URL."""
    tok = creds.get("access_token", "").strip()
    loc = creds.get("location_id", "").strip()
    if not tok or not loc:
        return _err("Missing access_token or location_id")
    payload = {
        "idempotency_key": idempotency_key,
        "quick_pay": {
            "name":     order_metadata.get("description") or "Order",
            "price_money": {"amount": amount_minor, "currency": (currency or "USD").upper()},
            "location_id": loc,
        },
        "checkout_options": {
            "redirect_url": return_url or "",
        },
    }
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_square_base(is_test)}/online-checkout/payment-links",
                       headers={"Square-Version": "2024-10-17",
                                "Content-Type": "application/json"},
                       body=body, bearer=tok)
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        link = r["body"].get("payment_link") or {}
        return _ok({
            "intent_id":    link.get("id", ""),
            "redirect_url": link.get("url", ""),
            "status":       "pending",
        }, r["body"])
    errors = (r["body"] or {}).get("errors", []) if isinstance(r["body"], dict) else []
    msg = errors[0].get("detail", "") if errors else ""
    return _err(msg or f"Square intent failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def square_get_intent(creds: dict, payment_link_id: str, is_test: bool = True) -> dict:
    """Square doesn't have a direct 'get intent' — we look up the linked Payment via
    list-payments filtered by note=payment_link_id. Simpler path: just trust the
    front-end provided payment_id (via Square.js callback)."""
    tok = creds.get("access_token", "").strip()
    if not tok:
        return _err("Missing access_token")
    r = _http_request("GET", f"{_square_base(is_test)}/payments/{payment_link_id}",
                       headers={"Square-Version": "2024-10-17"}, bearer=tok)
    if r["status"] == 200 and isinstance(r["body"], dict):
        p = r["body"].get("payment") or {}
        am = p.get("amount_money") or {}
        return _ok({
            "intent_id": p.get("id", ""),
            "status":    p.get("status", ""),
            "amount":    am.get("amount", 0),
            "currency":  am.get("currency", ""),
            "charge_id": p.get("id", ""),
            "metadata":  {"reference_id": p.get("reference_id", "")},
        }, r["body"])
    return _err(f"Square fetch failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def square_verify_webhook(payload_bytes: bytes, signature_header: str,
                            url: str, signature_key: str) -> tuple[bool, str]:
    """Header X-Square-HmacSha256-Signature = base64(HMAC-SHA256(notificationUrl + body, signatureKey)).
    See: https://developer.squareup.com/docs/webhooks/step3validate
    """
    if not signature_key:
        return False, "Webhook signature key not configured"
    if not signature_header:
        return False, "Missing Square signature header"
    string_to_sign = url.encode("utf-8") + payload_bytes
    expected = base64.b64encode(
        hmac.new(signature_key.encode(), string_to_sign, hashlib.sha256).digest()
    ).decode("ascii")
    if hmac.compare_digest(expected, signature_header):
        return True, ""
    return False, "Signature mismatch"


def square_parse_event(raw_body: bytes) -> dict:
    try:
        event = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"type": "unknown", "raw_type": "", "event_id": "", "intent_id": "",
                "charge_id": "", "status": "", "amount": 0, "currency": "",
                "metadata": {}, "raw": {}}
    raw_type = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}
    p   = obj.get("payment") or obj.get("refund") or {}
    canonical = "unknown"
    if raw_type == "payment.updated" and p.get("status") == "COMPLETED": canonical = "payment.succeeded"
    elif raw_type == "payment.updated" and p.get("status") in ("FAILED", "CANCELED"): canonical = "payment.failed"
    elif raw_type == "refund.updated" and p.get("status") == "COMPLETED": canonical = "refund.succeeded"
    elif raw_type == "dispute.created":                                   canonical = "dispute.created"
    am = p.get("amount_money") or {}
    return {
        "type":      canonical,
        "raw_type":  raw_type,
        "event_id":  event.get("event_id", "") or event.get("id", ""),
        "intent_id": p.get("id", ""),
        "charge_id": p.get("id", ""),
        "status":    p.get("status", ""),
        "amount":    am.get("amount", 0),
        "currency":  am.get("currency", ""),
        "metadata":  {"reference_id": p.get("reference_id", "")},
        "raw":       event,
    }


# ── Mollie ─────────────────────────────────────────────────────────────────

_MOLLIE_BASE = "https://api.mollie.com/v2"


def mollie_create_intent(creds: dict, amount: float, currency: str,
                          *, order_metadata: dict, idempotency_key: str,
                          return_url: str = "", webhook_url: str = "") -> dict:
    key = creds.get("api_key", "").strip()
    if not key:
        return _err("Missing api_key")
    payload = {
        "amount":      {"value": f"{round(amount, 2):.2f}", "currency": (currency or "EUR").upper()},
        "description": (order_metadata.get("description") or "Order")[:255],
        "redirectUrl": return_url or "https://example.com/return",
        "metadata":    {k: str(v)[:255] for k, v in order_metadata.items()},
    }
    if webhook_url:
        payload["webhookUrl"] = webhook_url
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_MOLLIE_BASE}/payments",
                       headers={"Content-Type": "application/json",
                                "Idempotency-Key": idempotency_key},
                       body=body, bearer=key)
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        return _ok({
            "intent_id":    r["body"].get("id", ""),
            "redirect_url": (r["body"].get("_links") or {}).get("checkout", {}).get("href", ""),
            "status":       r["body"].get("status", ""),
        }, r["body"])
    msg = (r["body"] or {}).get("detail", "") if isinstance(r["body"], dict) else ""
    return _err(msg or f"Mollie intent failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def mollie_get_intent(creds: dict, payment_id: str) -> dict:
    key = creds.get("api_key", "").strip()
    if not key:
        return _err("Missing api_key")
    r = _http_request("GET", f"{_MOLLIE_BASE}/payments/{payment_id}", bearer=key)
    if r["status"] == 200 and isinstance(r["body"], dict):
        am = r["body"].get("amount") or {}
        return _ok({
            "intent_id": r["body"].get("id", ""),
            "status":    r["body"].get("status", ""),
            "amount":    am.get("value", "0"),
            "currency":  am.get("currency", ""),
            "charge_id": r["body"].get("id", ""),
            "metadata":  r["body"].get("metadata") or {},
        }, r["body"])
    return _err(f"Mollie fetch failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def mollie_verify_webhook(raw_body: bytes) -> tuple[bool, str]:
    """Mollie does NOT sign webhooks. They send only the payment id in form data; we
    re-fetch the payment from API by ID to authenticate. Since the API call uses our
    secret key, only legitimate payments under our account return data.

    Caller MUST do the re-fetch (mollie_get_intent) and check it matches the body's
    payment id. We just verify the body has a valid `id` field shape.
    """
    parsed = urllib.parse.parse_qs(raw_body.decode("utf-8", errors="replace"))
    pid = (parsed.get("id") or [""])[0]
    if not pid or not pid.startswith(("tr_", "ord_")):
        return False, "Missing or malformed Mollie payment id"
    return True, ""


def mollie_parse_event(raw_body: bytes) -> dict:
    """Mollie webhook body is form-encoded {id: tr_XYZ}. No event type — caller
    must fetch payment status separately.
    """
    parsed = urllib.parse.parse_qs(raw_body.decode("utf-8", errors="replace"))
    pid = (parsed.get("id") or [""])[0]
    return {
        "type": "unknown", "raw_type": "mollie_notification",
        "event_id": pid, "intent_id": pid, "charge_id": pid,
        "status": "needs_lookup", "amount": 0, "currency": "EUR",
        "metadata": {}, "raw": {"id": pid},
    }


# ── Razorpay ───────────────────────────────────────────────────────────────

_RAZORPAY_BASE = "https://api.razorpay.com/v1"


def razorpay_create_intent(creds: dict, amount_minor: int, currency: str,
                             *, order_metadata: dict, idempotency_key: str) -> dict:
    """POST /v1/orders — Razorpay's intent equivalent. Frontend loads Razorpay
    Checkout with the returned order id + key_id."""
    kid  = creds.get("key_id", "").strip()
    ksec = creds.get("key_secret", "").strip()
    if not kid or not ksec:
        return _err("Missing key_id or key_secret")
    payload = {
        "amount":   amount_minor,
        "currency": (currency or "INR").upper(),
        "receipt":  str(order_metadata.get("order_pending_id") or idempotency_key)[:40],
        "notes":    {k: str(v)[:255] for k, v in order_metadata.items()},
    }
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_RAZORPAY_BASE}/orders",
                       headers={"Content-Type": "application/json",
                                "X-Idempotency-Key": idempotency_key},
                       body=body, basic_auth=(kid, ksec))
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        return _ok({
            "intent_id":       r["body"].get("id", ""),
            "publishable_key": kid,    # Razorpay key_id is safe to expose to frontend
            "amount":          r["body"].get("amount", 0),
            "currency":        r["body"].get("currency", ""),
            "status":          r["body"].get("status", ""),
        }, r["body"])
    desc = (r["body"] or {}).get("error", {}).get("description", "") if isinstance(r["body"], dict) else ""
    return _err(desc or f"Razorpay intent failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def razorpay_get_intent(creds: dict, order_id: str) -> dict:
    kid  = creds.get("key_id", "").strip()
    ksec = creds.get("key_secret", "").strip()
    if not kid or not ksec:
        return _err("Missing key_id or key_secret")
    # Razorpay: orders → payments. We fetch the order's payments to find a captured one.
    r = _http_request("GET", f"{_RAZORPAY_BASE}/orders/{order_id}/payments",
                       basic_auth=(kid, ksec))
    if r["status"] == 200 and isinstance(r["body"], dict):
        items = r["body"].get("items") or []
        captured = next((p for p in items if p.get("status") == "captured"), None)
        ref = captured or (items[0] if items else {})
        return _ok({
            "intent_id": order_id,
            "status":    ref.get("status", "created"),
            "amount":    ref.get("amount", 0),
            "currency":  ref.get("currency", ""),
            "charge_id": ref.get("id", ""),
            "metadata":  ref.get("notes") or {},
        }, r["body"])
    return _err(f"Razorpay fetch failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def razorpay_verify_webhook(raw_body: bytes, signature_header: str,
                              webhook_secret: str) -> tuple[bool, str]:
    """Header X-Razorpay-Signature = HMAC-SHA256(body, webhook_secret) hex digest."""
    if not webhook_secret:
        return False, "Webhook secret not configured"
    if not signature_header:
        return False, "Missing X-Razorpay-Signature header"
    expected = hmac.new(webhook_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    if hmac.compare_digest(expected, signature_header):
        return True, ""
    return False, "Signature mismatch"


def razorpay_parse_event(raw_body: bytes) -> dict:
    try:
        event = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"type": "unknown", "raw_type": "", "event_id": "", "intent_id": "",
                "charge_id": "", "status": "", "amount": 0, "currency": "INR",
                "metadata": {}, "raw": {}}
    raw_type = event.get("event", "")
    payload  = event.get("payload") or {}
    p_pay    = (payload.get("payment") or {}).get("entity") or {}
    p_ref    = (payload.get("refund")  or {}).get("entity") or {}
    canonical = "unknown"
    if raw_type == "payment.captured":             canonical = "payment.succeeded"
    elif raw_type == "payment.failed":             canonical = "payment.failed"
    elif raw_type in ("refund.processed", "refund.created"): canonical = "refund.succeeded"
    elif raw_type == "payment.dispute.created":    canonical = "dispute.created"
    obj = p_ref or p_pay
    return {
        "type":      canonical,
        "raw_type":  raw_type,
        "event_id":  event.get("id", "") or obj.get("id", ""),
        "intent_id": obj.get("order_id", "") or obj.get("payment_id", ""),
        "charge_id": obj.get("id", ""),
        "status":    obj.get("status", ""),
        "amount":    obj.get("amount", 0),
        "currency":  obj.get("currency", "INR"),
        "metadata":  obj.get("notes") or {},
        "raw":       event,
    }


# ── Paddle Billing ─────────────────────────────────────────────────────────

def _paddle_base(is_test: bool) -> str:
    return "https://sandbox-api.paddle.com" if is_test else "https://api.paddle.com"


def paddle_create_intent(creds: dict, amount: float, currency: str,
                          *, order_metadata: dict, idempotency_key: str,
                          is_test: bool = True, return_url: str = "") -> dict:
    """POST /transactions — Paddle's intent. Frontend uses Paddle.js Checkout."""
    tok = creds.get("api_key", "").strip()
    if not tok:
        return _err("Missing api_key")
    # Paddle requires a `items` list with price_id refs to existing catalog products.
    # For ad-hoc cart amounts we use the `non_catalog_items` / custom_data alternative.
    # In practice this requires catalog setup on the merchant side. Return the auth
    # token + a non-catalog transaction as best-effort.
    payload = {
        "items": [{
            "quantity": 1,
            "price": {
                "description":  (order_metadata.get("description") or "Order")[:200],
                "unit_price":   {"amount": str(int(round(amount * 100))),
                                  "currency_code": (currency or "USD").upper()},
                "tax_mode":     "external",
                "quantity":     {"minimum": 1, "maximum": 1},
            },
        }],
        "custom_data": {k: str(v)[:255] for k, v in order_metadata.items()},
    }
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_paddle_base(is_test)}/transactions",
                       headers={"Content-Type": "application/json",
                                "Paddle-Idempotency-Key": idempotency_key},
                       body=body, bearer=tok)
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        d = r["body"].get("data") or {}
        return _ok({
            "intent_id":     d.get("id", ""),
            "client_secret": d.get("checkout", {}).get("url", ""),
            "status":        d.get("status", "draft"),
        }, r["body"])
    err = (r["body"] or {}).get("error", {}).get("detail", "") if isinstance(r["body"], dict) else ""
    return _err(err or f"Paddle intent failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def paddle_get_intent(creds: dict, transaction_id: str, is_test: bool = True) -> dict:
    tok = creds.get("api_key", "").strip()
    if not tok:
        return _err("Missing api_key")
    r = _http_request("GET", f"{_paddle_base(is_test)}/transactions/{transaction_id}",
                       bearer=tok)
    if r["status"] == 200 and isinstance(r["body"], dict):
        d = r["body"].get("data") or {}
        total = (d.get("details") or {}).get("totals") or {}
        return _ok({
            "intent_id": d.get("id", ""),
            "status":    d.get("status", ""),
            "amount":    total.get("grand_total", "0"),
            "currency":  d.get("currency_code", ""),
            "charge_id": d.get("id", ""),
            "metadata":  d.get("custom_data") or {},
        }, r["body"])
    return _err(f"Paddle fetch failed (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def paddle_verify_webhook(raw_body: bytes, signature_header: str,
                            webhook_secret: str,
                            tolerance: int = _WEBHOOK_REPLAY_TOLERANCE) -> tuple[bool, str]:
    """Header Paddle-Signature = "ts=<unix>;h1=<HMAC-SHA256(ts:body, secret)>".
    https://developer.paddle.com/webhooks/signature-verification
    """
    if not webhook_secret:
        return False, "Webhook secret not configured"
    if not signature_header:
        return False, "Missing Paddle-Signature header"
    parts = {}
    for kv in signature_header.split(";"):
        if "=" in kv:
            k, v = kv.split("=", 1)
            parts[k.strip()] = v.strip()
    ts  = parts.get("ts", "")
    h1  = parts.get("h1", "")
    if not ts or not h1:
        return False, "Malformed Paddle-Signature"
    try:
        ts_int = int(ts)
    except ValueError:
        return False, "Bad timestamp"
    if abs(time.time() - ts_int) > tolerance:
        return False, f"Timestamp outside tolerance ({tolerance}s)"
    signed = f"{ts}:".encode() + raw_body
    expected = hmac.new(webhook_secret.encode(), signed, hashlib.sha256).hexdigest()
    if hmac.compare_digest(expected, h1):
        return True, ""
    return False, "Signature mismatch"


def paddle_parse_event(raw_body: bytes) -> dict:
    try:
        event = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"type": "unknown", "raw_type": "", "event_id": "", "intent_id": "",
                "charge_id": "", "status": "", "amount": 0, "currency": "USD",
                "metadata": {}, "raw": {}}
    raw_type = event.get("event_type", "")
    data = event.get("data") or {}
    canonical = "unknown"
    if raw_type in ("transaction.completed", "transaction.paid"):     canonical = "payment.succeeded"
    elif raw_type == "transaction.payment_failed":                    canonical = "payment.failed"
    elif raw_type in ("adjustment.created", "adjustment.updated"):
        if data.get("action") == "refund":                            canonical = "refund.succeeded"
    return {
        "type":      canonical,
        "raw_type":  raw_type,
        "event_id":  event.get("event_id", ""),
        "intent_id": data.get("id", "") or data.get("transaction_id", ""),
        "charge_id": data.get("id", ""),
        "status":    data.get("status", ""),
        "amount":    int(float((data.get("details") or {}).get("totals", {}).get("grand_total", 0) or 0)),
        "currency":  data.get("currency_code", "USD"),
        "metadata":  data.get("custom_data") or {},
        "raw":       event,
    }


# ── PayBox.money (Kazakhstan) ──────────────────────────────────────────────

_PAYBOX_BASE = "https://api.paybox.money"


def _paybox_sign(endpoint: str, params: dict, secret_key: str) -> str:
    parts = [endpoint]
    for k in sorted(params.keys()):
        parts.append(str(params[k]))
    parts.append(secret_key)
    return hashlib.sha1(";".join(parts).encode("utf-8")).hexdigest()


def paybox_create_intent(creds: dict, amount: float, currency: str,
                          *, order_metadata: dict, idempotency_key: str,
                          return_url: str = "") -> dict:
    """POST /init_payment.php — returns redirect URL. Form-encoded."""
    mid = creds.get("merchant_id", "").strip()
    sec = creds.get("secret_key", "").strip()
    if not mid or not sec:
        return _err("Missing merchant_id or secret_key")
    params = {
        "pg_merchant_id":   mid,
        "pg_amount":        f"{round(amount, 2):.2f}",
        "pg_currency":      (currency or "KZT").upper(),
        "pg_description":   (order_metadata.get("description") or "Order")[:200],
        "pg_order_id":      str(order_metadata.get("order_pending_id") or idempotency_key)[:40],
        "pg_salt":          idempotency_key[:32],
        "pg_success_url":   return_url or "",
        "pg_failure_url":   return_url or "",
        "pg_result_url":    "",  # filled in by storefront via separate webhook config
    }
    params = {k: v for k, v in params.items() if v}
    params["pg_sig"] = _paybox_sign("init_payment.php", params, sec)
    body = urllib.parse.urlencode(params).encode("utf-8")
    r = _http_request("POST", f"{_PAYBOX_BASE}/init_payment.php",
                       headers={"Content-Type": "application/x-www-form-urlencoded"},
                       body=body)
    if r["status"] == 200:
        # PayBox responds with XML containing <pg_redirect_url> + <pg_payment_id>.
        text = json.dumps(r["body"]) if isinstance(r["body"], dict) else str(r["body"])
        import re as _re
        url_match = _re.search(r"<pg_redirect_url>(.+?)</pg_redirect_url>", text)
        pid_match = _re.search(r"<pg_payment_id>(.+?)</pg_payment_id>", text)
        status_match = _re.search(r"<pg_status>(.+?)</pg_status>", text)
        if status_match and status_match.group(1).strip() == "ok":
            return _ok({
                "intent_id":    pid_match.group(1).strip() if pid_match else "",
                "redirect_url": url_match.group(1).strip() if url_match else "",
                "status":       "pending",
            }, {"raw_xml": text[:500]})
        return _err(f"PayBox declined: {text[:200]}", {})
    return _err(f"PayBox intent failed (HTTP {r['status']})", {})


def paybox_get_intent(creds: dict, payment_id: str) -> dict:
    mid = creds.get("merchant_id", "").strip()
    sec = creds.get("secret_key", "").strip()
    if not mid or not sec:
        return _err("Missing merchant_id or secret_key")
    params = {
        "pg_merchant_id": mid,
        "pg_payment_id":  payment_id,
        "pg_salt":        secrets.token_hex(8),
    }
    params["pg_sig"] = _paybox_sign("get_status.php", params, sec)
    body = urllib.parse.urlencode(params).encode("utf-8")
    r = _http_request("POST", f"{_PAYBOX_BASE}/get_status.php",
                       headers={"Content-Type": "application/x-www-form-urlencoded"},
                       body=body)
    if r["status"] == 200:
        text = json.dumps(r["body"]) if isinstance(r["body"], dict) else str(r["body"])
        import re as _re
        ts = _re.search(r"<pg_transaction_status>(.+?)</pg_transaction_status>", text)
        amt = _re.search(r"<pg_amount>([\d.]+)</pg_amount>", text)
        cur = _re.search(r"<pg_currency>(.+?)</pg_currency>", text)
        return _ok({
            "intent_id": payment_id,
            "status":    ts.group(1).strip() if ts else "unknown",
            "amount":    int(float(amt.group(1)) * 100) if amt else 0,
            "currency":  (cur.group(1).strip() if cur else "KZT"),
            "charge_id": payment_id,
            "metadata":  {},
        }, {"raw_xml": text[:500]})
    return _err(f"PayBox fetch failed (HTTP {r['status']})", {})


def paybox_verify_webhook(payload_form: dict, secret_key: str) -> tuple[bool, str]:
    """PayBox sends form-encoded notification with pg_sig. Re-sign with our key
    over /result.php endpoint name."""
    if not secret_key:
        return False, "Secret key not configured"
    sig = payload_form.get("pg_sig", "")
    if not sig:
        return False, "Missing pg_sig"
    params = {k: v for k, v in payload_form.items() if k != "pg_sig"}
    expected = _paybox_sign("result.php", params, secret_key)
    if hmac.compare_digest(expected, sig):
        return True, ""
    return False, "Signature mismatch"


def paybox_parse_event(raw_body: bytes) -> dict:
    """PayBox webhook body is form-encoded."""
    parsed = urllib.parse.parse_qs(raw_body.decode("utf-8", errors="replace"))
    flat = {k: v[0] if v else "" for k, v in parsed.items()}
    result = flat.get("pg_result", "")
    canonical = "unknown"
    if result == "1":  canonical = "payment.succeeded"
    elif result == "0": canonical = "payment.failed"
    return {
        "type":      canonical,
        "raw_type":  f"pg_result={result}",
        "event_id":  flat.get("pg_payment_id", ""),
        "intent_id": flat.get("pg_payment_id", ""),
        "charge_id": flat.get("pg_payment_id", ""),
        "status":    "succeeded" if result == "1" else "failed",
        "amount":    int(float(flat.get("pg_amount", 0) or 0) * 100),
        "currency":  flat.get("pg_currency", "KZT"),
        "metadata":  {"pg_order_id": flat.get("pg_order_id", "")},
        "raw":       flat,
    }


# ── Dispatcher ─────────────────────────────────────────────────────────────

def create_intent(provider: str, creds: dict, *, amount: float, currency: str,
                   order_metadata: dict, idempotency_key: str | None = None,
                   is_test_mode: bool = True, stripe_account_id: str = "",
                   return_url: str = "") -> dict:
    """Single entry point. amount in major units (dollars/rubles).
    Returns {ok, data: {intent_id, ?client_secret, ?redirect_url, ?publishable_key, status}, error, raw}."""
    if not idempotency_key:
        idempotency_key = "intent-" + secrets.token_urlsafe(16)
    if provider == "manual" or provider == "other":
        # Manual mode — no real intent. Caller should still record the order
        # but treat payment as "external / off-platform" and require manual confirmation.
        return _ok({"intent_id": "manual-" + idempotency_key, "status": "manual_required"})
    amount_minor = int(round(amount * 100))
    if provider == "stripe":
        return stripe_create_intent(creds, amount_minor, currency,
                                     order_metadata=order_metadata,
                                     idempotency_key=idempotency_key,
                                     stripe_account_id=stripe_account_id)
    if provider == "tinkoff":
        return tinkoff_create_intent(creds, amount_minor, currency,
                                      order_metadata=order_metadata,
                                      idempotency_key=idempotency_key)
    if provider == "cloudpayments":
        return cloudpayments_create_intent(creds, amount, currency,
                                            order_metadata=order_metadata,
                                            idempotency_key=idempotency_key)
    if provider == "yookassa":
        return yookassa_create_intent(creds, amount, currency,
                                       order_metadata=order_metadata,
                                       idempotency_key=idempotency_key,
                                       return_url=return_url)
    if provider == "paypal":
        return paypal_create_intent(creds, amount, currency,
                                     order_metadata=order_metadata,
                                     idempotency_key=idempotency_key,
                                     is_test=is_test_mode)
    if provider == "adyen":
        return adyen_create_intent(creds, amount_minor, currency,
                                    order_metadata=order_metadata,
                                    idempotency_key=idempotency_key,
                                    is_test=is_test_mode, return_url=return_url)
    if provider == "braintree":
        return braintree_create_intent(creds, amount_minor, currency,
                                        order_metadata=order_metadata,
                                        idempotency_key=idempotency_key,
                                        is_test=is_test_mode)
    if provider == "square":
        return square_create_intent(creds, amount_minor, currency,
                                     order_metadata=order_metadata,
                                     idempotency_key=idempotency_key,
                                     is_test=is_test_mode, return_url=return_url)
    if provider == "mollie":
        return mollie_create_intent(creds, amount, currency,
                                     order_metadata=order_metadata,
                                     idempotency_key=idempotency_key,
                                     return_url=return_url)
    if provider == "razorpay":
        return razorpay_create_intent(creds, amount_minor, currency,
                                       order_metadata=order_metadata,
                                       idempotency_key=idempotency_key)
    if provider == "paddle":
        return paddle_create_intent(creds, amount, currency,
                                     order_metadata=order_metadata,
                                     idempotency_key=idempotency_key,
                                     is_test=is_test_mode, return_url=return_url)
    if provider == "paybox":
        return paybox_create_intent(creds, amount, currency,
                                     order_metadata=order_metadata,
                                     idempotency_key=idempotency_key,
                                     return_url=return_url)
    return _err(f"Unknown provider: {provider}")


def get_intent(provider: str, creds: dict, *, intent_id: str,
                is_test_mode: bool = True, stripe_account_id: str = "") -> dict:
    if provider in ("manual", "other"):
        return _ok({"intent_id": intent_id, "status": "manual_required"})
    if provider == "stripe":         return stripe_get_intent(creds, intent_id, stripe_account_id)
    if provider == "tinkoff":        return tinkoff_get_intent(creds, intent_id)
    if provider == "cloudpayments":  return cloudpayments_get_intent(creds, intent_id)
    if provider == "yookassa":       return yookassa_get_intent(creds, intent_id)
    if provider == "paypal":         return paypal_get_intent(creds, intent_id, is_test_mode)
    if provider == "adyen":          return adyen_get_intent(creds, intent_id, is_test_mode)
    if provider == "braintree":      return braintree_get_intent(creds, intent_id, is_test_mode)
    if provider == "square":         return square_get_intent(creds, intent_id, is_test_mode)
    if provider == "mollie":         return mollie_get_intent(creds, intent_id)
    if provider == "razorpay":       return razorpay_get_intent(creds, intent_id)
    if provider == "paddle":         return paddle_get_intent(creds, intent_id, is_test_mode)
    if provider == "paybox":         return paybox_get_intent(creds, intent_id)
    return _err(f"Unknown provider: {provider}")


def verify_webhook(provider: str, creds: dict, *, raw_body: bytes,
                    headers: dict, source_ip: str = "", request_url: str = "",
                    is_test_mode: bool = True) -> tuple[bool, str]:
    """Returns (valid, error_message). Headers should be lowercase-keyed.

    `request_url` is the full URL the webhook was POSTed to — required for
    Square signature verification.
    """
    h = {k.lower(): v for k, v in (headers or {}).items()}
    if provider == "stripe":
        return stripe_verify_webhook(raw_body, h.get("stripe-signature", ""),
                                      creds.get("webhook_secret", ""))
    if provider == "tinkoff":
        return tinkoff_verify_webhook(raw_body, creds.get("password", ""))
    if provider == "cloudpayments":
        return cloudpayments_verify_webhook(raw_body, h.get("content-hmac", ""),
                                             creds.get("api_secret", ""))
    if provider == "yookassa":
        return yookassa_verify_webhook(raw_body, "", source_ip)
    if provider == "paypal":
        return paypal_verify_webhook(creds, h, raw_body,
                                      creds.get("webhook_id", ""), is_test_mode)
    if provider == "adyen":
        return adyen_verify_webhook(raw_body, creds.get("hmac_key", ""))
    if provider == "braintree":
        # Braintree body is form-encoded {bt_signature, bt_payload}
        parsed = urllib.parse.parse_qs(raw_body.decode("utf-8", errors="replace"))
        flat = {k: (v[0] if v else "") for k, v in parsed.items()}
        return braintree_verify_webhook(flat, creds.get("private_key", ""))
    if provider == "square":
        return square_verify_webhook(raw_body,
                                       h.get("x-square-hmacsha256-signature", "")
                                       or h.get("square-hmacsha256-signature", ""),
                                       request_url,
                                       creds.get("webhook_signature_key", ""))
    if provider == "mollie":
        return mollie_verify_webhook(raw_body)
    if provider == "razorpay":
        return razorpay_verify_webhook(raw_body, h.get("x-razorpay-signature", ""),
                                         creds.get("webhook_secret", ""))
    if provider == "paddle":
        return paddle_verify_webhook(raw_body, h.get("paddle-signature", ""),
                                       creds.get("webhook_secret", ""))
    if provider == "paybox":
        parsed = urllib.parse.parse_qs(raw_body.decode("utf-8", errors="replace"))
        flat = {k: (v[0] if v else "") for k, v in parsed.items()}
        return paybox_verify_webhook(flat, creds.get("secret_key", ""))
    if provider in ("manual", "other"):
        return False, "Provider does not support webhooks"
    return False, f"Unknown provider: {provider}"


def parse_event(provider: str, raw_body: bytes) -> dict:
    """Returns canonical event shape regardless of provider."""
    if provider == "stripe":         return stripe_parse_event(raw_body)
    if provider == "tinkoff":        return tinkoff_parse_event(raw_body)
    if provider == "cloudpayments":  return cloudpayments_parse_event(raw_body)
    if provider == "yookassa":       return yookassa_parse_event(raw_body)
    if provider == "paypal":         return paypal_parse_event(raw_body)
    if provider == "adyen":          return adyen_parse_event(raw_body)
    if provider == "braintree":      return braintree_parse_event(raw_body)
    if provider == "square":         return square_parse_event(raw_body)
    if provider == "mollie":         return mollie_parse_event(raw_body)
    if provider == "razorpay":       return razorpay_parse_event(raw_body)
    if provider == "paddle":         return paddle_parse_event(raw_body)
    if provider == "paybox":         return paybox_parse_event(raw_body)
    return {"type": "unknown", "raw_type": "", "event_id": "", "intent_id": "",
            "charge_id": "", "status": "", "amount": 0, "currency": "",
            "metadata": {}, "raw": {}}



def _get_org_payment_config(project_id: int) -> tuple[str, dict | None, bool, str]:
    """Returns (provider, credentials, is_test_mode, stripe_account_id).
    If org has no credentials row or provider is 'manual'/'other', returns ('manual', None, True, '').
    Never returns the credentials in a way that leaks them — caller is responsible
    for not echoing them back to the storefront.
    """
    row = db_one(
        "SELECT pc.provider, pc.credentials_encrypted, pc.is_test_mode, pc.is_connected,"
        "       pc.stripe_account_id"
        "  FROM crm_payment_credentials pc"
        "  JOIN crm_projects pr ON pr.org_id = (SELECT org_id FROM crm_projects WHERE id = %s)"
        " WHERE pc.org_id = pr.org_id LIMIT 1",
        (project_id,)
    )
    if not row or not row["credentials_encrypted"]:
        return ("manual", None, True, "")
    if row["provider"] in ("manual", "other"):
        return (row["provider"], None, bool(row["is_test_mode"]), "")
    if not row["is_connected"]:
        # Configured but not verified — treat as manual to avoid blocking checkout
        # behind unverified keys. The customer can still complete in manual mode.
        return ("manual", None, True, "")
    try:
        creds = decrypt_credentials(row["credentials_encrypted"])
    except (ValueError, RuntimeError):
        return ("manual", None, True, "")
    return (row["provider"], creds, bool(row["is_test_mode"]),
             row.get("stripe_account_id") or "")


def _compute_cart_total(cursor, project_id: int, user_id: int,
                         delivery_method: str, address: str,
                         promo_code: str | None) -> dict:
    """Re-runs the cart total computation without mutating anything.
    Returns {ok, subtotal, shipping, discount, total, items_count, currency} OR {ok: False, error}.

    Locks no rows (read-only) — for use in /orders/init-payment.
    """
    cursor.execute(
        "SELECT id FROM carts WHERE user_id=%s AND project_id=%s",
        (user_id, project_id)
    )
    cart = cursor.fetchone()
    if not cart:
        return {"ok": False, "error": "Cart is empty"}

    cursor.execute(
        "SELECT ci.quantity, ci.selected_modifier_item_ids, pc.price"
        "  FROM cart_items ci"
        "  JOIN product_configurations_l2 pc ON ci.configuration_id = pc.id"
        " WHERE ci.cart_id = %s",
        (cart["id"],)
    )
    rows = cursor.fetchall()
    if not rows:
        return {"ok": False, "error": "Cart is empty"}

    all_mod_ids = {mid for r in rows for mid in (r["selected_modifier_item_ids"] or [])}
    mod_delta = {}
    if all_mod_ids:
        cursor.execute(
            "SELECT id, price_delta FROM product_modifier_items WHERE id = ANY(%s)",
            (list(all_mod_ids),)
        )
        for r in cursor.fetchall():
            mod_delta[r["id"]] = float(r["price_delta"] or 0)

    subtotal = 0.0
    items_count = 0
    for r in rows:
        unit_price = float(r["price"] or 0)
        for mid in (r["selected_modifier_item_ids"] or []):
            unit_price += mod_delta.get(mid, 0.0)
        subtotal += unit_price * int(r["quantity"])
        items_count += int(r["quantity"])

    cursor.execute(
        "SELECT shipping_cost, free_shipping_threshold FROM shipping_settings WHERE project_id=%s LIMIT 1",
        (project_id,)
    )
    s = cursor.fetchone()
    shipping_cost  = float(s["shipping_cost"]) if s else 0.0
    free_threshold = float(s["free_shipping_threshold"]) if s else 0.0
    final_shipping = 0.0 if (delivery_method == "postal" or subtotal >= free_threshold) else shipping_cost

    discount = 0.0
    if promo_code:
        cursor.execute(
            "SELECT discount_type, discount_value, min_order_amount, is_active"
            "  FROM promo_codes WHERE code=%s AND project_id=%s",
            (promo_code.strip(), project_id)
        )
        p = cursor.fetchone()
        if p and p["is_active"] and subtotal >= float(p["min_order_amount"] or 0):
            if p["discount_type"] == "percent":
                discount = subtotal * float(p["discount_value"] or 0) / 100.0
            else:
                discount = float(p["discount_value"] or 0)
            discount = max(0.0, min(discount, subtotal))

    total = round(subtotal + final_shipping - discount, 2)
    return {
        "ok": True,
        "subtotal":    round(subtotal, 2),
        "shipping":    round(final_shipping, 2),
        "discount":    round(discount, 2),
        "total":       total,
        "items_count": items_count,
        "currency":    "USD",   # TODO: surface per-org/project currency once multi-currency lands
    }


@app.post("/{api_key}/orders/init-payment")
def init_payment(data: PlaceOrderRequest, request: Request,
                  api_key_record: dict = Depends(resolve_api_key)):
    """Step 1 of strict-mode checkout.

    Computes the cart total + creates a PaymentIntent on the merchant's provider account.
    Returns the data the storefront needs to launch its chosen UI (Stripe Elements,
    Checkout redirect, etc.). The order_history row is NOT created here — that happens
    only after the customer pays and POST /{api_key}/orders is called with the intent_id.

    Idempotency: caller can pass `idempotency_key` (UUID from frontend) so retrying the
    same logical "start checkout" click doesn't create multiple intents.
    """
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    if not user_id:
        raise HTTPException(401, "Login required to place an order")

    provider, creds, is_test_mode, stripe_account_id = _get_org_payment_config(project_id)

    # Compute total
    with db_cursor() as (conn, cursor):
        totals = _compute_cart_total(cursor, project_id, user_id,
                                       data.delivery_method, data.address or "",
                                       data.promo_code)
        if not totals["ok"]:
            raise HTTPException(400, totals["error"])

    if provider in ("manual", "other"):
        return {
            "provider":    provider,
            "intent_id":   "",
            "client_secret": "",
            "redirect_url": "",
            "publishable_key": "",
            "amount":      totals["total"],
            "currency":    totals["currency"],
            "needs_payment_intent": False,
        }

    if not creds:
        # Provider configured but credentials missing/broken — fall back to manual
        return {
            "provider":    "manual",
            "intent_id":   "",
            "client_secret": "",
            "redirect_url": "",
            "publishable_key": "",
            "amount":      totals["total"],
            "currency":    totals["currency"],
            "needs_payment_intent": False,
            "warning":     "Provider not connected; falling back to manual",
        }

    idemp_key = (request.headers.get("Idempotency-Key") or "").strip() or secrets.token_urlsafe(20)
    order_meta = {
        "project_id": project_id,
        "user_id":    user_id,
        "order_pending_id": idemp_key,
        "description": f"Order from project {project_id}",
    }

    # Per-project return_url for redirect-flow providers (YooKassa, PayPal)
    return_url = (get_project_frontend_url(project_id) or "") + "/checkout/return"

    result = create_intent(
        provider, creds,
        amount=totals["total"], currency=totals["currency"],
        order_metadata=order_meta,
        idempotency_key=idemp_key,
        is_test_mode=is_test_mode,
        stripe_account_id=stripe_account_id,
        return_url=return_url,
    )
    if not result["ok"]:
        raise HTTPException(400, f"Payment provider error: {result['error']}")

    d = result["data"]
    return {
        "provider":         provider,
        "intent_id":        d.get("intent_id", ""),
        "client_secret":    d.get("client_secret", ""),
        "redirect_url":     d.get("redirect_url", ""),
        "publishable_key":  d.get("publishable_key", "") or creds.get("publishable_key", ""),
        "public_id":        d.get("public_id", ""),
        "amount":           totals["total"],
        "currency":         totals["currency"],
        "needs_payment_intent": True,
        "is_test_mode":     is_test_mode,
    }


@app.post("/{api_key}/orders")
def place_order(data: PlaceOrderRequest, request: Request,
                background_tasks: BackgroundTasks,
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
            "ci.selected_modifier_item_ids, "
            "pc.price, pc.stock_quantity, p.title, p.product_type, pv.variation_name "
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

        # Stock check: continue_selling_oos = row-level bypass; checkout uses raw stock_quantity.
        product_flags = {}
        if items:
            ids = list({it["product_id"] for it in items})
            cursor.execute("SELECT id, continue_selling_oos FROM products WHERE id = ANY(%s)", (ids,))
            for r in cursor.fetchall():
                product_flags[r["id"]] = bool(r.get("continue_selling_oos"))

        # CRITICAL: lock the per-SKU stock aggregates BEFORE validating against
        # them. Without these locks two concurrent buyers can both pass the
        # check on the last unit and oversell into negative stock. We sort SKU
        # ids ascending to give a deterministic lock order and avoid deadlocks
        # when two carts share some-but-not-all SKUs.
        sku_ids_sorted = sorted({int(it["configuration_id"]) for it in items})
        cursor.execute(
            "SELECT sku_id, COALESCE(SUM(quantity), 0) AS total"
            "  FROM product_stock"
            " WHERE sku_id = ANY(%s)"
            " GROUP BY sku_id"
            " FOR UPDATE",                  # locks every product_stock row for these SKUs
            (sku_ids_sorted,)
        )
        live_stock = {int(r["sku_id"]): int(r["total"] or 0) for r in cursor.fetchall()}

        for it in items:
            sid = int(it["configuration_id"])
            # Use the live locked value, not the cart row's stale stock_quantity
            # (which was a JOIN snapshot before the lock was acquired).
            available = live_stock.get(sid, 0)
            if not product_flags.get(it["product_id"]) and available < it["quantity"]:
                raise HTTPException(400, f"Not enough stock for {it['title']}")

        # Per-line modifier price deltas (carried into order_items unit price snapshot).
        all_mod_ids = {mid for it in items for mid in (it["selected_modifier_item_ids"] or [])}
        mod_delta_by_id = {}
        if all_mod_ids:
            cursor.execute(
                "SELECT id, price_delta FROM product_modifier_items WHERE id = ANY(%s)",
                (list(all_mod_ids),)
            )
            for r in cursor.fetchall():
                mod_delta_by_id[r["id"]] = float(r["price_delta"] or 0)
        from datetime import timezone as _tz
        _checkout_now = datetime.now(_tz.utc)
        for it in items:
            it["mod_delta_total"] = sum(
                mod_delta_by_id.get(mid, 0)
                for mid in (it["selected_modifier_item_ids"] or [])
            )
            # Pricing layer: base → tier → sale → modifiers (sale walks L2 → L1 → product).
            sku_id = it.get("configuration_id")
            base_price = float(it["price"] or 0)
            tier_price = _resolve_unit_price(cursor, sku_id, base_price, it["quantity"]) if sku_id else base_price
            after_sale = tier_price
            if sku_id:
                st, sv, _, _ = _resolve_sku_sale_walkup(cursor, sku_id, _checkout_now)
                if st:
                    after_sale = _apply_sale(tier_price, st, sv)
            it["tier_price"] = tier_price
            it["unit_price"] = after_sale + it["mod_delta_total"]

        subtotal = sum(it["unit_price"] * it["quantity"] for it in items)

        # Промокод
        discount = 0.0
        applied_promo_id = None
        if data.promo_code:
            cursor.execute(
                "SELECT * FROM promo_codes WHERE code=%s AND project_id=%s AND is_active=TRUE",
                (data.promo_code.strip().upper(), project_id)
            )
            promo = cursor.fetchone()
            if promo:
                from datetime import timezone as _tz
                now = datetime.now(_tz.utc)
                # Phase 1: per-user limit & category restriction.
                per_user_ok = True
                if promo.get("per_user_limit"):
                    cursor.execute(
                        "SELECT COUNT(*) AS n FROM promo_code_uses WHERE promo_id=%s AND user_id=%s",
                        (promo["id"], user_id)
                    )
                    if int((cursor.fetchone() or {}).get("n") or 0) >= int(promo["per_user_limit"]):
                        per_user_ok = False
                cat_ok = True
                cat_ids = list(promo.get("category_ids") or [])
                if cat_ids:
                    cart_cats = {it["category_id"] for it in items if "category_id" in it}
                    if not cart_cats:
                        # category_id not pre-fetched on items; recompute now
                        cursor.execute(
                            "SELECT DISTINCT p.category_id FROM cart_items ci"
                            "  JOIN products p ON ci.product_id = p.id"
                            " WHERE ci.cart_id=%s",
                            (cart["id"],)
                        )
                        cart_cats = {r["category_id"] for r in cursor.fetchall()}
                    if None in cart_cats or not cart_cats.issubset(set(cat_ids)):
                        cat_ok = False
                if (per_user_ok and cat_ok and
                    (not promo["valid_from"] or promo["valid_from"] <= now) and
                    (not promo["valid_until"] or promo["valid_until"] >= now) and
                    subtotal >= float(promo["min_order_amount"]) and
                    (not promo["usage_limit"] or promo["times_used"] < promo["usage_limit"])):
                    dv = float(promo["discount_value"])
                    if promo["discount_type"] == "percentage":
                        discount = subtotal * (dv / 100)
                        if promo["max_discount"]: discount = min(discount, float(promo["max_discount"]))
                    else:
                        discount = dv
                    cursor.execute(
                        "UPDATE promo_codes SET times_used = times_used + 1 WHERE id=%s", (promo["id"],)
                    )
                    applied_promo_id = promo["id"]

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

        # ── Payment validation (Strict mode) ──────────────────────────────
        # If the org has a real provider configured, the customer MUST have already
        # paid via init-payment + provider-side checkout. We re-fetch the intent
        # from the provider here, validate status + amount, and capture the
        # intent_id/charge_id into order_history.
        provider, creds, is_test_mode, stripe_account_id = _get_org_payment_config(project_id)
        pay_status        = "manual"
        pay_intent_id     = ""
        pay_charge_id     = ""
        pay_amount_paid   = 0.0
        pay_currency      = "USD"
        pay_provider      = provider

        if provider not in ("manual", "other") and creds:
            intent_id = (data.payment_intent_id or "").strip()
            if not intent_id:
                raise HTTPException(402,
                    f"Payment intent required for provider {provider}. "
                    "Call POST /orders/init-payment first.")
            # Idempotency: refuse if an order already exists with this intent_id.
            cursor.execute(
                "SELECT id FROM order_history WHERE payment_intent_id=%s AND project_id=%s",
                (intent_id, project_id)
            )
            dup = cursor.fetchone()
            if dup:
                raise HTTPException(409, f"Intent {intent_id} already used for order #{dup['id']}")

            # Re-fetch intent from provider to verify status + amount server-side.
            verify = get_intent(provider, creds, intent_id=intent_id,
                                     is_test_mode=is_test_mode,
                                     stripe_account_id=stripe_account_id)
            if not verify["ok"]:
                raise HTTPException(400, f"Failed to verify payment: {verify['error']}")
            v = verify["data"]
            terminal_states = {
                "stripe":        {"succeeded"},
                "tinkoff":       {"CONFIRMED", "AUTHORIZED"},
                "cloudpayments": {"Completed"},
                "yookassa":      {"succeeded"},
                "paypal":        {"COMPLETED", "APPROVED"},
            }
            if v.get("status") not in terminal_states.get(provider, set()):
                raise HTTPException(402, f"Payment not completed (provider status: {v.get('status')})")

            # Amount validation. Stripe/Tinkoff use minor units (cents/kopecks),
            # YooKassa/PayPal use major units (string decimal). Normalise to dollars.
            provider_amount = v.get("amount", 0)
            if provider in ("stripe", "tinkoff", "cloudpayments"):
                provider_dollars = float(provider_amount) / 100.0
            else:
                try:
                    provider_dollars = float(provider_amount)
                except (TypeError, ValueError):
                    provider_dollars = 0.0
            # Allow 0.02 tolerance for rounding (e.g. tax computed differently)
            if abs(provider_dollars - float(total)) > 0.02:
                raise HTTPException(409,
                    f"Cart total changed since payment: provider charged {provider_dollars}, "
                    f"cart is {total}. Customer should re-init checkout.")

            pay_status      = "paid"
            pay_intent_id   = intent_id
            pay_charge_id   = v.get("charge_id") or intent_id
            pay_amount_paid = provider_dollars
            pay_currency    = (v.get("currency") or "USD").upper()
            pay_provider    = provider

        # Создаём заказ
        cursor.execute(
            """INSERT INTO order_history
               (project_id, user_id, total_amount, status,
                delivery_method, recipient_name, phone, address, comment, payment_method,
                payment_intent_id, payment_charge_id, payment_status, payment_provider,
                payment_currency, payment_amount_paid, payment_paid_at)
               VALUES (%s,%s,%s,'new',%s,%s,%s,%s,%s,%s,
                       %s,%s,%s,%s,%s,%s, CASE WHEN %s='paid' THEN NOW() ELSE NULL END)
               RETURNING id""",
            (project_id, user_id, round(float(total), 2),
             data.delivery_method, rn,
             sanitize(data.phone or ""), sanitize(data.address or ""),
             sanitize(data.comment or ""), data.payment_method,
             pay_intent_id, pay_charge_id, pay_status, pay_provider,
             pay_currency, round(pay_amount_paid, 2), pay_status)
        )
        order_id = cursor.fetchone()["id"]

        # Phase 1: log promo_code_uses for per_user_limit enforcement on
        # subsequent attempts. Only when promo was actually applied to this order.
        if applied_promo_id is not None:
            cursor.execute(
                "INSERT INTO promo_code_uses (promo_id, project_id, user_id, order_id)"
                " VALUES (%s, %s, %s, %s)",
                (applied_promo_id, project_id, user_id, order_id)
            )

        # Phase 5b: proximity routing — pick a warehouse matched against the customer's shipping address; per-SKU fallback if that WH is out of stock.
        shipping_addr_lower = (data.address or "").lower()
        cursor.execute(
            "SELECT id, country, city, region, is_default FROM warehouses"
            " WHERE project_id=%s AND is_active = TRUE",
            (project_id,)
        )
        wh_options = [dict(r) for r in cursor.fetchall()]
        default_wh = next((w for w in wh_options if w["is_default"]), None)

        def _pick_wh_for_sku(sku_id: int) -> int | None:
            """City match > country match > default. Skips warehouses with insufficient stock so we route to the next-closest one with capacity."""
            if not wh_options:
                return None
            # Find warehouses with enough stock for this SKU first.
            cursor.execute(
                "SELECT warehouse_id, quantity FROM product_stock WHERE sku_id=%s",
                (sku_id,)
            )
            stock_by_wh = {r["warehouse_id"]: r["quantity"] for r in cursor.fetchall()}

            def rank(w):
                city    = (w.get("city")    or "").lower()
                country = (w.get("country") or "").lower()
                if city and city in shipping_addr_lower:       return 0     # exact city match wins
                if country and country in shipping_addr_lower: return 1     # country match second
                if w["is_default"]:                            return 2     # default is safe fallback
                return 3
            ranked = sorted(wh_options, key=rank)
            # Pick first warehouse that has enough stock; fall back to default if none.
            for w in ranked:
                if stock_by_wh.get(w["id"], 0) >= int(it["quantity"]):
                    return w["id"]
            return (default_wh or wh_options[0])["id"]

        # Позиции заказа — price snapshots the unit price INCLUDING modifier deltas
        # so order history shows the price the customer actually paid per unit.
        for it in items:
            # Event-type products get a human-readable access code (XXXX-XXXX) saved alongside the order_item — backup if QR doesn't scan. Attached to `it` so the order-email builder can render it.
            access_code = None
            if it.get("product_type") == "event":
                access_code = _generate_access_code(cursor)
                it["access_code"] = access_code
            cursor.execute(
                "INSERT INTO order_items (order_id, product_id, variation_id, configuration_id, quantity, price, selected_modifier_item_ids, access_code) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (order_id, it["product_id"], it["variation_id"], it["configuration_id"],
                 it["quantity"], round(it["unit_price"], 2),
                 sorted(it["selected_modifier_item_ids"] or []),
                 access_code)
            )
            it["id"] = cursor.fetchone()["id"]
            # Phase 5b — write through to product_stock at the proximity-matched WH; re-sync l2.stock_quantity aggregate.
            wh_id = _pick_wh_for_sku(it["configuration_id"])
            if wh_id:
                cursor.execute(
                    "INSERT INTO product_stock (sku_id, warehouse_id, quantity, sold_quantity)"
                    " VALUES (%s, %s, %s, %s)"
                    " ON CONFLICT (sku_id, warehouse_id)"
                    " DO UPDATE SET quantity      = product_stock.quantity      - EXCLUDED.quantity,"
                    "               sold_quantity = product_stock.sold_quantity + EXCLUDED.sold_quantity",
                    (it["configuration_id"], wh_id, -int(it["quantity"]), int(it["quantity"]))
                )
            cursor.execute("SET LOCAL torta.skip_audit = 'on'")
            cursor.execute(
                "UPDATE product_configurations_l2"
                "   SET stock_quantity = COALESCE("
                "         (SELECT SUM(quantity) FROM product_stock WHERE sku_id=%s),"
                "         stock_quantity - %s),"
                "       sold_quantity  = sold_quantity + %s"
                " WHERE id=%s",
                (it["configuration_id"], it["quantity"],
                 it["quantity"], it["configuration_id"])
            )

            # Batch consumption: decrement quantity_remaining on inventory_batches in order dictated by project's batch_consumption_mode (FIFO default, LIFO opt-in). Skip frozen batches.
            cursor.execute(
                "SELECT batch_consumption_mode FROM crm_projects WHERE id=%s",
                (project_id,)
            )
            cmode_row = cursor.fetchone()
            cmode = (cmode_row or {}).get("batch_consumption_mode") or 'fifo'
            order_clause = "received_at ASC, id ASC" if cmode == 'fifo' else "received_at DESC, id DESC"
            remaining_to_consume = int(it["quantity"])
            cursor.execute(
                "SELECT id, batch_name, quantity_remaining"
                "  FROM inventory_batches"
                " WHERE sku_id=%s AND warehouse_id=%s"
                "   AND is_frozen = FALSE AND quantity_remaining > 0"
                " ORDER BY " + order_clause +
                " FOR UPDATE",
                (it["configuration_id"], wh_id)
            )
            batches = cursor.fetchall()
            consumed_from = []
            for batch in batches:
                if remaining_to_consume <= 0: break
                take = min(int(batch["quantity_remaining"]), remaining_to_consume)
                cursor.execute(
                    "UPDATE inventory_batches"
                    "   SET quantity_remaining = quantity_remaining - %s"
                    " WHERE id=%s",
                    (take, batch["id"])
                )
                consumed_from.append((batch["id"], batch["batch_name"], take))
                remaining_to_consume -= take

            # Phase 6: stock log entry for audit. One row per batch consumed so the trail is auditable per partition.
            if consumed_from:
                for bid, bname, take in consumed_from:
                    cursor.execute(
                        "INSERT INTO product_stock_log"
                        "  (project_id, sku_id, warehouse_id, delta, reason, reference_id, note)"
                        " VALUES (%s, %s, %s, %s, 'sale', %s, %s)",
                        (project_id, it["configuration_id"], wh_id, -take,
                         order_id, f"Order #{order_id} · batch {bname}")
                    )
            else:
                # No batches existed (legacy stock or untracked SKU) — still log the sale.
                cursor.execute(
                    "INSERT INTO product_stock_log"
                    "  (project_id, sku_id, warehouse_id, delta, reason, reference_id, note)"
                    " VALUES (%s, %s, %s, %s, 'sale', %s, %s)",
                    (project_id, it["configuration_id"], wh_id, -int(it["quantity"]),
                     order_id, f"Order #{order_id}")
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

        digital_html = _build_digital_html(project_id, items)
        event_html   = _build_event_html(api_key_record["api_key"], items, order_id)

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
                + digital_html + event_html +
                "<p>We will notify you when the status changes.</p>"
                "</div>"
            ),
            from_name=from_name,
            from_email=from_email,
        )

    # Outbound webhooks: fire both order.created and order.paid (no async payment provider yet).
    event_data = {
        "order_id": order_id,
        "amount":   float(total),
        "currency": "USD",
        "customer": {"name": (user or {}).get("name", "") or rn,
                     "email": (user or {}).get("email", "")},
        "items": [{"product_id": it["product_id"], "title": it["title"],
                   "variation": it.get("variation_name"), "qty": it["quantity"],
                   "price": float(it["price"])} for it in items],
        "delivery_method": data.delivery_method,
    }
    background_tasks.add_task(dispatch_event, project_id, "order.created", event_data)
    background_tasks.add_task(dispatch_event, project_id, "order.paid",    event_data)
    return {"success": True, "order_id": order_id}


def _build_digital_html(project_id: int, items: list) -> str:
    """Render 'Your downloads' block from product_custom_fields(field_type='file'); '' if none."""
    digital_ids = [it["product_id"] for it in items if it.get("product_type") == "digital"]
    if not digital_ids: return ""
    fmt = ",".join(["%s"] * len(digital_ids))
    rows = db_all(
        f"SELECT product_id, field_key, field_value FROM product_custom_fields "
        f"WHERE project_id=%s AND product_id IN ({fmt}) AND field_type='file' AND field_value <> ''",
        tuple([project_id] + digital_ids)
    )
    if not rows: return ""
    titles = {it["product_id"]: it["title"] for it in items}
    lines = []
    for r in rows:
        url = sanitize(r["field_value"])
        title = sanitize(titles.get(r["product_id"]) or "")
        key = sanitize(r["field_key"])
        lines.append(
            f"<li style='margin:6px 0'><b>{title}</b> &middot; "
            f"<a href='{url}' style='color:#0071E3'>{key}</a></li>"
        )
    return (
        "<hr style='margin:16px 0'>"
        "<h3 style='margin:0 0 8px;color:#111'>Your downloads</h3>"
        "<ul style='padding-left:18px;margin:0'>" + "".join(lines) + "</ul>"
    )


def _build_event_html(api_key: str, items: list, order_id: int) -> str:
    """Render 'Your tickets' block — one QR per event item + access code + order number. Backup if QR doesn't scan: support can verify by reading the code aloud."""
    event_items = [it for it in items if it.get("product_type") == "event"]
    if not event_items: return ""
    try:
        import qrcode, io as _io, base64 as _b64
    except Exception:
        return ""
    parts = [f"<hr style='margin:16px 0'><h3 style='margin:0 0 8px;color:#111'>Your tickets · Order #{order_id}</h3>"]
    for it in event_items:
        access_code = (it.get("access_code") or "").strip()
        for n in range(int(it["quantity"])):
            token = _sign_ticket(order_id, it["id"], n)
            url = f"{MAGAZ_BACKEND_URL}/{api_key}/tickets/verify?t={token}"
            buf = _io.BytesIO()
            qrcode.make(url).save(buf, format="PNG")
            b64 = _b64.b64encode(buf.getvalue()).decode("ascii")
            title = sanitize(it["title"])
            sub   = sanitize(it["variation_name"] or "")
            ac_html = (
                f"<div style='margin-top:8px;font-family:monospace;letter-spacing:2px;font-size:14px;color:#111'>"
                f"Access code: <b>{sanitize(access_code)}</b></div>"
            ) if access_code else ""
            parts.append(
                "<div style='margin:12px 0;padding:12px;border:1px solid #eee;border-radius:12px;text-align:center'>"
                f"<div style='font-weight:600;margin-bottom:8px'>{title}</div>"
                f"<div style='color:#666;font-size:13px;margin-bottom:8px'>{sub} &middot; ticket {n+1} of {it['quantity']}</div>"
                f"<img src='data:image/png;base64,{b64}' alt='QR' style='width:140px;height:140px' />"
                f"{ac_html}"
                "</div>"
            )
    return "".join(parts)


# Access codes: human-readable 8-char backup for event tickets (alphabet avoids O/0/I/1/L for legibility). Stored on order_items.access_code; emailed alongside the QR.
_ACCESS_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

def _generate_access_code(cursor) -> str:
    """Pick a unique 8-char code (4-4 grouped). Retries up to 25 times — the alphabet space is ~30^8 ≈ 6.5e11, collisions are vanishingly rare."""
    for _ in range(25):
        raw = ''.join(secrets.choice(_ACCESS_CODE_ALPHABET) for _ in range(8))
        code = f"{raw[:4]}-{raw[4:]}"
        cursor.execute("SELECT 1 FROM order_items WHERE access_code=%s LIMIT 1", (code,))
        if not cursor.fetchone():
            return code
    return None   # caller falls back to QR-only


def _sign_ticket(order_id: int, order_item_id: int, idx: int) -> str:
    """HMAC-SHA256 signed token: base64url('{order_id}.{item_id}.{idx}.{sig8}')."""
    import hmac as _hmac, hashlib as _hl, base64 as _b64
    msg = f"{order_id}.{order_item_id}.{idx}".encode()
    sig = _hmac.new(SECRET_KEY.encode(), msg, _hl.sha256).hexdigest()[:16]
    raw = f"{order_id}.{order_item_id}.{idx}.{sig}".encode()
    return _b64.urlsafe_b64encode(raw).decode().rstrip("=")


@app.get("/{api_key}/tickets/verify")
def verify_ticket(api_key: str, t: str = "",
                  api_key_record: dict = Depends(resolve_api_key_public)):
    """Public endpoint — staff scans QR with phone, browser hits this URL, gets a JSON status."""
    import hmac as _hmac, hashlib as _hl, base64 as _b64
    try:
        pad = "=" * ((4 - len(t) % 4) % 4)
        raw = _b64.urlsafe_b64decode(t + pad).decode()
        order_id, item_id, idx, sig = raw.split(".")
        msg = f"{order_id}.{item_id}.{idx}".encode()
        expected = _hmac.new(SECRET_KEY.encode(), msg, _hl.sha256).hexdigest()[:16]
        if not _hmac.compare_digest(sig, expected):
            return {"ok": False, "error": "invalid_signature"}
    except Exception:
        return {"ok": False, "error": "malformed"}
    project_id = api_key_record["id"]
    row = db_one(
        "SELECT oh.status, oh.recipient_name, p.title, pv.variation_name "
        "FROM order_items oi JOIN order_history oh ON oi.order_id=oh.id "
        "JOIN products p ON oi.product_id=p.id "
        "LEFT JOIN product_configurations_l1 pv ON oi.variation_id=pv.id "
        "WHERE oi.id=%s AND oh.id=%s AND oh.project_id=%s",
        (int(item_id), int(order_id), project_id)
    )
    if not row: return {"ok": False, "error": "not_found"}
    valid = row["status"] not in ("cancelled", "refunded")
    return {
        "ok": valid,
        "order_id": int(order_id),
        "ticket_idx": int(idx),
        "title": row["title"],
        "variation": row["variation_name"],
        "recipient": row["recipient_name"],
        "status": row["status"],
    }


@app.get("/{api_key}/tickets/verify-code")
def verify_ticket_by_code(api_key: str, code: str = "",
                          api_key_record: dict = Depends(resolve_api_key_public)):
    """Same JSON shape as /tickets/verify, but matched by the human-readable access code instead of the QR token. Used at the door if scanner can't read the QR."""
    project_id = api_key_record["id"]
    c = (code or "").strip().upper()[:16]
    if not c:
        return {"ok": False, "error": "missing_code"}
    row = db_one(
        "SELECT oi.id AS item_id, oh.id AS order_id, oh.status, oh.recipient_name,"
        "       p.title, pv.variation_name"
        "  FROM order_items oi"
        "  JOIN order_history oh ON oi.order_id = oh.id"
        "  JOIN products p ON oi.product_id = p.id"
        "  LEFT JOIN product_configurations_l1 pv ON oi.variation_id = pv.id"
        " WHERE oi.access_code = %s AND oh.project_id = %s",
        (c, project_id)
    )
    if not row: return {"ok": False, "error": "not_found"}
    valid = row["status"] not in ("cancelled", "refunded")
    return {
        "ok": valid,
        "order_id": row["order_id"],
        "item_id":  row["item_id"],
        "title":    row["title"],
        "variation": row["variation_name"],
        "recipient": row["recipient_name"],
        "status":   row["status"],
    }


@app.get("/{api_key}/orders/{order_id}/tickets")
def get_order_tickets(api_key: str, order_id: int, request: Request,
                      api_key_record: dict = Depends(resolve_api_key)):
    """Storefront/mobile-app endpoint: returns ticket payloads (QR URL + access code) for displaying on a customer's screen. Customer must own the order."""
    project_id = api_key_record["id"]
    token = request.cookies.get("authx_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        user_id = int(jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])["sub"])
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

    order = db_one(
        "SELECT id, status, user_id FROM order_history WHERE id=%s AND project_id=%s",
        (order_id, project_id)
    )
    if not order or order["user_id"] != user_id:
        raise HTTPException(404, "Order not found")

    rows = db_all(
        "SELECT oi.id AS item_id, oi.quantity, oi.access_code,"
        "       p.title, p.product_type, pv.variation_name"
        "  FROM order_items oi"
        "  JOIN products p ON oi.product_id = p.id"
        "  LEFT JOIN product_configurations_l1 pv ON oi.variation_id = pv.id"
        " WHERE oi.order_id = %s",
        (order_id,)
    )
    tickets = []
    for r in rows:
        if r.get("product_type") != "event": continue
        for n in range(int(r["quantity"])):
            token_s = _sign_ticket(order_id, r["item_id"], n)
            tickets.append({
                "item_id":     r["item_id"],
                "title":       r["title"],
                "variation":   r["variation_name"],
                "ticket_idx":  n,
                "qr_url":      f"{MAGAZ_BACKEND_URL}/{api_key}/tickets/verify?t={token_s}",
                "verify_token": token_s,
                "access_code":  r["access_code"],
            })
    return {"order_id": order_id, "status": order["status"], "tickets": tickets}


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
                  oh.created_at, oh.updated_at, oh.delivered_at
           FROM order_history oh
           WHERE oh.user_id=%s AND oh.project_id=%s
           ORDER BY oh.created_at DESC""",
        (user_id, project_id)
    )

    result = []
    for o in orders:
        items = db_all(
            """SELECT oi.id AS order_item_id, oi.quantity, oi.price, oi.selected_modifier_item_ids,
                      p.title, pv.variation_name, (pv.images)[1] AS image_url, pc.configuration_name
               FROM order_items oi
               JOIN products p ON oi.product_id=p.id
               JOIN product_configurations_l1 pv ON oi.variation_id=pv.id
               JOIN product_configurations_l2 pc ON oi.configuration_id=pc.id
               WHERE oi.order_id=%s
               ORDER BY oi.id""",
            (o["id"],)
        )
        # Bulk-fetch modifier item names referenced by any line in this order.
        mod_ids = {mid for it in items for mid in (it["selected_modifier_item_ids"] or [])}
        mod_meta = {}
        if mod_ids:
            mods = db_all(
                "SELECT i.id, i.name, i.price_delta, g.name AS group_name"
                "  FROM product_modifier_items i"
                "  JOIN product_modifier_groups g ON i.group_id = g.id"
                " WHERE i.id = ANY(%s)",
                (list(mod_ids),)
            )
            for m in mods:
                mod_meta[m["id"]] = {
                    "id":          m["id"],
                    "name":        m["name"],
                    "price_delta": float(m["price_delta"] or 0),
                    "group_name":  m["group_name"],
                }
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
            # Required by the return-request UI to anchor the 14-day window —
            # if missing, frontend falls back to created_at (stricter than backend).
            "delivered_at":    o["delivered_at"].isoformat() if o.get("delivered_at") else None,
            "items": [
                {
                    # order_item_id is required by request-return so the backend can
                    # look up the row in order_items. Without it the modal sends
                    # array-index ints and the request 400s with "items don't belong".
                    "order_item_id":      it["order_item_id"],
                    "title":              it["title"],
                    "variation_name":     it["variation_name"],
                    "configuration_name": it["configuration_name"],
                    "image_url":          it["image_url"],
                    "quantity":           it["quantity"],
                    "price":              float(it["price"]),
                    # Per-line modifier snapshot — names visible even if items were
                    # later renamed/deleted in CRM (DB still holds names via JOIN at read time).
                    "modifiers": [
                        mod_meta[mid] for mid in (it["selected_modifier_item_ids"] or [])
                        if mid in mod_meta
                    ],
                }
                for it in items
            ],
        })
    return result


# ── RETURNS / REFUNDS (customer-initiated) ───────────────
# Customer can request a return within 14 days of delivery (or order creation as fallback).
# Merchant reviews + approves/rejects in CRM. Refund is record-only (Variant A).

RETURN_WINDOW_DAYS = 14
RETURN_REASONS = ("damaged", "wrong_item", "not_as_described", "changed_mind",
                  "arrived_late", "quality_issue", "other")
ACTIVE_RETURN_STATUSES = ("requested", "approved", "received", "inspected")  # still open / not refundable again


@app.get("/{api_key}/orders/{order_id}/returns")
def get_my_order_returns(api_key: str, order_id: int, request: Request,
                          api_key_record: dict = Depends(resolve_api_key)):
    """List the customer's return requests for one of their orders."""
    project_id = api_key_record["id"]
    token = request.cookies.get("authx_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        user_id = int(jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])["sub"])
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

    order = db_one(
        "SELECT id, user_id FROM order_history WHERE id=%s AND project_id=%s",
        (order_id, project_id)
    )
    if not order or order["user_id"] != user_id:
        raise HTTPException(404, "Order not found")

    rows = db_all(
        """SELECT r.id, r.status, r.reason, r.customer_message, r.customer_photos,
                  r.refund_amount, r.refund_method, r.refund_processed_at,
                  r.rejected_reason, r.created_at, r.updated_at
             FROM order_returns r
            WHERE r.order_id=%s AND r.project_id=%s
            ORDER BY r.created_at DESC""",
        (order_id, project_id)
    )
    result = []
    for r in rows:
        items = db_all(
            """SELECT ri.id, ri.order_item_id, ri.quantity, ri.condition,
                      p.title, pv.variation_name, pc.configuration_name,
                      (pv.images)[1] AS image_url
                 FROM order_return_items ri
                 JOIN order_items oi ON ri.order_item_id = oi.id
                 JOIN products p ON oi.product_id = p.id
                 JOIN product_configurations_l1 pv ON oi.variation_id = pv.id
                 JOIN product_configurations_l2 pc ON oi.configuration_id = pc.id
                WHERE ri.return_id=%s""",
            (r["id"],)
        )
        result.append({
            "id":               r["id"],
            "status":           r["status"],
            "reason":           r["reason"],
            "customer_message": r["customer_message"] or "",
            "customer_photos":  r["customer_photos"] or [],
            "refund_amount":    float(r["refund_amount"] or 0),
            "refund_method":    r["refund_method"] or "",
            "refund_processed_at": r["refund_processed_at"].isoformat() if r["refund_processed_at"] else None,
            "rejected_reason":  r["rejected_reason"] or "",
            "created_at":       r["created_at"].isoformat() if r["created_at"] else None,
            "updated_at":       r["updated_at"].isoformat() if r["updated_at"] else None,
            "items": [
                {
                    "id":               it["id"],
                    "order_item_id":    it["order_item_id"],
                    "quantity":         int(it["quantity"]),
                    "condition":        it["condition"],
                    "title":            it["title"],
                    "variation_name":   it["variation_name"],
                    "configuration_name": it["configuration_name"],
                    "image_url":        it["image_url"],
                }
                for it in items
            ],
        })
    return result


@app.post("/{api_key}/orders/{order_id}/request-return")
def request_return(api_key: str, order_id: int, body: RequestReturnBody,
                    request: Request,
                    api_key_record: dict = Depends(resolve_api_key)):
    """Customer initiates a return for items from a delivered order.
       Validates: ownership, 14-day window, items belong to the order, no duplicate active returns."""
    project_id = api_key_record["id"]
    token = request.cookies.get("authx_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        user_id = int(jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])["sub"])
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

    if body.reason not in RETURN_REASONS:
        raise HTTPException(400, f"Invalid reason. Allowed: {RETURN_REASONS}")
    if not body.items:
        raise HTTPException(400, "At least one item is required")

    order = db_one(
        "SELECT id, user_id, status, delivered_at, created_at, total_amount"
        "  FROM order_history WHERE id=%s AND project_id=%s",
        (order_id, project_id)
    )
    if not order or order["user_id"] != user_id:
        raise HTTPException(404, "Order not found")
    if order["status"] in ("cancelled", "refunded"):
        raise HTTPException(400, f"Order is already {order['status']}")

    # 14-day window: delivered_at if available, else created_at
    anchor = order["delivered_at"] or order["created_at"]
    if anchor:
        anchor_aware = anchor if anchor.tzinfo else anchor.replace(tzinfo=timezone.utc)
        elapsed = datetime.now(timezone.utc) - anchor_aware
        if elapsed.days > RETURN_WINDOW_DAYS:
            raise HTTPException(400,
                f"Return window of {RETURN_WINDOW_DAYS} days has expired ({elapsed.days} days elapsed)")

    # Validate each requested item against the order
    item_ids = [it.order_item_id for it in body.items]
    if len(set(item_ids)) != len(item_ids):
        raise HTTPException(400, "Duplicate items in request")
    order_items = db_all(
        "SELECT id, quantity, price FROM order_items WHERE order_id=%s AND id = ANY(%s)",
        (order_id, item_ids)
    )
    oi_by_id = {it["id"]: it for it in order_items}
    if len(oi_by_id) != len(item_ids):
        raise HTTPException(400, "Some items don't belong to this order")
    for it in body.items:
        if it.quantity < 1:
            raise HTTPException(400, "Quantity must be at least 1")
        oi = oi_by_id[it.order_item_id]
        if it.quantity > int(oi["quantity"]):
            raise HTTPException(400,
                f"Cannot return {it.quantity} of item {it.order_item_id} — only {oi['quantity']} purchased")

    # Block duplicate active returns for the same line item
    existing = db_all(
        """SELECT ri.order_item_id, SUM(ri.quantity) AS qty
             FROM order_return_items ri
             JOIN order_returns r ON ri.return_id = r.id
            WHERE r.order_id=%s AND r.status = ANY(%s)
            GROUP BY ri.order_item_id""",
        (order_id, list(ACTIVE_RETURN_STATUSES))
    )
    active_by_item = {row["order_item_id"]: int(row["qty"] or 0) for row in existing}
    for it in body.items:
        ordered = int(oi_by_id[it.order_item_id]["quantity"])
        already_returning = active_by_item.get(it.order_item_id, 0)
        if already_returning + it.quantity > ordered:
            raise HTTPException(400,
                f"Item {it.order_item_id}: {already_returning} already in an active return, "
                f"can only request {ordered - already_returning} more")

    photos = [sanitize(p)[:1000] for p in (body.customer_photos or [])][:10]

    with db_cursor() as (conn, cur):
        cur.execute(
            "INSERT INTO order_returns"
            "  (order_id, project_id, customer_user_id, status, reason,"
            "   customer_message, customer_photos)"
            " VALUES (%s, %s, %s, 'requested', %s, %s, %s::jsonb) RETURNING id, created_at",
            (order_id, project_id, user_id, body.reason,
             sanitize(body.customer_message or "")[:2000],
             json.dumps(photos))
        )
        row = cur.fetchone()
        return_id = row["id"]
        for it in body.items:
            cur.execute(
                "INSERT INTO order_return_items (return_id, order_item_id, quantity)"
                " VALUES (%s, %s, %s)",
                (return_id, it.order_item_id, it.quantity)
            )
        conn.commit()

    # Notify CRM owner + team members in-app (bell icon).
    owners = db_all(
        "SELECT u.id FROM crm_users u JOIN crm_projects pr ON pr.crm_user_id = u.id"
        " WHERE pr.id = %s"
        " UNION SELECT tm.crm_user_id FROM crm_team_members tm WHERE tm.project_id = %s",
        (project_id, project_id)
    )
    proj = db_one("SELECT api_key FROM crm_projects WHERE id=%s", (project_id,))
    link = f"/project/{proj['api_key']}/orders?tab=returns&open={return_id}" if proj else None
    with db_cursor() as (conn, cur):
        for o in owners:
            if not o.get("id"): continue
            cur.execute(
                "INSERT INTO crm_notifications (user_id, project_id, type, title, message, link)"
                " VALUES (%s, %s, 'return', %s, %s, %s)",
                (o["id"], project_id,
                 f"New return request #{return_id}",
                 (body.customer_message or f"Reason: {body.reason}")[:500],
                 link)
            )
        conn.commit()

    return {"ok": True, "return_id": return_id, "status": "requested"}


@app.post("/{api_key}/orders/{order_id}/returns/{return_id}/cancel")
def cancel_return(api_key: str, order_id: int, return_id: int, request: Request,
                   api_key_record: dict = Depends(resolve_api_key)):
    """Customer cancels their own return request.

    Only allowed while status='requested' — once the merchant has acted
    (approved/rejected/received/etc), the customer can't unilaterally undo it
    and has to message the merchant. This is the common "I clicked by mistake" path.
    """
    project_id = api_key_record["id"]
    token = request.cookies.get("authx_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        user_id = int(jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])["sub"])
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

    r = db_one(
        "SELECT r.id, r.status, r.customer_user_id"
        "  FROM order_returns r"
        " WHERE r.id=%s AND r.order_id=%s AND r.project_id=%s",
        (return_id, order_id, project_id)
    )
    if not r:
        raise HTTPException(404, "Return not found")
    if r["customer_user_id"] != user_id:
        raise HTTPException(403, "Not your return request")
    if r["status"] != "requested":
        raise HTTPException(400,
            f"Cannot cancel — return is already '{r['status']}'. "
            "Contact the store directly to ask about it.")

    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE order_returns SET status='cancelled', updated_at=NOW() WHERE id=%s",
            (return_id,)
        )
        conn.commit()

    # Tell the merchant their pending review went away
    owners = db_all(
        "SELECT u.id FROM crm_users u JOIN crm_projects pr ON pr.crm_user_id = u.id"
        " WHERE pr.id = %s"
        " UNION SELECT tm.crm_user_id FROM crm_team_members tm WHERE tm.project_id = %s",
        (project_id, project_id)
    )
    proj = db_one("SELECT api_key FROM crm_projects WHERE id=%s", (project_id,))
    link = f"/project/{proj['api_key']}/orders?tab=returns&open={return_id}" if proj else None
    with db_cursor() as (conn, cur):
        for o in owners:
            if not o.get("id"): continue
            cur.execute(
                "INSERT INTO crm_notifications (user_id, project_id, type, title, message, link)"
                " VALUES (%s, %s, 'return', %s, %s, %s)",
                (o["id"], project_id,
                 f"Return #{return_id} cancelled by customer",
                 "Customer withdrew their return request.",
                 link)
            )
        conn.commit()

    return {"ok": True, "return_id": return_id, "status": "cancelled"}


# ── PROVIDER WEBHOOKS ────────────────────────────────────
# One endpoint per provider. The {api_key} path segment locates the project so we can
# load the right credentials for signature verification. URL: configured by merchant in
# their provider dashboard, e.g. https://api.tortacrm.com/{api_key}/webhooks/stripe.
#
# Security:
#   • Raw body read once (request.body()) — passed verbatim to signature verifier so
#     character normalisation doesn't break the HMAC.
#   • signature verify is provider-specific (see External/payment_providers.py).
#   • Idempotency table payment_webhook_events has UNIQUE(provider, event_id) — replay
#     attempts return 200 OK without re-processing.
#   • We ALWAYS return 200 to providers, even on validation errors, to prevent infinite
#     retries. The response body indicates what we did.
#   • Source IP captured for YooKassa (their only auth mechanism).

@app.post("/{api_key}/webhooks/{provider}")
async def receive_payment_webhook(api_key: str, provider: str, request: Request,
                                    background_tasks: BackgroundTasks):
    """Receive a payment webhook. ALWAYS returns 200 — body explains what happened."""
    provider = provider.strip().lower()
    if provider not in PROVIDER_FIELDS:
        return {"received": True, "ignored": True, "reason": f"unknown provider {provider}"}

    # Resolve project + credentials
    project = db_one(
        "SELECT id, org_id FROM crm_projects WHERE api_key=%s AND is_active=TRUE",
        (api_key,)
    )
    if not project:
        return {"received": True, "ignored": True, "reason": "unknown api_key"}
    project_id = project["id"]
    cred_row = db_one(
        "SELECT credentials_encrypted, is_test_mode, provider FROM crm_payment_credentials"
        " WHERE org_id=%s AND provider=%s",
        (project["org_id"], provider)
    )
    if not cred_row or not cred_row["credentials_encrypted"]:
        return {"received": True, "ignored": True, "reason": "credentials not configured"}
    try:
        creds = decrypt_credentials(cred_row["credentials_encrypted"])
    except (ValueError, RuntimeError) as e:
        return {"received": True, "ignored": True, "reason": f"decrypt failed: {e}"}

    raw_body = await request.body()
    headers  = {k.lower(): v for k, v in request.headers.items()}
    client_ip = (request.headers.get("X-Forwarded-For")
                  or request.headers.get("X-Real-IP")
                  or (request.client.host if request.client else ""))

    sig_valid, sig_err = verify_webhook(
        provider, creds, raw_body=raw_body, headers=headers,
        source_ip=client_ip, request_url=str(request.url),
        is_test_mode=bool(cred_row["is_test_mode"]),
    )
    event = parse_event(provider, raw_body)
    event_id = event["event_id"] or "unknown_" + secrets.token_hex(8)

    # Idempotency + audit log: insert first, return early on conflict
    try:
        with db_cursor() as (conn, cur):
            cur.execute(
                "INSERT INTO payment_webhook_events"
                "  (provider, event_id, project_id, order_id, payment_intent_id,"
                "   event_type, payload, signature_valid)"
                " VALUES (%s,%s,%s,NULL,%s,%s,%s::jsonb,%s)"
                " ON CONFLICT (provider, event_id) DO NOTHING"
                " RETURNING id",
                (provider, event_id, project_id, event["intent_id"],
                 event["raw_type"][:80], json.dumps(event["raw"], default=str), sig_valid)
            )
            row = cur.fetchone()
            conn.commit()
            if row is None:
                return {"received": True, "duplicate": True, "event_id": event_id}
            log_id = row["id"]
    except Exception as e:
        return {"received": True, "error": f"log insert failed: {e}"}

    if not sig_valid:
        with db_cursor() as (conn, cur):
            cur.execute(
                "UPDATE payment_webhook_events SET processing_error=%s WHERE id=%s",
                (f"Signature invalid: {sig_err}"[:1000], log_id)
            )
            conn.commit()
        return {"received": True, "signature_valid": False, "error": sig_err}

    # Process the event
    try:
        _process_payment_event(project_id, provider, event)
        with db_cursor() as (conn, cur):
            cur.execute(
                "UPDATE payment_webhook_events SET processed_ok=TRUE WHERE id=%s",
                (log_id,)
            )
            conn.commit()
    except Exception as e:
        traceback.print_exc()
        with db_cursor() as (conn, cur):
            cur.execute(
                "UPDATE payment_webhook_events SET processing_error=%s WHERE id=%s",
                (str(e)[:1000], log_id)
            )
            conn.commit()
        return {"received": True, "error": str(e)}
    return {"received": True, "type": event["type"], "event_id": event_id}


def _process_payment_event(project_id: int, provider: str, event: dict) -> None:
    """Apply the canonical event to order_history / order_returns / notifications.
    Idempotent on its own: payment_status updates are conditional on current state.
    """
    intent_id = event.get("intent_id") or ""
    charge_id = event.get("charge_id") or ""
    canon     = event.get("type", "")
    if not intent_id and not charge_id:
        return  # nothing actionable

    if canon == "payment.succeeded":
        # Mark order paid IF the order exists. Race-safe: only updates rows still in
        # pending. The /orders endpoint already sets paid synchronously, so this is
        # the catch-up path for webhook-before-confirm orderings.
        with db_cursor() as (conn, cur):
            cur.execute(
                "UPDATE order_history"
                "   SET payment_status='paid',"
                "       payment_charge_id = CASE WHEN payment_charge_id='' THEN %s ELSE payment_charge_id END,"
                "       payment_paid_at  = COALESCE(payment_paid_at, NOW()),"
                "       updated_at = NOW()"
                " WHERE project_id=%s AND payment_intent_id=%s AND payment_status='pending'"
                " RETURNING id",
                (charge_id or intent_id, project_id, intent_id)
            )
            updated = cur.fetchone()
            conn.commit()
            if updated:
                _notify_payment_event(project_id, updated["id"],
                                       f"Payment confirmed for order #{updated['id']}",
                                       f"{event.get('amount', 0)/100:.2f} {event.get('currency','').upper()}")

    elif canon == "payment.failed":
        with db_cursor() as (conn, cur):
            cur.execute(
                "UPDATE order_history"
                "   SET payment_status='failed', updated_at=NOW()"
                " WHERE project_id=%s AND payment_intent_id=%s AND payment_status='pending'"
                " RETURNING id",
                (project_id, intent_id)
            )
            row = cur.fetchone()
            conn.commit()
            if row:
                _notify_payment_event(project_id, row["id"],
                                       f"Payment FAILED for order #{row['id']}",
                                       "Customer attempted to pay but provider declined.")

    elif canon == "refund.succeeded":
        # Find the order, increment payment_amount_refunded, and link to the matching
        # order_returns row (by intent_id) so the merchant sees confirmation.
        with db_cursor() as (conn, cur):
            cur.execute(
                "SELECT id, total_amount, payment_amount_refunded"
                "  FROM order_history WHERE project_id=%s AND payment_intent_id=%s"
                "  FOR UPDATE",
                (project_id, intent_id)
            )
            order = cur.fetchone()
            if order:
                refund_amount_dollars = float(event.get("amount_refunded", event.get("amount", 0))) / 100.0
                # Stripe sends amount_refunded as cumulative; treat absent as snapshot of THIS event's amount
                # Some providers send delta — we take max with current to avoid going backwards
                new_total_refunded = max(float(order["payment_amount_refunded"] or 0), refund_amount_dollars)
                new_status = "refunded" if new_total_refunded >= float(order["total_amount"] or 0) - 0.01 \
                              else "partial_refunded"
                cur.execute(
                    "UPDATE order_history"
                    "   SET payment_amount_refunded=%s, payment_status=%s, updated_at=NOW()"
                    " WHERE id=%s",
                    (round(new_total_refunded, 2), new_status, order["id"])
                )
                # Mirror onto matching order_returns rows that already have this intent linked
                cur.execute(
                    "UPDATE order_returns"
                    "   SET provider_refund_status='succeeded', updated_at=NOW()"
                    " WHERE order_id=%s AND provider_refund_id=%s",
                    (order["id"], charge_id)
                )
                conn.commit()
                _notify_payment_event(project_id, order["id"],
                                       f"Refund processed for order #{order['id']}",
                                       f"{refund_amount_dollars:.2f} refunded via {provider}")

    elif canon == "dispute.created":
        with db_cursor() as (conn, cur):
            cur.execute(
                "SELECT id FROM order_history WHERE project_id=%s AND payment_intent_id=%s",
                (project_id, intent_id)
            )
            order = cur.fetchone()
            if order:
                _notify_payment_event(project_id, order["id"],
                                       f"⚠ Dispute opened on order #{order['id']}",
                                       "Customer disputed the payment with their bank. Review evidence in your provider dashboard.")


def _notify_payment_event(project_id: int, order_id: int, title: str, message: str) -> None:
    """Push to owner + every team member."""
    rows = db_all(
        "SELECT crm_user_id FROM crm_projects WHERE id=%s"
        " UNION SELECT crm_user_id FROM crm_team_members WHERE project_id=%s",
        (project_id, project_id)
    )
    proj = db_one("SELECT api_key FROM crm_projects WHERE id=%s", (project_id,))
    link = f"/project/{proj['api_key']}/orders" if proj else None
    with db_cursor() as (conn, cur):
        for r in rows:
            uid = r.get("crm_user_id")
            if not uid:
                continue
            cur.execute(
                "INSERT INTO crm_notifications (user_id, project_id, type, title, message, link)"
                " VALUES (%s, %s, 'payment', %s, %s, %s)",
                (uid, project_id, title[:200], message[:1000], link)
            )
        conn.commit()


# ── ТРЕКИНГ (воронка продаж) ─────────────────────────────

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


# ── GOOGLE OAUTH (per-project credentials) ───────────────

@app.get("/{api_key}/auth/google/login")
def magaz_google_login(api_key: str, api_key_record: dict = Depends(resolve_api_key_public)):
    import urllib.parse
    client_id, _ = get_google_credentials(api_key_record["id"])
    if not client_id: raise HTTPException(404, "Google OAuth not configured for this store")
    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key}/auth/google/callback"
    # CSRF: random state in short-lived cookie, validated on callback (prevents login-CSRF).
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


# ── GENERIC OAUTH PROVIDERS (per-project credentials) ────

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
        # KeyCloak self-hosted — override authorize/token/user_info URLs via KEYCLOAK_BASE_URL (defaults: Bitnami demo).
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


# ── PHONE / SMS AUTH (customer-provided SMS provider: Twilio/MessageBird/Textlocal/Vonage/Twilio Verify) ──

# Phone OTPs — kvstore-backed; stores SHA-256 hash so a memory/Redis dump can't leak live codes.
def _phone_otp_key(project_id, phone): return f"phone_otp:{project_id}:{phone}"
def _phone_otp_get(project_id, phone): return _kv_get(_phone_otp_key(project_id, phone))
def _phone_otp_set(project_id, phone, value, ttl):
    _kv_set(_phone_otp_key(project_id, phone), value, ttl=ttl)
def _phone_otp_del(project_id, phone): _kv_delete(_phone_otp_key(project_id, phone))

# Phone send-code rate limit buckets — atomic counters with TTL = block window.
def _phone_send_check_and_record(project_id: int, phone: str, ip: str):
    """Raise 429 if either per-phone or per-IP limit exceeded; else record."""
    limits = (
        (f"phone:{project_id}:{phone}", PHONE_SEND_MAX_PER_PHONE),
        (f"ip:{ip}",                    PHONE_SEND_MAX_PER_IP),
    )
    # Pre-check (don't increment if already over)
    for ident, lim in limits:
        cur = int(_kv_get(_fail_key("phone_send", ident)) or 0)
        if cur >= lim:
            left = max(_kv_ttl(_fail_key("phone_send", ident)), 1)
            raise HTTPException(429, f"Too many requests. Try again in {left} seconds.")
    # Record
    for ident, lim in limits:
        new_val = _kv_incr(_fail_key("phone_send", ident), ttl=BLOCK_MINUTES * 60)
        if new_val > lim:
            left = max(_kv_ttl(_fail_key("phone_send", ident)), 1)
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
    # Must explicitly start with '+' — auto-prefixing previously allowed bypass variants.
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

    # Per-OTP brute-force counter — invalidate code after MAX attempts (blocks 10^6 grinding).
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
    _kv_delete(_fail_key("phone_send", f"phone:{project_id}:{phone}"))

    token = create_token(user_id)
    set_auth_cookie(response, token)
    set_refresh_cookie(response, issue_refresh_token(user_id, project_id, request, label="Phone login"))
    return {"ok": True, "user_id": user_id}


# ── WEB CHAT (support widget on the client's site) ───────


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


# ── BOOKING — public storefront endpoints at /{api_key}/booking/...; slots: working-hours window walked by interval, available iff fits duration, capacity left, ≥ min_advance_minutes ──

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

from pydantic import model_validator as _model_validator

class PublicCreateBookingRequest(BaseModel):
    service_id:     int
    staff_id:       Optional[int] = None
    starts_at:      str
    # Accept None from older storefront builds (legacy code used `field || null` patterns)
    # by typing as Optional[str] and coercing None → "" in a `mode='before'` validator.
    # Keeps the backend contract permissive — old SDK versions / 3rd-party storefronts
    # keep working without an upgrade.
    customer_name:  Optional[str] = ""
    customer_phone: Optional[str] = ""
    customer_email: Optional[str] = ""
    notes:          Optional[str] = ""

    @_model_validator(mode="before")
    @classmethod
    def _coerce_none_to_empty(cls, data):
        if isinstance(data, dict):
            for k in ("customer_name", "customer_phone", "customer_email", "notes"):
                if data.get(k) is None:
                    data[k] = ""
        return data

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

    # Compare LOCAL business dates (not UTC) — Tokyo's "today" must not roll over while NY is on yesterday.
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
    # Group services (capacity>1, no required staff) emit slots_detailed with seats_left for "X seats left" UI.
    out_slots = []
    detailed  = []
    for (open_t, close_t) in windows:
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
                    label = slot_local.strftime("%H:%M")
                    out_slots.append(label)
                    detailed.append({"time": label, "seats_left": capacity - overlap, "capacity": capacity})
            slot_local += timedelta(minutes=interval)
    return {
        "date": date, "slots": out_slots,
        "slots_detailed": detailed,
        "capacity": capacity,
        "timezone": settings.get("timezone") or "UTC",
    }

_EMAIL_RE = _re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

@app.post("/{api_key}/booking/bookings")
def public_create_booking(req: PublicCreateBookingRequest,
                          request: Request,
                          background_tasks: BackgroundTasks,
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

    # Parse ISO 8601; if naive (no TZ offset), interpret as the business's local TZ.
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

    # Atomic capacity check + insert: pg advisory lock on (project_id, staff_id, service_id) serialises concurrent bookings; auto-released at COMMIT/ROLLBACK.
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

    # Outbound webhooks: always fire booking.created; if auto_confirm is on,
    # also fire booking.confirmed in the same dispatch cycle.
    event_data = {
        "booking_id":   bid, "service_id":  req.service_id,
        "service_name": svc["name"],
        "staff_id":     req.staff_id, "starts_at": starts.isoformat(),
        "ends_at":      ends.isoformat(), "status":   initial_status,
        "amount":       float(svc.get("price") or 0), "currency": "USD",
        "customer":     {"name": name, "email": email, "phone": phone},
    }
    background_tasks.add_task(dispatch_event, project_id, "booking.created", event_data)
    if initial_status == "confirmed":
        background_tasks.add_task(dispatch_event, project_id, "booking.confirmed", event_data)
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
                          background_tasks: BackgroundTasks,
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

    background_tasks.add_task(dispatch_event, project_id, "booking.cancelled", {
        "booking_id": bid, "service_id": row["service_id"],
        "starts_at": starts.isoformat(),
        "customer": {"name": row.get("customer_name", ""),
                     "email": row.get("customer_email", "")},
    })
    return {"ok": True, "status": "cancelled"}


# ── BOOKING REMINDER (T-1h) ──────────────────────────────
# Cron job hits /internal/booking/process-reminders every 5 min; idempotent via reminder_sent_at column. Window 50–70 min keeps noise low if cron skips a beat.

def _build_booking_reminder_html(service_name: str, staff_name: Optional[str],
                                 starts_at: datetime, biz_tz, venue: Optional[str] = None) -> str:
    local = starts_at.astimezone(biz_tz)
    try:    when = local.strftime("%A, %B %d at %H:%M")
    except Exception: when = local.isoformat()
    staff_line = f"<p style='color:#666;margin:4px 0'>With <b>{sanitize(staff_name)}</b></p>" if staff_name else ""
    venue_line = f"<p style='color:#666;margin:4px 0'>{sanitize(venue)}</p>" if venue else ""
    return f"""<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h1 style="color:#0071e3;margin:0 0 8px">Reminder: in 1 hour</h1>
        <p style="font-size:18px;color:#111;margin:0 0 16px"><b>{sanitize(service_name)}</b></p>
        <p style="font-size:16px;color:#333;margin:0 0 4px">{sanitize(when)}</p>
        {staff_line}{venue_line}
        <p style="color:#999;font-size:12px;margin-top:32px">See you soon!</p>
    </div>"""

@app.post("/internal/booking/process-reminders")
def internal_process_booking_reminders(request: Request):
    """Send T-1h booking reminders (cron every 5 min); idempotent via reminder_sent_at column."""
    if request.headers.get("X-Internal-Key") != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    now_utc = _utcnow()
    lo = now_utc + timedelta(minutes=50)
    hi = now_utc + timedelta(minutes=70)
    rows = db_all(
        """SELECT b.id, b.project_id, b.service_id, b.staff_id, b.customer_email,
                  b.starts_at, b.notes,
                  s.name AS service_name, s.duration_minutes,
                  st.name AS staff_name
           FROM bookings b
           JOIN booking_services s ON s.id = b.service_id
           LEFT JOIN booking_staff st ON st.id = b.staff_id
           WHERE b.status='confirmed'
             AND b.reminder_sent_at IS NULL
             AND b.starts_at BETWEEN %s AND %s
             AND b.customer_email <> ''""",
        (lo, hi)
    )
    sent, failed = 0, 0
    for r in rows:
        settings = _booking_settings(r["project_id"])
        biz_tz   = _tz(settings.get("timezone") or "UTC")
        starts   = r["starts_at"]
        if starts.tzinfo is None: starts = starts.replace(tzinfo=timezone.utc)
        from_name, from_email = get_project_email(r["project_id"])
        html = _build_booking_reminder_html(
            r["service_name"], r["staff_name"], starts, biz_tz, venue=None
        )
        ok = send_email(r["customer_email"], "Reminder: your appointment is in 1 hour",
                        html, from_name, from_email)
        if ok:
            with db_cursor() as (conn, cur):
                cur.execute("UPDATE bookings SET reminder_sent_at=NOW() WHERE id=%s", (r["id"],))
                conn.commit()
            sent += 1
        else:
            failed += 1
    return {"sent": sent, "failed": failed, "candidates": len(rows)}


# ── ABANDONED CART REMINDERS ─────────────────────────────
# Cron hits /internal/cart/process-abandoned every 30 min; finds carts inactive 23–25h, sends one reminder email, marks abandoned_email_sent_at so we don't spam.

def _build_abandoned_cart_html(customer_name: str, item_titles: list, cart_url: str) -> str:
    """Minimal inline-styled email template — same look as order confirmation."""
    name_html = sanitize(customer_name or "there")
    titles_html = "".join(
        f'<li style="padding:6px 0;color:#333">{sanitize(t)[:120]}</li>'
        for t in item_titles[:5]
    )
    more = f'<li style="padding:6px 0;color:#888">+ {len(item_titles) - 5} more…</li>' if len(item_titles) > 5 else ""
    safe_url = sanitize(cart_url or "")
    return (
        '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px">'
        f'<h2 style="color:#111;margin:0 0 12px">Hey {name_html}, you left something behind</h2>'
        '<p style="color:#444;line-height:1.5">Your cart is still waiting for you. Here\'s what\'s inside:</p>'
        f'<ul style="list-style:none;padding:0;margin:16px 0;border-top:1px solid #eee">{titles_html}{more}</ul>'
        f'<a href="{safe_url}" style="display:inline-block;background:#0071E3;color:#fff;text-decoration:none;'
        'padding:12px 28px;border-radius:999px;font-weight:600">Return to cart</a>'
        '<p style="color:#888;font-size:12px;margin-top:24px">If you didn\'t want this, ignore this email.</p>'
        '</div>'
    )


@app.post("/internal/cart/process-abandoned")
def internal_process_abandoned_carts(request: Request):
    """Idempotent: candidates filtered by abandoned_email_sent_at IS NULL; each candidate flagged after a successful send."""
    if request.headers.get("X-Internal-Key") != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    now_utc = _utcnow()
    lo = now_utc - timedelta(hours=25)
    hi = now_utc - timedelta(hours=23)
    # Find carts with items, owner has email, no reminder sent yet, last cart-item update in [25h..23h] ago.
    candidates = db_all(
        "SELECT c.id AS cart_id, c.project_id, c.user_id, u.email, u.name,"
        "       MAX(ci.updated_at) AS last_activity"
        "  FROM carts c"
        "  JOIN cart_items ci ON ci.cart_id = c.id"
        "  JOIN users u ON u.id = c.user_id AND u.project_id = c.project_id"
        " WHERE c.abandoned_email_sent_at IS NULL"
        "   AND u.email <> ''"
        " GROUP BY c.id, c.project_id, c.user_id, u.email, u.name"
        "HAVING MAX(ci.updated_at) BETWEEN %s AND %s",
        (lo, hi)
    )
    sent, failed = 0, 0
    for row in candidates:
        # Pull the cart items + product titles to render the email body.
        items = db_all(
            "SELECT p.title FROM cart_items ci JOIN products p ON ci.product_id = p.id"
            " WHERE ci.cart_id = %s",
            (row["cart_id"],)
        )
        if not items: continue
        titles = [r["title"] for r in items]
        from_name, from_email = get_project_email(row["project_id"])
        frontend_url = get_project_frontend_url(row["project_id"]) or ""
        cart_url = f"{frontend_url.rstrip('/')}/cart" if frontend_url else ""
        html = _build_abandoned_cart_html(row.get("name") or "", titles, cart_url)
        ok = send_email(row["email"], "You left items in your cart", html, from_name, from_email)
        if ok:
            with db_cursor() as (conn, cur):
                cur.execute("UPDATE carts SET abandoned_email_sent_at = NOW() WHERE id = %s",
                            (row["cart_id"],))
                conn.commit()
            sent += 1
        else:
            failed += 1
    return {"sent": sent, "failed": failed, "candidates": len(candidates)}


# ── LOW STOCK ALERTS ─────────────────────────────────────
# Cron hits /internal/stock/check-low-stock every 5 min. Sends one email per (project, sku) per 24h via crm_low_stock_alerts cooldown.

@app.post("/internal/stock/check-low-stock")
def internal_check_low_stock(request: Request):
    """Idempotent: a SKU only re-alerts after 24h via crm_low_stock_alerts.alerted_at. Also creates an in-app notification per project owner."""
    if request.headers.get("X-Internal-Key") != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    # Pull every SKU at/below its product's low_stock_threshold (>0 only — threshold=0 means "alerts disabled").
    rows = db_all(
        "SELECT l2.id AS sku_id, l2.stock_quantity, l2.configuration_name,"
        "       l1.variation_name, p.id AS product_id, p.title, p.project_id,"
        "       p.low_stock_threshold"
        "  FROM product_configurations_l2 l2"
        "  JOIN product_configurations_l1 l1 ON l2.variation_id = l1.id"
        "  JOIN products p ON l1.product_id = p.id"
        " WHERE p.low_stock_threshold > 0"
        "   AND l2.stock_quantity <= p.low_stock_threshold"
        "   AND p.is_archived = FALSE"
    )
    alerted, skipped = 0, 0
    cutoff = _utcnow() - timedelta(hours=24)
    for r in rows:
        last = db_one(
            "SELECT alerted_at FROM crm_low_stock_alerts"
            " WHERE project_id=%s AND sku_id=%s ORDER BY alerted_at DESC LIMIT 1",
            (r["project_id"], r["sku_id"])
        )
        if last and last["alerted_at"] and last["alerted_at"] > cutoff:
            skipped += 1; continue

        # In-app notification: owner of the project sees this in the bell.
        owner = db_one(
            "SELECT u.id, u.email, u.name FROM crm_users u"
            "  JOIN crm_projects pr ON pr.crm_user_id = u.id"
            " WHERE pr.id = %s",
            (r["project_id"],)
        )
        if not owner: continue
        title = r.get("title") or "Product"
        var   = r.get("variation_name") or ""
        cfg   = r.get("configuration_name") or ""
        msg   = f'{title}{" — " + var if var else ""}{" / " + cfg if cfg else ""}: {r["stock_quantity"]} left (threshold {r["low_stock_threshold"]})'
        with db_cursor() as (conn, cur):
            cur.execute(
                "INSERT INTO crm_notifications (user_id, project_id, type, title, message, link)"
                " VALUES (%s, %s, 'low_stock', %s, %s, %s)",
                (owner["id"], r["project_id"], 'Low stock alert', msg[:1000],
                 f'/product/{r["product_id"]}')
            )
            cur.execute(
                "INSERT INTO crm_low_stock_alerts (project_id, sku_id, stock_at_alert, threshold)"
                " VALUES (%s, %s, %s, %s)",
                (r["project_id"], r["sku_id"], r["stock_quantity"], r["low_stock_threshold"])
            )
            conn.commit()
        alerted += 1
    return {"alerted": alerted, "skipped": skipped, "candidates": len(rows)}


# ── BOOKING PAYMENT (Stripe stub) ────────────────────────
# Per-project frontend can call this to create a Stripe PaymentIntent and pay before slot is held. Returns 501 if Stripe is not configured server-side; structured to plug in stripe-python later.

@app.post("/{api_key}/booking/payment-intent")
def public_create_booking_payment_intent(
    payload: dict,
    api_key_record: dict = Depends(resolve_api_key),
):
    project_id = api_key_record["id"]
    if not STRIPE_SECRET_KEY:
        raise HTTPException(501, "Online payment is not configured for this store")

    service_id = payload.get("service_id")
    if not service_id:
        raise HTTPException(400, "service_id is required")
    svc = db_one(
        "SELECT id, name, price FROM booking_services WHERE id=%s AND project_id=%s AND is_active=TRUE",
        (service_id, project_id)
    )
    if not svc: raise HTTPException(404, "Service not found")
    amount_cents = int(round(float(svc["price"] or 0) * 100))
    if amount_cents <= 0:
        raise HTTPException(400, "This service has no price set")

    import urllib.parse
    body = urllib.parse.urlencode({
        "amount":             str(amount_cents),
        "currency":           "usd",
        "description":        f"{svc['name']} (project {project_id})",
        "metadata[project_id]": str(project_id),
        "metadata[service_id]": str(service_id),
    }).encode()
    req = urllib.request.Request(
        f"{STRIPE_API_BASE}/payment_intents", data=body,
        headers={
            "Authorization": f"Bearer {STRIPE_SECRET_KEY}",
            "Content-Type":  "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        return {"client_secret": data.get("client_secret"), "id": data.get("id"),
                "amount": amount_cents, "currency": "usd"}
    except urllib.error.HTTPError as e:
        try:    detail = json.loads(e.read()).get("error", {}).get("message", "Stripe error")
        except Exception: detail = "Stripe error"
        raise HTTPException(502, detail)
    except Exception as e:
        raise HTTPException(502, f"Payment provider unavailable: {e}")


# PDF DOCUMENTS — Invoice/Act/Receipt/Ticket rendered by pdf_documents.render_document from crm_document_settings.

def _get_branding(project_id: int) -> dict:
    row = db_one("SELECT * FROM crm_document_settings WHERE project_id=%s", (project_id,))
    if not row:
        return {"style": "modern", "company_name": "", "logo_url": None,
                "address": "", "tax_id_label": "Tax ID", "tax_id": "",
                "contact_email": "", "contact_phone": "", "footer_note": "",
                "accent_color": "#0071E3"}
    return dict(row)


def _pdf_response(pdf_bytes: bytes, filename: str):
    from fastapi.responses import Response as _Response
    return _Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'}
    )


@app.get("/{api_key}/orders/{order_id}/invoice.pdf")
def order_invoice_pdf(order_id: int, request: Request,
                      style: Optional[str] = Query(None),
                      api_key_record: dict = Depends(resolve_api_key)):
    """Return PDF invoice for one order; customer must own it (or staff via internal_key — TODO)."""
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    order = db_one(
        "SELECT * FROM order_history WHERE id=%s AND project_id=%s AND user_id=%s",
        (order_id, project_id, user_id)
    )
    if not order: raise HTTPException(404, "Order not found")

    items = db_all(
        """SELECT oi.quantity, oi.price, p.title, pv.variation_name
           FROM order_items oi
           JOIN products p                  ON oi.product_id     = p.id
           LEFT JOIN product_configurations_l1 pv ON oi.variation_id   = pv.id
           WHERE oi.order_id=%s""",
        (order_id,)
    )
    subtotal = sum(float(i["price"]) * i["quantity"] for i in items)
    total    = float(order.get("total_amount") or 0)
    shipping = max(0.0, total - subtotal)

    branding = _get_branding(project_id)
    branding["style"] = style or branding.get("style") or "modern"

    user = db_one("SELECT name, email FROM users WHERE id=%s", (user_id,))
    data = {
        "number":   order_id,
        "issued_at": order["created_at"].strftime("%Y-%m-%d") if order.get("created_at") else "",
        "currency": "USD",
        "customer": {"name": (user or {}).get("name", "") or order.get("recipient_name", ""),
                     "email": (user or {}).get("email", "")},
        "items": [{"title": i["title"], "variation": i.get("variation_name"),
                   "qty": i["quantity"], "price": float(i["price"])} for i in items],
        "subtotal": subtotal, "shipping": shipping, "discount": 0,
        "total":    total,
    }
    pdf = render_document("invoice", branding["style"], branding, data)
    return _pdf_response(pdf, f"invoice-{order_id}.pdf")


@app.get("/{api_key}/booking/bookings/{bid}/act.pdf")
def booking_act_pdf(bid: int, request: Request,
                    style: Optional[str] = Query(None),
                    api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    row = db_one(
        """SELECT b.*, s.name AS service_name, s.duration_minutes, s.price AS service_price
           FROM bookings b JOIN booking_services s ON s.id=b.service_id
           WHERE b.id=%s AND b.project_id=%s AND b.user_id=%s""",
        (bid, project_id, user_id)
    )
    if not row: raise HTTPException(404, "Booking not found")
    branding = _get_branding(project_id)
    branding["style"] = style or branding.get("style") or "modern"
    starts = row["starts_at"]
    when = starts.strftime("%Y-%m-%d %H:%M") if starts else ""
    data = {
        "number": bid,
        "performed_at": when,
        "currency": "USD",
        "customer": {"name": row.get("customer_name", "")},
        "items": [{"title": row["service_name"],
                   "variation": f"{row['duration_minutes']} min",
                   "qty": 1, "price": float(row.get("service_price") or 0)}],
        "subtotal": float(row.get("service_price") or 0),
        "total":    float(row.get("service_price") or 0),
    }
    pdf = render_document("act", branding["style"], branding, data)
    return _pdf_response(pdf, f"act-{bid}.pdf")


@app.get("/{api_key}/orders/{order_id}/receipt.pdf")
def order_receipt_pdf(order_id: int, request: Request,
                      style: Optional[str] = Query(None),
                      api_key_record: dict = Depends(resolve_api_key)):
    """Receipt — like invoice but more compact, includes digital download links."""
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    order = db_one(
        "SELECT * FROM order_history WHERE id=%s AND project_id=%s AND user_id=%s",
        (order_id, project_id, user_id)
    )
    if not order: raise HTTPException(404, "Order not found")
    items = db_all(
        """SELECT oi.quantity, oi.price, oi.product_id, p.title, p.product_type, pv.variation_name
           FROM order_items oi
           JOIN products p ON oi.product_id=p.id
           LEFT JOIN product_configurations_l1 pv ON oi.variation_id=pv.id
           WHERE oi.order_id=%s""",
        (order_id,)
    )
    digital_ids = [i["product_id"] for i in items if i.get("product_type") == "digital"]
    downloads = []
    if digital_ids:
        fmt = ",".join(["%s"] * len(digital_ids))
        files = db_all(
            f"SELECT product_id, field_key, field_value FROM product_custom_fields"
            f" WHERE project_id=%s AND product_id IN ({fmt}) AND field_type='file'"
            f" AND field_value <> ''",
            tuple([project_id] + digital_ids)
        )
        titles = {i["product_id"]: i["title"] for i in items}
        for f in files:
            downloads.append({"label": titles.get(f["product_id"]) or f["field_key"],
                              "url":   f["field_value"]})

    branding = _get_branding(project_id)
    branding["style"] = style or branding.get("style") or "modern"
    data = {
        "number": order_id,
        "paid_at": order["created_at"].strftime("%Y-%m-%d") if order.get("created_at") else "",
        "currency": "USD",
        "items": [{"title": i["title"], "variation": i.get("variation_name"),
                   "qty": i["quantity"], "price": float(i["price"])} for i in items],
        "subtotal": sum(float(i["price"]) * i["quantity"] for i in items),
        "total":    float(order.get("total_amount") or 0),
        "downloads": downloads,
    }
    pdf = render_document("receipt", branding["style"], branding, data)
    return _pdf_response(pdf, f"receipt-{order_id}.pdf")
