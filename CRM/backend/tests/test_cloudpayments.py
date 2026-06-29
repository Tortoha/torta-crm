"""Pure-logic unit tests for the CloudPayments / TipTop Pay status map + webhook HMAC.

Gateway rebranded CloudPayments KZ → TipTop Pay (2026); internal id stays
`cloudpayments` and the REST API stayed CloudPayments-compatible, so the status map
+ Content-HMAC scheme are UNCHANGED — these still mirror External/main.py
`_CP_STATUS` and `cloudpayments_verify_hmac` (keep in sync — the live module can't
be imported here; the DB pool is created at import).
Completed = funds captured (paid); Authorized = 2-stage HOLD that must NOT be
treated as paid. CloudPayments amounts are MAJOR units (KZT/RUB decimal), never
minor. Live HTTP + e2e are verified in CloudPayments test mode (see
Notes/Kaspi Integration), not here.

Run: pytest CRM/backend/tests/test_cloudpayments.py
"""

import base64
import hashlib
import hmac


# ── Reference logic (keep in sync with External/main.py) ───────────────────
_CP_STATUS = {
    "completed": "paid", "authorized": "pending", "awaitingauthentication": "pending",
    "cancelled": "canceled", "declined": "failed",
}
_CP_TERMINAL = {"paid"}
_MINOR_UNIT_PROVIDERS = {"stripe"}   # only Stripe divides by 100 in place_order


def _cp_verify_hmac(raw_body: bytes, header_hmac: str, api_secret: str) -> bool:
    if not header_hmac or not api_secret:
        return False
    digest = hmac.new(api_secret.encode("utf-8"), raw_body, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode("ascii")
    return hmac.compare_digest(expected, header_hmac.strip())


def _sign(raw_body: bytes, secret: str) -> str:
    return base64.b64encode(
        hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).digest()
    ).decode("ascii")


# ── Status mapping ─────────────────────────────────────────────────────────
def test_completed_is_paid():
    assert _CP_STATUS["completed"] == "paid"


def test_authorized_is_not_paid():
    # Authorized = amount only HELD (2-stage). Shipping on Authorized = free goods
    # if the capture (Confirm) never happens.
    assert _CP_STATUS["authorized"] == "pending"
    assert _CP_STATUS["authorized"] not in _CP_TERMINAL


def test_failure_states():
    assert _CP_STATUS["declined"] == "failed"
    assert _CP_STATUS["cancelled"] == "canceled"


def test_unknown_defaults_pending():
    assert _CP_STATUS.get("weird", "pending") == "pending"


def test_only_completed_is_terminal():
    for raw, canonical in _CP_STATUS.items():
        if raw == "completed":
            assert canonical in _CP_TERMINAL
        else:
            assert canonical not in _CP_TERMINAL, f"{raw} must NOT be treated as paid"


def test_amount_is_major_units():
    # CloudPayments returns KZT/RUB in MAJOR units — must NOT be divided by 100.
    assert "cloudpayments" not in _MINOR_UNIT_PROVIDERS


# ── Webhook HMAC (Content-HMAC = Base64(HMAC-SHA256(body, api_secret))) ─────
def test_hmac_valid_signature_passes():
    body = b"TransactionId=123&Amount=1000.00&Currency=KZT&InvoiceId=000000000123&Status=Completed"
    secret = "test_api_secret"
    assert _cp_verify_hmac(body, _sign(body, secret), secret) is True


def test_hmac_wrong_secret_fails():
    body = b"TransactionId=123&Amount=1000.00&InvoiceId=000000000123"
    # Signature computed with the attacker's secret must not validate against ours.
    assert _cp_verify_hmac(body, _sign(body, "attacker_secret"), "real_secret") is False


def test_hmac_tampered_body_fails():
    secret = "s3cr3t"
    sig = _sign(b"Amount=1000.00&InvoiceId=1", secret)
    # Attacker bumps the amount but reuses the old signature → must fail.
    assert _cp_verify_hmac(b"Amount=9999.00&InvoiceId=1", sig, secret) is False


def test_hmac_empty_inputs_fail():
    assert _cp_verify_hmac(b"x", "", "secret") is False
    assert _cp_verify_hmac(b"x", "somesig", "") is False


def test_hmac_known_vector():
    # Deterministic vector — guards against accidental algorithm drift.
    expected = base64.b64encode(
        hmac.new(b"key", b"hello", hashlib.sha256).digest()
    ).decode("ascii")
    assert _sign(b"hello", "key") == expected
    assert _cp_verify_hmac(b"hello", expected, "key") is True
