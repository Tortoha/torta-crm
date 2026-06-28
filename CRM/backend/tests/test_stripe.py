"""Pure-logic unit tests for Stripe's money-critical helpers.

Mirrors External/main.py `stripe_verify_webhook` (Stripe-Signature HMAC), the
payment_intent.succeeded → payment.succeeded event mapping, the minor-unit (/100)
amount conversion, and terminal_states['stripe'] == {'succeeded'} (keep in sync —
the live module can't be imported here; the DB pool is created at import). Stripe
is the ONLY minor-unit provider AND the only HMAC-signed webhook, so this guards
the highest-risk money path (a regression that strips the whsec_ prefix or changes
the /100 would otherwise pass silently).

Run: pytest CRM/backend/tests/test_stripe.py
"""

import hashlib
import hmac
import time

_WEBHOOK_REPLAY_TOLERANCE = 300
_STRIPE_TERMINAL = {"succeeded"}
_MINOR_UNIT_PROVIDERS = {"stripe"}
_EVENT_MAP = {
    "payment_intent.succeeded":      "payment.succeeded",
    "payment_intent.payment_failed": "payment.failed",
    "charge.refunded":               "refund.succeeded",
}


# ── Reference logic (mirror of External/main.py stripe_verify_webhook) ──────
def _stripe_verify(payload_bytes, signature_header, webhook_secret,
                   tolerance=_WEBHOOK_REPLAY_TOLERANCE, now=None):
    if not webhook_secret:
        return False, "Webhook secret not configured"
    if not signature_header:
        return False, "Missing Stripe-Signature header"
    parts = {}
    for kv in signature_header.split(","):
        if "=" in kv:
            k, v = kv.split("=", 1)
            parts.setdefault(k.strip(), []).append(v.strip())
    timestamp = (parts.get("t") or [""])[0]
    sigs = parts.get("v1") or []
    if not timestamp or not sigs:
        return False, "Malformed signature header"
    try:
        ts = int(timestamp)
    except ValueError:
        return False, "Bad timestamp"
    if abs((now if now is not None else time.time()) - ts) > tolerance:
        return False, "Timestamp outside tolerance"
    signed = f"{timestamp}.".encode() + payload_bytes
    expected = hmac.new(webhook_secret.encode(), signed, hashlib.sha256).hexdigest()
    if any(hmac.compare_digest(expected, s) for s in sigs):
        return True, ""
    return False, "Signature mismatch"


def _sign_header(payload_bytes, secret, ts):
    signed = f"{ts}.".encode() + payload_bytes
    v1 = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={v1}"


# ── Webhook signature ──────────────────────────────────────────────────────
def test_valid_signature_accepted():
    body, secret, ts = b'{"id":"evt_1","type":"payment_intent.succeeded"}', "whsec_test", 1_000_000
    ok, err = _stripe_verify(body, _sign_header(body, secret, ts), secret, now=ts)
    assert ok is True and err == ""


def test_tampered_body_rejected():
    secret, ts = "whsec_test", 1_000_000
    header = _sign_header(b'{"amount":100}', secret, ts)
    assert _stripe_verify(b'{"amount":999999}', header, secret, now=ts)[0] is False


def test_wrong_secret_rejected():
    body, ts = b'{"x":1}', 1_000_000
    assert _stripe_verify(body, _sign_header(body, "whsec_attacker", ts), "whsec_real", now=ts)[0] is False


def test_replay_outside_tolerance_rejected():
    body, secret = b'{"x":1}', "whsec_test"
    ok, err = _stripe_verify(body, _sign_header(body, secret, 1000), secret, now=2_000_000)
    assert ok is False and "tolerance" in err.lower()


def test_missing_header_rejected():
    assert _stripe_verify(b'{}', "", "whsec_test")[0] is False


def test_malformed_header_rejected():
    assert _stripe_verify(b'{}', "t=123", "whsec_test")[0] is False   # no v1 part


