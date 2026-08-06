// scripts/test-typography-treatment.ts
// Functional test for CRSL2-04 (Phase 25, plan 25-07): resolveTypographyTreatment
// + compositeTypography's additive, default-identity `treatment` parameter.
// Standalone, no network. Run with: npx tsx scripts/test-typography-treatment.ts
// Exits 0 on all-pass, 1 on any failure.

import fs from "node:fs";

import type { TextBlock, TextStyle } from "../shared/schema.js";
import { typographyMetaSchema } from "../shared/schema.js";
import {
  resolveTypographyTreatment,
  IDENTITY_TYPOGRAPHY_TREATMENT,
  TREATMENT_SIZE_SCALE_MIN,
  TREATMENT_SIZE_SCALE_MAX,
  TREATMENT_LETTER_SPACING_MAX,
  FONT_ALIASES,
  MIN_SIZE_RATIO,
  compositeTypography,
  type TypographyTreatment,
} from "../server/services/typography-compositor.service.js";

let passed = 0;
let failed = 0;

function pass(label: string): void {
  passed++;
  console.log(`PASS ${label}`);
}

function fail(label: string, detail?: string): void {
  failed++;
  console.error(`FAIL ${label}${detail ? `\n  ${detail}` : ""}`);
}

function assertTrue(condition: boolean, label: string, detail?: string): void {
  if (condition) pass(label);
  else fail(label, detail);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass(label);
  else fail(label, `actual=${a}, expected=${e}`);
}

// ── Fixture builders ─────────────────────────────────────────────────────

// Full TextStyle objects (textStyleSchema's OUTPUT type requires every field
// — the schema's z.object().default(...) fields are still required in the
// z.infer output shape) — so every fixture supplies all of them explicitly.
function makeTextStyle(opts: { description?: string; typography?: string }): TextStyle {
  return {
    id: "fixture-style",
    label: "Fixture Style",
    description: opts.description ?? "",
    categories: [],
    preview: { font_family: "var(--font-sans)", sample_text: "Sample", use_case: "" },
    prompt_hints: {
      typography: opts.typography ?? "",
      layout: "",
      emphasis: "",
      avoid: [],
    },
  };
}

// Real prompt_hints.typography values lifted verbatim from
// DEFAULT_STYLE_CATALOG.text_styles (shared/schema.ts) so the keyword rules
// are proven against the ACTUAL platform data, not synthetic strings.
const BOLD_PROMO = makeTextStyle({
  typography: "ultra-bold high-contrast sans-serif display typography, all-caps emphasis",
});
const EVENT_POSTER = makeTextStyle({
  typography: "bold condensed poster typography with strict supporting text hierarchy (date, time, location)",
});
const ELEGANT_SERIF = makeTextStyle({
  typography: "elegant, high-contrast serif typography with a classic, editorial magazine aesthetic",
});
const CASUAL_MARKER = makeTextStyle({
  typography: "casual handwritten marker pen typography, organic strokes, looking authentically hand-drawn",
});

// ══════════════════════════════════════════════════════════════════════════
// Task 1: resolveTypographyTreatment (pure)
// ══════════════════════════════════════════════════════════════════════════

// 1. [] deep-equals IDENTITY_TYPOGRAPHY_TREATMENT
assertEqual(
  resolveTypographyTreatment([]),
  IDENTITY_TYPOGRAPHY_TREATMENT,
  "resolveTypographyTreatment([]) deep-equals IDENTITY_TYPOGRAPHY_TREATMENT",
);

// 2-3. ultra-bold/display style => uppercaseHighlight true, sizeScale > 1
{
  const t = resolveTypographyTreatment([BOLD_PROMO]);
  assertTrue(t.uppercaseHighlight === true, "bold-promo style yields uppercaseHighlight: true", JSON.stringify(t));
  assertTrue(t.sizeScale > 1, "bold-promo style yields sizeScale > 1", JSON.stringify(t));
}

