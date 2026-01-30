from fastapi import FastAPI, Response, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timedelta
import mysql.connector
import hashlib
import jwt
import random
import resend


SECRET_KEY = "d2a9c8f0e5b741a39f6c8d2e1b5a9c3f8e7d6c5b4a3928173645e5f6a7b8c9d0"
JWT_ALGORITHM = "HS256"
JWT_HOURS = 24 * 7


app = FastAPI()
resend.api_key = "re_AixvxJe9_aQ8UsEwgVTFQjjrcUUMnAi6e"
pending_verifications = {}


# ИСПРАВЛЕННЫЕ CORS НАСТРОЙКИ
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# Настройки подключения к базе
db_config = {
    "host": "localhost",
    "user": "root",
    "password": "root",
    "database": "crmdb",
}


def get_db():
    return mysql.connector.connect(**db_config)


# --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(hours=JWT_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)


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


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="authx_token",
        value=token,
        httponly=True,
        max_age=60 * 60 * 24 * 7,
        samesite="lax",
        secure=False,
        path="/",
    )


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


# --- МОДЕЛИ ---


class UserRegister(BaseModel):
    name: str
    email: str
    password: str


class UserLogin(BaseModel):
    email: str
    password: str


class SendCodeRequest(BaseModel):
    email: str
    type: str
    name: str = None
    password: str = None


class VerifyCodeRequest(BaseModel):
    email: str
    code: str


from typing import Optional


class AddToCart(BaseModel):
    product_id: int
    variation_id: Optional[int] = None
    size_id: Optional[int] = None
    quantity: int = 1


class AddToFavorites(BaseModel):
    product_id: int


class UpdateCartQuantity(BaseModel):
    quantity: int


# --- PRODUCTS ---


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

    cursor.execute(
        f"SELECT * FROM product_variations WHERE product_id IN ({format_ids})",
        product_ids
    )
    variations = cursor.fetchall()

    cursor.execute(
        f"SELECT * FROM product_sizes WHERE product_id IN ({format_ids})",
        product_ids
    )
    sizes = cursor.fetchall()

    cursor.execute(
        f"""
        SELECT 
            pr.product_id,
            pr.rating,
            pr.comment,
            pr.created_at,
            u.name AS user_name
        FROM product_reviews pr
        JOIN users u ON pr.user_id = u.id
        WHERE pr.product_id IN ({format_ids})
        """,
        product_ids
    )
    reviews = cursor.fetchall()

    cursor.close()
    conn.close()

    sizes_by_variation = {}
    for s in sizes:
        sizes_by_variation.setdefault(s["variation_id"], []).append({
            "id": s["id"],
            "size_name": s["size_name"],
            "stock_quantity": s["stock_quantity"],
            "sold_quantity": s["sold_quantity"],
        })

    variations_by_product = {}
    for v in variations:
        v_id = v["id"]
        pid = v["product_id"]
        variation_obj = {
            "id": v_id,
            "variation_name": v["variation_name"],
            "image": v["image_url"],
            "sizes": sizes_by_variation.get(v_id, []),
        }
        variations_by_product.setdefault(pid, []).append(variation_obj)

    reviews_by_product = {}
    for r in reviews:
        pid = r["product_id"]
        reviews_by_product.setdefault(pid, []).append({
            "rating": r["rating"],
            "comment": r["comment"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "user_name": r["user_name"],
        })

    result = []
    for p in products:
        pid = p["id"]
        product_obj = dict(p)
        product_obj["variations"] = variations_by_product.get(pid, [])
        product_obj["reviews"] = reviews_by_product.get(pid, [])
        result.append(product_obj)

    return result


# --- ОТПРАВКА КОДА ---


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
    
    if send_code_email(email, code):
        return {"success": True, "message": "Code sent"}
    else:
        raise HTTPException(status_code=500, detail="Failed to send email")


# --- ПРОВЕРКА КОДА ---


@app.post("/api/verify-code")
def verify_code(request: VerifyCodeRequest, response: Response):
    email = request.email
    code = request.code
    
    if email not in pending_verifications:
        raise HTTPException(status_code=400, detail="Code not found or expired")
    
    pending = pending_verifications[email]
    
    if datetime.utcnow() > pending["expires"]:
        del pending_verifications[email]
        raise HTTPException(status_code=400, detail="Code expired")
    
    if int(code) != pending["code"]:
        raise HTTPException(status_code=400, detail="Invalid code")
    
    if pending["type"] == "register":
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO users (name, email, password_hash) VALUES (%s,%s,%s)",
            (pending["name"], email, hash_password(pending["password"])),
        )
        conn.commit()
        
        cursor.execute("SELECT id FROM users WHERE email=%s", (email,))
        user_id = cursor.fetchone()[0]
        cursor.close()
        conn.close()
        
        token = create_token(user_id)
        set_auth_cookie(response, token)
    
    elif pending["type"] == "login":
        db_user = get_user_by_email(email)
        token = create_token(db_user["id"])
        set_auth_cookie(response, token)
    
    del pending_verifications[email]
    
    return {"success": True}


