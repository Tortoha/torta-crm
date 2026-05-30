"""Find (and optionally delete) orphaned storage objects — objects in R2 that
are NOT referenced by any DB column (text / jsonb / array).

Run:  python cleanup_orphans.py            (report only)
      python cleanup_orphans.py --delete   (delete the orphans)

⚠️ The bucket is shared across environments. Run against the SAME DB whose
objects live in this bucket. Review the orphan list before --delete.
"""
import io
import os
import sys

import boto3
import psycopg2
import psycopg2.extras

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
DELETE = "--delete" in sys.argv

ENV = os.path.join(os.path.dirname(__file__), ".env")
env: dict[str, str] = {}
if os.path.exists(ENV):
    with open(ENV, "r", encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")

R2_ENDPOINT = env.get("R2_ENDPOINT", "")
R2_KEY      = env.get("R2_ACCESS_KEY_ID", "")
R2_SECRET   = env.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET   = env.get("R2_BUCKET", "torta-crm")

r2 = boto3.client("s3", endpoint_url=R2_ENDPOINT, region_name="auto",
                  aws_access_key_id=R2_KEY, aws_secret_access_key=R2_SECRET)

# All object keys in the bucket.
keys = []
sizes = {}
paginator = r2.get_paginator("list_objects_v2")
for page in paginator.paginate(Bucket=R2_BUCKET):
    for o in (page.get("Contents") or []):
        keys.append(o["Key"])
        sizes[o["Key"]] = int(o.get("Size") or 0)

# All DB text content that could reference an object key.
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
""")
blobs = []
for x in cur.fetchall():
    t, col, dt = x["table_name"], x["column_name"], x["data_type"]
    if dt in ("jsonb", "json"):
        expr = f'"{col}"::text'
    elif dt == "ARRAY":
        expr = f"array_to_string(\"{col}\", chr(10))"
    else:
        expr = f'"{col}"'
    try:
        cur.execute(f'SELECT string_agg({expr}, chr(10)) AS v FROM "{t}"')
        v = cur.fetchone()["v"]
        if v:
            blobs.append(v)
    except Exception:
        conn.rollback()
haystack = "\n".join(blobs)

orphans = [k for k in keys if k not in haystack]
orphan_bytes = sum(sizes[k] for k in orphans)

print("=" * 64)
print(f"R2 objects: {len(keys)} | referenced: {len(keys)-len(orphans)} | "
      f"ORPHANED: {len(orphans)} ({orphan_bytes/1024:.0f} KB)")
print("=" * 64)
# Group orphans by top-level prefix to spot the pattern (email? products?).
from collections import Counter
groups = Counter("/".join(k.split("/")[:1]) for k in orphans)
print("orphans by prefix:")
for g, n in groups.most_common():
    print(f"  {g}/ : {n}")
print("\n--- orphan keys ---")
for k in orphans:
    print(f"  {sizes[k]:>9,} B  {k}")

if DELETE and orphans:
    print("\nDeleting orphans...")
    for i in range(0, len(orphans), 1000):
        chunk = orphans[i:i+1000]
        r2.delete_objects(Bucket=R2_BUCKET,
                          Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True})
    print(f"Deleted {len(orphans)} orphaned objects ({orphan_bytes/1024:.0f} KB freed).")
elif orphans:
    print("\nReport only. Re-run with --delete to remove these.")

conn.close()
