# Phase 20: Generation Integration — Discussion Log

> **Audit trail only.** Decisions are in CONTEXT.md.

**Date:** 2026-05-16
**Phase:** 20-generation-integration
**Mode:** --auto (Claude picked recommended defaults)
**Areas decided:** Injection point, merge strategy, download approach, toggle placement, scope constraint

---

## Server Injection Point

| Option | Description | Selected |
|--------|-------------|----------|
| After brand fetch, before text gen | Fetch brand photos once, merge into merged array | ✓ |
| Inline at each generation call site | Fetch per call site | |

**Claude's choice:** After brand fetch — one fetch, one merge, used everywhere. Cleaner.

---

## Download Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| fetch(url) → arrayBuffer → base64 | Uses Node 18 native fetch, photos are public URLs | ✓ |
| Supabase signed URL | Extra API call overhead | |
| Admin client download | More complexity | |

**Claude's choice:** Native `fetch()` — photos are public, no auth needed for download. Best-effort with silent skip on failure.

---

## Toggle Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Above generate button (in flex-col gap-3) | Matches natural flow, near action | ✓ |
| In reference images section | Far from button, harder to find | |

**Claude's choice:** Above generate button — same container as credit info, natural grouping.

---

## Content Type Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Image only (not carousel, not enhancement) | Per v1.5 scope decision | ✓ |
| All content types | Too broad, carousel/enhance have separate routes | |

**Claude's choice:** Image only — carousel and enhancement are deferred to v1.6 per SEED-006 out-of-scope.

---

## Claude's Discretion

- `mergedReferenceImages` as the unified variable name (replaces `referenceImageBase64` concept)
- Helper function at module scope (not inline lambda)
- `use_brand_references: hasBrandReferences ? useBrandReferences : undefined` — avoids sending flag when no photos exist
- Reset `useBrandReferences` to `true` on fresh start (matches other ephemeral state resets)

## Deferred Ideas

- Carousel and enhancement routes using brand references (v1.6)
- Style description in text generation prompt (v1.6)
- Per-photo deselection in creator dialog (future)
