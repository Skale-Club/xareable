# Apps Performance Dashboard

Live monitoring for the **Skale Club Coolify host** (Hetzner, 80 GB shared disk). It
**auto-discovers every app deployed via Coolify** (no hardcoded list) and shows each
app's status + latency alongside server health — with **disk vs the 80 GB limit** as
the first-class metric.

> Greenfield project scaffolded from the Notion spec
> [_Skale Club | Apps → Active Projects → Apps Performance Dashboard_](https://www.notion.so/370b7a6861218148a94eff0bb4f1d39c).
> This is **not** part of any app's own repo — it's a standalone observability app
> deployed onto the same shared Coolify host it monitors.

## Status

Roadmap items **01–09 are scaffolded**. Items 10–11 (QA against a live token, ship) and
the live-data paths of 05/03 are gated by blockers below.

| # | Item | State |
|---|------|-------|
| 01 | Next.js + TS scaffold (standalone, `node:24-alpine`) | ✅ Done |
| 02 | Read-only Coolify API client + config | ✅ Done (live calls need **B2**) |
| 03 | App discovery → normalized inventory (CORE) | ✅ Done (live verify needs **B2**) |
| 04 | HTTP health + latency prober | ✅ Done |
| 05 | Server health (CPU/RAM/disk vs 80 GB) | ✅ Code done; live data needs **B1** |
| 06 | MetricsStore (in-memory v1, Supabase-ready) | ✅ Done |
| 07 | Dashboard UI + auto-refresh | ✅ Done |
| 08 | Decision-support flags | ✅ Done |
| 09 | Access control (gate infra data) | ⚙️ Basic-auth stub; final method is **B4** |
| 10 | QA vs real Coolify token (headless) | ⛔ Blocked on **B2** |
| 11 | Ship — deploy + DNS + cert | ⛔ Blocked on host access |

The app **runs today** without any blocker resolved — it boots in a degraded state and
the UI tells you exactly what's unconfigured.

## Blockers (need owner input)

- **B1 — Netdata not installed.** Install Netdata on the host (keep `:19999` private).
  Set `NETDATA_BASE`. Until then the server-health panel shows "metrics unavailable".
- **B2 — Coolify API token.** Provide a **read-scoped** `COOLIFY_TOKEN` + `COOLIFY_BASE`.
  Until then app discovery is disabled (server health + manual probes still work).
- **B3 — Token rotation.** Reissue the token after the pending RUNBOOK rotation.
- **B4 — Access-control decision.** Choose Cloudflare Access (recommended) vs the
  built-in Basic-auth stub before exposing real infra data publicly.

## Architecture

```
Browser ─poll /api/snapshot─▶ Next.js route ─▶ collector ─┬─▶ Coolify REST (read-only)  → inventory
   ▲  (auto-refresh 20s)                                   ├─▶ HTTP probes of each fqdn  → up/down + latency
   └────────────── normalized Snapshot ◀───────────────────┼─▶ Netdata (B1)              → CPU/RAM/disk
                                                            └─▶ flags (decision support)
                                                                 │
                                                     MetricsStore (in-memory v1 · Supabase-ready)
```

Everything the UI renders is one normalized [`Snapshot`](src/lib/types.ts). Each source
fails independently — a missing token or absent Netdata never takes the page down.

### File map

```
src/
  lib/
    config.ts            env (degraded-mode aware; never throws on missing optional input)
    types.ts             the normalized Snapshot model
    coolify/client.ts    READ-ONLY Coolify REST client (no mutation methods exist)
    discovery.ts         normalize Coolify resources → inventory (CORE, no hardcoded list)
    probe.ts             concurrency-limited HTTP health + latency prober
    netdata/client.ts    server CPU/RAM/disk vs 80GB (graceful if Netdata absent)
    store/               MetricsStore interface + in-memory ring buffer + factory
    flags.ts             decision-support alerts (down/slow/error/disk/ram/cpu)
    collector.ts         orchestrates the sources into a cached Snapshot
  middleware.ts          access gate (Basic-auth stub / Cloudflare Access — B4)
  app/
    api/snapshot/route.ts  gated; serves the Snapshot (?force=1 bypasses cache)
    api/health/route.ts    ungated; container healthcheck
    page.tsx + components/ the dashboard UI
```

## Run locally

```bash
cp .env.example .env.local      # fill COOLIFY_TOKEN/BASE when available (B2)
npm install
npm run dev                     # http://localhost:3000
```

Without a token the dashboard loads and shows the "Coolify token not configured" banner.

```bash
npm run typecheck               # tsc --noEmit
npm run build                   # production build (standalone output)
```

## Deploy (item 11 — when unblocked)

Deploy on the same Coolify host: project `skale-apps` / env `production`, **Dockerfile**
build pack (`node:24-alpine`, `output: 'standalone'`). Suggested domain `apps.skale.club`
or `status.skale.club` via `scripts/cloudflare_dns.py` (dns-only first for the LE cert).
Set runtime env: `COOLIFY_BASE`, `COOLIFY_TOKEN`, `NETDATA_BASE`, `DASHBOARD_BASIC_AUTH`
(or front with Cloudflare Access). Container healthcheck hits `/api/health`.

## Notes

- **Read-only by construction:** the Coolify client exposes GET methods only — there are
  no deploy/stop/delete calls anywhere.
- **Dynamic by construction:** the app list comes from Coolify every refresh; add/remove
  an app on the host and it appears/disappears on the next poll.
- **Supabase deferred:** history is in-memory (resets on redeploy). When `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` are set, implement a `SupabaseMetricsStore` satisfying the
  `MetricsStore` interface in [`src/lib/store/`](src/lib/store) — it's a drop-in.
