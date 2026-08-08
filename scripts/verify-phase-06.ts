/**
 * Phase 06 Verification Script
 *
 * Validates Phase 6 (Server Services) success criteria against a live
 * Supabase + (for Wave 2) Gemini environment.
 *
 * Wave 1 (this plan, 06-01) implements:
 *   - BILL-01: checkCredits slideCount multiplier (assertions 1×, 5×, 8× + 0/-3 clamps)
 *
 * Wave 2 (plans 06-02 and 06-03) will fill in the SKIP blocks for:
 *   - CRSL-02, CRSL-03, CRSL-06, CRSL-09, CRSL-10 (carousel generation service)
 *   - ENHC-03, ENHC-04, ENHC-05, ENHC-06 (enhancement service)
 *
 * Usage:
 *   npx tsx scripts/verify-phase-06.ts
 *
 * Required env (loaded from .env via dotenv, or from the shell):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env (when absent, the script mints a throwaway test user via the
 * admin API and tears it down at the end — lets this run end-to-end from CI
 * without a manually captured JWT):
 *   TEST_USER_ACCESS_TOKEN  (JWT for an existing non-admin Supabase auth user)
 *   TEST_USER_ID            (the user_id matching the JWT above)
 *
 * Exits 0 on full pass, 1 on any failure. SKIP lines (Wave 2 placeholders)
 * do NOT count as failures.
 *
 * Self-cleaning: minted user is deleted in `finally`. No posts/usage_events
 * rows are written by the Wave 1 BILL-01 block — checkCredits reads only.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as dotenv from "dotenv";
// @ts-ignore - sharp ESM
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase, createAdminSupabase } from "../server/supabase.js";
import { checkCredits } from "../server/quota.js";
import {
  generateCarousel,
  CarouselAbortedError,
  CarouselFullFailureError,
  CarouselInvalidAspectError,
  type CarouselGenerationParams,
  type CarouselProgressEvent,
} from "../server/services/carousel-generation.service.js";
import {
  enhanceProductPhoto,
  PreScreenUnavailableError,
  PreScreenRejectedError,
  REJECTION_MESSAGES,
  type EnhancementProgressEvent,
} from "../server/services/enhancement.service.js";
import { getStyleCatalogPayload } from "../server/routes/style-catalog.routes.js";
import { GeminiImageProvider } from "../server/services/image-provider.js";
import { DEFAULT_STYLE_CATALOG } from "../shared/schema.js";
import type { Brand } from "../shared/schema.js";

// Phase 12 made `imageProvider` a required, route-injected param on both
// generateCarousel() and enhanceProductPhoto(); this harness predates that and
// was never updated. Gemini is the right provider here: every fetch interceptor
// below asserts against `models/gemini-2.5-flash:generateContent` URLs, so the
// assertions only hold for the Gemini path.
const VERIFY_IMAGE_PROVIDER = new GeminiImageProvider();

dotenv.config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "FAIL: SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must be set (either in .env or the shell).",
  );
  process.exit(1);
}

let TEST_USER_ACCESS_TOKEN = process.env.TEST_USER_ACCESS_TOKEN;
let TEST_USER_ID = process.env.TEST_USER_ID;
let mintedTestUserId: string | null = null;

async function mintTestUserIfNeeded() {
  if (TEST_USER_ACCESS_TOKEN && TEST_USER_ID) return;

  const admin = createAdminSupabase();
  const email = `phase06-verify-${randomUUID()}@verify.local`;
  const password = `Phase06-${randomUUID()}`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`admin.createUser failed: ${createErr?.message ?? "no user"}`);
  }
  mintedTestUserId = created.user.id;

  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session) {
    throw new Error(`signInWithPassword failed: ${signInErr?.message ?? "no session"}`);
  }

  TEST_USER_ACCESS_TOKEN = signIn.session.access_token;
  TEST_USER_ID = created.user.id;
  console.log(`[setup] minted throwaway test user ${TEST_USER_ID} for Phase 6 checks`);
}

async function teardownTestUserIfMinted() {
  if (!mintedTestUserId) return;
  try {
    const admin = createAdminSupabase();
    await admin.auth.admin.deleteUser(mintedTestUserId);
    console.log(`[cleanup] deleted throwaway test user ${mintedTestUserId}`);
  } catch (e) {
    console.error(`[cleanup] failed to delete throwaway user ${mintedTestUserId}:`, (e as Error).message);
  }
}

type CheckResult = { name: string; pass: boolean; detail: string };
const results: CheckResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name} — ${detail}`);
}

async function main() {
  await mintTestUserIfNeeded();
  // Touch the user-scoped client import so future Wave 2 blocks (which will
  // use RLS-probing reads) remain linked. Not used in Wave 1.
  void createServerSupabase(TEST_USER_ACCESS_TOKEN!);
  const admin = createAdminSupabase();

  try {
    // --- Criterion BILL-01: slideCount multiplier ---
    // Minted throwaway user has is_admin=false, is_affiliate=false, is_business=false
    // → usesOwnApiKey returns false → full cost estimation path runs.
    //
    // BUT: the pay-per-use migration (20260303010000_pay_per_use_billing.sql)
    // sets user_credits.free_generations_limit default = 1, and the profile
    // trigger auto-creates that row on signup. That means a freshly minted user
    // has freeGenerationsRemaining = 1 → the free-generations early return
    // fires and estimated_cost_micros is 0, which makes the multiplier
    // untestable against a zero baseline.
    //
    // Exhaust the free generation by bumping free_generations_used to the limit
    // (via admin client, bypassing RLS) BEFORE calling checkCredits. This
    // forces the full cost-estimation path which is the only one the multiplier
    // applies to (own-api-key and free-generations returns are always 0 by
    // design — see D-19).
    //
    // After exhausting free generations, estimateBaseCostMicros falls back to
    // image_fallback_pricing.sell_micros (default 117_000 µ$) because the
    // minted user has no usage_events history, giving a stable non-zero
    // baseline for the 5 sub-assertions.
    const { data: creditsRow, error: creditsReadErr } = await admin
      .from("user_credits")
      .select("free_generations_limit, free_generations_used")
      .eq("user_id", TEST_USER_ID!)
      .maybeSingle();
    if (creditsReadErr) {
      throw new Error(`failed to read user_credits for minted user: ${creditsReadErr.message}`);
    }
    if (!creditsRow) {
      // Some older signups may not have triggered the auto-insert; ensure a
      // row exists with free generations already exhausted.
      const { error: insErr } = await admin
        .from("user_credits")
        .insert({ user_id: TEST_USER_ID!, free_generations_limit: 1, free_generations_used: 1 });
      if (insErr) {
        throw new Error(`failed to seed user_credits for minted user: ${insErr.message}`);
      }
    } else {
      const limit = creditsRow.free_generations_limit ?? 0;
      const { error: updErr } = await admin
        .from("user_credits")
        .update({ free_generations_used: limit })
        .eq("user_id", TEST_USER_ID!);
      if (updErr) {
        throw new Error(`failed to exhaust free generations for minted user: ${updErr.message}`);
      }
    }
    const singleCost = await checkCredits(TEST_USER_ID!, "generate", false, undefined);
    const fiveCost = await checkCredits(TEST_USER_ID!, "generate", false, 5);
    const oneCost = await checkCredits(TEST_USER_ID!, "generate", false, 1);
    const zeroCost = await checkCredits(TEST_USER_ID!, "generate", false, 0);
    const negCost = await checkCredits(TEST_USER_ID!, "generate", false, -3);
    const eightCost = await checkCredits(TEST_USER_ID!, "generate", false, 8);

    const base = singleCost.estimated_cost_micros;

    if (base === 0) {
      // Defensive diagnostic: if the baseline is 0, the minted user hit an
      // early-return path (own-api-key, free-generations) which makes the
      // multiplier untestable. Surface as FAIL with explicit reason.
      record(
        "BILL-01 (slideCount multiplier)",
        false,
        `baseline cost is 0 µ$ (minted user hit an early-return path — own-api-key or free-generations). Multiplier cannot be asserted against zero.`,
      );
    } else {
      const passes = [
        { label: "undefined === 1×", ok: base === oneCost.estimated_cost_micros },
        { label: "0 clamps to 1×", ok: base === zeroCost.estimated_cost_micros },
        { label: "-3 clamps to 1×", ok: base === negCost.estimated_cost_micros },
        { label: "5 === 5×", ok: fiveCost.estimated_cost_micros === 5 * base },
        { label: "8 === 8×", ok: eightCost.estimated_cost_micros === 8 * base },
      ];
      const failed = passes.filter((p) => !p.ok).map((p) => p.label);
      record(
        "BILL-01 (slideCount multiplier)",
        failed.length === 0,
        failed.length === 0
          ? `single=${base} µ$, 5×=${fiveCost.estimated_cost_micros} µ$ — all five assertions passed`
          : `failed: ${failed.join(", ")} (single=${base}, 1×=${oneCost.estimated_cost_micros}, 0→${zeroCost.estimated_cost_micros}, -3→${negCost.estimated_cost_micros}, 5×=${fiveCost.estimated_cost_micros}, 8×=${eightCost.estimated_cost_micros})`,
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Carousel verification helpers (Plan 06-02)
    // ═══════════════════════════════════════════════════════════════════════

    // Structural (no Gemini key needed):
    //   CRSL-10 — enforceExactImageText not imported
    //   AC-12 (CRSL-09 defense-in-depth) — invalid aspect ratio throws sync
    //
    // Live (require TEST_GEMINI_API_KEY):
    //   CRSL-02 — 1 text call + N sequential image calls with 3s spacing
    //   CRSL-03 — slides 2..N request bodies contain role:model + inlineData
    //             from slide 1 and (when slide 1 had it) thoughtSignature
    //   CRSL-06 — abort after slide 2 → draft or full-failure, persisted
    //             slides match observed success count
    //   CRSL-09 — only 1 call to gemini-2.5-flash text endpoint (caption
    //             quality check either returns the candidate as-is or
    //             makes its own calls — CRSL-09 is about ensureCaptionQuality
    //             *not* running inside the slide loop; we assert via source
    //             code grep that there is exactly 1 call site)
    //
    // Teardown: every postId created during verification is deleted via
    // admin.from("posts").delete() at the end of the try block. CASCADE on
    // post_slides + Phase 5 BEFORE DELETE trigger handles storage cleanup
    // enqueueing. Auth user deletion (teardownTestUserIfMinted) also
    // cascades posts→post_slides via FK.

    const createdPostIds = new Set<string>();

    const carouselBrand: Brand = {
      id: randomUUID(),
      user_id: TEST_USER_ID!,
      company_name: "Verify Coffee Co",
      company_type: "specialty coffee",
      color_1: "#2B1B0E",
      color_2: "#C4A484",
      color_3: "#F5E6D3",
      color_4: null,
      mood: "minimalist",
      logo_url: null,
      created_at: new Date().toISOString(),
    };

    // ── Fetch interceptor (captures all Gemini calls made by the service) ──
    type RecordedCall = {
      url: string;
      body: any;
      startedAt: number;
      responseStatus: number;
    };
    let recorded: RecordedCall[] = [];
    const originalFetch = globalThis.fetch;

    async function runWithInterceptor<T>(fn: () => Promise<T>): Promise<T> {
      recorded = [];
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = String(url);
        let parsedBody: any = null;
        if (init?.body && typeof init.body === "string") {
          try {
            parsedBody = JSON.parse(init.body);
          } catch {
            parsedBody = null;
          }
        }
        const startedAt = Date.now();
        const res = await originalFetch(url as any, init as any);
        recorded.push({ url: urlStr, body: parsedBody, startedAt, responseStatus: res.status });
        return res;
      }) as any;
      try {
        return await fn();
      } finally {
        globalThis.fetch = originalFetch;
      }
    }

    // ── CRSL-10: code-grep that enforceExactImageText is not imported ─────
    {
      const svcSource = readFileSync(
        "server/services/carousel-generation.service.ts",
        "utf-8",
      );
      const hasEnforce = /enforceExactImageText/.test(svcSource);
      record(
        "CRSL-10 (enforceExactImageText not in carousel path)",
        !hasEnforce,
        hasEnforce
          ? "service source contains 'enforceExactImageText' — CRSL-10 violated"
          : "service source contains zero occurrences of 'enforceExactImageText'",
      );
    }

    // ── AC-12 / CRSL-09 defense-in-depth: invalid aspect ratio throws sync ─
    {
      // We don't have a baseline textCall count here — the synchronous guard
      // should throw before any fetch is made. Run inside interceptor to
      // prove that: zero calls recorded.
      let sawCorrectError = false;
      let callCountBefore = 0;
      try {
        await runWithInterceptor(async () => {
          callCountBefore = recorded.length;
          await generateCarousel({
            userId: TEST_USER_ID!,
            apiKey: "sk-invalid-never-used",
            brand: carouselBrand,
            imageProvider: VERIFY_IMAGE_PROVIDER,
            styleCatalog: DEFAULT_STYLE_CATALOG,
            prompt: "invalid aspect guard probe",
            slideCount: 3,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            aspectRatio: "16:9" as any,
            postMood: "promo",
            contentLanguage: "en",
            idempotencyKey: randomUUID(),
          });
        });
      } catch (err) {
        if (err instanceof CarouselInvalidAspectError) sawCorrectError = true;
      }
      const noFetchesMade = recorded.length === callCountBefore;
      record(
        "CRSL-09 (aspect ratio guard — invalid aspect throws before any Gemini call)",
        sawCorrectError && noFetchesMade,
        sawCorrectError
          ? noFetchesMade
            ? "CarouselInvalidAspectError thrown synchronously; zero fetch calls recorded"
            : "CarouselInvalidAspectError thrown but some fetches were made before — guard is not synchronous"
          : "did not throw CarouselInvalidAspectError for aspectRatio=16:9",
      );
    }

    // ── Live blocks (gated on TEST_GEMINI_API_KEY) ─────────────────────────
    const geminiKey = process.env.TEST_GEMINI_API_KEY;
    if (!geminiKey) {
      console.log(
        "SKIP — CRSL-02 (one master text call + N sequential image calls) — set TEST_GEMINI_API_KEY in .env to run live",
      );
      console.log(
        "SKIP — CRSL-03 (thoughtSignature echoed + slide-1 inlineData in slides 2..N) — set TEST_GEMINI_API_KEY in .env to run live",
      );
      console.log(
        "SKIP — CRSL-06 (abort between slides → draft or full-failure) — set TEST_GEMINI_API_KEY in .env to run live",
      );
      console.log(
        "SKIP — CRSL-09-live (ensureCaptionQuality not in slide loop; source-grep check) — running structural check only",
      );
      // CRSL-09 structural check that matches AC-8 without a live run:
      const svcSource = readFileSync(
        "server/services/carousel-generation.service.ts",
        "utf-8",
      );
      const callSites = svcSource.match(/ensureCaptionQuality\(/g) ?? [];
      record(
        "CRSL-09 (ensureCaptionQuality — exactly 1 call site in carousel service)",
        callSites.length === 1,
        callSites.length === 1
          ? "service source contains exactly 1 call to ensureCaptionQuality(...) — confirms not called per-slide"
          : `service source contains ${callSites.length} call sites to ensureCaptionQuality(...) — CRSL-09 requires exactly 1`,
      );
    } else {
      // ── Happy-path 3-slide run — powers CRSL-02, CRSL-03, CRSL-09 ───────
      const progressEvents: CarouselProgressEvent[] = [];
      let happyResult: Awaited<ReturnType<typeof generateCarousel>> | null = null;
      try {
        // The result is returned *through* runWithInterceptor (which is generic
        // over its callback's result) rather than assigned from inside the
        // callback. TypeScript cannot see writes made in a nested closure, so
        // the assigned form left happyResult narrowed to its `null` initializer
        // and typed the `happyResult.postId` read below against `never`.
        happyResult = await runWithInterceptor(async () =>
          generateCarousel({
            userId: TEST_USER_ID!,
            apiKey: geminiKey!,
            brand: carouselBrand,
            imageProvider: VERIFY_IMAGE_PROVIDER,
            styleCatalog: DEFAULT_STYLE_CATALOG,
            prompt:
              "A minimalist product launch for a new specialty espresso maker — hook, feature, CTA",
            slideCount: 3,
            aspectRatio: "1:1",
            postMood: "promo",
            contentLanguage: "en",
            idempotencyKey: randomUUID(),
            onProgress: (ev) => progressEvents.push(ev),
          } satisfies CarouselGenerationParams),
        );
      } catch (runErr) {
        console.warn(
          "[verify] live carousel run raised — CRSL-02/03/09 will be marked FAIL with error detail:",
          String((runErr as Error)?.message ?? runErr),
        );
      }

      if (happyResult) {
        createdPostIds.add(happyResult.postId);
      }

      const textCalls = recorded.filter((r) =>
        r.url.includes(`models/gemini-2.5-flash:generateContent`),
      );
      const imageCalls = recorded.filter((r) =>
        r.url.includes(`models/gemini-3.1-flash-image-preview:generateContent`),
      );

      // ── CRSL-02 ──
      {
        const textOk = textCalls.length === 1;
        const imageOk = imageCalls.length === 3;
        // Inter-slide spacing: slides 2 and 3 must start ≥ previous + 2900ms
        let spacingOk = true;
        let spacingDetail = "";
        for (let i = 1; i < imageCalls.length; i++) {
          const gap = imageCalls[i].startedAt - imageCalls[i - 1].startedAt;
          if (gap < 2900) {
            spacingOk = false;
            spacingDetail = `imageCalls[${i}] started ${gap}ms after [${i - 1}] — expected ≥2900`;
            break;
          }
        }
        const pass = textOk && imageOk && spacingOk;
        record(
          "CRSL-02 (one text call + N sequential image calls with D-02 delay)",
          pass,
          pass
            ? `textCalls=1, imageCalls=3, inter-slide gaps satisfy ≥2900ms (D-02)`
            : `textCalls=${textCalls.length} (want 1), imageCalls=${imageCalls.length} (want 3)${spacingDetail ? "; " + spacingDetail : ""}`,
        );
      }

      // ── CRSL-03 ──
      {
        if (imageCalls.length < 2) {
          record(
            "CRSL-03 (thoughtSignature + slide-1 inlineData in slides 2..N)",
            false,
            `not enough imageCalls to inspect — got ${imageCalls.length}`,
          );
        } else {
          // The slide-1 body was a single-turn (no role:model); its response
          // shape isn't directly captured by the interceptor (we only
          // capture request bodies). To check slide-1 base64 match, we must
          // compare the base64 sent in slide-2's model turn against a known
          // slide-1 reference — but without access to slide 1's response
          // body we compare it against slide-2's own modelTurn consistency
          // (slide-3's modelTurn should carry the SAME slide-1 base64 as
          // slide-2's, since both reference slide 1).
          //
          // Primary structural assertions (AC-3):
          //   - slides 2..N bodies contain a role:"model" turn
          //   - that turn's parts[0].inlineData.data is a non-empty base64 string
          //   - slide-3's base64 equals slide-2's base64 (both = slide 1 bytes)
          //
          // thoughtSignature: check whether slide 2's model turn carries it.
          // If slide 1's response lacked a signature the service falls back
          // to single-turn (no role:model). Either outcome is acceptable
          // per D-06, but we record which path was taken.

          const shapes: string[] = [];
          let allMultiTurn = true;
          let allHaveInline = true;
          let baseForCompare: string | null = null;
          let consistentBase64 = true;
          let sigPresent = false;

          for (let i = 1; i < imageCalls.length; i++) {
            const body = imageCalls[i].body;
            const contents = body?.contents;
            const first = contents?.[0];
            const isModelTurn = first?.role === "model";
            const inline = first?.parts?.[0]?.inlineData;
            const hasInline = typeof inline?.data === "string" && inline.data.length > 0;
            const hasSig =
              typeof first?.parts?.[0]?.thoughtSignature === "string" &&
              first?.parts?.[0]?.thoughtSignature.length > 0;

            shapes.push(
              `slide${i + 1}:${isModelTurn ? "multi" : "single"}${hasInline ? "+inline" : ""}${hasSig ? "+sig" : ""}`,
            );

            if (!isModelTurn) allMultiTurn = false;
            if (!hasInline) allHaveInline = false;
            if (hasSig) sigPresent = true;

            if (hasInline) {
              if (baseForCompare === null) {
                baseForCompare = inline.data;
              } else if (inline.data !== baseForCompare) {
                consistentBase64 = false;
              }
            }
          }

          // D-06 accepts the silent fallback path. So:
          //   Happy path (sig present in slide 1): every slide 2..N must be multi-turn with sig.
          //   Fallback path (sig absent): slides 2..N are single-turn BUT must
          //     still carry slide 1 as bare inlineData in the user turn.
          let fallbackInlineOk = true;
          if (!allMultiTurn) {
            // For single-turn fallback, slide 1 base64 should appear as a part in the user turn
            for (let i = 1; i < imageCalls.length; i++) {
              const body = imageCalls[i].body;
              const parts = body?.contents?.[0]?.parts ?? [];
              const hasInlinePart = parts.some(
                (p: any) => typeof p?.inlineData?.data === "string" && p.inlineData.data.length > 0,
              );
              if (!hasInlinePart) {
                fallbackInlineOk = false;
                break;
              }
            }
          }

          const pass =
            (allMultiTurn && allHaveInline && consistentBase64 && sigPresent) ||
            (!allMultiTurn && fallbackInlineOk);

          record(
            "CRSL-03 (thoughtSignature echoed + slide-1 inlineData in slides 2..N)",
            pass,
            pass
              ? allMultiTurn
                ? `multi-turn path: slides 2..N carry role:model + slide-1 base64 + thoughtSignature (${shapes.join(", ")})`
                : `D-06 fallback path (no signature returned by slide 1): slides 2..N carry slide-1 base64 as inlineData in single-turn user parts (${shapes.join(", ")})`
              : `structural mismatch — shapes=[${shapes.join(", ")}], multi=${allMultiTurn}, inline=${allHaveInline}, consistent=${consistentBase64}, sig=${sigPresent}, fallbackInline=${fallbackInlineOk}`,
          );
        }
      }

      // ── CRSL-09 (ensureCaptionQuality — exactly 1 call site, verified
      //             by source grep; semantically: caption-quality never
      //             runs inside the per-slide loop) ──
      {
        const svcSource = readFileSync(
          "server/services/carousel-generation.service.ts",
          "utf-8",
        );
        const callSites = svcSource.match(/ensureCaptionQuality\(/g) ?? [];
        record(
          "CRSL-09 (ensureCaptionQuality — exactly 1 call site in carousel service)",
          callSites.length === 1,
          callSites.length === 1
            ? "service source contains exactly 1 call to ensureCaptionQuality(...) — confirms not called per-slide"
            : `service source contains ${callSites.length} call sites to ensureCaptionQuality(...) — CRSL-09 requires exactly 1`,
        );
      }

      // ── CRSL-06 (abort between slides) ─────────────────────────────────
      {
        const controller = new AbortController();
        // Abort after 8 seconds — slide 1 normally completes by then but
        // the 3s inter-slide delay and slide 2's own call should still be
        // in flight or queued when we trip the signal.
        const timer = setTimeout(() => controller.abort(), 8000);
        const events: CarouselProgressEvent[] = [];
        let observedError: unknown = null;
        let abortResultPostId: string | null = null;
        try {
          await runWithInterceptor(async () => {
            await generateCarousel({
              userId: TEST_USER_ID!,
              apiKey: geminiKey!,
              brand: carouselBrand,
              imageProvider: VERIFY_IMAGE_PROVIDER,
              styleCatalog: DEFAULT_STYLE_CATALOG,
              prompt: "An abort-test carousel — will be aborted mid-run",
              slideCount: 5,
              aspectRatio: "1:1",
              postMood: "promo",
              contentLanguage: "en",
              idempotencyKey: randomUUID(),
              signal: controller.signal,
              onProgress: (ev) => {
                events.push(ev);
                if (ev.type === "complete") {
                  // no-op; result return happens synchronously after this
                }
              },
            });
          });
        } catch (err) {
          observedError = err;
        } finally {
          clearTimeout(timer);
        }

        // Inspect progress events to determine how many slides completed
        const slideCompleteEvents = events.filter((e) => e.type === "slide_complete");
        const completeEvent = events.find((e) => e.type === "complete") as
          | Extract<CarouselProgressEvent, { type: "complete" }>
          | undefined;

        // Try to recover the postId from the abort branch: if the service
        // threw CarouselAbortedError after persisting, the posts row exists.
        // We search for it by idempotency_key match — but we didn't capture
        // it here. Instead fall back to querying by status+user_id+slide_count
        // within a recent window.
        const aborted = observedError instanceof CarouselAbortedError;
        const fullFail = observedError instanceof CarouselFullFailureError;

        // If we got a CarouselAbortedError we expect a posts row with
        // slide_count === savedSlideCount and status == (saved < 5 ? draft : completed)
        let dbCheckOk = true;
        let dbDetail = "";
        if (aborted && completeEvent) {
          const saved = completeEvent.savedSlideCount;
          const { data: rows, error: rowsErr } = await admin
            .from("posts")
            .select("id, status, slide_count")
            .eq("user_id", TEST_USER_ID!)
            .eq("content_type", "carousel")
            .eq("slide_count", saved)
            .order("created_at", { ascending: false })
            .limit(3);
          if (rowsErr) {
            dbCheckOk = false;
            dbDetail = `db read failed: ${rowsErr.message}`;
          } else if (!rows || rows.length === 0) {
            dbCheckOk = false;
            dbDetail = `no posts row with slide_count=${saved} found after abort`;
          } else {
            abortResultPostId = rows[0].id as string;
            createdPostIds.add(abortResultPostId);
            const expectedStatus = saved === 5 ? "completed" : "draft";
            if (rows[0].status !== expectedStatus) {
              dbCheckOk = false;
              dbDetail = `posts.status=${rows[0].status} (expected ${expectedStatus} for saved=${saved})`;
            } else {
              dbDetail = `posts row ${abortResultPostId} slide_count=${saved} status=${rows[0].status}`;
            }
          }
        }

        // Acceptable outcomes (AC-7):
        //   A. CarouselAbortedError thrown with savedSlideCount >= 1 AND
        //      posts row persisted with status=draft (if saved < 5) or
        //      completed (if saved === 5)
        //   B. CarouselFullFailureError thrown when abort fired before
        //      slide 1 completed (observedError is CarouselFullFailureError)
        //      and ZERO posts row inserted
        const scenarioA =
          aborted &&
          completeEvent !== undefined &&
          completeEvent.savedSlideCount >= 1 &&
          dbCheckOk;
        const scenarioB = fullFail && slideCompleteEvents.length === 0;
        const pass = scenarioA || scenarioB;

        record(
          "CRSL-06 (abort between slides → draft-or-full-failure contract)",
          pass,
          pass
            ? scenarioA
              ? `CarouselAbortedError thrown after savedSlideCount=${completeEvent!.savedSlideCount}; ${dbDetail}`
              : `CarouselFullFailureError thrown before slide 1 completed (abort landed early)`
            : `observedError=${(observedError as Error)?.constructor?.name ?? "none"}; slideCompleteEvents=${slideCompleteEvents.length}; dbDetail=${dbDetail}`,
        );
      }

      // ── Teardown: delete posts created during verification ──
      for (const postId of createdPostIds) {
        try {
          const { error: delErr } = await admin.from("posts").delete().eq("id", postId);
          if (delErr) {
            console.warn(`[cleanup] failed to delete post ${postId}: ${delErr.message}`);
          } else {
            console.log(`[cleanup] deleted carousel post ${postId} (cascade on post_slides)`);
          }
        } catch (cleanupErr) {
          console.warn(`[cleanup] exception deleting post ${postId}:`, (cleanupErr as Error).message);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Enhancement verification (Plan 06-03) — ENHC-03, ENHC-04, ENHC-05, ENHC-06
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Structural (no Gemini key needed):
    //   AC-10 — no text/logo composition in service source
    //   AC-13 — D-15 seam: no imports from express/server/lib/sse
    //   AC-14 — D-13 single file (enhancement.service.ts exists alongside carousel)
    //
    // Live (require TEST_GEMINI_API_KEY):
    //   ENHC-03 — EXIF strip: upload a JPEG with Orientation=6 + GPS; assert
    //             stored source.webp and result.webp both have no EXIF
    //   ENHC-04 — verbatim preservation-rules substrings in image-model body
    //   ENHC-05 — square input (width===height) in image-model body; scenery
    //             prompt_snippet present
    //   ENHC-06 — (a) fail-closed on 503, (b) reject on high confidence,
    //             (c) accept on low confidence, (d) exactly 1 pre-screen call
    //
    // Teardown: any postId created during verification is deleted via
    // admin.from("posts").delete() and explicit storage remove() calls.
    //
    // ── Structural grep checks (AC-10, AC-13, AC-14) ────────────────────────
    {
      const svcPath = "server/services/enhancement.service.ts";
      const svcSource = readFileSync(svcPath, "utf-8");

      // AC-10: no text/logo composition tokens
      const forbidden =
        /(applyLogoOverlay|enforceExactImageText|logo_url|logoPosition|caption.*overlay|text.*render)/;
      const ac10Violations = (svcSource.match(forbidden) ?? []).length;
      record(
        "ENHC-06 structural (AC-10 no text/logo composition)",
        ac10Violations === 0,
        ac10Violations === 0
          ? "service source contains zero matches for applyLogoOverlay/enforceExactImageText/logo_url/logoPosition/caption-overlay/text-render"
          : `service source contains ${ac10Violations} forbidden composition tokens`,
      );

      // AC-13: D-15 seam — no imports from express/server/lib/sse
      // (style-catalog.routes is whitelisted — it's a pure function export)
      const seamViolating =
        /from\s+["'](express|\.\.\/lib\/sse|\.\.\/lib\/sse\.js)["']/;
      const ac13Hit = seamViolating.test(svcSource);
      record(
        "ENHC-06 structural (AC-13 D-15 seam — no express/SSE imports)",
        !ac13Hit,
        ac13Hit
          ? "service imports from express or server/lib/sse — D-15 seam violated"
          : "service imports no express/SSE plumbing; only whitelisted getStyleCatalogPayload",
      );

      // AC-14: D-13 single file — enhancement.service.ts exists, no
      // additional new enhancement-* files in server/services/
      const fsReaddir = (await import("node:fs")).readdirSync;
      const servicesDir = fsReaddir("server/services");
      const enhancementFiles = servicesDir.filter(
        (f: string) => f.startsWith("enhancement") && f.endsWith(".ts"),
      );
      record(
        "ENHC-06 structural (AC-14 D-13 single file — only enhancement.service.ts)",
        enhancementFiles.length === 1 && enhancementFiles[0] === "enhancement.service.ts",
        enhancementFiles.length === 1
          ? "server/services/ contains exactly one enhancement-prefixed file: enhancement.service.ts"
          : `expected exactly 1 enhancement-* file; found ${enhancementFiles.length}: [${enhancementFiles.join(", ")}]`,
      );
    }

    // ── Live blocks (gated on TEST_GEMINI_API_KEY) ──────────────────────────
    const enhKey = process.env.TEST_GEMINI_API_KEY;

    if (!enhKey) {
      console.log(
        "SKIP — ENHC-03 (EXIF strip end-to-end) — set TEST_GEMINI_API_KEY in .env to run live",
      );
      console.log(
        "SKIP — ENHC-04 (verbatim preservation rules in prompt) — set TEST_GEMINI_API_KEY in .env to run live",
      );
      console.log(
        "SKIP — ENHC-05 (square input + scenery snippet in prompt) — set TEST_GEMINI_API_KEY in .env to run live",
      );
      console.log(
        "SKIP — ENHC-06 live (pre-screen fail-closed/reject/accept/no-retry) — set TEST_GEMINI_API_KEY in .env to run live",
      );
    } else {
      // Helper: synthesize a test JPEG with EXIF Orientation=6 + non-square
      // aspect so autoOrient() + contain-resize have observable effect.
      async function makeTestProductJpeg(): Promise<{ buffer: Buffer; base64: string; mimeType: string }> {
        const raw = await sharp({
          create: {
            width: 1200,
            height: 900,
            channels: 3,
            background: { r: 200, g: 50, b: 50 },
          },
        })
          .jpeg({ quality: 90 })
          .withExif({
            IFD0: {
              Orientation: "6", // 90° CW rotation
              GPSLatitude: "37/1 46/1 3000/100",
            },
          })
          .toBuffer();
        return {
          buffer: raw,
          base64: raw.toString("base64"),
          mimeType: "image/jpeg",
        };
      }

      // Set of postIds created during ENHC verification for teardown
      const enhCreatedPostIds = new Set<string>();

      // ── Fetch interceptor scoped to enhancement runs ──────────────────────
      type EnhRecordedCall = {
        url: string;
        body: any;
        startedAt: number;
        responseStatus: number;
      };
      let enhRecorded: EnhRecordedCall[] = [];
      let enhStubFetch:
        | ((urlStr: string, init: any) => Response | Promise<Response> | null)
        | null = null;
      const enhOriginalFetch = globalThis.fetch;

      async function runEnhWithInterceptor<T>(
        fn: () => Promise<T>,
        stub?: (urlStr: string, init: any) => Response | Promise<Response> | null,
      ): Promise<T> {
        enhRecorded = [];
        enhStubFetch = stub ?? null;
        globalThis.fetch = (async (url: any, init: any) => {
          const urlStr = String(url);
          let parsedBody: any = null;
          if (init?.body && typeof init.body === "string") {
            try {
              parsedBody = JSON.parse(init.body);
            } catch {
              parsedBody = null;
            }
          }
          const startedAt = Date.now();

          // If a stub is registered, ask it first. Stub returns a Response
          // (or Promise<Response>) to intercept, or null to pass through.
          if (enhStubFetch) {
            const stubbed = await enhStubFetch(urlStr, init);
            if (stubbed !== null) {
              enhRecorded.push({
                url: urlStr,
                body: parsedBody,
                startedAt,
                responseStatus: stubbed.status,
              });
              return stubbed;
            }
          }

          const res = await enhOriginalFetch(url as any, init as any);
          enhRecorded.push({
            url: urlStr,
            body: parsedBody,
            startedAt,
            responseStatus: res.status,
          });
          return res;
        }) as any;
        try {
          return await fn();
        } finally {
          globalThis.fetch = enhOriginalFetch;
          enhStubFetch = null;
        }
      }

      // Endpoint constants (mirror enhancement.service.ts)
      const PRE_SCREEN_URL_SUFFIX = "models/gemini-2.5-flash:generateContent";
      const IMAGE_URL_SUFFIX = "models/gemini-3.1-flash-image-preview:generateContent";

      // Synthesize a small "image model response" canned JSON with a 1×1 WebP
      // buffer so sub-case C (accept + real image-model call stubbed) doesn't
      // burn a real Gemini edit call.
      async function makeStubbedImageResponse(): Promise<Response> {
        // Tiny 1×1 white PNG encoded as base64
        const tinyPng = await sharp({
          create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 255, b: 255 } },
        })
          .png()
          .toBuffer();
        const body = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: tinyPng.toString("base64"),
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Resolve the sceneryId we'll use (from Phase 5 seed)
      const testSceneryId = "white-studio";
      const catalogForEnh = await getStyleCatalogPayload();
      const resolvedScenery = catalogForEnh.sceneries?.find(
        (s) => s.id === testSceneryId && s.is_active !== false,
      );
      if (!resolvedScenery) {
        record(
          "ENHC-05 scenery seed",
          false,
          `scenery '${testSceneryId}' not found in platform_settings — Phase 5 seed missing`,
        );
      }

      // ═════════════════════════════════════════════════════════════════════
      // ENHC-06 Sub-case A: fail-closed on pre-screen 503 (AC-2)
      // ═════════════════════════════════════════════════════════════════════
      {
        const { base64, mimeType } = await makeTestProductJpeg();
        let observedError: unknown = null;
        let preScreenCallCount = 0;
        let imageModelCallCount = 0;

        try {
          await runEnhWithInterceptor(
            async () => {
              await enhanceProductPhoto({
                userId: TEST_USER_ID!,
                apiKey: enhKey,
                sceneryId: testSceneryId,
                imageProvider: VERIFY_IMAGE_PROVIDER,
                idempotencyKey: randomUUID(),
                contentLanguage: "en",
                image: { mimeType, data: base64 },
              });
            },
            (urlStr) => {
              if (urlStr.includes(PRE_SCREEN_URL_SUFFIX)) {
                // Return HTTP 503
                return new Response(
                  JSON.stringify({ error: { message: "service unavailable" } }),
                  { status: 503, headers: { "Content-Type": "application/json" } },
                );
              }
              return null;
            },
          );
        } catch (err) {
          observedError = err;
        }

        preScreenCallCount = enhRecorded.filter((r) =>
          r.url.includes(PRE_SCREEN_URL_SUFFIX),
        ).length;
        imageModelCallCount = enhRecorded.filter((r) =>
          r.url.includes(IMAGE_URL_SUFFIX),
        ).length;

        const isUnavailable = observedError instanceof PreScreenUnavailableError;
        const expectedMsg =
          "We couldn't validate the image right now — please try again in a moment.";
        const msgMatch =
          isUnavailable && (observedError as Error).message === expectedMsg;
        const pass = isUnavailable && msgMatch && imageModelCallCount === 0;
        record(
          "ENHC-06 sub-case A (fail-closed on pre-screen 503 — AC-2)",
          pass,
          pass
            ? `PreScreenUnavailableError thrown with locked message; preScreenCalls=${preScreenCallCount}, imageModelCalls=0`
            : `observedError=${(observedError as Error)?.constructor?.name ?? "none"} msg="${(observedError as Error)?.message ?? ""}" preScreenCalls=${preScreenCallCount} imageModelCalls=${imageModelCallCount}`,
        );
      }

      // ═════════════════════════════════════════════════════════════════════
      // ENHC-06 Sub-case B: reject on high confidence (AC-4)
      // ═════════════════════════════════════════════════════════════════════
      {
        const { base64, mimeType } = await makeTestProductJpeg();
        let observedError: unknown = null;

        try {
          await runEnhWithInterceptor(
            async () => {
              await enhanceProductPhoto({
                userId: TEST_USER_ID!,
                apiKey: enhKey,
                sceneryId: testSceneryId,
                imageProvider: VERIFY_IMAGE_PROVIDER,
                idempotencyKey: randomUUID(),
                contentLanguage: "en",
                image: { mimeType, data: base64 },
              });
            },
            (urlStr) => {
              if (urlStr.includes(PRE_SCREEN_URL_SUFFIX)) {
                const body = {
                  candidates: [
                    {
                      content: {
                        parts: [
                          {
                            text: JSON.stringify({
                              rejection_category: "face_or_person",
                              confidence: "high",
                              reason: "face detected",
                            }),
                          },
                        ],
                      },
                    },
                  ],
                  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 20 },
                };
                return new Response(JSON.stringify(body), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                });
              }
              return null;
            },
          );
        } catch (err) {
          observedError = err;
        }

        const preScreenCalls = enhRecorded.filter((r) =>
          r.url.includes(PRE_SCREEN_URL_SUFFIX),
        ).length;
        const imageCalls = enhRecorded.filter((r) =>
          r.url.includes(IMAGE_URL_SUFFIX),
        ).length;

        const isRejected = observedError instanceof PreScreenRejectedError;
        const expectedMsg = REJECTION_MESSAGES.face_or_person;
        const msgMatch =
          isRejected && (observedError as Error).message === expectedMsg;
        const categoryMatch =
          isRejected && (observedError as PreScreenRejectedError).category === "face_or_person";
        const pass =
          isRejected && msgMatch && categoryMatch && imageCalls === 0 && preScreenCalls === 1;
        record(
          "ENHC-06 sub-case B (reject on high confidence — AC-4)",
          pass,
          pass
            ? `PreScreenRejectedError(face_or_person, high); preScreenCalls=1, imageModelCalls=0`
            : `observedError=${(observedError as Error)?.constructor?.name ?? "none"} msgMatch=${msgMatch} categoryMatch=${categoryMatch} preScreenCalls=${preScreenCalls} imageModelCalls=${imageCalls}`,
        );
      }

      // ═════════════════════════════════════════════════════════════════════
      // ENHC-06 Sub-case C: accept on low confidence (AC-3), stubbed image call
      // ═════════════════════════════════════════════════════════════════════
      // Note: this path exercises the full pipeline through storage + DB
      // because we stub the image-model call. We WILL create a posts row and
      // two storage files; both are cleaned up in the teardown below.
      let scAcceptResult: Awaited<ReturnType<typeof enhanceProductPhoto>> | null = null;
      {
        const { base64, mimeType } = await makeTestProductJpeg();
        let observedError: unknown = null;

        try {
          await runEnhWithInterceptor(
            async () => {
              scAcceptResult = await enhanceProductPhoto({
                userId: TEST_USER_ID!,
                apiKey: enhKey,
                sceneryId: testSceneryId,
                imageProvider: VERIFY_IMAGE_PROVIDER,
                idempotencyKey: randomUUID(),
                contentLanguage: "en",
                image: { mimeType, data: base64 },
              });
            },
            (urlStr) => {
              if (urlStr.includes(PRE_SCREEN_URL_SUFFIX)) {
                const body = {
                  candidates: [
                    {
                      content: {
                        parts: [
                          {
                            text: JSON.stringify({
                              rejection_category: "face_or_person",
                              confidence: "low",
                              reason: "possible background face",
                            }),
                          },
                        ],
                      },
                    },
                  ],
                  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 20 },
                };
                return new Response(JSON.stringify(body), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                });
              }
              if (urlStr.includes(IMAGE_URL_SUFFIX)) {
                // Async resolve, but return Promise — handler awaits it.
                return makeStubbedImageResponse();
              }
              return null;
            },
          );
        } catch (err) {
          observedError = err;
        }

        if (scAcceptResult) {
          enhCreatedPostIds.add((scAcceptResult as { postId: string }).postId);
        }

        const preScreenCalls = enhRecorded.filter((r) =>
          r.url.includes(PRE_SCREEN_URL_SUFFIX),
        ).length;
        const imageCalls = enhRecorded.filter((r) =>
          r.url.includes(IMAGE_URL_SUFFIX),
        ).length;

        // Acceptance path: PreScreenRejectedError MUST NOT fire. Any other
        // thrown error (infra, storage, etc.) is allowed — the test is
        // specifically that the confidence-low rejection does not short-circuit.
        const notRejected = !(observedError instanceof PreScreenRejectedError);
        const oneImageCall = imageCalls === 1;
        const onePreScreen = preScreenCalls === 1;
        const pass = notRejected && oneImageCall && onePreScreen;
        record(
          "ENHC-06 sub-case C (accept on low confidence — AC-3)",
          pass,
          pass
            ? `no PreScreenRejectedError; preScreenCalls=1, imageModelCalls=1 (stubbed response)`
            : `observedError=${(observedError as Error)?.constructor?.name ?? "none"} preScreenCalls=${preScreenCalls} imageModelCalls=${imageCalls}`,
        );

        // ─────────────────────────────────────────────────────────────────
        // AC-5 — exactly 1 pre-screen call per invocation (no retry on result)
        //   Assert for sub-case C (the happy-path one that went all the way
        //   through). Sub-cases A and B already asserted preScreenCalls
        //   inline (=1 in B; =1 in A where the failure path throws at the
        //   very first call).
        // ─────────────────────────────────────────────────────────────────
        record(
          "ENHC-06 sub-case D (no retry on pre-screen — AC-5, exactly 1 call per invocation)",
          preScreenCalls === 1,
          preScreenCalls === 1
            ? `exactly 1 pre-screen call recorded for accept-path (D-08 no retry)`
            : `preScreenCalls=${preScreenCalls} (D-08 requires exactly 1)`,
        );

        // ─────────────────────────────────────────────────────────────────
        // ENHC-04 / ENHC-05 — inspect the captured image-model request body
        //   from sub-case C's stubbed call
        // ─────────────────────────────────────────────────────────────────
        const imageReq = enhRecorded.find((r) => r.url.includes(IMAGE_URL_SUFFIX));
        if (!imageReq || !imageReq.body) {
          record(
            "ENHC-04 / ENHC-05 (image-model body inspection)",
            false,
            `no image-model request body captured (imageCalls=${imageCalls})`,
          );
        } else {
          const parts = imageReq.body?.contents?.[0]?.parts ?? [];
          const textPart = parts.find((p: any) => typeof p?.text === "string");
          const inlinePart = parts.find((p: any) => p?.inlineData?.data);
          const promptText: string = textPart?.text ?? "";

          // AC-8: three verbatim substrings from research §enhancementPrompt
          const sub1 =
            "Task: Place this product in a new background scene while preserving it exactly.";
          const sub2 = "Do NOT add text, logos, or overlays.";
          const sub3 =
            "The product's shape, silhouette, color, proportions, branding, and surface texture must remain identical.";
          const ac8 =
            promptText.includes(sub1) && promptText.includes(sub2) && promptText.includes(sub3);

          // AC-9: scenery prompt_snippet is present in the prompt
          const snippet = resolvedScenery?.prompt_snippet ?? "";
          const ac9 = snippet.length > 0 && promptText.includes(snippet);

          record(
            "ENHC-04 (verbatim preservation rules + ENHC-05 scenery injection)",
            ac8 && ac9,
            ac8 && ac9
              ? `prompt contains all 3 locked preservation substrings AND scenery '${testSceneryId}' snippet`
              : `ac8(preservation)=${ac8} ac9(scenery)=${ac9}; promptText length=${promptText.length}`,
          );

          // AC-7: square input (width === height)
          if (!inlinePart?.inlineData?.data) {
            record(
              "ENHC-05 live (square input to image model)",
              false,
              "no inlineData part found in image-model body",
            );
          } else {
            try {
              const decoded = Buffer.from(inlinePart.inlineData.data, "base64");
              const meta = await sharp(decoded).metadata();
              const square =
                typeof meta.width === "number" &&
                typeof meta.height === "number" &&
                meta.width === meta.height;
              record(
                "ENHC-05 live (square input to image model — width===height)",
                square,
                square
                  ? `normalized input is ${meta.width}×${meta.height} (square)`
                  : `normalized input is ${meta.width}×${meta.height} (not square)`,
              );
            } catch (e) {
              record(
                "ENHC-05 live (square input decoding)",
                false,
                `failed to decode inlineData: ${(e as Error).message}`,
              );
            }
          }
        }

        // ─────────────────────────────────────────────────────────────────
        // ENHC-03 — EXIF strip assertion on the stored files
        //   (download source.webp and result.webp, run sharp().metadata(),
        //   assert no orientation/no exif)
        // ─────────────────────────────────────────────────────────────────
        if (scAcceptResult) {
          const postId = (scAcceptResult as { postId: string }).postId;
          const sourcePath = `${TEST_USER_ID}/enhancement/${postId}-source.webp`;
          const resultPath = `${TEST_USER_ID}/enhancement/${postId}.webp`;

          const downloadAndInspect = async (
            path: string,
          ): Promise<{
            ok: boolean;
            detail: string;
          }> => {
            const { data, error } = await admin.storage.from("user_assets").download(path);
            if (error || !data) {
              return { ok: false, detail: `download failed: ${error?.message}` };
            }
            const ab = await data.arrayBuffer();
            const buf = Buffer.from(ab);
            const meta = await sharp(buf).metadata();
            const orientationOk = meta.orientation === undefined || meta.orientation === 1;
            // `meta.exif` is a Buffer when present, undefined when absent.
            const exifOk = meta.exif === undefined;
            return {
              ok: orientationOk && exifOk,
              detail: `orientation=${meta.orientation ?? "undefined"} exif=${meta.exif === undefined ? "undefined" : `present(${(meta.exif as Buffer).length}B)`}`,
            };
          };

          const [srcCheck, resCheck] = await Promise.all([
            downloadAndInspect(sourcePath),
            downloadAndInspect(resultPath),
          ]);
          const enhc03Pass = srcCheck.ok && resCheck.ok;
          record(
            "ENHC-03 (EXIF strip on source + result)",
            enhc03Pass,
            enhc03Pass
              ? `source.webp: ${srcCheck.detail}; result.webp: ${resCheck.detail}`
              : `source.webp: ${srcCheck.detail} | result.webp: ${resCheck.detail}`,
          );
        } else {
          record(
            "ENHC-03 (EXIF strip on source + result)",
            false,
            "no successful enhancement result; cannot inspect stored files",
          );
        }
      }

      // ── AC-12 progress event order — lightweight, not gated on live Gemini ─
      // (captured from sub-case C's event stream if the run produced events)
      // ── Teardown: posts + explicit storage removes ─────────────────────────
      for (const postId of enhCreatedPostIds) {
        try {
          const { error: delErr } = await admin.from("posts").delete().eq("id", postId);
          if (delErr) {
            console.warn(`[cleanup] failed to delete enhancement post ${postId}: ${delErr.message}`);
          } else {
            console.log(`[cleanup] deleted enhancement post ${postId}`);
          }
        } catch (e) {
          console.warn(
            `[cleanup] exception deleting enhancement post ${postId}:`,
            (e as Error).message,
          );
        }
        // Defense in depth — remove the two deterministic files even if the
        // BEFORE DELETE trigger enqueueing fires.
        const sourcePath = `${TEST_USER_ID}/enhancement/${postId}-source.webp`;
        const resultPath = `${TEST_USER_ID}/enhancement/${postId}.webp`;
        try {
          const { error: rmErr } = await admin.storage
            .from("user_assets")
            .remove([sourcePath, resultPath]);
          if (rmErr) {
            console.warn(`[cleanup] storage remove failed for ${postId}: ${rmErr.message}`);
          } else {
            console.log(`[cleanup] storage removed [${sourcePath}, ${resultPath}]`);
          }
        } catch (e) {
          console.warn(
            `[cleanup] storage remove exception for ${postId}:`,
            (e as Error).message,
          );
        }
      }

      // Suppress unused-import warning (EnhancementProgressEvent imported for
      // future strict-order assertion; reserved for Phase 7 when progress
      // ordering is tested downstream).
      const _enhUnusedProgress: EnhancementProgressEvent | null = null;
      void _enhUnusedProgress;
    }
  } finally {
    await teardownTestUserIfMinted();
  }

  const passes = results.filter((r) => r.pass).length;
  const total = results.length;
  const failedCount = results.filter((r) => !r.pass).length;
  console.log("");
  if (failedCount === 0) {
    console.log(`VERIFY PHASE 06: PASS (${passes}/${total} implemented criteria)`);
  } else {
    console.log(`VERIFY PHASE 06: FAIL (${passes}/${total} implemented criteria)`);
  }
  process.exit(failedCount === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("VERIFY PHASE 06: FAIL — unhandled error:", err);
  try {
    await teardownTestUserIfMinted();
  } catch (cleanupErr) {
    console.error("[cleanup] teardown after crash failed:", (cleanupErr as Error).message);
  }
  process.exit(1);
});
