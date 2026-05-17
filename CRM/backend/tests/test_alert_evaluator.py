"""Tests for the alert evaluator's per-type metric computation.
Patches `db_one` / `db_all` with fake rows so we exercise the
business logic without needing a real DB. The evaluator's IO layer
(send_email, INSERT INTO crm_alert_fires, UPDATE last_fired_at) is
intentionally NOT tested here — those are thin wrappers and need a
real DB."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest


@pytest.fixture
def fake_alert():
    return {
        "id":            1,
        "project_id":    100,
        "type":          "revenue_drop",
        "threshold":     20.0,
        "email":         "ops@example.com",
        "last_fired_at": None,
    }


def test_revenue_drop_fires_above_threshold(main_module, fake_alert):
    """Yesterday was $1000, today is $500 → 50% drop, threshold 20% → fires."""
    fake_alert["type"] = "revenue_drop"
    fake_alert["threshold"] = 20.0
    rows = [{"cur_rev": 500.0, "prev_rev": 1000.0}]
    with patch.object(main_module, "db_all", return_value=rows):
        out = main_module._evaluate_one_alert(fake_alert)
    assert out is not None
    msg, metric = out
    assert "50" in msg or "50.0" in msg
    assert metric == pytest.approx(50.0, abs=0.1)


def test_revenue_drop_below_threshold_does_not_fire(main_module, fake_alert):
    """5% drop, threshold 20% → does NOT fire."""
    fake_alert["type"] = "revenue_drop"
    fake_alert["threshold"] = 20.0
    rows = [{"cur_rev": 950.0, "prev_rev": 1000.0}]
    with patch.object(main_module, "db_all", return_value=rows):
        out = main_module._evaluate_one_alert(fake_alert)
    assert out is None


def test_revenue_drop_no_prev_revenue_does_not_fire(main_module, fake_alert):
    """If yesterday was $0, drop % is undefined — never fire (avoids
    divide-by-zero AND avoids spamming brand-new stores with no history)."""
    fake_alert["type"] = "revenue_drop"
    fake_alert["threshold"] = 20.0
    rows = [{"cur_rev": 0.0, "prev_rev": 0.0}]
    with patch.object(main_module, "db_all", return_value=rows):
        out = main_module._evaluate_one_alert(fake_alert)
    assert out is None


def test_low_stock_fires_when_skus_below_threshold(main_module, fake_alert):
    """3 SKUs below threshold → alert fires with count."""
    fake_alert["type"] = "low_stock"
    fake_alert["threshold"] = 5
    with patch.object(main_module, "db_one", return_value={"n": 3}):
        out = main_module._evaluate_one_alert(fake_alert)
    assert out is not None
    msg, metric = out
    assert "3" in msg
    assert metric == 3


def test_low_stock_zero_skus_does_not_fire(main_module, fake_alert):
    """No SKUs below threshold → no email."""
    fake_alert["type"] = "low_stock"
    fake_alert["threshold"] = 5
    with patch.object(main_module, "db_one", return_value={"n": 0}):
        out = main_module._evaluate_one_alert(fake_alert)
    assert out is None


def test_daily_summary_always_returns_metric(main_module, fake_alert):
    """Daily summary fires unconditionally — throttle (23h) is the only
    gate, not a threshold."""
    fake_alert["type"] = "daily_summary"
    with patch.object(main_module, "db_one",
                      return_value={"rev": 500.0, "orders": 7}):
        out = main_module._evaluate_one_alert(fake_alert)
    assert out is not None
    msg, metric = out
    assert "$500" in msg
    assert "7" in msg


def test_new_order_fires_when_orders_arrived(main_module, fake_alert):
    """At least one new order since last fire → ping merchant."""
    fake_alert["type"] = "new_order"
    fake_alert["last_fired_at"] = datetime.now(timezone.utc) - timedelta(hours=1)
    with patch.object(main_module, "db_one",
                      return_value={"n": 2, "rev": 200.0}):
        out = main_module._evaluate_one_alert(fake_alert)
    assert out is not None
    msg, metric = out
    assert "2 new" in msg
    assert metric == 2


def test_new_order_no_new_orders_does_not_fire(main_module, fake_alert):
    """Zero new orders → silent (no spam emails)."""
    fake_alert["type"] = "new_order"
    fake_alert["last_fired_at"] = datetime.now(timezone.utc) - timedelta(hours=1)
    with patch.object(main_module, "db_one",
                      return_value={"n": 0, "rev": 0.0}):
        out = main_module._evaluate_one_alert(fake_alert)
    assert out is None


def test_unknown_alert_type_returns_none(main_module, fake_alert):
    """Future-proofing: an unknown type stored in the DB shouldn't
    crash the evaluator. Returns None and the alert is silently skipped."""
    fake_alert["type"] = "future_metric_xyz"
    out = main_module._evaluate_one_alert(fake_alert)
    assert out is None
