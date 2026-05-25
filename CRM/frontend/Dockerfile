# syntax=docker/dockerfile:1.7
# CRM frontend (React + Vite SPA, includes the Landing).
#
# Two stages: Node builds the static bundle, then nginx serves it. Final
# image is ~50 MB (Node is huge, nginx:alpine is tiny). Build args let us
# bake the API base URL into the bundle at build time — Vite resolves
# `import.meta.env.VITE_*` literals into the JS during `npm run build`,
# so the runtime needs no env vars at all.

# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Cache npm install: copy lockfile first, install, then copy the rest. A
# code-only change reuses the (much heavier) node_modules layer.
COPY package*.json ./
RUN npm ci

# Build-time API endpoint — defaults match local docker-compose service
# names; override with `--build-arg VITE_API_BASE=https://api.tortacrm.com`
# when building for production.
ARG VITE_API_BASE=http://localhost:8001
ARG VITE_EXTERNAL_API_BASE=http://localhost:8000
ENV VITE_API_BASE=${VITE_API_BASE} \
    VITE_EXTERNAL_API_BASE=${VITE_EXTERNAL_API_BASE}

COPY . .
RUN npm run build

# ─── Stage 2: serve ──────────────────────────────────────────────────────────
FROM nginx:alpine AS runtime

# Drop the stock default.conf and ship our own — adds the SPA fallback
# (any unknown path → /index.html so client-side routing works).
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static bundle from the builder stage. Nginx serves /usr/share/nginx/html
# by default — drop Vite's dist/ there.
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:80/ > /dev/null || exit 1

# nginx:alpine already CMD's `nginx -g 'daemon off;'` — no override needed.
