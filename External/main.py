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
import email_engine

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:
    ZoneInfo = None
    class ZoneInfoNotFoundError(Exception): pass

def _tz(name: str):
    if not name or ZoneInfo is None:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, Exception):
        return timezone.utc

def _utcnow():
    return datetime.now(timezone.utc)


# ── S3 cleanup stubs ──────────────────────────────────────────────
def s3_delete_url(url: str, prefix: str) -> None:
    pass

def s3_delete_prefix(prefix: str) -> None:
    pass


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
INTERNAL_API_KEY      = os.getenv("INTERNAL_API_KEY",  "")

# Production-only fail-closed (same as CRM backend — keep in sync). In dev,
# fall back to a stable placeholder + log a warning. The catastrophic JWT-
# forgery path requires ENVIRONMENT=production to be in effect.
_IS_PROD = os.getenv("ENVIRONMENT", "development").lower() == "production"
if _IS_PROD:
    assert SECRET_KEY and len(SECRET_KEY) >= 32, \
        "SECRET_KEY env var is required in production and must be at least 32 chars long (used to sign auth JWTs)"
    assert INTERNAL_API_KEY and len(INTERNAL_API_KEY) >= 24, \
        "INTERNAL_API_KEY env var is required in production and must be at least 24 chars long (gates internal cron + webhook endpoints)"
else:
    # Must match the placeholder in CRM/backend/main.py — both backends sign
    # tokens with the same secret so they can validate each other's JWTs.
    if not SECRET_KEY:
        SECRET_KEY = "dev-only-do-not-use-in-prod-32chars-padding-xxxxxxxxxxxxxxxx"
        print("[security] WARNING: SECRET_KEY env not set — using dev-only placeholder. DO NOT deploy to prod without setting it.")
    if not INTERNAL_API_KEY:
        INTERNAL_API_KEY = "dev-only-internal-key-padding-xxxx"
        print("[security] WARNING: INTERNAL_API_KEY env not set — using dev-only placeholder. DO NOT deploy to prod without setting it.")
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

def _resolve_db_config():
    """DATABASE_URL (Fly Postgres attach) takes priority; falls back to the
    individual DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME vars used by our
    docker-compose and native dev .env files. Mirror of CRM backend logic."""
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        from urllib.parse import urlparse, unquote, parse_qs
        u = urlparse(url)
        q = parse_qs(u.query or "")
        cfg = {
            "host":     u.hostname or "localhost",
            "port":     int(u.port or 5432),
            "user":     unquote(u.username or "postgres"),
            "password": unquote(u.password or ""),
            "dbname":   (u.path or "/").lstrip("/") or "postgres",
        }
        # SSL: honor URL sslmode (Neon ships ?sslmode=require); else force SSL
        # for remote managed Postgres, leave Fly internal / localhost plaintext.
        host = cfg["host"]
        sslmode = q.get("sslmode", [None])[0]
        if sslmode:
            cfg["sslmode"] = sslmode
        elif host not in ("localhost", "127.0.0.1") \
                and not host.endswith(".flycast") and not host.endswith(".internal"):
            cfg["sslmode"] = "require"
        return cfg
    return {
        "host":     os.getenv("DB_HOST",     "localhost"),
        "port":     int(os.getenv("DB_PORT", "5432")),
        "user":     os.getenv("DB_USER",     "postgres"),
        "password": os.getenv("DB_PASSWORD", ""),
        "dbname":   os.getenv("DB_NAME",     "crmdb"),
    }

DB_CONFIG = _resolve_db_config()

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


def _project_store_name(project_id) -> str:
    if not project_id:
        return "our store"
    row = db_one("SELECT name FROM crm_projects WHERE id=%s", (project_id,))
    return (row.get("name") if row else None) or "our store"


def _resolve_email_branding(project_id) -> dict:
    row = db_one("SELECT * FROM crm_email_branding WHERE project_id=%s", (project_id,)) if project_id else None
    merged = {**email_engine.DEFAULT_BRANDING}
    if row:
        for k in email_engine.DEFAULT_BRANDING:
            if row.get(k) is not None:
                merged[k] = row[k]
    return merged


def _resolve_email_template(project_id, etype):
    row = db_one("SELECT subject, blocks, html FROM crm_email_templates WHERE project_id=%s AND type=%s",
                 (project_id, etype)) if project_id else None
    if row:
        return row["subject"], row["blocks"], (row.get("html") or "")
    d = email_engine.DEFAULT_EMAIL_TEMPLATES.get(etype, {})
    return d.get("subject", ""), d.get("blocks", []), ""


def _send_template_email(project_id, etype, to, variables, *, from_name=None, from_email=None, unsubscribe_url=None):
    """Resolve project template + branding, render, send. Falls back to code default if a required var is missing."""
    if not (from_name and from_email):
        fn, fe = get_project_email(project_id) if project_id else ("Torta Store", EMAIL_FROM)
        from_name = from_name or fn
        from_email = from_email or fe
    subject_tpl, blocks, html_tpl = _resolve_email_template(project_id, etype)
    ok = (email_engine.template_has_required_html(etype, html_tpl, subject_tpl)
          if html_tpl else email_engine.template_has_required(etype, blocks, subject_tpl))
    if not ok:
        d = email_engine.DEFAULT_EMAIL_TEMPLATES.get(etype, {})
        subject_tpl, blocks, html_tpl = d.get("subject", ""), d.get("blocks", []), ""
    branding = _resolve_email_branding(project_id)
    subject = email_engine.render_subject(subject_tpl, variables) or email_engine.EMAIL_TYPES.get(etype, {}).get("subject", "")
    html = (email_engine.render_email_html(html_tpl, branding, variables, unsubscribe_url=unsubscribe_url)
            if html_tpl else email_engine.render_email(blocks, branding, variables, unsubscribe_url=unsubscribe_url))
    return send_email(to, subject, html, from_name, from_email, project_id=project_id)


def _project_team_user_ids(project_id: int) -> list[int]:
    """All CRM users with access to this project — owner + team members.
    Used by every notification-fanout site so a single new-order ping
    reaches every operator subscribed to the project's bell stream."""
    rows = db_all(
        "SELECT u.id FROM crm_users u JOIN crm_projects pr ON pr.crm_user_id = u.id"
        "  WHERE pr.id = %s"
        " UNION SELECT tm.crm_user_id FROM crm_team_members tm WHERE tm.project_id = %s",
        (project_id, project_id)
    )
    return [int(r["id"]) for r in rows if r.get("id")]


def push_crm_notification(user_id: int, project_id: int, ntype: str,
                          title: str, message: str = "", link: str | None = None) -> None:
    """Cross-process bell push from External → CRM.

    External doesn't host the NotifHub WebSocket (that's a CRM process), so
    we can't broadcast in-process. Two-step delivery:
      1. INSERT into crm_notifications (so the bell list/feed and badge
         count are correct on next fetch regardless of WS connectivity)
      2. pg_notify on `crm_user_notifications` — CRM's background LISTEN
         task picks it up and broadcasts to the user's open WebSocket(s)
         within a few ms.

    Wrapped in try/except so a bell-push failure never breaks the request
    that triggered it (placing an order, creating a booking, etc.)."""
    try:
        with db_cursor() as (conn, cur):
            cur.execute(
                "INSERT INTO crm_notifications (user_id, project_id, type, title, message, link)"
                " VALUES (%s,%s,%s,%s,%s,%s) RETURNING id, created_at",
                (user_id, project_id, ntype, title[:200], message[:2000], (link or "")[:500])
            )
            row = cur.fetchone()
            payload = json.dumps({
                "id":         row["id"],
                "user_id":    user_id,
                "project_id": project_id,
                "type":       ntype,
                "title":      title,
                "message":    message,
                "link":       link or "",
                "is_read":    False,
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            }, default=str)
            cur.execute("SELECT pg_notify(%s, %s)", ("crm_user_notifications", payload))
            conn.commit()
    except Exception as e:
        print(f"[notif push] failed: {e}")


def push_crm_notification_project(project_id: int, ntype: str,
                                   title: str, message: str = "",
                                   link: str | None = None) -> None:
    for uid in _project_team_user_ids(project_id):
        push_crm_notification(uid, project_id, ntype, title, message, link)

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

def _org_shares_customers(org_id) -> bool:
    """Whether the org shares one customer identity across all its branches.
    Default TRUE. When TRUE, storefront auth resolves a customer across the
    whole org; when FALSE it stays scoped to the single project."""
    if not org_id:
        return False
    row = db_one("SELECT customers_shared FROM crm_organizations WHERE id = %s", (org_id,))
    return bool(row and row.get("customers_shared"))

def get_user_by_email(email: str, project_id: int, org_id=None):
    """Resolve a customer by email. When the org shares customers, match any
    branch in the org (lowest id = canonical identity); otherwise within the
    project only. `org_id=None` preserves the legacy per-project behaviour."""
    if org_id is not None and _org_shares_customers(org_id):
        return db_one(
            "SELECT * FROM users WHERE email = %s AND org_id = %s ORDER BY id LIMIT 1",
            (email, org_id))
    return db_one("SELECT * FROM users WHERE email = %s AND project_id = %s", (email, project_id))

def get_user_by_id(user_id: int, project_id: int, org_id=None):
    if org_id is not None and _org_shares_customers(org_id):
        return db_one("SELECT id, name, email FROM users WHERE id = %s AND org_id = %s", (user_id, org_id))
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
            # Guest checkout — anonymous users created lazily on
            # /cart/add when no auth cookie is present. is_guest=TRUE
            # marks them, email/phone NULL until they reach checkout.
            # When they later sign up properly with the same email,
            # /verify-code finds this row, sets password, drops the
            # flag, and their prior orders are already linked because
            # the user_id was theirs from the start.
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT FALSE",
            # Relax the NOT NULL on email — guest rows need to exist
            # before the contact info is known. UNIQUE constraint on
            # (email, project_id) keeps working: PostgreSQL treats
            # multiple NULLs as distinct, so any number of guests can
            # coexist.
            "ALTER TABLE users ALTER COLUMN email DROP NOT NULL",
            "ALTER TABLE favorites ADD COLUMN IF NOT EXISTS project_id int DEFAULT NULL",
            "ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS project_id int DEFAULT NULL",
            # org_id denormalised from the user's project so org-scoped identity
            # (one account across all branches of an org) is a single indexed
            # lookup. NULL for legacy rows until backfilled just below.
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id int DEFAULT NULL",
            # Extended customer profile fields. Optional everywhere — used by the
            # storefront registration (when a merchant enables them) AND by the
            # server-side customer push (merchants running their own auth).
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name varchar(200) DEFAULT NULL",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS birthdate date DEFAULT NULL",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS address varchar(500) DEFAULT NULL",
            # Free-form bag for any custom fields the merchant wants to attach.
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb",
            # TRUE = pushed in by a merchant's own backend (no password / no login
            # here); FALSE = a normal account that authenticates through us.
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_external boolean DEFAULT FALSE",
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
        # Backfill org_id from each user's project so org-scoped login works
        # without a per-request join to crm_projects.
        try:
            cur.execute(
                "UPDATE users u SET org_id = p.org_id FROM crm_projects p "
                "WHERE u.project_id = p.id AND u.org_id IS DISTINCT FROM p.org_id"
            )
            conn.commit()
        except Exception: conn.rollback()
        # Fast lookup for org-scoped identity (same account across all branches).
        try:
            cur.execute("CREATE INDEX IF NOT EXISTS idx_users_org_email ON users(org_id, email)")
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


def clean(v, max_len: int = 0) -> str:
    """Three-in-one input scrubber — coerce, sanitize, strip, truncate.
    Use everywhere we'd otherwise write `sanitize((x or "").strip())[:N]`."""
    if v is None: return ""
    s = sanitize(str(v)).strip()
    return s[:max_len] if max_len else s


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
    payload = {"sub": str(user_id),
               "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_MINUTES)}
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)

# SameSite policy for storefront-session cookies: must be "none" in prod so
# a customer can log in on `yourstore.com` (cross-origin to api.tortacrm.com)
# and the session cookie tags along on every subsequent API call. Browsers
# enforce SameSite=None + Secure, so we gate on COOKIE_SECURE — dev (HTTP)
# stays on "lax" which is fine for same-origin Vite proxy setups.
_SESSION_SAMESITE = "none" if COOKIE_SECURE else "lax"


def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="authx_token", value=token,
        httponly=True, max_age=ACCESS_TOKEN_MINUTES * 60,
        samesite=_SESSION_SAMESITE, secure=COOKIE_SECURE, path="/",
    )

def set_refresh_cookie(response: Response, raw: str):
    response.set_cookie(
        key="authx_refresh", value=raw,
        httponly=True, max_age=REFRESH_TOKEN_DAYS * 86400,
        samesite=_SESSION_SAMESITE, secure=COOKIE_SECURE, path="/",
    )

def clear_auth_cookies(response: Response):
    # Deletion MUST mirror set_auth_cookie's samesite + secure. Otherwise the
    # browser rejects the delete in a cross-site context (storefront origin →
    # API origin): a Set-Cookie without SameSite=None;Secure can't modify a
    # SameSite=None cookie cross-site, so the cookie survives and the user stays
    # logged in. This was the "Sign Out does nothing" bug.
    response.delete_cookie("authx_token",   path="/", samesite=_SESSION_SAMESITE, secure=COOKIE_SECURE)
    response.delete_cookie("authx_refresh", path="/", samesite=_SESSION_SAMESITE, secure=COOKIE_SECURE)

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


def get_or_create_guest_user(request: Request, response: Response,
                             project_id: int) -> int:
    """Return the current user_id, or create a guest user row if none.

    Called by every cart-write endpoint so the storefront's "Add to
    cart" works for unauthenticated visitors without any signup step.
    The guest row has:
      • is_guest = TRUE      (drives the "Guest" badge in CRM Orders)
      • email = NULL          (collected only when they reach checkout)
      • password_hash = NULL  (no login possible — the cookie is the
        identity until the email/phone OTP completes registration)

    When the same person later signs up properly via /send-code with
    the email they typed at checkout, /verify-code finds this exact
    row, sets the password, drops the is_guest flag, and their old
    orders are already linked because the user_id stayed constant.

    Idempotent — returns existing user_id when the auth cookie is
    already present; creates a row only on the first unauthenticated
    write hit per browser session.
    """
    uid = try_get_current_user_id(request)
    if uid is not None:
        return uid
    org_id = (db_one("SELECT org_id FROM crm_projects WHERE id=%s", (project_id,)) or {}).get("org_id")
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "INSERT INTO users (project_id, org_id, name, email,"
            "                   is_guest, phone_verified)"
            " VALUES (%s, %s, '', NULL, TRUE, FALSE)"
            " RETURNING id",
            (project_id, org_id)
        )
        new_id = cursor.fetchone()["id"]
        conn.commit()
    # Set the short-lived JWT + a refresh token so the cookie survives
    # the access-token expiry (15 min). Without the refresh token the
    # guest would lose their cart 15 min into browsing.
    set_auth_cookie(response, create_token(new_id))
    try:
        raw = issue_refresh_token(new_id, project_id, request,
                                   label="guest-session")
        set_refresh_cookie(response, raw)
    except Exception:
        # Refresh-token issue is best-effort. Even without it the
        # access cookie lets cart writes proceed in this session.
        pass
    return new_id

def get_client_ip(request: Request) -> str:
    # CloudFlare puts the real client IP in `CF-Connecting-IP`, otherwise the
    # standard `X-Forwarded-For` chain. Falls back to the direct socket.
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip: return cf_ip.strip()
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


# ── Analytics enrichment helpers ───────────────────────────────────────

# Lazy-loaded MaxMind reader. If GEOLITE_DB_PATH env var is set and the
# file exists we use it; otherwise we only rely on CloudFlare headers.
_GEOIP_READER = None
def _geoip_reader():
    global _GEOIP_READER
    if _GEOIP_READER is False: return None        # negative cache
    if _GEOIP_READER:          return _GEOIP_READER
    import os as _os
    path = _os.getenv("GEOLITE_DB_PATH", "")
    if not path or not _os.path.exists(path):
        _GEOIP_READER = False
        return None
    try:
        import geoip2.database   # type: ignore
        _GEOIP_READER = geoip2.database.Reader(path)
        return _GEOIP_READER
    except Exception:
        _GEOIP_READER = False
        return None


def _extract_geo(request: Request, ip: str) -> dict:
    """Returns {country_code, country_name, city} — never raises.
    Priority: CloudFlare headers > MaxMind GeoLite2 > all-None."""
    cc = (request.headers.get("cf-ipcountry") or "").upper().strip()
    cc = cc if len(cc) == 2 and cc.isalpha() else None
    city = (request.headers.get("cf-ipcity") or "").strip() or None
    cname = None
    # Try MaxMind only when CF didn't fill the country in. Keeps the helper
    # cheap on every request when CF is present (the common production path).
    if not cc and ip and ip != "unknown":
        rdr = _geoip_reader()
        if rdr:
            try:
                resp = rdr.country(ip)
                cc    = (resp.country.iso_code or "").upper() or None
                cname = resp.country.name or None
            except Exception:
                pass
    return {"country_code": cc, "country_name": cname, "city": city}


import re as _re_global
_UA_BOT_RE     = _re_global.compile(r"bot|crawler|spider|preview", _re_global.I)
_UA_TABLET_RE  = _re_global.compile(r"ipad|tablet|playbook|silk|(android(?!.*mobile))", _re_global.I)
_UA_MOBILE_RE  = _re_global.compile(r"mobile|iphone|android|ipod|blackberry|opera mini|iemobile", _re_global.I)

def _parse_ua(ua: str) -> dict:
    """Returns {device_type, browser, os}. Rough heuristics — accurate enough
    for "what % of customers are on mobile" widgets without dragging in
    Wurfl / ua-parser (those are 50MB+ deps)."""
    if not ua: return {"device_type": "unknown", "browser": None, "os": None}
    low = ua.lower()
    if _UA_BOT_RE.search(low):       device = "bot"
    elif _UA_TABLET_RE.search(low):  device = "tablet"
    elif _UA_MOBILE_RE.search(low):  device = "mobile"
    else:                            device = "desktop"
    # Browser detection — order matters (Edge/Opera identify as Chrome too).
    if   "edg/" in low or "edge/" in low:  browser = "Edge"
    elif "opr/" in low or "opera" in low:  browser = "Opera"
    elif "chrome" in low and "chromium" not in low: browser = "Chrome"
    elif "firefox" in low:                 browser = "Firefox"
    elif "safari" in low:                  browser = "Safari"
    elif "msie " in low or "trident" in low: browser = "IE"
    else: browser = None
    if   "windows nt" in low: os = "Windows"
    elif "mac os x"   in low: os = "macOS"
    elif "android"    in low: os = "Android"
    elif "iphone os"  in low or "ipad" in low: os = "iOS"
    elif "linux"      in low: os = "Linux"
    else: os = None
    return {"device_type": device, "browser": browser, "os": os}


def _classify_referrer(referrer: str) -> dict:
    """Bucket referrers into traffic-source categories storefront analytics
    can pie-chart. Returns {traffic_source, referrer_host}."""
    if not referrer:
        return {"traffic_source": "direct", "referrer_host": None}
    try:
        from urllib.parse import urlparse
        host = (urlparse(referrer).hostname or "").lower()
    except Exception:
        host = ""
    if not host: return {"traffic_source": "direct", "referrer_host": None}
    # Strip "www." for normalisation
    host = host[4:] if host.startswith("www.") else host
    # Known search engines.
    if any(s in host for s in ("google.", "bing.", "yandex.", "duckduckgo.", "yahoo.")):
        return {"traffic_source": "organic", "referrer_host": host}
    # Known social platforms.
    if any(s in host for s in ("facebook.", "instagram.", "twitter.", "x.com",
                               "tiktok.", "vk.com", "linkedin.", "pinterest.",
                               "youtube.", "reddit.", "t.me", "telegram.")):
        return {"traffic_source": "social", "referrer_host": host}
    return {"traffic_source": "referral", "referrer_host": host}


# In-memory sliding-window rate limiter for checkout (place-order + init-payment).
# Separate bucket from tracking so the two don't share a budget. A real customer
# never places a dozen orders a minute — this only bites bots hammering the public
# storefront key (and each init-payment also creates a real provider PaymentIntent,
# so spamming it would rack up provider-side objects). Keyed per (user_id || IP).
_ORDER_RL = {}   # key: "u:<id>" or "ip:<addr>" → list[float]
def _rate_limit_orders(request: Request, user_id: int | None, max_per_min: int = 12):
    import time
    now = time.time()
    cutoff = now - 60.0
    key = f"u:{user_id}" if user_id else f"ip:{get_client_ip(request)}"
    bucket = [t for t in (_ORDER_RL.get(key) or []) if t > cutoff]
    if len(bucket) >= max_per_min:
        raise HTTPException(429, "Too many checkout attempts — please wait a minute.")
    bucket.append(now)
    _ORDER_RL[key] = bucket
    if len(_ORDER_RL) > 256:
        for k in list(_ORDER_RL.keys()):
            _ORDER_RL[k] = [t for t in _ORDER_RL[k] if t > cutoff]
            if not _ORDER_RL[k]:
                del _ORDER_RL[k]


# In-memory sliding-window rate limiter for tracking endpoints.
# Window: 60 seconds. Limit: 20 events per (user_id || IP) per window.
# Lost on process restart — fine, attacker just has to wait one minute.
_TRACK_RL = {}   # key: "u:<id>" or "ip:<addr>" → list[float] (timestamps)
def _rate_limit_track(request: Request, user_id: int | None, max_per_min: int = 20):
    import time
    now = time.time()
    cutoff = now - 60.0
    if user_id:
        key = f"u:{user_id}"
    else:
        ip = get_client_ip(request)
        key = f"ip:{ip}"
    bucket = _TRACK_RL.get(key) or []
    # Drop entries older than 60s — fast path uses an index search since
    # the list is append-only ordered.
    bucket = [t for t in bucket if t > cutoff]
    if len(bucket) >= max_per_min:
        raise HTTPException(429, "Too many tracking events — slow down")
    bucket.append(now)
    _TRACK_RL[key] = bucket
    # Garbage-collect periodically: when the dict grows beyond 256 keys,
    # walk every entry and drop those whose bucket (after expiry trimming)
    # is empty. The previous version `if not _TRACK_RL[k]` was checked right
    # after we set the current key to a non-empty bucket — so it never
    # evicted anything and the dict grew unbounded.
    if len(_TRACK_RL) > 256:
        for k in list(_TRACK_RL.keys()):
            trimmed = [t for t in (_TRACK_RL.get(k) or []) if t > cutoff]
            if not trimmed:
                _TRACK_RL.pop(k, None)
            else:
                _TRACK_RL[k] = trimmed


# ── Goal progress helper ───────────────────────────────────────────────
def _check_goal_progress(project_id: int, goal_id: int):
    try:
        goal = db_one(
            "SELECT id, name, goal_type, target_value, period, custom_event_name,"
            "       last_achieved_at, last_period_start"
            "  FROM crm_goals WHERE id=%s AND project_id=%s AND is_active=TRUE",
            (goal_id, project_id)
        )
        if not goal: return
        # Compute current cycle window.
        period_days = {
            "1d": 1, "1w": 7, "1mo": 30, "season": 90, "1y": 365,
        }.get(goal["period"])
        if goal["period"] == "all_time":
            cycle_start = None       # NULL window = lifetime
        elif goal["last_period_start"]:
            cycle_start = goal["last_period_start"]
            # Roll over if cycle expired.
            from datetime import timedelta
            if cycle_start + timedelta(days=period_days) < _utcnow():
                cycle_start = _utcnow() - timedelta(days=period_days)
                with db_cursor() as (conn, cur):
                    cur.execute(
                        "UPDATE crm_goals SET last_period_start=%s, last_achieved_at=NULL"
                        " WHERE id=%s",
                        (cycle_start, goal_id)
                    )
                    conn.commit()
        else:
            from datetime import timedelta
            cycle_start = _utcnow() - timedelta(days=period_days)
            with db_cursor() as (conn, cur):
                cur.execute(
                    "UPDATE crm_goals SET last_period_start=%s WHERE id=%s",
                    (cycle_start, goal_id)
                )
                conn.commit()

        # Count progress for custom_event_count goals — others handled by
        # the CRM scheduled tick.
        if goal["goal_type"] != "custom_event_count":
            return
        sql_window = "AND created_at >= %s" if cycle_start else ""
        params = [goal_id]
        if cycle_start: params.append(cycle_start)
        row = db_one(
            f"SELECT COUNT(*) AS n FROM crm_goal_events"
            f" WHERE goal_id=%s {sql_window}",
            tuple(params)
        )
        current = int((row or {}).get("n") or 0)
        target = float(goal["target_value"] or 0)
        if current >= target and not goal["last_achieved_at"]:
            # Achievement! Fire webhook + bell + update last_achieved_at.
            with db_cursor() as (conn, cur):
                cur.execute(
                    "UPDATE crm_goals SET last_achieved_at=NOW() WHERE id=%s",
                    (goal_id,)
                )
                conn.commit()
            dispatch_event(project_id, "goal.achieved", {
                "goal_id":   goal_id,
                "name":      goal["name"],
                "goal_type": goal["goal_type"],
                "target":    target,
                "current":   current,
                "period":    goal["period"],
            })
            # Push notification to every team member (owner + crm_team_members)
            # via the cross-process helper — INSERT + NOTIFY so CRM's bell UI
            # gets it in real-time over WebSocket.
            try:
                proj = db_one("SELECT api_key FROM crm_projects WHERE id=%s", (project_id,))
                link = f"/project/{proj['api_key']}/targets" if proj else None
            except Exception:
                link = None
            push_crm_notification_project(
                project_id, "goal",
                title=f"🎯 Target achieved: {goal['name']}",
                message=f"Reached {current} of {int(target)} target.",
                link=link,
            )
    except Exception as e:
        print(f"[goal] _check_goal_progress({project_id},{goal_id}) failed: {e}")

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

