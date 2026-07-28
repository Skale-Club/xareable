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

  // ══════════════════════════════════════════════════════════════════════
  // [svc-idempotency] (POL-06) — generate/edit gain the EXACT
  // carousel/enhance idempotency contract: idempotency_key: z.string().uuid()
  // in the request body, a pre-flight SELECT before any generation work
  // starts (before the credit gate), a DB unique index for concurrent-request
  // race safety, and all 4 client call sites generating a key.
  // ══════════════════════════════════════════════════════════════════════
  {
    const generateBody = extractZodObjectBody(sharedSchemaSrc, "generateRequestSchema");
    check(
      "[svc-idempotency] shared/schema.ts's generateRequestSchema declares idempotency_key: z.string().uuid() (non-optional, mirroring carousel/enhance)",
      generateBody.includes("idempotency_key: z.string().uuid()") &&
        !generateBody.includes("idempotency_key: z.string().uuid().optional()"),
      `26-04 must add idempotency_key: z.string().uuid() (non-optional) to generateRequestSchema in ${sharedSchemaPath}`,
    );
  }

  {
    const editBody = extractZodObjectBody(sharedSchemaSrc, "editPostRequestSchema");
    const idemIdx = editBody.indexOf("idempotency_key: z.string().uuid()");
    const editContextIdx = editBody.indexOf("edit_context: z.object({");
    check(
      "[svc-idempotency] shared/schema.ts's editPostRequestSchema declares a TOP-LEVEL idempotency_key: z.string().uuid() (before edit_context, not nested inside it)",
      idemIdx > -1 && editContextIdx > -1 && idemIdx < editContextIdx,
      `26-06 must add a top-level idempotency_key: z.string().uuid() to editPostRequestSchema (before its edit_context field) in ${sharedSchemaPath}`,
    );
  }

  {
    const editSlideBody = extractZodObjectBody(sharedSchemaSrc, "editSlideRequestSchema");
    check(
      "[svc-idempotency] OUT-OF-SCOPE GUARD: shared/schema.ts's editSlideRequestSchema does NOT gain idempotency_key — POST /api/carousel/slide/edit is explicitly out of POL-06's scope",
      !editSlideBody.includes("idempotency_key"),
      `expected editSlideRequestSchema in ${sharedSchemaPath} to NOT declare idempotency_key (out of scope per 26-CONTEXT.md)`,
    );
  }

  {
    const postVersionBody = extractZodObjectBody(sharedSchemaSrc, "postVersionSchema");
    check(
      "[svc-idempotency] shared/schema.ts's postVersionSchema gains idempotency_key: z.string().uuid().nullable() (edit's OWN dedup column — post_versions, not posts)",
      postVersionBody.includes("idempotency_key: z.string().uuid().nullable()"),
      `26-06 must add idempotency_key: z.string().uuid().nullable() to postVersionSchema in ${sharedSchemaPath}`,
    );
  }

  {
    const idemIdx = generateRoutesSrc.indexOf('.eq("idempotency_key"');
    const creditIdx = generateRoutesSrc.indexOf("checkCredits(");
    const win = windowAround(generateRoutesSrc, '.eq("idempotency_key"', 500);
    check(
      "[svc-idempotency] generate.routes.ts runs an idempotency pre-flight SELECT (scoped by idempotency_key + user_id) BEFORE the credit gate, returning { idempotent: true, post } on a hit",
      idemIdx > -1 && creditIdx > -1 && idemIdx < creditIdx && win.includes('.eq("user_id"') && win.includes("idempotent: true"),
      `26-04 must add a pre-flight .eq("idempotency_key", ...).eq("user_id", ...) SELECT before checkCredits( in ${generateRoutesPath}, mirroring carousel.routes.ts's existing contract`,
    );
  }

  {
    const idemIdx = editRoutesSrc.indexOf('.eq("idempotency_key"');
    const creditIdx = editRoutesSrc.indexOf("checkCredits(");
    const win = windowAround(editRoutesSrc, '.eq("idempotency_key"', 600);
    check(
      '[svc-idempotency] edit.routes.ts runs an idempotency pre-flight SELECT scoped by (idempotency_key, post_id) — NOT user_id, since post_versions has no user_id column — BEFORE the credit gate',
      idemIdx > -1 &&
        creditIdx > -1 &&
        idemIdx < creditIdx &&
        win.includes('from("post_versions")') &&
        win.includes('.eq("post_id"') &&
        !win.includes('.eq("user_id"'),
      `26-06 must add a pre-flight SELECT from("post_versions").eq("idempotency_key", ...).eq("post_id", ...) before checkCredits( in ${editRoutesPath}`,
    );
  }

  {
    const postsInsertMatch = /\.from\(["']posts["']\)\s*\.insert\(\{([\s\S]*?)\}\)/.exec(generateRoutesSrc);
    const postsInsertBody = postsInsertMatch ? postsInsertMatch[1] : "";
    const versionsInsertMatch = /\.from\(["']post_versions["']\)\s*\.insert\(\{([\s\S]*?)\}\)/.exec(editRoutesSrc);
    const versionsInsertBody = versionsInsertMatch ? versionsInsertMatch[1] : "";
    check(
      "[svc-idempotency] generate.routes.ts's posts insert object AND edit.routes.ts's post_versions insert object both carry idempotency_key",
      postsInsertBody.includes("idempotency_key") && versionsInsertBody.includes("idempotency_key"),
      `26-04 must add idempotency_key to the posts insert in ${generateRoutesPath}; 26-06 must add idempotency_key to the post_versions insert in ${editRoutesPath}`,
    );
  }

  {
    const migFile = findMigrationFile("_post_versions_idempotency_key.sql");
    const migSrc = migFile ? readSafe(migFile) : "";
    check(
      "[svc-idempotency] a migration matching supabase/migrations/*_post_versions_idempotency_key.sql exists, adds the column, and creates a partial unique index (where idempotency_key is not null) for race-safe dedup",
      migFile !== null &&
        /add column if not exists idempotency_key/i.test(migSrc) &&
        /create unique index if not exists/i.test(migSrc) &&
        /where idempotency_key is not null/i.test(migSrc),
      `26-06 must add supabase/migrations/<ts>_post_versions_idempotency_key.sql with ADD COLUMN IF NOT EXISTS idempotency_key + CREATE UNIQUE INDEX IF NOT EXISTS ... WHERE idempotency_key IS NOT NULL`,
    );
  }

  {
    const postCreatorWin = windowAround(postCreatorSrc, 'fetchSSE("/api/generate"', 1500);
    const postsPageWin = windowAround(postsPageSrc, 'apiRequest("POST", "/api/edit-post"', 800);
    check(
      "[svc-idempotency] all four client call sites (post-creator-dialog.tsx generate, quick-remake.ts, post-edit-dialog.tsx, posts.tsx edit) generate and send an idempotency_key",
      postCreatorWin.includes("idempotency_key") &&
        quickRemakeSrc.includes("crypto.randomUUID()") &&
        postEditDialogSrc.includes("idempotency_key") &&
        postsPageWin.includes("idempotency_key"),
      `26-04/26-06 must add crypto.randomUUID()-generated idempotency_key to all 4 client generate/edit call sites (${postCreatorPath}, ${quickRemakePath}, ${postEditDialogPath}, ${postsPagePath}) — none send one today`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // [svc-quality-dashboard] (POL-09) — thumbs-up/down feedback on posts +
  // an admin Quality tab aggregating feedback, visual_critic outcomes, and
  // model_fallback rates.
  // ══════════════════════════════════════════════════════════════════════
  {
    const postSchemaBody = extractZodObjectBody(sharedSchemaSrc, "postSchema");
    check(
      '[svc-quality-dashboard] shared/schema.ts\'s postSchema declares feedback: z.enum(["up", "down"]) (nullable, one vote per post, overwritable)',
      /feedback:\s*z\.enum\(\[\s*"up"\s*,\s*"down"\s*\]\)/.test(postSchemaBody),
      `26-08 must add feedback: z.enum(["up","down"]).nullable().default(null) to postSchema in ${sharedSchemaPath}`,
    );
  }

  {
    const migFile = findMigrationFile("_posts_feedback.sql");
    const migSrc = migFile ? readSafe(migFile) : "";
    check(
      "[svc-quality-dashboard] a migration matching supabase/migrations/*_posts_feedback.sql exists and adds the feedback column",
      migFile !== null && /add column if not exists feedback/i.test(migSrc),
      "26-08 must add supabase/migrations/<ts>_posts_feedback.sql with ADD COLUMN IF NOT EXISTS feedback",
    );
  }

  {
    const registered = /router\.(patch|post)\("\/api\/posts\/:id\/feedback"/.test(postsRoutesSrc);
    check(
      "[svc-quality-dashboard] posts.routes.ts registers a feedback endpoint (PATCH or POST /api/posts/:id/feedback)",
      registered,
      `26-08 must register router.patch("/api/posts/:id/feedback", ...) in ${postsRoutesPath}`,
    );

    const feedbackWin = windowAround(postsRoutesSrc, "/api/posts/:id/feedback", 800);
    check(
      '[svc-quality-dashboard] the feedback endpoint checks ownership (.eq("user_id")) and overwrites the single feedback column via .update({ feedback: ... }) — no new feedback-event table',
      feedbackWin.includes('.eq("user_id"') && /\.update\(\{[\s\S]{0,200}feedback/.test(feedbackWin),
      `26-08's feedback endpoint in ${postsRoutesPath} must scope by .eq("user_id", ...) and .update({ feedback: ... })`,
    );
  }

  {
    const adminQualityOk =
      exists(adminQualityRoutesPath) &&
      adminQualityRoutesSrc.includes("requireAdminGuard") &&
      adminQualityRoutesSrc.includes("createAdminSupabase") &&
      /router\.get\(\s*["']\/api\/admin\/quality["']/.test(adminQualityRoutesSrc);
    check(
      "[svc-quality-dashboard] server/routes/admin-quality.routes.ts exists, uses requireAdminGuard + createAdminSupabase, and registers GET /api/admin/quality",
      adminQualityOk,
      `26-09 must create ${adminQualityRoutesPath} with requireAdminGuard, createAdminSupabase, and router.get("/api/admin/quality", ...)`,
    );
  }

  {
    const queriesAllThree =
      /from\(["']posts["']\)[\s\S]{0,300}feedback/.test(adminQualityRoutesSrc) &&
      adminQualityRoutesSrc.includes("event_kind") &&
      adminQualityRoutesSrc.includes('"visual_critic"') &&
      adminQualityRoutesSrc.includes('"model_fallback"');
    check(
      "[svc-quality-dashboard] admin-quality.routes.ts queries all three sources: posts.feedback, generation_logs.event_kind='visual_critic', and event_kind='model_fallback'",
      queriesAllThree,
      `26-09's ${adminQualityRoutesPath} must query from("posts") selecting feedback, plus generation_logs filtered on event_kind = 'visual_critic' and event_kind = 'model_fallback'`,
    );
  }

  {
    const wired =
      /from\s+["'].*admin-quality\.routes(\.js)?["']/.test(routesIndexSrc) &&
      /router\.use\(\s*adminQualityRoutes\s*\)/.test(routesIndexSrc);
    check(
      "[svc-quality-dashboard] server/routes/index.ts imports and router.use(...)s the new admin-quality router",
      wired,
      `26-09 must import adminQualityRoutes from './admin-quality.routes.js' and call router.use(adminQualityRoutes) in ${routesIndexPath}`,
    );
  }

  {
    const uiWired =
      exists(qualityTabPath) &&
      /export (function|const) QualityTab\b/.test(qualityTabSrc) &&
      /case "quality":/.test(adminPageSrc) &&
      /page:\s*"quality"/.test(appSidebarSrc) &&
      postViewerDialogSrc.includes("/feedback") &&
      postViewerDialogSrc.includes("ThumbsUp");
    check(
      '[svc-quality-dashboard] UI is wired: quality-tab.tsx exports QualityTab, admin.tsx has case "quality":, app-sidebar.tsx\'s adminNavItems has page: "quality", and post-viewer-dialog.tsx calls the /feedback endpoint with a ThumbsUp control',
      uiWired,
      `26-09 must create ${qualityTabPath} (export QualityTab), wire ${adminPagePath}'s case "quality": + ${appSidebarPath}'s adminNavItems page: "quality", and add thumbs-up/down UI (ThumbsUp icon, .../feedback call) to ${postViewerDialogPath}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // [svc-cost-reconciliation-runbook] (POL-08) — a documented, scheduled
  // (not run) audit of usage_events (source of truth) vs OpenRouter's own
  // dashboard, deferred per ROADMAP to after one full billing period.
  // ══════════════════════════════════════════════════════════════════════
  {
    check(
      `[svc-cost-reconciliation-runbook] ${costReconciliationRunbookPath} exists`,
      exists(costReconciliationRunbookPath),
      `26-05 must create ${costReconciliationRunbookPath}`,
    );

    check(
      "[svc-cost-reconciliation-runbook] the runbook names usage_events.cost_usd_micros as the PRIMARY source of truth (generation_logs mentioned only as the investigation source)",
      costReconciliationRunbookSrc.includes("usage_events") &&
        costReconciliationRunbookSrc.includes("cost_usd_micros") &&
        costReconciliationRunbookSrc.includes("generation_logs") &&
        /source of truth/i.test(costReconciliationRunbookSrc),
      `26-05's runbook must state usage_events / cost_usd_micros is the primary source of truth, with generation_logs used only to investigate discrepancies, per 26-CONTEXT.md's resolved question`,
    );

    check(
      '[svc-cost-reconciliation-runbook] the runbook states a numeric material-discrepancy threshold and a scheduled trigger naming "billing period"',
      /\d+\s*%/.test(costReconciliationRunbookSrc) && /billing period/i.test(costReconciliationRunbookSrc),
      "26-05's runbook must state a numeric % discrepancy threshold and a 'billing period' scheduled trigger",
    );

    check(
      "[svc-cost-reconciliation-runbook] the runbook explicitly states this audit does NOT gate milestone close, AND scripts/reconcile-openrouter-costs.ts exists but is NOT registered in any cron",
      /does not gate|cannot gate/i.test(costReconciliationRunbookSrc) &&
        exists("scripts/reconcile-openrouter-costs.ts") &&
        !cleanupCronServiceSrc.includes("reconcile"),
      `26-05 must state the audit does not/cannot gate milestone close, create scripts/reconcile-openrouter-costs.ts, and NOT wire it into ${cleanupCronServicePath}'s cron schedule`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // [svc-logo-contrast] (POL-03) — applyLogoOverlay() becomes contrast-aware:
  // samples the target region via analyzeRegionContrast(), detects a no-alpha
  // logo source (the JPEG box-artifact bug), and applies a soft-edged
  // plate/shadow treatment instead. An explicit logo_position is always
  // respected; automatic corner selection is a fallback only.
  // ══════════════════════════════════════════════════════════════════════
  {
    const applyLogoOverlayBody = extractFunctionBody(imageOptimizationSrc, "export async function applyLogoOverlay(");
    check(
      "[svc-logo-contrast] applyLogoOverlay(...) calls analyzeRegionContrast( to sample the logo's target region before deciding on a treatment",
      applyLogoOverlayBody.includes("analyzeRegionContrast("),
      `26-07 must import analyzeRegionContrast from typography-compositor.service.ts and call it inside applyLogoOverlay( in ${imageOptimizationPath}`,
    );
    check(
      "[svc-logo-contrast] applyLogoOverlay(...) inspects the logo buffer's alpha channel (hasAlpha) before compositing — the no-alpha JPEG box-artifact bug's root cause must be detected, not just visually patched",
      /hasAlpha/.test(applyLogoOverlayBody),
      `26-07 must detect the logo's hasAlpha metadata inside applyLogoOverlay( in ${imageOptimizationPath} to decide when the soft-edged plate/shadow treatment is needed (the no-alpha JPEG case)`,
    );
  }

  {
    const logoContrastScriptPath = "scripts/test-logo-overlay-contrast.ts";
    const logoContrastScriptExists = exists(logoContrastScriptPath);
    check(
      `[svc-logo-contrast] ${logoContrastScriptPath} exists`,
      logoContrastScriptExists,
      `26-07 must create ${logoContrastScriptPath} (no-network unit harness exercising tests/fixtures/logo/*)`,
    );

    if (tagActive("svc-logo-contrast")) {
      if (!logoContrastScriptExists) {
        check(
          `[svc-logo-contrast] FUNCTIONAL: ${logoContrastScriptPath} exits 0`,
          false,
          `missing — 26-07 must create ${logoContrastScriptPath} before this check can run`,
        );
      } else {
        const run = spawnSync("npx", ["tsx", logoContrastScriptPath], {
          encoding: "utf8",
          shell: process.platform === "win32",
        });
        const lastLine =
          (run.stderr || "").trim().split("\n").pop() || (run.stdout || "").trim().split("\n").pop() || "";
        check(
          `[svc-logo-contrast] FUNCTIONAL: ${logoContrastScriptPath} exits 0`,
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
