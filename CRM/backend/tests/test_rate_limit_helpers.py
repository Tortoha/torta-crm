"""Tests for the failed-attempt rate limiter and the password reset
token registry.

These wrap the in-memory KV store with namespaced keys (`fail:<bucket>:<ident>`,
`pw_reset:<hash>`) and a fixed TTL. They're tiny but they're the only
thing standing between a credential-stuffing attacker and a free attempt
budget, so we verify the count + lockout behavior explicitly."""
from __future__ import annotations

import time
import secrets

import pytest


# ── _fail_check / _fail_record / _fail_clear ──────────────────────────────

def _ident(prefix: str) -> str:
    """Unique-per-test identifier — keeps tests from stepping on each
    other's lockout counters when running in any order."""
    return f"{prefix}-{secrets.token_hex(4)}"


def test_fail_check_initially_unblocked(main_module):
    """A user/email with no prior fails is not blocked."""
    ident = _ident("never-failed")
    blocked, wait = main_module._fail_check("login", ident)
    assert blocked is False
    assert wait == 0


def test_fail_record_increments(main_module):
    """Each failed attempt bumps the counter by 1."""
    ident = _ident("incrementing")
    assert main_module._fail_record("login", ident) == 1
    assert main_module._fail_record("login", ident) == 2
    assert main_module._fail_record("login", ident) == 3


def test_fail_check_blocks_at_threshold(main_module):
    """`MAX_FAILED_ATTEMPTS` failed tries → blocked. The constant is 5
    by config; we record exactly that many to trip the lockout."""
    ident = _ident("trip-block")
    for _ in range(main_module.MAX_FAILED_ATTEMPTS):
        main_module._fail_record("login", ident)
    blocked, wait = main_module._fail_check("login", ident)
    assert blocked is True
    assert wait >= 1   # at least 1s left until unblock


def test_fail_clear_resets_state(main_module):
    """A successful login wipes the counter — otherwise yesterday's
    failures would still be there next time."""
    ident = _ident("clear-me")
    for _ in range(main_module.MAX_FAILED_ATTEMPTS):
        main_module._fail_record("login", ident)
    main_module._fail_clear("login", ident)
    blocked, _ = main_module._fail_check("login", ident)
    assert blocked is False


def test_fail_buckets_are_isolated(main_module):
    """`login` failures don't trip the `password-reset` lockout, and
    vice versa. Otherwise filling the reset bucket would lock out
    the user's normal login."""
    ident = _ident("two-buckets")
    for _ in range(main_module.MAX_FAILED_ATTEMPTS):
        main_module._fail_record("login", ident)
    # Login bucket is now blocked
    assert main_module._fail_check("login", ident)[0] is True
    # password-reset bucket on the same ident is untouched
    assert main_module._fail_check("password-reset", ident)[0] is False


def test_fail_idents_are_isolated(main_module):
    """alice@x.com being locked out must not lock out bob@x.com."""
    a = _ident("alice")
    b = _ident("bob")
    for _ in range(main_module.MAX_FAILED_ATTEMPTS):
        main_module._fail_record("login", a)
    assert main_module._fail_check("login", a)[0] is True
    assert main_module._fail_check("login", b)[0] is False


# ── _reset_set / _reset_get / _reset_del ──────────────────────────────────

def test_reset_token_round_trip(main_module):
    """The forgot-password flow: hash the token, store the user id
    under it, look it up when the user clicks the reset link."""
    h = secrets.token_hex(16)
    main_module._reset_set(h, {"user_id": 7, "email": "u@e.com"})
    got = main_module._reset_get(h)
    assert got is not None
    assert got["user_id"] == 7
    assert got["email"] == "u@e.com"


def test_reset_get_missing_returns_none(main_module):
    """Unknown reset hash → None. Endpoint should reject with 400."""
    assert main_module._reset_get("doesnt-exist-xyz") is None


def test_reset_del_invalidates_token(main_module):
    """After the user successfully resets, the token is single-use —
    delete it. A second click on the link must fail."""
    h = secrets.token_hex(16)
    main_module._reset_set(h, {"user_id": 99})
    main_module._reset_del(h)
    assert main_module._reset_get(h) is None


# ── _pv_get / _pv_set / _pv_del (pending email verifications) ─────────────

def test_pending_verification_round_trip(main_module):
    """Two-step signup: send-code stashes {email, code, user_info},
    verify-code reads it back."""
    email = f"u-{secrets.token_hex(4)}@example.com"
    payload = {"otp_hash": "abc123", "attempts": 0, "ts": time.time()}
    main_module._pv_set(email, payload, ttl=600)
    got = main_module._pv_get(email)
    assert got == payload


def test_pending_verification_del(main_module):
    """Verify-code wipes the pending state on success so the user
    can't re-use the same OTP."""
    email = f"u-{secrets.token_hex(4)}@example.com"
    main_module._pv_set(email, {"otp_hash": "x"})
    main_module._pv_del(email)
    assert main_module._pv_get(email) is None


# ── _analytics_cache (memoized API responses) ─────────────────────────────

def test_analytics_cache_set_get(main_module):
    """Set + get a value. The cache key in production is a hash of
    (user_id, route, query) but the test doesn't care what's in
    the key — just that round-trip works."""
    key = f"test-cache-{secrets.token_hex(4)}"
    main_module._analytics_cache_set(key, {"revenue": 100, "orders": 5})
    got = main_module._analytics_cache_get(key)
    assert got == {"revenue": 100, "orders": 5}


def test_analytics_cache_miss_returns_none(main_module):
    """Cold cache lookup → None. The caller should compute and
    populate. Don't return a sentinel object — None is the contract."""
    assert main_module._analytics_cache_get("never-set-xyz") is None


def test_analytics_cache_expires(main_module):
    """The TTL is a module constant (10s by default). Temporarily
    shrink it so the test runs fast."""
    key = f"test-cache-exp-{secrets.token_hex(4)}"
    original_ttl = main_module._ANALYTICS_CACHE_TTL
    try:
        main_module._ANALYTICS_CACHE_TTL = 1
        main_module._analytics_cache_set(key, "soon-gone")
        assert main_module._analytics_cache_get(key) == "soon-gone"
        time.sleep(1.2)
        assert main_module._analytics_cache_get(key) is None
    finally:
        main_module._ANALYTICS_CACHE_TTL = original_ttl
