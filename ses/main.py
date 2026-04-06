import os, re, shutil, smtplib, secrets, logging, sqlite3, subprocess
from pathlib import Path
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

try:
    import dns.resolver
    HAS_DNS = True
except ImportError:
    HAS_DNS = False

# ── Config ────────────────────────────────────────────────────────────────────
SES_API_KEY           = os.getenv("SES_API_KEY", "")
SMTP_HOST             = os.getenv("SMTP_HOST", "127.0.0.1")
SMTP_PORT             = int(os.getenv("SMTP_PORT", "25"))
LOG_LEVEL             = os.getenv("LOG_LEVEL", "INFO")
DEFAULT_FROM          = os.getenv("DEFAULT_FROM", "support@tortacrm.com")
DEFAULT_FROM_NAME     = os.getenv("DEFAULT_FROM_NAME", "Torta CRM")
SELECTOR              = "mail"

DKIM_DIR              = Path("/opt/ses/dkim")
OPENDKIM_KEY_TABLE    = Path("/etc/opendkim/KeyTable")
OPENDKIM_SIGNING_TABLE= Path("/etc/opendkim/SigningTable")
DB_PATH               = Path("/opt/ses/domains.db")

if not SES_API_KEY:
    raise RuntimeError("SES_API_KEY env variable is required")

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ses")

# ── Validation ────────────────────────────────────────────────────────────────
_EMAIL_RE  = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DOMAIN_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}$")

def valid_email(v: str) -> bool:  return bool(_EMAIL_RE.match(v))
def valid_domain(v: str) -> bool: return bool(_DOMAIN_RE.match(v))

# ── SQLite ────────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS domains (
                domain     TEXT PRIMARY KEY,
                selector   TEXT NOT NULL DEFAULT 'mail',
                public_key TEXT NOT NULL,
                dkim_ok    INTEGER NOT NULL DEFAULT 0,
                spf_ok     INTEGER NOT NULL DEFAULT 0,
                dmarc_ok   INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # migrate: add dmarc_ok if missing
        cols = [r[1] for r in db.execute("PRAGMA table_info(domains)").fetchall()]
        if "dmarc_ok" not in cols:
            db.execute("ALTER TABLE domains ADD COLUMN dmarc_ok INTEGER NOT NULL DEFAULT 0")

# ── DKIM helpers ──────────────────────────────────────────────────────────────
def generate_dkim_key(domain: str) -> str:
    """Generate 2048-bit RSA keypair. Returns base64 public key for DNS TXT record."""
    d = DKIM_DIR / domain
    d.mkdir(parents=True, exist_ok=True)
    priv = d / "mail.private"

    subprocess.run(
        ["openssl", "genrsa", "-out", str(priv), "2048"],
        check=True, capture_output=True
    )
    os.chmod(priv, 0o600)

    r = subprocess.run(
        ["openssl", "rsa", "-in", str(priv), "-pubout", "-outform", "PEM"],
        check=True, capture_output=True, text=True
    )
    # Strip PEM headers → raw base64
    pub_b64 = "".join(r.stdout.strip().splitlines()[1:-1])
    (d / "mail.txt").write_text(f"v=DKIM1; h=sha256; k=rsa; p={pub_b64}")
    return pub_b64


def _write_opendkim_tables():
    """Regenerate KeyTable and SigningTable from DB."""
    with get_db() as db:
        rows = db.execute("SELECT domain, selector FROM domains").fetchall()

    key_lines     = []
    signing_lines = []
    for row in rows:
        dom = row["domain"]
        sel = row["selector"]
        priv = DKIM_DIR / dom / "mail.private"
        key_lines.append(f"{sel}._domainkey.{dom} {dom}:{sel}:{priv}\n")
        signing_lines.append(f"*@{dom} {sel}._domainkey.{dom}\n")

    OPENDKIM_KEY_TABLE.parent.mkdir(parents=True, exist_ok=True)
    OPENDKIM_KEY_TABLE.write_text("".join(key_lines))
    OPENDKIM_SIGNING_TABLE.write_text("".join(signing_lines))


