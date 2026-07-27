// scripts/smoke-canvas.ts
// Phase 23 (TYPO-02/TYPO-04) — AVX / musl runtime smoke check for @napi-rs/canvas.
//
// This guards Brooooooklyn/canvas#1117: the linux-x64-musl prebuilt binary
// crashes the Node process with "Illegal instruction" on non-AVX x86_64 hosts
// starting at @napi-rs/canvas v0.1.78. That is a hard native crash (not a JS
// exception) that can crash-loop a container before it ever reaches app-level
// error handlers. This script is intended to run:
//   - inside the Docker build (builder stage), so a bad host is caught at
//     build time rather than in a production crash-loop, and
//   - on the production host itself (post-deploy smoke check), since the
//     build host and the runtime host may differ.
//
// Run: npx tsx scripts/smoke-canvas.ts
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function main() {
  const pkg = require("@napi-rs/canvas/package.json") as { version: string };

  const canvas = createCanvas(32, 32);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#336699";
  ctx.fillRect(0, 0, 32, 32);

  // Touch GlobalFonts too — some Alpine failure modes (fontconfig missing)
  // only surface once font APIs are exercised, not just canvas creation.
  void GlobalFonts.families;

  const buffer = canvas.encode("png");
  return buffer.then((bytes) => {
    console.log(`SMOKE OK: @napi-rs/canvas ${pkg.version} loaded and encoded ${bytes.length} bytes`);
    process.exit(0);
  });
}

try {
  main()?.catch((err: unknown) => {
    console.error("SMOKE FAIL:", err);
    process.exit(1);
  });
} catch (err) {
  console.error("SMOKE FAIL:", err);
  process.exit(1);
}