# --- ПОВТОРНАЯ ОТПРАВКА КОДА ---


@app.post("/api/resend-code")
def resend_code(request: dict):
    email = request.get("email")
    
    if email not in pending_verifications:
        raise HTTPException(status_code=400, detail="No pending verification")
    
    pending = pending_verifications[email]
    
    code = random.randint(100000, 999999)
    pending["code"] = code
    pending["expires"] = datetime.utcnow() + timedelta(minutes=10)
    
    if send_code_email(email, code):
        return {"success": True, "message": "Code resent"}
    else:
        raise HTTPException(status_code=500, detail="Failed to send email")


# --- АУТЕНТИФИКАЦИЯ ---


@app.get("/api/me")
def get_current_user(request: Request):
    token = request.cookies.get("authx_token")
    
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user = get_user_by_id(int(payload["sub"]))
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return {"name": user["name"], "email": user["email"]}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie("authx_token", path="/")
    return {"success": True}


# --- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ПОЛУЧЕНИЯ USER_ID ---


def get_current_user_id(request: Request) -> int:
    token = request.cookies.get("authx_token")
    
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail="Invalid token")


# ============================================
# ENDPOINTS ДЛЯ КОРЗИНЫ (ИСПРАВЛЕННЫЕ ДЛЯ 2 ТАБЛИЦ)
# ============================================


@app.post("/api/cart/add")
def add_to_cart(item: AddToCart, request: Request):
    print("=" * 50)
    print("ADD TO CART")
    user_id = get_current_user_id(request)
    print(f"User ID: {user_id}")
    print(f"Product: {item.product_id}, Variation: {item.variation_id}, Size: {item.size_id}")
    
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    try:
        # 1. Находим или создаем корзину пользователя
        cursor.execute("SELECT id FROM carts WHERE user_id=%s", (user_id,))
        cart = cursor.fetchone()
        
        if not cart:
            # Создаем новую корзину
            cursor.execute("INSERT INTO carts (user_id) VALUES (%s)", (user_id,))
            conn.commit()
            cart_id = cursor.lastrowid
            print(f"Created new cart: {cart_id}")
        else:
            cart_id = cart["id"]
            print(f"Found existing cart: {cart_id}")
        
        # 2. Проверяем, есть ли уже такой товар в корзине
        cursor.execute(
            """SELECT id, quantity FROM cart_items 
               WHERE cart_id=%s AND product_id=%s AND variation_id=%s AND size_id=%s""",
            (cart_id, item.product_id, item.variation_id, item.size_id)
        )
        existing_item = cursor.fetchone()
        
        if existing_item:
            # Обновляем количество
            new_quantity = existing_item["quantity"] + item.quantity
            cursor.execute(
                "UPDATE cart_items SET quantity=%s WHERE id=%s",
                (new_quantity, existing_item["id"])
            )
            print(f"Updated item quantity to {new_quantity}")
        else:
            # Добавляем новый товар
            cursor.execute(
                """INSERT INTO cart_items (cart_id, product_id, variation_id, size_id, quantity)
                   VALUES (%s, %s, %s, %s, %s)""",
                (cart_id, item.product_id, item.variation_id, item.size_id, item.quantity)
            )
            print(f"Added new item to cart")
        
        conn.commit()
        print("SUCCESS")
        print("=" * 50)
        
    except Exception as e:
        print(f"DATABASE ERROR: {e}")
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    finally:
        cursor.close()
        conn.close()
    
    return {"success": True, "message": "Item added to cart"}


