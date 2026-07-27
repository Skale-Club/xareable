// scripts/verify-golden-image.ts
//
// Phase 23 (TYPO-04). Runs inside the Docker build AND in CI. Fails the build
// if (a) @napi-rs/canvas cannot load — Brooooooklyn/canvas#1117 Illegal
// instruction on non-AVX musl hosts; (b) any bundled font fails to register —
// 23-RESEARCH.md Pitfall 2; (c) any pt-BR/es accented glyph renders as tofu —
// the Alpine/fontconfig failure mode, Pitfall 3; (d) any layout archetype
// fails to render.
//
// Deliberately SEPARATE from scripts/verify-phase-23.ts: this script must run
// standalone inside a Docker builder-stage RUN step, where the .planning/
// tree and the rest of the phase harness are irrelevant — and the Dockerfile
// RUN must fail the build on exactly these checks, nothing else.
//
// Usage: npx tsx scripts/verify-golden-image.ts [--out=<dir>]
//   --out=<dir>  also write the composited archetype/wrap/scrim PNGs to <dir>
//                so an operator can eyeball them from a container, e.g.:
//                docker run --rm <image> npx tsx scripts/verify-golden-image.ts --out=/tmp/golden
//                Default: no file output.

import fs from "node:fs";
import path from "node:path";

interface Result {
  name: string;
  pass: boolean;
  detail?: string;
}

const results: Result[] = [];

function report(name: string, pass: boolean, detail = ""): void {
  results.push({ name, pass, detail });
  const label = pass ? "PASS" : "FAIL";
  console.log(`${label}: ${name}${!pass && detail ? " — " + detail : ""}`);
}

const outArg = process.argv.find((a) => /^--out=(.+)$/.test(a));
const outDir = outArg ? outArg.match(/^--out=(.+)$/)![1] : null;

