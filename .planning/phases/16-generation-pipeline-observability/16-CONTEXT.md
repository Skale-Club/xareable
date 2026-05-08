# Phase 16: Generation Pipeline Observability - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Source:** Direct authoring after roadmapper surfaced 2 open questions (OBS-03 signal source + generation_logs schema strategy)

<domain>
## Phase Boundary

Add structured operational telemetry to the generation pipeline so quality regressions surface via logs (not user complaints), and remove dead duplicate caption helpers in `server/routes/posts.routes.ts`.

**In scope (4 OBS reqs):**
- OBS-01: log every `verifyExactImageText` / `enforceExactImageText` call from `server/services/text-rendering.service.ts`
- OBS-02: log every `ensureCaptionQuality` call from `server/services/caption-quality.service.ts`
- OBS-03: scaffold a subject-fidelity logging helper (NO new detection mechanism — see decisions)
- OBS-04: remove dead duplicate caption helpers from `server/routes/posts.routes.ts`

**Out of scope:**
- New telemetry pipelines (Sentry, Datadog, OpenTelemetry, etc.) — stick with existing `generation_logs`
- Frontend dashboard / admin UI surface for the new logs — future milestone
- Reverse-image-similarity scoring as new feature
- Inventing a subject-fidelity detection mechanism (OBS-03 explicitly forbids)

</domain>

<decisions>
## Implementation Decisions

### Decision 1: Schema strategy → **extend `generation_logs` with new columns**

**Open question from roadmapper:** stuff structured fields into `request_params` JSONB OR add first-class columns?

**Decision: extend with first-class columns + add enum value.**

Reasoning:
- First-class columns are query-friendly (`SELECT verification_outcome, count(*) FROM generation_logs WHERE ... GROUP BY verification_outcome` works directly; JSONB requires `->>` casts and harder index strategies)
- `error_type` enum frozen to 5 values today; adding `'subject_fidelity'` requires either ENUM extension OR widening to TEXT. ENUM extension is the cleanest.
- The `request_params` JSONB stays for unstructured/varying context; the new fields (which appear on EVERY log row) deserve their own columns
- PROJECT.md said "no new schema" — that meant "no new tables, no new dependencies"; column additions on an existing table are inside that spirit
- Migration is tiny (1 ALTER TABLE adding 8 columns + 1 enum-add); zero risk to existing rows

**New migration:** `supabase/migrations/{timestamp}_generation_logs_observability.sql`

```sql
-- Extend generation_logs with structured observability fields (Phase 16)

-- 1. Allow new error_type values (existing rows untouched; CHECK constraint kept aligned)
ALTER TABLE public.generation_logs
  DROP CONSTRAINT IF EXISTS generation_logs_error_type_check;

ALTER TABLE public.generation_logs
  ADD CONSTRAINT generation_logs_error_type_check
    CHECK (error_type IN (
      'text_generation',
      'image_generation',
      'upload',
      'database',
      'unknown',
      'subject_fidelity',           -- new (OBS-03)
      'text_verification',          -- new (OBS-01 — emitted when status='failed')
      'caption_quality'             -- new (OBS-02 — emitted when status='failed')
    ));

-- 2. Add first-class structured columns (all NULLABLE — existing rows have no values)
ALTER TABLE public.generation_logs
  ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_kind TEXT,                    -- 'text_verification' | 'caption_quality' | 'subject_fidelity'
  ADD COLUMN IF NOT EXISTS outcome TEXT,                       -- 'pass' | 'repair_triggered' | 'repair_succeeded' | 'repair_failed' | 'retry_triggered' | 'fallback_used' | 'failure'
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb; -- per-event extra fields (expected_text_hash, detected_text, final_caption_length, reference_image_count, etc.)

-- 3. Indexes for the typical query patterns
CREATE INDEX IF NOT EXISTS idx_generation_logs_post_id
  ON public.generation_logs (post_id) WHERE post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_logs_event_kind_outcome
  ON public.generation_logs (event_kind, outcome) WHERE event_kind IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_logs_created_event
  ON public.generation_logs (created_at DESC, event_kind) WHERE event_kind IS NOT NULL;

-- 4. RLS unchanged — admin-only read access from the original migration still applies
```

