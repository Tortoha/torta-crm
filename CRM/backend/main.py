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
                    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
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
import kvstore

# Email OTP (pending verifications)
def _pv_key(email: str) -> str: return f"pv:{email}"
def _pv_get(email):    return kvstore.get(_pv_key(email))
def _pv_set(email, v, ttl=None):
    kvstore.set(_pv_key(email), v, ttl=ttl or CODE_TTL_MINUTES * 60)
def _pv_del(email):    kvstore.delete(_pv_key(email))

# Failed-attempt counters (logins, reset, etc.) — atomic INCR with TTL window
def _fail_key(bucket: str, ident: str) -> str: return f"fail:{bucket}:{ident}"
def _fail_check(bucket: str, ident: str):
    key = _fail_key(bucket, ident)
    count = int(kvstore.get(key) or 0)
    if count >= MAX_FAILED_ATTEMPTS:
        return True, max(kvstore.ttl(key), 1)
    return False, 0
def _fail_record(bucket: str, ident: str) -> int:
    return kvstore.incr(_fail_key(bucket, ident), ttl=BLOCK_MINUTES * 60)
def _fail_clear(bucket: str, ident: str):
    kvstore.delete(_fail_key(bucket, ident))

# Password reset tokens
def _reset_key(token_hash: str) -> str: return f"pw_reset:{token_hash}"
def _reset_get(h):    return kvstore.get(_reset_key(h))
def _reset_set(h, v): kvstore.set(_reset_key(h), v, ttl=RESET_TTL_MINUTES * 60)
def _reset_del(h):    kvstore.delete(_reset_key(h))

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
    reason: str                             # 'restock' | 'manual' | 'damage' | 'transfer' | etc.
    note: Optional[str] = ''
    warehouse_id: Optional[int] = None

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
            left = max(kvstore.ttl(_fail_key("login", key)), 1)
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
        for k in kvstore.keys_matching("pw_reset:*"):
            d = kvstore.get(k)
            if d and d.get("email") == email:
                kvstore.delete(k)
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
                  user: dict = Depends(get_current_user)):
    """List products. Filters: category_id, uncategorized, product_type, archived (default false)."""
    require_team_member_or_owner(user, project_id)
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
    return rows


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
        conn.commit()
        return {"id": new_id, "variation_id": var_id, "configuration_name": name,
                "price": request.price, "stock_quantity": request.stock_quantity, "sold_quantity": 0}


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
def list_promo_codes(project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
    _ensure_promo_codes_table()
    rows = db_all(
        "SELECT id, code, discount_type, discount_value, min_order_amount, max_discount,"
        "       usage_limit, times_used, per_user_limit, category_ids,"
        "       is_active, valid_from, valid_until, created_at"
        "  FROM promo_codes WHERE project_id=%s ORDER BY created_at DESC",
        (project_id,)
    )
    for r in rows:
        for nf in ('discount_value', 'min_order_amount', 'max_discount'):
            if r.get(nf) is not None: r[nf] = float(r[nf])
        for tf in ('valid_from', 'valid_until', 'created_at'):
            if r.get(tf) is not None: r[tf] = r[tf].isoformat()
        r["category_ids"] = list(r.get("category_ids") or [])
    return rows


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
    if req.reason not in ('restock', 'manual', 'damage', 'transfer', 'return'):
        raise HTTPException(400, "Invalid reason")
    delta = int(req.delta)
    if delta == 0: raise HTTPException(400, "Delta must be non-zero")
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
        cur.execute(
            "INSERT INTO product_stock_log"
            "  (project_id, sku_id, warehouse_id, delta, reason, user_id, note)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (project_id, req.sku_id, wh_id, delta, req.reason,
             user["id"], sanitize(req.note or '')[:1000])
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
    """Atomic multi-line warehouse transfer (max 500 rows). Body: { transfers: [{ sku_id, from_warehouse_id, to_warehouse_id, quantity, note? }, ...] }."""
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
        parsed.append({"sku_id": sku_id, "from_wh": from_wh, "to_wh": to_wh, "qty": qty, "note": note})

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
            # Two audit log rows — keeps the chronological trail readable per WH.
            cur.execute(
                "INSERT INTO product_stock_log (project_id, sku_id, warehouse_id, delta, reason, user_id, note)"
                " VALUES (%s, %s, %s, %s, 'transfer', %s, %s)",
                (project_id, p["sku_id"], p["from_wh"], -p["qty"], user["id"], p["note"])
            )
            cur.execute(
                "INSERT INTO product_stock_log (project_id, sku_id, warehouse_id, delta, reason, user_id, note)"
                " VALUES (%s, %s, %s, %s, 'transfer', %s, %s)",
                (project_id, p["sku_id"], p["to_wh"], p["qty"], user["id"], p["note"])
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
    """Recompute l2.stock_quantity = SUM(product_stock.quantity) for this SKU."""
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
                                  external_msg_id: str = ""):
    """Channel-agnostic inbound: upsert conversation + insert message + broadcast via WebSocket."""
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
                 user: dict = Depends(get_current_user)):
    require_team_member_or_owner(user, project_id)
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
    rows = db_all(
        f"SELECT * FROM bookings WHERE {' AND '.join(where)} ORDER BY starts_at DESC",
        tuple(params)
    )
    return _enrich_booking(rows)

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
