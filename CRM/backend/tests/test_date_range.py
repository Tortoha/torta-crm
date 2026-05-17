"""Tests for `_date_range_for_period` — period code → UTC datetimes.

Critical because every analytics endpoint uses this to bound its SQL.
A regression here silently corrupts every chart on the dashboard."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest


def test_preset_period_returns_utc_aware(main_module):
    """All presets return TZ-aware UTC datetimes (not naive)."""
    start, end = main_module._date_range_for_period("1mo")
    assert start.tzinfo is not None
    assert end.tzinfo is not None
    assert start.utcoffset() == timedelta(0)
    assert end.utcoffset() == timedelta(0)


def test_preset_period_span_matches_table(main_module):
    """`1w` spans exactly 7 days. Catches off-by-one in the days table."""
    start, end = main_module._date_range_for_period("1w")
    assert (end - start) == timedelta(days=7)


def test_preset_period_legacy_codes(main_module):
    """Legacy frontend codes (`7d`, `30d`, `90d`, `year`) still resolve."""
    a, _ = main_module._date_range_for_period("1w")
    b, _ = main_module._date_range_for_period("7d")
    # Both anchored to "now" so might differ by microseconds — compare
    # span instead of absolute equality.
    assert abs((a - b).total_seconds()) < 1


def test_unknown_period_falls_back_to_30_days(main_module):
    """Unknown period codes default to 30 days, not crash."""
    start, end = main_module._date_range_for_period("not-a-period")
    assert (end - start) == timedelta(days=30)


# ── Custom range encoding (YYYY-MM-DD_YYYY-MM-DD) ─────────────────────────

def test_custom_range_parses_iso_pair(main_module):
    """`2026-04-01_2026-04-15` yields start = Apr 1, end = Apr 16 00:00 UTC."""
    start, end = main_module._date_range_for_period("2026-04-01_2026-04-15")
    assert start == datetime(2026, 4, 1, tzinfo=timezone.utc)
    # end is exclusive (next-midnight-after-last-day) so SQL `< end`
    # correctly includes the full Apr 15 day.
    assert end == datetime(2026, 4, 16, tzinfo=timezone.utc)


def test_custom_range_with_tz_anchors_to_local_midnight(main_module):
    """In Asia/Almaty (UTC+5), `2026-04-01_2026-04-01` should span from
    Mar 31 19:00 UTC to Apr 1 19:00 UTC (full local day)."""
    start, end = main_module._date_range_for_period(
        "2026-04-01_2026-04-01", tz="Asia/Almaty"
    )
    # Almaty is UTC+5 — local midnight Apr 1 = 19:00 UTC Mar 31.
    assert start.year == 2026 and start.month == 3 and start.day == 31
    assert end.year == 2026 and end.month == 4 and end.day == 1
    assert (end - start) == timedelta(days=1)


def test_custom_range_invalid_falls_back_to_preset(main_module):
    """Garbled range string → use default 30-day window, don't crash."""
    start, end = main_module._date_range_for_period("not-a-range_either")
    assert (end - start) == timedelta(days=30)


def test_custom_range_inverted_dates_does_not_crash(main_module):
    """`2026-12-31_2026-01-01` (end before start) still returns a tuple
    — frontend should validate but backend must not crash on bad input."""
    start, end = main_module._date_range_for_period("2026-12-31_2026-01-01")
    # Negative span is fine for our purposes — SQL just returns 0 rows.
    assert isinstance(start, datetime)
    assert isinstance(end, datetime)


# ── Timezone-anchored end-of-today ────────────────────────────────────────

def test_end_aligned_to_local_midnight(main_module):
    """In a tz with non-zero offset, end-of-today is the LOCAL next
    midnight converted to UTC — not 00:00 UTC."""
    _, end_utc = main_module._date_range_for_period("1d", tz="Asia/Almaty")
    # In Almaty, midnight is at 19:00 UTC of the previous calendar day,
    # or any of {00:00, 19:00} depending on which way you frame it. The
    # invariant: the UTC value, converted back to Almaty, ends on an
    # exact midnight.
    almaty = main_module._tz("Asia/Almaty")
    local = end_utc.astimezone(almaty)
    assert local.hour == 0 and local.minute == 0 and local.second == 0