**Zod schema update in `shared/schema.ts:generationLogSchema`:** add the new fields as optional (`.optional()`).

### Decision 2: OBS-03 signal source → **scaffolding-only (path b)**

**Open question from roadmapper:** OBS-03 says "log when subject-fidelity signal fires", but `subject_fidelity` doesn't exist anywhere in `server/`.

**Decision: scaffolding-only.** Build the log-emission helper + call site WITHOUT a signal source. Future PR adds the trigger when a real detection mechanism (e.g., reverse-image-similarity scorer) lands.

Reasoning:
- OBS-03's own constraint forbids inventing detection
- Scaffolding-only fully satisfies "logs the signal IF it fires" — the IF currently never fires, but the logging branch is type-checked, tested for log-shape correctness, and ready
- Defer-with-seed is the alternative; chose scaffolding because it leaves the door open for any future detection signal to plug in trivially (one function call) without needing to revisit OBS scope

**Implementation:**
- Create exported helper `logSubjectFidelityFailure({postId, referenceImageCount, failureReason})` in a new `server/services/observability.service.ts`
- Call site: NONE today. The function is exported and ready; future work that adds a detection signal in `gemini.service.ts` or `image-generation.service.ts` plugs in via single import + call
- Unit-test-equivalent verification: the function exists, returns void on success, swallows errors (best-effort), and produces the correct row shape when invoked. A small inline test in `scripts/verify-phase-16.ts` exercises it via direct invocation (NOT via real gen flow).

### Decision 3: Logging surface → new `server/services/observability.service.ts`

Single file consolidating ALL three log emitters (OBS-01, OBS-02, OBS-03). Avoids splattering `recordGenerationLog` calls into business logic.

```typescript
// server/services/observability.service.ts
export interface TextVerificationLogParams {
  postId: string | null;
  outcome: "pass" | "repair_triggered" | "repair_succeeded" | "repair_failed";
  expectedTextHash: string;        // SHA-256
  detectedText: string | null;
  repairAttemptCount: number;       // 0..2
  durationMs: number;
}

export interface CaptionQualityLogParams {
  postId: string | null;
  outcome: "pass" | "retry_triggered" | "repair_triggered" | "fallback_used";
  attemptCount: number;
  finalCaptionLength: number;
  finalCaptionParagraphCount: number;
  durationMs: number;
}

export interface SubjectFidelityLogParams {
  postId: string | null;
  referenceImageCount: number;
  failureReason: string;
}

export async function logTextVerification(params: TextVerificationLogParams): Promise<void>;
export async function logCaptionQuality(params: CaptionQualityLogParams): Promise<void>;
export async function logSubjectFidelityFailure(params: SubjectFidelityLogParams): Promise<void>;
```

All three functions:
- Use `createAdminSupabase()` for the insert (same pattern as existing `logGenerationError` in `generate.routes.ts`)
- Wrap the insert in try/catch and SWALLOW errors (best-effort — never block generation flow)
- Insert with `event_kind`, `outcome`, `attempt_count`, `duration_ms`, `metadata` (JSONB carrying type-specific fields like `expected_text_hash`, `detected_text`, etc.), and `error_type` is left NULL for success outcomes / set to one of the new enum values for failure outcomes

### Decision 4: Call site integration

**OBS-01 (`text-rendering.service.ts`):** `enforceExactImageText` already loops through up to `maxRepairPasses` (capped at 2). Wrap the loop with a `Date.now()` start, capture the final outcome on exit, and call `logTextVerification` exactly ONCE per `enforceExactImageText` invocation (not per repair pass — that would multiply logs N×). The outcome maps to: pass-on-first-try → `pass`; repaired-successfully → `repair_succeeded`; repair-attempted-but-failed → `repair_failed`; pass-after-zero-passes-needed → `pass`.

