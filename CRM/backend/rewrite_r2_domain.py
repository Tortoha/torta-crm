"""Rewrite image URLs in the DB from the r2.dev public URL to the
cdn.tortacrm.com custom domain. Dynamic scan over text/jsonb/array columns.

Run:  python rewrite_r2_domain.py            (dry-run)
      python rewrite_r2_domain.py --apply     (execute)

Reads DB creds + the OLD r2.dev URL from .env (R2_PUBLIC_URL). Delete after.
"""
import io
import os
import sys

import psycopg2
import psycopg2.extras

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
APPLY = "--apply" in sys.argv

ENV = os.path.join(os.path.dirname(__file__), ".env")
env: dict[str, str] = {}
if os.path.exists(ENV):
    with open(ENV, "r", encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")

# OLD = the r2.dev URL currently stored; NEW = the custom domain.
OLD = "https://pub-88b9f528d3ab4a9f8b4efd4e2fb99f9e.r2.dev"
NEW = "https://cdn.tortacrm.com"

print("=" * 60)
print(f"Rewrite image URLs   ({'APPLY' if APPLY else 'DRY-RUN'})")
print(f"  {OLD}")
print(f"  -> {NEW}")
print("=" * 60)

conn = psycopg2.connect(
    host=env.get("DB_HOST", "localhost"), port=env.get("DB_PORT", "5432"),
    dbname=env.get("DB_NAME", "crmdb"), user=env.get("DB_USER", "postgres"),
    password=env.get("DB_PASSWORD", ""))
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
cur.execute("""
    SELECT table_name, column_name, data_type
      FROM information_schema.columns
     WHERE table_schema='public'
       AND data_type IN ('character varying','text','character','jsonb','json','ARRAY')
     ORDER BY table_name, column_name
""")
like = f"%{OLD}%"
total = 0
cols = 0
for x in cur.fetchall():
    t, col, dt = x["table_name"], x["column_name"], x["data_type"]
    if dt in ("jsonb", "json"):
        test = f'"{col}"::text LIKE %s'
        upd  = f'UPDATE "{t}" SET "{col}" = REPLACE("{col}"::text, %s, %s)::{dt} WHERE "{col}"::text LIKE %s'
    elif dt == "ARRAY":
        test = f'array_to_string("{col}", \',\') LIKE %s'
        upd  = (f'UPDATE "{t}" SET "{col}" = '
                f'ARRAY(SELECT REPLACE(e, %s, %s) FROM unnest("{col}") e) '
                f'WHERE array_to_string("{col}", \',\') LIKE %s')
    else:
        test = f'"{col}" LIKE %s'
        upd  = f'UPDATE "{t}" SET "{col}" = REPLACE("{col}", %s, %s) WHERE "{col}" LIKE %s'
    try:
        cur.execute(f'SELECT COUNT(*) AS n FROM "{t}" WHERE {test}', (like,))
        n = cur.fetchone()["n"]
    except Exception:
        conn.rollback(); continue
    if not n:
        continue
    cols += 1; total += n
    print(f"  {t}.{col} [{dt}]: {n}")
    if APPLY:
        cur.execute(upd, (OLD, NEW, like))
if APPLY:
    conn.commit()
    print(f"\nRewrote {total} value(s) across {cols} column(s).")
else:
    print(f"\nWould rewrite {total} value(s) across {cols} column(s). Add --apply.")
conn.close()
