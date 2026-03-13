from fastapi import FastAPI, Response, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
import mysql.connector
import hashlib
import secrets
import jwt
import random
import resend


# ============================================
# НАСТРОЙКИ
# ============================================

SECRET_KEY = "d2a9c8f0e5b741a39f6c8d2e1b5a9c3f8e7d6c5b4a3928173645e5f6a7b8c9d0"
JWT_ALGORITHM = "HS256"
JWT_HOURS = 24 * 7

RESEND_API_KEY = "re_AixvxJe9_aQ8UsEwgVTFQjjrcUUMnAi6e"
RESEND_FROM = "onboarding@resend.dev"
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

app = FastAPI()
resend.api_key = RESEND_API_KEY

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


# ============================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ============================================

def get_db():
    return mysql.connector.connect(**DB_CONFIG)

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

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

def get_user_by_email(email: str):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM users WHERE email=%s", (email,))
    user = cursor.fetchone()
    cursor.close(); conn.close()
    return user

def get_user_by_id(user_id: int):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT id, name, email FROM users WHERE id=%s", (user_id,))
    user = cursor.fetchone()
    cursor.close(); conn.close()
    return user

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def send_code_email(email: str, code: int) -> bool:
    try:
        resend.Emails.send({
            "from": RESEND_FROM,
            "to": email,
            "subject": "Verification Code",
            "html": f"""
                <div style="font-family: Arial, sans-serif; text-align: center; padding: 40px;">
                    <h1 style="color: #333;">Your verification code</h1>
                    <p style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #000;">
                        {str(code)[:3]} {str(code)[3:]}
                    </p>
                    <p style="color: #666;">This code expires in 10 minutes.</p>
                </div>
            """
        })
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False

def send_reset_email(email: str, token: str) -> bool:
    reset_url = f"{FRONTEND_URL}/reset-password/{token}"
    try:
        resend.Emails.send({
            "from": RESEND_FROM,
            "to": email,
            "subject": "Password Reset",
            "html": f"""
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
                </div>
            """
        })
        return True
    except Exception as e:
        print(f"Reset email error: {e}")
        return False


# ============================================
# АУТЕНТИФИКАЦИЯ
# ============================================

@app.post("/api/send-code")
def send_code(request: SendCodeRequest, req: Request):
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
        if get_user_by_email(email):
            fail("Email already exists")
        if not request.name or not request.password:
            fail("Name and password required")

    elif request.type == "login":
        db_user = get_user_by_email(email)
        if not db_user:
            fail("Invalid email or password")
        if hash_password(request.password or "") != db_user["password_hash"]:
            fail("Invalid email or password")
    else:
        raise HTTPException(status_code=400, detail="Invalid type")

    code = random.randint(100000, 999999)
    pending_verifications[email] = {
        "code": str(code),
        "type": request.type,
        "name": request.name,
        "password": request.password,
        "expires": now + timedelta(minutes=CODE_TTL_MINUTES),
        "next_resend_at": now + timedelta(seconds=RESEND_COOLDOWN_SECONDS),
    }

    if not send_code_email(email, code):
        del pending_verifications[email]
        raise HTTPException(status_code=500, detail="Failed to send email")

    # Успех — сбрасываем счётчик
    for key in [f"ip:{ip}", f"email:{email}"]:
        login_attempts.pop(key, None)

    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.post("/api/verify-code")
def verify_code(request: VerifyCodeRequest, response: Response, req: Request):
    email = request.email.lower().strip()
    code  = (request.code or "").replace(" ", "").strip()
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

    if email not in pending_verifications:
        fail("Code not found or expired")

    pending = pending_verifications[email]

    if now > pending["expires"]:
        del pending_verifications[email]
        raise HTTPException(status_code=400, detail="Code expired")

    if code != pending["code"]:
        fail("Invalid code")

    conn   = get_db()
    cursor = conn.cursor()
    try:
        if pending["type"] == "register":
            cursor.execute(
                "INSERT INTO users (name, email, password_hash) VALUES (%s,%s,%s)",
                (pending["name"], email, hash_password(pending["password"]))
            )
            conn.commit()
            user_id = cursor.lastrowid
        else:
            user_id = get_user_by_email(email)["id"]
    finally:
        cursor.close(); conn.close()

    token = create_token(user_id)
    set_auth_cookie(response, token)
    del pending_verifications[email]

    for key in [f"ip:{ip}", f"email:{email}"]:
        login_attempts.pop(key, None)

    return {"success": True}


