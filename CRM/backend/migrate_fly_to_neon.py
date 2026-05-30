"""One-off migration: Fly Postgres -> Neon.

Dumps the Fly production DB (reached via `fly proxy`) and restores it into
Neon, giving an exact copy. Zero-downtime in practice because nobody is
writing to prod during the cutover.

Prereqs (you run these first):
  1. In a SEPARATE terminal, open the Fly Postgres tunnel and KEEP IT OPEN:
       fly proxy 5433:5432 -a torta-db
  2. Get the Fly Postgres password:
       fly ssh console -a torta-crm-backend -C "printenv DATABASE_URL"
     (prints postgres://postgres:PASSWORD@torta-db.flycast:5432/crmdb)
  3. In CRM/backend/.env add a TEMPORARY line (remove after migration):
       FLY_DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5433/crmdb
     (note: host=localhost:5433 — the proxy — and the PASSWORD from step 2)

Then:
  python migrate_fly_to_neon.py            # dry-run: shows row counts both sides
  python migrate_fly_to_neon.py --apply    # wipe Neon + dump Fly + restore

DATABASE_URL in .env must point at Neon (it does). Delete this script + the
FLY_DATABASE_URL line once verified.
"""
import io
import os
import subprocess
import sys
import tempfile

import psycopg2
import psycopg2.extras

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
APPLY = "--apply" in sys.argv

PG_BIN  = r"C:\Program Files\PostgreSQL\18\pgAdmin 4\runtime"
PG_DUMP = os.path.join(PG_BIN, "pg_dump.exe")
PSQL    = os.path.join(PG_BIN, "psql.exe")

ENV = os.path.join(os.path.dirname(__file__), ".env")
env: dict[str, str] = {}
if os.path.exists(ENV):
    with open(ENV, "r", encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")

SRC = env.get("FLY_DATABASE_URL", "")   # Fly (via proxy localhost:5433)
DST = env.get("DATABASE_URL", "")       # Neon

def mask(url: str) -> str:
    import re
    return re.sub(r"//([^:]+):[^@]+@", r"//\1:****@", url)

print("=" * 64)
print(f"Fly -> Neon migration   ({'APPLY' if APPLY else 'DRY-RUN'})")
print("=" * 64)
print(f"  SRC (Fly):  {mask(SRC)}")
print(f"  DST (Neon): {mask(DST)}")
print()

if not SRC:
    print("  ERROR: FLY_DATABASE_URL not set in .env (see header for steps).")
    sys.exit(1)
if not DST or "neon.tech" not in DST:
    print("  ERROR: DATABASE_URL must point at Neon.")
    sys.exit(1)

def counts(url: str, label: str) -> dict:
    out = {}
    try:
        c = psycopg2.connect(url)
        cur = c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT relname, n_live_tup FROM pg_stat_user_tables
             WHERE n_live_tup > 0 ORDER BY n_live_tup DESC LIMIT 12
        """)
        for r in cur.fetchall():
            out[r["relname"]] = r["n_live_tup"]
        cur.execute("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema='public'")
        out["__tables__"] = cur.fetchone()["n"]
        c.close()
    except Exception as e:
        print(f"  {label} connect failed: {type(e).__name__}: {e}")
    return out

print("-" * 64)
print("Row counts (top tables)")
print("-" * 64)
src_c = counts(SRC, "SRC")
print(f"  Fly:  {src_c.get('__tables__', '?')} tables | " +
      ", ".join(f"{k}={v}" for k, v in src_c.items() if k != "__tables__"))
dst_c = counts(DST, "DST")
print(f"  Neon: {dst_c.get('__tables__', '?')} tables | " +
      ", ".join(f"{k}={v}" for k, v in dst_c.items() if k != "__tables__"))
print()

if not APPLY:
    print("Dry-run complete. Re-run with --apply to migrate.")
    sys.exit(0)

# ── APPLY ──
print("-" * 64)
print("Applying migration")
print("-" * 64)

# 1. Wipe Neon's public schema for a clean restore.
print("  [1/3] Wiping Neon public schema...")
r = subprocess.run([PSQL, DST, "-v", "ON_ERROR_STOP=1", "-c",
                    "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"],
                   capture_output=True, text=True)
if r.returncode != 0:
    print(f"    FAILED: {r.stderr[:500]}")
    sys.exit(1)

# 2. Dump Fly to a temp file (schema + data, no ownership/grants — Neon role differs).
dump_path = os.path.join(tempfile.gettempdir(), "fly_dump.sql")
print(f"  [2/3] Dumping Fly -> {dump_path} ...")
r = subprocess.run([PG_DUMP, SRC, "--no-owner", "--no-acl", "--no-comments",
                    "-f", dump_path],
                   capture_output=True, text=True)
if r.returncode != 0:
    print(f"    FAILED: {r.stderr[:500]}")
    sys.exit(1)
print(f"    dump size: {os.path.getsize(dump_path):,} bytes")

# 3. Restore into Neon.
print("  [3/3] Restoring into Neon...")
r = subprocess.run([PSQL, DST, "-f", dump_path],
                   capture_output=True, text=True)
# psql -f reports notices on stderr; only fail on a real error string.
if "ERROR" in (r.stderr or "") and r.returncode != 0:
    print(f"    completed with errors (first 800 chars):\n{r.stderr[:800]}")
else:
    print("    restore done.")

# Verify.
print()
print("-" * 64)
print("Verify (Neon after restore)")
print("-" * 64)
after = counts(DST, "DST")
print(f"  Neon: {after.get('__tables__', '?')} tables | " +
      ", ".join(f"{k}={v}" for k, v in after.items() if k != "__tables__"))
print()
print("Done. Compare Fly vs Neon counts above — they should match.")
print("Then: remove FLY_DATABASE_URL from .env, delete this script.")
