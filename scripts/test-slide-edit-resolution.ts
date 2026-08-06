// scripts/test-slide-edit-resolution.ts
//
// Phase 25 (CRSL2-02/CRSL2-04) — no-network fixture test for the carousel
// slide-edit decision matrix exported from server/routes/carousel.routes.ts:
//   resolveSlideEditTarget, resolveSlideEditAspectRatio,
//   resolveCarouselLayoutArchetype, isSlideTextOnlyEdit
//
// Route taken (see scripts/test-edit-base-image-resolution.ts, Phase 23's
// identical precedent): a plain static `import` of carousel.routes.ts triggers
// ESM import hoisting — the module's transitive `import { config } from
// "../config/index.js"` runs validateEnv() before this file's own
// `process.env.SUPABASE_URL = ...` assignments would execute, printing a scary
// (harmless, non-fatal outside NODE_ENV=production) validation-error banner.
// A dynamic `await import(...)` inside main() is NOT hoisted, so the fixture
// env vars are set first and the import is clean.
//
// Run with: npx tsx scripts/test-slide-edit-resolution.ts
// Exits 0 on all-pass, 1 on any failure.

// `import type` is erased at compile time, so it does NOT re-introduce the
// import-hoisting problem described above — no module is evaluated at runtime.
// It also makes this file a module rather than a global script, which keeps its
// `passCount`/`failCount`/`assertEq` declarations from colliding with the
// identically-named ones in scripts/test-edit-base-image-resolution.ts.
import type { LayoutArchetypeIdShared } from "../shared/schema.js";

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

