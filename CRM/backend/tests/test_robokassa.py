"""Pure-logic unit tests for Robokassa signatures + status mapping.

Mirrors External/main.py `_robo_hash`, `robokassa_verify_result_sig` and
`_ROBO_STATE` (keep in sync — the live module can't be imported here; the DB pool
is created at import). Robokassa signs with MD5 by default (SHA256/512 are
configurable): init = HASH(login:OutSum:InvId:Password#1); ResultURL =
HASH(OutSum:InvId:Password#2); OpState = HASH(login:InvoiceID:Password#2).
StateCode 100/50 = paid, 20 = HOLD (NOT paid). Amounts are MAJOR units (KZT).
Live HTTP + e2e are verified in Robokassa test mode (see Notes/Kaspi Integration),
not here.

Run: pytest CRM/backend/tests/test_robokassa.py
"""

import hashlib
import hmac


# ── Reference logic (keep in sync with External/main.py) ───────────────────
_ROBO_STATE = {
    100: "paid", 50: "paid", 20: "pending", 5: "pending", 80: "pending",
    10: "canceled", 60: "refunded",
}
_ROBO_TERMINAL = {"paid"}
_MINOR_UNIT_PROVIDERS = {"stripe"}   # only Stripe divides by 100 in place_order


def _robo_hash(algo, s):
    fn = {"md5": hashlib.md5, "sha256": hashlib.sha256,
          "sha512": hashlib.sha512}.get((algo or "md5").lower(), hashlib.md5)
    return fn(s.encode("utf-8")).hexdigest()


def _init_sig(login, out_sum, inv_id, pw1, algo="md5"):
    return _robo_hash(algo, f"{login}:{out_sum}:{inv_id}:{pw1}")


def _result_sig(out_sum, inv_id, pw2, algo="md5"):
    return _robo_hash(algo, f"{out_sum}:{inv_id}:{pw2}")


def _verify_result(out_sum, inv_id, pw2, signature, algo="md5"):
    if not signature:
        return False
    expected = _result_sig(out_sum, inv_id, pw2, algo)
    return hmac.compare_digest(expected.lower(), signature.strip().lower())


# ── Signature formulas (known vectors) ─────────────────────────────────────
def test_init_signature_md5_vector():
    expected = hashlib.md5(b"demo:100.00:5:pass1").hexdigest()
    assert _init_sig("demo", "100.00", "5", "pass1") == expected


def test_result_signature_md5_vector():
    expected = hashlib.md5(b"100.00:5:pass2").hexdigest()
    assert _result_sig("100.00", "5", "pass2") == expected


def test_init_and_result_use_different_passwords():
    # A signature made with Password#1 must NOT validate as a Password#2 result sig.
    init = _init_sig("demo", "100.00", "5", "pass1")
    assert not _verify_result("100.00", "5", "pass2", init)


def test_result_verify_valid():
    sig = _result_sig("250.00", "42", "secret2")
    assert _verify_result("250.00", "42", "secret2", sig) is True


def test_result_verify_case_insensitive():
    # Robokassa hex signatures are case-insensitive.
    sig = _result_sig("250.00", "42", "secret2").upper()
    assert _verify_result("250.00", "42", "secret2", sig) is True


def test_result_verify_tampered_amount_fails():
    sig = _result_sig("250.00", "42", "secret2")
    # Attacker raises the amount but reuses the old signature.
    assert _verify_result("999.00", "42", "secret2", sig) is False


def test_result_verify_wrong_password_fails():
    sig = _result_sig("250.00", "42", "attacker_pw")
    assert _verify_result("250.00", "42", "real_pw", sig) is False


def test_result_verify_empty_fails():
    assert _verify_result("100.00", "1", "pw2", "") is False


def test_hash_algorithms():
    s = "demo:100.00:5:pw1"
    assert _robo_hash("md5", s) == hashlib.md5(s.encode()).hexdigest()
    assert _robo_hash("sha256", s) == hashlib.sha256(s.encode()).hexdigest()
    assert _robo_hash("sha512", s) == hashlib.sha512(s.encode()).hexdigest()
    # Unknown algo falls back to md5.
    assert _robo_hash("bogus", s) == hashlib.md5(s.encode()).hexdigest()


# ── Status mapping ─────────────────────────────────────────────────────────
def test_statecode_100_and_50_are_paid():
    assert _ROBO_STATE[100] == "paid"
    assert _ROBO_STATE[50] == "paid"   # funds received from buyer (crediting)


def test_hold_is_not_paid():
    # StateCode 20 = HOLD (2-stage auth) — must NOT be treated as paid.
    assert _ROBO_STATE[20] == "pending"
    assert _ROBO_STATE[20] not in _ROBO_TERMINAL


def test_cancel_and_refund_states():
    assert _ROBO_STATE[10] == "canceled"
    assert _ROBO_STATE[60] == "refunded"


def test_unknown_statecode_defaults_pending():
    assert _ROBO_STATE.get(999, "pending") == "pending"


def test_only_paid_is_terminal():
    for code, canonical in _ROBO_STATE.items():
        if code in (100, 50):
            assert canonical in _ROBO_TERMINAL
        else:
            assert canonical not in _ROBO_TERMINAL


def test_amount_is_major_units():
    assert "robokassa" not in _MINOR_UNIT_PROVIDERS


# ── Amount validation vs net/gross candidates (commission handling) ─────────
# Robokassa OpStateExt echoes OutSum (NET, credited to store) + IncSum (buyer paid).
# Which equals the gross cart total depends on the tariff, so place_order accepts a
# match against EITHER. Mirrors the candidate logic in External/main.py place_order.
def _amount_ok(total, candidates, tol=0.02):
    return any(abs(float(a) - float(total)) <= tol for a in candidates)


def test_amount_accepts_outsum_when_buyer_pays_fee():
    # Buyer-pays-commission tariff: OutSum == gross, IncSum == gross + fee.
    assert _amount_ok(1000.0, [1000.0, 1035.0])


def test_amount_accepts_incsum_when_store_pays_fee():
    # Store-pays-commission tariff: OutSum == gross - fee (net), IncSum == gross.
    assert _amount_ok(1000.0, [965.0, 1000.0])


def test_amount_rejects_tampered_cart():
    # Cart inflated to a total matching neither the net nor the buyer-paid sum.
    assert not _amount_ok(5000.0, [965.0, 1000.0])


def test_amount_net_only_would_have_rejected_legit_order():
    # Regression guard for the fixed bug: comparing ONLY against OutSum (net) would
    # 409-reject a legitimate store-pays-fee order; the candidate list fixes it.
    total, out_sum = 1000.0, 965.0                 # net < gross by the commission
    assert abs(out_sum - total) > 0.02             # old single-field check would fail
    assert _amount_ok(total, [out_sum, 1000.0])    # new candidate check passes
