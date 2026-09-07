# Torta CRM

A multi-tenant SaaS platform for running online stores — an admin console plus a
public storefront API. Built solo, from architecture to production deployment.

Started as a college project, grew well past it, and ran for a while as a live
product at `tortacrm.com` (now shut down). This repository is kept as a portfolio
and reference.

> **Note on scope.** This was a one-person project. The goal was to build and
> operate a realistic production system end to end — API design, data modelling,
> payments, real-time, infrastructure, CI/CD, security — not to ship a polished
> commercial product. Some corners are rougher than a team codebase would be, and
> that is called out honestly in the code and commit history.

---

## What's inside

| Service | Path | Stack | Port (local) |
|---|---|---|---|
| **CRM API** | `CRM/backend/` | Python, FastAPI, PostgreSQL (`psycopg2` + pool) | 8001 |
| **CRM console** | `CRM/frontend/` | React, Vite, React Router | 5174 |
| **Storefront API** | `External/` | Python, FastAPI, PostgreSQL | 8000 |
| **Demo storefront** | `Apps/ClothingWebsite/` | React, Vite, consumes the SDK | 5173 |
| **Operator console** | `Admin/frontend/` | React, Vite | 5175 |
| **JS SDK** | `sdk/` | published to npm as [`torta-js`](https://www.npmjs.com/package/torta-js) | — |
| **Email service** | `ses/` | FastAPI on a VPS: Postfix + OpenDKIM, DKIM/SPF/DMARC | — |

All services share one PostgreSQL database (`crmdb`). Store data is isolated per
tenant by a `project_id` foreign key on every table.

---

## Highlights

**API & data**
- Single-file FastAPI services (~9k lines for the CRM API), ~90-table schema,
  connection pooling, `db_cursor()` / `db_one()` / `db_all()` helpers.
- Multi-tenant isolation: every query is scoped by `project_id`; access control
  via `Depends` guards (`require_owner`, `require_team_member_or_owner`,
  `require_org_owner`).
- Auth: JWT with an access + refresh chain in an httpOnly cookie, Google OAuth 2.0,
  email OTP login, `slowapi` rate limiting on sensitive endpoints.
- Real-time over WebSocket (notifications, customer chat, live presence);
  cross-process fan-out through PostgreSQL `LISTEN` / `NOTIFY`.
- Alembic migrations alongside an idempotent bootstrap; materialized views for
  analytics; PDF and barcode/QR generation.

**Payments**
- Six gateways behind one internal interface (`create` / `verify` / `webhook`):
  Stripe, PayPal, CloudPayments / TipTop Pay, Robokassa, Kaspi, Halyk ePay.
- Every payment is verified server-to-server with the provider before an order is
  created. Idempotency is enforced at the database level (partial unique index on
  the payment intent). Webhook signatures are HMAC-verified.
- Recovery path for payments that succeeded at the gateway but never became an
  order (abandoned checkout, dead mobile tab).
- Subscription billing through Paddle (Merchant of Record) with signed webhooks.

**Infrastructure**
- Docker + docker-compose (multi-stage builds, health-check chains).
- CI/CD on GitHub Actions → auto-deploy to Google Cloud Run (scale-to-zero).
- PostgreSQL on Neon, object storage on Cloudflare R2, frontend on Cloudflare
  Workers, Nginx + Let's Encrypt.
- Self-hosted transactional email on a VPS instead of a managed provider:
  Postfix + OpenDKIM with per-domain keys, plus inbound mail parsed back into the
  app.

**Security**
- Two self-run code audits; fixes for SSRF, IDOR / cross-tenant access, CSV
  injection in exports, and an OAuth account-takeover path. Secrets are masked in
  API responses.

**Frontend**
- React + Vite, nested routing with an Outlet-context pattern, a custom design
  system (CSS variables), i18n in 3 languages with a sync pipeline, GSAP
  animations, custom interaction hooks.

**Tests**
- ~100 `pytest` unit tests over the pure-helper surface (date math, sanitization,
  password hashing, OTP, rate-limit helpers, alert evaluation).

---

## Running it locally

Requires Python 3.11+, Node 18+, and PostgreSQL 17.

```bash
# 1. Database — create `crmdb`; the CRM backend bootstraps the schema on first run.

# 2. CRM API (port 8001)
cd CRM/backend
pip install -r requirements.txt
cp ../../.env.example .env        # fill in the values you need
python -m uvicorn main:app --reload --port 8001

# 3. CRM console (port 5174)
cd CRM/frontend && npm install && npm run dev

# 4. Storefront API (port 8000)
cd External
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000

# 5. Demo storefront (port 5173)
cd Apps/ClothingWebsite && npm install && npm run dev
```

Payment gateways, Google OAuth, Paddle, and the email service each need their own
credentials; without them those features are simply inactive. See `.env.example`
for the full list of keys.

---

## Notes on the code

- Two backends, one shared database and schema. Common helpers were kept in sync
  by hand rather than extracted into a package — a deliberate trade-off for a
  solo project, and a known source of drift.
- The `MySQLConnectionPool` name in the code is historical; it is a PostgreSQL
  pool. The project was migrated from MySQL to PostgreSQL mid-way.
- Frontend is plain JavaScript, not TypeScript.
