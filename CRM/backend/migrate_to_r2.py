"""One-off migration: AWS S3 -> Cloudflare R2.

Phase 1: copy every object from the S3 bucket to the R2 bucket (same keys,
         preserving ContentType + CacheControl).
Phase 2: rewrite stored image URLs in the DB from the old S3 domain to the
         new R2 public domain (dynamic column scan — catches every column).

Safe to re-run (idempotent): copying overwrites identical keys, URL rewrite
only touches rows still on the old domain.

Run:  cd CRM/backend && python migrate_to_r2.py            (dry-run report)
      cd CRM/backend && python migrate_to_r2.py --apply    (actually do it)

Delete after the migration is confirmed.
"""
import io
import os
import sys

import boto3
import psycopg2
import psycopg2.extras

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

APPLY = "--apply" in sys.argv

# ── Load .env (utf-8-sig: PowerShell may have written a BOM) ──
ENV = os.path.join(os.path.dirname(__file__), ".env")
env: dict[str, str] = {}
if os.path.exists(ENV):
    with open(ENV, "r", encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
for k, v in env.items():
    os.environ.setdefault(k, v)

# S3 (source)
S3_KEY    = os.getenv("AWS_ACCESS_KEY_ID", "")
S3_SECRET = os.getenv("AWS_SECRET_ACCESS_KEY", "")
S3_BUCKET = os.getenv("AWS_S3_BUCKET", "torta-crm")
S3_REGION = os.getenv("AWS_S3_REGION", "eu-central-1")

# R2 (destination)
R2_ENDPOINT = os.getenv("R2_ENDPOINT", "")
R2_KEY      = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET   = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET   = os.getenv("R2_BUCKET", "torta-crm")
R2_PUBLIC   = os.getenv("R2_PUBLIC_URL", "").rstrip("/")

OLD_DOMAIN = f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com"
NEW_DOMAIN = R2_PUBLIC

print("=" * 64)
print(f"S3 -> R2 migration   ({'APPLY' if APPLY else 'DRY-RUN'})")
print("=" * 64)
print(f"  Source S3 bucket: {S3_BUCKET} ({S3_REGION})")
print(f"  Dest   R2 bucket: {R2_BUCKET} @ {R2_ENDPOINT}")
print(f"  URL rewrite:      {OLD_DOMAIN}")
print(f"             ->     {NEW_DOMAIN}")
print()

if not (S3_KEY and S3_SECRET):
    print("  ERROR: AWS creds missing — can't read source S3.")
    sys.exit(1)
if not (R2_ENDPOINT and R2_KEY and R2_SECRET and R2_PUBLIC):
    print("  ERROR: R2 config incomplete (need endpoint, keys, public url).")
    sys.exit(1)

s3 = boto3.client("s3", region_name=S3_REGION,
                  aws_access_key_id=S3_KEY, aws_secret_access_key=S3_SECRET)
r2 = boto3.client("s3", endpoint_url=R2_ENDPOINT, region_name="auto",
                  aws_access_key_id=R2_KEY, aws_secret_access_key=R2_SECRET)

# ── Phase 1: copy objects ──
print("-" * 64)
print("Phase 1: copy objects S3 -> R2")
print("-" * 64)
copied = 0
copied_bytes = 0
skipped = 0
paginator = s3.get_paginator("list_objects_v2")
try:
    for page in paginator.paginate(Bucket=S3_BUCKET):
        for obj in (page.get("Contents") or []):
            key = obj["Key"]
            size = int(obj.get("Size") or 0)
            if not APPLY:
                print(f"  would copy  {size:>10,} B  {key}")
                copied += 1
                copied_bytes += size
                continue
            # Pull the source object (with its content-type) and put into R2.
            src = s3.get_object(Bucket=S3_BUCKET, Key=key)
            body = src["Body"].read()
            extra = {}
            if src.get("ContentType"):
                extra["ContentType"] = src["ContentType"]
            if src.get("CacheControl"):
                extra["CacheControl"] = src["CacheControl"]
            else:
                extra["CacheControl"] = "max-age=31536000"
            r2.upload_fileobj(io.BytesIO(body), R2_BUCKET, key, ExtraArgs=extra)
            copied += 1
            copied_bytes += size
            print(f"  copied      {size:>10,} B  {key}")
except Exception as e:
    print(f"  ERROR during copy: {type(e).__name__}: {e}")
    sys.exit(1)
print(f"\n  {'Would copy' if not APPLY else 'Copied'}: {copied} objects, "
      f"{copied_bytes:,} B ({copied_bytes/1024/1024:.2f} MB)")
print()

# ── Phase 2: rewrite DB URLs ──
print("-" * 64)
print("Phase 2: rewrite DB image URLs (dynamic column scan)")
print("-" * 64)
try:
    DB_URL = os.getenv("DATABASE_URL")
    if DB_URL:
        conn = psycopg2.connect(DB_URL)
    else:
        conn = psycopg2.connect(
            host=os.getenv("DB_HOST", "localhost"),
            port=os.getenv("DB_PORT", "5432"),
            dbname=os.getenv("DB_NAME", "crmdb"),
            user=os.getenv("DB_USER", "postgres"),
            password=os.getenv("DB_PASSWORD", ""),
        )
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    # All columns that COULD hold a URL — text, jsonb AND postgres arrays
    # (product images live in product_configurations_l1.images text[], which
    # a text-only scan would miss).
    cur.execute("""
        SELECT table_name, column_name, data_type
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND data_type IN ('character varying', 'text', 'character',
                             'jsonb', 'json', 'ARRAY')
         ORDER BY table_name, column_name
    """)
    cols = cur.fetchall()
    like = f"%{OLD_DOMAIN}%"
    total_rows = 0
    touched_cols = 0
    for c in cols:
        t, col, dt = c["table_name"], c["column_name"], c["data_type"]
        # Per-type: how to TEST for the old domain + how to REWRITE it.
        if dt in ("jsonb", "json"):
            test = f'"{col}"::text LIKE %s'
            upd  = f'UPDATE "{t}" SET "{col}" = REPLACE("{col}"::text, %s, %s)::{dt} WHERE "{col}"::text LIKE %s'
        elif dt == "ARRAY":
            test = f'array_to_string("{col}", \',\') LIKE %s'
            upd  = (f'UPDATE "{t}" SET "{col}" = '
                    f'ARRAY(SELECT REPLACE(elem, %s, %s) FROM unnest("{col}") elem) '
                    f'WHERE array_to_string("{col}", \',\') LIKE %s')
        else:  # text / varchar / char
            test = f'"{col}" LIKE %s'
            upd  = f'UPDATE "{t}" SET "{col}" = REPLACE("{col}", %s, %s) WHERE "{col}" LIKE %s'
        try:
            cur.execute(f'SELECT COUNT(*) AS n FROM "{t}" WHERE {test}', (like,))
            n = cur.fetchone()["n"]
        except Exception:
            conn.rollback()
            continue
        if not n:
            continue
        touched_cols += 1
        total_rows += n
        print(f"  {t}.{col} [{dt}]: {n} row(s)")
        if APPLY:
            cur.execute(upd, (OLD_DOMAIN, NEW_DOMAIN, like))
    if APPLY:
        conn.commit()
        print(f"\n  Rewrote {total_rows} value(s) across {touched_cols} column(s).")
    else:
        print(f"\n  Would rewrite {total_rows} value(s) across {touched_cols} column(s).")
    conn.close()
except Exception as e:
    print(f"  DB ERROR: {type(e).__name__}: {e}")
    sys.exit(1)

print()
print("=" * 64)
print("Done." if APPLY else "Dry-run complete. Re-run with --apply to execute.")
