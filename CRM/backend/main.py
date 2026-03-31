from fastapi import FastAPI, Response, HTTPException, Request, Depends, UploadFile, File
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from datetime import datetime, timedelta
import mysql.connector, hashlib, secrets, jwt, random, resend, os, io

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

SECRET_KEY   = "crm_u7b3f9e2d8c1a4f6e0b5d3a7c9f2e8d4b1c6a0e9f7d3b5c8a2e4d0f6b9c3e7a1"
ALGORITHM    = "HS256"
JWT_HOURS    = 24 * 7
FRONTEND_URL = "http://localhost:5174"
DB_CONFIG    = {"host": "localhost", "user": "root", "password": "root", "database": "crmdb"}

RESEND_API_KEY          = "re_fqgeUf1L_NnvvDEmuLumrE2pkLGLv7wUC"
RESEND_FROM             = "onboarding@resend.dev"
MAX_FAILED_ATTEMPTS     = 5
BLOCK_MINUTES           = 10
CODE_TTL_MINUTES        = 10
RESEND_COOLDOWN_SECONDS = 60
RESET_TTL_MINUTES       = 30
UPLOADS_DIR             = "uploads"
GOOGLE_CLIENT_ID        = "507611541846-pcl6rqv08gc54021vq4tctca9pnntj0e.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET    = "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"
GOOGLE_REDIRECT_URI     = "http://localhost:8001/api/auth/google/callback"
CLOUDINARY_CLOUD_NAME   = "due5yumdr"
CLOUDINARY_API_KEY      = "513475749664165"
CLOUDINARY_API_SECRET   = "I35G6txxRQ5A8QKkHh76TzlVDnU"

os.makedirs(UPLOADS_DIR, exist_ok=True)

app = FastAPI()
resend.api_key = RESEND_API_KEY
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

class CreateApiKeyRequest(BaseModel):
    name: str

class SwitchApiKeyRequest(BaseModel):
    api_key_id: int

class CreateRoleRequest(BaseModel):
    name: str

class UpdateMemberRoleRequest(BaseModel):
    crm_user_id: int; crm_role_id: int

class CreateInviteRequest(BaseModel):
    crm_role_id: int; expires_hours: int = None; max_uses: int = None

class RenameApiKeyRequest(BaseModel):
    name: str

class CreateChannelRequest(BaseModel):
    name: str

class SendMessageRequest(BaseModel):
    message: str

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

class SetPermissionsRequest(BaseModel):
    permissions: list

class GoogleAuthRequest(BaseModel):
    token: str

# ════════════════════════════════════════════
# ФУНКЦИИ
# ════════════════════════════════════════════

ROLE_PERMISSIONS = [
    ("manage_products",  "Manage Products",  "Add, edit and delete products"),
    ("view_orders",      "View Orders",      "View all orders and their status"),
    ("manage_orders",    "Manage Orders",    "Update order status and details"),
    ("view_analytics",   "View Analytics",   "Access revenue and analytics data"),
    ("manage_discounts", "Manage Discounts", "Create and edit promo codes"),
    ("manage_invites",   "Manage Invites",   "Create and revoke invite links"),
]


def get_db():
    return mysql.connector.connect(**DB_CONFIG)

def db_one(sql: str, params: tuple = ()):
    conn = get_db()
    cur  = conn.cursor(dictionary=True)
    cur.execute(sql, params)
    row = cur.fetchone()
    cur.close(); conn.close()
    return row

def db_all(sql: str, params: tuple = ()):
    conn = get_db()
    cur  = conn.cursor(dictionary=True)
    cur.execute(sql, params)
    rows = cur.fetchall()
    cur.close(); conn.close()
    return rows

def run_migrations():
    conn = get_db(); cur = conn.cursor()
    for sql in [
        "ALTER TABLE crm_users ADD COLUMN avatar_url varchar(500) DEFAULT NULL",
        "ALTER TABLE product_custom_fields ADD COLUMN is_global tinyint(1) NOT NULL DEFAULT 0",
        """CREATE TABLE IF NOT EXISTS crm_role_permissions (
            id int(11) NOT NULL AUTO_INCREMENT,
            role_id int(11) NOT NULL,
            permission varchar(100) NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY role_perm (role_id, permission)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8""",
        "ALTER TABLE crm_users ADD COLUMN google_id varchar(255) DEFAULT NULL",
        "ALTER TABLE crm_users ADD COLUMN apple_id varchar(255) DEFAULT NULL",
    ]:
        try: cur.execute(sql); conn.commit()
        except: pass
    cur.close(); conn.close()

run_migrations()


def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def sanitize(v: str) -> str:
    if not isinstance(v, str): return v
    return v.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;").replace("'","&#x27;")

def validate_password(pwd: str):
    """Server-side password rules — applied at registration and reset."""
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

def require_owner(user: dict, api_key_id: int):
    if not db_one("SELECT id FROM crm_api_keys WHERE id = %s AND crm_user_id = %s",
                  (api_key_id, user["id"])):
        raise HTTPException(403, "Only project owner can do this")

def active_key_id(user_id: int) -> int:
    row = db_one("SELECT active_api_key_id FROM crm_users WHERE id = %s", (user_id,))
    if not row or not row["active_api_key_id"]:
        raise HTTPException(400, "No active API key selected")
    return row["active_api_key_id"]

def gen_api_key() -> str:
    raw = secrets.token_bytes(32)
    ts  = str(datetime.utcnow().timestamp()).encode()
    return hashlib.sha256(raw + ts).hexdigest()

# ════════════════════════════════════════════
# Email
# ════════════════════════════════════════════

def send_code_email(email: str, code: int) -> bool:
    try:
        resend.Emails.send({
            "from": RESEND_FROM, "to": email, "subject": "Verification Code",
            "html": f"""<div style="font-family:Arial;text-align:center;padding:40px">
                <h1>Your verification code</h1>
                <p style="font-size:36px;font-weight:bold;letter-spacing:8px">
                    {str(code)[:3]} {str(code)[3:]}</p>
                <p style="color:#666">Expires in 10 minutes.</p></div>"""
        })
        return True
    except Exception as e:
        print(f"Email error: {e}"); return False

