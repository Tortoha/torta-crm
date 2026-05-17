"""Tests for the small string-massaging helpers: `sanitize` (XSS escape),
`make_slug` (org-name → URL slug), `validate_password` (registration
gate). These are tiny pure functions but they sit in the request path
of every form submission — a regression here is a public-facing bug or
security hole."""
from __future__ import annotations

import pytest


# ── sanitize() ────────────────────────────────────────────────────────────

def test_sanitize_escapes_basic_html(main_module):
    """Angle brackets, ampersands and quotes get entity-encoded so a
    malicious user can't inject `<script>` via a form field."""
    s = main_module.sanitize("<b>hi</b> & \"world\" 'a'")
    assert "<" not in s and ">" not in s
    assert "&lt;" in s and "&gt;" in s
    assert "&amp;" in s
    # Some HTML libraries leave bare single quotes alone — accept either
    # &#x27; or &#39; or the literal character so we don't over-specify.
    assert s.count("'") <= 1


def test_sanitize_none_passes_through(main_module):
    """Non-string inputs (None, int) pass through untouched — sanitize
    is a no-op for anything that isn't a string. Callers are expected
    to coerce DB nulls before display."""
    assert main_module.sanitize(None) is None
    assert main_module.sanitize(42) == 42


def test_sanitize_already_safe_is_unchanged(main_module):
    """A plain string with no special chars round-trips."""
    s = "hello world 123"
    assert main_module.sanitize(s) == s


# ── make_slug() ────────────────────────────────────────────────────────────

def test_make_slug_basic(main_module):
    """Lowercase + hyphen-join. The most common case."""
    assert main_module.make_slug("My Org") == "my-org"


def test_make_slug_strips_punctuation(main_module):
    """Punctuation collapses to hyphens, never appears in the slug."""
    s = main_module.make_slug("Test, Inc.!")
    assert ',' not in s
    assert '.' not in s
    assert '!' not in s


def test_make_slug_consecutive_hyphens_collapse(main_module):
    """`Foo --- bar` should not produce `foo----bar` — multiple
    separators collapse."""
    s = main_module.make_slug("Foo --- bar")
    assert '--' not in s


def test_make_slug_empty_input(main_module):
    """An all-punctuation input shouldn't crash; either empty or a
    placeholder is acceptable."""
    s = main_module.make_slug("!!!")
    assert isinstance(s, str)


# ── validate_password() ────────────────────────────────────────────────────

def test_validate_password_too_short(main_module):
    with pytest.raises(Exception):
        main_module.validate_password("a1")


def test_validate_password_no_digit(main_module):
    with pytest.raises(Exception):
        main_module.validate_password("hellopassword")


def test_validate_password_no_letter(main_module):
    with pytest.raises(Exception):
        main_module.validate_password("12345678")


def test_validate_password_with_space(main_module):
    with pytest.raises(Exception):
        main_module.validate_password("hello 123")


def test_validate_password_too_long(main_module):
    with pytest.raises(Exception):
        main_module.validate_password("a1" + "x" * 100)


def test_validate_password_valid(main_module):
    """An 8-char password with a letter, a digit, no spaces should pass."""
    # No exception = pass. Function returns None on success.
    main_module.validate_password("abc12345")


def test_validate_password_cyrillic_letter(main_module):
    """`c.isalpha()` accepts Cyrillic — Kazakh/Russian users must
    not be excluded."""
    main_module.validate_password("привет123")