def resolve_api_key_secret(api_key: str, request: Request) -> dict:
    """Auth for trusted server-to-server calls. Validates the SECRET key
    (X-Secret-Key header) — never the publishable one — so only the merchant's
    backend can call these endpoints, not anything running in a browser."""
    record = db_one("SELECT * FROM crm_projects WHERE api_key = %s AND is_active = TRUE", (api_key,))
    if not record:
        raise HTTPException(401, "Invalid or inactive API key")
    sk_header = request.headers.get("x-secret-key", "")
    stored    = record.get("secret_key") or ""
    if not sk_header or not stored or not secrets.compare_digest(sk_header, stored):
        raise HTTPException(401, "Invalid or missing secret key")
    return record

def _eff_price(own_price, parent_eff):
    if own_price is None: return parent_eff
    return float(own_price)


def _build_layer_subtree(rows, layer, parent_eff,
                         layer4_by_parent, layer5_by_parent,
                         specifications_by_node, spec_groups_by_node=None):
    if not rows: return []
    spec_groups_by_node = spec_groups_by_node or {}
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
                                       specifications_by_node, spec_groups_by_node)
                  if children_rows and next_layer <= 5 else [])
        node = {
            "id":              r["id"],
            "name":            r.get("name") or r.get("configuration_name") or "",
            "price":           float(own_price) if own_price is not None else None,
            "effective_price": eff,
            "stock_quantity":  r.get("stock_quantity") or 0,
            "sold_quantity":   r.get("sold_quantity")  or 0,
            "specifications":  specifications_by_node.get((layer, r["id"]), []),
            "spec_groups":     spec_groups_by_node.get((layer, r["id"]), []),
        }
        if nested: node[f"conf_layer_{next_layer}"] = nested
        out.append(node)
    return out


def _split_keywords(value):
    # DB stores comma-separated string; API returns a clean array.
    if not value: return []
    return [t.strip() for t in str(value).split(",") if t.strip()]


def _media_type(url):
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
    spec_groups_by_node=None,  # { (layer, parent_id) → [{name, specs:[…]}] } pre-shaped
    review_stats=None,         # (true_count, true_avg) when `reviews_raw` is a capped subset (list endpoint);
                               # None → derive totals from the full reviews_raw array (single-product page)
):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    spec_groups_by_node = spec_groups_by_node or {}
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
                layer4_by_parent, layer5_by_parent, specifications_by_node, spec_groups_by_node)
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
                "spec_groups":    spec_groups_by_node.get((2, c["id"]), []),
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
            "image":  images[0] if images else None,   # cover (back-compat alias for clients using `image`) — first media in gallery order
            "price": float(v["price"]) if v.get("price") is not None else None,
            "effective_price": var_eff,
            "stock_quantity": v.get("stock_quantity") or 0,
            "sold_quantity":  v.get("sold_quantity")  or 0,
            "is_in_cart": any(c["is_in_cart"] for c in conf_2_out),
            "specifications": specifications_by_node.get((1, v["id"]), []),
            "spec_groups":    spec_groups_by_node.get((1, v["id"]), []),
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
    if review_stats is not None:
        # List endpoint: `reviews` is capped to the newest few; totals come from a
        # separate per-product COUNT/AVG so the rating badge stays correct.
        true_count, true_avg = review_stats
        reviews_count  = int(true_count or 0)
        average_rating = round(float(true_avg), 1) if true_avg is not None else 0.0
    else:
        # Single-product page: `reviews` is the full set — derive totals from it.
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
        "product_type": product.get("product_type") or "physical",   # physical | digital | service
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
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Publishable-Key, X-Web-Chat-Id, X-CSRF-Token, Idempotency-Key"
            resp.headers["Access-Control-Max-Age"]       = "600"
            return resp

        try:
            response = await call_next(request)
        except Exception as _exc:
            # Log the traceback so a 500 doesn't disappear into the void
            # — without this, every unhandled exception inside a route
            # returned a bare 500 with no body and nothing in the
            # terminal, making the order bug we just fixed invisible.
            # Response body stays generic so we don't leak internals.
            import traceback as _tb
            _tb.print_exc()
            print(f"[unhandled] {request.method} {request.url.path}: "
                  f"{type(_exc).__name__}: {_exc}")
            from starlette.responses import JSONResponse as _JR
            response = _JR(status_code=500,
                           content={"detail": "Internal server error"})
        if allow_origin:
            response.headers["Access-Control-Allow-Origin"]      = allow_origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"]                             = "Origin"
        return response

# ─── CSRF double-submit cookie ────────────────────────────────────────────
_CSRF_SAFE_METHODS   = {"GET", "HEAD", "OPTIONS", "TRACE"}
# `/auth/oauth/apple/callback` is exempted because Apple Sign-In's form_post
# mode submits the OAuth code cross-origin from appleid.apple.com — we have no
# way to inject a CSRF token there. The CSRF defence is replaced by Apple's
# id_token JWT signature verification + cookie-based state validation in
# the apple_oauth_callback_post handler.
# `/customers` is a server-to-server ingest endpoint (no browser, no cookies) —
# it's authenticated by the project SECRET key, so CSRF neither applies nor is
# possible there.
_CSRF_EXEMPT_SUFFIX  = ("/refresh", "/auth/oauth/apple/callback", "/customers")
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


# ── Security headers — clickjacking / MIME-sniff / referrer / HSTS ────
# Same set as the CRM backend. HSTS only in production (HTTPS). This API
# serves JSON, so frame-ancestors 'none' + the standard headers are what
# matter; the storefront's full CSP lives on its own edge.
class _SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app
    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send); return
        async def _send(event):
            if event.get("type") == "http.response.start":
                headers = event.setdefault("headers", [])
                have = {k.lower() for k, _ in headers}
                add = [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"strict-origin-when-cross-origin"),
                    (b"x-xss-protection", b"0"),
                    (b"content-security-policy", b"frame-ancestors 'none'"),
                    (b"permissions-policy", b"geolocation=(), microphone=(), camera=()"),
                ]
                if IS_PRODUCTION:
                    add.append((b"strict-transport-security",
                                b"max-age=31536000; includeSubDomains"))
                for k, v in add:
                    if k not in have:
                        headers.append((k, v))
            await send(event)
        await self.app(scope, receive, _send)

app.add_middleware(_SecurityHeadersMiddleware)

# ── Crash alerts — email unhandled 500s to the operator (prod only) ───
ALERT_EMAIL       = os.getenv("ALERT_EMAIL", "iskandersuleiemenov@gmail.com")
_alert_last: dict = {}
_ALERT_THROTTLE_S = 600

def _email_alert(subject: str, body_html: str):
    if not IS_PRODUCTION or not ALERT_EMAIL:
        return
    import time as _t
    if _t.time() - _alert_last.get(subject[:140], 0) < _ALERT_THROTTLE_S:
        return
    _alert_last[subject[:140]] = _t.time()
    try:
        send_email(ALERT_EMAIL, subject, body_html, from_name="Torta Alerts")
    except Exception:
        pass

@app.exception_handler(Exception)
async def _alert_on_unhandled(request: Request, exc: Exception):
    import traceback, threading
    # ALWAYS log the traceback to stdout (dev console + Cloud Run logs) — handling
    # the exception here stops uvicorn from logging it, so we must do it ourselves.
    raw_tb = traceback.format_exc()
    print(f"[500] {request.method} {request.url.path}\n{raw_tb}", flush=True)
    esc = lambda s: str(s).replace("<", "&lt;").replace(">", "&gt;")
    tb = esc(raw_tb)[-4000:]
    subject = f"[API 500] {type(exc).__name__} @ {request.url.path}"
    body = (f"<p><b>{esc(type(exc).__name__)}</b>: {esc(str(exc))[:300]}</p>"
            f"<p>{esc(request.method)} {esc(request.url.path)}</p>"
            f"<pre style='font-size:12px;white-space:pre-wrap'>{tb}</pre>")
    try:
        threading.Thread(target=_email_alert, args=(subject, body), daemon=True).start()
    except Exception:
        pass
    return _JSON({"detail": "Internal server error"}, status_code=500)


@app.api_route("/health", methods=["GET", "HEAD"])
def _healthcheck():
    """Unauthenticated liveness + DB probe for uptime monitors and load
    balancers (no api_key needed). 503 only when the DB is unreachable."""
    try:
        row = db_one("SELECT 1 AS one")
        ok = bool(row and row.get("one") == 1)
    except Exception as e:
        # Log the real reason server-side, but never echo the DB exception to an
        # unauthenticated caller — psycopg2 errors embed host/port/user/dbname.
        print(f"[health] DB probe failed: {e}", flush=True)
        return _JSON({"ok": False, "db": False}, status_code=503)
    return {"ok": ok, "db": ok}


# ── HTTP cache headers for safe-to-cache GETs ─────────────────────
_CACHEABLE_PATH_SUFFIXES = (
    "/config",          # currency / timezone / project name — rare changes
    "/products",        # product list — okay to be 60s stale
    "/auth/methods",    # whether email/phone OTP enabled — almost never changes
    "/categories",      # category list
    "/delivery-eta",    # delivery ETA — pulled per page load otherwise
)
@app.middleware("http")
async def add_cache_headers(request, call_next):
    response = await call_next(request)
    if request.method == "GET":
        path = request.url.path
        if any(path.endswith(s) for s in _CACHEABLE_PATH_SUFFIXES):
            response.headers["Cache-Control"] = "private, max-age=60, stale-while-revalidate=300"
            response.headers["Vary"] = "Cookie"
    return response


# ── МОДЕЛИ ───────────────────────────────────────────────

class SendCodeRequest(BaseModel):
    email: str; type: str; name: str = None; password: str = None
    # Optional extended profile fields, used only on register. A merchant asks
    # for whatever its business needs; all are nullable and ignored on login.
    surname: str = None; address: str = None; birthdate: str = None

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
    # Optional enrichment from storefront — SDK pulls these from
    # document.referrer / location.search / navigator.language / window.innerWidth.
    referrer:      Optional[str] = None
    utm_source:    Optional[str] = None
    utm_medium:    Optional[str] = None
    utm_campaign:  Optional[str] = None
    language:      Optional[str] = None
    screen_width:  Optional[int] = None

class TrackVisitRequest(BaseModel):
    """Storefront-provided enrichment payload for /track/visit. All fields
    are optional — backend never fails the call if any are missing."""
    referrer:      Optional[str] = None
    utm_source:    Optional[str] = None
    utm_medium:    Optional[str] = None
    utm_campaign:  Optional[str] = None
    language:      Optional[str] = None
    screen_width:  Optional[int] = None

class TrackSearchRequest(BaseModel):
    query:         str
    results_count: int = 0

class TrackCartEventRequest(BaseModel):
    action:           str               # add | remove | update_qty | apply_promo | remove_promo
    product_id:       Optional[int] = None
    variation_id:     Optional[int] = None
    configuration_id: Optional[int] = None
    quantity:         Optional[int] = None
    promo_code:       Optional[str] = None

class TrackCheckoutRequest(BaseModel):
    step:         str                  # started | address_filled | promo_tried | submitted | failed
    fail_reason:  Optional[str] = None
    total_amount: Optional[float] = None

class TrackGoalRequest(BaseModel):
    event_name:   str                  # must match an active crm_goals.custom_event_name
    value:        Optional[float] = None
    metadata:     Optional[dict]  = None

class PlaceOrderRequest(BaseModel):
    # Legacy single freeform name — composed from structured fields
    # below if those are sent. Made optional so new clients can omit
    # it entirely; old clients keep working.
    recipient_name: Optional[str] = None
    # Structured recipient name. `first` + `last` are required by the
    # backend (validated server-side); `middle` (patronymic) is
    # optional for non-CIS users.
    recipient_first_name:  Optional[str] = None
    recipient_last_name:   Optional[str] = None
    recipient_middle_name: Optional[str] = None
    # Guest checkout — when no auth cookie is present we use this as
    # the customer's contact identity. Required for guest orders.
    customer_email: Optional[str] = None
    phone: Optional[str] = None
    delivery_method: str = "courier"   # courier | postal
    # `address` stays for back-compat: old clients that don't know
    # about the structured fields keep working, and the merchant's
    # invoice PDF / receipt PDF that print "address" stay rendering.
    # New clients SHOULD send the structured fields instead — we'll
    # compose the legacy string from them on insert.
    address: Optional[str] = None
    # Structured shipping address — what real carriers want:
    #   country  → "Kazakhstan"
    #   city     → "Алматы"        (highlight block on shipping label)
    #   postal   → "050000"
    #   street   → "ул. Толе би, 273А"
    #   apartment → "кв. 123, 4 этаж, домофон 123#"
    # All optional individually so guest-checkout for digital goods
    # doesn't get blocked by required-address validation.
    address_country:     Optional[str] = None
    address_city:        Optional[str] = None
    address_postal_code: Optional[str] = None
    address_street:      Optional[str] = None
    # Apartment is split into 4 separate fields so the courier sees
    # clean structured info: which apartment number, which floor,
    # which entrance, the intercom code. Saves time on the doorstep
    # vs parsing one freeform line.
    address_apartment:   Optional[str] = None
    address_floor:       Optional[str] = None
    address_entrance:    Optional[str] = None
    address_intercom:    Optional[str] = None
    comment: Optional[str] = None
    payment_method: str = "card"       # card | cash
    promo_code: Optional[str] = None
    # Fulfillment: 'courier' delivers to address, 'pickup' = customer
    # collects from a warehouse. When `pickup`, `pickup_warehouse_id` is
    # required and `address` becomes optional.
    fulfillment_type:     str = "courier"   # courier | pickup
    pickup_warehouse_id:  Optional[int] = None
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
    group: str = ''     # optional section name (product_spec_groups), '' = ungrouped

class FrontSpecGroup(BaseModel):
    name: str = ''
    specs: List[FrontSpecification] = []

class FrontConfNode(BaseModel):
    id: int
    name: str = ''
    price: Optional[float] = None
    effective_price: Optional[float] = None
    stock_quantity: int = 0
    sold_quantity: int = 0
    specifications: List[FrontSpecification] = []
    spec_groups: List[FrontSpecGroup] = []   # specs nested under named sections
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
    product_type: str = "physical"      # physical | digital | service
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
    downloads: List[dict] = []          # digital only: buyer download links [{label, url}]
                                        # (one ZIP when digital_zip is on, else one per file).
                                        # MUST be declared here or response_model strips it.
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
    # Drives Checkout's UI: True → show structured address form,
    # False → show "Digital delivery — files arrive in email" note.
    # Defaults to True so the address form is the safe fallback if a
    # field ever gets lost in transit (better to over-collect address
    # data for a digital order than to skip collecting it for a
    # physical one and have the merchant unable to ship). Without
    # this field declared on the Pydantic response_model the
    # endpoint's returned value would be silently stripped during
    # FastAPI serialization — that was a real bug we hit.
    requires_shipping: bool = True


# ── EMAIL ────────────────────────────────────────────────

# ── Per-org daily email quota (shared crm_email_usage table, created by CRM) ──
def _email_org_id(project_id):
    if not project_id:
        return None
    r = db_one("SELECT org_id FROM crm_projects WHERE id=%s", (project_id,))
    return r.get("org_id") if r else None

def _email_quota_room(org_id) -> bool:
    """True if the org can send >=1 more email today (under emails_per_day_max).
    None limit / no plan row = unlimited."""
    if not org_id:
        return True
    row = db_one("SELECT (p.limits->>'emails_per_day_max') AS lim "
                 "FROM crm_organizations o "
                 "JOIN crm_subscription_plans p ON p.slug = COALESCE(o.plan_slug, 'free') "
                 "WHERE o.id = %s", (org_id,))
    lim = row.get("lim") if row else None
    if lim is None:
        return True
    r = db_one("SELECT sent FROM crm_email_usage WHERE org_id=%s AND day=CURRENT_DATE", (org_id,))
    return (int(r["sent"]) if r else 0) < int(lim)

def _email_count_inc(org_id, n: int = 1) -> None:
    if not org_id:
        return
    try:
        with db_cursor() as (conn, cur):
            cur.execute("INSERT INTO crm_email_usage (org_id, day, sent) VALUES (%s, CURRENT_DATE, %s) "
                        "ON CONFLICT (org_id, day) DO UPDATE SET sent = crm_email_usage.sent + EXCLUDED.sent",
                        (org_id, n))
            conn.commit()
    except Exception as e:
        print(f"[email_count] inc failed for org {org_id}: {e}")

def _enforce_storefront_users(org_id) -> None:
    """Raise 402 (plan_limit_exceeded) if the org is at its storefront-users cap
    — i.e. registered (non-guest) customers. No-op when org_id is missing, the
    limit is null (unlimited) or PLAN_ENFORCEMENT_DISABLED=1.

    Guests (anonymous carts) NEVER count toward the cap and are never blocked.
    Call this in every NEW-registration path right before the row is created or
    a guest is upgraded to a real account — never on plain login of an existing
    registered customer (that doesn't add to the count)."""
    if not org_id:
        return
    if os.getenv("PLAN_ENFORCEMENT_DISABLED", "0") == "1":
        return
    row = db_one("SELECT (p.limits->>'storefront_users_max') AS lim, p.slug AS slug "
                 "FROM crm_organizations o "
                 "JOIN crm_subscription_plans p ON p.slug = COALESCE(o.plan_slug, 'free') "
                 "WHERE o.id = %s", (org_id,))
    lim = (row or {}).get("lim")
    if lim is None:
        return
    cnt = db_one(
        "SELECT COUNT(*) AS n FROM users "
        " WHERE NOT COALESCE(is_guest, FALSE) "
        "   AND (org_id = %s OR project_id IN (SELECT id FROM crm_projects WHERE org_id = %s))",
        (org_id, org_id))
    current = int((cnt or {}).get("n") or 0)
    if current >= int(lim):
        raise HTTPException(402, detail={
            "error":     "plan_limit_exceeded",
            "plan":      (row or {}).get("slug"),
            "resource":  "storefront_users",
            "limit":     int(lim),
            "current":   current,
            "requested": 1,
        })


def send_email(to: str, subject: str, html: str,
               from_name: str = "Torta Store", from_email: str = EMAIL_FROM,
               project_id: int = None) -> bool:
    # Store->customer emails pass project_id → each send counts toward the org's
    # daily quota (emails_per_day_max). Over the limit → skip (block).
    org_id = _email_org_id(project_id) if project_id else None
    if org_id is not None and not _email_quota_room(org_id):
        print(f"[email] org {org_id} hit daily email limit — skipping send to {to}")
        return False
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
            ok = json.loads(resp.read()).get("ok", False)
    except Exception as e:
        print(f"Email error: {e}"); return False
    if ok and org_id is not None:
        _email_count_inc(org_id)
    return ok

def send_code_email(email: str, code: int, project_id: int = None) -> bool:
    return _send_template_email(project_id, "verification", email,
                                {"code": str(code), "store_name": _project_store_name(project_id), "expiry_minutes": "10"})

def send_reset_email(email: str, token: str, project_id: int = None) -> bool:
    frontend = get_project_frontend_url(project_id) if project_id else None
    if not frontend:
        print(f"send_reset_email: Site URL not configured for project_id={project_id}"); return False
    reset_url = f"{frontend}/reset-password/{token}"
    return _send_template_email(project_id, "password_reset", email,
                                {"reset_url": reset_url, "store_name": _project_store_name(project_id)})


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


_PRIVATE_NET_RE = _re_global.compile(
    r"^(?:127\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|"
    r"::1$|fc00:|fd00:|fe80:|0\.0\.0\.0)"
)
def _url_is_safe_for_outbound(url: str) -> tuple:
    """SSRF guard for merchant-supplied webhook URLs, mirroring the CRM backend's
    check. MUST run at DELIVERY time (every dispatch), not only at registration —
    the registration-time check in CRM cannot stop a hostname that resolves to a
    public IP at create time and is later re-pointed (DNS rebinding) at a private/
    metadata address. Rejects non-http(s) schemes and any hostname that resolves
    to a private / loopback / link-local / cloud-metadata address."""
    import socket
    import urllib.parse as _uparse
    try:
        parsed = _uparse.urlparse(url)
    except Exception:
        return False, "Malformed URL"
    if parsed.scheme not in ("http", "https"):
        return False, "Only http/https URLs are accepted"
    if IS_PRODUCTION and parsed.scheme != "https":
        return False, "Production webhooks must use https"
    host = (parsed.hostname or "").strip().lower()
    if not host:
        return False, "URL is missing a hostname"
    if host in ("localhost", "ip6-localhost", "ip6-loopback"):
        return False, "Loopback URLs are not allowed"
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False, f"Could not resolve hostname '{host}'"
    for _fam, _t, _p, _c, sockaddr in infos:
        ip = sockaddr[0]
        if _PRIVATE_NET_RE.match(ip):
            return False, f"URL resolves to a private/loopback address ({ip})"
    return True, ""


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
    # SSRF guard at delivery time — refuse to fetch private/loopback/metadata
    # targets even if the URL passed the registration-time check (DNS rebinding).
    ok, reason = _url_is_safe_for_outbound(sub.get("url") or "")
    if not ok:
        out.update({"status": "failed", "http_code": None,
                    "response_body": f"[blocked] {reason}"[:2000], "duration_ms": 0})
        return out
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
# Toggled at the bottom of this kvstore block — flipped to True after the
# crm_kv_store table is confirmed to exist. When True, all _kv_* calls go
# to Postgres → multi-instance safe (Fly.io machines, Docker replicas).
_pg_kv_active = False

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


# Currency metadata mirrors the JS Utils/currency.js table. Whenever
# that JS table changes, this Python table must stay in lock-step so a
# tenge-priced order rendered in the storefront ("100 ₸") shows the
# same on its PDF invoice. `position` decides symbol placement:
#   'prefix' → "$1,234.50"      (USD/EUR/GBP/JPY/CNY/INR/etc.)
#   'suffix' → "1,234.50 ₸"     (KZT/RUB/UAH/PLN/CZK/etc.)
# `decimals` matches ISO 4217 minor-unit rules — JPY/KRW/HUF/UZS/VND
# are whole-unit so we drop the cents.
_PDF_CURRENCY = {
    'USD': ('$',   'prefix', 2), 'EUR': ('€',   'prefix', 2), 'GBP': ('£',   'prefix', 2),
    'JPY': ('¥',   'prefix', 0), 'CNY': ('¥',   'prefix', 2), 'CHF': ('Fr.', 'prefix', 2),
    'CAD': ('C$',  'prefix', 2), 'AUD': ('A$',  'prefix', 2), 'NZD': ('NZ$', 'prefix', 2),
    'SGD': ('S$',  'prefix', 2), 'HKD': ('HK$', 'prefix', 2), 'INR': ('₹',   'prefix', 2),
    'KRW': ('₩',   'prefix', 0), 'IDR': ('Rp',  'prefix', 0), 'THB': ('฿',   'prefix', 2),
    'MYR': ('RM',  'prefix', 2), 'PHP': ('₱',   'prefix', 2), 'ILS': ('₪',   'prefix', 2),
    'BRL': ('R$',  'prefix', 2), 'MXN': ('MX$', 'prefix', 2), 'ARS': ('AR$', 'prefix', 2),
    'CLP': ('CLP$','prefix', 0), 'COP': ('COL$','prefix', 2), 'ZAR': ('R',   'prefix', 2),
    'EGP': ('E£',  'prefix', 2), 'NGN': ('₦',   'prefix', 2),
    # suffix-side
    'VND': ('₫',   'suffix', 0), 'AED': ('د.إ', 'suffix', 2), 'SAR': ('﷼',   'suffix', 2),
    'TRY': ('₺',   'suffix', 2), 'PLN': ('zł',  'suffix', 2), 'CZK': ('Kč',  'suffix', 2),
    'HUF': ('Ft',  'suffix', 0), 'RON': ('lei', 'suffix', 2), 'BGN': ('лв',  'suffix', 2),
    'SEK': ('kr',  'suffix', 2), 'NOK': ('kr',  'suffix', 2), 'DKK': ('kr',  'suffix', 2),
    'ISK': ('kr',  'suffix', 0), 'KZT': ('₸',   'suffix', 2), 'RUB': ('₽',   'suffix', 2),
    'UAH': ('₴',   'suffix', 2), 'BYN': ('Br',  'suffix', 2), 'KGS': ('с',   'suffix', 2),
    'UZS': ("so'm",'suffix', 0), 'TJS': ('SM',  'suffix', 2), 'TMT': ('m',   'suffix', 2),
    'AZN': ('₼',   'suffix', 2), 'GEL': ('₾',   'suffix', 2), 'AMD': ('֏',   'suffix', 2),
}


