// scripts/verify-phase-26.ts
// Phase 26 (Fixes & Polish) static + functional verifier.
// Run: npx tsx scripts/verify-phase-26.ts
// Supports a --only=<substring> filter for fast per-task feedback, e.g.:
//   npx tsx scripts/verify-phase-26.ts --only=self-test
//
// Ownership: this harness is created by plan 26-01 — the Wave 0 Nyquist
// requirement (nothing in Phase 26 can be verified until this file exists) —
// and is extended ONLY by plan 26-10, which adds the 9th tag,
// [svc-cross-plan], for invariants that span files no single plan owns
// (mirrors scripts/verify-phase-23.ts's [svc-cross-plan] precedent added by
// 23-11, scripts/verify-phase-24.ts's added by 24-07, and
// scripts/verify-phase-25.ts's added by 25-14) plus the trailing authoritative
// live-runbook block comment at the bottom of this file. Plans 26-02..26-09
// are NOT permitted to edit this file — their job is to turn its red checks
// green by writing the code these checks describe. That includes
// [svc-logo-contrast] (POL-03, owned end-to-end by plan 26-07): since no plan
// other than 26-10 (cross-plan invariants only) ever gets another chance to
// touch this file, its checks are written HERE, by 26-01, alongside every
// other requirement tag. This plan's own Task 3 appends the remaining
// [svc-idempotency] (POL-06), [svc-quality-dashboard] (POL-09), and
// [svc-cost-reconciliation-runbook] (POL-08) tag groups.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const failures: string[] = [];
const ok: string[] = [];

const onlyArg = process.argv.find((a) => /^--only=(.+)$/.test(a));
const only = onlyArg ? onlyArg.match(/^--only=(.+)$/)![1] : null;

function check(name: string, cond: boolean, detail = "") {
  if (only && !name.includes(only)) return;
  if (cond) ok.push(name);
  else failures.push(`${name}${detail ? " — " + detail : ""}`);
}
function read(p: string) {
  return fs.readFileSync(p, "utf8");
}
function exists(p: string) {
  return fs.existsSync(p);
}
function readSafe(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}
// Only bother running an expensive (subprocess-spawning) functional check
// group if the --only filter could possibly match one of its check names.
function tagActive(tag: string): boolean {
  return !only || tag.includes(only) || only.includes(tag);
}

// ── Balanced-delimiter extraction helpers ──────────────────────────────────
// Self-contained (no dependency on any other verify-phase-*.ts file) —
// heuristics good enough for grepping this repo's own TypeScript style, not a
// general parser. Copied verbatim from scripts/verify-phase-24.ts /
// scripts/verify-phase-25.ts.

/** Extracts `export const NAME = z.object({ ... });`'s balanced-brace body. */
function extractZodObjectBody(src: string, constName: string): string {
  const marker = `export const ${constName} = z.object({`;
  const idx = src.indexOf(marker);
  if (idx === -1) return "";
  let i = idx + marker.length - 1; // at the opening "{"
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(start, i);
}

/** Extracts `<markerPrefix> = { ... }`'s balanced-brace body (plain object literal, not z.object). */
function extractConstObjectLiteral(src: string, markerPrefix: string): string {
  const marker = `${markerPrefix} = {`;
  const idx = src.indexOf(marker);
  if (idx === -1) return "";
  let i = idx + marker.length - 1;
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(start, i);
}

/** Extracts an `(?:export )?interface NAME { ... }`'s balanced-brace body. */
function extractInterfaceBody(src: string, name: string): string {
  const m = new RegExp(`(?:export )?interface ${name}\\s*\\{`).exec(src);
  if (!m) return "";
  let i = m.index + m[0].length - 1;
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(start, i);
}

/**
 * Extracts a function's BODY (not its parameter list) starting from
 * `marker` (which must end with the function's opening "(" — e.g.
 * `"function drawBlocks("` or `"export async function applyLogoOverlay("`).
 * First balances PARENTHESES from that "(" to find the parameter list's true
 * close — correctly skipping past inline object-type parameter annotations
 * like `region: { left: number; ... }` that themselves contain braces — then
 * balances BRACES starting at the next "{" after that (the function body's
 * opening brace, skipping any `: ReturnType` annotation in between). Local to
 * this harness, mirrors the extract*Body helpers' style above.
 */
function extractFunctionBody(src: string, marker: string): string {
  const idx = src.indexOf(marker);
  if (idx === -1) return "";
  let i = idx + marker.length - 1; // at the opening "("
  let parenDepth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") parenDepth++;
    else if (src[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        i++;
        break;
      }
    }
  }
  const braceStart = src.indexOf("{", i);
  if (braceStart === -1) return "";
  let depth = 0;
  let j = braceStart;
  const start = braceStart;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  return src.slice(start, j);
}

