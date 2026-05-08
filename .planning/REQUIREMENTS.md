# Requirements: My Social Autopilot — v1.3 Generation Quality Observability

**Defined:** 2026-05-08
**Core Value:** Users can generate on-brand visual content (single posts, multi-slide carousels, and professionally enhanced product photos) in seconds from a prompt or a reference image — and recover any post they accidentally delete within a 30-day trash window.
**Milestone Goal:** Add structured operational telemetry to the generation pipeline so future quality regressions are detected via logs (not user complaints) and dead caption helpers from the post-generation rebuild are removed. Graduates SEED-005.

## v1.3 Requirements

Each requirement maps to exactly one phase. The roadmapper assigns phase numbers.

### Observability (OBS)

Structured operational logs feeding the existing `generation_logs` table. No new schema, no new dependencies, no new external telemetry pipelines. The premise: the generation pipeline is the product, and it has zero introspection today — every regression has to surface via user reports.

- [ ] **OBS-01**: `server/services/text-rendering.service.ts` writes one `generation_logs` row per call to `verifyExactText()` with structured fields capturing: `post_id`, `verification_outcome` (one of: `pass`, `repair_triggered`, `repair_succeeded`, `repair_failed`), `expected_text_hash` (SHA-256 of the requested exact text), `detected_text` (verbatim from the verification step), `repair_attempt_count` (0 or 1), and `duration_ms`. Logs are best-effort (failures in the log path do NOT block the generation flow).
- [ ] **OBS-02**: `server/services/caption-quality.service.ts` writes one `generation_logs` row per `ensureCaptionQuality()` invocation with structured fields capturing: `post_id`, `quality_outcome` (one of: `pass`, `retry_triggered`, `repair_triggered`, `fallback_used`), `attempt_count`, `final_caption_length`, `final_caption_paragraph_count`, and `duration_ms`. Logs are best-effort.
- [ ] **OBS-03**: When the generation pipeline detects a subject-fidelity failure (defined as: the user uploaded reference images AND the final image's reverse-image-similarity score against the references falls below a threshold OR the post-generation `subject_fidelity_warning` flag is raised by the prompting layer), one `generation_logs` row is written with `error_type = 'subject_fidelity'`, `post_id`, `reference_image_count`, and `failure_reason`. This requirement is satisfied by surfacing the existing detection signals (if any) into structured logs — NOT by inventing a new detection mechanism.
- [ ] **OBS-04**: Dead caption helper functions in `server/routes/posts.routes.ts` left over from the post-generation rebuild are removed. Verification: a `git grep` for the removed function names returns zero hits across `server/`, `client/`, `shared/`, and `scripts/`; `npm run check` and `npm run build` succeed; the existing post-generation flow (create / edit / remake-caption) continues to work end-to-end.

## Future Requirements

Deferred to later milestones. Tracked but not in v1.3 scope.

### Live E2E Validation (SEED-002)

- **VRFY-V2-01**: Test-mode harness exercising Stripe (subscription checkout, Connect onboarding, auto-recharge off-session, customer portal, webhook flow) end-to-end with real test credentials.
- **VRFY-V2-02**: GA4 + Facebook Conversions API delivery validation — generate a marketing event, confirm it lands in DebugView / Test Events tool within N seconds.
- **VRFY-V2-03**: Documented runbook + reusable fixtures so the harness re-runs after each integration change.

### Refactor (SEED-004)

- **REFACTOR-V2-01**: Split `client/src/components/post-creator-dialog.tsx` (2189 LOC) into per-step files under `post-creator/`.
- **REFACTOR-V2-02**: Split `server/routes/admin.routes.ts` (~1900 LOC) into focused modules.
- **REFACTOR-V2-03**: Split `client/src/components/admin/integrations-tab.tsx` (~1800 LOC) by integration section.
- **REFACTOR-V2-04**: Split `client/src/lib/translations.ts` (~1100 LOC) into per-language files for tree-shaking.
- **REFACTOR-V2-05**: Split `server/stripe.ts` (~1000 LOC) into checkout/subscription/webhook/customer/connect services.

### GHL Reconciliation (SEED-003)

- **GHL-V2-01**: Decide direction (remove admin / build lead-capture surface / repurpose as marketing-event sink) and execute.

### Future product surfaces (no seed yet)

- Direct social publishing (Instagram OAuth) — currently in PROJECT.md "Out of Scope"
- Multi-brand / teams (multiple brands per account, or shared brand across team)
- Templates / receitas reusáveis (saved generation configs)
- Per-user history / analytics dashboard

## Out of Scope

Explicitly excluded from v1.3. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| New product features | v1.3 is observability-only; feature work resumes in v1.4 |
| New telemetry pipelines (Sentry, Datadog, etc.) | Stick with the existing `generation_logs` table — proves utility before adding infra |
| Manual human UAT for prior phases (5–9.1, 11, 12) | Owner-time-bounded; tracked in seeds for revisit |
| Live billing/ads validation with real test creds | Tracked in SEED-002; defers to dedicated milestone |
| Fat file refactor | Tracked in SEED-004; not blocking, mechanical, deferred |
| GHL integration product-fit decision | Tracked in SEED-003; needs product conversation |
| Reverse-image-similarity scoring as new feature | Out of scope unless OBS-03 detection requires it; if it does, surface as a question during planning, not invent during execution |
| Frontend dashboard surfacing the new logs | Logs are infrastructure; visualization is a future milestone if/when ops need surfaces it |

## Traceability

Populated by the roadmapper when `ROADMAP.md` is created.

| Requirement | Phase | Status |
|-------------|-------|--------|
| OBS-01 | TBD | Pending |
| OBS-02 | TBD | Pending |
| OBS-03 | TBD | Pending |
| OBS-04 | TBD | Pending |

**Coverage:**
- v1.3 requirements: 4 total
- Mapped to phases: TBD (filled by roadmapper)
- Unmapped: TBD

---
*Requirements defined: 2026-05-08 — graduating SEED-005 with adjusted V2 scope (OBS-V2-01..04 → OBS-01..04).*
