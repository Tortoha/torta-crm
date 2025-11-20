from fastapi import FastAPI, Response, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import mysql.connector
from pydantic import BaseModel
from dotenv import load_dotenv
import jwt
from datetime import datetime, timedelta
import hashlib
import os

load_dotenv()
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
    'host': 'localhost',
    'user': 'root',
    'password': 'root',
    'database': 'crmdb'
}

@app.get("/api-products")
def get_products():
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM products")
    result = cursor.fetchall()
    cursor.close()
    conn.close()
    return result

SECRET_KEY = os.environ.get("SECRET_KEY", "SUPER_SECRET_KEY")
JWT_ALGORITHM = "HS256"
JWT_EXP = 24

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password: str, hash_: str) -> bool:
    return hash_password(password) == hash_

def create_jwt(user_id: int) -> str:
    payload = {
        "sub": str(user_id),  # ИСПРАВЛЕНО!
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXP)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)

class UserRegister(BaseModel):
    name: str
    email: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

@app.post("/api/register")
def register(user: UserRegister, response: Response):
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor()
    
    cursor.execute("SELECT 1 FROM users WHERE email=%s", (user.email,))
    if cursor.fetchone():
        cursor.close()
        conn.close()
        raise HTTPException(status_code=400, detail="Email already exists")
    
    password_hash = hash_password(user.password)
    cursor.execute(
        "INSERT INTO users (name, email, password_hash) VALUES (%s,%s,%s)",
        (user.name, user.email, password_hash)
    )
    conn.commit()
    
    cursor.execute("SELECT id FROM users WHERE email=%s", (user.email,))
    user_id = cursor.fetchone()[0]
    cursor.close()
    conn.close()
    
    token = create_jwt(user_id)
    response.set_cookie(
        key="authx_token",
        value=token,
        httponly=True,
        max_age=60*60*24,
        samesite="lax",
        secure=False
    )
    return {"success": True}

@app.post("/api/login")
def login(user: UserLogin, response: Response):
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor(dictionary=True)
    
    cursor.execute("SELECT * FROM users WHERE email=%s", (user.email,))
    db_user = cursor.fetchone()
    cursor.close()
    conn.close()
    
    if not db_user or not verify_password(user.password, db_user["password_hash"]):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    
    token = create_jwt(db_user["id"])
    response.set_cookie(
        key="authx_token",
        value=token,
        httponly=True,
        max_age=60*60*24,
        samesite="lax",
        secure=False
    )
    return {"success": True, "username": db_user["name"]}

@app.get("/api/me")
def get_current_user(request: Request):
    authx_token = request.cookies.get("authx_token")
    
    if not authx_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    try:
        payload = jwt.decode(authx_token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id = int(payload.get("sub"))  # ИСПРАВЛЕНО!
        
        conn = mysql.connector.connect(**db_config)
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id, name, email FROM users WHERE id=%s", (user_id,))
        user = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        
        return {"name": user["name"], "email": user["email"]}
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(key="authx_token")
    return {"success": True}