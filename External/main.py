from fastapi import FastAPI, Response, HTTPException, Request, Depends
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
from contextlib import contextmanager
import sys, os
import psycopg2
import psycopg2.errors
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor
import hashlib, secrets, jwt, random, re as _re, traceback, json, urllib.request, urllib.error
from hashids import Hashids
from starlette.middleware.base import BaseHTTPMiddleware
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)


# ============================================
# НАСТРОЙКИ
# ============================================

SECRET_KEY            = os.getenv("SECRET_KEY",        "")
JWT_ALGORITHM         = "HS256"
JWT_HOURS             = 24 * 7
MAGAZ_BACKEND_URL     = os.getenv("MAGAZ_BACKEND_URL", "http://localhost:8000")
CRM_BACKEND_URL       = os.getenv("CRM_BACKEND_URL",   "http://localhost:8001")
INTERNAL_API_KEY      = os.getenv("INTERNAL_API_KEY",  "torta-internal-dev-key")
SES_API_URL           = os.getenv("SES_API_URL",       "https://ses.tortacrm.com")
SES_INTERNAL_KEY      = os.getenv("SES_INTERNAL_KEY",  "")
EMAIL_FROM            = os.getenv("EMAIL_FROM",        "support@tortacrm.com")
MAX_FAILED_ATTEMPTS   = 5
BLOCK_MINUTES         = 10
CODE_TTL_MINUTES      = 10
RESEND_COOLDOWN_SECONDS = 60
RESET_TTL_MINUTES     = 30

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
    return row["frontend_url"].rstrip("/") if row and row["frontend_url"] else None

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

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

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
    payload = {"sub": str(user_id), "exp": datetime.utcnow() + timedelta(hours=JWT_HOURS)}
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)

def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="authx_token", value=token,
        httponly=True, max_age=60*60*24*7,
        samesite="lax", secure=False, path="/",
    )

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

        if _LOCALHOST_RE.match(origin):
            allow_origin = origin
        else:
            project_id = _get_project_id_from_path(request.url.path)
            if project_id:
                allowed = get_allowed_redirect_urls(project_id)
                allow_origin = origin if origin in allowed else (allowed[0] if allowed else origin)
            else:
                allow_origin = origin

        if request.method == "OPTIONS":
            from starlette.responses import Response as StarResponse
            resp = StarResponse(status_code=204)
            resp.headers["Access-Control-Allow-Origin"]      = allow_origin
            resp.headers["Access-Control-Allow-Credentials"] = "true"
            resp.headers["Access-Control-Allow-Methods"]     = "GET, POST, PUT, DELETE, OPTIONS"
            resp.headers["Access-Control-Allow-Headers"]     = "Content-Type, Authorization, X-Publishable-Key, X-Web-Chat-Id"
            resp.headers["Access-Control-Max-Age"]           = "600"
            return resp

        try:
            response = await call_next(request)
        except Exception:
            from starlette.responses import Response as StarResponse
            response = StarResponse(status_code=500)
        response.headers["Access-Control-Allow-Origin"]      = allow_origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        return response

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
    variation_id: Optional[int] = None
    size_id: Optional[int] = None
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

class FrontSize(BaseModel):
    id: int; size_name: str; price: float; stock_quantity: int
    sold_quantity: int; is_in_cart: bool = False
    cart_item_id: Optional[int] = None; cart_quantity: int = 0

class FrontVariation(BaseModel):
    id: int; variation_name: str; image: Optional[str] = None
    is_in_cart: bool = False; sizes: List[FrontSize]

class ProductPageResponse(BaseModel):
    id: int; product_hash: str; title: str
    description: Optional[str] = ""; characteristics: Optional[str] = ""
    seo_title: Optional[str] = None; seo_description: Optional[str] = None
    seo_keywords: Optional[str] = None; custom_fields: Optional[dict] = {}
    is_authenticated: bool; current_user_id: Optional[int] = None
    is_favorite: bool; can_review: bool
    reviews_count: int; average_rating: float
    initial_variation_index: int; initial_size_id: Optional[int] = None
    variations: List[FrontVariation]; reviews: List[FrontReview]

