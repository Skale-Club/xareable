/**
 * Generation pipeline observability (Phase 16, v1.3)
 *
 * Three best-effort log emitters writing to the existing generation_logs table:
 *   - logTextVerification        — ✅ wired (OBS-01): emitted by enforceExactImageText
 *                                    in server/services/text-rendering.service.ts
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
 *
 * Contract: all three SWALLOW errors. Logging failures NEVER block, fail, or alter
 * the user-visible generation result. Trade-off: occasional missing rows under DB
 * pressure are acceptable; corrupted gen flows are not.
 *
 * Mirrors the pattern from server/routes/generate.routes.ts:logGenerationError.
 */

import { createAdminSupabase } from "../supabase.js";

// ── Public contract (locked by CONTEXT.md Decision 3) ──────────────────────

export interface TextVerificationLogParams {
  postId: string | null;
  outcome: "pass" | "repair_triggered" | "repair_succeeded" | "repair_failed";
  expectedTextHash: string;       // SHA-256 hex of the requested exact text
  detectedText: string | null;
  repairAttemptCount: number;     // 0..2 (matches text-rendering.service.ts maxRepairPasses cap)
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

// ── Implementation ─────────────────────────────────────────────────────────

/** error_type values whose presence indicates a failure outcome. NULL for success. */
function textVerificationErrorType(outcome: TextVerificationLogParams["outcome"]): string | null {
  return outcome === "repair_failed" ? "text_verification" : null;
}

function captionQualityErrorType(outcome: CaptionQualityLogParams["outcome"]): string | null {
  return outcome === "fallback_used" ? "caption_quality" : null;
}

/**
 * OBS-01: log one row per enforceExactImageText invocation.
 * Call ONCE per invocation reflecting the FINAL outcome — never per repair pass.
 */
export async function logTextVerification(params: TextVerificationLogParams): Promise<void> {
  try {
    const supabase = createAdminSupabase();
    await supabase.from("generation_logs").insert({
      status: params.outcome === "repair_failed" ? "failed" : "ok",
      error_message: params.outcome === "repair_failed"
        ? `Exact text verification failed after ${params.repairAttemptCount} repair pass(es)`
        : "",
      error_type: textVerificationErrorType(params.outcome),
      post_id: params.postId,
      event_kind: "text_verification",
      outcome: params.outcome,
      attempt_count: params.repairAttemptCount,
      duration_ms: params.durationMs,
      metadata: {
        expected_text_hash: params.expectedTextHash,
        detected_text: params.detectedText,
      },
    });
  } catch {
    // Best-effort: swallow. NEVER throw — logging must not break generation flow.
  }
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