// 4-5. condensed/poster style => uppercaseHighlight true, letterSpacingRatio > 0
{
  const t = resolveTypographyTreatment([EVENT_POSTER]);
  assertTrue(t.uppercaseHighlight === true, "event-poster style yields uppercaseHighlight: true", JSON.stringify(t));
  assertTrue(t.letterSpacingRatio > 0, "event-poster style yields letterSpacingRatio > 0", JSON.stringify(t));
}

// 6-7. elegant/serif/editorial/classic/journal style => sizeScale < 1, uppercaseHighlight false
{
  const t = resolveTypographyTreatment([ELEGANT_SERIF]);
  assertTrue(t.sizeScale < 1, "elegant-serif style yields sizeScale < 1", JSON.stringify(t));
  assertTrue(t.uppercaseHighlight === false, "elegant-serif style yields uppercaseHighlight: false", JSON.stringify(t));
}

// 8-9. casual/handwritten/marker/script/organic style => uppercaseHighlight false,
// roleAliasOverride.highlight is the SEMIBOLD alias (softer than bold)
{
  const t = resolveTypographyTreatment([CASUAL_MARKER]);
  assertTrue(t.uppercaseHighlight === false, "casual-marker style yields uppercaseHighlight: false", JSON.stringify(t));
  assertTrue(
    t.roleAliasOverride.highlight === FONT_ALIASES.semibold,
    "casual-marker style yields roleAliasOverride.highlight === FONT_ALIASES.semibold (softer than bold)",
    JSON.stringify(t),
  );
}

// 10. empty prompt_hints.typography (and empty description) => identity treatment
{
  const t = resolveTypographyTreatment([makeTextStyle({ typography: "", description: "" })]);
  assertEqual(t, IDENTITY_TYPOGRAPHY_TREATMENT, "empty prompt_hints.typography + empty description yields the identity treatment");
}

// 11. empty prompt_hints.typography, non-empty but non-matching description => still identity
{
  const t = resolveTypographyTreatment([
    makeTextStyle({ typography: "", description: "a friendly neighborhood style with no special keywords" }),
  ]);
  assertEqual(
    t,
    IDENTITY_TYPOGRAPHY_TREATMENT,
    "empty prompt_hints.typography + a non-matching description still yields the identity treatment",
  );
}

// 12. empty prompt_hints.typography BUT description matches a keyword rule => the
// documented fallback-to-description actually engages keyword matching
{
  const t = resolveTypographyTreatment([
    makeTextStyle({ typography: "", description: "ultra-bold display typography for maximum impact" }),
  ]);
  assertTrue(
    t.uppercaseHighlight === true,
    "empty prompt_hints.typography falls back to description for keyword matching (ultra-bold description => uppercaseHighlight: true)",
    JSON.stringify(t),
  );
}

// 13-15. TWO selected styles merge deterministically: sizeScale is the clamped
// product, uppercaseHighlight is OR-ed, letterSpacingRatio is the max
{
  const t = resolveTypographyTreatment([BOLD_PROMO, ELEGANT_SERIF]);
  const expectedProduct = Math.min(TREATMENT_SIZE_SCALE_MAX, Math.max(TREATMENT_SIZE_SCALE_MIN, 1.15 * 0.9));
  assertTrue(
    Math.abs(t.sizeScale - expectedProduct) < 1e-9,
    "two-style merge: sizeScale is the clamped product of both styles' contributions",
    `actual=${t.sizeScale}, expected=${expectedProduct}`,
  );
  assertTrue(
    t.uppercaseHighlight === true,
    "two-style merge: uppercaseHighlight is OR-ed across styles (bold-promo=true, elegant-serif=false => true)",
    JSON.stringify(t),
  );
}
{
  const t = resolveTypographyTreatment([EVENT_POSTER, BOLD_PROMO]);
  assertTrue(
    t.letterSpacingRatio === TREATMENT_LETTER_SPACING_MAX,
    "two-style merge: letterSpacingRatio is the max across styles (event-poster's contribution, clamped)",
    JSON.stringify(t),
  );
}

