"""Pure-logic unit tests for Halyk ePay status mapping.

Mirrors External/main.py `_HALYK_STATUS` (keep in sync — the live module can't be
imported here; DB pool is created at import). CHARGE = funds debited (paid);
AUTH = amount only HELD (2-step), which must NOT be treated as paid. Live HTTP +
e2e are verified in Halyk test mode (see Notes/Kaspi Integration), not here.

Run: pytest CRM/backend/tests/test_halyk_epay.py
"""

# ── Reference logic (keep in sync with External/main.py) ───────────────────
_HALYK_STATUS = {
    "charge": "paid", "auth": "pending", "new": "pending", "3d": "pending",
    "verified": "pending", "cancel": "canceled", "reject": "failed",
    "failed": "failed", "refund": "refunded",
}
_HALYK_TERMINAL = {"paid"}
_MINOR_UNIT_PROVIDERS = {"stripe"}   # only Stripe divides by 100 in place_order


def test_charge_is_paid():
    assert _HALYK_STATUS["charge"] == "paid"


def test_auth_is_not_paid():
    # AUTH = amount only held (2-step) — shipping on AUTH = free goods if capture fails.
    assert _HALYK_STATUS["auth"] == "pending"
    assert _HALYK_STATUS["auth"] not in _HALYK_TERMINAL


def test_failure_and_refund_states():
    assert _HALYK_STATUS["reject"] == "failed"
    assert _HALYK_STATUS["failed"] == "failed"
    assert _HALYK_STATUS["cancel"] == "canceled"
    assert _HALYK_STATUS["refund"] == "refunded"


def test_unknown_defaults_pending():
    assert _HALYK_STATUS.get("weird", "pending") == "pending"


def test_only_paid_is_terminal():
    for s in ("pending", "auth", "failed", "canceled", "refunded", "new", "3d"):
        assert s not in _HALYK_TERMINAL, f"{s} must NOT be treated as paid"


def test_amount_is_major_units():
    assert "halyk_epay" not in _MINOR_UNIT_PROVIDERS   # KZT compared directly, no /100
