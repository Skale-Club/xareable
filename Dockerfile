# syntax=docker/dockerfile:1
# Multi-stage build for the Xareable Vite (client) + Express (server) app.
# Runtime entry is the esbuild bundle dist/index.cjs (the same `npm start` path),
# which serves the SPA from dist/public and starts in-process node-cron.
#
# Base tag node:24-alpine is identical across every app on the shared Coolify
# host — Docker stores the base layer once and reuses it (the 80GB disk
# discipline; see skaleclub-apps/COOLIFY.md).

FROM node:24-alpine AS base
# libc6-compat: glibc shim sharp's prebuilt musl binary expects (image optimization).
# fontconfig:   @napi-rs/canvas / Skia text paths depend on it on Alpine — without it
#               canvas creation can fail with "Create skia surface failed" or render
#               blank text that works fine on a non-Alpine dev machine
#               (Brooooooklyn/canvas#826; 23-RESEARCH.md Pitfall 3).
RUN apk add --no-cache libc6-compat fontconfig
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

# Phase 23 (TYPO-04): build the fontconfig cache over the bundled Inter weights that
# `npm run build` just copied to dist/assets/fonts, then hard-gate the build on the
# golden-image test. This fails the build — instead of the production container
# crash-looping — when the musl canvas binary cannot run on this CPU
# (Brooooooklyn/canvas#1117, `Illegal instruction`) or when any pt-BR/es glyph
# renders as a tofu box. `tsx` is available here because the builder stage copies
# the full (dev-inclusive) node_modules from `deps`.
RUN fc-cache -f /app/dist/assets/fonts && npx tsx scripts/verify-golden-image.ts

# --- runner: production deps only + built output ---
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=8888
# esbuild externalizes non-allowlisted deps (sharp, @supabase/supabase-js,
# node-cron, dotenv, @napi-rs/canvas, …) — they must exist in node_modules at
# runtime.
# --ignore-scripts: the `prepare` hook runs husky (dev-only, absent under
# --omit=dev) and would fail; the runtime deps need no postinstall (sharp ships
# a prebuilt @img/sharp-linuxmusl-x64 binary — file extraction, no build step;
# @napi-rs/canvas ships its own prebuilt linux-x64-musl binary the same way,
# and its platform binary must be present for the RUN check below to pass).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist

# Phase 23: prove @napi-rs/canvas actually loads in the RUNNER image (production
# deps only, --ignore-scripts). A failure here means the musl binary is missing or
# the CPU lacks AVX — better a red build than a crash-looping container.
# Note: dist/index.cjs externalizes @napi-rs/canvas, so it must resolve from
# node_modules at runtime — this line proves it.
RUN node -e "const c=require('@napi-rs/canvas');const k=c.createCanvas(8,8);k.getContext('2d').fillRect(0,0,8,8);console.log('canvas runtime OK');"

EXPOSE 8888
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8888/api/health || exit 1
# --enable-source-maps: map minified stack traces back to TS (build emits .map).
CMD ["node", "--enable-source-maps", "dist/index.cjs"]
