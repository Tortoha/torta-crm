# syntax=docker/dockerfile:1.7
# Admin panel frontend — same multi-stage pattern as CRM/frontend:
# Node builds the Vite bundle, nginx:alpine serves it. Talks to the same
# CRM backend on :8001 (admin endpoints under /api/admin/*).

# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

ARG VITE_API_BASE=http://localhost:8001
ENV VITE_API_BASE=${VITE_API_BASE}

COPY . .
RUN npm run build

# ─── Stage 2: serve ──────────────────────────────────────────────────────────
FROM nginx:alpine AS runtime

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:80/ > /dev/null || exit 1