**OBS-02 (`caption-quality.service.ts`):** `ensureCaptionQuality` has a similar retry loop. Same pattern — log ONCE per invocation with the final outcome.

**OBS-03 (`observability.service.ts`):** export `logSubjectFidelityFailure` but no call site lands in this phase (per Decision 2).

### Decision 5: OBS-04 dead helper removal — verified scope

A grep confirms which helpers are duplicates vs unique:

| Helper in `posts.routes.ts` | Also in `caption-quality.service.ts`? | Unique uses in `posts.routes.ts`? | Action |
|---|---|---|---|
| `looksTruncatedCaption` (line 24) | ✓ exported | None (only used by `isAcceptableCaption` in same file) | REMOVE |
| `hasHashtags` (line 35) | ✓ exported | None | REMOVE |
| `isAcceptableCaption` (line 39) | ✓ exported | Used by `buildCaptionFallback` in same file | REMOVE |
| `buildCaptionFallback` (line 47) | ✓ exported | Probably used by remake-caption endpoint — VERIFY before removing | REMOVE if grep clean inside posts.routes.ts; otherwise import from service |
| `extractPromptField` (line 18) | ✗ NOT in service | Used by remake-caption endpoint at lines 407–409 | **PRESERVE** |

The remake-caption endpoint that uses these helpers should `import { ensureCaptionQuality, ...other-helpers } from "../services/caption-quality.service.js"` and use the canonical exports. `extractPromptField` stays in posts.routes.ts as the only unique helper there.

### Claude's Discretion
- Migration filename timestamp — use the current date/time as YYYYMMDDHHMMSS
- Exact metadata JSONB shape per event_kind (the three TypeScript interfaces above lock the union)
- Whether to add a small `scripts/verify-phase-16.ts` static-grep harness (recommended — matches the pattern from earlier verify-phase scripts)

</decisions>

<canonical_refs>
## Canonical References

### Files to MODIFY
- `server/services/text-rendering.service.ts` — instrument `enforceExactImageText` (OBS-01); ~10 lines added around the retry loop
- `server/services/caption-quality.service.ts` — instrument `ensureCaptionQuality` (OBS-02); ~10 lines added around the retry loop
- `server/routes/posts.routes.ts` — remove 4 dead helpers (lines 24-83 approx) + add import from `caption-quality.service.js` (OBS-04)
- `shared/schema.ts:generationLogSchema` — add 5 new optional fields to the Zod schema

### Files to CREATE
- `server/services/observability.service.ts` — 3 log emitters (OBS-01, OBS-02, OBS-03 scaffold)
- `supabase/migrations/{timestamp}_generation_logs_observability.sql` — schema extension
- `scripts/verify-phase-16.ts` — static verification (file exists, exports present, imports wired, helpers removed) + dynamic mini-test of observability service log shape

### Files NOT to touch
- `supabase/migrations/20260306000000_generation_logs.sql` — original migration; the new migration is additive
- Any production cron infrastructure (Phase 11+12+14 stuff) — sealed
- Any AI service files beyond the two listed (do NOT add OBS-03 call site this phase)

### Existing patterns to borrow
- `server/routes/generate.routes.ts:logGenerationError` — best-effort error-swallowing pattern
- `server/services/cleanup-cron.service.ts` — service-layer file structure / JSDoc header style
- `scripts/verify-phase-11.ts` — static verification harness shape

</canonical_refs>

<specifics>
## Specific Ideas

### Migration filename

Use today's UTC timestamp at planning time: `20260508{HHMMSS}_generation_logs_observability.sql`. Planner can use `date -u +%Y%m%d%H%M%S` to grab the moment.

### Updated Zod schema in `shared/schema.ts`

Find existing `generationLogSchema` and extend:

```typescript
export const generationLogSchema = z.object({
  // ... existing fields ...
  post_id: z.string().uuid().nullable().optional(),
  event_kind: z.enum(["text_verification", "caption_quality", "subject_fidelity"]).nullable().optional(),
  outcome: z.string().nullable().optional(),  // permissive — TypeScript-side typing in observability.service.ts is stricter
  attempt_count: z.number().int().nonnegative().nullable().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});
```

