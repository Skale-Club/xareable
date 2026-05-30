# syntax=docker/dockerfile:1
# Multi-stage build for the Xareable Vite (client) + Express (server) app.
# Runtime entry is the esbuild bundle dist/index.cjs (the same `npm start` path),
# which serves the SPA from dist/public and starts in-process node-cron.
#
# Base tag node:24-alpine is identical across every app on the shared Coolify
# host — Docker stores the base layer once and reuses it (the 80GB disk
# discipline; see skaleclub-apps/COOLIFY.md).

FROM node:24-alpine AS base
# glibc shim that sharp's prebuilt binary expects on musl (image optimization).
RUN apk add --no-cache libc6-compat
WORKDIR /app

# --- deps: full install (incl. devDeps) needed to build client + server ---
FROM base AS deps
COPY package.json package-lock.json ./
# `npm install` (not `npm ci`) so the platform-specific sharp binary
# (@img/sharp-linuxmusl-x64) resolves correctly for alpine. A lockfile
# regenerated on Windows mangles sharp's cross-platform optional tree, which
# makes the strict `npm ci` skip the musl binary. This mirrors the install
# command Vercel used, so behavior is unchanged.
RUN npm install --no-audit --no-fund

# --- builder: vite build + esbuild bundle -> dist/ ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No build-time/public env vars: the client fetches Supabase config from
# /api/config at runtime, so there are no VITE_*/inlined values to pass here.
RUN npm run build

# --- runner: production deps only + built output ---
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=8888
# esbuild externalizes non-allowlisted deps (sharp, @supabase/supabase-js,
# node-cron, dotenv, …) — they must exist in node_modules at runtime.
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/dist ./dist
EXPOSE 8888
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8888/api/health || exit 1
CMD ["node", "dist/index.cjs"]