@app.post("/api/resend-code")
def resend_code(request: ResendCodeRequest):
    email = request.email.lower().strip()
    now   = datetime.utcnow()

    if email not in pending_verifications:
        raise HTTPException(status_code=400, detail="No pending verification")

    pending = pending_verifications[email]

    if now > pending["expires"]:
        del pending_verifications[email]
        raise HTTPException(status_code=400, detail="Code expired. Start again.")

    if now < pending["next_resend_at"]:
        left = int((pending["next_resend_at"] - now).total_seconds())
        raise HTTPException(status_code=429, detail=f"Resend available in {left} seconds")

    code = random.randint(100000, 999999)
    pending_verifications[email]["code"]           = str(code)
    pending_verifications[email]["expires"]        = now + timedelta(minutes=CODE_TTL_MINUTES)
    pending_verifications[email]["next_resend_at"] = now + timedelta(seconds=RESEND_COOLDOWN_SECONDS)

    if not send_code_email(email, code):
        raise HTTPException(status_code=500, detail="Failed to send email")

    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.get("/api/me")
def get_current_user(request: Request):
    user = get_user_by_id(get_current_user_id(request))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return {"id": user["id"], "name": user["name"], "email": user["email"]}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie("authx_token", path="/")
    return {"success": True}


# ============================================
# ВОССТАНОВЛЕНИЕ ПАРОЛЯ
# ============================================

@app.post("/api/forgot-password")
def forgot_password(request: ForgotPasswordRequest):
    email = request.email.lower().strip()
    user  = get_user_by_email(email)

    if not user:
        return {"success": True, "message": "If the account exists, a reset email has been sent."}

    # Удаляем старые токены этого email
    for t in [t for t, d in password_reset_tokens.items() if d["email"] == email]:
        del password_reset_tokens[t]

    raw_token  = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    password_reset_tokens[token_hash] = {
        "email":   email,
        "expires": datetime.utcnow() + timedelta(minutes=RESET_TTL_MINUTES),
    }

    if not send_reset_email(email, raw_token):
        del password_reset_tokens[token_hash]
        raise HTTPException(status_code=500, detail="Failed to send email")

    return {"success": True, "message": "If the account exists, a reset email has been sent."}


@app.get("/api/reset-password/validate/{token}")
def validate_reset_token(token: str):
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    data       = password_reset_tokens.get(token_hash)

    if not data or datetime.utcnow() > data["expires"]:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    return {"valid": True, "email": data["email"]}


@app.post("/api/reset-password")
def reset_password(request: ResetPasswordRequest):
    token    = (request.token or "").strip()
    password = request.password or ""

    if password != (request.repeat_password or ""):
        raise HTTPException(status_code=400, detail="Passwords do not match")

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    token_data = password_reset_tokens.get(token_hash)

    if not token_data or datetime.utcnow() > token_data["expires"]:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    conn   = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE users SET password_hash=%s WHERE email=%s",
            (hash_password(password), token_data["email"])
        )
        conn.commit()
    finally:
        cursor.close(); conn.close()

    del password_reset_tokens[token_hash]
    return {"success": True}


# ============================================
# ПРОДУКТЫ
# ============================================

