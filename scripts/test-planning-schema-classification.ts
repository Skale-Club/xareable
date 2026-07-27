// Functional test for PLAN-02: schema-vs-transport failure classification.
// No network. Run: npx tsx scripts/test-planning-schema-classification.ts
import {
  classifyPlanningFailure,
  isPlanningSchemaError,
  PlanningSchemaError,
  validatePlanningWireResult,
  type PlanningWirePlan,
} from "../server/services/planning-schema.service.js";

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    console.error(`FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
    process.exit(1);
  }
  console.log(`PASS ${label}`);
}

function assertThrowsSchemaError(label: string, fn: () => unknown): void {
  try {
    fn();
    console.error(`FAIL ${label}\n  expected PlanningSchemaError to be thrown, but nothing was thrown`);
    process.exit(1);
  } catch (err) {
    if (!(err instanceof PlanningSchemaError)) {
      console.error(`FAIL ${label}\n  expected PlanningSchemaError, got: ${err instanceof Error ? err.constructor.name : String(err)}`);
      process.exit(1);
    }
    console.log(`PASS ${label}`);
  }
}

const validFixture: PlanningWirePlan = {
  headline: "Fresh Brew, Every Morning",
  subtext: "Locally roasted, always bold.",
  image_prompt:
    "A steaming ceramic mug of dark roast coffee sits on a rustic wooden table, soft morning light streaming in from the left through a nearby window, gentle steam rising, warm amber tones, shallow depth of field with a blurred cafe background, negative space reserved in the lower third for typography.",
  caption: "Start your day right. #coffee #morning",
  text_blocks: [],
  layout_archetype_id: "bottom_band",
  creative_plan: {
    scenario_type: "product_lifestyle",
    subject_definition: "A steaming mug of dark roast coffee on a wooden table",
    preservation_notes: "Preserve the brand mug shape from the reference image",
    exact_text_required: false,
    exact_text_value: "",
    visual_constraints: ["warm lighting", "rustic wood surface"],
    negative_constraints: ["no other beverages", "no people"],
    structured_image_prompt: {
      subject: "A steaming mug of dark roast coffee",
      composition: {
        layout: "rule of thirds",
        framing: "close-up",
        focal_point: "the mug",
        camera_angle: "eye level",
        depth_of_field: "shallow",
      },
      visual_style: {
        type: "photorealistic",
        mood: "cozy",
        lighting: { type: "natural", direction: "side", quality: "soft" },
      },
      color_specification: {
        palette: ["amber", "brown", "cream"],
        dominant_color: "amber",
        color_harmony: "analogous",
      },
      required_elements: ["coffee mug", "steam"],
      text_rendering: null,
      logo_integration: null,
      aspect_ratio: "1:1",
      negative_prompt: "no text artifacts, no watermark",
    },
  },
};

// 1. classifyPlanningFailure(new SyntaxError("Unexpected token")) returns "schema"
assertEqual(
  'classifyPlanningFailure(new SyntaxError("Unexpected token")) returns "schema"',
  classifyPlanningFailure(new SyntaxError("Unexpected token")),
  "schema",
);

// 2. classifyPlanningFailure(new Error("no_json_found")) returns "schema"
assertEqual(
  'classifyPlanningFailure(new Error("no_json_found")) returns "schema"',
  classifyPlanningFailure(new Error("no_json_found")),
  "schema",
);

// 3. validatePlanningWireResult on a valid fixture returns the plan and does NOT throw
{
  const result = validatePlanningWireResult(validFixture, JSON.stringify(validFixture), 1);
  assertEqual(
    "validatePlanningWireResult on a valid fixture returns the plan without throwing",
    result.headline,
    validFixture.headline,
  );
}

// 4. validatePlanningWireResult on a plan missing image_prompt throws PlanningSchemaError
{
  const missingImagePrompt = { ...validFixture } as Record<string, unknown>;
  delete missingImagePrompt.image_prompt;
  assertThrowsSchemaError(
    "validatePlanningWireResult throws PlanningSchemaError when image_prompt is missing",
    () => validatePlanningWireResult(missingImagePrompt, "{}", 1),
  );
}

// 5. validatePlanningWireResult on a plan whose image_prompt is 12 chars throws PlanningSchemaError
{
  const shortImagePrompt: Record<string, unknown> = { ...validFixture, image_prompt: "short prompt" };
  assertThrowsSchemaError(
    "validatePlanningWireResult throws PlanningSchemaError when image_prompt is 12 characters",
    () => validatePlanningWireResult(shortImagePrompt, "{}", 1),
  );
}

// 6. validatePlanningWireResult on a plan with layout_archetype_id: "diagonal_split" throws PlanningSchemaError
{
  const invalidLayout: Record<string, unknown> = { ...validFixture, layout_archetype_id: "diagonal_split" };
  assertThrowsSchemaError(
    'validatePlanningWireResult throws PlanningSchemaError when layout_archetype_id is "diagonal_split"',
    () => validatePlanningWireResult(invalidLayout, "{}", 1),
  );
}

// 7. classifyPlanningFailure(new Error("fetch failed")) returns "transport"
assertEqual(
  'classifyPlanningFailure(new Error("fetch failed")) returns "transport"',
  classifyPlanningFailure(new Error("fetch failed")),
  "transport",
);

// 8. classifyPlanningFailure(new Error("OPENROUTER_API_KEY is not configured.")) returns "transport"
assertEqual(
  'classifyPlanningFailure(new Error("OPENROUTER_API_KEY is not configured.")) returns "transport"',
  classifyPlanningFailure(new Error("OPENROUTER_API_KEY is not configured.")),
  "transport",
);

// 9. isPlanningSchemaError(new PlanningSchemaError("x", "raw", 2)) is true
assertEqual(
  'isPlanningSchemaError(new PlanningSchemaError("x", "raw", 2)) is true',
  isPlanningSchemaError(new PlanningSchemaError("x", "raw", 2)),
  true,
);

console.log("\nAll PLAN-02 classification tests passed.");
