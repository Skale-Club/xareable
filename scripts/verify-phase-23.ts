// scripts/verify-phase-23.ts
// Phase 23 (Deterministic Typography & Edit Fidelity) static + functional verifier.
// Run: npx tsx scripts/verify-phase-23.ts
// Supports a --only=<substring> filter for fast per-task feedback, e.g.:
//   npx tsx scripts/verify-phase-23.ts --only=self-test
//
// Ownership: this harness is created by plan 23-01 and extended ONLY by plan
// 23-11 (which adds the 13th tag, [svc-cross-plan]). Plans 23-02..23-10 must
// NOT edit this file — their job is to turn the original 12 tags' red checks
// green (a couple of self-referential scanner bugs in this file were fixed by
// 23-09/23-10 as documented Rule-3 blocking deviations — see their SUMMARYs).
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
// Only bother running an expensive (dynamic-import) functional check group if
// the --only filter could possibly match one of its check names.
function tagActive(tag: string): boolean {
  return !only || tag.includes(only) || only.includes(tag);
}

// Extracts a class-method body: from the declaration match up to (but not
// including) the next same-indent private/public/protected/async method
// declaration, or end of file. Heuristic — good enough for grepping this
// repo's own TypeScript class-method style, not a general TS parser.
function extractMethodBody(src: string, declRegex: RegExp): string {
  const m = declRegex.exec(src);
  if (!m) return "";
  const rest = src.slice(m.index + m[0].length);
  const next = /\n\s{2}(private|public|protected|async)\s+\w+\s*\(/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

// Extracts the balanced-brace body of `export const NAME = z.object({ ... });`
function extractZodObjectBody(src: string, constName: string): string {
  const marker = `export const ${constName} = z.object({`;
  const idx = src.indexOf(marker);
  if (idx === -1) return "";
  let i = idx + marker.length - 1; // position at the opening "{"
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

// Recursively lists files with the given extensions under a directory.
function walkFiles(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      out.push(...walkFiles(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

// Repo-wide scan for call-site patterns, excluding pure-comment lines and an
// explicit file allowlist. scripts/verify-phase-06.ts legitimately asserts
// these identifiers' ABSENCE via regex/string literals (a verifier asserting
// against another file's source) — it is not itself a real call site.
function scanForCallSites(dirsOrFiles: string[], patterns: string[], allowlist: string[]): string[] {
  const hits: string[] = [];
  const files = dirsOrFiles.flatMap((d) => {
    if (!fs.existsSync(d)) return [];
    return fs.statSync(d).isDirectory() ? walkFiles(d, [".ts", ".tsx"]) : [d];
  });
  for (const file of files) {
    const normalized = file.split(path.sep).join("/");
    if (allowlist.some((a) => normalized.endsWith(a))) continue;
    const lines = readSafe(file).split("\n");
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      for (const p of patterns) {
        if (line.includes(p)) hits.push(`${normalized}:${i + 1}: ${trimmed}`);
      }
    });
  }
  return hits;
}

function findMigrationFile(): string | null {
  const dir = "supabase/migrations";
  if (!fs.existsSync(dir)) return null;
  const match = fs
    .readdirSync(dir)
    .find((f) => /base_image/.test(f) && /typography/.test(f) && f.endsWith(".sql"));
  return match ? path.join(dir, match) : null;
}

// ── Load sources ONCE. Every Phase 23 target file created by a later plan
// does not exist yet at 23-01 execution time — readSafe() (not read()) keeps
// this harness from throwing. ──
const typographyCompositorPath = "server/services/typography-compositor.service.ts";
const imageCropPath = "server/services/image-crop.service.ts";
const geminiPath = "server/services/gemini.service.ts";
const planningSchemaPath = "server/services/planning-schema.service.ts";
const promptBuilderPath = "server/services/prompt-builder.service.ts";
const generateRoutePath = "server/routes/generate.routes.ts";
const editRoutePath = "server/routes/edit.routes.ts";
const obsPath = "server/services/observability.service.ts";
const sharedSchemaPath = "shared/schema.ts";
const postEditDialogPath = "client/src/components/post-edit-dialog.tsx";
const quickRemakePath = "client/src/lib/quick-remake.ts";
const dockerfilePath = "Dockerfile";
const buildScriptPath = "script/build.ts";

const compositorSrc = readSafe(typographyCompositorPath);
const imageCropSrc = readSafe(imageCropPath);
const geminiSrc = readSafe(geminiPath);
const planningSchemaSrc = readSafe(planningSchemaPath);
const promptBuilderSrc = readSafe(promptBuilderPath);
const generateRouteSrc = readSafe(generateRoutePath);
const editRouteSrc = readSafe(editRoutePath);
const obsSrc = readSafe(obsPath);
const sharedSchemaSrc = readSafe(sharedSchemaPath);
const postEditDialogSrc = readSafe(postEditDialogPath);
const quickRemakeSrc = readSafe(quickRemakePath);
const dockerfileSrc = readSafe(dockerfilePath);
const buildScriptSrc = readSafe(buildScriptPath);

async function main() {
  // ── [self-test] ──
  check("[self-test] harness executes", true);
  {
    const selfSrc = read("scripts/verify-phase-23.ts");
    const requiredTags = [
      "[self-test]",
      "[svc-text-free-prompt]",
      "[svc-compositor-archetypes]",
      "[svc-contrast-scrim]",
      "[svc-golden-image-glyphs]",
      "[svc-aspect-crop]",
      "[svc-schema-migration]",
      "[svc-generation-params]",
      "[svc-edit-base-image]",
      "[svc-verify-repair-removed]",
      "[svc-docker-fonts]",
      "[svc-remake-ui]",
      "[svc-cross-plan]",
    ];
    check(
      "[self-test] harness source contains all 13 Phase 23 tag literals",
      requiredTags.every((t) => selfSrc.includes(t)),
    );
  }
  {
    const pkgJsonSrc = readSafe("package.json");
    check(
      "[self-test] @napi-rs/canvas is a package.json dependency",
      /"@napi-rs\/canvas"\s*:/.test(pkgJsonSrc),
    );
  }
  check(
    "[self-test] all three Inter TTF weight files exist and are each >= 100000 bytes",
    ["Inter-Regular.ttf", "Inter-SemiBold.ttf", "Inter-Bold.ttf"].every((f) => {
      const p = path.join("server/assets/fonts", f);
      return exists(p) && fs.statSync(p).size >= 100000;
    }),
  );
  check(
    "[self-test] tests/fixtures/typography/strings.json exists",
    exists("tests/fixtures/typography/strings.json"),
  );
  check(
    "[self-test] script/build.ts copies fonts into dist/assets/fonts",
    buildScriptSrc.includes("dist/assets/fonts"),
  );
  check("[self-test] scripts/smoke-canvas.ts exists", exists("scripts/smoke-canvas.ts"));

  // ── [svc-text-free-prompt] (TYPO-01, plan 23-05) ──
  // Channel 1 — the prompt-builder functions (gemini.service.ts)
  check(
    "[svc-text-free-prompt] gemini.service.ts: zero 'Render these on-image text blocks EXACTLY'",
    !geminiSrc.includes("Render these on-image text blocks EXACTLY"),
  );
  check(
    "[svc-text-free-prompt] gemini.service.ts: zero 'Render the on-image text EXACTLY'",
    !geminiSrc.includes("Render the on-image text EXACTLY"),
  );
  check(
    "[svc-text-free-prompt] gemini.service.ts: zero 'Typography directions:'",
    !geminiSrc.includes("Typography directions:"),
  );
  check(
    "[svc-text-free-prompt] gemini.service.ts: zero (case-insensitive) 'the text rendering rules above must be respected'",
    !geminiSrc.toLowerCase().includes("the text rendering rules above must be respected"),
  );
  check(
    "[svc-text-free-prompt] gemini.service.ts: zero (case-insensitive) 'the image text must be in'",
    !geminiSrc.toLowerCase().includes("the image text must be in"),
  );
  {
    const negSpaceBody = extractMethodBody(geminiSrc, /private\s+buildNegativeSpaceInstruction\s*\(/);
    check(
      "[svc-text-free-prompt] declares private buildNegativeSpaceInstruction( whose body mentions bottom_band, top_stack, centered_hero",
      /private\s+buildNegativeSpaceInstruction\s*\(/.test(geminiSrc) &&
        ["bottom_band", "top_stack", "centered_hero"].every((z) => negSpaceBody.includes(z)),
    );
  }
  check(
    "[svc-text-free-prompt] gemini.service.ts contains 'all on-image copy is composited server-side'",
    geminiSrc.includes("all on-image copy is composited server-side"),
  );
  check(
    "[svc-text-free-prompt] buildTextModeInstruction renamed to buildTextFidelityInstruction (new present, old absent)",
    /buildTextFidelityInstruction/.test(geminiSrc) && !/buildTextModeInstruction/.test(geminiSrc),
  );
  check(
    "[svc-text-free-prompt] buildTextStyleInstruction renamed to buildTextStyleCopyInstruction (new present, bare old identifier absent)",
    /private\s+buildTextStyleCopyInstruction\s*\(/.test(geminiSrc) && !/buildTextStyleInstruction\b/.test(geminiSrc),
  );
  check(
    "[svc-text-free-prompt] gemini.service.ts contains 'do NOT describe typography, lettering, font choice, or text placement anywhere in image_prompt'",
    geminiSrc.includes(
      "do NOT describe typography, lettering, font choice, or text placement anywhere in image_prompt",
    ),
  );

  // Channel 2 — the planning JSON schema, BOTH dialects (planning-schema.service.ts)
  check(
    "[svc-text-free-prompt] planning-schema.service.ts: zero 'text_rendering'",
    !planningSchemaSrc.includes("text_rendering"),
  );
  check(
    "[svc-text-free-prompt] planning-schema.service.ts: zero typography_style/text_placement/text_contrast/headline_text/subtext_text",
    ["typography_style", "text_placement", "text_contrast", "headline_text", "subtext_text"].every(
      (t) => !planningSchemaSrc.includes(t),
    ),
  );
  check(
    "[svc-text-free-prompt] REGRESSION GUARD: strict:true still present in planning-schema.service.ts",
    /strict: true/.test(planningSchemaSrc),
  );
  check(
    "[svc-text-free-prompt] REGRESSION GUARD: additionalProperties:false count >= 8 in planning-schema.service.ts",
    (planningSchemaSrc.match(/additionalProperties: false/g) ?? []).length >= 8,
  );
  check(
    "[svc-text-free-prompt] REGRESSION GUARD: nullable:true still present in planning-schema.service.ts",
    /nullable: true/.test(planningSchemaSrc),
  );
  check(
    "[svc-text-free-prompt] SCOPE GUARD: all 8 surviving structured_image_prompt fields still present (subject/composition/visual_style/color_specification/required_elements/logo_integration/aspect_ratio/negative_prompt)",
    [
      "subject",
      "composition",
      "visual_style",
      "color_specification",
      "required_elements",
      "logo_integration",
      "aspect_ratio",
      "negative_prompt",
    ].every((f) => planningSchemaSrc.includes(f)),
  );
  check(
    "[svc-text-free-prompt] planning-schema.service.ts: 'composited server-side' appears >= 2 times (IMAGE_PROMPT_DESCRIPTION + TEXT_BLOCKS_DESCRIPTION)",
    (planningSchemaSrc.match(/composited server-side/g) ?? []).length >= 2,
  );

  // Channel 3 — the structured-prompt flattener (prompt-builder.service.ts).
  // LIVE path: wins via `flattenedPrompt || image_prompt` in buildLocalTextFallback,
  // reached from normalizeGeminiTextResult whenever the model returned no image_prompt.
  check(
    "[svc-text-free-prompt] prompt-builder.service.ts: zero 'text_rendering'",
    !promptBuilderSrc.includes("text_rendering"),
  );
  check(
    "[svc-text-free-prompt] prompt-builder.service.ts: zero 'Render this headline text prominently'",
    !promptBuilderSrc.includes("Render this headline text prominently"),
  );
  check(
    "[svc-text-free-prompt] prompt-builder.service.ts: zero 'Render this subtext'",
    !promptBuilderSrc.includes("Render this subtext"),
  );
  check(
    "[svc-text-free-prompt] prompt-builder.service.ts: FALLBACK-ONLY doc marker still present (Phase 22 assertion)",
    promptBuilderSrc.includes("FALLBACK-ONLY"),
  );

  // Channel 4 — the embedded "Response format" JSON example inside the planning
  // prompt string (gemini.service.ts). Covered by channel 1/2's text_rendering
  // absence assertions; also assert directly so a stray example key can't survive.
  check(
    "[svc-text-free-prompt] gemini.service.ts: zero 'text_rendering' anywhere (closes the embedded JSON example channel)",
    !geminiSrc.includes("text_rendering"),
  );

  // Cross-cutting — buildTextStyleCopyInstruction's output must never reach an
  // image_prompt-facing string: exactly declaration + the single buildContextPrompt
  // call site. A third occurrence would mean buildLocalTextFallback (no LLM in the
  // loop, writes image_prompt directly) is calling it again.
  check(
    "[svc-text-free-prompt] CROSS-CUTTING: buildTextStyleCopyInstruction occurs exactly twice (declaration + the single buildContextPrompt call site)",
    (geminiSrc.match(/buildTextStyleCopyInstruction/g) ?? []).length === 2,
  );

  // ── [svc-compositor-archetypes] (TYPO-02, plan 23-04) ──
  check(
    "[svc-compositor-archetypes] typography-compositor.service.ts exists",
    exists(typographyCompositorPath),
  );
  {
    const requiredExports = [
      "COMPOSITOR_VERSION",
      "FONT_ALIASES",
      "resolveFontDir",
      "registerBundledFonts",
      "resolveTextBlocks",
      "computeArchetypeRegion",
      "analyzeRegionContrast",
      "compositeTypography",
      "renderGlyphRasterHash",
    ];
    check(
      "[svc-compositor-archetypes] exports COMPOSITOR_VERSION, FONT_ALIASES, resolveFontDir, registerBundledFonts, resolveTextBlocks, computeArchetypeRegion, analyzeRegionContrast, compositeTypography, renderGlyphRasterHash",
      requiredExports.every((name) =>
        new RegExp(`export\\s+(const|function|async function)\\s+${name}\\b`).test(compositorSrc),
      ),
    );
  }
  check(
    "[svc-compositor-archetypes] imports GlobalFonts, createCanvas, loadImage from @napi-rs/canvas",
    /from\s+["']@napi-rs\/canvas["']/.test(compositorSrc) &&
      ["GlobalFonts", "createCanvas", "loadImage"].every((n) => compositorSrc.includes(n)),
  );
  check(
    "[svc-compositor-archetypes] registers all three per-weight aliases Inter-Regular/Inter-SemiBold/Inter-Bold",
    ["Inter-Regular", "Inter-SemiBold", "Inter-Bold"].every((n) => compositorSrc.includes(n)),
  );
  check(
    "[svc-compositor-archetypes] does NOT rely on 'bold ${' weight-keyword matching in ctx.font (Pitfall 5)",
    !compositorSrc.includes("bold ${"),
  );
  check(
    "[svc-compositor-archetypes] contains a measureText( word-wrap loop",
    /measureText\(/.test(compositorSrc),
  );

  async function checkCompositorFunctional(): Promise<void> {
    if (!exists(typographyCompositorPath)) {
      check(
        "[svc-compositor-archetypes] FUNCTIONAL: compositeTypography renders all 3 archetypes as distinct 1024x1024 PNGs",
        false,
        "typography-compositor.service.ts does not exist yet",
      );
      return;
    }
    try {
      const mod: any = await import("../server/services/typography-compositor.service.js");
      const sharp = (await import("sharp")).default;
      const fixtures = JSON.parse(readSafe("tests/fixtures/typography/strings.json"));
      const baseBuffer = fs.readFileSync("tests/fixtures/typography/high-contrast-1024.png");
      for (const archetypeId of ["bottom_band", "top_stack", "centered_hero"]) {
        const result = await mod.compositeTypography({
          baseImageBuffer: baseBuffer,
          textBlocks: fixtures.pt_br,
          layoutArchetypeId: archetypeId,
        });
        const meta = await sharp(result.buffer).metadata();
        const identicalToInput = Buffer.isBuffer(result.buffer) && Buffer.compare(result.buffer, baseBuffer) === 0;
        check(
          `[svc-compositor-archetypes] FUNCTIONAL: compositeTypography(${archetypeId}) returns a distinct 1024x1024 PNG`,
          meta.width === 1024 && meta.height === 1024 && !identicalToInput,
        );
      }
    } catch (err) {
      check(
        "[svc-compositor-archetypes] FUNCTIONAL: compositeTypography renders all 3 archetypes as distinct 1024x1024 PNGs",
        false,
        String((err as Error)?.message ?? err),
      );
    }
  }
  if (tagActive("svc-compositor-archetypes")) await checkCompositorFunctional();

  // ── [svc-contrast-scrim] (TYPO-03, plan 23-04) ──
  async function checkContrastScrim(): Promise<void> {
    if (!exists(typographyCompositorPath)) {
      check(
        "[svc-contrast-scrim] FUNCTIONAL: analyzeRegionContrast + compositeTypography scrim behavior on low/high-contrast fixtures",
        false,
        "typography-compositor.service.ts does not exist yet",
      );
      return;
    }
    try {
      const mod: any = await import("../server/services/typography-compositor.service.js");
      const lowBuffer = fs.readFileSync("tests/fixtures/typography/low-contrast-1024.png");
      const highBuffer = fs.readFileSync("tests/fixtures/typography/high-contrast-1024.png");
      const fullRegion = { left: 0, top: 0, width: 1024, height: 1024 };

      const lowResult = await mod.analyzeRegionContrast(lowBuffer, fullRegion);
      check(
        "[svc-contrast-scrim] FUNCTIONAL: analyzeRegionContrast(low-contrast-1024.png) -> scrimNeeded === true",
        lowResult?.scrimNeeded === true,
      );

      const highResult = await mod.analyzeRegionContrast(highBuffer, fullRegion);
      check(
        '[svc-contrast-scrim] FUNCTIONAL: analyzeRegionContrast(high-contrast-1024.png) -> scrimNeeded === false, textColor === "#FFFFFF"',
        highResult?.scrimNeeded === false && highResult?.textColor === "#FFFFFF",
      );

      const fixtures = JSON.parse(readSafe("tests/fixtures/typography/strings.json"));
      const lowComposite = await mod.compositeTypography({
        baseImageBuffer: lowBuffer,
        textBlocks: fixtures.pt_br,
        layoutArchetypeId: "bottom_band",
      });
      check(
        "[svc-contrast-scrim] FUNCTIONAL: compositeTypography(low-contrast-1024.png) -> meta.scrim.applied === true",
        lowComposite?.meta?.scrim?.applied === true,
      );

      const highComposite = await mod.compositeTypography({
        baseImageBuffer: highBuffer,
        textBlocks: fixtures.pt_br,
        layoutArchetypeId: "bottom_band",
      });
      check(
        "[svc-contrast-scrim] FUNCTIONAL: compositeTypography(high-contrast-1024.png) -> meta.scrim === null",
        highComposite?.meta?.scrim === null,
      );
    } catch (err) {
      check(
        "[svc-contrast-scrim] FUNCTIONAL: analyzeRegionContrast + compositeTypography scrim behavior on low/high-contrast fixtures",
        false,
        String((err as Error)?.message ?? err),
      );
    }
  }
  if (tagActive("svc-contrast-scrim")) await checkContrastScrim();

  // ── [svc-golden-image-glyphs] (TYPO-04, plans 23-04 + 23-08) ──
  check(
    "[svc-golden-image-glyphs] scripts/verify-golden-image.ts exists",
    exists("scripts/verify-golden-image.ts"),
  );
  async function checkGoldenImageGlyphs(): Promise<void> {
    if (!exists(typographyCompositorPath)) {
      check(
        "[svc-golden-image-glyphs] FUNCTIONAL: renderGlyphRasterHash distinguishes every accented glyph from tofu/space",
        false,
        "typography-compositor.service.ts does not exist yet",
      );
      return;
    }
    try {
      const mod: any = await import("../server/services/typography-compositor.service.js");
      const fixtures = JSON.parse(readSafe("tests/fixtures/typography/strings.json"));
      const controlHash = await mod.renderGlyphRasterHash(fixtures.control_missing_char);
      const spaceHash = await mod.renderGlyphRasterHash(" ");
      let allDistinct = true;
      for (const ch of fixtures.accented_chars) {
        const hash = await mod.renderGlyphRasterHash(ch);
        if (hash === controlHash || hash === spaceHash) {
          allDistinct = false;
          break;
        }
      }
      check(
        "[svc-golden-image-glyphs] FUNCTIONAL: renderGlyphRasterHash distinguishes every accented glyph from tofu/space",
        allDistinct,
      );
    } catch (err) {
      check(
        "[svc-golden-image-glyphs] FUNCTIONAL: renderGlyphRasterHash distinguishes every accented glyph from tofu/space",
        false,
        String((err as Error)?.message ?? err),
      );
    }
  }
  if (tagActive("svc-golden-image-glyphs")) await checkGoldenImageGlyphs();

  // ── [svc-aspect-crop] (POL-04, plan 23-03) ──
  check("[svc-aspect-crop] image-crop.service.ts exists", exists(imageCropPath));
  check(
    "[svc-aspect-crop] exports parseAspectRatio and cropToExactAspectRatio",
    /export\s+function\s+parseAspectRatio\b/.test(imageCropSrc) &&
      /export\s+async\s+function\s+cropToExactAspectRatio\b/.test(imageCropSrc),
  );
  check(
    "[svc-aspect-crop] contains NO reference to ASPECT_RATIO_DIMENSIONS (Pitfall 9 — 6-of-15-values lookup must not be reused)",
    !imageCropSrc.includes("ASPECT_RATIO_DIMENSIONS"),
  );
  async function checkAspectCropFunctional(): Promise<void> {
    if (!exists(imageCropPath)) {
      check(
        "[svc-aspect-crop] FUNCTIONAL: cropToExactAspectRatio matches target ratio (within 0.01) for 1:1/4:5/16:9/1200:628/21:9/1:8/8:1",
        false,
        "image-crop.service.ts does not exist yet",
      );
      return;
    }
    try {
      const mod: any = await import("../server/services/image-crop.service.js");
      const sharp = (await import("sharp")).default;
      const baseBuffer = fs.readFileSync("tests/fixtures/typography/high-contrast-1024.png");
      const ratios = ["1:1", "4:5", "16:9", "1200:628", "21:9", "1:8", "8:1"];
      let allOk = true;
      let failedOn = "";
      for (const ratio of ratios) {
        const cropped = await mod.cropToExactAspectRatio(baseBuffer, ratio);
        const meta = await sharp(cropped).metadata();
        const [rw, rh] = ratio.split(":").map(Number);
        const targetRatio = rw / rh;
        const actualRatio = (meta.width ?? 0) / (meta.height ?? 1);
        if (Math.abs(actualRatio - targetRatio) > 0.01) {
          allOk = false;
          failedOn = ratio;
          break;
        }
      }
      check(
        "[svc-aspect-crop] FUNCTIONAL: cropToExactAspectRatio matches target ratio (within 0.01) for 1:1/4:5/16:9/1200:628/21:9/1:8/8:1",
        allOk,
        failedOn ? `failed on ${failedOn}` : "",
      );
    } catch (err) {
      check(
        "[svc-aspect-crop] FUNCTIONAL: cropToExactAspectRatio matches target ratio (within 0.01) for 1:1/4:5/16:9/1200:628/21:9/1:8/8:1",
        false,
        String((err as Error)?.message ?? err),
      );
    }
  }
  if (tagActive("svc-aspect-crop")) await checkAspectCropFunctional();

  // ── [svc-schema-migration] (TYPO-05, plan 23-02) ──
  {
    const migrationFile = findMigrationFile();
    const migrationSrc = migrationFile ? read(migrationFile) : "";
    check(
      "[svc-schema-migration] a supabase/migrations/*base_image*typography*.sql file exists",
      !!migrationFile,
    );
    check(
      "[svc-schema-migration] migration adds base_image_url, typography_meta, generation_params columns",
      [
        "ADD COLUMN IF NOT EXISTS base_image_url",
        "ADD COLUMN IF NOT EXISTS typography_meta",
        "ADD COLUMN IF NOT EXISTS generation_params",
      ].every((s) => migrationSrc.includes(s)),
    );
    check(
      "[svc-schema-migration] migration touches BOTH public.posts and public.post_versions",
      migrationSrc.includes("public.posts") && migrationSrc.includes("public.post_versions"),
    );
  }
  check(
    "[svc-schema-migration] shared/schema.ts exports typographyMetaSchema and generationParamsSchema",
    /export const typographyMetaSchema\b/.test(sharedSchemaSrc) &&
      /export const generationParamsSchema\b/.test(sharedSchemaSrc),
  );
  {
    const postBody = extractZodObjectBody(sharedSchemaSrc, "postSchema");
    check(
      "[svc-schema-migration] postSchema contains base_image_url, typography_meta, generation_params",
      ["base_image_url", "typography_meta", "generation_params"].every((f) => postBody.includes(f)),
    );
  }
  {
    const postVersionBody = extractZodObjectBody(sharedSchemaSrc, "postVersionSchema");
    check(
      "[svc-schema-migration] postVersionSchema contains base_image_url and typography_meta",
      ["base_image_url", "typography_meta"].every((f) => postVersionBody.includes(f)),
    );
  }

  // ── [svc-generation-params] (POL-05, plans 23-02/23-06/23-07) ──
  check(
    "[svc-generation-params] generate.routes.ts inserts generation_params: in its posts insert (alongside base_image_url:)",
    /generation_params:/.test(generateRouteSrc) && /base_image_url:/.test(generateRouteSrc),
  );
  {
    const recoverIdx = editRouteSrc.indexOf("recoverVideoAspectRatioFromPrompt(");
    const genParamsIdx = recoverIdx === -1 ? -1 : editRouteSrc.lastIndexOf("generation_params", recoverIdx);
    check(
      "[svc-generation-params] edit.routes.ts reads post.generation_params and recoverVideoAspectRatioFromPrompt is used ONLY as a documented fallback (generation_params referenced within 400 chars before the call site)",
      /generation_params/.test(editRouteSrc) &&
        recoverIdx !== -1 &&
        genParamsIdx !== -1 &&
        recoverIdx - genParamsIdx <= 400,
    );
  }
  {
    const editReqBody = extractZodObjectBody(sharedSchemaSrc, "editPostRequestSchema");
    check(
      "[svc-generation-params] shared/schema.ts editPostRequestSchema.edit_context contains aspect_ratio, use_logo, logo_position, text_only",
      ["aspect_ratio", "use_logo", "logo_position", "text_only"].every((f) => editReqBody.includes(f)),
    );
  }

  // ── [svc-edit-base-image] (TYPO-07, plan 23-07) ──
  check(
    "[svc-edit-base-image] edit.routes.ts contains base_image_url at least 3 times",
    (editRouteSrc.match(/base_image_url/g) ?? []).length >= 3,
  );
  check(
    "[svc-edit-base-image] selects base_image_url from post_versions",
    /post_versions/.test(editRouteSrc) && /base_image_url/.test(editRouteSrc),
  );
  check(
    "[svc-edit-base-image] contains explicit legacy branch marker 'LEGACY (base_image_url IS NULL)'",
    editRouteSrc.includes("LEGACY (base_image_url IS NULL)"),
  );
  check("[svc-edit-base-image] contains isTextOnlyEdit", /isTextOnlyEdit/.test(editRouteSrc));
  check(
    "[svc-edit-base-image] calls cropToExactAspectRatio( and compositeTypography(",
    /cropToExactAspectRatio\(/.test(editRouteSrc) && /compositeTypography\(/.test(editRouteSrc),
  );
  check(
    "[svc-edit-base-image] inserts base_image_url: and typography_meta: into its post_versions insert",
    /base_image_url:/.test(editRouteSrc) && /typography_meta:/.test(editRouteSrc),
  );

  // ── [svc-verify-repair-removed] (TYPO-06, plans 23-06/23-07/23-09) ──
  check(
    "[svc-verify-repair-removed] server/services/text-rendering.service.ts does NOT exist",
    !exists("server/services/text-rendering.service.ts"),
  );
  {
    const hits = scanForCallSites(
      ["server", "client/src", "shared", "scripts"],
      ["enforceExactImageText(", "verifyExactImageText(", "logTextVerification("],
      // scripts/verify-phase-06.ts: its own absence-assertion literals, not real call sites.
      // scripts/verify-phase-23.ts: this file — its own pattern-literal array below is data,
      // not a real call site; self-scanning it would always trip a false positive.
      ["scripts/verify-phase-06.ts", "scripts/verify-phase-23.ts"],
    );
    check(
      "[svc-verify-repair-removed] repo-wide scan (server/, client/src/, shared/, scripts/ — scripts/verify-phase-06.ts + scripts/verify-phase-23.ts allowlisted) finds ZERO real call sites of enforceExactImageText(/verifyExactImageText(/logTextVerification(",
      hits.length === 0,
      hits.slice(0, 5).join("; "),
    );
  }
  check(
    "[svc-verify-repair-removed] observability.service.ts does NOT export logTextVerification",
    !/export\s+(async\s+)?function\s+logTextVerification\b/.test(obsSrc),
  );
  check(
    "[svc-verify-repair-removed] generate.routes.ts and edit.routes.ts contain zero text_verification SSE progress stages",
    !generateRouteSrc.includes("text_verification") && !editRouteSrc.includes("text_verification"),
  );

  // ── [svc-docker-fonts] (TYPO-04, plan 23-08) ──
  check(
    "[svc-docker-fonts] Dockerfile contains fontconfig, fc-cache, and a RUN line invoking verify-golden-image or smoke-canvas in the builder stage",
    dockerfileSrc.includes("fontconfig") &&
      dockerfileSrc.includes("fc-cache") &&
      /RUN[^\n]*(verify-golden-image|smoke-canvas)/.test(dockerfileSrc),
  );
  {
    const workflowSrc = readSafe(".github/workflows/build-deploy.yml");
    check(
      "[svc-docker-fonts] .github/workflows/build-deploy.yml verify job runs verify-golden-image",
      /verify-golden-image/.test(workflowSrc),
    );
  }

  // ── [svc-remake-ui] (POL-05, plan 23-10) ──
  check(
    "[svc-remake-ui] post-edit-dialog.tsx references generation_params, renders aspect-ratio + logo-position controls, sends text_only",
    postEditDialogSrc.includes("generation_params") &&
      // Dynamic per-value testids follow this codebase's established convention
      // (template literal, e.g. edit-text-mode-${mode.id} a few lines up in the
      // same file) rather than a static quoted string, hence the alternation.
      /data-testid=(?:"edit-aspect-ratio-|\{`edit-aspect-ratio-)/.test(postEditDialogSrc) &&
      /data-testid=(?:"edit-logo-position-|\{`edit-logo-position-)/.test(postEditDialogSrc) &&
      /text_only/.test(postEditDialogSrc),
  );
  check(
    "[svc-remake-ui] quick-remake.ts accepts and forwards generationParams",
    /generationParams/.test(quickRemakeSrc),
  );

  // ── [svc-cross-plan] (plan 23-11) — invariants spanning files no single
  // plan owns: pipeline order in BOTH routes, the no-coverage-gap property
  // between the compositor and the deleted repair loop, the legacy
  // (base_image_url IS NULL) branch's real reachability, and prior-phase
  // non-regression. ──

  // a) PIPELINE ORDER — generate.routes.ts: crop -> typography -> logo -> optimize
  // NOTE (deviation, see 23-11-SUMMARY.md): a naive indexOf("processImageWithThumbnail(")
  // false-negatives here — the video branch (which runs BEFORE the image branch's
  // crop/typography/logo/optimize sequence in source order) calls
  // processImageWithThumbnail( once already, at its own reference-image-thumbnail
  // step. A bare first-occurrence indexOf finds that earlier, unrelated call and
  // reports optimize as happening before logo. Searching for the optimize marker
  // starting FROM the logo-overlay position (not from 0) finds the real image-
  // pipeline occurrence and keeps the assertion exact, not weakened.
  {
    const genOrderOk = (() => {
      const c = generateRouteSrc.indexOf("cropToExactAspectRatio(");
      const t = generateRouteSrc.indexOf("compositeTypography(");
      const l = generateRouteSrc.indexOf("applyLogoOverlay(");
      const o = l > -1 ? generateRouteSrc.indexOf("processImageWithThumbnail(", l) : -1;
      return c > -1 && t > c && l > t && o > l;
    })();
    check(
      "[svc-cross-plan] generate.routes.ts pipeline order: crop → typography → logo → optimize",
      genOrderOk,
    );
  }

  // a) PIPELINE ORDER — edit.routes.ts: crop is inside the non-fast-path branch,
  // so assert crop < composite < optimize, and that the logo overlay (when it
  // runs) happens after the composite step.
  {
    const editOrderOk = (() => {
      const c = editRouteSrc.indexOf("cropToExactAspectRatio(");
      const t = editRouteSrc.indexOf("compositeTypography(");
      const l = editRouteSrc.indexOf("applyLogoOverlay(");
      const o = editRouteSrc.indexOf("processImageWithThumbnail(");
      return c > -1 && t > c && o > t && l > t;
    })();
    check(
      "[svc-cross-plan] edit.routes.ts pipeline order: crop → composite → optimize (logo overlay after composite)",
      editOrderOk,
    );
  }

  // b) NO DOUBLE-RENDER SURFACE — the compositor is wired AND the repair loop
  // is gone, simultaneously. This is the exact condition the TYPO-06
  // sequencing rule protects: at no point in history could a coverage gap
  // have existed where NEITHER path rendered text.
  check(
    "[svc-cross-plan] compositor is wired AND the repair loop is gone (never a coverage gap)",
    /compositeTypography\(/.test(generateRouteSrc)
      && !fs.existsSync("server/services/text-rendering.service.ts")
      && !/enforceExactImageText/.test(generateRouteSrc)
      && !/enforceExactImageText/.test(editRouteSrc),
  );

  // c) LEGACY SAFETY — the base_image_url IS NULL branch exists and is
  // genuinely reachable: both cropToExactAspectRatio( and compositeTypography(
  // must sit behind an editTarget.isBaseImage guard, not run unconditionally.
  {
    const hasIsBaseImageFalse = /isBaseImage:\s*false/.test(editRouteSrc);
    const hasLegacyMarker = editRouteSrc.includes("LEGACY (base_image_url IS NULL)");
    const guardOccurrences = (editRouteSrc.match(/editTarget\.isBaseImage/g) ?? []).length;
    const firstGuardIdx = editRouteSrc.indexOf("editTarget.isBaseImage");
    const compositeIdx = editRouteSrc.indexOf("compositeTypography(");
    const cropIdx = editRouteSrc.indexOf("cropToExactAspectRatio(");
    check(
      "[svc-cross-plan] edit.routes.ts legacy branch is real and reachable: isBaseImage: false present, 'LEGACY (base_image_url IS NULL)' marker present, editTarget.isBaseImage referenced >= 3 times, and its first reference precedes both cropToExactAspectRatio( and compositeTypography(",
      hasIsBaseImageFalse
        && hasLegacyMarker
        && guardOccurrences >= 3
        && firstGuardIdx !== -1
        && compositeIdx !== -1
        && cropIdx !== -1
        && firstGuardIdx < compositeIdx
        && firstGuardIdx < cropIdx,
    );
  }

  // d) NO PRIOR-PHASE HARNESS REGRESSED — spawn each prior-phase harness and
  // assert all four exit 0. Guarded behind tagActive() so a targeted --only
  // run of an unrelated tag stays fast (these are real subprocess spawns).
  async function checkNoPriorPhaseRegression(): Promise<void> {
    const priorHarnesses = [
      "scripts/verify-phase-16.ts",
      "scripts/verify-phase-21.ts",
      "scripts/verify-phase-21.1.ts",
      "scripts/verify-phase-22.ts",
    ];
    for (const script of priorHarnesses) {
      const run = spawnSync("npx", ["tsx", script], { encoding: "utf8", shell: true });
      check(
        `[svc-cross-plan] no prior-phase harness regressed: ${script} exits 0`,
        run.status === 0,
        run.status !== 0 ? (run.stderr || run.stdout || "").slice(-800) : "",
      );
    }
  }
  if (tagActive("svc-cross-plan")) await checkNoPriorPhaseRegression();

  console.log(`\n=== Phase 23 verify ===`);
  console.log(`PASS: ${ok.length}`);
  ok.forEach((n) => console.log(`  ✓ ${n}`));
  if (failures.length) {
    console.log(`\nFAIL: ${failures.length}`);
    failures.forEach((n) => console.log(`  ✗ ${n}`));
    process.exit(1);
  }
  console.log(`\nAll Phase 23 checks passed.`);
}

main().catch((err) => {
  console.error("verify-phase-23 harness crashed:", err);
  process.exit(1);
});

// ── MANUAL/LIVE VERIFICATION RUNBOOK (Phase 23) ──
// Everything above this line is statically/functionally provable from this
// sandbox and is green. These seven steps are NOT — each requires either the
// real Coolify/Hetzner Alpine production host, the live Supabase project, or
// real paid AI calls, none of which this environment can reach. This is the
// single authoritative source for Phase 23 operator sign-off; do not
// duplicate its content elsewhere — reference it instead. Run once before
// closing Phase 23 and record the outcome in 23-11-SUMMARY.md.
//
// 1) APPLY THE MIGRATION.
//    Supabase Dashboard -> SQL Editor -> paste
//    supabase/migrations/20260728000000_posts_base_image_typography_generation_params.sql
//    -> Run. Expected: success; then
//      select column_name from information_schema.columns
//       where table_name='posts'
//         and column_name in ('base_image_url','typography_meta','generation_params');
//    returns 3 rows, and the same query for table_name='post_versions' (columns
//    base_image_url, typography_meta) returns 2 rows.
//
// 2) ALPINE/AVX SMOKE (23-RESEARCH.md Pitfall 1, Brooooooklyn/canvas#1117).
//    `docker build -t xareable:phase23 .` — expected to SUCCEED; both the
//    builder-stage verify-golden-image.ts RUN and the runner-stage
//    `require('@napi-rs/canvas')` RUN must pass. Then, on the REAL
//    Coolify/Hetzner host, in the deployed container:
//      docker exec <container> node -e "require('@napi-rs/canvas');console.log('AVX OK')"
//    Expected: prints AVX OK. A crash with "Illegal instruction" means the
//    production CPU lacks AVX — the documented remedy is a non-Alpine base
//    image for this dependency; do NOT ship until this passes.
//
// 3) GOLDEN IMAGE INSIDE THE REAL ALPINE CONTAINER (Pitfall 3 — font
//    rendering differs from a non-Alpine dev machine).
//      docker build --target builder -t xareable:phase23-builder .
//      docker run --rm -v "$PWD/out:/out" xareable:phase23-builder \
//        npx tsx scripts/verify-golden-image.ts --out=/out
//    (tsx and the scripts are not present in the runner stage — this must run
//    against the builder target.) Expected: "GOLDEN IMAGE: N/N passed", and
//    the PNGs written to ./out show crisp "PROMOÇÃO RELÂMPAGO" /
//    "¡OFERTA DEL DÍA!" with correct á ç ñ ã õ í ú ê — zero tofu boxes.
//
// 4) LIVE GENERATE.
//    Generate a single-image post in staging with use_text=true,
//    text_mode="exact", a pt-BR headline containing accents and a number, and
//    aspect_ratio="1200:628". Expected: (a) the delivered image is exactly
//    1200:628 within 1%; (b) the text is crisp, correctly spelled, and matches
//    the request character-for-character; (c)
//      select base_image_url, typography_meta, generation_params from posts
//       order by created_at desc limit 1;
//    shows all three populated and generation_params.aspect_ratio = '1200:628';
//    (d)
//      select count(*) from generation_logs
//       where event_kind='text_verification' and created_at > now() - interval '1 hour';
//    returns 0 (the deleted verify/repair loop never ran).
//
// 5) LIVE EDIT — NO GHOSTING (TYPO-07).
//    Edit the post from step 4 with a visual-concept change (e.g. "change the
//    background to a marble surface"). Expected: exactly ONE set of crisp
//    text in the result — no ghosted, doubled, or garbled second layer;
//      select base_image_url, typography_meta from post_versions
//       where post_id='<id>' order by version_number desc limit 1;
//    shows both populated.
//
// 6) LIVE TEXT-ONLY FAST PATH + REMAKE FIDELITY (POL-05).
//    On the same post, open Edit, change ONLY the text step (Replace Text,
//    three newline-separated lines), and confirm the Format & Logo step
//    already shows 1200:628 and the original logo position pre-filled.
//    Submit. Expected: it completes noticeably faster than step 5 (no AI
//    image call), the new text renders exactly as typed with the correct
//    headline/support/CTA hierarchy, and the aspect ratio is unchanged. Then
//    run a one-click Quick Remake and confirm the output is still 1200:628.
//
// 7) LEGACY POST REGRESSION (the no-lockout guarantee).
//    Pick a post created BEFORE the migration
//      (select id from posts where base_image_url is null and content_type='image'
//        order by created_at desc limit 1;)
//    and edit it. Expected: the edit succeeds, produces a sensible result,
//    and does NOT gain a second layer of text;
//      select base_image_url from post_versions
//       where post_id='<legacy id>' order by version_number desc limit 1;
//    is NULL (legacy path, no re-composite). ALSO regress one VIDEO post edit
//    to confirm the GATE-08-frozen path still works.
//
// If any step fails, record the failure in 23-11-SUMMARY.md and do NOT mark
// Phase 23 complete.
