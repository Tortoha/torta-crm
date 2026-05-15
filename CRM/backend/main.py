from fastapi import FastAPI, Response, HTTPException, Request, Depends, UploadFile, File, Query, Body, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta, timezone, time as dt_time
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))

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



# ── КОНФИГ ───────────────────────────────────────────────

SECRET_KEY       = os.getenv("SECRET_KEY", "")
ALGORITHM        = "HS256"
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "15"))
REFRESH_TOKEN_DAYS   = int(os.getenv("REFRESH_TOKEN_DAYS",   "30"))
JWT_HOURS        = ACCESS_TOKEN_MINUTES / 60
CRM_FRONTEND_URL = os.getenv("CRM_FRONTEND_URL", "http://localhost:5174")
CRM_BACKEND_URL  = os.getenv("CRM_BACKEND_URL",  "http://localhost:8001")
MAGAZ_BACKEND_URL= os.getenv("MAGAZ_BACKEND_URL", "http://localhost:8000")
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
ENVIRONMENT             = os.getenv("ENVIRONMENT", "development").lower()
IS_PRODUCTION           = ENVIRONMENT == "production"
COOKIE_SECURE           = IS_PRODUCTION
MAX_FAILED_ATTEMPTS     = 5
BLOCK_MINUTES           = 10
CODE_TTL_MINUTES        = 10
RESEND_COOLDOWN_SECONDS = 60
RESET_TTL_MINUTES       = 30
UPLOADS_DIR             = "uploads"
import hmac as _hmac, base64 as _b64
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

def s3_delete_prefix(prefix: str) -> None:
    """Best-effort: delete every object under `prefix`. Silently ignores S3 errors."""
    if not prefix:
        return
    try:
        s3 = _s3_client()
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=AWS_S3_BUCKET, Prefix=prefix):
            objs = page.get("Contents") or []
            if not objs:
                continue
            # delete_objects accepts up to 1000 keys per request
            for i in range(0, len(objs), 1000):
                chunk = objs[i:i+1000]
                s3.delete_objects(
                    Bucket=AWS_S3_BUCKET,
                    Delete={"Objects": [{"Key": o["Key"]} for o in chunk], "Quiet": True},
                )
    except Exception:
        pass

app = FastAPI()


# ── VALIDATION-ERROR FORMATTER ───────────────────────────
# FastAPI returns Pydantic validation errors as {"detail": [{...}, ...]} by default.
# Frontends usually do setError(json.detail) → <p>{error}</p>, which crashes React
# ("Objects are not valid as a React child"). Flatten to a single string so every
# endpoint is safe and the frontend never has to type-check the response shape.
from fastapi.exceptions import RequestValidationError as _RVE

@app.exception_handler(_RVE)
async def _crm_format_validation_error(request: Request, exc: _RVE):
    from starlette.responses import JSONResponse as _J
    errors = exc.errors() or []
    if not errors:
        return _J({"detail": "Invalid request"}, status_code=422)
    parts = []
    for e in errors:
        loc = e.get("loc") or ()
        field = ".".join(str(x) for x in loc if x != "body") or "input"
        msg = e.get("msg") or "Invalid value"
        parts.append(f"{field}: {msg}")
    return _J({"detail": "; ".join(parts)}, status_code=422)


# ── STARTUP MIGRATIONS ───────────────────────────────────

@app.on_event("startup")
def run_migrations():
    import re as _re
    hex20 = _re.compile(r'^[0-9a-f]{20}$')

    # Idempotent table renames (run FIRST so later migrations see consistent l1..l5 names).
    try:
        with db_cursor() as (conn, cur):
            cur.execute("SELECT 1 FROM information_schema.tables WHERE table_name='product_variations'")
            if cur.fetchone():
                cur.execute("ALTER TABLE product_variations RENAME TO product_configurations_l1")
            cur.execute("SELECT 1 FROM information_schema.tables WHERE table_name='product_configurations'")
            if cur.fetchone():
                cur.execute("ALTER TABLE product_configurations RENAME TO product_configurations_l2")
            conn.commit()
    except Exception as e:
        print(f"[migration] table rename to l1/l2 failed: {e}")

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

    # ─── Refresh tokens (long-lived sessions, rotated on use) ─────────
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_refresh_tokens (
                    id            SERIAL PRIMARY KEY,
                    user_id       INTEGER NOT NULL REFERENCES crm_users(id) ON DELETE CASCADE,
                    token_hash    VARCHAR(64) NOT NULL UNIQUE,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    expires_at    TIMESTAMPTZ NOT NULL,
                    last_used_at  TIMESTAMPTZ,
                    revoked_at    TIMESTAMPTZ,
                    revoke_reason VARCHAR(40),
                    rotated_to_id INTEGER REFERENCES crm_refresh_tokens(id) ON DELETE SET NULL,
                    parent_id     INTEGER REFERENCES crm_refresh_tokens(id) ON DELETE SET NULL,
                    user_agent    TEXT,
                    ip            VARCHAR(64),
                    label         VARCHAR(100)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_crm_refresh_user "
                        "ON crm_refresh_tokens(user_id, revoked_at, expires_at)")
            conn.commit()
    except Exception as e:
        print(f"[migration] crm_refresh_tokens table failed: {e}")

    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE crm_email_domains ADD COLUMN IF NOT EXISTS spf_ok   BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE crm_email_domains ADD COLUMN IF NOT EXISTS dmarc_ok BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("""
                UPDATE crm_email_domains
                   SET spf_ok   = (verify_token IN ('spf_ok', 'all_ok')),
                       dmarc_ok = (verify_token = 'all_ok')
                 WHERE verify_token IS NOT NULL
            """)
            conn.commit()
    except Exception as e:
        print(f"[migration] spf_ok/dmarc_ok columns migration failed: {e}")

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
                    attachments      JSONB NOT NULL DEFAULT '[]'::jsonb,
                    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Backfill column for installations that pre-date the attachments support.
            cur.execute("ALTER TABLE crm_chat_messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_chat_conv_project ON crm_chat_conversations(project_id, is_active, last_message_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON crm_chat_messages(conversation_id, created_at)")
            conn.commit()
    except Exception as e:
        print(f"[migration] chat tables migration failed: {e}")

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
            # Idempotent ALTER for existing installations — adds later-introduced columns.
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

    # Booking module (services, staff, hours, bookings, settings) — all keyed by project_id.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS booking_services (
                    id               SERIAL PRIMARY KEY,
                    project_id       INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    name             VARCHAR(200) NOT NULL,
                    description      TEXT NOT NULL DEFAULT '',
                    duration_minutes INTEGER NOT NULL DEFAULT 30,
                    price            NUMERIC(10,2) NOT NULL DEFAULT 0,
                    image_url        VARCHAR(1000),
                    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
                    requires_staff   BOOLEAN NOT NULL DEFAULT FALSE,
                    capacity         INTEGER NOT NULL DEFAULT 1,
                    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_booking_services_project ON booking_services(project_id)")
            # Optional 1:1 link to a products row (when service is created via Products → New).
            cur.execute("ALTER TABLE booking_services ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE CASCADE")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_services_product ON booking_services(product_id) WHERE product_id IS NOT NULL")
            # Backfill: service products without booking_services row get auto-seeded.
            cur.execute(
                "INSERT INTO booking_services (project_id, product_id, name, description,"
                "                              duration_minutes, price, is_active)"
                " SELECT p.project_id, p.id, p.title, COALESCE(p.description, ''), 30, 0, TRUE"
                "   FROM products p"
                "   LEFT JOIN booking_services bs ON bs.product_id = p.id"
                "  WHERE p.product_type = 'service' AND bs.id IS NULL"
            )

            cur.execute("""
                CREATE TABLE IF NOT EXISTS booking_staff (
                    id          SERIAL PRIMARY KEY,
                    project_id  INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    name        VARCHAR(200) NOT NULL,
                    avatar_url  VARCHAR(1000),
                    bio         TEXT NOT NULL DEFAULT '',
                    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_booking_staff_project ON booking_staff(project_id)")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS booking_staff_services (
                    staff_id   INTEGER NOT NULL REFERENCES booking_staff(id) ON DELETE CASCADE,
                    service_id INTEGER NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
                    PRIMARY KEY (staff_id, service_id)
                )
            """)

            # Working hours: staff_id NULL = project-wide default (for services with requires_staff=false).
            cur.execute("""
                CREATE TABLE IF NOT EXISTS booking_hours (
                    id           SERIAL PRIMARY KEY,
                    project_id   INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    staff_id     INTEGER REFERENCES booking_staff(id) ON DELETE CASCADE,
                    day_of_week  SMALLINT NOT NULL,        -- 0=Mon … 6=Sun
                    open_time    TIME NOT NULL,
                    close_time   TIME NOT NULL
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_booking_hours_project ON booking_hours(project_id, staff_id, day_of_week)")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS booking_settings (
                    id                          SERIAL PRIMARY KEY,
                    project_id                  INTEGER NOT NULL UNIQUE REFERENCES crm_projects(id) ON DELETE CASCADE,
                    slot_interval_minutes       INTEGER NOT NULL DEFAULT 15,
                    min_advance_minutes         INTEGER NOT NULL DEFAULT 60,
                    max_advance_days            INTEGER NOT NULL DEFAULT 60,
                    cancellation_window_minutes INTEGER NOT NULL DEFAULT 1440,
                    auto_confirm                BOOLEAN NOT NULL DEFAULT TRUE,
                    default_status              VARCHAR(20) NOT NULL DEFAULT 'confirmed',
                    timezone                    VARCHAR(64) NOT NULL DEFAULT 'UTC',
                    created_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Customer bookings: user_id refers to External-side users.id (not crm_users), same as orders/favorites/reviews.
            cur.execute("""
                CREATE TABLE IF NOT EXISTS bookings (
                    id              SERIAL PRIMARY KEY,
                    project_id      INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    service_id      INTEGER NOT NULL REFERENCES booking_services(id) ON DELETE RESTRICT,
                    staff_id        INTEGER REFERENCES booking_staff(id) ON DELETE SET NULL,
                    user_id         INTEGER,
                    starts_at       TIMESTAMP NOT NULL,
                    ends_at         TIMESTAMP NOT NULL,
                    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
                    customer_name   VARCHAR(200) NOT NULL DEFAULT '',
                    customer_phone  VARCHAR(64)  NOT NULL DEFAULT '',
                    customer_email  VARCHAR(200) NOT NULL DEFAULT '',
                    notes           TEXT NOT NULL DEFAULT '',
                    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_bookings_project ON bookings(project_id, starts_at)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_bookings_staff ON bookings(staff_id, starts_at)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, project_id)")
            conn.commit()
    except Exception as e:
        print(f"[migration] booking tables migration failed: {e}")

    # One-time migrate naive TIMESTAMP→TIMESTAMPTZ; existing rows interpreted as UTC; idempotent.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                SELECT data_type FROM information_schema.columns
                 WHERE table_name='bookings' AND column_name='starts_at'
            """)
            row = cur.fetchone()
            if row and row["data_type"] == "timestamp without time zone":
                cur.execute("ALTER TABLE bookings "
                            "ALTER COLUMN starts_at TYPE TIMESTAMPTZ "
                            "USING starts_at AT TIME ZONE 'UTC'")
                cur.execute("ALTER TABLE bookings "
                            "ALTER COLUMN ends_at   TYPE TIMESTAMPTZ "
                            "USING ends_at   AT TIME ZONE 'UTC'")
                conn.commit()
                print("[migration] bookings.starts_at/ends_at upgraded to TIMESTAMPTZ")
    except Exception as e:
        print(f"[migration] TIMESTAMPTZ migration failed: {e}")

    # bookings.reminder_sent_at — populated by /internal/booking/process-reminders cron; null = not yet reminded.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_bookings_reminder "
                        "ON bookings(starts_at) WHERE reminder_sent_at IS NULL AND status='confirmed'")
            conn.commit()
    except Exception as e:
        print(f"[migration] bookings.reminder_sent_at migration failed: {e}")

    # Rename products cols: description→subtitle, then characteristics→description (order matters; idempotent).
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                SELECT column_name FROM information_schema.columns
                 WHERE table_name='products'
                   AND column_name IN ('description','characteristics','subtitle')
            """)
            cols = {r["column_name"] for r in cur.fetchall()}
            if "subtitle" not in cols and "description" in cols and "characteristics" in cols:
                cur.execute("ALTER TABLE products RENAME COLUMN description TO subtitle")
                cur.execute("ALTER TABLE products RENAME COLUMN characteristics TO description")
                conn.commit()
                print("[migration] products columns renamed: description→subtitle, characteristics→description")
    except Exception as e:
        print(f"[migration] products column rename failed: {e}")

    # Product categories (flat, 0..1 per product, FK ON DELETE SET NULL); slug auto from name, UNIQUE per project, NOT updated on rename (stable URLs).
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_categories (
                    id          SERIAL PRIMARY KEY,
                    project_id  INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    name        VARCHAR(100) NOT NULL,
                    slug        VARCHAR(120) NOT NULL,
                    sort_order  INTEGER NOT NULL DEFAULT 0,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_cat_project_name "
                        "ON product_categories(project_id, LOWER(name))")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_cat_project_slug "
                        "ON product_categories(project_id, slug)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cat_project ON product_categories(project_id)")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS "
                        "category_id INTEGER REFERENCES product_categories(id) ON DELETE SET NULL")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)")
            conn.commit()
    except Exception as e:
        print(f"[migration] product_categories failed: {e}")

    # Vertical-strategy fields: type, archive, pause.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type VARCHAR(16) NOT NULL DEFAULT 'physical'")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_paused   BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("""
                DO $do$
                BEGIN
                  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_product_type_check') THEN
                    ALTER TABLE products ADD CONSTRAINT products_product_type_check
                      CHECK (product_type IN ('physical','digital','service','event'));
                  END IF;
                END $do$;
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_products_archived ON products(project_id, is_archived)")
            conn.commit()
    except Exception as e:
        print(f"[migration] product_type/archive/pause failed: {e}")

    # Phase 1: SaaS-grade physical product fields (catalog ID, shipping flags, inventory, B2B, OG).
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS sku                  VARCHAR(80)  NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode              VARCHAR(80)  NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS brand                VARCHAR(120) NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer         VARCHAR(120) NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor               VARCHAR(120) NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS country_of_origin    VARCHAR(80)  NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS hs_code              VARCHAR(20)  NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS og_image_url         VARCHAR(1000)")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS requires_shipping    BOOLEAN NOT NULL DEFAULT TRUE")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS ships_internationally BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS shipping_class       VARCHAR(40)  NOT NULL DEFAULT 'standard'")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS lead_time_days       INTEGER      NOT NULL DEFAULT 0")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS continue_selling_oos BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS moq                  INTEGER      NOT NULL DEFAULT 1")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS order_increment      INTEGER      NOT NULL DEFAULT 1")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold  INTEGER      NOT NULL DEFAULT 0")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_pre_order         BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS pre_order_release_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS net_terms_days       INTEGER      NOT NULL DEFAULT 0")  # B2B Net 30
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS allow_po             BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("""
                DO $do$
                BEGIN
                  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_shipping_class_check') THEN
                    ALTER TABLE products ADD CONSTRAINT products_shipping_class_check
                      CHECK (shipping_class IN ('standard','fragile','oversized','hazmat','perishable'));
                  END IF;
                END $do$;
            """)
            conn.commit()
    except Exception as e:
        print(f"[migration] products SaaS fields failed: {e}")

    # Discounts: sale_type/value/starts/ends on products+l1+l2. Walk-up: L2 → L1 → product. types: percent|amount|fixed.
    try:
        with db_cursor() as (conn, cur):
            for tbl in ('products', 'product_configurations_l1', 'product_configurations_l2'):
                cur.execute(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS sale_type      VARCHAR(20)")
                cur.execute(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS sale_value     NUMERIC(10,2)")
                cur.execute(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS sale_starts_at TIMESTAMPTZ")
                cur.execute(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS sale_ends_at   TIMESTAMPTZ")
                cur.execute(f"""
                    DO $do$
                    BEGIN
                      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='{tbl}_sale_type_check') THEN
                        ALTER TABLE {tbl} ADD CONSTRAINT {tbl}_sale_type_check
                          CHECK (sale_type IS NULL OR sale_type IN ('percent','amount','fixed'));
                      END IF;
                    END $do$;
                """)
            # One-shot migration of legacy l2.sale_price → sale_type='fixed' / sale_value=sale_price.
            cur.execute(
                "UPDATE product_configurations_l2"
                "   SET sale_type='fixed', sale_value=sale_price"
                " WHERE sale_price IS NOT NULL AND sale_type IS NULL"
            )
            conn.commit()
    except Exception as e:
        print(f"[migration] sale fields failed: {e}")

    # Auto-SKU: org-level (numeric/letters/alphanumeric/manual + length); manual leaves empty.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE crm_organizations ADD COLUMN IF NOT EXISTS sku_mode VARCHAR(20) NOT NULL DEFAULT 'numeric'")
            cur.execute("ALTER TABLE crm_organizations ADD COLUMN IF NOT EXISTS sku_length INTEGER NOT NULL DEFAULT 8")
            cur.execute("""
                DO $do$
                BEGIN
                  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_organizations_sku_mode_check') THEN
                    ALTER TABLE crm_organizations ADD CONSTRAINT crm_organizations_sku_mode_check
                      CHECK (sku_mode IN ('numeric','letters','alphanumeric','manual'));
                  END IF;
                END $do$;
            """)
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_products_project_sku "
                        "ON products (project_id, sku) WHERE sku <> ''")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_l2_project_sku_code "
                        "ON product_configurations_l2 (product_id, sku_code) WHERE sku_code <> ''")
            cur.execute("ALTER TABLE crm_projects DROP COLUMN IF EXISTS auto_sku")
            conn.commit()
    except Exception as e:
        print(f"[migration] org sku settings failed: {e}")

    # Per-SKU (L2) attrs: sku_code, compare_at_price, cost_price, weight + dims for carrier APIs.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE product_configurations_l2 ADD COLUMN IF NOT EXISTS barcode          VARCHAR(80)    NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE product_configurations_l2 ADD COLUMN IF NOT EXISTS sku_code         VARCHAR(80)    NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE product_configurations_l2 ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(10, 2)")
            cur.execute("ALTER TABLE product_configurations_l2 ADD COLUMN IF NOT EXISTS cost_price       NUMERIC(10, 2)")
            cur.execute("ALTER TABLE product_configurations_l2 ADD COLUMN IF NOT EXISTS weight_g         NUMERIC(10, 2)")
            cur.execute("ALTER TABLE product_configurations_l2 ADD COLUMN IF NOT EXISTS length_cm        NUMERIC(10, 2)")
            cur.execute("ALTER TABLE product_configurations_l2 ADD COLUMN IF NOT EXISTS width_cm         NUMERIC(10, 2)")
            cur.execute("ALTER TABLE product_configurations_l2 ADD COLUMN IF NOT EXISTS height_cm        NUMERIC(10, 2)")
            cur.execute("ALTER TABLE product_configurations_l2 ADD COLUMN IF NOT EXISTS sale_price       NUMERIC(10, 2)")
            cur.execute("ALTER TABLE product_configurations_l2 ADD COLUMN IF NOT EXISTS sale_starts_at   TIMESTAMPTZ")
            cur.execute("ALTER TABLE product_configurations_l2 ADD COLUMN IF NOT EXISTS sale_ends_at     TIMESTAMPTZ")
            conn.commit()
    except Exception as e:
        print(f"[migration] L2 SaaS fields failed: {e}")

    # Tax categories per project — referenced from products.tax_category_id.
    # Default category seeded at first lookup if list is empty.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_tax_categories (
                    id          SERIAL PRIMARY KEY,
                    project_id  INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    name        VARCHAR(120) NOT NULL,
                    rate        NUMERIC(5, 2) NOT NULL DEFAULT 0,   -- percent (0–100)
                    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tax_categories_project ON product_tax_categories(project_id)")
            cur.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_category_id INTEGER")
            cur.execute("""
                DO $do$
                BEGIN
                  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_products_tax_category') THEN
                    ALTER TABLE products ADD CONSTRAINT fk_products_tax_category
                      FOREIGN KEY (tax_category_id) REFERENCES product_tax_categories(id) ON DELETE SET NULL;
                  END IF;
                END $do$;
            """)
            conn.commit()
    except Exception as e:
        print(f"[migration] product_tax_categories failed: {e}")

    # Tier pricing per SKU — wholesale-style "buy N+ for $X each".
    # Lookup at cart-add: pick the highest min_qty row that's <= quantity.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_tier_pricing (
                    id              SERIAL PRIMARY KEY,
                    sku_id          INTEGER NOT NULL REFERENCES product_configurations_l2(id) ON DELETE CASCADE,
                    min_qty         INTEGER NOT NULL CHECK (min_qty >= 1),
                    price           NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (sku_id, min_qty)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tier_pricing_sku ON product_tier_pricing(sku_id, min_qty)")
            conn.commit()
    except Exception as e:
        print(f"[migration] product_tier_pricing failed: {e}")

    # Phase 2: cart_items.reserved_until soft-locks SKU for 15min to prevent checkout oversell.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cart_items_reserved ON cart_items(reserved_until) WHERE reserved_until IS NOT NULL")
            conn.commit()
    except Exception as e:
        print(f"[migration] cart_items reserved_until failed: {e}")

    # ── Phase 3: Reviews enhancements ─────────────────────────────────
    try:
        with db_cursor() as (conn, cur):
            # Inline merchant reply on product_reviews — single reply per review.
            cur.execute("ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS merchant_reply    TEXT")
            cur.execute("ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS merchant_reply_at TIMESTAMPTZ")
            # Photos uploaded by reviewer.
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_review_photos (
                    id          SERIAL PRIMARY KEY,
                    review_id   INTEGER NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
                    url         VARCHAR(1000) NOT NULL,
                    position    INTEGER NOT NULL DEFAULT 0,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_review_photos_review ON product_review_photos(review_id)")
            # Helpful / unhelpful votes from other shoppers (one per user per review).
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_review_votes (
                    id          SERIAL PRIMARY KEY,
                    review_id   INTEGER NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
                    user_id     INTEGER NOT NULL,
                    is_helpful  BOOLEAN NOT NULL,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (review_id, user_id)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_review_votes_review ON product_review_votes(review_id)")
            # Q&A — distinct from reviews, no rating.
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_questions (
                    id           SERIAL PRIMARY KEY,
                    project_id   INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                    user_id      INTEGER NOT NULL,
                    question     TEXT NOT NULL,
                    answer       TEXT,
                    answered_at  TIMESTAMPTZ,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_questions_product ON product_questions(product_id)")
            conn.commit()
    except Exception as e:
        print(f"[migration] reviews enhancements failed: {e}")

    # Phase 5: Multi-warehouse infrastructure (default WH per project, product_stock per-SKU overrides).
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS warehouses (
                    id          SERIAL PRIMARY KEY,
                    project_id  INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    name        VARCHAR(120) NOT NULL,
                    code        VARCHAR(40)  NOT NULL DEFAULT '',
                    address     TEXT NOT NULL DEFAULT '',
                    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
                    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_warehouses_project ON warehouses(project_id)")
            # Partial unique index — only one default per project.
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouses_default_per_project ON warehouses(project_id) WHERE is_default")
            # Structured address fields (legacy `address` TEXT stays as fallback display string).
            cur.execute("ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS country     VARCHAR(80)  NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS city        VARCHAR(120) NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS street      VARCHAR(255) NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS postal_code VARCHAR(40)  NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS region      VARCHAR(120) NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS contact_name  VARCHAR(120) NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(40)  NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS notes         TEXT NOT NULL DEFAULT ''")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_stock (
                    id              SERIAL PRIMARY KEY,
                    sku_id          INTEGER NOT NULL REFERENCES product_configurations_l2(id) ON DELETE CASCADE,
                    warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
                    quantity        INTEGER NOT NULL DEFAULT 0,
                    sold_quantity   INTEGER NOT NULL DEFAULT 0,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (sku_id, warehouse_id)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_product_stock_sku ON product_stock(sku_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_product_stock_warehouse ON product_stock(warehouse_id)")
            conn.commit()
    except Exception as e:
        print(f"[migration] warehouses + product_stock failed: {e}")

    # Phase A backfill: copy l2.stock_quantity → product_stock(default_wh) per SKU. Idempotent.
    try:
        with db_cursor() as (conn, cur):
            cur.execute(
                "INSERT INTO warehouses (project_id, name, code, is_default, is_active)"
                " SELECT DISTINCT p.project_id, 'Main warehouse', 'MAIN', TRUE, TRUE"
                "   FROM products p"
                "  WHERE NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.project_id = p.project_id)"
                " ON CONFLICT DO NOTHING"
            )
            cur.execute(
                "INSERT INTO product_stock (sku_id, warehouse_id, quantity, sold_quantity)"
                " SELECT c.id, w.id, c.stock_quantity, c.sold_quantity"
                "   FROM product_configurations_l2 c"
                "   JOIN product_configurations_l1 v ON c.variation_id = v.id"
                "   JOIN products p              ON v.product_id = p.id"
                "   JOIN warehouses w            ON w.project_id = p.project_id AND w.is_default"
                " ON CONFLICT (sku_id, warehouse_id) DO NOTHING"
            )
            conn.commit()
    except Exception as e:
        print(f"[migration] product_stock backfill failed: {e}")

    # ── Phase 6: Stock audit log + restock waitlist ───────────────────
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_stock_log (
                    id           BIGSERIAL PRIMARY KEY,
                    project_id   INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    sku_id       INTEGER NOT NULL REFERENCES product_configurations_l2(id) ON DELETE CASCADE,
                    warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
                    delta        INTEGER NOT NULL,
                    reason       VARCHAR(40) NOT NULL,            -- sale|restock|manual|return|damage|transfer|reservation
                    reference_id INTEGER,
                    user_id      INTEGER,                         -- crm_users.id (NULL for system events)
                    note         TEXT NOT NULL DEFAULT '',
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_log_sku ON product_stock_log(sku_id, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_log_project ON product_stock_log(project_id, created_at DESC)")

            # Restock waitlist — user signs up, gets email when stock returns.
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_restock_subscriptions (
                    id            SERIAL PRIMARY KEY,
                    project_id    INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                    sku_id        INTEGER REFERENCES product_configurations_l2(id) ON DELETE CASCADE,
                    email         VARCHAR(200) NOT NULL,
                    user_id       INTEGER,
                    notified_at   TIMESTAMPTZ,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_restock_subs_sku ON product_restock_subscriptions(sku_id) WHERE notified_at IS NULL")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_restock_subs_product ON product_restock_subscriptions(product_id)")
            conn.commit()
    except Exception as e:
        print(f"[migration] stock_log + restock_subs failed: {e}")

    # Phase 7: L1 media_alt TEXT[] for SEO; media_type derived from URL ext at read time.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE product_configurations_l1 ADD COLUMN IF NOT EXISTS media_alt TEXT[] NOT NULL DEFAULT '{}'")
            conn.commit()
    except Exception as e:
        print(f"[migration] L1 media_alt failed: {e}")

    # Phase 1 backfill: seed default specs (Material/Care/etc) on physical-product L1 variations.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE product_configurations_l1 ADD COLUMN IF NOT EXISTS default_specs_seeded BOOLEAN NOT NULL DEFAULT FALSE")
            # Find variations that haven't been seeded yet AND belong to physical products.
            cur.execute(
                "SELECT v.id FROM product_configurations_l1 v"
                "  JOIN products p ON v.product_id = p.id"
                " WHERE p.product_type = 'physical' AND v.default_specs_seeded = FALSE"
            )
            target_vids = [r["id"] for r in cur.fetchall()]
            DEFAULT_SPECS = ["Material", "Care instructions", "Country of origin", "Size guide"]
            for vid in target_vids:
                # Only add default spec if key doesn't already exist on this variation.
                cur.execute(
                    "SELECT spec_key FROM product_specifications"
                    " WHERE (variation_id = %s OR (layer = 1 AND parent_id = %s))",
                    (vid, vid)
                )
                existing_keys = {r["spec_key"] for r in cur.fetchall()}
                base_pos_row = cur.execute(
                    "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM product_specifications"
                    " WHERE (variation_id = %s OR (layer = 1 AND parent_id = %s))",
                    (vid, vid)
                )
                base_pos_row = cur.fetchone()
                pos = (base_pos_row.get("p") if base_pos_row else 0) or 0
                for key in DEFAULT_SPECS:
                    if key in existing_keys: continue
                    cur.execute(
                        "INSERT INTO product_specifications"
                        "  (variation_id, layer, parent_id, spec_key, spec_value, position)"
                        " VALUES (%s, 1, %s, %s, '', %s)",
                        (vid, vid, key, pos)
                    )
                    pos += 1
                cur.execute(
                    "UPDATE product_configurations_l1 SET default_specs_seeded = TRUE WHERE id = %s",
                    (vid,)
                )
            if target_vids:
                print(f"[migration] seeded default specs for {len(target_vids)} physical variations")
            conn.commit()
    except Exception as e:
        print(f"[migration] default specs seeding failed: {e}")

    # Rename size→configuration (clothing-specific term replaced with generic "priced options"); idempotent per step.
    try:
        with db_cursor() as (conn, cur):
            def table_exists(name):
                cur.execute("SELECT 1 FROM information_schema.tables WHERE table_name=%s", (name,))
                return cur.fetchone() is not None

            def column_exists(table, col):
                cur.execute("SELECT 1 FROM information_schema.columns WHERE table_name=%s AND column_name=%s", (table, col))
                return cur.fetchone() is not None

            # 1) product_sizes → product_configurations_l2
            if table_exists("product_sizes") and not table_exists("product_configurations_l2"):
                cur.execute("ALTER TABLE product_sizes RENAME TO product_configurations_l2")

            # 2) configuration_name (was size_name)
            if column_exists("product_configurations_l2", "size_name") and not column_exists("product_configurations_l2", "configuration_name"):
                cur.execute("ALTER TABLE product_configurations_l2 RENAME COLUMN size_name TO configuration_name")

            # 3) cart_items.size_id → configuration_id
            if column_exists("cart_items", "size_id") and not column_exists("cart_items", "configuration_id"):
                cur.execute("ALTER TABLE cart_items RENAME COLUMN size_id TO configuration_id")

            # 4) order_items.size_id → configuration_id
            if column_exists("order_items", "size_id") and not column_exists("order_items", "configuration_id"):
                cur.execute("ALTER TABLE order_items RENAME COLUMN size_id TO configuration_id")

            # 5) product_configurations_l1.position — for drag-and-drop ordering
            need_backfill = not column_exists("product_configurations_l1", "position")
            cur.execute("ALTER TABLE product_configurations_l1 ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0")
            # Backfill positions ONCE right after column creation; skip on later startups to preserve user reorders.
            if need_backfill:
                cur.execute("""
                    UPDATE product_configurations_l1 pv
                       SET position = sub.rn - 1
                      FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY id) AS rn
                              FROM product_configurations_l1) sub
                     WHERE pv.id = sub.id
                """)
            conn.commit()
    except Exception as e:
        print(f"[migration] size→configuration rename failed: {e}")

    # ─── Specifications per variation (key/value pairs) ─────────────
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_specifications (
                    id           SERIAL PRIMARY KEY,
                    variation_id INTEGER NOT NULL REFERENCES product_configurations_l1(id) ON DELETE CASCADE,
                    spec_key     VARCHAR(200) NOT NULL DEFAULT '',
                    spec_value   VARCHAR(1000) NOT NULL DEFAULT '',
                    position     INTEGER NOT NULL DEFAULT 0,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_product_specifications_variation_id ON product_specifications(variation_id)")
            conn.commit()
    except Exception as e:
        print(f"[migration] product_specifications create failed: {e}")

    # Multi-layer configurations product_configurations_l1..l5; price NULLABLE on l2-5 (NULL = inherit from parent).
    try:
        with db_cursor() as (conn, cur):
            # Layer 1 (l1) gets price/stock/sold (becomes a leaf if no Layer 2 exists)
            cur.execute("ALTER TABLE product_configurations_l1 ADD COLUMN IF NOT EXISTS price NUMERIC(10,2)")
            cur.execute("ALTER TABLE product_configurations_l1 ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0")
            cur.execute("ALTER TABLE product_configurations_l1 ADD COLUMN IF NOT EXISTS sold_quantity INTEGER NOT NULL DEFAULT 0")

            # Layer 2 price becomes NULLABLE (inherit from Layer 1 when NULL)
            cur.execute("""
                SELECT is_nullable FROM information_schema.columns
                WHERE table_name='product_configurations_l2' AND column_name='price'
            """)
            row = cur.fetchone()
            if row and row.get("is_nullable") == "NO":
                cur.execute("ALTER TABLE product_configurations_l2 ALTER COLUMN price DROP NOT NULL")
            # Layer 2 also needs `position` for tree ordering (older schema lacked it)
            cur.execute("ALTER TABLE product_configurations_l2 ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0")

            # Layers 3-5 hierarchical via parent_id chain; parent of layer N = previous layer's table.
            parent_for = {3: "product_configurations_l2", 4: "product_configurations_l3", 5: "product_configurations_l4"}
            for n, parent_tbl in parent_for.items():
                cur.execute(f"""
                    CREATE TABLE IF NOT EXISTS product_configurations_l{n} (
                        id              SERIAL PRIMARY KEY,
                        parent_id       INTEGER NOT NULL REFERENCES {parent_tbl}(id) ON DELETE CASCADE,
                        name            VARCHAR(200) NOT NULL DEFAULT '',
                        price           NUMERIC(10,2),
                        stock_quantity  INTEGER NOT NULL DEFAULT 0,
                        sold_quantity   INTEGER NOT NULL DEFAULT 0,
                        position        INTEGER NOT NULL DEFAULT 0,
                        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                """)
                cur.execute(f"CREATE INDEX IF NOT EXISTS idx_pc_l{n}_parent ON product_configurations_l{n}(parent_id)")

            # cart_items/order_items: tag the layer for configuration_id; existing rows default to 2 (l2).
            for tbl in ("cart_items", "order_items"):
                cur.execute(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS configuration_layer SMALLINT NOT NULL DEFAULT 2")

            # product_specifications attaches to any layer (1-5); backfill legacy variation_id rows as layer=1, parent_id=variation_id.
            cur.execute("ALTER TABLE product_specifications ADD COLUMN IF NOT EXISTS layer SMALLINT NOT NULL DEFAULT 1")
            cur.execute("ALTER TABLE product_specifications ADD COLUMN IF NOT EXISTS parent_id INTEGER")
            cur.execute("UPDATE product_specifications SET parent_id = variation_id WHERE parent_id IS NULL")
            # Allow specs for layer 2-5 (parent_id used, variation_id NULL)
            cur.execute("""
                SELECT is_nullable FROM information_schema.columns
                WHERE table_name='product_specifications' AND column_name='variation_id'
            """)
            row = cur.fetchone()
            if row and row.get("is_nullable") == "NO":
                cur.execute("ALTER TABLE product_specifications ALTER COLUMN variation_id DROP NOT NULL")

            # Custom fields position column for drag-and-drop reorder.
            cur.execute("ALTER TABLE product_custom_fields ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0")
            cur.execute("""
                UPDATE product_custom_fields cf SET position = sub.rn - 1
                FROM (
                    SELECT id, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at) AS rn
                    FROM product_custom_fields
                ) sub
                WHERE cf.id = sub.id AND cf.position = 0
            """)

            conn.commit()
    except Exception as e:
        print(f"[migration] multi-layer configurations failed: {e}")

    # Modifiers — 2-level: groups (checkbox/radio + min/max/required/default) contain items (name + price_delta). Self-heals on schema mismatch by drop+recreate.
    try:
        with db_cursor() as (conn, cur):
            # Drop legacy flat modifier table (clean break, no prod data).
            cur.execute("DROP TABLE IF EXISTS product_modifiers CASCADE")

            # Schema sanity check: `max_select` MUST be nullable (else unlimited checkbox groups break).
            cur.execute("""
                SELECT is_nullable FROM information_schema.columns
                 WHERE table_name='product_modifier_groups' AND column_name='max_select'
            """)
            row = cur.fetchone()
            schema_broken = row is not None and row["is_nullable"] != "YES"
            # Also rebuild if any of the 7 new columns are missing entirely.
            if not schema_broken:
                cur.execute("""
                    SELECT COUNT(*) AS n FROM information_schema.columns
                     WHERE table_name='product_modifier_groups'
                       AND column_name IN ('control_type', 'default_item_id', 'min_select',
                                           'max_select', 'is_required', 'position', 'name')
                """)
                schema_broken = (cur.fetchone()["n"] != 7)
            if schema_broken:
                print("[migration] product_modifier_groups: detected stale schema, recreating from scratch")
                cur.execute("DROP TABLE IF EXISTS product_modifier_items  CASCADE")
                cur.execute("DROP TABLE IF EXISTS product_modifier_groups CASCADE")

            # Fresh-create groups (covers both first-run AND post-drop rebuild).
            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_modifier_groups (
                    id              SERIAL PRIMARY KEY,
                    product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                    name            VARCHAR(200) NOT NULL DEFAULT '',
                    control_type    VARCHAR(16)  NOT NULL DEFAULT 'checkbox',
                    min_select      INTEGER      NOT NULL DEFAULT 0,
                    max_select      INTEGER,
                    is_required     BOOLEAN      NOT NULL DEFAULT FALSE,
                    default_item_id INTEGER,
                    position        INTEGER      NOT NULL DEFAULT 0,
                    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                    CONSTRAINT chk_modifier_control CHECK (control_type IN ('checkbox', 'radio'))
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_modifier_groups_product ON product_modifier_groups(product_id)")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS product_modifier_items (
                    id          SERIAL PRIMARY KEY,
                    group_id    INTEGER        NOT NULL REFERENCES product_modifier_groups(id) ON DELETE CASCADE,
                    name        VARCHAR(200)   NOT NULL DEFAULT '',
                    price_delta NUMERIC(10, 2) NOT NULL DEFAULT 0,
                    position    INTEGER        NOT NULL DEFAULT 0,
                    created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_modifier_items_group ON product_modifier_items(group_id)")

            # default_item_id FK — references items table; needs both tables + column to exist.
            cur.execute("""
                DO $$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_modifier_default_item') THEN
                        ALTER TABLE product_modifier_groups
                        ADD CONSTRAINT fk_modifier_default_item
                        FOREIGN KEY (default_item_id) REFERENCES product_modifier_items(id) ON DELETE SET NULL;
                    END IF;
                END $$;
            """)

            # cart_items / order_items: array of selected modifier item ids per line.
            cur.execute("ALTER TABLE cart_items  ADD COLUMN IF NOT EXISTS selected_modifier_item_ids INTEGER[] NOT NULL DEFAULT '{}'")
            cur.execute("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS selected_modifier_item_ids INTEGER[] NOT NULL DEFAULT '{}'")
            conn.commit()
            print("[migration] product_modifier_groups OK")
    except Exception as e:
        print(f"[migration] product_modifier_groups failed: {e}")

    # Per-variation image gallery: replace single image_url with TEXT[] images.
    # First in array = cover. Cart/order items keep their own image_url snapshot.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE product_configurations_l1 "
                        "ADD COLUMN IF NOT EXISTS images TEXT[] NOT NULL DEFAULT '{}'")
            cur.execute("SELECT column_name FROM information_schema.columns "
                        "WHERE table_name='product_configurations_l1' AND column_name='image_url'")
            if cur.fetchone():
                # Backfill: existing single image_url → 1-element array (idempotent: skip if already migrated).
                cur.execute("UPDATE product_configurations_l1 "
                            "SET images = ARRAY[image_url] "
                            "WHERE image_url IS NOT NULL AND image_url <> '' "
                            "  AND (images IS NULL OR cardinality(images) = 0)")
                cur.execute("ALTER TABLE product_configurations_l1 DROP COLUMN image_url")
                print("[migration] product_configurations_l1.image_url → images TEXT[]")
            conn.commit()
    except Exception as e:
        print(f"[migration] L1 images[] failed: {e}")

    # Outbound integrations: webhook subs + log. Same engine for Custom/Slack/Discord (type branches).
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_webhook_subscriptions (
                    id            SERIAL PRIMARY KEY,
                    project_id    INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    type          VARCHAR(32) NOT NULL DEFAULT 'webhook',
                    name          VARCHAR(200) NOT NULL DEFAULT '',
                    url           VARCHAR(2000) NOT NULL,
                    secret        VARCHAR(120) NOT NULL DEFAULT '',
                    events        TEXT[] NOT NULL DEFAULT '{}',
                    config        JSONB NOT NULL DEFAULT '{}'::jsonb,
                    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
                    last_status   VARCHAR(20) NOT NULL DEFAULT 'unknown',
                    last_error    TEXT NOT NULL DEFAULT '',
                    last_event_at TIMESTAMPTZ,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_webhook_subs_project ON crm_webhook_subscriptions(project_id)")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_webhook_deliveries (
                    id              SERIAL PRIMARY KEY,
                    subscription_id INTEGER NOT NULL REFERENCES crm_webhook_subscriptions(id) ON DELETE CASCADE,
                    project_id      INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    event           VARCHAR(64) NOT NULL,
                    payload         JSONB NOT NULL,
                    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
                    http_code       INTEGER,
                    response_body   TEXT NOT NULL DEFAULT '',
                    duration_ms     INTEGER,
                    attempt         INTEGER NOT NULL DEFAULT 1,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_webhook_deliv_project ON crm_webhook_deliveries(project_id, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_webhook_deliv_sub     ON crm_webhook_deliveries(subscription_id, created_at DESC)")
            conn.commit()
    except Exception as e:
        print(f"[migration] crm_webhook_* failed: {e}")

    # Documents (PDF) branding per project — invoice header, footer, tax IDs, etc.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_document_settings (
                    project_id    INTEGER PRIMARY KEY REFERENCES crm_projects(id) ON DELETE CASCADE,
                    style         VARCHAR(20) NOT NULL DEFAULT 'modern',
                    company_name  VARCHAR(200) NOT NULL DEFAULT '',
                    logo_url      VARCHAR(2000),
                    address       TEXT NOT NULL DEFAULT '',
                    tax_id_label  VARCHAR(40) NOT NULL DEFAULT 'Tax ID',
                    tax_id        VARCHAR(80) NOT NULL DEFAULT '',
                    contact_email VARCHAR(200) NOT NULL DEFAULT '',
                    contact_phone VARCHAR(40) NOT NULL DEFAULT '',
                    footer_note   TEXT NOT NULL DEFAULT '',
                    accent_color  VARCHAR(20) NOT NULL DEFAULT '#0071E3',
                    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            conn.commit()
    except Exception as e:
        print(f"[migration] crm_document_settings failed: {e}")

    # Stock audit trigger: catches manual SQL writes to l2.stock_quantity. App-level writes set torta.skip_audit='on' to avoid double-logging.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE OR REPLACE FUNCTION log_l2_stock_change()
                RETURNS TRIGGER AS $func$
                DECLARE
                    v_project_id INTEGER;
                    v_skip TEXT;
                BEGIN
                    BEGIN
                        v_skip := current_setting('torta.skip_audit', true);
                    EXCEPTION WHEN OTHERS THEN
                        v_skip := NULL;
                    END;
                    IF v_skip = 'on' THEN RETURN NEW; END IF;
                    IF OLD.stock_quantity IS NOT DISTINCT FROM NEW.stock_quantity THEN RETURN NEW; END IF;

                    SELECT p.project_id INTO v_project_id
                      FROM products p
                      JOIN product_configurations_l1 l1 ON l1.product_id = p.id
                     WHERE l1.id = NEW.variation_id;
                    IF v_project_id IS NULL THEN RETURN NEW; END IF;

                    INSERT INTO product_stock_log
                        (project_id, sku_id, warehouse_id, delta, reason, reference_id, user_id, note)
                    VALUES
                        (v_project_id, NEW.id, NULL,
                         NEW.stock_quantity - OLD.stock_quantity,
                         'manual_sql', NULL, NULL,
                         'External SQL change detected by trigger');
                    RETURN NEW;
                END;
                $func$ LANGUAGE plpgsql;
            """)
            cur.execute("DROP TRIGGER IF EXISTS trg_l2_stock_audit ON product_configurations_l2")
            cur.execute("""
                CREATE TRIGGER trg_l2_stock_audit
                AFTER UPDATE OF stock_quantity ON product_configurations_l2
                FOR EACH ROW
                EXECUTE FUNCTION log_l2_stock_change()
            """)
            conn.commit()
    except Exception as e:
        print(f"[migration] stock audit trigger failed: {e}")

    # Duplicate-product machinery, abandoned-cart tracking, notifications: see crm_notifications table below.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_notifications (
                    id          BIGSERIAL PRIMARY KEY,
                    user_id     INTEGER NOT NULL REFERENCES crm_users(id) ON DELETE CASCADE,
                    project_id  INTEGER REFERENCES crm_projects(id) ON DELETE CASCADE,
                    type        VARCHAR(40) NOT NULL,
                    title       VARCHAR(200) NOT NULL,
                    message     TEXT NOT NULL DEFAULT '',
                    link        VARCHAR(500),
                    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_crm_notifications_user_unread "
                        "ON crm_notifications(user_id, is_read, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_crm_notifications_project "
                        "ON crm_notifications(project_id, created_at DESC) WHERE project_id IS NOT NULL")
            conn.commit()
    except Exception as e:
        print(f"[migration] crm_notifications failed: {e}")

    # Abandoned cart tracking: timestamp last reminder sent so cron doesn't spam the same cart twice.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE carts ADD COLUMN IF NOT EXISTS abandoned_email_sent_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_carts_abandoned_scan "
                        "ON carts(abandoned_email_sent_at) WHERE abandoned_email_sent_at IS NULL")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_l2_low_stock "
                        "ON product_configurations_l2(stock_quantity)")
            # Auto-touch updated_at on any cart_items row change so abandoned-cart cron sees fresh timestamps.
            cur.execute("""
                CREATE OR REPLACE FUNCTION touch_cart_items_updated_at()
                RETURNS TRIGGER AS $func$
                BEGIN
                    NEW.updated_at := NOW();
                    -- Clear the abandoned flag on the parent cart so the user can re-trigger after fresh activity.
                    UPDATE carts SET abandoned_email_sent_at = NULL WHERE id = NEW.cart_id;
                    RETURN NEW;
                END;
                $func$ LANGUAGE plpgsql;
            """)
            cur.execute("DROP TRIGGER IF EXISTS trg_cart_items_touch ON cart_items")
            cur.execute("""
                CREATE TRIGGER trg_cart_items_touch
                BEFORE INSERT OR UPDATE ON cart_items
                FOR EACH ROW
                EXECUTE FUNCTION touch_cart_items_updated_at()
            """)
            conn.commit()
    except Exception as e:
        print(f"[migration] abandoned-cart / low-stock indexes failed: {e}")

    # Inventory batches — every stock receipt creates a batch row. Source of truth for the new Batches page; product_stock now references which batches a SKU's quantity came from.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS inventory_batches (
                    id                  BIGSERIAL PRIMARY KEY,
                    project_id          INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    sku_id              INTEGER NOT NULL REFERENCES product_configurations_l2(id) ON DELETE CASCADE,
                    warehouse_id        INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
                    batch_name          VARCHAR(80) NOT NULL,
                    production_date     DATE,
                    expiry_date         DATE,
                    quantity_received   INTEGER NOT NULL CHECK (quantity_received >= 0),
                    quantity_remaining  INTEGER NOT NULL CHECK (quantity_remaining >= 0),
                    cost_per_unit       NUMERIC(12, 2),
                    is_frozen           BOOLEAN NOT NULL DEFAULT FALSE,
                    notes               TEXT NOT NULL DEFAULT '',
                    received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    received_by_user_id INTEGER REFERENCES crm_users(id) ON DELETE SET NULL
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_batches_sku_active "
                        "ON inventory_batches(sku_id, is_frozen, received_at) "
                        "WHERE quantity_remaining > 0")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_batches_project "
                        "ON inventory_batches(project_id, received_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_batches_warehouse "
                        "ON inventory_batches(warehouse_id, received_at DESC)")
            conn.commit()
    except Exception as e:
        print(f"[migration] inventory_batches failed: {e}")

    # Batch-related project + organization settings.
    try:
        with db_cursor() as (conn, cur):
            # Org-level: how batch names are generated when the merchant enables auto-naming.
            cur.execute("ALTER TABLE crm_organizations "
                        "ADD COLUMN IF NOT EXISTS batch_naming_mode VARCHAR(10) NOT NULL DEFAULT 'auto'")
            cur.execute("ALTER TABLE crm_organizations "
                        "ADD COLUMN IF NOT EXISTS batch_naming_format VARCHAR(80) NOT NULL DEFAULT 'B-{YYYY}{MM}-{seq:03}'")
            # Project-level: consumption order (FIFO is dairy/skincare-style; LIFO is rare).
            cur.execute("ALTER TABLE crm_projects "
                        "ADD COLUMN IF NOT EXISTS batch_consumption_mode VARCHAR(10) NOT NULL DEFAULT 'fifo'")
            # Project-level barcode defaults — applied when opening PrintBarcodesModal.
            cur.execute("ALTER TABLE crm_projects "
                        "ADD COLUMN IF NOT EXISTS barcode_include_date    BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE crm_projects "
                        "ADD COLUMN IF NOT EXISTS barcode_include_batch   BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE crm_projects "
                        "ADD COLUMN IF NOT EXISTS barcode_include_qty     BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE crm_projects "
                        "ADD COLUMN IF NOT EXISTS barcode_include_serial  BOOLEAN NOT NULL DEFAULT FALSE")
            # Barcode binding: 'batch' (default — the encoded value resolves to a
            # specific inventory_batches row so a scan picks the exact batch) or
            # 'sku' (legacy — the encoded value resolves to a product_configurations_l2
            # row and consumption falls back to FIFO across batches). Default 'batch'
            # because batches are now first-class — see Batches page.
            cur.execute("ALTER TABLE crm_projects "
                        "ADD COLUMN IF NOT EXISTS barcode_binding VARCHAR(10) NOT NULL DEFAULT 'batch'")
            # Pricing display: hide_price_in_overview swaps Price column in L2 table for a Cost column (price gets auto-derived from cost × (1 + margin%)). default_margin_percent feeds the auto-derivation.
            cur.execute("ALTER TABLE crm_projects "
                        "ADD COLUMN IF NOT EXISTS hide_price_in_overview BOOLEAN NOT NULL DEFAULT FALSE")
            cur.execute("ALTER TABLE crm_projects "
                        "ADD COLUMN IF NOT EXISTS default_margin_percent NUMERIC(6,2) NOT NULL DEFAULT 50.00")
            # Batch naming moved from org-level to project-level (different shops in one org want different batch templates).
            cur.execute("ALTER TABLE crm_projects "
                        "ADD COLUMN IF NOT EXISTS batch_naming_mode VARCHAR(10) NOT NULL DEFAULT 'auto'")
            cur.execute("ALTER TABLE crm_projects "
                        "ADD COLUMN IF NOT EXISTS batch_naming_format VARCHAR(80) NOT NULL DEFAULT 'B-{YYYY}{MM}-{seq:03}'")
            # Batch grouping mode — controls how auto-named batches are scoped during a
            # multi-row receive. 'config' = each (product × variation × sku) row gets its
            # own auto-name (current behavior). 'product' = all rows of the same parent
            # product share one auto-name. 'global' = the whole receive shares one name.
            # Production/expiry dates auto-propagate using the same scope.
            cur.execute("ALTER TABLE crm_projects "
                        "ADD COLUMN IF NOT EXISTS batch_grouping_mode VARCHAR(10) NOT NULL DEFAULT 'config'")
            # One-time copy of the org-level template into projects that still have the default. Idempotent — only updates rows with default values, so re-running won't clobber edits.
            cur.execute("""
                UPDATE crm_projects pr
                   SET batch_naming_mode   = o.batch_naming_mode,
                       batch_naming_format = o.batch_naming_format
                  FROM crm_organizations o
                 WHERE pr.org_id = o.id
                   AND pr.batch_naming_mode   = 'auto'
                   AND pr.batch_naming_format = 'B-{YYYY}{MM}-{seq:03}'
            """)
            conn.commit()
    except Exception as e:
        print(f"[migration] batch settings columns failed: {e}")

    # Backfill cost_price for existing L2 rows that have a price but no cost (33% below price ≈ 50% margin). Idempotent — only touches NULL cost_price.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("SET LOCAL torta.skip_audit = 'on'")
            cur.execute(
                "UPDATE product_configurations_l2"
                "   SET cost_price = ROUND(price * 0.67, 2)"
                " WHERE cost_price IS NULL"
                "   AND price IS NOT NULL AND price > 0"
            )
            conn.commit()
    except Exception as e:
        print(f"[migration] cost_price backfill failed: {e}")

    # Per-batch sequence counter for auto-naming (`{seq:03}` placeholder).
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS inventory_batch_counters (
                    project_id  INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    period_key  VARCHAR(20) NOT NULL,
                    counter     INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (project_id, period_key)
                )
            """)
            conn.commit()
    except Exception as e:
        print(f"[migration] inventory_batch_counters failed: {e}")

    # Order items: access codes for event tickets — short human-readable backup if QR doesn't scan.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE order_items "
                        "ADD COLUMN IF NOT EXISTS access_code VARCHAR(20)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_order_items_access_code "
                        "ON order_items(access_code) WHERE access_code IS NOT NULL")
            conn.commit()
    except Exception as e:
        print(f"[migration] order_items.access_code failed: {e}")

    # Backfill EAN-13 barcodes on every product / L2 SKU that doesn't have one.
    # Uses the in-store prefix range (200-299) which never collides with real
    # registered GS1 codes — safe to mint without GS1 membership.
    try:
        with db_cursor() as (conn, cur):
            cur.execute(
                "SELECT id FROM products"
                " WHERE barcode IS NULL OR barcode = '' OR barcode !~ '^[0-9]{13}$'"
            )
            for r in cur.fetchall():
                pid = r['id']
                minted = _internal_ean13(EAN13_PREFIX_PRODUCT, pid)
                cur.execute("UPDATE products SET barcode = %s WHERE id = %s", (minted, pid))

            cur.execute(
                "SELECT id FROM product_configurations_l2"
                " WHERE barcode IS NULL OR barcode = '' OR barcode !~ '^[0-9]{13}$'"
            )
            for r in cur.fetchall():
                sid = r['id']
                minted = _internal_ean13(EAN13_PREFIX_SKU, sid)
                cur.execute("UPDATE product_configurations_l2 SET barcode = %s WHERE id = %s",
                            (minted, sid))
            conn.commit()
    except Exception as e:
        print(f"[migration] ean13 backfill failed: {e}")

    # Initial inventory backfill: any SKU that has product_stock.quantity > 0 but zero batches gets a synthetic "Initial inventory" batch so the new Inventory model holds true everywhere.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                INSERT INTO inventory_batches
                  (project_id, sku_id, warehouse_id, batch_name, quantity_received, quantity_remaining, notes)
                SELECT
                  p.project_id,
                  ps.sku_id,
                  ps.warehouse_id,
                  'Initial inventory',
                  ps.quantity,
                  ps.quantity,
                  'Auto-created at migration — represents pre-existing stock'
                FROM product_stock ps
                JOIN product_configurations_l2 l2 ON ps.sku_id = l2.id
                JOIN product_configurations_l1 l1 ON l2.variation_id = l1.id
                JOIN products p ON l1.product_id = p.id
                WHERE ps.quantity > 0
                  AND NOT EXISTS (
                      SELECT 1 FROM inventory_batches b
                       WHERE b.sku_id = ps.sku_id AND b.warehouse_id = ps.warehouse_id
                  )
            """)
            conn.commit()
    except Exception as e:
        print(f"[migration] initial inventory batch backfill failed: {e}")

    # Low-stock alert cooldown: one alert per (project, sku) per day, no spam.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_low_stock_alerts (
                    id          BIGSERIAL PRIMARY KEY,
                    project_id  INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    sku_id      INTEGER NOT NULL,
                    alerted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    stock_at_alert INTEGER NOT NULL,
                    threshold   INTEGER NOT NULL
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_low_stock_alerts_lookup "
                        "ON crm_low_stock_alerts(project_id, sku_id, alerted_at DESC)")
            conn.commit()
    except Exception as e:
        print(f"[migration] crm_low_stock_alerts failed: {e}")

    # Returns/Refunds workflow. Customer-initiated within 14 days of delivery.
    # Lifecycle: requested → approved → received → inspected → refunded (+ terminal rejected/cancelled).
    # Refund is record-only — merchant processes actual money refund through their own payment provider.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS order_returns (
                    id                  BIGSERIAL PRIMARY KEY,
                    order_id            INTEGER     NOT NULL REFERENCES order_history(id) ON DELETE CASCADE,
                    project_id          INTEGER     NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    customer_user_id    INTEGER,
                    status              VARCHAR(20) NOT NULL DEFAULT 'requested',
                    reason              VARCHAR(40) NOT NULL DEFAULT 'other',
                    customer_message    TEXT        NOT NULL DEFAULT '',
                    customer_photos     JSONB       NOT NULL DEFAULT '[]'::jsonb,
                    approved_by         INTEGER,
                    approved_at         TIMESTAMPTZ,
                    rejected_reason     TEXT        NOT NULL DEFAULT '',
                    received_by         INTEGER,
                    received_at         TIMESTAMPTZ,
                    inspected_by        INTEGER,
                    inspected_at        TIMESTAMPTZ,
                    refund_amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
                    refund_method       VARCHAR(40) NOT NULL DEFAULT '',
                    refund_reference    VARCHAR(120) NOT NULL DEFAULT '',
                    refund_processed_by INTEGER,
                    refund_processed_at TIMESTAMPTZ,
                    restocking_fee      NUMERIC(10,2) NOT NULL DEFAULT 0,
                    internal_notes      TEXT        NOT NULL DEFAULT '',
                    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='order_returns_status_check') THEN
                ALTER TABLE order_returns ADD CONSTRAINT order_returns_status_check
                  CHECK (status IN ('requested','approved','rejected','received','inspected','refunded','cancelled'));
              END IF;
            END $$;""")
            cur.execute("""DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='order_returns_reason_check') THEN
                ALTER TABLE order_returns ADD CONSTRAINT order_returns_reason_check
                  CHECK (reason IN ('damaged','wrong_item','not_as_described','changed_mind','arrived_late','quality_issue','other'));
              END IF;
            END $$;""")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_order_returns_project_status "
                        "ON order_returns(project_id, status, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_order_returns_order "
                        "ON order_returns(order_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_order_returns_customer "
                        "ON order_returns(customer_user_id)")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS order_return_items (
                    id                   BIGSERIAL PRIMARY KEY,
                    return_id            BIGINT      NOT NULL REFERENCES order_returns(id) ON DELETE CASCADE,
                    order_item_id        INTEGER     NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
                    quantity             INTEGER     NOT NULL DEFAULT 1,
                    condition            VARCHAR(20) NOT NULL DEFAULT 'pending',
                    restock_warehouse_id INTEGER     REFERENCES warehouses(id) ON DELETE SET NULL,
                    restock_batch_id     BIGINT      REFERENCES inventory_batches(id) ON DELETE SET NULL,
                    restocked_at         TIMESTAMPTZ,
                    unit_refund_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
                    item_notes           TEXT        NOT NULL DEFAULT ''
                )
            """)
            cur.execute("""DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='order_return_items_condition_check') THEN
                ALTER TABLE order_return_items ADD CONSTRAINT order_return_items_condition_check
                  CHECK (condition IN ('pending','resellable','damaged','unrecoverable'));
              END IF;
            END $$;""")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_return_items_return "
                        "ON order_return_items(return_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_return_items_order_item "
                        "ON order_return_items(order_item_id)")
            conn.commit()
    except Exception as e:
        print(f"[migration] order_returns failed: {e}")

    # Payment provider at organization level. Variant A — direct merchant payment (CRM never touches money).
    # Merchant connects their own Stripe/Tinkoff/etc. account at the customer storefront level;
    # refunds are processed in their dashboard and recorded here for audit + customer messaging.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE crm_organizations ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(30) NOT NULL DEFAULT 'manual'")
            cur.execute("ALTER TABLE crm_organizations ADD COLUMN IF NOT EXISTS payment_account_label VARCHAR(160) NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE crm_organizations ADD COLUMN IF NOT EXISTS payment_dashboard_url VARCHAR(600) NOT NULL DEFAULT ''")
            # Drop old constraint if it exists with old provider set, then recreate
            # with the expanded list. Safe to run repeatedly.
            cur.execute("ALTER TABLE crm_organizations DROP CONSTRAINT IF EXISTS crm_organizations_payment_provider_check")
            cur.execute("""
                ALTER TABLE crm_organizations ADD CONSTRAINT crm_organizations_payment_provider_check
                  CHECK (payment_provider IN (
                    'stripe','tinkoff','cloudpayments','yookassa','paypal',
                    'adyen','braintree','square','mollie','razorpay','paddle','paybox',
                    'manual','other'
                  ))
            """)
            conn.commit()
    except Exception as e:
        print(f"[migration] crm_organizations.payment_provider failed: {e}")

    # Encrypted payment-provider credentials (Stripe/Tinkoff/etc. API keys).
    # One row per org. credentials_encrypted is a Fernet-encrypted JSON dict — see payment_crypto.py.
    # is_test_mode toggles between provider's test/live API endpoints (Stripe sk_test_ vs sk_live_).
    # Stripe Connect: stripe_account_id is set when merchant connected via OAuth — refunds use
    # the Stripe-Account header to act on behalf of the connected account.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS crm_payment_credentials (
                    id                  BIGSERIAL PRIMARY KEY,
                    org_id              INTEGER     NOT NULL UNIQUE
                                                  REFERENCES crm_organizations(id) ON DELETE CASCADE,
                    provider            VARCHAR(30) NOT NULL,
                    credentials_encrypted TEXT      NOT NULL DEFAULT '',
                    is_test_mode        BOOLEAN     NOT NULL DEFAULT TRUE,
                    is_connected        BOOLEAN     NOT NULL DEFAULT FALSE,
                    connected_at        TIMESTAMPTZ,
                    last_verified_at    TIMESTAMPTZ,
                    last_error          TEXT        NOT NULL DEFAULT '',
                    stripe_account_id   VARCHAR(120) NOT NULL DEFAULT '',
                    connect_method      VARCHAR(20) NOT NULL DEFAULT 'manual',
                    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("ALTER TABLE crm_payment_credentials DROP CONSTRAINT IF EXISTS crm_payment_credentials_provider_check")
            cur.execute("""
                ALTER TABLE crm_payment_credentials ADD CONSTRAINT crm_payment_credentials_provider_check
                  CHECK (provider IN (
                    'stripe','tinkoff','cloudpayments','yookassa','paypal',
                    'adyen','braintree','square','mollie','razorpay','paddle','paybox',
                    'manual','other'
                  ))
            """)
            cur.execute("""DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_payment_credentials_method_check') THEN
                ALTER TABLE crm_payment_credentials ADD CONSTRAINT crm_payment_credentials_method_check
                  CHECK (connect_method IN ('manual','oauth'));
              END IF;
            END $$;""")
            conn.commit()
    except Exception as e:
        print(f"[migration] crm_payment_credentials failed: {e}")

    # Webhook event log — idempotency + audit trail. UNIQUE(provider, event_id) makes replays no-ops.
    # Stripe/Tinkoff/etc. retry webhooks on 5xx, so we INSERT first then process; if conflict, skip.
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS payment_webhook_events (
                    id                  BIGSERIAL PRIMARY KEY,
                    provider            VARCHAR(30) NOT NULL,
                    event_id            VARCHAR(160) NOT NULL,
                    project_id          INTEGER REFERENCES crm_projects(id) ON DELETE SET NULL,
                    order_id            INTEGER,
                    payment_intent_id   VARCHAR(160),
                    event_type          VARCHAR(80) NOT NULL,
                    payload             JSONB       NOT NULL DEFAULT '{}'::jsonb,
                    signature_valid     BOOLEAN     NOT NULL DEFAULT FALSE,
                    processed_ok        BOOLEAN     NOT NULL DEFAULT FALSE,
                    processing_error    TEXT        NOT NULL DEFAULT '',
                    received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE (provider, event_id)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_payment_webhook_project "
                        "ON payment_webhook_events(project_id, received_at DESC) "
                        "WHERE project_id IS NOT NULL")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_payment_webhook_intent "
                        "ON payment_webhook_events(payment_intent_id) "
                        "WHERE payment_intent_id IS NOT NULL")
            conn.commit()
    except Exception as e:
        print(f"[migration] payment_webhook_events failed: {e}")

    # Payment-tracking columns on order_history. payment_status drives Order Lifecycle gates:
    #  • 'pending' — intent created, awaiting webhook OR client confirmation
    #  • 'paid' — webhook payment_intent.succeeded received OR confirmed directly
    #  • 'failed' — provider rejected; STRICT mode means order should NOT exist in this state
    #              (we delete the row on confirm-payment failure) — kept only for webhook-driven races.
    #  • 'refunded' — full refund landed (sum of refunds ≥ total)
    #  • 'partial_refunded' — some refunds, not full
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE order_history ADD COLUMN IF NOT EXISTS payment_intent_id      VARCHAR(160) NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE order_history ADD COLUMN IF NOT EXISTS payment_charge_id      VARCHAR(160) NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE order_history ADD COLUMN IF NOT EXISTS payment_status         VARCHAR(20)  NOT NULL DEFAULT 'pending'")
            cur.execute("ALTER TABLE order_history ADD COLUMN IF NOT EXISTS payment_provider       VARCHAR(30)  NOT NULL DEFAULT 'manual'")
            cur.execute("ALTER TABLE order_history ADD COLUMN IF NOT EXISTS payment_currency       VARCHAR(3)   NOT NULL DEFAULT 'USD'")
            cur.execute("ALTER TABLE order_history ADD COLUMN IF NOT EXISTS payment_amount_paid    NUMERIC(10,2) NOT NULL DEFAULT 0")
            cur.execute("ALTER TABLE order_history ADD COLUMN IF NOT EXISTS payment_amount_refunded NUMERIC(10,2) NOT NULL DEFAULT 0")
            cur.execute("ALTER TABLE order_history ADD COLUMN IF NOT EXISTS payment_paid_at        TIMESTAMPTZ")
            cur.execute("""DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='order_history_payment_status_check') THEN
                ALTER TABLE order_history ADD CONSTRAINT order_history_payment_status_check
                  CHECK (payment_status IN ('pending','paid','failed','refunded','partial_refunded','manual'));
              END IF;
            END $$;""")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_order_history_payment_intent "
                        "ON order_history(payment_intent_id) WHERE payment_intent_id <> ''")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_order_history_payment_status "
                        "ON order_history(project_id, payment_status, created_at DESC)")
            # Backfill: orders that existed before this migration are treated as 'manual' (no provider involved).
            cur.execute("UPDATE order_history SET payment_status='manual' WHERE payment_status='pending' AND created_at < NOW() - INTERVAL '1 hour'")
            conn.commit()
    except Exception as e:
        print(f"[migration] order_history payment columns failed: {e}")

    # Real provider-driven refund tracking on order_returns. provider_refund_id is the
    # actual ID returned by Stripe.Refund.create() / etc. — distinct from the merchant-typed
    # `refund_reference` (which was only an audit field in the record-only flow).
    try:
        with db_cursor() as (conn, cur):
            cur.execute("ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS provider_refund_id     VARCHAR(160) NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS provider_refund_status VARCHAR(30)  NOT NULL DEFAULT ''")
            cur.execute("ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS provider_error         TEXT         NOT NULL DEFAULT ''")
            conn.commit()
    except Exception as e:
        print(f"[migration] order_returns provider refund columns failed: {e}")

# ── DB POOL ──────────────────────────────────────────────

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


# ── PAGINATION HELPERS ──────────────────────────────────
# Offset-based pagination wrapper. Frontend hook (`useInfiniteList`) signals "I want pagination" by sending a `cursor` query param (defaults to 0); without it the endpoint stays backward-compat and returns a bare array.

def _paginate(rows: list, limit: int) -> dict:
    """Trim `rows` to `limit` (assumes caller fetched `limit + 1` to peek the next page)."""
    has_more = len(rows) > limit
    page = rows[:limit]
    return {"items": page, "has_more": has_more}


def _wrap_paginated(want_pagination: bool, rows: list, cursor: Optional[int], limit: int):
    """Format response — paginated wrapper {items, next_cursor, has_more} OR legacy bare array."""
    if not want_pagination:
        return rows[:limit]   # legacy callers still get just the array
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = (cursor or 0) + len(page) if has_more else None
    return {"items": page, "next_cursor": next_cursor, "has_more": has_more}


def _pagination_params(cursor: Optional[str], limit_q: Optional[int], default_limit: int = 50, max_limit: int = 200):
    """Parse + clamp pagination params. Returns (want_pagination, offset, limit). want_pagination=True if cursor was explicitly passed (even '0')."""
    want = cursor is not None
    offset = 0
    if cursor is not None:
        try: offset = max(0, int(cursor))
        except (TypeError, ValueError): offset = 0
    limit = default_limit
    if limit_q is not None:
        try: limit = max(1, min(int(limit_q), max_limit))
        except (TypeError, ValueError): limit = default_limit
    return want, offset, limit


# ── EMAIL ────────────────────────────────────────────────

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


# Rate-limit / verification storage — Redis if REDIS_URL set, else in-memory (see kvstore.py).
import time as _time
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

def exists(key: str) -> bool:
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


# Email OTP (pending verifications)
def _pv_key(email: str) -> str: return f"pv:{email}"
def _pv_get(email):    return _kv_get(_pv_key(email))
def _pv_set(email, v, ttl=None):
    _kv_set(_pv_key(email), v, ttl=ttl or CODE_TTL_MINUTES * 60)
def _pv_del(email):    _kv_delete(_pv_key(email))

# Failed-attempt counters (logins, reset, etc.) — atomic INCR with TTL window
def _fail_key(bucket: str, ident: str) -> str: return f"fail:{bucket}:{ident}"
def _fail_check(bucket: str, ident: str):
    key = _fail_key(bucket, ident)
    count = int(_kv_get(key) or 0)
    if count >= MAX_FAILED_ATTEMPTS:
        return True, max(_kv_ttl(key), 1)
    return False, 0
def _fail_record(bucket: str, ident: str) -> int:
    return _kv_incr(_fail_key(bucket, ident), ttl=BLOCK_MINUTES * 60)
def _fail_clear(bucket: str, ident: str):
    _kv_delete(_fail_key(bucket, ident))

# Password reset tokens
def _reset_key(token_hash: str) -> str: return f"pw_reset:{token_hash}"
def _reset_get(h):    return _kv_get(_reset_key(h))
def _reset_set(h, v): _kv_set(_reset_key(h), v, ttl=RESET_TTL_MINUTES * 60)
def _reset_del(h):    _kv_delete(_reset_key(h))

# CSRF double-submit cookie: GET /api/csrf sets readable cookie, frontend echoes it as X-CSRF-Token, middleware compares; exempt: inbound webhooks and X-Internal-Key chat endpoint.
_CSRF_SAFE_METHODS  = {"GET", "HEAD", "OPTIONS", "TRACE"}
_CSRF_EXEMPT_PREFIX = ("/api/chat/webhook/", "/api/chat/internal/")

class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in _CSRF_SAFE_METHODS:
            return await call_next(request)
        path = request.url.path
        if any(path.startswith(p) for p in _CSRF_EXEMPT_PREFIX):
            return await call_next(request)
        cookie = request.cookies.get("csrf_token", "")
        header = request.headers.get("x-csrf-token", "")
        if not cookie or not secrets.compare_digest(
            cookie.encode("utf-8"), header.encode("utf-8")
        ):
            from starlette.responses import JSONResponse as _J
            return _J({"detail": "CSRF token missing or invalid"}, status_code=403)
        return await call_next(request)

# Add CSRF before CORS so CORS runs outermost — response always carries CORS headers even on CSRF 403.
app.add_middleware(CSRFMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

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

class CreateOrgRequest(BaseModel):
    name: str

class RenameOrgRequest(BaseModel):
    name: str

class CreateProjectRequest(BaseModel):
    name: str
    frontend_url: str
    # Optional — frontend sends `Intl.DateTimeFormat().resolvedOptions().timeZone`.
    # Used to seed booking_settings.timezone so customer-facing slot times match
    # the merchant's actual operating timezone from day 1.
    timezone: Optional[str] = None

class RenameProjectRequest(BaseModel):
    name: str

class CreateCategoryRequest(BaseModel):
    name: str

class UpdateCategoryRequest(BaseModel):
    name: str

class SetCategoryProductsRequest(BaseModel):
    product_ids: List[int] = []

class CreateProductRequest(BaseModel):
    title: str
    subtitle: Optional[str] = None        # short tagline shown under title
    description: Optional[str] = None     # long body text
    category_id: Optional[int] = None
    seo_title: Optional[str] = None
    seo_description: Optional[str] = None
    seo_keywords: Optional[str] = None
    product_type: Optional[str] = "physical"  # physical | digital | service | event
    sku: Optional[str] = None             # optional manual override; blank = auto-generate from org settings

class UpdateProductRequest(BaseModel):
    title: Optional[str] = None
    subtitle: Optional[str] = None
    description: Optional[str] = None
    category_id: Optional[int] = None    # pass null to clear, omit to leave unchanged
    seo_title: Optional[str] = None
    seo_description: Optional[str] = None
    seo_keywords: Optional[str] = None
    product_type: Optional[str] = None
    is_archived: Optional[bool] = None
    is_paused: Optional[bool] = None
    # ── Phase 1: SaaS-grade physical fields (all optional / nullable) ──
    sku: Optional[str] = None
    barcode: Optional[str] = None
    brand: Optional[str] = None
    manufacturer: Optional[str] = None
    vendor: Optional[str] = None
    country_of_origin: Optional[str] = None
    hs_code: Optional[str] = None
    og_image_url: Optional[str] = None
    requires_shipping: Optional[bool] = None
    ships_internationally: Optional[bool] = None
    shipping_class: Optional[str] = None              # standard|fragile|oversized|hazmat|perishable
    lead_time_days: Optional[int] = None
    continue_selling_oos: Optional[bool] = None
    moq: Optional[int] = None
    order_increment: Optional[int] = None
    low_stock_threshold: Optional[int] = None
    is_pre_order: Optional[bool] = None
    pre_order_release_at: Optional[str] = None        # ISO timestamp
    net_terms_days: Optional[int] = None
    allow_po: Optional[bool] = None
    tax_category_id: Optional[int] = None             # null clears
    # ── Discount (product-level, propagates to every SKU lacking its own) ──
    sale_type:       Optional[str]   = None  # 'percent' | 'amount' | 'fixed' | null=clear
    sale_value:      Optional[float] = None
    sale_starts_at:  Optional[str]   = None  # ISO; null = effective immediately
    sale_ends_at:    Optional[str]   = None  # ISO; null = no end

class TaxCategoryRequest(BaseModel):
    name: Optional[str] = None
    rate: Optional[float] = None
    is_default: Optional[bool] = None

class TierPricingRequest(BaseModel):
    sku_id: int
    min_qty: int
    price: float

class StockAdjustRequest(BaseModel):
    sku_id: int
    delta: int                              # signed: +50 = restock, -2 = manual write-off
    reason: str                             # see ADJUST_REASONS below — unified with bulk-receive
    note: Optional[str] = ''
    warehouse_id: Optional[int] = None
    # Optional batch routing. When batch_id is set the delta is applied to that specific
    # batch's quantity_remaining (positive bumps received+remaining, negative reduces
    # remaining). When new_batch_name is set (positive delta only) a new batch is created.
    # When neither is set, the legacy path runs: just bump product_stock, no batch touched.
    batch_id:       Optional[int] = None
    new_batch_name: Optional[str] = None

class WarehouseRequest(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    address: Optional[str] = None              # legacy / fallback free-form
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    # Structured address — preferred. UI groups these as "Address" section.
    country:       Optional[str] = None
    city:          Optional[str] = None
    street:        Optional[str] = None
    postal_code:   Optional[str] = None
    region:        Optional[str] = None
    # Operations contact (optional) — useful for transit/coordination calls.
    contact_name:  Optional[str] = None
    contact_phone: Optional[str] = None
    notes:         Optional[str] = None

class CreateVariationRequest(BaseModel):
    variation_name: Optional[str]       = None
    images:         Optional[List[str]] = None   # full gallery; first = cover

class UpdateVariationRequest(BaseModel):
    variation_name: Optional[str]       = None
    images:         Optional[List[str]] = None   # whole array overwrites — frontend orchestrates upload-then-PUT

class ReorderVariationsRequest(BaseModel):
    # New ordering of variation IDs for a product; array index becomes `position` (drag-and-drop in CRM).
    variation_ids: List[int]

class ReorderIdsRequest(BaseModel):
    # Generic reorder payload: array index → position. Used by L2-5 layer-row,
    # specifications, and custom-fields reorder endpoints.
    ids: List[int] = []
    parent_id: Optional[int]    = None  # required for L2-5 (scope) and specs
    layer: Optional[int]        = None  # required for specs reorder
    field_keys: Optional[List[str]] = None  # custom_fields use string keys, not ids

class CreateConfigurationRequest(BaseModel):
    configuration_name: str
    price: float
    stock_quantity: int = 0

class UpdateConfigurationRequest(BaseModel):
    configuration_name: str = None
    price: float = None
    stock_quantity: int = None

class CreateSpecificationRequest(BaseModel):
    spec_key: Optional[str] = ''
    spec_value: Optional[str] = ''
    layer: Optional[int] = 1
    parent_id: Optional[int] = None

class UpdateSpecificationRequest(BaseModel):
    spec_key: Optional[str] = None
    spec_value: Optional[str] = None

class CreateLayerItemRequest(BaseModel):
    parent_id: Optional[int] = None     # required for layer >= 2
    name: Optional[str] = ''
    price: Optional[float] = None       # NULL = inherit from parent
    stock_quantity: Optional[int] = 0
    sold_quantity: Optional[int] = 0
    images: Optional[List[str]] = None  # layer 1 only — cover = images[0]

class UpdateLayerItemRequest(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None       # explicit null in payload = clear (inherit)
    stock_quantity: Optional[int] = None
    sold_quantity: Optional[int] = None
    images: Optional[List[str]] = None  # whole array overwrite (L1 only)
    media_alt: Optional[List[str]] = None  # L1 only, parallel to images
    # ── Discount (per-layer; walk-up resolution: L2 own → L1 own → product own) ──
    sale_type:       Optional[str]   = None  # 'percent' | 'amount' | 'fixed' | null=clear
    sale_value:      Optional[float] = None
    # ── Phase 1: per-SKU (L2) physical fields. All optional + nullable. ──
    sku_code:         Optional[str]   = None
    barcode:          Optional[str]   = None
    compare_at_price: Optional[float] = None
    cost_price:       Optional[float] = None
    weight_g:         Optional[float] = None
    length_cm:        Optional[float] = None
    width_cm:         Optional[float] = None
    height_cm:        Optional[float] = None
    sale_price:       Optional[float] = None
    sale_starts_at:   Optional[str]   = None  # ISO timestamp
    sale_ends_at:     Optional[str]   = None  # ISO timestamp

class UpsertCustomFieldRequest(BaseModel):
    field_key: str
    field_value: str = None
    field_type: str = "string"
    is_global: bool = False

class ModifierGroupRequest(BaseModel):
    # All fields optional so the same model serves create + partial update via fields_set.
    name:            Optional[str]   = None
    control_type:    Optional[str]   = None     # 'checkbox' | 'radio'
    min_select:      Optional[int]   = None
    max_select:      Optional[int]   = None     # null = unlimited (checkbox)
    is_required:     Optional[bool]  = None
    default_item_id: Optional[int]   = None     # null clears (radio without preselect)

class ModifierItemRequest(BaseModel):
    name:        Optional[str]   = None
    price_delta: Optional[float] = None

class ReorderGroupsRequest(BaseModel):
    ids: List[int] = []                          # full list of group ids in new order

class ReorderItemsRequest(BaseModel):
    # Cross-group move + reorder in one shot. Each entry: { id, group_id, position }.
    # group_id can be the same (sort within group) or different (move between groups).
    items: List[dict] = []

class RestoreRequest(BaseModel):
    # Generic Undo snapshot — fresh IDs assigned on rebuild.
    type: str                         # variation | layer_node | layer | custom_fields
    layer: Optional[int]      = None  # required for layer_node + layer
    parent_id: Optional[int]  = None  # required for layer_node (l2-5)
    data: Optional[dict]      = None  # the recursive node payload
    rows: Optional[list]      = None  # list of nodes (whole-layer / cf cascade)

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

# ── ХЕЛПЕРЫ ──────────────────────────────────────────────

# Password hashing: new "$scrypt$<b64-salt>$<b64-hash>" (salt=16B, hash=32B); legacy 64-hex SHA-256 still verifies and is lazily re-hashed on login.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2 ** 14, 8, 1

def hash_pw(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h    = hashlib.scrypt(pw.encode(), salt=salt,
                          n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return f"$scrypt${_b64.b64encode(salt).decode()}${_b64.b64encode(h).decode()}"

def verify_pw(pw: str, stored: str) -> bool:
    if not stored: return False
    try:
        if stored.startswith("$scrypt$"):
            _, _, salt_b64, hash_b64 = stored.split("$", 3)
            salt = _b64.b64decode(salt_b64)
            want = _b64.b64decode(hash_b64)
            got  = hashlib.scrypt(pw.encode(), salt=salt,
                                  n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
            return _hmac.compare_digest(want, got)
        # Legacy SHA-256, constant-time compare
        return _hmac.compare_digest(hashlib.sha256(pw.encode()).hexdigest(), stored)
    except Exception:
        return False

def is_legacy_hash(stored: str) -> bool:
    return bool(stored) and not stored.startswith("$scrypt$")

# ── OTP helpers (cryptographic + hashed at rest) ───────────────────────
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

def get_ip(req: Request) -> str:
    fwd = req.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (req.client.host if req.client else "unknown")

def make_token(user_id: int) -> str:
    """Short-lived (15 min) access JWT. Companion refresh token is in DB."""
    return jwt.encode(
        {"sub": str(user_id), "type": "crm",
         "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_MINUTES)},
        SECRET_KEY, algorithm=ALGORITHM,
    )

def set_cookie(response: Response, token: str):
    """Set ACCESS token cookie (short max_age — frontend silently refreshes)."""
    response.set_cookie("crm_token", token, httponly=True,
                        max_age=ACCESS_TOKEN_MINUTES * 60, samesite="lax",
                        secure=COOKIE_SECURE, path="/")

def set_refresh_cookie(response: Response, refresh_token: str):
    """Set REFRESH token cookie (long-lived, only sent to /api/refresh path)."""
    response.set_cookie("crm_refresh", refresh_token, httponly=True,
                        max_age=REFRESH_TOKEN_DAYS * 86400, samesite="lax",
                        secure=COOKIE_SECURE, path="/")

def clear_auth_cookies(response: Response):
    response.delete_cookie("crm_token",   path="/")
    response.delete_cookie("crm_refresh", path="/")

# Refresh tokens: opaque "rt_"+64hex; plaintext only in cookie, SHA-256 hash stored in DB (UNIQUE INDEX = constant-time lookup).

REVOKE_REASON_LOGOUT  = "logout"
REVOKE_REASON_ROTATED = "rotated"
REVOKE_REASON_REUSED  = "reuse_detected"   # security incident — chain wiped
REVOKE_REASON_MANUAL  = "manual_revoke"

def _new_refresh_token() -> tuple[str, str]:
    """Returns (plaintext, hash). Plaintext goes to cookie, hash to DB."""
    raw  = "rt_" + secrets.token_hex(32)
    return raw, hashlib.sha256(raw.encode()).hexdigest()

def issue_refresh_token(user_id: int, request: Request,
                        parent_id: int | None = None,
                        label: str | None = None) -> str:
    """Create a new refresh-token row, return the plaintext string for cookie."""
    raw, h = _new_refresh_token()
    ua = (request.headers.get("user-agent") or "")[:500] if request else ""
    ip = get_ip(request) if request else ""
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS)
    with db_cursor() as (conn, cur):
        cur.execute(
            """INSERT INTO crm_refresh_tokens
                  (user_id, token_hash, expires_at, parent_id, user_agent, ip, label)
               VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (user_id, h, expires_at, parent_id, ua, ip, label),
        )
        new_id = cur.fetchone()["id"]
        conn.commit()
    return raw

def _revoke_chain_from(cur, root_id: int, reason: str):
    """Walk rotation chain (parent_id ↔ rotated_to_id) and revoke all on token-reuse detection."""
    visited = set()
    queue = [root_id]
    while queue:
        cur_id = queue.pop()
        if cur_id in visited: continue
        visited.add(cur_id)
        cur.execute("""
            UPDATE crm_refresh_tokens
               SET revoked_at = COALESCE(revoked_at, NOW()),
                   revoke_reason = COALESCE(revoke_reason, %s)
             WHERE id = %s
        """, (reason, cur_id))
        cur.execute(
            "SELECT id FROM crm_refresh_tokens WHERE parent_id=%s OR rotated_to_id=%s",
            (cur_id, cur_id),
        )
        for row in cur.fetchall():
            if row["id"] not in visited: queue.append(row["id"])

def consume_refresh_token(raw: str, request: Request) -> tuple[int, str] | None:
    """Validate + atomically rotate refresh token; revokes whole chain on reuse attack signal."""
    if not raw: return None
    h = hashlib.sha256(raw.encode()).hexdigest()
    with db_cursor() as (conn, cur):
        # Lock the row to prevent concurrent rotation races
        cur.execute(
            "SELECT * FROM crm_refresh_tokens WHERE token_hash=%s FOR UPDATE",
            (h,),
        )
        row = cur.fetchone()
        if not row:
            conn.commit()
            return None
        now_utc = datetime.now(timezone.utc)
        if row["revoked_at"] is not None:
            # Token was already used — REUSE attack signal.
            _revoke_chain_from(cur, row["id"], REVOKE_REASON_REUSED)
            conn.commit()
            return None
        if row["expires_at"] and row["expires_at"] < now_utc:
            cur.execute(
                "UPDATE crm_refresh_tokens SET revoked_at=NOW(), revoke_reason='expired' WHERE id=%s",
                (row["id"],),
            )
            conn.commit()
            return None
        # Issue new refresh, mark old as rotated
        new_raw, new_h = _new_refresh_token()
        ua = (request.headers.get("user-agent") or "")[:500] if request else (row.get("user_agent") or "")
        ip = get_ip(request) if request else (row.get("ip") or "")
        new_expires = now_utc + timedelta(days=REFRESH_TOKEN_DAYS)
        cur.execute(
            """INSERT INTO crm_refresh_tokens
                  (user_id, token_hash, expires_at, parent_id, user_agent, ip, label)
               VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (row["user_id"], new_h, new_expires, row["id"], ua, ip, row.get("label")),
        )
        new_id = cur.fetchone()["id"]
        cur.execute("""
            UPDATE crm_refresh_tokens
               SET revoked_at=NOW(), revoke_reason=%s,
                   rotated_to_id=%s, last_used_at=NOW()
             WHERE id=%s
        """, (REVOKE_REASON_ROTATED, new_id, row["id"]))
        conn.commit()
        return row["user_id"], new_raw

def revoke_refresh_by_raw(raw: str, reason: str = REVOKE_REASON_LOGOUT):
    if not raw: return
    h = hashlib.sha256(raw.encode()).hexdigest()
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE crm_refresh_tokens SET revoked_at=NOW(), revoke_reason=%s "
            "WHERE token_hash=%s AND revoked_at IS NULL",
            (reason, h),
        )
        conn.commit()

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
    """Each `key` is treated as a separate (bucket=login, ident=key) pair."""
    for key in keys:
        blocked, left = _fail_check("login", key)
        if blocked:
            raise HTTPException(429, f"Too many attempts. Retry in {left}s.")

def record_fail(keys: list, now: datetime):
    for key in keys:
        cnt = _fail_record("login", key)
        if cnt >= MAX_FAILED_ATTEMPTS:
            left = max(_kv_ttl(_fail_key("login", key)), 1)
            raise HTTPException(429, f"Too many attempts. Retry in {left}s.")

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

# ── EMAIL HELPERS ────────────────────────────────────────

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

# ── CSRF TOKEN ───────────────────────────────────────────

@app.get("/api/csrf")
def get_csrf_token(request: Request, response: Response):
    """Issue (or reuse) CSRF token cookie (non-httpOnly so JS echoes it as X-CSRF-Token)."""
    token = request.cookies.get("csrf_token", "")
    if not token:
        token = secrets.token_hex(32)
    response.set_cookie(
        "csrf_token", token,
        httponly=False,          # JS must read this to echo it as a header
        samesite="strict",
        secure=COOKIE_SECURE,
        max_age=86400,           # 24 h — refreshed on each page load
        path="/",
    )
    return {"csrf_token": token}


# ── АУТЕНТИФИКАЦИЯ ───────────────────────────────────────

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
        if not verify_pw(request.password or "", existing["password"]):
            record_fail(keys, now); raise HTTPException(400, "Invalid email or password")
        # Lazy migration of legacy SHA-256 hashes
        if is_legacy_hash(existing["password"]):
            try:
                with db_cursor() as (conn2, cur2):
                    cur2.execute("UPDATE crm_users SET password=%s WHERE id=%s",
                                 (hash_pw(request.password), existing["id"]))
                    conn2.commit()
            except Exception:
                pass
    else:
        raise HTTPException(400, "Invalid type")

    code = gen_otp(6)
    now_ts = _time.time()
    _pv_set(email, {
        "code_hash":         hash_otp(code), "type": request.type,
        "name":              request.name, "password": request.password,
        "expires_ts":        now_ts + CODE_TTL_MINUTES * 60,
        "next_resend_at_ts": now_ts + RESEND_COOLDOWN_SECONDS,
        "attempts":          0,
    })
    if not send_code_email(email, code):
        _pv_del(email)
        raise HTTPException(500, "Failed to send email")

    for k in keys: _fail_clear("login", k)
    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.post("/api/verify-code")
def verify_code(request: VerifyCodeRequest, response: Response, req: Request):
    email = request.email.lower().strip()
    code  = (request.code or "").replace(" ", "").strip()
    ip    = get_ip(req)
    now   = datetime.utcnow()
    keys  = [f"ip:{ip}", f"email:{email}"]
    check_rate_limit(keys, now)

    pending = _pv_get(email)
    if not pending:
        record_fail(keys, now); raise HTTPException(400, "Code not found or expired")
    now_ts = _time.time()
    if now_ts > float(pending.get("expires_ts", 0)):
        _pv_del(email); raise HTTPException(400, "Code expired")
    pending["attempts"] = int(pending.get("attempts", 0)) + 1
    _pv_set(email, pending,
            ttl=int(max(float(pending["expires_ts"]) - now_ts, 1)))
    if pending["attempts"] > MAX_FAILED_ATTEMPTS:
        _pv_del(email)
        raise HTTPException(429, "Too many invalid attempts. Request a new code.")
    if not verify_otp(code, pending.get("code_hash", "")):
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
    set_refresh_cookie(response, issue_refresh_token(user_id, req, label="Email login"))
    _pv_del(email)
    for k in keys: _fail_clear("login", k)
    return {"success": True}


@app.post("/api/resend-code")
def resend_code_endpoint(request: ResendCodeRequest):
    email = request.email.lower().strip()
    now_ts = _time.time()
    p = _pv_get(email)
    if not p:                                       raise HTTPException(400, "No pending verification")
    if now_ts > float(p.get("expires_ts", 0)):       _pv_del(email); raise HTTPException(400, "Code expired")
    if now_ts < float(p.get("next_resend_at_ts", 0)):
        left = int(float(p["next_resend_at_ts"]) - now_ts)
        raise HTTPException(429, f"Resend available in {left}s")

    code = gen_otp(6)
    p.update(code_hash=hash_otp(code),
             expires_ts=now_ts + CODE_TTL_MINUTES * 60,
             next_resend_at_ts=now_ts + RESEND_COOLDOWN_SECONDS,
             attempts=0)
    _pv_set(email, p)
    if not send_code_email(email, code): raise HTTPException(500, "Failed to send email")
    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.get("/api/me")
def get_me(user: dict = Depends(get_current_user)):
    return db_one(
        "SELECT id, name, email, role, avatar_url FROM crm_users WHERE id = %s AND is_active = TRUE",
        (user["id"],)
    ) or HTTPException(401, "User not found")


@app.post("/api/logout")
def logout(response: Response, request: Request):
    # Revoke only THIS session's refresh token; access JWT can't be revoked but expires <15 min.
    revoke_refresh_by_raw(request.cookies.get("crm_refresh", ""))
    clear_auth_cookies(response)
    return {"success": True}


# ── REFRESH TOKEN / SESSION MANAGEMENT ───────────────────

@app.post("/api/refresh")
def refresh_session(request: Request, response: Response):
    """Exchange refresh token for NEW access+refresh pair (rotation); 401 on any failure."""
    raw = request.cookies.get("crm_refresh", "")
    result = consume_refresh_token(raw, request)
    if not result:
        clear_auth_cookies(response)
        raise HTTPException(401, "Invalid or expired refresh token")
    user_id, new_raw = result
    # Verify user still exists and is active (might have been deactivated)
    if not db_one("SELECT 1 FROM crm_users WHERE id=%s AND is_active=TRUE", (user_id,)):
        clear_auth_cookies(response)
        raise HTTPException(401, "Account disabled")
    set_cookie(response, make_token(user_id))
    set_refresh_cookie(response, new_raw)
    return {"success": True}


@app.get("/api/sessions")
def list_sessions(request: Request, user: dict = Depends(get_current_user)):
    """List active sessions for current user; marks the one matching current refresh cookie."""
    cur_hash = ""
    raw = request.cookies.get("crm_refresh", "")
    if raw:
        cur_hash = hashlib.sha256(raw.encode()).hexdigest()
    rows = db_all(
        """SELECT id, created_at, last_used_at, expires_at, user_agent, ip, label, token_hash
           FROM crm_refresh_tokens
           WHERE user_id=%s AND revoked_at IS NULL AND expires_at > NOW()
           ORDER BY COALESCE(last_used_at, created_at) DESC""",
        (user["id"],),
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


@app.delete("/api/sessions/{session_id}")
def revoke_session(session_id: int, user: dict = Depends(get_current_user)):
    """Revoke a single session (logout from one device)."""
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE crm_refresh_tokens SET revoked_at=NOW(), revoke_reason=%s "
            "WHERE id=%s AND user_id=%s AND revoked_at IS NULL",
            (REVOKE_REASON_MANUAL, session_id, user["id"]),
        )
        conn.commit()
    return {"ok": True}


@app.post("/api/logout-all")
def logout_all(response: Response, user: dict = Depends(get_current_user)):
    """Revoke EVERY session for this user (logout from all devices)."""
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE crm_refresh_tokens SET revoked_at=NOW(), revoke_reason=%s "
            "WHERE user_id=%s AND revoked_at IS NULL",
            (REVOKE_REASON_MANUAL, user["id"]),
        )
        conn.commit()
    clear_auth_cookies(response)
    return {"ok": True}


# ── ВОССТАНОВЛЕНИЕ ПАРОЛЯ ────────────────────────────────

@app.post("/api/forgot-password")
def forgot_password(request: ForgotPasswordRequest, req: Request):
    email = request.email.lower().strip()
    ip    = get_ip(req)

    # Per-IP and per-email rate limit (mitigate enumeration + email bombing)
    for ident in (f"ip:{ip}", f"email:{email}"):
        blocked, left = _fail_check("reset", ident)
        if blocked:
            raise HTTPException(429, f"Too many requests. Try again in {left} seconds.")
        _fail_record("reset", ident)

    # Always return generic success — never differentiate existence.
    if db_one("SELECT id FROM crm_users WHERE email = %s", (email,)):
        # Sweep prior tokens for this email (cheap; they auto-expire anyway)
        for k in _kv_keys_matching("pw_reset:*"):
            d = _kv_get(k)
            if d and d.get("email") == email:
                _kv_delete(k)
        raw = secrets.token_urlsafe(32)
        h   = hashlib.sha256(raw.encode()).hexdigest()
        _reset_set(h, {"email": email, "used": False})
        try:
            send_reset_email(email, raw)
        except Exception:
            pass
    return {"success": True}


@app.get("/api/reset-password/validate/{token}")
def validate_reset_token(token: str):
    data = _reset_get(hashlib.sha256(token.encode()).hexdigest())
    if not data or data.get("used"):
        raise HTTPException(400, "Invalid or expired reset link")
    return {"valid": True, "email": data["email"]}


@app.post("/api/reset-password")
def reset_password(request: ResetPasswordRequest):
    if request.password != request.repeat_password:
        raise HTTPException(400, "Passwords do not match")
    validate_password(request.password)
    h    = hashlib.sha256(request.token.encode()).hexdigest()
    data = _reset_get(h)
    if not data or data.get("used"):
        raise HTTPException(400, "Invalid or expired reset link")

    # Mark used FIRST (still in store) to defeat reuse races, then update DB
    data["used"] = True
    _reset_set(h, data)
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE crm_users SET password = %s WHERE email = %s",
                    (hash_pw(request.password), data["email"]))
        conn.commit()
    _reset_del(h)
    return {"success": True}


# ── ORGANIZATIONS ────────────────────────────────────────

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


# ── PROJECTS ─────────────────────────────────────────────

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


# Org-wide SKU generation settings on crm_organizations: modes numeric/letters/alphanumeric/manual, length 4..64 (default numeric, 8).

@app.get("/api/orgs/{org_id}/sku-settings")
def get_org_sku_settings(org_id: int, user: dict = Depends(get_current_user)):
    require_org_owner(user, org_id)
    row = db_one("SELECT sku_mode, sku_length FROM crm_organizations WHERE id=%s", (org_id,))
    if not row: raise HTTPException(404, "Org not found")
    return {"mode": row["sku_mode"], "length": int(row["sku_length"])}


@app.put("/api/orgs/{org_id}/sku-settings")
def update_org_sku_settings(org_id: int, body: dict = Body(...),
                              user: dict = Depends(get_current_user)):
    require_org_owner(user, org_id)
    mode = (body.get("mode") or "numeric").strip().lower()
    if mode not in ("numeric", "letters", "alphanumeric", "manual"):
        raise HTTPException(400, "Invalid mode")
    try:
        length = int(body.get("length", 8))
    except Exception:
        raise HTTPException(400, "Length must be an integer")
    if length < 4 or length > 64:
        raise HTTPException(400, "Length must be 4..64")
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE crm_organizations SET sku_mode=%s, sku_length=%s WHERE id=%s",
                    (mode, length, org_id))
        conn.commit()
    return {"ok": True, "mode": mode, "length": length}


@app.post("/api/orgs/{org_id}/sku-regenerate")
def regenerate_org_skus(org_id: int, user: dict = Depends(get_current_user)):
    """Wipe + regenerate every product.sku and l2.sku_code in the org under current settings."""
    require_org_owner(user, org_id)
    settings = db_one("SELECT sku_mode, sku_length FROM crm_organizations WHERE id=%s", (org_id,))
    if not settings: raise HTTPException(404, "Org not found")
    mode = settings["sku_mode"]; length = int(settings["sku_length"])

    with db_cursor() as (conn, cur):
        cur.execute("SELECT id FROM crm_projects WHERE org_id=%s", (org_id,))
        project_ids = [r["id"] for r in cur.fetchall()]
        if not project_ids:
            return {"ok": True, "products_updated": 0, "skus_updated": 0}

        if mode == "manual":
            cur.execute("UPDATE products SET sku='' WHERE project_id = ANY(%s)", (project_ids,))
            products_updated = cur.rowcount
            cur.execute(
                "UPDATE product_configurations_l2 SET sku_code='' WHERE product_id IN"
                " (SELECT id FROM products WHERE project_id = ANY(%s))",
                (project_ids,)
            )
            skus_updated = cur.rowcount
            conn.commit()
            return {"ok": True, "products_updated": products_updated, "skus_updated": skus_updated}

        # Clear first, then regenerate row-by-row.
        cur.execute("UPDATE products SET sku='' WHERE project_id = ANY(%s)", (project_ids,))
        cur.execute(
            "UPDATE product_configurations_l2 SET sku_code='' WHERE product_id IN"
            " (SELECT id FROM products WHERE project_id = ANY(%s))",
            (project_ids,)
        )

        cur.execute("SELECT id, project_id FROM products WHERE project_id = ANY(%s)", (project_ids,))
        prod_rows = cur.fetchall()
        products_updated = 0
        for pr in prod_rows:
            new_sku = _gen_unique_product_sku(cur, pr["project_id"], mode, length)
            if new_sku:
                cur.execute("UPDATE products SET sku=%s WHERE id=%s", (new_sku, pr["id"]))
                products_updated += 1

        cur.execute(
            "SELECT c2.id, c2.product_id FROM product_configurations_l2 c2"
            " JOIN products p ON p.id = c2.product_id"
            " WHERE p.project_id = ANY(%s)",
            (project_ids,)
        )
        l2_rows = cur.fetchall()
        skus_updated = 0
        for lr in l2_rows:
            new_code = _gen_unique_l2_sku_code(cur, lr["product_id"], mode, length)
            if new_code:
                cur.execute("UPDATE product_configurations_l2 SET sku_code=%s WHERE id=%s",
                            (new_code, lr["id"]))
                skus_updated += 1
        conn.commit()
    return {"ok": True, "products_updated": products_updated, "skus_updated": skus_updated}


# Org-wide payment provider settings. Variant A model — CRM never touches money.
# Merchant connects their own Stripe/Tinkoff/etc. account on their storefront; this records
# which provider they use so the Returns workflow can show the right refund instructions.
PAYMENT_PROVIDERS = ("stripe", "tinkoff", "cloudpayments", "yookassa", "paypal",
                      "adyen", "braintree", "square", "mollie", "razorpay", "paddle", "paybox",
                      "manual", "other")

@app.get("/api/orgs/{org_id}/payment-settings")
def get_org_payment_settings(org_id: int, user: dict = Depends(get_current_user)):
    require_org_owner(user, org_id)
    row = db_one(
        "SELECT payment_provider, payment_account_label, payment_dashboard_url"
        " FROM crm_organizations WHERE id=%s",
        (org_id,)
    )
    if not row: raise HTTPException(404, "Org not found")
    return {
        "provider":      row["payment_provider"] or "manual",
        "account_label": row["payment_account_label"] or "",
        "dashboard_url": row["payment_dashboard_url"] or "",
    }


@app.put("/api/orgs/{org_id}/payment-settings")
def update_org_payment_settings(org_id: int, body: dict = Body(...),
                                  user: dict = Depends(get_current_user)):
    require_org_owner(user, org_id)
    provider = (body.get("provider") or "manual").strip().lower()
    if provider not in PAYMENT_PROVIDERS:
        raise HTTPException(400, f"Invalid provider. Allowed: {PAYMENT_PROVIDERS}")
    account_label = sanitize((body.get("account_label") or "").strip())[:160]
    dashboard_url = (body.get("dashboard_url") or "").strip()[:600]
    if dashboard_url and not dashboard_url.startswith(("http://", "https://")):
        raise HTTPException(400, "Dashboard URL must start with http:// or https://")
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE crm_organizations"
            "   SET payment_provider=%s, payment_account_label=%s, payment_dashboard_url=%s"
            " WHERE id=%s",
            (provider, account_label, dashboard_url, org_id)
        )
        conn.commit()
    return {"ok": True, "provider": provider,
            "account_label": account_label, "dashboard_url": dashboard_url}


# ── Payment credentials (encrypted at rest) ───────────────────────────────
# Per-org Stripe/Tinkoff/etc. API keys. Only org owners can read/write.
# Secret fields are NEVER returned in plaintext — only the last 4 chars + a
# masked indicator. The full secret can only be read internally by code that
# imports payment_crypto.decrypt_credentials() and is gated by require_org_owner.
#
# Security checklist:
#  • secret_key never leaves the DB except via payment_providers.* helpers
#  • all writes require org owner (require_org_owner)
#  • prefix validation prevents pasting a publishable key into the secret field
#  • test endpoint pings the real provider API to catch bad keys before saving
#  • DELETE clears credentials AND resets is_connected (so refund attempts fail loudly)

# ── Inlined: payment_crypto (Fernet AES-128 encryption of merchant creds) ──

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

# ── Inlined: payment_providers (CRM-side: test_connection + create_refund) ──

import base64
import hashlib
import hmac
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


# ── Provider catalogue ─────────────────────────────────────────────────────
# Required credential fields per provider. Used by CRM endpoints to validate
# the request body shape and by the frontend to render the form.

PROVIDER_FIELDS: dict[str, list[dict[str, Any]]] = {
    "stripe": [
        {"key": "publishable_key", "label": "Publishable key", "type": "text",
         "placeholder": "pk_test_…",     "secret": False, "required": True,
         "validate_prefix": ["pk_test_", "pk_live_"]},
        {"key": "secret_key",      "label": "Secret key",      "type": "password",
         "placeholder": "sk_test_…",     "secret": True,  "required": True,
         "validate_prefix": ["sk_test_", "sk_live_", "rk_test_", "rk_live_"]},
        {"key": "webhook_secret",  "label": "Webhook signing secret", "type": "password",
         "placeholder": "whsec_…",      "secret": True,  "required": False,
         "validate_prefix": ["whsec_"]},
    ],
    "tinkoff": [
        {"key": "terminal_key", "label": "Terminal key", "type": "text",
         "placeholder": "1234567890123", "secret": False, "required": True},
        {"key": "password",     "label": "Terminal password", "type": "password",
         "placeholder": "",              "secret": True,  "required": True},
    ],
    "cloudpayments": [
        {"key": "public_id", "label": "Public ID",     "type": "text",
         "placeholder": "pk_…",          "secret": False, "required": True},
        {"key": "api_secret", "label": "API secret",   "type": "password",
         "placeholder": "",              "secret": True,  "required": True},
    ],
    "yookassa": [
        {"key": "shop_id",    "label": "Shop ID",      "type": "text",
         "placeholder": "123456",        "secret": False, "required": True},
        {"key": "secret_key", "label": "Secret key",   "type": "password",
         "placeholder": "live_…/test_…", "secret": True,  "required": True},
    ],
    "paypal": [
        {"key": "client_id",     "label": "Client ID",     "type": "text",
         "placeholder": "",              "secret": False, "required": True},
        {"key": "client_secret", "label": "Client secret", "type": "password",
         "placeholder": "",              "secret": True,  "required": True},
        {"key": "webhook_id",    "label": "Webhook ID",    "type": "text",
         "placeholder": "WH-…",          "secret": False, "required": False},
    ],
    # Adyen — API key + HMAC key for webhook signatures + merchant account name.
    # client_key is the frontend-safe key (Drop-in JS uses it).
    "adyen": [
        {"key": "api_key",          "label": "API key",          "type": "password",
         "placeholder": "AQE…",       "secret": True,  "required": True},
        {"key": "merchant_account", "label": "Merchant account", "type": "text",
         "placeholder": "TortaECOM",  "secret": False, "required": True},
        {"key": "client_key",       "label": "Client key",       "type": "text",
         "placeholder": "test_…/live_…", "secret": False, "required": False},
        {"key": "hmac_key",         "label": "HMAC key (webhooks)", "type": "password",
         "placeholder": "",           "secret": True,  "required": False},
    ],
    # Braintree — public/private key pair + merchant_id. webhook signature uses private_key.
    "braintree": [
        {"key": "merchant_id", "label": "Merchant ID", "type": "text",
         "placeholder": "abc123xyz",       "secret": False, "required": True},
        {"key": "public_key",  "label": "Public key",  "type": "text",
         "placeholder": "",                "secret": False, "required": True},
        {"key": "private_key", "label": "Private key", "type": "password",
         "placeholder": "",                "secret": True,  "required": True},
    ],
    # Square — bearer access_token + application_id + location_id (per-location pricing).
    "square": [
        {"key": "access_token",   "label": "Access token",   "type": "password",
         "placeholder": "EAAAEE…",     "secret": True,  "required": True,
         "validate_prefix": ["EAAA"]},
        {"key": "application_id", "label": "Application ID", "type": "text",
         "placeholder": "sandbox-sq0idb-…/sq0idp-…", "secret": False, "required": True},
        {"key": "location_id",    "label": "Location ID",    "type": "text",
         "placeholder": "L…",         "secret": False, "required": True},
        {"key": "webhook_signature_key", "label": "Webhook signature key", "type": "password",
         "placeholder": "",            "secret": True,  "required": False},
    ],
    # Mollie — single API key carries the test/live mode in its prefix.
    "mollie": [
        {"key": "api_key", "label": "API key", "type": "password",
         "placeholder": "test_…/live_…", "secret": True, "required": True,
         "validate_prefix": ["test_", "live_"]},
    ],
    # Razorpay — key_id + key_secret + webhook secret (HMAC-SHA256).
    "razorpay": [
        {"key": "key_id",         "label": "Key ID",         "type": "text",
         "placeholder": "rzp_test_…/rzp_live_…", "secret": False, "required": True,
         "validate_prefix": ["rzp_test_", "rzp_live_"]},
        {"key": "key_secret",     "label": "Key secret",     "type": "password",
         "placeholder": "",         "secret": True,  "required": True},
        {"key": "webhook_secret", "label": "Webhook secret", "type": "password",
         "placeholder": "",         "secret": True,  "required": False},
    ],
    # Paddle Billing (new API) — bearer api_key + notification secret.
    "paddle": [
        {"key": "api_key",        "label": "API key",        "type": "password",
         "placeholder": "pdl_…",    "secret": True,  "required": True,
         "validate_prefix": ["pdl_", "apikey_"]},
        {"key": "webhook_secret", "label": "Notification secret", "type": "password",
         "placeholder": "pdl_ntfset_…", "secret": True, "required": False},
    ],
    # PayBox.money — Kazakhstan-focused. Signature-based auth (no header).
    "paybox": [
        {"key": "merchant_id", "label": "Merchant ID", "type": "text",
         "placeholder": "525447",   "secret": False, "required": True},
        {"key": "secret_key",  "label": "Secret key",  "type": "password",
         "placeholder": "",         "secret": True,  "required": True},
    ],
    "manual": [],
    "other":  [],
}

# Which fields are SECRET — used by mask_credentials() to redact before API responses.
# Note: builtin `set` is shadowed at module level by _kv_set(), so we use a
# string-form annotation here (PEP 563-style forward ref) which evaluates lazily.
SECRET_FIELDS: "dict[str, set[str]]" = {
    p: {f["key"] for f in fields if f.get("secret")}
    for p, fields in PROVIDER_FIELDS.items()
}


# ── Helpers ────────────────────────────────────────────────────────────────

_TIMEOUT = 15  # seconds, hard cap on every outbound call


def _ok(data: dict, raw: dict | None = None) -> dict:
    return {"ok": True, "data": data, "error": "", "raw": raw or {}}


def _err(message: str, raw: dict | None = None) -> dict:
    return {"ok": False, "data": {}, "error": message, "raw": raw or {}}


def _http_request(method: str, url: str, *, headers: dict | None = None,
                   body: bytes | None = None, basic_auth: tuple[str, str] | None = None,
                   bearer: str | None = None) -> dict:
    """Minimal urllib wrapper. Returns {"status": int, "body": dict|str}.
    Never raises on HTTP errors — body is captured for both success and error responses
    so the provider's error message can be surfaced.
    """
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


def validate_credentials_shape(provider: str, creds: dict) -> tuple[bool, str]:
    """Quick structural check before encrypt+save. Does NOT hit the network.
    Verifies required keys exist + match their expected prefix (if defined).
    """
    if provider not in PROVIDER_FIELDS:
        return False, f"Unknown provider: {provider}"
    for spec in PROVIDER_FIELDS[provider]:
        key = spec["key"]
        if spec["required"] and not str(creds.get(key, "")).strip():
            return False, f"Missing required field: {spec['label']}"
        val = str(creds.get(key, "")).strip()
        prefixes = spec.get("validate_prefix")
        if val and prefixes and not any(val.startswith(p) for p in prefixes):
            return False, f"{spec['label']} must start with one of: {', '.join(prefixes)}"
    return True, ""


def mask_credentials(provider: str, creds: dict) -> dict:
    """Redact secret fields for safe display. Public fields stay readable;
    secrets become '••••••••<last4>'.
    """
    if not creds:
        return {}
    secrets_set = SECRET_FIELDS.get(provider, set())
    out: dict[str, str] = {}
    for k, v in creds.items():
        if k in secrets_set:
            s = str(v) if v else ""
            out[k] = ("•" * 8 + s[-4:]) if len(s) > 4 else ("•" * len(s) if s else "")
            out[k + "_present"] = bool(s)
        else:
            out[k] = v
    return out


# ── Stripe ─────────────────────────────────────────────────────────────────
# Uses dashboard.stripe.com REST API directly (no `stripe` SDK).
# For Connect: pass connected account ID via Stripe-Account header.

_STRIPE_BASE = "https://api.stripe.com/v1"


def _stripe_headers(secret_key: str, stripe_account_id: str = "") -> dict:
    h = {"Content-Type": "application/x-www-form-urlencoded"}
    if stripe_account_id:
        h["Stripe-Account"] = stripe_account_id
    return h


def stripe_test_connection(creds: dict, stripe_account_id: str = "") -> dict:
    """Ping GET /v1/balance — the cheapest API call that requires a valid secret key.
    For Connect mode also tries GET /v1/accounts/{acct_id} to verify the connected
    account is still active.
    """
    sk = creds.get("secret_key", "").strip()
    if not sk:
        return _err("Missing secret_key")
    r = _http_request("GET", f"{_STRIPE_BASE}/balance",
                      headers=_stripe_headers(sk, stripe_account_id), bearer=sk)
    if r["status"] == 200:
        # Sanity-check that publishable_key (if present) matches the same mode (test/live)
        pk = creds.get("publishable_key", "").strip()
        if pk:
            pk_test = pk.startswith("pk_test_")
            sk_test = sk.startswith("sk_test_") or sk.startswith("rk_test_")
            if pk_test != sk_test:
                return _err("Publishable and secret keys are in different modes (one test, one live)")
        return _ok({"livemode": not sk.startswith(("sk_test_", "rk_test_"))}, r["body"])
    if r["status"] == 401:
        return _err("Invalid Stripe secret key (401 from /v1/balance)", r["body"])
    if r["status"] == 0:
        return _err(f"Network error: {r['body'].get('error', 'unknown')}")
    return _err(f"Stripe rejected the key (HTTP {r['status']})", r["body"])


def stripe_create_refund(creds: dict, charge_or_intent_id: str, amount_cents: int,
                          idempotency_key: str, stripe_account_id: str = "") -> dict:
    """POST /v1/refunds.
    Pass payment_intent= (for PaymentIntents flow) — Stripe accepts either ch_ or pi_.
    """
    sk = creds.get("secret_key", "").strip()
    if not sk:
        return _err("Missing secret_key")
    if amount_cents <= 0:
        return _err("Refund amount must be positive")
    if charge_or_intent_id.startswith("pi_"):
        payload = {"payment_intent": charge_or_intent_id, "amount": str(amount_cents)}
    else:
        payload = {"charge": charge_or_intent_id, "amount": str(amount_cents)}
    body = urllib.parse.urlencode(payload).encode("utf-8")

    headers = _stripe_headers(sk, stripe_account_id)
    headers["Idempotency-Key"] = idempotency_key

    r = _http_request("POST", f"{_STRIPE_BASE}/refunds",
                      headers=headers, body=body, bearer=sk)
    if r["status"] == 200 and isinstance(r["body"], dict):
        rid = r["body"].get("id", "")
        status = r["body"].get("status", "")
        return _ok({"refund_id": rid, "status": status, "amount": r["body"].get("amount", 0)}, r["body"])
    msg = (r["body"] or {}).get("error", {}).get("message", "") if isinstance(r["body"], dict) else ""
    return _err(msg or f"Stripe refund failed (HTTP {r['status']})", r["body"] if isinstance(r["body"], dict) else {})


# ── Tinkoff ────────────────────────────────────────────────────────────────
# https://www.tinkoff.ru/kassa/dev/payments/
# Tinkoff signs requests via Token = SHA256 of concatenated values of all
# top-level params (sorted by key) + Password. We add Token field server-side.

_TINKOFF_BASE = "https://securepay.tinkoff.ru/v2"


def _tinkoff_sign(params: dict, password: str) -> str:
    """Token = sha256 of values of {sorted top-level params + Password}, hex digest."""
    items = {k: v for k, v in params.items() if not isinstance(v, (dict, list))}
    items["Password"] = password
    concat = "".join(str(items[k]) for k in sorted(items))
    return hashlib.sha256(concat.encode("utf-8")).hexdigest()


def tinkoff_test_connection(creds: dict) -> dict:
    """Tinkoff has no read-only endpoint — we ping GetState with a fake PaymentId.
    A valid terminal+password returns INVALID_REQUEST_PARAMETERS error code,
    while invalid creds return BAD_TOKEN — that's how we distinguish."""
    tk = creds.get("terminal_key", "").strip()
    pw = creds.get("password", "").strip()
    if not tk or not pw:
        return _err("Missing terminal_key or password")
    payload = {"TerminalKey": tk, "PaymentId": "0"}
    payload["Token"] = _tinkoff_sign(payload, pw)
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_TINKOFF_BASE}/GetState",
                       headers={"Content-Type": "application/json"}, body=body)
    if r["status"] != 200 or not isinstance(r["body"], dict):
        return _err(f"Tinkoff API unavailable (HTTP {r['status']})", r["body"] if isinstance(r["body"], dict) else {})
    if r["body"].get("Success") is True:
        # Unlikely with PaymentId=0, but accept it
        return _ok({}, r["body"])
    code = str(r["body"].get("ErrorCode", ""))
    # Bad credentials → ErrorCode "8" or message "Неверный токен"; we treat anything
    # other than auth-failure codes as "creds OK, just bad request params"
    if code in ("8",) or "Token" in str(r["body"].get("Message", "")) or "токен" in str(r["body"].get("Details", "")).lower():
        return _err("Invalid Tinkoff terminal_key or password", r["body"])
    return _ok({}, r["body"])


def tinkoff_create_refund(creds: dict, payment_id: str, amount_kopecks: int,
                           idempotency_key: str) -> dict:
    """POST /v2/Cancel — refunds the (paid) payment. Tinkoff uses 'Cancel' for both
    void (pre-capture) and refund (post-capture)."""
    tk = creds.get("terminal_key", "").strip()
    pw = creds.get("password", "").strip()
    if not tk or not pw:
        return _err("Missing terminal_key or password")
    if amount_kopecks <= 0:
        return _err("Refund amount must be positive")
    payload = {"TerminalKey": tk, "PaymentId": payment_id, "Amount": amount_kopecks,
               "IP": "", "Receipt": ""}
    payload = {k: v for k, v in payload.items() if v not in ("", None)}
    payload["Token"] = _tinkoff_sign(payload, pw)
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_TINKOFF_BASE}/Cancel",
                       headers={"Content-Type": "application/json",
                                "Idempotency-Key": idempotency_key}, body=body)
    if r["status"] == 200 and isinstance(r["body"], dict) and r["body"].get("Success") is True:
        return _ok({"refund_id": str(r["body"].get("PaymentId", "")), "status": r["body"].get("Status", "")}, r["body"])
    msg = (r["body"] or {}).get("Message", "") if isinstance(r["body"], dict) else f"HTTP {r['status']}"
    return _err(msg or f"Tinkoff refund failed (HTTP {r['status']})", r["body"] if isinstance(r["body"], dict) else {})


# ── CloudPayments ──────────────────────────────────────────────────────────
# https://developers.cloudpayments.ru/
# HTTP Basic auth: public_id : api_secret.

_CLOUDPAYMENTS_BASE = "https://api.cloudpayments.ru"


def cloudpayments_test_connection(creds: dict) -> dict:
    """Calls /test — explicit credential-check endpoint."""
    pid = creds.get("public_id", "").strip()
    sec = creds.get("api_secret", "").strip()
    if not pid or not sec:
        return _err("Missing public_id or api_secret")
    r = _http_request("POST", f"{_CLOUDPAYMENTS_BASE}/test",
                       headers={"Content-Type": "application/json"},
                       body=b"{}", basic_auth=(pid, sec))
    if r["status"] == 200 and isinstance(r["body"], dict) and r["body"].get("Success") is True:
        return _ok({}, r["body"])
    if r["status"] == 401:
        return _err("Invalid CloudPayments public_id or api_secret", r["body"] if isinstance(r["body"], dict) else {})
    return _err(f"CloudPayments rejected (HTTP {r['status']})", r["body"] if isinstance(r["body"], dict) else {})


def cloudpayments_create_refund(creds: dict, transaction_id: str, amount: float,
                                 idempotency_key: str) -> dict:
    """POST /payments/refund. Amount in major units (rubles)."""
    pid = creds.get("public_id", "").strip()
    sec = creds.get("api_secret", "").strip()
    if not pid or not sec:
        return _err("Missing public_id or api_secret")
    if amount <= 0:
        return _err("Refund amount must be positive")
    body = json.dumps({"TransactionId": int(transaction_id), "Amount": round(float(amount), 2)}).encode("utf-8")
    r = _http_request("POST", f"{_CLOUDPAYMENTS_BASE}/payments/refund",
                       headers={"Content-Type": "application/json",
                                "X-Request-ID": idempotency_key},
                       body=body, basic_auth=(pid, sec))
    if r["status"] == 200 and isinstance(r["body"], dict) and r["body"].get("Success") is True:
        m = r["body"].get("Model") or {}
        return _ok({"refund_id": str(m.get("TransactionId", "")), "status": "succeeded"}, r["body"])
    msg = (r["body"] or {}).get("Message", "") if isinstance(r["body"], dict) else f"HTTP {r['status']}"
    return _err(msg or f"CloudPayments refund failed", r["body"] if isinstance(r["body"], dict) else {})


# ── YooKassa ───────────────────────────────────────────────────────────────
# https://yookassa.ru/developers/api
# HTTP Basic auth: shop_id : secret_key. Idempotence-Key header required on POSTs.

_YOOKASSA_BASE = "https://api.yookassa.ru/v3"


def yookassa_test_connection(creds: dict) -> dict:
    """GET /me returns the shop info — minimum read call."""
    shop = creds.get("shop_id", "").strip()
    sec  = creds.get("secret_key", "").strip()
    if not shop or not sec:
        return _err("Missing shop_id or secret_key")
    r = _http_request("GET", f"{_YOOKASSA_BASE}/me", basic_auth=(shop, sec))
    if r["status"] == 200 and isinstance(r["body"], dict):
        return _ok({"shop": r["body"].get("name", "")}, r["body"])
    if r["status"] == 401:
        return _err("Invalid YooKassa shop_id or secret_key", r["body"] if isinstance(r["body"], dict) else {})
    return _err(f"YooKassa rejected (HTTP {r['status']})", r["body"] if isinstance(r["body"], dict) else {})


def yookassa_create_refund(creds: dict, payment_id: str, amount: float,
                            currency: str, idempotency_key: str) -> dict:
    """POST /refunds. payment_id is YooKassa's payment.id (UUID)."""
    shop = creds.get("shop_id", "").strip()
    sec  = creds.get("secret_key", "").strip()
    if not shop or not sec:
        return _err("Missing shop_id or secret_key")
    if amount <= 0:
        return _err("Refund amount must be positive")
    payload = {
        "payment_id": payment_id,
        "amount": {"value": f"{round(float(amount), 2):.2f}", "currency": currency or "RUB"},
    }
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_YOOKASSA_BASE}/refunds",
                       headers={"Content-Type": "application/json",
                                "Idempotence-Key": idempotency_key},
                       body=body, basic_auth=(shop, sec))
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        return _ok({"refund_id": r["body"].get("id", ""), "status": r["body"].get("status", "")}, r["body"])
    if r["status"] == 401:
        return _err("Invalid YooKassa credentials", r["body"] if isinstance(r["body"], dict) else {})
    desc = (r["body"] or {}).get("description", "") if isinstance(r["body"], dict) else ""
    return _err(desc or f"YooKassa refund failed (HTTP {r['status']})", r["body"] if isinstance(r["body"], dict) else {})


# ── PayPal ─────────────────────────────────────────────────────────────────
# https://developer.paypal.com/api/rest/
# OAuth2 client_credentials grant for an access_token, then API calls with Bearer.

_PAYPAL_BASE_LIVE    = "https://api-m.paypal.com"
_PAYPAL_BASE_SANDBOX = "https://api-m.sandbox.paypal.com"


def _paypal_base(is_test: bool) -> str:
    return _PAYPAL_BASE_SANDBOX if is_test else _PAYPAL_BASE_LIVE


def _paypal_token(creds: dict, is_test: bool) -> tuple[str, str]:
    """Returns (access_token, error). One of the two will be empty."""
    cid  = creds.get("client_id", "").strip()
    csec = creds.get("client_secret", "").strip()
    if not cid or not csec:
        return "", "Missing client_id or client_secret"
    r = _http_request("POST", f"{_paypal_base(is_test)}/v1/oauth2/token",
                       headers={"Content-Type": "application/x-www-form-urlencoded"},
                       body=b"grant_type=client_credentials",
                       basic_auth=(cid, csec))
    if r["status"] == 200 and isinstance(r["body"], dict):
        tok = r["body"].get("access_token", "")
        if tok:
            return tok, ""
    return "", f"PayPal token request failed (HTTP {r['status']})"


def paypal_test_connection(creds: dict, is_test: bool = True) -> dict:
    """Token-acquisition is itself the test — if creds are bad, oauth2/token returns 401."""
    token, err = _paypal_token(creds, is_test)
    if err:
        return _err(err)
    return _ok({"mode": "sandbox" if is_test else "live"})


def paypal_create_refund(creds: dict, capture_id: str, amount: float,
                          currency: str, idempotency_key: str,
                          is_test: bool = True) -> dict:
    """POST /v2/payments/captures/{capture_id}/refund."""
    if amount <= 0:
        return _err("Refund amount must be positive")
    token, err = _paypal_token(creds, is_test)
    if err:
        return _err(err)
    payload = {"amount": {"value": f"{round(float(amount), 2):.2f}", "currency_code": (currency or "USD").upper()}}
    body = json.dumps(payload).encode("utf-8")
    r = _http_request("POST", f"{_paypal_base(is_test)}/v2/payments/captures/{capture_id}/refund",
                       headers={"Content-Type": "application/json",
                                "PayPal-Request-Id": idempotency_key},
                       body=body, bearer=token)
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        return _ok({"refund_id": r["body"].get("id", ""), "status": r["body"].get("status", "")}, r["body"])
    msg = (r["body"] or {}).get("message", "") if isinstance(r["body"], dict) else f"HTTP {r['status']}"
    return _err(msg or "PayPal refund failed", r["body"] if isinstance(r["body"], dict) else {})


# ── Adyen ──────────────────────────────────────────────────────────────────
# https://docs.adyen.com/api-explorer
# Auth: X-API-Key header. Different endpoints for test/live.

def _adyen_base(is_test: bool) -> str:
    return "https://checkout-test.adyen.com/v71" if is_test else "https://checkout-live.adyen.com/v71"


def adyen_test_connection(creds: dict, is_test_mode: bool = True) -> dict:
    """POST /paymentMethods with merchantAccount — minimum auth-check call."""
    api_key = creds.get("api_key", "").strip()
    mac     = creds.get("merchant_account", "").strip()
    if not api_key or not mac:
        return _err("Missing api_key or merchant_account")
    body = json.dumps({"merchantAccount": mac}).encode("utf-8")
    r = _http_request("POST", f"{_adyen_base(is_test_mode)}/paymentMethods",
                       headers={"X-API-Key": api_key, "Content-Type": "application/json"},
                       body=body)
    if r["status"] == 200:
        return _ok({}, r["body"] if isinstance(r["body"], dict) else {})
    if r["status"] in (401, 403):
        return _err("Invalid Adyen API key or merchant account", r["body"] if isinstance(r["body"], dict) else {})
    return _err(f"Adyen rejected (HTTP {r['status']})", r["body"] if isinstance(r["body"], dict) else {})


def adyen_create_refund(creds: dict, psp_reference: str, amount_minor: int,
                         currency: str, idempotency_key: str,
                         is_test_mode: bool = True) -> dict:
    """POST /payments/{pspReference}/refunds. amount_minor in cents."""
    api_key = creds.get("api_key", "").strip()
    mac     = creds.get("merchant_account", "").strip()
    if not api_key or not mac:
        return _err("Missing api_key or merchant_account")
    if amount_minor <= 0:
        return _err("Refund amount must be positive")
    body = json.dumps({
        "merchantAccount": mac,
        "amount": {"value": amount_minor, "currency": (currency or "USD").upper()},
    }).encode("utf-8")
    r = _http_request("POST", f"{_adyen_base(is_test_mode)}/payments/{psp_reference}/refunds",
                       headers={"X-API-Key": api_key, "Content-Type": "application/json",
                                "Idempotency-Key": idempotency_key},
                       body=body)
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        return _ok({"refund_id": r["body"].get("pspReference", ""),
                     "status": r["body"].get("status", "received")}, r["body"])
    msg = (r["body"] or {}).get("message", "") if isinstance(r["body"], dict) else ""
    return _err(msg or f"Adyen refund failed (HTTP {r['status']})",
                r["body"] if isinstance(r["body"], dict) else {})


# ── Braintree (GraphQL) ────────────────────────────────────────────────────
# https://graphql.braintreepayments.com/
# Auth: HTTP Basic public_key:private_key.

def _braintree_url(is_test: bool) -> str:
    return ("https://payments.sandbox.braintree-api.com/graphql" if is_test
            else "https://payments.braintree-api.com/graphql")


def _braintree_headers() -> dict:
    return {"Content-Type": "application/json",
            "Braintree-Version": "2019-01-01",
            "Accept": "application/json"}


def braintree_test_connection(creds: dict, is_test_mode: bool = True) -> dict:
    """GraphQL `ping` field returns "pong" — minimum auth check."""
    pub = creds.get("public_key", "").strip()
    pri = creds.get("private_key", "").strip()
    mid = creds.get("merchant_id", "").strip()
    if not pub or not pri or not mid:
        return _err("Missing merchant_id, public_key or private_key")
    body = json.dumps({"query": "query { ping }"}).encode("utf-8")
    r = _http_request("POST", _braintree_url(is_test_mode),
                       headers=_braintree_headers(), body=body,
                       basic_auth=(pub, pri))
    if r["status"] == 200 and isinstance(r["body"], dict) and not r["body"].get("errors"):
        return _ok({"ping": r["body"].get("data", {}).get("ping")}, r["body"])
    if r["status"] == 401:
        return _err("Invalid Braintree credentials", r["body"] if isinstance(r["body"], dict) else {})
    err = (r["body"] or {}).get("errors", [{}])[0].get("message", "") if isinstance(r["body"], dict) else ""
    return _err(err or f"Braintree rejected (HTTP {r['status']})",
                 r["body"] if isinstance(r["body"], dict) else {})


def braintree_create_refund(creds: dict, transaction_id: str, amount: float,
                             idempotency_key: str, is_test_mode: bool = True) -> dict:
    """GraphQL refundTransaction mutation."""
    pub = creds.get("public_key", "").strip()
    pri = creds.get("private_key", "").strip()
    if not pub or not pri:
        return _err("Missing public_key or private_key")
    if amount <= 0:
        return _err("Refund amount must be positive")
    # Braintree GraphQL refunds use { transactionId, amount }. The amount is decimal-string.
    body = json.dumps({
        "query": "mutation r($i: RefundTransactionInput!) { refundTransaction(input: $i) { refund { id status } } }",
        "variables": {"i": {"transactionId": transaction_id,
                              "refund": {"amount": f"{round(amount, 2):.2f}"}}},
    }).encode("utf-8")
    r = _http_request("POST", _braintree_url(is_test_mode),
                       headers={**_braintree_headers(), "Braintree-Idempotency": idempotency_key},
                       body=body, basic_auth=(pub, pri))
    if r["status"] == 200 and isinstance(r["body"], dict) and not r["body"].get("errors"):
        d = r["body"].get("data", {}).get("refundTransaction", {}).get("refund", {})
        return _ok({"refund_id": d.get("id", ""), "status": d.get("status", "")}, r["body"])
    err = (r["body"] or {}).get("errors", [{}])[0].get("message", "") if isinstance(r["body"], dict) else ""
    return _err(err or "Braintree refund failed",
                 r["body"] if isinstance(r["body"], dict) else {})


# ── Square ─────────────────────────────────────────────────────────────────
# https://developer.squareup.com/reference/square
# Auth: Bearer access_token.

def _square_base(is_test: bool) -> str:
    return "https://connect.squareupsandbox.com/v2" if is_test else "https://connect.squareup.com/v2"


def square_test_connection(creds: dict, is_test_mode: bool = True) -> dict:
    """GET /v2/locations returns merchant's locations (auth check)."""
    tok = creds.get("access_token", "").strip()
    if not tok:
        return _err("Missing access_token")
    r = _http_request("GET", f"{_square_base(is_test_mode)}/locations",
                       headers={"Square-Version": "2024-10-17", "Accept": "application/json"},
                       bearer=tok)
    if r["status"] == 200 and isinstance(r["body"], dict):
        locs = r["body"].get("locations") or []
        return _ok({"locations_count": len(locs)}, r["body"])
    if r["status"] == 401:
        return _err("Invalid Square access token", r["body"] if isinstance(r["body"], dict) else {})
    return _err(f"Square rejected (HTTP {r['status']})", r["body"] if isinstance(r["body"], dict) else {})


def square_create_refund(creds: dict, payment_id: str, amount_minor: int,
                          currency: str, idempotency_key: str,
                          is_test_mode: bool = True) -> dict:
    """POST /v2/refunds. amount_minor in smallest unit."""
    tok = creds.get("access_token", "").strip()
    if not tok:
        return _err("Missing access_token")
    if amount_minor <= 0:
        return _err("Refund amount must be positive")
    body = json.dumps({
        "idempotency_key": idempotency_key,
        "amount_money": {"amount": amount_minor, "currency": (currency or "USD").upper()},
        "payment_id": payment_id,
    }).encode("utf-8")
    r = _http_request("POST", f"{_square_base(is_test_mode)}/refunds",
                       headers={"Square-Version": "2024-10-17",
                                "Content-Type": "application/json"},
                       body=body, bearer=tok)
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        ref = r["body"].get("refund") or {}
        return _ok({"refund_id": ref.get("id", ""), "status": ref.get("status", "")}, r["body"])
    errors = (r["body"] or {}).get("errors", []) if isinstance(r["body"], dict) else []
    msg = errors[0].get("detail", "") if errors else f"HTTP {r['status']}"
    return _err(msg or "Square refund failed", r["body"] if isinstance(r["body"], dict) else {})


# ── Mollie ─────────────────────────────────────────────────────────────────
# https://docs.mollie.com/reference
# Auth: Bearer api_key (test_/live_ prefix selects mode).

_MOLLIE_BASE = "https://api.mollie.com/v2"


def mollie_test_connection(creds: dict) -> dict:
    """GET /v2/methods returns enabled methods for the account."""
    key = creds.get("api_key", "").strip()
    if not key:
        return _err("Missing api_key")
    r = _http_request("GET", f"{_MOLLIE_BASE}/methods", bearer=key)
    if r["status"] == 200 and isinstance(r["body"], dict):
        return _ok({"is_test": key.startswith("test_")}, r["body"])
    if r["status"] == 401:
        return _err("Invalid Mollie API key", r["body"] if isinstance(r["body"], dict) else {})
    return _err(f"Mollie rejected (HTTP {r['status']})", r["body"] if isinstance(r["body"], dict) else {})


def mollie_create_refund(creds: dict, payment_id: str, amount: float,
                          currency: str, idempotency_key: str) -> dict:
    """POST /v2/payments/{id}/refunds. amount in major units (decimal string)."""
    key = creds.get("api_key", "").strip()
    if not key:
        return _err("Missing api_key")
    if amount <= 0:
        return _err("Refund amount must be positive")
    body = json.dumps({"amount": {"value": f"{round(amount, 2):.2f}",
                                    "currency": (currency or "EUR").upper()}}).encode("utf-8")
    r = _http_request("POST", f"{_MOLLIE_BASE}/payments/{payment_id}/refunds",
                       headers={"Content-Type": "application/json",
                                "Idempotency-Key": idempotency_key},
                       body=body, bearer=key)
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        return _ok({"refund_id": r["body"].get("id", ""),
                     "status": r["body"].get("status", "")}, r["body"])
    msg = (r["body"] or {}).get("detail", "") if isinstance(r["body"], dict) else ""
    return _err(msg or "Mollie refund failed", r["body"] if isinstance(r["body"], dict) else {})


# ── Razorpay ───────────────────────────────────────────────────────────────
# https://razorpay.com/docs/api/
# Auth: HTTP Basic key_id:key_secret.

_RAZORPAY_BASE = "https://api.razorpay.com/v1"


def razorpay_test_connection(creds: dict) -> dict:
    """GET /v1/payments?count=1 returns up to 1 payment — auth check."""
    kid = creds.get("key_id", "").strip()
    ksec = creds.get("key_secret", "").strip()
    if not kid or not ksec:
        return _err("Missing key_id or key_secret")
    r = _http_request("GET", f"{_RAZORPAY_BASE}/payments?count=1", basic_auth=(kid, ksec))
    if r["status"] == 200:
        return _ok({"is_test": kid.startswith("rzp_test_")}, r["body"] if isinstance(r["body"], dict) else {})
    if r["status"] == 401:
        return _err("Invalid Razorpay key_id or key_secret", r["body"] if isinstance(r["body"], dict) else {})
    return _err(f"Razorpay rejected (HTTP {r['status']})", r["body"] if isinstance(r["body"], dict) else {})


def razorpay_create_refund(creds: dict, payment_id: str, amount_minor: int,
                            idempotency_key: str) -> dict:
    """POST /v1/payments/{id}/refund. amount in paise."""
    kid = creds.get("key_id", "").strip()
    ksec = creds.get("key_secret", "").strip()
    if not kid or not ksec:
        return _err("Missing key_id or key_secret")
    if amount_minor <= 0:
        return _err("Refund amount must be positive")
    body = json.dumps({"amount": amount_minor}).encode("utf-8")
    r = _http_request("POST", f"{_RAZORPAY_BASE}/payments/{payment_id}/refund",
                       headers={"Content-Type": "application/json",
                                "X-Idempotency-Key": idempotency_key},
                       body=body, basic_auth=(kid, ksec))
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        return _ok({"refund_id": r["body"].get("id", ""),
                     "status": r["body"].get("status", "")}, r["body"])
    desc = (r["body"] or {}).get("error", {}).get("description", "") if isinstance(r["body"], dict) else ""
    return _err(desc or "Razorpay refund failed", r["body"] if isinstance(r["body"], dict) else {})


# ── Paddle Billing (new API) ───────────────────────────────────────────────
# https://developer.paddle.com/api-reference/
# Auth: Bearer api_key. Refunds are issued via `adjustments`.

def _paddle_base(is_test: bool) -> str:
    return "https://sandbox-api.paddle.com" if is_test else "https://api.paddle.com"


def paddle_test_connection(creds: dict, is_test_mode: bool = True) -> dict:
    """GET /event-types returns webhook event types catalog — auth check."""
    tok = creds.get("api_key", "").strip()
    if not tok:
        return _err("Missing api_key")
    r = _http_request("GET", f"{_paddle_base(is_test_mode)}/event-types", bearer=tok)
    if r["status"] == 200:
        return _ok({}, r["body"] if isinstance(r["body"], dict) else {})
    if r["status"] in (401, 403):
        return _err("Invalid Paddle API key", r["body"] if isinstance(r["body"], dict) else {})
    return _err(f"Paddle rejected (HTTP {r['status']})", r["body"] if isinstance(r["body"], dict) else {})


def paddle_create_refund(creds: dict, transaction_id: str, amount: float,
                          currency: str, idempotency_key: str,
                          is_test_mode: bool = True) -> dict:
    """POST /adjustments — Paddle's refund mechanism. Requires line item details
    in real refunds, but a simple full-transaction refund can be issued by passing
    `action='refund'` + items=[{...}]. For diploma we use a simplified payload."""
    tok = creds.get("api_key", "").strip()
    if not tok:
        return _err("Missing api_key")
    if amount <= 0:
        return _err("Refund amount must be positive")
    # Paddle adjustments require per-item details; without them we can't issue a refund
    # via API alone. For now we return an instruction to use the dashboard. Future:
    # fetch the transaction's items first, then build the adjustments payload.
    body = json.dumps({
        "action": "refund",
        "transaction_id": transaction_id,
        "reason": f"Refund {round(amount, 2)} {(currency or 'USD').upper()}",
    }).encode("utf-8")
    r = _http_request("POST", f"{_paddle_base(is_test_mode)}/adjustments",
                       headers={"Content-Type": "application/json",
                                "Paddle-Idempotency-Key": idempotency_key},
                       body=body, bearer=tok)
    if r["status"] in (200, 201) and isinstance(r["body"], dict):
        d = r["body"].get("data") or {}
        return _ok({"refund_id": d.get("id", ""), "status": d.get("status", "pending")}, r["body"])
    err = (r["body"] or {}).get("error", {}).get("detail", "") if isinstance(r["body"], dict) else ""
    return _err(err or "Paddle refund failed — line-item details may be required",
                 r["body"] if isinstance(r["body"], dict) else {})


# ── PayBox.money (Kazakhstan) ──────────────────────────────────────────────
# https://paybox.money/docs
# Auth: signature in body (no header). All requests sign params via SHA1.
# Sort top-level params by key, prepend the endpoint name, append secret_key,
# SHA1 the result, hex digest → pg_sig field.

_PAYBOX_BASE = "https://api.paybox.money"


def _paybox_sign(endpoint: str, params: dict, secret_key: str) -> str:
    """sig = sha1(endpoint;v1;v2;...;secret) where v* are values of sorted params."""
    parts = [endpoint]
    for k in sorted(params.keys()):
        parts.append(str(params[k]))
    parts.append(secret_key)
    return hashlib.sha1(";".join(parts).encode("utf-8")).hexdigest()


def paybox_test_connection(creds: dict) -> dict:
    """POST /get_status with a fake payment id — a valid creds+signature gets
    response error_code=10 (payment not found), invalid signature gets 1."""
    mid = creds.get("merchant_id", "").strip()
    sec = creds.get("secret_key", "").strip()
    if not mid or not sec:
        return _err("Missing merchant_id or secret_key")
    params = {
        "pg_merchant_id": mid,
        "pg_payment_id":  "0",
        "pg_salt":        secrets.token_hex(8),
    }
    params["pg_sig"] = _paybox_sign("get_status.php", params, sec)
    body = urllib.parse.urlencode(params).encode("utf-8")
    r = _http_request("POST", f"{_PAYBOX_BASE}/get_status.php",
                       headers={"Content-Type": "application/x-www-form-urlencoded"},
                       body=body)
    # PayBox returns XML; we don't parse it here — just check HTTP and look for
    # "wrong signature" markers in the response body.
    if r["status"] == 200:
        text = json.dumps(r["body"]) if isinstance(r["body"], dict) else str(r["body"])
        if "wrong signature" in text.lower() or "неверная подпись" in text.lower():
            return _err("Invalid PayBox merchant_id or secret_key", {})
        return _ok({}, {})
    return _err(f"PayBox rejected (HTTP {r['status']})", {})


def paybox_create_refund(creds: dict, payment_id: str, amount: float,
                          currency: str, idempotency_key: str) -> dict:
    """POST /revoke.php to refund a successful payment. amount in major units."""
    mid = creds.get("merchant_id", "").strip()
    sec = creds.get("secret_key", "").strip()
    if not mid or not sec:
        return _err("Missing merchant_id or secret_key")
    if amount <= 0:
        return _err("Refund amount must be positive")
    params = {
        "pg_merchant_id": mid,
        "pg_payment_id":  payment_id,
        "pg_refund_amount": f"{round(amount, 2):.2f}",
        "pg_salt":        idempotency_key[:32],
    }
    params["pg_sig"] = _paybox_sign("revoke.php", params, sec)
    body = urllib.parse.urlencode(params).encode("utf-8")
    r = _http_request("POST", f"{_PAYBOX_BASE}/revoke.php",
                       headers={"Content-Type": "application/x-www-form-urlencoded"},
                       body=body)
    if r["status"] == 200:
        # PayBox returns XML, but we treat 200 with body containing pg_status=ok as success
        text = json.dumps(r["body"]) if isinstance(r["body"], dict) else str(r["body"])
        if "pg_status=ok" in text or "<pg_status>ok</pg_status>" in text:
            return _ok({"refund_id": payment_id, "status": "succeeded"}, {})
        if "wrong signature" in text.lower():
            return _err("Invalid PayBox signature", {})
        # Otherwise — likely declined / error response
        return _err(f"PayBox refund declined: {text[:200]}", {})
    return _err(f"PayBox refund failed (HTTP {r['status']})", {})


# ── Dispatcher ─────────────────────────────────────────────────────────────

def test_connection(provider: str, creds: dict, *, is_test_mode: bool = True,
                     stripe_account_id: str = "") -> dict:
    """Single entry point for all providers. Returns canonical {ok, data, error, raw}."""
    if provider == "manual" or provider == "other":
        return _ok({"note": "Manual / Other providers don't have a remote check — credentials are saved as-is."})
    if provider == "stripe":         return stripe_test_connection(creds, stripe_account_id)
    if provider == "tinkoff":        return tinkoff_test_connection(creds)
    if provider == "cloudpayments":  return cloudpayments_test_connection(creds)
    if provider == "yookassa":       return yookassa_test_connection(creds)
    if provider == "paypal":         return paypal_test_connection(creds, is_test_mode)
    if provider == "adyen":          return adyen_test_connection(creds, is_test_mode)
    if provider == "braintree":      return braintree_test_connection(creds, is_test_mode)
    if provider == "square":         return square_test_connection(creds, is_test_mode)
    if provider == "mollie":         return mollie_test_connection(creds)
    if provider == "razorpay":       return razorpay_test_connection(creds)
    if provider == "paddle":         return paddle_test_connection(creds, is_test_mode)
    if provider == "paybox":         return paybox_test_connection(creds)
    return _err(f"Unknown provider: {provider}")


def create_refund(provider: str, creds: dict, *, charge_or_intent_id: str,
                   amount: float, currency: str = "USD",
                   idempotency_key: str | None = None,
                   is_test_mode: bool = True,
                   stripe_account_id: str = "") -> dict:
    """Single entry point. amount is in MAJOR units (dollars/rubles); we convert to
    minor units (cents/kopecks) for providers that require it.

    `idempotency_key` MUST be stable across retries for the same logical refund —
    the caller (typically POST /returns/{rid}/refund) should derive it from
    (return_id, attempt_count) so a retry doesn't double-refund.
    """
    if not idempotency_key:
        idempotency_key = "refund-" + secrets.token_urlsafe(16)
    if provider == "manual" or provider == "other":
        # No real API call — just succeed. CRM stores reference manually entered.
        return _ok({"refund_id": "", "status": "manual"})
    amount_minor = int(round(amount * 100))
    if provider == "stripe":
        return stripe_create_refund(creds, charge_or_intent_id, amount_minor,
                                     idempotency_key, stripe_account_id)
    if provider == "tinkoff":
        return tinkoff_create_refund(creds, charge_or_intent_id, amount_minor, idempotency_key)
    if provider == "cloudpayments":
        return cloudpayments_create_refund(creds, charge_or_intent_id, amount, idempotency_key)
    if provider == "yookassa":
        return yookassa_create_refund(creds, charge_or_intent_id, amount, currency, idempotency_key)
    if provider == "paypal":
        return paypal_create_refund(creds, charge_or_intent_id, amount, currency, idempotency_key, is_test_mode)
    if provider == "adyen":
        return adyen_create_refund(creds, charge_or_intent_id, amount_minor, currency, idempotency_key, is_test_mode)
    if provider == "braintree":
        return braintree_create_refund(creds, charge_or_intent_id, amount, idempotency_key, is_test_mode)
    if provider == "square":
        return square_create_refund(creds, charge_or_intent_id, amount_minor, currency, idempotency_key, is_test_mode)
    if provider == "mollie":
        return mollie_create_refund(creds, charge_or_intent_id, amount, currency, idempotency_key)
    if provider == "razorpay":
        return razorpay_create_refund(creds, charge_or_intent_id, amount_minor, idempotency_key)
    if provider == "paddle":
        return paddle_create_refund(creds, charge_or_intent_id, amount, currency, idempotency_key, is_test_mode)
    if provider == "paybox":
        return paybox_create_refund(creds, charge_or_intent_id, amount, currency, idempotency_key)
    return _err(f"Unknown provider: {provider}")



@app.get("/api/orgs/{org_id}/payment-credentials")
def get_org_payment_credentials(org_id: int, user: dict = Depends(get_current_user)):
    """Returns provider catalog (which fields are needed for each) + current state.
    Secret values are masked (`••••••••<last4>`) — full plaintext is never exposed."""
    require_org_owner(user, org_id)

    row = db_one(
        "SELECT provider, credentials_encrypted, is_test_mode, is_connected,"
        "       connected_at, last_verified_at, last_error, stripe_account_id,"
        "       connect_method"
        "  FROM crm_payment_credentials WHERE org_id=%s",
        (org_id,)
    )

    org = db_one("SELECT payment_provider FROM crm_organizations WHERE id=%s", (org_id,))
    selected_provider = (row or {}).get("provider") or (org or {}).get("payment_provider") or "manual"

    masked: dict = {}
    if row and row["credentials_encrypted"]:
        try:
            decrypted = decrypt_credentials(row["credentials_encrypted"])
            masked = mask_credentials(row["provider"], decrypted)
        except (ValueError, RuntimeError) as e:
            masked = {"_error": f"Decryption failed: {e}"}

    return {
        "provider":            selected_provider,
        "is_test_mode":        bool((row or {}).get("is_test_mode", True)),
        "is_connected":        bool((row or {}).get("is_connected", False)),
        "connect_method":      (row or {}).get("connect_method") or "manual",
        "stripe_account_id":   (row or {}).get("stripe_account_id") or "",
        "connected_at":        row["connected_at"].isoformat() if row and row.get("connected_at") else None,
        "last_verified_at":    row["last_verified_at"].isoformat() if row and row.get("last_verified_at") else None,
        "last_error":          (row or {}).get("last_error") or "",
        "credentials_masked":  masked,
        "encryption_ok":       is_encryption_configured(),
        # Catalog: full provider list with their required-field specs (for UI)
        "provider_catalog": {
            p: [{k: v for k, v in spec.items() if k != "validate_prefix"} for spec in fields]
            for p, fields in PROVIDER_FIELDS.items()
        },
        # Stripe Connect availability
        "stripe_connect_available": bool(os.getenv("STRIPE_CONNECT_CLIENT_ID", "").strip()),
    }


@app.put("/api/orgs/{org_id}/payment-credentials")
def put_org_payment_credentials(org_id: int, body: dict = Body(...),
                                 user: dict = Depends(get_current_user)):
    """Save (or update) credentials for the org's selected payment provider.
    Body shape:
        {"provider": "stripe",
         "is_test_mode": true,
         "credentials": {"publishable_key": "pk_test_…", "secret_key": "sk_test_…", ...}}

    Validation:
      • encryption must be configured (otherwise refuse — we never store plaintext)
      • provider must be one of the known set
      • required fields per provider must be non-empty (validate_credentials_shape)
      • prefix check (e.g. secret_key must start with sk_test_ or sk_live_)

    Does NOT auto-verify with provider — that requires a separate POST .../test call
    so the merchant gets explicit "Connected ✓" feedback.
    """
    require_org_owner(user, org_id)
    if not is_encryption_configured():
        raise HTTPException(500, "Payment encryption is not configured on the server. "
                                  "Set PAYMENT_ENCRYPTION_KEY in .env.")

    provider = (body.get("provider") or "").strip().lower()
    if provider not in PROVIDER_FIELDS:
        raise HTTPException(400, f"Unknown provider: {provider}")
    is_test_mode = bool(body.get("is_test_mode", True))
    creds = body.get("credentials") or {}
    if not isinstance(creds, dict):
        raise HTTPException(400, "credentials must be an object")

    # Strip whitespace + drop blank-string entries
    creds_clean: dict[str, str] = {}
    for k, v in creds.items():
        if not isinstance(k, str):
            continue
        s = str(v or "").strip()
        if s:
            creds_clean[k] = s

    # When updating, merchant may want to keep the existing secret_key (sent as masked
    # value, e.g. "••••••••abcd"). Detect that case and preserve the stored value.
    masked_indicator = "•"
    existing = db_one(
        "SELECT credentials_encrypted, provider FROM crm_payment_credentials WHERE org_id=%s",
        (org_id,)
    )
    if existing and existing["credentials_encrypted"] and existing["provider"] == provider:
        try:
            previous = decrypt_credentials(existing["credentials_encrypted"])
        except (ValueError, RuntimeError):
            previous = {}
        secrets_set = SECRET_FIELDS.get(provider, set())
        for key in secrets_set:
            if key in creds_clean and masked_indicator in creds_clean[key]:
                # Keep the previous value verbatim
                if previous.get(key):
                    creds_clean[key] = previous[key]
                else:
                    creds_clean.pop(key, None)

    ok, msg = validate_credentials_shape(provider, creds_clean)
    if not ok:
        raise HTTPException(400, msg)

    encrypted = encrypt_credentials(creds_clean)

    with db_cursor() as (conn, cur):
        cur.execute(
            "INSERT INTO crm_payment_credentials"
            "  (org_id, provider, credentials_encrypted, is_test_mode, is_connected,"
            "   last_error, connect_method, updated_at)"
            " VALUES (%s, %s, %s, %s, FALSE, '', 'manual', NOW())"
            " ON CONFLICT (org_id) DO UPDATE SET"
            "   provider=EXCLUDED.provider,"
            "   credentials_encrypted=EXCLUDED.credentials_encrypted,"
            "   is_test_mode=EXCLUDED.is_test_mode,"
            "   is_connected=FALSE,"
            "   last_error='',"
            "   updated_at=NOW()",
            (org_id, provider, encrypted, is_test_mode)
        )
        # Keep crm_organizations.payment_provider in sync (used by Returns refund UI)
        cur.execute(
            "UPDATE crm_organizations SET payment_provider=%s WHERE id=%s",
            (provider, org_id)
        )
        conn.commit()
    return {"ok": True, "provider": provider, "is_test_mode": is_test_mode,
            "is_connected": False}


@app.post("/api/orgs/{org_id}/payment-credentials/test")
def test_org_payment_credentials(org_id: int, user: dict = Depends(get_current_user)):
    """Ping the provider API with stored credentials. Updates is_connected + last_verified_at."""
    require_org_owner(user, org_id)
    row = db_one(
        "SELECT provider, credentials_encrypted, is_test_mode, stripe_account_id"
        "  FROM crm_payment_credentials WHERE org_id=%s",
        (org_id,)
    )
    if not row or not row["credentials_encrypted"]:
        raise HTTPException(404, "No credentials saved for this organization")
    try:
        creds = decrypt_credentials(row["credentials_encrypted"])
    except (ValueError, RuntimeError) as e:
        raise HTTPException(500, f"Failed to decrypt credentials: {e}")

    result = test_connection(
        row["provider"], creds,
        is_test_mode=bool(row["is_test_mode"]),
        stripe_account_id=row.get("stripe_account_id") or "",
    )
    with db_cursor() as (conn, cur):
        if result["ok"]:
            cur.execute(
                "UPDATE crm_payment_credentials"
                "   SET is_connected=TRUE, connected_at=COALESCE(connected_at, NOW()),"
                "       last_verified_at=NOW(), last_error=''"
                " WHERE org_id=%s",
                (org_id,)
            )
        else:
            cur.execute(
                "UPDATE crm_payment_credentials"
                "   SET is_connected=FALSE, last_error=%s, last_verified_at=NOW()"
                " WHERE org_id=%s",
                (result["error"][:1000], org_id)
            )
        conn.commit()
    return {"ok": result["ok"], "error": result["error"], "data": result["data"]}


@app.delete("/api/orgs/{org_id}/payment-credentials")
def delete_org_payment_credentials(org_id: int, user: dict = Depends(get_current_user)):
    """Disconnect: clears stored credentials but keeps the provider selection.
    Existing orders + returns retain their snapshot of which provider was used."""
    require_org_owner(user, org_id)
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM crm_payment_credentials WHERE org_id=%s", (org_id,))
        conn.commit()
    return {"ok": True}


# ── Stripe Connect OAuth flow (optional) ──────────────────────────────────
# Standard OAuth2 — merchant clicks "Connect with Stripe" → redirected to Stripe →
# returns with `code` → CRM exchanges for access_token + stripe_user_id (acct_…).
# Refunds for that org then use Stripe-Account header to act on behalf of the
# connected account, instead of needing the merchant's actual secret_key.

import hashlib as _hashlib_oa

@app.get("/api/orgs/{org_id}/payment-credentials/oauth/stripe/start")
def stripe_connect_oauth_start(org_id: int, request: Request,
                                user: dict = Depends(get_current_user)):
    require_org_owner(user, org_id)
    client_id    = os.getenv("STRIPE_CONNECT_CLIENT_ID", "").strip()
    redirect_uri = os.getenv("STRIPE_CONNECT_REDIRECT_URI", "").strip()
    if not client_id or not redirect_uri:
        raise HTTPException(503, "Stripe Connect is not configured on this server. "
                                   "Set STRIPE_CONNECT_CLIENT_ID + STRIPE_CONNECT_REDIRECT_URI in .env.")

    # CSRF state: bind to (user_id, org_id) so the callback can verify
    nonce = secrets.token_urlsafe(24)
    state = f"{user['id']}.{org_id}.{nonce}"
    state_hash = _hashlib_oa.sha256((state + SECRET_KEY).encode()).hexdigest()
    state_token = f"{state}.{state_hash}"

    params = {
        "response_type": "code",
        "client_id":     client_id,
        "scope":         "read_write",
        "redirect_uri":  redirect_uri,
        "state":         state_token,
    }
    url = "https://connect.stripe.com/oauth/authorize?" + urllib.parse.urlencode(params)
    return {"redirect_url": url}


@app.get("/api/orgs/payment-credentials/oauth/stripe/callback")
def stripe_connect_oauth_callback(request: Request,
                                    code: str = Query(...),
                                    state: str = Query(...),
                                    user: dict = Depends(get_current_user)):
    """Exchange Stripe OAuth code for access_token + connected account ID."""
    # Verify state signature
    try:
        user_id_str, org_id_str, nonce, sig = state.split(".")
        state_payload = f"{user_id_str}.{org_id_str}.{nonce}"
        expected = _hashlib_oa.sha256((state_payload + SECRET_KEY).encode()).hexdigest()
        if not _hmac.compare_digest(sig, expected):
            raise ValueError("bad sig")
        org_id = int(org_id_str)
        if user["id"] != int(user_id_str):
            raise ValueError("user mismatch")
    except (ValueError, AttributeError):
        raise HTTPException(400, "Invalid OAuth state token")

    require_org_owner(user, org_id)

    client_id = os.getenv("STRIPE_CONNECT_CLIENT_ID", "").strip()
    # Stripe expects POST to /oauth/token with secret key auth
    # We need the PLATFORM's secret key (Torta's own), not the merchant's.
    platform_sk = os.getenv("STRIPE_PLATFORM_SECRET_KEY", "").strip()
    if not platform_sk:
        raise HTTPException(503, "Platform secret key not configured")

    body = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code":       code,
        "client_id":  client_id,
    }).encode("utf-8")
    req = urllib.request.Request("https://connect.stripe.com/oauth/token",
                                  method="POST", data=body)
    req.add_header("Authorization", f"Bearer {platform_sk}")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise HTTPException(400, f"Stripe rejected the OAuth code: {err_body[:300]}")
    except Exception as e:
        raise HTTPException(500, f"Stripe OAuth exchange failed: {e}")

    stripe_user_id  = data.get("stripe_user_id", "")
    stripe_pub_key  = data.get("stripe_publishable_key", "")
    access_token    = data.get("access_token", "")
    livemode        = bool(data.get("livemode", False))
    if not stripe_user_id or not access_token:
        raise HTTPException(500, "Stripe OAuth response missing fields")

    # Store: access_token is treated as the secret_key for refund calls.
    creds = {
        "publishable_key": stripe_pub_key,
        "secret_key":      access_token,
        "webhook_secret":  "",   # merchant configures webhooks via Stripe dashboard
    }
    encrypted = encrypt_credentials(creds)
    with db_cursor() as (conn, cur):
        cur.execute(
            "INSERT INTO crm_payment_credentials"
            "  (org_id, provider, credentials_encrypted, is_test_mode, is_connected,"
            "   connected_at, last_verified_at, last_error, stripe_account_id,"
            "   connect_method, updated_at)"
            " VALUES (%s, 'stripe', %s, %s, TRUE, NOW(), NOW(), '', %s, 'oauth', NOW())"
            " ON CONFLICT (org_id) DO UPDATE SET"
            "   provider='stripe',"
            "   credentials_encrypted=EXCLUDED.credentials_encrypted,"
            "   is_test_mode=EXCLUDED.is_test_mode,"
            "   is_connected=TRUE,"
            "   connected_at=COALESCE(crm_payment_credentials.connected_at, NOW()),"
            "   last_verified_at=NOW(),"
            "   last_error='',"
            "   stripe_account_id=EXCLUDED.stripe_account_id,"
            "   connect_method='oauth',"
            "   updated_at=NOW()",
            (org_id, encrypted, not livemode, stripe_user_id)
        )
        cur.execute(
            "UPDATE crm_organizations SET payment_provider='stripe' WHERE id=%s",
            (org_id,)
        )
        conn.commit()

    # Redirect back to OrgSettings → Payments
    org_slug_row = db_one("SELECT slug FROM crm_organizations WHERE id=%s", (org_id,))
    slug = (org_slug_row or {}).get("slug") or ""
    target = f"{CRM_FRONTEND_URL}/org/{slug}/payments?connected=stripe"
    return RedirectResponse(target)


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

        # Seed booking_settings.timezone from the merchant's browser TZ (if supplied).
        # Without this, the default 'UTC' silently breaks slot-time intuition for the
        # 95% of merchants who don't operate in UTC. We only seed if the merchant
        # passed a valid IANA name — invalid values fall back to the backend default.
        seed_tz = (request.timezone or "").strip()
        if seed_tz and seed_tz != "UTC":
            try:
                from zoneinfo import ZoneInfo
                ZoneInfo(seed_tz)   # validate IANA name
                cur.execute(
                    "INSERT INTO booking_settings (project_id, timezone) VALUES (%s, %s)"
                    " ON CONFLICT (project_id) DO UPDATE SET timezone = EXCLUDED.timezone",
                    (new_id, seed_tz)
                )
            except Exception:
                pass   # ignore — merchant can set it later in Booking → Settings
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
        # Magaz delete order (FK: sizes→variations→products); walk layer tree first to clean L2-5 specs (no parent_id CASCADE).
        cur.execute("SELECT v.id FROM product_configurations_l1 v JOIN products p ON v.product_id=p.id WHERE p.project_id=%s", pid)
        _l1 = [r["id"] for r in cur.fetchall()]
        _l2 = _l3 = _l4 = _l5 = []
        if _l1:
            cur.execute("SELECT id FROM product_configurations_l2 WHERE variation_id = ANY(%s)", (_l1,))
            _l2 = [r["id"] for r in cur.fetchall()]
        if _l2:
            cur.execute("SELECT id FROM product_configurations_l3 WHERE parent_id = ANY(%s)", (_l2,))
            _l3 = [r["id"] for r in cur.fetchall()]
        if _l3:
            cur.execute("SELECT id FROM product_configurations_l4 WHERE parent_id = ANY(%s)", (_l3,))
            _l4 = [r["id"] for r in cur.fetchall()]
        if _l4:
            cur.execute("SELECT id FROM product_configurations_l5 WHERE parent_id = ANY(%s)", (_l4,))
            _l5 = [r["id"] for r in cur.fetchall()]
        for _layer, _ids in ((2, _l2), (3, _l3), (4, _l4), (5, _l5)):
            if _ids:
                cur.execute("DELETE FROM product_specifications WHERE layer=%s AND parent_id = ANY(%s)",
                            (_layer, _ids))
        cur.execute("DELETE FROM product_configurations_l2 WHERE variation_id IN (SELECT v.id FROM product_configurations_l1 v JOIN products p ON v.product_id=p.id WHERE p.project_id=%s)", pid)
        cur.execute("DELETE FROM product_configurations_l1 WHERE product_id IN (SELECT id FROM products WHERE project_id=%s)", pid)
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
    # Best-effort: nuke the entire project's S3 folder (product images, etc.)
    s3_delete_prefix(f"projects/{project_id}/")
    return {"ok": True}


# ── PRODUCT CATEGORIES — flat, ≤1 per product, slug fixed at create; delete modes: keep_products|delete_products|move(?target_id=X) ──

def _category_slug(cur, project_id: int, name: str) -> str:
    """Generate unique category slug in this project (appends -2, -3 on collision)."""
    base = re.sub(r"[^a-z0-9]+", "-", name.lower().strip()).strip("-")[:100] or "category"
    slug = base
    n = 1
    while True:
        cur.execute("SELECT 1 FROM product_categories WHERE project_id=%s AND slug=%s",
                    (project_id, slug))
        if not cur.fetchone():
            return slug
        n += 1
        slug = f"{base}-{n}"


@app.get("/api/categories")
def list_categories(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    rows = db_all("""
        SELECT c.id, c.name, c.slug, c.created_at,
               COUNT(p.id) AS products_count
          FROM product_categories c
     LEFT JOIN products p ON p.category_id = c.id
         WHERE c.project_id = %s
      GROUP BY c.id
      ORDER BY LOWER(c.name) ASC
    """, (project_id,))
    for r in rows:
        r["created_at"]     = str(r["created_at"])
        r["products_count"] = int(r["products_count"] or 0)
    return rows


@app.post("/api/categories")
def create_category(req: CreateCategoryRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    name = sanitize(req.name.strip())
    if not name:           raise HTTPException(400, "Name is required")
    if len(name) > 100:    raise HTTPException(400, "Name too long (max 100)")
    if db_one("SELECT id FROM product_categories WHERE project_id=%s AND LOWER(name)=LOWER(%s)",
              (project_id, name)):
        raise HTTPException(409, "Category with this name already exists")
    with db_cursor() as (conn, cur):
        slug = _category_slug(cur, project_id, name)
        cur.execute(
            "INSERT INTO product_categories (project_id, name, slug) VALUES (%s,%s,%s) "
            "RETURNING id, name, slug, created_at",
            (project_id, name, slug),
        )
        row = cur.fetchone()
        conn.commit()
    return {"id": row["id"], "name": row["name"], "slug": row["slug"],
            "created_at": str(row["created_at"]), "products_count": 0}


@app.patch("/api/categories/{cat_id}")
def rename_category(cat_id: int, req: UpdateCategoryRequest,
                    project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    name = sanitize(req.name.strip())
    if not name:        raise HTTPException(400, "Name is required")
    if len(name) > 100: raise HTTPException(400, "Name too long (max 100)")
    if not db_one("SELECT id FROM product_categories WHERE id=%s AND project_id=%s", (cat_id, project_id)):
        raise HTTPException(404, "Category not found")
    if db_one("SELECT id FROM product_categories WHERE project_id=%s AND LOWER(name)=LOWER(%s) AND id != %s",
              (project_id, name, cat_id)):
        raise HTTPException(409, "Category with this name already exists")
    with db_cursor() as (conn, cur):
        # Slug stays the same — keeps storefront URLs stable across rename.
        cur.execute("UPDATE product_categories SET name=%s WHERE id=%s", (name, cat_id))
        conn.commit()
    return {"ok": True}


@app.put("/api/categories/{cat_id}/products")
def set_category_products(
    cat_id: int,
    req: SetCategoryProductsRequest,
    project_id: int = Query(...),
    user: dict = Depends(get_current_user),
):
    """Replaces set of products in this category (assigns new ones, clears removed ones)."""
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM product_categories WHERE id=%s AND project_id=%s",
                  (cat_id, project_id)):
        raise HTTPException(404, "Category not found")
    pids = list({int(x) for x in (req.product_ids or [])})
    with db_cursor() as (conn, cur):
        # Verify all given products belong to this project (prevents IDOR)
        if pids:
            cur.execute("SELECT id FROM products WHERE id = ANY(%s) AND project_id=%s",
                        (pids, project_id))
            valid = {r["id"] for r in cur.fetchall()}
            if len(valid) != len(pids):
                raise HTTPException(400, "Some product_ids do not belong to this project")
        # Un-assign products that were in this category but no longer in the list
        if pids:
            cur.execute("UPDATE products SET category_id=NULL "
                        "WHERE category_id=%s AND id != ALL(%s)", (cat_id, pids))
        else:
            cur.execute("UPDATE products SET category_id=NULL WHERE category_id=%s", (cat_id,))
        # Assign the listed products to this category (overrides previous category if any)
        if pids:
            cur.execute("UPDATE products SET category_id=%s "
                        "WHERE id = ANY(%s) AND project_id=%s", (cat_id, pids, project_id))
        conn.commit()
    return {"ok": True}


@app.delete("/api/categories/{cat_id}")
def delete_category(
    cat_id: int,
    mode:      str           = Query("keep_products"),
    target_id: Optional[int] = Query(None),
    project_id: int          = Query(...),
    user: dict               = Depends(get_current_user),
):
    """Three modes: keep_products | delete_products | move(?target_id=X)."""
    require_team_member_or_owner(user, project_id)
    if mode not in ("keep_products", "delete_products", "move"):
        raise HTTPException(400, "Invalid mode")
    if not db_one("SELECT id FROM product_categories WHERE id=%s AND project_id=%s",
                  (cat_id, project_id)):
        raise HTTPException(404, "Category not found")

    with db_cursor() as (conn, cur):
        if mode == "move":
            if target_id is None:
                raise HTTPException(400, "target_id is required for move mode")
            if target_id == cat_id:
                raise HTTPException(400, "Cannot move products to the same category")
            cur.execute("SELECT id FROM product_categories WHERE id=%s AND project_id=%s",
                        (target_id, project_id))
            if not cur.fetchone():
                raise HTTPException(404, "Target category not found")
            cur.execute("UPDATE products SET category_id=%s WHERE category_id=%s AND project_id=%s",
                        (target_id, cat_id, project_id))
        elif mode == "delete_products":
            cur.execute("SELECT id FROM products WHERE category_id=%s AND project_id=%s",
                        (cat_id, project_id))
            pids = [r["id"] for r in cur.fetchall()]
            if pids:
                # Collect S3 image URLs of all variations BEFORE wiping rows.
                # `unnest(images)` flattens the per-variation TEXT[] gallery into one row per URL.
                cur.execute("SELECT unnest(images) AS u FROM product_configurations_l1 WHERE product_id = ANY(%s)", (pids,))
                victim_urls = [r["u"] for r in cur.fetchall() if r.get("u")]
                # Manual cascade (no ON DELETE CASCADE): leaves→variations→product; walk layer tree first to clear L2-5 specs (parent_id has no CASCADE).
                cur.execute("SELECT id FROM product_configurations_l1 WHERE product_id = ANY(%s)", (pids,))
                _l1 = [r["id"] for r in cur.fetchall()]
                cur.execute("SELECT id FROM product_configurations_l2 WHERE variation_id = ANY(%s)", (_l1,)) if _l1 else None
                _l2 = [r["id"] for r in cur.fetchall()] if _l1 else []
                cur.execute("SELECT id FROM product_configurations_l3 WHERE parent_id = ANY(%s)", (_l2,)) if _l2 else None
                _l3 = [r["id"] for r in cur.fetchall()] if _l2 else []
                cur.execute("SELECT id FROM product_configurations_l4 WHERE parent_id = ANY(%s)", (_l3,)) if _l3 else None
                _l4 = [r["id"] for r in cur.fetchall()] if _l3 else []
                cur.execute("SELECT id FROM product_configurations_l5 WHERE parent_id = ANY(%s)", (_l4,)) if _l4 else None
                _l5 = [r["id"] for r in cur.fetchall()] if _l4 else []
                for _layer, _ids in ((2, _l2), (3, _l3), (4, _l4), (5, _l5)):
                    if _ids:
                        cur.execute("DELETE FROM product_specifications WHERE layer=%s AND parent_id = ANY(%s)",
                                    (_layer, _ids))
                cur.execute("DELETE FROM product_configurations_l2 WHERE variation_id IN "
                            "(SELECT id FROM product_configurations_l1 WHERE product_id = ANY(%s))", (pids,))
                cur.execute("DELETE FROM product_configurations_l1    WHERE product_id = ANY(%s)", (pids,))
                cur.execute("DELETE FROM product_custom_fields WHERE product_id = ANY(%s)", (pids,))
                cur.execute("DELETE FROM product_reviews       WHERE product_id = ANY(%s)", (pids,))
                cur.execute("DELETE FROM cart_items            WHERE product_id = ANY(%s)", (pids,))
                cur.execute("DELETE FROM favorites             WHERE product_id = ANY(%s)", (pids,))
                cur.execute("DELETE FROM product_page_views    WHERE product_id = ANY(%s)", (pids,))
                cur.execute("DELETE FROM products              WHERE id         = ANY(%s)", (pids,))
                # Best-effort S3 cleanup after DB rows are gone
                _prefix = f"projects/{project_id}/products/"
                for _u in victim_urls:
                    s3_delete_url(_u, _prefix)
        # keep_products: ON DELETE SET NULL on products.category_id handles it on the next line
        cur.execute("DELETE FROM product_categories WHERE id=%s", (cat_id,))
        conn.commit()
    return {"ok": True}


# ── PRODUCTS ─────────────────────────────────────────────

# Org-level SKU generation helpers (settings on crm_organizations); unique-checked per project/product.

_SKU_ALPHABETS = {
    'numeric':      '0123456789',
    'letters':      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'alphanumeric': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
}


def _resolve_sku_settings(project_id: int):
    row = db_one(
        "SELECT o.sku_mode, o.sku_length"
        "  FROM crm_organizations o JOIN crm_projects p ON p.org_id = o.id"
        " WHERE p.id = %s",
        (project_id,)
    )
    if not row: return ('numeric', 8)
    return (row['sku_mode'], int(row['sku_length']))


def _gen_sku_string(mode: str, length: int) -> str:
    chars = _SKU_ALPHABETS.get(mode, '')
    if not chars: return ''
    n = max(4, min(64, int(length)))
    return ''.join(random.choices(chars, k=n))


def _gen_unique_product_sku(cur, project_id: int, mode: str, length: int) -> str:
    if mode == 'manual': return ''
    for _ in range(50):
        candidate = _gen_sku_string(mode, length)
        cur.execute("SELECT 1 FROM products WHERE project_id=%s AND sku=%s",
                    (project_id, candidate))
        if cur.fetchone() is None:
            return candidate
    raise HTTPException(500, "Couldn't generate unique product SKU after 50 tries")


def _gen_unique_l2_sku_code(cur, product_id: int, mode: str, length: int) -> str:
    if mode == 'manual': return ''
    for _ in range(50):
        candidate = _gen_sku_string(mode, length)
        cur.execute("SELECT 1 FROM product_configurations_l2 WHERE product_id=%s AND sku_code=%s",
                    (product_id, candidate))
        if cur.fetchone() is None:
            return candidate
    raise HTTPException(500, "Couldn't generate unique L2 SKU code after 50 tries")


@app.get("/api/products")
def list_products(project_id: int = Query(...),
                  category_id: Optional[int] = Query(None),
                  uncategorized: bool = Query(False),
                  include_uncategorized: bool = Query(False),
                  product_type: Optional[str] = Query(None),
                  archived: bool = Query(False),
                  cursor: Optional[str] = Query(None),
                  limit: Optional[int]  = Query(None),
                  user: dict = Depends(get_current_user)):
    """List products. Filters: category_id, uncategorized, product_type, archived. Cursor pagination (opt-in via `cursor` param) for large catalogs — backward-compat when client doesn't ask."""
    require_team_member_or_owner(user, project_id)
    want_pagination, offset, page_size = _pagination_params(cursor, limit)
    where  = ["p.project_id=%s"]
    params = [project_id]
    if uncategorized:
        where.append("p.category_id IS NULL")
    elif category_id is not None:
        if include_uncategorized:
            where.append("(p.category_id=%s OR p.category_id IS NULL)")
        else:
            where.append("p.category_id=%s")
        params.append(category_id)
    if product_type:
        if product_type not in ("physical", "digital", "service", "event"):
            raise HTTPException(400, "Invalid product_type")
        where.append("p.product_type=%s")
        params.append(product_type)
    where.append("p.is_archived = %s")
    params.append(bool(archived))
    sql = (
        "SELECT p.id, p.title, p.sku, p.category_id, p.product_type, p.is_archived, p.is_paused,"
        " p.sale_type, p.sale_value, p.sale_starts_at, p.sale_ends_at,"
        " c.name AS category_name, c.slug AS category_slug,"
        " COUNT(DISTINCT v.id) AS variations_count,"
        " COALESCE(SUM(ps.stock_quantity),0) AS total_stock,"
        " COALESCE(MIN(ps.price),0) AS min_price,"
        " COALESCE(MAX(ps.price),0) AS max_price,"
        " COALESCE(AVG(pr.rating),0) AS avg_rating,"
        " COUNT(DISTINCT pr.id) AS reviews_count,"
        " (SELECT (images)[1] FROM product_configurations_l1 WHERE product_id=p.id ORDER BY id ASC LIMIT 1) AS first_image,"
        " (SELECT COALESCE(json_agg(json_build_object('id', pv2.id, 'name', pv2.variation_name, 'images', pv2.images) ORDER BY pv2.id), '[]'::json)"
        "  FROM product_configurations_l1 pv2 WHERE pv2.product_id=p.id) AS variations,"
        " (SELECT COUNT(*) FROM product_tier_pricing tp"
        "    JOIN product_configurations_l2 ll2 ON tp.sku_id = ll2.id"
        "   WHERE ll2.product_id = p.id) AS tier_count"
        " FROM products p"
        " LEFT JOIN product_categories c ON c.id=p.category_id"
        " LEFT JOIN product_configurations_l1 v ON v.product_id=p.id"
        " LEFT JOIN product_configurations_l2 ps ON ps.product_id=p.id"
        " LEFT JOIN product_reviews pr ON pr.product_id=p.id"
        f" WHERE {' AND '.join(where)} GROUP BY p.id, c.name, c.slug ORDER BY p.id DESC"
    )
    # Fetch limit+1 when paginated → lets us peek next page's existence.
    if want_pagination:
        sql += " LIMIT %s OFFSET %s"
        params.extend([page_size + 1, offset])
    rows = db_all(sql, tuple(params))
    for r in rows:
        r["avg_rating"]  = round(float(r["avg_rating"] or 0), 1)
        r["min_price"]   = float(r["min_price"] or 0)
        r["max_price"]   = float(r["max_price"] or 0)
        r["total_stock"] = int(r["total_stock"] or 0)
        r["is_archived"] = bool(r.get("is_archived"))
        r["is_paused"]   = bool(r.get("is_paused"))
        if r.get("sale_value") is not None:
            r["sale_value"] = float(r["sale_value"])
        for tk in ("sale_starts_at", "sale_ends_at"):
            if r.get(tk) is not None:
                r[tk] = r[tk].isoformat()
        r["tier_count"] = int(r.get("tier_count") or 0)
    return _wrap_paginated(want_pagination, rows, offset, page_size)


@app.post("/api/products")
def create_product(request: CreateProductRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    name = request.title.strip()
    if not name: raise HTTPException(400, "Title is required")
    if request.category_id is not None:
        if not db_one("SELECT id FROM product_categories WHERE id=%s AND project_id=%s",
                      (request.category_id, project_id)):
            raise HTTPException(400, "Category does not belong to this project")
    ptype = (request.product_type or "physical").strip()
    if ptype not in ("physical", "digital", "service", "event"):
        raise HTTPException(400, "Invalid product_type")
    sku_explicit = sanitize((request.sku or '').strip())[:80]
    with db_cursor() as (conn, cur):
        cur.execute(
            "INSERT INTO products (project_id,title,subtitle,description,category_id,seo_title,seo_description,seo_keywords,product_type,sku) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (project_id, sanitize(name), sanitize(request.subtitle), sanitize(request.description),
             request.category_id,
             sanitize(request.seo_title), sanitize(request.seo_description), sanitize(request.seo_keywords),
             ptype, sku_explicit)
        )
        new_id = cur.fetchone()["id"]
        # Auto-SKU: random unique code per org's sku_mode + sku_length (manual leaves blank).
        if not sku_explicit:
            mode, length = _resolve_sku_settings(project_id)
            generated = _gen_unique_product_sku(cur, project_id, mode, length)
            if generated:
                cur.execute("UPDATE products SET sku=%s WHERE id=%s",
                            (generated, new_id))
        # Auto-mint an internal EAN-13 (prefix 200) into products.barcode so the
        # product can be scanned + tracked from day one without manual entry.
        _ensure_product_ean13(cur, new_id)
        # type=service → also seed a booking_services row linked 1:1 to the product.
        if ptype == "service":
            cur.execute(
                "INSERT INTO booking_services (project_id, product_id, name, description, duration_minutes, price, is_active)"
                " VALUES (%s, %s, %s, %s, 30, 0, TRUE)",
                (project_id, new_id, sanitize(name), sanitize(request.description or ""))
            )
        conn.commit()
        return {"id": new_id, "title": name, "product_type": ptype}


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

    # Multi-layer tree (Layer 1 → 5). Each row has effective_price walked from parent.
    variations, max_layer = _load_product_tree(product_id)

    # Specs: fetch all and group by (layer, parent_id); new rows use parent_id, legacy rows have variation_id at layer=1.
    var_ids = [v["id"] for v in variations]
    specifications = []
    if var_ids:
        # Pull all specs in this product's tree: layer=1 by variation_id IN var_ids, layer≥2 by parent_id (new code).
        fmt = ",".join(["%s"] * len(var_ids))
        specifications = db_all(
            "SELECT id, variation_id, parent_id, layer, spec_key, spec_value, position"
            f" FROM product_specifications WHERE variation_id IN ({fmt})"
            "    OR parent_id IN ("
            "      SELECT id FROM product_configurations_l1 WHERE product_id=%s"
            "      UNION SELECT id FROM product_configurations_l2 WHERE variation_id IN (" + fmt + ")"
            "      UNION SELECT id FROM product_configurations_l3 WHERE parent_id IN ("
            "        SELECT id FROM product_configurations_l2 WHERE variation_id IN (" + fmt + "))"
            "      UNION SELECT id FROM product_configurations_l4 WHERE parent_id IN ("
            "        SELECT id FROM product_configurations_l3 WHERE parent_id IN ("
            "          SELECT id FROM product_configurations_l2 WHERE variation_id IN (" + fmt + ")))"
            "      UNION SELECT id FROM product_configurations_l5 WHERE parent_id IN ("
            "        SELECT id FROM product_configurations_l4 WHERE parent_id IN ("
            "          SELECT id FROM product_configurations_l3 WHERE parent_id IN ("
            "            SELECT id FROM product_configurations_l2 WHERE variation_id IN (" + fmt + "))))"
            "    )"
            " ORDER BY position ASC, id ASC",
            tuple(var_ids) + (product_id,) + tuple(var_ids) * 4
        )
    spec_by_node = {}     # key: (layer, parent_id)
    for s in specifications:
        # Backwards-compat: legacy rows have variation_id set, layer defaults to 1
        layer = s.get("layer") or 1
        parent_id = s.get("parent_id") if s.get("parent_id") is not None else s.get("variation_id")
        spec_by_node.setdefault((layer, parent_id), []).append({
            "id": s["id"], "spec_key": s["spec_key"], "spec_value": s["spec_value"],
            "position": s["position"], "layer": layer, "parent_id": parent_id,
        })

    # Attach Layer 1 specs to variations (legacy + layer=1 new entries)
    for v in variations:
        v["specifications"] = spec_by_node.get((1, v["id"]), [])

    # Attach deeper-layer specs by walking the tree
    def _attach_specs(items: list, layer: int):
        for it in items:
            it["specifications"] = spec_by_node.get((layer, it["id"]), [])
            if it.get("children"):
                _attach_specs(it["children"], layer + 1)
    for v in variations:
        if v.get("configurations"):
            _attach_specs(v["configurations"], 2)

    own_fields = db_all(
        "SELECT field_key,field_value,field_type,is_global,position,created_at FROM product_custom_fields"
        " WHERE product_id=%s AND project_id=%s ORDER BY position ASC, created_at ASC",
        (product_id, project_id)
    )
    own_keys = {cf["field_key"] for cf in own_fields}
    # Global keys → placeholder rows on products without their own value.
    global_keys_rows = db_all(
        "SELECT field_key, MAX(field_type) AS field_type"
        " FROM product_custom_fields"
        " WHERE project_id=%s AND is_global=TRUE"
        " GROUP BY field_key ORDER BY field_key ASC",
        (project_id,)
    )
    custom_fields = []
    for cf in own_fields:
        cf["is_global"] = bool(cf.get("is_global", 0))
        cf["is_placeholder"] = False
        cf.pop("created_at", None)
        custom_fields.append(cf)
    for gk in global_keys_rows:
        if gk["field_key"] in own_keys: continue
        custom_fields.append({
            "field_key": gk["field_key"],
            "field_value": "",
            "field_type": gk["field_type"] or "string",
            "is_global": True,
            "is_placeholder": True,
        })

    reviews = db_all(
        "SELECT pr.id,pr.rating,pr.comment,pr.created_at,pr.user_id"
        " FROM product_reviews pr"
        " WHERE pr.product_id=%s AND pr.project_id=%s ORDER BY pr.created_at DESC",
        (product_id, project_id)
    )
    for r in reviews:
        r["created_at"] = str(r["created_at"])

    cat_row = None
    if p.get("category_id"):
        cat_row = db_one("SELECT id, name, slug FROM product_categories WHERE id=%s", (p["category_id"],))

    # Modifier groups: two-level fetch (groups + items); guarded so missing migration doesn't break.
    groups = []
    try:
        groups = db_all(
            "SELECT id, name, control_type, min_select, max_select, is_required,"
            "       default_item_id, position FROM product_modifier_groups"
            " WHERE product_id=%s ORDER BY position ASC, id ASC",
            (product_id,)
        )
        items_by_group: dict = {}
        if groups:
            gids = [g["id"] for g in groups]
            rows = db_all(
                "SELECT id, group_id, name, price_delta, position FROM product_modifier_items"
                " WHERE group_id = ANY(%s) ORDER BY position ASC, id ASC",
                (gids,)
            )
            for r in rows:
                r["price_delta"] = float(r.get("price_delta") or 0)
                items_by_group.setdefault(r["group_id"], []).append(r)
        for g in groups:
            g["items"] = items_by_group.get(g["id"], [])
    except Exception as e:
        print(f"[get_product] modifier groups fetch failed (table missing?): {e}")
        groups = []

    return {
        "id": p["id"], "title": p["title"],
        "subtitle":       p["subtitle"]         or "",
        "description":    p["description"]      or "",
        "category_id":    p.get("category_id"),
        "category_name":  cat_row["name"] if cat_row else None,
        "category_slug":  cat_row["slug"] if cat_row else None,
        "seo_title":      p["seo_title"]        or "",
        "seo_description":p["seo_description"]  or "",
        "seo_keywords":   p["seo_keywords"]     or "",
        "product_type":   p.get("product_type") or "physical",
        "is_archived":    bool(p.get("is_archived")),
        "is_paused":      bool(p.get("is_paused")),
        # ── Phase 1: SaaS-grade physical fields (all default to '' / 0 / False / None) ──
        "sku":                   p.get("sku") or "",
        "barcode":               p.get("barcode") or "",
        "brand":                 p.get("brand") or "",
        "manufacturer":          p.get("manufacturer") or "",
        "vendor":                p.get("vendor") or "",
        "country_of_origin":     p.get("country_of_origin") or "",
        "hs_code":               p.get("hs_code") or "",
        "og_image_url":          p.get("og_image_url"),
        "requires_shipping":     bool(p.get("requires_shipping", True)),
        "ships_internationally": bool(p.get("ships_internationally")),
        "shipping_class":        p.get("shipping_class") or "standard",
        "lead_time_days":        int(p.get("lead_time_days") or 0),
        "continue_selling_oos":  bool(p.get("continue_selling_oos")),
        "moq":                   int(p.get("moq") or 1),
        "order_increment":       int(p.get("order_increment") or 1),
        "low_stock_threshold":   int(p.get("low_stock_threshold") or 0),
        "is_pre_order":          bool(p.get("is_pre_order")),
        "pre_order_release_at":  p["pre_order_release_at"].isoformat() if p.get("pre_order_release_at") else None,
        "net_terms_days":        int(p.get("net_terms_days") or 0),
        "allow_po":              bool(p.get("allow_po")),
        "tax_category_id":       p.get("tax_category_id"),
        # Discount (product-level) — UI walk-up resolution at storefront.
        "sale_type":      p.get("sale_type"),
        "sale_value":     float(p["sale_value"]) if p.get("sale_value") is not None else None,
        "sale_starts_at": p["sale_starts_at"].isoformat() if p.get("sale_starts_at") else None,
        "sale_ends_at":   p["sale_ends_at"].isoformat()   if p.get("sale_ends_at")   else None,
        "variations": variations, "custom_fields": custom_fields, "reviews": reviews,
        "modifier_groups": groups,
        "max_layer": max_layer,
    }


@app.put("/api/products/{product_id}")
def update_product(product_id: int, request: UpdateProductRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    fields = []; vals = []
    if request.title           is not None: fields.append("title=%s");           vals.append(request.title.strip())
    if request.subtitle        is not None: fields.append("subtitle=%s");        vals.append(request.subtitle)
    if request.description     is not None: fields.append("description=%s");     vals.append(request.description)
    if request.seo_title       is not None: fields.append("seo_title=%s");       vals.append(request.seo_title)
    if request.seo_description is not None: fields.append("seo_description=%s"); vals.append(request.seo_description)
    if request.seo_keywords    is not None: fields.append("seo_keywords=%s");    vals.append(request.seo_keywords)
    # category_id supports explicit null (clear) — check via Pydantic v2 fields_set
    if "category_id" in request.model_fields_set:
        if request.category_id is not None:
            if not db_one("SELECT id FROM product_categories WHERE id=%s AND project_id=%s",
                          (request.category_id, project_id)):
                raise HTTPException(400, "Category does not belong to this project")
        fields.append("category_id=%s"); vals.append(request.category_id)
    if request.product_type is not None:
        if request.product_type not in ("physical", "digital", "service", "event"):
            raise HTTPException(400, "Invalid product_type")
        fields.append("product_type=%s"); vals.append(request.product_type)
    if request.is_archived is not None:
        fields.append("is_archived=%s"); vals.append(bool(request.is_archived))
    if request.is_paused is not None:
        fields.append("is_paused=%s"); vals.append(bool(request.is_paused))
    # ── Phase 1: SaaS-grade physical fields ──
    # Free-text identifiers (sku, barcode, brand, etc.) — sanitized.
    for fld in ("sku", "barcode", "brand", "manufacturer", "vendor",
                "country_of_origin", "hs_code"):
        v = getattr(request, fld)
        if v is not None:
            fields.append(f"{fld}=%s"); vals.append(sanitize(v.strip())[:200])
    if "og_image_url" in request.model_fields_set:
        fields.append("og_image_url=%s"); vals.append(request.og_image_url)
    for fld in ("requires_shipping", "ships_internationally",
                "continue_selling_oos", "is_pre_order", "allow_po"):
        v = getattr(request, fld)
        if v is not None:
            fields.append(f"{fld}=%s"); vals.append(bool(v))
    if request.shipping_class is not None:
        if request.shipping_class not in ("standard", "fragile", "oversized", "hazmat", "perishable"):
            raise HTTPException(400, "Invalid shipping_class")
        fields.append("shipping_class=%s"); vals.append(request.shipping_class)
    for fld in ("lead_time_days", "moq", "order_increment",
                "low_stock_threshold", "net_terms_days"):
        v = getattr(request, fld)
        if v is not None:
            iv = int(v)
            if iv < 0: raise HTTPException(400, f"{fld} must be ≥ 0")
            # moq/order_increment must be ≥ 1 to make sense in a cart math.
            if fld in ("moq", "order_increment") and iv < 1:
                raise HTTPException(400, f"{fld} must be ≥ 1")
            fields.append(f"{fld}=%s"); vals.append(iv)
    if "pre_order_release_at" in request.model_fields_set:
        fields.append("pre_order_release_at=%s"); vals.append(request.pre_order_release_at)
    if "tax_category_id" in request.model_fields_set:
        if request.tax_category_id is not None:
            if not db_one("SELECT id FROM product_tax_categories WHERE id=%s AND project_id=%s",
                          (request.tax_category_id, project_id)):
                raise HTTPException(400, "Tax category does not belong to this project")
        fields.append("tax_category_id=%s"); vals.append(request.tax_category_id)
    # Discount fields — null-explicit clears, value sets.
    if "sale_type" in request.model_fields_set:
        v = request.sale_type
        if v is not None and v not in ('percent', 'amount', 'fixed'):
            raise HTTPException(400, "Invalid sale_type")
        fields.append("sale_type=%s"); vals.append(v)
    if "sale_value" in request.model_fields_set:
        v = request.sale_value
        if v is not None and float(v) < 0:
            raise HTTPException(400, "sale_value must be ≥ 0")
        fields.append("sale_value=%s"); vals.append(v)
    if "sale_starts_at" in request.model_fields_set:
        fields.append("sale_starts_at=%s"); vals.append(request.sale_starts_at)
    if "sale_ends_at" in request.model_fields_set:
        fields.append("sale_ends_at=%s"); vals.append(request.sale_ends_at)
    if not fields: return {"ok": True}
    vals.extend([product_id, project_id])
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE products SET " + ", ".join(fields) + " WHERE id=%s AND project_id=%s", vals)
        # Ensure 1:1 booking_services row when product becomes a service (for type-switch via PATCH).
        if request.product_type == "service":
            cur.execute(
                "INSERT INTO booking_services (project_id, product_id, name, description,"
                "                              duration_minutes, price, is_active)"
                " SELECT %s, %s, p.title, COALESCE(p.description, ''), 30, 0, TRUE"
                "   FROM products p WHERE p.id=%s"
                " ON CONFLICT DO NOTHING",
                (project_id, product_id, product_id)
            )
        # Sync title/description to linked booking_service so service edits in either place stay aligned.
        if request.title is not None or request.description is not None:
            sync_fields, sync_vals = [], []
            if request.title is not None:
                sync_fields.append("name=%s"); sync_vals.append(sanitize(request.title.strip())[:200])
            if request.description is not None:
                sync_fields.append("description=%s"); sync_vals.append(sanitize(request.description or "")[:5000])
            sync_vals.append(product_id)
            cur.execute(
                f"UPDATE booking_services SET {', '.join(sync_fields)} WHERE product_id=%s",
                sync_vals
            )
        conn.commit()
    return {"ok": True}


@app.delete("/api/products/{product_id}")
def delete_product(product_id: int, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    # Collect S3 image URLs of all variations BEFORE deleting DB rows
    image_rows = db_all("SELECT unnest(images) AS image_url FROM product_configurations_l1 WHERE product_id=%s", (product_id,))

    # Walk the layer tree to collect IDs per layer — parent_id has no FK CASCADE, so L2-5 specs would orphan otherwise (only L1 cascades via variation_id).
    l1_ids = [r["id"] for r in db_all(
        "SELECT id FROM product_configurations_l1 WHERE product_id=%s", (product_id,))]
    l2_ids = [r["id"] for r in db_all(
        "SELECT id FROM product_configurations_l2 WHERE variation_id = ANY(%s)", (l1_ids,))] if l1_ids else []
    l3_ids = [r["id"] for r in db_all(
        "SELECT id FROM product_configurations_l3 WHERE parent_id = ANY(%s)", (l2_ids,))] if l2_ids else []
    l4_ids = [r["id"] for r in db_all(
        "SELECT id FROM product_configurations_l4 WHERE parent_id = ANY(%s)", (l3_ids,))] if l3_ids else []
    l5_ids = [r["id"] for r in db_all(
        "SELECT id FROM product_configurations_l5 WHERE parent_id = ANY(%s)", (l4_ids,))] if l4_ids else []

    with db_cursor() as (conn, cur):
        # Layer 2-5 specs (parent_id-attached) — no FK CASCADE here, wipe by hand.
        for layer, ids in ((2, l2_ids), (3, l3_ids), (4, l4_ids), (5, l5_ids)):
            if ids:
                cur.execute(
                    "DELETE FROM product_specifications WHERE layer=%s AND parent_id = ANY(%s)",
                    (layer, ids))

        # Layer tree wipe: l3/l4/l5 cascade via parent_id FK; L1 specs cascade via product_specifications.variation_id.
        cur.execute(
            "DELETE FROM product_configurations_l2 WHERE variation_id IN "
            "(SELECT id FROM product_configurations_l1 WHERE product_id=%s)", (product_id,))
        cur.execute("DELETE FROM product_configurations_l1 WHERE product_id=%s", (product_id,))

        # Per-product CRM data
        cur.execute("DELETE FROM product_custom_fields WHERE product_id=%s", (product_id,))

        # Storefront tables — purge all refs so product disappears from active carts, favorites, analytics.
        cur.execute("DELETE FROM product_reviews    WHERE product_id=%s AND project_id=%s", (product_id, project_id))
        cur.execute("DELETE FROM favorites          WHERE product_id=%s AND project_id=%s", (product_id, project_id))
        cur.execute("DELETE FROM cart_items         WHERE product_id=%s", (product_id,))
        cur.execute("DELETE FROM product_page_views WHERE product_id=%s AND project_id=%s", (product_id, project_id))

        # order_items intentionally NOT touched — past orders display the checkout-snapshot fields (product_title / configuration_name).

        cur.execute("DELETE FROM products WHERE id=%s AND project_id=%s", (product_id, project_id))
        conn.commit()
    # Best-effort S3 cleanup (don't fail the request if S3 errors out)
    prefix = f"projects/{project_id}/products/"
    for r in image_rows:
        url = (r or {}).get("image_url")
        if url:
            s3_delete_url(url, prefix)
    return {"ok": True}


# ── DUPLICATE ────────────────────────────────────────────

@app.post("/api/products/{product_id}/duplicate")
def duplicate_product(product_id: int, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    """Clone product tree (L1-L5 + specs + custom_fields + modifier_groups/items). Skips reviews, orders, cart, stock_log."""
    require_team_member_or_owner(user, project_id)
    src = db_one("SELECT * FROM products WHERE id=%s AND project_id=%s", (product_id, project_id))
    if not src: raise HTTPException(404, "Product not found")

    with db_cursor() as (conn, cur):
        # 1. Clone product row with " (copy)" suffix; reset sku/barcode so auto-SKU regenerates uniquely.
        new_title = (src.get("title") or "") + " (copy)"
        cur.execute(
            "INSERT INTO products"
            "  (project_id, title, subtitle, description, category_id, seo_title, seo_description, seo_keywords,"
            "   product_type, sku, barcode, brand, manufacturer, vendor, country_of_origin, hs_code, og_image_url,"
            "   requires_shipping, ships_internationally, continue_selling_oos, is_pre_order, allow_po,"
            "   shipping_class, lead_time_days, moq, order_increment, low_stock_threshold, net_terms_days,"
            "   pre_order_release_at, tax_category_id)"
            " SELECT project_id, %s, subtitle, description, category_id, seo_title, seo_description, seo_keywords,"
            "        product_type, '', '', brand, manufacturer, vendor, country_of_origin, hs_code, og_image_url,"
            "        requires_shipping, ships_internationally, continue_selling_oos, is_pre_order, allow_po,"
            "        shipping_class, lead_time_days, moq, order_increment, low_stock_threshold, net_terms_days,"
            "        pre_order_release_at, tax_category_id"
            "   FROM products WHERE id=%s RETURNING id",
            (sanitize(new_title), product_id)
        )
        new_pid = cur.fetchone()["id"]

        # 2. Regenerate product-level auto-SKU under org settings.
        mode, length = _resolve_sku_settings(project_id)
        new_sku = _gen_unique_product_sku(cur, project_id, mode, length)
        if new_sku:
            cur.execute("UPDATE products SET sku=%s WHERE id=%s", (new_sku, new_pid))
        # Mint a fresh EAN-13 for the duplicate (we don't copy the source's
        # barcode because every product needs its own unique scannable code).
        cur.execute("UPDATE products SET barcode = '' WHERE id = %s", (new_pid,))
        _ensure_product_ean13(cur, new_pid)

        # 3. Clone Layer 1 → Layer 5 tree. Maintain id-map at each level so child rows point to new parents.
        l1_map = {}
        cur.execute("SELECT * FROM product_configurations_l1 WHERE product_id=%s ORDER BY position", (product_id,))
        for r in cur.fetchall():
            cur.execute(
                "INSERT INTO product_configurations_l1"
                "  (product_id, variation_name, images, media_alt, price, stock_quantity, sold_quantity, position,"
                "   sale_type, sale_value, sale_starts_at, sale_ends_at)"
                " VALUES (%s, %s, %s, %s, %s, 0, 0, %s, %s, %s, %s, %s) RETURNING id",
                (new_pid, r["variation_name"], r.get("images") or [], r.get("media_alt") or [],
                 r.get("price"), r["position"],
                 r.get("sale_type"), r.get("sale_value"), r.get("sale_starts_at"), r.get("sale_ends_at"))
            )
            l1_map[r["id"]] = cur.fetchone()["id"]

        l2_map = {}
        if l1_map:
            cur.execute("SELECT * FROM product_configurations_l2 WHERE variation_id = ANY(%s) ORDER BY position",
                        (list(l1_map.keys()),))
            for r in cur.fetchall():
                # Regenerate SKU code so we don't clash with parent's uq_l2_project_sku_code.
                new_sku_code = _gen_unique_l2_sku_code(cur, new_pid, mode, length) if r.get("sku_code") else ''
                cur.execute(
                    "INSERT INTO product_configurations_l2"
                    "  (product_id, variation_id, configuration_name, price, stock_quantity, sold_quantity, position,"
                    "   sku_code, barcode, compare_at_price, cost_price, weight_g, length_cm, width_cm, height_cm,"
                    "   sale_type, sale_value, sale_starts_at, sale_ends_at)"
                    " VALUES (%s, %s, %s, %s, 0, 0, %s, %s, '', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (new_pid, l1_map[r["variation_id"]], r["configuration_name"], r.get("price"), r["position"],
                     new_sku_code, r.get("compare_at_price"), r.get("cost_price"),
                     r.get("weight_g"), r.get("length_cm"), r.get("width_cm"), r.get("height_cm"),
                     r.get("sale_type"), r.get("sale_value"), r.get("sale_starts_at"), r.get("sale_ends_at"))
                )
                new_l2_id = cur.fetchone()["id"]
                l2_map[r["id"]] = new_l2_id
                # Mint a fresh EAN-13 for the duplicate SKU (we passed '' for
                # barcode in the INSERT above so _ensure mints a new one).
                _ensure_sku_ean13(cur, new_l2_id)

        def _clone_layer(layer_n: int, parent_map: dict) -> dict:
            if not parent_map: return {}
            new_map = {}
            cur.execute(
                f"SELECT * FROM product_configurations_l{layer_n} WHERE parent_id = ANY(%s) ORDER BY position",
                (list(parent_map.keys()),)
            )
            for r in cur.fetchall():
                cur.execute(
                    f"INSERT INTO product_configurations_l{layer_n}"
                    "  (parent_id, name, price, stock_quantity, sold_quantity, position)"
                    " VALUES (%s, %s, %s, 0, 0, %s) RETURNING id",
                    (parent_map[r["parent_id"]], r["name"], r.get("price"), r["position"])
                )
                new_map[r["id"]] = cur.fetchone()["id"]
            return new_map

        l3_map = _clone_layer(3, l2_map)
        l4_map = _clone_layer(4, l3_map)
        l5_map = _clone_layer(5, l4_map)

        # 4. Specifications: rewrite parent_id + variation_id pointing into new tree.
        full_map = {1: l1_map, 2: l2_map, 3: l3_map, 4: l4_map, 5: l5_map}
        for layer, pmap in full_map.items():
            if not pmap: continue
            cur.execute(
                "SELECT * FROM product_specifications WHERE layer=%s AND parent_id = ANY(%s)",
                (layer, list(pmap.keys()))
            )
            for r in cur.fetchall():
                v_id = l1_map.get(r["variation_id"]) if r.get("variation_id") else None
                cur.execute(
                    "INSERT INTO product_specifications (variation_id, layer, parent_id, spec_key, spec_value, position)"
                    " VALUES (%s, %s, %s, %s, %s, %s)",
                    (v_id, layer, pmap[r["parent_id"]], r["spec_key"], r["spec_value"], r.get("position", 0))
                )

        # 5. Custom fields (global rows are duplicated, but Global=true keeps key→all-products invariant).
        cur.execute("SELECT * FROM product_custom_fields WHERE product_id=%s ORDER BY position", (product_id,))
        for r in cur.fetchall():
            cur.execute(
                "INSERT INTO product_custom_fields"
                "  (project_id, product_id, field_key, field_value, field_type, is_global, position)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s)"
                " ON CONFLICT DO NOTHING",
                (project_id, new_pid, r["field_key"], r["field_value"], r["field_type"],
                 r.get("is_global", False), r.get("position", 0))
            )

        # 6. Modifier groups + items (preserve item-id map so default_item_id rewrites correctly).
        cur.execute("SELECT * FROM product_modifier_groups WHERE product_id=%s ORDER BY position", (product_id,))
        groups = cur.fetchall()
        group_map = {}
        for g in groups:
            cur.execute(
                "INSERT INTO product_modifier_groups"
                "  (product_id, name, control_type, min_select, max_select, is_required, position)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (new_pid, g["name"], g["control_type"], g["min_select"], g.get("max_select"),
                 g["is_required"], g["position"])
            )
            group_map[g["id"]] = cur.fetchone()["id"]

        item_map = {}
        if group_map:
            cur.execute("SELECT * FROM product_modifier_items WHERE group_id = ANY(%s) ORDER BY position",
                        (list(group_map.keys()),))
            for it in cur.fetchall():
                cur.execute(
                    "INSERT INTO product_modifier_items (group_id, name, price_delta, position)"
                    " VALUES (%s, %s, %s, %s) RETURNING id",
                    (group_map[it["group_id"]], it["name"], it["price_delta"], it["position"])
                )
                item_map[it["id"]] = cur.fetchone()["id"]

        # Re-link default_item_id on groups (we now have item_map).
        for g in groups:
            d = g.get("default_item_id")
            if d and d in item_map:
                cur.execute("UPDATE product_modifier_groups SET default_item_id=%s WHERE id=%s",
                            (item_map[d], group_map[g["id"]]))

        conn.commit()
    return {"id": new_pid, "title": new_title}


# ── BULK ACTIONS ─────────────────────────────────────────

class BulkActionRequest(BaseModel):
    action:       str
    product_ids:  List[int]
    category_id:  Optional[int] = None
    price_delta_pct: Optional[float] = None      # e.g. -10 = drop 10%
    set_stock:    Optional[int] = None
    is_paused:    Optional[bool] = None
    is_archived:  Optional[bool] = None


@app.post("/api/projects/{project_id}/products/bulk")
def bulk_action(project_id: int, request: BulkActionRequest, user: dict = Depends(get_current_user)):
    """Atomic batch on N products (max 500). Verifies every id belongs to the project before any write."""
    require_team_member_or_owner(user, project_id)
    if not request.product_ids:
        return {"ok": True, "affected": 0}
    if len(request.product_ids) > 500:
        raise HTTPException(400, "Too many products in one batch (max 500)")
    ids = [int(x) for x in request.product_ids]

    # Cross-tenant guard: re-fetch and require every id maps to this project.
    rows = db_all(
        "SELECT id FROM products WHERE id = ANY(%s) AND project_id=%s",
        (ids, project_id)
    )
    valid_ids = [r["id"] for r in rows]
    if len(valid_ids) != len(ids):
        raise HTTPException(403, "Some products do not belong to this project")

    action = request.action
    with db_cursor() as (conn, cur):
        if action == "delete":
            # Mirror delete_product but batched (avoid 500 round-trips).
            cur.execute("DELETE FROM product_specifications WHERE variation_id IN "
                        "(SELECT id FROM product_configurations_l1 WHERE product_id = ANY(%s))", (valid_ids,))
            cur.execute("DELETE FROM product_configurations_l2 WHERE variation_id IN "
                        "(SELECT id FROM product_configurations_l1 WHERE product_id = ANY(%s))", (valid_ids,))
            cur.execute("DELETE FROM product_configurations_l1 WHERE product_id = ANY(%s)", (valid_ids,))
            cur.execute("DELETE FROM product_custom_fields WHERE product_id = ANY(%s)", (valid_ids,))
            cur.execute("DELETE FROM product_reviews WHERE product_id = ANY(%s) AND project_id=%s", (valid_ids, project_id))
            cur.execute("DELETE FROM favorites WHERE product_id = ANY(%s) AND project_id=%s", (valid_ids, project_id))
            cur.execute("DELETE FROM cart_items WHERE product_id = ANY(%s)", (valid_ids,))
            cur.execute("DELETE FROM product_page_views WHERE product_id = ANY(%s) AND project_id=%s", (valid_ids, project_id))
            cur.execute("DELETE FROM products WHERE id = ANY(%s) AND project_id=%s", (valid_ids, project_id))
        elif action == "archive":
            cur.execute("UPDATE products SET is_archived=TRUE, is_paused=FALSE WHERE id = ANY(%s) AND project_id=%s",
                        (valid_ids, project_id))
        elif action == "unarchive":
            cur.execute("UPDATE products SET is_archived=FALSE WHERE id = ANY(%s) AND project_id=%s",
                        (valid_ids, project_id))
        elif action == "pause":
            cur.execute("UPDATE products SET is_paused=TRUE WHERE id = ANY(%s) AND project_id=%s",
                        (valid_ids, project_id))
        elif action == "resume":
            cur.execute("UPDATE products SET is_paused=FALSE WHERE id = ANY(%s) AND project_id=%s",
                        (valid_ids, project_id))
        elif action == "set_category":
            cat = request.category_id
            if cat is not None:
                if not db_one("SELECT id FROM product_categories WHERE id=%s AND project_id=%s",
                              (cat, project_id)):
                    raise HTTPException(400, "Category does not belong to this project")
            cur.execute("UPDATE products SET category_id=%s WHERE id = ANY(%s) AND project_id=%s",
                        (cat, valid_ids, project_id))
        elif action == "price_delta_pct":
            pct = request.price_delta_pct
            if pct is None: raise HTTPException(400, "price_delta_pct required")
            if pct <= -100 or pct >= 1000:
                raise HTTPException(400, "price_delta_pct out of range (-100..1000)")
            factor = 1.0 + (float(pct) / 100.0)
            # Apply on Layer 2 (SKU) price only — Layer 1 inherit semantics keep tree consistent.
            cur.execute(
                "UPDATE product_configurations_l2 SET price = GREATEST(price * %s, 0)"
                " WHERE variation_id IN (SELECT id FROM product_configurations_l1 WHERE product_id = ANY(%s))"
                "   AND price IS NOT NULL",
                (factor, valid_ids)
            )
        elif action == "set_stock":
            if request.set_stock is None or request.set_stock < 0:
                raise HTTPException(400, "set_stock must be ≥ 0")
            # Adjust via product_stock at default WH; _sync_l2_stock keeps the aggregate in sync.
            wh_id = _default_warehouse_id(cur, project_id)
            cur.execute(
                "SELECT c.id AS sku_id FROM product_configurations_l2 c"
                " JOIN product_configurations_l1 l1 ON c.variation_id = l1.id"
                " WHERE l1.product_id = ANY(%s)",
                (valid_ids,)
            )
            sku_ids = [r["sku_id"] for r in cur.fetchall()]
            for sid in sku_ids:
                cur.execute(
                    "INSERT INTO product_stock (sku_id, warehouse_id, quantity, sold_quantity)"
                    " VALUES (%s, %s, %s, 0)"
                    " ON CONFLICT (sku_id, warehouse_id) DO UPDATE SET quantity = EXCLUDED.quantity",
                    (sid, wh_id, request.set_stock)
                )
                cur.execute(
                    "INSERT INTO product_stock_log (project_id, sku_id, warehouse_id, delta, reason, user_id, note)"
                    " VALUES (%s, %s, %s, 0, 'bulk_set', %s, %s)",
                    (project_id, sid, wh_id, user["id"], f"Bulk set to {request.set_stock}")
                )
                _sync_l2_stock(cur, sid)
        else:
            raise HTTPException(400, f"Unknown action: {action}")
        conn.commit()
    return {"ok": True, "affected": len(valid_ids), "action": action}


# ── BARCODE PRINTING ─────────────────────────────────────

# Label format presets: dimensions in mm, fits printer rolls + A4 sheet variants.
LABEL_FORMATS = {
    "50x30":     {"w_mm": 50, "h_mm": 30, "per_page": 1,  "page_w_mm": 50,  "page_h_mm": 30 },
    "70x40":     {"w_mm": 70, "h_mm": 40, "per_page": 1,  "page_w_mm": 70,  "page_h_mm": 40 },
    "a4_24":     {"w_mm": 64, "h_mm": 33, "per_page": 24, "page_w_mm": 210, "page_h_mm": 297, "cols": 3, "rows": 8 },
    "a4_30":     {"w_mm": 70, "h_mm": 29, "per_page": 30, "page_w_mm": 210, "page_h_mm": 297, "cols": 3, "rows": 10},
}


def _generate_barcode_svg(value: str, symbology: str = "code128") -> str:
    """Return barcode SVG fragment. Symbology dispatches to the right
    python-barcode class. Each symbology has a strict payload — we coerce the
    input to fit so the library doesn't refuse to render. Falls back to plain
    text on any error. Bars are tall + wide so they actually scan from the printout."""
    if not value:
        return '<text x="0" y="14" font-family="monospace" font-size="10">no-code</text>'
    try:
        import barcode as _bc
        from barcode.writer import SVGWriter
        from io import BytesIO
        buf = BytesIO()
        digits = ''.join(c for c in value if c.isdigit())

        if symbology == "ean13":
            # 12 digit payload — python-barcode computes the 13th check digit.
            payload = digits[:12] if len(digits) >= 12 else digits.zfill(12)
            code = _bc.EAN13(payload, writer=SVGWriter())
        elif symbology == "ean8":
            # 7 digit payload — python-barcode computes the 8th check digit.
            payload = digits[:7] if len(digits) >= 7 else digits.zfill(7)
            code = _bc.EAN8(payload, writer=SVGWriter())
        elif symbology == "upca":
            # 11 digit payload — python-barcode computes the 12th check digit.
            payload = digits[:11] if len(digits) >= 11 else digits.zfill(11)
            code = _bc.UPCA(payload, writer=SVGWriter())
        elif symbology == "code39":
            # Code 39: uppercase letters + digits + few specials. Strip the rest.
            payload = ''.join(c for c in value.upper() if c.isalnum() or c in '-. $/+%')
            if not payload: payload = digits or 'X'
            code = _bc.Code39(payload, writer=SVGWriter(), add_checksum=False)
        elif symbology == "itf":
            # Interleaved 2 of 5: digits only, even length (library pads).
            payload = digits if len(digits) % 2 == 0 else '0' + digits
            if not payload: payload = '00'
            code = _bc.ITF(payload, writer=SVGWriter())
        elif symbology == "gs1_128":
            # GS1-128 — Code 128 with Application Identifiers. python-barcode
            # exposes Gs1_128 which respects the AI grammar (FNC1 separators).
            try:
                code = _bc.Gs1_128(value, writer=SVGWriter())
            except Exception:
                # Library version without Gs1_128 → degrade to plain Code 128.
                code = _bc.Code128(value, writer=SVGWriter())
        else:
            code = _bc.Code128(value, writer=SVGWriter())

        # Render ONLY the bars — we draw digits + extended guard bars in
        # _decorate_ean_svg with full control over layout. Module height 13mm
        # gives the standard EAN-13 aspect (about 2:1 wide:tall, matches
        # tec-it.com renderings).
        code.write(buf, options={
            "write_text":   False,
            "module_height": 13.0,
            "module_width":   0.33,
            "quiet_zone":     3,
        })
        raw = buf.getvalue().decode("utf-8", errors="replace")
        m = re.search(r"<svg[\s\S]*?</svg>", raw)
        if not m:
            return f'<text x="0" y="14" font-family="monospace" font-size="10">{sanitize(value)}</text>'
        svg = m.group(0)
        # python-barcode 0.15 quirk: rects use absolute mm units in attributes
        # (`x="2.000mm" width="0.400mm"`) AND the <svg> has no viewBox. With
        # CSS-sized SVG, the browser converts those mm values via DPI which
        # doesn't match the viewBox grid → bars end up at wrong positions.
        # Strip the "mm" suffix from every coordinate so they become bare
        # user-units matching the viewBox we inject.
        dim = re.search(r'<svg[^>]*?width="([^"]+)"[^>]*?height="([^"]+)"', svg)
        if dim:
            w_mm = float(re.sub(r'[^0-9.]', '', dim.group(1)) or '0')
            h_mm = float(re.sub(r'[^0-9.]', '', dim.group(2)) or '0')
            if w_mm > 0 and h_mm > 0:
                # Strip "mm" from every numeric-followed-by-mm attribute value
                # GLOBALLY (not just first per rect). Pattern: `="2.000mm"` → `="2.000"`.
                svg = re.sub(r'(="[\d.]+)mm(")', r'\1\2', svg)
                # Inject viewBox matching the (now unit-less) coordinate space.
                # Preserve aspect ratio so the bars don't stretch — gives the
                # squarer tec-it-style proportions instead of the wide-stretched
                # look that `preserveAspectRatio="none"` produces.
                if 'viewBox' not in svg:
                    svg = re.sub(r'<svg', f'<svg viewBox="0 0 {w_mm} {h_mm}" preserveAspectRatio="xMidYMid meet"', svg, count=1)
        return svg
    except Exception:
        return f'<text x="0" y="14" font-family="monospace" font-size="10">{sanitize(value)}</text>'


class PrintBarcodesRequest(BaseModel):
    items:           List[dict]                    # [{sku_id: int, qty: int}] OR [{product_id: int, qty: int}]
    format:          str   = "50x30"
    show_sku:        bool  = True
    show_barcode:    bool  = True
    show_title:      bool  = True
    show_price:      bool  = False
    copies_per_sku:  int   = 1                     # multiplier on top of per-item qty
    auto_print:      bool  = False                 # add window.print() on iframe load — disabled by default so users can review first
    # Advanced encoding — when set, these values are appended to the SKU/barcode string before Code128 encoding.
    include_date:        bool  = False
    production_date:     Optional[str]   = None       # YYYY-MM-DD or empty for "today"
    include_batch:       bool  = False
    batch_name:          Optional[str]   = None
    include_qty:         bool  = False
    qty_in_batch:        Optional[int]   = None
    include_serial:      bool  = False
    # Symbology — "code128" (default, alphanumeric) or "ean13" (numeric, 13 digits with check digit).
    symbology:           str   = "code128"
    qr_mode:             bool  = False               # render QR Code instead of Code128 (for event tickets)


def _ean13_check_digit(twelve: str) -> str:
    """GS1 EAN-13 algorithm: sum odd-position digits + 3 × even-position digits, then 10 - (sum % 10) mod 10."""
    if not twelve or not twelve.isdigit() or len(twelve) != 12:
        return ''
    s = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(twelve))
    return str((10 - (s % 10)) % 10)


def _normalize_ean13(raw: str) -> Optional[str]:
    """Accepts 12 or 13 digits. Returns the canonical 13-digit value or None if invalid."""
    s = (raw or '').strip()
    if not s.isdigit(): return None
    if len(s) == 12:
        return s + _ean13_check_digit(s)
    if len(s) == 13:
        return s if _ean13_check_digit(s[:12]) == s[12] else None
    return None


# Internal EAN-13 generation. Prefixes 200-299 are reserved by GS1 for
# "in-store / restricted distribution" — they never collide with real registered
# manufacturer codes, so it's safe to mint these without GS1 membership.
# Layout: PPP (3-digit prefix) + IIIIIIIII (9-digit entity id, zero-padded) + C (check)
EAN13_PREFIX_PRODUCT = '200'   # products
EAN13_PREFIX_SKU     = '201'   # product_configurations_l2 (L2 SKUs)

def _internal_ean13(prefix: str, entity_id: int) -> str:
    """Mint a 13-digit EAN-13 from a 3-digit prefix + 9-digit entity id +
    check digit. Caller picks the prefix (product / sku / etc.) so a scan can
    disambiguate the entity type just from the first 3 digits."""
    if entity_id is None or entity_id < 0:
        return ''
    twelve = f"{prefix}{int(entity_id):09d}"[:12].zfill(12)
    return twelve + _ean13_check_digit(twelve)


def _ensure_product_ean13(cur, product_id: int) -> str:
    """If products.barcode for `product_id` is empty/null/invalid, mint a fresh
    EAN-13 and persist it. Returns the canonical barcode (existing or new)."""
    cur.execute("SELECT barcode FROM products WHERE id = %s", (product_id,))
    row = cur.fetchone()
    existing = (row or {}).get('barcode') or ''
    if _normalize_ean13(existing):
        return existing
    minted = _internal_ean13(EAN13_PREFIX_PRODUCT, product_id)
    cur.execute("UPDATE products SET barcode = %s WHERE id = %s", (minted, product_id))
    return minted


def _ensure_sku_ean13(cur, sku_id: int) -> str:
    """Same as _ensure_product_ean13 but for product_configurations_l2 (L2 SKUs)."""
    cur.execute("SELECT barcode FROM product_configurations_l2 WHERE id = %s", (sku_id,))
    row = cur.fetchone()
    existing = (row or {}).get('barcode') or ''
    if _normalize_ean13(existing):
        return existing
    minted = _internal_ean13(EAN13_PREFIX_SKU, sku_id)
    cur.execute("UPDATE product_configurations_l2 SET barcode = %s WHERE id = %s",
                (minted, sku_id))
    return minted


def _format_ean_text(value: str, symbology: str) -> str:
    """Format a barcode value as the standard human-readable layout for EAN-13
    ("9 780201 379624"), EAN-8 ("1234 5678") or UPC-A ("0 12345 67890 5").
    Returns the raw digit string for non-EAN symbologies."""
    digits = ''.join(c for c in value if c.isdigit())
    if symbology == "ean13" and len(digits) >= 13:
        return f"{digits[0]} {digits[1:7]} {digits[7:13]}"
    if symbology == "ean8"  and len(digits) >= 8:
        return f"{digits[0:4]} {digits[4:8]}"
    if symbology == "upca"  and len(digits) >= 12:
        return f"{digits[0]} {digits[1:6]} {digits[6:11]} {digits[11]}"
    return value


def _decorate_ean_svg(svg: str, value: str, symbology: str) -> str:
    """Post-process a python-barcode EAN/UPC SVG so it looks like a real retail
    barcode: extends start/middle/end guard bars downward AND draws the
    human-readable digits in their canonical 3-group layout (e.g. `9 780201
    379624` for EAN-13). All done inside the SVG so it scales as one unit
    when the label CSS resizes it.

    Coordinate system after `_generate_barcode_svg` strips `mm` from rects:
    bars run from x ≈ 2.0 to x ≈ W-2.0, all at the same y/height.
    """
    digits = ''.join(c for c in value if c.isdigit())
    if symbology == "ean13" and len(digits) >= 13:
        groups = (digits[0], digits[1:7], digits[7:13])
    elif symbology == "ean8" and len(digits) >= 8:
        groups = (digits[0:4], digits[4:8])
    elif symbology == "upca" and len(digits) >= 12:
        groups = (digits[0], digits[1:6], digits[6:11], digits[11])
    else:
        return svg

    # Read the SVG's viewBox to know the bar zone in user units.
    vb = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
    if not vb:
        return svg
    w = float(vb.group(1))
    h = float(vb.group(2))

    # These constants MUST match the options passed to python-barcode in
    # _generate_barcode_svg (quiet_zone, module_height) so guard zones land
    # on the right rects.
    QUIET = 3.0
    BAR_TOP = 1.0
    BAR_BOT = BAR_TOP + 13.0   # module_height=13 → bars end at y=14
    EXTEND = 2.5               # how far guards drop below regular bars
    TEXT_Y = BAR_BOT + EXTEND + 0.5   # baseline for digits, just past guard tips
    NEW_H = TEXT_Y + 1.0

    # Guard-bar X ranges (in user units) by symbology. Numbers come from the
    # fixed EAN/UPC bar grammar (3-bar start guard, 5-bar middle, 3-bar end).
    bar_area = w - 2 * QUIET     # the actual bar zone width
    if symbology == "ean13":
        # 95-module pattern. Module width = bar_area / 95.
        m = bar_area / 95.0
        # Start at QUIET, end at QUIET+95m.
        start_lo, start_hi = QUIET, QUIET + 3 * m
        mid_lo,   mid_hi   = QUIET + 45 * m, QUIET + 50 * m
        end_lo,   end_hi   = QUIET + 92 * m, QUIET + 95 * m
        guards = [(start_lo, start_hi), (mid_lo, mid_hi), (end_lo, end_hi)]
    elif symbology == "upca":
        m = bar_area / 95.0   # UPC-A also 95 modules
        guards = [(QUIET, QUIET + 3*m), (QUIET + 45*m, QUIET + 50*m), (QUIET + 92*m, QUIET + 95*m)]
    elif symbology == "ean8":
        m = bar_area / 67.0   # EAN-8 has 67 modules
        guards = [(QUIET, QUIET + 3*m), (QUIET + 31*m, QUIET + 36*m), (QUIET + 64*m, QUIET + 67*m)]
    else:
        guards = []

    def is_guard(x, rw):
        cx = x + rw / 2.0
        return any(lo - 0.05 <= cx <= hi + 0.05 for lo, hi in guards)

    def bump(match):
        tag = match.group(0)
        # Skip the background fill rect (width=100%).
        if '100%' in tag:
            return tag
        xm = re.search(r'x="([\d.]+)"', tag)
        wm = re.search(r'width="([\d.]+)"', tag)
        hm = re.search(r'height="([\d.]+)"', tag)
        if not (xm and wm and hm):
            return tag
        x = float(xm.group(1)); rw = float(wm.group(1)); rh = float(hm.group(1))
        if not is_guard(x, rw):
            return tag
        return tag.replace(f'height="{hm.group(1)}"', f'height="{rh + EXTEND:.3f}"', 1)

    svg = re.sub(r'<rect[^/]*?/>', bump, svg)

    # Bump the SVG's viewBox + height attribute so the new tall guards + the
    # digit text below them stay visible.
    svg = re.sub(r'viewBox="0 0 ([\d.]+) ([\d.]+)"',
                 f'viewBox="0 0 {w} {NEW_H}"', svg, count=1)
    svg = re.sub(r'(<svg[^>]*?height=")[\d.]+(")',
                 f'\\g<1>{NEW_H}\\g<2>', svg, count=1)

    # Compose the digit text. Positions match the bar grammar so each group
    # sits directly under its half. font-size 2.0 user units ≈ 6pt at our scale.
    text_parts = []
    font = ('font-family="OCR-B, Courier New, monospace" '
            'font-size="3.2" font-weight="600" text-anchor="middle"')
    if symbology == "ean13":
        # "9" — left of start guard (in the quiet zone), left-anchored.
        text_parts.append(
            f'<text x="{QUIET - 0.5:.3f}" y="{TEXT_Y:.3f}" '
            f'font-family="OCR-B, Courier New, monospace" font-size="3.2" '
            f'font-weight="600" text-anchor="end">{groups[0]}</text>'
        )
        # 6 digits centered under the left half.
        m = bar_area / 95.0
        left_cx  = QUIET + 3*m + (42*m) / 2.0   # center of left half (42 mods)
        right_cx = QUIET + 50*m + (42*m) / 2.0
        text_parts.append(f'<text x="{left_cx:.3f}"  y="{TEXT_Y:.3f}" {font} letter-spacing="0.5">{groups[1]}</text>')
        text_parts.append(f'<text x="{right_cx:.3f}" y="{TEXT_Y:.3f}" {font} letter-spacing="0.5">{groups[2]}</text>')
    elif symbology == "upca":
        m = bar_area / 95.0
        text_parts.append(
            f'<text x="{QUIET - 0.5:.3f}" y="{TEXT_Y:.3f}" '
            f'font-family="OCR-B, Courier New, monospace" font-size="3.0" '
            f'font-weight="600" text-anchor="end">{groups[0]}</text>'
        )
        left_cx  = QUIET + 3*m + (42*m) / 2.0
        right_cx = QUIET + 50*m + (42*m) / 2.0
        text_parts.append(f'<text x="{left_cx:.3f}"  y="{TEXT_Y:.3f}" {font} letter-spacing="0.5">{groups[1]}</text>')
        text_parts.append(f'<text x="{right_cx:.3f}" y="{TEXT_Y:.3f}" {font} letter-spacing="0.5">{groups[2]}</text>')
        text_parts.append(
            f'<text x="{w - QUIET + 0.5:.3f}" y="{TEXT_Y:.3f}" '
            f'font-family="OCR-B, Courier New, monospace" font-size="3.0" '
            f'font-weight="600" text-anchor="start">{groups[3]}</text>'
        )
    elif symbology == "ean8":
        # EAN-8: two groups of 4, centered under each half.
        m = bar_area / 67.0
        left_cx  = QUIET + 3*m + (28*m) / 2.0
        right_cx = QUIET + 36*m + (28*m) / 2.0
        text_parts.append(f'<text x="{left_cx:.3f}"  y="{TEXT_Y:.3f}" {font} letter-spacing="0.5">{groups[0]}</text>')
        text_parts.append(f'<text x="{right_cx:.3f}" y="{TEXT_Y:.3f}" {font} letter-spacing="0.5">{groups[1]}</text>')

    # Inject text elements before </svg>.
    svg = svg.replace('</svg>', ''.join(text_parts) + '</svg>')
    return svg


def _generate_qr_svg(value: str, symbology: str = "qr") -> str:
    """2D barcode SVG fragment. Real `qrcode` lib renders QR. Data Matrix /
    GS1 Data Matrix / GS1 QR all fall through to QR because the GS1
    Application-Identifier wrapping is what scanners decode — the visual
    symbol (square QR vs Data Matrix) doesn't change the payload. Adding
    real Data Matrix would need the `pylibdmtx` system library.

    For GS1 variants we prepend the FNC1 symbology indicator (`]Q3` for QR,
    `]d2` for Data Matrix) so a barcode scanner reports the right type.
    """
    if not value: return '<text x="0" y="14" font-family="monospace" font-size="10">no-code</text>'

    # GS1 prefix marker — scanners interpret `]Q3` / `]d2` as "this 2D code
    # carries GS1 AIs". Without the prefix it's just an opaque string.
    payload = value
    if symbology == 'gs1_qr':         payload = ']Q3' + value
    elif symbology == 'gs1_datamatrix': payload = ']d2' + value
    elif symbology == 'data_matrix':   payload = value   # rendered as QR — visually different real symbol needs libdmtx

    try:
        import qrcode as _qr
        from qrcode.image.svg import SvgPathImage
        from io import BytesIO
        img = _qr.make(payload, image_factory=SvgPathImage, box_size=8, border=2)
        buf = BytesIO()
        img.save(buf)
        raw = buf.getvalue().decode('utf-8', errors='replace')
        m = re.search(r"<svg[\s\S]*?</svg>", raw)
        return m.group(0) if m else f'<text>{sanitize(value)}</text>'
    except Exception:
        return f'<text x="0" y="14" font-family="monospace" font-size="10">{sanitize(value)}</text>'


@app.get("/api/skus/lookup")
def lookup_skus(project_id: int = Query(...), ids: str = Query(""),
                user: dict = Depends(get_current_user)):
    """Batched sku_id → {product_id, title, variation_name, configuration_name} lookup. Used by PrintBarcodesModal to render labels for arbitrary SKU lists."""
    require_team_member_or_owner(user, project_id)
    try:
        id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()][:500]
    except ValueError:
        raise HTTPException(400, "Invalid ids")
    if not id_list:
        return []
    rows = db_all(
        "SELECT c.id AS sku_id, c.configuration_name, c.sku_code, c.barcode,"
        "       l1.id AS variation_id, l1.variation_name,"
        "       p.id AS product_id, p.title"
        "  FROM product_configurations_l2 c"
        "  JOIN product_configurations_l1 l1 ON c.variation_id = l1.id"
        "  JOIN products p ON l1.product_id = p.id"
        " WHERE c.id = ANY(%s) AND p.project_id = %s",
        (id_list, project_id)
    )
    return rows


@app.post("/api/projects/{project_id}/print-barcodes")
def print_barcodes(project_id: int, request: PrintBarcodesRequest,
                   user: dict = Depends(get_current_user)):
    """Returns a self-contained HTML page (with @media print rules). Frontend embeds it in an iframe — actual printer dispatch happens only when the user clicks Print (which triggers iframe.contentWindow.print())."""
    require_team_member_or_owner(user, project_id)
    fmt = LABEL_FORMATS.get(request.format)
    if not fmt: raise HTTPException(400, "Unknown label format")
    if not request.items: raise HTTPException(400, "No items to print")
    if len(request.items) > 2000:
        raise HTTPException(400, "Too many labels (max 2000)")

    # Items can mix three kinds: SKU-level, product-level, or batch-level.
    sku_ids     = [int(x["sku_id"])     for x in request.items if str(x.get("sku_id"))     not in (None, "") and str(x.get("sku_id")).isdigit()]
    product_ids = [int(x["product_id"]) for x in request.items if str(x.get("product_id")) not in (None, "") and str(x.get("product_id")).isdigit()]
    batch_ids   = [int(x["batch_id"])   for x in request.items if str(x.get("batch_id"))   not in (None, "") and str(x.get("batch_id")).isdigit()]
    if not sku_ids and not product_ids and not batch_ids:
        raise HTTPException(400, "items must contain sku_id, product_id or batch_id")

    # Cross-tenant guard: each id must belong to the caller's project.
    by_sku, by_product, by_batch = {}, {}, {}
    if sku_ids:
        rows = db_all(
            "SELECT c.id AS sku_id, c.sku_code, c.barcode AS sku_barcode, c.price,"
            "       p.id AS product_id, p.title"
            "  FROM product_configurations_l2 c"
            "  JOIN product_configurations_l1 l1 ON c.variation_id = l1.id"
            "  JOIN products p ON l1.product_id = p.id"
            " WHERE c.id = ANY(%s) AND p.project_id = %s",
            (sku_ids, project_id)
        )
        by_sku = {r["sku_id"]: r for r in rows}
        if len(by_sku) != len(set(sku_ids)):
            raise HTTPException(403, "Some SKUs do not belong to this project")
    if product_ids:
        rows = db_all(
            "SELECT id AS product_id, title, sku AS product_sku, barcode AS product_barcode"
            "  FROM products WHERE id = ANY(%s) AND project_id = %s",
            (product_ids, project_id)
        )
        by_product = {r["product_id"]: r for r in rows}
        if len(by_product) != len(set(product_ids)):
            raise HTTPException(403, "Some products do not belong to this project")
    if batch_ids:
        rows = db_all(
            "SELECT b.id AS batch_id, b.batch_name, b.sku_id,"
            "       l2.sku_code, l2.configuration_name AS sku_name, l2.price,"
            "       l1.variation_name, p.title"
            "  FROM inventory_batches b"
            "  JOIN product_configurations_l2 l2 ON b.sku_id = l2.id"
            "  JOIN product_configurations_l1 l1 ON l2.variation_id = l1.id"
            "  JOIN products p ON l1.product_id = p.id"
            " WHERE b.id = ANY(%s) AND b.project_id = %s",
            (batch_ids, project_id)
        )
        by_batch = {r["batch_id"]: r for r in rows}
        if len(by_batch) != len(set(batch_ids)):
            raise HTTPException(403, "Some batches do not belong to this project")

    copies = max(1, min(int(request.copies_per_sku), 50))

    # Resolve "date" placeholder once for the entire batch.
    date_value = ''
    if request.include_date:
        d = (request.production_date or '').strip()
        if d:
            date_value = d.replace('-', '')   # YYYYMMDD compact form
        else:
            date_value = _utcnow().strftime('%Y%m%d')

    # Static text appended to every label's base code: -YYYYMMDD-Bxxx-Qxxx (without serial; serial is per-unit).
    static_suffix = ''
    if request.include_date and date_value:
        static_suffix += f"-{date_value}"
    if request.include_batch and request.batch_name:
        # Sanitize batch into the encoded set (Code128 accepts everything; for EAN-13 we strip non-digits at the end).
        bn = re.sub(r'[^A-Za-z0-9]', '', request.batch_name)[:12]
        if bn: static_suffix += f"-B{bn}"
    if request.include_qty and request.qty_in_batch and int(request.qty_in_batch) > 0:
        static_suffix += f"-Q{int(request.qty_in_batch)}"

    # Build flat list of labels — one entry per individual sticker. Serial counters are assigned now so each unit gets a unique encoded value when include_serial is on.
    flat = []
    serial_counter = 0
    # We need a cursor open for any on-the-fly EAN-13 minting below.
    with db_cursor() as (mint_conn, mint_cur):
      for x in request.items:
        qty = max(1, int(x.get("qty") or 1)) * copies
        encode_field = x.get("encode_field") or 'auto'   # 'auto' | 'ean13'
        if x.get("sku_id") is not None and str(x.get("sku_id")).isdigit():
            r = by_sku.get(int(x["sku_id"]));
            if not r: continue
            if encode_field == 'ean13':
                # Force the canonical EAN-13. Mint one if the column is empty so
                # the print never fails just because a row was created pre-backfill.
                ean = r.get("sku_barcode") or ''
                if not _normalize_ean13(ean):
                    ean = _ensure_sku_ean13(mint_cur, int(r['sku_id']))
                base_code = ean or f"SKU-{r['sku_id']}"
            else:
                base_code = r.get("sku_barcode") or r.get("sku_code") or f"SKU-{r['sku_id']}"
            sku_label = r.get("sku_code") or ""
            title     = r.get("title") or ""
            price     = r.get("price")
        elif x.get("product_id") is not None and str(x.get("product_id")).isdigit():
            r = by_product.get(int(x["product_id"]))
            if not r: continue
            if encode_field == 'ean13':
                ean = r.get("product_barcode") or ''
                if not _normalize_ean13(ean):
                    ean = _ensure_product_ean13(mint_cur, int(r['product_id']))
                base_code = ean or f"P-{r['product_id']}"
            else:
                base_code = r.get("product_barcode") or r.get("product_sku") or f"P-{r['product_id']}"
            sku_label = r.get("product_sku") or ""
            title     = r.get("title") or ""
            price     = None
        elif x.get("batch_id") is not None and str(x.get("batch_id")).isdigit():
            r = by_batch.get(int(x["batch_id"]))
            if not r: continue
            # Encode the batch_name as the barcode value. Scanner → batch_name →
            # frontend looks up the inventory_batches row in O(1) on the project.
            base_code = r.get("batch_name") or f"BATCH-{r['batch_id']}"
            sku_label = r.get("sku_code") or ""
            title     = f"{r.get('title','')} · {r.get('variation_name','')} / {r.get('sku_name','')}"
            # Use the SKU's price (joined above) — batches inherit pricing from their SKU.
            price     = r.get("price")
        else:
            continue

        for _ in range(qty):
            serial_counter += 1
            encoded = str(base_code) + static_suffix
            if request.include_serial:
                # 0-padded to 4 digits so values sort lexically and look uniform.
                encoded += f"-{serial_counter:04d}"
            # EAN-13 mode: encoded value must be 12 or 13 digits — fall back to Code128 otherwise.
            if request.symbology == "ean13":
                normalized = _normalize_ean13(encoded.replace('-', ''))
                if normalized:
                    encoded = normalized
            flat.append({
                "code":  encoded,
                "sku":   sku_label,
                "title": title,
                "price": price,
                "serial": serial_counter if request.include_serial else None,
            })

    if not flat: raise HTTPException(400, "Nothing to print")

    # HTML structure: grid of label divs, each holding inline SVG (Code128/EAN-13 OR QR). window.print() dispatches the system printer dialog when the user explicitly asks.
    label_html_parts = []
    for lab in flat:
        if request.qr_mode:
            svg = _generate_qr_svg(lab["code"], symbology=request.symbology)
        else:
            svg = _generate_barcode_svg(lab["code"], symbology=request.symbology)
            # For EAN/UPC families, decorate the SVG with extended guard bars +
            # the canonical 3-group human-readable digits (e.g. "9 780201 379624"
            # for EAN-13). Done inside the SVG so it scales with CSS as one unit.
            if request.symbology in ("ean13", "ean8", "upca"):
                svg = _decorate_ean_svg(svg, lab["code"], request.symbology)
        # EAN/UPC bake digits directly into the SVG (via _decorate_ean_svg),
        # so no separate caption row is needed. Other 1D codes get the raw
        # encoded value shown below the bars.
        ean_family = request.symbology in ("ean13", "ean8", "upca")
        title  = f'<div class="lbl-title">{sanitize(lab["title"][:80])}</div>' if request.show_title  and lab["title"] else ""
        sku    = f'<div class="lbl-sku">{sanitize(lab["sku"])}</div>'           if request.show_sku    and lab["sku"]   else ""
        price  = f'<div class="lbl-price">${float(lab["price"]):.2f}</div>'     if request.show_price  and lab.get("price") is not None else ""
        bc_cap = f'<div class="lbl-code">{sanitize(lab["code"])}</div>'         if request.show_barcode and not request.qr_mode and not ean_family else ""
        bc_svg = f'<div class="lbl-svg{" lbl-svg--qr" if request.qr_mode else ""}">{svg}</div>' if request.show_barcode else ""
        label_html_parts.append(
            f'<div class="lbl">{title}{bc_svg}{bc_cap}{sku}{price}</div>'
        )

    label_html = "".join(label_html_parts)
    grid_cols = fmt.get("cols", 1)
    page_w = fmt["page_w_mm"]; page_h = fmt["page_h_mm"]
    lbl_w  = fmt["w_mm"];      lbl_h  = fmt["h_mm"]

    # SVG sizing — fill ~85% of the label width. Height is auto in CSS so the
    # barcode keeps its natural aspect ratio (otherwise EAN-13's guard bars
    # squish into uniform lines instead of extending below).
    svg_w = max(24, lbl_w - 8)
    svg_h = max(10, int(lbl_h * 0.45))   # max height when content is full

    auto_print_script = (
        "<script>window.addEventListener('load', () => "
        "{ setTimeout(() => { try { window.focus(); window.print(); } catch(e){} }, 200); });</script>"
        if request.auto_print else ""
    )

    # For thermal (1-col) formats every label gets its own page; for A4 sheet
    # formats the labels fill the grid and the page itself is the entire sheet.
    is_sheet = grid_cols > 1
    page_break_rule = ".lbl + .lbl { page-break-before: always; }" if not is_sheet else \
                      ".sheet + .sheet { page-break-before: always; }"

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Print barcodes</title>
<style>
  @page {{ size: {page_w}mm {page_h}mm; margin: 0; }}
  html, body {{ margin: 0; padding: 0; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }}
  .sheet {{ display: grid; grid-template-columns: repeat({grid_cols}, {lbl_w}mm); gap: 0; }}
  .lbl   {{ width: {lbl_w}mm; height: {lbl_h}mm; padding: 1mm; box-sizing: border-box;
            display: flex; flex-direction: column; align-items: center; justify-content: space-between;
            page-break-inside: avoid; overflow: hidden; gap: 0.3mm; }}
  .lbl-title {{ font-size: 6.5pt; font-weight: 600; text-align: center; line-height: 1.1;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
                flex-shrink: 0; }}
  /* SVG container fills available label space via flex. The SVG itself takes
     100%×100% — its embedded viewBox + preserveAspectRatio="xMidYMid meet"
     handles proportional scaling like `object-fit: contain` on an <img>. */
  .lbl-svg   {{ flex: 1 1 auto; min-height: 0; width: 100%;
                display: flex; justify-content: center; align-items: center; }}
  .lbl-svg svg {{ width: 100%; height: 100%; display: block; }}
  .lbl-svg--qr {{ flex: 0 0 auto; }}
  .lbl-svg--qr svg {{ width: {min(svg_w, svg_h)}mm; height: {min(svg_w, svg_h)}mm; }}
  .lbl-code  {{ font-family: 'Courier New', monospace; font-size: 6pt; letter-spacing: 0.3px;
                flex-shrink: 0; }}
  /* EAN human-readable digit row — wider letter-spacing to space out the
     "9 780201 379624" groups, slightly bigger so each digit is legible. */
  .lbl-code--ean {{ font-family: 'OCR-B', 'Courier New', monospace;
                    font-size: 7pt; letter-spacing: 1px; font-weight: 600; }}
  .lbl-sku   {{ font-size: 5.5pt; color: #555; flex-shrink: 0; }}
  .lbl-price {{ font-size: 8.5pt; font-weight: 700; flex-shrink: 0; }}
  @media print {{
    {page_break_rule}
    /* Hide any browser-added margin so the printer renders exactly the label. */
    html, body {{ width: {page_w}mm; height: {page_h}mm; }}
  }}
</style></head>
<body><div class="sheet">{label_html}</div>{auto_print_script}</body></html>"""

    return Response(content=html, media_type="text/html")


# ── CSV IMPORT / EXPORT ──────────────────────────────────

@app.get("/api/projects/{project_id}/products/export.csv")
def export_products_csv(project_id: int, ids: Optional[str] = Query(None),
                        user: dict = Depends(get_current_user)):
    """Streams a CSV with one row per Layer 2 SKU (project's full catalog or filtered by ?ids=). Used by the CRM Products page Export button."""
    require_team_member_or_owner(user, project_id)
    import csv as _csv
    from io import StringIO

    where_extra = ""
    params = [project_id]
    if ids:
        try:
            id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()][:1000]
        except ValueError:
            raise HTTPException(400, "Invalid ids")
        if not id_list: raise HTTPException(400, "No valid ids")
        where_extra = " AND p.id = ANY(%s)"
        params.append(id_list)

    rows = db_all(
        "SELECT p.id AS product_id, p.title, p.subtitle, p.description,"
        "       p.product_type, p.sku AS product_sku, p.barcode AS product_barcode,"
        "       p.brand, p.manufacturer, p.country_of_origin,"
        "       pc.name AS category, p.is_paused, p.is_archived,"
        "       l1.variation_name, l2.configuration_name, l2.sku_code, l2.barcode,"
        "       l2.price, l2.stock_quantity, l2.cost_price, l2.compare_at_price,"
        "       l2.weight_g, l2.length_cm, l2.width_cm, l2.height_cm"
        "  FROM products p"
        "  LEFT JOIN product_categories pc        ON p.category_id = pc.id"
        "  LEFT JOIN product_configurations_l1 l1 ON l1.product_id = p.id"
        "  LEFT JOIN product_configurations_l2 l2 ON l2.variation_id = l1.id"
        " WHERE p.project_id = %s" + where_extra +
        " ORDER BY p.id, l1.position, l2.position",
        tuple(params)
    )

    buf = StringIO()
    w = _csv.writer(buf, dialect="excel")
    w.writerow([
        "product_id", "title", "subtitle", "description", "product_type", "product_sku", "product_barcode",
        "brand", "manufacturer", "country_of_origin", "category", "is_paused", "is_archived",
        "variation_name", "configuration_name", "sku_code", "sku_barcode", "price", "stock_quantity",
        "cost_price", "compare_at_price", "weight_g", "length_cm", "width_cm", "height_cm",
    ])
    for r in rows:
        w.writerow([
            r["product_id"], r.get("title", ""), r.get("subtitle") or "", r.get("description") or "",
            r.get("product_type") or "physical", r.get("product_sku") or "", r.get("product_barcode") or "",
            r.get("brand") or "", r.get("manufacturer") or "", r.get("country_of_origin") or "",
            r.get("category") or "",
            "yes" if r.get("is_paused") else "", "yes" if r.get("is_archived") else "",
            r.get("variation_name") or "", r.get("configuration_name") or "",
            r.get("sku_code") or "", r.get("barcode") or "",
            r["price"] if r.get("price") is not None else "",
            r["stock_quantity"] if r.get("stock_quantity") is not None else "",
            r["cost_price"] if r.get("cost_price") is not None else "",
            r["compare_at_price"] if r.get("compare_at_price") is not None else "",
            r["weight_g"] if r.get("weight_g") is not None else "",
            r["length_cm"] if r.get("length_cm") is not None else "",
            r["width_cm"] if r.get("width_cm") is not None else "",
            r["height_cm"] if r.get("height_cm") is not None else "",
        ])
    data = buf.getvalue().encode("utf-8-sig")   # BOM so Excel opens UTF-8 correctly
    return Response(
        content=data, media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="products_{project_id}.csv"'}
    )


class CsvImportRow(BaseModel):
    title:               Optional[str] = None
    subtitle:            Optional[str] = None
    description:         Optional[str] = None
    product_type:        Optional[str] = None
    category:            Optional[str] = None
    variation_name:      Optional[str] = None
    configuration_name:  Optional[str] = None
    sku_code:            Optional[str] = None
    sku_barcode:         Optional[str] = None
    price:               Optional[float] = None
    stock_quantity:      Optional[int]   = None


class CsvImportRequest(BaseModel):
    rows:    List[CsvImportRow]
    dry_run: bool = False


@app.post("/api/projects/{project_id}/products/import")
def import_products_csv(project_id: int, request: CsvImportRequest,
                        user: dict = Depends(get_current_user)):
    """Parses validated CsvImportRow batch and upserts products + L1/L2 + categories. dry_run=true returns counters without writing."""
    require_team_member_or_owner(user, project_id)
    if not request.rows: return {"ok": True, "created": 0, "updated": 0}
    if len(request.rows) > 5000:
        raise HTTPException(400, "Too many rows (max 5000 per import)")

    counters = {"products_created": 0, "products_matched": 0, "skus_created": 0, "skus_updated": 0, "errors": []}
    if request.dry_run:
        # Light scan: title required, dedupe by title.
        seen = set()
        for i, row in enumerate(request.rows):
            t = (row.title or "").strip()
            if not t:
                counters["errors"].append({"row": i + 1, "error": "title required"})
                continue
            if t in seen:
                counters["skus_created"] += 1
            else:
                seen.add(t); counters["products_created"] += 1; counters["skus_created"] += 1
        counters["ok"] = True
        return counters

    with db_cursor() as (conn, cur):
        # Cache title→product_id within this batch so multiple SKU rows merge into one product.
        title_to_pid = {}
        cat_cache = {}

        for i, row in enumerate(request.rows):
            try:
                title = sanitize((row.title or "").strip())[:200]
                if not title:
                    counters["errors"].append({"row": i + 1, "error": "title required"}); continue

                ptype = (row.product_type or "physical").strip()
                if ptype not in ("physical", "digital", "service", "event"):
                    ptype = "physical"

                # Resolve category by name (case-insensitive); auto-create if missing.
                cat_id = None
                cname = (row.category or "").strip()
                if cname:
                    if cname.lower() in cat_cache:
                        cat_id = cat_cache[cname.lower()]
                    else:
                        cur.execute("SELECT id FROM product_categories WHERE project_id=%s AND LOWER(name)=LOWER(%s)",
                                    (project_id, cname))
                        c = cur.fetchone()
                        if c: cat_id = c["id"]
                        else:
                            slug = re.sub(r"[^a-z0-9]+", "-", cname.lower()).strip("-")[:80] or f"cat-{secrets.token_hex(3)}"
                            cur.execute(
                                "INSERT INTO product_categories (project_id, name, slug)"
                                " VALUES (%s, %s, %s) RETURNING id",
                                (project_id, sanitize(cname)[:100], slug)
                            )
                            cat_id = cur.fetchone()["id"]
                        cat_cache[cname.lower()] = cat_id

                # Upsert product (matched by title within this project, within this import).
                if title in title_to_pid:
                    pid = title_to_pid[title]
                    counters["products_matched"] += 1
                else:
                    cur.execute("SELECT id FROM products WHERE project_id=%s AND title=%s LIMIT 1",
                                (project_id, title))
                    existing = cur.fetchone()
                    if existing:
                        pid = existing["id"]; counters["products_matched"] += 1
                    else:
                        cur.execute(
                            "INSERT INTO products (project_id, title, subtitle, description, category_id, product_type, sku)"
                            " VALUES (%s, %s, %s, %s, %s, %s, '') RETURNING id",
                            (project_id, title,
                             sanitize((row.subtitle or "").strip())[:300],
                             sanitize((row.description or "").strip())[:5000],
                             cat_id, ptype)
                        )
                        pid = cur.fetchone()["id"]
                        mode, length = _resolve_sku_settings(project_id)
                        gen = _gen_unique_product_sku(cur, project_id, mode, length)
                        if gen: cur.execute("UPDATE products SET sku=%s WHERE id=%s", (gen, pid))
                        # Auto-mint EAN-13 so the imported product is scannable immediately.
                        _ensure_product_ean13(cur, pid)
                        counters["products_created"] += 1
                    title_to_pid[title] = pid

                # Variation (Layer 1) row — required: at minimum, use "Default" if missing.
                # Match case-insensitively so reimporting "Red" / "red" / "RED"
                # doesn't silently create duplicate variations.
                vname = sanitize((row.variation_name or "Default").strip())[:120]
                cur.execute("SELECT id FROM product_configurations_l1"
                            " WHERE product_id=%s AND LOWER(variation_name)=LOWER(%s) LIMIT 1",
                            (pid, vname))
                lv = cur.fetchone()
                if lv: vid = lv["id"]
                else:
                    cur.execute(
                        "INSERT INTO product_configurations_l1 (product_id, variation_name, images, price, stock_quantity, sold_quantity, position)"
                        " VALUES (%s, %s, '{}', NULL, 0, 0, 0) RETURNING id",
                        (pid, vname)
                    )
                    vid = cur.fetchone()["id"]

                # SKU (Layer 2) row — upsert by configuration_name (case-insensitive too).
                cname2 = sanitize((row.configuration_name or "Default").strip())[:120]
                price = row.price if row.price is not None and row.price >= 0 else None
                stock = max(0, int(row.stock_quantity)) if row.stock_quantity is not None else 0
                sku_code = sanitize((row.sku_code or "").strip())[:80]
                sku_bar  = sanitize((row.sku_barcode or "").strip())[:80]

                # Invalid EAN-13 input → drop it so the auto-mint kicks in below.
                # A malformed user-supplied barcode shouldn't poison the SKU.
                if sku_bar and not _normalize_ean13(sku_bar):
                    sku_bar = ''
                # SKU-code collision check — another product's L2 already owns this code
                # in the same project. Drop the imported value to avoid the unique-index
                # crash (`uq_l2_project_sku_code`); let auto-gen mint a fresh one.
                if sku_code:
                    cur.execute(
                        "SELECT 1 FROM product_configurations_l2 c"
                        "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
                        "  JOIN products p ON v.product_id = p.id"
                        " WHERE p.project_id=%s AND c.sku_code=%s AND c.variation_id <> %s LIMIT 1",
                        (project_id, sku_code, vid)
                    )
                    if cur.fetchone():
                        sku_code = ''

                cur.execute("SELECT id FROM product_configurations_l2"
                            " WHERE variation_id=%s AND LOWER(configuration_name)=LOWER(%s) LIMIT 1",
                            (vid, cname2))
                lc = cur.fetchone()
                if lc:
                    cur.execute(
                        "SET LOCAL torta.skip_audit = 'on';"
                        "UPDATE product_configurations_l2"
                        "   SET price=COALESCE(%s, price), stock_quantity=%s, sku_code=COALESCE(NULLIF(%s,''), sku_code),"
                        "       barcode=COALESCE(NULLIF(%s,''), barcode)"
                        " WHERE id=%s",
                        (price, stock, sku_code, sku_bar, lc["id"])
                    )
                    counters["skus_updated"] += 1
                else:
                    cur.execute(
                        "INSERT INTO product_configurations_l2"
                        "  (product_id, variation_id, configuration_name, price, stock_quantity, sku_code, barcode, sold_quantity, position)"
                        " VALUES (%s, %s, %s, %s, %s, %s, %s, 0, 0) RETURNING id",
                        (pid, vid, cname2, price, stock, sku_code, sku_bar)
                    )
                    new_sku_id = cur.fetchone()["id"]
                    # Auto-mint EAN-13 only if the CSV didn't supply one — caller's
                    # explicit barcode wins (might be a real GS1-registered code).
                    _ensure_sku_ean13(cur, new_sku_id)
                    counters["skus_created"] += 1
            except Exception as e:
                counters["errors"].append({"row": i + 1, "error": str(e)[:200]})
        conn.commit()

    counters["ok"] = True
    return counters


# ── VARIATIONS ───────────────────────────────────────────

@app.post("/api/products/{product_id}/variations")
def create_variation(product_id: int, request: CreateVariationRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    name = (request.variation_name or '').strip()
    images = list(request.images or [])
    with db_cursor() as (conn, cur):
        # Append at the end of the existing order — next position is max+1.
        cur.execute("SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM product_configurations_l1 WHERE product_id=%s", (product_id,))
        next_pos = cur.fetchone()["next_pos"]
        cur.execute("INSERT INTO product_configurations_l1 (product_id,variation_name,images,position) VALUES(%s,%s,%s,%s) RETURNING id",
                    (product_id, sanitize(name), images, next_pos))
        new_id = cur.fetchone()["id"]
        conn.commit()
        return {"id": new_id, "variation_name": name, "images": images,
                "position": next_pos, "configurations": []}


@app.put("/api/products/{product_id}/variations/reorder")
def reorder_variations(
    product_id: int,
    req: ReorderVariationsRequest,
    project_id: int = Query(...),
    user: dict = Depends(get_current_user),
):
    """Apply new order to all variations (id index → position); supplied set must match exactly."""
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    pids = list(req.variation_ids or [])
    with db_cursor() as (conn, cur):
        cur.execute("SELECT id FROM product_configurations_l1 WHERE product_id=%s", (product_id,))
        existing = {r["id"] for r in cur.fetchall()}
        if set(pids) != existing:
            raise HTTPException(400, "variation_ids must contain exactly the variations of this product")
        for idx, vid in enumerate(pids):
            cur.execute("UPDATE product_configurations_l1 SET position=%s WHERE id=%s AND product_id=%s",
                        (idx, vid, product_id))
        conn.commit()
    return {"ok": True}


@app.put("/api/products/{product_id}/layers/{layer}/reorder")
def reorder_layer_items(
    product_id: int, layer: int,
    req: ReorderIdsRequest,
    project_id: int = Query(...),
    user: dict = Depends(get_current_user),
):
    """Reorder rows under a parent at layer 2-5; id set must match existing rows (idor-safe)."""
    if layer < 2 or layer > 5:
        raise HTTPException(400, "Layer must be 2-5 (use /variations/reorder for layer 1)")
    if req.parent_id is None:
        raise HTTPException(400, "parent_id required")
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    _verify_layer_item_belongs_to_product(layer - 1, req.parent_id, product_id)
    tbl = _layer_table(layer)
    parent_col = _layer_parent_col(layer)
    ids = list(req.ids or [])
    with db_cursor() as (conn, cur):
        cur.execute(f"SELECT id FROM {tbl} WHERE {parent_col}=%s", (req.parent_id,))
        existing = {r["id"] for r in cur.fetchall()}
        if set(ids) != existing:
            raise HTTPException(400, "ids must contain exactly the rows under this parent")
        for idx, rid in enumerate(ids):
            cur.execute(f"UPDATE {tbl} SET position=%s WHERE id=%s AND {parent_col}=%s",
                        (idx, rid, req.parent_id))
        conn.commit()
    return {"ok": True}


@app.put("/api/products/{product_id}/specifications/reorder")
def reorder_specifications(
    product_id: int,
    req: ReorderIdsRequest,
    project_id: int = Query(...),
    user: dict = Depends(get_current_user),
):
    """Reorder specifications attached to a single (layer, parent_id) node."""
    if req.layer is None or req.parent_id is None:
        raise HTTPException(400, "layer and parent_id required")
    require_team_member_or_owner(user, project_id)
    owner_pid = _product_id_for(req.layer, req.parent_id)
    if owner_pid != product_id:
        raise HTTPException(404, "Parent not found")
    ids = list(req.ids or [])
    with db_cursor() as (conn, cur):
        cur.execute("SELECT id FROM product_specifications WHERE layer=%s AND parent_id=%s",
                    (req.layer, req.parent_id))
        existing = {r["id"] for r in cur.fetchall()}
        if set(ids) != existing:
            raise HTTPException(400, "ids must contain exactly the specs under this node")
        for idx, sid in enumerate(ids):
            cur.execute(
                "UPDATE product_specifications SET position=%s WHERE id=%s AND layer=%s AND parent_id=%s",
                (idx, sid, req.layer, req.parent_id)
            )
        conn.commit()
    return {"ok": True}


@app.put("/api/products/{product_id}/custom-fields/reorder")
def reorder_custom_fields(
    product_id: int,
    req: ReorderIdsRequest,
    project_id: int = Query(...),
    user: dict = Depends(get_current_user),
):
    """Reorder custom fields by field_keys (CF rows are identified by key, not id)."""
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    keys = list(req.field_keys or [])
    with db_cursor() as (conn, cur):
        cur.execute("SELECT field_key FROM product_custom_fields WHERE product_id=%s AND project_id=%s",
                    (product_id, project_id))
        existing = {r["field_key"] for r in cur.fetchall()}
        # Allow partial reorders (placeholders aren't owned by this product, so
        # they can't be reordered server-side; we only persist real-row order).
        unknown = [k for k in keys if k not in existing]
        if unknown:
            raise HTTPException(400, f"Unknown field_keys for this product: {unknown}")
        for idx, k in enumerate(keys):
            cur.execute(
                "UPDATE product_custom_fields SET position=%s WHERE product_id=%s AND project_id=%s AND field_key=%s",
                (idx, product_id, project_id, k)
            )
        conn.commit()
    return {"ok": True}


@app.put("/api/products/{product_id}/variations/{var_id}")
def update_variation(product_id: int, var_id: int, request: UpdateVariationRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    cur_row = db_one("SELECT images FROM product_configurations_l1 WHERE id=%s AND product_id=%s", (var_id, product_id))
    if not cur_row:
        raise HTTPException(404, "Variation not found")
    fields, vals = [], []
    if request.variation_name is not None: fields.append("variation_name=%s"); vals.append(request.variation_name.strip())
    if request.images         is not None: fields.append("images=%s");         vals.append(list(request.images))
    if not fields: return {"ok": True}
    vals.append(var_id)
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE product_configurations_l1 SET " + ", ".join(fields) + " WHERE id=%s", vals)
        conn.commit()
    # If images were replaced, S3-clean any URL that's gone from the new array.
    if request.images is not None:
        old_set = set(cur_row.get("images") or [])
        new_set = set(request.images or [])
        for url in (old_set - new_set):
            if url: s3_delete_url(url, f"projects/{project_id}/products/")
    return {"ok": True}


@app.delete("/api/products/{product_id}/variations/{var_id}")
def delete_variation(product_id: int, var_id: int, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    old = db_one("SELECT images FROM product_configurations_l1 WHERE id=%s AND product_id=%s", (var_id, product_id))
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM product_configurations_l2 WHERE variation_id=%s", (var_id,))
        cur.execute("DELETE FROM product_configurations_l1 WHERE id=%s AND product_id=%s", (var_id, product_id))
        conn.commit()
    for url in (old.get("images") if old else None) or []:
        if url: s3_delete_url(url, f"projects/{project_id}/products/")
    return {"ok": True}


# ── CONFIGURATIONS (priced options of a variation: sizes / portions / capacity / etc.) ──

@app.post("/api/products/{product_id}/variations/{var_id}/configurations")
def create_configuration(product_id: int, var_id: int, request: CreateConfigurationRequest,
                         project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    if not db_one("SELECT id FROM product_configurations_l1 WHERE id=%s AND product_id=%s", (var_id, product_id)):
        raise HTTPException(404, "Variation not found")
    name = request.configuration_name.strip()
    if not name: raise HTTPException(400, "Configuration name is required")
    with db_cursor() as (conn, cur):
        cur.execute(
            "INSERT INTO product_configurations_l2 (product_id,variation_id,configuration_name,price,stock_quantity) "
            "VALUES(%s,%s,%s,%s,%s) RETURNING id",
            (product_id, var_id, name, request.price, request.stock_quantity)
        )
        new_id = cur.fetchone()["id"]
        # Auto-mint an internal EAN-13 (prefix 201) so this SKU is scannable
        # from creation. Existing barcode on the row (if any) is preserved.
        sku_ean13 = _ensure_sku_ean13(cur, new_id)
        conn.commit()
        return {"id": new_id, "variation_id": var_id, "configuration_name": name,
                "price": request.price, "stock_quantity": request.stock_quantity, "sold_quantity": 0,
                "barcode": sku_ean13}


@app.put("/api/products/{product_id}/variations/{var_id}/configurations/{cfg_id}")
def update_configuration(product_id: int, var_id: int, cfg_id: int, request: UpdateConfigurationRequest,
                         project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    fields = []; vals = []
    if request.configuration_name is not None: fields.append("configuration_name=%s"); vals.append(request.configuration_name.strip())
    if request.price              is not None: fields.append("price=%s");              vals.append(request.price)
    if request.stock_quantity     is not None: fields.append("stock_quantity=%s");     vals.append(request.stock_quantity)
    if not fields: return {"ok": True}
    vals.extend([cfg_id, var_id])
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE product_configurations_l2 SET " + ", ".join(fields) +
                    " WHERE id=%s AND variation_id=%s", vals)
        conn.commit()
    return {"ok": True}


@app.delete("/api/products/{product_id}/variations/{var_id}/configurations/{cfg_id}")
def delete_configuration(product_id: int, var_id: int, cfg_id: int,
                         project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM product_configurations_l2 WHERE id=%s AND variation_id=%s", (cfg_id, var_id))
        conn.commit()
    return {"ok": True}


# ── SPECIFICATIONS (per variation, key/value pairs) ──────

def _ensure_var_in_product(product_id: int, var_id: int, project_id: int):
    """Reused guard: variation must belong to product, product to project."""
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    if not db_one("SELECT id FROM product_configurations_l1 WHERE id=%s AND product_id=%s", (var_id, product_id)):
        raise HTTPException(404, "Variation not found")


@app.post("/api/products/{product_id}/variations/{var_id}/specifications")
def create_specification(product_id: int, var_id: int, request: CreateSpecificationRequest,
                          project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    _ensure_var_in_product(product_id, var_id, project_id)
    key = sanitize((request.spec_key or '').strip())
    value = sanitize((request.spec_value or '').strip())
    with db_cursor() as (conn, cur):
        cur.execute("SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM product_specifications WHERE variation_id=%s",
                    (var_id,))
        next_pos = cur.fetchone()["next_pos"]
        cur.execute("INSERT INTO product_specifications (variation_id, spec_key, spec_value, position) "
                    "VALUES(%s,%s,%s,%s) RETURNING id",
                    (var_id, key, value, next_pos))
        new_id = cur.fetchone()["id"]
        conn.commit()
        return {"id": new_id, "variation_id": var_id, "spec_key": key, "spec_value": value, "position": next_pos}


@app.put("/api/products/{product_id}/variations/{var_id}/specifications/{spec_id}")
def update_specification(product_id: int, var_id: int, spec_id: int, request: UpdateSpecificationRequest,
                          project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    _ensure_var_in_product(product_id, var_id, project_id)
    fields = []; vals = []
    if request.spec_key is not None:
        fields.append("spec_key=%s"); vals.append(sanitize(request.spec_key.strip()))
    if request.spec_value is not None:
        fields.append("spec_value=%s"); vals.append(sanitize(request.spec_value.strip()))
    if not fields: return {"ok": True}
    vals.extend([spec_id, var_id])
    with db_cursor() as (conn, cur):
        cur.execute(f"UPDATE product_specifications SET {', '.join(fields)} WHERE id=%s AND variation_id=%s", vals)
        conn.commit()
    return {"ok": True}


@app.delete("/api/products/{product_id}/variations/{var_id}/specifications/{spec_id}")
def delete_specification(product_id: int, var_id: int, spec_id: int,
                          project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    _ensure_var_in_product(product_id, var_id, project_id)
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM product_specifications WHERE id=%s AND variation_id=%s", (spec_id, var_id))
        conn.commit()
    return {"ok": True}


@app.post("/api/products/{product_id}/variations/{var_id}/specifications/copy-to-all")
def copy_specifications_to_all(product_id: int, var_id: int,
                                project_id: int = Query(...), user: dict = Depends(get_current_user)):
    """Replace specifications on every other variation of this product with the
    current variation's specifications. Atomic per-variation: existing specs
    are deleted before re-inserting copies."""
    require_team_member_or_owner(user, project_id)
    _ensure_var_in_product(product_id, var_id, project_id)
    with db_cursor() as (conn, cur):
        cur.execute("SELECT spec_key, spec_value, position FROM product_specifications "
                    "WHERE variation_id=%s ORDER BY position ASC, id ASC", (var_id,))
        source_specs = cur.fetchall()
        cur.execute("SELECT id FROM product_configurations_l1 WHERE product_id=%s AND id != %s",
                    (product_id, var_id))
        target_ids = [r["id"] for r in cur.fetchall()]
        for tid in target_ids:
            cur.execute("DELETE FROM product_specifications WHERE variation_id=%s", (tid,))
            for s in source_specs:
                cur.execute("INSERT INTO product_specifications (variation_id, spec_key, spec_value, position) "
                            "VALUES(%s,%s,%s,%s)",
                            (tid, s["spec_key"], s["spec_value"], s["position"]))
        conn.commit()
    return {"ok": True, "copied_to": len(target_ids)}


# ── SPECIFICATIONS — generic (any layer 1-5): endpoints accept layer+parent_id; legacy variation endpoints above remain for layer-1 BC ──

@app.post("/api/products/{product_id}/specifications")
def create_specification_generic(product_id: int, request: CreateSpecificationRequest,
                                  project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    layer = request.layer or 1
    parent_id = request.parent_id
    if parent_id is None:
        raise HTTPException(400, "parent_id required")
    owner_pid = _product_id_for(layer, parent_id)
    if owner_pid != product_id:
        raise HTTPException(404, "Parent not found")
    key = sanitize((request.spec_key or '').strip())
    value = sanitize((request.spec_value or '').strip())
    with db_cursor() as (conn, cur):
        cur.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS next_pos"
            " FROM product_specifications WHERE layer=%s AND parent_id=%s",
            (layer, parent_id)
        )
        next_pos = cur.fetchone()["next_pos"]
        # Set variation_id only when layer=1 (backwards compat with legacy code paths)
        var_id = parent_id if layer == 1 else None
        cur.execute(
            "INSERT INTO product_specifications (variation_id, layer, parent_id, spec_key, spec_value, position)"
            " VALUES(%s, %s, %s, %s, %s, %s) RETURNING id",
            (var_id, layer, parent_id, key, value, next_pos)
        )
        new_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": new_id, "layer": layer, "parent_id": parent_id,
            "spec_key": key, "spec_value": value, "position": next_pos}


@app.put("/api/products/{product_id}/specifications/{spec_id}")
def update_specification_generic(product_id: int, spec_id: int, request: UpdateSpecificationRequest,
                                  project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    spec = db_one("SELECT layer, parent_id FROM product_specifications WHERE id=%s", (spec_id,))
    if not spec: raise HTTPException(404, "Spec not found")
    owner_pid = _product_id_for(spec["layer"] or 1, spec["parent_id"])
    if owner_pid != product_id:
        raise HTTPException(404, "Spec not found")
    fields, vals = [], []
    if request.spec_key is not None:
        fields.append("spec_key=%s"); vals.append(sanitize(request.spec_key.strip()))
    if request.spec_value is not None:
        fields.append("spec_value=%s"); vals.append(sanitize(request.spec_value.strip()))
    if not fields: return {"ok": True}
    vals.append(spec_id)
    with db_cursor() as (conn, cur):
        cur.execute(f"UPDATE product_specifications SET {', '.join(fields)} WHERE id=%s", vals)
        conn.commit()
    return {"ok": True}


@app.delete("/api/products/{product_id}/specifications/{spec_id}")
def delete_specification_generic(product_id: int, spec_id: int,
                                  project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    spec = db_one("SELECT layer, parent_id FROM product_specifications WHERE id=%s", (spec_id,))
    if not spec: return {"ok": True}
    owner_pid = _product_id_for(spec["layer"] or 1, spec["parent_id"])
    if owner_pid != product_id:
        raise HTTPException(404, "Spec not found")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM product_specifications WHERE id=%s", (spec_id,))
        conn.commit()
    return {"ok": True}


# ── MULTI-LAYER CONFIGURATIONS (l1 with images[]; l2..l5 each parent = previous layer) ──

def _restore_layer_subtree(cur, *, product_id: int, layer: int, parent_id: Optional[int], node: dict) -> Optional[int]:
    """Recursively recreate a layer node + specs + children for Undo; preserves snapshot position."""
    if not node: return None
    tbl       = _layer_table(layer)
    parent_col = _layer_parent_col(layer)
    name_col  = _layer_name_col(layer)
    name = sanitize((node.get("name") or node.get("variation_name") or node.get("configuration_name") or "").strip())
    price = node.get("price")
    stock = node.get("stock_quantity") or 0
    sold  = node.get("sold_quantity") or 0
    images = list(node.get("images") or [])    # full per-variation gallery (L1 only)

    # Use snapshot position if provided; else append at end.
    if node.get("position") is not None:
        pos = int(node["position"])
    else:
        if layer == 1:
            cur.execute(f"SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM {tbl} WHERE product_id=%s", (product_id,))
        else:
            cur.execute(f"SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM {tbl} WHERE {parent_col}=%s", (parent_id,))
        pos = cur.fetchone()["next_pos"]

    if layer == 1:
        cur.execute(
            f"INSERT INTO {tbl} (product_id, {name_col}, images, price, stock_quantity, sold_quantity, position)"
            f" VALUES(%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (product_id, name, images, price, stock, sold, pos)
        )
    elif layer == 2:
        cur.execute(
            f"INSERT INTO {tbl} (product_id, {parent_col}, {name_col}, price, stock_quantity, sold_quantity, position)"
            f" VALUES(%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (product_id, parent_id, name, price, stock, sold, pos)
        )
    else:
        cur.execute(
            f"INSERT INTO {tbl} ({parent_col}, {name_col}, price, stock_quantity, sold_quantity, position)"
            f" VALUES(%s, %s, %s, %s, %s, %s) RETURNING id",
            (parent_id, name, price, stock, sold, pos)
        )
    new_id = cur.fetchone()["id"]

    # Restore specs attached to this node — preserve their original position too.
    for spec in (node.get("specifications") or []):
        sk = sanitize((spec.get("spec_key") or "").strip())
        sv = sanitize(spec.get("spec_value") or "")
        if not sk: continue
        var_id_for_spec = new_id if layer == 1 else None
        cur.execute(
            "INSERT INTO product_specifications (variation_id, layer, parent_id, spec_key, spec_value, position)"
            " VALUES(%s, %s, %s, %s, %s, %s)",
            (var_id_for_spec, layer, new_id, sk, sv, spec.get("position") or 0)
        )

    # Recurse children. Snapshot may use 'configurations' (l1→l2) or 'children' (l2+→deeper) — accept either.
    if layer < 5:
        kids = node.get("children") or node.get("configurations") or []
        for child in kids:
            _restore_layer_subtree(cur, product_id=product_id, layer=layer + 1, parent_id=new_id, node=child)
    return new_id


def _layer_table(n: int) -> str:
    if 1 <= n <= 5: return f"product_configurations_l{n}"
    raise HTTPException(400, "Invalid layer (must be 1-5)")

def _layer_parent_col(n: int) -> str:
    if n == 1: return "product_id"
    if n == 2: return "variation_id"
    return "parent_id"

def _layer_name_col(n: int) -> str:
    if n == 1: return "variation_name"
    if n == 2: return "configuration_name"
    return "name"

def _product_id_for(n: int, item_id: int) -> Optional[int]:
    """Walk up the chain to find the owning product_id."""
    cur_n, cur_id = n, item_id
    while cur_n >= 2:
        row = db_one(f"SELECT {_layer_parent_col(cur_n)} AS p FROM {_layer_table(cur_n)} WHERE id=%s", (cur_id,))
        if not row: return None
        cur_id = row["p"]
        cur_n -= 1
    row = db_one("SELECT product_id FROM product_configurations_l1 WHERE id=%s", (cur_id,))
    return row["product_id"] if row else None

def _annotate_effective_price(items: list, parent_eff: Optional[float]):
    """Annotate effective_price = own price if set, else parent_eff (mutates items in place)."""
    for it in items:
        own = it.get("price")
        eff = float(own) if own is not None else parent_eff
        it["effective_price"] = eff
        if it.get("price") is not None:
            it["price"] = float(it["price"])
        for child_key in ("configurations", "children"):
            if it.get(child_key):
                _annotate_effective_price(it[child_key], eff)


def _load_product_tree(product_id: int) -> tuple[list, int]:
    """Load all layers for a product as a nested tree. Returns (variations, max_layer)."""
    variations = db_all(
        "SELECT id, variation_name, images, position, price, stock_quantity, sold_quantity,"
        " sale_type, sale_value, sale_starts_at, sale_ends_at"
        " FROM product_configurations_l1 WHERE product_id=%s ORDER BY position ASC, id ASC",
        (product_id,)
    )
    if not variations:
        return [], 1
    for v in variations:
        if v.get("sale_value") is not None:
            v["sale_value"] = float(v["sale_value"])
        for tk in ("sale_starts_at", "sale_ends_at"):
            if v.get(tk) is not None:
                v[tk] = v[tk].isoformat()

    max_layer = 1
    var_ids = [v["id"] for v in variations]

    def _fetch_layer(n: int, parent_ids: list[int]) -> dict:
        """Fetch layer N rows for parent_ids → dict {parent_id: rows}; L2 includes physical attrs."""
        if not parent_ids: return {}
        fmt = ",".join(["%s"] * len(parent_ids))
        name_col = _layer_name_col(n)
        parent_col = _layer_parent_col(n)
        extra = ""
        if n == 2:
            extra = (", sku_code, barcode, compare_at_price, cost_price,"
                     " weight_g, length_cm, width_cm, height_cm,"
                     " sale_price, sale_starts_at, sale_ends_at,"
                     " sale_type, sale_value")
        rows = db_all(
            f"SELECT id, {parent_col} AS parent_id, {name_col} AS name,"
            f" price, stock_quantity, sold_quantity, position{extra}"
            f" FROM {_layer_table(n)} WHERE {parent_col} IN ({fmt}) ORDER BY position ASC, id ASC",
            tuple(parent_ids)
        )
        by_parent = {}
        for r in rows:
            # Cast NUMERIC → float for JSON serialisation.
            for nk in ('compare_at_price', 'cost_price', 'weight_g',
                        'length_cm', 'width_cm', 'height_cm',
                        'sale_price', 'sale_value'):
                if nk in r and r[nk] is not None:
                    r[nk] = float(r[nk])
            for tk in ('sale_starts_at', 'sale_ends_at'):
                if tk in r and r[tk] is not None:
                    r[tk] = r[tk].isoformat()
            by_parent.setdefault(r["parent_id"], []).append(r)
        return by_parent

    # Layer 2
    l2_by = _fetch_layer(2, var_ids)
    l2_all = [r for rows in l2_by.values() for r in rows]
    if l2_all: max_layer = 2

    # Layer 3
    l2_ids = [r["id"] for r in l2_all]
    l3_by = _fetch_layer(3, l2_ids)
    l3_all = [r for rows in l3_by.values() for r in rows]
    if l3_all: max_layer = 3

    # Layer 4
    l3_ids = [r["id"] for r in l3_all]
    l4_by = _fetch_layer(4, l3_ids)
    l4_all = [r for rows in l4_by.values() for r in rows]
    if l4_all: max_layer = 4

    # Layer 5
    l4_ids = [r["id"] for r in l4_all]
    l5_by = _fetch_layer(5, l4_ids)
    l5_all = [r for rows in l5_by.values() for r in rows]
    if l5_all: max_layer = 5

    # Wire up tree (bottom-up)
    for r in l4_all:
        r["children"] = l5_by.get(r["id"], [])
    for r in l3_all:
        r["children"] = l4_by.get(r["id"], [])
    for r in l2_all:
        r["children"] = l3_by.get(r["id"], [])
    for v in variations:
        # Backwards compat: keep "configurations" name for Layer 2 list
        v["configurations"] = l2_by.get(v["id"], [])

    # Effective price walk from each variation downward
    _annotate_effective_price(variations, None)

    return variations, max_layer


# ─── Layer item CRUD (parametrized) ────────────────────────────────

def _verify_layer_item_belongs_to_product(layer: int, item_id: int, product_id: int):
    owner_pid = _product_id_for(layer, item_id)
    if owner_pid != product_id:
        raise HTTPException(404, "Item not found")


@app.get("/api/products/{product_id}/layers/{layer}")
def list_layer_items(product_id: int, layer: int, parent_id: Optional[int] = Query(None),
                     project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    tbl = _layer_table(layer)
    parent_col = _layer_parent_col(layer)
    name_col = _layer_name_col(layer)
    if layer == 1:
        rows = db_all(f"SELECT id, {name_col} AS name, images, price, stock_quantity, sold_quantity, position"
                      f" FROM {tbl} WHERE product_id=%s ORDER BY position ASC, id ASC", (product_id,))
    else:
        if parent_id is None:
            raise HTTPException(400, "parent_id query param required for layer >= 2")
        _verify_layer_item_belongs_to_product(layer - 1, parent_id, product_id)
        rows = db_all(f"SELECT id, {name_col} AS name, price, stock_quantity, sold_quantity, position"
                      f" FROM {tbl} WHERE {parent_col}=%s ORDER BY position ASC, id ASC", (parent_id,))
    for r in rows:
        if r.get("price") is not None:
            r["price"] = float(r["price"])
    return rows


@app.post("/api/products/{product_id}/layers/{layer}")
def create_layer_item(product_id: int, layer: int, request: CreateLayerItemRequest,
                       project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    tbl = _layer_table(layer)
    parent_col = _layer_parent_col(layer)
    name_col = _layer_name_col(layer)
    name = sanitize((request.name or '').strip())

    if layer == 1:
        scope_id = product_id
    else:
        if request.parent_id is None:
            raise HTTPException(400, "parent_id required for layer >= 2")
        _verify_layer_item_belongs_to_product(layer - 1, request.parent_id, product_id)
        scope_id = request.parent_id

    with db_cursor() as (conn, cur):
        cur.execute(f"SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM {tbl} WHERE {parent_col}=%s", (scope_id,))
        next_pos = cur.fetchone()["next_pos"]
        if layer == 1:
            cur.execute(
                f"INSERT INTO {tbl} (product_id, {name_col}, images, price, stock_quantity, sold_quantity, position) "
                f"VALUES(%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (product_id, name, list(request.images or []), request.price,
                 request.stock_quantity or 0, request.sold_quantity or 0, next_pos)
            )
        elif layer == 2:
            # l2 has a legacy NOT NULL product_id column — set explicitly (denormalized for External API speed).
            cur.execute(
                f"INSERT INTO {tbl} (product_id, {parent_col}, {name_col}, price, stock_quantity, sold_quantity, position) "
                f"VALUES(%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (product_id, scope_id, name, request.price,
                 request.stock_quantity or 0, request.sold_quantity or 0, next_pos)
            )
        else:
            cur.execute(
                f"INSERT INTO {tbl} ({parent_col}, {name_col}, price, stock_quantity, sold_quantity, position) "
                f"VALUES(%s, %s, %s, %s, %s, %s) RETURNING id",
                (scope_id, name, request.price,
                 request.stock_quantity or 0, request.sold_quantity or 0, next_pos)
            )
        new_id = cur.fetchone()["id"]
        # Auto-SKU on Layer 2 — random unique code per the organization's settings.
        if layer == 2:
            mode, length = _resolve_sku_settings(project_id)
            generated = _gen_unique_l2_sku_code(cur, product_id, mode, length)
            if generated:
                cur.execute("UPDATE product_configurations_l2 SET sku_code=%s WHERE id=%s AND sku_code=''",
                            (generated, new_id))
        # Phase 1: pre-seed default specs (Material/Care/etc) on new L1 physical-product variations.
        if layer == 1:
            cur.execute("SELECT product_type FROM products WHERE id=%s", (product_id,))
            ptype = (cur.fetchone() or {}).get("product_type") or "physical"
            if ptype == "physical":
                DEFAULT_SPECS = [
                    "Material",
                    "Care instructions",
                    "Country of origin",
                    "Size guide",
                ]
                for pos, key in enumerate(DEFAULT_SPECS):
                    cur.execute(
                        "INSERT INTO product_specifications"
                        "  (variation_id, layer, parent_id, spec_key, spec_value, position)"
                        " VALUES (%s, 1, %s, %s, '', %s)",
                        (new_id, new_id, key, pos)
                    )
            # Mark seeded regardless of type — prevents startup backfill on later type flips.
            cur.execute(
                "UPDATE product_configurations_l1 SET default_specs_seeded = TRUE WHERE id = %s",
                (new_id,)
            )
        conn.commit()
    return {
        "id": new_id, "layer": layer, "name": name,
        "price": request.price,
        "stock_quantity": request.stock_quantity or 0,
        "sold_quantity": request.sold_quantity or 0,
        "images": list(request.images or []) if layer == 1 else [],
        "position": next_pos,
        "children": [],
    }


@app.put("/api/products/{product_id}/layers/{layer}/{item_id}")
def update_layer_item(product_id: int, layer: int, item_id: int, request: UpdateLayerItemRequest,
                       project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    _verify_layer_item_belongs_to_product(layer, item_id, product_id)
    tbl = _layer_table(layer)
    name_col = _layer_name_col(layer)
    # Pydantic v2: only include fields the client actually sent
    sent = request.model_dump(exclude_unset=True)

    # For L1 image edits — read OLD array so we can S3-clean URLs that disappear from new one.
    old_images = []
    if layer == 1 and 'images' in sent:
        cur_row = db_one(f"SELECT images FROM {tbl} WHERE id=%s", (item_id,))
        old_images = (cur_row or {}).get("images") or []

    fields, vals = [], []
    if 'name' in sent and sent['name'] is not None:
        fields.append(f"{name_col}=%s"); vals.append(sanitize(sent['name'].strip()))
    if 'price' in sent:
        # Explicit null OR a number both go through (null = inherit)
        fields.append("price=%s"); vals.append(sent['price'])
    if 'stock_quantity' in sent and sent['stock_quantity'] is not None:
        fields.append("stock_quantity=%s"); vals.append(sent['stock_quantity'])
    if 'sold_quantity' in sent and sent['sold_quantity'] is not None:
        fields.append("sold_quantity=%s"); vals.append(sent['sold_quantity'])
    if layer == 1 and 'images' in sent:
        fields.append("images=%s"); vals.append(list(sent['images'] or []))
    if layer == 1 and 'media_alt' in sent:
        fields.append("media_alt=%s"); vals.append(list(sent['media_alt'] or []))
    # Discount fields — supported on layers 1 and 2 (product-level handled in update_product).
    if layer in (1, 2):
        if 'sale_type' in sent:
            v = sent['sale_type']
            if v is not None and v not in ('percent', 'amount', 'fixed'):
                raise HTTPException(400, "Invalid sale_type")
            fields.append("sale_type=%s"); vals.append(v)
        if 'sale_value' in sent:
            v = sent['sale_value']
            if v is not None and float(v) < 0:
                raise HTTPException(400, "sale_value must be ≥ 0")
            fields.append("sale_value=%s"); vals.append(v)
        # sale_starts_at / sale_ends_at on L2 already handled by the per-SKU
        # block below. For L1 we add them here.
        if layer == 1:
            if 'sale_starts_at' in sent:
                fields.append("sale_starts_at=%s"); vals.append(sent['sale_starts_at'])
            if 'sale_ends_at' in sent:
                fields.append("sale_ends_at=%s"); vals.append(sent['sale_ends_at'])
    # ── Phase 1: per-SKU (L2) physical fields ──
    if layer == 2:
        if 'sku_code' in sent and sent['sku_code'] is not None:
            fields.append("sku_code=%s"); vals.append(sanitize(sent['sku_code'].strip())[:80])
        if 'barcode' in sent and sent['barcode'] is not None:
            fields.append("barcode=%s"); vals.append(sanitize(sent['barcode'].strip())[:80])
        # NUMERIC nullable fields — explicit null clears, number sets, omit leaves alone
        for nf in ('compare_at_price', 'cost_price', 'weight_g',
                    'length_cm', 'width_cm', 'height_cm', 'sale_price'):
            if nf in sent:
                v = sent[nf]
                if v is not None and float(v) < 0:
                    raise HTTPException(400, f"{nf} must be ≥ 0")
                fields.append(f"{nf}=%s"); vals.append(v)
        for tf in ('sale_starts_at', 'sale_ends_at'):
            if tf in sent:
                fields.append(f"{tf}=%s"); vals.append(sent[tf])
    if not fields: return {"ok": True}
    vals.append(item_id)
    with db_cursor() as (conn, cur):
        cur.execute(f"UPDATE {tbl} SET {', '.join(fields)} WHERE id=%s", vals)
        conn.commit()

    # Best-effort S3 cleanup for removed photos (after commit so a delete failure
    # doesn't roll back the metadata change).
    if layer == 1 and 'images' in sent:
        new_set = set(sent['images'] or [])
        for url in (set(old_images) - new_set):
            if url: s3_delete_url(url, f"projects/{project_id}/products/")
    return {"ok": True}


@app.delete("/api/products/{product_id}/layers/{layer}/{item_id}")
def delete_layer_item(product_id: int, layer: int, item_id: int,
                       project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    _verify_layer_item_belongs_to_product(layer, item_id, product_id)
    tbl = _layer_table(layer)
    # Capture L1 image URLs before delete so we can S3-clean them post-commit.
    images_to_clean = []
    with db_cursor() as (conn, cur):
        cur.execute(f"DELETE FROM {tbl} WHERE id=%s", (item_id,))
        conn.commit()
    # S3 cleanup after commit — best-effort, never fails the request.
    for url in images_to_clean:
        if url: s3_delete_url(url, f"projects/{project_id}/products/")
    return {"ok": True}


@app.post("/api/products/{product_id}/layers/{layer}/{item_id}/copy-to-siblings")
def copy_layer_to_siblings(product_id: int, layer: int, item_id: int,
                            project_id: int = Query(...), user: dict = Depends(get_current_user)):
    """Replicate item_id's children to every sibling at same layer (NULL prices re-inherit)."""
    if layer < 1 or layer > 4:
        raise HTTPException(400, "copy-to-siblings requires layer 1-4 (deeper layers have no children)")
    require_team_member_or_owner(user, project_id)
    _verify_layer_item_belongs_to_product(layer, item_id, product_id)

    child_layer = layer + 1
    child_tbl = _layer_table(child_layer)
    child_name_col = _layer_name_col(child_layer)
    child_parent_col = _layer_parent_col(child_layer)
    parent_tbl = _layer_table(layer)
    parent_parent_col = _layer_parent_col(layer)

    # Find siblings of `item_id` at `layer` (same parent at layer-1, exclude self)
    grandparent_row = db_one(f"SELECT {parent_parent_col} AS gp FROM {parent_tbl} WHERE id=%s", (item_id,))
    if not grandparent_row: raise HTTPException(404, "Source not found")
    siblings = db_all(f"SELECT id FROM {parent_tbl} WHERE {parent_parent_col}=%s AND id != %s",
                      (grandparent_row["gp"], item_id))
    if not siblings: return {"ok": True, "copied_to": 0}

    # Source children list at child_layer under item_id
    source = db_all(
        f"SELECT {child_name_col} AS name, price, stock_quantity, position FROM {child_tbl}"
        f" WHERE {child_parent_col}=%s ORDER BY position ASC, id ASC",
        (item_id,)
    )

    # Replace each sibling's child list with copies (NULL prices stay NULL); L2 INSERT also needs product_id (legacy NOT NULL).
    with db_cursor() as (conn, cur):
        for sib in siblings:
            cur.execute(f"DELETE FROM {child_tbl} WHERE {child_parent_col}=%s", (sib["id"],))
            for s in source:
                if child_layer == 2:
                    cur.execute(
                        f"INSERT INTO {child_tbl} (product_id, {child_parent_col}, {child_name_col}, price, stock_quantity, position) "
                        f"VALUES(%s, %s, %s, %s, %s, %s)",
                        (product_id, sib["id"], s["name"], s["price"], s["stock_quantity"], s["position"])
                    )
                else:
                    cur.execute(
                        f"INSERT INTO {child_tbl} ({child_parent_col}, {child_name_col}, price, stock_quantity, position) "
                        f"VALUES(%s, %s, %s, %s, %s)",
                        (sib["id"], s["name"], s["price"], s["stock_quantity"], s["position"])
                    )
        conn.commit()
    return {"ok": True, "copied_to": len(siblings)}


@app.delete("/api/products/{product_id}/layers/{layer}")
def delete_entire_layer(product_id: int, layer: int,
                         project_id: int = Query(...), user: dict = Depends(get_current_user)):
    """Wipe every row of `layer` for this product (and CASCADE deletes deeper layers)."""
    if layer < 2 or layer > 5:
        raise HTTPException(400, "Only layers 2-5 can be deleted (Layer 1 = the product itself)")
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    # Delete this layer's rows for this product by walking down from l1 (L2 parent=variation, L3+ parent=previous layer).
    var_ids = [r["id"] for r in db_all("SELECT id FROM product_configurations_l1 WHERE product_id=%s", (product_id,))]
    if not var_ids: return {"ok": True, "deleted_layer": layer}

    # Get all ids at this layer for this product
    fmt = ",".join(["%s"] * len(var_ids))
    if layer == 2:
        target_ids = [r["id"] for r in db_all(f"SELECT id FROM product_configurations_l2 WHERE variation_id IN ({fmt})", tuple(var_ids))]
    else:
        # Walk down through each layer
        current = var_ids
        for n in range(2, layer):
            tbl = _layer_table(n)
            pcol = _layer_parent_col(n)
            fmt_n = ",".join(["%s"] * len(current))
            current = [r["id"] for r in db_all(f"SELECT id FROM {tbl} WHERE {pcol} IN ({fmt_n})", tuple(current))]
            if not current: break
        if not current:
            return {"ok": True, "deleted_layer": layer}
        tbl = _layer_table(layer)
        pcol = _layer_parent_col(layer)
        fmt_l = ",".join(["%s"] * len(current))
        target_ids = [r["id"] for r in db_all(f"SELECT id FROM {tbl} WHERE {pcol} IN ({fmt_l})", tuple(current))]

    if not target_ids: return {"ok": True, "deleted_layer": layer}
    fmt_t = ",".join(["%s"] * len(target_ids))
    with db_cursor() as (conn, cur):
        cur.execute(f"DELETE FROM {_layer_table(layer)} WHERE id IN ({fmt_t})", tuple(target_ids))
        conn.commit()
    return {"ok": True, "deleted_layer": layer, "removed": len(target_ids)}


# ── CUSTOM FIELDS ────────────────────────────────────────

@app.post("/api/products/{product_id}/custom-fields")
def upsert_custom_field(product_id: int, request: UpsertCustomFieldRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    # If global, propagate field_key/field_type/is_global across project; field_value stays per-product.
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    key = request.field_key.strip().lower().replace(" ", "_")
    if not key: raise HTTPException(400, "Field key is required")

    project_has_global = db_one(
        "SELECT 1 FROM product_custom_fields WHERE project_id=%s AND field_key=%s AND is_global=TRUE LIMIT 1",
        (project_id, key)
    )
    cascade = bool(project_has_global) or bool(request.is_global)

    ex = db_one("SELECT id FROM product_custom_fields WHERE product_id=%s AND project_id=%s AND field_key=%s",
                (product_id, project_id, key))
    with db_cursor() as (conn, cur):
        if ex:
            cur.execute("UPDATE product_custom_fields SET field_value=%s,field_type=%s,is_global=%s WHERE id=%s",
                        (request.field_value, request.field_type, request.is_global, ex["id"]))
            row_id = ex["id"]
        else:
            cur.execute(
                "INSERT INTO product_custom_fields (project_id,product_id,field_key,field_value,field_type,is_global)"
                " VALUES(%s,%s,%s,%s,%s,%s) RETURNING id",
                (project_id, product_id, key, request.field_value, request.field_type, request.is_global)
            )
            row_id = cur.fetchone()["id"]
        if cascade:
            cur.execute(
                "UPDATE product_custom_fields SET field_type=%s, is_global=%s"
                " WHERE project_id=%s AND field_key=%s AND id<>%s",
                (request.field_type, request.is_global, project_id, key, row_id)
            )
        conn.commit()
    return {"ok": True, "field_key": key, "is_global": request.is_global}


@app.put("/api/products/{product_id}/custom-fields/{field_key}")
def update_custom_field(product_id: int, field_key: str, request: UpsertCustomFieldRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    # Path param = OLD key (for rename). Global rows propagate key/type/is_global across project.
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    new_key = request.field_key.strip().lower().replace(" ", "_")
    if not new_key: raise HTTPException(400, "Field key is required")
    row = db_one("SELECT id, is_global FROM product_custom_fields WHERE product_id=%s AND project_id=%s AND field_key=%s",
                 (product_id, project_id, field_key))
    if not row: raise HTTPException(404, "Field not found")
    was_global = bool(row["is_global"])
    will_be_global = bool(request.is_global)
    is_global_field = was_global or will_be_global

    if new_key != field_key:
        if is_global_field:
            # Rename collision check across the whole project.
            clash = db_one(
                "SELECT id FROM product_custom_fields WHERE project_id=%s AND field_key=%s LIMIT 1",
                (project_id, new_key)
            )
        else:
            clash = db_one(
                "SELECT id FROM product_custom_fields WHERE product_id=%s AND project_id=%s AND field_key=%s",
                (product_id, project_id, new_key)
            )
        if clash: raise HTTPException(409, f"Field '{new_key}' already exists")
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE product_custom_fields SET field_key=%s,field_value=%s,field_type=%s,is_global=%s WHERE id=%s",
                    (new_key, request.field_value, request.field_type, will_be_global, row["id"]))
        if is_global_field:
            cur.execute(
                "UPDATE product_custom_fields SET field_key=%s, field_type=%s, is_global=%s"
                " WHERE project_id=%s AND field_key=%s AND id<>%s",
                (new_key, request.field_type, will_be_global, project_id, field_key, row["id"])
            )
        conn.commit()
    return {"ok": True, "field_key": new_key, "is_global": will_be_global}


@app.delete("/api/products/{product_id}/custom-fields/{field_key}")
def delete_custom_field(product_id: int, field_key: str, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    # Global row delete cascades across project; returns removed[] so Undo can /restore.
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    row = db_one("SELECT id, is_global FROM product_custom_fields WHERE product_id=%s AND project_id=%s AND field_key=%s",
                 (product_id, project_id, field_key))
    if not row:
        return {"ok": True, "removed": []}
    if row["is_global"]:
        removed = db_all(
            "SELECT product_id, field_key, field_value, field_type, is_global, position"
            " FROM product_custom_fields WHERE project_id=%s AND field_key=%s",
            (project_id, field_key)
        )
    else:
        removed = db_all(
            "SELECT product_id, field_key, field_value, field_type, is_global, position"
            " FROM product_custom_fields WHERE id=%s",
            (row["id"],)
        )
    for r in removed:
        r["is_global"] = bool(r.get("is_global", 0))
    with db_cursor() as (conn, cur):
        if row["is_global"]:
            cur.execute("DELETE FROM product_custom_fields WHERE project_id=%s AND field_key=%s",
                        (project_id, field_key))
        else:
            cur.execute("DELETE FROM product_custom_fields WHERE id=%s", (row["id"],))
        conn.commit()
    return {"ok": True, "cascaded": bool(row["is_global"]), "removed": removed}


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


# ── RESTORE (Undo target) ────────────────────────────────

@app.post("/api/products/{product_id}/restore")
def restore(product_id: int, request: RestoreRequest, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    """Generic Undo target: rebuilds a snapshot. Types: variation | layer_node | layer | custom_fields."""
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")

    if request.type == "variation":
        if not request.data: raise HTTPException(400, "data required")
        with db_cursor() as (conn, cur):
            new_id = _restore_layer_subtree(cur, product_id=product_id, layer=1, parent_id=None, node=request.data)
            conn.commit()
        return {"ok": True, "id": new_id}

    if request.type == "layer_node":
        if request.layer is None or request.parent_id is None or not request.data:
            raise HTTPException(400, "layer, parent_id, data are required")
        if not (2 <= request.layer <= 5):
            raise HTTPException(400, "layer_node requires layer 2-5")
        # Validate parent still belongs to this product
        _verify_layer_item_belongs_to_product(request.layer - 1, request.parent_id, product_id)
        with db_cursor() as (conn, cur):
            new_id = _restore_layer_subtree(cur, product_id=product_id, layer=request.layer, parent_id=request.parent_id, node=request.data)
            conn.commit()
        return {"ok": True, "id": new_id}

    if request.type == "layer":
        if request.layer is None or not request.rows:
            raise HTTPException(400, "layer and rows are required")
        new_ids = []
        with db_cursor() as (conn, cur):
            for r in request.rows:
                pid = r.get("parent_id")
                if request.layer >= 2 and pid is not None:
                    # Best-effort: skip rows whose parent is gone
                    if not _safe_parent_for_product(request.layer - 1, pid, product_id):
                        continue
                nid = _restore_layer_subtree(cur, product_id=product_id, layer=request.layer, parent_id=pid, node=r.get("data") or r)
                if nid is not None: new_ids.append(nid)
            conn.commit()
        return {"ok": True, "ids": new_ids}

    if request.type == "custom_fields":
        if not request.rows: return {"ok": True, "restored": 0}
        count = 0
        with db_cursor() as (conn, cur):
            for r in request.rows:
                pid = r.get("product_id")
                if not pid: continue
                # Validate the row's product still belongs to this project
                if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (pid, project_id)):
                    continue
                key = (r.get("field_key") or "").strip().lower().replace(" ", "_")
                if not key: continue
                # ON CONFLICT keeps Undo idempotent if some rows were already re-created elsewhere.
                cur.execute(
                    "INSERT INTO product_custom_fields (project_id, product_id, field_key, field_value, field_type, is_global, position)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                    (project_id, pid, key, r.get("field_value") or "",
                     r.get("field_type") or "string", bool(r.get("is_global")),
                     int(r.get("position") or 0))
                )
                count += 1
            conn.commit()
        return {"ok": True, "restored": count}

    raise HTTPException(400, f"Unknown restore type: {request.type}")


def _safe_parent_for_product(layer: int, parent_id: int, product_id: int) -> bool:
    try:
        _verify_layer_item_belongs_to_product(layer, parent_id, product_id)
        return True
    except HTTPException:
        return False


# ── MODIFIERS ────────────────────────────────────────────

# Modifier groups + items: 2-level model (groups checkbox|radio → items name+price_delta).

def _validate_group_payload(req: ModifierGroupRequest, *, control_type: str = None,
                             min_select: int = None, max_select: int = None):
    """Common validation for create + update — consistent error messages."""
    ct = control_type if control_type is not None else (req.control_type or 'checkbox')
    if ct not in ('checkbox', 'radio'):
        raise HTTPException(400, "control_type must be 'checkbox' or 'radio'")
    mn = min_select if min_select is not None else (req.min_select if req.min_select is not None else 0)
    mx = max_select if max_select is not None else req.max_select  # may be None = unlimited
    if mn < 0:
        raise HTTPException(400, "min_select must be ≥ 0")
    if mx is not None:
        if mx < 0: raise HTTPException(400, "max_select must be ≥ 0")
        if mx < mn: raise HTTPException(400, "max_select must be ≥ min_select")
    # Radio = inherently single-select. Force max=1 server-side so storefront can't
    # accidentally over-select even if the client UI is buggy.
    if ct == 'radio' and mx is not None and mx > 1:
        raise HTTPException(400, "max_select must be 0 or 1 for radio groups")
    return ct, mn, mx


@app.get("/api/products/{product_id}/modifier-groups")
def list_modifier_groups(product_id: int, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    groups = db_all(
        "SELECT id, name, control_type, min_select, max_select, is_required,"
        "       default_item_id, position FROM product_modifier_groups"
        " WHERE product_id=%s ORDER BY position ASC, id ASC",
        (product_id,)
    )
    items_by_group: dict = {}
    if groups:
        gids = [g["id"] for g in groups]
        rows = db_all(
            "SELECT id, group_id, name, price_delta, position FROM product_modifier_items"
            " WHERE group_id = ANY(%s) ORDER BY position ASC, id ASC",
            (gids,)
        )
        for r in rows:
            r["price_delta"] = float(r.get("price_delta") or 0)
            items_by_group.setdefault(r["group_id"], []).append(r)
    for g in groups:
        g["items"] = items_by_group.get(g["id"], [])
    return groups


@app.post("/api/products/{product_id}/modifier-groups")
def create_modifier_group(product_id: int, request: ModifierGroupRequest,
                           project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    ct, mn, mx = _validate_group_payload(request)
    name = sanitize((request.name or '').strip())[:200]
    is_required = bool(request.is_required) if request.is_required is not None else False
    with db_cursor() as (conn, cur):
        cur.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 AS next_pos"
            " FROM product_modifier_groups WHERE product_id=%s", (product_id,)
        )
        pos = cur.fetchone()["next_pos"]
        cur.execute(
            "INSERT INTO product_modifier_groups"
            "  (product_id, name, control_type, min_select, max_select, is_required, position)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (product_id, name, ct, mn, mx, is_required, pos)
        )
        new_id = cur.fetchone()["id"]
        conn.commit()
    return {
        "id": new_id, "name": name, "control_type": ct,
        "min_select": mn, "max_select": mx, "is_required": is_required,
        "default_item_id": None, "position": pos, "items": [],
    }


@app.put("/api/products/{product_id}/modifier-groups/{gid}")
def update_modifier_group(product_id: int, gid: int, request: ModifierGroupRequest,
                          project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    g = db_one(
        "SELECT id, control_type, min_select, max_select FROM product_modifier_groups"
        " WHERE id=%s AND product_id=%s", (gid, product_id)
    )
    if not g: raise HTTPException(404, "Modifier group not found")

    # Compute the post-update values for validation (so radio→checkbox switch sees consistent state).
    new_ct = request.control_type if request.control_type is not None else g["control_type"]
    new_mn = request.min_select   if request.min_select   is not None else g["min_select"]
    new_mx = request.max_select   if "max_select" in request.model_fields_set else g["max_select"]
    _validate_group_payload(request, control_type=new_ct, min_select=new_mn, max_select=new_mx)

    fields, vals = [], []
    if request.name is not None:
        fields.append("name=%s"); vals.append(sanitize(request.name.strip())[:200])
    if request.control_type is not None:
        fields.append("control_type=%s"); vals.append(new_ct)
    if request.min_select is not None:
        fields.append("min_select=%s"); vals.append(new_mn)
    if "max_select" in request.model_fields_set:
        fields.append("max_select=%s"); vals.append(new_mx)
    if request.is_required is not None:
        fields.append("is_required=%s"); vals.append(bool(request.is_required))
    if "default_item_id" in request.model_fields_set:
        # Validate the default item belongs to this group (or is being cleared with NULL).
        if request.default_item_id is not None:
            owned = db_one(
                "SELECT id FROM product_modifier_items WHERE id=%s AND group_id=%s",
                (request.default_item_id, gid)
            )
            if not owned: raise HTTPException(400, "default_item_id must reference an item in this group")
        fields.append("default_item_id=%s"); vals.append(request.default_item_id)
    if not fields: return {"ok": True}
    vals.append(gid)
    with db_cursor() as (conn, cur):
        cur.execute(f"UPDATE product_modifier_groups SET {', '.join(fields)} WHERE id=%s", vals)
        conn.commit()
    return {"ok": True}


@app.delete("/api/products/{product_id}/modifier-groups/{gid}")
def delete_modifier_group(product_id: int, gid: int,
                           project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM product_modifier_groups WHERE id=%s AND product_id=%s",
                  (gid, product_id)):
        raise HTTPException(404, "Modifier group not found")
    with db_cursor() as (conn, cur):
        # ON DELETE CASCADE on items takes care of cleanup.
        cur.execute("DELETE FROM product_modifier_groups WHERE id=%s", (gid,))
        conn.commit()
    return {"ok": True}


@app.put("/api/products/{product_id}/modifier-groups/reorder")
def reorder_modifier_groups(product_id: int, req: ReorderGroupsRequest,
                             project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    ids = list(req.ids or [])
    with db_cursor() as (conn, cur):
        cur.execute("SELECT id FROM product_modifier_groups WHERE product_id=%s", (product_id,))
        existing = {r["id"] for r in cur.fetchall()}
        if set(ids) != existing:
            raise HTTPException(400, "ids must contain exactly the groups of this product")
        for idx, gid in enumerate(ids):
            cur.execute("UPDATE product_modifier_groups SET position=%s WHERE id=%s", (idx, gid))
        conn.commit()
    return {"ok": True}


@app.post("/api/products/{product_id}/modifier-groups/{gid}/items")
def create_modifier_item(product_id: int, gid: int, request: ModifierItemRequest,
                          project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one(
        "SELECT g.id FROM product_modifier_groups g"
        " JOIN products p ON g.product_id=p.id"
        " WHERE g.id=%s AND p.id=%s AND p.project_id=%s",
        (gid, product_id, project_id),
    ):
        raise HTTPException(404, "Modifier group not found")
    # Empty name allowed on create — same UX as groups: user types it in after the
    # row appears. Save validation kicks in only via the PUT debounced save.
    name = sanitize((request.name or '').strip())[:200]
    delta = float(request.price_delta or 0)
    with db_cursor() as (conn, cur):
        cur.execute("SELECT COALESCE(MAX(position), -1) + 1 AS next_pos"
                    " FROM product_modifier_items WHERE group_id=%s", (gid,))
        pos = cur.fetchone()["next_pos"]
        cur.execute(
            "INSERT INTO product_modifier_items (group_id, name, price_delta, position)"
            " VALUES (%s, %s, %s, %s) RETURNING id",
            (gid, name, delta, pos)
        )
        new_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": new_id, "group_id": gid, "name": name, "price_delta": delta, "position": pos}


@app.put("/api/products/{product_id}/modifier-items/{iid}")
def update_modifier_item(product_id: int, iid: int, request: ModifierItemRequest,
                          project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one(
        "SELECT i.id FROM product_modifier_items i"
        " JOIN product_modifier_groups g ON i.group_id=g.id"
        " JOIN products p ON g.product_id=p.id"
        " WHERE i.id=%s AND p.id=%s AND p.project_id=%s",
        (iid, product_id, project_id),
    )
    if not row: raise HTTPException(404, "Modifier item not found")
    fields, vals = [], []
    if request.name is not None:
        # Allow empty (user can clear the field temporarily); DB column has DEFAULT ''.
        fields.append("name=%s"); vals.append(sanitize(request.name.strip())[:200])
    if request.price_delta is not None:
        fields.append("price_delta=%s"); vals.append(float(request.price_delta))
    if not fields: return {"ok": True}
    vals.append(iid)
    with db_cursor() as (conn, cur):
        cur.execute(f"UPDATE product_modifier_items SET {', '.join(fields)} WHERE id=%s", vals)
        conn.commit()
    return {"ok": True}


@app.delete("/api/products/{product_id}/modifier-items/{iid}")
def delete_modifier_item(product_id: int, iid: int,
                          project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one(
        "SELECT i.id FROM product_modifier_items i"
        " JOIN product_modifier_groups g ON i.group_id=g.id"
        " JOIN products p ON g.product_id=p.id"
        " WHERE i.id=%s AND p.id=%s AND p.project_id=%s",
        (iid, product_id, project_id),
    )
    if not row: raise HTTPException(404, "Modifier item not found")
    with db_cursor() as (conn, cur):
        # Group's default_item_id has ON DELETE SET NULL FK — auto-cleared.
        cur.execute("DELETE FROM product_modifier_items WHERE id=%s", (iid,))
        conn.commit()
    return {"ok": True}


@app.put("/api/products/{product_id}/modifier-items/reorder")
def reorder_modifier_items(product_id: int, req: ReorderItemsRequest,
                            project_id: int = Query(...), user: dict = Depends(get_current_user)):
    """Within-group sort + cross-group move. Body: { items: [{ id, group_id, position }, ...] }."""
    require_team_member_or_owner(user, project_id)
    payload = list(req.items or [])
    if not payload: return {"ok": True}

    item_ids = [int(e.get("id")) for e in payload if e.get("id") is not None]
    if not item_ids: raise HTTPException(400, "items must contain id+group_id+position triples")

    # Verify every item id belongs to this product (defence against IDOR).
    rows = db_all(
        "SELECT i.id FROM product_modifier_items i"
        " JOIN product_modifier_groups g ON i.group_id=g.id"
        " WHERE i.id = ANY(%s) AND g.product_id=%s",
        (item_ids, product_id),
    )
    found = {r["id"] for r in rows}
    if found != set(item_ids):
        raise HTTPException(400, "ids must reference items of this product only")

    # Verify every target group_id belongs to this product too.
    target_gids = list({int(e.get("group_id")) for e in payload if e.get("group_id") is not None})
    if target_gids:
        owned = db_all(
            "SELECT id FROM product_modifier_groups WHERE id = ANY(%s) AND product_id=%s",
            (target_gids, product_id),
        )
        if {r["id"] for r in owned} != set(target_gids):
            raise HTTPException(400, "group_id must reference a group of this product")

    with db_cursor() as (conn, cur):
        for entry in payload:
            iid = int(entry["id"])
            gid = int(entry["group_id"])
            pos = int(entry["position"])
            cur.execute(
                "UPDATE product_modifier_items SET group_id=%s, position=%s WHERE id=%s",
                (gid, pos, iid)
            )
        # Null out orphaned default_item_id (item may have been default of its old group).
        cur.execute(
            "UPDATE product_modifier_groups g"
            " SET default_item_id = NULL"
            " WHERE g.product_id=%s AND g.default_item_id IS NOT NULL"
            "   AND NOT EXISTS ("
            "     SELECT 1 FROM product_modifier_items i"
            "      WHERE i.id = g.default_item_id AND i.group_id = g.id"
            "   )",
            (product_id,)
        )
        conn.commit()
    return {"ok": True}


# Promo codes CRUD: shared with External (validates at /{api_key}/promo-code/apply); CRM owns admin UI.

def _ensure_promo_codes_table():
    """Create promo_codes + promo_code_uses with full Phase 1 column set (idempotent)."""
    try:
        with db_cursor() as (conn, cur):
            cur.execute("""
                CREATE TABLE IF NOT EXISTS promo_codes (
                    id               SERIAL PRIMARY KEY,
                    project_id       INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    code             VARCHAR(40) NOT NULL,
                    discount_type    VARCHAR(16) NOT NULL DEFAULT 'percentage',
                    discount_value   NUMERIC(10, 2) NOT NULL DEFAULT 0,
                    min_order_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
                    max_discount     NUMERIC(10, 2),
                    usage_limit      INTEGER,
                    times_used       INTEGER NOT NULL DEFAULT 0,
                    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
                    valid_from       TIMESTAMPTZ,
                    valid_until      TIMESTAMPTZ,
                    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_promo_codes_project ON promo_codes(project_id)")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_promo_code_per_project ON promo_codes(project_id, code)")
            # Phase 1 expansion — per-user limits + category targeting.
            cur.execute("ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS per_user_limit INTEGER")
            cur.execute("ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS category_ids INTEGER[] NOT NULL DEFAULT '{}'")
            # Per-user usage log — primary source for per_user_limit checks at /promo-code/apply.
            cur.execute("""
                CREATE TABLE IF NOT EXISTS promo_code_uses (
                    id          SERIAL PRIMARY KEY,
                    promo_id    INTEGER NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
                    project_id  INTEGER NOT NULL REFERENCES crm_projects(id) ON DELETE CASCADE,
                    user_id     INTEGER NOT NULL,
                    order_id    INTEGER,
                    used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_promo_uses_user ON promo_code_uses(promo_id, user_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_promo_uses_project ON promo_code_uses(project_id, used_at DESC)")
            conn.commit()
    except Exception as e:
        print(f"[promo_codes] table ensure failed: {e}")


class PromoCodeRequest(BaseModel):
    code:             Optional[str]   = None
    discount_type:    Optional[str]   = None     # 'percentage' | 'fixed'
    discount_value:   Optional[float] = None
    min_order_amount: Optional[float] = None
    max_discount:     Optional[float] = None     # null = unlimited
    usage_limit:      Optional[int]   = None     # null = global unlimited
    per_user_limit:   Optional[int]   = None     # null = unlimited per user
    category_ids:     Optional[List[int]] = None # empty / null = all categories
    is_active:        Optional[bool]  = None
    valid_from:       Optional[str]   = None     # ISO timestamp
    valid_until:      Optional[str]   = None


@app.get("/api/promo-codes")
def list_promo_codes(project_id: int = Query(...),
                     cursor: Optional[str] = Query(None),
                     limit:  Optional[int] = Query(None),
                     user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    _ensure_promo_codes_table()
    want_pagination, offset, page_size = _pagination_params(cursor, limit)
    sql = (
        "SELECT id, code, discount_type, discount_value, min_order_amount, max_discount,"
        "       usage_limit, times_used, per_user_limit, category_ids,"
        "       is_active, valid_from, valid_until, created_at"
        "  FROM promo_codes WHERE project_id=%s ORDER BY created_at DESC"
    )
    params: list = [project_id]
    if want_pagination:
        sql += " LIMIT %s OFFSET %s"
        params.extend([page_size + 1, offset])
    rows = db_all(sql, tuple(params))
    for r in rows:
        for nf in ('discount_value', 'min_order_amount', 'max_discount'):
            if r.get(nf) is not None: r[nf] = float(r[nf])
        for tf in ('valid_from', 'valid_until', 'created_at'):
            if r.get(tf) is not None: r[tf] = r[tf].isoformat()
        r["category_ids"] = list(r.get("category_ids") or [])
    return _wrap_paginated(want_pagination, rows, offset, page_size)


@app.post("/api/promo-codes")
def create_promo_code(req: PromoCodeRequest, project_id: int = Query(...),
                      user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    _ensure_promo_codes_table()
    code = sanitize((req.code or '').strip().upper())[:40]
    if not code: raise HTTPException(400, "Code is required")
    dtype = (req.discount_type or 'percentage').strip()
    if dtype not in ('percentage', 'fixed'):
        raise HTTPException(400, "discount_type must be 'percentage' or 'fixed'")
    dval = float(req.discount_value or 0)
    if dval < 0: raise HTTPException(400, "discount_value must be ≥ 0")
    if dtype == 'percentage' and dval > 100:
        raise HTTPException(400, "Percentage cannot exceed 100")
    min_order = float(req.min_order_amount or 0)
    if min_order < 0: raise HTTPException(400, "min_order_amount must be ≥ 0")
    max_disc = float(req.max_discount) if req.max_discount is not None else None
    usage = int(req.usage_limit) if req.usage_limit is not None else None
    if usage is not None and usage < 1: raise HTTPException(400, "usage_limit must be ≥ 1")
    is_active = bool(req.is_active) if req.is_active is not None else True
    per_user = int(req.per_user_limit) if req.per_user_limit is not None else None
    if per_user is not None and per_user < 1:
        raise HTTPException(400, "per_user_limit must be ≥ 1")
    cat_ids = list(req.category_ids or [])
    if len(cat_ids) > 200:
        raise HTTPException(400, "category_ids capped at 200 entries")
    # Verify supplied category ids really belong to this project (IDOR defense).
    if cat_ids:
        owned = db_all(
            "SELECT id FROM product_categories WHERE id = ANY(%s) AND project_id = %s",
            (cat_ids, project_id)
        )
        if {r["id"] for r in owned} != set(cat_ids):
            raise HTTPException(400, "category_ids must reference categories of this project")

    with db_cursor() as (conn, cur):
        try:
            cur.execute(
                "INSERT INTO promo_codes"
                "  (project_id, code, discount_type, discount_value, min_order_amount,"
                "   max_discount, usage_limit, per_user_limit, category_ids,"
                "   is_active, valid_from, valid_until)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (project_id, code, dtype, dval, min_order, max_disc, usage,
                 per_user, cat_ids, is_active, req.valid_from, req.valid_until)
            )
        except psycopg2.errors.UniqueViolation:
            raise HTTPException(400, f"Code '{code}' already exists for this project")
        new_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": new_id}


@app.put("/api/promo-codes/{pcid}")
def update_promo_code(pcid: int, req: PromoCodeRequest, project_id: int = Query(...),
                      user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if not db_one("SELECT id FROM promo_codes WHERE id=%s AND project_id=%s",
                  (pcid, project_id)):
        raise HTTPException(404, "Promo code not found")
    fields, vals = [], []
    if req.code is not None:
        fields.append("code=%s"); vals.append(sanitize(req.code.strip().upper())[:40])
    if req.discount_type is not None:
        if req.discount_type not in ('percentage', 'fixed'):
            raise HTTPException(400, "Invalid discount_type")
        fields.append("discount_type=%s"); vals.append(req.discount_type)
    if req.discount_value is not None:
        fields.append("discount_value=%s"); vals.append(float(req.discount_value))
    if req.min_order_amount is not None:
        fields.append("min_order_amount=%s"); vals.append(float(req.min_order_amount))
    if "max_discount" in req.model_fields_set:
        fields.append("max_discount=%s"); vals.append(req.max_discount)
    if "usage_limit" in req.model_fields_set:
        fields.append("usage_limit=%s"); vals.append(req.usage_limit)
    if "per_user_limit" in req.model_fields_set:
        if req.per_user_limit is not None and int(req.per_user_limit) < 1:
            raise HTTPException(400, "per_user_limit must be ≥ 1")
        fields.append("per_user_limit=%s"); vals.append(req.per_user_limit)
    if "category_ids" in req.model_fields_set:
        cat_ids = list(req.category_ids or [])
        if len(cat_ids) > 200:
            raise HTTPException(400, "category_ids capped at 200 entries")
        if cat_ids:
            owned = db_all(
                "SELECT id FROM product_categories WHERE id = ANY(%s) AND project_id = %s",
                (cat_ids, project_id)
            )
            if {r["id"] for r in owned} != set(cat_ids):
                raise HTTPException(400, "category_ids must reference categories of this project")
        fields.append("category_ids=%s"); vals.append(cat_ids)
    if req.is_active is not None:
        fields.append("is_active=%s"); vals.append(bool(req.is_active))
    if "valid_from" in req.model_fields_set:
        fields.append("valid_from=%s"); vals.append(req.valid_from)
    if "valid_until" in req.model_fields_set:
        fields.append("valid_until=%s"); vals.append(req.valid_until)
    if not fields: return {"ok": True}
    vals.append(pcid)
    with db_cursor() as (conn, cur):
        cur.execute(f"UPDATE promo_codes SET {', '.join(fields)} WHERE id=%s", vals)
        conn.commit()
    return {"ok": True}


@app.delete("/api/promo-codes/{pcid}")
def delete_promo_code(pcid: int, project_id: int = Query(...),
                     user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if not db_one("SELECT id FROM promo_codes WHERE id=%s AND project_id=%s",
                  (pcid, project_id)):
        raise HTTPException(404, "Promo code not found")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM promo_codes WHERE id=%s", (pcid,))
        conn.commit()
    return {"ok": True}


# Tax categories CRUD: per-project list referenced via products.tax_category_id (nullable FK).

@app.get("/api/tax-categories")
def list_tax_categories(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    rows = db_all(
        "SELECT id, name, rate, is_default FROM product_tax_categories"
        " WHERE project_id=%s ORDER BY is_default DESC, name ASC",
        (project_id,)
    )
    for r in rows: r["rate"] = float(r["rate"] or 0)
    return rows


@app.post("/api/tax-categories")
def create_tax_category(req: TaxCategoryRequest, project_id: int = Query(...),
                        user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    name = sanitize((req.name or '').strip())[:120]
    if not name: raise HTTPException(400, "Name is required")
    rate = float(req.rate or 0)
    if rate < 0 or rate > 100: raise HTTPException(400, "Rate must be 0..100")
    is_default = bool(req.is_default)
    with db_cursor() as (conn, cur):
        if is_default:
            # Only one default per project — clear the previous one if any.
            cur.execute("UPDATE product_tax_categories SET is_default=FALSE WHERE project_id=%s", (project_id,))
        cur.execute(
            "INSERT INTO product_tax_categories (project_id, name, rate, is_default)"
            " VALUES (%s, %s, %s, %s) RETURNING id",
            (project_id, name, rate, is_default)
        )
        new_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": new_id, "name": name, "rate": rate, "is_default": is_default}


@app.put("/api/tax-categories/{tcid}")
def update_tax_category(tcid: int, req: TaxCategoryRequest, project_id: int = Query(...),
                        user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if not db_one("SELECT id FROM product_tax_categories WHERE id=%s AND project_id=%s",
                  (tcid, project_id)):
        raise HTTPException(404, "Tax category not found")
    fields, vals = [], []
    if req.name is not None:
        n = sanitize(req.name.strip())[:120]
        if not n: raise HTTPException(400, "Name cannot be empty")
        fields.append("name=%s"); vals.append(n)
    if req.rate is not None:
        r = float(req.rate)
        if r < 0 or r > 100: raise HTTPException(400, "Rate must be 0..100")
        fields.append("rate=%s"); vals.append(r)
    if req.is_default is not None:
        fields.append("is_default=%s"); vals.append(bool(req.is_default))
    if not fields: return {"ok": True}
    vals.append(tcid)
    with db_cursor() as (conn, cur):
        if req.is_default:
            # Unset other defaults in the same project before flipping this one.
            cur.execute("UPDATE product_tax_categories SET is_default=FALSE"
                        " WHERE project_id=%s AND id<>%s", (project_id, tcid))
        cur.execute(f"UPDATE product_tax_categories SET {', '.join(fields)} WHERE id=%s", vals)
        conn.commit()
    return {"ok": True}


@app.delete("/api/tax-categories/{tcid}")
def delete_tax_category(tcid: int, project_id: int = Query(...),
                        user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if not db_one("SELECT id FROM product_tax_categories WHERE id=%s AND project_id=%s",
                  (tcid, project_id)):
        raise HTTPException(404, "Tax category not found")
    with db_cursor() as (conn, cur):
        # FK on products.tax_category_id is ON DELETE SET NULL — safe.
        cur.execute("DELETE FROM product_tax_categories WHERE id=%s", (tcid,))
        conn.commit()
    return {"ok": True}


# Tier pricing CRUD: per-SKU wholesale ladder; checkout picks highest min_qty ≤ line qty.

@app.get("/api/products/{product_id}/tier-pricing")
def list_tier_pricing(product_id: int, project_id: int = Query(...),
                       user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    rows = db_all(
        "SELECT tp.id, tp.sku_id, tp.min_qty, tp.price"
        "  FROM product_tier_pricing tp"
        "  JOIN product_configurations_l2 c ON tp.sku_id = c.id"
        "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
        " WHERE v.product_id=%s ORDER BY tp.sku_id ASC, tp.min_qty ASC",
        (product_id,)
    )
    for r in rows: r["price"] = float(r["price"] or 0)
    return rows


@app.post("/api/products/{product_id}/tier-pricing")
def create_tier_pricing(product_id: int, req: TierPricingRequest,
                         project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    # Verify the SKU belongs to this product (IDOR defense).
    if not db_one(
        "SELECT c.id FROM product_configurations_l2 c"
        "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
        " WHERE c.id=%s AND v.product_id=%s",
        (req.sku_id, product_id)
    ):
        raise HTTPException(404, "SKU not found in this product")
    if req.min_qty < 1: raise HTTPException(400, "min_qty must be ≥ 1")
    if req.price < 0:   raise HTTPException(400, "price must be ≥ 0")
    with db_cursor() as (conn, cur):
        try:
            cur.execute(
                "INSERT INTO product_tier_pricing (sku_id, min_qty, price)"
                " VALUES (%s, %s, %s) RETURNING id",
                (req.sku_id, req.min_qty, req.price)
            )
            new_id = cur.fetchone()["id"]
            conn.commit()
        except psycopg2.errors.UniqueViolation:
            raise HTTPException(400, f"Tier pricing already exists for sku {req.sku_id}, qty {req.min_qty}")
    return {"id": new_id, "sku_id": req.sku_id, "min_qty": req.min_qty, "price": req.price}


@app.delete("/api/products/{product_id}/tier-pricing/{tier_id}")
def delete_tier_pricing(product_id: int, tier_id: int,
                         project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    # Verify ownership through joins to enforce project isolation.
    row = db_one(
        "SELECT tp.id FROM product_tier_pricing tp"
        "  JOIN product_configurations_l2 c ON tp.sku_id = c.id"
        "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
        "  JOIN products p ON v.product_id = p.id"
        " WHERE tp.id=%s AND p.id=%s AND p.project_id=%s",
        (tier_id, product_id, project_id)
    )
    if not row: raise HTTPException(404, "Tier not found")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM product_tier_pricing WHERE id=%s", (tier_id,))
        conn.commit()
    return {"ok": True}


# ── INVENTORY BATCHES ────────────────────────────────────
# Batches = physical receipts of stock. The new source of truth for "how did this stock get here?". product_stock.quantity = SUM(inventory_batches.quantity_remaining) for active (non-frozen) batches.

def _resolve_batch_naming(project_id: int, cur, sku_id: Optional[int] = None) -> tuple[str, str]:
    """Look up project's batch_naming_mode/format (moved from org-level)."""
    row = db_one(
        "SELECT batch_naming_mode, batch_naming_format FROM crm_projects WHERE id = %s",
        (project_id,)
    )
    if not row:
        return ('auto', 'B-{YYYY}{MM}-{seq:03}')
    return (row.get('batch_naming_mode') or 'auto',
            row.get('batch_naming_format') or 'B-{YYYY}{MM}-{seq:03}')


def _generate_batch_name(cur, project_id: int, sku_id: Optional[int] = None,
                         quantity: Optional[int] = None) -> str:
    """Render the project's batch_naming_format template into a unique batch name.

    Supported placeholders:
      {YYYY}        4-digit year                {YY}    2-digit year
      {MM}          month (01-12)               {DD}    day (01-31)
      {sku}         L2 sku_code                 {qty}   quantity received
      {seq}         monthly counter (resets 1st of each month)
      {seq_day}     daily counter   (resets midnight)
      {seq_year}    yearly counter  (resets Jan 1)
      {seq_all}     all-time counter (never resets)

    Any seq token accepts ":NN" for zero-padding, e.g. {seq:03}, {seq_day:04}, {qty:04}.
    Each scope has its own atomic counter — separate period_key prefixes prevent collision.
    Counters are only bumped if the token actually appears in the template (lazy — no
    wasted IDs).
    """
    mode, fmt = _resolve_batch_naming(project_id, cur, sku_id)
    if mode != 'auto':
        return ''      # caller will supply manually
    now = _utcnow()

    # Map placeholder name → period_key (so each scope buckets its own counter).
    seq_buckets = {
        'seq':      f"M-{now.strftime('%Y%m')}",     # backward-compat — monthly
        'seq_day':  f"D-{now.strftime('%Y%m%d')}",   # daily
        'seq_year': f"Y-{now.strftime('%Y')}",       # yearly
        'seq_all':  "ALL",                            # never resets
    }
    # Lazy counter cache — bump only the buckets that actually appear in the template.
    seq_cache: dict[str, int] = {}

    def _bump(bucket_name: str) -> int:
        if bucket_name in seq_cache:
            return seq_cache[bucket_name]
        period_key = seq_buckets[bucket_name]
        cur.execute(
            "INSERT INTO inventory_batch_counters (project_id, period_key, counter)"
            " VALUES (%s, %s, 1)"
            " ON CONFLICT (project_id, period_key) DO UPDATE SET counter = inventory_batch_counters.counter + 1"
            " RETURNING counter",
            (project_id, period_key)
        )
        seq_cache[bucket_name] = cur.fetchone()["counter"]
        return seq_cache[bucket_name]

    sku_code = ''
    if sku_id:
        r = db_one("SELECT sku_code FROM product_configurations_l2 WHERE id=%s", (sku_id,))
        if r: sku_code = r.get('sku_code') or ''

    qty_str = str(quantity) if quantity is not None else ''

    def _pad(n: int, raw: str) -> str:
        # {token:NN} → zero-pad. Clamp width 1..10 to avoid runaway names.
        try:
            width = int(raw)
            return str(n).zfill(max(1, min(width, 10)))
        except ValueError:
            return str(n)

    def _replace(match):
        token = match.group(1)
        # Strip ":NN" suffix to look up base token.
        base, _, width_raw = token.partition(':')
        if base == 'YYYY': return now.strftime('%Y')
        if base == 'YY':   return now.strftime('%y')
        if base == 'MM':   return now.strftime('%m')
        if base == 'DD':   return now.strftime('%d')
        if base == 'sku':  return sku_code
        if base == 'qty':
            if quantity is None: return ''
            return _pad(quantity, width_raw) if width_raw else qty_str
        if base in seq_buckets:
            n = _bump(base)
            return _pad(n, width_raw) if width_raw else str(n)
        return match.group(0)

    # Note: regex now allows underscores in the base token so {seq_day} / {seq_year} / {seq_all} match.
    return re.sub(r'\{([A-Za-z_]+(?::[0-9]+)?)\}', _replace, fmt)


class ReceiveBatchRequest(BaseModel):
    sku_id:             int
    warehouse_id:       Optional[int] = None
    quantity_received:  int
    batch_name:         Optional[str] = None
    production_date:    Optional[str] = None   # YYYY-MM-DD
    expiry_date:        Optional[str] = None   # YYYY-MM-DD
    cost_per_unit:      Optional[float] = None
    notes:              Optional[str]   = None


@app.post("/api/projects/{project_id}/inventory/receive")
def receive_batch(project_id: int, req: ReceiveBatchRequest,
                  user: dict = Depends(get_current_user)):
    """Receive a new stock batch — bumps product_stock + creates inventory_batches row + audit log entry."""
    require_team_member_or_owner(user, project_id)
    if req.quantity_received <= 0:
        raise HTTPException(400, "quantity_received must be > 0")
    with db_cursor() as (conn, cur):
        _verify_sku_in_project(cur, req.sku_id, project_id)
        wh_id = req.warehouse_id or _default_warehouse_id(cur, project_id)
        if not wh_id: raise HTTPException(400, "No active warehouses in this project")
        _verify_warehouse_in_project(cur, wh_id, project_id)

        name = (req.batch_name or '').strip()[:80]
        if not name:
            name = _generate_batch_name(cur, project_id, req.sku_id, req.quantity_received) or f"B-{secrets.token_hex(3).upper()}"

        cur.execute(
            "INSERT INTO inventory_batches"
            "  (project_id, sku_id, warehouse_id, batch_name, quantity_received, quantity_remaining,"
            "   production_date, expiry_date, cost_per_unit, notes, received_by_user_id)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, received_at",
            (project_id, req.sku_id, wh_id, name,
             req.quantity_received, req.quantity_received,
             req.production_date or None, req.expiry_date or None,
             req.cost_per_unit, sanitize((req.notes or '')[:1000]),
             user["id"])
        )
        new_row = cur.fetchone()

        cur.execute(
            "INSERT INTO product_stock (sku_id, warehouse_id, quantity, sold_quantity)"
            " VALUES (%s, %s, %s, 0)"
            " ON CONFLICT (sku_id, warehouse_id)"
            " DO UPDATE SET quantity = product_stock.quantity + EXCLUDED.quantity",
            (req.sku_id, wh_id, req.quantity_received)
        )
        cur.execute(
            "INSERT INTO product_stock_log"
            "  (project_id, sku_id, warehouse_id, delta, reason, reference_id, user_id, note)"
            " VALUES (%s, %s, %s, %s, 'batch_receive', %s, %s, %s)",
            (project_id, req.sku_id, wh_id, req.quantity_received,
             new_row["id"], user["id"], f'Batch "{name}" received ({req.quantity_received} units)')
        )
        _sync_l2_stock(cur, req.sku_id)
        conn.commit()
    return {"ok": True, "batch_id": new_row["id"], "batch_name": name}


# Reasons accepted on the bulk-receive endpoint — anything else is rejected so the
# audit log stays clean. Free-form text goes in the `note` field instead.
RECEIVE_REASONS = {
    'supplier_delivery', 'initial_inventory', 'customer_return',
    'production', 'recount_adjust', 'transfer_in', 'other',
}

# Reasons accepted by the per-SKU stock-adjust endpoint. Superset of RECEIVE_REASONS
# (every receive reason is a valid +delta on adjust too) plus a few that only make
# sense as manual corrections: damage, transfer_out, manual. Legacy values
# (restock/return/transfer) are kept as aliases for back-compat — anything already
# in the audit log will still render. Frontend always picks from the new set.
ADJUST_REASONS = RECEIVE_REASONS | {
    'damage', 'transfer_out', 'manual',
    # Legacy aliases — kept so old saved values keep validating:
    'restock', 'return', 'transfer',
}


class BulkReceiveItem(BaseModel):
    sku_id:           int
    warehouse_id:     int
    quantity:         int
    # Batch routing: 'auto' (template), 'manual' (use batch_name), 'existing' (use target_batch_id).
    batch_choice:     str   = 'auto'
    batch_name:       Optional[str] = None
    target_batch_id:  Optional[int] = None
    reason:           Optional[str] = 'supplier_delivery'
    note:             Optional[str] = None
    # YYYY-MM-DD strings (or None). Auto-propagate within a group on the server when
    # batch_choice='auto' and the project's batch_grouping_mode is 'global' / 'product'.
    production_date:  Optional[str] = None
    expiry_date:      Optional[str] = None


class BulkReceiveRequest(BaseModel):
    items: list[BulkReceiveItem]


@app.post("/api/projects/{project_id}/inventory/bulk-receive")
def bulk_receive(project_id: int, req: BulkReceiveRequest,
                 user: dict = Depends(get_current_user)):
    """Receive stock for many SKUs at once. Each row either adds quantity to an
    existing batch, or creates a new one (auto-named or merchant-named). Mirrors
    /stock/bulk-transfer's all-or-nothing pattern: any single invalid row aborts
    the whole transaction so the merchant can fix and retry.
    """
    require_team_member_or_owner(user, project_id)
    if not req.items:
        raise HTTPException(400, "items must be non-empty")

    # ── Pre-flight validation (cheap, no writes) ─────────────────────────────
    def _parse_date(s: Optional[str], idx: int, label: str) -> Optional[str]:
        if not s: return None
        # Accept YYYY-MM-DD only. Keep as string — PostgreSQL parses on insert.
        try:
            datetime.strptime(s, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, f"row {idx+1}: {label} must be YYYY-MM-DD")
        return s

    cleaned: list[dict] = []
    for idx, it in enumerate(req.items):
        if it.quantity <= 0:
            raise HTTPException(400, f"row {idx+1}: quantity must be > 0")
        if it.batch_choice not in ('auto', 'manual', 'existing'):
            raise HTTPException(400, f"row {idx+1}: invalid batch_choice")
        if it.batch_choice == 'manual' and not (it.batch_name or '').strip():
            raise HTTPException(400, f"row {idx+1}: batch_name required when batch_choice='manual'")
        if it.batch_choice == 'existing' and not it.target_batch_id:
            raise HTTPException(400, f"row {idx+1}: target_batch_id required when batch_choice='existing'")
        reason = (it.reason or 'supplier_delivery').strip()
        if reason not in RECEIVE_REASONS:
            raise HTTPException(400, f"row {idx+1}: unknown reason '{reason}'")
        cleaned.append({
            "sku_id":          it.sku_id,
            "warehouse_id":    it.warehouse_id,
            "qty":             it.quantity,
            "batch_choice":    it.batch_choice,
            "batch_name":      (it.batch_name or '').strip()[:80] or None,
            "target_batch_id": it.target_batch_id,
            "reason":          reason,
            # NOTE: store as string (never None) — inventory_batches.notes is NOT NULL.
            # We track "no note" downstream by checking `if p['note']:`, not by None.
            "note":            sanitize((it.note or '')[:500]),
            "production_date": _parse_date(it.production_date, idx, 'production_date'),
            "expiry_date":     _parse_date(it.expiry_date,     idx, 'expiry_date'),
        })

    # ── Resolve project's batch_grouping_mode (default 'config' = current behaviour). ─
    # Used below to: (a) share one auto-generated batch name across rows in the same
    # group, and (b) propagate production/expiry dates inside the same group when the
    # merchant only filled them on one row.
    proj = db_one("SELECT batch_grouping_mode FROM crm_projects WHERE id=%s", (project_id,))
    grouping = (proj or {}).get('batch_grouping_mode') or 'config'

    # ── Apply in one transaction ─────────────────────────────────────────────
    batches_created = 0
    batches_updated = 0
    total_units     = 0
    with db_cursor() as (conn, cur):
        # Pre-compute group keys for every row + cache product_id per sku_id.
        sku_to_product: dict[int, int] = {}

        def _group_key_for(row: dict) -> str:
            if grouping == 'global':  return 'G'
            if grouping == 'product':
                sid = row["sku_id"]
                if sid not in sku_to_product:
                    r = db_one(
                        "SELECT v.product_id FROM product_configurations_l2 c"
                        "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
                        " WHERE c.id=%s", (sid,)
                    )
                    sku_to_product[sid] = int((r or {}).get('product_id') or 0)
                return f"P{sku_to_product[sid]}"
            # 'config' or anything unknown → unique per row (use sku+wh as key).
            return f"C{row['sku_id']}-{row['warehouse_id']}"

        # Build group → first-seen dates + shared auto-name slot (lazy-filled when
        # the first 'auto' row in that group reaches the loop body).
        group_dates: dict[str, dict] = {}
        group_auto_name: dict[str, str] = {}
        for p in cleaned:
            key = _group_key_for(p)
            p["_group_key"] = key
            d = group_dates.setdefault(key, {"production_date": None, "expiry_date": None})
            if p["production_date"] and not d["production_date"]:
                d["production_date"] = p["production_date"]
            if p["expiry_date"]     and not d["expiry_date"]:
                d["expiry_date"]     = p["expiry_date"]

        for idx, p in enumerate(cleaned):
            _verify_sku_in_project(cur, p["sku_id"], project_id)
            _verify_warehouse_in_project(cur, p["warehouse_id"], project_id)

            # Pull group-shared dates as fallbacks — only if the row didn't supply its own.
            gkey = p["_group_key"]
            prod_date = p["production_date"] or group_dates[gkey]["production_date"]
            exp_date  = p["expiry_date"]     or group_dates[gkey]["expiry_date"]

            if p["batch_choice"] == 'existing':
                # Add quantity to an existing batch row. Lock it to avoid the
                # race where two concurrent receivers fight over remaining/received.
                cur.execute(
                    "SELECT id, sku_id, warehouse_id, batch_name FROM inventory_batches"
                    " WHERE id=%s AND project_id=%s FOR UPDATE",
                    (p["target_batch_id"], project_id)
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(400, f"row {idx+1}: target batch not found")
                if row["sku_id"] != p["sku_id"] or row["warehouse_id"] != p["warehouse_id"]:
                    raise HTTPException(400, f"row {idx+1}: target batch belongs to a different SKU/warehouse")
                cur.execute(
                    "UPDATE inventory_batches"
                    "   SET quantity_received  = quantity_received  + %s,"
                    "       quantity_remaining = quantity_remaining + %s"
                    " WHERE id=%s",
                    (p["qty"], p["qty"], row["id"])
                )
                used_batch_id   = row["id"]
                used_batch_name = row["batch_name"]
                batches_updated += 1
            else:
                # Create a new batch row. For batch_choice='auto' we reuse the
                # group's shared name (and shared dates) when grouping is global/product.
                name = p["batch_name"]
                if not name:
                    # Reuse the auto-name generated for the first 'auto' row of this group.
                    if gkey in group_auto_name:
                        name = group_auto_name[gkey]
                    else:
                        name = _generate_batch_name(cur, project_id, p["sku_id"], p["qty"]) \
                               or f"B-{secrets.token_hex(3).upper()}"
                        group_auto_name[gkey] = name
                cur.execute(
                    "INSERT INTO inventory_batches"
                    "  (project_id, sku_id, warehouse_id, batch_name,"
                    "   quantity_received, quantity_remaining,"
                    "   production_date, expiry_date,"
                    "   notes, received_by_user_id)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (project_id, p["sku_id"], p["warehouse_id"], name,
                     p["qty"], p["qty"],
                     prod_date, exp_date,
                     p["note"], user["id"])
                )
                used_batch_id   = cur.fetchone()["id"]
                used_batch_name = name
                batches_created += 1

            # Bump warehouse-level stock + write the audit row. The audit `note`
            # captures both the user-typed reason and any free-text note.
            cur.execute(
                "INSERT INTO product_stock (sku_id, warehouse_id, quantity, sold_quantity)"
                " VALUES (%s, %s, %s, 0)"
                " ON CONFLICT (sku_id, warehouse_id)"
                " DO UPDATE SET quantity = product_stock.quantity + EXCLUDED.quantity",
                (p["sku_id"], p["warehouse_id"], p["qty"])
            )
            audit_note = f'Batch "{used_batch_name}" · reason: {p["reason"]}'
            if p["note"]: audit_note += f' · {p["note"]}'
            cur.execute(
                "INSERT INTO product_stock_log"
                "  (project_id, sku_id, warehouse_id, delta, reason, reference_id, user_id, note)"
                " VALUES (%s, %s, %s, %s, 'batch_receive', %s, %s, %s)",
                (project_id, p["sku_id"], p["warehouse_id"], p["qty"],
                 used_batch_id, user["id"], audit_note)
            )
            _sync_l2_stock(cur, p["sku_id"])
            total_units += p["qty"]

        conn.commit()

    return {
        "ok": True,
        "batches_created": batches_created,
        "batches_updated": batches_updated,
        "rows_applied":    len(cleaned),
        "total_units":     total_units,
    }


@app.get("/api/projects/{project_id}/batches")
def list_batches(project_id: int, sku_id: Optional[int] = Query(None),
                 warehouse_id: Optional[int] = Query(None),
                 frozen: Optional[bool] = Query(None),
                 cursor: Optional[str] = Query(None),
                 limit:  Optional[int] = Query(None),
                 user: dict = Depends(get_current_user)):
    """List batches with optional filters + cursor pagination. Returns joined product/warehouse names."""
    require_team_member_or_owner(user, project_id)
    want_pagination, offset, page_size = _pagination_params(cursor, limit)
    where = ["b.project_id = %s"]
    params: list = [project_id]
    if sku_id is not None:       where.append("b.sku_id = %s");       params.append(sku_id)
    if warehouse_id is not None: where.append("b.warehouse_id = %s"); params.append(warehouse_id)
    if frozen is not None:       where.append("b.is_frozen = %s");    params.append(frozen)
    sql = (
        "SELECT b.id, b.batch_name, b.quantity_received, b.quantity_remaining,"
        "       b.production_date, b.expiry_date, b.cost_per_unit, b.is_frozen,"
        "       b.notes, b.received_at, b.received_by_user_id,"
        "       b.sku_id, l2.configuration_name AS sku_name, l2.sku_code,"
        "       l1.id AS variation_id, l1.variation_name,"
        "       p.id AS product_id, p.title AS product_title,"
        "       b.warehouse_id, w.name AS warehouse_name, w.code AS warehouse_code,"
        "       u.name AS received_by_name"
        "  FROM inventory_batches b"
        "  JOIN product_configurations_l2 l2 ON b.sku_id = l2.id"
        "  JOIN product_configurations_l1 l1 ON l2.variation_id = l1.id"
        "  JOIN products p                  ON l1.product_id = p.id"
        "  JOIN warehouses w                ON b.warehouse_id = w.id"
        "  LEFT JOIN crm_users u            ON b.received_by_user_id = u.id"
        " WHERE " + " AND ".join(where) +
        " ORDER BY b.received_at DESC"
    )
    if want_pagination:
        sql += " LIMIT %s OFFSET %s"
        params.extend([page_size + 1, offset])
    rows = db_all(sql, tuple(params))
    return _wrap_paginated(want_pagination, rows, offset, page_size)


@app.get("/api/projects/{project_id}/batches/lookup")
def lookup_batches_for_target(project_id: int, sku_id: int = Query(...),
                              warehouse_id: int = Query(...),
                              user: dict = Depends(get_current_user)):
    """Used by the BulkTransferWizard Batch column — returns active (non-frozen) batches available as a target for adding more stock at (sku, warehouse)."""
    require_team_member_or_owner(user, project_id)
    rows = db_all(
        "SELECT id, batch_name, quantity_remaining, quantity_received, production_date, expiry_date"
        "  FROM inventory_batches"
        " WHERE project_id=%s AND sku_id=%s AND warehouse_id=%s AND is_frozen = FALSE"
        " ORDER BY received_at DESC LIMIT 50",
        (project_id, sku_id, warehouse_id)
    )
    return rows


@app.get("/api/projects/{project_id}/batches/{batch_id}")
def get_batch(project_id: int, batch_id: int, user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one(
        "SELECT b.*, l2.configuration_name AS sku_name, l2.sku_code,"
        "       l1.variation_name, p.title AS product_title,"
        "       w.name AS warehouse_name, u.name AS received_by_name"
        "  FROM inventory_batches b"
        "  JOIN product_configurations_l2 l2 ON b.sku_id = l2.id"
        "  JOIN product_configurations_l1 l1 ON l2.variation_id = l1.id"
        "  JOIN products p                  ON l1.product_id = p.id"
        "  JOIN warehouses w                ON b.warehouse_id = w.id"
        "  LEFT JOIN crm_users u            ON b.received_by_user_id = u.id"
        " WHERE b.id = %s AND b.project_id = %s",
        (batch_id, project_id)
    )
    if not row: raise HTTPException(404, "Batch not found")
    return row


class BatchUpdateRequest(BaseModel):
    batch_name:      Optional[str]   = None
    production_date: Optional[str]   = None
    expiry_date:     Optional[str]   = None
    cost_per_unit:   Optional[float] = None
    notes:           Optional[str]   = None
    is_frozen:       Optional[bool]  = None


@app.put("/api/projects/{project_id}/batches/{batch_id}")
def update_batch(project_id: int, batch_id: int, req: BatchUpdateRequest,
                 user: dict = Depends(get_current_user)):
    """Edit batch metadata. Freezing a batch removes its quantity_remaining from the SKU's available stock; un-freezing restores it."""
    require_team_member_or_owner(user, project_id)
    sent = req.model_dump(exclude_unset=True)
    if not sent: return {"ok": True}

    with db_cursor() as (conn, cur):
        # Lock the batch row up front so the read of quantity_remaining is a
        # consistent snapshot until commit. Without FOR UPDATE a concurrent
        # purchase could decrement quantity_remaining between this SELECT and
        # the UPDATE product_stock below — freeze would subtract units that
        # were ALSO just decremented by the sale, double-counting them.
        cur.execute("SELECT sku_id, warehouse_id, is_frozen, quantity_remaining"
                    "  FROM inventory_batches WHERE id=%s AND project_id=%s"
                    "  FOR UPDATE",
                    (batch_id, project_id))
        cur_row = cur.fetchone()
        if not cur_row: raise HTTPException(404, "Batch not found")

        fields, vals = [], []
        if 'batch_name'      in sent: fields.append("batch_name=%s");      vals.append(sanitize(sent['batch_name'])[:80])
        if 'production_date' in sent: fields.append("production_date=%s"); vals.append(sent['production_date'])
        if 'expiry_date'     in sent: fields.append("expiry_date=%s");     vals.append(sent['expiry_date'])
        if 'cost_per_unit'   in sent: fields.append("cost_per_unit=%s");   vals.append(sent['cost_per_unit'])
        if 'notes'           in sent: fields.append("notes=%s");           vals.append(sanitize(sent['notes'] or '')[:1000])
        freeze_changed = False
        if 'is_frozen'       in sent and bool(sent['is_frozen']) != bool(cur_row['is_frozen']):
            fields.append("is_frozen=%s"); vals.append(bool(sent['is_frozen']))
            freeze_changed = True

        if fields:
            vals.extend([batch_id, project_id])
            cur.execute("UPDATE inventory_batches SET " + ", ".join(fields) +
                        " WHERE id=%s AND project_id=%s", vals)

        # If freeze flipped, propagate to product_stock (frozen quantity becomes unavailable).
        if freeze_changed:
            # Also lock the product_stock row to serialise any concurrent
            # checkout writing to the same (sku, warehouse). Without this the
            # checkout's INSERT ... ON CONFLICT can interleave with our UPDATE
            # and leave product_stock out of sync with batch totals.
            cur.execute(
                "SELECT quantity FROM product_stock"
                " WHERE sku_id=%s AND warehouse_id=%s FOR UPDATE",
                (cur_row['sku_id'], cur_row['warehouse_id'])
            )
            delta = -int(cur_row['quantity_remaining']) if sent['is_frozen'] else int(cur_row['quantity_remaining'])
            cur.execute(
                "UPDATE product_stock SET quantity = GREATEST(quantity + %s, 0)"
                " WHERE sku_id=%s AND warehouse_id=%s",
                (delta, cur_row['sku_id'], cur_row['warehouse_id'])
            )
            cur.execute(
                "INSERT INTO product_stock_log"
                "  (project_id, sku_id, warehouse_id, delta, reason, reference_id, user_id, note)"
                " VALUES (%s, %s, %s, %s, 'batch_freeze', %s, %s, %s)",
                (project_id, cur_row['sku_id'], cur_row['warehouse_id'], delta,
                 batch_id, user["id"],
                 f"Batch {'frozen' if sent['is_frozen'] else 'unfrozen'}")
            )
            _sync_l2_stock(cur, cur_row['sku_id'])
        conn.commit()
    return {"ok": True}


@app.delete("/api/projects/{project_id}/batches/{batch_id}")
def delete_batch(project_id: int, batch_id: int, user: dict = Depends(get_current_user)):
    """Delete a batch — only allowed when quantity_remaining == quantity_received (i.e. nothing has been sold from it). Otherwise audit trail would be broken."""
    require_team_member_or_owner(user, project_id)
    row = db_one(
        "SELECT sku_id, warehouse_id, quantity_remaining, quantity_received"
        "  FROM inventory_batches WHERE id=%s AND project_id=%s",
        (batch_id, project_id)
    )
    if not row: raise HTTPException(404, "Batch not found")
    if row["quantity_remaining"] != row["quantity_received"]:
        raise HTTPException(400, "Cannot delete a batch that has already been partially consumed — freeze it instead")
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE product_stock SET quantity = GREATEST(quantity - %s, 0)"
            " WHERE sku_id=%s AND warehouse_id=%s",
            (row["quantity_received"], row["sku_id"], row["warehouse_id"])
        )
        cur.execute("DELETE FROM inventory_batches WHERE id=%s AND project_id=%s",
                    (batch_id, project_id))
        _sync_l2_stock(cur, row["sku_id"])
        cur.execute(
            "INSERT INTO product_stock_log"
            "  (project_id, sku_id, warehouse_id, delta, reason, reference_id, user_id, note)"
            " VALUES (%s, %s, %s, %s, 'batch_delete', %s, %s, %s)",
            (project_id, row["sku_id"], row["warehouse_id"],
             -row["quantity_received"], batch_id, user["id"],
             'Batch deleted — never consumed')
        )
        conn.commit()
    return {"ok": True}


# Org-level: batch naming format (template the user types) + project-level: consumption mode + barcode defaults. Two endpoints because they live in different tables.
@app.get("/api/orgs/{org_id}/batch-settings")
def get_org_batch_settings(org_id: int, user: dict = Depends(get_current_user)):
    require_org_owner(user, org_id)
    row = db_one(
        "SELECT batch_naming_mode, batch_naming_format FROM crm_organizations WHERE id=%s",
        (org_id,)
    )
    if not row: raise HTTPException(404, "Org not found")
    return row


class OrgBatchSettingsRequest(BaseModel):
    batch_naming_mode:   Optional[str] = None    # 'auto' | 'manual'
    batch_naming_format: Optional[str] = None


@app.put("/api/orgs/{org_id}/batch-settings")
def update_org_batch_settings(org_id: int, req: OrgBatchSettingsRequest,
                              user: dict = Depends(get_current_user)):
    require_org_owner(user, org_id)
    sent = req.model_dump(exclude_unset=True)
    if 'batch_naming_mode' in sent and sent['batch_naming_mode'] not in ('auto', 'manual'):
        raise HTTPException(400, "batch_naming_mode must be 'auto' or 'manual'")
    if not sent: return {"ok": True}
    fields, vals = [], []
    if 'batch_naming_mode'   in sent: fields.append("batch_naming_mode=%s");   vals.append(sent['batch_naming_mode'])
    if 'batch_naming_format' in sent: fields.append("batch_naming_format=%s"); vals.append(sanitize(sent['batch_naming_format'] or '')[:80])
    vals.append(org_id)
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE crm_organizations SET " + ", ".join(fields) + " WHERE id=%s", vals)
        conn.commit()
    return {"ok": True}


@app.get("/api/projects/{project_id}/batch-settings")
def get_project_batch_settings(project_id: int, user: dict = Depends(get_current_user)):
    """Project-level consumption + barcode encoding defaults + pricing display + batch naming (all project-level now)."""
    require_team_member_or_owner(user, project_id)
    row = db_one(
        "SELECT pr.batch_consumption_mode,"
        "       pr.barcode_include_date, pr.barcode_include_batch,"
        "       pr.barcode_include_qty,  pr.barcode_include_serial,"
        "       pr.barcode_binding,"
        "       pr.hide_price_in_overview, pr.default_margin_percent,"
        "       pr.batch_naming_mode, pr.batch_naming_format,"
        "       pr.batch_grouping_mode"
        "  FROM crm_projects pr"
        " WHERE pr.id = %s",
        (project_id,)
    )
    if not row: raise HTTPException(404, "Project not found")
    return row


class ProjectBatchSettingsRequest(BaseModel):
    batch_consumption_mode: Optional[str]   = None     # 'fifo' | 'lifo'
    barcode_include_date:   Optional[bool]  = None
    barcode_include_batch:  Optional[bool]  = None
    barcode_include_qty:    Optional[bool]  = None
    barcode_include_serial: Optional[bool]  = None
    barcode_binding:        Optional[str]   = None     # 'batch' | 'sku'
    hide_price_in_overview: Optional[bool]  = None
    default_margin_percent: Optional[float] = None
    batch_naming_mode:      Optional[str]   = None     # 'auto' | 'manual'
    batch_naming_format:    Optional[str]   = None
    batch_grouping_mode:    Optional[str]   = None     # 'global' | 'product' | 'config'


@app.put("/api/projects/{project_id}/batch-settings")
def update_project_batch_settings(project_id: int, req: ProjectBatchSettingsRequest,
                                  user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    sent = req.model_dump(exclude_unset=True)
    if 'batch_consumption_mode' in sent and sent['batch_consumption_mode'] not in ('fifo', 'lifo'):
        raise HTTPException(400, "batch_consumption_mode must be 'fifo' or 'lifo'")
    if 'default_margin_percent' in sent and sent['default_margin_percent'] is not None:
        m = float(sent['default_margin_percent'])
        if m < 0 or m > 10000:
            raise HTTPException(400, "default_margin_percent must be in 0..10000")
    if 'batch_naming_mode' in sent and sent['batch_naming_mode'] not in ('auto', 'manual'):
        raise HTTPException(400, "batch_naming_mode must be 'auto' or 'manual'")
    if 'batch_grouping_mode' in sent and sent['batch_grouping_mode'] not in ('global', 'product', 'config'):
        raise HTTPException(400, "batch_grouping_mode must be 'global', 'product' or 'config'")
    if 'barcode_binding' in sent and sent['barcode_binding'] not in ('batch', 'sku'):
        raise HTTPException(400, "barcode_binding must be 'batch' or 'sku'")
    if not sent: return {"ok": True}
    fields, vals = [], []
    for k in ('batch_consumption_mode', 'barcode_include_date', 'barcode_include_batch',
              'barcode_include_qty', 'barcode_include_serial', 'barcode_binding',
              'hide_price_in_overview', 'default_margin_percent',
              'batch_naming_mode', 'batch_naming_format',
              'batch_grouping_mode'):
        if k in sent:
            val = sent[k]
            if k == 'batch_naming_format': val = sanitize(val or '')[:80]
            fields.append(f"{k}=%s"); vals.append(val)
    vals.append(project_id)
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE crm_projects SET " + ", ".join(fields) + " WHERE id=%s", vals)
        conn.commit()
    return {"ok": True}


# ── EVENT TICKETS (CRM-side) ─────────────────────────────
# Lists issued tickets per project. Source = order_items where product.product_type='event'. Used by /project/:apiKey/tickets.

@app.get("/api/projects/{project_id}/tickets/issued")
def list_issued_tickets(project_id: int, search: Optional[str] = Query(None),
                        status: Optional[str] = Query(None),
                        cursor: Optional[str] = Query(None),
                        limit:  Optional[int] = Query(None),
                        user: dict = Depends(get_current_user)):
    """List event tickets sold through this project — joined order/customer info + access code. Cursor pagination."""
    require_team_member_or_owner(user, project_id)
    want_pagination, offset, page_size = _pagination_params(cursor, limit)
    where = ["p.project_id = %s", "p.product_type = 'event'"]
    params: list = [project_id]
    if status:
        where.append("oh.status = %s"); params.append(status)
    if search:
        where.append("(oh.recipient_name ILIKE %s OR oi.access_code ILIKE %s OR p.title ILIKE %s)")
        s = f"%{search.strip()}%"
        params += [s, s, s]
    sql = (
        "SELECT oi.id AS item_id, oi.quantity, oi.access_code, oi.price,"
        "       oh.id AS order_id, oh.status, oh.recipient_name, oh.phone, oh.created_at,"
        "       p.id AS product_id, p.title,"
        "       pv.variation_name"
        "  FROM order_items oi"
        "  JOIN order_history oh ON oi.order_id = oh.id"
        "  JOIN products p ON oi.product_id = p.id"
        "  LEFT JOIN product_configurations_l1 pv ON oi.variation_id = pv.id"
        " WHERE " + " AND ".join(where) +
        " ORDER BY oh.created_at DESC"
    )
    fetch_limit = (page_size + 1) if want_pagination else 500
    sql += " LIMIT %s" + (" OFFSET %s" if want_pagination else "")
    params.append(fetch_limit)
    if want_pagination:
        params.append(offset)
    rows = db_all(sql, tuple(params))
    return _wrap_paginated(want_pagination, rows, offset, page_size)


# Stock adjust + audit log: manual restock/write-off/damage; updates stock + emits product_stock_log row.

@app.post("/api/products/{product_id}/stock/adjust")
def adjust_stock(product_id: int, req: StockAdjustRequest,
                 project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    # Validate SKU belongs to this product + project.
    sku = db_one(
        "SELECT c.id FROM product_configurations_l2 c"
        "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
        "  JOIN products p ON v.product_id = p.id"
        " WHERE c.id=%s AND p.id=%s AND p.project_id=%s",
        (req.sku_id, product_id, project_id)
    )
    if not sku: raise HTTPException(404, "SKU not found in this product")
    # Unified reason set — same as RECEIVE_REASONS plus a few that only make sense for
    # manual adjustments (damage, transfer_out, manual, other). Old values are still
    # accepted so historical UI and existing audit-log rows keep working.
    if req.reason not in ADJUST_REASONS:
        raise HTTPException(400, "Invalid reason")
    delta = int(req.delta)
    if delta == 0: raise HTTPException(400, "Delta must be non-zero")
    if req.batch_id is not None and req.new_batch_name:
        raise HTTPException(400, "Pass either batch_id OR new_batch_name, not both")
    if req.new_batch_name and delta < 0:
        raise HTTPException(400, "new_batch_name is only valid for positive deltas")
    with db_cursor() as (conn, cur):
        # Resolve target warehouse (request value, or project's default).
        if req.warehouse_id is not None:
            _verify_warehouse_in_project(cur, req.warehouse_id, project_id)
            wh_id = req.warehouse_id
        else:
            wh_id = _default_warehouse_id(cur, project_id)
        # Lock the per-(sku, warehouse) row before reading current quantity to
        # avoid races between two concurrent admins editing the same SKU.
        cur.execute(
            "SELECT quantity FROM product_stock"
            " WHERE sku_id=%s AND warehouse_id=%s FOR UPDATE",
            (req.sku_id, wh_id)
        )
        existing = cur.fetchone()
        old_qty_wh = int((existing or {}).get("quantity") or 0)
        new_qty_wh = old_qty_wh + delta
        if new_qty_wh < 0:
            raise HTTPException(400, "Resulting stock would be negative on this warehouse")
        # Aggregate across all warehouses — used to detect the "0→positive" transition.
        cur.execute(
            "SELECT COALESCE(SUM(quantity), 0) AS total"
            "  FROM product_stock WHERE sku_id=%s",
            (req.sku_id,)
        )
        was_zero = int((cur.fetchone() or {}).get("total") or 0) == 0
        # ── Batch routing (optional) ─────────────────────────────────────
        # When batch_id or new_batch_name is supplied, also adjust an inventory_batches
        # row so the Batches page reflects the manual change. Without these fields the
        # legacy path runs — product_stock is bumped but no batch is touched.
        touched_batch_id   = None
        touched_batch_name = None
        if req.batch_id is not None:
            cur.execute(
                "SELECT id, batch_name, sku_id, warehouse_id, quantity_remaining"
                "  FROM inventory_batches"
                " WHERE id=%s AND project_id=%s FOR UPDATE",
                (req.batch_id, project_id)
            )
            brow = cur.fetchone()
            if not brow:
                raise HTTPException(400, "Batch not found in this project")
            if brow["sku_id"] != req.sku_id or brow["warehouse_id"] != wh_id:
                raise HTTPException(400, "Batch belongs to a different SKU/warehouse")
            new_remaining = int(brow["quantity_remaining"]) + delta
            if new_remaining < 0:
                raise HTTPException(400, "Resulting batch remaining would be negative")
            if delta > 0:
                cur.execute(
                    "UPDATE inventory_batches"
                    "   SET quantity_received  = quantity_received  + %s,"
                    "       quantity_remaining = quantity_remaining + %s"
                    " WHERE id=%s",
                    (delta, delta, brow["id"])
                )
            else:
                cur.execute(
                    "UPDATE inventory_batches"
                    "   SET quantity_remaining = quantity_remaining + %s"
                    " WHERE id=%s",
                    (delta, brow["id"])   # delta is negative, so this subtracts
                )
            touched_batch_id   = brow["id"]
            touched_batch_name = brow["batch_name"]
        elif req.new_batch_name:
            # delta>0 enforced above. Create a fresh batch row at this WH.
            name = (req.new_batch_name or '').strip()[:80] \
                   or (_generate_batch_name(cur, project_id, req.sku_id, delta)
                       or f"B-{secrets.token_hex(3).upper()}")
            cur.execute(
                "INSERT INTO inventory_batches"
                "  (project_id, sku_id, warehouse_id, batch_name,"
                "   quantity_received, quantity_remaining, received_by_user_id)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (project_id, req.sku_id, wh_id, name, delta, delta, user["id"])
            )
            touched_batch_id   = cur.fetchone()["id"]
            touched_batch_name = name

        # Upsert per-WH stock.
        cur.execute(
            "INSERT INTO product_stock (sku_id, warehouse_id, quantity, sold_quantity)"
            " VALUES (%s, %s, %s, 0)"
            " ON CONFLICT (sku_id, warehouse_id)"
            " DO UPDATE SET quantity = product_stock.quantity + EXCLUDED.quantity",
            (req.sku_id, wh_id, delta)
        )
        # Sync L2 aggregate so callers reading l2.stock_quantity see the new sum.
        _sync_l2_stock(cur, req.sku_id)
        audit_note = sanitize(req.note or '')[:1000]
        if touched_batch_name:
            tag = f'[batch: {touched_batch_name}]'
            audit_note = f"{tag} {audit_note}".strip() if audit_note else tag
        cur.execute(
            "INSERT INTO product_stock_log"
            "  (project_id, sku_id, warehouse_id, delta, reason, reference_id, user_id, note)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (project_id, req.sku_id, wh_id, delta, req.reason,
             touched_batch_id, user["id"], audit_note)
        )
        # Recompute new aggregate for the response (so the UI doesn't need a refetch).
        cur.execute(
            "SELECT COALESCE(SUM(quantity), 0) AS total"
            "  FROM product_stock WHERE sku_id=%s",
            (req.sku_id,)
        )
        new_qty = int((cur.fetchone() or {}).get("total") or 0)
        # Phase 6: restock notifications when stock transitions 0 → >0 (mark subs pending; send async).
        notify_emails = []
        if was_zero and new_qty > 0:
            cur.execute(
                "SELECT id, email FROM product_restock_subscriptions"
                " WHERE (sku_id=%s OR sku_id IS NULL) AND notified_at IS NULL"
                "   AND product_id = (SELECT v.product_id FROM product_configurations_l1 v"
                "                      JOIN product_configurations_l2 c ON c.variation_id=v.id"
                "                      WHERE c.id=%s)",
                (req.sku_id, req.sku_id)
            )
            subs = cur.fetchall() or []
            notify_emails = [(s["id"], s["email"]) for s in subs]
            if notify_emails:
                ids = [s[0] for s in notify_emails]
                cur.execute(
                    "UPDATE product_restock_subscriptions SET notified_at=NOW() WHERE id = ANY(%s)",
                    (ids,)
                )
        conn.commit()
    # Fire-and-forget restock notifications post-commit (CRM sends from platform default).
    for _, email in notify_emails:
        try:
            send_email(
                to=email,
                subject="Back in stock — your wishlist item is available",
                html=("<p>Good news — the item you were watching is back in stock.</p>"
                      "<p>Visit the store to grab it before it sells out.</p>"),
            )
        except Exception:
            pass
    return {"ok": True, "new_quantity": new_qty, "notified": len(notify_emails)}


@app.get("/api/products/{product_id}/stock/log")
def get_stock_log(product_id: int, project_id: int = Query(...), limit: int = Query(100),
                   user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    rows = db_all(
        "SELECT sl.id, sl.sku_id, sl.warehouse_id, sl.delta, sl.reason,"
        "       sl.reference_id, sl.user_id, sl.note, sl.created_at,"
        "       u.name AS user_name, c.configuration_name AS sku_name"
        "  FROM product_stock_log sl"
        "  JOIN product_configurations_l2 c ON sl.sku_id = c.id"
        "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
        "  LEFT JOIN crm_users u ON sl.user_id = u.id"
        " WHERE v.product_id=%s AND sl.project_id=%s"
        " ORDER BY sl.created_at DESC LIMIT %s",
        (product_id, project_id, max(1, min(int(limit), 500)))
    )
    for r in rows:
        r["created_at"] = r["created_at"].isoformat() if r["created_at"] else None
    return rows


@app.get("/api/products/{product_id}/stock/per-warehouse")
def get_per_warehouse_stock(product_id: int, project_id: int = Query(...),
                              user: dict = Depends(get_current_user)):
    """Per-SKU per-warehouse stock matrix for product: [{sku_id, sku_name, variation_name, warehouses[]}]."""
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    skus = db_all(
        "SELECT c.id AS sku_id, c.configuration_name AS sku_name, c.sku_code,"
        "       v.variation_name, v.id AS variation_id, c.position"
        "  FROM product_configurations_l2 c"
        "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
        " WHERE v.product_id = %s"
        " ORDER BY v.position ASC, c.position ASC, c.id ASC",
        (product_id,)
    )
    if not skus: return []
    warehouses = db_all(
        "SELECT id, name, code, is_default FROM warehouses"
        " WHERE project_id=%s AND is_active=TRUE"
        " ORDER BY is_default DESC, name ASC",
        (project_id,)
    )
    sku_ids = [s["sku_id"] for s in skus]
    stock_rows = db_all(
        "SELECT sku_id, warehouse_id, quantity, sold_quantity FROM product_stock"
        " WHERE sku_id = ANY(%s)",
        (sku_ids,)
    )
    # Map (sku, wh) → (qty, sold) for per-WH tree to show sold counts in one round-trip.
    by_pair = {
        (r["sku_id"], r["warehouse_id"]): (int(r["quantity"]), int(r["sold_quantity"] or 0))
        for r in stock_rows
    }
    return [
        {
            "sku_id":           s["sku_id"],
            "sku_name":         s["sku_name"],
            "sku_code":         s.get("sku_code") or "",
            "variation_id":     s["variation_id"],
            "variation_name":   s["variation_name"],
            "warehouses": [
                {
                    "warehouse_id":  w["id"],
                    "name":          w["name"],
                    "code":          w.get("code") or "",
                    "is_default":    bool(w["is_default"]),
                    "quantity":      by_pair.get((s["sku_id"], w["id"]), (0, 0))[0],
                    "sold_quantity": by_pair.get((s["sku_id"], w["id"]), (0, 0))[1],
                }
                for w in warehouses
            ],
        }
        for s in skus
    ]


@app.get("/api/projects/{project_id}/stock/per-warehouse-summary")
def get_project_stock_summary(project_id: int,
                                user: dict = Depends(get_current_user)):
    """Project-wide snapshot for Inventory 'by Warehouse' view: one row per (warehouse, sku) with stock."""
    require_team_member_or_owner(user, project_id)
    rows = db_all(
        "SELECT ps.warehouse_id, ps.sku_id, ps.quantity, ps.sold_quantity,"
        "       w.name AS warehouse_name, w.code AS warehouse_code, w.is_default,"
        "       c.configuration_name AS sku_name, c.sku_code,"
        "       v.id AS variation_id, v.variation_name,"
        "       (v.images)[1] AS variation_image,"
        "       p.id AS product_id, p.title AS product_title, p.sku AS product_sku,"
        "       (SELECT (vv.images)[1] FROM product_configurations_l1 vv"
        "         WHERE vv.product_id = p.id ORDER BY vv.position ASC, vv.id ASC LIMIT 1) AS product_image"
        "  FROM product_stock ps"
        "  JOIN warehouses w ON ps.warehouse_id = w.id"
        "  JOIN product_configurations_l2 c ON ps.sku_id = c.id"
        "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
        "  JOIN products p ON v.product_id = p.id"
        " WHERE w.project_id=%s AND w.is_active"
        " ORDER BY w.is_default DESC, w.name ASC, p.title ASC, v.position ASC, c.position ASC",
        (project_id,)
    )
    return rows


@app.post("/api/projects/{project_id}/stock/bulk-transfer")
def bulk_transfer_stock(project_id: int, body: dict = Body(...),
                         user: dict = Depends(get_current_user)):
    """Atomic multi-line warehouse transfer + batch assignment (max 500 rows).
    Body: { transfers: [{ sku_id, from_warehouse_id, to_warehouse_id, quantity, note?,
                          target_batch_id?: int, target_batch_name?: str }, ...] }.
    Batch assignment rules per row:
      - target_batch_id set → append qty to that existing inventory_batches row
      - target_batch_name set → create a NEW inventory_batches row with that name (multi-SKU batches share a name but get one row per (sku, warehouse))
      - neither → auto-generate a name from the project's batch_naming_format (auto mode) or fall back to "B-XXXXXX"
    """
    require_team_member_or_owner(user, project_id)
    raw = body.get("transfers") if isinstance(body, dict) else None
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "transfers must be a non-empty array")
    if len(raw) > 500:
        raise HTTPException(400, "Too many transfers in one request (max 500)")

    # Validate every row in pure Python before touching the DB. Any failure short-circuits the whole batch.
    parsed = []
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            raise HTTPException(400, f"transfers[{i}] must be an object")
        try:
            sku_id   = int(row["sku_id"])
            from_wh  = int(row["from_warehouse_id"])
            to_wh    = int(row["to_warehouse_id"])
            qty      = int(row["quantity"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, f"transfers[{i}] missing or non-integer field")
        if from_wh == to_wh: raise HTTPException(400, f"transfers[{i}]: from and to are the same warehouse")
        if qty <= 0:         raise HTTPException(400, f"transfers[{i}]: quantity must be > 0")
        note = sanitize(str(row.get("note") or ''))[:500]
        # Batch target (optional).
        target_batch_id   = row.get("target_batch_id")
        target_batch_name = (row.get("target_batch_name") or '').strip()[:80]
        if target_batch_id is not None:
            try: target_batch_id = int(target_batch_id)
            except (TypeError, ValueError): raise HTTPException(400, f"transfers[{i}].target_batch_id must be int")
        parsed.append({
            "sku_id": sku_id, "from_wh": from_wh, "to_wh": to_wh, "qty": qty, "note": note,
            "target_batch_id":   target_batch_id,
            "target_batch_name": target_batch_name,
        })

    affected_skus = set()
    with db_cursor() as (conn, cur):
        # IDOR guards — verify every referenced sku/WH belongs to THIS project.
        sku_ids = list({p["sku_id"] for p in parsed})
        wh_ids  = list({w for p in parsed for w in (p["from_wh"], p["to_wh"])})
        cur.execute(
            "SELECT c.id FROM product_configurations_l2 c"
            "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
            "  JOIN products p                  ON v.product_id   = p.id"
            " WHERE p.project_id=%s AND c.id = ANY(%s)",
            (project_id, sku_ids)
        )
        ok_sku = {r["id"] for r in cur.fetchall()}
        for s in sku_ids:
            if s not in ok_sku: raise HTTPException(404, f"SKU {s} not found in this project")
        cur.execute("SELECT id FROM warehouses WHERE project_id=%s AND id = ANY(%s)",
                    (project_id, wh_ids))
        ok_wh = {r["id"] for r in cur.fetchall()}
        for w in wh_ids:
            if w not in ok_wh: raise HTTPException(404, f"Warehouse {w} not found in this project")

        # Apply transfers — order by (sku, from_wh) so deadlocks between concurrent
        # batches resolve deterministically.
        parsed.sort(key=lambda p: (p["sku_id"], p["from_wh"], p["to_wh"]))
        for p in parsed:
            cur.execute(
                "SELECT quantity FROM product_stock"
                " WHERE sku_id=%s AND warehouse_id=%s FOR UPDATE",
                (p["sku_id"], p["from_wh"])
            )
            src_row = cur.fetchone() or {}
            src_qty = int(src_row.get("quantity") or 0)
            if src_qty < p["qty"]:
                raise HTTPException(400,
                    f"Insufficient stock on source warehouse for SKU {p['sku_id']} "
                    f"(have {src_qty}, need {p['qty']})")
            # Decrement source. RETURNING quantity guards against silent UPDATE-no-op duplication bug.
            cur.execute(
                "UPDATE product_stock SET quantity = quantity - %s"
                " WHERE sku_id=%s AND warehouse_id=%s"
                " RETURNING quantity",
                (p["qty"], p["sku_id"], p["from_wh"])
            )
            updated = cur.fetchone()
            if not updated:
                raise HTTPException(500,
                    f"Source stock row vanished mid-transfer for SKU {p['sku_id']} "
                    f"at warehouse {p['from_wh']} — refusing to duplicate stock")
            expected = src_qty - p["qty"]
            if int(updated["quantity"]) != expected:
                raise HTTPException(500,
                    f"Source stock state inconsistent for SKU {p['sku_id']} "
                    f"at warehouse {p['from_wh']}: expected {expected}, got {updated['quantity']}")
            # Increment destination (UPSERT — first transfer to a brand-new WH must INSERT).
            cur.execute(
                "INSERT INTO product_stock (sku_id, warehouse_id, quantity, sold_quantity)"
                " VALUES (%s, %s, %s, 0)"
                " ON CONFLICT (sku_id, warehouse_id)"
                " DO UPDATE SET quantity = product_stock.quantity + EXCLUDED.quantity",
                (p["sku_id"], p["to_wh"], p["qty"])
            )

            # Batch assignment on destination side.
            target_batch_id = p["target_batch_id"]
            if target_batch_id is not None:
                # Append to existing inventory_batches row — must belong to this project AND this (sku, warehouse).
                cur.execute(
                    "SELECT quantity_remaining FROM inventory_batches"
                    " WHERE id=%s AND project_id=%s AND sku_id=%s AND warehouse_id=%s"
                    " FOR UPDATE",
                    (target_batch_id, project_id, p["sku_id"], p["to_wh"])
                )
                ex = cur.fetchone()
                if not ex:
                    raise HTTPException(404,
                        f"target_batch_id {target_batch_id} not found for (sku={p['sku_id']}, wh={p['to_wh']}) in this project")
                cur.execute(
                    "UPDATE inventory_batches"
                    "   SET quantity_received = quantity_received + %s,"
                    "       quantity_remaining = quantity_remaining + %s"
                    " WHERE id=%s",
                    (p["qty"], p["qty"], target_batch_id)
                )
                used_batch_label = f"batch #{target_batch_id}"
            else:
                # Create a new batch row. Either the caller named it, or we auto-generate from the project's template.
                name = p["target_batch_name"]
                if not name:
                    name = _generate_batch_name(cur, project_id, p["sku_id"], p["qty"]) or f"B-{secrets.token_hex(3).upper()}"
                cur.execute(
                    "INSERT INTO inventory_batches"
                    "  (project_id, sku_id, warehouse_id, batch_name, quantity_received, quantity_remaining,"
                    "   notes, received_by_user_id)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    (project_id, p["sku_id"], p["to_wh"], name, p["qty"], p["qty"], p["note"], user["id"])
                )
                used_batch_label = f'batch "{name}"'

            # Two audit log rows — keeps the chronological trail readable per WH.
            cur.execute(
                "INSERT INTO product_stock_log (project_id, sku_id, warehouse_id, delta, reason, user_id, note)"
                " VALUES (%s, %s, %s, %s, 'transfer', %s, %s)",
                (project_id, p["sku_id"], p["from_wh"], -p["qty"], user["id"], p["note"])
            )
            cur.execute(
                "INSERT INTO product_stock_log (project_id, sku_id, warehouse_id, delta, reason, user_id, note)"
                " VALUES (%s, %s, %s, %s, 'transfer', %s, %s)",
                (project_id, p["sku_id"], p["to_wh"], p["qty"], user["id"],
                 f"{p['note']} → {used_batch_label}".strip(' →'))
            )
            affected_skus.add(p["sku_id"])
        # Re-sync L2 aggregate per touched SKU (UPSERT may have created quantity=0 rows).
        for sid in affected_skus:
            _sync_l2_stock(cur, sid)
        conn.commit()
    return {"ok": True, "transfers_applied": len(parsed), "skus_affected": len(affected_skus)}


# Bulk apply project-wide defaults to every product (Products → Settings tab).

@app.post("/api/projects/{project_id}/products/bulk-apply-defaults")
def bulk_apply_product_defaults(project_id: int, body: dict = Body(...),
                                  user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    fields_in = body.get("fields") if isinstance(body, dict) else None
    if not isinstance(fields_in, dict) or not fields_in:
        raise HTTPException(400, "No fields provided")

    BOOL_FIELDS = {'ships_internationally', 'requires_shipping',
                   'continue_selling_oos', 'allow_po'}
    INT_FIELDS  = {'lead_time_days', 'low_stock_threshold', 'net_terms_days'}
    SHIPPING_CLASSES = {'standard', 'fragile', 'oversized', 'hazmat', 'perishable'}

    set_clauses, vals = [], []
    for key, val in fields_in.items():
        if key in BOOL_FIELDS:
            v = bool(val)
        elif key in INT_FIELDS:
            try: v = int(val)
            except Exception: raise HTTPException(400, f"{key} must be an integer")
            if v < 0: raise HTTPException(400, f"{key} must be >= 0")
            if key == 'net_terms_days' and v > 365: raise HTTPException(400, "net_terms_days too large")
            if key == 'lead_time_days' and v > 365: raise HTTPException(400, "lead_time_days too large")
        elif key == 'shipping_class':
            v = str(val or '').strip().lower()
            if v not in SHIPPING_CLASSES:
                raise HTTPException(400, "Invalid shipping_class")
        else:
            raise HTTPException(400, f"Field '{key}' is not allowed")
        set_clauses.append(f"{key}=%s")
        vals.append(v)

    vals.append(project_id)
    with db_cursor() as (conn, cur):
        cur.execute(f"UPDATE products SET {', '.join(set_clauses)} WHERE project_id=%s", vals)
        affected = cur.rowcount
        conn.commit()
    return {"ok": True, "affected": affected}


# ─── Warehouses CRUD ────────────────────────────────────────────────
# Each project starts with one default warehouse on first list call.

def _ensure_default_warehouse(project_id):
    """Lazy-create default warehouse on first access (idempotent via partial unique index)."""
    if not db_one("SELECT id FROM warehouses WHERE project_id=%s LIMIT 1", (project_id,)):
        with db_cursor() as (conn, cur):
            cur.execute(
                "INSERT INTO warehouses (project_id, name, code, is_default, is_active)"
                " VALUES (%s, %s, %s, TRUE, TRUE) ON CONFLICT DO NOTHING",
                (project_id, "Main warehouse", "MAIN")
            )
            conn.commit()


# Multi-warehouse stock (Phase A): product_stock is source of truth, l2.stock_quantity is denormalised aggregate. Every write must call _sync_l2_stock(sku_id).

def _default_warehouse_id(cur, project_id):
    """Return the default WH id for the project, creating one if missing."""
    cur.execute("SELECT id FROM warehouses WHERE project_id=%s AND is_default LIMIT 1", (project_id,))
    row = cur.fetchone()
    if row: return row["id"]
    cur.execute(
        "INSERT INTO warehouses (project_id, name, code, is_default, is_active)"
        " VALUES (%s, 'Main warehouse', 'MAIN', TRUE, TRUE) RETURNING id",
        (project_id,)
    )
    return cur.fetchone()["id"]


def _verify_warehouse_in_project(cur, warehouse_id, project_id):
    """403/404 guard for warehouse_id — prevents IDOR. Call from every WH endpoint."""
    cur.execute("SELECT id FROM warehouses WHERE id=%s AND project_id=%s",
                (warehouse_id, project_id))
    if not cur.fetchone():
        raise HTTPException(404, "Warehouse not found in this project")


def _verify_sku_in_project(cur, sku_id, project_id):
    """Same idea, for SKUs (Layer 2 row)."""
    cur.execute(
        "SELECT c.id FROM product_configurations_l2 c"
        "  JOIN product_configurations_l1 v ON c.variation_id = v.id"
        "  JOIN products p                  ON v.product_id   = p.id"
        " WHERE c.id=%s AND p.project_id=%s",
        (sku_id, project_id)
    )
    if not cur.fetchone():
        raise HTTPException(404, "SKU not found in this project")


def _sync_l2_stock(cur, sku_id):
    """Recompute l2.stock_quantity = SUM(product_stock.quantity) for this SKU. Skips trg_l2_stock_audit since app already logs via product_stock_log."""
    cur.execute("SET LOCAL torta.skip_audit = 'on'")
    cur.execute(
        "UPDATE product_configurations_l2"
        "   SET stock_quantity = COALESCE("
        "         (SELECT SUM(quantity) FROM product_stock WHERE sku_id=%s), 0)"
        " WHERE id=%s",
        (sku_id, sku_id)
    )


def _per_warehouse_stock(cur, sku_id):
    """List {warehouse_id, name, code, is_default, quantity} for every project WH (0 if no row)."""
    cur.execute(
        "SELECT w.id AS warehouse_id, w.name, w.code, w.is_default,"
        "       COALESCE(ps.quantity, 0) AS quantity"
        "  FROM warehouses w"
        "  LEFT JOIN product_stock ps ON ps.warehouse_id = w.id AND ps.sku_id = %s"
        " WHERE w.project_id = ("
        "         SELECT p.project_id FROM product_configurations_l2 c"
        "           JOIN product_configurations_l1 v ON c.variation_id = v.id"
        "           JOIN products p                  ON v.product_id   = p.id"
        "          WHERE c.id = %s)"
        "   AND w.is_active = TRUE"
        " ORDER BY w.is_default DESC, w.name ASC",
        (sku_id, sku_id)
    )
    return [dict(r) for r in cur.fetchall()]


_WH_STR_FIELDS = {
    "country": 80, "city": 120, "street": 255, "postal_code": 40, "region": 120,
    "contact_name": 120, "contact_phone": 40,
}


@app.get("/api/warehouses")
def list_warehouses(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    _ensure_default_warehouse(project_id)
    rows = db_all(
        "SELECT id, name, code, address, is_active, is_default, created_at,"
        "       country, city, street, postal_code, region,"
        "       contact_name, contact_phone, notes"
        " FROM warehouses WHERE project_id=%s"
        " ORDER BY is_default DESC, name ASC",
        (project_id,)
    )
    for r in rows:
        r["created_at"] = r["created_at"].isoformat() if r["created_at"] else None
    return rows


@app.post("/api/warehouses")
def create_warehouse(req: WarehouseRequest, project_id: int = Query(...),
                     user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    name = sanitize((req.name or '').strip())[:120]
    if not name: raise HTTPException(400, "Name is required")
    code     = sanitize((req.code or '').strip())[:40]
    address  = sanitize(req.address or '')[:1000]
    notes    = sanitize(req.notes or '')[:2000]
    extras = {fld: sanitize(getattr(req, fld) or '').strip()[:lim]
              for fld, lim in _WH_STR_FIELDS.items()}
    is_default = bool(req.is_default)
    with db_cursor() as (conn, cur):
        if is_default:
            cur.execute("UPDATE warehouses SET is_default=FALSE WHERE project_id=%s", (project_id,))
        cur.execute(
            "INSERT INTO warehouses ("
            "  project_id, name, code, address, is_default, is_active,"
            "  country, city, street, postal_code, region, contact_name, contact_phone, notes"
            ") VALUES (%s,%s,%s,%s,%s,TRUE, %s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (project_id, name, code, address, is_default,
             extras["country"], extras["city"], extras["street"],
             extras["postal_code"], extras["region"],
             extras["contact_name"], extras["contact_phone"], notes)
        )
        new_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": new_id}


@app.put("/api/warehouses/{wid}")
def update_warehouse(wid: int, req: WarehouseRequest, project_id: int = Query(...),
                     user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if not db_one("SELECT id FROM warehouses WHERE id=%s AND project_id=%s", (wid, project_id)):
        raise HTTPException(404, "Warehouse not found")
    fields, vals = [], []
    if req.name is not None:
        n = sanitize(req.name.strip())[:120]
        if not n: raise HTTPException(400, "Name cannot be empty")
        fields.append("name=%s"); vals.append(n)
    if req.code is not None:
        fields.append("code=%s"); vals.append(sanitize(req.code.strip())[:40])
    if req.address is not None:
        fields.append("address=%s"); vals.append(sanitize(req.address)[:1000])
    if req.notes is not None:
        fields.append("notes=%s"); vals.append(sanitize(req.notes)[:2000])
    for fld, lim in _WH_STR_FIELDS.items():
        v = getattr(req, fld)
        if v is not None:
            fields.append(f"{fld}=%s"); vals.append(sanitize(v.strip())[:lim])
    if req.is_active is not None:
        # Block deactivating a WH that still holds stock or the default WH.
        if req.is_active is False:
            cur_default = db_one("SELECT is_default FROM warehouses WHERE id=%s", (wid,))
            if cur_default and cur_default.get("is_default"):
                raise HTTPException(400, "Cannot deactivate the default warehouse")
            leftover = db_one("SELECT COALESCE(SUM(quantity),0) AS t FROM product_stock WHERE warehouse_id=%s", (wid,))
            if int((leftover or {}).get("t") or 0) > 0:
                raise HTTPException(400,
                    "Warehouse still holds stock — transfer it out first.")
        fields.append("is_active=%s"); vals.append(bool(req.is_active))
    if req.is_default is not None:
        # Setting is_default=False on the only default would orphan the project — block.
        if req.is_default is False:
            row = db_one("SELECT is_default FROM warehouses WHERE id=%s", (wid,))
            if row and row.get("is_default"):
                raise HTTPException(400, "Pick another warehouse as default before unflagging this one")
        fields.append("is_default=%s"); vals.append(bool(req.is_default))
    if not fields: return {"ok": True}
    vals.append(wid)
    with db_cursor() as (conn, cur):
        if req.is_default:
            cur.execute("UPDATE warehouses SET is_default=FALSE WHERE project_id=%s AND id<>%s",
                        (project_id, wid))
        cur.execute(f"UPDATE warehouses SET {', '.join(fields)} WHERE id=%s", vals)
        conn.commit()
    return {"ok": True}


@app.delete("/api/warehouses/{wid}")
def delete_warehouse(wid: int, project_id: int = Query(...),
                     user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    row = db_one("SELECT id, is_default FROM warehouses WHERE id=%s AND project_id=%s",
                 (wid, project_id))
    if not row: raise HTTPException(404, "Warehouse not found")
    if row["is_default"]:
        raise HTTPException(400, "Cannot delete the default warehouse — set another as default first")
    # Don't silently destroy stock (cascades into product_stock); force transfer-out first.
    leftover = db_one(
        "SELECT COALESCE(SUM(quantity), 0) AS total FROM product_stock WHERE warehouse_id=%s",
        (wid,)
    )
    if int((leftover or {}).get("total") or 0) > 0:
        raise HTTPException(400,
            "Warehouse still holds stock — transfer it to another warehouse "
            "(or write it off via Adjust) before deleting.")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM warehouses WHERE id=%s", (wid,))
        conn.commit()
    return {"ok": True}


# ─── Restock waitlist (CRM-side: list + manual notify-out) ──────────

@app.get("/api/products/{product_id}/restock-subscriptions")
def list_restock_subs(product_id: int, project_id: int = Query(...),
                       user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    rows = db_all(
        "SELECT id, sku_id, email, user_id, notified_at, created_at"
        " FROM product_restock_subscriptions WHERE product_id=%s"
        " ORDER BY created_at DESC LIMIT 500",
        (product_id,)
    )
    for r in rows:
        r["created_at"]  = r["created_at"].isoformat() if r["created_at"] else None
        r["notified_at"] = r["notified_at"].isoformat() if r["notified_at"] else None
    return rows


# ─── Q&A management ─────────────────────────────────────────────────
# Customers post questions via External API; merchant answers them via CRM.

@app.get("/api/products/{product_id}/questions")
def list_questions(product_id: int, project_id: int = Query(...),
                    user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one("SELECT id FROM products WHERE id=%s AND project_id=%s", (product_id, project_id)):
        raise HTTPException(404, "Product not found")
    rows = db_all(
        "SELECT id, user_id, question, answer, answered_at, created_at"
        " FROM product_questions WHERE product_id=%s"
        " ORDER BY created_at DESC LIMIT 200",
        (product_id,)
    )
    for r in rows:
        r["created_at"]  = r["created_at"].isoformat() if r["created_at"] else None
        r["answered_at"] = r["answered_at"].isoformat() if r["answered_at"] else None
    return rows


class AnswerQuestionRequest(BaseModel):
    answer: str

@app.put("/api/products/{product_id}/questions/{qid}/answer")
def answer_question(product_id: int, qid: int, req: AnswerQuestionRequest,
                     project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one(
        "SELECT id FROM product_questions WHERE id=%s AND product_id=%s AND project_id=%s",
        (qid, product_id, project_id)
    )
    if not row: raise HTTPException(404, "Question not found")
    answer = sanitize(req.answer.strip())[:5000]
    if not answer: raise HTTPException(400, "Answer cannot be empty")
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE product_questions SET answer=%s, answered_at=NOW() WHERE id=%s",
            (answer, qid)
        )
        conn.commit()
    return {"ok": True}


# ─── Review merchant reply ──────────────────────────────────────────

class ReviewReplyRequest(BaseModel):
    reply: str  # empty string clears the reply

@app.put("/api/products/{product_id}/reviews/{review_id}/reply")
def reply_to_review(product_id: int, review_id: int, req: ReviewReplyRequest,
                     project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if not db_one(
        "SELECT id FROM product_reviews WHERE id=%s AND product_id=%s AND project_id=%s",
        (review_id, product_id, project_id)
    ):
        raise HTTPException(404, "Review not found")
    reply = sanitize(req.reply.strip())[:5000]
    with db_cursor() as (conn, cur):
        if reply:
            cur.execute(
                "UPDATE product_reviews SET merchant_reply=%s, merchant_reply_at=NOW() WHERE id=%s",
                (reply, review_id)
            )
        else:
            cur.execute(
                "UPDATE product_reviews SET merchant_reply=NULL, merchant_reply_at=NULL WHERE id=%s",
                (review_id,)
            )
        conn.commit()
    return {"ok": True}


# ── UPLOAD ───────────────────────────────────────────────

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


# Media upload (Phase 7): images/videos/3D/AR; preserves original format (no server-side transcoding).

ALLOWED_MEDIA_EXTS = {
    # images — also accepted by /api/upload/image for back-compat
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
    'webp': 'image/webp', 'gif': 'image/gif',
    # video
    'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime', 'm4v': 'video/x-m4v',
    # 3D / AR
    'glb': 'model/gltf-binary', 'usdz': 'model/vnd.usdz+zip', 'gltf': 'model/gltf+json',
}

MEDIA_SIZE_LIMITS = {
    'image': 10 * 1024 * 1024,    # 10 MB
    'video': 100 * 1024 * 1024,   # 100 MB
    'model':  50 * 1024 * 1024,   #  50 MB
}

def _media_kind_from_ext(ext: str) -> Optional[str]:
    if ext in ('jpg', 'jpeg', 'png', 'webp', 'gif'): return 'image'
    if ext in ('mp4', 'webm', 'mov', 'm4v'):         return 'video'
    if ext in ('glb', 'usdz', 'gltf'):               return 'model'
    return None


@app.post("/api/upload/media")
async def upload_media(
    file: UploadFile = File(...),
    project_id: Optional[int] = Query(None),
    user: dict = Depends(get_current_user),
):
    """Multi-type upload for L1 variation gallery (images/videos/3D/AR); preserves user-chosen ext."""
    fname = (file.filename or '').strip()
    ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
    if ext not in ALLOWED_MEDIA_EXTS:
        raise HTTPException(400, f"File type .{ext or '?'} not allowed. "
                                  f"Allowed: {sorted(ALLOWED_MEDIA_EXTS.keys())}")
    kind = _media_kind_from_ext(ext)
    contents = await file.read()
    cap = MEDIA_SIZE_LIMITS.get(kind, 10 * 1024 * 1024)
    if len(contents) > cap:
        raise HTTPException(400, f"File too large (max {cap // (1024*1024)} MB for {kind})")

    # Mime-type sniff defence — refuse if declared mime mismatches ext (.glb-renamed-from-.exe).
    declared = (file.content_type or '').lower()
    expected = ALLOWED_MEDIA_EXTS[ext]
    # Browsers send 'application/octet-stream' for unknown types — accept that.
    if declared and declared != expected and declared != 'application/octet-stream':
        # Allow image/* for any image ext (browsers vary on jpeg vs jpg).
        if not (kind == 'image' and declared.startswith('image/')):
            raise HTTPException(400, f"Mime mismatch: file says '{declared}', extension says '{expected}'")

    filename = f"{secrets.token_hex(16)}.{ext}"
    if S3_AVAILABLE and AWS_ACCESS_KEY_ID:
        folder = f"projects/{project_id}/products" if project_id else "products"
        key = f"{folder}/{filename}"
        try:
            buf = io.BytesIO(contents); buf.seek(0)
            url = s3_upload(buf, key, content_type=expected)
            return {"url": url, "type": kind, "size": len(contents)}
        except (BotoCoreError, ClientError) as e:
            raise HTTPException(500, f"S3 upload failed: {e}")
    else:
        path = os.path.join(UPLOADS_DIR, filename)
        with open(path, "wb") as f:
            f.write(contents)
        return {"url": f"{CRM_BACKEND_URL}/uploads/{filename}", "type": kind, "size": len(contents)}


# Trusted external embed hosts for "Paste URL" path — narrow (SSRF/clickjacking risk).
SAFE_MEDIA_HOSTS = (
    "youtube.com", "www.youtube.com", "youtu.be",
    "vimeo.com", "player.vimeo.com",
)

def _is_safe_media_url(url: str) -> bool:
    """True if URL is on our S3 bucket OR https + whitelisted external host."""
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
    return p.hostname in SAFE_MEDIA_HOSTS


class AddMediaUrlRequest(BaseModel):
    url: str

@app.post("/api/products/{product_id}/layers/1/{var_id}/media-url")
def add_media_url(product_id: int, var_id: int, req: AddMediaUrlRequest,
                  project_id: int = Query(...), user: dict = Depends(get_current_user)):
    """Append S3 or whitelisted-host URL to variation's images[] (refuses arbitrary external URLs)."""
    require_team_member_or_owner(user, project_id)
    _verify_layer_item_belongs_to_product(1, var_id, product_id)
    url = (req.url or '').strip()
    if not _is_safe_media_url(url):
        raise HTTPException(400, "URL must be from your S3 bucket or a whitelisted "
                                  "video host (YouTube, Vimeo) over https.")
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE product_configurations_l1 SET images = array_append(images, %s) WHERE id=%s",
            (url, var_id)
        )
        conn.commit()
    return {"ok": True, "url": url}


@app.post("/api/upload/file")
async def upload_file(
    file: UploadFile = File(...),
    project_id: Optional[int] = Query(None),
    user: dict = Depends(get_current_user),
):
    """Generic file upload for Custom Field type=file (digital products, ticket PDFs, etc.)."""
    import re as _re_local
    contents = await file.read()
    if len(contents) > 50 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 50MB)")
    safe_name = _re_local.sub(r"[^a-zA-Z0-9._-]", "_", file.filename or "file")
    filename = f"{secrets.token_hex(12)}_{safe_name}"

    if S3_AVAILABLE and AWS_ACCESS_KEY_ID:
        folder = f"projects/{project_id}/files" if project_id else "files"
        key = f"{folder}/{filename}"
        try:
            url = s3_upload(io.BytesIO(contents), key, content_type=file.content_type or "application/octet-stream")
            return {"url": url, "name": file.filename, "size": len(contents)}
        except (BotoCoreError, ClientError) as e:
            raise HTTPException(500, f"S3 upload failed: {e}")
    else:
        path = os.path.join(UPLOADS_DIR, filename)
        with open(path, "wb") as f:
            f.write(contents)
        return {"url": f"{CRM_BACKEND_URL}/uploads/{filename}", "name": file.filename, "size": len(contents)}


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


# ── SETTINGS ─────────────────────────────────────────────

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


# ── GOOGLE OAUTH (CRM login) ─────────────────────────────

@app.get("/api/auth/google/login")
def google_login():
    import urllib.parse
    # CSRF protection — random state stored in short-lived cookie
    state = secrets.token_urlsafe(32)
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "offline",
        "prompt":        "select_account",
        "state":         state,
    }
    redirect = RedirectResponse(
        "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    )
    # path="/" so the cookie survives the Google→callback cross-origin redirect; httponly + 10-min TTL keeps it safe.
    redirect.set_cookie(
        key="crm_oa_state", value=state, httponly=True, max_age=600,
        samesite="lax", secure=COOKIE_SECURE, path="/",
    )
    return redirect


@app.get("/api/auth/google/callback")
def google_callback(request: Request, code: str = None, error: str = None, state: str = None):
    # Validate CSRF state BEFORE doing anything with the code
    cookie_state = request.cookies.get("crm_oa_state", "")
    if not state or not cookie_state or not _hmac.compare_digest(state, cookie_state):
        return RedirectResponse(f"{CRM_FRONTEND_URL}/login?error=oauth_state_mismatch")
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
    except Exception:
        import traceback; traceback.print_exc()
        return RedirectResponse(f"{CRM_FRONTEND_URL}/login?error=google_token")

    id_token_str = tokens.get("id_token")
    if not id_token_str:
        # Don't log raw token contents
        return RedirectResponse(f"{CRM_FRONTEND_URL}/login?error=google_no_id_token")

    try:
        from google.oauth2 import id_token as g_id_token
        from google.auth.transport import requests as g_requests
        # 60s skew tolerates normal clock drift between local server and Google
        idinfo  = g_id_token.verify_oauth2_token(id_token_str, g_requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=60)
        g_id    = idinfo["sub"]
        email   = idinfo["email"]
        name    = idinfo.get("name", email.split("@")[0])
        picture = idinfo.get("picture")
    except Exception:
        import traceback; traceback.print_exc()
        return RedirectResponse(f"{CRM_FRONTEND_URL}/login?error=google_verify")

    user_id   = _upsert_google_user(g_id, email, name, picture)
    jwt_token = make_token(user_id)
    refresh   = issue_refresh_token(user_id, request, label="Google login")
    redirect  = RedirectResponse(f"{CRM_FRONTEND_URL}/dashboard", status_code=302)
    redirect.set_cookie(key="crm_token", value=jwt_token, httponly=True,
                        samesite="lax", secure=COOKIE_SECURE,
                        max_age=ACCESS_TOKEN_MINUTES * 60, path="/")
    redirect.set_cookie(key="crm_refresh", value=refresh, httponly=True,
                        samesite="lax", secure=COOKIE_SECURE,
                        max_age=REFRESH_TOKEN_DAYS * 86400, path="/")
    redirect.delete_cookie("crm_oa_state", path="/")
    return redirect


@app.post("/api/auth/google")
def google_auth(request: GoogleAuthRequest, response: Response, req: Request):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(501, "Google OAuth not configured")
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as g_requests
        # Same 60s skew as callback — tolerates normal clock drift
        idinfo  = id_token.verify_oauth2_token(request.token, g_requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=60)
        g_id    = idinfo["sub"]
        email   = idinfo["email"]
        name    = idinfo.get("name", email.split("@")[0])
        picture = idinfo.get("picture")
    except Exception:
        # Don't leak internal token-parsing details
        raise HTTPException(400, "Invalid Google token")

    user_id = _upsert_google_user(g_id, email, name, picture)
    set_cookie(response, make_token(user_id))
    set_refresh_cookie(response, issue_refresh_token(user_id, req, label="Google login"))
    return {"success": True}


# ── EMAIL DOMAIN ─────────────────────────────────────────

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
        "spf_ok":         bool(row.get("spf_ok")),
        "dmarc_ok":       bool(row.get("dmarc_ok")),
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

    domain   = row["domain"]
    result   = _ses("POST", f"/domains/{domain}/verify")
    dkim_ok  = bool(result.get("dkim_ok",  False))
    spf_ok   = bool(result.get("spf_ok",   False))
    dmarc_ok = bool(result.get("dmarc_ok", False))
    # all_ok = full email stack (DKIM + SPF + DMARC); without DMARC, Gmail/Outlook silently spam-folder.
    all_ok   = dkim_ok and spf_ok and dmarc_ok

    with db_cursor() as (conn, cur):
        cur.execute("""
            UPDATE crm_email_domains
            SET is_verified=%s,
                spf_ok=%s,
                dmarc_ok=%s,
                verify_token=%s,
                verified_at=CASE WHEN %s AND verified_at IS NULL THEN NOW() ELSE verified_at END
            WHERE project_id=%s
        """, (
            dkim_ok, spf_ok, dmarc_ok,
            # Keep verify_token populated for backward compat with any other reader
            "all_ok" if (spf_ok and dmarc_ok) else ("spf_ok" if spf_ok else ""),
            all_ok, project_id
        ))
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


# ── OAUTH SETTINGS ───────────────────────────────────────

@app.get("/api/oauth-settings")
def get_oauth_settings(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    key_row      = db_one("SELECT api_key FROM crm_projects WHERE id=%s", (project_id,))
    api_key_str  = key_row["api_key"] if key_row else ""
    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key_str}/auth/google/callback"

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


# ── GENERIC OAUTH PROVIDERS (GitHub, Discord, Facebook, GitLab, Bitbucket, LinkedIn, Twitch, Spotify, Slack, Notion, Figma, Zoom, Azure, Apple, X, VK, Kakao, KeyCloak) ──

# Whitelist of providers handled in External — add to OAUTH_PROVIDERS in External/main.py when extending.
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
    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key_str}/auth/oauth/{provider}/callback"
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


# ── SMS / PHONE AUTH (customer-provided: Twilio/MessageBird/Textlocal/Vonage/Twilio Verify); per-provider creds preserve switching history ──

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


# ── URL CONFIGURATION ────────────────────────────────────

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


# ── REDIRECT URLs ────────────────────────────────────────

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


# ── ЗАКАЗЫ ───────────────────────────────────────────────

ORDER_STATUSES = ["new", "confirmed", "shipped", "delivered", "cancelled", "refunded"]

class UpdateOrderStatus(BaseModel):
    status: str

@app.get("/api/orders")
def get_orders(project_id: int = Query(...),
               status: Optional[str] = Query(None),
               cursor: Optional[str] = Query(None),
               limit:  Optional[int] = Query(None),
               user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    want_pagination, offset, page_size = _pagination_params(cursor, limit)
    where = "WHERE oh.project_id=%s"
    params: list = [project_id]
    if status and status in ORDER_STATUSES:
        where += " AND oh.status=%s"
        params.append(status)

    fetch_limit = (page_size + 1) if want_pagination else 200
    sql = f"""SELECT oh.id, oh.total_amount, oh.status, oh.delivery_method,
                   oh.recipient_name, oh.phone, oh.address, oh.comment,
                   oh.payment_method, oh.created_at, oh.updated_at,
                   u.name AS customer_name, u.email AS customer_email,
                   (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=oh.id) AS items_count
            FROM order_history oh
            LEFT JOIN users u ON oh.user_id=u.id
            {where}
            ORDER BY oh.created_at DESC
            LIMIT %s"""
    params.append(fetch_limit)
    if want_pagination:
        sql += " OFFSET %s"
        params.append(offset)

    orders = db_all(sql, tuple(params))
    serialized = [
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
    return _wrap_paginated(want_pagination, serialized, offset, page_size)


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
    """SSE 3s poll: fires on new_count OR max id change (catches new orders even if count equal)."""
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
                  p.title, pv.variation_name, (pv.images)[1] AS image_url, pc.configuration_name
           FROM order_items oi
           JOIN products p ON oi.product_id=p.id
           JOIN product_configurations_l1 pv ON oi.variation_id=pv.id
           JOIN product_configurations_l2 pc ON oi.configuration_id=pc.id
           WHERE oi.order_id=%s""",
        (order_id,)
    )
    return {
        **{k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in dict(o).items()},
        "items": [
            {
                "title":             it["title"],
                "variation_name":    it["variation_name"],
                "configuration_name":it["configuration_name"],
                "image_url":         it["image_url"],
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


# ── RETURNS / REFUNDS ─────────────────────────────────────
# Lifecycle: requested → approved → received → inspected → refunded
# Terminal: rejected | cancelled
# Stock is returned to a specific inventory_batch on inspection (merchant picks per item).
# Refund is record-only (Variant A) — merchant processes actual money refund elsewhere.

RETURN_STATUSES = ("requested", "approved", "rejected", "received", "inspected", "refunded", "cancelled")
RETURN_REASONS  = ("damaged", "wrong_item", "not_as_described", "changed_mind",
                   "arrived_late", "quality_issue", "other")
ITEM_CONDITIONS = ("pending", "resellable", "damaged", "unrecoverable")

# Status groupings shown in the Returns UI
RETURN_GROUP_ACTION    = {"requested", "received"}        # 🔔 merchant must act now
RETURN_GROUP_PROGRESS  = {"approved", "inspected"}        # ⏳ in progress (awaiting goods or refund)
RETURN_GROUP_DONE      = {"refunded"}                     # ✅ completed
RETURN_GROUP_CLOSED    = {"rejected", "cancelled"}        # ❌ closed (no refund)


class RejectReturnBody(BaseModel):
    reason: str


class InspectItemEntry(BaseModel):
    return_item_id: int
    condition: str
    restock_warehouse_id: Optional[int] = None
    restock_batch_id: Optional[int] = None
    item_notes: Optional[str] = ""


class InspectReturnBody(BaseModel):
    items: List[InspectItemEntry]
    internal_notes: Optional[str] = ""


class RefundReturnBody(BaseModel):
    refund_amount: float
    refund_method: Optional[str] = ""
    refund_reference: Optional[str] = ""
    restocking_fee: Optional[float] = 0


def _serialize_return(r: dict) -> dict:
    """Shared serializer for a return row."""
    return {
        "id":                  r["id"],
        "order_id":            r["order_id"],
        "project_id":          r["project_id"],
        "customer_user_id":    r["customer_user_id"],
        "status":              r["status"],
        "reason":              r["reason"],
        "customer_message":    r.get("customer_message") or "",
        "customer_photos":     r.get("customer_photos") or [],
        "approved_at":         r["approved_at"].isoformat() if r.get("approved_at") else None,
        "rejected_reason":     r.get("rejected_reason") or "",
        "received_at":         r["received_at"].isoformat() if r.get("received_at") else None,
        "inspected_at":        r["inspected_at"].isoformat() if r.get("inspected_at") else None,
        "refund_amount":       float(r.get("refund_amount") or 0),
        "refund_method":       r.get("refund_method") or "",
        "refund_reference":    r.get("refund_reference") or "",
        "refund_processed_at": r["refund_processed_at"].isoformat() if r.get("refund_processed_at") else None,
        "restocking_fee":      float(r.get("restocking_fee") or 0),
        "internal_notes":      r.get("internal_notes") or "",
        "created_at":          r["created_at"].isoformat() if r.get("created_at") else None,
        "updated_at":          r["updated_at"].isoformat() if r.get("updated_at") else None,
    }


def _notify_return_event(project_id: int, return_id: int, title: str, message: str):
    """Push notification to project owner + every team member."""
    rows = db_all(
        "SELECT crm_user_id FROM crm_projects WHERE id=%s"
        " UNION"
        " SELECT crm_user_id FROM crm_team_members WHERE project_id=%s",
        (project_id, project_id)
    )
    proj = db_one("SELECT api_key FROM crm_projects WHERE id=%s", (project_id,))
    link = f"/project/{proj['api_key']}/orders?tab=returns&open={return_id}" if proj else None
    for r in rows:
        if r.get("crm_user_id"):
            push_notification(r["crm_user_id"], project_id, "return", title, message, link)


def _email_customer_about_return(project_id: int, return_id: int,
                                   subject: str, body_html: str) -> None:
    """Best-effort email the customer when their return changes state.
    Silent on failure — merchant bell still fires via _notify_return_event so the
    audit trail is preserved even if SMTP is down."""
    try:
        # Pull the customer's email + project's branded sender in one query
        row = db_one(
            "SELECT u.email AS to_email, u.name AS to_name,"
            "       ed.from_name, ed.from_email, ed.is_verified,"
            "       uc.frontend_url"
            "  FROM order_returns r"
            "  JOIN users u             ON u.id = r.customer_user_id"
            "  LEFT JOIN crm_email_domains ed ON ed.project_id = r.project_id"
            "  LEFT JOIN crm_url_config uc    ON uc.project_id = r.project_id"
            " WHERE r.id=%s AND r.project_id=%s",
            (return_id, project_id)
        )
        if not row or not row.get("to_email"):
            return
        # Use verified branded sender if available, else default
        if row.get("is_verified") and row.get("from_email"):
            from_email = row["from_email"]
            from_name  = row.get("from_name") or "Store"
        else:
            from_email = EMAIL_FROM
            from_name  = "Store"
        # Sanitize customer name for the greeting
        customer_name = sanitize(row.get("to_name") or "there")
        frontend = (row.get("frontend_url") or "").rstrip("/")
        link_html = (f'<p style="margin:16px 0"><a href="{frontend}/orders" '
                      f'style="color:#0071E3">View order status →</a></p>') if frontend else ""
        html = (
            "<div style='font-family:sans-serif;max-width:520px;margin:auto'>"
            f"<p>Hi {customer_name},</p>"
            f"{body_html}"
            f"{link_html}"
            "<p style='color:#888;font-size:12px;margin-top:24px'>"
            f"Return #{return_id}"
            "</p></div>"
        )
        send_email(row["to_email"], subject, html, from_email=from_email, from_name=from_name)
    except Exception as e:
        # Never break the lifecycle transition because of an email problem
        print(f"[return email] best-effort failed for return {return_id}: {e}")


@app.get("/api/projects/{project_id}/returns")
def list_returns(project_id: int,
                 status: Optional[str] = Query(None),
                 group: Optional[str] = Query(None),
                 cursor: Optional[str] = Query(None),
                 limit: Optional[int] = Query(None),
                 user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    want_pagination, offset, page_size = _pagination_params(cursor, limit)

    where = "WHERE r.project_id=%s"
    params: list = [project_id]

    if status and status in RETURN_STATUSES:
        where += " AND r.status=%s"
        params.append(status)
    elif group:
        group_map = {
            "action":   tuple(RETURN_GROUP_ACTION),
            "progress": tuple(RETURN_GROUP_PROGRESS),
            "done":     tuple(RETURN_GROUP_DONE),
            "closed":   tuple(RETURN_GROUP_CLOSED),
        }
        if group in group_map:
            where += f" AND r.status = ANY(%s)"
            params.append(list(group_map[group]))

    fetch_limit = (page_size + 1) if want_pagination else 200
    sql = f"""SELECT r.*, oh.total_amount AS order_total,
                     oh.recipient_name, oh.created_at AS order_created_at,
                     u.name AS customer_name, u.email AS customer_email,
                     (SELECT COUNT(*) FROM order_return_items ri WHERE ri.return_id=r.id) AS items_count,
                     (SELECT COALESCE(SUM(ri.quantity), 0) FROM order_return_items ri WHERE ri.return_id=r.id) AS units_count
              FROM order_returns r
              JOIN order_history oh ON r.order_id = oh.id
              LEFT JOIN users u ON r.customer_user_id = u.id
              {where}
              ORDER BY r.created_at DESC
              LIMIT %s"""
    params.append(fetch_limit)
    if want_pagination:
        sql += " OFFSET %s"
        params.append(offset)

    rows = db_all(sql, tuple(params))
    serialized = []
    for r in rows:
        d = _serialize_return(r)
        d["order_total"]      = float(r["order_total"] or 0)
        d["recipient_name"]   = r["recipient_name"]
        d["order_created_at"] = r["order_created_at"].isoformat() if r["order_created_at"] else None
        d["customer_name"]    = r["customer_name"]
        d["customer_email"]   = r["customer_email"]
        d["items_count"]      = int(r["items_count"] or 0)
        d["units_count"]      = int(r["units_count"] or 0)
        serialized.append(d)
    return _wrap_paginated(want_pagination, serialized, offset, page_size)


@app.get("/api/projects/{project_id}/returns/stats")
def returns_stats(project_id: int, user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one(
        """SELECT
             COUNT(*) FILTER (WHERE status = ANY(%s)) AS action_count,
             COUNT(*) FILTER (WHERE status = ANY(%s)) AS progress_count,
             COUNT(*) FILTER (WHERE status = ANY(%s)) AS done_count,
             COUNT(*) FILTER (WHERE status = ANY(%s)) AS closed_count,
             COUNT(*)                                 AS total
           FROM order_returns
           WHERE project_id = %s""",
        (list(RETURN_GROUP_ACTION), list(RETURN_GROUP_PROGRESS),
         list(RETURN_GROUP_DONE), list(RETURN_GROUP_CLOSED), project_id)
    )
    return {
        "action_count":   int(row["action_count"]   or 0) if row else 0,
        "progress_count": int(row["progress_count"] or 0) if row else 0,
        "done_count":     int(row["done_count"]     or 0) if row else 0,
        "closed_count":   int(row["closed_count"]   or 0) if row else 0,
        "total":          int(row["total"]          or 0) if row else 0,
    }


@app.get("/api/projects/{project_id}/returns/{return_id}")
def get_return(project_id: int, return_id: int, user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    r = db_one(
        """SELECT r.*, oh.total_amount AS order_total, oh.status AS order_status,
                  oh.recipient_name, oh.phone, oh.address, oh.payment_method,
                  oh.created_at AS order_created_at, oh.delivered_at,
                  u.name AS customer_name, u.email AS customer_email,
                  org.payment_provider, org.payment_account_label, org.payment_dashboard_url
           FROM order_returns r
           JOIN order_history oh ON r.order_id = oh.id
           JOIN crm_projects p ON p.id = r.project_id
           LEFT JOIN crm_organizations org ON org.id = p.org_id
           LEFT JOIN users u ON r.customer_user_id = u.id
           WHERE r.id=%s AND r.project_id=%s""",
        (return_id, project_id)
    )
    if not r:
        raise HTTPException(404, "Return not found")

    items = db_all(
        """SELECT ri.*, oi.product_id, oi.variation_id, oi.configuration_id,
                  oi.price AS unit_price, oi.quantity AS ordered_quantity,
                  p.title, pv.variation_name, pc.configuration_name,
                  (pv.images)[1] AS image_url,
                  w.name AS restock_warehouse_name,
                  b.batch_name AS restock_batch_name
           FROM order_return_items ri
           JOIN order_items oi ON ri.order_item_id = oi.id
           JOIN products p ON oi.product_id = p.id
           JOIN product_configurations_l1 pv ON oi.variation_id = pv.id
           JOIN product_configurations_l2 pc ON oi.configuration_id = pc.id
           LEFT JOIN warehouses w ON ri.restock_warehouse_id = w.id
           LEFT JOIN inventory_batches b ON ri.restock_batch_id = b.id
           WHERE ri.return_id=%s
           ORDER BY ri.id""",
        (return_id,)
    )

    d = _serialize_return(r)
    d["order_total"]      = float(r["order_total"] or 0)
    d["order_status"]     = r["order_status"]
    d["recipient_name"]   = r["recipient_name"]
    d["phone"]            = r["phone"]
    d["address"]          = r["address"]
    d["payment_method"]   = r["payment_method"]
    d["order_created_at"] = r["order_created_at"].isoformat() if r["order_created_at"] else None
    d["delivered_at"]     = r["delivered_at"].isoformat() if r["delivered_at"] else None
    d["customer_name"]    = r["customer_name"]
    d["customer_email"]   = r["customer_email"]
    d["payment_provider"] = r.get("payment_provider") or "manual"
    d["payment_account_label"] = r.get("payment_account_label") or ""
    d["payment_dashboard_url"] = r.get("payment_dashboard_url") or ""
    d["items"] = [
        {
            "id":                    it["id"],
            "order_item_id":         it["order_item_id"],
            "product_id":            it["product_id"],
            "variation_id":          it["variation_id"],
            "configuration_id":      it["configuration_id"],
            "quantity":              int(it["quantity"]),
            "ordered_quantity":      int(it["ordered_quantity"]),
            "condition":             it["condition"],
            "restock_warehouse_id":  it["restock_warehouse_id"],
            "restock_warehouse_name":it["restock_warehouse_name"],
            "restock_batch_id":      it["restock_batch_id"],
            "restock_batch_name":    it["restock_batch_name"],
            "restocked_at":          it["restocked_at"].isoformat() if it["restocked_at"] else None,
            "unit_refund_amount":    float(it["unit_refund_amount"] or 0),
            "item_notes":            it["item_notes"] or "",
            "title":                 it["title"],
            "variation_name":        it["variation_name"],
            "configuration_name":    it["configuration_name"],
            "image_url":             it["image_url"],
            "unit_price":            float(it["unit_price"] or 0),
        }
        for it in items
    ]
    return d


@app.post("/api/projects/{project_id}/returns/{return_id}/approve")
def approve_return(project_id: int, return_id: int, user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    r = db_one("SELECT id, status FROM order_returns WHERE id=%s AND project_id=%s",
               (return_id, project_id))
    if not r: raise HTTPException(404, "Return not found")
    if r["status"] != "requested":
        raise HTTPException(400, f"Cannot approve from status '{r['status']}'")
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE order_returns SET status='approved', approved_by=%s, approved_at=NOW(),"
            "  updated_at=NOW() WHERE id=%s",
            (user["id"], return_id)
        )
        conn.commit()
    _notify_return_event(project_id, return_id,
                         f"Return #{return_id} approved",
                         "Awaiting customer to ship items back.")
    _email_customer_about_return(project_id, return_id,
        subject="Your return request was approved",
        body_html=(
            "<p>Your return has been <b>approved</b>. Please send the items back "
            "using the shipping method we agreed on.</p>"
            "<p>We'll process your refund once the items are received and inspected.</p>"
        ))
    return {"ok": True, "status": "approved"}


@app.post("/api/projects/{project_id}/returns/{return_id}/reject")
def reject_return(project_id: int, return_id: int, body: RejectReturnBody,
                  user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    r = db_one("SELECT id, status FROM order_returns WHERE id=%s AND project_id=%s",
               (return_id, project_id))
    if not r: raise HTTPException(404, "Return not found")
    if r["status"] not in ("requested", "approved", "received"):
        raise HTTPException(400, f"Cannot reject from status '{r['status']}'")
    reason = sanitize((body.reason or "").strip())[:1000]
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE order_returns SET status='rejected', rejected_reason=%s, updated_at=NOW()"
            " WHERE id=%s",
            (reason, return_id)
        )
        conn.commit()
    _notify_return_event(project_id, return_id,
                         f"Return #{return_id} rejected", reason or "Rejected by merchant.")
    _email_customer_about_return(project_id, return_id,
        subject="Your return request was rejected",
        body_html=(
            "<p>Unfortunately, your return request was <b>rejected</b>.</p>"
            f"<p style='background:#fff3f3;padding:12px;border-radius:8px;color:#b32417'>"
            f"<b>Reason:</b> {sanitize(reason) or 'No reason provided'}</p>"
            "<p>If you believe this was a mistake, please reply to this email or "
            "contact our support team.</p>"
        ))
    return {"ok": True, "status": "rejected"}


@app.post("/api/projects/{project_id}/returns/{return_id}/receive")
def receive_return(project_id: int, return_id: int, user: dict = Depends(get_current_user)):
    """Goods physically arrived at warehouse — mark as received, ready for inspection."""
    require_team_member_or_owner(user, project_id)
    r = db_one("SELECT id, status FROM order_returns WHERE id=%s AND project_id=%s",
               (return_id, project_id))
    if not r: raise HTTPException(404, "Return not found")
    if r["status"] != "approved":
        raise HTTPException(400, f"Cannot receive from status '{r['status']}'")
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE order_returns SET status='received', received_by=%s, received_at=NOW(),"
            "  updated_at=NOW() WHERE id=%s",
            (user["id"], return_id)
        )
        conn.commit()
    _notify_return_event(project_id, return_id,
                         f"Return #{return_id} received",
                         "Inspect items and decide on restocking.")
    return {"ok": True, "status": "received"}


@app.post("/api/projects/{project_id}/returns/{return_id}/inspect")
def inspect_return(project_id: int, return_id: int, body: InspectReturnBody,
                   user: dict = Depends(get_current_user)):
    """Per-item condition + restock decisions. Resellable items get added back to chosen batch."""
    require_team_member_or_owner(user, project_id)
    r = db_one("SELECT id, status FROM order_returns WHERE id=%s AND project_id=%s",
               (return_id, project_id))
    if not r: raise HTTPException(404, "Return not found")
    if r["status"] != "received":
        raise HTTPException(400, f"Cannot inspect from status '{r['status']}'")

    with db_cursor() as (conn, cur):
        for entry in body.items:
            if entry.condition not in ITEM_CONDITIONS:
                raise HTTPException(400, f"Invalid condition '{entry.condition}'")
            cur.execute(
                "SELECT ri.id, ri.quantity, ri.order_item_id, oi.configuration_id"
                "  FROM order_return_items ri"
                "  JOIN order_items oi ON ri.order_item_id = oi.id"
                " WHERE ri.id=%s AND ri.return_id=%s",
                (entry.return_item_id, return_id)
            )
            ri = cur.fetchone()
            if not ri:
                raise HTTPException(404, f"Return item {entry.return_item_id} not found")

            restock_wh = entry.restock_warehouse_id
            restock_batch = entry.restock_batch_id

            # If resellable: must have warehouse + batch. Restock inventory.
            if entry.condition == "resellable":
                if not restock_wh:
                    raise HTTPException(400, "Resellable items require restock_warehouse_id")
                # If batch chosen: top it up. Otherwise create a "Returns" batch.
                if restock_batch:
                    cur.execute(
                        "SELECT id, project_id, sku_id, warehouse_id FROM inventory_batches"
                        " WHERE id=%s FOR UPDATE",
                        (restock_batch,)
                    )
                    b = cur.fetchone()
                    if not b or b["project_id"] != project_id:
                        raise HTTPException(404, "Batch not found in this project")
                    if b["sku_id"] != ri["configuration_id"] or b["warehouse_id"] != restock_wh:
                        raise HTTPException(400, "Batch SKU/warehouse mismatch")
                    cur.execute(
                        "UPDATE inventory_batches"
                        "   SET quantity_remaining = quantity_remaining + %s"
                        " WHERE id=%s",
                        (int(ri["quantity"]), restock_batch)
                    )
                else:
                    cur.execute(
                        "INSERT INTO inventory_batches"
                        "  (project_id, sku_id, warehouse_id, batch_name,"
                        "   quantity_received, quantity_remaining, notes)"
                        " VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                        (project_id, ri["configuration_id"], restock_wh,
                         f"Returns · R#{return_id}", int(ri["quantity"]), int(ri["quantity"]),
                         f"Auto-created from return #{return_id}")
                    )
                    restock_batch = cur.fetchone()["id"]

                # product_stock aggregate top-up
                cur.execute(
                    "INSERT INTO product_stock (sku_id, warehouse_id, quantity, sold_quantity)"
                    " VALUES (%s, %s, %s, 0)"
                    " ON CONFLICT (sku_id, warehouse_id)"
                    " DO UPDATE SET quantity = product_stock.quantity + EXCLUDED.quantity",
                    (ri["configuration_id"], restock_wh, int(ri["quantity"]))
                )
                # l2 aggregate
                cur.execute("SET LOCAL torta.skip_audit = 'on'")
                cur.execute(
                    "UPDATE product_configurations_l2"
                    "   SET stock_quantity = COALESCE("
                    "         (SELECT SUM(quantity) FROM product_stock WHERE sku_id=%s),"
                    "         stock_quantity)"
                    " WHERE id=%s",
                    (ri["configuration_id"], ri["configuration_id"])
                )
                # Audit trail
                cur.execute(
                    "INSERT INTO product_stock_log"
                    "  (project_id, sku_id, warehouse_id, delta, reason, reference_id, note)"
                    " VALUES (%s, %s, %s, %s, 'return', %s, %s)",
                    (project_id, ri["configuration_id"], restock_wh, int(ri["quantity"]),
                     return_id, f"Return #{return_id} · restocked")
                )

            cur.execute(
                "UPDATE order_return_items"
                "   SET condition=%s, restock_warehouse_id=%s, restock_batch_id=%s,"
                "       restocked_at=%s, item_notes=%s"
                " WHERE id=%s",
                (entry.condition, restock_wh, restock_batch,
                 datetime.utcnow() if entry.condition == "resellable" else None,
                 sanitize(entry.item_notes or "")[:1000],
                 entry.return_item_id)
            )

        cur.execute(
            "UPDATE order_returns"
            "   SET status='inspected', inspected_by=%s, inspected_at=NOW(),"
            "       internal_notes = CASE WHEN %s = '' THEN internal_notes ELSE %s END,"
            "       updated_at=NOW()"
            " WHERE id=%s",
            (user["id"], (body.internal_notes or ""),
             sanitize(body.internal_notes or "")[:5000], return_id)
        )
        conn.commit()

    _notify_return_event(project_id, return_id,
                         f"Return #{return_id} inspected",
                         "Ready to issue refund.")
    return {"ok": True, "status": "inspected"}


@app.post("/api/projects/{project_id}/returns/{return_id}/refund")
def refund_return(project_id: int, return_id: int, body: RefundReturnBody,
                  user: dict = Depends(get_current_user)):
    """Process a refund. If the org has a configured payment provider AND the order
    was paid through that provider, this calls the provider's refund API (Stripe.Refund.create
    / Tinkoff Cancel / etc.) and records the real `provider_refund_id`. Otherwise
    falls back to record-only mode (merchant did the refund manually in their dashboard;
    we just store their reference for audit).

    Idempotency: idempotency_key derived from (return_id, refund_amount, refund_reference)
    so retrying the same logical refund doesn't double-charge the merchant's account.
    """
    require_team_member_or_owner(user, project_id)
    r = db_one(
        "SELECT r.id, r.status, r.order_id, r.refund_amount AS prior_refund_amount,"
        "       oh.payment_intent_id, oh.payment_charge_id, oh.payment_status,"
        "       oh.payment_provider, oh.payment_currency, oh.payment_amount_paid,"
        "       oh.total_amount AS order_total, oh.id AS oh_id,"
        "       p.org_id"
        "  FROM order_returns r"
        "  JOIN order_history oh ON oh.id = r.order_id"
        "  JOIN crm_projects p   ON p.id  = r.project_id"
        " WHERE r.id=%s AND r.project_id=%s",
        (return_id, project_id)
    )
    if not r: raise HTTPException(404, "Return not found")
    if r["status"] != "inspected":
        raise HTTPException(400, f"Cannot refund from status '{r['status']}'")
    if body.refund_amount < 0:
        raise HTTPException(400, "Refund amount cannot be negative")
    if body.refund_amount > float(r["payment_amount_paid"] or r["order_total"] or 0) + 0.01:
        raise HTTPException(400, "Refund cannot exceed what was paid")

    # Determine if we should call the provider API
    provider_refund_id = ""
    provider_refund_status = ""
    provider_error = ""
    refund_reference = sanitize(body.refund_method or "")[:40]
    real_ref = sanitize(body.refund_reference or "")[:120]

    cred = db_one(
        "SELECT credentials_encrypted, is_test_mode, provider, stripe_account_id"
        "  FROM crm_payment_credentials"
        " WHERE org_id=%s",
        (r["org_id"],)
    )
    can_call_api = (
        cred and cred["credentials_encrypted"]
        and cred["provider"] not in ("manual", "other")
        and r["payment_provider"] == cred["provider"]
        and r["payment_status"] in ("paid", "partial_refunded")
        and r["payment_charge_id"]
    )

    if can_call_api:
        try:
            creds = decrypt_credentials(cred["credentials_encrypted"])
        except (ValueError, RuntimeError) as e:
            raise HTTPException(500, f"Failed to decrypt credentials: {e}")
        idemp = f"return-{return_id}-{int(round(float(body.refund_amount) * 100))}"
        result = create_refund(
            cred["provider"], creds,
            charge_or_intent_id=r["payment_charge_id"] or r["payment_intent_id"],
            amount=float(body.refund_amount),
            currency=r["payment_currency"] or "USD",
            idempotency_key=idemp,
            is_test_mode=bool(cred["is_test_mode"]),
            stripe_account_id=cred.get("stripe_account_id") or "",
        )
        if not result["ok"]:
            # STRICT: do NOT mark return as refunded if provider rejected
            provider_error = result["error"]
            with db_cursor() as (conn, cur):
                cur.execute(
                    "UPDATE order_returns SET provider_error=%s, updated_at=NOW() WHERE id=%s",
                    (provider_error[:1000], return_id)
                )
                conn.commit()
            raise HTTPException(502, f"Provider refund failed: {provider_error}")
        provider_refund_id = result["data"].get("refund_id", "") or ""
        provider_refund_status = result["data"].get("status", "succeeded") or "succeeded"
        if not real_ref:
            real_ref = provider_refund_id

    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE order_returns"
            "   SET status='refunded',"
            "       refund_amount=%s, refund_method=%s, refund_reference=%s,"
            "       restocking_fee=%s, refund_processed_by=%s, refund_processed_at=NOW(),"
            "       provider_refund_id=%s, provider_refund_status=%s, provider_error='',"
            "       updated_at=NOW()"
            " WHERE id=%s",
            (round(float(body.refund_amount), 2),
             refund_reference,
             real_ref,
             round(float(body.restocking_fee or 0), 2),
             user["id"], provider_refund_id, provider_refund_status, return_id)
        )
        # Mirror onto order_history payment_amount_refunded + payment_status
        cur.execute(
            "SELECT total_amount, payment_amount_refunded, payment_status"
            "  FROM order_history WHERE id=%s FOR UPDATE",
            (r["order_id"],)
        )
        oh = cur.fetchone()
        if oh:
            new_total = float(oh["payment_amount_refunded"] or 0) + float(body.refund_amount)
            full_refund = new_total >= float(oh["total_amount"] or 0) - 0.01
            new_pay_status = "refunded" if full_refund else "partial_refunded"
            # Don't downgrade — keep 'paid' if amount is zero, only update if we have a real refund
            if float(body.refund_amount) > 0:
                cur.execute(
                    "UPDATE order_history"
                    "   SET payment_amount_refunded=%s, payment_status=%s,"
                    "       status=CASE WHEN %s THEN 'refunded' ELSE status END,"
                    "       updated_at=NOW()"
                    " WHERE id=%s",
                    (round(new_total, 2), new_pay_status, full_refund, r["order_id"])
                )
        conn.commit()

    msg_extra = f" via {cred['provider']}" if can_call_api else " (manual)"
    _notify_return_event(project_id, return_id,
                         f"Return #{return_id} refunded{msg_extra}",
                         f"Refund of {round(float(body.refund_amount), 2)} recorded.")
    refund_amount_fmt = round(float(body.refund_amount), 2)
    currency_short = (r["payment_currency"] or "USD").upper()
    _email_customer_about_return(project_id, return_id,
        subject=f"Refund processed — {refund_amount_fmt} {currency_short}",
        body_html=(
            f"<p>Your refund of <b>{refund_amount_fmt} {currency_short}</b> has been processed.</p>"
            + (f"<p style='color:#666;font-size:13px'>Provider reference: <code>{sanitize(real_ref)}</code></p>"
                if real_ref else "")
            + ("<p style='color:#666;font-size:13px'>Funds may take 3-5 business days to appear on your statement.</p>"
                if can_call_api else
                "<p style='color:#666;font-size:13px'>Funds were sent through our payment partner. Please allow time for processing.</p>")
        ))
    return {
        "ok": True,
        "status": "refunded",
        "provider_refund_id": provider_refund_id,
        "provider_refund_status": provider_refund_status,
        "called_provider_api": bool(can_call_api),
    }


# ── CHAT WITH CUSTOMERS ──────────────────────────────────

# Channels: real-time (localhost, no HTTPS) — telegram(long-poll)/discord(Gateway WS)/vk(Long Poll)/webchat(widget); webhook (prod, HTTPS) — whatsapp/instagram/facebook(Meta Graph), viber, x.
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
                                  external_msg_id: str = "",
                                  attachments: list | None = None):
    """Channel-agnostic inbound: upsert conversation, insert message (+attachments), broadcast."""
    attachments = attachments or []
    # Drop empty messages — but keep ones that ONLY have an attachment (e.g. Telegram voice with no caption).
    if not external_chat_id or (not text and not attachments):
        return

    contact_uid = make_contact_uid(channel, external_chat_id, project_id)
    preview     = sanitize(text[:200]) if text else _attachment_preview(attachments)
    safe_text   = sanitize(text[:4000]) if text else ""

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
                """INSERT INTO crm_chat_messages (conversation_id, direction, text, external_msg_id, attachments)
                   VALUES (%s, 'in', %s, %s, %s::jsonb)
                   RETURNING id, conversation_id, direction, text, sender_user_id, attachments, created_at""",
                (conv["id"], safe_text, str(external_msg_id), json.dumps(attachments))
            )
            message = cur.fetchone()
            conn.commit()
        return conv, message

    conv, message = await loop.run_in_executor(None, _upsert)
    await chat_hub.broadcast(project_id, {
        "type":         "message.created",
        "conversation": _serialize_conv(conv),
        "message":      _serialize_msg(message, project_id),
    })


# Short label shown in the conversation list when the message has no text body.
_ATT_PREVIEW = {"image": "📷 Photo", "video": "🎬 Video", "audio": "🎵 Audio",
                "voice": "🎤 Voice message", "file": "📎 File"}

def _attachment_preview(attachments: list) -> str:
    if not attachments: return ""
    a = attachments[0]
    label = _ATT_PREVIEW.get(a.get("type"), "📎 Attachment")
    name  = a.get("filename")
    return f"{label}: {name}"[:200] if name and a.get("type") == "file" else label


# ── Per-channel attachment extractors ────────────────────────────────────────
# Each takes the raw inbound payload and returns a list of dicts with shape:
#   {type, url?, ref?, mime?, filename?, duration?, size?, thumb?}
# `url`  — direct media URL renderable in <img>/<video>/<audio>; if missing, frontend hits /api/chat/messages/{id}/media/{idx}.
# `ref`  — channel-specific lookup token (Telegram file_id, WhatsApp media_id) used by the proxy.

def _extract_telegram_attachments(msg: dict) -> list:
    out = []
    # Telegram sends multiple photo sizes; we keep the largest.
    if msg.get("photo"):
        biggest = max(msg["photo"], key=lambda p: p.get("file_size") or 0)
        out.append({"type": "image", "ref": biggest.get("file_id"),
                    "mime": "image/jpeg", "size": biggest.get("file_size")})
    if msg.get("video"):
        v = msg["video"]
        out.append({"type": "video", "ref": v.get("file_id"),
                    "mime": v.get("mime_type") or "video/mp4",
                    "duration": v.get("duration"), "size": v.get("file_size"),
                    "filename": v.get("file_name")})
    if msg.get("voice"):
        v = msg["voice"]
        out.append({"type": "voice", "ref": v.get("file_id"),
                    "mime": v.get("mime_type") or "audio/ogg",
                    "duration": v.get("duration"), "size": v.get("file_size")})
    if msg.get("audio"):
        a = msg["audio"]
        out.append({"type": "audio", "ref": a.get("file_id"),
                    "mime": a.get("mime_type") or "audio/mpeg",
                    "duration": a.get("duration"), "size": a.get("file_size"),
                    "filename": a.get("file_name") or a.get("title")})
    if msg.get("document"):
        d = msg["document"]
        # Documents can also be stickers/animations — bucket by MIME.
        mime = d.get("mime_type") or "application/octet-stream"
        kind = "image" if mime.startswith("image/") else "video" if mime.startswith("video/") else "file"
        out.append({"type": kind, "ref": d.get("file_id"),
                    "mime": mime, "filename": d.get("file_name"),
                    "size": d.get("file_size")})
    if msg.get("sticker"):
        s = msg["sticker"]
        out.append({"type": "image", "ref": s.get("file_id"),
                    "mime": "image/webp", "size": s.get("file_size")})
    return out


def _extract_discord_attachments(msg: dict) -> list:
    """Discord CDN URLs are public-ish; store directly so the browser can render them."""
    out = []
    for a in (msg.get("attachments") or []):
        mime = a.get("content_type") or "application/octet-stream"
        kind = ("image" if mime.startswith("image/") else
                "video" if mime.startswith("video/") else
                "voice" if a.get("waveform") else
                "audio" if mime.startswith("audio/") else
                "file")
        out.append({"type": kind, "url": a.get("url"),
                    "mime": mime, "filename": a.get("filename"),
                    "size": a.get("size"), "duration": a.get("duration_secs")})
    return out


def _extract_vk_attachments(msg: dict) -> list:
    out = []
    for att in (msg.get("attachments") or []):
        t = att.get("type")
        if t == "photo":
            sizes = (att.get("photo") or {}).get("sizes") or []
            if sizes:
                best = max(sizes, key=lambda s: (s.get("width") or 0) * (s.get("height") or 0))
                out.append({"type": "image", "url": best.get("url"), "mime": "image/jpeg"})
        elif t == "video":
            v = att.get("video") or {}
            # VK doesn't always give a direct mp4 URL — fall back to the player URL.
            url = v.get("player") or (v.get("files") or {}).get("mp4_480") or (v.get("files") or {}).get("mp4_360")
            out.append({"type": "video", "url": url, "mime": "video/mp4",
                        "duration": v.get("duration"), "thumb": (v.get("image") or [{}])[-1].get("url")})
        elif t == "audio_message":
            a = att.get("audio_message") or {}
            out.append({"type": "voice", "url": a.get("link_ogg") or a.get("link_mp3"),
                        "mime": "audio/ogg", "duration": a.get("duration")})
        elif t == "doc":
            d = att.get("doc") or {}
            mime = d.get("ext") and f"application/{d['ext']}" or "application/octet-stream"
            out.append({"type": "file", "url": d.get("url"),
                        "mime": mime, "filename": d.get("title"), "size": d.get("size")})
    return out


def _extract_whatsapp_attachments(msg: dict) -> list:
    """WhatsApp media must be fetched via /{media_id} with token — store ref, proxy resolves at request time."""
    out = []
    for kind in ("image", "video", "audio", "document"):
        m = msg.get(kind)
        if not m: continue
        t = ("file" if kind == "document" else
             "voice" if kind == "audio" and m.get("voice") else
             kind)
        out.append({"type": t, "ref": m.get("id"),
                    "mime": m.get("mime_type"), "filename": m.get("filename")})
    if msg.get("sticker"):
        out.append({"type": "image", "ref": msg["sticker"].get("id"), "mime": "image/webp"})
    return out


def _extract_meta_attachments(msg: dict) -> list:
    """Instagram + Facebook share the same attachment shape — direct CDN URLs in payload.url."""
    out = []
    for a in (msg.get("attachments") or []):
        t = a.get("type")
        url = (a.get("payload") or {}).get("url")
        if not url: continue
        kind = ("image" if t == "image" else
                "video" if t == "video" else
                "audio" if t == "audio" else
                "voice" if t == "audio" else
                "file")
        out.append({"type": kind, "url": url, "mime": None})
    return out


def _extract_viber_attachments(msg: dict) -> list:
    """Viber inlines media URL in the message body — each message has at most one media item."""
    t = msg.get("type")
    if t in ("picture", "video", "file"):
        kind = {"picture": "image", "video": "video", "file": "file"}[t]
        return [{"type": kind, "url": msg.get("media"),
                 "filename": msg.get("file_name"), "size": msg.get("size"),
                 "duration": msg.get("duration")}]
    return []


# ── Telegram long-poll background poller (works on localhost without HTTPS) ───

async def _process_telegram_update(project_id: int, update: dict):
    """Handle one Telegram update: upsert conversation + message (+attachments), broadcast."""
    msg = update.get("message") or update.get("edited_message")
    if not msg:
        return
    chat = msg.get("chat") or {}
    external_chat_id = str(chat.get("id", ""))
    text = (msg.get("text") or msg.get("caption") or "").strip()
    await _handle_inbound_message(
        project_id, "telegram", external_chat_id, text,
        external_msg_id=str(msg.get("message_id", "")),
        attachments=_extract_telegram_attachments(msg),
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
    """Connects to Discord Gateway via WebSocket; receives DMs in real-time (intents 36864)."""

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
            attachments=_extract_discord_attachments(msg),
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
                                    attachments=_extract_vk_attachments(msg),
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


def _serialize_msg(row: dict, project_id: int | None = None) -> dict:
    # Sign the proxy URL for token-protected attachments so the browser can render them via <img>/<video>/<audio>.
    atts = list(row.get("attachments") or [])
    if project_id:
        signed = []
        for i, a in enumerate(atts):
            a = dict(a)
            if a.get("ref") and not a.get("url"):
                a["url"] = _sign_chat_media_url(row["id"], i, project_id)
            signed.append(a)
        atts = signed
    return {
        "id":              row["id"],
        "conversation_id": row["conversation_id"],
        "direction":       row["direction"],
        "text":            row["text"],
        "sender_user_id":  row.get("sender_user_id"),
        "attachments":     atts,
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
        # No external credentials — widget reuses the project's existing api_key + publishable_key (validated by External).
        proj = await loop.run_in_executor(
            None, lambda: db_one("SELECT name FROM crm_projects WHERE id=%s", (project_id,))
        )
        bot_username = (proj or {}).get("name") or "Web chat"

    elif channel == "x":
        # X Account Activity API: creds stored only; subscription must be registered through dev portal manually.
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
                       cursor: Optional[str] = Query(None),
                       limit:  Optional[int] = Query(None),
                       user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    want_pagination, offset, page_size = _pagination_params(cursor, limit)
    sql = (
        "SELECT id, channel, external_chat_id, contact_uid, is_active,"
        "       unread_count, last_message_at, last_message_preview, created_at"
        "  FROM crm_chat_conversations"
        " WHERE project_id=%s"
        " ORDER BY (last_message_at IS NULL), last_message_at DESC, id DESC"
    )
    params: list = [project_id]
    if want_pagination:
        sql += " LIMIT %s OFFSET %s"
        params.extend([page_size + 1, offset])
    rows = db_all(sql, tuple(params))
    serialized = [_serialize_conv(r) for r in rows]
    if want_pagination:
        return _wrap_paginated(True, serialized, offset, page_size)
    # Legacy callers expect the outer {conversations: [...]} envelope.
    return {"conversations": serialized}


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

# Persistent secret for signing chat-media proxy URLs — same secret survives restarts in prod via env, generated at boot for dev.
MEDIA_SIG_SECRET = os.getenv("MEDIA_SIG_SECRET") or secrets.token_hex(32)

# 24h signed URL — long enough that an opened conversation keeps working all day, short enough to limit scrape windows if leaked.
def _sign_chat_media_url(msg_id: int, idx: int, project_id: int, ttl_seconds: int = 86400) -> str:
    exp = int(time.time()) + ttl_seconds
    payload  = f"{msg_id}.{idx}.{project_id}.{exp}"
    sig      = hmac.new(MEDIA_SIG_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{CRM_BACKEND_URL}/api/chat/media/{msg_id}/{idx}?pid={project_id}&exp={exp}&sig={sig}"


def _verify_chat_media_sig(msg_id: int, idx: int, project_id: int, exp: int, sig: str) -> bool:
    if exp < int(time.time()): return False
    payload  = f"{msg_id}.{idx}.{project_id}.{exp}"
    expected = hmac.new(MEDIA_SIG_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(expected, sig)


# Fetches the actual media bytes from the channel's CDN/API — kept server-side so bot tokens never reach the browser.
def _fetch_channel_media(channel: str, ref: str, cfg: dict) -> tuple[bytes, str] | None:
    if channel == "telegram":
        token = cfg.get("bot_token")
        if not (token and ref): return None
        result = _telegram_call(token, "getFile", {"file_id": ref})
        path = ((result.get("result") or {}).get("file_path") or "") if result.get("ok") else ""
        if not path: return None
        try:
            with urllib.request.urlopen(f"https://api.telegram.org/file/bot{token}/{path}", timeout=30) as r:
                return r.read(), r.headers.get("Content-Type", "application/octet-stream")
        except Exception: return None
    if channel == "whatsapp":
        token = cfg.get("access_token")
        if not (token and ref): return None
        try:
            req = urllib.request.Request(f"https://graph.facebook.com/v19.0/{ref}",
                                          headers={"Authorization": f"Bearer {token}"})
            with urllib.request.urlopen(req, timeout=10) as r:
                meta_url = (json.loads(r.read()) or {}).get("url")
            if not meta_url: return None
            req2 = urllib.request.Request(meta_url, headers={"Authorization": f"Bearer {token}"})
            with urllib.request.urlopen(req2, timeout=30) as r:
                return r.read(), r.headers.get("Content-Type", "application/octet-stream")
        except Exception: return None
    return None


@app.get("/api/chat/media/{msg_id}/{idx}")
def get_chat_media(msg_id: int, idx: int,
                   pid: int = Query(...), exp: int = Query(...), sig: str = Query(...)):
    """Streams a chat attachment's bytes — auth via signed URL so <img>/<video> tags work cross-origin."""
    if not _verify_chat_media_sig(msg_id, idx, pid, exp, sig):
        raise HTTPException(403, "Invalid or expired signature")
    row = db_one(
        """SELECT m.attachments, c.channel
             FROM crm_chat_messages m
             JOIN crm_chat_conversations c ON c.id = m.conversation_id
            WHERE m.id=%s AND c.project_id=%s""",
        (msg_id, pid)
    )
    if not row: raise HTTPException(404, "Message not found")
    atts = row.get("attachments") or []
    if idx < 0 or idx >= len(atts): raise HTTPException(404, "Attachment not found")
    att = atts[idx]
    if att.get("url") and not att.get("ref"):
        return RedirectResponse(att["url"])  # CDN-hosted — fast path, no streaming
    integ = db_one(
        "SELECT config FROM crm_chat_integrations WHERE project_id=%s AND channel=%s AND is_active=TRUE",
        (pid, row["channel"])
    )
    if not integ: raise HTTPException(503, "Channel disconnected")
    fetched = _fetch_channel_media(row["channel"], att.get("ref") or "", integ.get("config") or {})
    if not fetched: raise HTTPException(502, "Media unavailable")
    data, mime = fetched
    return Response(content=data, media_type=mime,
                    headers={"Cache-Control": "private, max-age=86400"})


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
        """SELECT id, conversation_id, direction, text, sender_user_id, attachments, created_at
           FROM crm_chat_messages
           WHERE conversation_id=%s
           ORDER BY id ASC""",
        (conv_id,)
    )
    return {"messages": [_serialize_msg(r, project_id) for r in rows]}


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
        # Web-chat replies are stored only — widget polls GET /{api_key}/api/chat/messages?since_id=N.
        external_msg_id = ""

    elif ch == "x":
        token = cfg.get("bearer_token")
        if not token:
            raise HTTPException(400, "X bearer token missing")
        # X API v2 DM endpoint (needs elevated access) — best-effort send; full delivery gated by X dev approval.
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
               RETURNING id, conversation_id, direction, text, sender_user_id, attachments, created_at""",
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

    payload = _serialize_msg(msg, project_id)
    await chat_hub.broadcast(project_id, {
        "type":            "message.created",
        "conversation_id": conv_id,
        "message":         payload,
    })
    return {"ok": True, "message": payload}


@app.delete("/api/chat/messages/{msg_id}")
async def delete_chat_message(msg_id: int,
                              project_id: int = Query(...),
                              user: dict = Depends(get_current_user)):
    """Hard-deletes a single chat message (CRM-side only — does not unsend on the messenger)."""
    require_team_member_or_owner(user, project_id)
    row = db_one(
        """SELECT m.id, m.conversation_id
             FROM crm_chat_messages m
             JOIN crm_chat_conversations c ON c.id = m.conversation_id
            WHERE m.id=%s AND c.project_id=%s""",
        (msg_id, project_id)
    )
    if not row: raise HTTPException(404, "Message not found")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM crm_chat_messages WHERE id=%s", (msg_id,))
        conn.commit()
    await chat_hub.broadcast(project_id, {
        "type":            "message.deleted",
        "conversation_id": row["conversation_id"],
        "message_id":      msg_id,
    })
    return {"ok": True}


# Inbound webhooks: HTTPS-only messengers (Meta family, Viber, Telegram in prod) hit these endpoints; long-poll/Gateway channels go through pollers instead.

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
        attachments=_extract_telegram_attachments(msg),
    )
    return {"ok": True}


# Meta webhook (WhatsApp/Instagram/FB) — GET = hub.challenge handshake; POST = entry[].changes[].value.messages[] (WA) or entry[].messaging[] (IG/FB); optional X-Hub-Signature-256 verify.

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
                        attachments=_extract_whatsapp_attachments(msg),
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
                    attachments=_extract_meta_attachments(msg),
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
                attachments=_extract_viber_attachments(msg),
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


# Internal endpoint: External API forwards web-chat widget messages here so CRM operators see them instantly via the in-process WebSocket hub.

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


# ── BOOKING admin endpoints — services / staff / staff_services / hours (per-staff or project-wide) / settings / bookings; all require team-or-owner, settings+staff require owner ──

BOOKING_STATUSES = ("pending", "confirmed", "cancelled", "completed", "no_show")

# Allowed status transitions; terminal (cancelled/completed) cannot be revived (delete+recreate) — prevents un-cancel of rebooked slots and completed→pending undo bugs.
BOOKING_STATUS_TRANSITIONS = {
    "pending":   {"confirmed", "cancelled", "no_show"},
    "confirmed": {"completed", "cancelled", "no_show"},
    "cancelled": set(),
    "completed": set(),
    "no_show":   set(),
}

# Email/phone format regex (best-effort, prevents obvious garbage)
import re as _bk_re
_BK_EMAIL_RE = _bk_re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_BK_PHONE_RE = _bk_re.compile(r"^[0-9+\s\-()]{4,32}$")

class BookingServiceRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    duration_minutes: int = 30
    price: float = 0
    image_url: Optional[str] = None
    is_active: bool = True
    requires_staff: bool = False
    capacity: int = 1
    staff_ids: Optional[List[int]] = None        # M:N — overwrite link if provided

class BookingStaffRequest(BaseModel):
    name: str
    avatar_url: Optional[str] = None
    bio: Optional[str] = ""
    is_active: bool = True
    service_ids: Optional[List[int]] = None      # M:N — overwrite link if provided

class BookingHourRow(BaseModel):
    day_of_week: int                              # 0=Mon … 6=Sun
    open_time: str                                # "HH:MM"
    close_time: str                               # "HH:MM"

class BookingHoursRequest(BaseModel):
    staff_id: Optional[int] = None                # None → project-wide schedule
    rows: List[BookingHourRow]

class BookingSettingsRequest(BaseModel):
    slot_interval_minutes: int = 15
    min_advance_minutes: int = 60
    max_advance_days: int = 60
    cancellation_window_minutes: int = 1440
    auto_confirm: bool = True
    default_status: str = "confirmed"
    timezone: str = "UTC"

class CreateBookingRequest(BaseModel):
    service_id: int
    staff_id: Optional[int] = None
    starts_at: str                                # ISO 8601, e.g. "2025-04-26T14:00"
    customer_name: str = ""
    customer_phone: str = ""
    customer_email: str = ""
    notes: str = ""
    status: Optional[str] = None                  # admin override; default = pending/confirmed

class UpdateBookingStatusRequest(BaseModel):
    status: str

# ── Services ──────────────────────────────────────────────────────────────────

def _service_with_staff(row: dict) -> dict:
    if not row: return row
    sids = db_all(
        "SELECT staff_id FROM booking_staff_services WHERE service_id=%s",
        (row["id"],)
    )
    row["staff_ids"] = [r["staff_id"] for r in sids]
    return row

@app.get("/api/booking/services")
def booking_list_services(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    rows = db_all(
        "SELECT * FROM booking_services WHERE project_id=%s ORDER BY id ASC",
        (project_id,)
    )
    # Bulk fetch staff links to avoid N+1
    sids = db_all(
        """SELECT bss.service_id, bss.staff_id
           FROM booking_staff_services bss
           JOIN booking_services s ON s.id = bss.service_id
           WHERE s.project_id=%s""",
        (project_id,)
    )
    by_service: dict = {}
    for r in sids:
        by_service.setdefault(r["service_id"], []).append(r["staff_id"])
    for s in rows:
        s["staff_ids"]   = by_service.get(s["id"], [])
        s["price"]       = float(s["price"]) if s["price"] is not None else 0.0
    return rows

def _verify_staff_in_project(staff_ids, project_id):
    """Ensure every staff_id belongs to this project (defence against IDOR
    where a malicious owner links staff from another project to their own
    service). Raises 400 if any id is foreign or unknown."""
    if not staff_ids: return
    rows = db_all(
        "SELECT id FROM booking_staff WHERE id = ANY(%s) AND project_id = %s",
        (list(set(staff_ids)), project_id),
    )
    found = {r["id"] for r in rows}
    missing = [i for i in set(staff_ids) if i not in found]
    if missing:
        raise HTTPException(400, f"Staff not found in this project: {missing}")

def _verify_services_in_project(service_ids, project_id):
    if not service_ids: return
    rows = db_all(
        "SELECT id FROM booking_services WHERE id = ANY(%s) AND project_id = %s",
        (list(set(service_ids)), project_id),
    )
    found = {r["id"] for r in rows}
    missing = [i for i in set(service_ids) if i not in found]
    if missing:
        raise HTTPException(400, f"Service not found in this project: {missing}")

@app.post("/api/booking/services")
def booking_create_service(req: BookingServiceRequest,
                           project_id: int = Query(...),
                           user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if not req.name.strip():
        raise HTTPException(400, "Name is required")
    if req.duration_minutes < 5 or req.duration_minutes > 1440:
        raise HTTPException(400, "Duration must be 5–1440 minutes")
    if req.capacity < 1: raise HTTPException(400, "Capacity must be ≥ 1")
    if req.price is not None and req.price < 0:
        raise HTTPException(400, "Price must be ≥ 0")
    _verify_staff_in_project(req.staff_ids or [], project_id)
    with db_cursor() as (conn, cur):
        cur.execute(
            """INSERT INTO booking_services
                  (project_id, name, description, duration_minutes,
                   price, image_url, is_active, requires_staff, capacity)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (project_id, sanitize(req.name)[:200], sanitize(req.description or "")[:5000],
             req.duration_minutes, req.price, req.image_url,
             req.is_active, req.requires_staff, req.capacity)
        )
        sid = cur.fetchone()["id"]
        if req.staff_ids:
            for st_id in req.staff_ids:
                cur.execute(
                    "INSERT INTO booking_staff_services (staff_id, service_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                    (st_id, sid)
                )
        conn.commit()
    return {"id": sid}

@app.put("/api/booking/services/{sid}")
def booking_update_service(sid: int, req: BookingServiceRequest,
                           project_id: int = Query(...),
                           user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    existing = db_one("SELECT id FROM booking_services WHERE id=%s AND project_id=%s",
                      (sid, project_id))
    if not existing: raise HTTPException(404, "Service not found")
    if req.duration_minutes < 5 or req.duration_minutes > 1440:
        raise HTTPException(400, "Duration must be 5–1440 minutes")
    if req.capacity < 1: raise HTTPException(400, "Capacity must be ≥ 1")
    if req.price is not None and req.price < 0:
        raise HTTPException(400, "Price must be ≥ 0")
    if req.staff_ids is not None:
        _verify_staff_in_project(req.staff_ids, project_id)
    with db_cursor() as (conn, cur):
        cur.execute(
            """UPDATE booking_services SET
                  name=%s, description=%s, duration_minutes=%s,
                  price=%s, image_url=%s, is_active=%s,
                  requires_staff=%s, capacity=%s
               WHERE id=%s""",
            (sanitize(req.name)[:200], sanitize(req.description or "")[:5000],
             req.duration_minutes, req.price, req.image_url,
             req.is_active, req.requires_staff, req.capacity, sid)
        )
        if req.staff_ids is not None:
            cur.execute("DELETE FROM booking_staff_services WHERE service_id=%s", (sid,))
            for st_id in req.staff_ids:
                cur.execute(
                    "INSERT INTO booking_staff_services (staff_id, service_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                    (st_id, sid)
                )
        conn.commit()
    return {"ok": True}

@app.delete("/api/booking/services/{sid}")
def booking_delete_service(sid: int, project_id: int = Query(...),
                           force: bool = Query(False),
                           user: dict = Depends(get_current_user)):
    """Delete a service. Refuses if there are active (pending/confirmed)
    bookings unless ?force=true is passed — frontend should re-prompt the
    owner. Past bookings (completed/cancelled/no_show) are kept and the
    service row deletion is allowed (FK should be ON DELETE SET NULL or
    bookings will become orphaned: callers see service_name=None, which
    _enrich_booking() handles gracefully)."""
    require_owner(user, project_id)
    existing = db_one("SELECT id FROM booking_services WHERE id=%s AND project_id=%s",
                      (sid, project_id))
    if not existing: raise HTTPException(404, "Service not found")
    if not force:
        active = db_one(
            """SELECT COUNT(*) AS n FROM bookings
               WHERE service_id=%s AND project_id=%s AND status = ANY(%s)""",
            (sid, project_id, ["pending", "confirmed"])
        )
        if active and active["n"] > 0:
            raise HTTPException(409,
                f"Service has {active['n']} active booking(s). "
                "Cancel them first, or pass ?force=true to delete anyway.")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM booking_services WHERE id=%s AND project_id=%s",
                    (sid, project_id))
        conn.commit()
    return {"ok": True}

# ── Staff ─────────────────────────────────────────────────────────────────────

@app.get("/api/booking/staff")
def booking_list_staff(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    rows = db_all(
        "SELECT * FROM booking_staff WHERE project_id=%s ORDER BY id ASC",
        (project_id,)
    )
    sids = db_all(
        """SELECT bss.staff_id, bss.service_id
           FROM booking_staff_services bss
           JOIN booking_staff st ON st.id = bss.staff_id
           WHERE st.project_id=%s""",
        (project_id,)
    )
    by_staff: dict = {}
    for r in sids: by_staff.setdefault(r["staff_id"], []).append(r["service_id"])
    for s in rows: s["service_ids"] = by_staff.get(s["id"], [])
    return rows

@app.post("/api/booking/staff")
def booking_create_staff(req: BookingStaffRequest,
                         project_id: int = Query(...),
                         user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if not req.name.strip(): raise HTTPException(400, "Name is required")
    _verify_services_in_project(req.service_ids or [], project_id)
    with db_cursor() as (conn, cur):
        cur.execute(
            """INSERT INTO booking_staff (project_id, name, avatar_url, bio, is_active)
               VALUES (%s,%s,%s,%s,%s) RETURNING id""",
            (project_id, sanitize(req.name)[:200], req.avatar_url,
             sanitize(req.bio or "")[:5000], req.is_active)
        )
        st_id = cur.fetchone()["id"]
        if req.service_ids:
            for s_id in req.service_ids:
                cur.execute(
                    "INSERT INTO booking_staff_services (staff_id, service_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                    (st_id, s_id)
                )
        conn.commit()
    return {"id": st_id}

@app.put("/api/booking/staff/{st_id}")
def booking_update_staff(st_id: int, req: BookingStaffRequest,
                         project_id: int = Query(...),
                         user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    existing = db_one("SELECT id FROM booking_staff WHERE id=%s AND project_id=%s",
                      (st_id, project_id))
    if not existing: raise HTTPException(404, "Staff not found")
    if req.service_ids is not None:
        _verify_services_in_project(req.service_ids, project_id)
    with db_cursor() as (conn, cur):
        cur.execute(
            """UPDATE booking_staff SET name=%s, avatar_url=%s, bio=%s, is_active=%s
               WHERE id=%s""",
            (sanitize(req.name)[:200], req.avatar_url,
             sanitize(req.bio or "")[:5000], req.is_active, st_id)
        )
        if req.service_ids is not None:
            cur.execute("DELETE FROM booking_staff_services WHERE staff_id=%s", (st_id,))
            for s_id in req.service_ids:
                cur.execute(
                    "INSERT INTO booking_staff_services (staff_id, service_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                    (st_id, s_id)
                )
        conn.commit()
    return {"ok": True}

@app.delete("/api/booking/staff/{st_id}")
def booking_delete_staff(st_id: int, project_id: int = Query(...),
                         force: bool = Query(False),
                         user: dict = Depends(get_current_user)):
    """Refuses if there are active (pending/confirmed) bookings unless
    ?force=true. See booking_delete_service for rationale."""
    require_owner(user, project_id)
    existing = db_one("SELECT id FROM booking_staff WHERE id=%s AND project_id=%s",
                      (st_id, project_id))
    if not existing: raise HTTPException(404, "Staff not found")
    if not force:
        active = db_one(
            """SELECT COUNT(*) AS n FROM bookings
               WHERE staff_id=%s AND project_id=%s AND status = ANY(%s)""",
            (st_id, project_id, ["pending", "confirmed"])
        )
        if active and active["n"] > 0:
            raise HTTPException(409,
                f"Staff has {active['n']} active booking(s). "
                "Cancel them first, or pass ?force=true to delete anyway.")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM booking_staff WHERE id=%s AND project_id=%s",
                    (st_id, project_id))
        conn.commit()
    return {"ok": True}

# ── Working hours ─────────────────────────────────────────────────────────────

@app.get("/api/booking/hours")
def booking_get_hours(project_id: int = Query(...),
                      staff_id: Optional[int] = Query(None),
                      user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if staff_id is None:
        rows = db_all(
            "SELECT * FROM booking_hours WHERE project_id=%s AND staff_id IS NULL ORDER BY day_of_week",
            (project_id,)
        )
    else:
        rows = db_all(
            "SELECT * FROM booking_hours WHERE project_id=%s AND staff_id=%s ORDER BY day_of_week",
            (project_id, staff_id)
        )
    return [{
        "day_of_week": r["day_of_week"],
        "open_time":   r["open_time"].strftime("%H:%M"),
        "close_time":  r["close_time"].strftime("%H:%M"),
    } for r in rows]

@app.put("/api/booking/hours")
def booking_set_hours(req: BookingHoursRequest,
                      project_id: int = Query(...),
                      user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if req.staff_id is not None:
        st = db_one("SELECT id FROM booking_staff WHERE id=%s AND project_id=%s",
                    (req.staff_id, project_id))
        if not st: raise HTTPException(404, "Staff not found")
    with db_cursor() as (conn, cur):
        if req.staff_id is None:
            cur.execute(
                "DELETE FROM booking_hours WHERE project_id=%s AND staff_id IS NULL",
                (project_id,)
            )
        else:
            cur.execute(
                "DELETE FROM booking_hours WHERE project_id=%s AND staff_id=%s",
                (project_id, req.staff_id)
            )
        for r in req.rows:
            if not (0 <= r.day_of_week <= 6): continue
            cur.execute(
                """INSERT INTO booking_hours (project_id, staff_id, day_of_week, open_time, close_time)
                   VALUES (%s,%s,%s,%s,%s)""",
                (project_id, req.staff_id, r.day_of_week, r.open_time, r.close_time)
            )
        conn.commit()
    return {"ok": True}

# ── Booking-level settings ────────────────────────────────────────────────────

_BOOKING_SETTINGS_DEFAULTS = {
    "slot_interval_minutes":       15,
    "min_advance_minutes":         60,
    "max_advance_days":            60,
    "cancellation_window_minutes": 1440,
    "auto_confirm":                True,
    "default_status":              "confirmed",
    "timezone":                    "UTC",
}

@app.get("/api/booking/settings")
def booking_get_settings(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one("SELECT * FROM booking_settings WHERE project_id=%s", (project_id,))
    if not row: return {"configured": False, **_BOOKING_SETTINGS_DEFAULTS}
    out = {k: v for k, v in row.items() if k not in ("id", "project_id", "created_at")}
    out["configured"] = True
    return out

@app.put("/api/booking/settings")
def booking_save_settings(req: BookingSettingsRequest,
                          project_id: int = Query(...),
                          user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if req.default_status not in ("pending", "confirmed"):
        raise HTTPException(400, "default_status must be 'pending' or 'confirmed'")
    if req.slot_interval_minutes < 5 or req.slot_interval_minutes > 240:
        raise HTTPException(400, "slot_interval_minutes must be 5–240")
    # Validate the timezone string — if invalid, slots would silently fall back to UTC
    # and the merchant wouldn't realise their config is broken.
    if req.timezone and req.timezone != "UTC":
        try:
            from zoneinfo import ZoneInfo
            ZoneInfo(req.timezone)
        except Exception:
            raise HTTPException(400, f"Unknown timezone: '{req.timezone}'. "
                                       "Use a valid IANA name like 'Asia/Almaty' or 'Europe/Berlin'.")
    cols = ["slot_interval_minutes","min_advance_minutes","max_advance_days",
            "cancellation_window_minutes","auto_confirm","default_status","timezone"]
    vals = tuple(getattr(req, c) for c in cols)
    existing = db_one("SELECT id FROM booking_settings WHERE project_id=%s", (project_id,))
    with db_cursor() as (conn, cur):
        if existing:
            set_clause = ", ".join(f"{c}=%s" for c in cols)
            cur.execute(f"UPDATE booking_settings SET {set_clause} WHERE project_id=%s",
                        vals + (project_id,))
        else:
            placeholders = ",".join(["%s"] * (len(cols) + 1))
            cur.execute(
                f"INSERT INTO booking_settings ({', '.join(cols)}, project_id) VALUES ({placeholders})",
                vals + (project_id,)
            )
        conn.commit()
    return {"ok": True}

# ── Bookings (the actual appointments) ────────────────────────────────────────

def _enrich_booking(rows):
    """Attach service / staff names so the front-end never has to join."""
    if not rows: return rows
    svc_ids   = {r["service_id"] for r in rows}
    staff_ids = {r["staff_id"]   for r in rows if r["staff_id"]}
    svcs  = {r["id"]: r for r in db_all(
        "SELECT id, name, duration_minutes, price FROM booking_services WHERE id = ANY(%s)",
        (list(svc_ids),)
    )} if svc_ids else {}
    stfs  = {r["id"]: r for r in db_all(
        "SELECT id, name, avatar_url FROM booking_staff WHERE id = ANY(%s)",
        (list(staff_ids),)
    )} if staff_ids else {}
    for r in rows:
        s = svcs.get(r["service_id"])
        st = stfs.get(r["staff_id"])
        r["service_name"]     = s["name"] if s else None
        r["service_duration"] = s["duration_minutes"] if s else None
        r["service_price"]    = float(s["price"]) if (s and s["price"] is not None) else 0.0
        r["staff_name"]       = st["name"] if st else None
        r["staff_avatar"]     = st["avatar_url"] if st else None
    return rows

@app.get("/api/booking/stats")
def booking_stats(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    """Aggregate snapshot for the Bookings dashboard: counts by status, this week
    vs last week, no-show rate, average ticket, top staff by completed bookings."""
    require_team_member_or_owner(user, project_id)
    counts = db_all(
        "SELECT status, COUNT(*) AS n FROM bookings WHERE project_id=%s GROUP BY status",
        (project_id,)
    )
    by_status = {r["status"]: int(r["n"]) for r in counts}
    total = sum(by_status.values())
    no_show = by_status.get("no_show", 0)
    completed = by_status.get("completed", 0)
    cancelled = by_status.get("cancelled", 0)

    no_show_rate = (no_show / max(1, completed + no_show + cancelled)) * 100

    avg_row = db_one(
        "SELECT AVG(s.price) AS avg_price FROM bookings b"
        " JOIN booking_services s ON b.service_id=s.id"
        " WHERE b.project_id=%s AND b.status IN ('completed','confirmed')",
        (project_id,)
    )
    avg_ticket = float(avg_row["avg_price"] or 0) if avg_row else 0

    week_row = db_one(
        "SELECT COUNT(*) AS n FROM bookings WHERE project_id=%s AND starts_at >= NOW() - INTERVAL '7 days'",
        (project_id,)
    )
    last_week_row = db_one(
        "SELECT COUNT(*) AS n FROM bookings WHERE project_id=%s "
        "  AND starts_at >= NOW() - INTERVAL '14 days' AND starts_at < NOW() - INTERVAL '7 days'",
        (project_id,)
    )

    top_staff = db_all(
        "SELECT s.id, s.name, COUNT(b.id) AS n FROM booking_staff s"
        " LEFT JOIN bookings b ON b.staff_id=s.id AND b.project_id=%s AND b.status='completed'"
        " WHERE s.project_id=%s GROUP BY s.id, s.name ORDER BY n DESC LIMIT 5",
        (project_id, project_id)
    )

    return {
        "total": total,
        "by_status": by_status,
        "no_show_rate": round(no_show_rate, 1),
        "avg_ticket": round(avg_ticket, 2),
        "week_count": int((week_row or {}).get("n") or 0),
        "last_week_count": int((last_week_row or {}).get("n") or 0),
        "top_staff": [{"id": r["id"], "name": r["name"], "completed": int(r["n"])} for r in top_staff],
    }


@app.get("/api/booking/bookings")
def booking_list(project_id: int = Query(...),
                 from_date: Optional[str] = Query(None),
                 to_date:   Optional[str] = Query(None),
                 status:    Optional[str] = Query(None),
                 cursor:    Optional[str] = Query(None),
                 limit:     Optional[int] = Query(None),
                 user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    want_pagination, offset, page_size = _pagination_params(cursor, limit)
    where = ["project_id=%s"]; params: list = [project_id]
    # Accept date filters as YYYY-MM-DD (business-local midnight→UTC) or full ISO 8601 with TZ offset.
    biz_tz = None
    if from_date or to_date:
        tz_row = db_one("SELECT timezone FROM booking_settings WHERE project_id=%s",
                        (project_id,))
        biz_tz = _tz((tz_row or {}).get("timezone") or "UTC")

    def _parse_filter_date(s, end_of_day=False):
        try:
            if "T" in s:
                d = datetime.fromisoformat(s.replace("Z", "+00:00"))
                if d.tzinfo is None: d = d.replace(tzinfo=biz_tz)
                return d.astimezone(timezone.utc)
            day = datetime.strptime(s, "%Y-%m-%d").date()
            t = dt_time(23, 59, 59) if end_of_day else dt_time(0, 0)
            return datetime.combine(day, t, tzinfo=biz_tz).astimezone(timezone.utc)
        except Exception:
            raise HTTPException(400, f"Invalid date: {s!r}")

    if from_date: where.append("starts_at >= %s"); params.append(_parse_filter_date(from_date))
    if to_date:   where.append("starts_at <  %s"); params.append(_parse_filter_date(to_date))
    if status and status != "all":
        if status not in BOOKING_STATUSES:
            raise HTTPException(400, "Unknown status")
        where.append("status=%s"); params.append(status)
    sql = f"SELECT * FROM bookings WHERE {' AND '.join(where)} ORDER BY starts_at DESC"
    if want_pagination:
        sql += " LIMIT %s OFFSET %s"
        params.extend([page_size + 1, offset])
    rows = db_all(sql, tuple(params))
    enriched = _enrich_booking(rows)
    return _wrap_paginated(want_pagination, enriched, offset, page_size)

@app.post("/api/booking/bookings")
def booking_create_admin(req: CreateBookingRequest,
                         project_id: int = Query(...),
                         user: dict = Depends(get_current_user)):
    """Admin-side booking creation (staff manually adding an appointment).
    Admins bypass min_advance/max_advance windows and the slot-availability
    check (intentional — they may need to record walk-ins or move appointments)."""
    require_team_member_or_owner(user, project_id)
    svc = db_one("SELECT * FROM booking_services WHERE id=%s AND project_id=%s",
                 (req.service_id, project_id))
    if not svc: raise HTTPException(404, "Service not found")
    if svc["requires_staff"] and not req.staff_id:
        raise HTTPException(400, "This service requires selecting a staff member")
    if req.staff_id:
        st = db_one("SELECT id FROM booking_staff WHERE id=%s AND project_id=%s",
                    (req.staff_id, project_id))
        if not st: raise HTTPException(404, "Staff not found")

    # Resolve business timezone to interpret naive datetimes correctly
    tz_row = db_one("SELECT timezone FROM booking_settings WHERE project_id=%s",
                    (project_id,))
    biz_tz = _tz((tz_row or {}).get("timezone") or "UTC")
    try:
        starts = datetime.fromisoformat(req.starts_at.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "Invalid starts_at (expected ISO 8601)")
    # Frontend SHOULD send with TZ offset; if naive, interpret as business-local
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=biz_tz)
    starts = starts.astimezone(timezone.utc)
    ends   = starts + timedelta(minutes=svc["duration_minutes"])
    status = req.status or "confirmed"
    if status not in BOOKING_STATUSES: raise HTTPException(400, "Unknown status")
    # Best-effort customer contact validation
    if req.customer_email and not _BK_EMAIL_RE.match(req.customer_email.strip()):
        raise HTTPException(400, "Invalid customer email")
    if req.customer_phone and not _BK_PHONE_RE.match(req.customer_phone.strip()):
        raise HTTPException(400, "Invalid customer phone")
    if not (req.customer_name or "").strip():
        raise HTTPException(400, "Customer name is required")

    with db_cursor() as (conn, cur):
        # Same advisory lock key as the public endpoint — avoids admin/customer race for the same slot.
        lock_key = (project_id * 10**12
                    + (req.staff_id or 0) * 10**6
                    + (req.service_id or 0))
        cur.execute("SELECT pg_advisory_xact_lock(%s::bigint)", (lock_key,))
        cur.execute(
            """INSERT INTO bookings
                  (project_id, service_id, staff_id, user_id, starts_at, ends_at,
                   status, customer_name, customer_phone, customer_email, notes)
               VALUES (%s,%s,%s,NULL,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (project_id, req.service_id, req.staff_id, starts, ends, status,
             sanitize(req.customer_name)[:200], sanitize(req.customer_phone)[:64],
             sanitize(req.customer_email)[:200], sanitize(req.notes)[:2000])
        )
        bid = cur.fetchone()["id"]
        conn.commit()
    return {"id": bid}

@app.patch("/api/booking/bookings/{bid}")
def booking_update_status(bid: int, req: UpdateBookingStatusRequest,
                          project_id: int = Query(...),
                          user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if req.status not in BOOKING_STATUSES:
        raise HTTPException(400, "Unknown status")
    # Enforce a state machine — terminal statuses cannot be revived
    cur_row = db_one(
        "SELECT status FROM bookings WHERE id=%s AND project_id=%s",
        (bid, project_id),
    )
    if not cur_row:
        raise HTTPException(404, "Booking not found")
    cur_status = cur_row["status"]
    if cur_status == req.status:
        return {"ok": True}  # idempotent
    allowed = BOOKING_STATUS_TRANSITIONS.get(cur_status, set())
    if req.status not in allowed:
        raise HTTPException(409,
            f"Cannot transition from '{cur_status}' to '{req.status}'. "
            f"Allowed: {sorted(allowed) or 'none (terminal state)'}")
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE bookings SET status=%s WHERE id=%s AND project_id=%s",
                    (req.status, bid, project_id))
        conn.commit()
    return {"ok": True}

@app.put("/api/booking/bookings/{bid}/move")
def booking_move(bid: int,
                 starts_at: str = Query(...),
                 project_id: int = Query(...),
                 user: dict = Depends(get_current_user)):
    """Reschedule a booking — used by calendar drag-and-drop. starts_at is naive ISO
    in business TZ. ends_at is recomputed from the linked service's duration."""
    require_team_member_or_owner(user, project_id)
    row = db_one(
        "SELECT b.id, b.service_id, s.duration_minutes FROM bookings b"
        " JOIN booking_services s ON b.service_id=s.id"
        " WHERE b.id=%s AND b.project_id=%s",
        (bid, project_id)
    )
    if not row: raise HTTPException(404, "Booking not found")
    tz_row = db_one("SELECT timezone FROM booking_settings WHERE project_id=%s", (project_id,))
    biz_tz = _tz((tz_row or {}).get("timezone") or "UTC")
    try:
        starts = datetime.fromisoformat(starts_at.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "Invalid starts_at")
    if starts.tzinfo is None:
        starts = starts.replace(tzinfo=biz_tz)
    starts = starts.astimezone(timezone.utc)
    ends = starts + timedelta(minutes=row["duration_minutes"])
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE bookings SET starts_at=%s, ends_at=%s WHERE id=%s", (starts, ends, bid))
        conn.commit()
    return {"ok": True, "starts_at": starts.isoformat(), "ends_at": ends.isoformat()}


@app.delete("/api/booking/bookings/{bid}")
def booking_delete(bid: int, project_id: int = Query(...),
                   user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM bookings WHERE id=%s AND project_id=%s",
                    (bid, project_id))
        conn.commit()
    return {"ok": True}


# INTEGRATIONS / WEBHOOKS — outbound engine: subscribe URLs to events, POST signed JSON, retry, log. Powers Custom/Slack/Discord (type column branches body shape).

ALL_EVENTS = [
    "order.created", "order.paid", "order.shipped", "order.delivered",
    "order.cancelled", "order.returned",
    "booking.created", "booking.confirmed", "booking.completed",
    "booking.cancelled", "booking.no_show",
    "customer.created",
    "payment.received",
    "product.created", "product.updated",
]
ALLOWED_INTEGRATION_TYPES = {"webhook", "slack", "discord"}


def _build_slack_message(event: str, data: dict) -> dict:
    """Render an event as a Slack 'incoming webhook' payload (text + attachment)."""
    label_map = {
        "order.created":      ("🆕 New order",        ":package:"),
        "order.paid":         ("💰 Order paid",       ":moneybag:"),
        "order.shipped":      ("🚚 Order shipped",    ":truck:"),
        "order.delivered":    ("✅ Order delivered",  ":white_check_mark:"),
        "order.cancelled":    ("🚫 Order cancelled",  ":x:"),
        "order.returned":     ("↩ Order returned",    ":arrow_left:"),
        "booking.created":    ("📅 New booking",      ":calendar:"),
        "booking.confirmed":  ("✅ Booking confirmed",":white_check_mark:"),
        "booking.completed":  ("🏁 Booking completed",":checkered_flag:"),
        "booking.cancelled":  ("🚫 Booking cancelled",":x:"),
        "booking.no_show":    ("👻 No-show",           ":ghost:"),
        "customer.created":   ("👤 New customer",     ":bust_in_silhouette:"),
        "payment.received":   ("💸 Payment received", ":dollar:"),
        "product.created":    ("🆕 Product added",    ":new:"),
        "product.updated":    ("✏ Product updated",   ":pencil2:"),
    }
    title, _ = label_map.get(event, (event, ":bell:"))
    fields = []
    if "order_id" in data:    fields.append({"title": "Order #", "value": str(data.get("order_id")), "short": True})
    if "booking_id" in data:  fields.append({"title": "Booking #", "value": str(data.get("booking_id")), "short": True})
    if data.get("amount"):    fields.append({"title": "Amount",
                                              "value": f"{data.get('currency', 'USD')} {data['amount']}",
                                              "short": True})
    cust = data.get("customer") or {}
    if cust.get("name"):      fields.append({"title": "Customer", "value": cust["name"], "short": True})
    if cust.get("email"):     fields.append({"title": "Email",    "value": cust["email"], "short": True})
    if data.get("service_name"): fields.append({"title": "Service", "value": data["service_name"], "short": True})
    if data.get("starts_at"):    fields.append({"title": "Starts at", "value": data["starts_at"], "short": True})
    return {
        "text": title,
        "attachments": [{"color": "#0071E3", "fields": fields}],
    }


def _build_discord_message(event: str, data: dict) -> dict:
    """Render an event as a Discord webhook payload (embeds)."""
    title_map = {
        "order.created":      "🆕 New order",
        "order.paid":         "💰 Order paid",
        "order.shipped":      "🚚 Order shipped",
        "order.delivered":    "✅ Order delivered",
        "order.cancelled":    "🚫 Order cancelled",
        "order.returned":     "↩ Order returned",
        "booking.created":    "📅 New booking",
        "booking.confirmed":  "✅ Booking confirmed",
        "booking.completed":  "🏁 Booking completed",
        "booking.cancelled":  "🚫 Booking cancelled",
        "booking.no_show":    "👻 No-show",
        "customer.created":   "👤 New customer",
        "payment.received":   "💸 Payment received",
        "product.created":    "🆕 Product added",
        "product.updated":    "✏ Product updated",
    }
    title = title_map.get(event, event)
    fields = []
    if "order_id" in data:    fields.append({"name": "Order #", "value": str(data.get("order_id")), "inline": True})
    if "booking_id" in data:  fields.append({"name": "Booking #", "value": str(data.get("booking_id")), "inline": True})
    if data.get("amount"):    fields.append({"name": "Amount",
                                              "value": f"{data.get('currency', 'USD')} {data['amount']}",
                                              "inline": True})
    cust = data.get("customer") or {}
    if cust.get("name"):      fields.append({"name": "Customer", "value": cust["name"], "inline": True})
    if cust.get("email"):     fields.append({"name": "Email",    "value": cust["email"], "inline": True})
    if data.get("service_name"): fields.append({"name": "Service", "value": data["service_name"], "inline": True})
    if data.get("starts_at"):    fields.append({"name": "Starts at", "value": data["starts_at"], "inline": True})
    return {
        "embeds": [{
            "title": title, "color": 0x0071E3,
            "fields": fields,
            "timestamp": _utcnow().isoformat(),
        }],
    }


def _post_webhook(sub: dict, event: str, data: dict, attempt: int = 1) -> dict:
    """Synchronously POSTs an event payload to a single subscription. Returns
    a delivery dict suitable for INSERT into crm_webhook_deliveries."""
    sub_type = sub["type"]
    if sub_type == "slack":
        body_obj   = _build_slack_message(event, data)
        ext_body   = json.dumps(body_obj).encode()
        ext_headers = {"Content-Type": "application/json"}
    elif sub_type == "discord":
        body_obj   = _build_discord_message(event, data)
        ext_body   = json.dumps(body_obj).encode()
        ext_headers = {"Content-Type": "application/json"}
    else:
        body_obj = {
            "event":       event,
            "project_id":  sub["project_id"],
            "occurred_at": _utcnow().isoformat(),
            "data":        data,
        }
        ext_body = json.dumps(body_obj, default=str).encode()
        sig = hmac.new(sub["secret"].encode(), ext_body, hashlib.sha256).hexdigest()
        ext_headers = {
            "Content-Type":       "application/json",
            "X-Torta-Event":      event,
            "X-Torta-Signature":  f"sha256={sig}",
            "X-Torta-Timestamp":  str(int(time.time())),
            "User-Agent":         "Torta-Webhooks/1.0",
        }

    t0  = time.time()
    req = urllib.request.Request(sub["url"], data=ext_body, headers=ext_headers, method="POST")
    out = {
        "subscription_id": sub["id"], "project_id": sub["project_id"],
        "event": event, "payload": json.dumps(body_obj, default=str),
        "attempt": attempt,
    }
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            response_text = resp.read(4096).decode("utf-8", errors="replace")
            out.update({
                "status": "success" if 200 <= resp.status < 300 else "failed",
                "http_code": resp.status, "response_body": response_text[:2000],
                "duration_ms": int((time.time() - t0) * 1000),
            })
    except urllib.error.HTTPError as e:
        try:    body = e.read(4096).decode("utf-8", errors="replace")
        except Exception: body = str(e)
        out.update({"status": "failed", "http_code": e.code,
                    "response_body": body[:2000],
                    "duration_ms": int((time.time() - t0) * 1000)})
    except Exception as e:
        out.update({"status": "failed", "http_code": None,
                    "response_body": str(e)[:2000],
                    "duration_ms": int((time.time() - t0) * 1000)})
    return out


def dispatch_event(project_id: int, event: str, data: dict):
    """Find every active subscription on this project that listens to `event`,
    POST the payload to each, log to crm_webhook_deliveries. Designed for
    BackgroundTasks (fire-and-forget) — never raises into the caller's request."""
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
            out = _post_webhook(dict(sub), event, data, attempt=1)
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
                    (out["status"], out.get("response_body", "")[:500] if out["status"] != "success" else "",
                     sub["id"])
                )
                conn.commit()
        except Exception as e:
            print(f"[webhook] dispatch failed for sub {sub.get('id')}: {e}")


# ── Integration endpoints ───────────────────────────────

class IntegrationCreateRequest(BaseModel):
    type:    str = "webhook"
    name:    str = ""
    url:     str
    events:  Optional[List[str]] = None  # None or [] = all events
    config:  Optional[dict]      = None

class IntegrationUpdateRequest(BaseModel):
    name:      Optional[str]       = None
    url:       Optional[str]       = None
    events:    Optional[List[str]] = None
    config:    Optional[dict]      = None
    is_active: Optional[bool]      = None


@app.get("/api/integrations/events")
def integrations_events(user: dict = Depends(get_current_user)):
    """Public catalog of dispatchable event names — fed into the connector modal
    so the UI doesn't have to keep its own list in sync."""
    return {"events": ALL_EVENTS}


@app.get("/api/integrations")
def integrations_list(project_id: int = Query(...),
                      user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    rows = db_all(
        """SELECT id, type, name, url, events, config, is_active,
                  last_status, last_error, last_event_at, created_at
           FROM crm_webhook_subscriptions WHERE project_id=%s
           ORDER BY id DESC""",
        (project_id,)
    )
    # Stat: how many deliveries each subscription has had (lifetime).
    counts = {}
    for r in db_all(
        "SELECT subscription_id, COUNT(*) AS n FROM crm_webhook_deliveries"
        " WHERE project_id=%s GROUP BY subscription_id", (project_id,)
    ):
        counts[r["subscription_id"]] = r["n"]
    out = []
    for r in rows:
        d = dict(r)
        d["deliveries"]    = counts.get(r["id"], 0)
        d["last_event_at"] = r["last_event_at"].isoformat() if r["last_event_at"] else None
        d["created_at"]    = r["created_at"].isoformat()    if r["created_at"]    else None
        d.pop("secret", None)  # never expose the signing secret over GET list
        out.append(d)
    return out


@app.post("/api/integrations")
def integrations_create(req: IntegrationCreateRequest,
                        project_id: int = Query(...),
                        user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    if req.type not in ALLOWED_INTEGRATION_TYPES:
        raise HTTPException(400, f"Unsupported type. Allowed: {sorted(ALLOWED_INTEGRATION_TYPES)}")
    url = (req.url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "URL must start with http:// or https://")
    events = req.events or []
    invalid = [e for e in events if e not in ALL_EVENTS]
    if invalid:
        raise HTTPException(400, f"Unknown events: {invalid}")
    secret = "wh_sec_" + secrets.token_hex(24)
    name   = (req.name or "").strip()[:200] or _default_integration_name(req.type)
    with db_cursor() as (conn, cur):
        cur.execute(
            """INSERT INTO crm_webhook_subscriptions
                  (project_id, type, name, url, secret, events, config)
               VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb) RETURNING id""",
            (project_id, req.type, sanitize(name), url, secret, events,
             json.dumps(req.config or {}))
        )
        sub_id = cur.fetchone()["id"]
        conn.commit()
    return {"id": sub_id, "secret": secret}


def _default_integration_name(t: str) -> str:
    return {"slack": "Slack notifications", "discord": "Discord notifications",
            "webhook": "Custom Webhook"}.get(t, t.title())


# NOTE: /deliveries routes MUST be declared BEFORE /{sub_id} (FastAPI matches in declaration order).

@app.get("/api/integrations/deliveries")
def integrations_deliveries(project_id: int = Query(...),
                            subscription_id: Optional[int] = Query(None),
                            event: Optional[str] = Query(None),
                            status: Optional[str] = Query(None),
                            limit: int = Query(100, ge=1, le=500),
                            user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    where  = ["d.project_id=%s"]
    params = [project_id]
    if subscription_id is not None: where.append("d.subscription_id=%s"); params.append(subscription_id)
    if event:   where.append("d.event=%s");  params.append(event)
    if status:  where.append("d.status=%s"); params.append(status)
    params.append(limit)
    rows = db_all(
        f"""SELECT d.id, d.subscription_id, d.event, d.status, d.http_code,
                   d.duration_ms, d.attempt, d.created_at, d.response_body,
                   s.type AS sub_type, s.name AS sub_name
            FROM crm_webhook_deliveries d
            LEFT JOIN crm_webhook_subscriptions s ON s.id=d.subscription_id
            WHERE {' AND '.join(where)}
            ORDER BY d.id DESC LIMIT %s""",
        params
    )
    return [{
        **{k: r[k] for k in ("id", "subscription_id", "event", "status",
                              "http_code", "duration_ms", "attempt",
                              "response_body", "sub_type", "sub_name")},
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
    } for r in rows]


@app.get("/api/integrations/deliveries/{delivery_id}")
def integrations_delivery_detail(delivery_id: int,
                                 project_id: int = Query(...),
                                 user: dict = Depends(get_current_user)):
    """Full payload + headers for a single delivery — used by the 'expand row' UX in Logs."""
    require_team_member_or_owner(user, project_id)
    row = db_one(
        "SELECT * FROM crm_webhook_deliveries WHERE id=%s AND project_id=%s",
        (delivery_id, project_id)
    )
    if not row: raise HTTPException(404, "Delivery not found")
    d = dict(row)
    d["created_at"] = row["created_at"].isoformat() if row["created_at"] else None
    return d


@app.post("/api/integrations/deliveries/{delivery_id}/retry")
def integrations_delivery_retry(delivery_id: int,
                                project_id: int = Query(...),
                                user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one(
        "SELECT * FROM crm_webhook_deliveries WHERE id=%s AND project_id=%s",
        (delivery_id, project_id)
    )
    if not row: raise HTTPException(404, "Delivery not found")
    sub = db_one("SELECT * FROM crm_webhook_subscriptions WHERE id=%s AND project_id=%s",
                 (row["subscription_id"], project_id))
    if not sub: raise HTTPException(404, "Integration was deleted")
    try:    payload = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"])
    except Exception: payload = {}
    data = payload.get("data", payload)  # webhook payloads wrap data; slack/discord don't
    out = _post_webhook(dict(sub), row["event"], data, attempt=row["attempt"] + 1)
    with db_cursor() as (conn, cur):
        cur.execute(
            """INSERT INTO crm_webhook_deliveries
                  (subscription_id, project_id, event, payload, status,
                   http_code, response_body, duration_ms, attempt)
               VALUES (%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s)""",
            (out["subscription_id"], out["project_id"], out["event"],
             out["payload"], out["status"], out.get("http_code"),
             out.get("response_body", ""), out.get("duration_ms"), out["attempt"])
        )
        conn.commit()
    return {"status": out["status"], "http_code": out.get("http_code")}


@app.get("/api/integrations/{sub_id}")
def integrations_get(sub_id: int, project_id: int = Query(...),
                     user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one(
        "SELECT * FROM crm_webhook_subscriptions WHERE id=%s AND project_id=%s",
        (sub_id, project_id)
    )
    if not row: raise HTTPException(404, "Integration not found")
    d = dict(row)
    d["last_event_at"] = row["last_event_at"].isoformat() if row["last_event_at"] else None
    d["created_at"]    = row["created_at"].isoformat()    if row["created_at"]    else None
    return d


@app.put("/api/integrations/{sub_id}")
def integrations_update(sub_id: int, req: IntegrationUpdateRequest,
                        project_id: int = Query(...),
                        user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one("SELECT id FROM crm_webhook_subscriptions WHERE id=%s AND project_id=%s",
                 (sub_id, project_id))
    if not row: raise HTTPException(404, "Integration not found")
    fields, values = [], []
    if req.name is not None:
        fields.append("name=%s");  values.append(sanitize(req.name.strip())[:200])
    if req.url is not None:
        u = req.url.strip()
        if not u.startswith(("http://", "https://")):
            raise HTTPException(400, "URL must start with http:// or https://")
        fields.append("url=%s");   values.append(u)
    if req.events is not None:
        invalid = [e for e in req.events if e not in ALL_EVENTS]
        if invalid: raise HTTPException(400, f"Unknown events: {invalid}")
        fields.append("events=%s"); values.append(req.events)
    if req.config is not None:
        fields.append("config=%s::jsonb"); values.append(json.dumps(req.config))
    if req.is_active is not None:
        fields.append("is_active=%s"); values.append(req.is_active)
    if not fields: return {"ok": True}
    values.append(sub_id)
    with db_cursor() as (conn, cur):
        cur.execute(f"UPDATE crm_webhook_subscriptions SET {', '.join(fields)} WHERE id=%s", values)
        conn.commit()
    return {"ok": True}


@app.delete("/api/integrations/{sub_id}")
def integrations_delete(sub_id: int, project_id: int = Query(...),
                        user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM crm_webhook_subscriptions WHERE id=%s AND project_id=%s",
                    (sub_id, project_id))
        conn.commit()
    return {"ok": True}


@app.post("/api/integrations/{sub_id}/test")
def integrations_test(sub_id: int, project_id: int = Query(...),
                      user: dict = Depends(get_current_user)):
    """Sends synthetic 'order.paid' to verify receiver; logged to deliveries like real events."""
    require_team_member_or_owner(user, project_id)
    sub = db_one("SELECT * FROM crm_webhook_subscriptions WHERE id=%s AND project_id=%s",
                 (sub_id, project_id))
    if not sub: raise HTTPException(404, "Integration not found")
    test_data = {
        "order_id": 0, "test": True, "amount": 99.99, "currency": "USD",
        "customer": {"name": "Test Customer", "email": "test@example.com"},
        "items": [{"title": "Test product", "qty": 1, "price": 99.99}],
    }
    out = _post_webhook(dict(sub), "order.paid", test_data, attempt=1)
    with db_cursor() as (conn, cur):
        cur.execute(
            """INSERT INTO crm_webhook_deliveries
                  (subscription_id, project_id, event, payload, status,
                   http_code, response_body, duration_ms, attempt)
               VALUES (%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s)""",
            (out["subscription_id"], out["project_id"], out["event"],
             out["payload"], out["status"], out.get("http_code"),
             out.get("response_body", ""), out.get("duration_ms"), out["attempt"])
        )
        cur.execute(
            "UPDATE crm_webhook_subscriptions SET last_status=%s, last_error=%s, last_event_at=NOW() WHERE id=%s",
            (out["status"], out.get("response_body", "")[:500] if out["status"] != "success" else "",
             sub_id)
        )
        conn.commit()
    return {
        "status": out["status"], "http_code": out.get("http_code"),
        "duration_ms": out.get("duration_ms"),
        "response_body": (out.get("response_body") or "")[:500],
    }


# ── DOCUMENT (PDF) settings ─────────────────────────────

class DocumentSettingsRequest(BaseModel):
    style:         Optional[str] = None
    company_name:  Optional[str] = None
    logo_url:      Optional[str] = None
    address:       Optional[str] = None
    tax_id_label:  Optional[str] = None
    tax_id:        Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    footer_note:   Optional[str] = None
    accent_color:  Optional[str] = None


@app.get("/api/document-settings")
def document_settings_get(project_id: int = Query(...),
                          user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    row = db_one("SELECT * FROM crm_document_settings WHERE project_id=%s", (project_id,))
    if not row:
        return {
            "project_id": project_id, "style": "modern",
            "company_name": "", "logo_url": None, "address": "",
            "tax_id_label": "Tax ID", "tax_id": "",
            "contact_email": "", "contact_phone": "",
            "footer_note": "", "accent_color": "#0071E3",
        }
    return {**row, "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None}


@app.put("/api/document-settings")
def document_settings_save(req: DocumentSettingsRequest,
                           project_id: int = Query(...),
                           user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    allowed_styles = {"modern", "classic", "minimal"}
    if req.style is not None and req.style not in allowed_styles:
        raise HTTPException(400, f"Style must be one of {sorted(allowed_styles)}")
    fields = req.model_dump(exclude_unset=True)
    fields = {k: (sanitize(v) if isinstance(v, str) else v) for k, v in fields.items()}
    cols = ["project_id"] + list(fields.keys())
    vals = [project_id] + [fields[k] for k in fields]
    placeholders = ", ".join(["%s"] * len(cols))
    update_clause = ", ".join(f"{k}=EXCLUDED.{k}" for k in fields) + ", updated_at=NOW()"
    if not fields:
        return {"ok": True}
    with db_cursor() as (conn, cur):
        cur.execute(
            f"INSERT INTO crm_document_settings ({', '.join(cols)}) VALUES ({placeholders})"
            f" ON CONFLICT (project_id) DO UPDATE SET {update_clause}",
            vals
        )
        conn.commit()
    return {"ok": True}


# ── NOTIFICATIONS ────────────────────────────────────────

@app.get("/api/notifications")
def list_notifications(project_id: Optional[int] = Query(None), unread_only: bool = Query(False),
                       limit: int = Query(50), user: dict = Depends(get_current_user)):
    """Latest notifications for the current user; optionally project-scoped + unread-only filter."""
    where = ["user_id = %s"]
    params: list = [user["id"]]
    if project_id is not None:
        require_team_member_or_owner(user, project_id)
        where.append("(project_id = %s OR project_id IS NULL)")
        params.append(project_id)
    if unread_only:
        where.append("is_read = FALSE")
    limit = min(max(1, int(limit)), 200)

    rows = db_all(
        "SELECT id, project_id, type, title, message, link, is_read, created_at"
        "  FROM crm_notifications"
        " WHERE " + " AND ".join(where) +
        " ORDER BY created_at DESC LIMIT %s",
        tuple(params + [limit])
    )
    unread = db_one(
        "SELECT COUNT(*) AS c FROM crm_notifications WHERE user_id=%s AND is_read=FALSE",
        (user["id"],)
    )
    return {"items": rows, "unread": unread["c"] if unread else 0}


@app.post("/api/notifications/{notif_id}/read")
def mark_notification_read(notif_id: int, user: dict = Depends(get_current_user)):
    """Owner-scoped: only the recipient can mark a notification read."""
    with db_cursor() as (conn, cur):
        cur.execute(
            "UPDATE crm_notifications SET is_read=TRUE WHERE id=%s AND user_id=%s",
            (notif_id, user["id"])
        )
        conn.commit()
    return {"ok": True}


@app.post("/api/notifications/read-all")
def mark_all_read(user: dict = Depends(get_current_user)):
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE crm_notifications SET is_read=TRUE WHERE user_id=%s AND is_read=FALSE",
                    (user["id"],))
        conn.commit()
    return {"ok": True}


@app.delete("/api/notifications/{notif_id}")
def delete_notification(notif_id: int, user: dict = Depends(get_current_user)):
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM crm_notifications WHERE id=%s AND user_id=%s",
                    (notif_id, user["id"]))
        conn.commit()
    return {"ok": True}


# ── ANALYTICS ────────────────────────────────────────────
# All endpoints aggregate read-only data — safe to call repeatedly. project access verified up-front.

def _date_range_for_period(period: str):
    """period in {7d, 30d, 90d, year}; returns (start, end) tuples in UTC."""
    end = _utcnow()
    if   period == "7d":   start = end - timedelta(days=7)
    elif period == "30d":  start = end - timedelta(days=30)
    elif period == "90d":  start = end - timedelta(days=90)
    elif period == "year": start = end - timedelta(days=365)
    else:                  start = end - timedelta(days=30)
    return start, end


@app.get("/api/analytics/overview")
def analytics_overview(project_id: int = Query(...), period: str = Query("30d"),
                       user: dict = Depends(get_current_user)):
    """5 KPI cards + daily revenue series + same-length previous-period deltas. Single endpoint for the Overview dashboard tile."""
    require_team_member_or_owner(user, project_id)
    start, end = _date_range_for_period(period)
    prev_start = start - (end - start)

    def _agg(s, e):
        # Aggregate revenue / orders / customers in a single round trip.
        row = db_one(
            "SELECT COUNT(*) AS orders,"
            "       COALESCE(SUM(total_amount), 0) AS revenue,"
            "       COUNT(DISTINCT user_id) AS customers"
            "  FROM order_history"
            " WHERE project_id=%s AND created_at >= %s AND created_at < %s"
            "   AND status NOT IN ('cancelled', 'refunded')",
            (project_id, s, e)
        )
        visitors = db_one(
            "SELECT COUNT(DISTINCT ip_address) AS v FROM site_visits"
            " WHERE project_id=%s AND visit_date >= %s AND visit_date < %s",
            (project_id, s.date(), e.date())
        )
        return {
            "revenue":   float(row["revenue"] or 0),
            "orders":    int(row["orders"] or 0),
            "aov":       float(row["revenue"] or 0) / max(1, int(row["orders"] or 0)),
            "customers": int(row["customers"] or 0),
            "visitors":  int((visitors or {}).get("v") or 0),
        }

    cur = _agg(start, end)
    prev = _agg(prev_start, start)
    cur["conversion"] = (cur["orders"] / cur["visitors"] * 100) if cur["visitors"] else 0
    prev["conversion"] = (prev["orders"] / prev["visitors"] * 100) if prev["visitors"] else 0

    def pct(c, p):
        if not p: return None
        return round((c - p) / p * 100, 1)

    deltas = {
        "revenue":    pct(cur["revenue"],    prev["revenue"]),
        "orders":     pct(cur["orders"],     prev["orders"]),
        "aov":        pct(cur["aov"],        prev["aov"]),
        "customers":  pct(cur["customers"],  prev["customers"]),
        "visitors":   pct(cur["visitors"],   prev["visitors"]),
        "conversion": pct(cur["conversion"], prev["conversion"]),
    }

    # Daily revenue chart (day-bucketed; UTC).
    series = db_all(
        "SELECT DATE(created_at) AS day,"
        "       COALESCE(SUM(total_amount), 0) AS revenue,"
        "       COUNT(*) AS orders"
        "  FROM order_history"
        " WHERE project_id=%s AND created_at >= %s AND created_at < %s"
        "   AND status NOT IN ('cancelled', 'refunded')"
        " GROUP BY day ORDER BY day ASC",
        (project_id, start, end)
    )
    return {
        "current":  cur,
        "previous": prev,
        "delta":    deltas,
        "series":   [{"day": str(r["day"]), "revenue": float(r["revenue"]), "orders": int(r["orders"])} for r in series],
        "period":   period,
    }


@app.get("/api/analytics/funnel")
def analytics_funnel(project_id: int = Query(...), period: str = Query("30d"),
                     user: dict = Depends(get_current_user)):
    """visitors → product_views → ATC → paid. Each step is a count, frontend computes drop-off %."""
    require_team_member_or_owner(user, project_id)
    start, end = _date_range_for_period(period)
    visitors = db_one(
        "SELECT COUNT(DISTINCT ip_address) AS v FROM site_visits"
        " WHERE project_id=%s AND visit_date >= %s AND visit_date < %s",
        (project_id, start.date(), end.date())
    )
    views = db_one(
        "SELECT COUNT(*) AS v FROM product_page_views"
        " WHERE project_id=%s AND view_date >= %s AND view_date < %s",
        (project_id, start.date(), end.date())
    )
    atc = db_one(
        "SELECT COUNT(DISTINCT ci.cart_id) AS v"
        "  FROM cart_items ci JOIN carts c ON ci.cart_id = c.id"
        " WHERE c.project_id=%s AND ci.updated_at >= %s AND ci.updated_at < %s",
        (project_id, start, end)
    )
    paid = db_one(
        "SELECT COUNT(*) AS v FROM order_history"
        " WHERE project_id=%s AND created_at >= %s AND created_at < %s"
        "   AND status NOT IN ('cancelled', 'refunded', 'new')",
        (project_id, start, end)
    )
    return {
        "visitors":      int((visitors or {}).get("v") or 0),
        "product_views": int((views    or {}).get("v") or 0),
        "atc":           int((atc      or {}).get("v") or 0),
        "paid":          int((paid     or {}).get("v") or 0),
    }


@app.get("/api/analytics/top-products")
def analytics_top_products(project_id: int = Query(...), period: str = Query("30d"),
                           by: str = Query("revenue"),  # revenue | margin | units
                           limit: int = Query(10),
                           user: dict = Depends(get_current_user)):
    """Top N products by revenue / margin / units sold within the period."""
    require_team_member_or_owner(user, project_id)
    start, end = _date_range_for_period(period)
    limit = min(max(1, int(limit)), 50)

    if by == "margin":
        order_clause = "margin DESC"
    elif by == "units":
        order_clause = "units DESC"
    else:
        order_clause = "revenue DESC"

    rows = db_all(
        "SELECT p.id, p.title,"
        "       SUM(oi.quantity)                                  AS units,"
        "       SUM(oi.quantity * oi.price)                       AS revenue,"
        "       SUM(oi.quantity * (oi.price - COALESCE(l2.cost_price, 0))) AS margin"
        "  FROM order_items oi"
        "  JOIN products p ON oi.product_id = p.id"
        "  JOIN order_history oh ON oi.order_id = oh.id"
        "  LEFT JOIN product_configurations_l2 l2 ON oi.configuration_id = l2.id"
        " WHERE p.project_id=%s"
        "   AND oh.created_at >= %s AND oh.created_at < %s"
        "   AND oh.status NOT IN ('cancelled', 'refunded')"
        " GROUP BY p.id, p.title"
        " ORDER BY " + order_clause +
        " LIMIT %s",
        (project_id, start, end, limit)
    )
    return [
        {
            "id":       r["id"],
            "title":    r["title"],
            "units":    int(r["units"] or 0),
            "revenue":  float(r["revenue"] or 0),
            "margin":   float(r["margin"] or 0),
        } for r in rows
    ]


@app.get("/api/analytics/inventory-health")
def analytics_inventory_health(project_id: int = Query(...),
                               user: dict = Depends(get_current_user)):
    """Aggregate stock health across project: OOS / low / healthy SKU counts."""
    require_team_member_or_owner(user, project_id)
    row = db_one(
        "SELECT"
        "   COUNT(*) FILTER (WHERE l2.stock_quantity = 0)                       AS oos,"
        "   COUNT(*) FILTER (WHERE l2.stock_quantity > 0"
        "                     AND l2.stock_quantity <= COALESCE(p.low_stock_threshold, 5))     AS low,"
        "   COUNT(*) FILTER (WHERE l2.stock_quantity >  COALESCE(p.low_stock_threshold, 5))    AS healthy,"
        "   COUNT(*)                                                           AS total"
        "  FROM product_configurations_l2 l2"
        "  JOIN product_configurations_l1 l1 ON l2.variation_id = l1.id"
        "  JOIN products p                  ON l1.product_id = p.id"
        " WHERE p.project_id = %s AND p.is_archived = FALSE",
        (project_id,)
    )
    return {
        "oos":     int((row or {}).get("oos") or 0),
        "low":     int((row or {}).get("low") or 0),
        "healthy": int((row or {}).get("healthy") or 0),
        "total":   int((row or {}).get("total") or 0),
    }


# ── NOTIFICATIONS WEBSOCKET ──────────────────────────────
# Push channel: bell icon subscribes; backend fans out events to per-user subscribers.

class NotifHub:
    """In-memory subscriber registry by user_id. Pattern mirrors ChatHub."""
    def __init__(self):
        self._subs: dict[int, set] = {}

    async def subscribe(self, user_id: int, ws):
        self._subs.setdefault(user_id, set()).add(ws)

    async def unsubscribe(self, user_id: int, ws):
        s = self._subs.get(user_id)
        if s:
            s.discard(ws)
            if not s: self._subs.pop(user_id, None)

    async def broadcast(self, user_id: int, message: dict):
        s = self._subs.get(user_id) or set()
        dead = []
        for ws in list(s):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            s.discard(ws)


notif_hub = NotifHub()


@app.websocket("/api/notifications/ws")
async def notifications_ws(ws: WebSocket):
    """Cookie-authenticated; rejects with code 4401 if JWT cookie is missing/invalid (browsers can read close codes)."""
    await ws.accept()
    cookie = ws.cookies.get("crm_token")
    if not cookie:
        await ws.close(code=4401)
        return
    try:
        payload = jwt.decode(cookie, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except Exception:
        await ws.close(code=4401)
        return
    await notif_hub.subscribe(user_id, ws)
    try:
        while True:
            # Keep socket open; client doesn't need to send anything.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await notif_hub.unsubscribe(user_id, ws)


def push_notification(user_id: int, project_id: Optional[int], ntype: str,
                      title: str, message: str = "", link: Optional[str] = None) -> None:
    """Helper: insert notification + broadcast over WebSocket. Used by webhook fanout, order events, etc. Always sanitize() user-supplied content before passing in."""
    try:
        with db_cursor() as (conn, cur):
            cur.execute(
                "INSERT INTO crm_notifications (user_id, project_id, type, title, message, link)"
                " VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, created_at",
                (user_id, project_id, ntype, title[:200], message[:2000], (link or "")[:500])
            )
            row = cur.fetchone()
            conn.commit()
        msg = {
            "id":         row["id"],
            "project_id": project_id,
            "type":       ntype,
            "title":      title,
            "message":    message,
            "link":       link,
            "is_read":    False,
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        }
        # Fire WebSocket broadcast in the background (we're outside an async context here).
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(notif_hub.broadcast(user_id, msg))
        except Exception:
            pass
    except Exception as e:
        print(f"[notifications] push failed: {e}")