def _money(amount, currency="USD"):
    """Format `amount` as money in the given ISO 4217 code, using the
    same symbol position rules as the frontend's formatMoney. Unknown
    codes fall back to "<amount> <CODE>" so an unrecognized currency
    doesn't break the invoice — operator sees the raw code instead."""
    code = (currency or "USD").upper()
    meta = _PDF_CURRENCY.get(code)
    if not meta:
        return f"{amount:,.2f} {code}"
    sym, position, decimals = meta
    num = f"{amount:,.{decimals}f}"
    return f"{sym}{num}" if position == 'prefix' else f"{num} {sym}"


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
    now = time.time()
    expired = [k for k, t in _mem_expires.items() if t <= now]
    for k in expired:
        _mem.pop(k, None)
        _mem_expires.pop(k, None)


# ─── Postgres backend (used when Redis is not configured) ──────────────────
# Mirrors Redis SETEX/INCR semantics on top of the shared `crm_kv_store`
# table. Multi-instance safe — every container reads/writes the same rows.
# Falls through to the in-memory backend if Postgres has a transient error.

def _glob_to_like(pattern: str) -> str:
    p = pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    p = p.replace("*", "%").replace("?", "_")
    return p

def _pg_kv_get(key: str):
    row = db_one(
        "SELECT value FROM crm_kv_store "
        " WHERE key = %s AND (expires_at IS NULL OR expires_at > NOW())",
        (key,)
    )
    return row["value"] if row else None

def _pg_kv_set(key: str, value, ttl=None) -> None:
    payload = json.dumps(value)
    with db_cursor() as (conn, cur):
        if ttl:
            cur.execute(
                "INSERT INTO crm_kv_store (key, value, expires_at) "
                "VALUES (%s, %s::jsonb, NOW() + (%s || ' seconds')::interval) "
                "ON CONFLICT (key) DO UPDATE SET "
                "  value=EXCLUDED.value, expires_at=EXCLUDED.expires_at, updated_at=NOW()",
                (key, payload, str(int(ttl)))
            )
        else:
            cur.execute(
                "INSERT INTO crm_kv_store (key, value) VALUES (%s, %s::jsonb) "
                "ON CONFLICT (key) DO UPDATE SET "
                "  value=EXCLUDED.value, expires_at=NULL, updated_at=NOW()",
                (key, payload)
            )
        conn.commit()

def _pg_kv_delete(key: str) -> None:
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM crm_kv_store WHERE key = %s", (key,))
        conn.commit()

def _pg_kv_exists(key: str) -> bool:
    row = db_one(
        "SELECT 1 FROM crm_kv_store "
        " WHERE key = %s AND (expires_at IS NULL OR expires_at > NOW())",
        (key,)
    )
    return bool(row)

def _pg_kv_incr(key: str, ttl=None) -> int:
    with db_cursor() as (conn, cur):
        if ttl:
            cur.execute(
                "INSERT INTO crm_kv_store (key, value, expires_at) "
                "VALUES (%s, '1'::jsonb, NOW() + (%s || ' seconds')::interval) "
                "ON CONFLICT (key) DO UPDATE SET "
                "  value = ((crm_kv_store.value)::text::int + 1)::text::jsonb, "
                "  updated_at = NOW() "
                "RETURNING (crm_kv_store.value)::text::int AS n",
                (key, str(int(ttl)))
            )
        else:
            cur.execute(
                "INSERT INTO crm_kv_store (key, value) VALUES (%s, '1'::jsonb) "
                "ON CONFLICT (key) DO UPDATE SET "
                "  value = ((crm_kv_store.value)::text::int + 1)::text::jsonb, "
                "  updated_at = NOW() "
                "RETURNING (crm_kv_store.value)::text::int AS n",
                (key,)
            )
        n = cur.fetchone()["n"]
        conn.commit()
        return int(n)

def _pg_kv_ttl(key: str) -> int:
    row = db_one(
        "SELECT EXTRACT(EPOCH FROM (expires_at - NOW()))::int AS s, "
        "       (expires_at IS NULL) AS no_expiry "
        "  FROM crm_kv_store WHERE key = %s",
        (key,)
    )
    if not row: return -2
    if row["no_expiry"]: return -1
    return max(int(row["s"] or 0), 0)

def _pg_kv_keys_matching(pattern: str) -> list[str]:
    like = _glob_to_like(pattern)
    rows = db_all(
        "SELECT key FROM crm_kv_store "
        " WHERE key LIKE %s ESCAPE E'\\\\' "
        "   AND (expires_at IS NULL OR expires_at > NOW())",
        (like,)
    )
    return [r["key"] for r in rows]


# ─── Public API ─────────────────────────────────────────────────────────────

def _kv_get(key: str) -> Any | None:
    if _redis:
        v = _redis.get(key)
        if v is None: return None
        try:    return json.loads(v)
        except Exception: return None
    if _pg_kv_active:
        try:    return _pg_kv_get(key)
        except Exception: pass
    with _mem_lock:
        _mem_purge_expired()
        return _mem.get(key)

def _kv_set(key: str, value: Any, ttl: int | None = None) -> None:
    if _redis:
        payload = json.dumps(value)
        if ttl: _redis.setex(key, int(ttl), payload)
        else:   _redis.set(key, payload)
        return
    if _pg_kv_active:
        try:    _pg_kv_set(key, value, ttl); return
        except Exception: pass
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
    if _pg_kv_active:
        try:    _pg_kv_delete(key); return
        except Exception: pass
    with _mem_lock:
        _mem.pop(key, None)
        _mem_expires.pop(key, None)

def _kv_exists(key: str) -> bool:
    if _redis:
        return bool(_redis.exists(key))
    if _pg_kv_active:
        try:    return _pg_kv_exists(key)
        except Exception: pass
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
    if _pg_kv_active:
        try:    return _pg_kv_incr(key, ttl)
        except Exception: pass
    with _mem_lock:
        _mem_purge_expired()
        cur = int(_mem.get(key, 0)) + 1
        _mem[key] = cur
        if ttl is not None and key not in _mem_expires:
            _mem_expires[key] = time.time() + int(ttl)
        return cur

def _kv_ttl(key: str) -> int:
    if _redis:
        return int(_redis.ttl(key))
    if _pg_kv_active:
        try:    return _pg_kv_ttl(key)
        except Exception: pass
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
    if _pg_kv_active:
        try:    return _pg_kv_keys_matching(pattern)
        except Exception: pass
    with _mem_lock:
        _mem_purge_expired()
        return [k for k in list(_mem.keys()) if fnmatch.fnmatch(k, pattern)]


