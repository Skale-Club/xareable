// scripts/test-style-reference-merge.ts
// Functional test for PLAN-07: planReferenceImageSlots — the pure
// slot-priority merge arithmetic (user images > brand reference photos >
// style reference board images), never exceeding REFERENCE_IMAGE_SLOT_LIMIT.
// Standalone, no network, no Supabase, no AI modules.
// Run with: npx tsx scripts/test-style-reference-merge.ts
// Exits 0 on all-pass, 1 on any failure.

import {
  planReferenceImageSlots,
  REFERENCE_IMAGE_SLOT_LIMIT,
  type ReferenceImageData,
  type ReferenceSlotInput,
} from "../server/services/style-reference.service.js";

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

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson === expectedJson) {
    pass(label);
  } else {
    fail(label, `actual=${actualJson}\n  expected=${expectedJson}`);
  }
}

function userImgs(n: number): ReferenceImageData[] {
  return Array.from({ length: n }, (_, i) => ({ mimeType: "image/png", data: `user-${i}` }));
}

function urls(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
}

async function main(): Promise<void> {
  // 0: REFERENCE_IMAGE_SLOT_LIMIT is the documented 4-slot cap.
  assertEqual("REFERENCE_IMAGE_SLOT_LIMIT === 4", REFERENCE_IMAGE_SLOT_LIMIT, 4);

  // 1: 0 user + 0 brand + 0 style → all empty, usedSlots 0.
  {
    const input: ReferenceSlotInput = { userImages: [], brandPhotoUrls: [], styleBoardPhotoUrls: [] };
    const result = planReferenceImageSlots(input);
    assertEqual(
      "0 user + 0 brand + 0 style -> { userImages: [], brandPhotoUrls: [], styleBoardPhotoUrls: [], usedSlots: 0 }",
      result,
      { userImages: [], brandPhotoUrls: [], styleBoardPhotoUrls: [], usedSlots: 0 },
    );
  }

  // 2: 4 user + 3 brand + 3 style -> 4 user, 0 brand, 0 style (user saturates the budget).
  {
    const result = planReferenceImageSlots({
      userImages: userImgs(4),
      brandPhotoUrls: urls("brand", 3),
      styleBoardPhotoUrls: urls("style", 3),
    });
    assertEqual(
      "4 user + 3 brand + 3 style -> 4 user, 0 brand, 0 style (user saturates the budget)",
      { userCount: result.userImages.length, brandCount: result.brandPhotoUrls.length, styleCount: result.styleBoardPhotoUrls.length, usedSlots: result.usedSlots },
      { userCount: 4, brandCount: 0, styleCount: 0, usedSlots: 4 },
    );
  }

  // 3: 5 user + 2 brand -> user truncated to 4, brand 0 (never exceeds the cap).
  {
    const result = planReferenceImageSlots({
      userImages: userImgs(5),
      brandPhotoUrls: urls("brand", 2),
      styleBoardPhotoUrls: [],
    });
    assertEqual(
      "5 user + 2 brand -> user truncated to 4, brand 0 (never exceeds the cap)",
      { userCount: result.userImages.length, brandCount: result.brandPhotoUrls.length, usedSlots: result.usedSlots },
      { userCount: 4, brandCount: 0, usedSlots: 4 },
    );
  }

  // 4: 1 user + 2 brand + 5 style -> 1 user, 2 brand, 1 style (usedSlots === 4).
  {
    const result = planReferenceImageSlots({
      userImages: userImgs(1),
      brandPhotoUrls: urls("brand", 2),
      styleBoardPhotoUrls: urls("style", 5),
    });
    assertEqual(
      "1 user + 2 brand + 5 style -> 1 user, 2 brand, 1 style (usedSlots === 4)",
      { userCount: result.userImages.length, brandCount: result.brandPhotoUrls.length, styleCount: result.styleBoardPhotoUrls.length, usedSlots: result.usedSlots },
      { userCount: 1, brandCount: 2, styleCount: 1, usedSlots: 4 },
    );
  }

  // 5: 0 user + 0 brand + 6 style -> 4 style (style alone can fill the whole budget).
  {
    const result = planReferenceImageSlots({
      userImages: [],
      brandPhotoUrls: [],
      styleBoardPhotoUrls: urls("style", 6),
    });
    assertEqual(
      "0 user + 0 brand + 6 style -> 4 style (style alone can fill the whole budget)",
      { userCount: result.userImages.length, brandCount: result.brandPhotoUrls.length, styleCount: result.styleBoardPhotoUrls.length, usedSlots: result.usedSlots },
      { userCount: 0, brandCount: 0, styleCount: 4, usedSlots: 4 },
    );
  }

  // 6: 2 user + 0 brand + 5 style -> 2 user, 0 brand, 2 style (an empty middle tier does not block the lowest tier).
  {
    const result = planReferenceImageSlots({
      userImages: userImgs(2),
      brandPhotoUrls: [],
      styleBoardPhotoUrls: urls("style", 5),
    });
    assertEqual(
      "2 user + 0 brand + 5 style -> 2 user, 0 brand, 2 style (an empty middle tier does not block the lowest tier)",
      { userCount: result.userImages.length, brandCount: result.brandPhotoUrls.length, styleCount: result.styleBoardPhotoUrls.length, usedSlots: result.usedSlots },
      { userCount: 2, brandCount: 0, styleCount: 2, usedSlots: 4 },
    );
  }

  // 7: includeBrand: false -> brand tier contributes 0 and its slots roll down to the style tier.
  {
    const result = planReferenceImageSlots({
      userImages: userImgs(1),
      brandPhotoUrls: urls("brand", 3),
      styleBoardPhotoUrls: urls("style", 5),
      includeBrand: false,
    });
    assertEqual(
      "includeBrand: false -> brand tier contributes 0 and its slots roll down to the style tier",
      { userCount: result.userImages.length, brandCount: result.brandPhotoUrls.length, styleCount: result.styleBoardPhotoUrls.length, usedSlots: result.usedSlots },
      { userCount: 1, brandCount: 0, styleCount: 3, usedSlots: 4 },
    );
  }

  // 8: includeStyleBoard: false -> style tier contributes 0 and slots are simply left unused.
  {
    const result = planReferenceImageSlots({
      userImages: userImgs(1),
      brandPhotoUrls: urls("brand", 1),
      styleBoardPhotoUrls: urls("style", 5),
      includeStyleBoard: false,
    });
    assertEqual(
      "includeStyleBoard: false -> style tier contributes 0 and slots are simply left unused",
      { userCount: result.userImages.length, brandCount: result.brandPhotoUrls.length, styleCount: result.styleBoardPhotoUrls.length, usedSlots: result.usedSlots },
      { userCount: 1, brandCount: 1, styleCount: 0, usedSlots: 2 },
    );
  }

  // 9: ordering within each tier is preserved (input order in, input order out).
  // Uses 1 image per tier (3 total, within the 4-slot budget) so all three
  // tiers are fully represented in the output.
  {
    const orderedUsers = userImgs(1);
    const orderedBrand = ["brand-first", "brand-second"];
    const orderedStyle = ["style-first"];
    const result = planReferenceImageSlots({
      userImages: orderedUsers,
      brandPhotoUrls: orderedBrand,
      styleBoardPhotoUrls: orderedStyle,
    });
    assertEqual(
      "ordering within each tier is preserved (input order in, input order out)",
      { userImages: result.userImages, brandPhotoUrls: result.brandPhotoUrls, styleBoardPhotoUrls: result.styleBoardPhotoUrls },
      { userImages: orderedUsers, brandPhotoUrls: orderedBrand, styleBoardPhotoUrls: orderedStyle },
    );
  }

  // 10: the function mutates none of its inputs.
  {
    const input: ReferenceSlotInput = {
      userImages: userImgs(5),
      brandPhotoUrls: urls("brand", 3),
      styleBoardPhotoUrls: urls("style", 3),
    };
    const userImagesSnapshot = JSON.stringify(input.userImages);
    const brandSnapshot = JSON.stringify(input.brandPhotoUrls);
    const styleSnapshot = JSON.stringify(input.styleBoardPhotoUrls);
    const userLenBefore = input.userImages.length;
    const brandLenBefore = input.brandPhotoUrls.length;
    const styleLenBefore = input.styleBoardPhotoUrls.length;

    planReferenceImageSlots(input);

    const unmutated =
      JSON.stringify(input.userImages) === userImagesSnapshot &&
      JSON.stringify(input.brandPhotoUrls) === brandSnapshot &&
      JSON.stringify(input.styleBoardPhotoUrls) === styleSnapshot &&
      input.userImages.length === userLenBefore &&
      input.brandPhotoUrls.length === brandLenBefore &&
      input.styleBoardPhotoUrls.length === styleLenBefore;

    if (unmutated) {
      pass("the function mutates none of its inputs");
    } else {
      fail("the function mutates none of its inputs", "input arrays changed after calling planReferenceImageSlots");
    }
  }

  // 11: returned arrays are NOT the same array references as the inputs (fresh .slice() copies).
  {
    const input: ReferenceSlotInput = {
      userImages: userImgs(1),
      brandPhotoUrls: urls("brand", 1),
      styleBoardPhotoUrls: urls("style", 1),
    };
    const result = planReferenceImageSlots(input);
    const freshCopies =
      result.userImages !== input.userImages &&
      result.brandPhotoUrls !== input.brandPhotoUrls &&
      result.styleBoardPhotoUrls !== input.styleBoardPhotoUrls;
    if (freshCopies) {
      pass("returned arrays are fresh copies (.slice()), never the same array references as the inputs");
    } else {
      fail("returned arrays are fresh copies (.slice()), never the same array references as the inputs");
    }
  }

  const total = passed + failed;
  console.log(`\n${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unhandled error in test-style-reference-merge.ts:", err);
  process.exit(1);
});