// A minimal, schema-shaped TypographyMeta fixture builder. The archetype id is
// typed as the schema's own union (not `string`) so the returned fixture is
// assignable to TypographyMeta at every call site.
function makeMeta(archetypeId: LayoutArchetypeIdShared) {
    return {
        compositor_version: 1,
        layout_archetype_id: archetypeId,
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
}

async function main() {
    const {
        resolveSlideEditTarget,
        resolveSlideEditAspectRatio,
        resolveCarouselLayoutArchetype,
        isSlideTextOnlyEdit,
    } = await import("../server/routes/carousel.routes.js");

    const M = makeMeta("bottom_band");

    // ── resolveSlideEditTarget ───────────────────────────────────────────

    // 1. Slide with its own base image, no version.
    assertEq(
        "resolveSlideEditTarget: slide's own base_image_url wins, no version",
        resolveSlideEditTarget({ image_url: "flat", base_image_url: "b", typography_meta: M }, undefined),
        { url: "b", isBaseImage: true, priorTypographyMeta: M },
    );

    // 2. Latest version WITH base_image_url wins over the slide's own base,
    //    carrying the VERSION's typography_meta.
    {
        const versionMeta = makeMeta("top_stack");
        assertEq(
            "resolveSlideEditTarget: latest version's own base_image_url wins over the slide's base, carries VERSION's typography_meta",
            resolveSlideEditTarget(
                { image_url: "flat", base_image_url: "b_slide", typography_meta: M },
                { image_url: "flat_v", base_image_url: "b_version", typography_meta: versionMeta },
            ),
            { url: "b_version", isBaseImage: true, priorTypographyMeta: versionMeta },
        );
    }

    // 3. Latest version has base_image_url: null but a typography_meta — does
    //    NOT win. The slide's own base image is still chosen.
    assertEq(
        "resolveSlideEditTarget: version.base_image_url null (even with typography_meta) must not shadow the slide's base",
        resolveSlideEditTarget(
            { image_url: "flat", base_image_url: "b_slide", typography_meta: M },
            { image_url: "flat_v", base_image_url: null, typography_meta: makeMeta("centered_hero") },
        ),
        { url: "b_slide", isBaseImage: true, priorTypographyMeta: M },
    );

    // 4. LEGACY: slide base_image_url null, latest version base_image_url null.
    assertEq(
        "resolveSlideEditTarget: LEGACY (both base_image_url NULL) — latest version's flattened image_url used, isBaseImage false",
        resolveSlideEditTarget(
            { image_url: "flat", base_image_url: null, typography_meta: null },
            { image_url: "flat_v", base_image_url: null, typography_meta: null },
        ),
        { url: "flat_v", isBaseImage: false, priorTypographyMeta: null },
    );

    // 5. LEGACY with no versions at all.
    assertEq(
        "resolveSlideEditTarget: LEGACY (base_image_url NULL) — no versions, slide's flattened image_url used",
        resolveSlideEditTarget({ image_url: "flat", base_image_url: null, typography_meta: null }, undefined),
        { url: "flat", isBaseImage: false, priorTypographyMeta: null },
    );

    // 6. Nothing at all -> null.
    assertEq(
        "resolveSlideEditTarget: no image_url, no base, no versions -> null",
        resolveSlideEditTarget({ image_url: null, base_image_url: null, typography_meta: null }, undefined),
        null,
    );

    // ── resolveSlideEditAspectRatio ──────────────────────────────────────

    // 7. Explicit client value wins.
    assertEq(
        "resolveSlideEditAspectRatio: explicit edit_context.aspect_ratio wins over generation_params",
        resolveSlideEditAspectRatio("4:5", { aspect_ratio: "1:1" }),
        "4:5",
    );

    // 8. No explicit -> persisted generation_params used.
    assertEq(
        "resolveSlideEditAspectRatio: no explicit -> persisted generation_params.aspect_ratio used",
        resolveSlideEditAspectRatio(undefined, { aspect_ratio: "4:5" }),
        "4:5",
    );

    // 9. Neither -> carousel default "1:1".
    assertEq(
        "resolveSlideEditAspectRatio: neither explicit nor generation_params -> carousel default 1:1",
        resolveSlideEditAspectRatio(undefined, null),
        "1:1",
    );

    // 10. A non-carousel ratio is REJECTED, not passed through.
    assertEq(
        "resolveSlideEditAspectRatio: non-carousel ratio 1200:628 rejected -> falls through to generation_params 4:5",
        resolveSlideEditAspectRatio("1200:628", { aspect_ratio: "4:5" }),
        "4:5",
    );

    // ── resolveCarouselLayoutArchetype ───────────────────────────────────

    // 11. First non-null (and valid) entry wins.
    assertEq(
        "resolveCarouselLayoutArchetype: first non-null valid entry wins (top_stack)",
        resolveCarouselLayoutArchetype([null, makeMeta("top_stack"), makeMeta("bottom_band")]),
        "top_stack",
    );

    // 12. Empty array -> default.
    assertEq(
        "resolveCarouselLayoutArchetype: [] -> DEFAULT_LAYOUT_ARCHETYPE_ID",
        resolveCarouselLayoutArchetype([]),
        "bottom_band",
    );

    // 13. All null/undefined -> default.
    assertEq(
        "resolveCarouselLayoutArchetype: [null, undefined] -> DEFAULT_LAYOUT_ARCHETYPE_ID",
        resolveCarouselLayoutArchetype([null, undefined]),
        "bottom_band",
    );

    // 14. Unrecognized stored value coerces to default, never throws.
    //     The cast is deliberate and is the point of this case: it feeds a value
    //     the schema type forbids, to prove the RUNTIME coercion path handles
    //     rows written before the archetype list was fixed.
    assertEq(
        "resolveCarouselLayoutArchetype: unrecognized stored value coerces to DEFAULT_LAYOUT_ARCHETYPE_ID",
        resolveCarouselLayoutArchetype([makeMeta("nonsense" as LayoutArchetypeIdShared)]),
        "bottom_band",
    );

    // ── isSlideTextOnlyEdit ──────────────────────────────────────────────

    const baseImageTarget = { url: "b", isBaseImage: true, priorTypographyMeta: M };
    const legacyTarget = { url: "flat", isBaseImage: false, priorTypographyMeta: null };

    // 15. flag true + base-image target + manual source -> true.
    assertEq(
        "isSlideTextOnlyEdit: flag true + base-image target + manual source -> true",
        isSlideTextOnlyEdit({ textOnlyFlag: true, target: baseImageTarget, source: "manual" }),
        true,
    );

    // 16. flag undefined -> false.
    assertEq(
        "isSlideTextOnlyEdit: flag undefined -> false",
        isSlideTextOnlyEdit({ textOnlyFlag: undefined, target: baseImageTarget, source: "manual" }),
        false,
    );

    // 17. flag false -> false.
    assertEq(
        "isSlideTextOnlyEdit: flag false -> false",
        isSlideTextOnlyEdit({ textOnlyFlag: false, target: baseImageTarget, source: "manual" }),
        false,
    );

    // 18. target null -> false.
    assertEq(
        "isSlideTextOnlyEdit: target null -> false",
        isSlideTextOnlyEdit({ textOnlyFlag: true, target: null, source: "manual" }),
        false,
    );

    // 19. target.isBaseImage false (LEGACY) -> false.
    assertEq(
        "isSlideTextOnlyEdit: target is LEGACY (isBaseImage false) -> false",
        isSlideTextOnlyEdit({ textOnlyFlag: true, target: legacyTarget, source: "manual" }),
        false,
    );

    // 20. source === "quick_remake" -> false.
    assertEq(
        'isSlideTextOnlyEdit: source is "quick_remake" -> false',
        isSlideTextOnlyEdit({ textOnlyFlag: true, target: baseImageTarget, source: "quick_remake" }),
        false,
    );

    console.log(`\n${passCount}/${passCount + failCount} passed`);
    if (failCount > 0) {
        process.exit(1);
    }
    process.exit(0);
}

main();
