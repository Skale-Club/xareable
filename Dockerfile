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
# Neutralize the `prepare` husky hook in CI: there's no .git in the build context
# and husky is dev-only. HUSKY=0 makes it a no-op where husky IS installed (deps);
# the runner stage additionally uses --ignore-scripts since husky is omitted there.
ENV HUSKY=0
WORKDIR /app

# --- deps: full install (incl. devDeps) needed to build client + server ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

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
# --ignore-scripts: the `prepare` hook runs husky (dev-only, absent under
# --omit=dev) and would fail; the runtime deps need no postinstall (sharp ships
# a prebuilt @img/sharp-linuxmusl-x64 binary — file extraction, no build step).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist
EXPOSE 8888
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8888/api/health || exit 1
CMD ["node", "dist/index.cjs"]
