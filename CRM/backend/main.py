from fastapi import FastAPI, Response, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timedelta
import mysql.connector, hashlib, secrets, jwt, random, resend


# ════════════════════════════════════════════
# КОНФИГ
# ════════════════════════════════════════════

SECRET_KEY   = "crm_u7b3f9e2d8c1a4f6e0b5d3a7c9f2e8d4b1c6a0e9f7d3b5c8a2e4d0f6b9c3e7a1"
ALGORITHM    = "HS256"
JWT_HOURS    = 24 * 7
FRONTEND_URL = "http://localhost:5174"
DB_CONFIG    = {"host": "localhost", "user": "root", "password": "root", "database": "crmdb"}

RESEND_API_KEY          = "re_fqgeUf1L_NnvvDEmuLumrE2pkLGLv7wUC"
RESEND_FROM             = "onboarding@resend.dev"
MAX_FAILED_ATTEMPTS     = 5
BLOCK_MINUTES           = 10
CODE_TTL_MINUTES        = 10
RESEND_COOLDOWN_SECONDS = 60
RESET_TTL_MINUTES       = 30

app = FastAPI()
resend.api_key = RESEND_API_KEY

# In-memory хранилища
pending_verifications = {}
login_attempts        = {}
password_reset_tokens = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# ════════════════════════════════════════════
# МОДЕЛИ
# ════════════════════════════════════════════

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

class CreateApiKeyRequest(BaseModel):
    name: str

class SwitchApiKeyRequest(BaseModel):
    api_key_id: int

class CreateRoleRequest(BaseModel):
    name: str

class UpdateMemberRoleRequest(BaseModel):
    crm_user_id: int; crm_role_id: int

class CreateInviteRequest(BaseModel):
    crm_role_id: int; expires_hours: int = None; max_uses: int = None

# ════════════════════════════════════════════
# ФУНКЦИИ
# ════════════════════════════════════════════

def get_db():
    return mysql.connector.connect(**DB_CONFIG)

def db_one(sql: str, params: tuple = ()):
    conn = get_db()
    cur  = conn.cursor(dictionary=True)
    cur.execute(sql, params)
    row = cur.fetchone()
    cur.close(); conn.close()
    return row

def db_all(sql: str, params: tuple = ()):
    conn = get_db()
    cur  = conn.cursor(dictionary=True)
    cur.execute(sql, params)
    rows = cur.fetchall()
    cur.close(); conn.close()
    return rows

def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def get_ip(req: Request) -> str:
    fwd = req.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (req.client.host if req.client else "unknown")

def make_token(user_id: int) -> str:
    return jwt.encode(
        {"sub": str(user_id), "type": "crm", "exp": datetime.utcnow() + timedelta(hours=JWT_HOURS)},
        SECRET_KEY, algorithm=ALGORITHM,
    )

def set_cookie(response: Response, token: str):
    response.set_cookie("crm_token", token, httponly=True,
                        max_age=60*60*24*7, samesite="lax", secure=False, path="/")

