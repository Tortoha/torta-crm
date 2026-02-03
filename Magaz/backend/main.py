from fastapi import FastAPI, Response, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
import mysql.connector
import hashlib
import jwt
import random
import resend

# НАСТРОЙКИ
SECRET_KEY = "d2a9c8f0e5b741a39f6c8d2e1b5a9c3f8e7d6c5b4a3928173645e5f6a7b8c9d0"
JWT_ALGORITHM = "HS256"
JWT_HOURS = 24 * 7

DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "root",
    "database": "crmdb",
}

app = FastAPI()
resend.api_key = "re_AixvxJe9_aQ8UsEwgVTFQjjrcUUMnAi6e"
pending_verifications = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# МОДЕЛИ
class SendCodeRequest(BaseModel):
    email: str
    type: str
    name: str = None
    password: str = None

class VerifyCodeRequest(BaseModel):
    email: str
    code: str

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
        key="authx_token",
        value=token,
        httponly=True,
        max_age=60 * 60 * 24 * 7,
        samesite="lax",
        secure=False,
        path="/",
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
    cursor.close()
    conn.close()
    return user

def get_user_by_id(user_id: int):
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT id, name, email FROM users WHERE id=%s", (user_id,))
    user = cursor.fetchone()
    cursor.close()
    conn.close()
    return user

