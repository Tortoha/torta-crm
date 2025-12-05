from fastapi import FastAPI, Response, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timedelta
import mysql.connector
import hashlib
import jwt
import random
import resend

#cd Magaz\backend
#.\venv\Scripts\activate
#pip install -r .\requirements.txt

SECRET_KEY = "d2a9c8f0e5b741a39f6c8d2e1b5a9c3f8e7d6c5b4a3928173645e5f6a7b8c9d0"
JWT_ALGORITHM = "HS256"
JWT_HOURS = 24 * 7

app = FastAPI()
resend.api_key = "re_AixvxJe9_aQ8UsEwgVTFQjjrcUUMnAi6e"
pending_verifications = {}

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
    
    # Генерируем новый код
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
    response.delete_cookie("authx_token")
    return {"success": True}