// 16-17. roleAliasOverride takes the FIRST style's override (selection order wins)
{
  const firstCasual = resolveTypographyTreatment([CASUAL_MARKER, BOLD_PROMO]);
  assertTrue(
    firstCasual.roleAliasOverride.highlight === FONT_ALIASES.semibold,
    "roleAliasOverride: casual style FIRST in selection order supplies the override",
    JSON.stringify(firstCasual),
  );
  const secondCasual = resolveTypographyTreatment([BOLD_PROMO, CASUAL_MARKER]);
  assertTrue(
    secondCasual.roleAliasOverride.highlight === FONT_ALIASES.semibold,
    "roleAliasOverride: the (only) override-supplying style contributes it regardless of position",
    JSON.stringify(secondCasual),
  );
}

// 18-19. sizeScale is always clamped to [0.8, 1.25] regardless of how many styles are selected
{
  const manyBold = resolveTypographyTreatment([BOLD_PROMO, BOLD_PROMO, BOLD_PROMO, BOLD_PROMO]);
  assertEqual(
    manyBold.sizeScale,
    TREATMENT_SIZE_SCALE_MAX,
    "4 selected ultra-bold styles clamp sizeScale to the upper bound (1.15^4 unclamped would exceed 1.25)",
  );
  const manyElegant = resolveTypographyTreatment([ELEGANT_SERIF, ELEGANT_SERIF, ELEGANT_SERIF, ELEGANT_SERIF]);
  assertEqual(
    manyElegant.sizeScale,
    TREATMENT_SIZE_SCALE_MIN,
    "4 selected elegant-serif styles clamp sizeScale to the lower bound (0.9^4 unclamped would be below 0.8)",
  );
}

// 20. letterSpacingRatio is always clamped to [0, 0.08]
{
  const t = resolveTypographyTreatment([EVENT_POSTER]);
  assertEqual(
    t.letterSpacingRatio,
    TREATMENT_LETTER_SPACING_MAX,
    "a single condensed/poster style's raw letterSpacingRatio contribution is clamped to the [0, 0.08] max",
  );
}

// 21. every roleAliasOverride value is one of the 3 FONT_ALIASES values — never a new family name
{
  const allTreatments: TypographyTreatment[] = [
    resolveTypographyTreatment([CASUAL_MARKER]),
    resolveTypographyTreatment([BOLD_PROMO, CASUAL_MARKER]),
    resolveTypographyTreatment([CASUAL_MARKER, EVENT_POSTER, ELEGANT_SERIF]),
  ];
  // Set<string>, not Set<"Inter-Regular" | …>: the point of this assertion is to
  // test an arbitrary runtime value for membership, so the lookup type must be
  // wide. An `undefined` override value fails the assertion rather than being
  // cast away — a role mapped to nothing is not a FONT_ALIASES member either.
  const validAliases = new Set<string>(Object.values(FONT_ALIASES));
  const allValid = allTreatments.every((t) =>
    Object.values(t.roleAliasOverride).every((alias) => alias !== undefined && validAliases.has(alias)),
  );
  assertTrue(allValid, "every produced roleAliasOverride value is a member of FONT_ALIASES (never a new family name)");
}

// ══════════════════════════════════════════════════════════════════════════
// Task 2: additive `treatment` parameter on compositeTypography
// ══════════════════════════════════════════════════════════════════════════

