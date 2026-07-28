// scripts/verify-phase-25.ts
// Phase 25 (Narrative Carousels & Aesthetic DNA) static + functional verifier.
// Run: npx tsx scripts/verify-phase-25.ts
// Supports a --only=<substring> filter for fast per-task feedback, e.g.:
//   npx tsx scripts/verify-phase-25.ts --only=self-test
//
// Ownership: this harness is created by plan 25-01 — the Wave 0 Nyquist
// requirement (nothing in Phase 25 can be verified until this file exists) —
// and was extended by plan 25-14, which added an 8th tag, [svc-cross-plan],
// for invariants that span files no single plan owns (mirrors
// scripts/verify-phase-23.ts's [svc-cross-plan] precedent added by 23-11, and
// scripts/verify-phase-24.ts's added by 24-07) plus the trailing authoritative
// live-runbook block comment at the bottom of this file. Plans 25-02..25-13
// were NOT permitted to edit this file — their job was to turn its red checks
// green by writing the code these checks describe. 25-14 is the only plan
// permitted to touch this file after 25-01.
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
// general parser. Copied verbatim from scripts/verify-phase-24.ts.

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

const PHASE_25_TAGS = [
  "self-test",
  "svc-carousel-narrative",
  "svc-carousel-compositor",
  "svc-carousel-textstyle-logo",
  "svc-aesthetic-dna-catalog",
  "svc-color-proportion",
  "svc-style-reference-boards",
  "svc-cross-plan",
];

// ── Load sources ONCE. Most Phase 25 target files already exist (written by
// Phases 21-24) — this harness's job for those is to detect the ABSENCE of
// not-yet-written Phase 25 behavior inside them. A few target files
// (carousel-plan-schema.service.ts, style-art-direction.service.ts,
// style-reference.service.ts, style-references.routes.ts,
// style-reference-boards-card.tsx, post-moods-card.tsx) genuinely do not
// exist yet. readSafe() (not read()) keeps this harness from throwing on any
// of them — a not-yet-created file yields "" instead of an ENOENT. ──
const sharedSchemaPath = "shared/schema.ts";
const carouselGenPath = "server/services/carousel-generation.service.ts";
const carouselPlanSchemaPath = "server/services/carousel-plan-schema.service.ts";
const styleReferencePath = "server/services/style-reference.service.ts";
const styleArtDirectionPath = "server/services/style-art-direction.service.ts";
const promptBuilderPath = "server/services/prompt-builder.service.ts";
const typographyCompositorPath = "server/services/typography-compositor.service.ts";
const geminiServicePath = "server/services/gemini.service.ts";
const generateRoutesPath = "server/routes/generate.routes.ts";
const carouselRoutesPath = "server/routes/carousel.routes.ts";
const styleReferencesRoutesPath = "server/routes/style-references.routes.ts";
const routesIndexPath = "server/routes/index.ts";
const brandStylesCardPath = "client/src/components/admin/post-creation/brand-styles-card.tsx";
const postMoodsCardPath = "client/src/components/admin/post-creation/post-moods-card.tsx";
const styleReferenceBoardsCardPath = "client/src/components/admin/post-creation/style-reference-boards-card.tsx";