async function main(): Promise<void> {
  // ── 1. @napi-rs/canvas imports and a 32x32 canvas encodes ──────────────
  const { createCanvas } = await import("@napi-rs/canvas");
  const smokeCanvas = createCanvas(32, 32);
  const smokeCtx = smokeCanvas.getContext("2d");
  smokeCtx.fillStyle = "#336699";
  smokeCtx.fillRect(0, 0, 32, 32);
  const smokeBuffer = await smokeCanvas.encode("png");
  report(
    "@napi-rs/canvas imports and a 32x32 canvas encodes to PNG (guards Brooooooklyn/canvas#1117 Illegal instruction on non-AVX musl)",
    smokeBuffer.length > 0,
    `encoded ${smokeBuffer.length} bytes`,
  );

  const compositor: any = await import("../server/services/typography-compositor.service.js");

  // ── 2. resolveFontDir() returns an existing directory ──────────────────
  const fontDir = compositor.resolveFontDir();
  const fontDirExists = typeof fontDir === "string" && fs.existsSync(fontDir) && fs.statSync(fontDir).isDirectory();
  report(`resolveFontDir() returns an existing directory: ${fontDir}`, fontDirExists);

  // ── 3. registerBundledFonts() returns exactly the 3 expected aliases ───
  const aliases = compositor.registerBundledFonts();
  const expectedAliases = ["Inter-Regular", "Inter-SemiBold", "Inter-Bold"];
  const aliasesOk =
    Array.isArray(aliases) && aliases.length === 3 && expectedAliases.every((a) => aliases.includes(a));
  report(
    "registerBundledFonts() returns exactly Inter-Regular, Inter-SemiBold, Inter-Bold (23-RESEARCH.md Pitfall 2 — a silently unregistered font renders blank text with zero error)",
    aliasesOk,
    `got: ${JSON.stringify(aliases)}`,
  );

  const fixtures = JSON.parse(fs.readFileSync("tests/fixtures/typography/strings.json", "utf8"));
  const highContrastBuffer = fs.readFileSync("tests/fixtures/typography/high-contrast-1024.png");
  const lowContrastBuffer = fs.readFileSync("tests/fixtures/typography/low-contrast-1024.png");

  // ── 4. TOFU DETECTION ───────────────────────────────────────────────────
  // Pitfall 3: missing fontconfig on Alpine makes canvas creation fail
  // outright, OR renders blank/tofu text with no thrown error — indistinguishable
  // from a real glyph unless hash-compared against known-bad controls.
  const missingHash = await compositor.renderGlyphRasterHash(fixtures.control_missing_char);
  const blankHash = await compositor.renderGlyphRasterHash(" ");
  for (const ch of fixtures.accented_chars as string[]) {
    const hash = await compositor.renderGlyphRasterHash(ch);
    const isReal = hash !== missingHash && hash !== blankHash;
    report(`TOFU DETECTION: accented glyph "${ch}" renders as a real glyph (not tofu, not blank)`, isReal);
  }

  // ── 5. ASCII control ────────────────────────────────────────────────────
  // Guards against the whole rasterizer being broken, which would make check 4
  // trivially pass by accident. FAIL if missing === blank, since that would
  // mean nothing at all is rendering (both controls collapsed to one hash).
  const asciiHash = await compositor.renderGlyphRasterHash("A");
  report(
    'ASCII CONTROL: renderGlyphRasterHash("A") differs from both the tofu hash and the blank hash',
    asciiHash !== missingHash && asciiHash !== blankHash,
  );
  report(
    "ASCII CONTROL: tofu hash !== blank hash (if equal, nothing is rendering at all and check 4 would pass by accident)",
    missingHash !== blankHash,
    missingHash === blankHash ? "control_missing_char and a blank space produced an identical raster hash" : "",
  );

  // ── 6. ARCHETYPE RENDER ──────────────────────────────────────────────────
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const sharp = (await import("sharp")).default;
  const archetypes = ["bottom_band", "top_stack", "centered_hero"] as const;
  for (const archetypeId of archetypes) {
    const { buffer, meta } = await compositor.compositeTypography({
      baseImageBuffer: highContrastBuffer,
      textBlocks: fixtures.pt_br,
      layoutArchetypeId: archetypeId,
    });
    const imgMeta = await sharp(buffer).metadata();
    const isValidPng = imgMeta.format === "png" && imgMeta.width === 1024 && imgMeta.height === 1024;
    const differsFromInput = Buffer.isBuffer(buffer) && Buffer.compare(buffer, highContrastBuffer) !== 0;
    report(
      `ARCHETYPE RENDER: compositeTypography(${archetypeId}) returns a valid 1024x1024 PNG distinct from the input`,
      isValidPng && differsFromInput,
      `format=${imgMeta.format} width=${imgMeta.width} height=${imgMeta.height} scrim=${JSON.stringify(meta?.scrim)}`,
    );
    if (outDir) fs.writeFileSync(path.join(outDir, `archetype-${archetypeId}.png`), buffer);
  }

  // ── 7. WRAP ──────────────────────────────────────────────────────────────
  const wrapResult = await compositor.compositeTypography({
    baseImageBuffer: highContrastBuffer,
    textBlocks: fixtures.long_wrap,
    layoutArchetypeId: "bottom_band",
  });
  const wrapped = Array.isArray(wrapResult?.meta?.fonts) && wrapResult.meta.fonts.some((f: any) => f.lines >= 3);
  report(
    "WRAP: long_wrap text block wraps to >= 3 lines (proves word-wrap actually wraps rather than clipping to one line)",
    wrapped,
    `fonts=${JSON.stringify(wrapResult?.meta?.fonts)}`,
  );
  if (outDir) fs.writeFileSync(path.join(outDir, "wrap-bottom_band.png"), wrapResult.buffer);

  // ── 8. SCRIM ─────────────────────────────────────────────────────────────
  const scrimResult = await compositor.compositeTypography({
    baseImageBuffer: lowContrastBuffer,
    textBlocks: fixtures.pt_br,
    layoutArchetypeId: "bottom_band",
  });
  const scrimApplied = scrimResult?.meta?.scrim !== null && scrimResult?.meta?.scrim?.applied === true;
  report(
    "SCRIM: compositeTypography(low-contrast-1024.png) applies an automatic contrast scrim",
    scrimApplied,
    `scrim=${JSON.stringify(scrimResult?.meta?.scrim)}`,
  );
  if (outDir) fs.writeFileSync(path.join(outDir, "scrim-low-contrast.png"), scrimResult.buffer);

  // ── Summary ──────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\nGOLDEN IMAGE: ${passed}/${total} passed`);
  if (passed !== total) {
    console.log(`\nFAIL: ${total - passed}`);
    results.filter((r) => !r.pass).forEach((r) => console.log(`  ✗ ${r.name}${r.detail ? " — " + r.detail : ""}`));
  }
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(`GOLDEN IMAGE FAIL: ${(err as Error)?.message ?? err}`);
  process.exit(1);
});