def reload_opendkim():
    _write_opendkim_tables()
    subprocess.run(["systemctl", "reload", "opendkim"], check=True, capture_output=True)
    log.info("OpenDKIM reloaded")

# ── DNS verification ──────────────────────────────────────────────────────────
def check_dkim(domain: str, pub_key: str) -> bool:
    if not HAS_DNS:
        return False
    try:
        answers = dns.resolver.resolve(f"{SELECTOR}._domainkey.{domain}", "TXT")
        for rd in answers:
            txt = "".join(s.decode() if isinstance(s, bytes) else s for s in rd.strings)
            m = re.search(r"p=([A-Za-z0-9+/=]+)", txt)
            if m and m.group(1) == pub_key:
                return True
    except Exception as e:
        log.debug("DKIM check %s: %s", domain, e)
    return False

def check_spf(domain: str) -> bool:
    if not HAS_DNS:
        return False
    try:
        answers = dns.resolver.resolve(domain, "TXT")
        for rd in answers:
            txt = "".join(s.decode() if isinstance(s, bytes) else s for s in rd.strings)
            if txt.startswith("v=spf1"):
                return True
    except Exception as e:
        log.debug("SPF check %s: %s", domain, e)
    return False

def check_dmarc(domain: str) -> bool:
    if not HAS_DNS:
        return False
    try:
        answers = dns.resolver.resolve(f"_dmarc.{domain}", "TXT")
        for rd in answers:
            txt = "".join(s.decode() if isinstance(s, bytes) else s for s in rd.strings)
            if txt.startswith("v=DMARC1"):
                return True
    except Exception as e:
        log.debug("DMARC check %s: %s", domain, e)
    return False

# ── Domain serializer ─────────────────────────────────────────────────────────
def domain_dict(row) -> dict:
    dom = row["domain"]
    pub = row["public_key"]
    return {
        "domain":   dom,
        "selector": row["selector"],
        "dkim_ok":  bool(row["dkim_ok"]),
        "spf_ok":   bool(row["spf_ok"]),
        "dmarc_ok": bool(row["dmarc_ok"]),
        "dns_records": [
            {
                "type": "TXT",
                "host": f"{row['selector']}._domainkey.{dom}",
                "value": f"v=DKIM1; h=sha256; k=rsa; p={pub}",
                "label": "DKIM",
            },
            {
                "type": "TXT",
                "host": "@",
                "value": "v=spf1 include:tortacrm.com ~all",
                "label": "SPF",
            },
            {
                "type": "TXT",
                "host": "_dmarc",
                "value": "v=DMARC1; p=none; rua=mailto:admin@tortacrm.com",
                "label": "DMARC",
            },
        ],
    }

# ── App ───────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    DKIM_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    log.info("SES started — SMTP %s:%s", SMTP_HOST, SMTP_PORT)
    yield
    log.info("SES stopped")

app = FastAPI(title="SES", docs_url=None, redoc_url=None, lifespan=lifespan)

# ── Auth ──────────────────────────────────────────────────────────────────────
@app.middleware("http")
async def require_api_key(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    key = request.headers.get("X-API-Key", "")
    if not secrets.compare_digest(key.encode(), SES_API_KEY.encode()):
        return JSONResponse(status_code=401, content={"ok": False, "error": "Unauthorized"})
    return await call_next(request)

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"ok": True}

