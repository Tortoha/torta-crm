"""Tests for the `_tz()` and `get_project_timezone()` helpers — both
gate every analytics SQL query. If `_tz()` silently returns UTC for a
valid IANA name due to a broken zoneinfo install, every chart on the
dashboard becomes wrong overnight."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest


def test_tz_returns_utc_for_none(main_module):
    assert main_module._tz(None) is timezone.utc


def test_tz_returns_utc_for_empty_string(main_module):
    assert main_module._tz("") is timezone.utc


def test_tz_returns_utc_for_unknown_zone(main_module):
    """Bad names fall back to UTC, never raise. Analytics SQL must
    keep running even if a project has a stale tz value in the DB."""
    assert main_module._tz("Mars/Olympus_Mons") is timezone.utc


def test_tz_returns_valid_zone_for_iana_name(main_module):
    """A real IANA name returns a non-UTC zoneinfo (assumes zoneinfo
    DB is present — which it should be on any modern Python install)."""
    if main_module.ZoneInfo is None:
        pytest.skip("zoneinfo unavailable in this Python build")
    tz = main_module._tz("Asia/Almaty")
    assert tz is not timezone.utc
    # Should have a fixed offset of UTC+5 (or +6 historically — both ok).
    now = datetime.now(tz)
    offset_hrs = now.utcoffset().total_seconds() / 3600
    assert offset_hrs in (5, 6)
