from fastapi import FastAPI, Response, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
import mysql.connector
import hashlib
import secrets
import jwt
import random
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pydantic import BaseModel
from typing import Optional, List
from hashids import Hashids


# ============================================
# НАСТРОЙКИ
# ============================================

SECRET_KEY = "d2a9c8f0e5b741a39f6c8d2e1b5a9c3f8e7d6c5b4a3928173645e5f6a7b8c9d0"
JWT_ALGORITHM = "HS256"
JWT_HOURS = 24 * 7

SMTP_HOST = "email-smtp.eu-north-1.amazonaws.com"
SMTP_PORT = 587
SMTP_USER = "AKIASY5ETQGYQK5YLIM3"
SMTP_PASS = "BL6yBolOEm/aYUODmJ5M+G0AQi14nTd3M4rpnPZN7yI6"
EMAIL_FROM = "support@tortafinance.com"
FRONTEND_URL = "http://localhost:5173"
MAX_FAILED_ATTEMPTS = 5
BLOCK_MINUTES = 10
CODE_TTL_MINUTES = 10
RESEND_COOLDOWN_SECONDS = 60
RESET_TTL_MINUTES = 30

DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "root",
    "database": "crmdb",
}

hashids = Hashids(salt="qpzmrld10vsljklfgdnsdsafjkhfl526742228666777mzpqnxowhgf", min_length=6)

app = FastAPI()
def get_project_email(api_key_id: int) -> tuple[str, str]:
    """Return (from_name, from_email) for this project.
    Uses verified custom domain if configured, otherwise falls back to platform default."""
    conn = get_db(); cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT from_name, from_email FROM crm_email_domains "
            "WHERE api_key_id = %s AND is_verified = 1",
            (api_key_id,)
        )
        row = cursor.fetchone()
    finally:
        cursor.close(); conn.close()
    if row:
        return row["from_name"], row["from_email"]
    return "Torta Store", EMAIL_FROM

def send_email(to: str, subject: str, html: str, from_name: str = "Torta Store", from_email: str = EMAIL_FROM) -> bool:
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"{from_name} <{from_email}>"
        msg["To"]      = to
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
            s.sendmail(from_email, to, msg.as_string())
        return True
    except Exception as e:
        print(f"Email error: {e}"); return False

pending_verifications = {}   # email -> { code, type, name, password, expires, next_resend_at }
login_attempts        = {}   # "ip:..." / "email:..." -> { count, blocked_until }
password_reset_tokens = {}   # sha256(token) -> { email, expires }

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# МОДЕЛИ
# ============================================

class SendCodeRequest(BaseModel):
    email: str
    type: str
    name: str = None
    password: str = None

class VerifyCodeRequest(BaseModel):
    email: str
    code: str

class ResendCodeRequest(BaseModel):
    email: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    password: str
    repeat_password: str

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
    product_id: int
    rating: int
    comment: str = ""

class ApplyPromoCode(BaseModel):
    code: str

class FrontReview(BaseModel):
    id: int
    user_id: int
    user_name: str
    rating: int
    comment: str = ""
    created_at: Optional[str] = None

class FrontSize(BaseModel):
    id: int
    size_name: str
    price: float
    stock_quantity: int
    sold_quantity: int
    is_in_cart: bool = False
    cart_item_id: Optional[int] = None
    cart_quantity: int = 0

class FrontVariation(BaseModel):
    id: int
    variation_name: str
    image: Optional[str] = None
    is_in_cart: bool = False
    sizes: List[FrontSize]

class ProductPageResponse(BaseModel):
    id: int
    product_hash: str
    title: str
    description: Optional[str] = ""
    characteristics: Optional[str] = ""
    seo_title: Optional[str] = None
    seo_description: Optional[str] = None
    seo_keywords: Optional[str] = None
    custom_fields: Optional[dict] = {}
    is_authenticated: bool
    current_user_id: Optional[int] = None
    is_favorite: bool
    can_review: bool
    reviews_count: int
    average_rating: float
    initial_variation_index: int
    initial_size_id: Optional[int] = None
    variations: List[FrontVariation]
    reviews: List[FrontReview]


class CartPageItem(BaseModel):
    cart_item_id: int
    quantity: int
    product_id: int
    product_hash: str
    variation_id: Optional[int] = None
    size_id: Optional[int] = None
    title: str
    description: Optional[str] = ""
    price: float
    size_name: Optional[str] = None
    variation_name: Optional[str] = None
    image_url: Optional[str] = None
    is_favorite: bool = False

class CartPageResponse(BaseModel):
    items: List[CartPageItem]
    favorites_ids: List[int]
    subtotal: float
    shipping_cost: float
    free_shipping_threshold: float
    amount_to_free_shipping: float
    shipping_progress: float
    total: float
    
class TrackProductView(BaseModel):
    product_id: int


# ============================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ============================================

def get_db():
    return mysql.connector.connect(**DB_CONFIG)

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def sanitize(v: str) -> str:
    if not isinstance(v, str): return v
    return v.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&#x27;")

