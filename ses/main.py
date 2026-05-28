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

# Postfix maps for inbound mail routing.
# transport  — tells Postfix "deliver mail for <domain> via the torta_crm pipe"
# relay_domains — tells Postfix "we accept incoming mail for <domain>"
# Without an entry in relay_domains Postfix replies 554 "Relay access denied"
# for any RCPT TO outside mydestination.
POSTFIX_TRANSPORT     = Path("/etc/postfix/transport")
POSTFIX_RELAY_DOMAINS = Path("/etc/postfix/relay_domains")
INBOUND_TRANSPORT     = "torta_crm:"  # must match the master.cf service name

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
        # migrate: add columns if missing
        cols = [r[1] for r in db.execute("PRAGMA table_info(domains)").fetchall()]
        if "dmarc_ok" not in cols:
            db.execute("ALTER TABLE domains ADD COLUMN dmarc_ok INTEGER NOT NULL DEFAULT 0")
        if "inbound_ok" not in cols:
            db.execute("ALTER TABLE domains ADD COLUMN inbound_ok INTEGER NOT NULL DEFAULT 0")

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

# ── Postfix inbound helpers ───────────────────────────────────────────────────
# Each registered inbound domain needs a line in two Postfix maps:
#   /etc/postfix/transport       → "<domain> torta_crm:"  (route to the pipe daemon)
#   /etc/postfix/relay_domains   → "<domain> OK"          (accept mail for that domain)
# After editing, both maps must be re-hashed via `postmap` and Postfix reloaded.
#
# We treat the files as the source of truth and rewrite them in full from the DB
# on every change — same pattern as KeyTable/SigningTable above. That keeps the
# files deterministic and avoids needing grep/sed to detect duplicates.

def _read_map_lines(path: Path) -> list[str]:
    """Return existing lines from a Postfix map file, excluding our managed
    domain entries (anything we don't have in DB stays untouched so a sysadmin
    can hand-edit unrelated routes if they ever need to)."""
    if not path.exists():
        return []
    return path.read_text().splitlines()


def _write_postfix_maps():
    """Regenerate transport + relay_domains from DB (only domains with
    inbound_ok=1), preserving any manually-added foreign lines."""
    with get_db() as db:
        rows = db.execute(
            "SELECT domain FROM domains WHERE inbound_ok=1"
        ).fetchall()
    managed = {row["domain"] for row in rows}

    POSTFIX_TRANSPORT.parent.mkdir(parents=True, exist_ok=True)

    # Marker comments fence the auto-managed block so we don't clobber any
    # hand-written entries above/below.
    BEGIN = "# >>> ses-managed inbound (do not edit) >>>"
    END   = "# <<< ses-managed inbound <<<"

    def _rewrite(path: Path, value: str):
        existing = _read_map_lines(path)
        kept: list[str] = []
        skip = False
        for line in existing:
            if line.strip() == BEGIN:
                skip = True
                continue
            if line.strip() == END:
                skip = False
                continue
            if skip:
                continue
            kept.append(line)
        # Trim trailing blank lines so the block lands cleanly at EOF
        while kept and not kept[-1].strip():
            kept.pop()

        block = [BEGIN] + [f"{d}\t{value}" for d in sorted(managed)] + [END]
        out = "\n".join(kept + block) + "\n"
        path.write_text(out)

    _rewrite(POSTFIX_TRANSPORT,     INBOUND_TRANSPORT)
    _rewrite(POSTFIX_RELAY_DOMAINS, "OK")

    # postmap converts the text file → .db hash that Postfix actually reads
    subprocess.run(["postmap", str(POSTFIX_TRANSPORT)],     check=True, capture_output=True)
    subprocess.run(["postmap", str(POSTFIX_RELAY_DOMAINS)], check=True, capture_output=True)


def reload_postfix():
    _write_postfix_maps()
    subprocess.run(["postfix", "reload"], check=True, capture_output=True)
    log.info("Postfix reloaded")

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

def check_mx(domain: str) -> bool:
    """For inbound to work, the customer's MX must point at our VPS
    (mail.tortacrm.com). Returns True if any MX answer resolves to our host."""
    if not HAS_DNS:
        return False
    try:
        answers = dns.resolver.resolve(domain, "MX")
        for rd in answers:
            target = str(rd.exchange).rstrip(".").lower()
            if target == "mail.tortacrm.com":
                return True
    except Exception as e:
        log.debug("MX check %s: %s", domain, e)
    return False