@app.get("/api/cart")
def get_cart(request: Request):
    user_id = get_current_user_id(request)
    
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    try:
        # 1. Находим корзину пользователя
        cursor.execute("SELECT id FROM carts WHERE user_id=%s", (user_id,))
        cart = cursor.fetchone()
        
        if not cart:
            # Корзина пустая
            return []
        
        # 2. Получаем все товары из корзины с информацией о продукте
        cursor.execute(
            """SELECT 
                ci.id as cart_item_id,
                ci.quantity,
                ci.product_id,
                ci.variation_id,
                ci.size_id,
                p.title,
                p.price,
                p.description,
                pv.variation_name,
                pv.image_url,
                ps.size_name
               FROM cart_items ci
               JOIN products p ON ci.product_id = p.id
               LEFT JOIN product_variations pv ON ci.variation_id = pv.id
               LEFT JOIN product_sizes ps ON ci.size_id = ps.id
               WHERE ci.cart_id = %s""",
            (cart["id"],)
        )
        items = cursor.fetchall()
        
        return items
        
    finally:
        cursor.close()
        conn.close()


@app.delete("/api/cart/{cart_item_id}")
def remove_from_cart(cart_item_id: int, request: Request):
    user_id = get_current_user_id(request)
    
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    try:
        # Проверяем, что этот cart_item принадлежит корзине пользователя
        cursor.execute(
            """SELECT ci.id FROM cart_items ci
               JOIN carts c ON ci.cart_id = c.id
               WHERE ci.id=%s AND c.user_id=%s""",
            (cart_item_id, user_id)
        )
        item = cursor.fetchone()
        
        if not item:
            raise HTTPException(status_code=404, detail="Cart item not found")
        
        # Удаляем товар из корзины
        cursor.execute("DELETE FROM cart_items WHERE id=%s", (cart_item_id,))
        conn.commit()
        
        return {"success": True, "message": "Item removed from cart"}
        
    finally:
        cursor.close()
        conn.close()


@app.put("/api/cart/{cart_item_id}")
def update_cart_quantity(cart_item_id: int, data: UpdateCartQuantity, request: Request):
    user_id = get_current_user_id(request)
    
    if data.quantity < 1:
        raise HTTPException(status_code=400, detail="Quantity must be at least 1")
    
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    try:
        # Проверяем права доступа
        cursor.execute(
            """SELECT ci.id FROM cart_items ci
               JOIN carts c ON ci.cart_id = c.id
               WHERE ci.id=%s AND c.user_id=%s""",
            (cart_item_id, user_id)
        )
        item = cursor.fetchone()
        
        if not item:
            raise HTTPException(status_code=404, detail="Cart item not found")
        
        # Обновляем количество
        cursor.execute(
            "UPDATE cart_items SET quantity=%s WHERE id=%s",
            (data.quantity, cart_item_id)
        )
        conn.commit()
        
        return {"success": True, "message": "Quantity updated"}
        
    finally:
        cursor.close()
        conn.close()


@app.delete("/api/cart/clear")
def clear_cart(request: Request):
    user_id = get_current_user_id(request)
    
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    try:
        # Находим корзину
        cursor.execute("SELECT id FROM carts WHERE user_id=%s", (user_id,))
        cart = cursor.fetchone()
        
        if cart:
            # Удаляем все товары из корзины
            cursor.execute("DELETE FROM cart_items WHERE cart_id=%s", (cart["id"],))
            conn.commit()
        
        return {"success": True, "message": "Cart cleared"}
        
    finally:
        cursor.close()
        conn.close()


# ============================================
# ENDPOINTS ДЛЯ ИЗБРАННОГО
# ============================================


@app.post("/api/favorites/add")
def add_to_favorites(item: AddToFavorites, request: Request):
    user_id = get_current_user_id(request)
    
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute(
            "INSERT INTO favorites (user_id, product_id) VALUES (%s, %s)",
            (user_id, item.product_id)
        )
        conn.commit()
    except mysql.connector.IntegrityError:
        # Уже в избранном
        pass
    
    cursor.close()
    conn.close()
    
    return {"success": True}


@app.get("/api/favorites")
def get_favorites(request: Request):
    user_id = get_current_user_id(request)
    
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    
    cursor.execute(
        """SELECT f.*, p.title, p.price, p.description
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
    
    cursor.execute(
        "DELETE FROM favorites WHERE product_id=%s AND user_id=%s",
        (product_id, user_id)
    )
    
    conn.commit()
    cursor.close()
    conn.close()
    
    return {"success": True}