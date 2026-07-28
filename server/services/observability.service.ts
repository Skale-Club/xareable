/**
 * Generation pipeline observability (Phase 16, v1.3)
 *
 * Best-effort log emitters writing to the existing generation_logs table:
 *   - (exact-text verify/repair)  — ❌ REMOVED in Phase 23 (TYPO-06). The AI verify/repair
 *                                    loop's log emitter is gone; text is now composited
 *                                    deterministically by typography-compositor.service.ts,
 *                                    so there is no AI-judgment step left to log.
 *   - logCaptionQuality          — ✅ wired (OBS-02): emitted by ensureCaptionQuality
 *                                    in server/services/caption-quality.service.ts
 *   - logSubjectFidelityFailure  — ⏳ scaffolded (OBS-03): exported, not yet called.
 *                                    Needs a future "fidelity detection" signal —
 *                                    e.g. a Gemini self-evaluation step or reverse-image
 *                                    similarity check comparing the generated output
 *                                    against reference images. Wire it when that signal
 *                                    exists in image-generation.service.ts or generate.routes.ts.
 *                                    This is a new-feature prerequisite, not a cleanup task.
 *                                    (SEED-005 graduated 2026-05-18)
 *   - logPlanningSchemaFailure   — ✅ wired (PLAN-02): emitted by GeminiService.generateText
 *                                    in server/services/gemini.service.ts
 *   - logVisualCritic            — ⏳ wired (CRIT-05): emitted by the re-roll loop in
 *                                    server/routes/generate.routes.ts
 *
 * Contract: all SWALLOW errors. Logging failures NEVER block, fail, or alter
 * the user-visible generation result. Trade-off: occasional missing rows under DB
 * pressure are acceptable; corrupted gen flows are not.
 *
 * Mirrors the pattern from server/routes/generate.routes.ts:logGenerationError.
 */

import { createAdminSupabase } from "../supabase.js";

// ── Public contract (locked by CONTEXT.md Decision 3) ──────────────────────

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

// ── Implementation ─────────────────────────────────────────────────────────

/** error_type values whose presence indicates a failure outcome. NULL for success. */
function captionQualityErrorType(outcome: CaptionQualityLogParams["outcome"]): string | null {
  return outcome === "fallback_used" ? "caption_quality" : null;
}

/**
 * OBS-02: log one row per ensureCaptionQuality invocation.
 * Call ONCE per invocation reflecting the FINAL outcome.
 */
export async function logCaptionQuality(params: CaptionQualityLogParams): Promise<void> {
  try {
    const supabase = createAdminSupabase();
    await supabase.from("generation_logs").insert({
      status: params.outcome === "fallback_used" ? "failed" : "ok",
      error_message: params.outcome === "fallback_used"
        ? `Caption quality fell back after ${params.attemptCount} attempt(s)`
        : "",
      error_type: captionQualityErrorType(params.outcome),
      post_id: params.postId,
      event_kind: "caption_quality",
      outcome: params.outcome,
      attempt_count: params.attemptCount,
      duration_ms: params.durationMs,
      metadata: {
        final_caption_length: params.finalCaptionLength,
        final_caption_paragraph_count: params.finalCaptionParagraphCount,
      },
    });
  } catch {
    // Best-effort: swallow.
  }
}

/**
 * OBS-03 SCAFFOLDING (per CONTEXT.md Decision 2): exported but no call site lands this phase.
 * A future detection mechanism (reverse-image-similarity, Gemini self-evaluation, etc.) will
 * import + invoke this. Until then it remains dead-but-typed — verify-phase-16.ts proves shape.
 */
export async function logSubjectFidelityFailure(params: SubjectFidelityLogParams): Promise<void> {
  try {
    const supabase = createAdminSupabase();
    await supabase.from("generation_logs").insert({
      status: "failed",
      error_message: params.failureReason,
      error_type: "subject_fidelity",
      post_id: params.postId,
      event_kind: "subject_fidelity",
      outcome: "failure",
      metadata: {
        reference_image_count: params.referenceImageCount,
        failure_reason: params.failureReason,
      },
    });
  } catch {
    // Best-effort: swallow.
  }
}