def get_current_user(request: Request) -> dict:
    token = request.cookies.get("crm_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "crm":
            raise HTTPException(401, "Invalid token")
        user_id = int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    user = db_one("SELECT id, name, email, role FROM crm_users WHERE id = %s AND is_active = 1", (user_id,))
    if not user:
        raise HTTPException(401, "User not found")
    return user

def check_rate_limit(keys: list, now: datetime):
    for key in keys:
        s = login_attempts.get(key)
        if s and s.get("blocked_until") and now < s["blocked_until"]:
            left = int((s["blocked_until"] - now).total_seconds())
            raise HTTPException(429, f"Too many attempts. Retry in {left}s.")

def record_fail(keys: list, now: datetime):
    for key in keys:
        s = login_attempts.get(key, {"count": 0, "blocked_until": None})
        s["count"] += 1
        if s["count"] >= MAX_FAILED_ATTEMPTS:
            s = {"count": 0, "blocked_until": now + timedelta(minutes=BLOCK_MINUTES)}
            login_attempts[key] = s
            left = int((s["blocked_until"] - now).total_seconds())
            raise HTTPException(429, f"Too many attempts. Retry in {left}s.")
        login_attempts[key] = s

def require_owner(user: dict, api_key_id: int):
    if not db_one("SELECT id FROM crm_api_keys WHERE id = %s AND crm_user_id = %s",
                  (api_key_id, user["id"])):
        raise HTTPException(403, "Only project owner can do this")

def active_key_id(user_id: int) -> int:
    row = db_one("SELECT active_api_key_id FROM crm_users WHERE id = %s", (user_id,))
    if not row or not row["active_api_key_id"]:
        raise HTTPException(400, "No active API key selected")
    return row["active_api_key_id"]

def gen_api_key() -> str:
    raw = secrets.token_bytes(32)
    ts  = str(datetime.utcnow().timestamp()).encode()
    return hashlib.sha256(raw + ts).hexdigest()

# ── Email ─────────────────────────────────────────────────────
def send_code_email(email: str, code: int) -> bool:
    try:
        resend.Emails.send({
            "from": RESEND_FROM, "to": email, "subject": "Verification Code",
            "html": f"""<div style="font-family:Arial;text-align:center;padding:40px">
                <h1>Your verification code</h1>
                <p style="font-size:36px;font-weight:bold;letter-spacing:8px">
                    {str(code)[:3]} {str(code)[3:]}</p>
                <p style="color:#666">Expires in 10 minutes.</p></div>"""
        })
        return True
    except Exception as e:
        print(f"Email error: {e}"); return False

def send_reset_email(email: str, token: str) -> bool:
    url = f"{FRONTEND_URL}/reset-password/{token}"
    try:
        resend.Emails.send({
            "from": RESEND_FROM, "to": email, "subject": "Password Reset",
            "html": f"""<div style="font-family:Arial;text-align:center;padding:40px">
                <h1>Reset your password</h1>
                <a href="{url}" style="display:inline-block;margin-top:24px;padding:14px 32px;
                    background:#0071e3;color:#fff;text-decoration:none;border-radius:16px;
                    font-size:18px;font-weight:600">Reset password</a>
                <p style="margin-top:24px;color:#999;font-size:12px">{url}</p></div>"""
        })
        return True
    except Exception as e:
        print(f"Reset email error: {e}"); return False

# ════════════════════════════════════════════
# АУТЕНТИФИКАЦИЯ
# ════════════════════════════════════════════

@app.post("/api/send-code")
def send_code(request: SendCodeRequest, req: Request):
    email = request.email.lower().strip()
    ip    = get_ip(req)
    now   = datetime.utcnow()
    keys  = [f"ip:{ip}", f"email:{email}"]
    check_rate_limit(keys, now)

    existing = db_one("SELECT * FROM crm_users WHERE email = %s", (email,))

    if request.type == "register":
        if existing:
            record_fail(keys, now); raise HTTPException(400, "Email already exists")
        if not request.name or not request.password:
            raise HTTPException(400, "Name and password required")
    elif request.type == "login":
        if not existing or not existing.get("is_active"):
            record_fail(keys, now); raise HTTPException(400, "Invalid email or password")
        if hash_pw(request.password or "") != existing["password"]:
            record_fail(keys, now); raise HTTPException(400, "Invalid email or password")
    else:
        raise HTTPException(400, "Invalid type")

    code = random.randint(100000, 999999)
    pending_verifications[email] = {
        "code": str(code), "type": request.type,
        "name": request.name, "password": request.password,
        "expires": now + timedelta(minutes=CODE_TTL_MINUTES),
        "next_resend_at": now + timedelta(seconds=RESEND_COOLDOWN_SECONDS),
    }
    if not send_code_email(email, code):
        del pending_verifications[email]
        raise HTTPException(500, "Failed to send email")

    for k in keys: login_attempts.pop(k, None)
    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.post("/api/verify-code")
def verify_code(request: VerifyCodeRequest, response: Response, req: Request):
    email = request.email.lower().strip()
    code  = (request.code or "").replace(" ", "").strip()
    ip    = get_ip(req)
    now   = datetime.utcnow()
    keys  = [f"ip:{ip}", f"email:{email}"]
    check_rate_limit(keys, now)

    pending = pending_verifications.get(email)
    if not pending:
        record_fail(keys, now); raise HTTPException(400, "Code not found or expired")
    if now > pending["expires"]:
        del pending_verifications[email]; raise HTTPException(400, "Code expired")
    if code != pending["code"]:
        record_fail(keys, now); raise HTTPException(400, "Invalid code")

    conn = get_db(); cur = conn.cursor()
    try:
        if pending["type"] == "register":
            cur.execute(
                "INSERT INTO crm_users (name, email, password, role) VALUES (%s,%s,%s,'owner')",
                (pending["name"], email, hash_pw(pending["password"]))
            )
            conn.commit()
            user_id = cur.lastrowid
            cur.execute("INSERT INTO crm_settings (crm_user_id) VALUES (%s)", (user_id,))
            conn.commit()
        else:
            row = db_one("SELECT id FROM crm_users WHERE email = %s", (email,))
            user_id = row["id"]
            cur.execute("UPDATE crm_users SET last_login_at = NOW() WHERE id = %s", (user_id,))
            conn.commit()
    finally:
        cur.close(); conn.close()

    set_cookie(response, make_token(user_id))
    del pending_verifications[email]
    for k in keys: login_attempts.pop(k, None)
    return {"success": True}


@app.post("/api/resend-code")
def resend_code_endpoint(request: ResendCodeRequest):
    email = request.email.lower().strip()
    now   = datetime.utcnow()
    p     = pending_verifications.get(email)
    if not p:                        raise HTTPException(400, "No pending verification")
    if now > p["expires"]:           del pending_verifications[email]; raise HTTPException(400, "Code expired")
    if now < p["next_resend_at"]:
        left = int((p["next_resend_at"] - now).total_seconds())
        raise HTTPException(429, f"Resend available in {left}s")

    code = random.randint(100000, 999999)
    p.update(code=str(code),
             expires=now + timedelta(minutes=CODE_TTL_MINUTES),
             next_resend_at=now + timedelta(seconds=RESEND_COOLDOWN_SECONDS))
    if not send_code_email(email, code): raise HTTPException(500, "Failed to send email")
    return {"success": True, "resend_available_in": RESEND_COOLDOWN_SECONDS}


@app.get("/api/me")
def get_me(user: dict = Depends(get_current_user)):
    return db_one(
        "SELECT id, name, email, role, active_api_key_id FROM crm_users WHERE id = %s AND is_active = 1",
        (user["id"],)
    ) or HTTPException(401, "User not found")


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie("crm_token", path="/")
    return {"success": True}


# ════════════════════════════════════════════
# ВОССТАНОВЛЕНИЕ ПАРОЛЯ
# ════════════════════════════════════════════

@app.post("/api/forgot-password")
def forgot_password(request: ForgotPasswordRequest):
    email = request.email.lower().strip()
    if not db_one("SELECT id FROM crm_users WHERE email = %s", (email,)):
        return {"success": True}  # Не раскрываем что email не существует

    # Удаляем старые токены этого email
    for t in [t for t, d in password_reset_tokens.items() if d["email"] == email]:
        del password_reset_tokens[t]

    raw   = secrets.token_urlsafe(32)
    h     = hashlib.sha256(raw.encode()).hexdigest()
    password_reset_tokens[h] = {"email": email, "expires": datetime.utcnow() + timedelta(minutes=RESET_TTL_MINUTES)}

    if not send_reset_email(email, raw):
        del password_reset_tokens[h]; raise HTTPException(500, "Failed to send email")
    return {"success": True}


@app.get("/api/reset-password/validate/{token}")
def validate_reset_token(token: str):
    data = password_reset_tokens.get(hashlib.sha256(token.encode()).hexdigest())
    if not data or datetime.utcnow() > data["expires"]:
        raise HTTPException(400, "Invalid or expired reset link")
    return {"valid": True, "email": data["email"]}


@app.post("/api/reset-password")
def reset_password(request: ResetPasswordRequest):
    if request.password != request.repeat_password:
        raise HTTPException(400, "Passwords do not match")
    h    = hashlib.sha256(request.token.encode()).hexdigest()
    data = password_reset_tokens.get(h)
    if not data or datetime.utcnow() > data["expires"]:
        raise HTTPException(400, "Invalid or expired reset link")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("UPDATE crm_users SET password = %s WHERE email = %s",
                    (hash_pw(request.password), data["email"]))
        conn.commit()
    finally:
        cur.close(); conn.close()
    del password_reset_tokens[h]
    return {"success": True}


# ════════════════════════════════════════════
# API KEYS
# ════════════════════════════════════════════

@app.get("/api/api-keys")
def get_api_keys(user: dict = Depends(get_current_user)):
    rows = db_all("""
        SELECT k.id, k.name, k.api_key, k.is_active,
               k.last_used_at, k.last_used_ip, k.created_at,
               (u.active_api_key_id = k.id) AS is_selected,
               r.name AS user_role
        FROM crm_api_keys k
        JOIN crm_users u ON u.id = %s
        LEFT JOIN crm_team_members tm ON tm.api_key_id = k.id AND tm.crm_user_id = %s
        LEFT JOIN crm_roles r ON r.id = tm.crm_role_id
        WHERE k.crm_user_id = %s OR tm.crm_user_id = %s
        GROUP BY k.id ORDER BY k.created_at DESC
    """, (user["id"], user["id"], user["id"], user["id"]))

    for k in rows:
        k["is_selected"]  = bool(k["is_selected"])
        k["last_used_at"] = k["last_used_at"].isoformat() if k.get("last_used_at") else None
        k["created_at"]   = str(k["created_at"])
    return rows


@app.post("/api/api-keys")
def create_api_key(request: CreateApiKeyRequest, req: Request, user: dict = Depends(get_current_user)):
    if user["role"] != "owner":
        raise HTTPException(403, "Only owner can create API keys")

    name = request.name.strip()
    if not name:               raise HTTPException(400, "Name is required")
    if len(name) > 100:        raise HTTPException(400, "Name too long (max 100)")

    # Генерируем уникальный ключ
    new_key = next(
        (c for _ in range(5)
         if not db_one("SELECT id FROM crm_api_keys WHERE api_key = %s", (c := gen_api_key(),))),
        None
    )
    if not new_key: raise HTTPException(500, "Failed to generate unique key")

    conn = get_db(); cur = conn.cursor(dictionary=True)
    try:
        cur.execute(
            "INSERT INTO crm_api_keys (crm_user_id, name, api_key, last_used_ip, is_active) VALUES (%s,%s,%s,%s,1)",
            (user["id"], name, new_key, get_ip(req))
        )
        conn.commit()
        new_id = cur.lastrowid  # ← получаем ID сразу после INSERT

        # Системная роль Owner для нового проекта
        cur.execute("INSERT INTO crm_roles (api_key_id, name, is_system) VALUES (%s,'Owner',1)", (new_id,))
        conn.commit()
        owner_role_id = cur.lastrowid

        # Добавляем создателя как участника
        cur.execute(
            "INSERT INTO crm_team_members (api_key_id, crm_user_id, crm_role_id) VALUES (%s,%s,%s)",
            (new_id, user["id"], owner_role_id)
        )

        # Если первый ключ — делаем активным
        cur.execute("SELECT COUNT(*) AS cnt FROM crm_api_keys WHERE crm_user_id = %s", (user["id"],))
        count = cur.fetchone()["cnt"]
        if count == 1:
            cur.execute("UPDATE crm_users SET active_api_key_id = %s WHERE id = %s", (new_id, user["id"]))
        conn.commit()

        return {"id": new_id, "name": name, "api_key": new_key,
                "is_active": True, "is_selected": count == 1}
    finally:
        cur.close(); conn.close()


@app.put("/api/api-keys/switch")
def switch_api_key(request: SwitchApiKeyRequest, user: dict = Depends(get_current_user)):
    key = db_one("""
        SELECT k.id, k.name FROM crm_api_keys k
        LEFT JOIN crm_team_members tm ON tm.api_key_id = k.id AND tm.crm_user_id = %s
        WHERE k.id = %s AND k.is_active = 1
          AND (k.crm_user_id = %s OR tm.crm_user_id IS NOT NULL)
    """, (user["id"], request.api_key_id, user["id"]))
    if not key:
        raise HTTPException(404, "API key not found or access denied")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("UPDATE crm_users SET active_api_key_id=%s WHERE id=%s",
                    (request.api_key_id, user["id"]))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True, "active_key": key}


