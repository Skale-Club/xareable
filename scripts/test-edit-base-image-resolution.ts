// scripts/test-edit-base-image-resolution.ts
//
// Phase 23 (TYPO-06/07, POL-05) — no-network fixture test for the edit-target
// resolution / fast-path / TextEditMode decision matrix exported from
// server/routes/edit.routes.ts:
//   resolveEditTarget, resolveEditAspectRatio, isTextOnlyEdit, resolveEditTextBlocks
//
// Route taken (see 23-07-SUMMARY.md "Task 3" for the full rationale): a plain
// static `import` of edit.routes.ts triggers ESM import hoisting — the
// module's transitive `import { config } from "../config/index.js"` runs
// validateEnv() before this file's own `process.env.SUPABASE_URL = ...`
// assignments would execute, printing a scary (harmless, non-fatal outside
// NODE_ENV=production) validation-error banner. A dynamic `await import(...)`
// inside main() is NOT hoisted, so the fixture env vars are set first and the
// import is clean. This keeps the four helpers declared directly in
// edit.routes.ts (satisfying Task 1's own acceptance criteria) rather than
// requiring extraction into a separate edit-target.helpers.ts module.
//
// Run with: npx tsx scripts/test-edit-base-image-resolution.ts
// Exits 0 on all-pass, 1 on any failure.

process.env.SUPABASE_URL ||= "https://fixture-project.example.co";
process.env.SUPABASE_ANON_KEY ||= "fixture-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "fixture-service";

let passCount = 0;
let failCount = 0;