async function runTask2(): Promise<void> {
  const baseImageBuffer = fs.readFileSync("tests/fixtures/typography/high-contrast-1024.png");

  const textBlocks: TextBlock[] = [
    { role: "highlight", text: "make it count" },
    { role: "support", text: "everyday essentials, on sale now" },
    { role: "cta", text: "shop the collection" },
  ];

  // 22-23. Omitting `treatment` entirely produces byte-identical output (buffer
  // AND meta) to passing IDENTITY_TYPOGRAPHY_TREATMENT explicitly — the
  // identity path is a true no-op, reproducing Phase 23's exact behavior.
  const omitted = await compositeTypography({
    baseImageBuffer,
    textBlocks,
    layoutArchetypeId: "bottom_band",
  });
  const explicitIdentity = await compositeTypography({
    baseImageBuffer,
    textBlocks,
    layoutArchetypeId: "bottom_band",
    treatment: IDENTITY_TYPOGRAPHY_TREATMENT,
  });
  assertTrue(
    Buffer.compare(omitted.buffer, explicitIdentity.buffer) === 0,
    "compositeTypography() with NO treatment produces a byte-identical PNG to passing IDENTITY_TYPOGRAPHY_TREATMENT explicitly",
  );
  assertEqual(
    omitted.meta,
    explicitIdentity.meta,
    "compositeTypography() with NO treatment produces byte-identical meta to passing IDENTITY_TYPOGRAPHY_TREATMENT explicitly",
  );

  // 24. { sizeScale: 1.2, uppercaseHighlight: true, ... } produces a LARGER
  // highlight size_px than the identity run on the same input.
  const scaledUp = await compositeTypography({
    baseImageBuffer,
    textBlocks,
    layoutArchetypeId: "bottom_band",
    treatment: { sizeScale: 1.2, roleAliasOverride: {}, uppercaseHighlight: true, letterSpacingRatio: 0 },
  });
  const identityHighlightSize = explicitIdentity.meta.fonts.find((f) => f.role === "highlight")?.size_px ?? 0;
  const scaledHighlightSize = scaledUp.meta.fonts.find((f) => f.role === "highlight")?.size_px ?? 0;
  assertTrue(
    scaledHighlightSize > identityHighlightSize,
    "treatment { sizeScale: 1.2, uppercaseHighlight: true } yields a LARGER highlight size_px than the identity run",
    `identity=${identityHighlightSize}, scaled=${scaledHighlightSize}`,
  );

  // 25-26. uppercaseHighlight uppercases only the highlight block's RENDERED
  // text (proven via a real pixel diff against the identity run); meta.text_blocks
  // still records the ORIGINAL casing — the meta is the source of truth for
  // re-composition on edit.
  assertTrue(
    Buffer.compare(scaledUp.buffer, explicitIdentity.buffer) !== 0,
    "uppercaseHighlight: true changes the rendered PNG pixels vs. the identity run (the highlight glyphs actually changed)",
  );
  const originalHighlightText = textBlocks.find((b) => b.role === "highlight")?.text;
  const metaHighlightText = scaledUp.meta.text_blocks.find((b) => b.role === "highlight")?.text;
  assertTrue(
    metaHighlightText === originalHighlightText,
    "meta.text_blocks keeps the ORIGINAL (lowercase) casing even though uppercaseHighlight rendered it upper-case on the canvas",
    `original=${originalHighlightText}, meta=${metaHighlightText}`,
  );

  // 27. the returned meta still validates against shared/schema.ts's typographyMetaSchema
  const metaValidation = typographyMetaSchema.safeParse(scaledUp.meta);
  assertTrue(
    metaValidation.success,
    "compositeTypography()'s returned meta still validates against typographyMetaSchema",
    metaValidation.success ? "" : JSON.stringify(metaValidation.error.issues),
  );

  // 28. a treatment cannot push a size below MIN_SIZE_RATIO * base (the existing
  // autoshrink floor still wins), even for an extreme out-of-normal-range sizeScale.
  const sharp = (await import("sharp")).default;
  const meta1024 = await sharp(baseImageBuffer).metadata();
  const base = Math.min(meta1024.width ?? 1024, meta1024.height ?? 1024);
  const minSizePx = Math.round(MIN_SIZE_RATIO * base);
  const shrunk = await compositeTypography({
    baseImageBuffer,
    textBlocks,
    layoutArchetypeId: "bottom_band",
    treatment: { sizeScale: 0.01, roleAliasOverride: {}, uppercaseHighlight: false, letterSpacingRatio: 0 },
  });
  const shrunkHighlightSize = shrunk.meta.fonts.find((f) => f.role === "highlight")?.size_px ?? 0;
  assertTrue(
    shrunkHighlightSize === minSizePx,
    "an extreme treatment.sizeScale cannot push size_px below MIN_SIZE_RATIO * base — the autoshrink floor still wins",
    `minSizePx=${minSizePx}, actual=${shrunkHighlightSize}`,
  );
}

runTask2()
  .then(() => {
    const total = passed + failed;
    console.log(`\n${passed}/${total} passed`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("Unhandled error in test-typography-treatment.ts:", err);
    process.exit(1);
  });