// ── Small local helpers specific to this harness ───────────────────────────

/** Returns a window of `radius` chars on each side of the first occurrence of `marker` in `src`, or "" if not found. */
function windowAround(src: string, marker: string, radius: number): string {
  const idx = src.indexOf(marker);
  if (idx === -1) return "";
  return src.slice(Math.max(0, idx - radius), Math.min(src.length, idx + marker.length + radius));
}

/** Finds a migration file in supabase/migrations whose name ends with `suffix`. Returns its path or null. */
function findMigrationFile(suffix: string): string | null {
  const dir = "supabase/migrations";
  if (!exists(dir)) return null;
  const files = fs.readdirSync(dir);
  const match = files.find((f) => f.endsWith(suffix));
  return match ? path.join(dir, match) : null;
}

const PHASE_26_TAGS = [
  "self-test",
  "svc-webp-quality",
  "svc-webp-edge-check",
  "svc-drawblocks-font-fix",
  "svc-logo-contrast",
  "svc-idempotency",
  "svc-quality-dashboard",
  "svc-cost-reconciliation-runbook",
  "svc-cross-plan",
];

// ── Load sources ONCE. Most Phase 26 target files already exist (written by
// Phases 21-25) — this harness's job for those is to detect the ABSENCE of
// not-yet-written Phase 26 behavior inside them. A few target files
// (admin-quality.routes.ts, quality-tab.tsx, cost-reconciliation-runbook.md,
// the Wave-0 unit harness scripts) genuinely do not exist yet. readSafe()
// (not read()) keeps this harness from throwing on any of them — a
// not-yet-created file yields "" instead of an ENOENT. ──
const imageOptimizationPath = "server/services/image-optimization.service.ts";
const typographyCompositorPath = "server/services/typography-compositor.service.ts";
const generateRoutesPath = "server/routes/generate.routes.ts";
const editRoutesPath = "server/routes/edit.routes.ts";
const carouselRoutesPath = "server/routes/carousel.routes.ts";
const carouselGenPath = "server/services/carousel-generation.service.ts";
const cleanupCronServicePath = "server/services/cleanup-cron.service.ts";
const sharedSchemaPath = "shared/schema.ts";
const postsRoutesPath = "server/routes/posts.routes.ts";
const adminQualityRoutesPath = "server/routes/admin-quality.routes.ts";
const routesIndexPath = "server/routes/index.ts";
const postCreatorPath = "client/src/components/post-creator-dialog.tsx";
const postEditDialogPath = "client/src/components/post-edit-dialog.tsx";
const postViewerDialogPath = "client/src/components/post-viewer-dialog.tsx";
const postsPagePath = "client/src/pages/posts.tsx";
const adminPagePath = "client/src/pages/admin.tsx";
const appSidebarPath = "client/src/components/app-sidebar.tsx";
const quickRemakePath = "client/src/lib/quick-remake.ts";
const qualityTabPath = "client/src/components/admin/quality-tab.tsx";
const costReconciliationRunbookPath = "docs/cost-reconciliation-runbook.md";