def validate_password(pwd: str):
    if not pwd or " " in pwd:
        raise HTTPException(status_code=400, detail="Password must not contain spaces")
    if len(pwd) < 8 or len(pwd) > 24:
        raise HTTPException(status_code=400, detail="Password must be 8–24 characters")
    if not any(c.isalpha() for c in pwd):
        raise HTTPException(status_code=400, detail="Password must contain at least 1 letter")
    if not any(c.isdigit() for c in pwd):
        raise HTTPException(status_code=400, detail="Password must contain at least 1 digit")

def create_token(user_id: int) -> str:
    payload = {"sub": str(user_id), "exp": datetime.utcnow() + timedelta(hours=JWT_HOURS)}
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)

def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="authx_token", value=token,
        httponly=True, max_age=60 * 60 * 24 * 7,
        samesite="lax", secure=False, path="/",
    )

def get_current_user_id(request: Request) -> int:
    token = request.cookies.get("authx_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def get_user_by_email(email: str, api_key_id: int):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM users WHERE email = %s AND api_key_id = %s", (email, api_key_id))
    user = cursor.fetchone()
    cursor.close(); conn.close()
    return user

def get_user_by_id(user_id: int, api_key_id: int):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT id, name, email FROM users WHERE id = %s AND api_key_id = %s", (user_id, api_key_id))
    user = cursor.fetchone()
    cursor.close(); conn.close()
    return user

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def send_code_email(email: str, code: int, api_key_id: int = None) -> bool:
    from_name, from_email = get_project_email(api_key_id) if api_key_id else ("Torta Store", EMAIL_FROM)
    html = f"""
        <div style="font-family: Arial, sans-serif; text-align: center; padding: 40px;">
            <h1 style="color: #333;">Your verification code</h1>
            <p style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #000;">
                {str(code)[:3]} {str(code)[3:]}
            </p>
            <p style="color: #666;">This code expires in 10 minutes.</p>
        </div>"""
    return send_email(email, "Verification Code", html, from_name, from_email)

def send_reset_email(email: str, token: str, api_key_id: int = None) -> bool:
    from_name, from_email = get_project_email(api_key_id) if api_key_id else ("Torta Store", EMAIL_FROM)
    reset_url = f"{FRONTEND_URL}/reset-password/{token}"
    html = f"""
        <div style="font-family: Arial, sans-serif; text-align: center; padding: 40px;">
            <h1 style="color: #333;">Reset your password</h1>
            <p style="font-size: 16px; color: #666;">
                Click the button below to set a new password. Link expires in 30 minutes.
            </p>
            <a href="{reset_url}" style="
                display: inline-block; margin-top: 24px; padding: 14px 32px;
                background: #0071e3; color: #fff; text-decoration: none;
                border-radius: 16px; font-size: 18px; font-weight: 600;">
                Reset password
            </a>
            <p style="margin-top: 24px; color: #999; font-size: 12px; word-break: break-all;">
                {reset_url}
            </p>
        </div>"""
    return send_email(email, "Password Reset", html, from_name, from_email)
    
def try_get_current_user_id(request: Request):
    try:
        return get_current_user_id(request)
    except HTTPException:
        return None
    
def resolve_api_key(api_key: str, request: Request) -> dict:
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute(
        "SELECT * FROM crm_api_keys WHERE api_key = %s AND is_active = 1",
        (api_key,)
    )
    record = cursor.fetchone()
    if not record:
        cursor.close(); conn.close()
        raise HTTPException(status_code=401, detail="Invalid or inactive API key")
    
    # Обновляем last_used_ip и last_used_at
    ip = get_client_ip(request)
    cursor.execute(
        "UPDATE crm_api_keys SET last_used_ip = %s, last_used_at = NOW() WHERE id = %s",
        (ip, record["id"])
    )
    conn.commit()
    cursor.close(); conn.close()
    return record


# ============================================
# АУТЕНТИФИКАЦИЯ
# ============================================