class CartPageItem(BaseModel):
    cart_item_id: int; quantity: int; product_id: int; product_hash: str
    variation_id: Optional[int] = None; size_id: Optional[int] = None
    title: str; description: Optional[str] = ""; price: float
    size_name: Optional[str] = None; variation_name: Optional[str] = None
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
    reset_url = f"{frontend}/reset-password/{token}"
    html = f"""<div style="font-family:Arial,sans-serif;text-align:center;padding:40px">
        <h1 style="color:#333">Reset your password</h1>
        <p style="font-size:16px;color:#666">Click the button below to set a new password. Link expires in 30 minutes.</p>
        <a href="{reset_url}" style="display:inline-block;margin-top:24px;padding:14px 32px;
            background:#0071e3;color:#fff;text-decoration:none;border-radius:16px;font-size:18px;font-weight:600">
            Reset password</a>
        <p style="margin-top:24px;color:#999;font-size:12px;word-break:break-all">{reset_url}</p></div>"""
    return send_email(email, "Password Reset", html, from_name, from_email)


# ============================================
# IN-MEMORY ХРАНИЛИЩА (rate-limit, верификации)
# ============================================

pending_verifications = {}
login_attempts        = {}
password_reset_tokens = {}


# ============================================
# АУТЕНТИФИКАЦИЯ
# ============================================