def send_reset_email(email: str, token: str) -> bool:
    url = f"{FRONTEND_URL}/reset-password/{token}"
    try:
        resend.Emails.send({
            "from": RESEND_FROM, "to": email, "subject": "Password Reset",
            "html": f"""<div style="font-family:Arial;text-align:center;padding:40px">
                <h1>Reset your password</h1>
                <a href="{url}" style="display:inline-block;margin-top:24px;padding:14px 32px;
                    background:#0071e3;color:#fff;text-decoration:none;border-radius:16px;
                    font-size:18px;font-weight:600">Reset password</a>
                <p style="margin-top:24px;color:#999;font-size:12px">{url}</p></div>"""
        })
        return True
    except Exception as e:
        print(f"Reset email error: {e}"); return False

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

    conn = get_db(); cur = conn.cursor()
    try:
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
    finally:
        cur.close(); conn.close()

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
        "SELECT id, name, email, role, active_api_key_id FROM crm_users WHERE id = %s AND is_active = 1",
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
        return {"success": True}  # Не раскрываем что email не существует

    # Удаляем старые токены этого email
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

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("UPDATE crm_users SET password = %s WHERE email = %s",
                    (hash_pw(request.password), data["email"]))
        conn.commit()
    finally:
        cur.close(); conn.close()
    del password_reset_tokens[h]
    return {"success": True}


# ════════════════════════════════════════════
# API KEYS
# ════════════════════════════════════════════

@app.get("/api/api-keys")
def get_api_keys(user: dict = Depends(get_current_user)):
    rows = db_all("""
        SELECT k.id, k.name, k.api_key, k.is_active,
               k.last_used_at, k.last_used_ip, k.created_at,
               (u.active_api_key_id = k.id) AS is_selected,
               r.name AS user_role
        FROM crm_api_keys k
        JOIN crm_users u ON u.id = %s
        LEFT JOIN crm_team_members tm ON tm.api_key_id = k.id AND tm.crm_user_id = %s
        LEFT JOIN crm_roles r ON r.id = tm.crm_role_id
        WHERE k.crm_user_id = %s OR tm.crm_user_id = %s
        GROUP BY k.id ORDER BY k.created_at DESC
    """, (user["id"], user["id"], user["id"], user["id"]))

    for k in rows:
        k["is_selected"]  = bool(k["is_selected"])
        k["last_used_at"] = k["last_used_at"].isoformat() if k.get("last_used_at") else None
        k["created_at"]   = str(k["created_at"])
    return rows


@app.post("/api/api-keys")
def create_api_key(request: CreateApiKeyRequest, req: Request, user: dict = Depends(get_current_user)):
    if user["role"] != "owner":
        raise HTTPException(403, "Only owner can create API keys")

    name = request.name.strip()
    if not name:               raise HTTPException(400, "Name is required")
    if len(name) > 100:        raise HTTPException(400, "Name too long (max 100)")

    # Генерируем уникальный ключ
    new_key = next(
        (c for _ in range(5)
         if not db_one("SELECT id FROM crm_api_keys WHERE api_key = %s", (c := gen_api_key(),))),
        None
    )
    if not new_key: raise HTTPException(500, "Failed to generate unique key")

    conn = get_db(); cur = conn.cursor(dictionary=True)
    try:
        cur.execute(
            "INSERT INTO crm_api_keys (crm_user_id, name, api_key, last_used_ip, is_active) VALUES (%s,%s,%s,%s,1)",
            (user["id"], sanitize(name), new_key, get_ip(req))
        )
        conn.commit()
        new_id = cur.lastrowid  # ← получаем ID сразу после INSERT

        # Системная роль Owner для нового проекта
        cur.execute("INSERT INTO crm_roles (api_key_id, name, is_system) VALUES (%s,'Owner',1)", (new_id,))
        conn.commit()
        owner_role_id = cur.lastrowid

        # Добавляем создателя как участника (IGNORE — на случай если запись уже есть)
        cur.execute(
            "INSERT IGNORE INTO crm_team_members (api_key_id, crm_user_id, crm_role_id) VALUES (%s,%s,%s)",
            (new_id, user["id"], owner_role_id)
        )

        # Если первый ключ — делаем активным
        cur.execute("SELECT COUNT(*) AS cnt FROM crm_api_keys WHERE crm_user_id = %s", (user["id"],))
        count = cur.fetchone()["cnt"]
        if count == 1:
            cur.execute("UPDATE crm_users SET active_api_key_id = %s WHERE id = %s", (new_id, user["id"]))
        conn.commit()

        return {"id": new_id, "name": name, "api_key": new_key,
                "is_active": True, "is_selected": count == 1}
    finally:
        cur.close(); conn.close()


@app.put("/api/api-keys/switch")
def switch_api_key(request: SwitchApiKeyRequest, user: dict = Depends(get_current_user)):
    key = db_one("""
        SELECT k.id, k.name FROM crm_api_keys k
        LEFT JOIN crm_team_members tm ON tm.api_key_id = k.id AND tm.crm_user_id = %s
        WHERE k.id = %s AND k.is_active = 1
          AND (k.crm_user_id = %s OR tm.crm_user_id IS NOT NULL)
    """, (user["id"], request.api_key_id, user["id"]))
    if not key:
        raise HTTPException(404, "API key not found or access denied")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("UPDATE crm_users SET active_api_key_id=%s WHERE id=%s",
                    (request.api_key_id, user["id"]))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True, "active_key": key}


@app.delete("/api/api-keys/{key_id}")
def delete_api_key(key_id: int, user: dict = Depends(get_current_user)):
    if user["role"] != "owner": raise HTTPException(403, "Only owner can delete API keys")
    if not db_one("SELECT id FROM crm_api_keys WHERE id = %s AND crm_user_id = %s", (key_id, user["id"])):
        raise HTTPException(404, "API key not found")

    cnt = db_one("SELECT COUNT(*) AS c FROM crm_api_keys WHERE crm_user_id = %s", (user["id"],))["c"]
    if cnt <= 1: raise HTTPException(400, "Cannot delete the last API key")

    conn = get_db(); cur = conn.cursor(dictionary=True)
    try:
        # Если удаляем активный — переключаем на другой
        cur.execute("SELECT active_api_key_id FROM crm_users WHERE id = %s", (user["id"],))
        if cur.fetchone()["active_api_key_id"] == key_id:
            cur.execute(
                "SELECT id FROM crm_api_keys WHERE crm_user_id=%s AND id!=%s AND is_active=1 LIMIT 1",
                (user["id"], key_id)
            )
            fb = cur.fetchone()
            if fb:
                cur.execute("UPDATE crm_users SET active_api_key_id=%s WHERE id=%s", (fb["id"], user["id"]))

        cur.execute("DELETE FROM crm_api_keys WHERE id = %s", (key_id,))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