@app.post("/{api_key}/api/send-code")
def send_code(
    request: SendCodeRequest,
    req: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    email = request.email.lower().strip()
    ip    = get_client_ip(req)
    now   = datetime.utcnow()

    # Проверка блокировки
    for key in [f"ip:{ip}", f"email:{email}"]:
        state = login_attempts.get(key)
        if state and state.get("blocked_until") and now < state["blocked_until"]:
            left = int((state["blocked_until"] - now).total_seconds())
            raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {left} seconds.")

    def fail(detail: str):
        for key in [f"ip:{ip}", f"email:{email}"]:
            state = login_attempts.get(key, {"count": 0, "blocked_until": None})
            state["count"] += 1
            if state["count"] >= MAX_FAILED_ATTEMPTS:
                state = {"count": 0, "blocked_until": now + timedelta(minutes=BLOCK_MINUTES)}
                left  = int((state["blocked_until"] - now).total_seconds())
                login_attempts[key] = state
                raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {left} seconds.")
            login_attempts[key] = state
        raise HTTPException(status_code=400, detail=detail)

    if request.type == "register":
        if get_user_by_email(email, api_key_id):
            fail("Email already exists")
        if not request.name or not request.password:
            fail("Name and password required")
        validate_password(request.password)

    elif request.type == "login":
        db_user = get_user_by_email(email, api_key_id)
        if not db_user:
            fail("Invalid email or password")
        if hash_password(request.password or "") != db_user["password_hash"]:
            fail("Invalid email or password")
    else:
        raise HTTPException(status_code=400, detail="Invalid type")

    code = random.randint(100000, 999999)
    pv_key = f"{api_key_id}:{email}"
    pending_verifications[pv_key] = {
        "code":          str(code),
        "type":          request.type,
        "name":          request.name,
        "password":      request.password,
        "api_key_id":    api_key_id,
        "expires":       now + timedelta(minutes=CODE_TTL_MINUTES),
        "next_resend_at": now + timedelta(seconds=RESEND_COOLDOWN_SECONDS),
    }

    if not send_code_email(email, code, api_key_id):
        del pending_verifications[pv_key]
        raise HTTPException(status_code=500, detail="Failed to send email")

    for key in [f"ip:{ip}", f"email:{email}"]:
        login_attempts.pop(key, None)

    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.post("/{api_key}/api/verify-code")
def verify_code(
    request: VerifyCodeRequest,
    response: Response,
    req: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    email  = request.email.lower().strip()
    code   = (request.code or "").replace(" ", "").strip()
    ip     = get_client_ip(req)
    now    = datetime.utcnow()
    pv_key = f"{api_key_id}:{email}"

    for key in [f"ip:{ip}", f"email:{email}"]:
        state = login_attempts.get(key)
        if state and state.get("blocked_until") and now < state["blocked_until"]:
            left = int((state["blocked_until"] - now).total_seconds())
            raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {left} seconds.")

    def fail(detail: str):
        for key in [f"ip:{ip}", f"email:{email}"]:
            state = login_attempts.get(key, {"count": 0, "blocked_until": None})
            state["count"] += 1
            if state["count"] >= MAX_FAILED_ATTEMPTS:
                state = {"count": 0, "blocked_until": now + timedelta(minutes=BLOCK_MINUTES)}
                left  = int((state["blocked_until"] - now).total_seconds())
                login_attempts[key] = state
                raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {left} seconds.")
            login_attempts[key] = state
        raise HTTPException(status_code=400, detail=detail)

    if pv_key not in pending_verifications:
        fail("Code not found or expired")

    pending = pending_verifications[pv_key]

    if now > pending["expires"]:
        del pending_verifications[pv_key]
        raise HTTPException(status_code=400, detail="Code expired")

    if code != pending["code"]:
        fail("Invalid code")

    conn   = get_db()
    cursor = conn.cursor()
    try:
        if pending["type"] == "register":
            cursor.execute(
                "INSERT INTO users (name, email, password_hash, api_key_id) VALUES (%s, %s, %s, %s)",
                (sanitize(pending["name"]), email, hash_password(pending["password"]), api_key_id)
            )
            conn.commit()
            user_id = cursor.lastrowid
        else:
            user_id = get_user_by_email(email, api_key_id)["id"]
    finally:
        cursor.close(); conn.close()

    token = create_token(user_id)
    set_auth_cookie(response, token)
    del pending_verifications[pv_key]

    for key in [f"ip:{ip}", f"email:{email}"]:
        login_attempts.pop(key, None)

    return {"success": True}


@app.post("/{api_key}/api/resend-code")
def resend_code(
    request: ResendCodeRequest,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    email  = request.email.lower().strip()
    now    = datetime.utcnow()
    pv_key = f"{api_key_id}:{email}"

    if pv_key not in pending_verifications:
        raise HTTPException(status_code=400, detail="No pending verification")

    pending = pending_verifications[pv_key]

    if now > pending["expires"]:
        del pending_verifications[pv_key]
        raise HTTPException(status_code=400, detail="Code expired. Start again.")

    if now < pending["next_resend_at"]:
        left = int((pending["next_resend_at"] - now).total_seconds())
        raise HTTPException(status_code=429, detail=f"Resend available in {left} seconds")

    code = random.randint(100000, 999999)
    pending_verifications[pv_key]["code"]            = str(code)
    pending_verifications[pv_key]["expires"]         = now + timedelta(minutes=CODE_TTL_MINUTES)
    pending_verifications[pv_key]["next_resend_at"]  = now + timedelta(seconds=RESEND_COOLDOWN_SECONDS)

    if not send_code_email(email, code, pending_verifications[pv_key]["api_key_id"]):
        raise HTTPException(status_code=500, detail="Failed to send email")

    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.get("/{api_key}/api/me")
def get_me(
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    user_id = get_current_user_id(request)
    user = get_user_by_id(user_id, api_key_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return {"id": user["id"], "name": user["name"], "email": user["email"]}


@app.post("/{api_key}/api/logout")
def logout(
    response: Response,
    api_key_record: dict = Depends(resolve_api_key)
):
    response.delete_cookie("authx_token", path="/")
    return {"success": True}


# ============================================
# ВОССТАНОВЛЕНИЕ ПАРОЛЯ
# ============================================

@app.post("/{api_key}/api/forgot-password")
def forgot_password(
    request: ForgotPasswordRequest,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    email = request.email.lower().strip()
    user  = get_user_by_email(email, api_key_id)

    if not user:
        return {"success": True, "message": "If the account exists, a reset email has been sent."}

    for t in [t for t, d in password_reset_tokens.items()
              if d["email"] == email and d["api_key_id"] == api_key_id]:
        del password_reset_tokens[t]

    raw_token  = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    password_reset_tokens[token_hash] = {
        "email":      email,
        "api_key_id": api_key_id,
        "expires":    datetime.utcnow() + timedelta(minutes=RESET_TTL_MINUTES),
    }

    if not send_reset_email(email, raw_token, api_key_id):
        del password_reset_tokens[token_hash]
        raise HTTPException(status_code=500, detail="Failed to send email")

    return {"success": True, "message": "If the account exists, a reset email has been sent."}


@app.get("/{api_key}/api/reset-password/validate/{token}")
def validate_reset_token(
    token: str,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    data       = password_reset_tokens.get(token_hash)

    if not data or datetime.utcnow() > data["expires"] or data["api_key_id"] != api_key_id:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    return {"valid": True, "email": data["email"]}


@app.post("/{api_key}/api/reset-password")
def reset_password(
    request: ResetPasswordRequest,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    token    = (request.token or "").strip()
    password = request.password or ""

    if password != (request.repeat_password or ""):
        raise HTTPException(status_code=400, detail="Passwords do not match")
    validate_password(password)

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    token_data = password_reset_tokens.get(token_hash)

    if not token_data or datetime.utcnow() > token_data["expires"] or token_data["api_key_id"] != api_key_id:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    conn   = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE users SET password_hash = %s WHERE email = %s AND api_key_id = %s",
            (hash_password(password), token_data["email"], api_key_id)
        )
        conn.commit()
    finally:
        cursor.close(); conn.close()

    del password_reset_tokens[token_hash]
    return {"success": True}


# ============================================
# ПРОДУКТЫ
# ============================================

@app.get("/{api_key}/api-products")
def get_products(api_key_record: dict = Depends(resolve_api_key)):
    api_key_id = api_key_record["id"]
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """SELECT id, title, seo_title, seo_description, seo_keywords
               FROM products WHERE api_key_id = %s""",
            (api_key_id,)
        )
        products = cursor.fetchall()
        if not products:
            return []

        product_ids = [p["id"] for p in products]
        format_ids  = ",".join(["%s"] * len(product_ids))

        cursor.execute(
            f"""SELECT product_id, MIN(id) as variation_id
                FROM product_variations
                WHERE product_id IN ({format_ids})
                GROUP BY product_id""",
            product_ids
        )
        first_variation = {row["product_id"]: row["variation_id"] for row in cursor.fetchall()}

        variation_ids = list(first_variation.values())
        images = {}
        if variation_ids:
            fmt = ",".join(["%s"] * len(variation_ids))
            cursor.execute(
                f"SELECT id, image_url FROM product_variations WHERE id IN ({fmt})",
                variation_ids
            )
            images = {row["id"]: row["image_url"] for row in cursor.fetchall()}

        cursor.execute(
            f"SELECT product_id, MIN(price) as price FROM product_sizes WHERE product_id IN ({format_ids}) GROUP BY product_id",
            product_ids
        )
        prices = {row["product_id"]: float(row["price"]) for row in cursor.fetchall()}

        cursor.execute(
            f"""SELECT product_id, field_key, field_value, field_type
                FROM product_custom_fields
                WHERE api_key_id = %s AND product_id IN ({format_ids})""",
            [api_key_id] + product_ids
        )
        custom_fields_map = {}
        for row in cursor.fetchall():
            pid = row["product_id"]
            custom_fields_map.setdefault(pid, {})[row["field_key"]] = row["field_value"]

        return [
            {
                "id":              p["id"],
                "hash":            hashids.encode(p["id"]),
                "title":           p["title"],
                "price":           prices.get(p["id"], 0),
                "image":           images.get(first_variation.get(p["id"])),
                "seo_title":       p["seo_title"],
                "seo_description": p["seo_description"],
                "seo_keywords":    p["seo_keywords"],
                "custom_fields":   custom_fields_map.get(p["id"], {}),
            }
            for p in products
        ]
    finally:
        cursor.close()
        conn.close()

@app.get("/{api_key}/api/product/{product_hash}", response_model=ProductPageResponse)
def get_product_page(
    product_hash: str,
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    decoded = hashids.decode(product_hash)
    if not decoded:
        raise HTTPException(status_code=404, detail="Product not found")
    product_id = decoded[0]

    api_key_id = api_key_record["id"]
    user_id    = try_get_current_user_id(request)

    conn   = get_db()
    cursor = conn.cursor(dictionary=True)

    try:
        cursor.execute(
            """SELECT id, title, description, characteristics,
                      seo_title, seo_description, seo_keywords
               FROM products WHERE id = %s AND api_key_id = %s""",
            (product_id, api_key_id)
        )
        product = cursor.fetchone()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")

        cursor.execute(
            "SELECT id, product_id, variation_name, image_url FROM product_variations WHERE product_id = %s",
            (product_id,)
        )
        variations = cursor.fetchall()

        variation_ids = [v["id"] for v in variations]
        sizes = []
        if variation_ids:
            format_ids = ",".join(["%s"] * len(variation_ids))
            cursor.execute(
                f"""SELECT id, product_id, variation_id, size_name, price, stock_quantity, sold_quantity
                    FROM product_sizes WHERE variation_id IN ({format_ids})""",
                variation_ids
            )
            sizes = cursor.fetchall()

        cursor.execute(
            """SELECT pr.id, pr.user_id, pr.rating, pr.comment, pr.created_at, u.name AS user_name
               FROM product_reviews pr
               JOIN users u ON pr.user_id = u.id
               WHERE pr.product_id = %s
               ORDER BY pr.created_at DESC""",
            (product_id,)
        )
        reviews_raw = cursor.fetchall()

        cursor.execute(
            """SELECT field_key, field_value, field_type
               FROM product_custom_fields
               WHERE api_key_id = %s AND product_id = %s""",
            (api_key_id, product_id)
        )
        custom_fields = {
            row["field_key"]: row["field_value"]
            for row in cursor.fetchall()
        }

        is_favorite = False
        can_review  = False
        cart_map    = {}

        if user_id:
            cursor.execute(
                "SELECT 1 FROM favorites WHERE user_id = %s AND product_id = %s LIMIT 1",
                (user_id, product_id)
            )
            is_favorite = cursor.fetchone() is not None

            cursor.execute(
                """SELECT ci.id AS cart_item_id, ci.variation_id, ci.size_id, ci.quantity
                   FROM cart_items ci
                   JOIN carts c ON ci.cart_id = c.id
                   WHERE c.user_id = %s AND ci.product_id = %s AND c.api_key_id = %s""",
                (user_id, product_id, api_key_id)
            )
            for row in cursor.fetchall():
                cart_map[(row["variation_id"], row["size_id"])] = row

            cursor.execute(
                "SELECT id FROM product_reviews WHERE product_id = %s AND user_id = %s LIMIT 1",
                (product_id, user_id)
            )
            already_reviewed = cursor.fetchone() is not None

            if not already_reviewed:
                cursor.execute(
                    """SELECT DISTINCT oh.id FROM order_history oh
                       JOIN order_items oi ON oh.id = oi.order_id
                       WHERE oh.user_id = %s AND oi.product_id = %s
                         AND oh.api_key_id = %s
                         AND oh.status IN ('delivered', 'returned')
                       LIMIT 1""",
                    (user_id, product_id, api_key_id)
                )
                can_review = cursor.fetchone() is not None

        sizes_by_variation = {}
        for s in sizes:
            if s["stock_quantity"] <= 0:
                continue
            cart_item = cart_map.get((s["variation_id"], s["id"]))
            sizes_by_variation.setdefault(s["variation_id"], []).append({
                "id":             s["id"],
                "size_name":      s["size_name"],
                "price":          float(s["price"]),
                "stock_quantity": s["stock_quantity"],
                "sold_quantity":  s["sold_quantity"],
                "is_in_cart":     cart_item is not None,
                "cart_item_id":   cart_item["cart_item_id"] if cart_item else None,
                "cart_quantity":  cart_item["quantity"] if cart_item else 0,
            })

        final_variations = []
        for v in variations:
            var_sizes = sizes_by_variation.get(v["id"], [])
            if not var_sizes:
                continue
            final_variations.append({
                "id":             v["id"],
                "variation_name": v["variation_name"],
                "image":          v["image_url"],
                "is_in_cart":     any(s["is_in_cart"] for s in var_sizes),
                "sizes":          var_sizes,
            })

        reviews = [
            {
                "id":         r["id"],
                "user_id":    r["user_id"],
                "user_name":  r["user_name"],
                "rating":     r["rating"],
                "comment":    r["comment"] or "",
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in reviews_raw
        ]

        reviews_count  = len(reviews)
        average_rating = round(sum(r["rating"] for r in reviews) / reviews_count, 1) if reviews_count > 0 else 0.0
        initial_size_id = final_variations[0]["sizes"][0]["id"] if final_variations and final_variations[0]["sizes"] else None

        return {
            "id":                      product["id"],
            "product_hash":            hashids.encode(product["id"]),
            "title":                   product["title"],
            "description":             product["description"] or "",
            "characteristics":         product["characteristics"] or "",
            "seo_title":               product["seo_title"],
            "seo_description":         product["seo_description"],
            "seo_keywords":            product["seo_keywords"],
            "custom_fields":           custom_fields,
            "is_authenticated":        user_id is not None,
            "current_user_id":         user_id,
            "is_favorite":             is_favorite,
            "can_review":              can_review,
            "reviews_count":           reviews_count,
            "average_rating":          average_rating,
            "initial_variation_index": 0,
            "initial_size_id":         initial_size_id,
            "variations":              final_variations,
            "reviews":                 reviews,
        }

    finally:
        cursor.close()
        conn.close()

# ============================================
# КОРЗИНА
# ============================================

@app.post("/{api_key}/api/cart/add")
def add_to_cart(
    item: AddToCart,
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id FROM carts WHERE user_id = %s AND api_key_id = %s",
            (user_id, api_key_id)
        )
        cart = cursor.fetchone()
        if not cart:
            cursor.execute(
                "INSERT INTO carts (user_id, api_key_id) VALUES (%s, %s)",
                (user_id, api_key_id)
            )
            conn.commit()
            cart_id = cursor.lastrowid
        else:
            cart_id = cart["id"]

        cursor.execute(
            "SELECT id FROM products WHERE id = %s AND api_key_id = %s",
            (item.product_id, api_key_id)
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=403, detail="Product not in this store")

        cursor.execute(
            """SELECT id, quantity FROM cart_items
               WHERE cart_id = %s AND product_id = %s AND variation_id = %s AND size_id = %s""",
            (cart_id, item.product_id, item.variation_id, item.size_id)
        )
        existing = cursor.fetchone()
        if existing:
            cursor.execute(
                "UPDATE cart_items SET quantity = %s WHERE id = %s",
                (existing["quantity"] + item.quantity, existing["id"])
            )
        else:
            cursor.execute(
                """INSERT INTO cart_items (cart_id, product_id, variation_id, size_id, quantity)
                   VALUES (%s, %s, %s, %s, %s)""",
                (cart_id, item.product_id, item.variation_id, item.size_id, item.quantity)
            )
        conn.commit()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close(); conn.close()


@app.delete("/{api_key}/api/cart/clear")
def clear_cart(
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id FROM carts WHERE user_id = %s AND api_key_id = %s",
            (user_id, api_key_id)
        )
        cart = cursor.fetchone()
        if cart:
            cursor.execute("DELETE FROM cart_items WHERE cart_id = %s", (cart["id"],))
            conn.commit()
        return {"success": True}
    finally:
        cursor.close(); conn.close()


@app.delete("/{api_key}/api/cart/{cart_item_id}")
def remove_from_cart(
    cart_item_id: int,
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """SELECT ci.id FROM cart_items ci
               JOIN carts c ON ci.cart_id = c.id
               WHERE ci.id = %s AND c.user_id = %s AND c.api_key_id = %s""",
            (cart_item_id, user_id, api_key_id)
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Cart item not found")
        cursor.execute("DELETE FROM cart_items WHERE id = %s", (cart_item_id,))
        conn.commit()
        return {"success": True}
    finally:
        cursor.close(); conn.close()


@app.put("/{api_key}/api/cart/{cart_item_id}")
def update_cart_quantity(
    cart_item_id: int,
    data: UpdateCartQuantity,
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    user_id = get_current_user_id(request)
    if data.quantity < 1:
        raise HTTPException(status_code=400, detail="Quantity must be at least 1")
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """SELECT ci.id FROM cart_items ci
               JOIN carts c ON ci.cart_id = c.id
               WHERE ci.id = %s AND c.user_id = %s AND c.api_key_id = %s""",
            (cart_item_id, user_id, api_key_id)
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Cart item not found")
        cursor.execute(
            "UPDATE cart_items SET quantity = %s WHERE id = %s",
            (data.quantity, cart_item_id)
        )
        conn.commit()
        return {"success": True}
    finally:
        cursor.close(); conn.close()


@app.get("/{api_key}/api/cart", response_model=CartPageResponse)
def get_cart(
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    user_id = get_current_user_id(request)
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT shipping_cost, free_shipping_threshold FROM shipping_settings WHERE api_key_id = %s LIMIT 1",
            (api_key_id,)
        )
        settings       = cursor.fetchone()
        shipping_cost  = float(settings["shipping_cost"])           if settings else 10.0
        free_threshold = float(settings["free_shipping_threshold"]) if settings else 2000.0

        cursor.execute(
            "SELECT product_id FROM favorites WHERE user_id = %s",
            (user_id,)
        )
        favorites_ids = [row["product_id"] for row in cursor.fetchall()]
        favorites_set = set(favorites_ids)

        cursor.execute(
            "SELECT id FROM carts WHERE user_id = %s AND api_key_id = %s",
            (user_id, api_key_id)
        )
        cart = cursor.fetchone()

        if not cart:
            return {
                "items": [], "favorites_ids": favorites_ids,
                "subtotal": 0, "shipping_cost": shipping_cost,
                "free_shipping_threshold": free_threshold,
                "amount_to_free_shipping": free_threshold,
                "shipping_progress": 0, "total": 0,
            }

        cursor.execute(
            """SELECT ci.id as cart_item_id, ci.quantity, ci.product_id, ci.variation_id, ci.size_id,
                      p.title, p.description, ps.price, ps.size_name,
                      pv.variation_name, pv.image_url
               FROM cart_items ci
               JOIN products p                 ON ci.product_id  = p.id
               LEFT JOIN product_variations pv ON ci.variation_id = pv.id
               LEFT JOIN product_sizes      ps ON ci.size_id      = ps.id
               WHERE ci.cart_id = %s""",
            (cart["id"],)
        )
        rows = cursor.fetchall()

        items    = []
        subtotal = 0.0
        for row in rows:
            price     = float(row["price"] or 0)
            subtotal += price * row["quantity"]
            items.append({**row, "price": price, "product_hash": hashids.encode(row["product_id"]), "is_favorite": row["product_id"] in favorites_set})

        final_shipping    = 0.0 if subtotal >= free_threshold else shipping_cost
        shipping_progress = min((subtotal / free_threshold) * 100, 100) if free_threshold > 0 else 100
        amount_to_free    = max(free_threshold - subtotal, 0)

        return {
            "items":                   items,
            "favorites_ids":           favorites_ids,
            "subtotal":                round(subtotal, 2),
            "shipping_cost":           round(final_shipping, 2),
            "free_shipping_threshold": free_threshold,
            "amount_to_free_shipping": round(amount_to_free, 2),
            "shipping_progress":       round(shipping_progress, 2),
            "total":                   round(subtotal + final_shipping, 2),
        }
    finally:
        cursor.close(); conn.close()


# ============================================
# ИЗБРАННОЕ
# ============================================

@app.post("/{api_key}/api/favorites/add")
def add_to_favorites(
    item: AddToFavorites,
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id FROM products WHERE id = %s AND api_key_id = %s",
            (item.product_id, api_key_id)
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=403, detail="Product not in this store")
        cursor.execute(
            "INSERT INTO favorites (user_id, product_id) VALUES (%s, %s)",
            (user_id, item.product_id)
        )
        conn.commit()
    except mysql.connector.IntegrityError:
        pass
    except HTTPException:
        raise
    finally:
        cursor.close(); conn.close()
    return {"success": True}


@app.get("/{api_key}/api/favorites")
def get_favorites(
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    user_id = get_current_user_id(request)
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """SELECT f.product_id, p.title FROM favorites f
               JOIN products p ON f.product_id = p.id
               WHERE f.user_id = %s AND p.api_key_id = %s""",
            (user_id, api_key_id)
        )
        rows = cursor.fetchall()
        return [
            {**row, "hash": hashids.encode(row["product_id"])}
            for row in rows
        ]
    finally:
        cursor.close(); conn.close()


@app.delete("/{api_key}/api/favorites/{product_hash}")
def remove_from_favorites(
    product_hash: str,
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    decoded = hashids.decode(product_hash)
    if not decoded:
        raise HTTPException(status_code=404, detail="Product not found")
    product_id = decoded[0]

    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor()
    try:
        cursor.execute(
            "DELETE FROM favorites WHERE product_id = %s AND user_id = %s",
            (product_id, user_id)
        )
        conn.commit()
        return {"success": True}
    finally:
        cursor.close(); conn.close()



# ============================================
# ОТЗЫВЫ
# ============================================

@app.post("/{api_key}/api/reviews/add")
def add_review(
    review: AddReview,
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    user_id = get_current_user_id(request)
    if not 1 <= review.rating <= 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id FROM products WHERE id = %s AND api_key_id = %s",
            (review.product_id, api_key_id)
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=403, detail="Product not in this store")
        cursor.execute(
            """INSERT INTO product_reviews (product_id, user_id, rating, comment, created_at)
               VALUES (%s, %s, %s, %s, NOW())""",
            (review.product_id, user_id, review.rating, sanitize(review.comment))
        )
        conn.commit()
        return {"success": True}
    except mysql.connector.IntegrityError:
        raise HTTPException(status_code=400, detail="You have already reviewed this product")
    except HTTPException:
        raise
    finally:
        cursor.close(); conn.close()


@app.get("/{api_key}/api/reviews/can-review/{product_id}")
def can_user_review(
    product_id: int,
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    try:
        user_id = get_current_user_id(request)
    except Exception:
        return {"can_review": False, "reason": "not_authenticated"}
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id FROM product_reviews WHERE product_id = %s AND user_id = %s",
            (product_id, user_id)
        )
        if cursor.fetchone():
            return {"can_review": False, "reason": "already_reviewed"}
        cursor.execute(
            """SELECT DISTINCT oh.id FROM order_history oh
               JOIN order_items oi ON oh.id = oi.order_id
               WHERE oh.user_id = %s AND oi.product_id = %s
                 AND oh.api_key_id = %s
                 AND oh.status IN ('delivered', 'returned')
               LIMIT 1""",
            (user_id, product_id, api_key_id)
        )
        can = cursor.fetchone() is not None
        return {"can_review": can} if can else {"can_review": False, "reason": "not_purchased"}
    finally:
        cursor.close(); conn.close()


@app.delete("/{api_key}/api/reviews/{review_id}")
def delete_review(
    review_id: int,
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT user_id FROM product_reviews WHERE id = %s", (review_id,))
        review = cursor.fetchone()
        if not review:
            raise HTTPException(status_code=404, detail="Review not found")
        if review["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Not authorized")
        cursor.execute("DELETE FROM product_reviews WHERE id = %s", (review_id,))
        conn.commit()
        return {"success": True}
    finally:
        cursor.close(); conn.close()


# ============================================
# ПРОМОКОДЫ
# ============================================

@app.post("/{api_key}/api/promo-code/apply")
def apply_promo_code(
    data: ApplyPromoCode,
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    user_id = get_current_user_id(request)
    now     = datetime.utcnow()
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id FROM carts WHERE user_id = %s AND api_key_id = %s",
            (user_id, api_key_id)
        )
        cart = cursor.fetchone()
        if not cart:
            raise HTTPException(status_code=400, detail="Cart is empty")

        cursor.execute(
            """SELECT SUM(ps.price * ci.quantity) as subtotal
               FROM cart_items ci
               JOIN product_sizes ps ON ci.size_id = ps.id
               WHERE ci.cart_id = %s""",
            (cart["id"],)
        )
        subtotal = float((cursor.fetchone() or {}).get("subtotal") or 0)
        if subtotal == 0:
            raise HTTPException(status_code=400, detail="Cart is empty")

        cursor.execute(
            "SELECT * FROM promo_codes WHERE code = %s AND api_key_id = %s AND is_active = TRUE",
            (data.code.strip().upper(), api_key_id)
        )
        promo = cursor.fetchone()
        if not promo:
            raise HTTPException(status_code=404, detail="Promo code not found")

        if promo["valid_from"]  and promo["valid_from"]  > now:
            raise HTTPException(status_code=400, detail="Promo code not yet valid")
        if promo["valid_until"] and promo["valid_until"] < now:
            raise HTTPException(status_code=400, detail="Promo code expired")
        if subtotal < float(promo["min_order_amount"]):
            raise HTTPException(status_code=400, detail=f"Minimum order amount is {promo['min_order_amount']}")
        if promo["usage_limit"] and promo["times_used"] >= promo["usage_limit"]:
            raise HTTPException(status_code=400, detail="Usage limit reached")

        discount_value = float(promo["discount_value"])
        if promo["discount_type"] == "percentage":
            discount = subtotal * (discount_value / 100)
            if promo["max_discount"]:
                discount = min(discount, float(promo["max_discount"]))
        else:
            discount = discount_value

        cursor.execute(
            "SELECT shipping_cost, free_shipping_threshold FROM shipping_settings WHERE api_key_id = %s LIMIT 1",
            (api_key_id,)
        )
        settings       = cursor.fetchone()
        shipping_cost  = float(settings["shipping_cost"])           if settings else 10.0
        free_threshold = float(settings["free_shipping_threshold"]) if settings else 2000.0

        final_shipping = 0.0 if subtotal >= free_threshold else shipping_cost
        total          = subtotal + final_shipping - discount

        return {
            "success":          True,
            "code":             promo["code"],
            "discount":         round(discount, 2),
            "discount_percent": round((discount / subtotal) * 100) if subtotal > 0 else 0,
            "subtotal":         round(subtotal, 2),
            "shipping_cost":    final_shipping,
            "total":            round(total, 2),
        }
    finally:
        cursor.close(); conn.close()


# ============================================
# ТРЕКИНГ
# ============================================

@app.post("/{api_key}/api/track/visit")
def track_visit(
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    try:
        user_id = get_current_user_id(request)
    except Exception:
        user_id = None
    ip   = get_client_ip(request)
    conn = get_db()
    cursor = conn.cursor(dictionary=True, buffered=True)
    try:
        cursor.execute(
            """SELECT id FROM site_visits
               WHERE ip = %s AND api_key_id = %s
               AND created_at >= NOW() - INTERVAL 30 SECOND""",
            (ip, api_key_id)
        )
        if cursor.fetchone():
            return {"success": True, "skipped": True}
        cursor.execute(
            "INSERT INTO site_visits (user_id, ip, api_key_id) VALUES (%s, %s, %s)",
            (user_id, ip, api_key_id)
        )
        conn.commit()
        return {"success": True}
    finally:
        cursor.close(); conn.close()


@app.post("/{api_key}/api/track/product-view")
def track_product_view(
    data: TrackProductView,
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    try:
        user_id = get_current_user_id(request)
    except Exception:
        user_id = None
    ip   = get_client_ip(request)
    conn = get_db()
    cursor = conn.cursor(dictionary=True, buffered=True)
    try:
        cursor.execute(
            """SELECT id FROM product_page_views
               WHERE ip = %s AND product_id = %s AND api_key_id = %s
               AND created_at >= NOW() - INTERVAL 30 SECOND""",
            (ip, data.product_id, api_key_id)
        )
        if cursor.fetchone():
            return {"success": True, "skipped": True}
        cursor.execute(
            "INSERT INTO product_page_views (product_id, user_id, ip, api_key_id) VALUES (%s, %s, %s, %s)",
            (data.product_id, user_id, ip, api_key_id)
        )
        conn.commit()
        return {"success": True}
    finally:
        cursor.close(); conn.close()


@app.post("/{api_key}/api/track/product-view")
def track_product_view(
    data: TrackProductView,
    request: Request,
    api_key_record: dict = Depends(resolve_api_key)
):
    api_key_id = api_key_record["id"]
    try:
        user_id = get_current_user_id(request)
    except Exception:
        user_id = None
    ip = get_client_ip(request)
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """SELECT id FROM product_page_views
               WHERE ip = %s AND product_id = %s AND api_key_id = %s
               AND created_at >= NOW() - INTERVAL 30 SECOND""",
            (ip, data.product_id, api_key_id)
        )
        if cursor.fetchone():
            return {"success": True, "skipped": True}
        cursor.execute(
            "INSERT INTO product_page_views (product_id, user_id, ip, api_key_id) VALUES (%s, %s, %s, %s)",
            (data.product_id, user_id, ip, api_key_id)
        )
        conn.commit()
        return {"success": True}
    finally:
        cursor.close(); conn.close()