const sharedSchemaSrc = readSafe(sharedSchemaPath);
const carouselGenSrc = readSafe(carouselGenPath);
const carouselPlanSchemaSrc = readSafe(carouselPlanSchemaPath);
const styleReferenceSrc = readSafe(styleReferencePath);
const styleArtDirectionSrc = readSafe(styleArtDirectionPath);
const promptBuilderSrc = readSafe(promptBuilderPath);
const typographyCompositorSrc = readSafe(typographyCompositorPath);
const geminiServiceSrc = readSafe(geminiServicePath);
const generateRoutesSrc = readSafe(generateRoutesPath);
const carouselRoutesSrc = readSafe(carouselRoutesPath);
const styleReferencesRoutesSrc = readSafe(styleReferencesRoutesPath);
const routesIndexSrc = readSafe(routesIndexPath);
const brandStylesCardSrc = readSafe(brandStylesCardPath);
const postMoodsCardSrc = readSafe(postMoodsCardPath);
const styleReferenceBoardsCardSrc = readSafe(styleReferenceBoardsCardPath);
// brandStylesCardSrc / postMoodsCardSrc / styleReferenceBoardsCardSrc are
// loaded for structural parity with the full Phase 25 target-file set (a
// later plan wires the admin art-direction/reference-board editors into these
// three files). No check in Wave 0 asserts on them directly — referencing
// them here documents the intent without a silent "declared but never read"
// trap for a future editor (mirrors verify-phase-24.ts's void-referenced
// admin-file precedent).
void brandStylesCardSrc;
void postMoodsCardSrc;
void styleReferenceBoardsCardSrc;

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  // [self-test] — proves THIS harness is not vacuous (5 checks)
  // ══════════════════════════════════════════════════════════════════════
  check("[self-test] harness executes", true);

  {
    const selfSrc = read("scripts/verify-phase-25.ts");
    check(
      "[self-test] harness source contains all 8 Phase 25 tag literals",
      PHASE_25_TAGS.every((t) => selfSrc.includes(`[${t}]`)),
    );
    // Checks 3 & 4 assert this harness is WIRED to eventually invoke the two
    // Wave 0 unit harnesses plans 25-03/25-04 create — NOT that those files
    // already exist on disk today. Asserting raw exists() here would make
    // --only=self-test legitimately red until 25-03/25-04 land, contradicting
    // this plan's own must_haves.truths ("self-test exits 0") and the Phase
    // 22/23/24 precedent that [self-test] only proves the CURRENT plan's own
    // deliverables, never a future plan's.
    check(
      "[self-test] harness is wired to invoke the Wave 0 unit harness scripts/test-carousel-narrative-plan.ts (created by 25-03)",
      selfSrc.includes("scripts/test-carousel-narrative-plan.ts"),
    );
    check(
      "[self-test] harness is wired to invoke the Wave 0 unit harness scripts/test-style-reference-merge.ts (created by 25-04)",
      selfSrc.includes("scripts/test-style-reference-merge.ts"),
    );
  }

  check(
    "[self-test] scanner is not vacuous — a deliberately absent sentinel is correctly reported ABSENT from shared/schema.ts",
    !sharedSchemaSrc.includes("__PHASE_25_ABSENT_SENTINEL__"),
  );

  // ══════════════════════════════════════════════════════════════════════
  // [svc-carousel-narrative] (CRSL2-01) — deterministic role assignment +
  // per-slide composition variation, dual-dialect plan schema
  // ══════════════════════════════════════════════════════════════════════
  check(
    "[svc-carousel-narrative] server/services/carousel-plan-schema.service.ts exists",
    exists(carouselPlanSchemaPath),
  );

  check(
    "[svc-carousel-narrative] carousel-plan-schema.service.ts exports SLIDE_ROLES containing hook/content/cta",
    /export const SLIDE_ROLES/.test(carouselPlanSchemaSrc) &&
      ["hook", "content", "cta"].every((r) => carouselPlanSchemaSrc.includes(`"${r}"`)),
    `expected 'export const SLIDE_ROLES' with "hook"/"content"/"cta" literals in ${carouselPlanSchemaPath}`,
  );

  check(
    "[svc-carousel-narrative] carousel-plan-schema.service.ts declares CAROUSEL_PLAN_JSON_SCHEMA (OpenRouter dialect) AND CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA (direct dialect) as two DISTINCT const declarations",
    /export const CAROUSEL_PLAN_JSON_SCHEMA/.test(carouselPlanSchemaSrc) &&
      /export const CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA/.test(carouselPlanSchemaSrc),
    `expected both 'export const CAROUSEL_PLAN_JSON_SCHEMA' and 'export const CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA' in ${carouselPlanSchemaPath}`,
  );

  {
    const openRouterBody = extractConstObjectLiteral(carouselPlanSchemaSrc, "export const CAROUSEL_PLAN_JSON_SCHEMA");
    const geminiBody = extractConstObjectLiteral(
      carouselPlanSchemaSrc,
      "export const CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA",
    );
    check(
      "[svc-carousel-narrative] DIALECT NON-CROSS-WIRING: the OpenRouter schema body contains strict: true AND additionalProperties: false; the Gemini schema body contains uppercase OBJECT/STRING Type literals and contains NEITHER additionalProperties NOR strict:",
      openRouterBody.includes("strict: true") &&
        openRouterBody.includes("additionalProperties: false") &&
        geminiBody.includes('"OBJECT"') &&
        geminiBody.includes('"STRING"') &&
        !geminiBody.includes("additionalProperties") &&
        !geminiBody.includes("strict:"),
      `expected OpenRouter dialect body to carry strict:true/additionalProperties:false and Gemini dialect body to carry "OBJECT"/"STRING" with neither strict: nor additionalProperties in ${carouselPlanSchemaPath}`,
    );
  }

  check(
    "[svc-carousel-narrative] carousel-plan-schema.service.ts exports assignSlideRoles, findDuplicateCompositionNotes, validateCarouselWirePlan",
    ["assignSlideRoles", "findDuplicateCompositionNotes", "validateCarouselWirePlan"].every(
      (fn) => new RegExp(`export (function|const) ${fn}\\b`).test(carouselPlanSchemaSrc),
    ),
    `expected exported assignSlideRoles/findDuplicateCompositionNotes/validateCarouselWirePlan in ${carouselPlanSchemaPath}`,
  );

  {
    const carouselTextPlanBody = extractInterfaceBody(carouselGenSrc, "CarouselTextPlan");
    check(
      "[svc-carousel-narrative] carousel-generation.service.ts's CarouselTextPlan interface body contains layout_archetype_id, composition_note, text_blocks, role",
      ["layout_archetype_id", "composition_note", "text_blocks", "role"].every((f) =>
        carouselTextPlanBody.includes(f),
      ),
      `expected CarouselTextPlan interface body in ${carouselGenPath} to declare layout_archetype_id/composition_note/text_blocks/role`,
    );
  }

  check(
    // NOTE: the real module file is carousel-plan-schema.SERVICE.ts (see
    // carouselPlanSchemaPath above) — this check originally required the
    // shorthand './carousel-plan-schema.js' specifier, which can never resolve
    // to that file and would break `npm run check`/`npm run build` if actually
    // used. Corrected to match the same '.service.js' convention this file's
    // own sibling checks already use for image-crop.service.js/
    // typography-compositor.service.js (25-10 fix).
    "[svc-carousel-narrative] carousel-generation.service.ts imports from ./carousel-plan-schema.service.js",
    /from\s+["']\.\/carousel-plan-schema\.service\.js["']/.test(carouselGenSrc),
    `expected an import from './carousel-plan-schema.service.js' in ${carouselGenPath}`,
  );

  check(
    "[svc-carousel-narrative] carousel-generation.service.ts calls assignSlideRoles( — server-side deterministic role assignment, model output overwritten",
    carouselGenSrc.includes("assignSlideRoles("),
    `expected a call to assignSlideRoles( in ${carouselGenPath}`,
  );

  if (tagActive("svc-carousel-narrative")) {
    const run = spawnSync("npx", ["tsx", "scripts/test-carousel-narrative-plan.ts"], {
      encoding: "utf8",
      shell: true,
    });
    check(
      "[svc-carousel-narrative] FUNCTIONAL: scripts/test-carousel-narrative-plan.ts exits 0 (no-network unit harness for deterministic role assignment + composition-note variation, created by 25-03)",
      run.status === 0,
      run.status !== 0 ? (run.stderr || run.stdout || "").slice(-800) : "",
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // [svc-carousel-compositor] (CRSL2-02) — deterministic per-slide compositor
  // pipeline wiring + carousel-level layout archetype consistency
  // ══════════════════════════════════════════════════════════════════════
  check(
    "[svc-carousel-compositor] carousel-generation.service.ts imports cropToExactAspectRatio from ./image-crop.service.js",
    /cropToExactAspectRatio/.test(carouselGenSrc) && /from\s+["']\.\/image-crop\.service\.js["']/.test(carouselGenSrc),
    `expected an import of cropToExactAspectRatio from './image-crop.service.js' in ${carouselGenPath}`,
  );

  check(
    "[svc-carousel-compositor] carousel-generation.service.ts imports resolveTextBlocks and compositeTypography from ./typography-compositor.service.js",
    /resolveTextBlocks/.test(carouselGenSrc) &&
      /compositeTypography/.test(carouselGenSrc) &&
      /from\s+["']\.\/typography-compositor\.service\.js["']/.test(carouselGenSrc),
    `expected imports of resolveTextBlocks and compositeTypography from './typography-compositor.service.js' in ${carouselGenPath}`,
  );

  {
    const cropIdx = carouselGenSrc.indexOf("cropToExactAspectRatio(");
    const typoIdx = carouselGenSrc.indexOf("compositeTypography(");
    const logoIdx = carouselGenSrc.indexOf("applyLogoOverlay(");
    const uploadIdx = carouselGenSrc.indexOf("uploadSlideBuffer(");
    check(
      "[svc-carousel-compositor] PIPELINE ORDER: cropToExactAspectRatio -> compositeTypography -> applyLogoOverlay -> uploadSlideBuffer in strictly increasing source order (mirrors verify-phase-23.ts's pipeline-order check)",
      cropIdx > -1 && typoIdx > cropIdx && logoIdx > typoIdx && uploadIdx > logoIdx,
      `expected cropToExactAspectRatio( < compositeTypography( < applyLogoOverlay( < uploadSlideBuffer( by source position in ${carouselGenPath}`,
    );
  }

  {
    const anchorIdx = carouselGenSrc.indexOf("slide1Base64 = result.rawBase64");
    const firstCropIdx = carouselGenSrc.indexOf("cropToExactAspectRatio(");
    check(
      "[svc-carousel-compositor] SLIDE-1 ANCHOR DISCIPLINE: `slide1Base64 = result.rawBase64` appears BEFORE the first cropToExactAspectRatio( occurrence (the anchor is captured from the raw AI buffer)",
      anchorIdx > -1 && firstCropIdx > -1 && anchorIdx < firstCropIdx,
      `expected 'slide1Base64 = result.rawBase64' to appear before the first cropToExactAspectRatio( call in ${carouselGenPath}`,
    );
  }

  {
    const slideRowsMatch = /const slideRows = successfulSlides\.map\(\(s\) => \(\{([\s\S]*?)\}\)\)/.exec(
      carouselGenSrc,
    );
    const slideRowsBody = slideRowsMatch ? slideRowsMatch[1] : "";
    check(
      "[svc-carousel-compositor] carousel-generation.service.ts's slideRows insert object contains base_image_url and typography_meta",
      slideRowsBody.includes("base_image_url") && slideRowsBody.includes("typography_meta"),
      `expected the slideRows insert object literal in ${carouselGenPath} to carry base_image_url and typography_meta`,
    );
  }

  {
    const compositeWindow = windowAround(carouselGenSrc, "compositeTypography(", 400);
    check(
      "[svc-carousel-compositor] layout_archetype_id is read from the CAROUSEL-level plan field, not a per-slide field, at the compositeTypography( call site",
      compositeWindow.includes("plan.layout_archetype_id") && !compositeWindow.includes("slides[i].layout_archetype_id"),
      `expected the 400 chars around compositeTypography( in ${carouselGenPath} to reference plan.layout_archetype_id and NOT slides[i].layout_archetype_id`,
    );
  }

  {
    const postSlideSchemaBody = extractZodObjectBody(sharedSchemaSrc, "postSlideSchema");
    check(
      "[svc-carousel-compositor] shared/schema.ts's postSlideSchema body contains base_image_url and typography_meta",
      postSlideSchemaBody.includes("base_image_url") && postSlideSchemaBody.includes("typography_meta"),
      `expected postSlideSchema in ${sharedSchemaPath} to declare base_image_url and typography_meta`,
    );
  }

  check(
    "[svc-carousel-compositor] server/routes/carousel.routes.ts slide-edit path exports resolveSlideEditTarget (typography-aware edit, CRSL2-02 no-double-render)",
    /export (function|const) resolveSlideEditTarget\b/.test(carouselRoutesSrc),
    `expected an exported resolveSlideEditTarget in ${carouselRoutesPath}`,
  );

  // ══════════════════════════════════════════════════════════════════════
  // [svc-carousel-textstyle-logo] (CRSL2-04) — textStyleIds actually consumed;
  // logo overlay regression guard; generation_params persisted
  // ══════════════════════════════════════════════════════════════════════
  check(
    "[svc-carousel-textstyle-logo] typography-compositor.service.ts exports resolveTypographyTreatment",
    /export (function|const) resolveTypographyTreatment\b/.test(typographyCompositorSrc),
    `expected an exported resolveTypographyTreatment in ${typographyCompositorPath}`,
  );

  {
    const compositeParamsBody = extractFunctionParamsObjectType(typographyCompositorSrc, "compositeTypography");
    check(
      "[svc-carousel-textstyle-logo] compositeTypography's param object type contains treatment?:",
      compositeParamsBody.includes("treatment?:"),
      `expected compositeTypography's params object type in ${typographyCompositorPath} to declare treatment?:`,
    );
  }

  {
    const fontAliasesBody = extractConstObjectLiteral(typographyCompositorSrc, "export const FONT_ALIASES");
    const entryCount = (fontAliasesBody.match(/^\s*\w+:/gm) ?? []).length;
    const fontPathLiterals = fontAliasesBody.match(/["'][^"']*\.(ttf|otf)["']/g) ?? [];
    const allInsideAssetsFonts = fontPathLiterals.every((lit) => lit.includes("server/assets/fonts"));
    check(
      "[svc-carousel-textstyle-logo] typography-compositor.service.ts still registers ONLY the bundled Inter aliases (FONT_ALIASES has exactly 3 entries, no new bundled font this phase)",
      entryCount === 3 && (fontPathLiterals.length === 0 || allInsideAssetsFonts),
      `expected FONT_ALIASES in ${typographyCompositorPath} to declare exactly 3 entries (found ${entryCount}) with no .ttf/.otf literal outside server/assets/fonts`,
    );
  }

  check(
    "[svc-carousel-textstyle-logo] carousel-generation.service.ts calls resolveTypographyTreatment(",
    carouselGenSrc.includes("resolveTypographyTreatment("),
    `expected a call to resolveTypographyTreatment( in ${carouselGenPath}`,
  );

  {
    const textStyleIdsWindow = windowAround(carouselGenSrc, "params.textStyleIds", 800);
    check(
      "[svc-carousel-textstyle-logo] carousel-generation.service.ts resolves params.textStyleIds against styleCatalog.text_styles (both appear in the same 800-char window)",
      textStyleIdsWindow.includes("text_styles"),
      `expected 'text_styles' within 800 chars of 'params.textStyleIds' in ${carouselGenPath}`,
    );
  }

  check(
    "[svc-carousel-textstyle-logo] carousel-generation.service.ts still calls applyLogoOverlay( exactly once in the slide loop (logo regression guard)",
    (carouselGenSrc.match(/applyLogoOverlay\(/g) ?? []).length === 1,
    `expected exactly one applyLogoOverlay( call site in ${carouselGenPath}`,
  );

  {
    const postsInsertMatch = /\.from\(["']posts["']\)\s*\.insert\(\{([\s\S]*?)\}\)/.exec(carouselGenSrc);
    const postsInsertBody = postsInsertMatch ? postsInsertMatch[1] : "";
    check(
      "[svc-carousel-textstyle-logo] carousel-generation.service.ts's posts insert object contains generation_params (so slide edit/remake can reuse aspect_ratio/use_logo/logo_position/text_style_ids)",
      postsInsertBody.includes("generation_params"),
      `expected the posts insert object literal in ${carouselGenPath} to carry generation_params`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // [svc-aesthetic-dna-catalog] (PLAN-05) — dense art direction on the style
  // catalog, populated for every existing entry
  // ══════════════════════════════════════════════════════════════════════
  {
    const artDirectionSchemaBody = extractZodObjectBody(sharedSchemaSrc, "artDirectionSchema");
    check(
      "[svc-aesthetic-dna-catalog] shared/schema.ts declares artDirectionSchema with photography_type, lighting, composition, texture, negative_prompts",
      ["photography_type", "lighting", "composition", "texture", "negative_prompts"].every((f) =>
        artDirectionSchemaBody.includes(f),
      ),
      `expected 'export const artDirectionSchema = z.object({...})' in ${sharedSchemaPath} declaring photography_type/lighting/composition/texture/negative_prompts`,
    );
  }

  {
    const brandStyleSchemaBody = extractZodObjectBody(sharedSchemaSrc, "brandStyleSchema");
    check(
      "[svc-aesthetic-dna-catalog] brandStyleSchema body contains art_direction",
      brandStyleSchemaBody.includes("art_direction"),
      `expected brandStyleSchema in ${sharedSchemaPath} to declare art_direction`,
    );
  }

  {
    const postMoodSchemaBody = extractZodObjectBody(sharedSchemaSrc, "postMoodSchema");
    check(
      "[svc-aesthetic-dna-catalog] postMoodSchema body contains art_direction",
      postMoodSchemaBody.includes("art_direction"),
      `expected postMoodSchema in ${sharedSchemaPath} to declare art_direction`,
    );
  }

  check(
    "[svc-aesthetic-dna-catalog] server/services/style-art-direction.service.ts exists and exports buildStyleArtDirectionBlock and GLOBAL_ANTI_AI_NEGATIVE_PROMPT",
    exists(styleArtDirectionPath) &&
      /export (function|const) buildStyleArtDirectionBlock\b/.test(styleArtDirectionSrc) &&
      /export const GLOBAL_ANTI_AI_NEGATIVE_PROMPT\b/.test(styleArtDirectionSrc),
    `expected ${styleArtDirectionPath} to exist and export buildStyleArtDirectionBlock + GLOBAL_ANTI_AI_NEGATIVE_PROMPT`,
  );

  async function checkAestheticDnaCatalogFunctional(): Promise<void> {
    const names = {
      stylesDense:
        "[svc-aesthetic-dna-catalog] FUNCTIONAL: every DEFAULT_STYLE_CATALOG.styles entry has non-empty art_direction.photography_type/.lighting/.composition/.texture and negative_prompts.length >= 2",
      moodsDense:
        "[svc-aesthetic-dna-catalog] FUNCTIONAL: every DEFAULT_STYLE_CATALOG.post_moods entry has non-empty art_direction.photography_type/.lighting/.composition/.texture and negative_prompts.length >= 2",
      nonDuplication:
        "[svc-aesthetic-dna-catalog] FUNCTIONAL NON-DUPLICATION: across all styles, photography_type values are all distinct, and no entry's photography_type is byte-equal to its own description",
    };
    const prevNodeEnv = process.env.NODE_ENV;
    if (prevNodeEnv === "production") process.env.NODE_ENV = "test";
    try {
      const mod: any = await import("../shared/schema.js");
      const catalog = mod.DEFAULT_STYLE_CATALOG;
      const styles: any[] = catalog?.styles ?? [];
      const moods: any[] = catalog?.post_moods ?? [];

      function isDense(entry: any): boolean {
        const ad = entry?.art_direction;
        if (!ad) return false;
        const fieldsOk =
          typeof ad.photography_type === "string" &&
          ad.photography_type.length > 0 &&
          typeof ad.lighting === "string" &&
          ad.lighting.length > 0 &&
          typeof ad.composition === "string" &&
          ad.composition.length > 0 &&
          typeof ad.texture === "string" &&
          ad.texture.length > 0;
        const negOk = Array.isArray(ad.negative_prompts) && ad.negative_prompts.length >= 2;
        return fieldsOk && negOk;
      }

      const stylesDense = styles.length > 0 && styles.every(isDense);
      check(names.stylesDense, stylesDense, stylesDense ? "" : `styles.length=${styles.length}`);

      const moodsDense = moods.length > 0 && moods.every(isDense);
      check(names.moodsDense, moodsDense, moodsDense ? "" : `post_moods.length=${moods.length}`);

      const photographyTypes = styles.map((s) => s?.art_direction?.photography_type).filter(Boolean);
      const distinctCount = new Set(photographyTypes).size;
      const noSelfDuplicate = styles.every(
        (s) => !s?.art_direction?.photography_type || s.art_direction.photography_type !== s?.description,
      );
      const nonDuplicationOk =
        styles.length > 0 && distinctCount === photographyTypes.length && photographyTypes.length === styles.length && noSelfDuplicate;
      check(
        names.nonDuplication,
        nonDuplicationOk,
        nonDuplicationOk
          ? ""
          : `styles.length=${styles.length} distinctPhotographyTypes=${distinctCount} noSelfDuplicate=${noSelfDuplicate}`,
      );
    } catch (err) {
      const detail = String((err as Error)?.message ?? err);
      for (const name of Object.values(names)) check(name, false, detail);
    } finally {
      if (prevNodeEnv === "production") process.env.NODE_ENV = prevNodeEnv;
    }
  }
  if (tagActive("svc-aesthetic-dna-catalog")) await checkAestheticDnaCatalogFunctional();

  // ══════════════════════════════════════════════════════════════════════
  // [svc-color-proportion] (PLAN-06) — 60-30-10 named-color usage, explicit
  // color_4 reference, graceful null degradation
  // ══════════════════════════════════════════════════════════════════════
  check(
    "[svc-color-proportion] prompt-builder.service.ts exports formatBrandColorsProportional",
    /export (function|const) formatBrandColorsProportional\b/.test(promptBuilderSrc),
    `expected an exported formatBrandColorsProportional in ${promptBuilderPath}`,
  );

  async function checkColorProportionFunctional(): Promise<void> {
    const names = {
      proportional:
        '[svc-color-proportion] FUNCTIONAL: formatBrandColorsProportional({color_1,color_2,color_3,color_4}) returns a string containing "60", "30", "10", and all three hex codes',
      accentIsColor4:
        "[svc-color-proportion] FUNCTIONAL: the returned string does NOT contain color_3's hex in the 10% accent clause — color_4 is the accent, not color_3",
      gracefulDegradation:
        '[svc-color-proportion] FUNCTIONAL graceful degradation: with color_3/color_4 null, still returns a non-empty string mentioning "60" and "30" and never the literal "null"/"undefined"',
    };
    const prevNodeEnv = process.env.NODE_ENV;
    if (prevNodeEnv === "production") process.env.NODE_ENV = "test";
    try {
      const pb: any = await import("../server/services/prompt-builder.service.js");
      const fn = pb.formatBrandColorsProportional;

      const full = fn({
        color_1: "#0A2540",
        color_2: "#F5F7FA",
        color_3: "#8892A0",
        color_4: "#FF6B35",
      });
      const fullStr = String(full ?? "");
      const proportionalOk =
        fullStr.includes("60") &&
        fullStr.includes("30") &&
        fullStr.includes("10") &&
        fullStr.includes("#0A2540") &&
        fullStr.includes("#F5F7FA") &&
        fullStr.includes("#FF6B35");
      check(names.proportional, proportionalOk, proportionalOk ? "" : `returned: ${fullStr.slice(0, 300)}`);

      // color_3 must not appear inside the 10% accent clause — approximate by
      // checking it doesn't appear at all near a "10%" mention alongside it,
      // since color_4 (not color_3) is the accent.
      const tenPctIdx = fullStr.indexOf("10");
      const accentWindow = tenPctIdx > -1 ? fullStr.slice(Math.max(0, tenPctIdx - 60), tenPctIdx + 60) : "";
      const accentOk = !accentWindow.includes("#8892A0");
      check(names.accentIsColor4, accentOk, accentOk ? "" : `10% window: ${accentWindow}`);

      const degraded = fn({ color_1: "#0A2540", color_2: "#F5F7FA", color_3: null, color_4: null });
      const degradedStr = String(degraded ?? "");
      const degradedOk =
        degradedStr.length > 0 &&
        degradedStr.includes("60") &&
        degradedStr.includes("30") &&
        !degradedStr.includes("null") &&
        !degradedStr.includes("undefined");
      check(names.gracefulDegradation, degradedOk, degradedOk ? "" : `returned: ${degradedStr.slice(0, 300)}`);
    } catch (err) {
      const detail = String((err as Error)?.message ?? err);
      for (const name of Object.values(names)) check(name, false, detail);
    } finally {
      if (prevNodeEnv === "production") process.env.NODE_ENV = prevNodeEnv;
    }
  }
  if (tagActive("svc-color-proportion")) await checkColorProportionFunctional();

  check(
    "[svc-color-proportion] gemini.service.ts's buildContextPrompt calls formatBrandColorsProportional(",
    // Radius widened 4000 -> 16000 (25-09): buildContextPrompt's real body (marker
    // to `return contextPrompt;`) is ~13.7K chars post-Phase-22/23/24 growth (video
    // branch + image branch both live inside one function) — the original 4000
    // radius couldn't reach either image-branch call site even when correctly wired.
    windowAround(geminiServiceSrc, "buildContextPrompt(params: GenerateParams)", 16000).includes(
      "formatBrandColorsProportional(",
    ),
    `expected buildContextPrompt in ${geminiServicePath} to call formatBrandColorsProportional(`,
  );

  check(
    "[svc-color-proportion] carousel-generation.service.ts's buildCarouselMasterPrompt calls formatBrandColorsProportional(",
    windowAround(carouselGenSrc, "buildCarouselMasterPrompt", 4000).includes("formatBrandColorsProportional("),
    `expected buildCarouselMasterPrompt in ${carouselGenPath} to call formatBrandColorsProportional(`,
  );

  // ══════════════════════════════════════════════════════════════════════
  // [svc-style-reference-boards] (PLAN-07) — admin-curated platform-wide
  // style reference boards, inverted-ACL RLS, shared priority-merge logic
  // ══════════════════════════════════════════════════════════════════════
  const styleRefMigrationFile = findMigrationFile("_style_reference_photos.sql");
  const styleRefMigrationSrc = styleRefMigrationFile ? readSafe(styleRefMigrationFile) : "";

  check(
    "[svc-style-reference-boards] a migration file matching supabase/migrations/*_style_reference_photos.sql exists",
    styleRefMigrationFile !== null,
    "expected a file in supabase/migrations/ ending with '_style_reference_photos.sql'",
  );

  check(
    "[svc-style-reference-boards] that migration contains CREATE TABLE IF NOT EXISTS public.style_reference_photos",
    styleRefMigrationSrc.includes("CREATE TABLE IF NOT EXISTS public.style_reference_photos"),
    "expected 'CREATE TABLE IF NOT EXISTS public.style_reference_photos' in the style_reference_photos migration",
  );

  check(
    "[svc-style-reference-boards] RLS INVERTED-ACL: contains FOR SELECT USING (true) AND profiles.is_admin = true, and does NOT contain user_id = auth.uid() (must not copy brand_reference_photos' owner-only pattern)",
    styleRefMigrationSrc.includes("FOR SELECT USING (true)") &&
      styleRefMigrationSrc.includes("profiles.is_admin = true") &&
      !styleRefMigrationSrc.includes("user_id = auth.uid()"),
    "expected the style_reference_photos migration to grant public SELECT + admin-only write, with no user_id = auth.uid() owner-only clause",
  );

  check(
    "[svc-style-reference-boards] migration contains ENABLE ROW LEVEL SECURITY",
    styleRefMigrationSrc.includes("ENABLE ROW LEVEL SECURITY"),
    "expected 'ENABLE ROW LEVEL SECURITY' in the style_reference_photos migration",
  );

  check(
    "[svc-style-reference-boards] shared/schema.ts declares styleReferencePhotoSchema",
    /export const styleReferencePhotoSchema/.test(sharedSchemaSrc),
    `expected 'export const styleReferencePhotoSchema' in ${sharedSchemaPath}`,
  );

  check(
    "[svc-style-reference-boards] server/services/style-reference.service.ts exists and exports planReferenceImageSlots and REFERENCE_IMAGE_SLOT_LIMIT",
    exists(styleReferencePath) &&
      /export (function|const) planReferenceImageSlots\b/.test(styleReferenceSrc) &&
      /export const REFERENCE_IMAGE_SLOT_LIMIT\b/.test(styleReferenceSrc),
    `expected ${styleReferencePath} to exist and export planReferenceImageSlots + REFERENCE_IMAGE_SLOT_LIMIT`,
  );

  check(
    "[svc-style-reference-boards] server/routes/style-references.routes.ts exists and uses requireAdminGuard",
    exists(styleReferencesRoutesPath) && styleReferencesRoutesSrc.includes("requireAdminGuard"),
    `expected ${styleReferencesRoutesPath} to exist and reference requireAdminGuard`,
  );

  check(
    "[svc-style-reference-boards] server/routes/index.ts imports and router.use(...)s the style-references router",
    /from\s+["'].*style-references\.routes(\.js)?["']/.test(routesIndexSrc) &&
      /router\.use\(\s*styleReferencesRoutes\s*\)/.test(routesIndexSrc),
    `expected ${routesIndexPath} to import the style-references router and call router.use(styleReferencesRoutes)`,
  );

  check(
    "[svc-style-reference-boards] generate.routes.ts calls planReferenceImageSlots( (single-image path uses the shared merge, not the old inline arithmetic)",
    generateRoutesSrc.includes("planReferenceImageSlots("),
    `expected a call to planReferenceImageSlots( in ${generateRoutesPath}`,
  );

  check(
    "[svc-style-reference-boards] carousel-generation.service.ts calls planReferenceImageSlots( (carousel path too — PLAN-07 covers both per 25-CONTEXT.md's resolved question)",
    carouselGenSrc.includes("planReferenceImageSlots("),
    `expected a call to planReferenceImageSlots( in ${carouselGenPath}`,
  );

  if (tagActive("svc-style-reference-boards")) {
    const run = spawnSync("npx", ["tsx", "scripts/test-style-reference-merge.ts"], {
      encoding: "utf8",
      shell: true,
    });
    check(
      "[svc-style-reference-boards] FUNCTIONAL: scripts/test-style-reference-merge.ts exits 0 (no-network unit harness for the reference-image priority-merge arithmetic, created by 25-04)",
      run.status === 0,
      run.status !== 0 ? (run.stderr || run.stdout || "").slice(-800) : "",
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // [svc-cross-plan] (plan 25-14) — invariants spanning files no single plan
  // owns: pipeline parity across BOTH generation paths, archetype singularity
  // (SC1), the closed double-render coverage gap, LEGACY-branch reachability,
  // the single reference-slot-cap declaration, both-path aesthetic DNA (SC4),
  // the frozen GATE-08 video fence, every Phase 25 unit harness, and
  // prior-phase/CI-gate non-regression. Mirrors scripts/verify-phase-23.ts's
  // [svc-cross-plan] precedent (23-11) and scripts/verify-phase-24.ts's
  // (24-07).
  // ══════════════════════════════════════════════════════════════════════

  // 1) PIPELINE PARITY ACROSS BOTH GENERATION PATHS — spans 25-09's
  // generate.routes.ts and 25-12's carousel-generation.service.ts. Neither
  // plan's own check proves BOTH files run the SAME pipeline in the SAME
  // order. One check per file.
  {
    const cropIdx = generateRoutesSrc.indexOf("cropToExactAspectRatio(");
    const typoIdx = generateRoutesSrc.indexOf("compositeTypography(");
    const logoIdx = generateRoutesSrc.indexOf("applyLogoOverlay(");
    // BEWARE the 23-11/24-07 substring-collision class: generate.routes.ts
    // contains an earlier, unrelated processImageWithThumbnail( call inside
    // the video-post-completion branch (uploading a reference-image
    // thumbnail) — search for the optimize marker starting FROM the
    // applyLogoOverlay( index, not from 0, or that earlier call wins.
    const optIdx = logoIdx > -1 ? generateRoutesSrc.indexOf("processImageWithThumbnail(", logoIdx) : -1;
    check(
      "[svc-cross-plan] PIPELINE PARITY ACROSS BOTH GENERATION PATHS: generate.routes.ts runs cropToExactAspectRatio -> compositeTypography -> applyLogoOverlay -> processImageWithThumbnail in strictly increasing source order",
      cropIdx > -1 && typoIdx > cropIdx && logoIdx > typoIdx && optIdx > logoIdx,
      `expected cropToExactAspectRatio( < compositeTypography( < applyLogoOverlay( < processImageWithThumbnail( (searched forward from the logo-overlay index) in ${generateRoutesPath}`,
    );
  }
  {
    const cropIdx = carouselGenSrc.indexOf("cropToExactAspectRatio(");
    const typoIdx = carouselGenSrc.indexOf("compositeTypography(");
    const logoIdx = carouselGenSrc.indexOf("applyLogoOverlay(");
    const uploadIdx = carouselGenSrc.indexOf("uploadSlideBuffer(");
    check(
      "[svc-cross-plan] PIPELINE PARITY ACROSS BOTH GENERATION PATHS: carousel-generation.service.ts runs cropToExactAspectRatio -> compositeTypography -> applyLogoOverlay -> uploadSlideBuffer in strictly increasing source order — the SAME pipeline shape as generate.routes.ts",
      cropIdx > -1 && typoIdx > cropIdx && logoIdx > typoIdx && uploadIdx > logoIdx,
      `expected cropToExactAspectRatio( < compositeTypography( < applyLogoOverlay( < uploadSlideBuffer( in ${carouselGenPath}`,
    );
  }

  // 2) ARCHETYPE SINGULARITY (SC1) — spans 25-03, 25-10, 25-12 and 25-13.
  {
    const carouselWireSlideBody = extractInterfaceBody(carouselPlanSchemaSrc, "CarouselWireSlide");
    const notPerSlideField = carouselWireSlideBody.length > 0 && !carouselWireSlideBody.includes("layout_archetype_id");
    const carouselLevelOnlyInGen =
      carouselGenSrc.includes("plan.layout_archetype_id") &&
      !carouselGenSrc.includes("slides[i].layout_archetype_id") &&
      !carouselGenSrc.includes("slide.layout_archetype_id");
    const editReusesCarouselArchetype = windowAround(carouselRoutesSrc, "compositeTypography(", 400).includes(
      "layoutArchetypeId: carouselArchetype",
    );
    check(
      "[svc-cross-plan] ARCHETYPE SINGULARITY (SC1): CarouselWireSlide carries NO per-slide layout_archetype_id, carousel-generation.service.ts reads ONLY the carousel-level plan.layout_archetype_id (never slides[i]./slide.layout_archetype_id), and carousel.routes.ts's slide-edit re-composite reuses the CAROUSEL's own archetype (not a per-slide guess) — layout archetype is structurally impossible to vary per slide anywhere in the pipeline",
      notPerSlideField && carouselLevelOnlyInGen && editReusesCarouselArchetype,
      `notPerSlideField=${notPerSlideField} carouselLevelOnlyInGen=${carouselLevelOnlyInGen} editReusesCarouselArchetype=${editReusesCarouselArchetype}`,
    );
  }

  // 3) NO-DOUBLE-RENDER CLOSURE (no coverage gap) — spans 25-12 and 25-13.
  // generation-composites-WITHOUT-base-aware-edit is exactly the failure mode
  // this single conjunction catches and neither plan alone can.
  {
    const generationComposites = carouselGenSrc.includes("compositeTypography(");
    const editIsBaseAware = carouselRoutesSrc.includes("resolveSlideEditTarget(") && carouselRoutesSrc.includes("isBaseImage");
    const zeroCrsl10 = !/CRSL-10/.test(carouselRoutesSrc);
    const zeroDoNotUseOnImageText = !/do not use on-image text/i.test(carouselRoutesSrc);
    check(
      "[svc-cross-plan] NO-DOUBLE-RENDER CLOSURE: slides carry composited text AND the slide-edit path is base-image-aware — the Phase-23-class double-render regression 25-CONTEXT.md forbids is structurally closed",
      generationComposites && editIsBaseAware && zeroCrsl10 && zeroDoNotUseOnImageText,
      `generationComposites=${generationComposites} editIsBaseAware=${editIsBaseAware} zeroCrsl10=${zeroCrsl10} zeroDoNotUseOnImageText=${zeroDoNotUseOnImageText}`,
    );
  }

  // 4) LEGACY REACHABILITY — spans 25-02's migration and 25-13's route.
  {
    const migFile = findMigrationFile("_post_slides_base_image_typography.sql");
    const migSrc = migFile ? readSafe(migFile) : "";
    const hasAddColumn = migSrc.includes("ADD COLUMN IF NOT EXISTS base_image_url");
    // NOTE (deviation, same self-referential collision class as 23-09/24-07):
    // the migration's own explanatory comment states "no default and no
    // backfill" — a naive /backfill/i scan flags that negated, correct
    // documentation as if it were a real backfill marker. Count total
    // "backfill" mentions vs. mentions immediately preceded by "no " (the
    // documented-absence phrasing); only a mention NOT part of that negation
    // is a genuine signal that a real backfill step exists.
    const backfillMentions = (migSrc.match(/backfill/gi) ?? []).length;
    const negatedBackfillMentions = (migSrc.match(/no backfill/gi) ?? []).length;
    const noBackfillSignals =
      migSrc.length > 0 &&
      !/NOT NULL/.test(migSrc) &&
      !/DEFAULT /.test(migSrc) &&
      !/UPDATE public\.post_slides/.test(migSrc) &&
      backfillMentions <= negatedBackfillMentions;
    const legacyReachable = carouselRoutesSrc.includes("isBaseImage: false");
    check(
      "[svc-cross-plan] LEGACY REACHABILITY: the post_slides/post_slide_versions migration adds base_image_url with none of NOT NULL/DEFAULT /UPDATE public.post_slides/BACKFILL (a backfilled or non-null column would make the LEGACY branch dead code and silently rewrite pre-Phase-25 slides), and carousel.routes.ts contains a literal isBaseImage: false return proving the LEGACY branch is genuinely reachable",
      migFile !== null && hasAddColumn && noBackfillSignals && legacyReachable,
      `migFile=${migFile} hasAddColumn=${hasAddColumn} noBackfillSignals=${noBackfillSignals} legacyReachable=${legacyReachable}`,
    );
  }

  // 5) REFERENCE-SLOT CAP DECLARED EXACTLY ONCE — spans 25-04, 25-09 and
  // 25-12 (25-RESEARCH.md: "a second, slightly different cap invites drift").
  {
    const hasExportedLimit = /export const REFERENCE_IMAGE_SLOT_LIMIT = 4/.test(styleReferenceSrc);
    const noSlotsRemainingInGenerate = !generateRoutesSrc.includes("slotsRemaining");
    const noSlotsRemainingInCarousel = !carouselGenSrc.includes("slotsRemaining");
    const noOldArithmeticInGenerate = !generateRoutesSrc.includes("4 - userRefImages.length");
    const noOldArithmeticInCarousel = !carouselGenSrc.includes("4 - userRefImages.length");
    check(
      "[svc-cross-plan] REFERENCE-SLOT CAP DECLARED EXACTLY ONCE: style-reference.service.ts exports REFERENCE_IMAGE_SLOT_LIMIT = 4, and neither generate.routes.ts nor carousel-generation.service.ts contains the old slotsRemaining or '4 - userRefImages.length' arithmetic",
      hasExportedLimit &&
        noSlotsRemainingInGenerate &&
        noSlotsRemainingInCarousel &&
        noOldArithmeticInGenerate &&
        noOldArithmeticInCarousel,
      `hasExportedLimit=${hasExportedLimit} noSlotsRemainingInGenerate=${noSlotsRemainingInGenerate} noSlotsRemainingInCarousel=${noSlotsRemainingInCarousel} noOldArithmeticInGenerate=${noOldArithmeticInGenerate} noOldArithmeticInCarousel=${noOldArithmeticInCarousel}`,
    );
  }

  // 6) AESTHETIC DNA REACHES BOTH PATHS (SC4) — spans 25-06, 25-09 and 25-10.
  {
    const geminiHasBoth =
      geminiServiceSrc.includes("buildStyleArtDirectionBlock(") && geminiServiceSrc.includes("formatBrandColorsProportional(");
    const carouselHasBoth =
      carouselGenSrc.includes("buildStyleArtDirectionBlock(") && carouselGenSrc.includes("formatBrandColorsProportional(");
    check(
      "[svc-cross-plan] AESTHETIC DNA REACHES BOTH PATHS (SC4): gemini.service.ts AND carousel-generation.service.ts BOTH call buildStyleArtDirectionBlock( and formatBrandColorsProportional( — carousels are a creator surface too, so a single-image-only injection would satisfy every per-plan check while still failing SC4",
      geminiHasBoth && carouselHasBoth,
      `geminiHasBoth=${geminiHasBoth} carouselHasBoth=${carouselHasBoth}`,
    );
  }

  // 7) GATE-08 VIDEO FENCE STILL HOLDS — spans 25-06 and 25-09.
  {
    const videoHelperSurvived = geminiServiceSrc.includes("formatBrandColorsLabeled(");
    const isVideoNearCall = windowAround(generateRoutesSrc, "resolveGenerationReferenceImages({", 400).includes("isVideo");
    check(
      "[svc-cross-plan] GATE-08 VIDEO FENCE STILL HOLDS: gemini.service.ts still calls formatBrandColorsLabeled( (the frozen video branch's helper survived the image-branch rewrite) and the 400 chars around generate.routes.ts's resolveGenerationReferenceImages({ call contain isVideo — the two new reference tiers are excluded from the frozen video path",
      videoHelperSurvived && isVideoNearCall,
      `videoHelperSurvived=${videoHelperSurvived} isVideoNearCall=${isVideoNearCall}`,
    );
  }

  // 8) EVERY PHASE 25 UNIT HARNESS STILL PASSES — pulls each Phase 25 plan's
  // own no-network harness into the phase gate (a tag's own grep-for-the-
  // export check does not prove the harness itself still exits 0).
  async function checkEveryPhase25UnitHarnessStillPasses(): Promise<void> {
    const scripts = [
      "scripts/test-carousel-narrative-plan.ts",
      "scripts/test-style-reference-merge.ts",
      "scripts/test-typography-treatment.ts",
      "scripts/test-slide-edit-resolution.ts",
    ];
    for (const script of scripts) {
      const run = spawnSync("npx", ["tsx", script], { encoding: "utf8", shell: true });
      const lastLine = (run.stderr || "").trim().split("\n").pop() || (run.stdout || "").trim().split("\n").pop() || "";
      check(
        `[svc-cross-plan] EVERY PHASE 25 UNIT HARNESS STILL PASSES: ${script} exits 0`,
        run.status === 0,
        run.status !== 0 ? lastLine : "",
      );
    }
  }
  if (tagActive("svc-cross-plan")) await checkEveryPhase25UnitHarnessStillPasses();

  // 9) ZERO REGRESSION — spawn every prior-phase harness plus the
  // golden-image CI gate (25-07 edited a Phase 23 file,
  // typography-compositor.service.ts, that the gate renders through).
  async function checkZeroRegression(): Promise<void> {
    const scripts = [
      "scripts/verify-phase-21.ts",
      "scripts/verify-phase-21.1.ts",
      "scripts/verify-phase-22.ts",
      "scripts/verify-phase-23.ts",
      "scripts/verify-phase-24.ts",
      "scripts/verify-golden-image.ts",
    ];
    for (const script of scripts) {
      const run = spawnSync("npx", ["tsx", script], { encoding: "utf8", shell: true });
      const lastLine = (run.stderr || "").trim().split("\n").pop() || (run.stdout || "").trim().split("\n").pop() || "";
      check(
        `[svc-cross-plan] ZERO REGRESSION: no prior-phase harness or CI gate regressed: ${script} exits 0`,
        run.status === 0,
        run.status !== 0 ? lastLine : "",
      );
    }
  }
  if (tagActive("svc-cross-plan")) await checkZeroRegression();

  console.log(`\n=== Phase 25 verify ===`);
  console.log(`PASS: ${ok.length}`);
  ok.forEach((n) => console.log(`  ✓ ${n}`));
  if (failures.length) {
    console.log(`\nFAIL: ${failures.length}`);
    failures.forEach((n) => console.log(`  ✗ ${n}`));
    process.exit(1);
  }
  console.log(`\nAll Phase 25 checks passed.`);
}

/** Extracts a function's params object TYPE ANNOTATION body: from `function NAME(params: {` (or `async function`/arrow) to its balanced closing brace, before the `)`. Local to this harness — Phase 25's compositeTypography(params: {...}) shape mirrors typography-compositor.service.ts's own style. */
function extractFunctionParamsObjectType(src: string, fnName: string): string {
  const m = new RegExp(`(?:export )?(?:async )?function ${fnName}\\s*\\(\\s*params:\\s*\\{`).exec(src);
  if (!m) return "";
  let i = m.index + m[0].length - 1; // at the opening "{"
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

main().catch((err) => {
  console.error("verify-phase-25 harness crashed:", err);
  process.exit(1);
});