const imageOptimizationSrc = readSafe(imageOptimizationPath);
const typographyCompositorSrc = readSafe(typographyCompositorPath);
const generateRoutesSrc = readSafe(generateRoutesPath);
const editRoutesSrc = readSafe(editRoutesPath);
const carouselRoutesSrc = readSafe(carouselRoutesPath);
const carouselGenSrc = readSafe(carouselGenPath);
const cleanupCronServiceSrc = readSafe(cleanupCronServicePath);
const sharedSchemaSrc = readSafe(sharedSchemaPath);
const postsRoutesSrc = readSafe(postsRoutesPath);
const adminQualityRoutesSrc = readSafe(adminQualityRoutesPath);
const routesIndexSrc = readSafe(routesIndexPath);
const postCreatorSrc = readSafe(postCreatorPath);
const postEditDialogSrc = readSafe(postEditDialogPath);
const postViewerDialogSrc = readSafe(postViewerDialogPath);
const postsPageSrc = readSafe(postsPagePath);
const adminPageSrc = readSafe(adminPagePath);
const appSidebarSrc = readSafe(appSidebarPath);
const quickRemakeSrc = readSafe(quickRemakePath);
const qualityTabSrc = readSafe(qualityTabPath);
const costReconciliationRunbookSrc = readSafe(costReconciliationRunbookPath);

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  // [self-test] — proves THIS harness is not vacuous (6 checks)
  // ══════════════════════════════════════════════════════════════════════
  check("[self-test] harness executes", true);

  {
    const selfSrc = read("scripts/verify-phase-26.ts");
    check(
      "[self-test] harness source contains all 9 Phase 26 tag literals",
      PHASE_26_TAGS.every((t) => selfSrc.includes(`[${t}]`)),
    );
    // Checks 3 & 4 assert this harness is WIRED to eventually invoke the
    // Wave 0 unit harnesses later plans create — NOT that those files already
    // exist on disk today. Asserting raw exists() here would make
    // --only=self-test legitimately red until 26-02/26-03/26-07 land,
    // contradicting this plan's own must_haves.truths ("self-test exits 0")
    // and the Phase 22/23/24/25 precedent that [self-test] only proves the
    // CURRENT plan's own deliverables, never a future plan's.
    check(
      "[self-test] harness is wired to invoke the Wave 0 unit harness scripts/verify-webp-text-edge.ts (created by 26-02)",
      selfSrc.includes("scripts/verify-webp-text-edge.ts"),
    );
    check(
      "[self-test] harness is wired to invoke the Wave 0 unit harnesses scripts/test-drawblocks-font-state.ts (created by 26-03) and scripts/test-logo-overlay-contrast.ts (created by 26-07)",
      selfSrc.includes("scripts/test-drawblocks-font-state.ts") && selfSrc.includes("scripts/test-logo-overlay-contrast.ts"),
    );
  }

  check(
    "[self-test] scanner is not vacuous — a deliberately absent sentinel is correctly reported ABSENT from image-optimization.service.ts",
    !imageOptimizationSrc.includes("__PHASE_26_ABSENT_SENTINEL__"),
  );

  check(
    "[self-test] the three Wave 0 logo/corner-contrast fixtures exist on disk (delivered by this plan's own Task 1)",
    exists("tests/fixtures/logo/logo-alpha-256.png") &&
      exists("tests/fixtures/logo/logo-opaque-256.jpg") &&
      exists("tests/fixtures/logo/quad-corners-1024.png"),
    "expected tests/fixtures/logo/{logo-alpha-256.png,logo-opaque-256.jpg,quad-corners-1024.png} to exist (Task 1 of plan 26-01)",
  );

  // ══════════════════════════════════════════════════════════════════════
  // [svc-webp-quality] (POL-02) — main-image WebP quality bumped 80 -> 85;
  // thumbnail quality (a separate, lower setting) untouched; no call site
  // silently overrides the new default.
  // ══════════════════════════════════════════════════════════════════════
  check(
    "[svc-webp-quality] image-optimization.service.ts declares const DEFAULT_IMAGE_QUALITY = 85 (the old = 80 literal is gone)",
    /const DEFAULT_IMAGE_QUALITY = 85;/.test(imageOptimizationSrc) &&
      !/const DEFAULT_IMAGE_QUALITY = 80;/.test(imageOptimizationSrc),
    `26-02 must change DEFAULT_IMAGE_QUALITY from 80 to 85 in ${imageOptimizationPath}`,
  );

  {
    const thumbOptionsBody = extractConstObjectLiteral(
      imageOptimizationSrc,
      "const DEFAULT_THUMBNAIL_OPTIONS: ThumbnailOptions",
    );
    check(
      "[svc-webp-quality] DEFAULT_THUMBNAIL_OPTIONS still declares quality: 70 — the separate, lower thumbnail setting must NOT be swept along by the main-image bump",
      /quality:\s*70/.test(thumbOptionsBody),
      `expected DEFAULT_THUMBNAIL_OPTIONS in ${imageOptimizationPath} to keep quality: 70 unchanged`,
    );
  }

  {
    const callSiteFiles = [
      { p: generateRoutesPath, src: generateRoutesSrc },
      { p: editRoutesPath, src: editRoutesSrc },
      { p: carouselRoutesPath, src: carouselRoutesSrc },
      { p: carouselGenPath, src: carouselGenSrc },
    ];
    let totalCalls = 0;
    let singleArgCalls = 0;
    for (const f of callSiteFiles) {
      totalCalls += (f.src.match(/processImageWithThumbnail\(/g) ?? []).length;
      singleArgCalls += (f.src.match(/processImageWithThumbnail\([A-Za-z0-9_.]+\)/g) ?? []).length;
    }
    check(
      "[svc-webp-quality] no call site passes an explicit main-image quality override — every processImageWithThumbnail( occurrence across generate/edit/carousel routes + carousel-generation.service.ts is single-argument, so the DEFAULT_IMAGE_QUALITY constant genuinely propagates",
      totalCalls > 0 && totalCalls === singleArgCalls,
      `expected every processImageWithThumbnail( call across ${callSiteFiles.map((f) => f.p).join(", ")} to be single-argument (found ${totalCalls} total, ${singleArgCalls} single-argument)`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // [svc-webp-edge-check] (POL-02) — automated text-edge-sharpness
  // regression check for the new WebP quality setting.
  // ══════════════════════════════════════════════════════════════════════
  {
    const webpEdgeScriptPath = "scripts/verify-webp-text-edge.ts";
    const webpEdgeExists = exists(webpEdgeScriptPath);
    check(
      `[svc-webp-edge-check] ${webpEdgeScriptPath} exists`,
      webpEdgeExists,
      `26-02 must create ${webpEdgeScriptPath} (renders text via the compositor, encodes to WebP at DEFAULT_IMAGE_QUALITY, and measures edge-sharpness retention in a region straddling a text edge)`,
    );

    if (tagActive("svc-webp-edge-check")) {
      if (!webpEdgeExists) {
        check(
          `[svc-webp-edge-check] FUNCTIONAL: ${webpEdgeScriptPath} exits 0`,
          false,
          `missing — 26-02 must create ${webpEdgeScriptPath} before this check can run`,
        );
      } else {
        const run = spawnSync("npx", ["tsx", webpEdgeScriptPath], {
          encoding: "utf8",
          shell: process.platform === "win32",
        });
        const lastLine =
          (run.stderr || "").trim().split("\n").pop() || (run.stdout || "").trim().split("\n").pop() || "";
        check(
          `[svc-webp-edge-check] FUNCTIONAL: ${webpEdgeScriptPath} exits 0`,
          run.status === 0,
          run.status !== 0 ? lastLine : "",
        );
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // [svc-drawblocks-font-fix] — drawBlocks() never assigns ctx.font itself,
  // silently inheriting layoutBlocks()'s last-measured font in multi-block
  // layouts (pre-existing bug, present since Phase 23, logged in Phase 25's
  // deferred-items.md; this phase is the natural place to close it).
  // ══════════════════════════════════════════════════════════════════════
  {
    const drawBlocksBody = extractFunctionBody(typographyCompositorSrc, "function drawBlocks(");
    check(
      "[svc-drawblocks-font-fix] drawBlocks()'s balanced-brace body contains a ctx.font = assignment",
      drawBlocksBody.includes("ctx.font ="),
      `26-03 must add a ctx.font = assignment inside drawBlocks() in ${typographyCompositorPath} — the bug: drawBlocks never sets ctx.font itself, inheriting layoutBlocks()'s last measured font`,
    );
    check(
      "[svc-drawblocks-font-fix] that ctx.font = assignment is INSIDE the layouts.forEach( loop (per-block font, not one stale font for the whole draw pass)",
      windowAround(drawBlocksBody, "layouts.forEach(", 1200).includes("ctx.font ="),
      `26-03 must set ctx.font = inside the layouts.forEach( loop body of drawBlocks() in ${typographyCompositorPath}`,
    );
  }

  {
    const drawBlocksScriptPath = "scripts/test-drawblocks-font-state.ts";
    const drawBlocksScriptExists = exists(drawBlocksScriptPath);
    check(
      `[svc-drawblocks-font-fix] ${drawBlocksScriptPath} exists`,
      drawBlocksScriptExists,
      `26-03 must create ${drawBlocksScriptPath} (no-network unit harness proving per-block font state across a multi-block layout)`,
    );

    if (tagActive("svc-drawblocks-font-fix")) {
      if (!drawBlocksScriptExists) {
        check(
          `[svc-drawblocks-font-fix] FUNCTIONAL: ${drawBlocksScriptPath} exits 0`,
          false,
          `missing — 26-03 must create ${drawBlocksScriptPath} before this check can run`,
        );
      } else {
        const run = spawnSync("npx", ["tsx", drawBlocksScriptPath], {
          encoding: "utf8",
          shell: process.platform === "win32",
        });
        const lastLine =
          (run.stderr || "").trim().split("\n").pop() || (run.stdout || "").trim().split("\n").pop() || "";
        check(
          `[svc-drawblocks-font-fix] FUNCTIONAL: ${drawBlocksScriptPath} exits 0`,
          run.status === 0,
          run.status !== 0 ? lastLine : "",
        );
      }
    }
  }

  console.log(`\n=== Phase 26 verify ===`);
  console.log(`PASS: ${ok.length}`);
  ok.forEach((n) => console.log(`  ✓ ${n}`));
  if (failures.length) {
    console.log(`\nFAIL: ${failures.length}`);
    failures.forEach((n) => console.log(`  ✗ ${n}`));
    process.exit(1);
  }
  console.log(`\nAll Phase 26 checks passed.`);
}

main().catch((err) => {
  console.error("verify-phase-26 harness crashed:", err);
  process.exit(1);
});
