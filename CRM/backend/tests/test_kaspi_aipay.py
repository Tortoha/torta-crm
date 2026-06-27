"""Pure-logic unit tests for the Kaspi (via AiPay) payment integration.

These mirror the small pure helpers in External/main.py
(`_AIPAY_STATUS_BY_CODE`, `_aipay_canonical_status`) and the amount/terminal-state
rules used by place_order. The live modules can't be imported here (the DB pool
is created at import time), so the reference logic is replicated below and MUST
be kept in sync with External/main.py. Live HTTP + e2e are verified in the AiPay
sandbox (see Notes/Kaspi Integration), not here.

Run: pytest CRM/backend/tests/test_kaspi_aipay.py
"""

# ── Reference logic (keep in sync with External/main.py) ───────────────────
_AIPAY_STATUS_BY_CODE = {
    1: "created", 2: "pending", 3: "no_account", 5: "canceled",
    7: "expired", 8: "canceled", 9: "paid", 11: "refunded", 12: "rejected",
}


def _aipay_canonical_status(inv: dict) -> str:
    s = (inv.get("status") or "").strip().lower()
    if s:
        return s
    return _AIPAY_STATUS_BY_CODE.get(inv.get("status_code"), "unknown")


# Terminal success state place_order accepts for kaspi_aipay.
_KASPI_TERMINAL = {"paid"}
# Providers whose amounts are in MINOR units (÷100). kaspi_aipay is NOT here →
# its tenge amount is compared as-is.
_MINOR_UNIT_PROVIDERS = {"stripe"}   # only Stripe divides by 100 in place_order


# ── status_code → canonical mapping ────────────────────────────────────────
def test_status_code_9_is_paid():
    assert _aipay_canonical_status({"status_code": 9}) == "paid"


def test_all_status_codes_map():
    assert _aipay_canonical_status({"status_code": 1}) == "created"
    assert _aipay_canonical_status({"status_code": 2}) == "pending"
    assert _aipay_canonical_status({"status_code": 3}) == "no_account"
    assert _aipay_canonical_status({"status_code": 5}) == "canceled"
    assert _aipay_canonical_status({"status_code": 7}) == "expired"
    assert _aipay_canonical_status({"status_code": 8}) == "canceled"
    assert _aipay_canonical_status({"status_code": 11}) == "refunded"
    assert _aipay_canonical_status({"status_code": 12}) == "rejected"


def test_unknown_status_code_is_unknown():
    assert _aipay_canonical_status({"status_code": 999}) == "unknown"
    assert _aipay_canonical_status({}) == "unknown"


def test_string_status_takes_precedence():
    # When AiPay returns a string status we trust it over the numeric code.
    assert _aipay_canonical_status({"status": "Paid", "status_code": 2}) == "paid"
    assert _aipay_canonical_status({"status": "EXPIRED"}) == "expired"


# ── only "paid" is terminal success (never ship on a non-paid status) ──────
def test_only_paid_is_terminal():
    assert "paid" in _KASPI_TERMINAL
    for s in ("pending", "created", "expired", "canceled", "rejected",
              "no_account", "refunded", "unknown"):
        assert s not in _KASPI_TERMINAL, f"{s} must NOT be treated as paid"


# ── amount is whole tenge, NOT minor units (no ÷100) ───────────────────────
def test_kaspi_amount_is_not_minor_units():
    assert "kaspi_aipay" not in _MINOR_UNIT_PROVIDERS


def test_tenge_amount_matches_cart_total():
    # place_order: provider_amount (tenge) compared to cart total within 0.02.
    cart_total = 5000.0           # 5000 ₸ store price
    provider_amount = 5000        # AiPay invoice amount, whole tenge
    provider_value = float(provider_amount)   # kaspi → major-unit branch (no /100)
    assert abs(provider_value - cart_total) <= 0.02


def test_amount_mismatch_is_rejected():
    cart_total = 5000.0
    provider_amount = 4000        # customer underpaid / cart changed
    assert abs(float(provider_amount) - cart_total) > 0.02