# ─── Activate Postgres backend (idempotent table init) ─────────────────────
# CRM backend creates this same table in its own run_migrations(); doing it
# here too is harmless thanks to CREATE TABLE IF NOT EXISTS, and lets External
# start standalone (e.g. in tests, or when CRM container hasn't booted yet).
if not _redis and os.getenv("USE_PG_KV", "1") == "1":
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_kv_store (
                    key         VARCHAR(255) PRIMARY KEY,
                    value       JSONB        NOT NULL,
                    expires_at  TIMESTAMPTZ  NULL,
                    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_crm_kv_expires
                  ON crm_kv_store (expires_at) WHERE expires_at IS NOT NULL
            """)
            conn.commit()
        _pg_kv_active = True
        _backend_name = "postgres"
        print("[kvstore] Using Postgres KV backend (crm_kv_store)")
    except Exception as e:
        print(f"[kvstore] Postgres init failed ({e}) — falling back to in-memory")


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
    token = request.cookies.get("csrf_token", "")
    if not token:
        token = secrets.token_hex(32)
    response.set_cookie(
        "csrf_token", token,
        httponly=False,       # JS must read this to echo it as a header
        # SameSite=None is required for cross-origin SDK usage: a storefront
        # on `yourstore.com` calls `api.tortacrm.com` — without None the
        # cookie is never sent back, every POST 403s with "CSRF missing".
        # The CSRF protection still holds via the double-submit check
        # (attacker on evil.com can't read the cookie cross-origin so can't
        # forge the matching X-CSRF-Token header). Falls back to "lax" in
        # dev because browsers reject SameSite=None without Secure flag.
        samesite="none" if COOKIE_SECURE else "lax",
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
    org_id     = api_key_record.get("org_id")
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
        existing = get_user_by_email(email, project_id, org_id)
        # A pre-existing GUEST row with this email is fine — that
        # means the same person checked out as a guest earlier and is
        # now properly signing up. /verify-code will UPDATE the
        # existing row in-place: set name/password, drop is_guest,
        # mark email verified. All their previous orders remain
        # linked because the user_id never changes.
        if existing and not existing.get("is_guest"):
            fail("Email already exists")
        if not request.name or not request.password: fail("Name and password required")
        validate_password(request.password)
        if request.birthdate:
            from datetime import date
            try:
                date.fromisoformat(request.birthdate.strip())
            except ValueError:
                fail("birthdate must be YYYY-MM-DD")
    elif request.type == "login":
        db_user = get_user_by_email(email, project_id, org_id)
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
        "surname": request.surname, "address": request.address, "birthdate": request.birthdate,
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
                background_tasks: BackgroundTasks,
                api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    org_id     = api_key_record.get("org_id")
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
        is_new_user = False
        if pending["type"] == "register":
            # Optional extended profile fields collected at registration
            # (surname / address / birthdate). All nullable — a merchant only
            # asks for what they need. birthdate is pre-validated in send_code.
            reg_surname   = sanitize((pending.get("surname") or "").strip())[:200] or None
            reg_address   = sanitize((pending.get("address") or "").strip())[:500] or None
            reg_birthdate = (pending.get("birthdate") or "").strip() or None
            # If a guest row with this email already exists (placed an
            # order earlier without signing up), upgrade it in place
            # rather than creating a parallel account — that's the
            # whole point of the auto-claim feature. We do that BEFORE
            # the INSERT path so the happy guest case is one query.
            existing = get_user_by_email(email, project_id, org_id)
            # Storefront-users cap: gate BEFORE creating/upgrading a registered
            # customer (new INSERT or guest→registered upgrade). Plain login of
            # an already-registered customer never reaches this register branch.
            if (existing is None) or existing.get("is_guest"):
                _enforce_storefront_users(org_id)
            if existing and existing.get("is_guest"):
                cursor.execute(
                    "UPDATE users SET name=%s, last_name=COALESCE(%s,last_name), password_hash=%s,"
                    "                 address=COALESCE(%s,address), birthdate=COALESCE(%s,birthdate),"
                    "                 is_guest=FALSE"
                    " WHERE id=%s",
                    (sanitize(pending["name"]), reg_surname, hash_password(pending["password"]),
                     reg_address, reg_birthdate, existing["id"])
                )
                conn.commit()
                user_id = existing["id"]
                # Treat as a new "real" user for downstream events —
                # this is the first time we have all of their info.
                is_new_user = True
            else:
                try:
                    cursor.execute(
                        "INSERT INTO users (name, last_name, email, password_hash, project_id, org_id, address, birthdate)"
                        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                        (sanitize(pending["name"]), reg_surname, email, hash_password(pending["password"]),
                         project_id, org_id, reg_address, reg_birthdate)
                    )
                    user_id = cursor.fetchone()["id"]
                    conn.commit()
                    is_new_user = True
                except psycopg2.errors.UniqueViolation:
                    conn.rollback()
                    # Race: another request created the same user concurrently
                    existing = get_user_by_email(email, project_id, org_id)
                    if not existing:
                        raise HTTPException(500, "Registration failed")
                    user_id = existing["id"]
        else:
            user_id = get_user_by_email(email, project_id, org_id)["id"]

    # Fire customer.created for Mailchimp / GA4 / Mixpanel / any subscriber that
    # listens on it. Done outside the cursor block so a slow dispatch doesn't
    # hold the DB connection.
    if is_new_user:
        background_tasks.add_task(dispatch_event, project_id, "customer.created", {
            "user_id":  user_id,
            "customer": {"name": sanitize(pending["name"]), "email": email},
        })

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
    user = get_user_by_id(get_current_user_id(request), api_key_record["id"], api_key_record.get("org_id"))
    if not user: raise HTTPException(401, "User not found")
    return {"id": user["id"], "name": user["name"], "email": user["email"]}


@app.get("/{api_key}/auth/methods")
def get_auth_methods(api_key_record: dict = Depends(resolve_api_key)):
    """What contact methods does this storefront support for checkout
    + login? Driven by the merchant's `crm_auth_providers` config in
    CRM. The Magaz Checkout uses this to render the right input
    (email-only, phone-only, or a toggle between both).
    Email is always available because order-confirmation emails
    rely on it and our SES infrastructure is shared platform-wide."""
    project_id = api_key_record["id"]
    phone_enabled = False
    try:
        row = db_one(
            "SELECT is_enabled FROM crm_auth_providers"
            " WHERE project_id=%s AND provider='phone'",
            (project_id,)
        )
        phone_enabled = bool(row and row.get("is_enabled"))
    except Exception:
        phone_enabled = False
    return {"email": True, "phone": phone_enabled}


# ── CUSTOMER INGEST (server-to-server; merchants running their own auth) ──
# Lets a merchant push customer records into the CRM from THEIR backend using
# the project's SECRET key. No password / no login here — these are data-only
# "external" customers. Upserts by email (then phone), respecting org-shared scope.

class CustomerUpsertBody(BaseModel):
    email:     Optional[str]  = None
    phone:     Optional[str]  = None
    name:      Optional[str]  = None
    last_name: Optional[str]  = None
    surname:   Optional[str]  = None     # alias for last_name (matches registration field)
    birthdate: Optional[str]  = None     # ISO date "YYYY-MM-DD"
    address:   Optional[str]  = None
    metadata:  Optional[dict] = None     # free-form custom fields

@app.post("/{api_key}/customers")
def upsert_customer(body: CustomerUpsertBody, api_key: str,
                    api_key_record: dict = Depends(resolve_api_key_secret)):
    project_id = api_key_record["id"]
    org_id     = api_key_record.get("org_id")

    email = (body.email or "").lower().strip() or None
    phone = (body.phone or "").strip() or None
    if not email and not phone:
        raise HTTPException(400, "email or phone is required")

    name      = sanitize((body.name or "").strip())[:200]
    last_name = sanitize((body.last_name or body.surname or "").strip())[:200] or None
    address   = sanitize((body.address or "").strip())[:500] or None
    birthdate = (body.birthdate or "").strip() or None
    if birthdate:
        from datetime import date
        try:
            date.fromisoformat(birthdate)
        except ValueError:
            raise HTTPException(400, "birthdate must be YYYY-MM-DD")
    metadata = body.metadata if isinstance(body.metadata, dict) else {}

    # Find an existing record — email first, then phone — in org or project scope.
    existing = get_user_by_email(email, project_id, org_id) if email else None
    if not existing and phone:
        if org_id is not None and _org_shares_customers(org_id):
            existing = db_one("SELECT id FROM users WHERE phone=%s AND org_id=%s ORDER BY id LIMIT 1", (phone, org_id))
        else:
            existing = db_one("SELECT id FROM users WHERE phone=%s AND project_id=%s ORDER BY id LIMIT 1", (phone, project_id))

    with db_cursor() as (conn, cur):
        if existing:
            cur.execute(
                "UPDATE users SET "
                "  name      = COALESCE(NULLIF(%s,''), name), "
                "  last_name = COALESCE(%s, last_name), "
                "  phone     = COALESCE(%s, phone), "
                "  birthdate = COALESCE(%s, birthdate), "
                "  address   = COALESCE(%s, address), "
                "  metadata  = COALESCE(metadata,'{}'::jsonb) || %s::jsonb "
                "WHERE id=%s RETURNING id",
                (name, last_name, phone, birthdate, address, json.dumps(metadata), existing["id"]))
            user_id = cur.fetchone()["id"]
            created = False
        else:
            _enforce_storefront_users(org_id)
            cur.execute(
                "INSERT INTO users "
                "  (project_id, org_id, name, last_name, email, phone, birthdate, address, "
                "   metadata, is_external, is_guest, password_hash) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb, TRUE, FALSE, '') RETURNING id",
                (project_id, org_id, name, last_name, email, phone, birthdate, address,
                 json.dumps(metadata)))
            user_id = cur.fetchone()["id"]
            created = True
        conn.commit()
    return {"ok": True, "id": user_id, "created": created}


# ── SAVED ADDRESSES ──────────────────────────────────────

class SaveAddressBody(BaseModel):
    label:        Optional[str] = ""    # "Home", "Office" etc.
    country:      Optional[str] = ""
    city:         Optional[str] = ""
    postal_code:  Optional[str] = ""
    street:       Optional[str] = ""
    apartment:    Optional[str] = ""
    floor:        Optional[str] = ""
    entrance:     Optional[str] = ""
    intercom:     Optional[str] = ""
    is_default:   Optional[bool] = False


def _serialize_address(r: dict) -> dict:
    return {
        "id":          r["id"],
        "label":       r.get("label") or "",
        "country":     r.get("country") or "",
        "city":        r.get("city") or "",
        "postal_code": r.get("postal_code") or "",
        "street":      r.get("street") or "",
        "apartment":   r.get("apartment") or "",
        "floor":       r.get("floor") or "",
        "entrance":    r.get("entrance") or "",
        "intercom":    r.get("intercom") or "",
        "is_default":  bool(r.get("is_default")),
        "created_at":  r["created_at"].isoformat() if r.get("created_at") else None,
    }


@app.get("/{api_key}/me/addresses")
def list_my_addresses(request: Request, api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    rows = db_all(
        "SELECT id, label, country, city, postal_code, street, apartment,"
        "       floor, entrance, intercom, is_default, created_at"
        "  FROM user_addresses"
        " WHERE project_id=%s AND user_id=%s"
        " ORDER BY is_default DESC, created_at DESC",
        (project_id, user_id)
    )
    return [_serialize_address(r) for r in rows]


@app.post("/{api_key}/me/addresses")
def save_my_address(body: SaveAddressBody, request: Request,
                    api_key_record: dict = Depends(resolve_api_key)):
    """Save a new delivery address. If is_default=true, clears the
    default flag from all other addresses (only one default per user)."""
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    label     = clean(body.label,       60)
    country   = clean(body.country,     60)
    city      = clean(body.city,        120)
    postal    = clean(body.postal_code, 20)
    street    = clean(body.street,      300)
    apartment = clean(body.apartment,   120)
    floor     = clean(body.floor,       20)
    entrance  = clean(body.entrance,    20)
    intercom  = clean(body.intercom,    40)
    if not city or not street:
        raise HTTPException(400, "City and street are required")
    # Soft cap so a runaway client can't fill the table.
    cur_count = db_one(
        "SELECT COUNT(*) AS c FROM user_addresses WHERE project_id=%s AND user_id=%s",
        (project_id, user_id)
    )
    if cur_count and cur_count["c"] >= 20:
        raise HTTPException(400, "Address book limit reached (20)")
    with db_cursor() as (conn, cursor):
        if body.is_default:
            cursor.execute(
                "UPDATE user_addresses SET is_default=FALSE"
                " WHERE project_id=%s AND user_id=%s",
                (project_id, user_id)
            )
        # `region` is a legacy NOT NULL column with no default —
        # explicit '' so the INSERT doesn't trip on it.
        cursor.execute(
            "INSERT INTO user_addresses"
            " (project_id, user_id, label, country, region, city, postal_code, street, apartment,"
            "  floor, entrance, intercom, is_default)"
            " VALUES (%s,%s,%s,%s,'',%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (project_id, user_id, label, country, city, postal, street, apartment,
             floor, entrance, intercom, bool(body.is_default))
        )
        new_id = cursor.fetchone()["id"]
        conn.commit()
    return {"id": new_id}


@app.delete("/{api_key}/me/addresses/{addr_id}")
def delete_my_address(addr_id: int, request: Request,
                      api_key_record: dict = Depends(resolve_api_key)):
    """Remove an address. 404 if it belongs to a different user — never
    leak existence by returning 403 here."""
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "DELETE FROM user_addresses WHERE id=%s AND project_id=%s AND user_id=%s",
            (addr_id, project_id, user_id)
        )
        if cursor.rowcount == 0:
            raise HTTPException(404, "Address not found")
        conn.commit()
    return {"ok": True}


@app.patch("/{api_key}/me/addresses/{addr_id}/default")
def set_default_address(addr_id: int, request: Request,
                        api_key_record: dict = Depends(resolve_api_key)):
    """Promote an address to default. Clears the flag on all others
    for this user atomically inside a single transaction."""
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "UPDATE user_addresses SET is_default=FALSE"
            " WHERE project_id=%s AND user_id=%s",
            (project_id, user_id)
        )
        cursor.execute(
            "UPDATE user_addresses SET is_default=TRUE"
            " WHERE id=%s AND project_id=%s AND user_id=%s",
            (addr_id, project_id, user_id)
        )
        if cursor.rowcount == 0:
            raise HTTPException(404, "Address not found")
        conn.commit()
    return {"ok": True}


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
    # Validate the account still exists in scope. Under org-shared customers a
    # session created at branch B belongs to an account whose home row may be a
    # different branch, so the check must be org-wide (get_user_by_id handles it).
    if not get_user_by_id(user_id, project_id, api_key_record.get("org_id")):
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

    user = get_user_by_email(email, project_id, api_key_record.get("org_id"))
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
    org_id = api_key_record.get("org_id")
    with db_cursor() as (conn, cursor):
        if _org_shares_customers(org_id):
            # Org-shared: the account's home row may live under another branch,
            # so scope the password update to the org, not this single project.
            cursor.execute(
                "UPDATE users SET password_hash = %s WHERE email = %s AND org_id = %s",
                (hash_password(request.password), token_data["email"], org_id)
            )
        else:
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


@app.get("/{api_key}/pickup-locations")
def get_pickup_locations(api_key_record: dict = Depends(resolve_api_key)):
    """Public-facing list of warehouses the merchant has opted into "pickup
    at store". Returns just the customer-friendly fields — internal stuff
    like sold_quantity / cost_price stays in the CRM endpoints."""
    project_id = api_key_record["id"]
    rows = db_all(
        "SELECT id, name, country, city, street, postal_code, region,"
        "       contact_phone, pickup_hours,"
        "       delivery_eta_min_days, delivery_eta_max_days"
        " FROM warehouses"
        " WHERE project_id=%s AND is_active=TRUE AND is_pickup_enabled=TRUE"
        " ORDER BY is_default DESC, name ASC",
        (project_id,)
    )
    return rows


@app.get("/{api_key}/delivery-eta")
def get_delivery_eta(api_key_record: dict = Depends(resolve_api_key)):
    """Aggregate delivery ETA the storefront uses for "Delivery in 2–4 days"
    hints on product cards / checkout (courier fulfillment).
    Returns the MIN-min and MAX-max across all active warehouses that have
    ETA configured. If no warehouse has ETA, returns null fields → storefront
    just hides the hint."""
    project_id = api_key_record["id"]
    row = db_one(
        "SELECT MIN(delivery_eta_min_days) AS min_days,"
        "       MAX(delivery_eta_max_days) AS max_days"
        " FROM warehouses"
        " WHERE project_id=%s AND is_active=TRUE"
        "   AND delivery_eta_min_days IS NOT NULL"
        "   AND delivery_eta_max_days IS NOT NULL",
        (project_id,)
    )
    return {
        "min_days": row.get("min_days") if row else None,
        "max_days": row.get("max_days") if row else None,
    }


@app.get("/{api_key}/config")
def get_storefront_config(api_key_record: dict = Depends(resolve_api_key)):
    """Public per-project config consumed by the storefront on bootstrap.

    Currency in particular MUST be available before any price is
    rendered — otherwise the first paint shows the fallback symbol
    (USD '$') and then flickers to the merchant's chosen one when the
    rest of the data arrives. The Magaz SDK fetches this once at app
    init and caches it for the session.

    Kept intentionally minimal — just the values the public storefront
    needs. Admin-only fields (margins, costs, internal flags) stay
    inside the CRM API."""
    provider, creds, is_test_mode, _stripe_acct = _get_org_payment_config(api_key_record["id"])
    # Multi-method model (WooCommerce/Shopify): the storefront renders a picker
    # of all enabled methods; the customer chooses one. 'online' methods (Stripe)
    # need a card + verified PaymentIntent; offline methods are record-only and
    # may carry customer-facing `instructions` (e.g. "Send Kaspi to +7…").
    methods = _get_enabled_payment_methods(api_key_record["id"])
    # online_payment kept for back-compat (older storefront builds): true when a
    # usable online card method is among the enabled set.
    online = any(m["online"] for m in methods)
    return {
        "currency":     api_key_record.get("currency") or "USD",
        "project_name": api_key_record.get("name"),
        "timezone":     api_key_record.get("timezone") or "UTC",
        "payment_methods":   methods,
        "payment_provider":  provider,
        "online_payment":    online,
        "payment_test_mode": bool(is_test_mode) if online else False,
    }


@app.get("/{api_key}/products")
def get_products(request: Request,
                 api_key_record: dict = Depends(resolve_api_key),
                 category: Optional[str] = None,
                 uncategorized: bool = False,
                 page: Optional[int] = None,
                 limit: Optional[int] = None):
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)

    # OPT-IN pagination. Default (limit is None) = return the WHOLE catalog,
    # byte-for-byte identical to the pre-pagination behavior. The storefront
    # (Grid/FavoritesGrid/DigitalProducts) filters client-side and relies on the
    # full list, so pagination must never be forced on. Only when `limit` is
    # supplied do we clamp and apply LIMIT/OFFSET.
    paginate = limit is not None
    offset = 0
    if paginate:
        limit = max(1, min(int(limit), 100))   # clamp 1..100
        page  = max(1, int(page or 1))
        offset = (page - 1) * limit

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
        # Pagination is appended only when explicitly requested (opt-in); the
        # default query is unchanged so the storefront's full-catalog fetch and
        # its client-side filtering keep working exactly as before.
        page_clause = ""
        page_params = []
        if paginate:
            page_clause = " LIMIT %s OFFSET %s"
            page_params = [limit, offset]
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
            "ORDER BY p.id ASC"
            f"{page_clause}",
            params + page_params
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
                f"       sku_code, barcode, compare_at_price, cost_price,"
                f"       sale_type, sale_value, sale_price, sale_starts_at, sale_ends_at,"
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
                f"SELECT variation_id, layer, parent_id, spec_key, spec_value, position, "
                f"       (SELECT name FROM product_spec_groups psg WHERE psg.id = product_specifications.group_id) AS group_name "
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
                    "group": (row.get("group_name") or ""),
                })

        # ── 6. Reviews per product ────────────────────────────────────
        # Cap embedded reviews to the 3 newest per product — the catalog card only
        # needs a small preview; the full thread lives on get_product_page. Keeps
        # the payload bounded no matter how many reviews a product accumulates.
        REVIEW_PREVIEW_N = 3
        cursor.execute(
            f"SELECT id, user_id, product_id, rating, comment, created_at, user_name FROM ("
            f"  SELECT pr.id, pr.user_id, pr.product_id, pr.rating, pr.comment, pr.created_at, "
            f"         u.name AS user_name, "
            f"         ROW_NUMBER() OVER (PARTITION BY pr.product_id ORDER BY pr.created_at DESC, pr.id DESC) AS rn "
            f"  FROM product_reviews pr "
            f"  JOIN users u ON pr.user_id = u.id AND u.project_id = %s "
            f"  WHERE pr.product_id IN ({fmt}) AND pr.project_id = %s "
            f") ranked WHERE rn <= %s "
            f"ORDER BY product_id ASC, created_at DESC",
            [project_id] + product_ids + [project_id, REVIEW_PREVIEW_N]
        )
        reviews_by_product = {}
        for r in cursor.fetchall():
            reviews_by_product.setdefault(r["product_id"], []).append(r)

        # Separate per-product totals (JOIN users to match the embedded query's
        # exclusion of reviews whose author row is gone) so reviews_count /
        # average_rating stay accurate even though only a preview slice is embedded.
        cursor.execute(
            f"SELECT pr.product_id, COUNT(*) AS cnt, AVG(pr.rating) AS avg_rating "
            f"FROM product_reviews pr "
            f"JOIN users u ON pr.user_id = u.id AND u.project_id = %s "
            f"WHERE pr.product_id IN ({fmt}) AND pr.project_id = %s "
            f"GROUP BY pr.product_id",
            [project_id] + product_ids + [project_id]
        )
        review_stats_by_product = {
            r["product_id"]: (r["cnt"], r["avg_rating"]) for r in cursor.fetchall()
        }

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
                f"AND oh.status IN ('delivered','returned','refunded','partial_refunded') "
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
            review_stats=review_stats_by_product.get(p["id"]),
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
        specifications_by_node = {}    # key: (layer, parent_id) → list[{key,value,group}]
        spec_groups_by_node = {}       # key: (layer, parent_id) → list[{name, specs:[…]}]
        if variations:
            vids = [v["id"] for v in variations]
            vfmt = ",".join(["%s"] * len(vids))
            cursor.execute(
                f"SELECT id, product_id, variation_id, configuration_name, price, stock_quantity, sold_quantity, position, "
                f"       sku_code, barcode, compare_at_price, cost_price,"
                f"       sale_type, sale_value, sale_price, sale_starts_at, sale_ends_at,"
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
                f"SELECT variation_id, layer, parent_id, group_id, spec_key, spec_value, position, "
                f"       (SELECT name FROM product_spec_groups psg WHERE psg.id = product_specifications.group_id) AS group_name "
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
                    "group": (row.get("group_name") or ""),
                    "_gid":  row.get("group_id"),
                })

            # Nest specs under their sections (product_spec_groups) per node, ordered
            # by group position. Sections with no non-empty specs are skipped.
            try:
                cursor.execute(
                    "SELECT id, layer, parent_id, name FROM product_spec_groups "
                    "WHERE product_id = %s ORDER BY position ASC, id ASC",
                    (product["id"],)
                )
                groups_at = {}
                for g in cursor.fetchall():
                    groups_at.setdefault((g["layer"], g["parent_id"]), []).append(g)
                for (lv, pid), node_specs in specifications_by_node.items():
                    sections = []
                    for g in groups_at.get((lv, pid), []):
                        gspecs = [{"key": s["key"], "value": s["value"], "group": g["name"]}
                                  for s in node_specs if s.get("_gid") == g["id"]]
                        if gspecs:
                            sections.append({"name": g["name"], "specs": gspecs})
                    if sections:
                        spec_groups_by_node[(lv, pid)] = sections
            except Exception:
                spec_groups_by_node = {}

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
                    "AND oh.status IN ('delivered','returned','refunded','partial_refunded') LIMIT 1",
                    (user_id, product_id, project_id)
                )
                can_review = cursor.fetchone() is not None

    # Group L2 rows by their L1 parent for the assembler.
    cfg_by_variation_id = {}
    for c in configurations:
        cfg_by_variation_id.setdefault(c["variation_id"], []).append(c)

    modifier_groups = _fetch_modifier_groups_for_products([product_id]).get(product_id, [])
    tier_pricing_by_sku = _fetch_tier_pricing([c["id"] for c in configurations])

    payload = _assemble_product_payload(
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
        spec_groups_by_node=spec_groups_by_node,
    )
    # Digital download links are NOT exposed on the public product endpoint — they are
    # paid content. The storefront receives working URLs only from authenticated,
    # owned-order paths (order success / My Orders), never to anonymous visitors.
    return payload


# ── КОРЗИНА ──────────────────────────────────────────────

# ── Tier pricing helper ─────────────────────────────────────────────
def _resolve_unit_price(cursor, sku_id, base_price, quantity):
    cursor.execute(
        "SELECT min_qty, price FROM product_tier_pricing"
        " WHERE sku_id=%s AND min_qty<=%s ORDER BY min_qty DESC LIMIT 1",
        (sku_id, max(1, int(quantity)))
    )
    row = cursor.fetchone()
    if row and row.get("price") is not None:
        return float(row["price"])
    return float(base_price or 0)


def _resolve_unit_prices_bulk(cursor, sku_qty_pairs):
    """Batch version of _resolve_unit_price. Returns {sku_id: best_tier_price}
    for every (sku_id, quantity) in input. One round-trip instead of N."""
    if not sku_qty_pairs:
        return {}
    sku_ids = list({s for s, _ in sku_qty_pairs})
    cursor.execute(
        "SELECT sku_id, min_qty, price FROM product_tier_pricing"
        " WHERE sku_id = ANY(%s)"
        " ORDER BY sku_id, min_qty DESC",
        (sku_ids,)
    )
    by_sku: dict = {}
    for r in cursor.fetchall():
        by_sku.setdefault(r["sku_id"], []).append(r)
    out: dict = {}
    for sku_id, qty in sku_qty_pairs:
        q = max(1, int(qty))
        for row in by_sku.get(sku_id, []):
            if row["min_qty"] <= q:
                out[sku_id] = float(row["price"])
                break
    return out


def _resolve_sku_sales_bulk(cursor, sku_ids, now):
    """Batch version of _resolve_sku_sale_walkup. Returns
    {sku_id: (sale_type, sale_value, starts_at, ends_at)} or NULL when
    no active sale applies. One JOIN instead of N."""
    if not sku_ids:
        return {}
    cursor.execute(
        "SELECT c.id AS sku_id,"
        "       c.sale_type AS c_st, c.sale_value AS c_sv,"
        "       c.sale_starts_at AS c_ss, c.sale_ends_at AS c_se,"
        "       c.sale_price AS c_sp,"
        "       v.sale_type AS v_st, v.sale_value AS v_sv,"
        "       v.sale_starts_at AS v_ss, v.sale_ends_at AS v_se,"
        "       p.sale_type AS p_st, p.sale_value AS p_sv,"
        "       p.sale_starts_at AS p_ss, p.sale_ends_at AS p_se"
        "  FROM product_configurations_l2 c"
        "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
        "  JOIN products p ON v.product_id = p.id"
        " WHERE c.id = ANY(%s)",
        (list(sku_ids),)
    )
    out = {}
    for row in cursor.fetchall():
        l2_sale = (row.get("c_st"), row.get("c_sv"),
                   row.get("c_ss"), row.get("c_se"))
        if not l2_sale[0] and row.get("c_sp") is not None:
            l2_sale = ('fixed', float(row["c_sp"]),
                       row.get("c_ss"), row.get("c_se"))
        var_sale  = (row.get("v_st"), row.get("v_sv"),
                     row.get("v_ss"), row.get("v_se"))
        prod_sale = (row.get("p_st"), row.get("p_sv"),
                     row.get("p_ss"), row.get("p_se"))
        out[row["sku_id"]] = _resolve_active_sale(now, l2_sale, var_sale, prod_sale)
    return out


def _resolve_sku_sale_walkup(cursor, sku_id, now):
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
    cursor.execute(
        "UPDATE cart_items SET reserved_until = NULL"
        " WHERE reserved_until IS NOT NULL AND reserved_until < NOW()"
    )
    return cursor.rowcount

def _available_stock(cursor, sku_id, exclude_cart_id=None):
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
def add_to_cart(item: AddToCart, request: Request, response: Response,
                api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    # Lazy guest-user creation: unauthenticated visitors get a hidden
    # account + JWT on their first Add-to-cart click. Lets cart survive
    # page reloads and lets all the downstream cart endpoints stay
    # unchanged (they keep assuming a user_id is always present).
    user_id    = get_or_create_guest_user(request, response, project_id)
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
        # ── Funnel analytics audit log ────────────────────────────────────
        try:
            cursor.execute(
                "INSERT INTO cart_events"
                " (project_id, user_id, ip, action,"
                "  product_id, variation_id, configuration_id, quantity)"
                " VALUES (%s,%s,%s, 'add', %s,%s,%s,%s)",
                (project_id, user_id, get_client_ip(request),
                 item.product_id, item.variation_id, item.configuration_id,
                 item.quantity)
            )
        except Exception as _e:
            print(f"[cart-event] insert failed (non-fatal): {_e}")
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
        # Defaults 0/0 when the merchant hasn't visited Products → Settings yet.
        # Was 10/2000 (hidden magic fallback) but that confused merchants — they
        # saw `0` in CRM but cart showed $10, no way to set it back to 0 without
        # those magic numbers re-appearing. Now: whatever's in DB is what's used,
        # and DB defaults to 0 too. "Free shipping always" out of the box.
        settings       = cursor.fetchone()
        shipping_cost  = float(settings["shipping_cost"])           if settings else 0.0
        free_threshold = float(settings["free_shipping_threshold"]) if settings else 0.0

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
                # Default to True so an empty-cart response that
                # somehow reaches the checkout UI (race condition,
                # cached stale call) doesn't trick it into showing
                # "Digital delivery" instead of the address form.
                "requires_shipping": True,
            }

        cursor.execute(
            "SELECT ci.id as cart_item_id, ci.quantity, ci.product_id, ci.variation_id, ci.configuration_id, "
            "ci.selected_modifier_item_ids, "
            # Price walk: SKU (L2) → variation (L1). Merchants who set
            # one variation-level price for all sizes leave L2.price
            # NULL — the L1 fallback keeps cart math correct.
            "p.title, p.subtitle, p.product_type, COALESCE(pc.price, pv.price) AS price, pc.configuration_name, pv.variation_name, "
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
    # Two batched queries cover the whole cart instead of 2×N round-trips
    # that we had with the per-row `_resolve_unit_price` +
    # `_resolve_sku_sale_walkup` calls. On a 20-item cart this drops the
    # cart-get latency from ~600ms to ~80ms.
    from datetime import timezone as _tz
    _cart_now = datetime.now(_tz.utc)
    line_pricing = {}  # cart_item_id → (tier_price, after_sale, on_sale)
    if rows:
        sku_qty_pairs = [(r["configuration_id"], r["quantity"])
                         for r in rows if r.get("configuration_id")]
        sku_ids = [s for s, _ in sku_qty_pairs]
        with db_cursor() as (_, c2):
            tier_by_sku = _resolve_unit_prices_bulk(c2, sku_qty_pairs)
            sale_by_sku = _resolve_sku_sales_bulk(c2, sku_ids, _cart_now)
        for r in rows:
            sku_id   = r.get("configuration_id")
            sku_base = float(r["price"] or 0)
            if not sku_id:
                line_pricing[r["cart_item_id"]] = (sku_base, sku_base, False)
                continue
            tier   = tier_by_sku.get(sku_id, sku_base)
            after  = tier
            on_sl  = False
            st, sv, _, _ = sale_by_sku.get(sku_id, (None, None, None, None))
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
        "AND oh.status IN ('delivered','returned','refunded','partial_refunded') LIMIT 1",
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
    s3_delete_url(row["url"], f"projects/{project_id}/reviews/")
    return {"success": True}


class VoteReview(BaseModel):
    review_id: int
    is_helpful: bool

@app.post("/{api_key}/reviews/vote")
def vote_review(data: VoteReview, request: Request,
                 api_key_record: dict = Depends(resolve_api_key)):
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
    from datetime import timezone as _tz
    now        = datetime.now(_tz.utc)
    # Tolerate legacy promo rows where valid_from / valid_until are
    # naive TIMESTAMP (pre-TIMESTAMPTZ schema). See same pattern in
    # place_order.
    def _aware(d):
        if d is None: return None
        return d if getattr(d, 'tzinfo', None) else d.replace(tzinfo=_tz.utc)

    with db_cursor() as (_, cursor):
        cursor.execute("SELECT id FROM carts WHERE user_id=%s AND project_id=%s", (user_id, project_id))
        cart = cursor.fetchone()
        if not cart: raise HTTPException(400, "Cart is empty")

        cursor.execute(
            "SELECT SUM(COALESCE(pc.price, pv.price) * ci.quantity) as subtotal FROM cart_items ci "
            "JOIN product_configurations_l2 pc ON ci.configuration_id=pc.id "
            "JOIN product_configurations_l1 pv ON pc.variation_id=pv.id "
            "WHERE ci.cart_id=%s",
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

        vf = _aware(promo["valid_from"])
        vu = _aware(promo["valid_until"])
        if vf and vf > now: raise HTTPException(400, "Promo code not yet valid")
        if vu and vu < now: raise HTTPException(400, "Promo code expired")
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
        # Defaults 0/0 — see canonical comment in the cart-totals branch above.
        settings       = cursor.fetchone()
        shipping_cost  = float(settings["shipping_cost"])           if settings else 0.0
        free_threshold = float(settings["free_shipping_threshold"]) if settings else 0.0
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


# -- Non-Stripe provider integrations removed: Stripe is the only API-native
# gateway; every other gateway runs as manual/other (record-only). See git history. --


def create_intent(provider: str, creds: dict, *, amount: float, currency: str,
                   order_metadata: dict, idempotency_key: str | None = None,
                   is_test_mode: bool = True, stripe_account_id: str = "",
                   return_url: str = "") -> dict:
    """Single entry point. amount in major units (dollars/rubles).
    Returns {ok, data: {intent_id, ?client_secret, ?redirect_url, ?publishable_key, status}, error, raw}."""
    if not idempotency_key:
        idempotency_key = "intent-" + secrets.token_urlsafe(16)
    if provider == "manual" or provider == "other":
        # Manual mode — no real intent. Caller records the order but treats
        # payment as "external / off-platform" (manual confirmation).
        return _ok({"intent_id": "manual-" + idempotency_key, "status": "manual_required"})
    if provider == "stripe":
        amount_minor = int(round(amount * 100))
        return stripe_create_intent(creds, amount_minor, currency,
                                     order_metadata=order_metadata,
                                     idempotency_key=idempotency_key,
                                     stripe_account_id=stripe_account_id)
    return _err(f"Unknown provider: {provider}")


def get_intent(provider: str, creds: dict, *, intent_id: str,
                is_test_mode: bool = True, stripe_account_id: str = "") -> dict:
    if provider in ("manual", "other"):
        return _ok({"intent_id": intent_id, "status": "manual_required"})
    if provider == "stripe":
        return stripe_get_intent(creds, intent_id, stripe_account_id)
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
    if provider in ("manual", "other"):
        return False, "Provider does not support webhooks"
    return False, f"Unknown provider: {provider}"


def parse_event(provider: str, raw_body: bytes) -> dict:
    if provider == "stripe":         return stripe_parse_event(raw_body)
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


_PAY_METHOD_FALLBACK_LABELS = {
    "stripe": "Card", "manual": "Cash / Pay on delivery", "other": "Other",
}


def _get_enabled_payment_methods(project_id: int) -> list[dict]:
    """Enabled payment methods for the project's org (WooCommerce/Shopify model —
    methods coexist, the customer picks one at checkout). Returns
    [{method, label, instructions, online}] in sort order. The 'stripe' (online
    card) entry is only included when the org actually has connected credentials.
    Defensive fallback to a single manual method when the org has no rows yet."""
    rows = db_all(
        "SELECT pm.method, pm.display_label, pm.instructions, pm.sort_order"
        "  FROM crm_payment_methods pm"
        "  JOIN crm_projects pr ON pr.org_id = pm.org_id"
        " WHERE pr.id = %s AND pm.is_enabled = TRUE"
        " ORDER BY pm.sort_order, pm.method",
        (project_id,)
    )
    provider, creds, _is_test, _acct = _get_org_payment_config(project_id)
    stripe_usable = (provider == "stripe" and bool(creds))

    out: list[dict] = []
    for r in rows:
        m = r["method"]
        if m == "stripe" and not stripe_usable:
            continue   # enabled in UI but gateway not connected → not offerable
        out.append({
            "method":       m,
            "label":        r["display_label"] or _PAY_METHOD_FALLBACK_LABELS.get(m, m),
            "instructions": r["instructions"] or "",
            "online":       m == "stripe",
        })
    if not out:
        out = [{"method": "manual",
                "label": _PAY_METHOD_FALLBACK_LABELS["manual"],
                "instructions": "", "online": False}]
    return out


def _resolve_chosen_method(project_id: int, requested: str | None) -> tuple[str, list[dict]]:
    """Map the customer's requested payment method to a VALID enabled method.
    Security: a client cannot claim an offline method to bypass a required card.
      • requested ∈ enabled            → use it
      • requested invalid, 1 method    → use that one (no real choice existed)
      • requested invalid, >1 methods  → 400 (must pick a real option)
    Legacy aliases: card→stripe, cash/cod→manual."""
    methods = _get_enabled_payment_methods(project_id)
    keys = [m["method"] for m in methods]
    alias = {"card": "stripe", "cash": "manual", "cod": "manual"}
    req = (requested or "").strip().lower()
    req = alias.get(req, req)
    if req in keys:
        return req, methods
    if len(keys) == 1:
        return keys[0], methods
    raise HTTPException(400, "Selected payment method is not available.")


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
        "SELECT ci.configuration_id, ci.quantity, ci.selected_modifier_item_ids,"
        "       COALESCE(pc.price, pv.price) AS price"
        "  FROM cart_items ci"
        "  JOIN product_configurations_l2 pc ON ci.configuration_id = pc.id"
        "  JOIN product_configurations_l1 pv ON pc.variation_id = pv.id"
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

    # Pricing layers MUST match place_order(): base → tier (wholesale) → sale →
    # modifiers. The old version used only the base price, so init-payment charged
    # the provider the undiscounted total while POST /orders validated the tier/sale
    # total — the amounts disagreed and checkout 409'd ("Cart total changed").
    from datetime import timezone as _tz
    _now = datetime.now(_tz.utc)
    _pairs = [(r["configuration_id"], r["quantity"]) for r in rows if r.get("configuration_id")]
    _ids   = [s for s, _ in _pairs]
    tier_by_sku = _resolve_unit_prices_bulk(cursor, _pairs)
    sale_by_sku = _resolve_sku_sales_bulk(cursor, _ids, _now)

    subtotal = 0.0
    items_count = 0
    for r in rows:
        sku_id = r.get("configuration_id")
        unit   = tier_by_sku.get(sku_id, float(r["price"] or 0)) if sku_id else float(r["price"] or 0)
        if sku_id:
            st, sv, _, _ = sale_by_sku.get(sku_id, (None, None, None, None))
            if st:
                unit = _apply_sale(unit, st, sv)
        for mid in (r["selected_modifier_item_ids"] or []):
            unit += mod_delta.get(mid, 0.0)
        subtotal += unit * int(r["quantity"])
        items_count += int(r["quantity"])

    cursor.execute(
        "SELECT shipping_cost, free_shipping_threshold FROM shipping_settings WHERE project_id=%s LIMIT 1",
        (project_id,)
    )
    s = cursor.fetchone()
    shipping_cost  = float((s or {}).get("shipping_cost") or 0)
    free_threshold = float((s or {}).get("free_shipping_threshold") or 0)
    final_shipping = 0.0 if (delivery_method == "postal" or subtotal >= free_threshold) else shipping_cost

    # Promo — evaluate exactly like place_order (uppercased code, validity window,
    # usage / per-user limits, category restriction, max_discount cap), but READ-ONLY:
    # we never increment times_used here. Any divergence re-introduces the 409.
    discount = 0.0
    if promo_code:
        cursor.execute(
            "SELECT * FROM promo_codes WHERE code=%s AND project_id=%s AND is_active=TRUE",
            (promo_code.strip().upper(), project_id)
        )
        promo = cursor.fetchone()
        if promo:
            def _aware(d):
                if d is None: return None
                return d if getattr(d, 'tzinfo', None) else d.replace(tzinfo=_tz.utc)
            vf = _aware(promo.get("valid_from"))
            vu = _aware(promo.get("valid_until"))
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
                (not vf or vf <= _now) and (not vu or vu >= _now) and
                subtotal >= float(promo["min_order_amount"] or 0) and
                (not promo["usage_limit"] or promo["times_used"] < promo["usage_limit"])):
                dv = float(promo["discount_value"] or 0)
                if promo["discount_type"] == "percentage":
                    discount = subtotal * (dv / 100)
                    if promo["max_discount"]:
                        discount = min(discount, float(promo["max_discount"] or 0))
                else:
                    discount = dv

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
    _rate_limit_orders(request, user_id, max_per_min=15)
    if not user_id:
        raise HTTPException(401, "Login required to place an order")

    # Which method did the customer pick? (validated against the enabled set)
    chosen, _methods = _resolve_chosen_method(project_id, data.payment_method)
    provider, creds, is_test_mode, stripe_account_id = _get_org_payment_config(project_id)

    # Compute total
    with db_cursor() as (conn, cursor):
        totals = _compute_cart_total(cursor, project_id, user_id,
                                       data.delivery_method, data.address or "",
                                       data.promo_code)
        if not totals["ok"]:
            raise HTTPException(400, totals["error"])

    # Offline method (manual / other) — no PaymentIntent; the order is recorded
    # as pending and the merchant collects payment off-platform.
    if chosen != "stripe":
        return {
            "provider":    chosen,
            "intent_id":   "",
            "client_secret": "",
            "redirect_url": "",
            "publishable_key": "",
            "amount":      totals["total"],
            "currency":    totals["currency"],
            "needs_payment_intent": False,
        }

    # Online card chosen but the gateway isn't actually connected — degrade to
    # record-only instead of blocking the sale.
    if provider != "stripe" or not creds:
        return {
            "provider":    "manual",
            "intent_id":   "",
            "client_secret": "",
            "redirect_url": "",
            "publishable_key": "",
            "amount":      totals["total"],
            "currency":    totals["currency"],
            "needs_payment_intent": False,
            "warning":     "Card payments not connected; falling back to manual",
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
def place_order(data: PlaceOrderRequest, request: Request, response: Response,
                background_tasks: BackgroundTasks,
                api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    # Guest visitors arrive here with a guest user_id already minted
    # by /cart/add — but we need to enforce they provide contact info
    # at checkout. We also create a guest_user lazily here just in
    # case a stale session somehow lost its cookie between cart and
    # checkout (defensive).
    user_id = get_or_create_guest_user(request, response, project_id)
    _rate_limit_orders(request, user_id, max_per_min=12)

    # Structured name — compose into legacy recipient_name "{last} {first} {middle}".
    # If only the legacy field was sent (older clients), keep it as-is.
    sn_first  = clean(data.recipient_first_name,  80)
    sn_last   = clean(data.recipient_last_name,   80)
    sn_middle = clean(data.recipient_middle_name, 80)
    if sn_first or sn_last:
        if not sn_first or not sn_last:
            raise HTTPException(400, "First name and last name are required")
        rn = " ".join(s for s in (sn_last, sn_first, sn_middle) if s)
    else:
        rn = sanitize((data.recipient_name or "").strip())
        if not rn:
            raise HTTPException(400, "Recipient name is required")

    # ── Contact-info gate: every guest MUST hand over email or phone
    cust_email = clean(data.customer_email, 255).lower()
    cust_phone = clean(data.phone, 32)
    if cust_email and "@" not in cust_email:
        raise HTTPException(400, "Invalid email")
    # Probe what's enabled for this merchant. crm_auth_providers rows
    # exist when the merchant has switched on a specific provider; we
    # treat at least Email-OTP as always-available because order
    # confirmation emails (via SES) are essential for any storefront.
    email_enabled = True   # email-OTP is always available
    phone_enabled = False
    try:
        phone_row = db_one(
            "SELECT is_enabled FROM crm_auth_providers"
            " WHERE project_id=%s AND provider='phone'",
            (project_id,)
        )
        phone_enabled = bool(phone_row and phone_row.get("is_enabled"))
    except Exception:
        # If the table doesn't exist or schema mismatch, fail open to
        # email-only — never block a checkout because of a meta-config
        # read failure.
        phone_enabled = False
    # Check current user record — they may already have email/phone
    # from a previous order in this session.
    existing = db_one("SELECT email, phone FROM users WHERE id=%s", (user_id,)) or {}
    existing_email = (existing.get("email") or "").strip()
    existing_phone = (existing.get("phone") or "").strip()
    effective_email = cust_email or existing_email
    effective_phone = cust_phone or existing_phone
    if not effective_email and not effective_phone:
        raise HTTPException(400,
            "Email or phone is required to place an order")
    if effective_email and not email_enabled and not phone_enabled:
        # extremely unlikely — keeping the branch so future merchant
        # configs that disable email don't silently accept it
        raise HTTPException(400, "Email checkout is disabled for this store")
    if effective_phone and not phone_enabled and not email_enabled:
        raise HTTPException(400, "Phone checkout is disabled for this store")
    # Persist whichever new contact info the user provided onto the
    # users row. Use sanitised values, ignore NULL on existing.
    if cust_email or cust_phone:
        sets = []
        vals = []
        if cust_email:
            sets.append("email=%s"); vals.append(cust_email)
        if cust_phone:
            sets.append("phone=%s"); vals.append(cust_phone)
        vals.append(user_id)
        with db_cursor() as (conn, cursor):
            try:
                cursor.execute(
                    f"UPDATE users SET {', '.join(sets)} WHERE id=%s",
                    tuple(vals)
                )
                conn.commit()
            except psycopg2.errors.UniqueViolation:
                # Email or phone already belongs to another user in
                # this project — surface to the storefront so they can
                # log in instead of "creating" a parallel account.
                conn.rollback()
                raise HTTPException(409,
                    "This email/phone is already registered. Please sign in instead.")
            except Exception:
                conn.rollback()
                # Soft-fail the UPDATE — order should still be placed
                # even if writing the contact info hits an edge case.
                pass

    # Fulfillment validation. For `pickup` the customer collects from a
    # specific warehouse — verify it exists, belongs to this project, is
    # active AND opted-in for pickup. Address becomes optional in that case.
    fulfillment_type = (data.fulfillment_type or "courier").lower()
    if fulfillment_type not in ("courier", "pickup"):
        raise HTTPException(400, "Invalid fulfillment_type")
    pickup_wh_id = None
    if fulfillment_type == "pickup":
        if not data.pickup_warehouse_id:
            raise HTTPException(400, "pickup_warehouse_id is required for pickup orders")
        wh_check = db_one(
            "SELECT id FROM warehouses WHERE id=%s AND project_id=%s"
            " AND is_active=TRUE AND is_pickup_enabled=TRUE",
            (int(data.pickup_warehouse_id), project_id)
        )
        if not wh_check:
            raise HTTPException(400, "Selected pickup location is not available")
        pickup_wh_id = int(data.pickup_warehouse_id)
    elif data.delivery_method == "courier" and not (data.address or "").strip():
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
            # Price walk SKU → variation (same as cart-get + cart-subtotal).
            "COALESCE(pc.price, pv.price) AS price, "
            "pc.cost_price, "
            "pc.stock_quantity, p.title, p.product_type, pv.variation_name "
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
        # IMPORTANT: filter by project_id — without it a malicious cart
        # injection (product_id from another store) would read another
        # store's continue_selling_oos flag and bypass our stock checks.
        product_flags = {}
        if items:
            ids = list({it["product_id"] for it in items})
            cursor.execute(
                "SELECT id, continue_selling_oos FROM products"
                " WHERE id = ANY(%s) AND project_id=%s",
                (ids, project_id)
            )
            for r in cursor.fetchall():
                product_flags[r["id"]] = bool(r.get("continue_selling_oos"))

        # CRITICAL: lock the per-SKU stock aggregates BEFORE validating against
        # them. Without these locks two concurrent buyers can both pass the
        # check on the last unit and oversell into negative stock. We sort SKU
        # ids ascending to give a deterministic lock order and avoid deadlocks
        # when two carts share some-but-not-all SKUs.
        #
        # Availability = SUM(quantity) - SUM(reserved_quantity). Other pending
        # orders that haven't shipped yet already hold reservations against
        # this stock, so we must subtract them from the visible total to
        # avoid promising units that are spoken-for.
        #
        # PostgreSQL disallows `FOR UPDATE` together with `GROUP BY` in the
        # same query (`FeatureNotSupported`), so we lock rows in a CTE and
        # aggregate over the CTE output.
        sku_ids_sorted = sorted({int(it["configuration_id"]) for it in items})
        cursor.execute(
            "WITH locked AS ("
            "  SELECT sku_id, quantity, reserved_quantity"
            "    FROM product_stock"
            "   WHERE sku_id = ANY(%s)"
            "   FOR UPDATE"
            ")"
            "SELECT sku_id,"
            "       COALESCE(SUM(quantity), 0)          AS total,"
            "       COALESCE(SUM(reserved_quantity), 0) AS reserved"
            "  FROM locked"
            " GROUP BY sku_id",
            (sku_ids_sorted,)
        )
        live_stock = {
            int(r["sku_id"]): (int(r["total"] or 0), int(r["reserved"] or 0))
            for r in cursor.fetchall()
        }

        for it in items:
            sid = int(it["configuration_id"])
            # Use the live locked value, not the cart row's stale stock_quantity
            # (which was a JOIN snapshot before the lock was acquired).
            total, reserved = live_stock.get(sid, (0, 0))
            available = total - reserved
            if not product_flags.get(it["product_id"]) and available < it["quantity"]:
                raise HTTPException(400, f"Not enough stock for {it['title']}")

        # Per-line modifier price deltas (carried into order_items unit price snapshot).
        # Cross-tenant guard: JOIN through modifier_groups → products to ensure
        # every modifier belongs to a product in THIS project. Without this a
        # tampered cart could reference a cheap modifier from another store.
        all_mod_ids = {mid for it in items for mid in (it["selected_modifier_item_ids"] or [])}
        mod_delta_by_id = {}
        if all_mod_ids:
            cursor.execute(
                "SELECT mi.id, mi.price_delta"
                "  FROM product_modifier_items mi"
                "  JOIN product_modifier_groups mg ON mi.group_id = mg.id"
                "  JOIN products p ON mg.product_id = p.id"
                " WHERE mi.id = ANY(%s) AND p.project_id = %s",
                (list(all_mod_ids), project_id)
            )
            for r in cursor.fetchall():
                mod_delta_by_id[r["id"]] = float(r["price_delta"] or 0)
        from datetime import timezone as _tz
        _checkout_now = datetime.now(_tz.utc)
        # Two batched lookups for pricing — replaces 2×N round-trips
        # to product_tier_pricing + the L2/L1/products sale walkup.
        _sku_qty_pairs = [(it["configuration_id"], it["quantity"])
                          for it in items if it.get("configuration_id")]
        _sku_ids       = [s for s, _ in _sku_qty_pairs]
        tier_by_sku = _resolve_unit_prices_bulk(cursor, _sku_qty_pairs)
        sale_by_sku = _resolve_sku_sales_bulk(cursor, _sku_ids, _checkout_now)
        for it in items:
            it["mod_delta_total"] = sum(
                mod_delta_by_id.get(mid, 0)
                for mid in (it["selected_modifier_item_ids"] or [])
            )
            # Pricing layer: base → tier → sale → modifiers (sale walks L2 → L1 → product).
            sku_id = it.get("configuration_id")
            base_price = float(it["price"] or 0)
            tier_price = tier_by_sku.get(sku_id, base_price) if sku_id else base_price
            after_sale = tier_price
            if sku_id:
                st, sv, _, _ = sale_by_sku.get(sku_id, (None, None, None, None))
                if st:
                    after_sale = _apply_sale(tier_price, st, sv)
            it["tier_price"] = tier_price
            it["unit_price"] = after_sale + it["mod_delta_total"]

        subtotal = sum(it["unit_price"] * it["quantity"] for it in items)

        # Промокод
        discount = 0.0
        applied_promo_id = None
        if data.promo_code:
            # FOR UPDATE: lock the promo row so two parallel orders sharing
            # the same code can't both pass `times_used < usage_limit` before
            # either increments — otherwise a usage-limit=1 code can be
            # redeemed twice via a fast double-click.
            cursor.execute(
                "SELECT * FROM promo_codes"
                " WHERE code=%s AND project_id=%s AND is_active=TRUE"
                " FOR UPDATE",
                (data.promo_code.strip().upper(), project_id)
            )
            promo = cursor.fetchone()
            if promo:
                from datetime import timezone as _tz
                now = datetime.now(_tz.utc)
                # Defensive: the schema declares valid_from/valid_until as
                # TIMESTAMPTZ, but on databases that pre-date that schema
                # the columns are plain TIMESTAMP and psycopg2 returns
                # naive datetimes — which can't be compared to `now`
                # (offset-aware). Normalise both fields to tz-aware UTC
                # before comparing so we don't 500 on legacy promos.
                def _aware(d):
                    if d is None: return None
                    return d if getattr(d, 'tzinfo', None) else d.replace(tzinfo=_tz.utc)
                promo_valid_from  = _aware(promo.get("valid_from"))
                promo_valid_until = _aware(promo.get("valid_until"))
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
                    (not promo_valid_from  or promo_valid_from  <= now) and
                    (not promo_valid_until or promo_valid_until >= now) and
                    subtotal >= float(promo["min_order_amount"] or 0) and
                    (not promo["usage_limit"] or promo["times_used"] < promo["usage_limit"])):
                    dv = float(promo["discount_value"] or 0)
                    if promo["discount_type"] == "percentage":
                        discount = subtotal * (dv / 100)
                        if promo["max_discount"]: discount = min(discount, float(promo["max_discount"] or 0))
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
        # `or 0` guards against NULL columns in legacy rows where DEFAULTs
        # weren't enforced; float(None) would raise TypeError.
        shipping_cost  = float((ship_settings or {}).get("shipping_cost") or 0)
        free_threshold = float((ship_settings or {}).get("free_shipping_threshold") or 0)
        final_shipping = 0.0 if (data.delivery_method == "postal" or subtotal >= free_threshold) else shipping_cost

        total = round(subtotal + final_shipping - discount, 2)

        # ── Payment validation (Strict mode) ──────────────────────────────
        provider, creds, is_test_mode, stripe_account_id = _get_org_payment_config(project_id)
        # Which enabled method did the customer pick? Cannot claim an offline
        # method to bypass a required card (validated against the enabled set).
        chosen, _methods = _resolve_chosen_method(project_id, data.payment_method)
        # Per-project default currency. Each order row snapshots the
        # currency it was placed in — even if the merchant later changes
        # the project's currency, historical orders stay immutable. For
        # paid orders the provider's reply still overrides (Stripe might
        # have charged in EUR even though the project is USD-default, in
        # which case the order is recorded as EUR — what was actually
        # charged is the ground truth).
        _proj_row = db_one(
            "SELECT COALESCE(currency, 'USD') AS currency FROM crm_projects WHERE id=%s",
            (project_id,)
        )
        project_currency  = (_proj_row or {}).get("currency", "USD")
        # 'other' = customer pays via an external gateway (Kaspi, bank, own link)
        # we CANNOT verify → record the order but leave payment UNCONFIRMED
        # ('pending'): it shows in the CRM Orders list but is NOT counted as paid
        # revenue until the merchant confirms it (Mark as paid). 'manual' (cash /
        # pay-on-delivery) stays settled — the merchant collects it directly.
        pay_status        = "pending" if chosen == "other" else "manual"
        pay_intent_id     = ""
        pay_charge_id     = ""
        pay_amount_paid   = 0.0
        pay_currency      = project_currency
        pay_provider      = chosen

        # Strict mode applies ONLY when the customer chose the online card method
        # AND the gateway is actually connected. Offline methods (manual/other),
        # or card-chosen-but-not-connected, are record-only.
        do_strict = (chosen == "stripe" and provider == "stripe" and bool(creds))
        if chosen == "stripe" and not do_strict:
            pay_provider = "manual"   # card chosen but gateway not connected

        if do_strict:
            intent_id = (data.payment_intent_id or "").strip()
            if not intent_id:
                raise HTTPException(402,
                    "Payment intent required for card payment. "
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
                # PayPal: ONLY "COMPLETED" — "APPROVED" means the buyer
                # consented but the capture step hasn't happened, so funds
                # haven't moved. Treating APPROVED as paid would mark
                # uncaptured orders as paid and the merchant would ship for
                # free if capture later failed.
                "paypal":        {"COMPLETED"},
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
            pay_currency    = (v.get("currency") or project_currency).upper()
            pay_provider    = provider

        # ── Compose legacy `address` from structured fields ─────────
        sa_country   = clean(data.address_country,     60)
        sa_city      = clean(data.address_city,        120)
        sa_postal    = clean(data.address_postal_code, 20)
        sa_street    = clean(data.address_street,      300)
        sa_apartment = clean(data.address_apartment,   120)
        sa_floor     = clean(data.address_floor,       20)
        sa_entrance  = clean(data.address_entrance,    20)
        sa_intercom  = clean(data.address_intercom,    40)
        if any([sa_country, sa_city, sa_postal, sa_street, sa_apartment,
                sa_floor, sa_entrance, sa_intercom]):
            # Build the apartment-line for the legacy freeform string
            # — "кв 123, эт 4, под 2, домофон 123#".
            apt_parts = []
            if sa_apartment: apt_parts.append(f"кв {sa_apartment}")
            if sa_floor:     apt_parts.append(f"эт {sa_floor}")
            if sa_entrance:  apt_parts.append(f"под {sa_entrance}")
            if sa_intercom:  apt_parts.append(f"домофон {sa_intercom}")
            apt_line = ", ".join(apt_parts)
            street_line = ", ".join(s for s in (sa_street, apt_line) if s)
            composed = ", ".join(s for s in (sa_city, street_line, sa_postal, sa_country) if s)
            address_str = composed
        else:
            address_str = sanitize(data.address or "")
        # Digital-only orders have nothing to ship — the buyer gets the download
        # link the moment they pay (see _digital_downloads / OrderSuccess / My
        # Orders), so the order is born "delivered" instead of sitting in the
        # New → Confirmed → Shipped pipeline. Any physical/service item in the cart
        # keeps the normal 'new' flow (that part still needs fulfillment).
        is_digital_only = bool(items) and all(
            it.get("product_type") == "digital" for it in items)
        order_status = "delivered" if is_digital_only else "new"
        # Создаём заказ
        cursor.execute(
            """INSERT INTO order_history
               (project_id, user_id, total_amount, status,
                delivery_method, recipient_name, phone, address, comment, payment_method,
                payment_intent_id, payment_charge_id, payment_status, payment_provider,
                payment_currency, payment_amount_paid, payment_paid_at,
                fulfillment_type, pickup_warehouse_id,
                address_country, address_city, address_postal_code,
                address_street, address_apartment, address_floor,
                address_entrance, address_intercom,
                recipient_first_name, recipient_last_name, recipient_middle_name,
                customer_email)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                       %s,%s,%s,%s,%s,%s, CASE WHEN %s='paid' THEN NOW() ELSE NULL END,
                       %s,%s,
                       %s,%s,%s,%s,%s,%s,
                       %s,%s,
                       %s,%s,%s,
                       %s)
               RETURNING id""",
            (project_id, user_id, round(float(total), 2), order_status,
             data.delivery_method, rn,
             sanitize(data.phone or ""), address_str,
             sanitize(data.comment or ""), pay_provider,
             pay_intent_id, pay_charge_id, pay_status, pay_provider,
             pay_currency, round(pay_amount_paid, 2), pay_status,
             fulfillment_type, pickup_wh_id,
             sa_country or None, sa_city or None, sa_postal or None,
             sa_street or None, sa_apartment or None, sa_floor or None,
             sa_entrance or None, sa_intercom or None,
             sn_first or None, sn_last or None, sn_middle or None,
             # customer_email — snapshot of the email at order time
             # (the users row may later change email, but historical
             # orders should preserve "what was sent").
             effective_email or None)
        )
        order_id = cursor.fetchone()["id"]

        # ── Auto-save address (silent default) ─────────────────────
        if (fulfillment_type == "courier"
            and (sa_city or sa_street)):
            cursor.execute(
                "SELECT 1 FROM user_addresses"
                " WHERE project_id=%s AND user_id=%s LIMIT 1",
                (project_id, user_id)
            )
            if not cursor.fetchone():
                cursor.execute("SAVEPOINT sp_save_addr")
                try:
                    # `region` is a legacy NOT NULL column with no
                    # default (pre-existed the structured-address
                    # migration). We don't collect a region from the
                    # storefront, so pass an explicit empty string.
                    cursor.execute(
                        "INSERT INTO user_addresses"
                        " (project_id, user_id, label, country, region, city, postal_code,"
                        "  street, apartment, floor, entrance, intercom, is_default)"
                        " VALUES (%s,%s,'',%s,'',%s,%s,%s,%s,%s,%s,%s,TRUE)",
                        (project_id, user_id,
                         sa_country, sa_city, sa_postal,
                         sa_street, sa_apartment, sa_floor, sa_entrance, sa_intercom)
                    )
                    cursor.execute("RELEASE SAVEPOINT sp_save_addr")
                except Exception as e:
                    # Roll the savepoint back so the outer transaction
                    # stays usable. Print so we can debug what's
                    # actually broken without hiding the symptom.
                    cursor.execute("ROLLBACK TO SAVEPOINT sp_save_addr")
                    print(f"[place_order] auto-save address skipped: {type(e).__name__}: {e}")

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

        # Bulk-load stock for ALL line-item SKUs once (was: 1 query per item).
        _all_sku_ids = list({int(it["configuration_id"]) for it in items if it.get("configuration_id")})
        _stock_rows = []
        if _all_sku_ids:
            cursor.execute(
                "SELECT sku_id, warehouse_id, quantity FROM product_stock WHERE sku_id = ANY(%s)",
                (_all_sku_ids,)
            )
            _stock_rows = cursor.fetchall()
        _stock_by_sku: dict = {}
        for _r in _stock_rows:
            _stock_by_sku.setdefault(_r["sku_id"], {})[_r["warehouse_id"]] = _r["quantity"]

        def _pick_wh_for_sku(sku_id: int) -> int | None:
            if not wh_options:
                return None
            # Per-SKU stock now read from the pre-loaded bulk map.
            stock_by_wh = _stock_by_sku.get(sku_id, {})

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
        # cost_per_unit also snapshotted at checkout time so historical Margin
        # analysis stays accurate when the merchant edits the SKU's cost field
        # later. Without the snapshot, COGS computed at report time would use
        # whatever cost_price happens to be RIGHT NOW.
        for it in items:
            # cost_price now comes from the cart-items SELECT (pc.cost_price added
            # there), so no per-item round-trip here. Falls back to None for any row
            # where the column is absent (legacy / non-L2 line).
            cost_per_unit = it.get("cost_price")
            cursor.execute(
                "INSERT INTO order_items"
                "  (order_id, product_id, variation_id, configuration_id,"
                "   quantity, price, cost_per_unit, selected_modifier_item_ids) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (order_id, it["product_id"], it["variation_id"], it["configuration_id"],
                 it["quantity"], round(it["unit_price"], 2), cost_per_unit,
                 sorted(it["selected_modifier_item_ids"] or []))
            )
            it["id"] = cursor.fetchone()["id"]
            # Digital items carry no physical stock, and a digital-only order is
            # born 'delivered' — so the reserved→deducted/released transition
            # (CRM update_order_status) never runs to unwind a reservation. If we
            # reserved here, reserved_quantity (especially the L2 mirror, which
            # updates even when the SKU has no warehouse row) would inflate
            # permanently and leak availability for that SKU. Skip all stock
            # side-effects for digital line items — the order_items row above is
            # all a digital purchase needs.
            if it.get("product_type") == "digital":
                continue
            # Reservation model — at order time we RESERVE stock, we don't
            # decrement it. The customer's order is not yet shipped, so the
            # physical stock count and the "sold" lifetime number must not
            # move yet. They get moved when the merchant transitions status
            # to shipped/delivered (see CRM update_order_status). On cancel
            # before shipment, the reservation is released back to the pool.
            #
            # Visible stock in the merchant inventory = quantity - reserved.
            # Available for sale = same.
            wh_id = _pick_wh_for_sku(it["configuration_id"])
            if wh_id:
                cursor.execute(
                    "INSERT INTO product_stock (sku_id, warehouse_id, quantity, reserved_quantity)"
                    " VALUES (%s, %s, 0, %s)"
                    " ON CONFLICT (sku_id, warehouse_id)"
                    " DO UPDATE SET reserved_quantity"
                    "        = product_stock.reserved_quantity + EXCLUDED.reserved_quantity",
                    (it["configuration_id"], wh_id, int(it["quantity"]))
                )
            # L2 reservation mirror (keeps the l2-level reserved_quantity in
            # sync so simple queries that don't join product_stock can still
            # see "in-flight" orders).
            cursor.execute(
                "UPDATE product_configurations_l2"
                "   SET reserved_quantity = reserved_quantity + %s"
                " WHERE id = %s",
                (int(it["quantity"]), it["configuration_id"])
            )
            # NOTE: inventory_batches are also untouched at reservation time.
            # When status transitions to shipped/delivered, the CRM-side
            # `_apply_stock_deduction` consumes batches FIFO/LIFO.
            # Stock log is still written here as an audit trail for the
            # reservation event so the merchant sees "reserved -36 for order #N".
            cursor.execute(
                "INSERT INTO product_stock_log"
                "  (project_id, sku_id, warehouse_id, delta, reason, reference_id, note)"
                " VALUES (%s, %s, %s, %s, 'reservation', %s, %s)",
                (project_id, it["configuration_id"], wh_id, -int(it["quantity"]),
                 order_id, f"Order #{order_id} · reserved (awaiting fulfillment)")
            )

        # Очищаем корзину
        cursor.execute("DELETE FROM cart_items WHERE cart_id=%s", (cart["id"],))
        conn.commit()

    # Email + webhooks happen in background tasks so a slow / broken SES does
    # not 500 the order endpoint after the row was already committed. Email
    # body uses `it["unit_price"]` (the price the customer actually paid per
    # unit after tier / sale / modifiers) — previously this used `it["price"]`
    # which is the raw L2 price and disagreed with the order total.
    user = db_one("SELECT name, email FROM users WHERE id=%s", (user_id,))
    from_name, from_email = get_project_email(project_id)
    if user and user.get("email"):
        frontend = get_project_frontend_url(project_id) or ""
        order_items = [
            {"title": it["title"] + (" — " + it["variation_name"] if it.get("variation_name") else ""),
             "qty": it["quantity"], "price": f"{float(it['unit_price']):.2f}"}
            for it in items
        ]
        order_vars = {
            "order_number": str(order_id),
            "customer_name": user.get("name") or "Customer",
            "items": order_items,
            "order_total": f"{float(total):.2f}",
            "order_url": (f"{frontend.rstrip('/')}/orders" if frontend else ""),
            "store_name": _project_store_name(project_id),
            "downloads": _digital_downloads(project_id, items),
        }
        background_tasks.add_task(
            _send_template_email, project_id, "order_confirmation", user["email"], order_vars,
            from_name=from_name, from_email=from_email,
        )

    # Outbound webhooks. `order.created` always fires; `order.paid` ONLY
    # fires when a real payment was captured — for Pay-on-Delivery (manual)
    # we have no payment to confirm yet, so consumers shouldn't see it.
    event_data = {
        "order_id": order_id,
        "amount":   float(total),
        "currency": "USD",
        "customer": {"name": (user or {}).get("name", "") or rn,
                     "email": (user or {}).get("email", "")},
        "items": [{"product_id": it["product_id"], "title": it["title"],
                   "variation": it.get("variation_name"), "qty": it["quantity"],
                   "price": float(it["unit_price"])} for it in items],
        "delivery_method": data.delivery_method,
    }
    background_tasks.add_task(dispatch_event, project_id, "order.created", event_data)
    if pay_status == "paid":
        background_tasks.add_task(dispatch_event, project_id, "order.paid", event_data)

    # Bell push for every operator on the project — title carries the order
    # number for at-a-glance triage, message has customer + amount, link
    # jumps to the Orders page filtered to this order.
    try:
        proj = db_one("SELECT api_key, currency FROM crm_projects WHERE id=%s", (project_id,))
        api_key = (proj or {}).get("api_key")
        cust_name = (data.recipient_name or "").strip() or "Guest"
        currency  = (event_data.get("currency") or (proj or {}).get("currency") or "USD").upper()
        amount    = event_data.get("amount") or event_data.get("total") or 0
        background_tasks.add_task(
            push_crm_notification_project,
            project_id, "new_order",
            f"New order #{order_id}",
            f"{cust_name} · {currency} {float(amount):.2f}",
            f"/project/{api_key}/orders?open={order_id}" if api_key else None,
        )
    except Exception as e:
        print(f"[notif] order push failed: {e}")
    # Live push to CRM dashboards via PostgreSQL NOTIFY — CRM's
    # background LISTEN task fans out to all WebSocket subscribers
    # watching this project. No HTTP hop, no shared secret needed
    # since both processes hit the same DB.
    try:
        with db_cursor() as (_c2, _cur2):
            _cur2.execute(
                "SELECT pg_notify(%s, %s)",
                ("crm_project_events", json.dumps({
                    "type": "order_created",
                    "project_id": int(project_id),
                    "data": {"order_id": order_id, "total": float(total)},
                    "ts": datetime.now(timezone.utc).isoformat(),
                })),
            )
            _c2.commit()
    except Exception:
        pass
    return {"success": True, "order_id": order_id}


def _digital_downloads(project_id: int, items: list,
                       _prod_cache: dict | None = None,
                       _file_cache: dict | None = None) -> list:
    """Download links for digital products in an order — [{title, label, url}] (engine escapes at render).

    When a product opts into one-ZIP delivery (products.digital_zip) and the CRM has
    built its bundle (products.digital_zip_url), hand out that single archive instead
    of N per-file links. Products without bundling (or whose zip isn't built yet) fall
    back to the per-file links.

    Optional pre-fetched caches let a batched caller (e.g. get_my_orders rendering many
    orders at once) avoid the per-order product/custom-field queries entirely:
      _prod_cache: {product_id: {"digital_zip": bool, "digital_zip_url": str|None}}
      _file_cache: {product_id: [ {"field_key": str, "field_value": str}, ... ]}
    Both must cover EVERY digital product_id in `items` when supplied, or those ids are
    treated as having no rows (same as a DB miss). When None (default) the function
    self-fetches exactly as before — preserving behavior for all other callers."""
    digital_ids = list(dict.fromkeys(
        it["product_id"] for it in items if it.get("product_type") == "digital"))
    if not digital_ids:
        return []
    titles = {it["product_id"]: it["title"] for it in items}
    if _prod_cache is not None:
        prods = [dict(id=pid, **_prod_cache[pid]) for pid in digital_ids if pid in _prod_cache]
    else:
        fmt = ",".join(["%s"] * len(digital_ids))
        try:
            prods = db_all(f"SELECT id, digital_zip, digital_zip_url FROM products WHERE id IN ({fmt})",
                           tuple(digital_ids))
        except Exception:
            prods = []   # columns not present yet → everyone gets per-file links
    out, per_file_ids = [], []
    for pid in digital_ids:
        p = next((x for x in prods if x["id"] == pid), None) or {}
        if p.get("digital_zip") and p.get("digital_zip_url"):
            out.append({"title": titles.get(pid) or "", "label": "ZIP archive", "url": p["digital_zip_url"]})
        else:
            per_file_ids.append(pid)
    if per_file_ids:
        if _file_cache is not None:
            for pid in per_file_ids:
                for r in _file_cache.get(pid, []):
                    out.append({"title": titles.get(pid) or "",
                                "label": r["field_key"], "url": r["field_value"]})
        else:
            fmt2 = ",".join(["%s"] * len(per_file_ids))
            rows = db_all(
                f"SELECT product_id, field_key, field_value FROM product_custom_fields "
                f"WHERE project_id=%s AND product_id IN ({fmt2}) AND field_type='file' AND field_value <> ''",
                tuple([project_id] + per_file_ids)
            )
            out += [{"title": titles.get(r["product_id"]) or "", "label": r["field_key"], "url": r["field_value"]}
                    for r in rows]
    return out


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

    # Opt-in pagination: limit/offset only take effect when explicitly supplied as
    # query params. When BOTH are absent the query is unchanged (no LIMIT) so the
    # default fetch-all behavior is preserved — OrderSuccess.jsx fetches the full
    # list then .find()s one order, and the SDK's client.orders.list() passes no
    # params. Callers that DO want a page pass ?limit=N (&offset=M).
    qp = request.query_params
    page_sql, page_params = "", []
    if qp.get("limit") is not None:
        try:
            lim = max(1, min(int(qp.get("limit")), 200))
        except (TypeError, ValueError):
            raise HTTPException(400, "limit must be an integer")
        page_sql += " LIMIT %s"
        page_params.append(lim)
        if qp.get("offset") is not None:
            try:
                off = max(0, int(qp.get("offset")))
            except (TypeError, ValueError):
                raise HTTPException(400, "offset must be an integer")
            page_sql += " OFFSET %s"
            page_params.append(off)
    elif qp.get("offset") is not None:
        # offset without limit is meaningless in SQL; reject rather than silently ignore.
        raise HTTPException(400, "offset requires limit")

    orders = db_all(
        """SELECT oh.id, oh.total_amount, oh.status, oh.delivery_method,
                  oh.recipient_name, oh.address, oh.payment_method, oh.comment,
                  oh.created_at, oh.updated_at, oh.delivered_at,
                  oh.tracking_number, oh.package_count,
                  oh.address_country, oh.address_city, oh.address_postal_code,
                  oh.address_street, oh.address_apartment,
                  oh.address_floor, oh.address_entrance, oh.address_intercom,
                  oh.recipient_first_name, oh.recipient_last_name, oh.recipient_middle_name,
                  c.name AS carrier_name,
                  c.tracking_url_template
           FROM order_history oh
           LEFT JOIN shipping_carriers c ON c.id = oh.carrier_id
           WHERE oh.user_id=%s AND oh.project_id=%s
           ORDER BY oh.created_at DESC""" + page_sql,
        tuple([user_id, project_id] + page_params)
    )
    if not orders:
        return []

    order_ids = [o["id"] for o in orders]

    # ── 1. ALL order_items for these orders in ONE query (was N queries). ──────────
    #    oi.order_id added to the SELECT so rows can be grouped per order in Python.
    item_rows = db_all(
        """SELECT oi.order_id, oi.id AS order_item_id, oi.quantity, oi.price,
                  oi.selected_modifier_item_ids, oi.product_id,
                  p.title, p.product_type, pv.variation_name,
                  (pv.images)[1] AS image_url, pc.configuration_name
           FROM order_items oi
           JOIN products p ON oi.product_id=p.id
           JOIN product_configurations_l1 pv ON oi.variation_id=pv.id
           JOIN product_configurations_l2 pc ON oi.configuration_id=pc.id
           WHERE oi.order_id = ANY(%s)
           ORDER BY oi.order_id, oi.id""",
        (order_ids,)
    )
    items_by_order = {}
    for it in item_rows:
        items_by_order.setdefault(it["order_id"], []).append(it)

    # ── 2. ALL modifier items referenced by ANY line across ALL orders in ONE query. ─
    all_mod_ids = {mid for it in item_rows for mid in (it["selected_modifier_item_ids"] or [])}
    mod_meta = {}
    if all_mod_ids:
        mods = db_all(
            "SELECT i.id, i.name, i.price_delta, g.name AS group_name"
            "  FROM product_modifier_items i"
            "  JOIN product_modifier_groups g ON i.group_id = g.id"
            " WHERE i.id = ANY(%s)",
            (list(all_mod_ids),)
        )
        for m in mods:
            mod_meta[m["id"]] = {
                "id":          m["id"],
                "name":        m["name"],
                "price_delta": float(m["price_delta"] or 0),
                "group_name":  m["group_name"],
            }

    # ── 3+4. Pre-fetch digital-download data for ALL digital products at once, then
    #    let _digital_downloads resolve per order from the cache (0 queries per order).
    digital_ids = list(dict.fromkeys(
        it["product_id"] for it in item_rows if it.get("product_type") == "digital"))
    prod_cache, file_cache = {}, {}
    if digital_ids:
        dfmt = ",".join(["%s"] * len(digital_ids))
        try:
            for r in db_all(
                f"SELECT id, digital_zip, digital_zip_url FROM products WHERE id IN ({dfmt})",
                tuple(digital_ids)
            ):
                prod_cache[r["id"]] = {"digital_zip": r["digital_zip"],
                                       "digital_zip_url": r["digital_zip_url"]}
        except Exception:
            prod_cache = {}   # columns not present yet → fall through to per-file links
        for r in db_all(
            f"SELECT product_id, field_key, field_value FROM product_custom_fields "
            f"WHERE project_id=%s AND product_id IN ({dfmt}) AND field_type='file' AND field_value <> ''",
            tuple([project_id] + digital_ids)
        ):
            file_cache.setdefault(r["product_id"], []).append(
                {"field_key": r["field_key"], "field_value": r["field_value"]})

    result = []
    for o in orders:
        # Resolve the courier tracking URL on the server side so the
        # storefront doesn't need to know the {tracking} substitution
        # convention — it just renders <a href={tracking_url}>. We
        # return null when either field is missing so the JSX can
        # cleanly hide the tracking row.
        track = (o.get("tracking_number") or "").strip()
        tpl   = o.get("tracking_url_template") or ""
        tracking_url = tpl.replace("{tracking}", track) if (tpl and track) else None
        items = items_by_order.get(o["id"], [])
        # Digital download links for this order (one ZIP when bundled, else per file)
        # resolved from the batched caches — same output as the per-order call.
        order_downloads = _digital_downloads(project_id, [
            {"product_id": it["product_id"], "title": it["title"], "product_type": it.get("product_type")}
            for it in items
        ], _prod_cache=prod_cache, _file_cache=file_cache)
        result.append({
            "id":              o["id"],
            "total_amount":    o["total_amount"],
            "status":          o["status"],
            "downloads":       order_downloads,
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
            # Courier tracking — populated once the merchant fills the
            # shipping label modal in CRM. Storefront uses these to
            # render a "Track parcel" row that links to the carrier's
            # public tracking page (CDEK / Kazpost / Pochta / DHL).
            "carrier_name":    o.get("carrier_name") or None,
            "tracking_number": track or None,
            "tracking_url":    tracking_url,
            "package_count":   int(o.get("package_count") or 1),
            # Structured shipping address — null for digital / pickup
            # orders (no recipient address collected). Storefront can
            # display the structured fields back to the customer in
            # their Orders page so they see exactly what was sent.
            "address_country":     o.get("address_country") or None,
            "address_city":        o.get("address_city") or None,
            "address_postal_code": o.get("address_postal_code") or None,
            "address_street":      o.get("address_street") or None,
            "address_apartment":   o.get("address_apartment") or None,
            "address_floor":       o.get("address_floor") or None,
            "address_entrance":    o.get("address_entrance") or None,
            "address_intercom":    o.get("address_intercom") or None,
            # Structured recipient name — Last/First/Middle separately.
            # Storefront falls back to legacy `recipient_name` if
            # these are null (orders placed before this migration).
            "recipient_first_name":  o.get("recipient_first_name") or None,
            "recipient_last_name":   o.get("recipient_last_name") or None,
            "recipient_middle_name": o.get("recipient_middle_name") or None,
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

RETURN_WINDOW_DAYS = 14
RETURN_REASONS = ("damaged", "wrong_item", "not_as_described", "changed_mind",
                  "arrived_late", "quality_issue", "other")
ACTIVE_RETURN_STATUSES = ("requested", "approved", "received", "inspected")  # still open / not refundable again


@app.get("/{api_key}/orders/{order_id}/returns")
def get_my_order_returns(api_key: str, order_id: int, request: Request,
                          api_key_record: dict = Depends(resolve_api_key)):
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


# ── Stock transition helper (mirrors CRM's _apply_stock_transition) ────
_X_DEDUCTED_STATES = {"shipped", "delivered"}
_X_RESERVED_STATES = {"new", "confirmed"}

def _release_or_restock_for_cancel(cur, order_id: int, project_id: int,
                                    old_status: str, was_deducted: bool):
    cur.execute(
        "SELECT configuration_id AS sku_id, quantity"
        "  FROM order_items WHERE order_id=%s",
        (order_id,)
    )
    items = cur.fetchall()
    if not items:
        return
    cur.execute("SET LOCAL torta.skip_audit = 'on'")
    for it in items:
        sku_id = int(it["sku_id"]) if it["sku_id"] is not None else None
        qty    = int(it["quantity"] or 0)
        if not sku_id or not qty: continue
        # Pick a warehouse: prefer one that holds reservation/stock for this SKU.
        cur.execute(
            "SELECT warehouse_id FROM product_stock"
            " WHERE sku_id=%s AND (quantity > 0 OR reserved_quantity > 0)"
            " LIMIT 1",
            (sku_id,)
        )
        wh_row = cur.fetchone()
        wh_id = wh_row["warehouse_id"] if wh_row else None
        if not wh_id:
            cur.execute(
                "SELECT id FROM warehouses WHERE project_id=%s AND is_active=TRUE"
                " ORDER BY is_default DESC NULLS LAST, id ASC LIMIT 1",
                (project_id,)
            )
            row = cur.fetchone()
            wh_id = row["id"] if row else None
        if not wh_id: continue

        if was_deducted:
            # Order had already shipped — physically restock.
            cur.execute(
                "UPDATE product_stock"
                "   SET quantity      = quantity      + %s,"
                "       sold_quantity = GREATEST(0, sold_quantity - %s)"
                " WHERE sku_id=%s AND warehouse_id=%s",
                (qty, qty, sku_id, wh_id)
            )
            cur.execute(
                "UPDATE product_configurations_l2"
                "   SET stock_quantity = stock_quantity + %s,"
                "       sold_quantity  = GREATEST(0, sold_quantity - %s)"
                " WHERE id=%s",
                (qty, qty, sku_id)
            )
            cur.execute(
                "INSERT INTO product_stock_log"
                " (project_id, sku_id, warehouse_id, delta, reason, reference_id, note)"
                " VALUES (%s, %s, %s, %s, 'return', %s, %s)",
                (project_id, sku_id, wh_id, qty, order_id,
                 f"Order #{order_id} · cancelled by customer (restocked)")
            )
        elif old_status in _X_RESERVED_STATES:
            # Still reserved — release the reservation only.
            cur.execute(
                "UPDATE product_stock"
                "   SET reserved_quantity = GREATEST(0, reserved_quantity - %s)"
                " WHERE sku_id=%s AND warehouse_id=%s",
                (qty, sku_id, wh_id)
            )
            cur.execute(
                "UPDATE product_configurations_l2"
                "   SET reserved_quantity = GREATEST(0, reserved_quantity - %s)"
                " WHERE id=%s",
                (qty, sku_id)
            )
            cur.execute(
                "INSERT INTO product_stock_log"
                " (project_id, sku_id, warehouse_id, delta, reason, reference_id, note)"
                " VALUES (%s, %s, %s, %s, 'reservation', %s, %s)",
                (project_id, sku_id, wh_id, qty, order_id,
                 f"Order #{order_id} · cancelled by customer (reservation released)")
            )

    cur.execute(
        "UPDATE order_history SET stock_deducted=FALSE WHERE id=%s",
        (order_id,)
    )


# ── Customer-initiated order cancellation ──────────────────────────────
_CUSTOMER_CANCELLABLE = {"new", "confirmed", "shipped"}

@app.post("/{api_key}/orders/{order_id}/cancel")
def cancel_order(api_key: str, order_id: int, request: Request,
                 api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    token = request.cookies.get("authx_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        user_id = int(jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])["sub"])
    except Exception:
        raise HTTPException(401, "Invalid or expired token")

    with db_cursor() as (conn, cur):
        cur.execute(
            "SELECT id, status, COALESCE(stock_deducted, FALSE) AS stock_deducted"
            "  FROM order_history"
            " WHERE id=%s AND project_id=%s AND user_id=%s"
            " FOR UPDATE",
            (order_id, project_id, user_id)
        )
        order = cur.fetchone()
        if not order:
            raise HTTPException(404, "Order not found")
        if order["status"] not in _CUSTOMER_CANCELLABLE:
            raise HTTPException(409,
                f"Order in status '{order['status']}' cannot be cancelled. "
                f"Allowed only while: {', '.join(_CUSTOMER_CANCELLABLE)}.")

        # Update status first so trigger code sees the new row.
        cur.execute(
            "UPDATE order_history SET status='cancelled', updated_at=NOW()"
            " WHERE id=%s",
            (order_id,)
        )
        _release_or_restock_for_cancel(
            cur, order_id, project_id,
            old_status=order["status"],
            was_deducted=bool(order["stock_deducted"])
        )
        conn.commit()

    return {"success": True, "status": "cancelled"}


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

    photos = [sanitize(p)[:1000] for p in (body.customer_photos or [])][:10]

    with db_cursor() as (conn, cur):
        # Lock the order row so concurrent return requests for the SAME order
        # serialize. Without it, two requests both read the same already-returning
        # total and both insert, together exceeding the purchased quantity — which
        # the CRM inspect flow would then restock, inflating inventory. The
        # duplicate-active-return check therefore has to run INSIDE this locked
        # transaction (on this cursor), not on a separate pooled connection.
        cur.execute(
            "SELECT id FROM order_history WHERE id=%s AND project_id=%s FOR UPDATE",
            (order_id, project_id)
        )
        if not cur.fetchone():
            raise HTTPException(404, "Order not found")
        cur.execute(
            """SELECT ri.order_item_id, SUM(ri.quantity) AS qty
                 FROM order_return_items ri
                 JOIN order_returns r ON ri.return_id = r.id
                WHERE r.order_id=%s AND r.status = ANY(%s)
                GROUP BY ri.order_item_id""",
            (order_id, list(ACTIVE_RETURN_STATUSES))
        )
        active_by_item = {row["order_item_id"]: int(row["qty"] or 0) for row in cur.fetchall()}
        for it in body.items:
            ordered = int(oi_by_id[it.order_item_id]["quantity"])
            already_returning = active_by_item.get(it.order_item_id, 0)
            if already_returning + it.quantity > ordered:
                raise HTTPException(400,
                    f"Item {it.order_item_id}: {already_returning} already in an active return, "
                    f"can only request {ordered - already_returning} more")

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
# Security:

@app.post("/{api_key}/webhooks/{provider}")
async def receive_payment_webhook(api_key: str, provider: str, request: Request,
                                    background_tasks: BackgroundTasks):
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

def _enrich_payload(request: Request, ip: str, payload) -> dict:
    """Build the geo + UA + referrer dict used by every tracker insert. Reads
    optional fields from the request payload (SDK adds them automatically)
    and falls back to None when the storefront didn't send them."""
    geo = _extract_geo(request, ip)
    ua  = request.headers.get("user-agent") or ""
    uap = _parse_ua(ua)
    referrer = getattr(payload, "referrer", None) if payload else None
    ref_class = _classify_referrer(referrer or "")
    return {
        **geo,                # country_code / country_name / city
        "user_agent":      ua[:1000] if ua else None,
        "device_type":     uap["device_type"],
        "browser":         uap["browser"],
        "os":              uap["os"],
        "referrer":        (referrer or "")[:500] or None,
        "referrer_host":   ref_class["referrer_host"],
        "traffic_source":  ref_class["traffic_source"],
        "utm_source":      (getattr(payload, "utm_source",   None) or None) if payload else None,
        "utm_medium":      (getattr(payload, "utm_medium",   None) or None) if payload else None,
        "utm_campaign":    (getattr(payload, "utm_campaign", None) or None) if payload else None,
        "language":        (getattr(payload, "language",     None) or None) if payload else None,
        "screen_width":    (getattr(payload, "screen_width", None) or None) if payload else None,
    }


@app.post("/{api_key}/track/visit")
def track_visit(request: Request,
                data: Optional[TrackVisitRequest] = None,
                api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)
    ip         = get_client_ip(request)
    print(f"[track-visit] project={project_id} ip={ip} user={user_id}")
    try:
        with db_cursor() as (conn, cursor):
            # Dedup is per-identity, not per-IP. If the user is logged in,
            # match on user_id — that way several accounts on the same
            # machine each get their own visit row (previously the second
            # account got silently deduped because IPs match). Anonymous
            # traffic still dedups by IP. Window of 30s prevents pure
            # refresh-spam but is short enough that switching accounts
            # immediately registers as a fresh visit.
            if user_id:
                cursor.execute(
                    "SELECT id FROM site_visits"
                    " WHERE user_id=%s AND project_id=%s"
                    "   AND created_at >= NOW() - INTERVAL '30 seconds'",
                    (user_id, project_id)
                )
            else:
                cursor.execute(
                    "SELECT id FROM site_visits"
                    " WHERE ip=%s AND project_id=%s AND user_id IS NULL"
                    "   AND created_at >= NOW() - INTERVAL '30 seconds'",
                    (ip, project_id)
                )
            if cursor.fetchone():
                return {"success": True, "skipped": True}
            e = _enrich_payload(request, ip, data)
            # Same defensive INSERT pattern as track_product_view.
            try:
                cursor.execute(
                    "INSERT INTO site_visits (user_id, ip, project_id,"
                    "  country_code, country_name, city, user_agent, device_type, browser, os,"
                    "  referrer, referrer_host, traffic_source,"
                    "  utm_source, utm_medium, utm_campaign, language, screen_width)"
                    " VALUES (%s,%s,%s, %s,%s,%s,%s,%s,%s,%s, %s,%s,%s, %s,%s,%s,%s,%s)",
                    (user_id, ip, project_id,
                     e["country_code"], e["country_name"], e["city"],
                     e["user_agent"], e["device_type"], e["browser"], e["os"],
                     e["referrer"], e["referrer_host"], e["traffic_source"],
                     e["utm_source"], e["utm_medium"], e["utm_campaign"],
                     e["language"], e["screen_width"])
                )
            except (psycopg2.errors.UndefinedColumn, psycopg2.DataError,
                    psycopg2.errors.StringDataRightTruncation):
                conn.rollback()
                cursor.execute(
                    "INSERT INTO site_visits (user_id, ip, project_id) VALUES (%s,%s,%s)",
                    (user_id, ip, project_id)
                )
            conn.commit()
    except Exception as e:
        print(f"[track-visit] FAILED: {type(e).__name__}: {e}")
        return {"success": False, "error": str(e)[:200]}
    return {"success": True}


@app.post("/{api_key}/track/product-view")
def track_product_view(data: TrackProductView, request: Request,
                       api_key_record: dict = Depends(resolve_api_key)):
    """One row per (IP, product, day). The previous dedup was per (IP, day)
    without product_id — so after the first product view of the day, every
    subsequent view (even of a different product) was silently skipped and
    the funnel reported 0 views forever after the first impression. We
    still dedup obvious page-reloads of the SAME product on the SAME day
    so a curious shopper hitting F5 doesn't inflate the view count."""
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)
    ip         = get_client_ip(request)
    print(f"[track-pv] project={project_id} product={data.product_id} ip={ip} user={user_id}")
    try:
        with db_cursor() as (conn, cursor):
            # Dedup is per-(identity, product, day) so that switching
            # accounts on the same machine produces separate viewer
            # records. The old IP-only dedup blocked every account after
            # the first from registering any product view in a day —
            # devastating for a multi-account test scenario.
            if user_id:
                cursor.execute(
                    "SELECT id FROM product_page_views"
                    " WHERE user_id=%s AND project_id=%s AND product_id=%s"
                    "   AND DATE(created_at)=CURRENT_DATE",
                    (user_id, project_id, data.product_id)
                )
            else:
                cursor.execute(
                    "SELECT id FROM product_page_views"
                    " WHERE ip=%s AND project_id=%s AND product_id=%s"
                    "   AND user_id IS NULL AND DATE(created_at)=CURRENT_DATE",
                    (ip, project_id, data.product_id)
                )
            if cursor.fetchone():
                print(f"[track-pv] skipped (dedup): product={data.product_id} ip={ip} user={user_id}")
                return {"success": True, "skipped": True}
            e = _enrich_payload(request, ip, data)
            # Defensive INSERT: try the full enriched row first, fall back to
            # the legacy 4-column form if any column is missing or rejects the
            # value. Without this fallback a missing/incompatible column
            # silently rolls back the transaction → 0 rows → 0 views in the
            # funnel.
            try:
                cursor.execute(
                    "INSERT INTO product_page_views (product_id, user_id, ip, project_id,"
                    "  country_code, country_name, city, user_agent, device_type, browser, os,"
                    "  referrer, referrer_host, traffic_source,"
                    "  utm_source, utm_medium, utm_campaign, language, screen_width)"
                    " VALUES (%s,%s,%s,%s, %s,%s,%s,%s,%s,%s,%s, %s,%s,%s, %s,%s,%s,%s,%s)",
                    (data.product_id, user_id, ip, project_id,
                     e["country_code"], e["country_name"], e["city"],
                     e["user_agent"], e["device_type"], e["browser"], e["os"],
                     e["referrer"], e["referrer_host"], e["traffic_source"],
                     e["utm_source"], e["utm_medium"], e["utm_campaign"],
                     e["language"], e["screen_width"])
                )
                print(f"[track-pv] inserted (enriched): product={data.product_id}")
            except (psycopg2.errors.UndefinedColumn, psycopg2.DataError,
                    psycopg2.errors.StringDataRightTruncation) as enrich_err:
                conn.rollback()
                cursor.execute(
                    "INSERT INTO product_page_views (product_id, user_id, ip, project_id)"
                    " VALUES (%s,%s,%s,%s)",
                    (data.product_id, user_id, ip, project_id)
                )
                print(f"[track-pv] inserted (basic, fallback after {type(enrich_err).__name__}): product={data.product_id}")
            conn.commit()
    except Exception as e:
        # Last-line safety: tracking must never break the page. Log and
        # return success so the SDK's fire-and-forget catches happily.
        print(f"[track-pv] FAILED: {type(e).__name__}: {e}")
        return {"success": False, "error": str(e)[:200]}
    return {"success": True}