@app.post("/{api_key}/api/send-code")
def send_code(request: SendCodeRequest, req: Request,
              api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    email = request.email.lower().strip()
    ip    = get_client_ip(req)
    now   = datetime.utcnow()

    for key in [f"ip:{ip}", f"email:{email}"]:
        s = login_attempts.get(key)
        if s and s.get("blocked_until") and now < s["blocked_until"]:
            left = int((s["blocked_until"] - now).total_seconds())
            raise HTTPException(429, f"Too many failed attempts. Try again in {left} seconds.")

    def fail(detail: str):
        for key in [f"ip:{ip}", f"email:{email}"]:
            s = login_attempts.get(key, {"count": 0, "blocked_until": None})
            s["count"] += 1
            if s["count"] >= MAX_FAILED_ATTEMPTS:
                s = {"count": 0, "blocked_until": now + timedelta(minutes=BLOCK_MINUTES)}
                login_attempts[key] = s
                raise HTTPException(429, f"Too many failed attempts. Try again in {int((s['blocked_until']-now).total_seconds())} seconds.")
            login_attempts[key] = s
        raise HTTPException(400, detail)

    if request.type == "register":
        if get_user_by_email(email, project_id): fail("Email already exists")
        if not request.name or not request.password: fail("Name and password required")
        validate_password(request.password)
    elif request.type == "login":
        db_user = get_user_by_email(email, project_id)
        if not db_user: fail("Invalid email or password")
        if hash_password(request.password or "") != db_user["password_hash"]: fail("Invalid email or password")
    else:
        raise HTTPException(400, "Invalid type")

    code   = random.randint(100000, 999999)
    pv_key = f"{project_id}:{email}"
    pending_verifications[pv_key] = {
        "code": str(code), "type": request.type, "name": request.name,
        "password": request.password, "project_id": project_id,
        "expires": now + timedelta(minutes=CODE_TTL_MINUTES),
        "next_resend_at": now + timedelta(seconds=RESEND_COOLDOWN_SECONDS),
    }
    if not send_code_email(email, code, project_id):
        del pending_verifications[pv_key]
        raise HTTPException(500, "Failed to send email")

    for key in [f"ip:{ip}", f"email:{email}"]: login_attempts.pop(key, None)
    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.post("/{api_key}/api/verify-code")
def verify_code(request: VerifyCodeRequest, response: Response, req: Request,
                api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    email  = request.email.lower().strip()
    code   = (request.code or "").replace(" ", "").strip()
    ip     = get_client_ip(req)
    now    = datetime.utcnow()
    pv_key = f"{project_id}:{email}"

    for key in [f"ip:{ip}", f"email:{email}"]:
        s = login_attempts.get(key)
        if s and s.get("blocked_until") and now < s["blocked_until"]:
            left = int((s["blocked_until"] - now).total_seconds())
            raise HTTPException(429, f"Too many failed attempts. Try again in {left} seconds.")

    def fail(detail: str):
        for key in [f"ip:{ip}", f"email:{email}"]:
            s = login_attempts.get(key, {"count": 0, "blocked_until": None})
            s["count"] += 1
            if s["count"] >= MAX_FAILED_ATTEMPTS:
                s = {"count": 0, "blocked_until": now + timedelta(minutes=BLOCK_MINUTES)}
                login_attempts[key] = s
                raise HTTPException(429, f"Too many failed attempts. Try again in {int((s['blocked_until']-now).total_seconds())} seconds.")
            login_attempts[key] = s
        raise HTTPException(400, detail)

    if pv_key not in pending_verifications: fail("Code not found or expired")
    pending = pending_verifications[pv_key]
    if now > pending["expires"]:
        del pending_verifications[pv_key]
        raise HTTPException(400, "Code expired")
    if code != pending["code"]: fail("Invalid code")

    with db_cursor() as (conn, cursor):
        if pending["type"] == "register":
            cursor.execute(
                "INSERT INTO users (name, email, password_hash, project_id) VALUES (%s,%s,%s,%s) RETURNING id",
                (sanitize(pending["name"]), email, hash_password(pending["password"]), project_id)
            )
            user_id = cursor.fetchone()["id"]
            conn.commit()
        else:
            user_id = get_user_by_email(email, project_id)["id"]

    token = create_token(user_id)
    set_auth_cookie(response, token)
    del pending_verifications[pv_key]
    for key in [f"ip:{ip}", f"email:{email}"]: login_attempts.pop(key, None)
    return {"success": True}


@app.post("/{api_key}/api/resend-code")
def resend_code(request: ResendCodeRequest, api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    email  = request.email.lower().strip()
    now    = datetime.utcnow()
    pv_key = f"{project_id}:{email}"

    if pv_key not in pending_verifications:
        raise HTTPException(400, "No pending verification")
    pending = pending_verifications[pv_key]
    if now > pending["expires"]:
        del pending_verifications[pv_key]; raise HTTPException(400, "Code expired. Start again.")
    if now < pending["next_resend_at"]:
        left = int((pending["next_resend_at"] - now).total_seconds())
        raise HTTPException(429, f"Resend available in {left} seconds")

    code = random.randint(100000, 999999)
    pending_verifications[pv_key].update({
        "code": str(code),
        "expires": now + timedelta(minutes=CODE_TTL_MINUTES),
        "next_resend_at": now + timedelta(seconds=RESEND_COOLDOWN_SECONDS),
    })
    if not send_code_email(email, code, pending["project_id"]):
        raise HTTPException(500, "Failed to send email")
    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.get("/{api_key}/api/me")
def get_me(request: Request, api_key_record: dict = Depends(resolve_api_key)):
    user = get_user_by_id(get_current_user_id(request), api_key_record["id"])
    if not user: raise HTTPException(401, "User not found")
    return {"id": user["id"], "name": user["name"], "email": user["email"]}


@app.post("/{api_key}/api/logout")
def logout(response: Response, api_key_record: dict = Depends(resolve_api_key)):
    response.delete_cookie("authx_token", path="/")
    return {"success": True}


# ============================================
# ВОССТАНОВЛЕНИЕ ПАРОЛЯ
# ============================================

@app.post("/{api_key}/api/forgot-password")
def forgot_password(request: ForgotPasswordRequest, api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    email = request.email.lower().strip()
    if not get_user_by_email(email, project_id):
        return {"success": True, "message": "If the account exists, a reset email has been sent."}

    for t in [t for t, d in password_reset_tokens.items()
              if d["email"] == email and d["project_id"] == project_id]:
        del password_reset_tokens[t]

    raw_token  = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    password_reset_tokens[token_hash] = {
        "email": email, "project_id": project_id,
        "expires": datetime.utcnow() + timedelta(minutes=RESET_TTL_MINUTES),
    }
    if not send_reset_email(email, raw_token, project_id):
        del password_reset_tokens[token_hash]
        raise HTTPException(500, "Failed to send email")
    return {"success": True, "message": "If the account exists, a reset email has been sent."}


@app.get("/{api_key}/api/reset-password/validate/{token}")
def validate_reset_token(token: str, api_key_record: dict = Depends(resolve_api_key)):
    data = password_reset_tokens.get(hashlib.sha256(token.encode()).hexdigest())
    if not data or datetime.utcnow() > data["expires"] or data["project_id"] != api_key_record["id"]:
        raise HTTPException(400, "Invalid or expired reset link")
    return {"valid": True, "email": data["email"]}


@app.post("/{api_key}/api/reset-password")
def reset_password(request: ResetPasswordRequest, api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    if request.password != (request.repeat_password or ""):
        raise HTTPException(400, "Passwords do not match")
    validate_password(request.password)

    token_hash = hashlib.sha256((request.token or "").strip().encode()).hexdigest()
    token_data = password_reset_tokens.get(token_hash)
    if not token_data or datetime.utcnow() > token_data["expires"] or token_data["project_id"] != project_id:
        raise HTTPException(400, "Invalid or expired reset link")

    with db_cursor() as (conn, cursor):
        cursor.execute(
            "UPDATE users SET password_hash = %s WHERE email = %s AND project_id = %s",
            (hash_password(request.password), token_data["email"], project_id)
        )
        conn.commit()
    del password_reset_tokens[token_hash]
    return {"success": True}


# ============================================
# ПРОДУКТЫ
# ============================================

@app.get("/{api_key}/api-products")
def get_products(api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    with db_cursor() as (_, cursor):
        cursor.execute(
            "SELECT id, title, seo_title, seo_description, seo_keywords FROM products WHERE project_id = %s",
            (project_id,)
        )
        products = cursor.fetchall()
        if not products: return []

        product_ids = [p["id"] for p in products]
        fmt         = ",".join(["%s"] * len(product_ids))

        cursor.execute(
            f"SELECT product_id, MIN(id) as variation_id FROM product_variations WHERE product_id IN ({fmt}) GROUP BY product_id",
            product_ids
        )
        first_variation = {r["product_id"]: r["variation_id"] for r in cursor.fetchall()}

        images = {}
        if first_variation:
            vids = list(first_variation.values())
            vfmt = ",".join(["%s"] * len(vids))
            cursor.execute(f"SELECT id, image_url FROM product_variations WHERE id IN ({vfmt})", vids)
            images = {r["id"]: r["image_url"] for r in cursor.fetchall()}

        cursor.execute(
            f"SELECT product_id, MIN(price) as price FROM product_sizes WHERE product_id IN ({fmt}) GROUP BY product_id",
            product_ids
        )
        prices = {r["product_id"]: float(r["price"]) for r in cursor.fetchall()}

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
            "seo_title": p["seo_title"], "seo_description": p["seo_description"],
            "seo_keywords": p["seo_keywords"], "custom_fields": cf_map.get(p["id"], {}),
        }
        for p in products
    ]


@app.get("/{api_key}/api/product/{product_hash}", response_model=ProductPageResponse)
def get_product_page(product_hash: str, request: Request,
                     api_key_record: dict = Depends(resolve_api_key)):
    decoded = hashids.decode(product_hash)
    if not decoded: raise HTTPException(404, "Product not found")
    product_id = decoded[0]
    project_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)

    with db_cursor() as (_, cursor):
        cursor.execute(
            "SELECT id, title, description, characteristics, seo_title, seo_description, seo_keywords "
            "FROM products WHERE id = %s AND project_id = %s",
            (product_id, project_id)
        )
        product = cursor.fetchone()
        if not product: raise HTTPException(404, "Product not found")

        cursor.execute(
            "SELECT id, product_id, variation_name, image_url FROM product_variations WHERE product_id = %s",
            (product_id,)
        )
        variations = cursor.fetchall()

        sizes = []
        if variations:
            vids = [v["id"] for v in variations]
            vfmt = ",".join(["%s"] * len(vids))
            cursor.execute(
                f"SELECT id, product_id, variation_id, size_name, price, stock_quantity, sold_quantity "
                f"FROM product_sizes WHERE variation_id IN ({vfmt})",
                vids
            )
            sizes = cursor.fetchall()

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
                "SELECT ci.id AS cart_item_id, ci.variation_id, ci.size_id, ci.quantity "
                "FROM cart_items ci JOIN carts c ON ci.cart_id = c.id "
                "WHERE c.user_id = %s AND ci.product_id = %s AND c.project_id = %s",
                (user_id, product_id, project_id)
            )
            for row in cursor.fetchall():
                cart_map[(row["variation_id"], row["size_id"])] = row

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

    sizes_by_variation = {}
    for s in sizes:
        if s["stock_quantity"] <= 0: continue
        cart_item = cart_map.get((s["variation_id"], s["id"]))
        sizes_by_variation.setdefault(s["variation_id"], []).append({
            "id": s["id"], "size_name": s["size_name"], "price": float(s["price"]),
            "stock_quantity": s["stock_quantity"], "sold_quantity": s["sold_quantity"],
            "is_in_cart": cart_item is not None,
            "cart_item_id": cart_item["cart_item_id"] if cart_item else None,
            "cart_quantity": cart_item["quantity"] if cart_item else 0,
        })

    final_variations = [
        {
            "id": v["id"], "variation_name": v["variation_name"], "image": v["image_url"],
            "is_in_cart": any(s["is_in_cart"] for s in sizes_by_variation.get(v["id"], [])),
            "sizes": sizes_by_variation.get(v["id"], []),
        }
        for v in variations if sizes_by_variation.get(v["id"])
    ]

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
    initial_size_id = final_variations[0]["sizes"][0]["id"] if final_variations and final_variations[0]["sizes"] else None

    return {
        "id": product["id"], "product_hash": hashids.encode(product["id"]),
        "title": product["title"], "description": product["description"] or "",
        "characteristics": product["characteristics"] or "",
        "seo_title": product["seo_title"], "seo_description": product["seo_description"],
        "seo_keywords": product["seo_keywords"], "custom_fields": custom_fields,
        "is_authenticated": user_id is not None, "current_user_id": user_id,
        "is_favorite": is_favorite, "can_review": can_review,
        "reviews_count": reviews_count, "average_rating": average_rating,
        "initial_variation_index": 0, "initial_size_id": initial_size_id,
        "variations": final_variations, "reviews": reviews,
    }


# ============================================
# КОРЗИНА
# ============================================

@app.post("/{api_key}/api/cart/add")
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
            "SELECT id, quantity FROM cart_items WHERE cart_id=%s AND product_id=%s AND variation_id=%s AND size_id=%s",
            (cart_id, item.product_id, item.variation_id, item.size_id)
        )
        existing = cursor.fetchone()
        if existing:
            cursor.execute("UPDATE cart_items SET quantity=%s WHERE id=%s",
                           (existing["quantity"] + item.quantity, existing["id"]))
        else:
            cursor.execute(
                "INSERT INTO cart_items (cart_id, product_id, variation_id, size_id, quantity) VALUES (%s,%s,%s,%s,%s)",
                (cart_id, item.product_id, item.variation_id, item.size_id, item.quantity)
            )
        conn.commit()
    return {"success": True}


@app.delete("/{api_key}/api/cart/clear")
def clear_cart(request: Request, api_key_record: dict = Depends(resolve_api_key)):
    user_id = get_current_user_id(request)
    with db_cursor() as (conn, cursor):
        cursor.execute("SELECT id FROM carts WHERE user_id=%s AND project_id=%s", (user_id, api_key_record["id"]))
        cart = cursor.fetchone()
        if cart:
            cursor.execute("DELETE FROM cart_items WHERE cart_id=%s", (cart["id"],))
            conn.commit()
    return {"success": True}


@app.delete("/{api_key}/api/cart/{cart_item_id}")
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


@app.put("/{api_key}/api/cart/{cart_item_id}")
def update_cart_quantity(cart_item_id: int, data: UpdateCartQuantity, request: Request,
                         api_key_record: dict = Depends(resolve_api_key)):
    if data.quantity < 1: raise HTTPException(400, "Quantity must be at least 1")
    user_id = get_current_user_id(request)
    with db_cursor() as (conn, cursor):
        cursor.execute(
            "SELECT ci.id, ci.size_id FROM cart_items ci JOIN carts c ON ci.cart_id=c.id "
            "WHERE ci.id=%s AND c.user_id=%s AND c.project_id=%s",
            (cart_item_id, user_id, api_key_record["id"])
        )
        item = cursor.fetchone()
        if not item: raise HTTPException(404, "Cart item not found")
        cursor.execute("SELECT stock_quantity FROM product_sizes WHERE id=%s", (item["size_id"],))
        size = cursor.fetchone()
        if size and data.quantity > size["stock_quantity"]:
            raise HTTPException(400, f"Only {size['stock_quantity']} items in stock")
        cursor.execute("UPDATE cart_items SET quantity=%s WHERE id=%s", (data.quantity, cart_item_id))
        conn.commit()
    return {"success": True}


@app.get("/{api_key}/api/cart", response_model=CartPageResponse)
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
            "SELECT ci.id as cart_item_id, ci.quantity, ci.product_id, ci.variation_id, ci.size_id, "
            "p.title, p.description, ps.price, ps.size_name, pv.variation_name, pv.image_url "
            "FROM cart_items ci JOIN products p ON ci.product_id=p.id "
            "LEFT JOIN product_variations pv ON ci.variation_id=pv.id "
            "LEFT JOIN product_sizes ps ON ci.size_id=ps.id "
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

@app.post("/{api_key}/api/favorites/add")
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


@app.get("/{api_key}/api/favorites")
def get_favorites(request: Request, api_key_record: dict = Depends(resolve_api_key)):
    user_id = get_current_user_id(request)
    rows = db_all(
        "SELECT f.product_id, p.title FROM favorites f JOIN products p ON f.product_id=p.id "
        "WHERE f.user_id=%s AND f.project_id=%s",
        (user_id, api_key_record["id"])
    )
    return [{**r, "hash": hashids.encode(r["product_id"])} for r in rows]


@app.delete("/{api_key}/api/favorites/{product_hash}")
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

@app.post("/{api_key}/api/reviews/add")
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


@app.get("/{api_key}/api/reviews/can-review/{product_id}")
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


@app.delete("/{api_key}/api/reviews/{review_id}")
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

@app.post("/{api_key}/api/promo-code/apply")
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
            "SELECT SUM(ps.price * ci.quantity) as subtotal FROM cart_items ci "
            "JOIN product_sizes ps ON ci.size_id=ps.id WHERE ci.cart_id=%s",
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

@app.post("/{api_key}/api/orders")
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
            "SELECT ci.id, ci.product_id, ci.variation_id, ci.size_id, ci.quantity, "
            "ps.price, ps.stock_quantity, p.title, pv.variation_name "
            "FROM cart_items ci "
            "JOIN product_sizes ps ON ci.size_id = ps.id "
            "JOIN products p ON ci.product_id = p.id "
            "JOIN product_variations pv ON ci.variation_id = pv.id "
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

        # Промокод
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
                "INSERT INTO order_items (order_id, product_id, variation_id, size_id, quantity, price) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (order_id, it["product_id"], it["variation_id"], it["size_id"], it["quantity"], it["price"])
            )
            # Уменьшаем остаток
            cursor.execute(
                "UPDATE product_sizes SET stock_quantity = stock_quantity - %s WHERE id=%s",
                (it["quantity"], it["size_id"])
            )

        # Очищаем корзину
        cursor.execute("DELETE FROM cart_items WHERE cart_id=%s", (cart["id"],))
        conn.commit()

    # Email to customer
    user = db_one("SELECT name, email FROM users WHERE id=%s", (user_id,))
    from_name, from_email = get_project_email(project_id)
    if user and user.get("email"):
        items_html = "".join(
            "<tr>"
            "<td style='padding:6px 0;color:#333'>" + it["title"] + " &mdash; " + it["variation_name"] + "</td>"
            "<td style='padding:6px 0;text-align:right;color:#333'>" + str(it["quantity"]) + " &times; " + str(int(float(it["price"]))) + "</td>"
            "</tr>"
            for it in items
        )
        shipping_row = (
            "<tr><td style='padding:6px 0;color:#888'>Shipping</td>"
            "<td style='padding:6px 0;text-align:right;color:#888'>" + str(int(final_shipping)) + "</td></tr>"
        ) if final_shipping else ""
        customer_name = user["name"] or "Customer"
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


