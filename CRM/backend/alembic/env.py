"""Alembic env.py — pulls DB connection from .env (same source as
main.py's DB_CONFIG) instead of from alembic.ini.

This way:
  - One source of truth (.env). Switching DBs only touches one place.
  - alembic.ini gets committed without leaking creds.
  - `alembic upgrade head` works in CI / Docker without extra config.

Run with:
    python -m alembic upgrade head      # apply pending migrations
    python -m alembic downgrade -1      # rollback last migration
    python -m alembic revision -m "msg" # generate empty revision skel
"""
from __future__ import annotations

import os
from logging.config import fileConfig

from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

from alembic import context

# Load .env from the backend directory (alembic env.py runs from
# CRM/backend/ when invoked via `python -m alembic`).
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
load_dotenv(os.path.join(_BACKEND, ".env"), override=False)

config = context.config

# Inject the SQLAlchemy URL from .env into the Alembic config so all the
# rest of Alembic's machinery works unchanged.
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASS = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "crmdb")
SQLALCHEMY_URL = (
    f"postgresql+psycopg2://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)
config.set_main_option("sqlalchemy.url", SQLALCHEMY_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# No SQLAlchemy ORM models in this project — every migration writes
# raw SQL via `op.execute(...)`. autogenerate is therefore disabled
# (target_metadata=None); migrations are authored by hand.
target_metadata = None


def run_migrations_offline() -> None:
    """Render SQL to stdout without connecting — used for review."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Connect to the DB and apply migrations transactionally."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