def send_code_email(email: str, code: int) -> bool:
    try:
        resend.Emails.send({
            "from": "onboarding@resend.dev",
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

# ============================================
# АУТЕНТИФИКАЦИЯ
# ============================================

@app.post("/api/send-code")
def send_code(request: SendCodeRequest):
    email = request.email
    
    if request.type == "register":
        if get_user_by_email(email):
            raise HTTPException(status_code=400, detail="Email already exists")
        if not request.name or not request.password:
            raise HTTPException(status_code=400, detail="Name and password required")
    elif request.type == "login":
        db_user = get_user_by_email(email)
        if not db_user:
            raise HTTPException(status_code=400, detail="User not found")
        if hash_password(request.password) != db_user["password_hash"]:
            raise HTTPException(status_code=400, detail="Invalid password")
    
    code = random.randint(100000, 999999)
    pending_verifications[email] = {
        "code": code,
        "type": request.type,
        "name": request.name,
        "password": request.password,
        "expires": datetime.utcnow() + timedelta(minutes=10)
    }
    
    return {"success": True} if send_code_email(email, code) else HTTPException(status_code=500, detail="Failed to send email")

@app.post("/api/verify-code")
def verify_code(request: VerifyCodeRequest, response: Response):
    email, code = request.email, request.code
    
    if email not in pending_verifications:
        raise HTTPException(status_code=400, detail="Code not found or expired")
    
    pending = pending_verifications[email]
    
    if datetime.utcnow() > pending["expires"]:
        del pending_verifications[email]
        raise HTTPException(status_code=400, detail="Code expired")
    
    if int(code) != pending["code"]:
        raise HTTPException(status_code=400, detail="Invalid code")
    
    conn = get_db()
    cursor = conn.cursor()
    
    if pending["type"] == "register":
        cursor.execute(
            "INSERT INTO users (name, email, password_hash) VALUES (%s,%s,%s)",
            (pending["name"], email, hash_password(pending["password"]))
        )
        conn.commit()
        cursor.execute("SELECT id FROM users WHERE email=%s", (email,))
        user_id = cursor.fetchone()[0]
    else:
        user_id = get_user_by_email(email)["id"]
    
    cursor.close()
    conn.close()
    
    token = create_token(user_id)
    set_auth_cookie(response, token)
    del pending_verifications[email]
    
    return {"success": True}

@app.post("/api/resend-code")
def resend_code(request: dict):
    email = request.get("email")
    if email not in pending_verifications:
        raise HTTPException(status_code=400, detail="No pending verification")
    
    code = random.randint(100000, 999999)
    pending_verifications[email]["code"] = code
    pending_verifications[email]["expires"] = datetime.utcnow() + timedelta(minutes=10)
    
    return {"success": True} if send_code_email(email, code) else HTTPException(status_code=500, detail="Failed to send email")

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
# ПРОДУКТЫ
# ============================================

@app.get("/api-products")
def get_products():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("SELECT * FROM products")
    products = cursor.fetchall()
    if not products:
        cursor.close()
        conn.close()
        return []

    product_ids = [p["id"] for p in products]
    format_ids = ",".join(["%s"] * len(product_ids))

    # Получаем все связанные данные одним запросом
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
            "stock_quantity": s["stock_quantity"], "sold_quantity": s["sold_quantity"]
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

    # Формирование результата
    for p in products:
        p["variations"] = variations_by_product.get(p["id"], [])
        p["reviews"] = reviews_by_product.get(p["id"], [])

    return products

# ============================================
# КОРЗИНА
# ============================================

@app.post("/api/cart/add")
def add_to_cart(item: AddToCart, request: Request):
    user_id = get_current_user_id(request)
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
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
        cursor.close()
        conn.close()

@app.get("/api/cart")
def get_cart(request: Request):
    user_id = get_current_user_id(request)
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    cursor.execute("SELECT id FROM carts WHERE user_id=%s", (user_id,))
    cart = cursor.fetchone()
    
    if not cart:
        cursor.close()
        conn.close()
        return []
    
    cursor.execute(
        """SELECT ci.id as cart_item_id, ci.quantity, ci.product_id, ci.variation_id, ci.size_id,
           p.title, p.price, pv.variation_name, pv.image_url, ps.size_name
           FROM cart_items ci
           JOIN products p ON ci.product_id = p.id
           LEFT JOIN product_variations pv ON ci.variation_id = pv.id
           LEFT JOIN product_sizes ps ON ci.size_id = ps.id
           WHERE ci.cart_id = %s""",
        (cart["id"],)
    )
    items = cursor.fetchall()
    cursor.close()
    conn.close()
    return items

@app.delete("/api/cart/{cart_item_id}")
def remove_from_cart(cart_item_id: int, request: Request):
    user_id = get_current_user_id(request)
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    cursor.execute(
        """SELECT ci.id FROM cart_items ci
           JOIN carts c ON ci.cart_id = c.id
           WHERE ci.id=%s AND c.user_id=%s""",
        (cart_item_id, user_id)
    )
    
    if not cursor.fetchone():
        cursor.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Cart item not found")
    
    cursor.execute("DELETE FROM cart_items WHERE id=%s", (cart_item_id,))
    conn.commit()
    cursor.close()
    conn.close()
    return {"success": True}

@app.put("/api/cart/{cart_item_id}")
def update_cart_quantity(cart_item_id: int, data: UpdateCartQuantity, request: Request):
    user_id = get_current_user_id(request)
    if data.quantity < 1:
        raise HTTPException(status_code=400, detail="Quantity must be at least 1")
    
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    cursor.execute(
        """SELECT ci.id FROM cart_items ci
           JOIN carts c ON ci.cart_id = c.id
           WHERE ci.id=%s AND c.user_id=%s""",
        (cart_item_id, user_id)
    )
    
    if not cursor.fetchone():
        cursor.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Cart item not found")
    
    cursor.execute("UPDATE cart_items SET quantity=%s WHERE id=%s", (data.quantity, cart_item_id))
    conn.commit()
    cursor.close()
    conn.close()
    return {"success": True}

@app.delete("/api/cart/clear")
def clear_cart(request: Request):
    user_id = get_current_user_id(request)
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    cursor.execute("SELECT id FROM carts WHERE user_id=%s", (user_id,))
    cart = cursor.fetchone()
    
    if cart:
        cursor.execute("DELETE FROM cart_items WHERE cart_id=%s", (cart["id"],))
        conn.commit()
    
    cursor.close()
    conn.close()
    return {"success": True}

# ============================================
# ИЗБРАННОЕ
# ============================================

@app.post("/api/favorites/add")
def add_to_favorites(item: AddToFavorites, request: Request):
    user_id = get_current_user_id(request)
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute("INSERT INTO favorites (user_id, product_id) VALUES (%s, %s)", (user_id, item.product_id))
        conn.commit()
    except mysql.connector.IntegrityError:
        pass
    finally:
        cursor.close()
        conn.close()
    
    return {"success": True}

@app.get("/api/favorites")
def get_favorites(request: Request):
    user_id = get_current_user_id(request)
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    cursor.execute(
        """SELECT f.*, p.title, p.price
           FROM favorites f
           JOIN products p ON f.product_id = p.id
           WHERE f.user_id = %s""",
        (user_id,)
    )
    items = cursor.fetchall()
    cursor.close()
    conn.close()
    return items

@app.delete("/api/favorites/{product_id}")
def remove_from_favorites(product_id: int, request: Request):
    user_id = get_current_user_id(request)
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("DELETE FROM favorites WHERE product_id=%s AND user_id=%s", (product_id, user_id))
    conn.commit()
    cursor.close()
    conn.close()
    return {"success": True}

# ============================================
# ОТЗЫВЫ
# ============================================

@app.post("/api/reviews/add")
def add_review(review: AddReview, request: Request):
    user_id = get_current_user_id(request)
    
    if not 1 <= review.rating <= 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
    
    conn = get_db()
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
        cursor.close()
        conn.close()

@app.get("/api/reviews/can-review/{product_id}")
def can_user_review(product_id: int, request: Request):
    try:
        user_id = get_current_user_id(request)
    except:
        return {"can_review": False, "reason": "not_authenticated"}
    
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    cursor.execute("SELECT id FROM product_reviews WHERE product_id=%s AND user_id=%s", (product_id, user_id))
    if cursor.fetchone():
        cursor.close()
        conn.close()
        return {"can_review": False, "reason": "already_reviewed"}
    
    cursor.execute(
        """SELECT DISTINCT oh.id 
           FROM order_history oh
           JOIN order_items oi ON oh.id = oi.order_id
           WHERE oh.user_id = %s AND oi.product_id = %s AND oh.status IN ('delivered', 'returned')
           LIMIT 1""",
        (user_id, product_id)
    )
    can_review = cursor.fetchone() is not None
    cursor.close()
    conn.close()
    
    return {"can_review": can_review} if can_review else {"can_review": False, "reason": "not_purchased"}

@app.delete("/api/reviews/{review_id}")
def delete_review(review_id: int, request: Request):
    user_id = get_current_user_id(request)
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    cursor.execute("SELECT user_id FROM product_reviews WHERE id=%s", (review_id,))
    review = cursor.fetchone()
    
    if not review:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Review not found")
    
    if review["user_id"] != user_id:
        cursor.close()
        conn.close()
        raise HTTPException(status_code=403, detail="Not authorized")
    
    cursor.execute("DELETE FROM product_reviews WHERE id=%s", (review_id,))
    conn.commit()
    cursor.close()
    conn.close()
    return {"success": True}

@app.get("/api/pages/favorites")
def get_favorites(request: Request):
    user_id = get_current_user_id(request)
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    cursor.execute("SELECT product_id FROM favorites WHERE user_id = %s", (user_id,))
    favorites = cursor.fetchall()
    cursor.close()
    conn.close()
    
    return [f["product_id"] for f in favorites]