# ── New trackers: search / cart events / checkout events / custom goals ─

@app.post("/{api_key}/track/search")
def track_search(data: TrackSearchRequest, request: Request,
                 api_key_record: dict = Depends(resolve_api_key)):
    """Records every search the customer fires. The zero-result-count is the
    valuable signal — those queries tell the merchant what SKUs are missing
    from their catalog."""
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)
    _rate_limit_track(request, user_id)
    ip = get_client_ip(request)
    q  = sanitize((data.query or "").strip())[:200]
    if not q: return {"success": True, "skipped": True}
    geo = _extract_geo(request, ip)
    with db_cursor() as (conn, cur):
        cur.execute(
            "INSERT INTO search_queries (project_id, user_id, ip, query, results_count, country_code)"
            " VALUES (%s,%s,%s,%s,%s,%s)",
            (project_id, user_id, ip, q, max(0, int(data.results_count or 0)),
             geo["country_code"])
        )
        conn.commit()
    return {"success": True}


@app.post("/{api_key}/track/cart-event")
def track_cart_event(data: TrackCartEventRequest, request: Request,
                     api_key_record: dict = Depends(resolve_api_key)):
    """Per-action cart event log — used to build the fine-grained funnel
    (which products got added then removed, time-to-purchase, etc)."""
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)
    _rate_limit_track(request, user_id)
    action = (data.action or "").lower()
    if action not in ("add", "remove", "update_qty", "apply_promo", "remove_promo"):
        raise HTTPException(400, "Invalid cart event action")
    ip = get_client_ip(request)
    with db_cursor() as (conn, cur):
        cur.execute(
            "INSERT INTO cart_events (project_id, user_id, ip, action,"
            "  product_id, variation_id, configuration_id, quantity, promo_code)"
            " VALUES (%s,%s,%s,%s, %s,%s,%s,%s,%s)",
            (project_id, user_id, ip, action,
             data.product_id, data.variation_id, data.configuration_id,
             data.quantity, (data.promo_code or "")[:40] or None)
        )
        conn.commit()
    return {"success": True}


