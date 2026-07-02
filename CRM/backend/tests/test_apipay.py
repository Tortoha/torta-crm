"""Pure-logic unit tests for the Kaspi (via ApiPay) payment integration.

Mirror the small pure helpers in External/main.py (`_APIPAY_STATUS_MAP`,
`_apipay_canonical_status`, `_apipay_amount`, `apipay_verify_webhook`) and the
amount/terminal-state rules used by place_order. The live module can't be imported
here (the DB pool is created at import), so the reference logic is replicated below
and MUST be kept in sync with External/main.py. Live HTTP + e2e are verified in the
ApiPay sandbox (see Notes/Kaspi Integration), not here.

Run: pytest CRM/backend/tests/test_apipay.py
"""

import hashlib
import hmac


# ── Reference logic (keep in sync with External/main.py) ───────────────────
_APIPAY_STATUS_MAP = {
    "pending": "pending", "processing": "pending", "cancelling": "pending",
    "paid": "paid", "partially_refunded": "paid",
    "cancelled": "canceled", "expired": "expired", "error": "error",
}


def _apipay_canonical_status(inv: dict) -> str:
    s = (inv.get("status") or "").strip().lower()
    return _APIPAY_STATUS_MAP.get(s, s or "unknown")


def _apipay_amount(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def apipay_verify_webhook(raw_body: bytes, signature_header: str, secret: str) -> bool:
    sig = (signature_header or "").strip()
    if not sig or not secret or not raw_body:
        return False
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    try:
        return hmac.compare_digest(expected, sig)
    except Exception:
        return False


def _sign(raw_body: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()


# Terminal success state place_order accepts for apipay.
_APIPAY_TERMINAL = {"paid"}
# Providers whose amounts are MINOR units (÷100). apipay is NOT here → its tenge
# amount (a decimal string) is compared as-is.
_MINOR_UNIT_PROVIDERS = {"stripe"}


# ── status → canonical mapping ─────────────────────────────────────────────
def test_paid_is_paid():
    assert _apipay_canonical_status({"status": "paid"}) == "paid"


def test_partially_refunded_is_paid():
    # Money WAS collected → still counts as paid (a later partial refund never
    # un-pays the order). Must not be treated as unpaid.
    assert _apipay_canonical_status({"status": "partially_refunded"}) == "paid"


def test_pending_family():
    for s in ("pending", "processing", "cancelling"):
        assert _apipay_canonical_status({"status": s}) == "pending"


def test_failure_states():
    assert _apipay_canonical_status({"status": "cancelled"}) == "canceled"
    assert _apipay_canonical_status({"status": "expired"}) == "expired"
    assert _apipay_canonical_status({"status": "error"}) == "error"


def test_status_is_case_insensitive():
    assert _apipay_canonical_status({"status": "PAID"}) == "paid"
    assert _apipay_canonical_status({"status": "  Paid "}) == "paid"


def test_unknown_status():
    assert _apipay_canonical_status({"status": "weird"}) == "weird"
    assert _apipay_canonical_status({}) == "unknown"


# ── only "paid" is terminal success (never ship on a non-paid status) ──────
def test_only_paid_is_terminal():
    assert "paid" in _APIPAY_TERMINAL
    for raw, canonical in _APIPAY_STATUS_MAP.items():
        if canonical == "paid":
            assert canonical in _APIPAY_TERMINAL
        else:
            assert canonical not in _APIPAY_TERMINAL, f"{raw} must NOT be treated as paid"


# ── amount is whole tenge (decimal string), NOT minor units (no ÷100) ──────
def test_apipay_amount_is_not_minor_units():
    assert "apipay" not in _MINOR_UNIT_PROVIDERS


def test_amount_string_parses_to_major_tenge():
    # ApiPay returns amount as a decimal STRING in whole tenge.
    assert _apipay_amount("5000.00") == 5000.0
    assert _apipay_amount(5000) == 5000.0
    assert _apipay_amount(None) == 0.0
    assert _apipay_amount("garbage") == 0.0


def test_tenge_amount_matches_cart_total():
    cart_total = 5000.0
    provider_amount = _apipay_amount("5000.00")   # major-unit branch (no /100)
    assert abs(provider_amount - cart_total) <= 0.02


def test_amount_mismatch_is_rejected():
    cart_total = 5000.0
    provider_amount = _apipay_amount("4000.00")   # customer underpaid / cart changed
    assert abs(provider_amount - cart_total) > 0.02


# ── Webhook HMAC: X-Webhook-Signature = "sha256=" + hex(HMAC-SHA256(body, secret)) ─
def test_hmac_valid_signature_passes():
    body = b'{"event":"invoice.status_changed","invoice":{"id":1,"status":"paid","amount":"5000.00"}}'
    secret = "test_webhook_secret"
    assert apipay_verify_webhook(body, _sign(body, secret), secret) is True


def test_hmac_wrong_secret_fails():
    body = b'{"invoice":{"id":1,"status":"paid"}}'
    assert apipay_verify_webhook(body, _sign(body, "attacker_secret"), "real_secret") is False


def test_hmac_tampered_body_fails():
    secret = "s3cr3t"
    sig = _sign(b'{"invoice":{"id":1,"amount":"1000.00"}}', secret)
    # Attacker bumps the amount but reuses the old signature → must fail.
    assert apipay_verify_webhook(b'{"invoice":{"id":1,"amount":"9999.00"}}', sig, secret) is False


def test_hmac_empty_inputs_fail():
    assert apipay_verify_webhook(b"x", "", "secret") is False
    assert apipay_verify_webhook(b"x", "somesig", "") is False
    assert apipay_verify_webhook(b"", "sha256=deadbeef", "secret") is False


def test_hmac_known_vector():
    # Deterministic vector — guards against algorithm drift (hex, not base64).
    expected = "sha256=" + hmac.new(b"key", b"hello", hashlib.sha256).hexdigest()
    assert _sign(b"hello", "key") == expected
    assert apipay_verify_webhook(b"hello", expected, "key") is True
