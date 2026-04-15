from fastapi import FastAPI, Response, HTTPException, Request, Depends, UploadFile, File, Query
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
from contextlib import contextmanager
from mysql.connector.pooling import MySQLConnectionPool
import hashlib, secrets, jwt, random, os, io, json, re
import urllib.request, urllib.error

try:
    from PIL import Image as PilImage
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    import cloudinary
    import cloudinary.uploader
    CLOUDINARY_AVAILABLE = True
except ImportError:
    CLOUDINARY_AVAILABLE = False



# ════════════════════════════════════════════
# КОНФИГ
# ════════════════════════════════════════════

SECRET_KEY       = "crm_u7b3f9e2d8c1a4f6e0b5d3a7c9f2e8d4b1c6a0e9f7d3b5c8a2e4d0f6b9c3e7a1"
ALGORITHM        = "HS256"
JWT_HOURS        = 24 * 7
CRM_FRONTEND_URL = "http://localhost:5174"
CRM_BACKEND_URL  = "http://localhost:8001"
DB_CONFIG        = {"host": "localhost", "user": "root", "password": "root", "database": "crmdb"}

SES_API_URL      = "https://ses.tortacrm.com"
SES_INTERNAL_KEY = "821ba4c3ac76f3206f20d338c642bccfb2782e8c986627e81a1aff8d23a13a5d"
EMAIL_FROM       = "support@tortacrm.com"
MAX_FAILED_ATTEMPTS     = 5
BLOCK_MINUTES           = 10
CODE_TTL_MINUTES        = 10
RESEND_COOLDOWN_SECONDS = 60
RESET_TTL_MINUTES       = 30
UPLOADS_DIR             = "uploads"
GOOGLE_CLIENT_ID        = "507611541846-pcl6rqv08gc54021vq4tctca9pnntj0e.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET    = "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"
GOOGLE_REDIRECT_URI     = "http://localhost:8001/api/auth/google/callback"
MAGAZ_BACKEND_URL       = "http://localhost:8000"
CLOUDINARY_CLOUD_NAME   = "due5yumdr"
CLOUDINARY_API_KEY      = "513475749664165"
CLOUDINARY_API_SECRET   = "I35G6txxRQ5A8QKkHh76TzlVDnU"

os.makedirs(UPLOADS_DIR, exist_ok=True)

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

# ════════════════════════════════════════════
# DB POOL
# ════════════════════════════════════════════

_pool = MySQLConnectionPool(pool_name="crm", pool_size=10, pool_reset_session=True, **DB_CONFIG)

def get_db():
    return _pool.get_connection()

@contextmanager
def db_cursor(dictionary=True):
    conn = get_db()
    cursor = conn.cursor(dictionary=dictionary)
    try:
        yield conn, cursor
    finally:
        cursor.close()
        conn.close()

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

if CLOUDINARY_AVAILABLE:
    cloudinary.config(
        cloud_name = CLOUDINARY_CLOUD_NAME,
        api_key    = CLOUDINARY_API_KEY,
        api_secret = CLOUDINARY_API_SECRET,
        secure     = True
    )

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

class UrlConfigRequest(BaseModel):
    frontend_url: str = ""

