# Docker — local stack + production hand-off

Single command spins up the whole CRM stack (postgres + 2 backends + 1
frontend) on your laptop. Production deploy still goes through Fly.io;
the same Dockerfiles are reused there.

## First-time setup

1. **Make sure Docker Desktop is running.**
   `docker --version` should print 20.10+.

2. **Copy the secrets template:**
   ```bash
   cp .env.example .env
   ```

3. **Fill in `.env`.** The required keys are listed in `.env.example`
   with comments. Minimum to boot:
   - `DB_PASSWORD` — anything strong, doesn't have to match your local DB
   - `SECRET_KEY` — `python -c "import secrets; print(secrets.token_hex(32))"`
   - `PAYMENT_ENCRYPTION_KEY` — `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
   - SES / S3 / Google OAuth keys if you want those features working

4. **Build + start everything:**
   ```bash
   docker compose up -d --build
   ```
   First run takes ~5 minutes (downloading Python/Node/nginx base images,
   `pip install`, `npm ci`, `npm run build`). Subsequent runs are seconds.

5. **Tail logs to make sure migrations ran:**
   ```bash
   docker compose logs -f crm-backend external-api
   ```
   Look for `[kvstore] Using Postgres KV backend (crm_kv_store)` — that
   confirms multi-instance state is shared via PG.

## URLs

| Service       | URL                       |
|---------------|---------------------------|
| CRM frontend  | http://localhost:5174     |
| CRM backend   | http://localhost:8001/docs |
| External API  | http://localhost:8000/docs |
| Postgres      | `localhost:5432` (use pgAdmin) |

## Daily commands

```bash
# Start everything (after first build)
docker compose up -d

# Stop everything, keep DB
docker compose down

# Stop AND wipe DB volume (full reset)
docker compose down -v

# Rebuild ONE service after code change
docker compose build crm-backend && docker compose up -d crm-backend

# Tail logs from one service
docker compose logs -f crm-backend

# Get a shell inside a running container
docker compose exec crm-backend bash
docker compose exec postgres psql -U postgres -d crmdb
```

## When you change Python code

The Dockerfiles copy the source into the image — they don't volume-mount
it. So a code change requires a rebuild:

```bash
docker compose build crm-backend && docker compose restart crm-backend
```

For active development, you can switch to volume-mounted dev mode by
running native `python -m uvicorn main:app --reload --port 8001` on your
host machine and only using Docker for `postgres`:

```bash
docker compose up -d postgres
# then in a separate terminal, native:
cd CRM/backend && python -m uvicorn main:app --reload --port 8001
```

That gives you hot-reload without rebuilding the image on every save.

## When you change frontend code

Same idea — Dockerfile bakes the bundle in via `npm run build`. For
active dev, run Vite natively:

```bash
cd CRM/frontend && npm run dev
```

The Docker frontend container is mostly useful for verifying the
production build (it's what Fly.io will ship).

## Production (Fly.io) — preview

Each service has its own `Dockerfile` that Fly.io can deploy directly:

```bash
# CRM backend
cd CRM/backend && fly launch --dockerfile Dockerfile --name torta-crm-backend
fly deploy

# External API
cd External && fly launch --dockerfile Dockerfile --name torta-external-api
fly deploy

# CRM frontend
cd CRM/frontend && fly launch --dockerfile Dockerfile --name torta-crm-frontend \
    --build-arg VITE_API_BASE=https://api.tortacrm.com \
    --build-arg VITE_EXTERNAL_API_BASE=https://api.tortacrm.com
fly deploy
```

Postgres goes through `fly postgres create` and is attached to each
backend via `fly postgres attach`. We'll wire all of that up after the
local stack is green.

## Troubleshooting

**`crm-backend` keeps restarting.**
Check `docker compose logs crm-backend`. Most common cause: env var
typo or missing key. The backend won't start without `DB_PASSWORD`,
`SECRET_KEY`, `PAYMENT_ENCRYPTION_KEY`.

**`crm-frontend` builds but the SPA hits CORS errors in browser.**
The bundle baked in `VITE_API_BASE=http://localhost:8001` at build time.
If you opened the app via `http://localhost:5174` from your host, the
browser hits `localhost:8001` which IS exposed by the backend service.
Should "just work". If it doesn't, rebuild the frontend image with
matching URLs.

**Postgres data wiped after `down -v`.**
That's the intent of `-v`. Use plain `docker compose down` to keep data
across restarts.

**Port conflict (5174 / 8001 / 8000 / 5432 already in use).**
Stop the native instances of those services, or edit the `ports:`
section in `docker-compose.yml` to use different host ports
(e.g. `8002:8001`).