# ── Send ──────────────────────────────────────────────────────────────────────
class SendRequest(BaseModel):
    to:         str
    subject:    str
    html:       str
    from_name:  str      = DEFAULT_FROM_NAME
    from_email: str      = DEFAULT_FROM
    reply_to:   str | None = None

    @field_validator("to", "from_email")
    @classmethod
    def v_email(cls, v):
        v = v.strip()
        if not valid_email(v):
            raise ValueError(f"Invalid email: {v!r}")
        return v.lower()

    @field_validator("subject", "html", "from_name")
    @classmethod
    def v_nonempty(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Must not be empty")
        return v

@app.post("/send")
async def send_email(req: SendRequest):
    msg            = MIMEMultipart("alternative")
    msg["Subject"] = req.subject
    msg["From"]    = formataddr((req.from_name, req.from_email))
    msg["To"]      = req.to
    if req.reply_to:
        msg["Reply-To"] = req.reply_to

    plain = re.sub(r"<[^>]+>", "", req.html).strip()
    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(req.html,  "html",  "utf-8"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
            smtp.sendmail(req.from_email, [req.to], msg.as_bytes())
        log.info("SENT  to=%s  from=%s  subject=%r", req.to, req.from_email, req.subject)
        return {"ok": True}
    except smtplib.SMTPRecipientsRefused as e:
        raise HTTPException(status_code=422, detail=f"Recipient refused: {e}")
    except smtplib.SMTPException as e:
        raise HTTPException(status_code=502, detail=f"SMTP error: {e}")
    except OSError as e:
        raise HTTPException(status_code=503, detail=f"Cannot connect to SMTP: {e}")

# ── Register domain ───────────────────────────────────────────────────────────
class DomainIn(BaseModel):
    domain: str

    @field_validator("domain")
    @classmethod
    def v_domain(cls, v):
        v = v.lower().strip()
        if not valid_domain(v):
            raise ValueError(f"Invalid domain: {v!r}")
        return v

@app.post("/domains", status_code=201)
async def register_domain(body: DomainIn):
    domain = body.domain
    with get_db() as db:
        if db.execute("SELECT 1 FROM domains WHERE domain=?", (domain,)).fetchone():
            raise HTTPException(409, f"Domain {domain!r} already registered")
        pub = generate_dkim_key(domain)
        db.execute(
            "INSERT INTO domains (domain, selector, public_key) VALUES (?,?,?)",
            (domain, SELECTOR, pub)
        )
    try:
        reload_opendkim()
    except Exception as e:
        log.error("OpenDKIM reload failed: %s", e)
    log.info("DOMAIN registered: %s", domain)
    with get_db() as db:
        row = db.execute("SELECT * FROM domains WHERE domain=?", (domain,)).fetchone()
    return domain_dict(row)

# ── Get domain ────────────────────────────────────────────────────────────────
@app.get("/domains/{domain}")
async def get_domain(domain: str):
    domain = domain.lower().strip()
    with get_db() as db:
        row = db.execute("SELECT * FROM domains WHERE domain=?", (domain,)).fetchone()
    if not row:
        raise HTTPException(404, f"Domain {domain!r} not found")
    return domain_dict(row)

# ── Verify domain DNS ─────────────────────────────────────────────────────────
@app.post("/domains/{domain}/verify")
async def verify_domain(domain: str):
    domain = domain.lower().strip()
    with get_db() as db:
        row = db.execute("SELECT * FROM domains WHERE domain=?", (domain,)).fetchone()
        if not row:
            raise HTTPException(404, f"Domain {domain!r} not found")
        dkim_ok  = check_dkim(domain, row["public_key"])
        spf_ok   = check_spf(domain)
        dmarc_ok = check_dmarc(domain)
        db.execute(
            "UPDATE domains SET dkim_ok=?, spf_ok=?, dmarc_ok=? WHERE domain=?",
            (int(dkim_ok), int(spf_ok), int(dmarc_ok), domain)
        )
        row = db.execute("SELECT * FROM domains WHERE domain=?", (domain,)).fetchone()
    log.info("VERIFY  domain=%s  dkim=%s  spf=%s  dmarc=%s", domain, dkim_ok, spf_ok, dmarc_ok)
    return domain_dict(row)

# ── Delete domain ─────────────────────────────────────────────────────────────
@app.delete("/domains/{domain}")
async def delete_domain(domain: str):
    domain = domain.lower().strip()
    with get_db() as db:
        if not db.execute("SELECT 1 FROM domains WHERE domain=?", (domain,)).fetchone():
            raise HTTPException(404, f"Domain {domain!r} not found")
        db.execute("DELETE FROM domains WHERE domain=?", (domain,))
    d = DKIM_DIR / domain
    if d.exists():
        shutil.rmtree(d)
    try:
        reload_opendkim()
    except Exception as e:
        log.error("OpenDKIM reload failed: %s", e)
    log.info("DOMAIN deleted: %s", domain)
    return {"ok": True}
