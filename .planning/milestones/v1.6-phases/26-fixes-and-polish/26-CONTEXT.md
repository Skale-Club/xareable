# Phase 26: Fixes & Polish - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

The remaining output-quality and hygiene gaps close out the milestone — sharper WebP compression with a text-edge quality check, contrast-aware adaptive logo overlay, idempotent generate/edit APIs, a post-migration cost reconciliation against the OpenRouter dashboard (scheduled/documented only — does not gate milestone close), and a thumbs-up/down feedback loop surfaced on an admin quality dashboard.

</domain>

<decisions>
## Implementation Decisions

### WebP Quality & Text-Edge Check (POL-02)
- `DEFAULT_IMAGE_QUALITY` bumped from 80 to 85 (main image; thumbnail quality stays a separate, lower setting as today).
- Automated text-edge artifact check follows Phase 23's golden-image pattern: render text via the compositor, encode to WebP at the new quality setting, measure edge-sharpness retention in a region straddling a text edge (reusing the existing region-contrast-analysis sampling approach), and fail if it degrades below a threshold. No new image-analysis library — built on `sharp`'s existing stats/extract capabilities, same as Phase 23's contrast analysis.

### Adaptive Logo Overlay (POL-03)
- Reuse/adapt `analyzeRegionContrast` (Phase 23) to sample the logo's target region and decide whether a backing plate/shadow is needed when contrast is insufficient.
- Fix the specific JPEG (no-alpha) logo bug: instead of compositing a raw rectangular non-transparent image (producing a visible opaque box), apply a soft-edged plate/shadow treatment behind it so no hard box artifact appears.
- If the user has explicitly chosen a `logo_position`, that choice is RESPECTED — only the plate/shadow treatment at that position is contrast-adaptive. Automatic corner selection by region-contrast analysis applies only as the fallback algorithm when no `logo_position` was explicitly set by the user — it never silently overrides an explicit user choice.

### Idempotent Generate/Edit APIs (POL-06)
- Mirrors the EXISTING carousel/enhance idempotency contract exactly: `idempotency_key: z.string().uuid()` in the request body, a pre-flight `SELECT` by `(idempotency_key, user_id)` before any generation work starts, a DB unique index for concurrent-request race safety, and returning the existing post (200 JSON) on a detected duplicate rather than creating a new one or double-charging.
- `generate.routes.ts` reuses the same `posts.idempotency_key` column already used by carousel/enhance (new post created, same table).
- `edit.routes.ts` gets its OWN new `post_versions.idempotency_key` column (additive migration) — since an edit creates a new `post_versions` row, not a new `posts` row, the dedup check and unique index apply to that table instead.

### Feedback + Admin Quality Dashboard (POL-09)
- New additive `posts.feedback` column (`z.enum(["up","down"]).nullable()`) — one vote per post, overwritable (changing your mind re-submits the same field), no separate feedback-event table.
- New "Quality" tab in the admin panel (alongside the existing `GenerationsTab`/`DashboardTab` pattern) showing: feedback tally (thumbs up/down counts) + critic outcome rates (`generation_logs.event_kind='visual_critic'`, from Phase 24) + fallback rates (`event_kind='model_fallback'`, from Phase 21) together on one dashboard. Backed by a new admin route/query, since the existing `admin-generations.routes.ts` route explicitly does not select `event_kind`/`outcome`/`metadata` today.
- User-facing thumbs-up/down UI lives in `post-viewer-dialog.tsx` (where users already view their generated posts) — not a new page.

### Resolved Design Questions (from research)
- **Client-side idempotency_key generation is IN SCOPE.** Research found the 4 client call sites for generate/edit/remake (`post-creator-dialog.tsx`, `post-edit-dialog.tsx`, `post-viewer-dialog.tsx`, `posts.tsx`) currently send no `idempotency_key` at all — unlike carousel/enhance's client paths, which already generate and send one as part of the existing working contract. This phase must add client-side `idempotency_key` generation (e.g. `crypto.randomUUID()`) to all 4 generate/edit call sites, following whatever pattern the existing carousel/enhance client call sites already use — otherwise POL-06's server-side work has no effect end-to-end.
- **Concurrent-duplicate race behavior:** replicate the EXISTING carousel/enhance contract exactly, including its known race-condition gap (a genuinely concurrent duplicate request currently surfaces as a generic 500, not a graceful 200) — this phase mirrors the established pattern verbatim, it does not additionally improve on a pre-existing edge case outside its own scope.
- **`post_versions` has no `user_id` column** — edit's idempotency dedup check is scoped by `(idempotency_key, post_id)`, not `(idempotency_key, user_id)` like generate/carousel/enhance's `posts`-table check.
- **POL-08's reconciliation scaffold** treats `usage_events` (real per-request cost) as the primary source of truth for the audit; `generation_logs`' cost-related metadata is used only for investigating/explaining any discrepancy found, not as a second primary total.

