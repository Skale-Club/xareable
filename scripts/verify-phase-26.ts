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

  // ══════════════════════════════════════════════════════════════════════
  // [svc-cross-plan] (plan 26-10) — invariants spanning files no single plan
  // owns: idempotency survives the logo-overlay re-edit (26-06 x 26-07), both
  // image-optimization changes coexist (26-02 x 26-07), no coverage gap in
  // the logo path, the feedback write/read column chain (four files, two
  // plans), the compositor contract unchanged by the font fix (26-03), the
  // POL-08 scheduled-not-run property, and a subprocess sweep of every
  // Phase 26 unit harness plus every prior-phase/CI gate. Mirrors
  // scripts/verify-phase-25.ts's [svc-cross-plan] precedent (25-14) and
  // scripts/verify-phase-24.ts's (24-07).
  // ══════════════════════════════════════════════════════════════════════

  // 1) IDEMPOTENCY SURVIVED THE LOGO-OVERLAY RE-EDIT (26-06 x 26-07). Both
  // generate.routes.ts and edit.routes.ts were edited by two plans in two
  // waves — ordering, not mere presence: a duplicate must be rejected BEFORE
  // any money is committed and long BEFORE any image work happens.
  {
    const idemIdx = generateRoutesSrc.indexOf('.eq("idempotency_key"');
    const creditIdx = generateRoutesSrc.indexOf("checkCredits(");
    const logoIdx = generateRoutesSrc.indexOf("applyLogoOverlay(");
    check(
      "[svc-cross-plan] IDEMPOTENCY SURVIVED THE LOGO-OVERLAY RE-EDIT: generate.routes.ts runs its idempotency pre-flight BEFORE checkCredits( AND BEFORE applyLogoOverlay( (26-06 x 26-07 composition)",
      idemIdx > -1 && creditIdx > -1 && logoIdx > -1 && idemIdx < creditIdx && creditIdx < logoIdx,
      `expected .eq("idempotency_key" < checkCredits( < applyLogoOverlay( by source position in ${generateRoutesPath}`,
    );
  }
  {
    const idemIdx = editRoutesSrc.indexOf('.eq("idempotency_key"');
    const creditIdx = editRoutesSrc.indexOf("checkCredits(");
    const logoIdx = editRoutesSrc.indexOf("applyLogoOverlay(");
    check(
      "[svc-cross-plan] IDEMPOTENCY SURVIVED THE LOGO-OVERLAY RE-EDIT: edit.routes.ts runs its idempotency pre-flight BEFORE checkCredits( AND BEFORE applyLogoOverlay( (26-06 x 26-07 composition)",
      idemIdx > -1 && creditIdx > -1 && logoIdx > -1 && idemIdx < creditIdx && creditIdx < logoIdx,
      `expected .eq("idempotency_key" < checkCredits( < applyLogoOverlay( by source position in ${editRoutesPath}`,
    );
  }

  // 2) BOTH IMAGE-OPTIMIZATION CHANGES COEXIST (26-02 x 26-07). 26-07
  // rewrote a large block of the same file 26-02 touched; guard against one
  // plan's diff eating the other's.
  {
    const hasQuality85 = /const DEFAULT_IMAGE_QUALITY = 85;/.test(imageOptimizationSrc);
    const hasDetailed = imageOptimizationSrc.includes("applyLogoOverlayDetailed");
    const hasAnalyze = imageOptimizationSrc.includes("analyzeRegionContrast");
    const thumbBody = extractConstObjectLiteral(imageOptimizationSrc, "const DEFAULT_THUMBNAIL_OPTIONS: ThumbnailOptions");
    const hasQuality70 = /quality:\s*70/.test(thumbBody);
    check(
      "[svc-cross-plan] BOTH IMAGE-OPTIMIZATION CHANGES COEXIST: image-optimization.service.ts declares DEFAULT_IMAGE_QUALITY = 85 AND applyLogoOverlayDetailed AND analyzeRegionContrast AND DEFAULT_THUMBNAIL_OPTIONS still quality: 70 — 26-07's rewrite did not silently eat 26-02's quality bump or vice versa",
      hasQuality85 && hasDetailed && hasAnalyze && hasQuality70,
      `hasQuality85=${hasQuality85} hasDetailed=${hasDetailed} hasAnalyze=${hasAnalyze} hasQuality70=${hasQuality70} in ${imageOptimizationPath}`,
    );
  }

  // 3) NO COVERAGE GAP IN THE LOGO PATH. Half of this fix shipping (a
  // service that can auto-select, behind routes that never let it) would be
  // an invisible no-op.
  {
    const sigMatch = /export async function applyLogoOverlay\(([\s\S]*?)\)\s*:\s*Promise<Buffer>/.exec(imageOptimizationSrc);
    const sig = sigMatch ? sigMatch[1] : "";
    const noDefaultInSignature = sig.length > 0 && !sig.includes('"bottom-right"');
    const noFallbackInGenerate = !/logo_position\s*(\?\?|\|\|)\s*"bottom-right"/.test(generateRoutesSrc);
    const noFallbackInEdit = !/(logo_position|logoPosition)\s*(\?\?|\|\|)\s*"bottom-right"/.test(editRoutesSrc);
    check(
      '[svc-cross-plan] NO COVERAGE GAP IN THE LOGO PATH: applyLogoOverlay(...)\'s own signature no longer defaults position to "bottom-right", AND neither generate.routes.ts nor edit.routes.ts collapses an absent logo_position with ?? "bottom-right" / || "bottom-right" before calling it — the auto-corner-selection feature is actually reachable, not shipped inert behind a route that still pre-collapses the default',
      noDefaultInSignature && noFallbackInGenerate && noFallbackInEdit,
      `noDefaultInSignature=${noDefaultInSignature} noFallbackInGenerate=${noFallbackInGenerate} noFallbackInEdit=${noFallbackInEdit}`,
    );
  }

  // 4) THE FEEDBACK WRITE PATH AND THE READ PATH ADDRESS THE SAME COLUMN — a
  // four-file chain owned by two plans (26-08 user-facing, 26-09 admin).
  {
    const migFile = findMigrationFile("_posts_feedback.sql");
    const migSrc = migFile ? readSafe(migFile) : "";
    const writeOk =
      /\.update\(\{[\s\S]{0,200}feedback/.test(postsRoutesSrc) && postsRoutesSrc.includes("/api/posts/:id/feedback");
    const adminReadOk = /from\(["']posts["']\)[\s\S]{0,300}feedback/.test(adminQualityRoutesSrc);
    const viewerOk = postViewerDialogSrc.includes("/feedback");
    const migOk = migFile !== null && /add column if not exists feedback/i.test(migSrc);
    check(
      "[svc-cross-plan] FEEDBACK WRITE PATH AND READ PATH ADDRESS THE SAME COLUMN: posts.routes.ts's feedback handler updates feedback, admin-quality.routes.ts selects feedback from posts, post-viewer-dialog.tsx PATCHes .../feedback, and the *_posts_feedback.sql migration adds that column — a four-file chain spanning 26-08 and 26-09",
      writeOk && adminReadOk && viewerOk && migOk,
      `writeOk=${writeOk} adminReadOk=${adminReadOk} viewerOk=${viewerOk} migOk=${migOk}`,
    );
  }

  // 5) THE COMPOSITOR CONTRACT IS UNCHANGED BY THE FONT FIX (26-03). The fix
  // changed rasterization, not the persisted contract — if the contract
  // moved, every Phase 23/25 persisted row is suspect.
  {
    const hasVersion1 = /COMPOSITOR_VERSION = 1/.test(typographyCompositorSrc);
    const zeroBlocksWindow = windowAround(typographyCompositorSrc, "params.textBlocks.length === 0", 400);
    const hasPassThrough = zeroBlocksWindow.includes("buffer: params.baseImageBuffer");
    const typoMetaBody = extractZodObjectBody(sharedSchemaSrc, "typographyMetaSchema");
    const contractFields = [
      "compositor_version",
      "layout_archetype_id",
      "text_blocks",
      "text_color",
      "fonts",
      "scrim",
      "safe_zone",
      "canvas",
    ];
    const contractUnchanged = contractFields.every((f) => typoMetaBody.includes(f));
    check(
      "[svc-cross-plan] THE COMPOSITOR CONTRACT IS UNCHANGED BY THE FONT FIX: typography-compositor.service.ts still declares COMPOSITOR_VERSION = 1 and still contains the zero-text-blocks pass-through early return, AND shared/schema.ts's typographyMetaSchema is unchanged in shape (compositor_version/layout_archetype_id/text_blocks/text_color/fonts/scrim/safe_zone/canvas all still present) — 26-03 fixed rasterization, not the persisted contract",
      hasVersion1 && hasPassThrough && contractUnchanged,
      `hasVersion1=${hasVersion1} hasPassThrough=${hasPassThrough} contractUnchanged=${contractUnchanged}`,
    );
  }

  // 6) POL-08 IS SET UP BUT GENUINELY NOT SCHEDULED. Mention-vs-negated-
  // mention count (this harness's OWN prose above mentions "reconcile" many
  // times, so a raw string-includes on THIS file would be meaningless here —
  // this check greps the TARGET files, not itself) avoids the
  // self-referential-scanner false-positive class 23-09/24-07/25-14 hit.
  {
    const cleanupMentions = (cleanupCronServiceSrc.match(/reconcile/gi) ?? []).length;
    let workflowMentions = 0;
    const workflowsDir = ".github/workflows";
    if (exists(workflowsDir)) {
      for (const f of fs.readdirSync(workflowsDir)) {
        const src = readSafe(path.join(workflowsDir, f));
        workflowMentions += (src.match(/reconcile/gi) ?? []).length;
      }
    }
    const runbookExists = exists(costReconciliationRunbookPath);
    const scaffoldExists = exists("scripts/reconcile-openrouter-costs.ts");
    check(
      "[svc-cross-plan] POL-08 IS SET UP BUT GENUINELY NOT SCHEDULED: docs/cost-reconciliation-runbook.md exists, scripts/reconcile-openrouter-costs.ts exists, AND neither cleanup-cron.service.ts nor any file under .github/workflows/ mentions 'reconcile' (0 mentions in each) — the scaffold exists without being silently wired into any scheduler",
      runbookExists && scaffoldExists && cleanupMentions === 0 && workflowMentions === 0,
      `runbookExists=${runbookExists} scaffoldExists=${scaffoldExists} cleanupMentions=${cleanupMentions} workflowMentions=${workflowMentions}`,
    );
  }

  // 7) SUBPROCESS SWEEPS — every Phase 26 unit harness plus every prior-phase
  // gate + the CI-wired golden-image gate. Skip (explicit false check) any
  // script that does not exist rather than letting npx produce an opaque
  // error.
  async function checkEveryPhase26UnitHarnessStillPasses(): Promise<void> {
    const scripts = [
      "scripts/verify-webp-text-edge.ts",
      "scripts/test-drawblocks-font-state.ts",
      "scripts/test-logo-overlay-contrast.ts",
      "scripts/reconcile-openrouter-costs.ts",
    ];
    for (const script of scripts) {
      if (!exists(script)) {
        check(`[svc-cross-plan] EVERY PHASE 26 UNIT HARNESS STILL PASSES: ${script} exits 0`, false, "missing");
        continue;
      }
      const run = spawnSync("npx", ["tsx", script], { encoding: "utf8", shell: process.platform === "win32" });
      const lastLine =
        (run.stdout || "").trim().split("\n").filter(Boolean).pop() ||
        (run.stderr || "").trim().split("\n").filter(Boolean).pop() ||
        "";
      check(
        `[svc-cross-plan] EVERY PHASE 26 UNIT HARNESS STILL PASSES: ${script} exits 0`,
        run.status === 0,
        run.status !== 0 ? lastLine : "",
      );
    }
  }
  if (tagActive("svc-cross-plan")) await checkEveryPhase26UnitHarnessStillPasses();

  async function checkZeroRegression(): Promise<void> {
    const scripts = [
      "scripts/verify-phase-21.ts",
      "scripts/verify-phase-21.1.ts",
      "scripts/verify-phase-22.ts",
      "scripts/verify-phase-23.ts",
      "scripts/verify-phase-24.ts",
      "scripts/verify-phase-25.ts",
      "scripts/verify-golden-image.ts",
      "scripts/verify-phase-12.6.ts",
      "scripts/test-typography-treatment.ts",
    ];
    for (const script of scripts) {
      if (!exists(script)) {
        check(`[svc-cross-plan] ZERO REGRESSION: no prior-phase harness or CI gate regressed: ${script} exits 0`, false, "missing");
        continue;
      }
      const run = spawnSync("npx", ["tsx", script], { encoding: "utf8", shell: process.platform === "win32" });
      const lastLine =
        (run.stdout || "").trim().split("\n").filter(Boolean).pop() ||
        (run.stderr || "").trim().split("\n").filter(Boolean).pop() ||
        "";
      check(
        `[svc-cross-plan] ZERO REGRESSION: no prior-phase harness or CI gate regressed: ${script} exits 0`,
        run.status === 0,
        run.status !== 0 ? lastLine : "",
      );
    }
  }
  if (tagActive("svc-cross-plan")) await checkZeroRegression();

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

// ── MANUAL/LIVE VERIFICATION RUNBOOK (not automated — requires the live Coolify host, the live Supabase project, and real paid OpenRouter generations) ──
// Everything above this line is statically/functionally provable from this
// sandbox and is green (9 tags, 60 checks, zero weakened). These seven steps
// are NOT — each requires the real Coolify production host, the live
// Supabase project, real uploaded brand logos, or real paid OpenRouter
// generations, none of which this environment can reach. This is the single
// authoritative source for Phase 26 (and v1.6 milestone) operator sign-off;
// do not duplicate its content elsewhere — reference it instead. Run once
// before closing Phase 26 and record the outcome in 26-10-SUMMARY.md.
//
// BEFORE STEP 1: apply BOTH Phase 26 migrations to the live Supabase project —
// supabase/migrations/20260730000000_post_versions_idempotency_key.sql
// (post_versions gains idempotency_key + a partial unique index) and
// supabase/migrations/20260730000001_posts_feedback.sql (posts gains
// feedback + a CHECK constraint). Steps 1, 2, 5 and 6 are meaningless against
// a database missing post_versions.idempotency_key or posts.feedback, and
// step 2's edit request will fail outright without the first one.
//
// ALSO NOTE (client-compatibility warning): idempotency_key is now a
// REQUIRED z.string().uuid() field on BOTH POST /api/generate and
// POST /api/edit-post request bodies (shared/schema.ts's generateRequestSchema
// / editPostRequestSchema). Any external/manual caller (curl, Postman, a
// third-party integration) that does not send one now gets a 400 — confirm
// there are no such external consumers before rollout.
//
// 1) LIVE IDEMPOTENCY — GENERATE (POL-06). Fire two identical
//    POST /api/generate requests with the SAME idempotency_key (the second
//    AFTER the first completes). Expect the second response to be HTTP 200
//    with { "idempotent": true, "post": { ... } } and NO SSE stream at all
//    (generate.routes.ts's pre-flight returns plain JSON before initSSE()
//    runs). Then:
//      select count(*) from posts where idempotency_key = '<key>';
//    Expect exactly 1.
//      select count(*) from usage_events where post_id = '<post id>';
//    Expect exactly 1. A second post row or a second usage event means the
//    pre-flight is running AFTER the credit gate, not before it.
//
// 2) LIVE IDEMPOTENCY — EDIT (POL-06). Same with POST /api/edit-post on an
//    existing post, same idempotency_key repeated. Expect
//    { "idempotent": true, "version": { ... } }. Then:
//      select count(*) from post_versions where idempotency_key = '<key>';
//    Expect exactly 1. Also confirm version_number did NOT advance between
//    the first and second call. Note explicitly: a TRUE concurrent race (two
//    simultaneous in-flight requests, not a sequential resubmit) still
//    surfaces as a generic 500 — this matches the shipped carousel/enhance
//    contract verbatim (26-CONTEXT.md's locked decision) and is intentional,
//    NOT a regression to report.
//
// 3) ADAPTIVE LOGO — JPEG, NO ALPHA (POL-03). Upload a JPEG logo with a solid
//    non-white background to a brand, then generate a post with
//    use_logo: true and NO logo_position. Visually confirm: no hard opaque
//    rectangle, a soft feathered plate behind the mark
//    (LOGO_PLATE_BLUR_SIGMA=8, LOGO_PLATE_PAD_RATIO=0.18 in
//    image-optimization.service.ts), and the logo placed in the cleanest
//    corner rather than always bottom-right (auto-selection order: prefer
//    !scrimNeeded, then lowest stdev, then declared array order
//    bottom-right/bottom-left/top-right/top-left as the final tie-break).
//    Then repeat with logo_position: "bottom-right" explicitly set over a
//    deliberately busy background and confirm the logo STAYS bottom-right —
//    the contrast treatment (plate on/off) adapts, but an explicit position
//    is NEVER re-scored or overridden.
//
// 4) WEBP QUALITY + TEXT EDGES (POL-02). Generate a post with a 3-block text
//    layout (highlight/support/cta). Download the resulting .webp and
//    confirm at 200% zoom that glyph edges are crisp with no ringing/mosquito
//    artifacts. In the same image confirm the drawBlocks fix (26-03)
//    visually: the headline must be plainly larger than the CTA line — each
//    block now gets its own ctx.font assignment instead of silently
//    inheriting layoutBlocks()'s last-measured font. Reference calibration
//    (scripts/verify-webp-text-edge.ts, WEBP_TEXT_EDGE_MIN_RATIO = 0.996):
//    measured edge-retention ratios on the high-contrast fixture were
//    quality 40 = 0.9934 (below threshold, the deliberate non-vacuity
//    control), quality 85 = 0.9977 (above threshold, the shipped default),
//    quality 95 = 0.9992 — use these as the numeric frame of reference for
//    "crisp," not an improvised judgment call. Then check storage impact is
//    acceptable: compare a few pre- and post-deploy file sizes for
//    similarly-composed images in the Supabase Storage browser — a ~10-20%
//    increase is expected (quality 80 -> 85) and fine.
//
// 5) FEEDBACK ROUND TRIP (POL-09). As a normal user, open a post in the
//    viewer, thumbs-up it, close and reopen the dialog (the up button must
//    render active — post-viewer-dialog.tsx's loadPostPrompt() re-fetches
//    feedback on open), thumbs-down it, then click thumbs-down again to
//    clear. After each step:
//      select feedback from posts where id = '<post id>';
//    Expect 'up', then 'down', then null — in that order. One row throughout,
//    never a second (posts.feedback is a single overwritable column, not an
//    event log).
//
// 6) ADMIN QUALITY DASHBOARD (POL-09). As an admin, open /admin/quality.
//    Confirm the feedback tally matches step 5's votes, the critic card
//    shows real visual_critic outcome counts (cross-check with):
//      select outcome, count(*) from generation_logs where event_kind='visual_critic' group by outcome;
//    and the fallback card matches:
//      select metadata->>'call_class', count(*) from generation_logs where event_kind='model_fallback' group by 1;
//    Switch the window selector to 7 and 90 days and confirm the numbers
//    move. Finally confirm the ACL: as a NON-admin, GET /api/admin/quality
//    returns 403 (requireAdminGuard in server/routes/admin-quality.routes.ts).
//
// 7) NO-REGRESSION SWEEP + POL-08 HANDOFF. Generate one video (the frozen
//    GATE-08 path), one carousel, one product enhancement, and one
//    single-image post; edit one pre-Phase-23 legacy post. Expect all five to
//    succeed unchanged. Then confirm the POL-08 handoff is real but open:
//      select min(created_at) from usage_events where metadata->>'real_cost_usd_micros' is not null;
//    docs/cost-reconciliation-runbook.md exists, its audit-log table is
//    still empty (no rows below the header), and its trigger condition (one
//    full billing period, 30 days, after the date the query above returns)
//    has NOT yet been met. Record in 26-10-SUMMARY.md that POL-08 remains
//    scheduled and Pending by design, and that it does not block the v1.6
//    milestone close — this audit does not gate milestone close per
//    docs/cost-reconciliation-runbook.md's own header.
//
// If any step fails, record it in 26-10-SUMMARY.md and do NOT mark Phase 26
// complete.