### `observability.service.ts` skeleton

```typescript
/**
 * Generation pipeline observability (Phase 16, v1.3)
 *
 * Three best-effort log emitters writing to the existing generation_logs table:
 *   - logTextVerification — emitted by enforceExactImageText (OBS-01)
 *   - logCaptionQuality   — emitted by ensureCaptionQuality (OBS-02)
 *   - logSubjectFidelityFailure — exported but NOT YET CALLED (OBS-03 scaffolding;
 *     wires up trivially when a future signal source materializes)
 *
 * Contract: all three swallow errors. Logging failures NEVER block, fail, or alter
 * the user-visible generation result. The trade-off: occasional missing rows under
 * DB pressure are acceptable; corrupted gen flows are not.
 */

import { createAdminSupabase } from "../supabase.js";

// ... three exports as sketched in <decisions> Decision 3 ...
```

### `posts.routes.ts` cleanup pattern

Before:
```typescript
function looksTruncatedCaption(text: string): boolean { /* ... */ }
function hasHashtags(text: string): boolean { /* ... */ }
function isAcceptableCaption(text: string): boolean { /* ... */ }
function buildCaptionFallback(params: {/* ... */}): string { /* ... */ }
```

After: delete those 4 functions. Where they're used in the file, import from the canonical service:

```typescript
import { isAcceptableCaption, buildCaptionFallback } from "../services/caption-quality.service.js";
```

(Only import the ones actually used — `npm run check` will fail with unused imports.)

### Verification harness `scripts/verify-phase-16.ts`

Pattern: static checks (file exists, expected exports/imports present, dead-helper grep clean) + a mini-test that constructs a fake row shape via the observability service against a real Supabase but with a deterministic test post_id, then asserts the row exists, then deletes it.

```typescript
// Pseudo-shape:
import { logTextVerification, logCaptionQuality, logSubjectFidelityFailure } from "../server/services/observability.service.js";

async function main() {
  // 1. Static: source files exist with expected exports
  // 2. Static: posts.routes.ts no longer contains the dead helper names
  // 3. Static: shared/schema.ts has new fields
  // 4. Static: migration file exists
  // 5. Dynamic: invoke each log emitter with a fake post_id, verify row written, cleanup
  // 6. Exit 0 only if all pass
}
```

### Plan structure recommendation

1 plan with 4-5 tasks (sequential, single file or set of files per task):

- Task 1: Migration file + Zod schema update — schema layer first
- Task 2: `observability.service.ts` (3 log emitters) — depends on Task 1's Zod
- Task 3: Instrument `text-rendering.service.ts` with `logTextVerification` call (OBS-01)
- Task 4: Instrument `caption-quality.service.ts` with `logCaptionQuality` call (OBS-02)
- Task 5: Remove dead helpers in `posts.routes.ts` + add canonical imports (OBS-04) + write `scripts/verify-phase-16.ts`

OR collapse Tasks 3+4 into a single "instrument both gen-pipeline services" task if they share enough pattern. Planner's call.

</specifics>

<deferred>
## Deferred Ideas

- **OBS-03 real call site** — the `logSubjectFidelityFailure` function lands ready-to-use; the trigger lands when a future detection mechanism (reverse-image-similarity, Gemini self-evaluation, user-feedback signal, etc.) materializes. New seed if this becomes urgent.
- **Admin dashboard** showing aggregated outcome counts (e.g., "this week: 92% pass / 7% repair_triggered / 1% repair_failed") — separate phase if/when ops needs the surface
- **Alert thresholds** (e.g., page someone if `repair_failed` rate exceeds 5% over 24h) — premature; need baseline data first
- **OpenTelemetry / Sentry / Datadog** integration — explicitly out of scope; revisit when log volume justifies the infra cost

</deferred>

---

*Phase: 16-generation-pipeline-observability*
*Context gathered: 2026-05-08*
