from fastapi import FastAPI, Response, HTTPException, Request, Depends, UploadFile, File, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
from contextlib import contextmanager
import asyncio
import sys, os
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor
import hashlib, secrets, jwt, random, io, json, re, time
import urllib.request, urllib.error, urllib.parse
import hmac
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)

try:
    from PIL import Image as PilImage
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
    S3_AVAILABLE = True
except ImportError:
    S3_AVAILABLE = False



# ════════════════════════════════════════════
# КОНФИГ
# ════════════════════════════════════════════

SECRET_KEY       = os.getenv("SECRET_KEY", "")
ALGORITHM        = "HS256"
JWT_HOURS        = 24 * 7
CRM_FRONTEND_URL = os.getenv("CRM_FRONTEND_URL", "http://localhost:5174")
CRM_BACKEND_URL  = os.getenv("CRM_BACKEND_URL",  "http://localhost:8001")
MAGAZ_BACKEND_URL= os.getenv("MAGAZ_BACKEND_URL", "http://localhost:8000")
# Shared secret for service-to-service calls (External API → CRM web-chat inbound)
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "torta-internal-dev-key")
DB_CONFIG        = {
    "host":     os.getenv("DB_HOST",     "localhost"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "user":     os.getenv("DB_USER",     "postgres"),
    "password": os.getenv("DB_PASSWORD", ""),
    "dbname":   os.getenv("DB_NAME",     "crmdb"),
}

SES_API_URL      = os.getenv("SES_API_URL",      "https://ses.tortacrm.com")
SES_INTERNAL_KEY = os.getenv("SES_INTERNAL_KEY", "")
EMAIL_FROM       = os.getenv("EMAIL_FROM",       "support@tortacrm.com")
MAX_FAILED_ATTEMPTS     = 5
BLOCK_MINUTES           = 10
CODE_TTL_MINUTES        = 10
RESEND_COOLDOWN_SECONDS = 60
RESET_TTL_MINUTES       = 30
UPLOADS_DIR             = "uploads"
GOOGLE_CLIENT_ID        = os.getenv("GOOGLE_CLIENT_ID",     "")
GOOGLE_CLIENT_SECRET    = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI     = os.getenv("GOOGLE_REDIRECT_URI",  "http://localhost:8001/api/auth/google/callback")

# ── AWS S3 ──────────────────────────────────────────────────────
AWS_ACCESS_KEY_ID     = os.getenv("AWS_ACCESS_KEY_ID",     "")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")
AWS_S3_BUCKET         = os.getenv("AWS_S3_BUCKET",         "torta-crm")
AWS_S3_REGION         = os.getenv("AWS_S3_REGION",         "eu-central-1")
AWS_CLOUDFRONT_URL    = os.getenv("AWS_CLOUDFRONT_URL",    "")

os.makedirs(UPLOADS_DIR, exist_ok=True)

def _s3_client():
    return boto3.client(
        "s3",
        region_name=AWS_S3_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    )

def s3_upload(data: io.BytesIO, key: str, content_type: str = "image/webp",
              cache_control: str = "max-age=31536000") -> str:
    s3 = _s3_client()
    s3.upload_fileobj(data, AWS_S3_BUCKET, key,
                      ExtraArgs={"ContentType": content_type, "CacheControl": cache_control})
    if AWS_CLOUDFRONT_URL:
        return f"{AWS_CLOUDFRONT_URL.rstrip('/')}/{key}"
    return f"https://{AWS_S3_BUCKET}.s3.{AWS_S3_REGION}.amazonaws.com/{key}"

def s3_delete(key: str) -> None:
    try:
        _s3_client().delete_object(Bucket=AWS_S3_BUCKET, Key=key)
    except Exception:
        pass

def s3_key_from_url(url: str) -> str | None:
    if not url:
        return None
    try:
        from urllib.parse import urlparse
        path = urlparse(url.split("?")[0]).path.lstrip("/")
        return path or None
    except Exception:
        return None

def s3_delete_url(url: str, prefix: str) -> None:
    key = s3_key_from_url(url)
    if key and key.startswith(prefix):
        s3_delete(key)

app = FastAPI()

# ════════════════════════════════════════════
# STARTUP MIGRATIONS
# ════════════════════════════════════════════

@app.on_event("startup")
def run_migrations():
    """Migrate legacy name-based org slugs to random 20-char hex slugs."""
    import re as _re
    hex20 = _re.compile(r'^[0-9a-f]{20}$')
    try:
        with db_cursor() as (conn, cur):
            cur.execute("SELECT id, slug FROM crm_organizations")
            rows = cur.fetchall()
            for row in rows:
                if not hex20.match(row["slug"]):
                    # Generate a unique new slug
                    new_slug = secrets.token_hex(10)
                    while True:
                        cur.execute("SELECT id FROM crm_organizations WHERE slug = %s AND id != %s", (new_slug, row["id"]))
                        if not cur.fetchone():
                            break
                        new_slug = secrets.token_hex(10)
                    cur.execute("UPDATE crm_organizations SET slug = %s WHERE id = %s", (new_slug, row["id"]))
            conn.commit()
    except Exception as e:
        print(f"[migration] org slug migration failed: {e}")

    # Add sender_avatar column to crm_email_domains if not exists
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE crm_email_domains ADD COLUMN IF NOT EXISTS sender_avatar VARCHAR(1000) DEFAULT NULL")
            conn.commit()
    except Exception as e:
        print(f"[migration] sender_avatar column migration failed: {e}")

    # Chat with Customers tables
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_chat_integrations (
                    id           SERIAL PRIMARY KEY,
                    project_id   INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    channel      VARCHAR(32) NOT NULL,
                    config       JSONB NOT NULL DEFAULT '{}'::jsonb,
                    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
                    bot_username VARCHAR(255) DEFAULT NULL,
                    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(project_id, channel)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_chat_conversations (
                    id               SERIAL PRIMARY KEY,
                    project_id       INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    channel          VARCHAR(32) NOT NULL,
                    external_chat_id VARCHAR(128) NOT NULL,
                    contact_uid      VARCHAR(32) NOT NULL,
                    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
                    unread_count     INTEGER NOT NULL DEFAULT 0,
                    last_message_at  TIMESTAMP DEFAULT NULL,
                    last_message_preview TEXT DEFAULT '',
                    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(project_id, channel, external_chat_id)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_chat_messages (
                    id               SERIAL PRIMARY KEY,
                    conversation_id  INTEGER NOT NULL REFERENCES crm_chat_conversations(id) ON DELETE CASCADE,
                    direction        VARCHAR(8) NOT NULL,
                    text             TEXT NOT NULL DEFAULT '',
                    sender_user_id   INTEGER DEFAULT NULL REFERENCES crm_users(id) ON DELETE SET NULL,
                    external_msg_id  VARCHAR(128) DEFAULT NULL,
                    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_chat_conv_project ON crm_chat_conversations(project_id, is_active, last_message_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON crm_chat_messages(conversation_id, created_at)")
            conn.commit()
    except Exception as e:
        print(f"[migration] chat tables migration failed: {e}")

    # Generic OAuth providers table (GitHub, Discord, Facebook, GitLab, etc.)
    # Google stays in crm_oauth_settings (legacy + uses ID token verification differently).
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_auth_providers (
                    id            SERIAL PRIMARY KEY,
                    project_id    INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    provider      VARCHAR(40) NOT NULL,
                    client_id     TEXT,
                    client_secret TEXT,
                    is_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(project_id, provider)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_auth_prov_project ON crm_auth_providers(project_id)")
            conn.commit()
    except Exception as e:
        print(f"[migration] crm_auth_providers migration failed: {e}")

    # Phone / SMS authentication settings (one row per project).
    # Supports multiple SMS providers (Twilio, MessageBird, Textlocal, Vonage, Twilio Verify).
    # Credentials stored per-provider so switching doesn't lose config.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_sms_settings (
                    id                          SERIAL PRIMARY KEY,
                    project_id                  INTEGER NOT NULL UNIQUE REFERENCES crm_projects(id) ON DELETE CASCADE,
                    is_enabled                  BOOLEAN NOT NULL DEFAULT FALSE,
                    provider                    VARCHAR(40) NOT NULL DEFAULT 'twilio',

                    -- Twilio (SMS API)
                    twilio_account_sid          TEXT,
                    twilio_auth_token           TEXT,
                    twilio_message_service_sid  TEXT,
                    twilio_content_sid          TEXT,
                    -- Twilio Verify (separate API, returns SID per verification)
                    twilio_verify_service_sid   TEXT,

                    -- MessageBird
                    messagebird_access_key      TEXT,
                    messagebird_originator      TEXT,

                    -- Textlocal
                    textlocal_api_key           TEXT,
                    textlocal_sender            TEXT,

                    -- Vonage (formerly Nexmo)
                    vonage_api_key              TEXT,
                    vonage_api_secret           TEXT,
                    vonage_from_number          TEXT,

                    -- AWS SNS
                    aws_access_key_id           TEXT,
                    aws_secret_access_key       TEXT,
                    aws_region                  TEXT,

                    -- Plivo
                    plivo_auth_id               TEXT,
                    plivo_auth_token            TEXT,
                    plivo_from_number           TEXT,

                    -- SMSC.ru (Russia/CIS)
                    smsc_login                  TEXT,
                    smsc_password               TEXT,
                    smsc_sender                 TEXT,

                    -- SMS.ru (Russia)
                    smsru_api_id                TEXT,
                    smsru_from                  TEXT,

                    -- Mobizon.kz (Kazakhstan)
                    mobizon_api_key             TEXT,
                    mobizon_alpha               TEXT,

                    -- Telegram Gateway (free OTP via Telegram)
                    telegram_gateway_token      TEXT,

                    -- OTP behaviour
                    enable_phone_confirmations  BOOLEAN NOT NULL DEFAULT TRUE,
                    otp_expiry_seconds          INTEGER NOT NULL DEFAULT 60,
                    otp_length                  INTEGER NOT NULL DEFAULT 6,
                    message_template            TEXT NOT NULL DEFAULT 'Your code is {{ .Code }}',
                    test_phone_numbers          TEXT NOT NULL DEFAULT '',

                    created_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Idempotent ALTER for existing installations — adds columns introduced
            # after the initial table was created.
            for col in [
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS aws_access_key_id TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS aws_secret_access_key TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS aws_region TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS plivo_auth_id TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS plivo_auth_token TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS plivo_from_number TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS smsc_login TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS smsc_password TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS smsc_sender TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS smsru_api_id TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS smsru_from TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS mobizon_api_key TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS mobizon_alpha TEXT",
                "ALTER TABLE crm_sms_settings ADD COLUMN IF NOT EXISTS telegram_gateway_token TEXT",
            ]:
                try: cur.execute(col)
                except Exception: pass
            conn.commit()
    except Exception as e:
        print(f"[migration] crm_sms_settings migration failed: {e}")

# ════════════════════════════════════════════
# DB POOL
# ════════════════════════════════════════════

_pool = ThreadedConnectionPool(1, 10, **DB_CONFIG)

def get_db():
    return _pool.getconn()

@contextmanager
def db_cursor():
    conn = get_db()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        yield conn, cursor
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        _pool.putconn(conn)

def db_one(sql: str, params: tuple = ()):
    with db_cursor() as (_, cur):
        cur.execute(sql, params)
        return cur.fetchone()

def db_all(sql: str, params: tuple = ()):
    with db_cursor() as (_, cur):
        cur.execute(sql, params)
        return cur.fetchall()

# ════════════════════════════════════════════
# EMAIL
# ════════════════════════════════════════════

def _ses(method: str, path: str, data: dict | None = None) -> dict:
    """Call self-hosted SES API."""
    body = json.dumps(data).encode() if data is not None else None
    req  = urllib.request.Request(
        f"{SES_API_URL}{path}",
        data=body,
        headers={"Content-Type": "application/json", "X-API-Key": SES_INTERNAL_KEY},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read()).get("detail", str(e))
        except Exception:
            detail = str(e)
        raise HTTPException(e.code, detail)
    except Exception as e:
        raise HTTPException(503, f"SES API unavailable: {e}")

def send_email(to: str, subject: str, html: str,
               from_email: str = EMAIL_FROM,
               from_name: str = "Torta CRM") -> bool:
    try:
        _ses("POST", "/send", {
            "to": to, "subject": subject, "html": html,
            "from_email": from_email, "from_name": from_name,
        })
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False

app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


# In-memory хранилища
pending_verifications = {}
login_attempts        = {}
password_reset_tokens = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# ════════════════════════════════════════════
# МОДЕЛИ
# ════════════════════════════════════════════

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

class CreateOrgRequest(BaseModel):
    name: str

class RenameOrgRequest(BaseModel):
    name: str

class CreateProjectRequest(BaseModel):
    name: str
    frontend_url: str

class RenameProjectRequest(BaseModel):
    name: str

class CreateProductRequest(BaseModel):
    title: str
    description: str = None
    characteristics: str = None
    seo_title: str = None
    seo_description: str = None
    seo_keywords: str = None

class UpdateProductRequest(BaseModel):
    title: str = None
    description: str = None
    characteristics: str = None
    seo_title: str = None
    seo_description: str = None
    seo_keywords: str = None

class CreateVariationRequest(BaseModel):
    variation_name: str
    image_url: str = None

class UpdateVariationRequest(BaseModel):
    variation_name: str = None
    image_url: str = None

class CreateSizeRequest(BaseModel):
    size_name: str
    price: float
    stock_quantity: int = 0

class UpdateSizeRequest(BaseModel):
    size_name: str = None
    price: float = None
    stock_quantity: int = None

class UpsertCustomFieldRequest(BaseModel):
    field_key: str
    field_value: str = None
    field_type: str = "string"
    is_global: bool = False

class UpdateSettingsRequest(BaseModel):
    name: str = None
    language: str = None
    currency: str = None
    theme: str = None
    org_view: str = None
    org_sort: str = None

class GoogleAuthRequest(BaseModel):
    token: str

class OAuthSettingsRequest(BaseModel):
    google_client_id: str = ""
    google_client_secret: str = ""
    google_enabled: bool = False

class AuthProviderRequest(BaseModel):
    client_id: str = ""
    client_secret: str = ""
    is_enabled: bool = False

class SmsSettingsRequest(BaseModel):
    is_enabled: bool = False
    provider: str = "twilio"

    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_message_service_sid: str = ""
    twilio_content_sid: str = ""
    twilio_verify_service_sid: str = ""

    messagebird_access_key: str = ""
    messagebird_originator: str = ""

    textlocal_api_key: str = ""
    textlocal_sender: str = ""

    vonage_api_key: str = ""
    vonage_api_secret: str = ""
    vonage_from_number: str = ""

    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = ""

    plivo_auth_id: str = ""
    plivo_auth_token: str = ""
    plivo_from_number: str = ""

    smsc_login: str = ""
    smsc_password: str = ""
    smsc_sender: str = ""

    smsru_api_id: str = ""
    smsru_from: str = ""

    mobizon_api_key: str = ""
    mobizon_alpha: str = ""

    telegram_gateway_token: str = ""

    enable_phone_confirmations: bool = True
    otp_expiry_seconds: int = 60
    otp_length: int = 6
    message_template: str = "Your code is {{ .Code }}"
    test_phone_numbers: str = ""

class UrlConfigRequest(BaseModel):
    frontend_url: str = ""

class AddRedirectUrlRequest(BaseModel):
    url: str

class ChatIntegrationRequest(BaseModel):
    channel: str
    config: dict = {}
    is_active: bool = True

class ChatSendRequest(BaseModel):
    text: str

# ════════════════════════════════════════════
# ХЕЛПЕРЫ
# ════════════════════════════════════════════

def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

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

def get_ip(req: Request) -> str:
    fwd = req.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (req.client.host if req.client else "unknown")

def make_token(user_id: int) -> str:
    return jwt.encode(
        {"sub": str(user_id), "type": "crm", "exp": datetime.utcnow() + timedelta(hours=JWT_HOURS)},
        SECRET_KEY, algorithm=ALGORITHM,
    )

def set_cookie(response: Response, token: str):
    response.set_cookie("crm_token", token, httponly=True,
                        max_age=60*60*24*7, samesite="lax", secure=False, path="/")

def get_current_user(request: Request) -> dict:
    token = request.cookies.get("crm_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "crm":
            raise HTTPException(401, "Invalid token")
        user_id = int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    user = db_one("SELECT id, name, email, role FROM crm_users WHERE id = %s AND is_active = TRUE", (user_id,))
    if not user:
        raise HTTPException(401, "User not found")
    return user

def check_rate_limit(keys: list, now: datetime):
    for key in keys:
        s = login_attempts.get(key)
        if s and s.get("blocked_until") and now < s["blocked_until"]:
            left = int((s["blocked_until"] - now).total_seconds())
            raise HTTPException(429, f"Too many attempts. Retry in {left}s.")

def record_fail(keys: list, now: datetime):
    for key in keys:
        s = login_attempts.get(key, {"count": 0, "blocked_until": None})
        s["count"] += 1
        if s["count"] >= MAX_FAILED_ATTEMPTS:
            s = {"count": 0, "blocked_until": now + timedelta(minutes=BLOCK_MINUTES)}
            login_attempts[key] = s
            left = int((s["blocked_until"] - now).total_seconds())
            raise HTTPException(429, f"Too many attempts. Retry in {left}s.")
        login_attempts[key] = s

def require_owner(user: dict, project_id: int):
    if not db_one("SELECT id FROM crm_projects WHERE id = %s AND crm_user_id = %s",
                  (project_id, user["id"])):
        raise HTTPException(403, "Only project owner can do this")

def require_org_owner(user: dict, org_id: int):
    if not db_one("SELECT id FROM crm_organizations WHERE id = %s AND owner_id = %s",
                  (org_id, user["id"])):
        raise HTTPException(403, "Only organization owner can do this")

def require_team_member_or_owner(user: dict, project_id: int):
    key_row = db_one("SELECT crm_user_id FROM crm_projects WHERE id=%s AND is_active=TRUE", (project_id,))
    if not key_row:
        raise HTTPException(404, "Project not found")
    if key_row["crm_user_id"] == user["id"]:
        return
    if not db_one("SELECT id FROM crm_team_members WHERE project_id=%s AND crm_user_id=%s",
                  (project_id, user["id"])):
        raise HTTPException(403, "Not a member of this project")

def gen_api_key() -> str:
    return secrets.token_hex(10)   # 20 chars, URL-safe

def gen_publishable_key() -> str:
    return "pk_" + secrets.token_hex(24)  # pk_ + 48 chars

def make_slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower().strip()).strip("-")
    return slug or "org"

def _upsert_google_user(g_id: str, email: str, name: str, picture: str) -> int:
    user = db_one("SELECT id FROM crm_users WHERE google_id=%s OR (email=%s AND google_id IS NULL)", (g_id, email))
    if user:
        user_id = user["id"]
        with db_cursor() as (conn, cur):
            cur.execute(
                "UPDATE crm_users SET google_id=%s, avatar_url=%s, last_login_at=NOW() WHERE id=%s",
                (g_id, picture, user_id)
            )
            conn.commit()
    else:
        with db_cursor() as (conn, cur):
            cur.execute(
                "INSERT INTO crm_users (name,email,password,role,google_id,avatar_url) VALUES(%s,%s,'','owner',%s,%s) RETURNING id",
                (sanitize(name), email, g_id, picture)
            )
            user_id = cur.fetchone()["id"]
            conn.commit()
            cur.execute("INSERT INTO crm_settings (crm_user_id) VALUES(%s)", (user_id,))
            conn.commit()
    return user_id

# ════════════════════════════════════════════
# EMAIL HELPERS
# ════════════════════════════════════════════

def send_code_email(email: str, code: int) -> bool:
    html = f"""<div style="font-family:Arial;text-align:center;padding:40px">
                <h1>Your verification code</h1>
                <p style="font-size:36px;font-weight:bold;letter-spacing:8px">
                    {str(code)[:3]} {str(code)[3:]}</p>
                <p style="color:#666">Expires in 10 minutes.</p></div>"""
    return send_email(email, "Verification Code", html)

def send_reset_email(email: str, token: str) -> bool:
    url = f"{CRM_FRONTEND_URL}/reset-password/{token}"
    html = f"""<div style="font-family:Arial;text-align:center;padding:40px">
                <h1>Reset your password</h1>
                <a href="{url}" style="display:inline-block;margin-top:24px;padding:14px 32px;
                    background:#0071e3;color:#fff;text-decoration:none;border-radius:16px;
                    font-size:18px;font-weight:600">Reset password</a>
                <p style="margin-top:24px;color:#999;font-size:12px">{url}</p></div>"""
    return send_email(email, "Password Reset", html)

# ════════════════════════════════════════════
# АУТЕНТИФИКАЦИЯ
# ════════════════════════════════════════════

@app.post("/api/send-code")
def send_code(request: SendCodeRequest, req: Request):
    email = request.email.lower().strip()
    ip    = get_ip(req)
    now   = datetime.utcnow()
    keys  = [f"ip:{ip}", f"email:{email}"]
    check_rate_limit(keys, now)

    existing = db_one("SELECT * FROM crm_users WHERE email = %s", (email,))

    if request.type == "register":
        if existing:
            record_fail(keys, now); raise HTTPException(400, "Email already exists")
        if not request.name or not request.password:
            raise HTTPException(400, "Name and password required")
        validate_password(request.password)
    elif request.type == "login":
        if not existing or not existing.get("is_active"):
            record_fail(keys, now); raise HTTPException(400, "Invalid email or password")
        if hash_pw(request.password or "") != existing["password"]:
            record_fail(keys, now); raise HTTPException(400, "Invalid email or password")
    else:
        raise HTTPException(400, "Invalid type")

    code = random.randint(100000, 999999)
    pending_verifications[email] = {
        "code": str(code), "type": request.type,
        "name": request.name, "password": request.password,
        "expires": now + timedelta(minutes=CODE_TTL_MINUTES),
        "next_resend_at": now + timedelta(seconds=RESEND_COOLDOWN_SECONDS),
    }
    if not send_code_email(email, code):
        del pending_verifications[email]
        raise HTTPException(500, "Failed to send email")

    for k in keys: login_attempts.pop(k, None)
    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.post("/api/verify-code")
def verify_code(request: VerifyCodeRequest, response: Response, req: Request):
    email = request.email.lower().strip()
    code  = (request.code or "").replace(" ", "").strip()
    ip    = get_ip(req)
    now   = datetime.utcnow()
    keys  = [f"ip:{ip}", f"email:{email}"]
    check_rate_limit(keys, now)

    pending = pending_verifications.get(email)
    if not pending:
        record_fail(keys, now); raise HTTPException(400, "Code not found or expired")
    if now > pending["expires"]:
        del pending_verifications[email]; raise HTTPException(400, "Code expired")
    if code != pending["code"]:
        record_fail(keys, now); raise HTTPException(400, "Invalid code")

    with db_cursor() as (conn, cur):
        if pending["type"] == "register":
            cur.execute(
                "INSERT INTO crm_users (name, email, password, role) VALUES (%s,%s,%s,'owner') RETURNING id",
                (sanitize(pending["name"]), email, hash_pw(pending["password"]))
            )
            user_id = cur.fetchone()["id"]
            conn.commit()
            cur.execute("INSERT INTO crm_settings (crm_user_id) VALUES (%s)", (user_id,))
            conn.commit()
        else:
            row = db_one("SELECT id FROM crm_users WHERE email = %s", (email,))
            user_id = row["id"]
            cur.execute("UPDATE crm_users SET last_login_at = NOW() WHERE id = %s", (user_id,))
            conn.commit()

    set_cookie(response, make_token(user_id))
    del pending_verifications[email]
    for k in keys: login_attempts.pop(k, None)
    return {"success": True}


@app.post("/api/resend-code")
def resend_code_endpoint(request: ResendCodeRequest):
    email = request.email.lower().strip()
    now   = datetime.utcnow()
    p     = pending_verifications.get(email)
    if not p:                        raise HTTPException(400, "No pending verification")
    if now > p["expires"]:           del pending_verifications[email]; raise HTTPException(400, "Code expired")
    if now < p["next_resend_at"]:
        left = int((p["next_resend_at"] - now).total_seconds())
        raise HTTPException(429, f"Resend available in {left}s")

    code = random.randint(100000, 999999)
    p.update(code=str(code),
             expires=now + timedelta(minutes=CODE_TTL_MINUTES),
             next_resend_at=now + timedelta(seconds=RESEND_COOLDOWN_SECONDS))
    if not send_code_email(email, code): raise HTTPException(500, "Failed to send email")
    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.get("/api/me")
def get_me(user: dict = Depends(get_current_user)):
    return db_one(
        "SELECT id, name, email, role, avatar_url FROM crm_users WHERE id = %s AND is_active = TRUE",
        (user["id"],)
    ) or HTTPException(401, "User not found")


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie("crm_token", path="/")
    return {"success": True}


# ════════════════════════════════════════════
# ВОССТАНОВЛЕНИЕ ПАРОЛЯ
# ════════════════════════════════════════════

@app.post("/api/forgot-password")
def forgot_password(request: ForgotPasswordRequest):
    email = request.email.lower().strip()
    if not db_one("SELECT id FROM crm_users WHERE email = %s", (email,)):
        return {"success": True}

    for t in [t for t, d in password_reset_tokens.items() if d["email"] == email]:
        del password_reset_tokens[t]

    raw   = secrets.token_urlsafe(32)
    h     = hashlib.sha256(raw.encode()).hexdigest()
    password_reset_tokens[h] = {"email": email, "expires": datetime.utcnow() + timedelta(minutes=RESET_TTL_MINUTES)}

    if not send_reset_email(email, raw):
        del password_reset_tokens[h]; raise HTTPException(500, "Failed to send email")
    return {"success": True}


@app.get("/api/reset-password/validate/{token}")
def validate_reset_token(token: str):
    data = password_reset_tokens.get(hashlib.sha256(token.encode()).hexdigest())
    if not data or datetime.utcnow() > data["expires"]:
        raise HTTPException(400, "Invalid or expired reset link")
    return {"valid": True, "email": data["email"]}


@app.post("/api/reset-password")
def reset_password(request: ResetPasswordRequest):
    if request.password != request.repeat_password:
        raise HTTPException(400, "Passwords do not match")
    validate_password(request.password)
    h    = hashlib.sha256(request.token.encode()).hexdigest()
    data = password_reset_tokens.get(h)
    if not data or datetime.utcnow() > data["expires"]:
        raise HTTPException(400, "Invalid or expired reset link")

    with db_cursor() as (conn, cur):
        cur.execute("UPDATE crm_users SET password = %s WHERE email = %s",
                    (hash_pw(request.password), data["email"]))
        conn.commit()
    del password_reset_tokens[h]
    return {"success": True}


# ════════════════════════════════════════════
# ORGANIZATIONS
# ════════════════════════════════════════════

@app.get("/api/orgs")
def get_orgs(user: dict = Depends(get_current_user)):
    rows = db_all("""
        SELECT o.id, o.name, o.slug, o.created_at,
               COUNT(DISTINCT p.id) AS projects_count,
               (o.owner_id = %s) AS is_owner
        FROM crm_organizations o
        LEFT JOIN crm_projects p ON p.org_id = o.id
        WHERE o.owner_id = %s
        GROUP BY o.id ORDER BY o.created_at DESC
    """, (user["id"], user["id"]))
    for r in rows:
        r["created_at"]     = str(r["created_at"])
        r["is_owner"]       = bool(r["is_owner"])
        r["projects_count"] = int(r["projects_count"] or 0)
    return rows


@app.post("/api/orgs")
def create_org(request: CreateOrgRequest, user: dict = Depends(get_current_user)):
    name = request.name.strip()
    if not name:        raise HTTPException(400, "Organization name is required")
    if len(name) > 100: raise HTTPException(400, "Name too long (max 100)")

    # Generate unique random slug (20 hex chars, same scheme as project api_key)
    slug = next(
        c for _ in iter(int, 1)
        if not db_one("SELECT id FROM crm_organizations WHERE slug = %s", (c := secrets.token_hex(10),))
    )

    with db_cursor() as (conn, cur):
        cur.execute(
            "INSERT INTO crm_organizations (name, slug, owner_id) VALUES (%s,%s,%s) RETURNING id",
            (sanitize(name), slug, user["id"])
        )
        new_id = cur.fetchone()["id"]
        conn.commit()
        return {"id": new_id, "name": name, "slug": slug, "is_owner": True, "projects_count": 0}


@app.get("/api/orgs/by-slug/{slug}")
def get_org_by_slug(slug: str, user: dict = Depends(get_current_user)):
    org = db_one("""
        SELECT o.id, o.name, o.slug, o.created_at, (o.owner_id = %s) AS is_owner
        FROM crm_organizations o
        WHERE o.slug = %s AND o.owner_id = %s
    """, (user["id"], slug, user["id"]))
    if not org: raise HTTPException(404, "Organization not found")
    org["created_at"] = str(org["created_at"])
    org["is_owner"]   = bool(org["is_owner"])
    return org


@app.get("/api/orgs/{org_id}")
def get_org(org_id: int, user: dict = Depends(get_current_user)):
    org = db_one("""
        SELECT o.id, o.name, o.slug, o.created_at, (o.owner_id = %s) AS is_owner
        FROM crm_organizations o
        WHERE o.id = %s AND o.owner_id = %s
    """, (user["id"], org_id, user["id"]))
    if not org: raise HTTPException(404, "Organization not found")
    org["created_at"] = str(org["created_at"])
    org["is_owner"]   = bool(org["is_owner"])
    return org


@app.patch("/api/orgs/{org_id}")
def rename_org(org_id: int, request: RenameOrgRequest, user: dict = Depends(get_current_user)):
    name = request.name.strip()
    if not name:        raise HTTPException(400, "Name is required")
    if len(name) > 100: raise HTTPException(400, "Name too long (max 100)")
    require_org_owner(user, org_id)
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE crm_organizations SET name=%s WHERE id=%s", (sanitize(name), org_id))
        conn.commit()
    return {"ok": True, "name": name}


@app.delete("/api/orgs/{org_id}")
def delete_org(org_id: int, user: dict = Depends(get_current_user)):
    require_org_owner(user, org_id)
    count = db_one("SELECT COUNT(*) AS c FROM crm_projects WHERE org_id=%s", (org_id,))["c"]
    if count > 0: raise HTTPException(400, "Delete all projects in this organization first")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM crm_organizations WHERE id=%s", (org_id,))
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════
# PROJECTS
# ════════════════════════════════════════════

@app.get("/api/orgs/{org_id}/projects")
def get_projects(org_id: int, user: dict = Depends(get_current_user)):
    if not db_one("SELECT id FROM crm_organizations WHERE id=%s AND owner_id=%s", (org_id, user["id"])):
        raise HTTPException(404, "Organization not found")
    rows = db_all("""
        SELECT p.id, p.name, p.api_key, p.is_active, p.last_used_at, p.created_at
        FROM crm_projects p
        WHERE p.org_id = %s
        ORDER BY p.created_at DESC
    """, (org_id,))
    for p in rows:
        p["last_used_at"] = p["last_used_at"].isoformat() if p.get("last_used_at") else None
        p["created_at"]   = str(p["created_at"])
    return rows


@app.post("/api/orgs/{org_id}/projects")
def create_project(org_id: int, request: CreateProjectRequest, req: Request, user: dict = Depends(get_current_user)):
    require_org_owner(user, org_id)

    name = request.name.strip()
    if not name:          raise HTTPException(400, "Name is required")
    if len(name) > 100:   raise HTTPException(400, "Name too long (max 100)")

    frontend_url = request.frontend_url.strip()
    if not frontend_url:  raise HTTPException(400, "Frontend URL is required")
    if not frontend_url.startswith(("http://", "https://")):
        raise HTTPException(400, "Frontend URL must start with http:// or https://")
    if len(frontend_url) > 500: raise HTTPException(400, "Frontend URL too long")

    new_key = next(
        (c for _ in range(5)
         if not db_one("SELECT id FROM crm_projects WHERE api_key = %s", (c := gen_api_key(),))),
        None
    )
    if not new_key: raise HTTPException(500, "Failed to generate unique key")
    new_pk = gen_publishable_key()

    with db_cursor() as (conn, cur):
        cur.execute(
            "INSERT INTO crm_projects (org_id, crm_user_id, name, api_key, publishable_key, last_used_ip, is_active) VALUES (%s,%s,%s,%s,%s,%s,TRUE) RETURNING id",
            (org_id, user["id"], sanitize(name), new_key, new_pk, get_ip(req))
        )
        new_id = cur.fetchone()["id"]
        conn.commit()

        cur.execute("INSERT INTO crm_roles (project_id, name, is_system) VALUES (%s,'Owner',TRUE) RETURNING id", (new_id,))
        owner_role_id = cur.fetchone()["id"]
        conn.commit()

        cur.execute(
            "INSERT INTO crm_team_members (project_id, crm_user_id, crm_role_id) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
            (new_id, user["id"], owner_role_id)
        )
        cur.execute("INSERT INTO crm_url_config (project_id, frontend_url) VALUES (%s,%s)", (new_id, frontend_url))
        cur.execute("INSERT INTO crm_redirect_urls (project_id, url) VALUES (%s,%s) ON CONFLICT DO NOTHING", (new_id, frontend_url))
        conn.commit()

    return {"id": new_id, "name": name, "api_key": new_key, "publishable_key": new_pk, "is_active": True}


@app.get("/api/projects/by-key/{api_key}")
def get_project_by_key(api_key: str, user: dict = Depends(get_current_user)):
    p = db_one("""
        SELECT p.id, p.name, p.api_key, p.publishable_key, p.is_active, p.last_used_at, p.created_at,
               o.id AS org_id, o.name AS org_name, o.slug AS org_slug
        FROM crm_projects p
        JOIN crm_organizations o ON o.id = p.org_id
        WHERE p.api_key = %s
    """, (api_key,))
    if not p: raise HTTPException(404, "Project not found")
    require_team_member_or_owner(user, p["id"])
    p["last_used_at"] = p["last_used_at"].isoformat() if p.get("last_used_at") else None
    p["created_at"]   = str(p["created_at"])
    return p


@app.get("/api/projects/{project_id}")
def get_project(project_id: int, user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    p = db_one("""
        SELECT p.id, p.name, p.api_key, p.publishable_key, p.is_active, p.last_used_at, p.created_at,
               o.id AS org_id, o.name AS org_name, o.slug AS org_slug
        FROM crm_projects p
        JOIN crm_organizations o ON o.id = p.org_id
        WHERE p.id = %s
    """, (project_id,))
    if not p: raise HTTPException(404, "Project not found")
    p["last_used_at"] = p["last_used_at"].isoformat() if p.get("last_used_at") else None
    p["created_at"]   = str(p["created_at"])
    return p


@app.get("/api/projects/{project_id}/overview")
def get_project_overview(
    project_id: int,
    days: int = Query(30, ge=1, le=365),
    user: dict = Depends(get_current_user)
):
    require_team_member_or_owner(user, project_id)
    pid = (project_id,)

    # Revenue + orders in period (non-cancelled/returned)
    rev = db_one("""
        SELECT COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS orders
        FROM order_history
        WHERE project_id = %s
          AND status NOT IN ('cancelled','returned')
          AND created_at >= NOW() - %s * INTERVAL '1 day'
    """, (project_id, days))

    # Customers total
    cust = db_one("SELECT COUNT(*) AS cnt FROM users WHERE project_id = %s", pid)

    # Products total
    prod = db_one("SELECT COUNT(*) AS cnt FROM products WHERE project_id = %s", pid)

    # Visits in period
    vis = db_one("""
        SELECT COUNT(*) AS cnt FROM site_visits
        WHERE project_id = %s AND created_at >= NOW() - %s * INTERVAL '1 day'
    """, (project_id, days))

    # Reviews total
    rev_cnt = db_one("SELECT COUNT(*) AS cnt FROM product_reviews WHERE project_id = %s", pid)

    # Recent orders (last 8)
    recent = db_all("""
        SELECT o.id, o.total_amount, o.status, o.created_at, u.name AS customer_name
        FROM order_history o
        LEFT JOIN users u ON o.user_id = u.id AND u.project_id = %s
        WHERE o.project_id = %s
        ORDER BY o.created_at DESC
        LIMIT 8
    """, (project_id, project_id))

    for r in (recent or []):
        r["created_at"] = str(r["created_at"])

    return {
        "stats": {
            "revenue":   int(rev["revenue"]) if rev else 0,
            "orders":    int(rev["orders"])  if rev else 0,
            "customers": int(cust["cnt"])    if cust else 0,
            "products":  int(prod["cnt"])    if prod else 0,
            "visits":    int(vis["cnt"])     if vis else 0,
            "reviews":   int(rev_cnt["cnt"]) if rev_cnt else 0,
        },
        "recent_orders": recent or [],
    }


@app.patch("/api/projects/{project_id}")
def rename_project(project_id: int, request: RenameProjectRequest, user: dict = Depends(get_current_user)):
    name = request.name.strip()
    if not name:        raise HTTPException(400, "Name is required")
    if len(name) > 100: raise HTTPException(400, "Name too long (max 100)")
    require_owner(user, project_id)
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE crm_projects SET name=%s WHERE id=%s", (sanitize(name), project_id))
        conn.commit()
    return {"ok": True, "name": name}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int, user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    org = db_one("SELECT org_id FROM crm_projects WHERE id=%s", (project_id,))
    count = db_one("SELECT COUNT(*) AS c FROM crm_projects WHERE org_id=%s", (org["org_id"],))["c"]
    if count <= 1: raise HTTPException(400, "Cannot delete the last project in an organization")

    # Удалить DKIM-ключи домена с SES если есть
    email_row = db_one("SELECT domain FROM crm_email_domains WHERE project_id=%s", (project_id,))
    if email_row:
        try:
            _ses("DELETE", f"/domains/{email_row['domain']}")
        except Exception:
            pass

    pid = (project_id,)
    with db_cursor() as (conn, cur):
        # ── Magaz: порядок важен (FK: sizes → variations → products) ──
        cur.execute("DELETE FROM product_sizes WHERE variation_id IN (SELECT v.id FROM product_variations v JOIN products p ON v.product_id=p.id WHERE p.project_id=%s)", pid)
        cur.execute("DELETE FROM product_variations WHERE product_id IN (SELECT id FROM products WHERE project_id=%s)", pid)
        cur.execute("DELETE FROM product_custom_fields WHERE project_id=%s", pid)
        cur.execute("DELETE FROM product_reviews     WHERE project_id=%s", pid)
        cur.execute("DELETE FROM product_page_views  WHERE project_id=%s", pid)
        cur.execute("DELETE FROM products            WHERE project_id=%s", pid)
        cur.execute("DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE project_id=%s)", pid)
        cur.execute("DELETE FROM carts          WHERE project_id=%s", pid)
        cur.execute("DELETE FROM favorites      WHERE project_id=%s", pid)
        cur.execute("DELETE FROM order_history  WHERE project_id=%s", pid)
        cur.execute("DELETE FROM promo_codes    WHERE project_id=%s", pid)
        cur.execute("DELETE FROM shipping_settings WHERE project_id=%s", pid)
        cur.execute("DELETE FROM site_visits    WHERE project_id=%s", pid)
        cur.execute("DELETE FROM users          WHERE project_id=%s", pid)
        # ── CRM ──
        cur.execute("DELETE FROM crm_team_members  WHERE project_id=%s", pid)
        cur.execute("DELETE FROM crm_roles         WHERE project_id=%s", pid)
        cur.execute("DELETE FROM crm_redirect_urls WHERE project_id=%s", pid)
        cur.execute("DELETE FROM crm_url_config    WHERE project_id=%s", pid)
        cur.execute("DELETE FROM crm_oauth_settings WHERE project_id=%s", pid)
        cur.execute("DELETE FROM crm_email_domains  WHERE project_id=%s", pid)
        cur.execute("DELETE FROM crm_projects       WHERE id=%s",         pid)
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════
# PRODUCTS
# ════════════════════════════════════════════

@app.get("/api/products")
def list_products(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    rows = db_all(
        "SELECT p.id, p.title,"
        " COUNT(DISTINCT v.id) AS variations_count,"
        " COALESCE(SUM(ps.stock_quantity),0) AS total_stock,"
        " COALESCE(MIN(ps.price),0) AS min_price,"
        " COALESCE(MAX(ps.price),0) AS max_price,"
        " COALESCE(AVG(pr.rating),0) AS avg_rating,"
        " COUNT(DISTINCT pr.id) AS reviews_count,"
        " (SELECT image_url FROM product_variations WHERE product_id=p.id ORDER BY id ASC LIMIT 1) AS first_image"
        " FROM products p"
        " LEFT JOIN product_variations v ON v.product_id=p.id"
        " LEFT JOIN product_sizes ps ON ps.product_id=p.id"
        " LEFT JOIN product_reviews pr ON pr.product_id=p.id"
        " WHERE p.project_id=%s GROUP BY p.id ORDER BY p.id DESC",
        (project_id,)
    )
    for r in rows:
        r["avg_rating"]  = round(float(r["avg_rating"] or 0), 1)
        r["min_price"]   = float(r["min_price"] or 0)
        r["max_price"]   = float(r["max_price"] or 0)
        r["total_stock"] = int(r["total_stock"] or 0)
    return rows


@app.post("/api/products")
def create_product(request: CreateProductRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    name = request.title.strip()
    if not name: raise HTTPException(400, "Title is required")
    with db_cursor() as (conn, cur):
        cur.execute(
            "INSERT INTO products (project_id,title,description,characteristics,seo_title,seo_description,seo_keywords) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (project_id, sanitize(name), sanitize(request.description), sanitize(request.characteristics),
             sanitize(request.seo_title), sanitize(request.seo_description), sanitize(request.seo_keywords))
        )
        new_id = cur.fetchone()["id"]
        conn.commit()
        return {"id": new_id, "title": name}


@app.get("/api/products/{product_id}/project-context")
def get_product_project_context(product_id: int, user: dict = Depends(get_current_user)):
    row = db_one(
        "SELECT p.project_id, pr.name AS project_name, pr.api_key, pr.org_id,"
        " o.name AS org_name, o.slug AS org_slug"
        " FROM products p"
        " JOIN crm_projects pr ON p.project_id = pr.id"
        " JOIN crm_organizations o ON pr.org_id = o.id"
        " WHERE p.id = %s",
        (product_id,)
    )
    if not row: raise HTTPException(404, "Product not found")
    require_team_member_or_owner(user, row["project_id"])
    return {
        "project_id":   row["project_id"],
        "project_name": row["project_name"],
        "api_key":      row["api_key"],
        "org_id":       row["org_id"],
        "org_name":     row["org_name"],
        "org_slug":     row["org_slug"],
    }


@app.get("/api/products/{product_id}")
def get_product(product_id: int, project_id: Optional[int] = Query(None), user: dict = Depends(get_current_user)):
    if project_id is None:
        row = db_one("SELECT project_id FROM products WHERE id=%s", (product_id,))
        if not row: raise HTTPException(404, "Product not found")
        project_id = row["project_id"]
    require_team_member_or_owner(user, project_id)
    p = db_one("SELECT * FROM products WHERE id=%s AND project_id=%s", (product_id, project_id))
    if not p: raise HTTPException(404, "Product not found")

    variations = db_all(
        "SELECT id, variation_name, image_url FROM product_variations WHERE product_id=%s ORDER BY id ASC",
        (product_id,)
    )
    var_ids = [v["id"] for v in variations]
    sizes   = []
    if var_ids:
        fmt   = ",".join(["%s"] * len(var_ids))
        sizes = db_all(
            "SELECT id,variation_id,size_name,price,stock_quantity,sold_quantity"
            " FROM product_sizes WHERE variation_id IN (" + fmt + ") ORDER BY id ASC",
            tuple(var_ids)
        )
    sizes_by_var = {}
    for s in sizes:
        s["price"] = float(s["price"])
        sizes_by_var.setdefault(s["variation_id"], []).append(s)
    for v in variations:
        v["sizes"] = sizes_by_var.get(v["id"], [])

    custom_fields = db_all(
        "SELECT field_key,field_value,field_type,is_global FROM product_custom_fields"
        " WHERE product_id=%s AND project_id=%s ORDER BY created_at ASC",
        (product_id, project_id)
    )
    for cf in custom_fields:
        cf["is_global"] = bool(cf.get("is_global", 0))

    reviews = db_all(
        "SELECT pr.id,pr.rating,pr.comment,pr.created_at,pr.user_id"
        " FROM product_reviews pr"
        " WHERE pr.product_id=%s AND pr.project_id=%s ORDER BY pr.created_at DESC",
        (product_id, project_id)
    )
    for r in reviews:
        r["created_at"] = str(r["created_at"])

    return {
        "id": p["id"], "title": p["title"],
        "description":    p["description"]     or "",
        "characteristics":p["characteristics"] or "",
        "seo_title":      p["seo_title"]        or "",
        "seo_description":p["seo_description"]  or "",
        "seo_keywords":   p["seo_keywords"]     or "",
        "variations": variations, "custom_fields": custom_fields, "reviews": reviews,
    }


@app.put("/api/products/{product_id}")
def update_product(product_id: int, request: UpdateProductRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    fields = []; vals = []
    if request.title           is not None: fields.append("title=%s");           vals.append(request.title.strip())
    if request.description     is not None: fields.append("description=%s");     vals.append(request.description)
    if request.characteristics is not None: fields.append("characteristics=%s"); vals.append(request.characteristics)
    if request.seo_title       is not None: fields.append("seo_title=%s");       vals.append(request.seo_title)
    if request.seo_description is not None: fields.append("seo_description=%s"); vals.append(request.seo_description)
    if request.seo_keywords    is not None: fields.append("seo_keywords=%s");    vals.append(request.seo_keywords)
    if not fields: return {"ok": True}
    vals.extend([product_id, project_id])
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE products SET " + ", ".join(fields) + " WHERE id=%s AND project_id=%s", vals)
        conn.commit()
    return {"ok": True}


@app.delete("/api/products/{product_id}")
def delete_product(product_id: int, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM product_sizes WHERE variation_id IN (SELECT id FROM product_variations WHERE product_id=%s)", (product_id,))
        cur.execute("DELETE FROM product_variations WHERE product_id=%s",              (product_id,))
        cur.execute("DELETE FROM product_custom_fields WHERE product_id=%s",           (product_id,))
        cur.execute("DELETE FROM product_reviews WHERE product_id=%s AND project_id=%s", (product_id, project_id))
        cur.execute("DELETE FROM products WHERE id=%s AND project_id=%s",              (product_id, project_id))
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════
# VARIATIONS
# ════════════════════════════════════════════

@app.post("/api/products/{product_id}/variations")
def create_variation(product_id: int, request: CreateVariationRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    name = request.variation_name.strip()
    if not name: raise HTTPException(400, "Variation name is required")
    with db_cursor() as (conn, cur):
        cur.execute("INSERT INTO product_variations (product_id,variation_name,image_url) VALUES(%s,%s,%s) RETURNING id",
                    (product_id, sanitize(name), request.image_url))
        new_id = cur.fetchone()["id"]
        conn.commit()
        return {"id": new_id, "variation_name": name, "image_url": request.image_url, "sizes": []}


@app.put("/api/products/{product_id}/variations/{var_id}")
def update_variation(product_id: int, var_id: int, request: UpdateVariationRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    if not db_one("SELECT id FROM product_variations WHERE id=%s AND product_id=%s", (var_id, product_id)):
        raise HTTPException(404, "Variation not found")
    fields = []; vals = []
    if request.variation_name is not None: fields.append("variation_name=%s"); vals.append(request.variation_name.strip())
    if request.image_url      is not None: fields.append("image_url=%s");      vals.append(request.image_url)
    if not fields: return {"ok": True}
    vals.append(var_id)
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE product_variations SET " + ", ".join(fields) + " WHERE id=%s", vals)
        conn.commit()
    return {"ok": True}


@app.delete("/api/products/{product_id}/variations/{var_id}")
def delete_variation(product_id: int, var_id: int, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM product_sizes WHERE variation_id=%s", (var_id,))
        cur.execute("DELETE FROM product_variations WHERE id=%s AND product_id=%s", (var_id, product_id))
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════
# SIZES
# ════════════════════════════════════════════

@app.post("/api/products/{product_id}/variations/{var_id}/sizes")
def create_size(product_id: int, var_id: int, request: CreateSizeRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    if not db_one("SELECT id FROM product_variations WHERE id=%s AND product_id=%s", (var_id, product_id)):
        raise HTTPException(404, "Variation not found")
    name = request.size_name.strip()
    if not name: raise HTTPException(400, "Size name is required")
    with db_cursor() as (conn, cur):
        cur.execute(
            "INSERT INTO product_sizes (product_id,variation_id,size_name,price,stock_quantity) VALUES(%s,%s,%s,%s,%s) RETURNING id",
            (product_id, var_id, name, request.price, request.stock_quantity)
        )
        new_id = cur.fetchone()["id"]
        conn.commit()
        return {"id": new_id, "variation_id": var_id, "size_name": name,
                "price": request.price, "stock_quantity": request.stock_quantity, "sold_quantity": 0}


@app.put("/api/products/{product_id}/variations/{var_id}/sizes/{size_id}")
def update_size(product_id: int, var_id: int, size_id: int, request: UpdateSizeRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    fields = []; vals = []
    if request.size_name      is not None: fields.append("size_name=%s");      vals.append(request.size_name.strip())
    if request.price          is not None: fields.append("price=%s");          vals.append(request.price)
    if request.stock_quantity is not None: fields.append("stock_quantity=%s"); vals.append(request.stock_quantity)
    if not fields: return {"ok": True}
    vals.extend([size_id, var_id])
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE product_sizes SET " + ", ".join(fields) + " WHERE id=%s AND variation_id=%s", vals)
        conn.commit()
    return {"ok": True}


@app.delete("/api/products/{product_id}/variations/{var_id}/sizes/{size_id}")
def delete_size(product_id: int, var_id: int, size_id: int, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM product_sizes WHERE id=%s AND variation_id=%s", (size_id, var_id))
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════
# CUSTOM FIELDS
# ════════════════════════════════════════════

@app.post("/api/products/{product_id}/custom-fields")
def upsert_custom_field(product_id: int, request: UpsertCustomFieldRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    key = request.field_key.strip().lower().replace(" ", "_")
    if not key: raise HTTPException(400, "Field key is required")

    ex = db_one("SELECT id FROM product_custom_fields WHERE product_id=%s AND project_id=%s AND field_key=%s",
                (product_id, project_id, key))
    with db_cursor() as (conn, cur):
        if ex:
            cur.execute("UPDATE product_custom_fields SET field_value=%s,field_type=%s,is_global=%s WHERE id=%s",
                        (request.field_value, request.field_type, request.is_global, ex["id"]))
        else:
            cur.execute("INSERT INTO product_custom_fields (project_id,product_id,field_key,field_value,field_type,is_global) VALUES(%s,%s,%s,%s,%s,%s)",
                        (project_id, product_id, key, request.field_value, request.field_type, request.is_global))
        conn.commit()
    return {"ok": True, "field_key": key, "is_global": request.is_global}


@app.delete("/api/products/{product_id}/custom-fields/{field_key}")
def delete_custom_field(product_id: int, field_key: str, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM product_custom_fields WHERE product_id=%s AND project_id=%s AND field_key=%s",
                    (product_id, project_id, field_key))
        conn.commit()
    return {"ok": True}


@app.patch("/api/products/{product_id}/custom-fields/{field_key}/global")
def toggle_custom_field_global(product_id: int, field_key: str, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one("SELECT id, is_global FROM product_custom_fields WHERE product_id=%s AND project_id=%s AND field_key=%s",
                 (product_id, project_id, field_key))
    if not row: raise HTTPException(404, "Field not found")
    new_val = not row["is_global"]
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE product_custom_fields SET is_global=%s WHERE id=%s", (new_val, row["id"]))
        conn.commit()
    return {"ok": True, "is_global": new_val}


# ════════════════════════════════════════════
# UPLOAD
# ════════════════════════════════════════════

@app.post("/api/upload/image")
async def upload_image(
    file: UploadFile = File(...),
    project_id: Optional[int] = Query(None),
    user: dict = Depends(get_current_user),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are allowed")
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10MB)")
    if not PIL_AVAILABLE:
        raise HTTPException(500, "Pillow not installed. Run: pip install Pillow")
    try:
        img = PilImage.open(io.BytesIO(contents)).convert("RGB")
        out = io.BytesIO()
        img.save(out, "WEBP", quality=85, method=4)
        out.seek(0)
    except Exception:
        raise HTTPException(400, "Invalid image file")

    filename = f"{secrets.token_hex(16)}.webp"

    if S3_AVAILABLE and AWS_ACCESS_KEY_ID:
        folder = f"projects/{project_id}/products" if project_id else "products"
        key = f"{folder}/{filename}"
        try:
            url = s3_upload(out, key)
            return {"url": url}
        except (BotoCoreError, ClientError) as e:
            raise HTTPException(500, f"S3 upload failed: {e}")
    else:
        path = os.path.join(UPLOADS_DIR, filename)
        with open(path, "wb") as f:
            f.write(out.read())
        return {"url": f"{CRM_BACKEND_URL}/uploads/{filename}"}


@app.post("/api/upload/avatar")
async def upload_avatar(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are allowed")
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 5MB)")
    if not PIL_AVAILABLE:
        raise HTTPException(500, "Pillow not installed. Run: pip install Pillow")
    try:
        img = PilImage.open(io.BytesIO(contents)).convert("RGB")
        img.thumbnail((256, 256), PilImage.LANCZOS)
        out = io.BytesIO()
        img.save(out, "WEBP", quality=85)
        out.seek(0)
    except Exception:
        raise HTTPException(400, "Invalid image file")

    if S3_AVAILABLE and AWS_ACCESS_KEY_ID:
        # Уникальный ключ с меткой времени — новый URL каждый раз, никакого кеша
        ts  = int(time.time())
        key = f"avatars/{user['id']}/avatar_{ts}.webp"
        try:
            old_url = (db_one("SELECT avatar_url FROM crm_users WHERE id=%s", (user["id"],)) or {}).get("avatar_url") or ""
            url = s3_upload(out, key, cache_control="no-cache, must-revalidate")
            s3_delete_url(old_url, f"avatars/{user['id']}/")
        except (BotoCoreError, ClientError) as e:
            raise HTTPException(500, f"S3 upload failed: {e}")
    else:
        filename = f"avatar_{user['id']}_{secrets.token_hex(8)}.webp"
        path = os.path.join(UPLOADS_DIR, filename)
        with open(path, "wb") as f:
            f.write(out.read())
        url = f"{CRM_BACKEND_URL}/uploads/{filename}"

    with db_cursor() as (conn, cur):
        cur.execute("UPDATE crm_users SET avatar_url=%s WHERE id=%s", (url, user["id"]))
        conn.commit()
    return {"url": url}


# ════════════════════════════════════════════
# SETTINGS
# ════════════════════════════════════════════

@app.get("/api/settings")
def get_settings(user: dict = Depends(get_current_user)):
    u = db_one("SELECT id, name, email, role, avatar_url FROM crm_users WHERE id=%s", (user["id"],))
    s = db_one("SELECT language, currency, theme, org_view, org_sort FROM crm_settings WHERE crm_user_id=%s", (user["id"],))
    return {
        "id":         u["id"],
        "name":       u["name"],
        "email":      u["email"],
        "role":       u["role"],
        "avatar_url": u.get("avatar_url"),
        "language":   (s or {}).get("language", "en"),
        "currency":   (s or {}).get("currency", "USD"),
        "theme":      (s or {}).get("theme", "light"),
        "org_view":   (s or {}).get("org_view", "grid"),
        "org_sort":   (s or {}).get("org_sort", "date_desc"),
    }


@app.put("/api/settings")
def update_settings(request: UpdateSettingsRequest, user: dict = Depends(get_current_user)):
    with db_cursor() as (conn, cur):
        if request.name is not None:
            name = request.name.strip()
            if not name:        raise HTTPException(400, "Name cannot be empty")
            if len(name) > 80:  raise HTTPException(400, "Name too long (max 80)")
            cur.execute("UPDATE crm_users SET name=%s WHERE id=%s", (sanitize(name), user["id"]))
        upd = {}
        if request.language is not None: upd["language"] = request.language
        if request.currency is not None: upd["currency"] = request.currency
        if request.theme    is not None: upd["theme"]    = request.theme
        if request.org_view is not None and request.org_view in ("grid", "list"): upd["org_view"] = request.org_view
        VALID_SORTS = ("name_asc", "name_desc", "date_asc", "date_desc")
        if request.org_sort is not None and request.org_sort in VALID_SORTS: upd["org_sort"] = request.org_sort
        if upd:
            sets = ", ".join(f"{k}=%s" for k in upd)
            cur.execute(f"UPDATE crm_settings SET {sets} WHERE crm_user_id=%s",
                        list(upd.values()) + [user["id"]])
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════
# GOOGLE OAUTH (CRM login)
# ════════════════════════════════════════════

@app.get("/api/auth/google/login")
def google_login():
    import urllib.parse
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "offline",
        "prompt":        "select_account",
    }
    return RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params))


@app.get("/api/auth/google/callback")
def google_callback(code: str = None, error: str = None):
    if error or not code:
        return RedirectResponse(f"{CRM_FRONTEND_URL}/login?error=google_cancelled")

    import urllib.request, urllib.parse, json as _json
    data = urllib.parse.urlencode({
        "code": code, "client_id": GOOGLE_CLIENT_ID, "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GOOGLE_REDIRECT_URI, "grant_type": "authorization_code",
    }).encode()
    try:
        req = urllib.request.Request(
            "https://oauth2.googleapis.com/token", data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            tokens = _json.loads(resp.read())
    except Exception as e:
        import traceback; traceback.print_exc()
        return RedirectResponse(f"{CRM_FRONTEND_URL}/login?error=google_token")

    id_token_str = tokens.get("id_token")
    if not id_token_str:
        print(f"[google_callback] no id_token in response: {tokens}")
        return RedirectResponse(f"{CRM_FRONTEND_URL}/login?error=google_no_id_token")

    try:
        from google.oauth2 import id_token as g_id_token
        from google.auth.transport import requests as g_requests
        idinfo  = g_id_token.verify_oauth2_token(id_token_str, g_requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=60)
        g_id    = idinfo["sub"]
        email   = idinfo["email"]
        name    = idinfo.get("name", email.split("@")[0])
        picture = idinfo.get("picture")
    except Exception as e:
        import traceback; traceback.print_exc()
        return RedirectResponse(f"{CRM_FRONTEND_URL}/login?error=google_verify")

    user_id   = _upsert_google_user(g_id, email, name, picture)
    jwt_token = make_token(user_id)
    redirect  = RedirectResponse(f"{CRM_FRONTEND_URL}/dashboard", status_code=302)
    redirect.set_cookie(key="crm_token", value=jwt_token, httponly=True, samesite="lax", max_age=60*60*24*7)
    return redirect


@app.post("/api/auth/google")
def google_auth(request: GoogleAuthRequest, response: Response):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(501, "Google OAuth not configured")
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as g_requests
        idinfo  = id_token.verify_oauth2_token(request.token, g_requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=10)
        g_id    = idinfo["sub"]
        email   = idinfo["email"]
        name    = idinfo.get("name", email.split("@")[0])
        picture = idinfo.get("picture")
    except Exception as e:
        raise HTTPException(400, f"Invalid Google token: {e}")

    user_id = _upsert_google_user(g_id, email, name, picture)
    set_cookie(response, make_token(user_id))
    return {"success": True}


# ════════════════════════════════════════════
# EMAIL DOMAIN
# ════════════════════════════════════════════

class EmailDomainRequest(BaseModel):
    domain: str
    from_name: str
    from_email: str


@app.get("/api/email-domain")
def get_email_domain(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one("SELECT * FROM crm_email_domains WHERE project_id = %s", (project_id,))
    if not row:
        return {"configured": False}
    dns_records = []
    try:
        dns_records = json.loads(row["dkim_public"]) if row["dkim_public"] else []
    except Exception:
        pass
    return {
        "configured":     True,
        "domain":         row["domain"],
        "from_name":      row["from_name"],
        "from_email":     row["from_email"],
        "sender_avatar":  row.get("sender_avatar"),
        "dkim_ok":        bool(row["is_verified"]),
        "spf_ok":         row["verify_token"] in ("spf_ok", "all_ok"),
        "dmarc_ok":       row["verify_token"] == "all_ok",
        "verified_at":    row["verified_at"].isoformat() if row["verified_at"] else None,
        "dns_records":    dns_records,
    }


@app.post("/api/email-domain")
def save_email_domain(req: EmailDomainRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    domain     = req.domain.lower().strip().rstrip("/").removeprefix("https://").removeprefix("http://")
    from_name  = sanitize(req.from_name.strip())
    from_email = req.from_email.lower().strip()

    if not domain or "." not in domain:  raise HTTPException(400, "Invalid domain")
    if not from_email or "@" not in from_email: raise HTTPException(400, "Invalid from email")

    # Register domain in SES API (generates DKIM keys, returns DNS records to add)
    try:
        ses_data = _ses("POST", "/domains", {"domain": domain})
    except HTTPException as e:
        if e.status_code == 409:
            ses_data = _ses("GET", f"/domains/{domain}")
        else:
            raise

    dns_records = ses_data.get("dns_records", [])

    existing_db = db_one("SELECT domain FROM crm_email_domains WHERE project_id = %s", (project_id,))

    # If domain changed — delete old one from SES API
    if existing_db and existing_db["domain"] != domain:
        try:
            _ses("DELETE", f"/domains/{existing_db['domain']}")
        except Exception:
            pass

    with db_cursor() as (conn, cur):
        if existing_db:
            cur.execute("""
                UPDATE crm_email_domains
                SET domain=%s, from_name=%s, from_email=%s,
                    dkim_public=%s, is_verified=FALSE, verify_token='', verified_at=NULL
                WHERE project_id=%s
            """, (domain, from_name, from_email, json.dumps(dns_records), project_id))
        else:
            cur.execute("""
                INSERT INTO crm_email_domains
                    (project_id, domain, from_name, from_email, dkim_public, verify_token)
                VALUES (%s,%s,%s,%s,%s,%s)
            """, (project_id, domain, from_name, from_email, json.dumps(dns_records), ''))
        conn.commit()

    return get_email_domain(project_id=project_id, user=user)


@app.post("/api/email-domain/verify")
def verify_email_domain(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one("SELECT * FROM crm_email_domains WHERE project_id = %s", (project_id,))
    if not row: raise HTTPException(404, "No domain configured")

    domain  = row["domain"]
    result  = _ses("POST", f"/domains/{domain}/verify")
    dkim_ok  = result.get("dkim_ok", False)
    spf_ok   = result.get("spf_ok", False)
    dmarc_ok = result.get("dmarc_ok", False)
    all_ok   = dkim_ok and spf_ok

    with db_cursor() as (conn, cur):
        cur.execute("""
            UPDATE crm_email_domains
            SET is_verified=%s,
                verify_token=%s,
                verified_at=CASE WHEN %s AND verified_at IS NULL THEN NOW() ELSE verified_at END
            WHERE project_id=%s
        """, (dkim_ok, "all_ok" if (spf_ok and dmarc_ok) else ("spf_ok" if spf_ok else None), all_ok, project_id))
        conn.commit()

    return {"dkim_ok": dkim_ok, "spf_ok": spf_ok, "dmarc_ok": dmarc_ok, "all_ok": all_ok}


@app.delete("/api/email-domain")
def delete_email_domain(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    row = db_one("SELECT domain FROM crm_email_domains WHERE project_id=%s", (project_id,))
    if row:
        try:
            _ses("DELETE", f"/domains/{row['domain']}")
        except Exception:
            pass
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM crm_email_domains WHERE project_id=%s", (project_id,))
        conn.commit()
    return {"success": True}


# ════════════════════════════════════════════
# OAUTH SETTINGS
# ════════════════════════════════════════════

@app.get("/api/oauth-settings")
def get_oauth_settings(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    key_row      = db_one("SELECT api_key FROM crm_projects WHERE id=%s", (project_id,))
    api_key_str  = key_row["api_key"] if key_row else ""
    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key_str}/api/auth/google/callback"

    row = db_one("SELECT * FROM crm_oauth_settings WHERE project_id=%s", (project_id,))
    if not row:
        return {"configured": False, "google_client_id": "", "google_client_secret": "",
                "google_enabled": False, "redirect_uri": redirect_uri}
    return {
        "configured":           True,
        "google_client_id":     row["google_client_id"] or "",
        "google_client_secret": row["google_client_secret"] or "",
        "google_enabled":       bool(row["google_enabled"]),
        "redirect_uri":         redirect_uri,
    }


@app.post("/api/oauth-settings")
def save_oauth_settings(req: OAuthSettingsRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    existing = db_one("SELECT id FROM crm_oauth_settings WHERE project_id=%s", (project_id,))
    with db_cursor() as (conn, cur):
        if existing:
            cur.execute(
                "UPDATE crm_oauth_settings SET google_client_id=%s, google_client_secret=%s, google_enabled=%s WHERE project_id=%s",
                (req.google_client_id or None, req.google_client_secret or None, req.google_enabled, project_id)
            )
        else:
            cur.execute(
                "INSERT INTO crm_oauth_settings (project_id, google_client_id, google_client_secret, google_enabled) VALUES(%s,%s,%s,%s)",
                (project_id, req.google_client_id or None, req.google_client_secret or None, req.google_enabled)
            )
        conn.commit()
    return {"ok": True}


@app.delete("/api/oauth-settings")
def delete_oauth_settings(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM crm_oauth_settings WHERE project_id=%s", (project_id,))
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════
# GENERIC OAUTH PROVIDERS
# (GitHub, Discord, Facebook, GitLab, Bitbucket, LinkedIn, Twitch,
#  Spotify, Slack, Notion, Figma, Zoom, Azure, Apple, X, VK, Kakao, KeyCloak)
# ════════════════════════════════════════════

# Whitelist of providers we know how to handle in External.
# Adding a new provider requires extending OAUTH_PROVIDERS in External/main.py too.
ALLOWED_AUTH_PROVIDERS = {
    "github", "discord", "facebook", "gitlab", "bitbucket", "linkedin",
    "twitch", "spotify", "slack", "notion", "figma", "zoom",
    "azure", "apple", "x", "vk", "kakao", "keycloak",
}

@app.get("/api/auth-providers")
def list_auth_providers(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    """Return all configured providers for a project (id, enabled state — secrets stripped)."""
    require_team_member_or_owner(user, project_id)
    rows = db_all(
        "SELECT provider, is_enabled, (client_id IS NOT NULL AND client_id <> '') AS configured "
        "FROM crm_auth_providers WHERE project_id=%s",
        (project_id,),
    )
    return {"providers": rows or []}


@app.get("/api/auth-providers/{provider}")
def get_auth_provider(provider: str, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if provider not in ALLOWED_AUTH_PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {provider}")
    key_row     = db_one("SELECT api_key FROM crm_projects WHERE id=%s", (project_id,))
    api_key_str = key_row["api_key"] if key_row else ""
    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key_str}/api/auth/oauth/{provider}/callback"
    row = db_one(
        "SELECT client_id, client_secret, is_enabled FROM crm_auth_providers "
        "WHERE project_id=%s AND provider=%s",
        (project_id, provider),
    )
    if not row:
        return {"configured": False, "client_id": "", "client_secret": "",
                "is_enabled": False, "redirect_uri": redirect_uri}
    return {
        "configured":    True,
        "client_id":     row["client_id"] or "",
        "client_secret": row["client_secret"] or "",
        "is_enabled":    bool(row["is_enabled"]),
        "redirect_uri":  redirect_uri,
    }


@app.post("/api/auth-providers/{provider}")
def save_auth_provider(provider: str, req: AuthProviderRequest,
                       project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if provider not in ALLOWED_AUTH_PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {provider}")
    existing = db_one(
        "SELECT id FROM crm_auth_providers WHERE project_id=%s AND provider=%s",
        (project_id, provider),
    )
    with db_cursor() as (conn, cur):
        if existing:
            cur.execute(
                "UPDATE crm_auth_providers SET client_id=%s, client_secret=%s, is_enabled=%s "
                "WHERE project_id=%s AND provider=%s",
                (req.client_id or None, req.client_secret or None, req.is_enabled,
                 project_id, provider),
            )
        else:
            cur.execute(
                "INSERT INTO crm_auth_providers (project_id, provider, client_id, client_secret, is_enabled) "
                "VALUES (%s,%s,%s,%s,%s)",
                (project_id, provider, req.client_id or None, req.client_secret or None, req.is_enabled),
            )
        conn.commit()
    return {"ok": True}


@app.delete("/api/auth-providers/{provider}")
def delete_auth_provider(provider: str, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    with db_cursor() as (conn, cur):
        cur.execute(
            "DELETE FROM crm_auth_providers WHERE project_id=%s AND provider=%s",
            (project_id, provider),
        )
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════
# SMS / PHONE AUTHENTICATION
# Customer brings their own SMS provider — Twilio, MessageBird, Textlocal, Vonage,
# or Twilio Verify. Credentials stored per-provider so switching keeps history.
# ════════════════════════════════════════════

ALLOWED_SMS_PROVIDERS = {
    "twilio", "twilio_verify", "messagebird", "textlocal", "vonage",
    "aws_sns", "plivo",
    "smsc", "sms_ru", "mobizon",
    "telegram_gateway",
}

# Default row used when no settings exist yet — keeps frontend simple.
_SMS_DEFAULTS = {
    "is_enabled":                  False,
    "provider":                    "twilio",
    "twilio_account_sid":          "",
    "twilio_auth_token":           "",
    "twilio_message_service_sid":  "",
    "twilio_content_sid":          "",
    "twilio_verify_service_sid":   "",
    "messagebird_access_key":      "",
    "messagebird_originator":      "",
    "textlocal_api_key":           "",
    "textlocal_sender":            "",
    "vonage_api_key":              "",
    "vonage_api_secret":           "",
    "vonage_from_number":          "",
    "aws_access_key_id":           "",
    "aws_secret_access_key":       "",
    "aws_region":                  "",
    "plivo_auth_id":               "",
    "plivo_auth_token":            "",
    "plivo_from_number":           "",
    "smsc_login":                  "",
    "smsc_password":               "",
    "smsc_sender":                 "",
    "smsru_api_id":                "",
    "smsru_from":                  "",
    "mobizon_api_key":             "",
    "mobizon_alpha":               "",
    "telegram_gateway_token":      "",
    "enable_phone_confirmations":  True,
    "otp_expiry_seconds":          60,
    "otp_length":                  6,
    "message_template":            "Your code is {{ .Code }}",
    "test_phone_numbers":          "",
}

@app.get("/api/sms-settings")
def get_sms_settings(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one("SELECT * FROM crm_sms_settings WHERE project_id=%s", (project_id,))
    if not row:
        return {"configured": False, **_SMS_DEFAULTS}
    # Drop internal columns
    out = {k: v for k, v in row.items() if k not in ("id", "project_id", "created_at")}
    out["configured"] = True
    return out


@app.post("/api/sms-settings")
def save_sms_settings(req: SmsSettingsRequest,
                      project_id: int = Query(...),
                      user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if req.provider not in ALLOWED_SMS_PROVIDERS:
        raise HTTPException(400, f"Unknown SMS provider: {req.provider}")
    if req.otp_length < 4 or req.otp_length > 10:
        raise HTTPException(400, "OTP length must be 4–10")
    if req.otp_expiry_seconds < 30 or req.otp_expiry_seconds > 600:
        raise HTTPException(400, "OTP expiry must be 30–600 seconds")

    # All credential / OTP columns in a single ordered list so UPDATE and INSERT stay in sync.
    cols = [
        "is_enabled", "provider",
        "twilio_account_sid", "twilio_auth_token",
        "twilio_message_service_sid", "twilio_content_sid",
        "twilio_verify_service_sid",
        "messagebird_access_key", "messagebird_originator",
        "textlocal_api_key", "textlocal_sender",
        "vonage_api_key", "vonage_api_secret", "vonage_from_number",
        "aws_access_key_id", "aws_secret_access_key", "aws_region",
        "plivo_auth_id", "plivo_auth_token", "plivo_from_number",
        "smsc_login", "smsc_password", "smsc_sender",
        "smsru_api_id", "smsru_from",
        "mobizon_api_key", "mobizon_alpha",
        "telegram_gateway_token",
        "enable_phone_confirmations",
        "otp_expiry_seconds", "otp_length",
        "message_template", "test_phone_numbers",
    ]

    def _v(name):
        v = getattr(req, name)
        # Bool / int kept as-is, empty strings → NULL for credentials
        if isinstance(v, bool) or isinstance(v, int) and not isinstance(v, bool):
            return v
        if name in ("message_template", "test_phone_numbers"):
            return v or ""
        return v or None

    fields = tuple(_v(c) for c in cols)

    existing = db_one("SELECT id FROM crm_sms_settings WHERE project_id=%s", (project_id,))
    with db_cursor() as (conn, cur):
        if existing:
            set_clause = ", ".join(f"{c}=%s" for c in cols)
            cur.execute(
                f"UPDATE crm_sms_settings SET {set_clause} WHERE project_id=%s",
                fields + (project_id,),
            )
        else:
            placeholders = ",".join(["%s"] * (len(cols) + 1))
            cur.execute(
                f"INSERT INTO crm_sms_settings ({', '.join(cols)}, project_id) VALUES ({placeholders})",
                fields + (project_id,),
            )
        conn.commit()
    return {"ok": True}


@app.delete("/api/sms-settings")
def delete_sms_settings(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM crm_sms_settings WHERE project_id=%s", (project_id,))
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════
# URL CONFIGURATION
# ════════════════════════════════════════════

@app.get("/api/url-config")
def get_url_config(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one("SELECT frontend_url FROM crm_url_config WHERE project_id=%s", (project_id,))
    return {"frontend_url": row["frontend_url"] if row else ""}


@app.put("/api/url-config")
def save_url_config(req: UrlConfigRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    url = req.frontend_url.strip()
    if url and not url.startswith(("http://", "https://")):
        raise HTTPException(400, "URL must start with http:// or https://")
    existing = db_one("SELECT id FROM crm_url_config WHERE project_id=%s", (project_id,))
    with db_cursor() as (conn, cur):
        if existing:
            cur.execute("UPDATE crm_url_config SET frontend_url=%s WHERE project_id=%s", (url or None, project_id))
        else:
            cur.execute("INSERT INTO crm_url_config (project_id, frontend_url) VALUES (%s,%s)", (project_id, url or None))
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════
# REDIRECT URLs
# ════════════════════════════════════════════

@app.get("/api/redirect-urls")
def get_redirect_urls(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    rows = db_all("SELECT id, url FROM crm_redirect_urls WHERE project_id=%s ORDER BY id ASC", (project_id,))
    return {"urls": rows}


@app.post("/api/redirect-urls")
def add_redirect_url(req: AddRedirectUrlRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    url = req.url.strip()
    if not url:                                          raise HTTPException(400, "URL is required")
    if not url.startswith(("http://", "https://")):      raise HTTPException(400, "URL must start with http:// or https://")
    if len(url) > 500:                                   raise HTTPException(400, "URL too long")
    if db_one("SELECT id FROM crm_redirect_urls WHERE project_id=%s AND url=%s", (project_id, url)):
        raise HTTPException(400, "URL already in the list")
    with db_cursor() as (conn, cur):
        cur.execute("INSERT INTO crm_redirect_urls (project_id, url) VALUES (%s,%s) RETURNING id", (project_id, url))
        new_id = cur.fetchone()["id"]
        conn.commit()
        return {"ok": True, "id": new_id, "url": url}


@app.delete("/api/redirect-urls/{url_id}")
def delete_redirect_url(url_id: int, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if not db_one("SELECT id FROM crm_redirect_urls WHERE id=%s AND project_id=%s", (url_id, project_id)):
        raise HTTPException(404, "URL not found")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM crm_redirect_urls WHERE id=%s", (url_id,))
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════
# ЗАКАЗЫ
# ════════════════════════════════════════════

ORDER_STATUSES = ["new", "confirmed", "shipped", "delivered", "cancelled", "refunded"]

class UpdateOrderStatus(BaseModel):
    status: str

@app.get("/api/orders")
def get_orders(project_id: int = Query(...),
               status: Optional[str] = Query(None),
               user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    where = "WHERE oh.project_id=%s"
    params: list = [project_id]
    if status and status in ORDER_STATUSES:
        where += " AND oh.status=%s"
        params.append(status)

    orders = db_all(
        f"""SELECT oh.id, oh.total_amount, oh.status, oh.delivery_method,
                   oh.recipient_name, oh.phone, oh.address, oh.comment,
                   oh.payment_method, oh.created_at, oh.updated_at,
                   u.name AS customer_name, u.email AS customer_email,
                   (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=oh.id) AS items_count
            FROM order_history oh
            LEFT JOIN users u ON oh.user_id=u.id
            {where}
            ORDER BY oh.created_at DESC
            LIMIT 200""",
        tuple(params)
    )
    return [
        {
            "id":              o["id"],
            "total_amount":    o["total_amount"],
            "status":          o["status"],
            "delivery_method": o["delivery_method"],
            "recipient_name":  o["recipient_name"],
            "phone":           o["phone"],
            "address":         o["address"],
            "comment":         o["comment"],
            "payment_method":  o["payment_method"],
            "items_count":     o["items_count"],
            "customer_name":   o["customer_name"],
            "customer_email":  o["customer_email"],
            "created_at":      o["created_at"].isoformat() if o["created_at"] else None,
            "updated_at":      o["updated_at"].isoformat() if o["updated_at"] else None,
        }
        for o in orders
    ]


@app.get("/api/orders/stats")
def get_orders_stats(project_id: int = Query(...),
                     user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)

    # One query for counters + revenue
    summary = db_one(
        """SELECT
             COUNT(*) FILTER (WHERE status = 'new')              AS new_count,
             COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)  AS today_orders,
             COALESCE(SUM(total_amount) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS today_revenue
           FROM order_history
           WHERE project_id = %s""",
        (project_id,)
    )
    recent = db_all(
        """SELECT oh.id, oh.total_amount, oh.status, oh.recipient_name, oh.created_at,
                  u.name AS customer_name
           FROM order_history oh
           LEFT JOIN users u ON oh.user_id=u.id
           WHERE oh.project_id=%s
           ORDER BY oh.created_at DESC LIMIT 5""",
        (project_id,)
    )
    return {
        "new_count":     int(summary["new_count"])     if summary else 0,
        "today_orders":  int(summary["today_orders"])  if summary else 0,
        "today_revenue": float(summary["today_revenue"]) if summary else 0,
        "recent":        [
            {
                "id":            r["id"],
                "total_amount":  r["total_amount"],
                "status":        r["status"],
                "recipient_name": r["recipient_name"],
                "customer_name": r["customer_name"],
                "created_at":    r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in recent
        ],
    }


@app.get("/api/orders/stream")
async def stream_orders(project_id: int = Query(...),
                        user: dict = Depends(get_current_user)):
    """SSE: 3-second poll. Fires when new_count OR max order id changes.
    Tracks max id so a new order is always detected even if new_count stays equal."""
    require_team_member_or_owner(user, project_id)

    async def generator():
        last_count   = -1
        last_max_id  = -1
        try:
            while True:
                row = db_one(
                    """SELECT COUNT(*) FILTER (WHERE status='new') AS new_count,
                              COALESCE(MAX(id), 0)                  AS max_id
                       FROM order_history WHERE project_id=%s""",
                    (project_id,)
                )
                count  = int(row["new_count"]) if row else 0
                max_id = int(row["max_id"])     if row else 0
                if count != last_count or max_id != last_max_id:
                    last_count  = count
                    last_max_id = max_id
                    yield f"data: {json.dumps({'new_count': count, 'last_id': max_id})}\n\n"
                await asyncio.sleep(3)
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/orders/{order_id}")
def get_order(order_id: int, project_id: int = Query(...),
              user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    o = db_one(
        """SELECT oh.*, u.name AS customer_name, u.email AS customer_email
           FROM order_history oh
           LEFT JOIN users u ON oh.user_id=u.id
           WHERE oh.id=%s AND oh.project_id=%s""",
        (order_id, project_id)
    )
    if not o:
        raise HTTPException(404, "Order not found")

    items = db_all(
        """SELECT oi.quantity, oi.price,
                  p.title, pv.variation_name, pv.image_url, ps.size_name
           FROM order_items oi
           JOIN products p ON oi.product_id=p.id
           JOIN product_variations pv ON oi.variation_id=pv.id
           JOIN product_sizes ps ON oi.size_id=ps.id
           WHERE oi.order_id=%s""",
        (order_id,)
    )
    return {
        **{k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in dict(o).items()},
        "items": [
            {
                "title":          it["title"],
                "variation_name": it["variation_name"],
                "size_name":      it["size_name"],
                "image_url":      it["image_url"],
                "quantity":       it["quantity"],
                "price":          float(it["price"]),
            }
            for it in items
        ],
    }


@app.patch("/api/orders/{order_id}")
def update_order_status(order_id: int, body: UpdateOrderStatus,
                        project_id: int = Query(...),
                        user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if body.status not in ORDER_STATUSES:
        raise HTTPException(400, f"Invalid status. Allowed: {ORDER_STATUSES}")
    o = db_one("SELECT id, status FROM order_history WHERE id=%s AND project_id=%s",
               (order_id, project_id))
    if not o:
        raise HTTPException(404, "Order not found")

    extra_sql = ""
    if body.status == "delivered":
        extra_sql = ", delivered_at = CURRENT_TIMESTAMP"

    with db_cursor() as (conn, cur):
        cur.execute(
            f"UPDATE order_history SET status=%s, updated_at=CURRENT_TIMESTAMP{extra_sql} "
            "WHERE id=%s AND project_id=%s",
            (body.status, order_id, project_id)
        )
        conn.commit()

    return {"ok": True, "status": body.status}


# ════════════════════════════════════════════
# CHAT WITH CUSTOMERS
# ════════════════════════════════════════════

# Real-time channels (work on localhost without HTTPS):
#   telegram — long-poll getUpdates
#   discord  — Gateway WebSocket
#   vk       — Long Poll for groups
#   webchat  — embedded support widget on the client's own website
#
# Webhook channels (require public HTTPS, work in production):
#   whatsapp / instagram / facebook — Meta Graph API webhooks
#   viber                           — Viber Bot API webhook
#   x                               — X (Twitter) Account Activity API webhook
CHAT_CHANNELS = {
    "telegram", "discord", "vk", "webchat",
    "whatsapp", "instagram", "facebook", "viber", "x",
}
CHAT_REALTIME_CHANNELS = {"telegram", "discord", "vk", "webchat"}
CHAT_WEBHOOK_CHANNELS  = {"whatsapp", "instagram", "facebook", "viber", "x"}

# Per-channel required config keys for validation
CHAT_REQUIRED_KEYS: dict[str, tuple] = {
    "telegram":  ("bot_token",),
    "discord":   ("bot_token",),
    "vk":        ("group_id", "access_token"),
    "webchat":   (),  # no credentials — uses project's existing api_key
    "whatsapp":  ("phone_number_id", "access_token", "verify_token"),
    "instagram": ("page_id", "access_token", "verify_token"),
    "facebook":  ("page_id", "access_token", "verify_token"),
    "viber":     ("auth_token",),
    "x":         ("bearer_token",),
}


def make_contact_uid(channel: str, external_chat_id: str, project_id: int) -> str:
    """Stable, anonymous, project-scoped 10-hex public id (e.g. u_a8f3d2b14c)."""
    raw = f"{project_id}|{channel}|{external_chat_id}".encode()
    return "u_" + hashlib.sha256(raw).hexdigest()[:10]


class ChatHub:
    """Per-project WebSocket subscriber registry. Broadcasts chat events."""
    def __init__(self):
        self._subs: dict[int, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, project_id: int, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._subs.setdefault(project_id, set()).add(ws)

    async def disconnect(self, project_id: int, ws: WebSocket):
        async with self._lock:
            subs = self._subs.get(project_id)
            if subs:
                subs.discard(ws)
                if not subs:
                    self._subs.pop(project_id, None)

    async def broadcast(self, project_id: int, event: dict):
        subs = list(self._subs.get(project_id, ()))
        payload = json.dumps(event)
        dead = []
        for ws in subs:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                cur = self._subs.get(project_id)
                if cur:
                    for w in dead:
                        cur.discard(w)


chat_hub = ChatHub()


# ── Generic inbound-message handler (channel-agnostic) ────────────────────────

async def _handle_inbound_message(project_id: int, channel: str,
                                  external_chat_id: str, text: str,
                                  external_msg_id: str = ""):
    """Channel-agnostic inbound message handler.
    Upserts conversation + inserts message + broadcasts via WebSocket."""
    if not external_chat_id or not text:
        return

    contact_uid = make_contact_uid(channel, external_chat_id, project_id)
    preview     = sanitize(text[:200])
    safe_text   = sanitize(text[:4000])

    loop = asyncio.get_event_loop()

    def _upsert():
        with db_cursor() as (conn, cur):
            cur.execute(
                """INSERT INTO crm_chat_conversations
                       (project_id, channel, external_chat_id, contact_uid,
                        is_active, unread_count, last_message_at, last_message_preview)
                   VALUES (%s, %s, %s, %s, TRUE, 1, CURRENT_TIMESTAMP, %s)
                   ON CONFLICT (project_id, channel, external_chat_id) DO UPDATE SET
                       is_active = TRUE,
                       unread_count = crm_chat_conversations.unread_count + 1,
                       last_message_at = CURRENT_TIMESTAMP,
                       last_message_preview = EXCLUDED.last_message_preview
                   RETURNING id, channel, external_chat_id, contact_uid, is_active,
                             unread_count, last_message_at, last_message_preview, created_at""",
                (project_id, channel, external_chat_id, contact_uid, preview)
            )
            conv = cur.fetchone()
            cur.execute(
                """INSERT INTO crm_chat_messages (conversation_id, direction, text, external_msg_id)
                   VALUES (%s, 'in', %s, %s)
                   RETURNING id, conversation_id, direction, text, sender_user_id, created_at""",
                (conv["id"], safe_text, str(external_msg_id))
            )
            message = cur.fetchone()
            conn.commit()
        return conv, message

    conv, message = await loop.run_in_executor(None, _upsert)
    await chat_hub.broadcast(project_id, {
        "type":         "message.created",
        "conversation": _serialize_conv(conv),
        "message":      _serialize_msg(message),
    })


# ── Telegram long-poll background poller (works on localhost without HTTPS) ───

async def _process_telegram_update(project_id: int, update: dict):
    """Handle one Telegram update: upsert conversation + message, broadcast."""
    msg = update.get("message") or update.get("edited_message")
    if not msg:
        return
    chat = msg.get("chat") or {}
    external_chat_id = str(chat.get("id", ""))
    text = (msg.get("text") or msg.get("caption") or "").strip()
    await _handle_inbound_message(
        project_id, "telegram", external_chat_id, text,
        external_msg_id=str(msg.get("message_id", "")),
    )


class TelegramPoller:
    """Long-poll getUpdates per project. Auto-started on bot connect."""

    def __init__(self):
        self._tasks: dict[int, asyncio.Task] = {}

    async def start(self, project_id: int, token: str):
        await self.stop(project_id)
        task = asyncio.create_task(self._poll_loop(project_id, token))
        self._tasks[project_id] = task
        print(f"[telegram poller] started for project {project_id}")

    async def stop(self, project_id: int):
        task = self._tasks.pop(project_id, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            print(f"[telegram poller] stopped for project {project_id}")

    async def start_all(self):
        """Called on server startup — resumes polling for all active bots."""
        loop = asyncio.get_event_loop()
        rows = await loop.run_in_executor(
            None,
            lambda: db_all(
                "SELECT project_id, config FROM crm_chat_integrations WHERE channel='telegram' AND is_active=TRUE",
                ()
            )
        )
        for row in rows:
            token = (row["config"] or {}).get("bot_token")
            if token:
                await self.start(row["project_id"], token)

    async def _poll_loop(self, project_id: int, token: str):
        offset = 0
        loop = asyncio.get_event_loop()
        while True:
            try:
                result = await loop.run_in_executor(
                    None,
                    lambda: _telegram_call_timeout(token, "getUpdates", {
                        "offset":          offset,
                        "timeout":         25,
                        "allowed_updates": ["message"],
                    }, timeout=30)
                )
                if result.get("ok"):
                    for upd in result.get("result", []):
                        offset = upd["update_id"] + 1
                        try:
                            await _process_telegram_update(project_id, upd)
                        except Exception as e:
                            print(f"[telegram poller] process error: {e}")
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[telegram poller] poll error project={project_id}: {e}")
                await asyncio.sleep(5)


telegram_poller = TelegramPoller()


# ── Discord Gateway WebSocket poller (works on localhost without HTTPS) ───────

class DiscordPoller:
    """Connects to Discord Gateway via WebSocket. Receives DMs in real-time.

    Required intents: DIRECT_MESSAGES (4096) + MESSAGE_CONTENT (32768) = 36864.
    For DMs the MESSAGE_CONTENT intent must be enabled in the bot's Developer Portal."""

    GATEWAY_URL    = "wss://gateway.discord.gg/?v=10&encoding=json"
    DM_INTENTS     = (1 << 12) | (1 << 15)  # DIRECT_MESSAGES + MESSAGE_CONTENT

    def __init__(self):
        self._tasks: dict[int, asyncio.Task] = {}
        self._bot_ids: dict[int, str]        = {}

    async def start(self, project_id: int, token: str):
        await self.stop(project_id)
        task = asyncio.create_task(self._run(project_id, token))
        self._tasks[project_id] = task
        print(f"[discord poller] started for project {project_id}")

    async def stop(self, project_id: int):
        task = self._tasks.pop(project_id, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            print(f"[discord poller] stopped for project {project_id}")
        self._bot_ids.pop(project_id, None)

    async def start_all(self):
        loop = asyncio.get_event_loop()
        rows = await loop.run_in_executor(
            None,
            lambda: db_all(
                "SELECT project_id, config FROM crm_chat_integrations WHERE channel='discord' AND is_active=TRUE",
                ()
            )
        )
        for row in rows:
            token = (row["config"] or {}).get("bot_token")
            if token:
                await self.start(row["project_id"], token)

    async def _run(self, project_id: int, token: str):
        try:
            import websockets
        except ImportError:
            print("[discord poller] websockets library missing — install uvicorn[standard]")
            return

        try:
            while True:
                try:
                    async with websockets.connect(self.GATEWAY_URL, max_size=10 * 1024 * 1024) as ws:
                        hello = json.loads(await ws.recv())
                        heartbeat_ms = hello["d"]["heartbeat_interval"]

                        # IDENTIFY
                        await ws.send(json.dumps({
                            "op": 2,
                            "d": {
                                "token":   token,
                                "intents": self.DM_INTENTS,
                                "properties": {
                                    "os": "linux", "browser": "torta-crm", "device": "torta-crm",
                                },
                            },
                        }))

                        # heartbeat task
                        async def hb():
                            while True:
                                await asyncio.sleep(heartbeat_ms / 1000)
                                await ws.send(json.dumps({"op": 1, "d": None}))

                        hb_task = asyncio.create_task(hb())
                        try:
                            async for raw in ws:
                                try:
                                    evt = json.loads(raw)
                                except Exception:
                                    continue
                                op = evt.get("op")
                                if op == 0:
                                    t = evt.get("t")
                                    d = evt.get("d") or {}
                                    if t == "READY":
                                        bot_user = (d.get("user") or {}).get("id")
                                        if bot_user:
                                            self._bot_ids[project_id] = str(bot_user)
                                    elif t == "MESSAGE_CREATE":
                                        await self._on_message(project_id, d)
                                elif op == 11:
                                    pass  # heartbeat ack
                                elif op == 7 or op == 9:
                                    break  # need to reconnect
                        finally:
                            hb_task.cancel()
                            try: await hb_task
                            except asyncio.CancelledError: pass
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    print(f"[discord poller] WS error project={project_id}: {e}")
                    await asyncio.sleep(5)
        except asyncio.CancelledError:
            return

    async def _on_message(self, project_id: int, msg: dict):
        # Only handle DMs (no guild_id) to keep scope private/anonymous
        if msg.get("guild_id"):
            return
        author = msg.get("author") or {}
        if author.get("bot"):
            return
        bot_id = self._bot_ids.get(project_id)
        if bot_id and str(author.get("id")) == bot_id:
            return
        external_chat_id = str(msg.get("channel_id", ""))
        text = (msg.get("content") or "").strip()
        await _handle_inbound_message(
            project_id, "discord", external_chat_id, text,
            external_msg_id=str(msg.get("id", "")),
        )


discord_poller = DiscordPoller()


def _discord_call(token: str, method: str, path: str, payload: dict | None = None) -> dict:
    """Synchronous Discord REST API call."""
    url  = f"https://discord.com/api/v10{path}"
    body = json.dumps(payload).encode() if payload is not None else None
    req  = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": f"Bot {token}",
        "Content-Type":  "application/json",
        "User-Agent":    "torta-crm (https://tortacrm.com, 1.0)",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            return json.loads(data) if data else {}
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read())
        except Exception:
            detail = {"message": str(e)}
        raise HTTPException(e.code, detail.get("message", "Discord error"))
    except Exception as e:
        raise HTTPException(503, f"Discord unreachable: {e}")


# ── VK Long Poll for groups (works on localhost without HTTPS) ────────────────

class VKPoller:
    """VK Bots Long Poll — receives messages sent to a community.

    Requires:
      - group_id      (numeric VK group/community id)
      - access_token  (group token with `messages` scope, generated in group settings)
    Group settings → API usage → Long Poll API → Enabled, version 5.131."""

    API_BASE = "https://api.vk.com/method"
    API_VER  = "5.131"

    def __init__(self):
        self._tasks: dict[int, asyncio.Task] = {}

    async def start(self, project_id: int, group_id: str, token: str):
        await self.stop(project_id)
        task = asyncio.create_task(self._run(project_id, group_id, token))
        self._tasks[project_id] = task
        print(f"[vk poller] started for project {project_id}")

    async def stop(self, project_id: int):
        task = self._tasks.pop(project_id, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            print(f"[vk poller] stopped for project {project_id}")

    async def start_all(self):
        loop = asyncio.get_event_loop()
        rows = await loop.run_in_executor(
            None,
            lambda: db_all(
                "SELECT project_id, config FROM crm_chat_integrations WHERE channel='vk' AND is_active=TRUE",
                ()
            )
        )
        for row in rows:
            cfg = row["config"] or {}
            gid, tok = cfg.get("group_id"), cfg.get("access_token")
            if gid and tok:
                await self.start(row["project_id"], str(gid), tok)

    def _api(self, token: str, method: str, params: dict) -> dict:
        params = {**params, "access_token": token, "v": self.API_VER}
        url = f"{self.API_BASE}/{method}"
        body = urllib.parse.urlencode(params).encode()
        req = urllib.request.Request(url, data=body, method="POST")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())

    async def _run(self, project_id: int, group_id: str, token: str):
        loop = asyncio.get_event_loop()
        try:
            while True:
                try:
                    server_info = await loop.run_in_executor(
                        None,
                        lambda: self._api(token, "groups.getLongPollServer", {"group_id": group_id})
                    )
                    if "response" not in server_info:
                        err = server_info.get("error", {}).get("error_msg", "unknown")
                        print(f"[vk poller] cannot get LP server project={project_id}: {err}")
                        await asyncio.sleep(15)
                        continue

                    lp     = server_info["response"]
                    server = lp["server"]
                    key    = lp["key"]
                    ts     = lp["ts"]

                    while True:
                        url    = f"{server}?act=a_check&key={key}&ts={ts}&wait=25"
                        result = await loop.run_in_executor(
                            None,
                            lambda u=url: json.loads(urllib.request.urlopen(u, timeout=30).read())
                        )
                        if "failed" in result:
                            # 1: ts outdated → use new ts; 2/3: re-fetch server info
                            if result["failed"] == 1 and "ts" in result:
                                ts = result["ts"]; continue
                            break  # break inner loop, refetch LP server
                        ts = result.get("ts", ts)
                        for upd in result.get("updates", []):
                            if upd.get("type") != "message_new":
                                continue
                            msg = (upd.get("object") or {}).get("message") or {}
                            external_chat_id = str(msg.get("peer_id", ""))
                            text = (msg.get("text") or "").strip()
                            try:
                                await _handle_inbound_message(
                                    project_id, "vk", external_chat_id, text,
                                    external_msg_id=str(msg.get("id", "")),
                                )
                            except Exception as e:
                                print(f"[vk poller] process error: {e}")
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    print(f"[vk poller] error project={project_id}: {e}")
                    await asyncio.sleep(5)
        except asyncio.CancelledError:
            return


vk_poller = VKPoller()


def _vk_call(token: str, method: str, params: dict) -> dict:
    """Synchronous VK API call (validation, send, etc.)."""
    full = {**params, "access_token": token, "v": VKPoller.API_VER}
    url  = f"{VKPoller.API_BASE}/{method}"
    body = urllib.parse.urlencode(full).encode()
    req  = urllib.request.Request(url, data=body, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        raise HTTPException(503, f"VK unreachable: {e}")


# ── Meta Graph API helpers (WhatsApp / Instagram / Facebook) ──────────────────

def _meta_call(method: str, path: str, access_token: str,
               payload: dict | None = None, params: dict | None = None) -> dict:
    """Synchronous Meta Graph API call. Used to send messages."""
    qs = urllib.parse.urlencode({**(params or {}), "access_token": access_token})
    url = f"https://graph.facebook.com/v20.0{path}?{qs}"
    body = json.dumps(payload).encode() if payload is not None else None
    req  = urllib.request.Request(url, data=body, method=method, headers={
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read())
        except Exception:
            detail = {"error": {"message": str(e)}}
        msg = ((detail.get("error") or {}).get("message")) or "Meta API error"
        raise HTTPException(e.code, msg)
    except Exception as e:
        raise HTTPException(503, f"Meta unreachable: {e}")


# ── Viber Bot API helpers ─────────────────────────────────────────────────────

def _viber_call(method: str, auth_token: str, payload: dict) -> dict:
    """Synchronous Viber Bot API call."""
    url = f"https://chatapi.viber.com/pa/{method}"
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type":         "application/json",
        "X-Viber-Auth-Token":   auth_token,
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read())
        except Exception:
            detail = {"status_message": str(e)}
        raise HTTPException(e.code, detail.get("status_message", "Viber error"))
    except Exception as e:
        raise HTTPException(503, f"Viber unreachable: {e}")


# ── Startup: resume all real-time pollers ─────────────────────────────────────

@app.on_event("startup")
async def start_telegram_polling():
    await telegram_poller.start_all()


@app.on_event("startup")
async def start_discord_polling():
    await discord_poller.start_all()


@app.on_event("startup")
async def start_vk_polling():
    await vk_poller.start_all()


def _user_from_token(token: str) -> dict | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "crm":
            return None
        user_id = int(payload["sub"])
    except Exception:
        return None
    return db_one("SELECT id, name, email, role FROM crm_users WHERE id = %s AND is_active = TRUE", (user_id,))


def _telegram_call_timeout(token: str, method: str, payload: dict, timeout: int = 15) -> dict:
    """Synchronous Telegram Bot API call with configurable timeout."""
    url = f"https://api.telegram.org/bot{token}/{method}"
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read())
        except Exception:
            detail = {"description": str(e)}
        raise HTTPException(e.code, detail.get("description", "Telegram error"))
    except Exception as e:
        raise HTTPException(503, f"Telegram unreachable: {e}")


def _telegram_call(token: str, method: str, payload: dict) -> dict:
    return _telegram_call_timeout(token, method, payload, timeout=15)


def _serialize_conv(row: dict) -> dict:
    return {
        "id":               row["id"],
        "channel":          row["channel"],
        "contact_uid":      row["contact_uid"],
        "external_chat_id": row["external_chat_id"],
        "is_active":        row["is_active"],
        "unread_count":     row["unread_count"],
        "last_message_at":  row["last_message_at"].isoformat() if row.get("last_message_at") else None,
        "last_message_preview": row.get("last_message_preview", ""),
        "created_at":       row["created_at"].isoformat() if row.get("created_at") else None,
    }


def _serialize_msg(row: dict) -> dict:
    return {
        "id":              row["id"],
        "conversation_id": row["conversation_id"],
        "direction":       row["direction"],
        "text":            row["text"],
        "sender_user_id":  row.get("sender_user_id"),
        "created_at":      row["created_at"].isoformat() if row.get("created_at") else None,
    }


# ── Integrations ──────────────────────────────────────────────────────────────

@app.get("/api/chat/integrations")
def list_chat_integrations(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    rows = db_all(
        "SELECT id, channel, is_active, bot_username, created_at FROM crm_chat_integrations WHERE project_id=%s",
        (project_id,)
    )
    return {
        "integrations": [{
            "id":           r["id"],
            "channel":      r["channel"],
            "is_active":    r["is_active"],
            "bot_username": r["bot_username"],
            "created_at":   r["created_at"].isoformat() if r["created_at"] else None,
        } for r in rows]
    }


@app.post("/api/chat/integrations")
async def save_chat_integration(req: ChatIntegrationRequest,
                                project_id: int = Query(...),
                                user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    channel = req.channel.lower().strip()
    if channel not in CHAT_CHANNELS:
        raise HTTPException(400, "Unsupported channel")

    raw = req.config or {}
    required = CHAT_REQUIRED_KEYS.get(channel, ())
    missing  = [k for k in required if not str(raw.get(k, "")).strip()]
    if missing:
        raise HTTPException(400, f"Missing fields: {', '.join(missing)}")

    bot_username = None
    config       = {k: str(v).strip() for k, v in raw.items() if isinstance(v, (str, int))}
    loop         = asyncio.get_event_loop()

    # ── Per-channel validation + setup ────────────────────────────────────────
    if channel == "telegram":
        token = config["bot_token"]
        if ":" not in token:
            raise HTTPException(400, "Invalid bot token format")
        info = await loop.run_in_executor(None, lambda: _telegram_call(token, "getMe", {}))
        if not info.get("ok"):
            raise HTTPException(400, "Telegram rejected the token")
        bot_username = info["result"].get("username")
        try:
            await loop.run_in_executor(None,
                lambda: _telegram_call(token, "deleteWebhook", {"drop_pending_updates": True}))
        except Exception:
            pass

    elif channel == "discord":
        token = config["bot_token"]
        info = await loop.run_in_executor(None,
            lambda: _discord_call(token, "GET", "/users/@me"))
        username = info.get("username")
        if not username:
            raise HTTPException(400, "Discord rejected the token")
        bot_username = username + (f"#{info['discriminator']}" if info.get("discriminator") and info["discriminator"] != "0" else "")

    elif channel == "vk":
        token   = config["access_token"]
        gid     = config["group_id"]
        info    = await loop.run_in_executor(None,
            lambda: _vk_call(token, "groups.getById", {"group_id": gid}))
        if "error" in info:
            raise HTTPException(400, info["error"].get("error_msg", "VK rejected the token"))
        groups = info.get("response") or []
        if not groups:
            raise HTTPException(400, "VK group not found")
        bot_username = groups[0].get("name") or groups[0].get("screen_name")

    elif channel in ("whatsapp", "instagram", "facebook"):
        token = config["access_token"]
        # Validate token by hitting /me
        try:
            info = await loop.run_in_executor(None,
                lambda: _meta_call("GET", "/me", token, params={"fields": "id,name"}))
            bot_username = info.get("name") or info.get("id")
        except HTTPException as e:
            raise HTTPException(400, f"Meta API rejected the token: {e.detail}")

    elif channel == "viber":
        token = config["auth_token"]
        info  = await loop.run_in_executor(None,
            lambda: _viber_call("get_account_info", token, {}))
        if info.get("status") != 0:
            raise HTTPException(400, info.get("status_message", "Viber rejected the token"))
        bot_username = info.get("name") or info.get("uri")

    elif channel == "webchat":
        # No external credentials — the website widget uses the project's existing
        # public api_key + publishable_key (already validated by External API).
        proj = await loop.run_in_executor(
            None, lambda: db_one("SELECT name FROM crm_projects WHERE id=%s", (project_id,))
        )
        bot_username = (proj or {}).get("name") or "Web chat"

    elif channel == "x":
        # X (Twitter) Account Activity API webhook — credentials are stored;
        # actual subscription must be registered through dev portal manually.
        bot_username = config.get("handle") or "X account"

    # ── Persist ───────────────────────────────────────────────────────────────
    def _save():
        with db_cursor() as (conn, cur):
            cur.execute("""
                INSERT INTO crm_chat_integrations (project_id, channel, config, is_active, bot_username)
                VALUES (%s, %s, %s::jsonb, %s, %s)
                ON CONFLICT (project_id, channel) DO UPDATE SET
                    config=EXCLUDED.config, is_active=EXCLUDED.is_active, bot_username=EXCLUDED.bot_username
            """, (project_id, channel, json.dumps(config), req.is_active, bot_username))
            conn.commit()

    await loop.run_in_executor(None, _save)

    # ── Start real-time pollers ───────────────────────────────────────────────
    if req.is_active:
        if channel == "telegram":
            await telegram_poller.start(project_id, config["bot_token"])
        elif channel == "discord":
            await discord_poller.start(project_id, config["bot_token"])
        elif channel == "vk":
            await vk_poller.start(project_id, config["group_id"], config["access_token"])

    # ── Return webhook URL hint for webhook-only channels ─────────────────────
    extra: dict = {}
    if channel in CHAT_WEBHOOK_CHANNELS:
        extra["webhook_url"] = f"{CRM_BACKEND_URL}/api/chat/webhook/{channel}/{project_id}"
        if channel in ("whatsapp", "instagram", "facebook"):
            extra["verify_token"] = config.get("verify_token", "")

    return {"ok": True, "bot_username": bot_username, **extra}


@app.delete("/api/chat/integrations/{channel}")
async def delete_chat_integration(channel: str,
                                  project_id: int = Query(...),
                                  user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    channel = channel.lower().strip()
    if channel not in CHAT_CHANNELS:
        raise HTTPException(400, "Unsupported channel")
    loop = asyncio.get_event_loop()

    row = await loop.run_in_executor(
        None, lambda: db_one("SELECT config FROM crm_chat_integrations WHERE project_id=%s AND channel=%s",
                              (project_id, channel))
    )

    # ── Stop real-time pollers ────────────────────────────────────────────────
    if channel == "telegram":
        await telegram_poller.stop(project_id)
        if row:
            token = (row["config"] or {}).get("bot_token")
            if token:
                try:
                    await loop.run_in_executor(None, lambda: _telegram_call(token, "deleteWebhook", {}))
                except Exception:
                    pass
    elif channel == "discord":
        await discord_poller.stop(project_id)
    elif channel == "vk":
        await vk_poller.stop(project_id)

    # ── Persist ───────────────────────────────────────────────────────────────
    def _delete():
        with db_cursor() as (conn, cur):
            cur.execute("DELETE FROM crm_chat_integrations WHERE project_id=%s AND channel=%s",
                        (project_id, channel))
            conn.commit()

    await loop.run_in_executor(None, _delete)
    return {"ok": True}


# ── Conversations ─────────────────────────────────────────────────────────────

@app.get("/api/chat/conversations")
def list_conversations(project_id: int = Query(...),
                       user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    rows = db_all(
        """SELECT id, channel, external_chat_id, contact_uid, is_active,
                  unread_count, last_message_at, last_message_preview, created_at
           FROM crm_chat_conversations
           WHERE project_id=%s
           ORDER BY (last_message_at IS NULL), last_message_at DESC, id DESC""",
        (project_id,)
    )
    return {"conversations": [_serialize_conv(r) for r in rows]}


@app.post("/api/chat/conversations/{conv_id}/close")
async def close_conversation(conv_id: int,
                             project_id: int = Query(...),
                             user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE crm_chat_conversations SET is_active=FALSE WHERE id=%s AND project_id=%s",
                    (conv_id, project_id))
        conn.commit()
    await chat_hub.broadcast(project_id, {"type": "conversation.closed", "conversation_id": conv_id})
    return {"ok": True}


@app.post("/api/chat/conversations/{conv_id}/reopen")
async def reopen_conversation(conv_id: int,
                              project_id: int = Query(...),
                              user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE crm_chat_conversations SET is_active=TRUE WHERE id=%s AND project_id=%s",
                    (conv_id, project_id))
        conn.commit()
    await chat_hub.broadcast(project_id, {"type": "conversation.reopened", "conversation_id": conv_id})
    return {"ok": True}


@app.post("/api/chat/conversations/{conv_id}/read")
def mark_conversation_read(conv_id: int,
                           project_id: int = Query(...),
                           user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE crm_chat_conversations SET unread_count=0 WHERE id=%s AND project_id=%s",
                    (conv_id, project_id))
        conn.commit()
    return {"ok": True}


# ── Messages ──────────────────────────────────────────────────────────────────

@app.get("/api/chat/conversations/{conv_id}/messages")
def list_messages(conv_id: int,
                  project_id: int = Query(...),
                  user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    conv = db_one("SELECT id FROM crm_chat_conversations WHERE id=%s AND project_id=%s",
                  (conv_id, project_id))
    if not conv:
        raise HTTPException(404, "Conversation not found")
    rows = db_all(
        """SELECT id, conversation_id, direction, text, sender_user_id, created_at
           FROM crm_chat_messages
           WHERE conversation_id=%s
           ORDER BY id ASC""",
        (conv_id,)
    )
    return {"messages": [_serialize_msg(r) for r in rows]}


@app.post("/api/chat/conversations/{conv_id}/messages")
async def send_message(conv_id: int,
                       body: ChatSendRequest,
                       project_id: int = Query(...),
                       user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "Empty message")
    if len(text) > 4000:
        raise HTTPException(400, "Message too long")

    conv = db_one(
        """SELECT id, channel, external_chat_id, is_active
           FROM crm_chat_conversations WHERE id=%s AND project_id=%s""",
        (conv_id, project_id)
    )
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if not conv["is_active"]:
        raise HTTPException(400, "Conversation is closed")

    integ = db_one(
        "SELECT config FROM crm_chat_integrations WHERE project_id=%s AND channel=%s AND is_active=TRUE",
        (project_id, conv["channel"])
    )
    if not integ:
        raise HTTPException(400, "Channel not configured")

    external_msg_id = None
    cfg = integ["config"] or {}
    ch  = conv["channel"]
    chat_id = conv["external_chat_id"]

    if ch == "telegram":
        token = cfg.get("bot_token")
        if not token:
            raise HTTPException(400, "Telegram token missing")
        result = _telegram_call(token, "sendMessage", {"chat_id": chat_id, "text": text})
        if result.get("ok") and result.get("result"):
            external_msg_id = str(result["result"].get("message_id", ""))

    elif ch == "discord":
        token = cfg.get("bot_token")
        if not token:
            raise HTTPException(400, "Discord token missing")
        result = _discord_call(token, "POST", f"/channels/{chat_id}/messages", {"content": text})
        external_msg_id = str(result.get("id", ""))

    elif ch == "vk":
        token = cfg.get("access_token")
        if not token:
            raise HTTPException(400, "VK token missing")
        result = _vk_call(token, "messages.send", {
            "peer_id":   chat_id,
            "message":   text,
            "random_id": secrets.randbits(31),
        })
        if "error" in result:
            raise HTTPException(400, result["error"].get("error_msg", "VK send failed"))
        external_msg_id = str(result.get("response", ""))

    elif ch == "whatsapp":
        token = cfg.get("access_token")
        phone = cfg.get("phone_number_id")
        if not token or not phone:
            raise HTTPException(400, "WhatsApp not configured")
        result = _meta_call("POST", f"/{phone}/messages", token, payload={
            "messaging_product": "whatsapp",
            "to":                chat_id,
            "type":              "text",
            "text":              {"body": text},
        })
        msgs = result.get("messages") or []
        if msgs:
            external_msg_id = msgs[0].get("id", "")

    elif ch in ("instagram", "facebook"):
        token = cfg.get("access_token")
        page  = cfg.get("page_id")
        if not token or not page:
            raise HTTPException(400, f"{ch.title()} not configured")
        result = _meta_call("POST", f"/{page}/messages", token, payload={
            "recipient": {"id": chat_id},
            "message":   {"text": text},
            "messaging_type": "RESPONSE",
        })
        external_msg_id = result.get("message_id", "")

    elif ch == "viber":
        token = cfg.get("auth_token")
        if not token:
            raise HTTPException(400, "Viber token missing")
        result = _viber_call("send_message", token, {
            "receiver":   chat_id,
            "min_api_version": 1,
            "type":       "text",
            "text":       text,
            "sender":     {"name": "Support"},
        })
        external_msg_id = str(result.get("message_token", ""))

    elif ch == "webchat":
        # Web-chat replies are stored only — the widget polls External API
        # (GET /{api_key}/api/chat/messages?since_id=N) to display them.
        external_msg_id = ""

    elif ch == "x":
        token = cfg.get("bearer_token")
        if not token:
            raise HTTPException(400, "X bearer token missing")
        # X API v2 DM endpoint (requires elevated access). Best-effort send;
        # full delivery is gated by X dev approval.
        try:
            url  = f"https://api.twitter.com/2/dm_conversations/with/{chat_id}/messages"
            body = json.dumps({"text": text}).encode()
            req  = urllib.request.Request(url, data=body, method="POST", headers={
                "Authorization": f"Bearer {token}",
                "Content-Type":  "application/json",
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
            external_msg_id = str(((data.get("data") or {}).get("dm_event_id")) or "")
        except Exception as e:
            raise HTTPException(503, f"X send failed: {e}")

    else:
        raise HTTPException(400, f"Sending not implemented for {ch}")

    with db_cursor() as (conn, cur):
        cur.execute(
            """INSERT INTO crm_chat_messages (conversation_id, direction, text, sender_user_id, external_msg_id)
               VALUES (%s, 'out', %s, %s, %s)
               RETURNING id, conversation_id, direction, text, sender_user_id, created_at""",
            (conv_id, text, user["id"], external_msg_id)
        )
        msg = cur.fetchone()
        cur.execute(
            """UPDATE crm_chat_conversations
               SET last_message_at=CURRENT_TIMESTAMP, last_message_preview=%s
               WHERE id=%s""",
            (text[:200], conv_id)
        )
        conn.commit()

    payload = _serialize_msg(msg)
    await chat_hub.broadcast(project_id, {
        "type":            "message.created",
        "conversation_id": conv_id,
        "message":         payload,
    })
    return {"ok": True, "message": payload}


# ── Inbound webhooks ──────────────────────────────────────────────────────────
#
# Each external messenger that requires an HTTPS webhook (Meta family, Viber,
# Telegram in production) hits one of these endpoints. The localhost-friendly
# real-time channels (Telegram getUpdates, Discord Gateway, VK Long Poll) do
# NOT use webhooks — pollers handle them.

@app.post("/api/chat/webhook/telegram/{project_id}")
async def telegram_webhook(project_id: int, request: Request):
    """For production HTTPS deploys (setWebhook). On localhost we use long-poll instead."""
    try:
        update = await request.json()
    except Exception:
        return {"ok": True}

    integ = db_one(
        "SELECT id FROM crm_chat_integrations WHERE project_id=%s AND channel='telegram' AND is_active=TRUE",
        (project_id,)
    )
    if not integ:
        return {"ok": True}

    msg = update.get("message") or update.get("edited_message")
    if not msg:
        return {"ok": True}
    chat = msg.get("chat") or {}
    await _handle_inbound_message(
        project_id, "telegram",
        str(chat.get("id", "")),
        (msg.get("text") or msg.get("caption") or "").strip(),
        external_msg_id=str(msg.get("message_id", "")),
    )
    return {"ok": True}


# ── Meta webhook (WhatsApp / Instagram / Facebook) ────────────────────────────
#
# Meta uses the same webhook contract for all three products:
#   GET  → verification handshake (echoes hub.challenge if hub.verify_token matches)
#   POST → JSON payload with `entry[].changes[].value.messages[]` (WhatsApp)
#          or `entry[].messaging[]` (Instagram / Facebook Messenger)
#
# Optional: signature verification via X-Hub-Signature-256 + app_secret.

def _verify_meta_signature(app_secret: str, signature_header: str, body: bytes) -> bool:
    if not app_secret or not signature_header:
        return True  # signature check disabled
    if not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature_header.split("=", 1)[1], expected)


@app.get("/api/chat/webhook/{channel}/{project_id}")
async def meta_webhook_verify(channel: str, project_id: int, request: Request):
    """Meta verification handshake. Echo hub.challenge when verify_token matches."""
    if channel not in ("whatsapp", "instagram", "facebook"):
        raise HTTPException(404, "Not found")
    qp        = request.query_params
    mode      = qp.get("hub.mode")
    token     = qp.get("hub.verify_token", "")
    challenge = qp.get("hub.challenge", "")

    integ = db_one(
        "SELECT config FROM crm_chat_integrations WHERE project_id=%s AND channel=%s AND is_active=TRUE",
        (project_id, channel)
    )
    expected = (integ or {}).get("config", {}).get("verify_token", "")
    if mode == "subscribe" and token and token == expected:
        return Response(content=challenge, media_type="text/plain")
    raise HTTPException(403, "Verification failed")


@app.post("/api/chat/webhook/{channel}/{project_id}")
async def channel_webhook_inbound(channel: str, project_id: int, request: Request):
    """Inbound webhook for Meta family + Viber. Telegram has its own dedicated route above."""
    if channel not in CHAT_WEBHOOK_CHANNELS:
        raise HTTPException(404, "Not found")

    integ = db_one(
        "SELECT config FROM crm_chat_integrations WHERE project_id=%s AND channel=%s AND is_active=TRUE",
        (project_id, channel)
    )
    if not integ:
        return {"ok": True}
    cfg = integ["config"] or {}

    raw_body = await request.body()

    # Optional signature verification for Meta family
    if channel in ("whatsapp", "instagram", "facebook"):
        sig = request.headers.get("X-Hub-Signature-256", "")
        if not _verify_meta_signature(cfg.get("app_secret", ""), sig, raw_body):
            raise HTTPException(403, "Bad signature")

    try:
        payload = json.loads(raw_body or b"{}")
    except Exception:
        return {"ok": True}

    if channel == "whatsapp":
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value") or {}
                for msg in value.get("messages", []):
                    text = ((msg.get("text") or {}).get("body") or "").strip()
                    chat_id = str(msg.get("from", ""))
                    await _handle_inbound_message(
                        project_id, "whatsapp", chat_id, text,
                        external_msg_id=str(msg.get("id", "")),
                    )

    elif channel in ("instagram", "facebook"):
        for entry in payload.get("entry", []):
            for evt in entry.get("messaging", []):
                msg = evt.get("message") or {}
                if msg.get("is_echo"):  # ignore our own outbound echo
                    continue
                text = (msg.get("text") or "").strip()
                chat_id = str((evt.get("sender") or {}).get("id", ""))
                await _handle_inbound_message(
                    project_id, channel, chat_id, text,
                    external_msg_id=str(msg.get("mid", "")),
                )

    elif channel == "viber":
        event = payload.get("event")
        if event == "message":
            sender = payload.get("sender") or {}
            msg    = payload.get("message") or {}
            text   = (msg.get("text") or "").strip()
            chat_id = str(sender.get("id", ""))
            await _handle_inbound_message(
                project_id, "viber", chat_id, text,
                external_msg_id=str(payload.get("message_token", "")),
            )
        # `webhook`, `subscribed`, `delivered`, `seen` events are acknowledged silently

    elif channel == "x":
        # X (Twitter) Account Activity API delivers DMs as `direct_message_events[]`
        for evt in payload.get("direct_message_events", []):
            if evt.get("type") != "message_create":
                continue
            mc        = evt.get("message_create") or {}
            sender_id = str((mc.get("sender_id") or ""))
            msg_data  = mc.get("message_data") or {}
            text      = (msg_data.get("text") or "").strip()
            await _handle_inbound_message(
                project_id, "x", sender_id, text,
                external_msg_id=str(evt.get("id", "")),
            )

    return {"ok": True}


# ── Internal endpoint: External API → CRM (web-chat inbound) ──────────────────
#
# The website widget (ClothingWebsite) sends a message via External API.
# External API forwards it here so the CRM operator sees it instantly via
# the in-process WebSocket hub.

class WebChatInboundRequest(BaseModel):
    project_id:  int
    web_chat_id: str
    text:        str


@app.post("/api/chat/internal/inbound")
async def internal_chat_inbound(req: WebChatInboundRequest, request: Request):
    if request.headers.get("X-Internal-Key", "") != INTERNAL_API_KEY:
        raise HTTPException(403, "Forbidden")
    text = (req.text or "").strip()
    if not text or not req.web_chat_id:
        return {"ok": True}
    await _handle_inbound_message(
        req.project_id, "webchat", req.web_chat_id, text[:4000],
    )
    return {"ok": True}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/api/chat/ws")
async def chat_ws(ws: WebSocket, project_id: int):
    token = ws.cookies.get("crm_token")
    user = _user_from_token(token)
    if not user:
        await ws.close(code=4401)
        return
    proj = db_one("SELECT crm_user_id FROM crm_projects WHERE id=%s AND is_active=TRUE", (project_id,))
    if not proj:
        await ws.close(code=4404)
        return
    if proj["crm_user_id"] != user["id"]:
        member = db_one("SELECT id FROM crm_team_members WHERE project_id=%s AND crm_user_id=%s",
                        (project_id, user["id"]))
        if not member:
            await ws.close(code=4403)
            return

    await chat_hub.connect(project_id, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await chat_hub.disconnect(project_id, ws)
