# syntax=docker/dockerfile:1.7
# CRM backend — FastAPI on Postgres.
#
# Multi-stage build keeps the final image small (~250 MB) by only carrying
# runtime artefacts: the system libs needed by Pillow / psycopg2 / etc.,
# the installed Python packages, and the source. No build chain (gcc,
# Python headers) ships to production.
#
# Image runs as a non-root user `app` for hardening.
# Default CMD binds uvicorn to 0.0.0.0:8001 — same port as local dev so
# nothing else in the codebase has to change.

# ─── Stage 1: install Python deps ────────────────────────────────────────────
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Build-time system deps: gcc/headers for native wheels (psycopg2, Pillow,
# cryptography), libpq for libpq-fe.h, libffi for cffi/cryptography.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        libjpeg-dev \
        zlib1g-dev \
        libffi-dev \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt ./
RUN pip install --user -r requirements.txt

# ─── Stage 2: slim runtime ───────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/home/app/.local/bin:${PATH}" \
    PORT=8001

# Runtime system deps only — libpq5 for psycopg2 (the lib, not the headers),
# libjpeg/zlib for Pillow, libgomp for PyMuPDF.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        libjpeg62-turbo \
        zlib1g \
        libffi8 \
        libssl3 \
        libgomp1 \
        ca-certificates \
        tzdata \
        curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash --uid 1000 app

WORKDIR /app

# Copy installed Python packages from the builder stage into the app user
# home (matches PATH above).
COPY --from=builder --chown=app:app /root/.local /home/app/.local

# App source — copy after deps so a code-only change doesn't bust the
# (much heavier) pip-install layer cache.
COPY --chown=app:app . /app

USER app

EXPOSE 8001

# Health-check pings /api/me/csrf-equivalent — actually we use the
# lighter-weight /docs endpoint that FastAPI provides automatically.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8001/docs > /dev/null || exit 1

# Run via uvicorn — single worker per container, scale horizontally by
# spinning up more containers (Fly.io machines) instead of multi-worker.
# That keeps each container's footprint predictable and matches the
# stateless-after-PG-kv-migration architecture.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--proxy-headers", "--forwarded-allow-ips=*"]
