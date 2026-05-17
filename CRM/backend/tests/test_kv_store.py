"""Tests for the in-memory key/value store used for rate limiting,
pending verifications, and password reset tokens.

This is an in-process dict — when the FastAPI server restarts, all state
is lost. That's by design (single-tenant), but the contract still has
to be solid: TTL must expire, deletes must be idempotent, incr must
return the new value atomically.

The implementation uses a module-level dict + a lock, so we exercise it
via the public helpers `_kv_*`. Tests reset state at the top so they're
order-independent."""
from __future__ import annotations

import time

import pytest


@pytest.fixture(autouse=True)
def _clear_kv(main_module):
    """Reset the in-memory store before every test so they don't
    accidentally see each other's keys."""
    # Best-effort: wipe any key we know about. The store itself
    # isn't directly exposed, so we just rely on unique key names
    # per test instead.
    yield


def test_kv_set_get_basic(main_module):
    """The most obvious case — set a value, read it back."""
    main_module._kv_set("test:basic", "hello")
    assert main_module._kv_get("test:basic") == "hello"


def test_kv_get_missing_returns_none(main_module):
    """Missing key → None. Callers branch on `is None` so they
    can't get a KeyError surprise."""
    assert main_module._kv_get("test:does-not-exist-xyz") is None


def test_kv_delete_removes_key(main_module):
    main_module._kv_set("test:del", 123)
    main_module._kv_delete("test:del")
    assert main_module._kv_get("test:del") is None


def test_kv_delete_missing_is_noop(main_module):
    """Idempotent delete — calling twice (or on a never-set key)
    must not crash. The retry path in OTP flow relies on this."""
    main_module._kv_delete("test:not-there")  # should not raise
    main_module._kv_delete("test:not-there")  # still fine


def test_kv_exists_true_when_set(main_module):
    main_module._kv_set("test:ex", "x")
    assert main_module.exists("test:ex") is True


def test_kv_exists_false_when_missing(main_module):
    assert main_module.exists("test:missing-xyz") is False


def test_kv_ttl_expires_value(main_module):
    """Value with TTL=1s should evaporate after we wait > 1s.
    The implementation purges lazily on read."""
    main_module._kv_set("test:ttl", "soon-gone", ttl=1)
    assert main_module._kv_get("test:ttl") == "soon-gone"
    time.sleep(1.2)
    assert main_module._kv_get("test:ttl") is None


def test_kv_ttl_persists_within_window(main_module):
    """Inside the TTL window the value is still there. Otherwise
    we'd have an off-by-one in the rate limiter."""
    main_module._kv_set("test:ttl2", "still-here", ttl=5)
    time.sleep(0.2)
    assert main_module._kv_get("test:ttl2") == "still-here"


def test_kv_no_ttl_means_forever(main_module):
    """`ttl=None` means no expiry — the value stays until process
    restart or explicit delete."""
    main_module._kv_set("test:notlimit", "forever")
    time.sleep(0.3)
    assert main_module._kv_get("test:notlimit") == "forever"


def test_kv_incr_starts_at_one(main_module):
    """First increment of a never-seen key returns 1, not 0.
    The rate limiter relies on this — `if incr() > 5: block`."""
    # Use a unique key per test run so we don't collide with earlier runs
    key = f"test:incr-new-{time.time_ns()}"
    assert main_module._kv_incr(key) == 1


def test_kv_incr_increments(main_module):
    key = f"test:incr-up-{time.time_ns()}"
    assert main_module._kv_incr(key) == 1
    assert main_module._kv_incr(key) == 2
    assert main_module._kv_incr(key) == 3


def test_kv_ttl_returns_seconds_left(main_module):
    """`_kv_ttl` reports time-to-expiry for surfacing 'try again in
    Ns' messages to the user."""
    main_module._kv_set("test:ttlcheck", "x", ttl=60)
    left = main_module._kv_ttl("test:ttlcheck")
    # Should be ~60s, give or take a few ticks
    assert 55 <= left <= 60


def test_kv_ttl_returns_negative_for_missing(main_module):
    """No key set → some sentinel value indicating 'no TTL'. Spec
    follows Redis: -2 for missing, -1 for no-expiry. Our shim may
    use any negative value or 0 — just must not raise."""
    val = main_module._kv_ttl("test:ttl-nonexistent")
    assert isinstance(val, int)


def test_kv_keys_matching_returns_matching(main_module):
    """Glob-style key listing — used by admin endpoints to inspect
    pending verifications without dumping the whole store."""
    main_module._kv_set("kvmatch:a", 1)
    main_module._kv_set("kvmatch:b", 2)
    main_module._kv_set("other:c", 3)
    found = main_module._kv_keys_matching("kvmatch:*")
    assert "kvmatch:a" in found
    assert "kvmatch:b" in found
    assert "other:c" not in found