@app.delete("/api/api-keys/{key_id}")
def delete_api_key(key_id: int, user: dict = Depends(get_current_user)):
    if user["role"] != "owner": raise HTTPException(403, "Only owner can delete API keys")
    if not db_one("SELECT id FROM crm_api_keys WHERE id = %s AND crm_user_id = %s", (key_id, user["id"])):
        raise HTTPException(404, "API key not found")

    cnt = db_one("SELECT COUNT(*) AS c FROM crm_api_keys WHERE crm_user_id = %s", (user["id"],))["c"]
    if cnt <= 1: raise HTTPException(400, "Cannot delete the last API key")

    conn = get_db(); cur = conn.cursor(dictionary=True)
    try:
        # Если удаляем активный — переключаем на другой
        cur.execute("SELECT active_api_key_id FROM crm_users WHERE id = %s", (user["id"],))
        if cur.fetchone()["active_api_key_id"] == key_id:
            cur.execute(
                "SELECT id FROM crm_api_keys WHERE crm_user_id=%s AND id!=%s AND is_active=1 LIMIT 1",
                (user["id"], key_id)
            )
            fb = cur.fetchone()
            if fb:
                cur.execute("UPDATE crm_users SET active_api_key_id=%s WHERE id=%s", (fb["id"], user["id"]))

        cur.execute("DELETE FROM crm_api_keys WHERE id = %s", (key_id,))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


