"""Tests for the pagination helpers used by every list endpoint.

`_paginate` / `_wrap_paginated` / `_pagination_params` together implement
cursor-based pagination — the caller fetches `limit + 1` rows from the DB,
hands them here, and gets a `{items, has_more, next_cursor}` envelope back.
Off-by-one bugs here would either drop rows from the UI or send too many,
so we test the boundary conditions explicitly."""
from __future__ import annotations

import pytest


# ── _paginate ─────────────────────────────────────────────────────────────

def test_paginate_trims_to_limit_and_flags_more(main_module):
    """Caller asks for limit=5 but fetched 6 rows to peek — we return
    5 items and `has_more=True`."""
    rows = list(range(6))
    out = main_module._paginate(rows, limit=5)
    assert out["items"] == [0, 1, 2, 3, 4]
    assert out["has_more"] is True


def test_paginate_exactly_at_limit_no_more(main_module):
    """5 rows fetched, limit=5 → page is full but there's no peek row,
    so `has_more=False`."""
    rows = list(range(5))
    out = main_module._paginate(rows, limit=5)
    assert out["items"] == rows
    assert out["has_more"] is False


def test_paginate_under_limit(main_module):
    """Fewer rows than limit — return what we have, no more pages."""
    out = main_module._paginate([1, 2], limit=5)
    assert out["items"] == [1, 2]
    assert out["has_more"] is False


def test_paginate_empty(main_module):
    """No data → empty page, no more. UI should render the empty state."""
    out = main_module._paginate([], limit=10)
    assert out["items"] == []
    assert out["has_more"] is False


# ── _wrap_paginated ───────────────────────────────────────────────────────

def test_wrap_paginated_legacy_returns_bare_array(main_module):
    """If the caller didn't ask for pagination (cursor=None and not
    explicitly opted in), preserve backward-compat: bare array."""
    rows = [1, 2, 3]
    out = main_module._wrap_paginated(False, rows, cursor=None, limit=10)
    assert out == [1, 2, 3]


def test_wrap_paginated_returns_envelope_when_requested(main_module):
    """When pagination IS requested, we get a dict envelope, not an
    array — frontend code dispatches on `items` key presence."""
    rows = list(range(11))
    out = main_module._wrap_paginated(True, rows, cursor=0, limit=10)
    assert out["items"] == list(range(10))
    assert out["has_more"] is True
    assert out["next_cursor"] == 10


def test_wrap_paginated_next_cursor_none_on_last_page(main_module):
    """On the last page `next_cursor` is None so the frontend knows
    not to render the 'Load more' button."""
    rows = [1, 2, 3]
    out = main_module._wrap_paginated(True, rows, cursor=0, limit=10)
    assert out["has_more"] is False
    assert out["next_cursor"] is None


def test_wrap_paginated_cursor_accumulates(main_module):
    """Each page's `next_cursor` = old cursor + items on this page.
    The frontend just plugs it back into the next request."""
    rows = list(range(11))
    out = main_module._wrap_paginated(True, rows, cursor=20, limit=10)
    assert out["next_cursor"] == 30


# ── _pagination_params ────────────────────────────────────────────────────

def test_pagination_params_no_cursor_means_legacy(main_module):
    """No cursor passed → `want_pagination=False`, caller returns
    the bare array."""
    want, offset, limit = main_module._pagination_params(None, None)
    assert want is False
    assert offset == 0


def test_pagination_params_cursor_zero_opts_in(main_module):
    """Passing the string '0' as cursor opts into the envelope
    format. Important: cursor='0' is NOT the same as cursor=None."""
    want, offset, limit = main_module._pagination_params("0", None)
    assert want is True
    assert offset == 0


def test_pagination_params_parses_numeric_cursor(main_module):
    """Non-zero cursor — keep it."""
    _, offset, _ = main_module._pagination_params("42", None)
    assert offset == 42


def test_pagination_params_bad_cursor_defaults_to_zero(main_module):
    """Garbage cursor (e.g. injected from a malicious URL) doesn't
    crash — falls back to offset 0."""
    _, offset, _ = main_module._pagination_params("not-a-number", None)
    assert offset == 0


def test_pagination_params_negative_cursor_clamped(main_module):
    """Negative offsets would confuse SQL OFFSET. Clamp to 0."""
    _, offset, _ = main_module._pagination_params("-5", None)
    assert offset == 0


def test_pagination_params_limit_clamped_to_max(main_module):
    """Requesting `limit=99999` would hammer the DB. Clamp to
    `max_limit` (default 200)."""
    _, _, limit = main_module._pagination_params(None, 99999)
    assert limit == 200


def test_pagination_params_limit_clamped_to_one(main_module):
    """limit=0 or negative would return empty pages forever — clamp
    to min 1 so the UI always makes progress."""
    _, _, limit = main_module._pagination_params(None, 0)
    assert limit == 1


def test_pagination_params_default_limit_when_missing(main_module):
    """No limit passed → `default_limit` (default 50)."""
    _, _, limit = main_module._pagination_params(None, None)
    assert limit == 50


def test_pagination_params_garbage_limit_falls_back(main_module):
    """Non-numeric limit falls back to default, doesn't crash."""
    _, _, limit = main_module._pagination_params(None, "abc")
    assert limit == 50


def test_pagination_params_respects_custom_defaults(main_module):
    """Endpoints can override defaults — e.g. products page wants
    default_limit=24, max_limit=100."""
    _, _, limit = main_module._pagination_params(None, None,
                                                 default_limit=24,
                                                 max_limit=100)
    assert limit == 24
    _, _, limit = main_module._pagination_params(None, 9999,
                                                 default_limit=24,
                                                 max_limit=100)
    assert limit == 100