# ── Domain serializer ─────────────────────────────────────────────────────────
def domain_dict(row) -> dict:
    dom = row["domain"]
    pub = row["public_key"]
    # inbound_ok column was added in a later migration — older rows may not have it.
    try:
        inbound_ok = bool(row["inbound_ok"])
    except (IndexError, KeyError):
        inbound_ok = False
    return {
        "domain":     dom,
        "selector":   row["selector"],
        "dkim_ok":    bool(row["dkim_ok"]),
        "spf_ok":     bool(row["spf_ok"]),
        "dmarc_ok":   bool(row["dmarc_ok"]),
        "inbound_ok": inbound_ok,
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
            # Inbound MX record — only matters if the customer wants
            # incoming email (Chat channels). Customer adds this once on
            # their DNS and points all `*@their-domain` mail at our VPS.
            {
                "type":  "MX",
                "host":  "@",
                "value": "10 mail.tortacrm.com",
                "label": "MX (inbound)",
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
    # MX is checked on-demand and not persisted: customers may change it
    # independently of inbound on/off, and it's an "informational" status
    # for the UI rather than something we sign or trust.
    mx_ok = check_mx(domain)
    log.info("VERIFY  domain=%s  dkim=%s  spf=%s  dmarc=%s  mx=%s",
             domain, dkim_ok, spf_ok, dmarc_ok, mx_ok)
    out = domain_dict(row)
    out["mx_ok"] = mx_ok
    return out

# ── Delete domain ─────────────────────────────────────────────────────────────
@app.delete("/domains/{domain}")
async def delete_domain(domain: str):
    domain = domain.lower().strip()
    with get_db() as db:
        if not db.execute("SELECT 1 FROM domains WHERE domain=?", (domain,)).fetchone():
            raise HTTPException(404, f"Domain {domain!r} not found")
        # If inbound was enabled, drop the Postfix maps too — otherwise
        # mail.log will fill with "unknown user" bounces after the row is gone.
        had_inbound = db.execute(
            "SELECT inbound_ok FROM domains WHERE domain=?", (domain,)
        ).fetchone()["inbound_ok"]
        db.execute("DELETE FROM domains WHERE domain=?", (domain,))
    d = DKIM_DIR / domain
    if d.exists():
        shutil.rmtree(d)
    try:
        reload_opendkim()
    except Exception as e:
        log.error("OpenDKIM reload failed: %s", e)
    if had_inbound:
        try:
            reload_postfix()
        except Exception as e:
            log.error("Postfix reload failed: %s", e)
    log.info("DOMAIN deleted: %s", domain)
    return {"ok": True}

# ── Inbound register / unregister ─────────────────────────────────────────────
# These endpoints toggle whether Postfix accepts mail FOR a domain and routes
# it to the email_to_crm.py pipe. Outbound (DKIM signing) is independent —
# a domain can be outbound-only, inbound-only, or both.
#
# The MX record on the customer's DNS must point at mail.tortacrm.com for any
# of this to do anything useful; we report MX status separately so the CRM
# UI can show a "DNS not ready" hint without blocking the registration.

@app.post("/domains/{domain}/inbound", status_code=201)
async def register_inbound(domain: str):
    domain = domain.lower().strip()
    if not valid_domain(domain):
        raise HTTPException(400, f"Invalid domain: {domain!r}")
    with get_db() as db:
        row = db.execute("SELECT * FROM domains WHERE domain=?", (domain,)).fetchone()
        if not row:
            raise HTTPException(404, f"Domain {domain!r} not registered — call POST /domains first")
        if row["inbound_ok"]:
            # Idempotent: caller can hit this on every Email-channel save
            # without us thrashing Postfix.
            log.info("INBOUND already enabled for %s — no-op", domain)
            return domain_dict(row)
        db.execute("UPDATE domains SET inbound_ok=1 WHERE domain=?", (domain,))
    try:
        reload_postfix()
    except subprocess.CalledProcessError as e:
        # Roll back the DB flag — Postfix would not actually accept the mail.
        with get_db() as db:
            db.execute("UPDATE domains SET inbound_ok=0 WHERE domain=?", (domain,))
        stderr = (e.stderr or b"").decode("utf-8", errors="replace")[:500]
        log.error("Postfix reload failed for %s: %s", domain, stderr)
        raise HTTPException(502, f"Postfix reload failed: {stderr}")
    log.info("INBOUND enabled: %s", domain)
    with get_db() as db:
        row = db.execute("SELECT * FROM domains WHERE domain=?", (domain,)).fetchone()
    return domain_dict(row)


@app.delete("/domains/{domain}/inbound")
async def unregister_inbound(domain: str):
    domain = domain.lower().strip()
    with get_db() as db:
        row = db.execute("SELECT * FROM domains WHERE domain=?", (domain,)).fetchone()
        if not row:
            raise HTTPException(404, f"Domain {domain!r} not found")
        if not row["inbound_ok"]:
            # Already off — idempotent.
            return domain_dict(row)
        db.execute("UPDATE domains SET inbound_ok=0 WHERE domain=?", (domain,))
    try:
        reload_postfix()
    except subprocess.CalledProcessError as e:
        # Even if reload fails, we keep the DB flag off — next successful
        # reload will catch up. The maps on disk are still consistent with DB.
        stderr = (e.stderr or b"").decode("utf-8", errors="replace")[:500]
        log.error("Postfix reload failed for %s: %s", domain, stderr)
    log.info("INBOUND disabled: %s", domain)
    with get_db() as db:
        row = db.execute("SELECT * FROM domains WHERE domain=?", (domain,)).fetchone()
    return domain_dict(row)
