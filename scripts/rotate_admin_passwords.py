#!/usr/bin/env python3
r"""
Rotate the locked admin account's passwords (CRM login + Admin panel).

WHY: the original bootstrap passwords were hardcoded in source and are therefore
permanently exposed in git history. Moving them to env vars does NOT un-leak
them — the only real fix is to change the actual account passwords. The app's
bootstrap is create/heal-only (it never overwrites an existing admin_password),
so rotation has to update the DB row directly. This script does that with the
EXACT same scrypt parameters the backend's hash_pw() uses, then revokes every
existing refresh-token session (a session opened with the leaked password must
die too).

SECURITY: new passwords are read interactively with getpass — they never appear
in argv, shell history, this file, or any log. Nothing is printed except a
count summary.

USAGE (run once, locally, against PRODUCTION):
    # PowerShell:
    $env:DATABASE_URL = "postgresql://USER:PASS@HOST/DB?sslmode=require"   # prod Neon
    python scripts/rotate_admin_passwords.py
    Remove-Item Env:\DATABASE_URL                                          # clear after

    # bash:
    DATABASE_URL="postgresql://USER:PASS@HOST/DB?sslmode=require" \
        python scripts/rotate_admin_passwords.py

Optional env:
    ADMIN_LOCKED_EMAIL   target account (default: iskandersuleiemenov@gmail.com)

After running: also update the Cloud Run bootstrap env vars
(ADMIN_CRM_BOOTSTRAP_PASSWORD / ADMIN_BOOTSTRAP_PASSWORD) to the NEW values so a
future fresh-DB seed never reuses the leaked ones — set them via a method that
doesn't land in shell history (Cloud Console UI or Secret Manager).
"""
import base64
import getpass
import hashlib
import os
import secrets
import sys

# ── Exact mirror of CRM/backend/main.py hash_pw() — keep in sync ──────────────
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2 ** 14, 8, 1


def hash_pw(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt,
                       n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return f"$scrypt${base64.b64encode(salt).decode()}${base64.b64encode(h).decode()}"


def verify_pw(pw: str, stored: str) -> bool:
    try:
        _, _, salt_b64, hash_b64 = stored.split("$", 3)
        salt = base64.b64decode(salt_b64)
        want = base64.b64decode(hash_b64)
        got = hashlib.scrypt(pw.encode(), salt=salt,
                             n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
        import hmac
        return hmac.compare_digest(want, got)
    except Exception:
        return False


def _prompt_new(label: str) -> str:
    """Prompt twice for a new password; WARN (don't hard-block) on weak choices
    so the operator can make an informed call; never echoes."""
    while True:
        p1 = getpass.getpass(f"New {label} password: ")
        if not p1:
            print("  ! empty — try again")
            continue
        if " " in p1:
            print("  ! no spaces allowed — try again")
            continue
        weak = []
        if len(p1) < 12:
            weak.append("shorter than 12 chars")
        if not any(c.isalpha() for c in p1) or not any(c.isdigit() for c in p1):
            weak.append("missing a letter or a digit")
        if weak:
            ans = input(f"  ! weak password ({', '.join(weak)}). Use it anyway? [y/N] ").strip().lower()
            if ans not in ("y", "yes"):
                continue
        p2 = getpass.getpass(f"Confirm {label} password: ")
        if p1 != p2:
            print("  ! the two entries differ — try again")
            continue
        return p1


def main() -> int:
    db_url = os.getenv("DATABASE_URL", "").strip()
    if not db_url:
        print("ERROR: set DATABASE_URL to the PRODUCTION connection string first.")
        return 2

    target_email = os.getenv("ADMIN_LOCKED_EMAIL",
                             "iskandersuleiemenov@gmail.com").lower().strip()

    try:
        import psycopg2
        from psycopg2.extras import RealDictCursor
    except ImportError:
        print("ERROR: psycopg2 not installed. `pip install psycopg2-binary`")
        return 2

    # Connect + confirm exactly one matching account BEFORE asking for anything.
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT id, email FROM crm_users WHERE LOWER(email) = LOWER(%s)",
                (target_email,))
            rows = cur.fetchall()
        if len(rows) != 1:
            print(f"ERROR: expected exactly 1 account for {target_email!r}, "
                  f"found {len(rows)}. Aborting (check the DB / email).")
            return 1
        user_id = rows[0]["id"]
        print(f"Rotating passwords for: {rows[0]['email']}  (id={user_id})")
        print("Enter the NEW passwords (input hidden):\n")

        crm_pw = _prompt_new("CRM login")
        admin_pw = _prompt_new("Admin panel")

        crm_hash = hash_pw(crm_pw)
        admin_hash = hash_pw(admin_pw)
        # Sanity: the freshly computed hashes must verify with the same params.
        assert verify_pw(crm_pw, crm_hash) and verify_pw(admin_pw, admin_hash), \
            "internal hashing/verify mismatch — aborting"

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE crm_users SET password = %s, admin_password = %s WHERE id = %s",
                (crm_hash, admin_hash, user_id))
            updated = cur.rowcount
            # Kill every live session opened with the old (leaked) password.
            revoked = 0
            try:
                cur.execute(
                    "UPDATE crm_refresh_tokens "
                    "SET revoked_at = NOW(), revoke_reason = 'password_rotation' "
                    "WHERE user_id = %s AND revoked_at IS NULL",
                    (user_id,))
                revoked = cur.rowcount
            except Exception as e:
                # Non-fatal: if the table name differs, the password change still stands.
                print(f"  (note: could not revoke refresh tokens: {e})")
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e} — rolled back, nothing changed.")
        return 1
    finally:
        conn.close()

    # Wipe plaintext from memory promptly.
    del crm_pw, admin_pw, crm_hash, admin_hash
    print(f"\nDONE. Updated {updated} account row, revoked {revoked} active session(s).")
    print("Old (git-history) passwords no longer work. Next:")
    print("  1) Log in to CRM and the Admin panel with the new passwords to confirm.")
    print("  2) Update Cloud Run env ADMIN_CRM_BOOTSTRAP_PASSWORD / ADMIN_BOOTSTRAP_PASSWORD")
    print("     to the NEW values (Console/Secret Manager — not shell history).")
    print("  3) If CRM/backend/.env holds the old bootstrap values, update them too.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