@app.get("/api/me/active-key")
def get_active_key(user: dict = Depends(get_current_user)):
    return db_one("""
        SELECT k.id, k.name, k.api_key FROM crm_users u
        JOIN crm_api_keys k ON k.id = u.active_api_key_id WHERE u.id = %s
    """, (user["id"],)) or {}


# ════════════════════════════════════════════
# ROLES
# ════════════════════════════════════════════

@app.get("/api/roles")
def get_roles(user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    return db_all(
        "SELECT id, name, is_system FROM crm_roles WHERE api_key_id=%s ORDER BY is_system DESC, id ASC",
        (kid,)
    )


@app.post("/api/roles")
def create_role(request: CreateRoleRequest, user: dict = Depends(get_current_user)):
    name = request.name.strip()
    if not name:        raise HTTPException(400, "Role name is required")
    if len(name) > 50:  raise HTTPException(400, "Role name too long (max 50)")

    kid = active_key_id(user["id"])
    require_owner(user, kid)

    if db_one("SELECT id FROM crm_roles WHERE api_key_id=%s AND name=%s", (kid, name)):
        raise HTTPException(400, "Role already exists")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("INSERT INTO crm_roles (api_key_id, name, is_system) VALUES (%s,%s,0)", (kid, sanitize(name)))
        conn.commit()
        return {"id": cur.lastrowid, "name": sanitize(name), "is_system": False}
    finally:
        cur.close(); conn.close()


@app.delete("/api/roles/{role_id}")
def delete_role(role_id: int, user: dict = Depends(get_current_user)):
    kid  = active_key_id(user["id"])
    require_owner(user, kid)
    role = db_one("SELECT id, is_system FROM crm_roles WHERE id=%s AND api_key_id=%s", (role_id, kid))
    if not role:            raise HTTPException(404, "Role not found")
    if role["is_system"]:   raise HTTPException(400, "Cannot delete system role")

    used = db_one("SELECT COUNT(*) AS c FROM crm_team_members WHERE crm_role_id=%s", (role_id,))["c"]
    if used > 0: raise HTTPException(400, "Role is in use, reassign members first")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM crm_roles WHERE id=%s", (role_id,))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


# ════════════════════════════════════════════
# TEAM
# ════════════════════════════════════════════

@app.get("/api/team")
def get_team(user: dict = Depends(get_current_user)):
    conn = get_db(); cur = conn.cursor(dictionary=True)
    try:
        kid = active_key_id(user["id"])
        key_row = db_one("SELECT crm_user_id FROM crm_api_keys WHERE id = %s", (kid,))
        is_owner = key_row and key_row["crm_user_id"] == user["id"]

        if not is_owner:
            if not db_one(
                "SELECT id FROM crm_team_members WHERE api_key_id=%s AND crm_user_id=%s",
                (kid, user["id"])
            ):
                raise HTTPException(403, "You are not a member of this project")

        if is_owner:
            existing = db_one(
                "SELECT id FROM crm_team_members WHERE api_key_id=%s AND crm_user_id=%s",
                (kid, user["id"])
            )
            if not existing:
                owner_role = db_one(
                    "SELECT id FROM crm_roles WHERE api_key_id=%s AND is_system=1",
                    (kid,)
                )
                if not owner_role:
                    c2 = conn.cursor()
                    c2.execute(
                        "INSERT INTO crm_roles (api_key_id, name, is_system) VALUES (%s,'Owner',1)",
                        (kid,)
                    )
                    conn.commit()
                    owner_role_id = c2.lastrowid
                    c2.close()
                else:
                    owner_role_id = owner_role["id"]

                c2 = conn.cursor()
                c2.execute(
                    "INSERT INTO crm_team_members (api_key_id, crm_user_id, crm_role_id) VALUES(%s,%s,%s)",
                    (kid, user["id"], owner_role_id)
                )
                conn.commit()
                c2.close()

        members = db_all("""
            SELECT u.id, u.name, u.email,
                   r.id AS role_id, r.name AS role_name, r.is_system,
                   tm.joined_at, (k.crm_user_id = u.id) AS is_owner
            FROM crm_team_members tm
            JOIN crm_users u    ON u.id = tm.crm_user_id
            JOIN crm_roles r    ON r.id = tm.crm_role_id
            JOIN crm_api_keys k ON k.id = %s
            WHERE tm.api_key_id = %s
            ORDER BY is_owner DESC, tm.joined_at ASC
        """, (kid, kid))

        for m in members:
            m["joined_at"] = str(m["joined_at"])
            m["is_owner"]  = bool(m["is_owner"])
            m["is_system"] = bool(m["is_system"])
            m["is_me"]     = (m["id"] == user["id"])
        return members
    finally:
        cur.close(); conn.close()


@app.put("/api/team/role")
def update_member_role(request: UpdateMemberRoleRequest, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_owner(user, kid)
    if request.crm_user_id == user["id"]: raise HTTPException(400, "Cannot change your own role")
    if not db_one("SELECT id FROM crm_roles WHERE id=%s AND api_key_id=%s", (request.crm_role_id, kid)):
        raise HTTPException(404, "Role not found in this project")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE crm_team_members SET crm_role_id=%s WHERE api_key_id=%s AND crm_user_id=%s",
            (request.crm_role_id, kid, request.crm_user_id)
        )
        conn.commit()
        if cur.rowcount == 0: raise HTTPException(404, "Member not found")
    finally:
        cur.close(); conn.close()
    return {"ok": True}


@app.delete("/api/team/{member_user_id}")
def remove_member(member_user_id: int, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_owner(user, kid)
    if member_user_id == user["id"]: raise HTTPException(400, "Cannot remove yourself")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM crm_team_members WHERE api_key_id=%s AND crm_user_id=%s", (kid, member_user_id))
        conn.commit()
        if cur.rowcount == 0: raise HTTPException(404, "Member not found")
    finally:
        cur.close(); conn.close()
    return {"ok": True}


# ════════════════════════════════════════════
# INVITES
# ════════════════════════════════════════════

@app.post("/api/invites")
def create_invite(request: CreateInviteRequest, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_owner(user, kid)
    if not db_one("SELECT id FROM crm_roles WHERE id=%s AND api_key_id=%s", (request.crm_role_id, kid)):
        raise HTTPException(404, "Role not found")

    token      = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(hours=request.expires_hours) if request.expires_hours else None

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO crm_invites (api_key_id,crm_role_id,token,created_by,expires_at,max_uses) VALUES(%s,%s,%s,%s,%s,%s)",
            (kid, request.crm_role_id, token, user["id"], expires_at, request.max_uses)
        )
        conn.commit()
        return {
            "id": cur.lastrowid, "token": token,
            "invite_url": f"{FRONTEND_URL}/invite/{token}",
            "expires_at": expires_at.isoformat() if expires_at else None,
            "max_uses": request.max_uses,
        }
    finally:
        cur.close(); conn.close()


@app.get("/api/invites")
def get_invites(user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_owner(user, kid)
    rows = db_all("""
        SELECT i.id, i.token, i.uses, i.max_uses, i.expires_at, i.created_at, r.name AS role_name
        FROM crm_invites i JOIN crm_roles r ON r.id = i.crm_role_id
        WHERE i.api_key_id=%s AND i.is_active=1 ORDER BY i.created_at DESC
    """, (kid,))
    for i in rows:
        i["created_at"] = str(i["created_at"])
        i["expires_at"] = i["expires_at"].isoformat() if i["expires_at"] else None
        i["invite_url"] = f"{FRONTEND_URL}/invite/{i['token']}"
    return rows


@app.delete("/api/invites/{invite_id}")
def revoke_invite(invite_id: int, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_owner(user, kid)
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("UPDATE crm_invites SET is_active=0 WHERE id=%s AND api_key_id=%s", (invite_id, kid))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


@app.get("/api/invites/validate/{token}")
def validate_invite(token: str):
    inv = db_one("""
        SELECT i.id, i.api_key_id, i.crm_role_id, i.uses, i.max_uses,
               i.expires_at, i.is_active, r.name AS role_name, k.name AS project_name
        FROM crm_invites i
        JOIN crm_roles r ON r.id = i.crm_role_id
        JOIN crm_api_keys k ON k.id = i.api_key_id
        WHERE i.token = %s
    """, (token,))
    if not inv:                 raise HTTPException(404, "Invite not found")
    if not inv["is_active"]:    raise HTTPException(400, "Invite revoked")
    if inv["expires_at"] and datetime.utcnow() > inv["expires_at"]: raise HTTPException(400, "Invite expired")
    if inv["max_uses"] and inv["uses"] >= inv["max_uses"]:          raise HTTPException(400, "Invite limit reached")
    inv["expires_at"] = inv["expires_at"].isoformat() if inv["expires_at"] else None
    return inv


@app.post("/api/invites/accept/{token}")
def accept_invite(token: str, user: dict = Depends(get_current_user)):
    inv = db_one("""
        SELECT i.*, r.name AS role_name, k.name AS project_name
        FROM crm_invites i JOIN crm_roles r ON r.id=i.crm_role_id JOIN crm_api_keys k ON k.id=i.api_key_id
        WHERE i.token=%s AND i.is_active=1
    """, (token,))
    if not inv: raise HTTPException(404, "Invalid or expired invite")
    if inv["expires_at"] and datetime.utcnow() > inv["expires_at"]: raise HTTPException(400, "Invite expired")
    if inv["max_uses"] and inv["uses"] >= inv["max_uses"]:           raise HTTPException(400, "Invite limit reached")

    conn = get_db(); cur = conn.cursor(dictionary=True)
    try:
        cur.execute("SELECT id FROM crm_team_members WHERE api_key_id=%s AND crm_user_id=%s",
                    (inv["api_key_id"], user["id"]))
        if cur.fetchone():
            cur.execute("UPDATE crm_users SET active_api_key_id=%s WHERE id=%s", (inv["api_key_id"], user["id"]))
            conn.commit()
            return {"ok": True, "message": "Already a member"}

        cur.execute(
            "INSERT INTO crm_team_members (api_key_id,crm_user_id,crm_role_id) VALUES(%s,%s,%s)",
            (inv["api_key_id"], user["id"], inv["crm_role_id"])
        )
        cur.execute("UPDATE crm_users SET active_api_key_id=%s WHERE id=%s", (inv["api_key_id"], user["id"]))
        cur.execute("UPDATE crm_invites SET uses=uses+1 WHERE id=%s", (inv["id"],))
        if inv["max_uses"] and (inv["uses"] + 1) >= inv["max_uses"]:
            cur.execute("UPDATE crm_invites SET is_active=0 WHERE id=%s", (inv["id"],))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True, "project_name": inv["project_name"], "role": inv["role_name"]}


# ════════════════════════════════════════════
# RENAME API KEY
# ════════════════════════════════════════════

@app.put("/api/api-keys/{key_id}/rename")
def rename_api_key(key_id: int, request: RenameApiKeyRequest, user: dict = Depends(get_current_user)):
    name = request.name.strip()
    if not name:         raise HTTPException(400, "Name is required")
    if len(name) > 100:  raise HTTPException(400, "Name too long (max 100)")
    if user["role"] != "owner": raise HTTPException(403, "Only owner can rename API keys")
    if not db_one("SELECT id FROM crm_api_keys WHERE id=%s AND crm_user_id=%s", (key_id, user["id"])):
        raise HTTPException(404, "API key not found")
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("UPDATE crm_api_keys SET name=%s WHERE id=%s", (sanitize(name), key_id))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True, "name": name}


# ════════════════════════════════════════════
# CHAT
# ════════════════════════════════════════════

def require_team_member_or_owner(user: dict, api_key_id: int):
    key_row = db_one("SELECT crm_user_id FROM crm_api_keys WHERE id=%s AND is_active=1", (api_key_id,))
    if not key_row:
        raise HTTPException(404, "Project not found")
    if key_row["crm_user_id"] == user["id"]:
        return  # owner — доступ есть
    if not db_one(
        "SELECT id FROM crm_team_members WHERE api_key_id=%s AND crm_user_id=%s",
        (api_key_id, user["id"])
    ):
        raise HTTPException(403, "Not a member of this project")


@app.get("/api/chat/channels")
def get_channels(user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_team_member_or_owner(user, kid)

    # Авто-создаём #general если каналов ещё нет
    cnt = db_one("SELECT COUNT(*) AS c FROM crm_chat_channels WHERE api_key_id=%s", (kid,))["c"]
    if cnt == 0:
        conn = get_db(); cur = conn.cursor()
        try:
            cur.execute(
                "INSERT INTO crm_chat_channels (api_key_id, name, is_general, created_by) VALUES(%s,'general',1,%s)",
                (kid, user["id"])
            )
            conn.commit()
        finally:
            cur.close(); conn.close()

    rows = db_all(
        "SELECT id, name, is_general, created_at FROM crm_chat_channels WHERE api_key_id=%s ORDER BY is_general DESC, created_at ASC",
        (kid,)
    )
    for r in rows:
        r["created_at"] = str(r["created_at"])
    return rows


@app.post("/api/chat/channels")
def create_channel(request: CreateChannelRequest, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_owner(user, kid)

    name = request.name.strip().lower().replace(" ", "-")
    if not name:        raise HTTPException(400, "Channel name is required")
    if len(name) > 50:  raise HTTPException(400, "Channel name too long (max 50)")
    if db_one("SELECT id FROM crm_chat_channels WHERE api_key_id=%s AND name=%s", (kid, name)):
        raise HTTPException(400, "Channel already exists")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO crm_chat_channels (api_key_id, name, is_general, created_by) VALUES(%s,%s,0,%s)",
            (kid, sanitize(name), user["id"])
        )
        conn.commit()
        return {"id": cur.lastrowid, "name": sanitize(name), "is_general": False, "created_at": str(datetime.utcnow())}
    finally:
        cur.close(); conn.close()


@app.delete("/api/chat/channels/{channel_id}")
def delete_channel(channel_id: int, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_owner(user, kid)
    ch = db_one("SELECT id, is_general FROM crm_chat_channels WHERE id=%s AND api_key_id=%s", (channel_id, kid))
    if not ch:          raise HTTPException(404, "Channel not found")
    if ch["is_general"]: raise HTTPException(400, "Cannot delete the general channel")
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM crm_chat_channels WHERE id=%s", (channel_id,))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


@app.get("/api/chat/channels/{channel_id}/messages")
def get_messages(channel_id: int, after_id: int = None, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_team_member_or_owner(user, kid)
    if not db_one("SELECT id FROM crm_chat_channels WHERE id=%s AND api_key_id=%s", (channel_id, kid)):
        raise HTTPException(404, "Channel not found")

    if after_id:
        rows = db_all("""
            SELECT m.id, m.message, m.created_at, u.id AS user_id, u.name AS user_name
            FROM crm_chat_messages m
            JOIN crm_users u ON u.id = m.user_id
            WHERE m.channel_id=%s AND m.id > %s
            ORDER BY m.created_at ASC
        """, (channel_id, after_id))
    else:
        rows = db_all("""
            SELECT m.id, m.message, m.created_at, u.id AS user_id, u.name AS user_name
            FROM crm_chat_messages m
            JOIN crm_users u ON u.id = m.user_id
            WHERE m.channel_id=%s
            ORDER BY m.created_at DESC LIMIT 50
        """, (channel_id,))
        rows = list(reversed(rows))

    for r in rows:
        r["created_at"] = str(r["created_at"])
        r["is_me"] = (r["user_id"] == user["id"])
    return rows


@app.post("/api/chat/channels/{channel_id}/messages")
def send_message(channel_id: int, request: SendMessageRequest, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_team_member_or_owner(user, kid)
    if not db_one("SELECT id FROM crm_chat_channels WHERE id=%s AND api_key_id=%s", (channel_id, kid)):
        raise HTTPException(404, "Channel not found")

    msg = request.message.strip()
    if not msg:         raise HTTPException(400, "Message cannot be empty")
    if len(msg) > 2000: raise HTTPException(400, "Message too long (max 2000)")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO crm_chat_messages (channel_id, user_id, message) VALUES(%s,%s,%s)",
            (channel_id, user["id"], sanitize(msg))
        )
        conn.commit()
        return {
            "id": cur.lastrowid, "message": msg,
            "user_id": user["id"], "user_name": user["name"],
            "is_me": True, "created_at": str(datetime.utcnow()),
        }
    finally:
        cur.close(); conn.close()

# ════════════════════════════════════════════
# PRODUCTS
# ════════════════════════════════════════════

@app.get("/api/products")
def list_products(user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    rows = db_all(
        "SELECT p.id, p.title,"
        " COUNT(DISTINCT v.id) AS variations_count,"
        " COALESCE(SUM(ps.stock_quantity),0) AS total_stock,"
        " COALESCE(MIN(ps.price),0) AS min_price,"
        " COALESCE(MAX(ps.price),0) AS max_price,"
        " COALESCE(AVG(pr.rating),0) AS avg_rating,"
        " COUNT(DISTINCT pr.id) AS reviews_count"
        " FROM products p"
        " LEFT JOIN product_variations v ON v.product_id=p.id"
        " LEFT JOIN product_sizes ps ON ps.product_id=p.id"
        " LEFT JOIN product_reviews pr ON pr.product_id=p.id"
        " WHERE p.api_key_id=%s GROUP BY p.id ORDER BY p.id DESC",
        (kid,)
    )
    for r in rows:
        r["avg_rating"]  = round(float(r["avg_rating"] or 0), 1)
        r["min_price"]   = float(r["min_price"] or 0)
        r["max_price"]   = float(r["max_price"] or 0)
        r["total_stock"] = int(r["total_stock"] or 0)
    return rows


@app.post("/api/products")
def create_product(request: CreateProductRequest, user: dict = Depends(get_current_user)):
    kid  = active_key_id(user["id"])
    name = request.title.strip()
    if not name: raise HTTPException(400, "Title is required")
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO products (api_key_id,title,description,characteristics,seo_title,seo_description,seo_keywords) VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (kid, sanitize(name), sanitize(request.description), sanitize(request.characteristics),
             sanitize(request.seo_title), sanitize(request.seo_description), sanitize(request.seo_keywords))
        )
        conn.commit()
        return {"id": cur.lastrowid, "title": name}
    finally:
        cur.close(); conn.close()


@app.get("/api/products/{product_id}")
def get_product(product_id: int, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    p   = db_one("SELECT * FROM products WHERE id=%s AND api_key_id=%s", (product_id, kid))
    if not p: raise HTTPException(404, "Product not found")
    variations = db_all(
        "SELECT id, variation_name, image_url FROM product_variations WHERE product_id=%s ORDER BY id ASC",
        (product_id,)
    )
    var_ids = [v["id"] for v in variations]
    sizes = []
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
        " WHERE product_id=%s AND api_key_id=%s ORDER BY created_at ASC",
        (product_id, kid)
    )
    for cf in custom_fields:
        cf["is_global"] = bool(cf.get("is_global", 0))
    reviews = db_all(
        "SELECT pr.id,pr.rating,pr.comment,pr.created_at,u.name AS user_name"
        " FROM product_reviews pr JOIN users u ON u.id=pr.user_id"
        " WHERE pr.product_id=%s ORDER BY pr.created_at DESC",
        (product_id,)
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
def update_product(product_id: int, request: UpdateProductRequest, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    if not db_one("SELECT id FROM products WHERE id=%s AND api_key_id=%s", (product_id, kid)):
        raise HTTPException(404, "Product not found")
    fields = []; vals = []
    if request.title           is not None: fields.append("title=%s");           vals.append(request.title.strip())
    if request.description     is not None: fields.append("description=%s");     vals.append(request.description)
    if request.characteristics is not None: fields.append("characteristics=%s"); vals.append(request.characteristics)
    if request.seo_title       is not None: fields.append("seo_title=%s");       vals.append(request.seo_title)
    if request.seo_description is not None: fields.append("seo_description=%s"); vals.append(request.seo_description)
    if request.seo_keywords    is not None: fields.append("seo_keywords=%s");    vals.append(request.seo_keywords)
    if not fields: return {"ok": True}
    vals.append(product_id)
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("UPDATE products SET " + ", ".join(fields) + " WHERE id=%s", vals)
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


@app.delete("/api/products/{product_id}")
def delete_product(product_id: int, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    if not db_one("SELECT id FROM products WHERE id=%s AND api_key_id=%s", (product_id, kid)):
        raise HTTPException(404, "Product not found")
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("DELETE ps FROM product_sizes ps JOIN product_variations v ON ps.variation_id=v.id WHERE v.product_id=%s", (product_id,))
        cur.execute("DELETE FROM product_variations WHERE product_id=%s",    (product_id,))
        cur.execute("DELETE FROM product_custom_fields WHERE product_id=%s", (product_id,))
        cur.execute("DELETE FROM product_reviews WHERE product_id=%s",       (product_id,))
        cur.execute("DELETE FROM products WHERE id=%s",                      (product_id,))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}

# ════════════════════════════════════════════
# Variations
# ════════════════════════════════════════════

@app.post("/api/products/{product_id}/variations")
def create_variation(product_id: int, request: CreateVariationRequest, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    if not db_one("SELECT id FROM products WHERE id=%s AND api_key_id=%s", (product_id, kid)):
        raise HTTPException(404, "Product not found")
    name = request.variation_name.strip()
    if not name: raise HTTPException(400, "Variation name is required")
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("INSERT INTO product_variations (product_id,variation_name,image_url) VALUES(%s,%s,%s)",
                    (product_id, sanitize(name), request.image_url))
        conn.commit()
        return {"id": cur.lastrowid, "variation_name": name, "image_url": request.image_url, "sizes": []}
    finally:
        cur.close(); conn.close()


@app.put("/api/products/{product_id}/variations/{var_id}")
def update_variation(product_id: int, var_id: int, request: UpdateVariationRequest, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    if not db_one("SELECT id FROM products WHERE id=%s AND api_key_id=%s", (product_id, kid)):
        raise HTTPException(404, "Product not found")
    if not db_one("SELECT id FROM product_variations WHERE id=%s AND product_id=%s", (var_id, product_id)):
        raise HTTPException(404, "Variation not found")
    fields = []; vals = []
    if request.variation_name is not None: fields.append("variation_name=%s"); vals.append(request.variation_name.strip())
    if request.image_url      is not None: fields.append("image_url=%s");      vals.append(request.image_url)
    if not fields: return {"ok": True}
    vals.append(var_id)
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("UPDATE product_variations SET " + ", ".join(fields) + " WHERE id=%s", vals)
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


@app.delete("/api/products/{product_id}/variations/{var_id}")
def delete_variation(product_id: int, var_id: int, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    if not db_one("SELECT id FROM products WHERE id=%s AND api_key_id=%s", (product_id, kid)):
        raise HTTPException(404, "Product not found")
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM product_sizes WHERE variation_id=%s", (var_id,))
        cur.execute("DELETE FROM product_variations WHERE id=%s AND product_id=%s", (var_id, product_id))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


# ════════════════════════════════════════════
# Sizes
# ════════════════════════════════════════════

@app.post("/api/products/{product_id}/variations/{var_id}/sizes")
def create_size(product_id: int, var_id: int, request: CreateSizeRequest, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    if not db_one("SELECT id FROM products WHERE id=%s AND api_key_id=%s", (product_id, kid)):
        raise HTTPException(404, "Product not found")
    if not db_one("SELECT id FROM product_variations WHERE id=%s AND product_id=%s", (var_id, product_id)):
        raise HTTPException(404, "Variation not found")
    name = request.size_name.strip()
    if not name: raise HTTPException(400, "Size name is required")
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO product_sizes (product_id,variation_id,size_name,price,stock_quantity) VALUES(%s,%s,%s,%s,%s)",
            (product_id, var_id, name, request.price, request.stock_quantity)
        )
        conn.commit()
        return {"id": cur.lastrowid, "variation_id": var_id, "size_name": name,
                "price": request.price, "stock_quantity": request.stock_quantity, "sold_quantity": 0}
    finally:
        cur.close(); conn.close()


@app.put("/api/products/{product_id}/variations/{var_id}/sizes/{size_id}")
def update_size(product_id: int, var_id: int, size_id: int, request: UpdateSizeRequest, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    if not db_one("SELECT id FROM products WHERE id=%s AND api_key_id=%s", (product_id, kid)):
        raise HTTPException(404, "Product not found")
    fields = []; vals = []
    if request.size_name      is not None: fields.append("size_name=%s");      vals.append(request.size_name.strip())
    if request.price          is not None: fields.append("price=%s");          vals.append(request.price)
    if request.stock_quantity is not None: fields.append("stock_quantity=%s"); vals.append(request.stock_quantity)
    if not fields: return {"ok": True}
    vals.append(size_id)
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("UPDATE product_sizes SET " + ", ".join(fields) + " WHERE id=%s", vals)
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


@app.delete("/api/products/{product_id}/variations/{var_id}/sizes/{size_id}")
def delete_size(product_id: int, var_id: int, size_id: int, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    if not db_one("SELECT id FROM products WHERE id=%s AND api_key_id=%s", (product_id, kid)):
        raise HTTPException(404, "Product not found")
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM product_sizes WHERE id=%s AND variation_id=%s", (size_id, var_id))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


# ════════════════════════════════════════════
# Custom Fields
# ════════════════════════════════════════════

@app.post("/api/products/{product_id}/custom-fields")
def upsert_custom_field(product_id: int, request: UpsertCustomFieldRequest, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    if not db_one("SELECT id FROM products WHERE id=%s AND api_key_id=%s", (product_id, kid)):
        raise HTTPException(404, "Product not found")
    key = request.field_key.strip().lower().replace(" ", "_")
    if not key: raise HTTPException(400, "Field key is required")
    conn = get_db(); cur = conn.cursor()
    try:
        ex = db_one("SELECT id FROM product_custom_fields WHERE product_id=%s AND api_key_id=%s AND field_key=%s",
                    (product_id, kid, key))
        if ex:
            cur.execute("UPDATE product_custom_fields SET field_value=%s,field_type=%s,is_global=%s WHERE id=%s",
                        (request.field_value, request.field_type, int(request.is_global), ex["id"]))
        else:
            cur.execute("INSERT INTO product_custom_fields (api_key_id,product_id,field_key,field_value,field_type,is_global) VALUES(%s,%s,%s,%s,%s,%s)",
                        (kid, product_id, key, request.field_value, request.field_type, int(request.is_global)))
        conn.commit()
        return {"ok": True, "field_key": key, "is_global": request.is_global}
    finally:
        cur.close(); conn.close()


@app.delete("/api/products/{product_id}/custom-fields/{field_key}")
def delete_custom_field(product_id: int, field_key: str, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    if not db_one("SELECT id FROM products WHERE id=%s AND api_key_id=%s", (product_id, kid)):
        raise HTTPException(404, "Product not found")
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM product_custom_fields WHERE product_id=%s AND api_key_id=%s AND field_key=%s",
                    (product_id, kid, field_key))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


@app.patch("/api/products/{product_id}/custom-fields/{field_key}/global")
def toggle_custom_field_global(product_id: int, field_key: str, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    row = db_one("SELECT id, is_global FROM product_custom_fields WHERE product_id=%s AND api_key_id=%s AND field_key=%s",
                 (product_id, kid, field_key))
    if not row: raise HTTPException(404, "Field not found")
    new_val = 0 if row["is_global"] else 1
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("UPDATE product_custom_fields SET is_global=%s WHERE id=%s", (new_val, row["id"]))
        conn.commit()
    finally:
        cur.close(); conn.close()
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
            result = cloudinary.uploader.upload(
                out,
                folder="crm/products",
                format="webp",
                quality="auto:good",
                resource_type="image"
            )
            return {"url": result["secure_url"]}
        except Exception as e:
            raise HTTPException(500, f"Cloudinary upload failed: {e}")
    else:
        filename = f"{secrets.token_hex(16)}.webp"
        path = os.path.join(UPLOADS_DIR, filename)
        with open(path, "wb") as f:
            f.write(out.read())
        return {"url": f"http://localhost:8001/uploads/{filename}"}


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
            result = cloudinary.uploader.upload(
                out,
                folder="crm/avatars",
                public_id=f"avatar_{user['id']}",
                overwrite=True,
                format="webp",
                quality="auto:good",
                resource_type="image"
            )
            url = result["secure_url"]
        except Exception as e:
            raise HTTPException(500, f"Cloudinary upload failed: {e}")
    else:
        filename = f"avatar_{user['id']}_{secrets.token_hex(8)}.webp"
        path = os.path.join(UPLOADS_DIR, filename)
        with open(path, "wb") as f:
            f.write(out.read())
        url = f"http://localhost:8001/uploads/{filename}"
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("UPDATE crm_users SET avatar_url=%s WHERE id=%s", (url, user["id"]))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"url": url}


# ════════════════════════════════════════════
# SETTINGS
# ════════════════════════════════════════════

@app.get("/api/settings")
def get_settings(user: dict = Depends(get_current_user)):
    u = db_one("SELECT id, name, email, role, avatar_url FROM crm_users WHERE id=%s", (user["id"],))
    s = db_one("SELECT language, currency, theme FROM crm_settings WHERE crm_user_id=%s", (user["id"],))
    return {
        "id":         u["id"],
        "name":       u["name"],
        "email":      u["email"],
        "role":       u["role"],
        "avatar_url": u.get("avatar_url"),
        "language":   (s or {}).get("language", "en"),
        "currency":   (s or {}).get("currency", "USD"),
        "theme":      (s or {}).get("theme", "light"),
    }


@app.put("/api/settings")
def update_settings(request: UpdateSettingsRequest, user: dict = Depends(get_current_user)):
    conn = get_db(); cur = conn.cursor()
    try:
        if request.name is not None:
            name = request.name.strip()
            if not name: raise HTTPException(400, "Name cannot be empty")
            if len(name) > 80: raise HTTPException(400, "Name too long (max 80)")
            cur.execute("UPDATE crm_users SET name=%s WHERE id=%s", (sanitize(name), user["id"]))
        upd = {}
        if request.language is not None: upd["language"] = request.language
        if request.currency is not None: upd["currency"] = request.currency
        if request.theme    is not None: upd["theme"]    = request.theme
        if upd:
            sets = ", ".join(f"{k}=%s" for k in upd)
            cur.execute(f"UPDATE crm_settings SET {sets} WHERE crm_user_id=%s",
                        list(upd.values()) + [user["id"]])
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


# ════════════════════════════════════════════
# ROLE PERMISSIONS
# ════════════════════════════════════════════

@app.get("/api/roles/{role_id}/permissions")
def get_role_permissions(role_id: int, user: dict = Depends(get_current_user)):
    kid  = active_key_id(user["id"])
    role = db_one("SELECT id, name, is_system FROM crm_roles WHERE id=%s AND api_key_id=%s", (role_id, kid))
    if not role: raise HTTPException(404, "Role not found")
    perms = db_all("SELECT permission FROM crm_role_permissions WHERE role_id=%s", (role_id,))
    return {
        "role":            role,
        "permissions":     [p["permission"] for p in perms],
        "all_permissions": [{"key": k, "label": l, "desc": d} for k, l, d in ROLE_PERMISSIONS],
    }


@app.put("/api/roles/{role_id}/permissions")
def set_role_permissions(role_id: int, request: SetPermissionsRequest, user: dict = Depends(get_current_user)):
    kid  = active_key_id(user["id"])
    require_owner(user, kid)
    role = db_one("SELECT id, is_system FROM crm_roles WHERE id=%s AND api_key_id=%s", (role_id, kid))
    if not role:          raise HTTPException(404, "Role not found")
    if role["is_system"]: raise HTTPException(400, "Cannot edit system role permissions")
    valid = {p[0] for p in ROLE_PERMISSIONS}
    perms = [p for p in request.permissions if p in valid]
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM crm_role_permissions WHERE role_id=%s", (role_id,))
        if perms:
            cur.executemany(
                "INSERT INTO crm_role_permissions (role_id, permission) VALUES (%s,%s)",
                [(role_id, p) for p in perms]
            )
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True, "permissions": perms}


# ════════════════════════════════════════════
# GOOGLE OAUTH
# ════════════════════════════════════════════

@app.get("/api/auth/google/login")
def google_login():
    """Redirect browser to Google sign-in page."""
    import urllib.parse
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "offline",
        "prompt":        "select_account",   # always show account picker
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    return RedirectResponse(url)


@app.get("/api/auth/google/callback")
def google_callback(code: str = None, error: str = None):
    """Google redirects here with ?code=... after sign-in."""
    if error or not code:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=google_cancelled")

    import urllib.request, urllib.parse, json as _json
    # Exchange code → tokens
    data = urllib.parse.urlencode({
        "code":          code,
        "client_id":     GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "grant_type":    "authorization_code",
    }).encode()
    try:
        req = urllib.request.Request(
            "https://oauth2.googleapis.com/token",
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            tokens = _json.loads(resp.read())
    except Exception as e:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=google_token")

    id_token_str = tokens.get("id_token")
    if not id_token_str:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=google_no_id_token")

    # Verify id_token and extract user info
    try:
        from google.oauth2 import id_token as g_id_token
        from google.auth.transport import requests as g_requests
        idinfo = g_id_token.verify_oauth2_token(
            id_token_str, g_requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=10
        )
        g_id    = idinfo["sub"]
        email   = idinfo["email"]
        name    = idinfo.get("name", email.split("@")[0])
        picture = idinfo.get("picture")
    except Exception as e:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=google_verify")

    # Upsert user
    user = db_one("SELECT id FROM crm_users WHERE google_id=%s OR (email=%s AND google_id IS NULL)", (g_id, email))
    if user:
        user_id = user["id"]
        conn = get_db(); cur = conn.cursor()
        try:
            cur.execute("UPDATE crm_users SET google_id=%s, last_login_at=NOW() WHERE id=%s", (g_id, user_id))
            conn.commit()
        finally:
            cur.close(); conn.close()
    else:
        conn = get_db(); cur = conn.cursor()
        try:
            cur.execute(
                "INSERT INTO crm_users (name,email,password,role,google_id,avatar_url) VALUES(%s,%s,'','owner',%s,%s)",
                (sanitize(name), email, g_id, picture)
            )
            conn.commit()
            user_id = cur.lastrowid
            cur.execute("INSERT INTO crm_settings (crm_user_id) VALUES(%s)", (user_id,))
            conn.commit()
        finally:
            cur.close(); conn.close()

    # Set JWT cookie and redirect to dashboard
    jwt_token = make_token(user_id)
    redirect = RedirectResponse(f"{FRONTEND_URL}/dashboard", status_code=302)
    redirect.set_cookie(
        key="crm_token", value=jwt_token,
        httponly=True, samesite="lax", max_age=60 * 60 * 24 * 7,
    )
    return redirect


@app.post("/api/auth/google")
def google_auth(request: GoogleAuthRequest, response: Response):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(501, "Google OAuth not configured (set GOOGLE_CLIENT_ID)")
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as g_requests
        idinfo = id_token.verify_oauth2_token(request.token, g_requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=10)
        g_id    = idinfo["sub"]
        email   = idinfo["email"]
        name    = idinfo.get("name", email.split("@")[0])
        picture = idinfo.get("picture")
    except Exception as e:
        raise HTTPException(400, f"Invalid Google token: {e}")

    user = db_one("SELECT id FROM crm_users WHERE google_id=%s OR (email=%s AND google_id IS NULL)", (g_id, email))
    if user:
        user_id = user["id"]
        conn = get_db(); cur = conn.cursor()
        try:
            cur.execute("UPDATE crm_users SET google_id=%s, last_login_at=NOW() WHERE id=%s", (g_id, user_id))
            conn.commit()
        finally:
            cur.close(); conn.close()
    else:
        conn = get_db(); cur = conn.cursor()
        try:
            cur.execute(
                "INSERT INTO crm_users (name,email,password,role,google_id,avatar_url) VALUES(%s,%s,'',\'owner\',%s,%s)",
                (sanitize(name), email, g_id, picture)
            )
            conn.commit()
            user_id = cur.lastrowid
            cur.execute("INSERT INTO crm_settings (crm_user_id) VALUES(%s)", (user_id,))
            conn.commit()
        finally:
            cur.close(); conn.close()

    set_cookie(response, make_token(user_id))
    return {"success": True}
