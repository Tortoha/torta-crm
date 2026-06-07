#!/usr/bin/env python3
"""Uptime watchdog — runs on the SES VPS (independent of the Cloud Run backends,
so it can still email when a backend is down). Pings each service's health
endpoint; on a state CHANGE (up→down or down→up) it emails the operator via the
local SES API. State is kept in a small file so a flapping service emails once,
not on every run.

Schedule via cron (every 2 min):
    */2 * * * * SES_API_KEY=<key> /opt/ses/venv/bin/python /opt/ses/uptime.py >> /var/log/uptime.log 2>&1

Override any URL/credential via env (defaults assume the tortacrm.com prod hosts):
    SES_API_URL, SES_API_KEY, ALERT_EMAIL, UPTIME_STATE,
    CRM_HEALTH_URL, EXT_HEALTH_URL, STORE_URL, SES_HEALTH_URL
"""
import os, json, urllib.request, urllib.error

SES_API_URL = os.getenv("SES_API_URL", "http://127.0.0.1:2525")
SES_API_KEY = os.getenv("SES_API_KEY", "")
ALERT_EMAIL = os.getenv("ALERT_EMAIL", "iskandersuleiemenov@gmail.com")
STATE_FILE  = os.getenv("UPTIME_STATE", "/tmp/torta_uptime_state.json")

TARGETS = [
    ("CRM API",      os.getenv("CRM_HEALTH_URL", "https://api-crm.tortacrm.com/api/health")),
    ("External API", os.getenv("EXT_HEALTH_URL", "https://api.tortacrm.com/health")),
    ("Storefront",   os.getenv("STORE_URL",      "https://tortacrm.com")),
    ("SES",          os.getenv("SES_HEALTH_URL", "http://127.0.0.1:2525/health")),
]


def check(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "torta-uptime"})
        with urllib.request.urlopen(req, timeout=10) as r:
            code = getattr(r, "status", r.getcode())
            return (200 <= code < 400), f"HTTP {code}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, str(e)[:140]


def _load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(s):
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(s, f)
    except Exception as e:
        print(f"[uptime] state save failed: {e}")


def send_alert(subject, html):
    if not SES_API_KEY:
        print("[uptime] no SES_API_KEY set — cannot email", subject)
        return
    payload = json.dumps({
        "to": ALERT_EMAIL, "subject": subject, "html": html,
        "from_email": "alerts@tortacrm.com", "from_name": "Torta Uptime",
    }).encode()
    req = urllib.request.Request(
        SES_API_URL + "/send", data=payload,
        headers={"Content-Type": "application/json", "X-API-Key": SES_API_KEY})
    try:
        urllib.request.urlopen(req, timeout=15)
        print(f"[uptime] alert sent: {subject}")
    except Exception as e:
        print(f"[uptime] alert email failed: {e}")


def main():
    state = _load_state()
    changes = []
    for label, url in TARGETS:
        up, detail = check(url)
        prev = (state.get(label) or {}).get("up")
        state[label] = {"up": up, "detail": detail}
        status = "UP" if up else "DOWN"
        print(f"[uptime] {label}: {status} ({detail})")
        if prev is not None and up != prev:
            changes.append((label, url, up, detail))
    _save_state(state)
    for label, url, up, detail in changes:
        if up:
            send_alert(f"🟢 RECOVERED: {label}",
                       f"<p><b>{label}</b> is back up.<br>{url}<br>{detail}</p>")
        else:
            send_alert(f"🔴 DOWN: {label}",
                       f"<p><b>{label}</b> is DOWN.<br>{url}<br>{detail}</p>")


if __name__ == "__main__":
    main()