class AddRedirectUrlRequest(BaseModel):
    url: str

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
    user = db_one("SELECT id, name, email, role FROM crm_users WHERE id = %s AND is_active = 1", (user_id,))
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
    key_row = db_one("SELECT crm_user_id FROM crm_projects WHERE id=%s AND is_active=1", (project_id,))
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
    """Upsert CRM user by Google ID. Returns user_id."""
    user = db_one("SELECT id FROM crm_users WHERE google_id=%s OR (email=%s AND google_id IS NULL)", (g_id, email))
    if user:
        user_id = user["id"]
        with db_cursor() as (conn, cur):
            cur.execute("UPDATE crm_users SET google_id=%s, last_login_at=NOW() WHERE id=%s", (g_id, user_id))
            conn.commit()
    else:
        with db_cursor() as (conn, cur):
            cur.execute(
                "INSERT INTO crm_users (name,email,password,role,google_id,avatar_url) VALUES(%s,%s,'','owner',%s,%s)",
                (sanitize(name), email, g_id, picture)
            )
            conn.commit()
            user_id = cur.lastrowid
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
                "INSERT INTO crm_users (name, email, password, role) VALUES (%s,%s,%s,'owner')",
                (sanitize(pending["name"]), email, hash_pw(pending["password"]))
            )
            conn.commit()
            user_id = cur.lastrowid
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
        "SELECT id, name, email, role FROM crm_users WHERE id = %s AND is_active = 1",
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
            "INSERT INTO crm_organizations (name, slug, owner_id) VALUES (%s,%s,%s)",
            (sanitize(name), slug, user["id"])
        )
        conn.commit()
        return {"id": cur.lastrowid, "name": name, "slug": slug, "is_owner": True, "projects_count": 0}


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
            "INSERT INTO crm_projects (org_id, crm_user_id, name, api_key, publishable_key, last_used_ip, is_active) VALUES (%s,%s,%s,%s,%s,%s,1)",
            (org_id, user["id"], sanitize(name), new_key, new_pk, get_ip(req))
        )
        conn.commit()
        new_id = cur.lastrowid

        cur.execute("INSERT INTO crm_roles (project_id, name, is_system) VALUES (%s,'Owner',1)", (new_id,))
        conn.commit()
        owner_role_id = cur.lastrowid

        cur.execute(
            "INSERT IGNORE INTO crm_team_members (project_id, crm_user_id, crm_role_id) VALUES (%s,%s,%s)",
            (new_id, user["id"], owner_role_id)
        )
        cur.execute("INSERT INTO crm_url_config (project_id, frontend_url) VALUES (%s,%s)", (new_id, frontend_url))
        cur.execute("INSERT IGNORE INTO crm_redirect_urls (project_id, url) VALUES (%s,%s)", (new_id, frontend_url))
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
          AND created_at >= DATE_SUB(NOW(), INTERVAL %s DAY)
    """, (project_id, days))

    # Customers total
    cust = db_one("SELECT COUNT(*) AS cnt FROM users WHERE project_id = %s", pid)

    # Products total
    prod = db_one("SELECT COUNT(*) AS cnt FROM products WHERE project_id = %s", pid)

    # Visits in period
    vis = db_one("""
        SELECT COUNT(*) AS cnt FROM site_visits
        WHERE project_id = %s AND created_at >= DATE_SUB(NOW(), INTERVAL %s DAY)
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
        cur.execute("DELETE ps FROM product_sizes ps JOIN product_variations v ON ps.variation_id=v.id JOIN products p ON v.product_id=p.id WHERE p.project_id=%s", pid)
        cur.execute("DELETE pv FROM product_variations pv JOIN products p ON pv.product_id=p.id WHERE p.project_id=%s", pid)
        cur.execute("DELETE FROM product_custom_fields WHERE project_id=%s", pid)
        cur.execute("DELETE FROM product_reviews     WHERE project_id=%s", pid)
        cur.execute("DELETE FROM product_page_views  WHERE project_id=%s", pid)
        cur.execute("DELETE FROM products            WHERE project_id=%s", pid)
        cur.execute("DELETE ci FROM cart_items ci JOIN carts c ON ci.cart_id=c.id WHERE c.project_id=%s", pid)
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
            "INSERT INTO products (project_id,title,description,characteristics,seo_title,seo_description,seo_keywords) VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (project_id, sanitize(name), sanitize(request.description), sanitize(request.characteristics),
             sanitize(request.seo_title), sanitize(request.seo_description), sanitize(request.seo_keywords))
        )
        conn.commit()
        return {"id": cur.lastrowid, "title": name}


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
        cur.execute("DELETE ps FROM product_sizes ps JOIN product_variations v ON ps.variation_id=v.id WHERE v.product_id=%s", (product_id,))
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
        cur.execute("INSERT INTO product_variations (product_id,variation_name,image_url) VALUES(%s,%s,%s)",
                    (product_id, sanitize(name), request.image_url))
        conn.commit()
        return {"id": cur.lastrowid, "variation_name": name, "image_url": request.image_url, "sizes": []}


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
            "INSERT INTO product_sizes (product_id,variation_id,size_name,price,stock_quantity) VALUES(%s,%s,%s,%s,%s)",
            (product_id, var_id, name, request.price, request.stock_quantity)
        )
        conn.commit()
        return {"id": cur.lastrowid, "variation_id": var_id, "size_name": name,
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
                        (request.field_value, request.field_type, int(request.is_global), ex["id"]))
        else:
            cur.execute("INSERT INTO product_custom_fields (project_id,product_id,field_key,field_value,field_type,is_global) VALUES(%s,%s,%s,%s,%s,%s)",
                        (project_id, product_id, key, request.field_value, request.field_type, int(request.is_global)))
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
    new_val = 0 if row["is_global"] else 1
    with db_cursor() as (conn, cur):
        cur.execute("UPDATE product_custom_fields SET is_global=%s WHERE id=%s", (new_val, row["id"]))
        conn.commit()
    return {"ok": True, "is_global": bool(new_val)}