@app.get("/{api_key}/api/orders")
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
                      p.title, pv.variation_name, pv.image_url, ps.size_name
               FROM order_items oi
               JOIN products p ON oi.product_id=p.id
               JOIN product_variations pv ON oi.variation_id=pv.id
               JOIN product_sizes ps ON oi.size_id=ps.id
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
                    "title":          it["title"],
                    "variation_name": it["variation_name"],
                    "size_name":      it["size_name"],
                    "image_url":      it["image_url"],
                    "quantity":       it["quantity"],
                    "price":          float(it["price"]),
                }
                for it in items
            ],
        })
    return result


# ============================================
# ТРЕКИНГ (воронка продаж)
# ============================================

@app.post("/{api_key}/api/track/visit")
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


@app.post("/{api_key}/api/track/product-view")
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

@app.get("/{api_key}/api/auth/google/login")
def magaz_google_login(api_key: str, api_key_record: dict = Depends(resolve_api_key_public)):
    import urllib.parse
    client_id, _ = get_google_credentials(api_key_record["id"])
    if not client_id: raise HTTPException(404, "Google OAuth not configured for this store")
    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key}/api/auth/google/callback"
    params = {
        "client_id": client_id, "redirect_uri": redirect_uri,
        "response_type": "code", "scope": "openid email profile",
        "access_type": "offline", "prompt": "select_account",
    }
    return RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params))