@app.get("/api/me/active-key")
def get_active_key(user: dict = Depends(get_current_user)):
    return db_one("""
        SELECT k.id, k.name, k.api_key FROM crm_users u
        JOIN crm_api_keys k ON k.id = u.active_api_key_id WHERE u.id = %s
    """, (user["id"],)) or {}


# ════════════════════════════════════════════
# ROLES
# ════════════════════════════════════════════

@app.get("/api/roles")
def get_roles(user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    return db_all(
        "SELECT id, name, is_system FROM crm_roles WHERE api_key_id=%s ORDER BY is_system DESC, id ASC",
        (kid,)
    )


@app.post("/api/roles")
def create_role(request: CreateRoleRequest, user: dict = Depends(get_current_user)):
    name = request.name.strip()
    if not name:        raise HTTPException(400, "Role name is required")
    if len(name) > 50:  raise HTTPException(400, "Role name too long (max 50)")

    kid = active_key_id(user["id"])
    require_owner(user, kid)

    if db_one("SELECT id FROM crm_roles WHERE api_key_id=%s AND name=%s", (kid, name)):
        raise HTTPException(400, "Role already exists")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("INSERT INTO crm_roles (api_key_id, name, is_system) VALUES (%s,%s,0)", (kid, name))
        conn.commit()
        return {"id": cur.lastrowid, "name": name, "is_system": False}
    finally:
        cur.close(); conn.close()


@app.delete("/api/roles/{role_id}")
def delete_role(role_id: int, user: dict = Depends(get_current_user)):
    kid  = active_key_id(user["id"])
    require_owner(user, kid)
    role = db_one("SELECT id, is_system FROM crm_roles WHERE id=%s AND api_key_id=%s", (role_id, kid))
    if not role:            raise HTTPException(404, "Role not found")
    if role["is_system"]:   raise HTTPException(400, "Cannot delete system role")

    used = db_one("SELECT COUNT(*) AS c FROM crm_team_members WHERE crm_role_id=%s", (role_id,))["c"]
    if used > 0: raise HTTPException(400, "Role is in use, reassign members first")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM crm_roles WHERE id=%s", (role_id,))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


# ════════════════════════════════════════════
# TEAM
# ════════════════════════════════════════════

@app.get("/api/team")
def get_team(user: dict = Depends(get_current_user)):
    conn = get_db(); cur = conn.cursor(dictionary=True)
    try:
        kid = active_key_id(user["id"])
        key_row = db_one("SELECT crm_user_id FROM crm_api_keys WHERE id = %s", (kid,))
        is_owner = key_row and key_row["crm_user_id"] == user["id"]

        if not is_owner:
            if not db_one(
                "SELECT id FROM crm_team_members WHERE api_key_id=%s AND crm_user_id=%s",
                (kid, user["id"])
            ):
                raise HTTPException(403, "You are not a member of this project")

        if is_owner:
            existing = db_one(
                "SELECT id FROM crm_team_members WHERE api_key_id=%s AND crm_user_id=%s",
                (kid, user["id"])
            )
            if not existing:
                owner_role = db_one(
                    "SELECT id FROM crm_roles WHERE api_key_id=%s AND is_system=1",
                    (kid,)
                )
                if not owner_role:
                    c2 = conn.cursor()
                    c2.execute(
                        "INSERT INTO crm_roles (api_key_id, name, is_system) VALUES (%s,'Owner',1)",
                        (kid,)
                    )
                    conn.commit()
                    owner_role_id = c2.lastrowid
                    c2.close()
                else:
                    owner_role_id = owner_role["id"]

                c2 = conn.cursor()
                c2.execute(
                    "INSERT INTO crm_team_members (api_key_id, crm_user_id, crm_role_id) VALUES(%s,%s,%s)",
                    (kid, user["id"], owner_role_id)
                )
                conn.commit()
                c2.close()

        members = db_all("""
            SELECT u.id, u.name, u.email,
                   r.id AS role_id, r.name AS role_name, r.is_system,
                   tm.joined_at, (k.crm_user_id = u.id) AS is_owner
            FROM crm_team_members tm
            JOIN crm_users u    ON u.id = tm.crm_user_id
            JOIN crm_roles r    ON r.id = tm.crm_role_id
            JOIN crm_api_keys k ON k.id = %s
            WHERE tm.api_key_id = %s
            ORDER BY is_owner DESC, tm.joined_at ASC
        """, (kid, kid))

        for m in members:
            m["joined_at"] = str(m["joined_at"])
            m["is_owner"]  = bool(m["is_owner"])
            m["is_system"] = bool(m["is_system"])
            m["is_me"]     = (m["id"] == user["id"])
        return members
    finally:
        cur.close(); conn.close()


@app.put("/api/team/role")
def update_member_role(request: UpdateMemberRoleRequest, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_owner(user, kid)
    if request.crm_user_id == user["id"]: raise HTTPException(400, "Cannot change your own role")
    if not db_one("SELECT id FROM crm_roles WHERE id=%s AND api_key_id=%s", (request.crm_role_id, kid)):
        raise HTTPException(404, "Role not found in this project")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE crm_team_members SET crm_role_id=%s WHERE api_key_id=%s AND crm_user_id=%s",
            (request.crm_role_id, kid, request.crm_user_id)
        )
        conn.commit()
        if cur.rowcount == 0: raise HTTPException(404, "Member not found")
    finally:
        cur.close(); conn.close()
    return {"ok": True}


@app.delete("/api/team/{member_user_id}")
def remove_member(member_user_id: int, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_owner(user, kid)
    if member_user_id == user["id"]: raise HTTPException(400, "Cannot remove yourself")

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM crm_team_members WHERE api_key_id=%s AND crm_user_id=%s", (kid, member_user_id))
        conn.commit()
        if cur.rowcount == 0: raise HTTPException(404, "Member not found")
    finally:
        cur.close(); conn.close()
    return {"ok": True}


# ════════════════════════════════════════════
# INVITES
# ════════════════════════════════════════════

@app.post("/api/invites")
def create_invite(request: CreateInviteRequest, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_owner(user, kid)
    if not db_one("SELECT id FROM crm_roles WHERE id=%s AND api_key_id=%s", (request.crm_role_id, kid)):
        raise HTTPException(404, "Role not found")

    token      = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(hours=request.expires_hours) if request.expires_hours else None

    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO crm_invites (api_key_id,crm_role_id,token,created_by,expires_at,max_uses) VALUES(%s,%s,%s,%s,%s,%s)",
            (kid, request.crm_role_id, token, user["id"], expires_at, request.max_uses)
        )
        conn.commit()
        return {
            "id": cur.lastrowid, "token": token,
            "invite_url": f"{FRONTEND_URL}/invite/{token}",
            "expires_at": expires_at.isoformat() if expires_at else None,
            "max_uses": request.max_uses,
        }
    finally:
        cur.close(); conn.close()


@app.get("/api/invites")
def get_invites(user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_owner(user, kid)
    rows = db_all("""
        SELECT i.id, i.token, i.uses, i.max_uses, i.expires_at, i.created_at, r.name AS role_name
        FROM crm_invites i JOIN crm_roles r ON r.id = i.crm_role_id
        WHERE i.api_key_id=%s AND i.is_active=1 ORDER BY i.created_at DESC
    """, (kid,))
    for i in rows:
        i["created_at"] = str(i["created_at"])
        i["expires_at"] = i["expires_at"].isoformat() if i["expires_at"] else None
        i["invite_url"] = f"{FRONTEND_URL}/invite/{i['token']}"
    return rows


@app.delete("/api/invites/{invite_id}")
def revoke_invite(invite_id: int, user: dict = Depends(get_current_user)):
    kid = active_key_id(user["id"])
    require_owner(user, kid)
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("UPDATE crm_invites SET is_active=0 WHERE id=%s AND api_key_id=%s", (invite_id, kid))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True}


@app.get("/api/invites/validate/{token}")
def validate_invite(token: str):
    inv = db_one("""
        SELECT i.id, i.api_key_id, i.crm_role_id, i.uses, i.max_uses,
               i.expires_at, i.is_active, r.name AS role_name, k.name AS project_name
        FROM crm_invites i
        JOIN crm_roles r ON r.id = i.crm_role_id
        JOIN crm_api_keys k ON k.id = i.api_key_id
        WHERE i.token = %s
    """, (token,))
    if not inv:                 raise HTTPException(404, "Invite not found")
    if not inv["is_active"]:    raise HTTPException(400, "Invite revoked")
    if inv["expires_at"] and datetime.utcnow() > inv["expires_at"]: raise HTTPException(400, "Invite expired")
    if inv["max_uses"] and inv["uses"] >= inv["max_uses"]:          raise HTTPException(400, "Invite limit reached")
    inv["expires_at"] = inv["expires_at"].isoformat() if inv["expires_at"] else None
    return inv


@app.post("/api/invites/accept/{token}")
def accept_invite(token: str, user: dict = Depends(get_current_user)):
    inv = db_one("""
        SELECT i.*, r.name AS role_name, k.name AS project_name
        FROM crm_invites i JOIN crm_roles r ON r.id=i.crm_role_id JOIN crm_api_keys k ON k.id=i.api_key_id
        WHERE i.token=%s AND i.is_active=1
    """, (token,))
    if not inv: raise HTTPException(404, "Invalid or expired invite")
    if inv["expires_at"] and datetime.utcnow() > inv["expires_at"]: raise HTTPException(400, "Invite expired")
    if inv["max_uses"] and inv["uses"] >= inv["max_uses"]:           raise HTTPException(400, "Invite limit reached")

    conn = get_db(); cur = conn.cursor(dictionary=True)
    try:
        cur.execute("SELECT id FROM crm_team_members WHERE api_key_id=%s AND crm_user_id=%s",
                    (inv["api_key_id"], user["id"]))
        if cur.fetchone():
            cur.execute("UPDATE crm_users SET active_api_key_id=%s WHERE id=%s", (inv["api_key_id"], user["id"]))
            conn.commit()
            return {"ok": True, "message": "Already a member"}

        cur.execute(
            "INSERT INTO crm_team_members (api_key_id,crm_user_id,crm_role_id) VALUES(%s,%s,%s)",
            (inv["api_key_id"], user["id"], inv["crm_role_id"])
        )
        cur.execute("UPDATE crm_users SET active_api_key_id=%s WHERE id=%s", (inv["api_key_id"], user["id"]))
        cur.execute("UPDATE crm_invites SET uses=uses+1 WHERE id=%s", (inv["id"],))
        if inv["max_uses"] and (inv["uses"] + 1) >= inv["max_uses"]:
            cur.execute("UPDATE crm_invites SET is_active=0 WHERE id=%s", (inv["id"],))
        conn.commit()
    finally:
        cur.close(); conn.close()
    return {"ok": True, "project_name": inv["project_name"], "role": inv["role_name"]}