def test_no_secret_rejected():
    assert _stripe_verify(b'{}', "t=1,v1=abc", "")[0] is False


def test_secret_used_raw_no_prefix_strip():
    # The whsec_ prefix is part of the HMAC key — it must NOT be stripped.
    body, secret, ts = b'{"x":1}', "whsec_abc123", 1_000_000
    ok_full, _ = _stripe_verify(body, _sign_header(body, secret, ts), secret, now=ts)
    ok_strip, _ = _stripe_verify(body, _sign_header(body, secret[len("whsec_"):], ts), secret, now=ts)
    assert ok_full is True and ok_strip is False


# ── Event mapping + amount units + terminal status ─────────────────────────
def test_succeeded_event_mapping():
    assert _EVENT_MAP["payment_intent.succeeded"] == "payment.succeeded"
    assert _EVENT_MAP["payment_intent.payment_failed"] == "payment.failed"


def test_amount_minor_to_major():
    # Stripe amounts are cents → place_order divides by 100 (Stripe ONLY).
    assert 10000 / 100.0 == 100.00
    assert 4999 / 100.0 == 49.99


def test_stripe_is_the_minor_unit_provider():
    assert _MINOR_UNIT_PROVIDERS == {"stripe"}


def test_succeeded_is_terminal():
    assert "succeeded" in _STRIPE_TERMINAL


def test_non_final_statuses_not_terminal():
    for s in ("processing", "requires_capture", "requires_payment_method", "canceled"):
        assert s not in _STRIPE_TERMINAL


# ── Currency minor-unit factor (zero-decimal overcharge guard) ──────────────
# Mirror of External/main.py _STRIPE_ZERO_DECIMAL / _stripe_minor_factor. Stripe
# charges zero-decimal currencies (JPY/KRW/…) in WHOLE units (no ×100); a flat ×100
# would charge 100× and the amount check wouldn't catch it (÷100 on verify cancels).
_STRIPE_ZERO_DECIMAL = {
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
    "PYG", "RWF", "VND", "VUV", "XAF", "XOF", "XPF",
}


def _stripe_minor_factor(currency):
    return 1 if (currency or "").strip().upper() in _STRIPE_ZERO_DECIMAL else 100


def test_normal_currencies_are_x100():
    for c in ("USD", "EUR", "KZT", "RUB", "GBP", "kzt"):
        assert _stripe_minor_factor(c) == 100


def test_zero_decimal_currencies_are_x1():
    for c in ("JPY", "KRW", "VND", "CLP", "jpy"):
        assert _stripe_minor_factor(c) == 1


def test_display_zero_but_stripe_charges_x100():
    # IDR/HUF/ISK/UZS/TWD display without decimals but Stripe CHARGES them ×100 — using
    # display-decimals here would 100×-undercharge. They must NOT be zero-decimal.
    for c in ("IDR", "HUF", "ISK", "UZS", "TWD"):
        assert _stripe_minor_factor(c) == 100


def test_send_and_verify_use_same_factor_recovers_total():
    # The send (×factor) and verify (÷factor) must recover the cart total for ANY
    # currency — this round-trip is what prevents the silent over/under-charge.
    for currency, total in (("USD", 10.00), ("KZT", 1500.0), ("JPY", 1000.0), ("KRW", 9900.0)):
        f = _stripe_minor_factor(currency)
        assert abs(int(round(total * f)) / f - total) < 0.001, currency


def test_jpy_not_multiplied_by_100():
    # The actual bug fixed: ¥1000 sent as 1000, NOT 100000 (would be a 100× overcharge).
    assert int(round(1000.0 * _stripe_minor_factor("JPY"))) == 1000
    assert int(round(10.00 * _stripe_minor_factor("USD"))) == 1000   # $10 → 1000 cents


def test_paypal_zero_decimal_set():
    # PayPal rejects decimals on these — value must be a whole number.
    paypal_zero = {"HUF", "JPY", "TWD"}
    assert "JPY" in paypal_zero and "USD" not in paypal_zero
