#!/usr/bin/env python3
"""Money-path smoke tests — run BEFORE every prod deploy.

Deliberately tiny and non-brittle: it does not depend on internal request
models, only on the contracts the storefront actually relies on. Covers
liveness, DB, the two-key security model (both accept AND reject), and that the
payment route is alive (doesn't 500).

Run as a script (exit code 0 = all passed, 1 = a failure):
    SMOKE_API_KEY=<store public key> SMOKE_PK=<pk_...> python tests/smoke_test.py

Or under pytest:
    pip install pytest && SMOKE_API_KEY=... SMOKE_PK=... pytest tests/smoke_test.py -v

Env:
    SMOKE_CRM_URL  default https://api-crm.tortacrm.com
    SMOKE_EXT_URL  default https://api.tortacrm.com
    SMOKE_API_KEY  a TEST store's public key (20 hex). Unset → storefront tests skip.
    SMOKE_PK       that store's publishable key (pk_...).  Unset → storefront tests skip.
"""
import os, json, urllib.request, urllib.error

CRM_URL = os.getenv("SMOKE_CRM_URL", "https://api-crm.tortacrm.com").rstrip("/")
EXT_URL = os.getenv("SMOKE_EXT_URL", "https://api.tortacrm.com").rstrip("/")
API_KEY = os.getenv("SMOKE_API_KEY", "").strip()
PK      = os.getenv("SMOKE_PK", "").strip()


class SmokeSkip(Exception):
    pass


def _skip(reason):
    try:
        import pytest
        pytest.skip(reason)
    except ImportError:
        raise SmokeSkip(reason)


def _req(method, url, headers=None, body=None, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    h = {"User-Agent": "torta-smoke", "Accept": "application/json"}
    if data is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return getattr(r, "status", r.getcode()), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


# ── Liveness (no auth) ────────────────────────────────────────────────
def test_crm_health():
    code, body = _req("GET", f"{CRM_URL}/api/health")
    assert code == 200, f"CRM /api/health → {code}: {body[:200]}"
    assert (json.loads(body).get("components", {}).get("db", {}).get("ok")), f"CRM DB not ok: {body[:200]}"


def test_crm_ready():
    code, _ = _req("GET", f"{CRM_URL}/api/ready")
    assert code == 200, f"CRM /api/ready → {code}"


def test_ext_health():
    code, body = _req("GET", f"{EXT_URL}/health")
    assert code == 200, f"External /health → {code}: {body[:200]}"
    assert json.loads(body).get("db") is True, f"External DB not ok: {body[:200]}"


# ── Two-key security: requests WITHOUT the publishable key are rejected ─
def test_products_rejected_without_pk():
    if not API_KEY:
        _skip("SMOKE_API_KEY not set")
    code, body = _req("GET", f"{EXT_URL}/{API_KEY}/products")  # no X-Publishable-Key
    assert code in (401, 403), f"products WITHOUT pk should be 401/403, got {code}: {body[:200]}"


# ── Two-key security: WITH the publishable key the storefront read works ─
def test_products_ok_with_pk():
    if not (API_KEY and PK):
        _skip("SMOKE_API_KEY / SMOKE_PK not set")
    code, body = _req("GET", f"{EXT_URL}/{API_KEY}/products", headers={"X-Publishable-Key": PK})
    assert code == 200, f"products WITH pk → {code}: {body[:200]}"
    json.loads(body)  # must be valid JSON


# ── Payment route is alive (not crashing). A 4xx is fine — it means the
#    route + provider code path ran and validated; a 5xx = real breakage. ──
def test_payment_route_alive():
    if not (API_KEY and PK):
        _skip("SMOKE_API_KEY / SMOKE_PK not set")
    code, body = _req("POST", f"{EXT_URL}/{API_KEY}/orders/init-payment",
                      headers={"X-Publishable-Key": PK}, body={})
    assert code < 500, f"init-payment 5xx (route is broken) → {code}: {body[:200]}"


# ── Standalone runner ─────────────────────────────────────────────────
if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = failed = skipped = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except SmokeSkip as e:
            print(f"  SKIP  {t.__name__} — {e}")
            skipped += 1
        except AssertionError as e:
            print(f"  FAIL  {t.__name__} — {e}")
            failed += 1
        except Exception as e:
            print(f"  ERROR {t.__name__} — {type(e).__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed, {skipped} skipped")
    raise SystemExit(1 if failed else 0)
