"""Tests for password + OTP hashing.

scrypt is the system of record for new passwords; legacy SHA-256 hashes
are still accepted on verify so existing users don't have to reset. OTPs
are stored hashed too — never plaintext, even in transient KV state.

These are pure crypto helpers — no DB, no network. They sit on the
authentication hot path, so a silent regression here is a security
incident."""
from __future__ import annotations

import pytest


# ── scrypt password hashing ───────────────────────────────────────────────

def test_hash_pw_returns_scrypt_envelope(main_module):
    """The output format must start with `$scrypt$` so `verify_pw` can
    dispatch to the right algorithm. Don't change the prefix without
    a migration plan — every existing hash in the DB depends on it."""
    h = main_module.hash_pw("supersecret123")
    assert h.startswith("$scrypt$")
    # Three `$` separators → 4 segments: scheme, salt, hash, ...
    assert h.count("$") >= 3


def test_hash_pw_is_non_deterministic(main_module):
    """Same input → different output because the salt is random.
    Without this property, rainbow tables would work."""
    a = main_module.hash_pw("samepassword")
    b = main_module.hash_pw("samepassword")
    assert a != b


def test_verify_pw_round_trip(main_module):
    """Hash then verify — the happy path every login takes."""
    h = main_module.hash_pw("correctpassword1")
    assert main_module.verify_pw("correctpassword1", h) is True


def test_verify_pw_wrong_password_rejected(main_module):
    """Wrong password must NOT verify, no matter how close."""
    h = main_module.hash_pw("correctpassword1")
    assert main_module.verify_pw("wrongpassword1", h) is False
    # Off-by-one char
    assert main_module.verify_pw("correctpassword2", h) is False


def test_verify_pw_empty_stored_rejected(main_module):
    """A user row with empty `password` (e.g. Google-only account) must
    never verify — would let an attacker log in with empty string."""
    assert main_module.verify_pw("anything", "") is False
    assert main_module.verify_pw("", "") is False


def test_verify_pw_malformed_envelope_rejected(main_module):
    """If the stored hash is corrupted, verify must return False,
    not raise."""
    assert main_module.verify_pw("anything", "$scrypt$not$enough$parts") is False
    assert main_module.verify_pw("anything", "$scrypt$") is False


def test_verify_pw_legacy_sha256_still_works(main_module):
    """A user from before the scrypt migration has a bare SHA-256
    hex hash — we still accept it so they don't get locked out."""
    import hashlib
    legacy_hash = hashlib.sha256(b"oldpassword").hexdigest()
    assert main_module.verify_pw("oldpassword", legacy_hash) is True
    assert main_module.verify_pw("notoldpassword", legacy_hash) is False


def test_is_legacy_hash_detects_sha256(main_module):
    """The migration path: on successful login with a legacy hash,
    we re-hash the password with scrypt. `is_legacy_hash` is the
    flag that triggers that rehash."""
    import hashlib
    legacy = hashlib.sha256(b"x").hexdigest()
    assert main_module.is_legacy_hash(legacy) is True
    assert main_module.is_legacy_hash("$scrypt$abc$def") is False
    # Empty is NOT legacy — there's nothing to migrate.
    assert main_module.is_legacy_hash("") is False
    assert main_module.is_legacy_hash(None) is False


# ── OTP (one-time passcode) helpers ───────────────────────────────────────

def test_gen_otp_is_numeric_and_correct_length(main_module):
    """Default length is 6 digits — matches the SMS/email UI."""
    for _ in range(20):
        otp = main_module.gen_otp()
        assert len(otp) == 6
        assert otp.isdigit()


def test_gen_otp_custom_length(main_module):
    """Caller can request 8-digit codes for higher-stakes flows."""
    otp = main_module.gen_otp(length=8)
    assert len(otp) == 8
    assert otp.isdigit()


def test_gen_otp_is_random(main_module):
    """20 codes in a row should not all be identical. The chance
    of accidental collision is 1 in 10⁶ × 19 — effectively zero."""
    codes = {main_module.gen_otp() for _ in range(20)}
    assert len(codes) >= 2


def test_hash_otp_is_deterministic(main_module):
    """Same OTP → same hash. Otherwise verify would fail every time."""
    assert main_module.hash_otp("123456") == main_module.hash_otp("123456")


def test_verify_otp_round_trip(main_module):
    """Happy path — code matches its stored hash."""
    h = main_module.hash_otp("428517")
    assert main_module.verify_otp("428517", h) is True


def test_verify_otp_wrong_code_rejected(main_module):
    h = main_module.hash_otp("428517")
    assert main_module.verify_otp("000000", h) is False


def test_verify_otp_empty_inputs_rejected(main_module):
    """Empty or missing values must return False — guards against
    a logic bug where a missing OTP would silently pass."""
    h = main_module.hash_otp("123456")
    assert main_module.verify_otp("", h) is False
    assert main_module.verify_otp("123456", "") is False
    assert main_module.verify_otp(None, h) is False


# ── API key + publishable key generators ──────────────────────────────────

def test_gen_api_key_format(main_module):
    """API keys are 20 hex chars (10 random bytes hex-encoded).
    20 chars = 80 bits of entropy = unguessable."""
    k = main_module.gen_api_key()
    assert len(k) == 20
    assert all(c in "0123456789abcdef" for c in k)


def test_gen_api_key_uniqueness(main_module):
    """No two keys should ever collide. 100 in a row is a sanity
    check — full uniqueness comes from 80 bits of entropy."""
    keys = {main_module.gen_api_key() for _ in range(100)}
    assert len(keys) == 100


def test_gen_publishable_key_format(main_module):
    """Publishable keys are `pk_` + 48 hex chars. Stripe-style prefix
    makes them obviously a publishable key when seen in code review
    or in a browser DevTools tab."""
    k = main_module.gen_publishable_key()
    assert k.startswith("pk_")
    body = k[3:]
    assert len(body) == 48
    assert all(c in "0123456789abcdef" for c in body)
