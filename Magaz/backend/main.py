from fastapi import FastAPI, Response, HTTPException, Request, Depends
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
from contextlib import contextmanager
import sys
import psycopg2
import psycopg2.errors
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor
import hashlib, secrets, jwt, random, re as _re, traceback, json, urllib.request, urllib.error
from hashids import Hashids
from starlette.middleware.base import BaseHTTPMiddleware


# ============================================
# НАСТРОЙКИ
# ============================================

SECRET_KEY            = "d2a9c8f0e5b741a39f6c8d2e1b5a9c3f8e7d6c5b4a3928173645e5f6a7b8c9d0"
JWT_ALGORITHM         = "HS256"
JWT_HOURS             = 24 * 7
MAGAZ_BACKEND_URL     = "http://localhost:8000"
SES_API_URL           = "https://ses.tortacrm.com"
SES_INTERNAL_KEY      = "821ba4c3ac76f3206f20d338c642bccfb2782e8c986627e81a1aff8d23a13a5d"
EMAIL_FROM            = "support@tortacrm.com"
MAX_FAILED_ATTEMPTS   = 5
BLOCK_MINUTES         = 10
CODE_TTL_MINUTES      = 10
RESEND_COOLDOWN_SECONDS = 60
RESET_TTL_MINUTES     = 30

DB_CONFIG = {
    "host":     "localhost",
    "port":     5432,
    "user":     "postgres",
    "password": "REDACTED",
    "dbname":   "crmdb",
}

hashids = Hashids(salt="qpzmrld10vsljklfgdnsdsafjkhfl526742228666777mzpqnxowhgf", min_length=6)

# Пул соединений: переиспользуем до 10 соединений вместо нового TCP-handshake на каждый запрос
_pool = ThreadedConnectionPool(1, 10, **DB_CONFIG)

def get_db():
    return _pool.getconn()

@contextmanager
def db_cursor():
    """Context manager: автоматически закрывает cursor и возвращает соединение в пул."""
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
            resp.headers["Access-Control-Allow-Headers"]     = "Content-Type, Authorization, X-Publishable-Key"
            resp.headers["Access-Control-Max-Age"]           = "600"
            return resp

        response = await call_next(request)
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