@app.post("/{api_key}/track/checkout")
def track_checkout(data: TrackCheckoutRequest, request: Request,
                   api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)
    _rate_limit_track(request, user_id)
    step = (data.step or "").lower()
    if step not in ("started", "address_filled", "promo_tried", "submitted", "failed"):
        raise HTTPException(400, "Invalid checkout step")
    ip = get_client_ip(request)
    with db_cursor() as (conn, cur):
        cur.execute(
            "INSERT INTO checkout_events (project_id, user_id, ip, step, fail_reason, total_amount)"
            " VALUES (%s,%s,%s,%s,%s,%s)",
            (project_id, user_id, ip, step,
             sanitize(data.fail_reason or "")[:200] or None,
             float(data.total_amount) if data.total_amount is not None else None)
        )
        conn.commit()
    return {"success": True}


@app.post("/{api_key}/track/goal")
def track_goal(data: TrackGoalRequest, request: Request,
               background_tasks: BackgroundTasks,
               api_key_record: dict = Depends(resolve_api_key)):
    """Customer fires a custom-event goal from the storefront. We accept it
    only if the merchant pre-registered a `goal_type='custom_event_count'`
    goal with a matching `custom_event_name` — prevents schema-spam attacks."""
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)
    _rate_limit_track(request, user_id)
    name = (data.event_name or "").strip()[:120]
    if not name: raise HTTPException(400, "event_name is required")
    # Whitelist check — must match an active, custom-event goal in this project.
    goal = db_one(
        "SELECT id FROM crm_goals"
        " WHERE project_id=%s AND is_active=TRUE"
        "   AND goal_type='custom_event_count' AND custom_event_name=%s",
        (project_id, name)
    )
    if not goal:
        # Reject silently so attackers can't probe goal names — return 200
        # but record nothing. Storefront treats it the same as success.
        return {"success": True, "ignored": True}
    metadata = data.metadata if isinstance(data.metadata, dict) else None
    with db_cursor() as (conn, cur):
        import json as _json
        cur.execute(
            "INSERT INTO crm_goal_events (project_id, goal_id, user_id, event_name, value, metadata)"
            " VALUES (%s,%s,%s,%s,%s,%s::jsonb)",
            (project_id, goal["id"], user_id, name,
             float(data.value) if data.value is not None else None,
             _json.dumps(metadata) if metadata else None)
        )
        conn.commit()
    # Re-check goal progress in the background — may fire goal.achieved webhook.
    background_tasks.add_task(_check_goal_progress, project_id, goal["id"])
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

    org_id = (db_one("SELECT org_id FROM crm_projects WHERE id=%s", (project_id,)) or {}).get("org_id")
    scope_sql, scope_val = ("org_id=%s", org_id) if _org_shares_customers(org_id) else ("project_id=%s", project_id)
    is_new_user = False
    with db_cursor() as (conn, cursor):
        cursor.execute(f"SELECT id FROM users WHERE google_id=%s AND {scope_sql}", (g_id, scope_val))
        user = cursor.fetchone()
        if not user:
            cursor.execute(f"SELECT id FROM users WHERE email=%s AND {scope_sql} AND google_id IS NULL",
                           (email, scope_val))
            user = cursor.fetchone()
            if user:
                cursor.execute("UPDATE users SET google_id=%s WHERE id=%s", (g_id, user["id"]))
                conn.commit()
        if not user:
            _enforce_storefront_users(org_id)
            cursor.execute(
                "INSERT INTO users (name, email, password_hash, project_id, org_id, google_id) VALUES(%s,%s,'',%s,%s,%s) RETURNING id",
                (sanitize(name), email, project_id, org_id, g_id)
            )
            user_id = cursor.fetchone()["id"]
            conn.commit()
            is_new_user = True
        else:
            user_id = user["id"]

    if is_new_user:
        # OAuth callback isn't injected with BackgroundTasks (it's a redirect
        # endpoint). dispatch_event has its own try/except so we just thread
        # the call to keep the redirect snappy.
        import threading
        threading.Thread(
            target=dispatch_event, daemon=True,
            args=(project_id, "customer.created",
                  {"user_id": user_id, "customer": {"name": sanitize(name), "email": email}}),
        ).start()

    token   = create_token(user_id)
    refresh = issue_refresh_token(user_id, project_id, request, label="Google login")
    redirect = RedirectResponse(f"{frontend}", status_code=302)
    # Use _SESSION_SAMESITE (= "none" in prod) so the cookies survive the
    # cross-origin fetches the storefront makes after redirect. Was hardcoded
    # "lax" — that worked for same-origin storefronts but blocked all cross-
    # origin fetch from a storefront on a different domain (cookies stored
    # but never sent → /users/me 401 → user appears not logged in even
    # though the OAuth callback technically succeeded).
    redirect.set_cookie(key="authx_token", value=token, httponly=True,
                        max_age=ACCESS_TOKEN_MINUTES * 60,
                        samesite=_SESSION_SAMESITE, secure=COOKIE_SECURE, path="/")
    redirect.set_cookie(key="authx_refresh", value=refresh, httponly=True,
                        max_age=REFRESH_TOKEN_DAYS * 86400,
                        samesite=_SESSION_SAMESITE, secure=COOKIE_SECURE, path="/")
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
        # Discord 2023+ migrated to handle-less accounts: legacy usernames have
        # no global_name, fresh accounts have both. Prefer global_name (display),
        # fall back to username (handle) so legacy users still get a sane name.
        "extract":       lambda info: {
            "id":    str(info.get("id") or ""),
            "email": info.get("email"),
            "name":  info.get("global_name") or info.get("username") or "",
        },
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
        # Bitbucket's /2.0/user response doesn't include the email — it's at
        # /2.0/user/emails. Without the fallback every Bitbucket signup would
        # land with a `bitbucket_<uuid>@oauth.local` placeholder. Special-cased
        # via the post-extract email fetch in _oauth_finish (see "bitbucket" branch).
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
        # Production-grade Apple Sign-In:
        #   • client_secret stored as JSON {team_id, key_id, private_key}
        #     → _oauth_finish parses it and signs a fresh ES256 JWT per token
        #       exchange (cached 50min, see _apple_client_secret_jwt).
        #   • `name email` scope + form_post mode → Apple POSTs the callback
        #     with `code`, `id_token`, and (first sign-in only) a `user` field
        #     containing the display name. See @app.post("/apple/callback").
        #   • id_token is verified against Apple's JWK set (cached 1h) before
        #     trusting its claims — _verify_apple_id_token.
        # Apple's cookie sameSite=lax POST callback works because we also set
        # the state cookie with SameSite=None when the user clicks Login (see
        # the apple branch in oauth_login).
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


