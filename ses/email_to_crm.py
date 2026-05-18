#!/usr/bin/env python3
"""Postfix pipe target: parse a raw RFC 5322 email from stdin and POST it to
the CRM's email-inbound webhook.

Deployment (on VPS):
  scp email_to_crm.py root@SERVER_IP:/opt/ses/email_to_crm.py
  chmod +x /opt/ses/email_to_crm.py
  Add to /etc/postfix/master.cf:

    torta_crm  unix  -       n       n       -       -       pipe
      flags=DRhu user=nobody argv=/opt/ses/email_to_crm.py ${recipient}

  Add to /etc/postfix/transport:

    chat.tortacrm.com    torta_crm:
    merchant-domain.com  torta_crm:   # for each merchant domain

  Then: postmap /etc/postfix/transport && systemctl reload postfix

Required env (set in /etc/default/ses or systemd unit):
  CRM_BACKEND_URL    — e.g. https://crm.tortacrm.com
  INTERNAL_API_KEY   — must match what CRM backend has

This script is intentionally dependency-free (stdlib only) so it can run with
whatever Python is on the VPS without a venv."""

import email
import email.utils
import json
import os
import sys
import urllib.error
import urllib.request
from email import policy
from email.parser import BytesParser

CRM_BACKEND_URL  = os.environ.get("CRM_BACKEND_URL",  "http://127.0.0.1:8001")
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")
ENDPOINT         = f"{CRM_BACKEND_URL}/api/chat/internal/email-inbound"
MAX_BODY_BYTES   = 2 * 1024 * 1024   # 2 MB — Postfix accepts much more, but we cap to keep DB sane


def _addr_only(header_value: str) -> str:
    """Strip display name from a From/To header, return just `user@domain`."""
    if not header_value:
        return ""
    _, addr = email.utils.parseaddr(header_value)
    return (addr or "").strip().lower()


def _display_name(header_value: str) -> str:
    if not header_value:
        return ""
    name, _ = email.utils.parseaddr(header_value)
    return (name or "").strip()


def _walk_bodies(msg) -> tuple[str, str]:
    """Pull text/plain and text/html parts. Multipart/alternative wins
    text-first. Skips attachments (handled separately if we ever wire them)."""
    text_part, html_part = "", ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = (part.get_content_type() or "").lower()
            cdisp = (part.get("Content-Disposition") or "").lower()
            if "attachment" in cdisp:
                continue
            try:
                payload = part.get_content()
            except Exception:
                payload = part.get_payload(decode=True)
                if isinstance(payload, bytes):
                    payload = payload.decode("utf-8", errors="replace")
                payload = payload or ""
            if ctype == "text/plain" and not text_part:
                text_part = payload
            elif ctype == "text/html" and not html_part:
                html_part = payload
    else:
        ctype = (msg.get_content_type() or "").lower()
        try:
            body = msg.get_content()
        except Exception:
            body = ""
        if ctype == "text/html":
            html_part = body
        else:
            text_part = body
    return text_part, html_part


def _parse_auth_results(header_value: str) -> tuple[bool | None, bool | None]:
    """Postfix-DKIM / opendkim usually appends an Authentication-Results header
    that looks like:
       Authentication-Results: mx.tortacrm.com;
         spf=pass smtp.mailfrom=foo@example.com;
         dkim=pass header.d=example.com
    Return (spf_pass, dkim_pass). None = unknown."""
    if not header_value:
        return None, None
    v = header_value.lower()
    def _flag(scheme: str) -> bool | None:
        if f"{scheme}=pass" in v:    return True
        if f"{scheme}=fail" in v or f"{scheme}=permerror" in v or f"{scheme}=neutral" in v:
            return False
        return None
    return _flag("spf"), _flag("dkim")


def main():
    if not INTERNAL_API_KEY:
        print("ERROR: INTERNAL_API_KEY env var not set", file=sys.stderr)
        sys.exit(75)  # tempfail — Postfix will retry

    recipient = sys.argv[1] if len(sys.argv) > 1 else ""
    if not recipient:
        print("ERROR: no recipient passed (argv[1])", file=sys.stderr)
        sys.exit(78)  # permfail — Postfix bounces

    raw = sys.stdin.buffer.read(MAX_BODY_BYTES + 1)
    if len(raw) > MAX_BODY_BYTES:
        print(f"ERROR: message exceeds {MAX_BODY_BYTES} bytes", file=sys.stderr)
        sys.exit(78)

    try:
        msg = BytesParser(policy=policy.default).parsebytes(raw)
    except Exception as e:
        print(f"ERROR: parse failed: {e}", file=sys.stderr)
        sys.exit(78)

    message_id = (msg.get("Message-Id") or "").strip()
    if not message_id:
        # Synthesise one so the dedup constraint still works
        import hashlib, time
        message_id = f"<missing-{hashlib.sha256(raw).hexdigest()[:12]}@local>"

    from_header = msg.get("From") or ""
    text_body, html_body = _walk_bodies(msg)
    spf_pass, dkim_pass  = _parse_auth_results(msg.get("Authentication-Results"))

    body = {
        "message_id":  message_id,
        "from_email":  _addr_only(from_header),
        "from_name":   _display_name(from_header),
        "to_email":    recipient.strip().lower(),
        "subject":     (msg.get("Subject") or "").strip(),
        "body_text":   text_body[:50_000],
        "body_html":   html_body[:200_000],
        "in_reply_to": (msg.get("In-Reply-To") or "").strip(),
        "references":  (msg.get("References") or "").strip(),
        "raw_size":    len(raw),
        "spf_pass":    spf_pass,
        "dkim_pass":   dkim_pass,
    }

    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body).encode(),
        headers={
            "Content-Type":  "application/json",
            "X-Internal-Key": INTERNAL_API_KEY,
            "User-Agent":    "torta-ses-pipe/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()  # drain
    except urllib.error.HTTPError as e:
        body_bytes = b""
        try: body_bytes = e.read()[:500]
        except Exception: pass
        # 4xx = bad data → permanent fail (don't loop); 5xx = transient
        if 400 <= e.code < 500:
            print(f"PERM: CRM rejected {e.code}: {body_bytes!r}", file=sys.stderr)
            sys.exit(78)
        print(f"TEMP: CRM {e.code}: {body_bytes!r}", file=sys.stderr)
        sys.exit(75)
    except Exception as e:
        print(f"TEMP: CRM unreachable: {e}", file=sys.stderr)
        sys.exit(75)

    sys.exit(0)


if __name__ == "__main__":
    main()