### POL-08 (Cost Reconciliation) — Explicitly Deferred, Non-Gating
- Per ROADMAP's explicit callout: this requires one full billing period of real gateway traffic after the OpenRouter migration and CANNOT gate milestone close. This phase's job is to set up/schedule the audit (e.g., a documented runbook + any lightweight query/report scaffolding), not to actually run and close it — the reconciliation itself completes later, after the milestone ships.

### Claude's Discretion
- Exact WebP quality threshold formula for the automated edge-sharpness regression check.
- Exact contrast threshold / plate treatment algorithm for adaptive logo overlay.
- Exact `post_versions.idempotency_key` migration shape and dedup query.
- Exact admin Quality-tab layout/query shape.
- Exact POL-08 scheduling mechanism (could be a documented runbook, a scheduled reminder, or a lightweight scaffold query — not a fully-run audit).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `server/services/image-optimization.service.ts` — `DEFAULT_IMAGE_QUALITY = 80` (`:30`), `optimizeImage`/`generateThumbnail`/`processImageWithThumbnail`, `applyLogoOverlay` (`:153-218`, purely positional 3x3 grid, no contrast analysis).
- `server/services/typography-compositor.service.ts`'s `analyzeRegionContrast` (`:317-366`) — generic rectangular-region sampler (not text-specific in implementation), directly reusable/adaptable for logo-region contrast analysis.
- Existing carousel/enhance idempotency contract (`shared/schema.ts:1407,1424`, `carousel.routes.ts:340-354`, `enhance.routes.ts:204-218`, `posts.idempotency_key` DB unique index) — the exact pattern to replicate for generate/edit.
- `generation_logs.event_kind` already includes `"model_fallback"` (Phase 21) and `"visual_critic"` (Phase 24) with queryable `outcome`/`metadata` fields — data already exists, just needs a new admin route/query.
- `client/src/pages/admin.tsx`'s tab-switch pattern (`:46-74`) and `GenerationsTab` component — template for the new Quality tab.

### Established Patterns
- Additive-migration convention throughout the project.
- Phase 23's golden-image CI-test pattern — template for the new WebP text-edge regression check.
- `server/services/observability.service.ts:124-127` already has a code comment flagging this exact gap: "Admin UI for these rows is Phase 26 (POL-09), not this phase."

### Integration Points
- `server/services/image-optimization.service.ts` — quality constant bump + `applyLogoOverlay` rewrite.
- `server/routes/generate.routes.ts`, `server/routes/edit.routes.ts` — idempotency pre-flight check + schema fields.
- `shared/schema.ts` — `generateRequestSchema`/`editPostRequestSchema` gain `idempotency_key`; `postSchema` gains `feedback`.
- `server/routes/admin-generations.routes.ts` or a new `admin-quality.routes.ts` — new query surfacing `event_kind`/`outcome`/`metadata` aggregates.
- `client/src/pages/admin.tsx` — new Quality tab; `client/src/components/post-viewer-dialog.tsx` — thumbs-up/down UI.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP's stated success criteria and REQUIREMENTS.md's POL-02/03/06/08/09 — these are the primary specification, cross-checked against the codebase scout above.

**Known pre-existing bug worth folding into this phase's scope (found during Phase 25 execution, logged in `.planning/phases/25-narrative-carousels-and-aesthetic-dna/deferred-items.md`):** `typography-compositor.service.ts`'s `drawBlocks()` never sets `ctx.font` itself — it relies on whatever font `ctx` was left in by the LAST block iterated inside `layoutBlocks()`'s measurement loop, so in a multi-block layout (headline+support+cta) all blocks may render with one block's font/size instead of each block's own. This predates Phase 25 (present since Phase 23) and was explicitly left unfixed there to preserve "byte-identical to Phase 23" test guarantees. Phase 26 ("Fixes & Polish") is the natural place to close this — research/planning should confirm the fix and update the golden-image baseline accordingly (this WILL change output bytes, intentionally).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (POL-08 itself is explicitly a deferred/scheduled-not-run item per the ROADMAP's own design, not a discussion-surfaced deferral.)

</deferred>
