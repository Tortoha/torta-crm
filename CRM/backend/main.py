from fastapi import FastAPI, Response, HTTPException, Request, Depends
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

SECRET_KEY      = "crm_u7b3f9e2d8c1a4f6e0b5d3a7c9f2e8d4b1c6a0e9f7d3b5c8a2e4d0f6b9c3e7a1"
JWT_ALGORITHM   = "HS256"
JWT_HOURS       = 24 * 7

RESEND_API_KEY          = "re_fqgeUf1L_NnvvDEmuLumrE2pkLGLv7wUC"
RESEND_FROM             = "onboarding@resend.dev"
FRONTEND_URL            = "http://localhost:5174"
MAX_FAILED_ATTEMPTS     = 5
BLOCK_MINUTES           = 10
CODE_TTL_MINUTES        = 10
RESEND_COOLDOWN_SECONDS = 60
RESET_TTL_MINUTES       = 30

DB_CONFIG = {
    "host":     "localhost",
    "user":     "root",
    "password": "root",
    "database": "crmdb",
}

app = FastAPI()
resend.api_key = RESEND_API_KEY

pending_verifications = {}  # key -> { code, type, name, password, expires, next_resend_at }
login_attempts        = {}  # "ip:..." / "email:..." -> { count, blocked_until }
password_reset_tokens = {}  # sha256(token) -> { email, expires }

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# МОДЕЛИ
# ============================================

class SendCodeRequest(BaseModel):
    email:    str
    type:     str
    name:     str = None
    password: str = None

class VerifyCodeRequest(BaseModel):
    email: str
    code:  str

class ResendCodeRequest(BaseModel):
    email: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token:           str
    password:        str
    repeat_password: str

# ============================================
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ============================================

def get_db():
    return mysql.connector.connect(**DB_CONFIG)

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def create_token(user_id: int) -> str:
    payload = {
        "sub":  str(user_id),
        "type": "crm",
        "exp":  datetime.utcnow() + timedelta(hours=JWT_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)

def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="crm_token", value=token,
        httponly=True, max_age=60 * 60 * 24 * 7,
        samesite="lax", secure=False, path="/",
    )

def get_current_user(request: Request) -> dict:
    token = request.cookies.get("crm_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "crm":
            raise HTTPException(status_code=401, detail="Invalid token")
        user_id = int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute(
        "SELECT id, name, email, role FROM crm_users WHERE id = %s AND is_active = 1",
        (user_id,)
    )
    user = cursor.fetchone()
    cursor.close(); conn.close()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def get_crm_user_by_email(email: str):
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM crm_users WHERE email = %s", (email,))
    user = cursor.fetchone()
    cursor.close(); conn.close()
    return user

def send_code_email(email: str, code: int) -> bool:
    try:
        resend.Emails.send({
            "from":    RESEND_FROM,
            "to":      email,
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
            "from":    RESEND_FROM,
            "to":      email,
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
        if get_crm_user_by_email(email):
            fail("Email already exists")
        if not request.name or not request.password:
            fail("Name and password required")

    elif request.type == "login":
        db_user = get_crm_user_by_email(email)
        if not db_user:
            fail("Invalid email or password")
        if not db_user.get("is_active"):
            fail("Account is disabled")
        if hash_password(request.password or "") != db_user["password"]:
            fail("Invalid email or password")
    else:
        raise HTTPException(status_code=400, detail="Invalid type")

    code   = random.randint(100000, 999999)
    pv_key = email
    pending_verifications[pv_key] = {
        "code":           str(code),
        "type":           request.type,
        "name":           request.name,
        "password":       request.password,
        "expires":        now + timedelta(minutes=CODE_TTL_MINUTES),
        "next_resend_at": now + timedelta(seconds=RESEND_COOLDOWN_SECONDS),
    }

    if not send_code_email(email, code):
        del pending_verifications[pv_key]
        raise HTTPException(status_code=500, detail="Failed to send email")

    for key in [f"ip:{ip}", f"email:{email}"]:
        login_attempts.pop(key, None)

    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.post("/api/verify-code")
def verify_code(request: VerifyCodeRequest, response: Response, req: Request):
    email  = request.email.lower().strip()
    code   = (request.code or "").replace(" ", "").strip()
    ip     = get_client_ip(req)
    now    = datetime.utcnow()
    pv_key = email

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
                "INSERT INTO crm_users (name, email, password, role) VALUES (%s, %s, %s, 'owner')",
                (pending["name"], email, hash_password(pending["password"]))
            )
            conn.commit()
            user_id = cursor.lastrowid
            # Создаём настройки по умолчанию
            cursor.execute(
                "INSERT INTO crm_settings (crm_user_id) VALUES (%s)",
                (user_id,)
            )
            conn.commit()
        else:
            db_user = get_crm_user_by_email(email)
            user_id = db_user["id"]
            cursor.execute(
                "UPDATE crm_users SET last_login_at = NOW() WHERE id = %s",
                (user_id,)
            )
            conn.commit()
    finally:
        cursor.close(); conn.close()

    token = create_token(user_id)
    set_auth_cookie(response, token)
    del pending_verifications[pv_key]

    for key in [f"ip:{ip}", f"email:{email}"]:
        login_attempts.pop(key, None)

    return {"success": True}


@app.post("/api/resend-code")
def resend_code_endpoint(request: ResendCodeRequest):
    email  = request.email.lower().strip()
    now    = datetime.utcnow()
    pv_key = email

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

    if not send_code_email(email, code):
        raise HTTPException(status_code=500, detail="Failed to send email")

    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.get("/api/me")
def get_me(user: dict = Depends(get_current_user)):
    return user


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie("crm_token", path="/")
    return {"success": True}

# ============================================
# ВОССТАНОВЛЕНИЕ ПАРОЛЯ
# ============================================

@app.post("/api/forgot-password")
def forgot_password(request: ForgotPasswordRequest):
    email = request.email.lower().strip()
    user  = get_crm_user_by_email(email)

    if not user:
        return {"success": True, "message": "If the account exists, a reset email has been sent."}

    # Удаляем старые токены для этого email
    to_delete = [t for t, d in password_reset_tokens.items() if d["email"] == email]
    for t in to_delete:
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
            "UPDATE crm_users SET password = %s WHERE email = %s",
            (hash_password(password), token_data["email"])
        )
        conn.commit()
    finally:
        cursor.close(); conn.close()

    del password_reset_tokens[token_hash]
    return {"success": True}