@app.get("/{api_key}/api/auth/google/callback")
def magaz_google_callback(api_key: str, api_key_record: dict = Depends(resolve_api_key_public),
                           code: str = None, error: str = None):
    project_id = api_key_record["id"]
    frontend   = get_project_frontend_url(project_id)
    if not frontend:
        return RedirectResponse("/?error=site_url_not_configured")
    try:
        return _magaz_google_callback_inner(api_key, project_id, code, error, frontend)
    except Exception:
        traceback.print_exc()
        return RedirectResponse(f"{frontend}/login?error=server_error")


def _magaz_google_callback_inner(api_key, project_id, code, error, frontend):
    import urllib.parse, json as _json

    if error or not code:
        return RedirectResponse(f"{frontend}/login?error=google_cancelled")

    client_id, client_secret = get_google_credentials(project_id)
    if not client_id:
        return RedirectResponse(f"{frontend}/login?error=google_not_configured")

    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key}/api/auth/google/callback"
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

    token    = create_token(user_id)
    redirect = RedirectResponse(f"{frontend}", status_code=302)
    redirect.set_cookie(key="authx_token", value=token, httponly=True,
                        max_age=60*60*24*7, samesite="lax", secure=False, path="/")
    return redirect


# ============================================
# GENERIC OAUTH PROVIDERS (per-project credentials)
# ============================================