# ── Apple Sign-In production helpers ──────────────────────────────────────

_APPLE_JWT_CACHE: dict[tuple, tuple[str, float]] = {}   # (service_id,key_id) → (jwt, exp)
_APPLE_JWK_CACHE: dict[str, tuple[dict, float]] = {}    # "keys" → (jwks_dict, fetched_at)
_APPLE_AUD       = "https://appleid.apple.com"
_APPLE_JWKS_URL  = "https://appleid.apple.com/auth/keys"


def _parse_apple_credentials(client_secret_blob: str) -> dict:
    """Apple's `client_secret` column holds a JSON blob with team_id, key_id,
    private_key (PEM). Raises ValueError if malformed so callers can surface a
    user-friendly error to the merchant."""
    try:
        data = json.loads(client_secret_blob or "{}")
    except Exception:
        raise ValueError("Apple client_secret must be JSON {team_id, key_id, private_key}")
    team_id = (data.get("team_id") or "").strip()
    key_id  = (data.get("key_id")  or "").strip()
    pem     = (data.get("private_key") or "").strip()
    if not team_id or len(team_id) != 10:
        raise ValueError("Apple team_id must be 10 characters (Apple Developer → Membership)")
    if not key_id or len(key_id) != 10:
        raise ValueError("Apple key_id must be 10 characters (Apple Developer → Keys → your Sign-In key)")
    if "PRIVATE KEY" not in pem:
        raise ValueError("Apple private_key must be the PEM contents of the .p8 file (-----BEGIN PRIVATE KEY-----)")
    return {"team_id": team_id, "key_id": key_id, "private_key": pem}


def _apple_client_secret_jwt(service_id: str, team_id: str, key_id: str,
                             private_key_pem: str) -> str:
    """Returns a cached or freshly-signed ES256 JWT suitable for Apple's
    /auth/token endpoint. Apple accepts up to 15777000s (6mo) but we reissue
    every 50min — JWT signing is cheap and a short TTL limits blast-radius if
    the private key ever leaks."""
    cache_key = (service_id, key_id)
    cached = _APPLE_JWT_CACHE.get(cache_key)
    now = int(time.time())
    if cached and cached[1] - now > 60:   # >1min left
        return cached[0]
    payload = {
        "iss": team_id,
        "iat": now,
        "exp": now + 50 * 60,
        "aud": _APPLE_AUD,
        "sub": service_id,
    }
    token = jwt.encode(
        payload, private_key_pem, algorithm="ES256",
        headers={"alg": "ES256", "kid": key_id},
    )
    _APPLE_JWT_CACHE[cache_key] = (token, payload["exp"])
    return token


def _apple_jwks() -> dict:
    """Apple's public JWK set — used to verify id_token signatures. Cached
    1 hour; the keys rotate but old ones stay valid during the rotation
    window so a 1h refresh is plenty."""
    cached = _APPLE_JWK_CACHE.get("keys")
    now = time.time()
    if cached and now - cached[1] < 3600:
        return cached[0]
    try:
        req = urllib.request.Request(_APPLE_JWKS_URL, headers={"User-Agent": "torta-crm/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        _APPLE_JWK_CACHE["keys"] = (data, now)
        return data
    except Exception as e:
        print(f"[apple] JWK fetch failed: {e}")
        # Return stale-but-cached if available; never raise (sign-in must keep working)
        return cached[0] if cached else {"keys": []}


def _verify_apple_id_token(id_token: str, audience: str) -> dict:
    """Verifies + decodes Apple's id_token JWT. `audience` is the merchant's
    Service ID (the `aud` claim Apple sets to). Returns the JWT payload, or
    raises ValueError with a user-friendly message."""
    try:
        header = jwt.get_unverified_header(id_token)
        kid = header.get("kid")
    except Exception:
        raise ValueError("Apple id_token is not a valid JWT")
    jwks = _apple_jwks().get("keys") or []
    key  = next((k for k in jwks if k.get("kid") == kid), None)
    if not key:
        raise ValueError(f"Apple id_token signed by unknown key '{kid}' — JWK set may be stale")
    public_key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key))
    try:
        payload = jwt.decode(
            id_token, public_key, algorithms=["RS256"],
            audience=audience, issuer=_APPLE_AUD,
        )
    except jwt.ExpiredSignatureError:
        raise ValueError("Apple id_token has expired")
    except jwt.InvalidTokenError as e:
        raise ValueError(f"Apple id_token verification failed: {e}")
    return payload


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
    # Apple uses form_post mode → the callback arrives as a cross-origin POST
    # from appleid.apple.com. Cookies with SameSite=lax are NOT sent on
    # cross-origin POST, so we set SameSite=none (requires Secure=true and
    # therefore HTTPS — Apple won't work over plain HTTP localhost either way).
    # All other providers use SameSite=lax which is sent on top-level GET.
    state_samesite = "none" if provider == "apple" else "lax"
    state_secure   = True   if provider == "apple" else COOKIE_SECURE
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
                    max_age=600, httponly=True, samesite=state_samesite,
                    secure=state_secure, path=cookie_path)
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


@app.post("/{api_key}/auth/oauth/apple/callback")
async def apple_oauth_callback_post(api_key: str, request: Request,
                                     api_key_record: dict = Depends(resolve_api_key_public)):
    """Apple's form_post mode delivers the callback as `POST application/x-www-form-urlencoded`
    with fields {code, id_token, state, user?}. We re-use the same _oauth_finish
    flow as the GET callback, plus extract the `user` JSON (sent ONLY on first
    sign-in) for the display name."""
    project_id = api_key_record["id"]
    frontend   = get_project_frontend_url(project_id)
    if not frontend:
        return RedirectResponse("/?error=site_url_not_configured")

    cfg = OAUTH_PROVIDERS.get("apple")
    if not cfg:
        return RedirectResponse(f"{frontend}/login?error=unknown_provider")

    try:
        form = await request.form()
    except Exception:
        return RedirectResponse(f"{frontend}/login?error=apple_bad_form")
    code  = form.get("code") or ""
    state = form.get("state") or ""
    user_blob = form.get("user") or ""

    # State validation: cookie may be missing on cross-site POST over HTTP
    # (SameSite=none requires Secure=true → HTTPS only). When the cookie isn't
    # delivered, fall back to the JWT signature on id_token as the only
    # authentication barrier — Apple's id_token cannot be forged.
    cookie_state = request.cookies.get("oa_state_apple", "")
    if cookie_state and not _hmac.compare_digest(state or "", cookie_state):
        return RedirectResponse(f"{frontend}/login?error=apple_state_mismatch")

    if not code:
        return RedirectResponse(f"{frontend}/login?error=apple_cancelled")

    client_id, client_secret = _get_oauth_credentials(project_id, "apple")
    if not client_id:
        return RedirectResponse(f"{frontend}/login?error=apple_not_configured")

    # `user` field is JSON-encoded and present ONLY the first time a user signs
    # in to this Service ID. After that Apple stops sending it — that's why we
    # MUST persist the name on the very first signup; subsequent logins won't
    # have it.
    apple_user_name = None
    if user_blob:
        try:
            data = json.loads(user_blob)
            n = data.get("name") or {}
            full = " ".join(p for p in (n.get("firstName"), n.get("lastName")) if p).strip()
            if full:
                apple_user_name = full
        except Exception:
            pass

    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key}/auth/oauth/apple/callback"

    try:
        return _oauth_finish("apple", cfg, code, client_id, client_secret,
                             redirect_uri, project_id, frontend, request,
                             apple_user_name=apple_user_name)
    except Exception:
        traceback.print_exc()
        return RedirectResponse(f"{frontend}/login?error=apple_server_error")