@app.get("/api-products")
def get_products():
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("SELECT * FROM products")
    products = cursor.fetchall()
    if not products:
        cursor.close(); conn.close()
        return []

    product_ids = [p["id"] for p in products]
    format_ids = ",".join(["%s"] * len(product_ids))

    cursor.execute(f"SELECT * FROM product_variations WHERE product_id IN ({format_ids})", product_ids)
    variations = cursor.fetchall()
    
    cursor.execute(f"SELECT * FROM product_sizes WHERE product_id IN ({format_ids})", product_ids)
    sizes = cursor.fetchall()
    
    cursor.execute(
        f"""SELECT pr.*, u.name AS user_name
            FROM product_reviews pr
            JOIN users u ON pr.user_id = u.id
            WHERE pr.product_id IN ({format_ids})""",
        product_ids
    )
    reviews = cursor.fetchall()
    
    cursor.close()
    conn.close()

    # Группировка данных
    sizes_by_variation = {}
    for s in sizes:
        sizes_by_variation.setdefault(s["variation_id"], []).append({
            "id": s["id"], "size_name": s["size_name"],
            "price": float(s["price"]),
            "stock_quantity": s["stock_quantity"],
            "sold_quantity": s["sold_quantity"]
        })

    variations_by_product = {}
    for v in variations:
        variations_by_product.setdefault(v["product_id"], []).append({
            "id": v["id"], "variation_name": v["variation_name"],
            "image": v["image_url"], "sizes": sizes_by_variation.get(v["id"], [])
        })

    reviews_by_product = {}
    for r in reviews:
        reviews_by_product.setdefault(r["product_id"], []).append({
            "id": r["id"], "user_id": r["user_id"], "rating": r["rating"],
            "comment": r["comment"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "user_name": r["user_name"]
        })

    # Вычисление минимальной цены для каждого продукта
    min_price_by_product = {}
    for s in sizes:
        product_id = s["product_id"]
        price = float(s["price"])
        if product_id not in min_price_by_product:
            min_price_by_product[product_id] = price
        else:
            min_price_by_product[product_id] = min(min_price_by_product[product_id], price)

    # Формирование результата
    for p in products:
        p["variations"] = variations_by_product.get(p["id"], [])
        p["reviews"] = reviews_by_product.get(p["id"], [])
        p["price"] = min_price_by_product.get(p["id"], 0)

    return products


# ============================================
# КОРЗИНА
# ============================================

@app.post("/api/cart/add")
def add_to_cart(item: AddToCart, request: Request):
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT id FROM carts WHERE user_id=%s", (user_id,))
        cart = cursor.fetchone()
        if not cart:
            cursor.execute("INSERT INTO carts (user_id) VALUES (%s)", (user_id,))
            conn.commit()
            cart_id = cursor.lastrowid
        else:
            cart_id = cart["id"]

        cursor.execute(
            """SELECT id, quantity FROM cart_items
               WHERE cart_id=%s AND product_id=%s AND variation_id=%s AND size_id=%s""",
            (cart_id, item.product_id, item.variation_id, item.size_id)
        )
        existing = cursor.fetchone()
        if existing:
            cursor.execute(
                "UPDATE cart_items SET quantity=%s WHERE id=%s",
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
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cursor.close(); conn.close()


@app.get("/api/cart")
def get_cart(request: Request):
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    cursor.execute("SELECT id FROM carts WHERE user_id=%s", (user_id,))
    cart = cursor.fetchone()
    if not cart:
        cursor.close(); conn.close()
        return []
    cursor.execute(
        """SELECT ci.id as cart_item_id, ci.quantity, ci.product_id, ci.variation_id, ci.size_id,
           p.title, ps.price, pv.variation_name, pv.image_url, ps.size_name
           FROM cart_items ci
           JOIN products p ON ci.product_id = p.id
           LEFT JOIN product_variations pv ON ci.variation_id = pv.id
           LEFT JOIN product_sizes ps ON ci.size_id = ps.id
           WHERE ci.cart_id = %s""",
        (cart["id"],)
    )
    items = cursor.fetchall()
    cursor.close(); conn.close()
    return items


@app.delete("/api/cart/{cart_item_id}")
def remove_from_cart(cart_item_id: int, request: Request):
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    cursor.execute(
        """SELECT ci.id FROM cart_items ci
           JOIN carts c ON ci.cart_id = c.id
           WHERE ci.id=%s AND c.user_id=%s""",
        (cart_item_id, user_id)
    )
    if not cursor.fetchone():
        cursor.close(); conn.close()
        raise HTTPException(status_code=404, detail="Cart item not found")
    cursor.execute("DELETE FROM cart_items WHERE id=%s", (cart_item_id,))
    conn.commit()
    cursor.close(); conn.close()
    return {"success": True}


@app.put("/api/cart/{cart_item_id}")
def update_cart_quantity(cart_item_id: int, data: UpdateCartQuantity, request: Request):
    user_id = get_current_user_id(request)
    if data.quantity < 1:
        raise HTTPException(status_code=400, detail="Quantity must be at least 1")
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute(
        """SELECT ci.id FROM cart_items ci
           JOIN carts c ON ci.cart_id = c.id
           WHERE ci.id=%s AND c.user_id=%s""",
        (cart_item_id, user_id)
    )
    if not cursor.fetchone():
        cursor.close(); conn.close()
        raise HTTPException(status_code=404, detail="Cart item not found")
    cursor.execute("UPDATE cart_items SET quantity=%s WHERE id=%s", (data.quantity, cart_item_id))
    conn.commit()
    cursor.close(); conn.close()
    return {"success": True}


@app.delete("/api/cart/clear")
def clear_cart(request: Request):
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    cursor.execute("SELECT id FROM carts WHERE user_id=%s", (user_id,))
    cart = cursor.fetchone()
    if cart:
        cursor.execute("DELETE FROM cart_items WHERE cart_id=%s", (cart["id"],))
        conn.commit()
    cursor.close(); conn.close()
    return {"success": True}


# ============================================
# ИЗБРАННОЕ
# ============================================

@app.post("/api/favorites/add")
def add_to_favorites(item: AddToFavorites, request: Request):
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor()
    try:
        cursor.execute("INSERT INTO favorites (user_id, product_id) VALUES (%s, %s)", (user_id, item.product_id))
        conn.commit()
    except mysql.connector.IntegrityError:
        pass
    finally:
        cursor.close(); conn.close()
    return {"success": True}


@app.get("/api/favorites")
def get_favorites(request: Request):
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    cursor.execute(
        """SELECT f.*, p.title FROM favorites f
           JOIN products p ON f.product_id = p.id
           WHERE f.user_id = %s""",
        (user_id,)
    )
    items = cursor.fetchall()
    cursor.close(); conn.close()
    return items


@app.delete("/api/favorites/{product_id}")
def remove_from_favorites(product_id: int, request: Request):
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor()
    cursor.execute("DELETE FROM favorites WHERE product_id=%s AND user_id=%s", (product_id, user_id))
    conn.commit()
    cursor.close(); conn.close()
    return {"success": True}


# ============================================
# ОТЗЫВЫ
# ============================================

@app.post("/api/reviews/add")
def add_review(review: AddReview, request: Request):
    user_id = get_current_user_id(request)
    if not 1 <= review.rating <= 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
    conn   = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """INSERT INTO product_reviews (product_id, user_id, rating, comment, created_at)
               VALUES (%s, %s, %s, %s, NOW())""",
            (review.product_id, user_id, review.rating, review.comment)
        )
        conn.commit()
        return {"success": True}
    except mysql.connector.IntegrityError:
        raise HTTPException(status_code=400, detail="You have already reviewed this product")
    finally:
        cursor.close(); conn.close()


@app.get("/api/reviews/can-review/{product_id}")
def can_user_review(product_id: int, request: Request):
    try:
        user_id = get_current_user_id(request)
    except Exception:
        return {"can_review": False, "reason": "not_authenticated"}
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT id FROM product_reviews WHERE product_id=%s AND user_id=%s", (product_id, user_id))
    if cursor.fetchone():
        cursor.close(); conn.close()
        return {"can_review": False, "reason": "already_reviewed"}
    cursor.execute(
        """SELECT DISTINCT oh.id FROM order_history oh
           JOIN order_items oi ON oh.id = oi.order_id
           WHERE oh.user_id = %s AND oi.product_id = %s AND oh.status IN ('delivered', 'returned')
           LIMIT 1""",
        (user_id, product_id)
    )
    can_review = cursor.fetchone() is not None
    cursor.close(); conn.close()
    return {"can_review": can_review} if can_review else {"can_review": False, "reason": "not_purchased"}


@app.delete("/api/reviews/{review_id}")
def delete_review(review_id: int, request: Request):
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    cursor.execute("SELECT user_id FROM product_reviews WHERE id=%s", (review_id,))
    review = cursor.fetchone()
    if not review:
        cursor.close(); conn.close()
        raise HTTPException(status_code=404, detail="Review not found")
    if review["user_id"] != user_id:
        cursor.close(); conn.close()
        raise HTTPException(status_code=403, detail="Not authorized")
    cursor.execute("DELETE FROM product_reviews WHERE id=%s", (review_id,))
    conn.commit()
    cursor.close(); conn.close()
    return {"success": True}


# ============================================
# СТРАНИЦЫ — ИЗБРАННОЕ / КОРЗИНА
# ============================================

@app.get("/api/pages/favorites")
def get_favorites_ids(request: Request):
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    cursor.execute("SELECT product_id FROM favorites WHERE user_id = %s", (user_id,))
    favorites = cursor.fetchall()
    cursor.close(); conn.close()
    return [f["product_id"] for f in favorites]


@app.get("/api/pages/cart")
def get_cart_page(request: Request):
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT id FROM carts WHERE user_id=%s", (user_id,))
        cart = cursor.fetchone()

        cursor.execute("SELECT shipping_cost, free_shipping_threshold FROM shipping_settings LIMIT 1")
        settings       = cursor.fetchone()
        shipping_cost  = float(settings["shipping_cost"])           if settings else 10.0
        free_threshold = float(settings["free_shipping_threshold"]) if settings else 2000.0

        if not cart:
            return {
                "items": [], "subtotal": 0,
                "shipping_cost": shipping_cost,
                "free_shipping_threshold": free_threshold,
                "amount_to_free_shipping": free_threshold,
                "shipping_progress": 0, "total": 0
            }

        cursor.execute(
            """SELECT ci.id as cart_item_id, ci.quantity, ci.product_id, ci.variation_id, ci.size_id,
                p.title, p.description, ps.price, ps.size_name, pv.variation_name, pv.image_url
               FROM cart_items ci
               JOIN products p ON ci.product_id = p.id
               LEFT JOIN product_variations pv ON ci.variation_id = pv.id
               LEFT JOIN product_sizes ps ON ci.size_id = ps.id
               WHERE ci.cart_id = %s""",
            (cart["id"],)
        )
        items    = cursor.fetchall()
        subtotal = sum(float(item["price"]) * item["quantity"] for item in items)

        final_shipping    = 0 if subtotal >= free_threshold else shipping_cost
        shipping_progress = min((subtotal / free_threshold) * 100, 100) if free_threshold > 0 else 100
        amount_to_free    = max(free_threshold - subtotal, 0)
        total             = subtotal + final_shipping

        return {
            "items": items,
            "subtotal": round(subtotal, 2),
            "shipping_cost": final_shipping,
            "free_shipping_threshold": free_threshold,
            "amount_to_free_shipping": round(amount_to_free, 2),
            "shipping_progress": round(shipping_progress, 2),
            "total": round(total, 2)
        }
    finally:
        cursor.close(); conn.close()


# ============================================
# ПРОМОКОДЫ
# ============================================

@app.post("/api/promo-code/apply")
def apply_promo_code(data: ApplyPromoCode, request: Request):
    user_id = get_current_user_id(request)
    conn    = get_db()
    cursor  = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT id FROM carts WHERE user_id=%s", (user_id,))
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
            "SELECT * FROM promo_codes WHERE code = %s AND is_active = TRUE",
            (data.code.upper(),)
        )
        promo = cursor.fetchone()
        if not promo:
            raise HTTPException(status_code=404, detail="Promo code not found")

        now = datetime.utcnow()
        if promo["valid_from"]  and promo["valid_from"]  > now:
            raise HTTPException(status_code=400, detail="Promo code not yet valid")
        if promo["valid_until"] and promo["valid_until"] < now:
            raise HTTPException(status_code=400, detail="Promo code expired")
        if subtotal < float(promo["min_order_amount"]):
            raise HTTPException(status_code=400, detail=f"Minimum order amount is ${promo['min_order_amount']}")
        if promo["usage_limit"] and promo["times_used"] >= promo["usage_limit"]:
            raise HTTPException(status_code=400, detail="Usage limit reached")

        discount_value = float(promo["discount_value"])
        if promo["discount_type"] == "percentage":
            discount = subtotal * (discount_value / 100)
            if promo["max_discount"]:
                discount = min(discount, float(promo["max_discount"]))
        else:
            discount = discount_value

        cursor.execute("SELECT shipping_cost, free_shipping_threshold FROM shipping_settings LIMIT 1")
        settings       = cursor.fetchone()
        shipping_cost  = float(settings["shipping_cost"])           if settings else 10.0
        free_threshold = float(settings["free_shipping_threshold"]) if settings else 2000.0

        final_shipping = 0 if subtotal >= free_threshold else shipping_cost
        total          = subtotal + final_shipping - discount

        return {
            "success": True,
            "code": promo["code"],
            "discount": round(discount, 2),
            "discount_percent": round((discount / subtotal) * 100) if subtotal > 0 else 0,
            "subtotal": round(subtotal, 2),
            "shipping_cost": final_shipping,
            "total": round(total, 2)
        }
    finally:
        cursor.close(); conn.close()
        
