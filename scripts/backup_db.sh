#!/usr/bin/env bash
# Nightly Postgres backup → Cloudflare R2 (off-Neon disaster copy).
#
# Neon already does automatic PITR (point-in-time recovery — 7 days on free,
# longer on paid). VERIFY it's enabled in the Neon console first. This script is
# belt-and-suspenders: an independent, portable copy in R2 you control, in case
# you ever leave Neon or its history window is too short.
#
# Schedule via cron (03:17 UTC daily):
#   17 3 * * * /opt/scripts/backup_db.sh >> /var/log/db_backup.log 2>&1
#
# Requires (export these, or source an .env before running):
#   DATABASE_URL           Postgres conn string (Neon — use the DIRECT, non-pooled URL)
#   R2_BUCKET              e.g. torta-backups
#   R2_ENDPOINT           https://<account-id>.r2.cloudflarestorage.com
#   AWS_ACCESS_KEY_ID      R2 access key id      (aws-cli speaks R2's S3 API)
#   AWS_SECRET_ACCESS_KEY  R2 secret access key
# Tools: postgresql-client (pg_dump), awscli, gzip.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL not set}"
: "${R2_BUCKET:?R2_BUCKET not set}"
: "${R2_ENDPOINT:?R2_ENDPOINT not set}"

TS=$(date -u +%Y%m%d-%H%M%S)
DIR=${BACKUP_DIR:-/var/backups/torta}
KEEP=${BACKUP_KEEP:-14}
mkdir -p "$DIR"
FILE="$DIR/crmdb-$TS.sql.gz"

echo "[backup] $(date -u) — dumping → $FILE"
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip -9 > "$FILE"

SIZE=$(du -h "$FILE" | cut -f1)
echo "[backup] dumped $SIZE — uploading → s3://$R2_BUCKET/db/"
aws s3 cp "$FILE" "s3://$R2_BUCKET/db/" --endpoint-url "$R2_ENDPOINT"

# Prune local copies beyond the last $KEEP.
ls -1t "$DIR"/crmdb-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "[backup] done — $SIZE uploaded, kept last $KEEP local."

# Optional: also back up the SES VPS SQLite (registered domains / DKIM state).
# Uncomment if this runs on the SES VPS:
#   sqlite3 /opt/ses/domains.db ".backup '$DIR/ses-domains-$TS.db'"
#   aws s3 cp "$DIR/ses-domains-$TS.db" "s3://$R2_BUCKET/ses/" --endpoint-url "$R2_ENDPOINT"
