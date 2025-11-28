from fastapi import FastAPI, Response, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timedelta
import mysql.connector
import hashlib
import jwt
import os

#cd Magaz\backend
#.\venv\Scripts\activate
#pip install -r .\requirements.txt

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

@app.get("/api-products")
def get_products():
    conn = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM products")
    products = cursor.fetchall()
    cursor.close()
    conn.close()
    return products

# --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

SECRET_KEY = os.getenv("SECRET_KEY", "SUPER_SECRET_KEY")
JWT_ALGORITHM = "HS256"
JWT_HOURS = 24 * 7

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
    )

# --- МОДЕЛИ ---

class UserRegister(BaseModel):
    name: str
    email: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

# --- АУТЕНТИФИКАЦИЯ ---

@app.post("/api/register")
def register(user: UserRegister, response: Response):
    if get_user_by_email(user.email):
        raise HTTPException(status_code=400, detail="Email already exists")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO users (name, email, password_hash) VALUES (%s,%s,%s)",
        (user.name, user.email, hash_password(user.password)),
    )
    conn.commit()

    cursor.execute("SELECT id FROM users WHERE email=%s", (user.email,))
    user_id = cursor.fetchone()[0]
    cursor.close()
    conn.close()

    token = create_token(user_id)
    set_auth_cookie(response, token)
    return {"success": True}

@app.post("/api/login")
def login(user: UserLogin, response: Response):
    db_user = get_user_by_email(user.email)
    if not db_user or hash_password(user.password) != db_user["password_hash"]:
        raise HTTPException(status_code=400, detail="Invalid email or password")

    token = create_token(db_user["id"])
    set_auth_cookie(response, token)
    return {"success": True, "username": db_user["name"]}

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
    response.delete_cookie("authx_token")
    return {"success": True}