export interface PlanningSchemaFailureLogParams {
  postId: string | null;
  model: string;
  attemptCount: number;      // 2 when both planning attempts failed schema validation
  rawResponsePreview: string; // caller truncates; this fn truncates again defensively
  errorMessage: string;
}

/**
 * Phase 22 (PLAN-02): a planning call whose output failed strict-schema validation on
 * BOTH attempts. Mirrors ai-gateway.service.ts's logModelFallback: fire-and-forget,
 * never throws. Unlike model_fallback the generation does NOT continue — the caller
 * throws PlanningSchemaError right after this returns.
 *
 * NOTE (22-RESEARCH.md Pitfall 4): /api/admin/generations does not SELECT event_kind /
 * outcome / metadata, so "surfaced in generation_logs" means the row is queryable via
 * Supabase — same bar model_fallback met in Phase 21. Admin UI for these rows is
 * Phase 26 (POL-09), not this phase.
 */
export async function logPlanningSchemaFailure(params: PlanningSchemaFailureLogParams): Promise<void> {
  try {
    const supabase = createAdminSupabase();
    await supabase.from("generation_logs").insert({
      status: "failed",
      error_message: params.errorMessage,
      error_type: "text_generation",
      post_id: params.postId,
      event_kind: "planning_schema_failure",
      outcome: "schema_validation_failed",
      attempt_count: params.attemptCount,
      metadata: {
        model: params.model,
        raw_response_preview: params.rawResponsePreview.slice(0, 2000),
      },
    });
  } catch {
    // Best-effort: swallow. NEVER throw — logging must not break generation flow.
  }
}

export interface VisualCriticLogParams {
  /**
   * NULL on the hard-fail path: the post row is never inserted there, and
   * generation_logs.post_id is a real FK to posts(id) — passing a not-yet-existent
   * UUID would make the insert fail (silently, since this emitter swallows).
   */
  postId: string | null;
  outcome: "pass" | "soft_fail_accepted_best" | "hard_fail_all_attempts" | "critic_unavailable";
  /** Total generation attempts made, 1-3. */
  attemptCount: number;
  /** False only when the delivered image was never cleared of unwanted rendered text. */
  textFreeCompliant: boolean;
  finalScores: { composition: number; color_harmony: number; text_legibility_zone: number } | null;
  /** Discarded (non-delivered) attempts only. 0 when the first attempt was accepted. */
  rerollAttemptCount: number;
  /** Platform-side cost of the discarded attempts (image-gen + critic), in micros. */
  rerollCostUsdMicros: number;
  /** Wall time of the whole critic/re-roll loop. */
  durationMs: number;
}

/**
 * Phase 24 (CRIT-05): one row per generation that reached the image branch, whether the
 * critic passed, exhausted the re-roll cap, hard-failed on unwanted text, or was
 * unavailable. Mirrors logCaptionQuality exactly: createAdminSupabase, single insert,
 * fire-and-forget, NEVER throws.
 *
 * Compliance rate query this enables:
 *   SELECT outcome, COUNT(*) FROM generation_logs WHERE event_kind = 'visual_critic' GROUP BY outcome;
 */
export async function logVisualCritic(params: VisualCriticLogParams): Promise<void> {
  try {
    const supabase = createAdminSupabase();
    await supabase.from("generation_logs").insert({
      status: params.outcome === "hard_fail_all_attempts" ? "failed" : "ok",
      error_message:
        params.outcome === "hard_fail_all_attempts"
          ? `All ${params.attemptCount} attempt(s) contained unwanted rendered text`
          : "",
      error_type: params.outcome === "hard_fail_all_attempts" ? "image_generation" : null,
      post_id: params.postId,
      event_kind: "visual_critic",
      outcome: params.outcome,
      attempt_count: params.attemptCount,
      duration_ms: params.durationMs,
      metadata: {
        text_free_compliant: params.textFreeCompliant,
        final_scores: params.finalScores,
        reroll_attempt_count: params.rerollAttemptCount,
        reroll_cost_usd_micros: params.rerollCostUsdMicros,
      },
    });
  } catch {
    // Best-effort: swallow. Logging must NEVER break the generation flow.
  }
}