def _oauth_finish(provider, cfg, code, client_id, client_secret,
                  redirect_uri, project_id, frontend, request,
                  apple_user_name: str | None = None):
    import urllib.parse, json as _json, base64

    # Apple: replace the merchant-supplied JSON blob with a freshly-signed
    # ES256 JWT. _parse_apple_credentials raises with a user-friendly message
    # if any required field is missing or malformed.
    if provider == "apple":
        try:
            creds = _parse_apple_credentials(client_secret)
        except ValueError as e:
            print(f"[apple] credentials parse failed: {e}")
            return RedirectResponse(f"{frontend}/login?error=apple_bad_credentials")
        client_secret = _apple_client_secret_jwt(
            service_id=client_id,
            team_id=creds["team_id"], key_id=creds["key_id"],
            private_key_pem=creds["private_key"],
        )

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
    # Some providers want HTTP Basic auth instead of body params for the
    # token exchange. Zoom + Bitbucket REJECT body credentials and only accept
    # Basic; Spotify/Notion/X accept either but Basic is the official path.
    # Apple uses body-credential form (the JWT as client_secret) — do NOT
    # switch to Basic for Apple.
    if provider in ("x", "spotify", "notion", "zoom", "bitbucket"):
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
        url = cfg["user_info_url"]
        try:
            ui_req = urllib.request.Request(url, headers=ui_headers, method="GET")
            with urllib.request.urlopen(ui_req, timeout=15) as resp:
                user_info = _json.loads(resp.read())
        except Exception as e:
            print(f"[{provider}] user_info error: {e}")
            return RedirectResponse(f"{frontend}/login?error={provider}_user_info")
    else:
        # Apple: verify the id_token JWT against Apple's public JWK set (cached
        # 1 h). Verifies signature + aud (== our Service ID == client_id) +
        # issuer (https://appleid.apple.com) + exp.
        id_token_str = tokens.get("id_token", "")
        if not id_token_str:
            return RedirectResponse(f"{frontend}/login?error={provider}_no_id_token")
        try:
            user_info = _verify_apple_id_token(id_token_str, audience=client_id)
        except ValueError as e:
            print(f"[{provider}] id_token verification failed: {e}")
            return RedirectResponse(f"{frontend}/login?error={provider}_id_token")

    # ── 3. Extract canonical { id, email, name } ─────────────────────────
    extracted = cfg["extract"](user_info)
    oid   = extracted["id"]
    email = (extracted.get("email") or "").strip().lower() or None
    # Apple sends the display name only on first sign-in via the `user` field
    # in the POST callback; pass-through here so the new user gets their real
    # name instead of the email prefix.
    name  = (apple_user_name
             or extracted.get("name")
             or (email.split("@")[0] if email else f"{provider}_user_{oid[:8]}"))

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

    # Bitbucket /2.0/user never returns the email — it lives on /2.0/user/emails
    # behind the `email` scope. Without this branch every Bitbucket signup would
    # land with a synthetic `bitbucket_<uuid>@oauth.local` placeholder.
    if provider == "bitbucket" and not email:
        try:
            req3 = urllib.request.Request(
                "https://api.bitbucket.org/2.0/user/emails",
                headers={"Authorization": f"Bearer {access_token}",
                         "Accept": "application/json", "User-Agent": "torta-crm/1.0"},
            )
            with urllib.request.urlopen(req3, timeout=10) as r3:
                payload = _json.loads(r3.read())
            for e in (payload.get("values") or []):
                if e.get("is_primary") and e.get("is_confirmed") and e.get("email"):
                    email = e["email"].lower(); break
            # Fall back to first confirmed if no primary marked
            if not email:
                for e in (payload.get("values") or []):
                    if e.get("is_confirmed") and e.get("email"):
                        email = e["email"].lower(); break
        except Exception:
            pass

    # ── 4. Find or create user ───────────────────────────────────────────
    org_id = (db_one("SELECT org_id FROM crm_projects WHERE id=%s", (project_id,)) or {}).get("org_id")
    scope_sql, scope_val = ("org_id=%s", org_id) if _org_shares_customers(org_id) else ("project_id=%s", project_id)
    with db_cursor() as (conn, cursor):
        # 4a. Try by (provider, oauth_provider_id)
        cursor.execute(
            f"SELECT id FROM users WHERE oauth_provider=%s AND oauth_provider_id=%s AND {scope_sql}",
            (provider, oid, scope_val),
        )
        user = cursor.fetchone()
        # 4b. Try linking by email if user already registered
        if not user and email:
            cursor.execute(
                f"SELECT id FROM users WHERE email=%s AND {scope_sql} "
                "AND oauth_provider IS NULL AND google_id IS NULL",
                (email, scope_val),
            )
            user = cursor.fetchone()
            if user:
                cursor.execute(
                    "UPDATE users SET oauth_provider=%s, oauth_provider_id=%s WHERE id=%s",
                    (provider, oid, user["id"]),
                )
                conn.commit()
        # 4c. Create new user
        is_new_user = False
        if not user:
            _enforce_storefront_users(org_id)
            # Email may be missing (X doesn't return it without elevated access) — generate a stable placeholder
            email_to_use = email or f"{provider}_{oid}@oauth.local"
            try:
                cursor.execute(
                    "INSERT INTO users (name, email, password_hash, project_id, org_id, "
                    "oauth_provider, oauth_provider_id) "
                    "VALUES (%s,%s,'',%s,%s,%s,%s) RETURNING id",
                    (sanitize(name), email_to_use, project_id, org_id, provider, oid),
                )
                user_id = cursor.fetchone()["id"]
                conn.commit()
                is_new_user = True
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                # Race: user got created between our SELECT and INSERT — re-fetch
                cursor.execute(
                    f"SELECT id FROM users WHERE oauth_provider=%s AND oauth_provider_id=%s AND {scope_sql}",
                    (provider, oid, scope_val),
                )
                row = cursor.fetchone()
                if not row:
                    raise
                user_id = row["id"]
        else:
            user_id = user["id"]

    if is_new_user:
        import threading
        threading.Thread(
            target=dispatch_event, daemon=True,
            args=(project_id, "customer.created",
                  {"user_id": user_id,
                   "customer": {"name": sanitize(name), "email": email or ""}}),
        ).start()

    token   = create_token(user_id)
    refresh = issue_refresh_token(user_id, project_id, request, label=f"{provider} login")
    redirect = RedirectResponse(f"{frontend}", status_code=302)
    # OAuth final cookies — same SameSite policy as the session helpers so
    # the storefront on a cross-origin domain keeps the user logged in after
    # the provider redirect roundtrip.
    redirect.set_cookie(key="authx_token", value=token, httponly=True,
                        max_age=ACCESS_TOKEN_MINUTES * 60, samesite=_SESSION_SAMESITE,
                        secure=COOKIE_SECURE, path="/")
    redirect.set_cookie(key="authx_refresh", value=refresh, httponly=True,
                        max_age=REFRESH_TOKEN_DAYS * 86400, samesite=_SESSION_SAMESITE,
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
    return "".join(str(secrets.randbelow(10)) for _ in range(length))


def _parse_test_numbers(s: str) -> dict:
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

    # ── AliCloud SMS (中国 — Twilio blocked by GFW) ────────────────────
    # Aliyun Pop API signing — HMAC-SHA1 over canonicalised query string.
    # Reference: https://help.aliyun.com/document_detail/56189.html
    if provider == "alicloud_sms":
        akey   = settings.get("alicloud_access_key_id")
        secret = settings.get("alicloud_access_key_secret")
        sign   = settings.get("alicloud_sign_name")
        tmpl   = settings.get("alicloud_template_code")
        if not (akey and secret and sign and tmpl):
            return False, "AliCloud credentials incomplete (need AccessKey + Sign + Template)"
        import hmac, hashlib
        # OTP body for Aliyun templates uses TemplateParam JSON e.g. {"code":"123456"}
        # We try to extract last whitespace-separated token as the code (works for
        # both `Your code is 123456` and `123456`); merchant's template should be
        # designed accordingly.
        code = (message or "").strip().split()[-1] if message else ""
        params = {
            "SignatureMethod":   "HMAC-SHA1",
            "SignatureNonce":    secrets.token_hex(16),
            "AccessKeyId":       akey,
            "SignatureVersion":  "1.0",
            "Timestamp":         _utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "Format":            "JSON",
            "Action":            "SendSms",
            "Version":           "2017-05-25",
            "RegionId":          "cn-hangzhou",
            "PhoneNumbers":      phone.lstrip("+"),
            "SignName":          sign,
            "TemplateCode":      tmpl,
            "TemplateParam":     _json.dumps({"code": code}, separators=(",", ":")),
        }
        # Canonical sort + percent-encode (Aliyun-specific: spaces → %20, not +)
        def _aly_q(s): return urllib.parse.quote(str(s), safe="")
        sorted_q = "&".join(f"{_aly_q(k)}={_aly_q(v)}" for k, v in sorted(params.items()))
        string_to_sign = f"GET&%2F&{_aly_q(sorted_q)}"
        sig = base64.b64encode(
            hmac.new((secret + "&").encode(), string_to_sign.encode(), hashlib.sha1).digest()
        ).decode()
        params["Signature"] = sig
        url = "https://dysmsapi.aliyuncs.com/?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                resp = _json.loads(r.read())
            if resp.get("Code") == "OK":
                return True, ""
            return False, f"AliCloud SMS: {resp.get('Message') or resp.get('Code')}"
        except urllib.error.HTTPError as e:
            return False, f"AliCloud SMS error: {e.read().decode(errors='replace')[:200]}"
        except Exception as e:
            return False, f"AliCloud SMS error: {e}"

    # ── MSG91 (India — DLT/TRAI compliance) ────────────────────────────
    # MSG91 v5 Flow API — template_id must be pre-approved on DLT (handled
    # by MSG91 onboarding). For OTPs MSG91 has a dedicated OTP endpoint we
    # prefer (better delivery + retry semantics).
    if provider == "msg91":
        key  = settings.get("msg91_auth_key")
        tmpl = settings.get("msg91_template_id")
        sender = settings.get("msg91_sender_id") or ""
        if not (key and tmpl):
            return False, "MSG91 credentials incomplete (need auth_key + template_id)"
        code = (message or "").strip().split()[-1] if message else ""
        url = "https://control.msg91.com/api/v5/otp"
        params = {
            "template_id": tmpl,
            "mobile":      phone.lstrip("+"),
            "otp":         code,
        }
        if sender: params["sender"] = sender
        url_with_qs = url + "?" + urllib.parse.urlencode(params)
        try:
            req = urllib.request.Request(url_with_qs, method="POST",
                headers={"authkey": key, "Content-Type": "application/JSON"})
            with urllib.request.urlopen(req, timeout=15) as r:
                resp = _json.loads(r.read())
            if resp.get("type") == "success":
                return True, ""
            return False, f"MSG91: {resp.get('message') or resp}"
        except urllib.error.HTTPError as e:
            return False, f"MSG91 error: {e.read().decode(errors='replace')[:200]}"
        except Exception as e:
            return False, f"MSG91 error: {e}"

    # ── Zenvia (Brasil — 3-5x cheaper than Twilio for BR routes) ───────
    if provider == "zenvia":
        token = settings.get("zenvia_api_token")
        from_n = settings.get("zenvia_from")
        if not (token and from_n):
            return False, "Zenvia credentials incomplete (need api_token + from)"
        url = "https://api.zenvia.com/v2/channels/sms/messages"
        body = _json.dumps({
            "from": from_n,
            "to":   phone.lstrip("+"),
            "contents": [{"type": "text", "text": message}],
        }).encode()
        try:
            req = urllib.request.Request(url, data=body, method="POST", headers={
                "X-API-Token": token,
                "Content-Type": "application/json",
            })
            with urllib.request.urlopen(req, timeout=15) as r:
                _ = r.read()
            return True, ""
        except urllib.error.HTTPError as e:
            return False, f"Zenvia error: {e.read().decode(errors='replace')[:200]}"
        except Exception as e:
            return False, f"Zenvia error: {e}"

    # ── Eskiz (Узбекистан — Twilio не доставляет SMS в UZ reliably) ───
    # Eskiz uses email/password to get a JWT, then Bearer-auths SMS calls.
    # We login on every send for simplicity (no token cache yet — Eskiz
    # tokens last 30 days so a cache is the obvious next-step optimisation).
    if provider == "eskiz":
        email  = settings.get("eskiz_email")
        passwd = settings.get("eskiz_password")
        from_n = settings.get("eskiz_from") or "4546"  # 4546 is Eskiz's default test sender
        if not (email and passwd):
            return False, "Eskiz credentials incomplete (need email + password)"
        # Step 1: login
        login_url = "https://notify.eskiz.uz/api/auth/login"
        try:
            login_req = urllib.request.Request(login_url, method="POST",
                data=urllib.parse.urlencode({"email": email, "password": passwd}).encode(),
                headers={"Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(login_req, timeout=15) as r:
                token = (_json.loads(r.read()).get("data") or {}).get("token")
            if not token:
                return False, "Eskiz: login returned no token"
        except Exception as e:
            return False, f"Eskiz login error: {e}"
        # Step 2: send SMS
        send_url = "https://notify.eskiz.uz/api/message/sms/send"
        try:
            send_req = urllib.request.Request(send_url, method="POST",
                data=urllib.parse.urlencode({
                    "mobile_phone": phone.lstrip("+"),
                    "message":      message,
                    "from":         from_n,
                }).encode(),
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type":  "application/x-www-form-urlencoded",
                })
            with urllib.request.urlopen(send_req, timeout=15) as r:
                resp = _json.loads(r.read())
            if str(resp.get("status", "")).lower() == "waiting" or resp.get("id"):
                return True, ""
            return False, f"Eskiz: {resp.get('message') or resp}"
        except urllib.error.HTTPError as e:
            return False, f"Eskiz send error: {e.read().decode(errors='replace')[:200]}"
        except Exception as e:
            return False, f"Eskiz send error: {e}"

    # ── WhatsApp Business Cloud API (Meta — alt to SMS, ~10x cheaper) ──
    # Uses Meta's Cloud API on graph.facebook.com. Template must be pre-
    # approved in Meta Business Manager (category=AUTHENTICATION for OTPs).
    # Merchant supplies the approved template_name; we send the OTP code as
    # the body parameter (Meta's "authentication" template variant).
    if provider == "whatsapp_cloud":
        pnid  = settings.get("whatsapp_phone_number_id")
        token = settings.get("whatsapp_access_token")
        tmpl  = settings.get("whatsapp_template_name")
        if not (pnid and token and tmpl):
            return False, "WhatsApp Cloud credentials incomplete (need phone_number_id + token + template_name)"
        code = (message or "").strip().split()[-1] if message else ""
        url = f"https://graph.facebook.com/v18.0/{pnid}/messages"
        body = _json.dumps({
            "messaging_product": "whatsapp",
            "to":   phone.lstrip("+"),
            "type": "template",
            "template": {
                "name":     tmpl,
                "language": {"code": "en"},  # merchant overrides via template approved lang
                "components": [{
                    "type": "body",
                    "parameters": [{"type": "text", "text": code}],
                }],
            },
        }).encode()
        try:
            req = urllib.request.Request(url, data=body, method="POST", headers={
                "Authorization": f"Bearer {token}",
                "Content-Type":  "application/json",
            })
            with urllib.request.urlopen(req, timeout=15) as r:
                resp = _json.loads(r.read())
            if resp.get("messages"):
                return True, ""
            return False, f"WhatsApp Cloud: {resp}"
        except urllib.error.HTTPError as e:
            return False, f"WhatsApp Cloud error: {e.read().decode(errors='replace')[:200]}"
        except Exception as e:
            return False, f"WhatsApp Cloud error: {e}"

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
    org_id = api_key_record.get("org_id")
    scope_sql, scope_val = ("org_id=%s", org_id) if _org_shares_customers(org_id) else ("project_id=%s", project_id)
    is_new_user = False
    with db_cursor() as (conn, cur):
        cur.execute(
            f"SELECT id FROM users WHERE phone=%s AND {scope_sql} ORDER BY id LIMIT 1",
            (phone, scope_val),
        )
        user = cur.fetchone()
        if user:
            cur.execute("UPDATE users SET phone_verified=TRUE WHERE id=%s", (user["id"],))
            user_id = user["id"]
        else:
            _enforce_storefront_users(org_id)
            try:
                cur.execute(
                    "INSERT INTO users (name, email, password_hash, project_id, org_id, phone, phone_verified) "
                    "VALUES (%s, %s, '', %s, %s, %s, TRUE) RETURNING id",
                    (sanitize(name), f"phone_{phone}@phone.local", project_id, org_id, phone),
                )
                user_id = cur.fetchone()["id"]
                is_new_user = True
            except psycopg2.errors.UniqueViolation:
                # Concurrent INSERT won the race — find the existing row
                conn.rollback()
                cur.execute(
                    f"SELECT id FROM users WHERE phone=%s AND {scope_sql} ORDER BY id LIMIT 1",
                    (phone, scope_val),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(500, "Authentication failed")
                user_id = row["id"]
        conn.commit()

    if is_new_user:
        import threading
        threading.Thread(
            target=dispatch_event, daemon=True,
            args=(project_id, "customer.created",
                  {"user_id": user_id, "phone": phone,
                   "customer": {"name": sanitize(name), "phone": phone}}),
        ).start()

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
    # service_id is now optional — freeform bookings can be created by 3rd party tools
    # (handymen, custom services, one-offs) without first registering the service.
    service_id:     Optional[int] = None
    staff_id:       Optional[int] = None
    starts_at:      str
    # Accept None from older storefront builds (legacy code used `field || null` patterns)
    # by typing as Optional[str] and coercing None → "" in a `mode='before'` validator.
    # Keeps the backend contract permissive — old SDK versions / 3rd-party storefronts
    # keep working without an upgrade.
    customer_name:  Optional[str] = ""
    customer_phone: Optional[str] = ""
    customer_email: Optional[str] = ""
    customer_address: Optional[str] = ""
    notes:          Optional[str] = ""
    # Freeform fields: used when service_id is None. Caller specifies the
    # service name, duration and (optionally) price in the request itself.
    freeform_service_name:     Optional[str] = ""
    freeform_duration_minutes: Optional[int] = None
    freeform_price:            Optional[float] = None

    @_model_validator(mode="before")
    @classmethod
    def _coerce_none_to_empty(cls, data):
        if isinstance(data, dict):
            for k in ("customer_name", "customer_phone", "customer_email",
                      "customer_address", "notes", "freeform_service_name"):
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

    # Two modes: service-based (caller provides service_id) or freeform
    # (caller provides freeform_service_name + freeform_duration_minutes).
    svc           = None
    duration_min  = None
    loc_type      = 'shop'
    freeform_name = ''
    freeform_dur  = None
    freeform_pr   = None
    if req.service_id is not None:
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
        duration_min = int(svc["duration_minutes"])
        loc_type     = (svc.get("location_type") or 'shop')
    else:
        # Freeform booking — caller must supply name + duration.
        if not (req.freeform_service_name or "").strip():
            raise HTTPException(400, "Either service_id or freeform_service_name is required")
        if not req.freeform_duration_minutes or int(req.freeform_duration_minutes) <= 0:
            raise HTTPException(400, "freeform_duration_minutes is required for freeform bookings")
        if int(req.freeform_duration_minutes) < 5 or int(req.freeform_duration_minutes) > 1440:
            raise HTTPException(400, "freeform_duration_minutes must be between 5 and 1440")
        if req.staff_id:
            st = db_one("SELECT id FROM booking_staff WHERE id=%s AND project_id=%s AND is_active=TRUE",
                        (req.staff_id, project_id))
            if not st: raise HTTPException(404, "Staff not found")
        duration_min  = int(req.freeform_duration_minutes)
        freeform_name = sanitize(req.freeform_service_name)[:200]
        freeform_dur  = duration_min
        if req.freeform_price is not None:
            try:
                freeform_pr = float(req.freeform_price)
                if freeform_pr < 0: freeform_pr = 0.0
            except Exception:
                freeform_pr = None

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
    ends = starts + timedelta(minutes=duration_min)

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
    name    = sanitize(req.customer_name or "")[:200]
    phone   = sanitize(req.customer_phone or "")[:64]
    email   = sanitize(req.customer_email or "")[:200]
    address = sanitize(req.customer_address or "")[:500]
    if user_id:
        u = db_one("SELECT name, email, phone FROM users WHERE id=%s AND project_id=%s",
                   (user_id, project_id))
        if u:
            if not name  and u["name"]:  name  = u["name"]
            if not email and u["email"]: email = u["email"]
            if not phone and u.get("phone"): phone = u["phone"]

    if not name: raise HTTPException(400, "Name is required")

    # If service is location_type='customer' the address is mandatory.
    if loc_type == 'customer' and not address:
        raise HTTPException(400, "This service is delivered at the customer's location — customer_address is required")

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
        elif svc is not None:
            cur.execute(
                """SELECT COUNT(*) AS n FROM bookings
                   WHERE project_id=%s AND service_id=%s AND status = ANY(%s)
                     AND NOT (ends_at <= %s OR starts_at >= %s)""",
                (project_id, req.service_id, list(blocking_states), starts, ends)
            )
            if cur.fetchone()["n"] >= int(svc["capacity"]):
                conn.rollback()
                raise HTTPException(409, "This time slot is no longer available")
        # Freeform without staff: no capacity check (no service row to read capacity from)

        cur.execute(
            """INSERT INTO bookings
                  (project_id, service_id, staff_id, user_id, starts_at, ends_at,
                   status, customer_name, customer_phone, customer_email,
                   customer_address, notes,
                   freeform_service_name, freeform_duration_minutes, freeform_price)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (project_id, req.service_id, req.staff_id, user_id, starts, ends,
             initial_status, name, phone, email, address,
             sanitize(req.notes or "")[:2000],
             freeform_name, freeform_dur, freeform_pr)
        )
        bid = cur.fetchone()["id"]
        conn.commit()

    # Outbound webhooks: always fire booking.created; if auto_confirm is on,
    # also fire booking.confirmed in the same dispatch cycle.
    event_data = {
        "booking_id":   bid, "service_id":  req.service_id,
        "service_name": (svc["name"] if svc else freeform_name) or None,
        "staff_id":     req.staff_id, "starts_at": starts.isoformat(),
        "ends_at":      ends.isoformat(), "status":   initial_status,
        "amount":       float(svc.get("price") or 0) if svc else (freeform_pr or 0.0),
        "currency":     "USD",
        "customer":     {"name": name, "email": email, "phone": phone, "address": address},
    }
    background_tasks.add_task(dispatch_event, project_id, "booking.created", event_data)
    if initial_status == "confirmed":
        background_tasks.add_task(dispatch_event, project_id, "booking.confirmed", event_data)

    # Bell push — booking flow has no payment_status yet, so we always
    # surface it. Link jumps to the Bookings calendar tab focused on the
    # new booking. Includes service name + customer + start time for quick
    # triage without opening the modal.
    try:
        proj = db_one("SELECT api_key FROM crm_projects WHERE id=%s", (project_id,))
        api_key = (proj or {}).get("api_key")
        svc_name = (svc or {}).get("name") if svc else (freeform_name or "Service")
        starts_local = starts.strftime("%H:%M · %b %d")
        background_tasks.add_task(
            push_crm_notification_project,
            project_id, "new_booking",
            f"New booking — {svc_name}",
            f"{name} · {starts_local}",
            # Route is /booking (singular) — /bookings 404s and the page never renders.
            f"/project/{api_key}/booking" if api_key else None,
        )
    except Exception as e:
        print(f"[notif] booking push failed: {e}")

    return {"id": bid, "status": initial_status,
            "starts_at": starts.isoformat(), "ends_at": ends.isoformat()}

@app.get("/{api_key}/booking/bookings/my")
def public_list_my_bookings(request: Request,
                            api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    user_id    = get_current_user_id(request)
    # LEFT JOIN booking_services because b.service_id can be NULL (freeform bookings).
    rows = db_all(
        """SELECT b.*, s.name AS svc_name, s.duration_minutes AS svc_duration,
                  s.price AS svc_price,
                  st.name AS staff_name, st.avatar_url AS staff_avatar
           FROM bookings b
           LEFT JOIN booking_services s ON s.id = b.service_id
           LEFT JOIN booking_staff st ON st.id = b.staff_id
           WHERE b.project_id=%s AND b.user_id=%s
           ORDER BY b.starts_at DESC""",
        (project_id, user_id)
    )
    out = []
    for r in rows:
        svc_name  = r["svc_name"] if r["service_id"] else (r.get("freeform_service_name") or None)
        svc_dur   = r["svc_duration"] if r["service_id"] else r.get("freeform_duration_minutes")
        svc_price = (float(r["svc_price"]) if r["service_id"] and r["svc_price"] is not None
                     else (float(r["freeform_price"]) if r.get("freeform_price") is not None else 0.0))
        out.append({
            "id": r["id"], "service_id": r["service_id"], "staff_id": r["staff_id"],
            "service_name": svc_name, "staff_name": r["staff_name"],
            "staff_avatar": r["staff_avatar"],
            "service_price": svc_price,
            "duration_minutes": svc_dur,
            "starts_at": r["starts_at"].isoformat() if r["starts_at"] else None,
            "ends_at":   r["ends_at"].isoformat()   if r["ends_at"]   else None,
            "status": r["status"], "notes": r["notes"],
            "customer_address": r.get("customer_address") or "",
        })
    return out

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

@app.post("/internal/booking/process-reminders")
def internal_process_booking_reminders(request: Request):
    if request.headers.get("X-Internal-Key") != INTERNAL_API_KEY:
        raise HTTPException(401, "Unauthorized")
    now_utc = _utcnow()
    lo = now_utc + timedelta(minutes=50)
    hi = now_utc + timedelta(minutes=70)
    rows = db_all(
        """SELECT b.id, b.project_id, b.service_id, b.staff_id, b.customer_email, b.customer_name,
                  b.starts_at, b.notes,
                  s.name AS service_name, s.duration_minutes,
                  b.freeform_service_name, b.freeform_duration_minutes,
                  st.name AS staff_name
           FROM bookings b
           LEFT JOIN booking_services s ON s.id = b.service_id
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
        svc_name = r["service_name"] or r.get("freeform_service_name") or "Appointment"
        local = starts.astimezone(biz_tz)
        try:    when = local.strftime("%A, %B %d at %H:%M")
        except Exception: when = local.isoformat()
        ok = _send_template_email(
            r["project_id"], "booking_reminder", r["customer_email"],
            {"customer_name": r.get("customer_name") or "", "service_name": svc_name,
             "staff_name": r.get("staff_name") or "", "when": when,
             "store_name": _project_store_name(r["project_id"])},
            from_name=from_name, from_email=from_email,
        )
        if ok:
            with db_cursor() as (conn, cur):
                cur.execute("UPDATE bookings SET reminder_sent_at=NOW() WHERE id=%s", (r["id"],))
                conn.commit()
            sent += 1
        else:
            failed += 1
    return {"sent": sent, "failed": failed, "candidates": len(rows)}


# ── ABANDONED CART REMINDERS ─────────────────────────────

@app.post("/internal/cart/process-abandoned")
def internal_process_abandoned_carts(request: Request):
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
        from_name, from_email = get_project_email(row["project_id"])
        frontend_url = get_project_frontend_url(row["project_id"]) or ""
        cart_url = f"{frontend_url.rstrip('/')}/cart" if frontend_url else ""
        ok = _send_template_email(
            row["project_id"], "abandoned_cart", row["email"],
            {"customer_name": row.get("name") or "", "cart_url": cart_url,
             "store_name": _project_store_name(row["project_id"])},
            from_name=from_name, from_email=from_email,
        )
        if ok:
            with db_cursor() as (conn, cur):
                cur.execute("UPDATE carts SET abandoned_email_sent_at = NOW() WHERE id = %s",
                            (row["cart_id"],))
                conn.commit()
            sent += 1
        else:
            failed += 1
    return {"sent": sent, "failed": failed, "candidates": len(candidates)}


# ── UNSUBSCRIBE (broadcast opt-out) ──────────────────────

@app.get("/{api_key}/unsubscribe")
def unsubscribe(api_key: str, u: int = Query(...), token: str = Query(...)):
    """Public opt-out link from broadcast footers — no publishable key (clicked from an email client)."""
    proj = db_one("SELECT id FROM crm_projects WHERE api_key=%s", (api_key,))
    done = False
    if proj:
        row = db_one("SELECT unsubscribe_token FROM users WHERE id=%s AND project_id=%s", (u, proj["id"]))
        if row and row.get("unsubscribe_token") and token and row["unsubscribe_token"] == token:
            with db_cursor() as (conn, cur):
                cur.execute("UPDATE users SET email_opt_out=TRUE WHERE id=%s AND project_id=%s", (u, proj["id"]))
                conn.commit()
            done = True
    title = "Unsubscribed" if done else "Link error"
    msg = ("You've been unsubscribed from marketing emails. You'll still receive important account and order emails."
           if done else "This unsubscribe link is invalid or has expired.")
    html = ("<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'></head>"
            "<body style='font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#f4f4f5;margin:0'>"
            "<div style='max-width:480px;margin:80px auto;background:#fff;border-radius:16px;padding:40px;text-align:center'>"
            f"<h2 style='color:#1d1d1f;margin:0 0 12px'>{title}</h2>"
            f"<p style='color:#555;line-height:1.5;margin:0'>{msg}</p></div></body></html>")
    return Response(content=html, media_type="text/html")


# ── LOW STOCK ALERTS ─────────────────────────────────────

@app.post("/internal/stock/check-low-stock")
def internal_check_low_stock(request: Request):
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
    # Batch the last-alert lookup: one grouped query keyed by sku_id instead of
    # one SELECT per candidate SKU.
    _sku_ids = [r["sku_id"] for r in rows]
    _last_alert_by_sku = {}
    if _sku_ids:
        for _a in db_all(
            "SELECT sku_id, MAX(alerted_at) AS alerted_at FROM crm_low_stock_alerts"
            " WHERE sku_id = ANY(%s) GROUP BY sku_id",
            (_sku_ids,)
        ):
            _last_alert_by_sku[_a["sku_id"]] = _a["alerted_at"]
    for r in rows:
        last_alerted = _last_alert_by_sku.get(r["sku_id"])
        if last_alerted and last_alerted > cutoff:
            skipped += 1; continue

        # Bell push to every operator (was: only owner; team members never
        # got it). push_crm_notification_project does INSERT + NOTIFY so
        # bells flash live, not on next reload.
        title = r.get("title") or "Product"
        var   = r.get("variation_name") or ""
        cfg   = r.get("configuration_name") or ""
        msg   = f'{title}{" — " + var if var else ""}{" / " + cfg if cfg else ""}: {r["stock_quantity"]} left (threshold {r["low_stock_threshold"]})'
        push_crm_notification_project(
            r["project_id"], "low_stock",
            "Low stock alert", msg[:1000],
            f'/product/{r["product_id"]}',
        )
        with db_cursor() as (conn, cur):
            cur.execute(
                "INSERT INTO crm_low_stock_alerts (project_id, sku_id, stock_at_alert, threshold)"
                " VALUES (%s, %s, %s, %s)",
                (r["project_id"], r["sku_id"], r["stock_quantity"], r["low_stock_threshold"])
            )
            conn.commit()
        alerted += 1
    return {"alerted": alerted, "skipped": skipped, "candidates": len(rows)}


# ── BOOKING PAYMENT (Stripe stub) ────────────────────────

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
    # Use the order's snapshotted payment_currency — historical orders
    # render in the currency they were placed in, even if the merchant
    # has since changed the project's house currency. Falls back to
    # the project's current currency for rows that pre-date the column.
    invoice_currency = (
        order.get("payment_currency")
        or api_key_record.get("currency")
        or "USD"
    )
    data = {
        "number":   order_id,
        "issued_at": order["created_at"].strftime("%Y-%m-%d") if order.get("created_at") else "",
        "currency": invoice_currency,
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
           FROM bookings b LEFT JOIN booking_services s ON s.id=b.service_id
           WHERE b.id=%s AND b.project_id=%s AND b.user_id=%s""",
        (bid, project_id, user_id)
    )
    if not row: raise HTTPException(404, "Booking not found")
    branding = _get_branding(project_id)
    branding["style"] = style or branding.get("style") or "modern"
    starts = row["starts_at"]
    when = starts.strftime("%Y-%m-%d %H:%M") if starts else ""
    # Fallbacks for freeform bookings (service_id is NULL).
    svc_title    = row["service_name"] or row.get("freeform_service_name") or "Appointment"
    svc_duration = row["duration_minutes"] or row.get("freeform_duration_minutes") or 0
    svc_price    = (float(row["service_price"]) if row.get("service_price") is not None
                    else (float(row["freeform_price"]) if row.get("freeform_price") is not None else 0.0))
    # Booking act uses the project's current currency — bookings
    # don't have a per-row currency snapshot the way orders do, so
    # we trust the merchant's current setting. (If they switch
    # currencies mid-week, acts issued afterward will reflect the new
    # symbol — same trade-off as Stripe's invoice rendering.)
    data = {
        "number": bid,
        "performed_at": when,
        "currency": api_key_record.get("currency") or "USD",
        "customer": {"name": row.get("customer_name", "")},
        "items": [{"title": svc_title,
                   "variation": f"{svc_duration} min",
                   "qty": 1, "price": svc_price}],
        "subtotal": svc_price,
        "total":    svc_price,
    }
    pdf = render_document("act", branding["style"], branding, data)
    return _pdf_response(pdf, f"act-{bid}.pdf")


@app.get("/{api_key}/orders/{order_id}/receipt.pdf")
def order_receipt_pdf(order_id: int, request: Request,
                      style: Optional[str] = Query(None),
                      api_key_record: dict = Depends(resolve_api_key)):
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
    # Honor the same bundling rule as the order-confirmation email: one ZIP link per
    # product when digital_zip is on, else a link per file. Label with the product
    # title (falls back to the file key / "ZIP archive").
    downloads = [{"label": d["title"] or d["label"], "url": d["url"]}
                 for d in _digital_downloads(project_id, items)]

    branding = _get_branding(project_id)
    branding["style"] = style or branding.get("style") or "modern"
    # Receipt mirrors invoice: snapshot wins over current project setting.
    receipt_currency = (
        order.get("payment_currency")
        or api_key_record.get("currency")
        or "USD"
    )
    data = {
        "number": order_id,
        "paid_at": order["created_at"].strftime("%Y-%m-%d") if order.get("created_at") else "",
        "currency": receipt_currency,
        "items": [{"title": i["title"], "variation": i.get("variation_name"),
                   "qty": i["quantity"], "price": float(i["price"])} for i in items],
        "subtotal": sum(float(i["price"]) * i["quantity"] for i in items),
        "total":    float(order.get("total_amount") or 0),
        "downloads": downloads,
    }
    pdf = render_document("receipt", branding["style"], branding, data)
    return _pdf_response(pdf, f"receipt-{order_id}.pdf")