def _basic_extract(id_field, email_field=None, name_field=None):
    """Most providers return a flat JSON. Some need different keys."""
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
        # Notion returns { bot: { owner: { user: { id, name, person: { email } } } } }
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


@app.get("/{api_key}/api/auth/oauth/{provider}/login")
def oauth_login(api_key: str, provider: str,
                api_key_record: dict = Depends(resolve_api_key_public)):
    import urllib.parse
    cfg = OAUTH_PROVIDERS.get(provider)
    if not cfg:
        raise HTTPException(404, f"Unknown provider: {provider}")
    client_id, _ = _get_oauth_credentials(api_key_record["id"], provider)
    if not client_id:
        raise HTTPException(404, f"{provider} OAuth not configured for this store")
    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key}/api/auth/oauth/{provider}/callback"
    params = {
        "client_id":     client_id,
        "redirect_uri":  redirect_uri,
        "response_type": "code",
        "scope":         cfg.get("scope", ""),
    }
    if cfg.get("extra_query"):
        params.update(cfg["extra_query"])
    if cfg.get("pkce"):
        import base64, hashlib as _h
        verifier = secrets.token_urlsafe(48)
        challenge = base64.urlsafe_b64encode(_h.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        params["code_challenge"] = challenge
        params["code_challenge_method"] = "S256"
        # NOTE: stash the verifier in a short-lived cookie so callback can read it
        resp = RedirectResponse(cfg["authorize_url"] + "?" + urllib.parse.urlencode(params))
        resp.set_cookie(key=f"oa_pkce_{provider}", value=verifier,
                        max_age=600, httponly=True, samesite="lax", path="/")
        return resp
    return RedirectResponse(cfg["authorize_url"] + "?" + urllib.parse.urlencode(params))


@app.get("/{api_key}/api/auth/oauth/{provider}/callback")
def oauth_callback(api_key: str, provider: str, request: Request,
                   api_key_record: dict = Depends(resolve_api_key_public),
                   code: str = None, error: str = None):
    project_id = api_key_record["id"]
    frontend   = get_project_frontend_url(project_id)
    if not frontend:
        return RedirectResponse("/?error=site_url_not_configured")

    cfg = OAUTH_PROVIDERS.get(provider)
    if not cfg:
        return RedirectResponse(f"{frontend}/login?error=unknown_provider")

    if error or not code:
        return RedirectResponse(f"{frontend}/login?error={provider}_cancelled")

    client_id, client_secret = _get_oauth_credentials(project_id, provider)
    if not client_id:
        return RedirectResponse(f"{frontend}/login?error={provider}_not_configured")

    redirect_uri = f"{MAGAZ_BACKEND_URL}/{api_key}/api/auth/oauth/{provider}/callback"

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

    token    = create_token(user_id)
    redirect = RedirectResponse(f"{frontend}", status_code=302)
    redirect.set_cookie(key="authx_token", value=token, httponly=True,
                        max_age=60*60*24*7, samesite="lax", secure=False, path="/")
    # Clean up any PKCE cookie
    if cfg.get("pkce"):
        redirect.delete_cookie(key=f"oa_pkce_{provider}", path="/")
    return redirect


# ============================================
# PHONE / SMS AUTHENTICATION
# Customer brings their own SMS provider — Twilio, MessageBird, Textlocal,
# Vonage, or Twilio Verify. We just route the OTP through them.
# ============================================

# In-memory OTP store: { (project_id, phone): { code, expires_at, sent_at } }
# Restart-safe? No, but OTPs are short-lived (60-600s) so this is fine.
_phone_otps = {}


def _sms_settings(project_id: int):
    return db_one("SELECT * FROM crm_sms_settings WHERE project_id=%s AND is_enabled=TRUE", (project_id,))


def _normalize_phone(p: str) -> str:
    """Strip spaces, hyphens, parentheses. Phone must be in E.164 (+...)."""
    if not p: return ""
    cleaned = "".join(ch for ch in p if ch.isdigit() or ch == "+")
    if not cleaned.startswith("+"):
        cleaned = "+" + cleaned
    return cleaned


def _gen_otp(length: int) -> str:
    return "".join(str(random.randint(0, 9)) for _ in range(length))


def _parse_test_numbers(s: str) -> dict:
    """'+1=789012, +77071234567=000000' → {'+1': '789012', '+77071234567': '000000'}"""
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


@app.post("/{api_key}/api/auth/phone/send-code")
def phone_send_code(req: PhoneSendCodeRequest, api_key: str,
                    api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    settings   = _sms_settings(project_id)
    if not settings:
        raise HTTPException(404, "Phone authentication not enabled for this store")

    phone = _normalize_phone(req.phone)
    if not phone or len(phone) < 7:
        raise HTTPException(400, "Invalid phone number")

    otp_length = settings.get("otp_length", 6)
    expiry     = settings.get("otp_expiry_seconds", 60)
    template   = settings.get("message_template") or "Your code is {{ .Code }}"
    test_map   = _parse_test_numbers(settings.get("test_phone_numbers", ""))

    # Twilio Verify generates the code itself; for everyone else we generate it
    if settings.get("provider") == "twilio_verify":
        # We still call _send_sms (it kicks off the verification flow)
        ok, err = _send_sms(settings, phone, "")
        if not ok:
            raise HTTPException(502, err or "SMS provider failed")
        # Mark this phone as "pending verify" with a sentinel — the actual code
        # check is delegated to Twilio in /verify-code below.
        _phone_otps[(project_id, phone)] = {
            "code":       "__twilio_verify__",
            "expires_at": datetime.utcnow() + timedelta(seconds=expiry),
            "name":       req.name,
        }
        return {"ok": True, "delivery": "twilio_verify"}

    # Test numbers — bypass the SMS provider entirely
    if phone in test_map:
        code = test_map[phone]
    else:
        code = _gen_otp(otp_length)
        msg  = template.replace("{{ .Code }}", code).replace("{{.Code}}", code)
        ok, err = _send_sms(settings, phone, msg)
        if not ok:
            raise HTTPException(502, err or "SMS provider failed")

    _phone_otps[(project_id, phone)] = {
        "code":       code,
        "expires_at": datetime.utcnow() + timedelta(seconds=expiry),
        "name":       req.name,
    }
    return {"ok": True, "delivery": "sms"}


@app.post("/{api_key}/api/auth/phone/verify-code")
def phone_verify_code(req: PhoneVerifyCodeRequest, api_key: str,
                      response: Response,
                      api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    settings   = _sms_settings(project_id)
    if not settings:
        raise HTTPException(404, "Phone authentication not enabled for this store")

    phone   = _normalize_phone(req.phone)
    pending = _phone_otps.get((project_id, phone))
    if not pending:
        raise HTTPException(400, "No code requested for this number")
    if datetime.utcnow() > pending["expires_at"]:
        _phone_otps.pop((project_id, phone), None)
        raise HTTPException(400, "Code expired")

    # Twilio Verify — delegate validation to Twilio
    if pending["code"] == "__twilio_verify__":
        import urllib.parse, base64
        sid    = settings.get("twilio_account_sid")
        token  = settings.get("twilio_auth_token")
        verify = settings.get("twilio_verify_service_sid")
        url   = f"https://verify.twilio.com/v2/Services/{verify}/VerificationCheck"
        body  = urllib.parse.urlencode({"To": phone, "Code": req.code}).encode()
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
        if (req.code or "").strip() != pending["code"]:
            raise HTTPException(400, "Invalid code")

    # ── Find or create user ──────────────────────────────────────────
    name = pending.get("name") or f"User {phone[-4:]}"
    with db_cursor() as (conn, cur):
        cur.execute(
            "SELECT id FROM users WHERE phone=%s AND project_id=%s",
            (phone, project_id),
        )
        user = cur.fetchone()
        if not user:
            cur.execute(
                "INSERT INTO users (name, email, password_hash, project_id, phone, phone_verified) "
                "VALUES (%s, %s, '', %s, %s, TRUE) RETURNING id",
                (sanitize(name), f"phone_{phone}@phone.local", project_id, phone),
            )
            user_id = cur.fetchone()["id"]
        else:
            cur.execute("UPDATE users SET phone_verified=TRUE WHERE id=%s", (user["id"],))
            user_id = user["id"]
        conn.commit()

    _phone_otps.pop((project_id, phone), None)

    token = create_token(user_id)
    set_auth_cookie(response, token)
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


@app.get("/{api_key}/api/chat/bootstrap")
def webchat_bootstrap(request: Request,
                      api_key_record: dict = Depends(resolve_api_key)):
    project_id = api_key_record["id"]
    incoming   = request.headers.get("x-web-chat-id", "").strip()
    return {
        "enabled":     _is_webchat_enabled(project_id),
        "project_id":  project_id,
        "web_chat_id": incoming or _new_web_chat_id(),
    }


@app.post("/{api_key}/api/chat/messages")
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


@app.get("/{api_key}/api/chat/messages")
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