# ============================================
# ТРЕКИНГ
# ============================================

class TrackProductView(BaseModel):
    product_id: int


@app.post("/api/track/visit")
def track_visit(request: Request):
    try:
        user_id = get_current_user_id(request)
    except Exception:
        user_id = None

    ip = get_client_ip(request)

    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            """SELECT id FROM site_visits
               WHERE ip = %s
               AND created_at >= NOW() - INTERVAL 30 SECOND""",
            (ip,)
        )
        if cursor.fetchone():
            return {"success": True, "skipped": True}

        cursor.execute(
            "INSERT INTO site_visits (user_id, ip) VALUES (%s, %s)",
            (user_id, ip)
        )
        conn.commit()
    finally:
        cursor.close(); conn.close()
    return {"success": True}

@app.post("/api/track/product-view")
def track_product_view(data: TrackProductView, request: Request):
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
               WHERE ip = %s AND product_id = %s
               AND created_at >= NOW() - INTERVAL 30 SECOND""",
            (ip, data.product_id)
        )
        if cursor.fetchone():
            return {"success": True, "skipped": True}

        cursor.execute(
            "INSERT INTO product_page_views (product_id, user_id, ip) VALUES (%s, %s, %s)",
            (data.product_id, user_id, ip)
        )
        conn.commit()
    finally:
        cursor.close(); conn.close()
    return {"success": True}