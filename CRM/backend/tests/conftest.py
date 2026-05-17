"""pytest fixtures for CRM backend tests.

Test surface area
-----------------
main.py is a ~9 000-statement single-file FastAPI app. About 80 % of it
is HTTP route handlers, background daemon threads, and a 2 500-line
idempotent startup-migration block that only runs under uvicorn — none
of which can be unit-tested without a real Postgres connection and a
running FastAPI app.

What lives in these tests is the remaining ~20 %: the pure helpers and
mocked-IO logic that DOES round-trip without a server:

  • _date_range_for_period / _tz / _utcnow   (date math)
  • sanitize / make_slug / validate_password (form-input guards)
  • hash_pw / verify_pw / is_legacy_hash     (password storage)
  • gen_otp / hash_otp / verify_otp          (one-time codes)
  • gen_api_key / gen_publishable_key        (key generators)
  • _paginate / _wrap_paginated /
    _pagination_params                        (cursor pagination)
  • _kv_get/set/delete/incr/ttl/exists/
    _kv_keys_matching                         (in-memory store)
  • _fail_check / _fail_record / _fail_clear (rate limiter)
  • _reset_set/get/del + _pv_set/get/del     (token registries)
  • _analytics_cache_get / _analytics_cache_set
  • _evaluate_one_alert (with db_one/db_all mocked via unittest.mock)

For higher coverage we would add an integration test layer that boots
the app against a dedicated Postgres test DB (Alembic migrations applied
fresh), spins up FastAPI's TestClient, and exercises endpoints with a
seeded user + JWT cookie. That layer is intentionally deferred until
Docker-based dev/test infra is set up.

Run from the CRM/backend directory:
    pytest tests/                       # all unit tests
    pytest tests/ --cov=main            # with coverage
    pytest tests/test_string_helpers.py # one file
"""
from __future__ import annotations

import os
import sys
import importlib
from datetime import datetime, timedelta, timezone

import pytest

# Make `main.py` importable as a module. Tests live in
# CRM/backend/tests/ so we add CRM/backend/ to sys.path.
HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(HERE)
sys.path.insert(0, BACKEND_DIR)


@pytest.fixture(scope="session")
def main_module():
    """Import main.py once per session. The startup migrations are
    wrapped in `@app.on_event("startup")` so they don't run during
    plain `import main` — meaning we can import even if Postgres is
    unreachable. Individual tests that need DB will skip themselves
    by detecting the absence of a live connection."""
    try:
        import main  # type: ignore
        return main
    except Exception as e:
        pytest.skip(f"main.py not importable in this environment: {e}")


@pytest.fixture
def utc_now():
    """Frozen `now` for deterministic date-range assertions."""
    return datetime(2026, 5, 17, 12, 0, 0, tzinfo=timezone.utc)
