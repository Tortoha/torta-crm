"""Pure-logic unit tests for the PayPal Orders v2 integration.

Mirrors External/main.py `_paypal_extract` + the status logic (keep in sync — the
live module can't be imported here; the DB pool is created at import). PayPal
intent=CAPTURE: status COMPLETED = funds captured (paid); APPROVED = buyer
consented but NOT captured (money has NOT moved — must NOT ship). Amounts are
MAJOR units (decimal string). ⚠️ PayPal does not support KZT. Live HTTP + e2e are
verified in PayPal sandbox (see Notes/Kaspi Integration), not here.

Run: pytest CRM/backend/tests/test_paypal.py
"""

_PAYPAL_TERMINAL = {"COMPLETED"}
_MINOR_UNIT_PROVIDERS = {"stripe"}


def _paypal_extract(order):
    """Mirror of External/main.py _paypal_extract — pulls status + captured amount +
    capture id from an order/capture response."""
    status, amount, currency, capture_id = order.get("status", ""), 0.0, "USD", ""
    for pu in (order.get("purchase_units") or []):
        caps = ((pu.get("payments") or {}).get("captures")) or []
        if caps:
            cap = caps[0]
            capture_id = cap.get("id", "") or capture_id
            amt = cap.get("amount") or {}
            amount = float(amt.get("value", 0) or 0)
            currency = amt.get("currency_code", currency) or currency
        elif pu.get("amount"):
            amount = float(pu["amount"].get("value", 0) or 0)
            currency = pu["amount"].get("currency_code", currency) or currency
    return {"status": status, "amount": amount, "currency": currency, "capture_id": capture_id}


# ── Status: only COMPLETED ships ───────────────────────────────────────────
def test_completed_is_terminal():
    assert "COMPLETED" in _PAYPAL_TERMINAL


def test_approved_is_not_terminal():
    # APPROVED = buyer consented but capture NOT done → money has not moved.
    assert "APPROVED" not in _PAYPAL_TERMINAL


def test_other_statuses_not_terminal():
    for s in ("CREATED", "SAVED", "PAYER_ACTION_REQUIRED", "VOIDED"):
        assert s not in _PAYPAL_TERMINAL


# ── Amount + capture extraction ────────────────────────────────────────────
def test_extract_captured_amount_and_id():
    order = {
        "status": "COMPLETED",
        "purchase_units": [{
            "payments": {"captures": [
                {"id": "CAP123", "amount": {"value": "100.00", "currency_code": "USD"}}
            ]},
        }],
    }
    info = _paypal_extract(order)
    assert info["status"] == "COMPLETED"
    assert info["amount"] == 100.0          # MAJOR units — not divided by 100
    assert info["currency"] == "USD"
    assert info["capture_id"] == "CAP123"


def test_extract_order_amount_when_not_captured():
    # Before capture (APPROVED), the amount comes from purchase_units[].amount.
    order = {"status": "APPROVED",
             "purchase_units": [{"amount": {"value": "49.99", "currency_code": "EUR"}}]}
    info = _paypal_extract(order)
    assert info["status"] == "APPROVED"
    assert info["amount"] == 49.99
    assert info["currency"] == "EUR"
    assert info["capture_id"] == ""         # no capture yet → nothing to refund


def test_amount_is_major_units():
    assert "paypal" not in _MINOR_UNIT_PROVIDERS


def test_capture_id_is_charge_id_for_refunds():
    # The refund path (POST /v2/payments/captures/{id}/refund) needs the CAPTURE id,
    # not the order id — get_intent returns it as charge_id.
    order = {"status": "COMPLETED", "purchase_units": [{
        "payments": {"captures": [{"id": "8AB", "amount": {"value": "5.00", "currency_code": "USD"}}]}}]}
    assert _paypal_extract(order)["capture_id"] == "8AB"