function assertEq(label: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        passCount++;
        console.log(`PASS ${label}`);
    } else {
        failCount++;
        console.error(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`);
    }
}

async function main() {
    const { resolveEditTarget, resolveEditAspectRatio, isTextOnlyEdit, resolveEditTextBlocks } =
        await import("../server/routes/edit.routes.js");

    // A minimal, schema-shaped TypographyMeta fixture reused across cases.
    const M = {
        compositor_version: 1,
        layout_archetype_id: "bottom_band" as const,
        text_blocks: [
            { role: "highlight" as const, text: "Existing headline" },
            { role: "support" as const, text: "Existing support copy" },
        ],
        text_color: "#FFFFFF",
        fonts: [],
        scrim: null,
        safe_zone: { left: 0, top: 600, width: 1080, height: 480 },
        canvas: { width: 1080, height: 1080 },
    };

    // ── resolveEditTarget ────────────────────────────────────────────────

    // 1. New post, no versions.
    assertEq(
        "resolveEditTarget: new post, no versions -> post's base wins, isBaseImage true",
        resolveEditTarget({ image_url: "F", base_image_url: "B", typography_meta: M }, undefined),
        { url: "B", isBaseImage: true, priorTypographyMeta: M },
    );

    // 2. New post with a version that has its own base: version wins over post.
    assertEq(
        "resolveEditTarget: version's own base_image_url wins over the post's base",
        resolveEditTarget(
            { image_url: "F", base_image_url: "B_post", typography_meta: M },
            { image_url: "F_v", base_image_url: "B_version", typography_meta: null },
        ),
        { url: "B_version", isBaseImage: true, priorTypographyMeta: M },
    );

    // 3. Version has base_image_url: null but post has one -> post's base is used.
    assertEq(
        "resolveEditTarget: version.base_image_url null falls back to post's base, isBaseImage true",
        resolveEditTarget(
            { image_url: "F", base_image_url: "B_post", typography_meta: M },
            { image_url: "F_v", base_image_url: null, typography_meta: null },
        ),
        { url: "B_post", isBaseImage: true, priorTypographyMeta: M },
    );

    // 4. LEGACY: post base_image_url null, version image_url present.
    assertEq(
        "resolveEditTarget: LEGACY (base_image_url IS NULL) — version's flattened image_url used, isBaseImage false",
        resolveEditTarget(
            { image_url: "F", base_image_url: null, typography_meta: null },
            { image_url: "V", base_image_url: null, typography_meta: null },
        ),
        { url: "V", isBaseImage: false, priorTypographyMeta: null },
    );

    // 5. LEGACY: post base_image_url null, no versions.
    assertEq(
        "resolveEditTarget: LEGACY (base_image_url IS NULL) — no versions, post's flattened image_url used",
        resolveEditTarget({ image_url: "F", base_image_url: null, typography_meta: null }, undefined),
        { url: "F", isBaseImage: false, priorTypographyMeta: null },
    );

    // 6. Nothing at all.
    assertEq(
        "resolveEditTarget: no image_url, no base, no versions -> null",
        resolveEditTarget({ image_url: null, base_image_url: null, typography_meta: null }, undefined),
        null,
    );

    // ── resolveEditAspectRatio ───────────────────────────────────────────

    // 7. Explicit edit_context.aspect_ratio wins over generation_params.
    assertEq(
        "resolveEditAspectRatio: explicit edit_context.aspect_ratio wins over generation_params",
        resolveEditAspectRatio("4:5", { aspect_ratio: "1:1" }, null),
        "4:5",
    );

    // 8. No explicit -> generation_params.aspect_ratio used.
    assertEq(
        "resolveEditAspectRatio: no explicit -> generation_params.aspect_ratio used",
        resolveEditAspectRatio(undefined, { aspect_ratio: "1:1" }, null),
        "1:1",
    );

    // 9. Neither -> legacy ai_prompt_used regex fallback finds 16:9.
    assertEq(
        "resolveEditAspectRatio: neither explicit nor generation_params -> ai_prompt_used regex finds 16:9",
        resolveEditAspectRatio(undefined, null, "Landscape 16:9 video for the brand"),
        "16:9",
    );

    // 10. Neither, and the prompt has no ratio -> default 9:16.
    assertEq(
        "resolveEditAspectRatio: neither, prompt has no ratio -> default 9:16",
        resolveEditAspectRatio(undefined, null, "No ratio mentioned here"),
        "9:16",
    );

    // ── isTextOnlyEdit ───────────────────────────────────────────────────

    const baseImageTarget = { url: "B", isBaseImage: true, priorTypographyMeta: M };
    const legacyTarget = { url: "F", isBaseImage: false, priorTypographyMeta: null };

    // 11. flag true + image post + base target + manual -> true.
    assertEq(
        "isTextOnlyEdit: flag true + image post + base-image target + manual source -> true",
        isTextOnlyEdit({ textOnlyFlag: true, isVideoPost: false, target: baseImageTarget, source: "manual" }),
        true,
    );

    // 12. flag true but isVideoPost true -> false.
    assertEq(
        "isTextOnlyEdit: flag true but isVideoPost true -> false",
        isTextOnlyEdit({ textOnlyFlag: true, isVideoPost: true, target: baseImageTarget, source: "manual" }),
        false,
    );

    // 13. flag true but target isBaseImage false (LEGACY) -> false.
    assertEq(
        "isTextOnlyEdit: flag true but target is LEGACY (isBaseImage false) -> false",
        isTextOnlyEdit({ textOnlyFlag: true, isVideoPost: false, target: legacyTarget, source: "manual" }),
        false,
    );

    // 14. flag true but source quick_remake -> false.
    assertEq(
        "isTextOnlyEdit: flag true but source is quick_remake -> false",
        isTextOnlyEdit({ textOnlyFlag: true, isVideoPost: false, target: baseImageTarget, source: "quick_remake" }),
        false,
    );

    // 15. flag undefined -> false.
    assertEq(
        "isTextOnlyEdit: flag undefined -> false",
        isTextOnlyEdit({ textOnlyFlag: undefined, isVideoPost: false, target: baseImageTarget, source: "manual" }),
        false,
    );

    // ── resolveEditTextBlocks ────────────────────────────────────────────

    // 16. "remove" -> [].
    assertEq(
        'resolveEditTextBlocks: "remove" -> []',
        resolveEditTextBlocks("remove", undefined, M),
        [],
    );

    // 17. "replace" with "A\nB\nC\nD" -> 3 blocks, roles highlight/support/cta, texts A/B/C.
    assertEq(
        'resolveEditTextBlocks: "replace" with 4 lines -> first 3, roles highlight/support/cta',
        resolveEditTextBlocks("replace", "A\nB\nC\nD", M),
        [
            { role: "highlight", text: "A" },
            { role: "support", text: "B" },
            { role: "cta", text: "C" },
        ],
    );

    // 18. "replace" with empty string -> falls back to priorMeta.text_blocks.
    assertEq(
        'resolveEditTextBlocks: "replace" with empty replacement_text -> falls back to priorMeta.text_blocks',
        resolveEditTextBlocks("replace", "", M),
        M.text_blocks,
    );

    // 19. "keep" -> priorMeta.text_blocks unchanged.
    assertEq(
        'resolveEditTextBlocks: "keep" -> priorMeta.text_blocks unchanged',
        resolveEditTextBlocks("keep", undefined, M),
        M.text_blocks,
    );

    // 20. undefined with priorMeta null -> [].
    assertEq(
        "resolveEditTextBlocks: undefined textMode with priorMeta null -> []",
        resolveEditTextBlocks(undefined, undefined, null),
        [],
    );

    console.log(`\n${passCount}/${passCount + failCount} passed`);
    if (failCount > 0) {
        process.exit(1);
    }
}

main();