# ════════════════════════════════════════════
# UPLOAD
# ════════════════════════════════════════════

@app.post("/api/upload/image")
async def upload_image(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
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
    if CLOUDINARY_AVAILABLE:
        try:
            result = cloudinary.uploader.upload(out, folder="crm/products", format="webp",
                                                quality="auto:good", resource_type="image")
            return {"url": result["secure_url"]}
        except Exception as e:
            raise HTTPException(500, f"Cloudinary upload failed: {e}")
    else:
        filename = f"{secrets.token_hex(16)}.webp"
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

    if CLOUDINARY_AVAILABLE:
        try:
            result = cloudinary.uploader.upload(out, folder="crm/avatars",
                                                public_id=f"avatar_{user['id']}", overwrite=True,
                                                format="webp", quality="auto:good", resource_type="image")
            url = result["secure_url"]
        except Exception as e:
            raise HTTPException(500, f"Cloudinary upload failed: {e}")
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
        "configured":  True,
        "domain":      row["domain"],
        "from_name":   row["from_name"],
        "from_email":  row["from_email"],
        "dkim_ok":     bool(row["is_verified"]),
        "spf_ok":      row["verify_token"] in ("spf_ok", "all_ok"),
        "dmarc_ok":    row["verify_token"] == "all_ok",
        "verified_at": row["verified_at"].isoformat() if row["verified_at"] else None,
        "dns_records": dns_records,
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
                    dkim_public=%s, is_verified=0, verify_token='', verified_at=NULL
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
                verified_at=IF(%s=1 AND verified_at IS NULL, NOW(), verified_at)
            WHERE project_id=%s
        """, (int(dkim_ok), "all_ok" if (spf_ok and dmarc_ok) else ("spf_ok" if spf_ok else None), int(all_ok), project_id))
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
                (req.google_client_id or None, req.google_client_secret or None, int(req.google_enabled), project_id)
            )
        else:
            cur.execute(
                "INSERT INTO crm_oauth_settings (project_id, google_client_id, google_client_secret, google_enabled) VALUES(%s,%s,%s,%s)",
                (project_id, req.google_client_id or None, req.google_client_secret or None, int(req.google_enabled))
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
        cur.execute("INSERT INTO crm_redirect_urls (project_id, url) VALUES (%s,%s)", (project_id, url))
        conn.commit()
        return {"ok": True, "id": cur.lastrowid, "url": url}


@app.delete("/api/redirect-urls/{url_id}")
def delete_redirect_url(url_id: int, project_id: int = Query(...), user: dict = Depends(get_current_user)):
    require_owner(user, project_id)
    if not db_one("SELECT id FROM crm_redirect_urls WHERE id=%s AND project_id=%s", (url_id, project_id)):
        raise HTTPException(404, "URL not found")
    with db_cursor() as (conn, cur):
        cur.execute("DELETE FROM crm_redirect_urls WHERE id=%s", (url_id,))
        conn.commit()
    return {"ok": True}
