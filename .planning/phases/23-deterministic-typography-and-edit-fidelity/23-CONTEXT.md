# Phase 23: Deterministic Typography & Edit Fidelity - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Images are generated text-free with reserved negative space; a `@napi-rs/canvas`-based typography compositor renders headline/support/CTA text with real bundled fonts and guaranteed contrast; edit and remake flows operate on a persisted pre-typography base image and reuse the original generation parameters — eliminating the AI-rendered-text verify/repair loop entirely.

</domain>

<decisions>
## Implementation Decisions

### Compositor & Layout Archetypes (TYPO-01, TYPO-02, TYPO-03)
- Single bundled font family (e.g. Inter — full pt-BR/es Latin Extended glyph coverage, permissive license, multiple weights) used across headline/support/CTA, differentiated by weight/size rather than requiring multiple font families.
- Exact positioning/sizing specs for the 3 layout archetypes (bottom band w/ scrim, top stack, centered hero) and per-format safe-zone margins (incl. IG 4:5 grid-crop) are Claude's technical discretion, informed by research — no specific pixel values mandated here.
- The image-generation prompt (built from Phase 22's `text_blocks`/`layout_archetype_id` schema fields) must explicitly instruct the model to leave blank/negative space in the target text region matching the chosen archetype — this is new prompt-engineering work building on Phase 22's forward-compat schema fields.
- Contrast/scrim algorithm: sample target-region stats via `sharp` (e.g. average luminance/color), apply an automatic semi-transparent scrim/plate behind text when contrast is insufficient (WCAG-inspired threshold) — exact algorithm and threshold are Claude's discretion, but must be deterministic and covered by the golden-image test.

### Font Bundling & CI Golden-Image Test (TYPO-04)
- Font files are committed directly into the repo (e.g. `server/assets/fonts/`), not downloaded at Docker build time — deterministic, no network dependency, controlled license footprint.
- `fontconfig` + `fc-cache` installed via `apk` in the Alpine-based Dockerfile (standard package addition) — exact Dockerfile diff is Claude's discretion.
- A CI golden-image test renders sample pt-BR/es text (accented characters — á, ç, ñ, etc.) at build time and fails the build if missing-glyph/tofu boxes are detected — exact test mechanism (pixel-diff, glyph-presence check, or similar) is Claude's discretion.

### Base Image Persistence & Edit Fidelity (TYPO-05, TYPO-06, TYPO-07)
- New additive columns: `posts.base_image_url` (the raw AI output, post-crop, pre-typography/pre-logo) and `posts.typography_meta` (JSONB: layout archetype, text blocks, fonts used).
- `post_versions` gains the equivalent per-version columns (`base_image_url`, `typography_meta`) — consistent with the existing versioning pattern.
- Edit flow is rewritten: fetch and edit `base_image_url` (not the flattened `image_url`) via the AI image model, then re-run the crop → compositor (typography + logo) pipeline on the freshly-edited base, persisting both a new `base_image_url` and the new final `image_url` as a new version.
- The AI-rendered-text verify/repair loop (`verifyExactImageText`/`enforceExactImageText` in `text-rendering.service.ts`, plus their `generation_logs` observability calls) is removed entirely — the compositor guarantees correct text deterministically (TYPO-06).
- Backward compatibility: existing posts created before this migration have `base_image_url = NULL`. Editing such a post falls back to the legacy behavior (operates on `image_url` directly, no typography re-composite) — no backfill migration, no lockout. New posts get full base-image fidelity from day one.

### Aspect Ratio Crop & Generation Params Persistence (POL-04, POL-05)
- Deterministic center-crop to the exact requested aspect ratio via `sharp` (`fit: cover`-equivalent, computed crop box) applied to the raw AI output, BEFORE typography/logo compositing runs.
- New additive `posts.generation_params` JSONB column (aspect_ratio, resolution, content options like `use_logo`/`logo_position`/`text_mode`) persisted at generation time.
- Edit/remake flows read and reuse `generation_params` instead of guessing/regex-parsing the stored prompt text (this replaces the existing `recoverVideoAspectRatioFromPrompt` regex hack and quick-remake's generic-default synthesis found in `edit.routes.ts`).
- Remake/quick-remake UI (`post-viewer-dialog.tsx`, `post-edit-dialog.tsx`) pre-fills from persisted `generation_params` using the aspect-ratio/logo-position controls that already exist in `post-creator-dialog.tsx`, instead of generic defaults — this is UI wiring to existing controls, not new UI design.

### Claude's Discretion
- Exact layout-archetype pixel/percentage specs and safe-zone margins.
- Exact contrast/scrim algorithm and threshold.
- Exact golden-image CI test mechanism.
- Exact Dockerfile fontconfig setup.
- Exact `typography_meta`/`generation_params` JSONB shapes (informed by Phase 22's existing `text_blocks`/`layout_archetype_id` schema).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sharp` already a dependency (`package.json:75`) — used for logo overlay (`image-optimization.service.ts:153-218` `applyLogoOverlay`, 9-anchor grid pattern) and thumbnail resize. No existing text-rendering or SVG compositing code — `@napi-rs/canvas` (per TYPO-02, not yet a dependency) needs to be added.
- Existing deterministic logo-overlay step in `generate.routes.ts:697-725` (already "deterministic logo placement", runs after AI verify/repair today) — the compositor's new typography step slots in alongside/before this existing deterministic step.
- `post-creator-dialog.tsx` already has aspect-ratio (`:191`, `:1551-1558`) and logo-position (`:190`, `:1510`) controls — reusable for remake UI wiring, not net-new design.
- `post-edit-dialog.tsx` already has a text-edit-mode picker (`:390-407`, keep/improve/replace/remove) — separate from generation-time text_mode, may need reconciling.

### Established Patterns
- `post_versions` table already tracks `image_url`/`edit_prompt`/`version_number` per edit — the pattern to extend with `base_image_url`/`typography_meta`.
- Additive-migration convention used throughout the project — `posts.base_image_url`, `posts.typography_meta`, `posts.generation_params` are all new nullable columns, no drops.
- `logTextVerification` observability pattern (`observability.service.ts`) — being removed along with the verify/repair loop it instruments; no replacement observability needed since the compositor's output is deterministic (no AI-judgment step to log).

### Integration Points
- `server/services/text-rendering.service.ts` (`verifyExactImageText`, `enforceExactImageText`) — DELETED entirely per TYPO-06.
- `server/routes/generate.routes.ts:660-725` — exact-text trigger + logo overlay step replaced by: crop → typography compositor → logo overlay (in that order).
- `server/routes/edit.routes.ts:274-286, 393-398, 489-495` — rewritten to operate on `base_image_url` instead of the flattened `image_url`; `recoverVideoAspectRatioFromPrompt` regex hack (`:40-43`) replaced by reading persisted `generation_params`.
- Phase 22's `text_blocks`/`layout_archetype_id` fields on the planning-call structured output — the direct input driving both the reserved-negative-space prompt instruction and the compositor's rendering.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP's stated success criteria and REQUIREMENTS.md's TYPO-01..07/POL-04/05 — these are the primary specification, cross-checked against the codebase scout above.

</specifics>

<deferred>
## Deferred Ideas

- Contrast-aware adaptive logo overlay color/treatment — explicitly Phase 26's scope ("Fixes & Polish"), not this phase. This phase's logo overlay stays purely positional as it is today.
- Backfilling `base_image_url`/`generation_params` for existing posts — explicitly out of scope; old posts keep working via the legacy edit fallback.

</deferred>
