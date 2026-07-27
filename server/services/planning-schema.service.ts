/**
 * Phase 22 (PLAN-02/PLAN-04) — the art-director planning call's structured-output
 * contract. TWO schema literals are exported because the two transports use
 * INCOMPATIBLE dialects: OpenRouter's `response_format.json_schema` is standard
 * JSON Schema (lowercase types, `strict: true`, `additionalProperties: false` at
 * every object level, EVERY property listed in `required` — optionality is
 * expressed as a nullable union), while Google's direct
 * `generationConfig.responseSchema` uses UPPERCASE Type enum strings, omits that
 * per-object flag entirely, and expresses optionality via `nullable: true`.
 * Do NOT try to share one object between them.
 */

import { TEXT_BLOCK_ROLES } from "../../shared/schema.js";

export const PLANNING_SCHEMA_NAME = "art_director_plan";
export const PLANNING_MAX_OUTPUT_TOKENS = 4096;

export const LAYOUT_ARCHETYPE_IDS = ["bottom_band", "top_stack", "centered_hero"] as const;
export type LayoutArchetypeId = typeof LAYOUT_ARCHETYPE_IDS[number];
export const DEFAULT_LAYOUT_ARCHETYPE_ID: LayoutArchetypeId = "bottom_band";

/**
 * Runtime floor for a "dense natural-language scene description" (PLAN-04). NOT
 * expressed as a JSON-Schema length keyword — OpenAI-style strict mode does not
 * reliably support those keywords.
 */
export const MIN_IMAGE_PROMPT_LENGTH = 40;

// ── Wire types (zero `?` optionals; explicit `| null` where genuinely optional) ──
// Named PlanningWire* so they never collide with gemini.service.ts's normalized
// GeminiCreativePlan / GeminiStructuredImagePrompt types.

export interface PlanningWireTextBlock {
  role: "highlight" | "support" | "cta";
  text: string;
}

export interface PlanningWireStructuredImagePrompt {
  subject: string;
  composition: {
    layout: string;
    framing: string;
    focal_point: string;
    camera_angle: string;
    depth_of_field: string;
  };
  visual_style: {
    type: string;
    mood: string;
    lighting: { type: string; direction: string; quality: string };
  };
  color_specification: {
    palette: string[];
    dominant_color: string;
    color_harmony: string;
  };
  required_elements: string[];
  logo_integration: {
    position: string;
    size: string;
    treatment: string;
    integration_style: string;
  } | null;
  aspect_ratio: string;
  negative_prompt: string;
}

export interface PlanningWireCreativePlan {
  scenario_type: string;
  subject_definition: string;
  preservation_notes: string;
  exact_text_required: boolean;
  exact_text_value: string;
  visual_constraints: string[];
  negative_constraints: string[];
  structured_image_prompt: PlanningWireStructuredImagePrompt;
}

export interface PlanningWirePlan {
  headline: string;
  subtext: string;
  image_prompt: string;
  caption: string;
  text_blocks: PlanningWireTextBlock[];
  layout_archetype_id: LayoutArchetypeId;
  creative_plan: PlanningWireCreativePlan;
}

// ── Load-bearing field descriptions (kept identical across both dialects) ──

const IMAGE_PROMPT_DESCRIPTION =
  "THE authoritative art-direction brief handed verbatim to the image model. One dense, flowing natural-language paragraph of 120-200 words describing the scene as an art director briefs a photo shoot: subject and its exact state, camera framing and angle, lens and depth-of-field feel, lighting setup and direction, surface and material texture, background treatment, where each named brand color appears, overall mood, and the negative space reserved for typography. Continuous prose only — never bullet points, never 'Composition: ..., Lighting: ...' label fragments. Everything in creative_plan.structured_image_prompt must also be expressed inside this paragraph.";

const TEXT_BLOCKS_DESCRIPTION =
  "On-image text broken into at most 3 role-tagged blocks (highlight = main attention trigger, support = secondary line, cta = compact call to action). Emit an empty array when the image must stay text-free.";

const LAYOUT_ARCHETYPE_DESCRIPTION =
  "Layout archetype the on-image text should occupy: bottom_band (text in a band across the lower third), top_stack (stacked at the top), or centered_hero (centered over the focal point). Choose bottom_band when uncertain.";

const LOGO_INTEGRATION_DESCRIPTION = "null when the user did not request a logo.";

// ── PLANNING_JSON_SCHEMA — OpenRouter `response_format.json_schema` dialect ──
// Standard JSON Schema: lowercase types, strict:true, `additionalProperties: false`
// at EVERY object level, every property listed in required (optionality via
// anyOf null-union).

export const PLANNING_JSON_SCHEMA = {
  name: PLANNING_SCHEMA_NAME,
  strict: true,
  schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "The main short headline text for the post. Empty string when no headline is requested." },
      subtext: { type: "string", description: "Secondary supporting text beneath the headline. Empty string when no subtext is requested." },
      image_prompt: { type: "string", description: IMAGE_PROMPT_DESCRIPTION },
      caption: { type: "string", description: "The social-media caption text accompanying the post." },
      // Phase 22 forward-compatibility (ROADMAP SC5): required in the schema from
      // day one, but consumed only by Phase 23's typography compositor.
      // headline/subtext remain the fields Phase 22 code actually reads — the
      // redundancy is INTENTIONAL and is Phase 23's to resolve (22-RESEARCH.md
      // Pitfall 5).
      text_blocks: {
        type: "array",
        description: TEXT_BLOCKS_DESCRIPTION,
        items: {
          type: "object",
          properties: {
            role: { type: "string", enum: ["highlight", "support", "cta"], description: "The role this text block plays." },
            text: { type: "string", description: "The text content of this block." },
          },
          required: ["role", "text"],
          additionalProperties: false,
        },
      },
      layout_archetype_id: {
        type: "string",
        enum: [...LAYOUT_ARCHETYPE_IDS],
        description: LAYOUT_ARCHETYPE_DESCRIPTION,
      },
      creative_plan: {
        type: "object",
        properties: {
          scenario_type: { type: "string", description: "The scenario/category this creative belongs to." },
          subject_definition: { type: "string", description: "Precise definition of the subject of the post." },
          preservation_notes: { type: "string", description: "Notes on what existing visual elements (e.g. from reference images) must be preserved." },
          exact_text_required: { type: "boolean", description: "Whether exact user-specified text must be rendered verbatim." },
          exact_text_value: { type: "string", description: "The exact text to render verbatim, when exact_text_required is true. Empty string otherwise." },
          visual_constraints: { type: "array", items: { type: "string" }, description: "Hard visual constraints the image must satisfy." },
          negative_constraints: { type: "array", items: { type: "string" }, description: "Things the image must NOT contain." },
          structured_image_prompt: {
            type: "object",
            properties: {
              subject: { type: "string", description: "The precise subject of the image." },
              composition: {
                type: "object",
                properties: {
                  layout: { type: "string", description: "Overall compositional layout." },
                  framing: { type: "string", description: "Camera framing (e.g. close-up, wide shot)." },
                  focal_point: { type: "string", description: "The visual focal point of the composition." },
                  camera_angle: { type: "string", description: "The camera angle." },
                  depth_of_field: { type: "string", description: "Depth-of-field characteristics." },
                },
                required: ["layout", "framing", "focal_point", "camera_angle", "depth_of_field"],
                additionalProperties: false,
              },
              visual_style: {
                type: "object",
                properties: {
                  type: { type: "string", description: "The visual style type (e.g. photorealistic, illustration)." },
                  mood: { type: "string", description: "The overall mood of the image." },
                  lighting: {
                    type: "object",
                    properties: {
                      type: { type: "string", description: "Lighting type (e.g. natural, studio)." },
                      direction: { type: "string", description: "Lighting direction." },
                      quality: { type: "string", description: "Lighting quality (e.g. soft, harsh)." },
                    },
                    required: ["type", "direction", "quality"],
                    additionalProperties: false,
                  },
                },
                required: ["type", "mood", "lighting"],
                additionalProperties: false,
              },
              color_specification: {
                type: "object",
                properties: {
                  palette: { type: "array", items: { type: "string" }, description: "The named color palette used." },
                  dominant_color: { type: "string", description: "The single dominant color." },
                  color_harmony: { type: "string", description: "The color harmony scheme used." },
                },
                required: ["palette", "dominant_color", "color_harmony"],
                additionalProperties: false,
              },
              required_elements: { type: "array", items: { type: "string" }, description: "Elements that must appear in the image." },
              logo_integration: {
                description: LOGO_INTEGRATION_DESCRIPTION,
                anyOf: [
                  {
                    type: "object",
                    properties: {
                      position: { type: "string", description: "Where the logo is placed." },
                      size: { type: "string", description: "Logo size treatment." },
                      treatment: { type: "string", description: "Visual treatment applied to the logo." },
                      integration_style: { type: "string", description: "How the logo integrates into the scene." },
                    },
                    required: ["position", "size", "treatment", "integration_style"],
                    additionalProperties: false,
                  },
                  { type: "null" },
                ],
              },
              aspect_ratio: { type: "string", description: "The aspect ratio of the image." },
              negative_prompt: { type: "string", description: "Things to avoid in the generated image." },
            },
            required: [
              "subject",
              "composition",
              "visual_style",
              "color_specification",
              "required_elements",
              "logo_integration",
              "aspect_ratio",
              "negative_prompt",
            ],
            additionalProperties: false,
          },
        },
        required: [
          "scenario_type",
          "subject_definition",
          "preservation_notes",
          "exact_text_required",
          "exact_text_value",
          "visual_constraints",
          "negative_constraints",
          "structured_image_prompt",
        ],
        additionalProperties: false,
      },
    },
    required: ["headline", "subtext", "image_prompt", "caption", "text_blocks", "layout_archetype_id", "creative_plan"],
    additionalProperties: false,
  },
};

// ── PLANNING_GEMINI_RESPONSE_SCHEMA — direct-Gemini `generationConfig.responseSchema`
// dialect. UPPERCASE Type enum strings, this dialect has no per-object
// "additionalProperties: false" concept, and optionality is expressed via
// nullable:true (NOT an anyOf null union). Reuses the same field descriptions
// as the OpenRouter dialect.

export const PLANNING_GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING", description: "The main short headline text for the post. Empty string when no headline is requested." },
    subtext: { type: "STRING", description: "Secondary supporting text beneath the headline. Empty string when no subtext is requested." },
    image_prompt: { type: "STRING", description: IMAGE_PROMPT_DESCRIPTION },
    caption: { type: "STRING", description: "The social-media caption text accompanying the post." },
    text_blocks: {
      type: "ARRAY",
      description: TEXT_BLOCKS_DESCRIPTION,
      items: {
        type: "OBJECT",
        properties: {
          role: { type: "STRING", enum: ["highlight", "support", "cta"], description: "The role this text block plays." },
          text: { type: "STRING", description: "The text content of this block." },
        },
        required: ["role", "text"],
      },
    },
    layout_archetype_id: {
      type: "STRING",
      enum: [...LAYOUT_ARCHETYPE_IDS],
      description: LAYOUT_ARCHETYPE_DESCRIPTION,
    },
    creative_plan: {
      type: "OBJECT",
      properties: {
        scenario_type: { type: "STRING", description: "The scenario/category this creative belongs to." },
        subject_definition: { type: "STRING", description: "Precise definition of the subject of the post." },
        preservation_notes: { type: "STRING", description: "Notes on what existing visual elements (e.g. from reference images) must be preserved." },
        exact_text_required: { type: "BOOLEAN", description: "Whether exact user-specified text must be rendered verbatim." },
        exact_text_value: { type: "STRING", description: "The exact text to render verbatim, when exact_text_required is true. Empty string otherwise." },
        visual_constraints: { type: "ARRAY", items: { type: "STRING" }, description: "Hard visual constraints the image must satisfy." },
        negative_constraints: { type: "ARRAY", items: { type: "STRING" }, description: "Things the image must NOT contain." },
        structured_image_prompt: {
          type: "OBJECT",
          properties: {
            subject: { type: "STRING", description: "The precise subject of the image." },
            composition: {
              type: "OBJECT",
              properties: {
                layout: { type: "STRING", description: "Overall compositional layout." },
                framing: { type: "STRING", description: "Camera framing (e.g. close-up, wide shot)." },
                focal_point: { type: "STRING", description: "The visual focal point of the composition." },
                camera_angle: { type: "STRING", description: "The camera angle." },
                depth_of_field: { type: "STRING", description: "Depth-of-field characteristics." },
              },
              required: ["layout", "framing", "focal_point", "camera_angle", "depth_of_field"],
            },
            visual_style: {
              type: "OBJECT",
              properties: {
                type: { type: "STRING", description: "The visual style type (e.g. photorealistic, illustration)." },
                mood: { type: "STRING", description: "The overall mood of the image." },
                lighting: {
                  type: "OBJECT",
                  properties: {
                    type: { type: "STRING", description: "Lighting type (e.g. natural, studio)." },
                    direction: { type: "STRING", description: "Lighting direction." },
                    quality: { type: "STRING", description: "Lighting quality (e.g. soft, harsh)." },
                  },
                  required: ["type", "direction", "quality"],
                },
              },
              required: ["type", "mood", "lighting"],
            },
            color_specification: {
              type: "OBJECT",
              properties: {
                palette: { type: "ARRAY", items: { type: "STRING" }, description: "The named color palette used." },
                dominant_color: { type: "STRING", description: "The single dominant color." },
                color_harmony: { type: "STRING", description: "The color harmony scheme used." },
              },
              required: ["palette", "dominant_color", "color_harmony"],
            },
            required_elements: { type: "ARRAY", items: { type: "STRING" }, description: "Elements that must appear in the image." },
            logo_integration: {
              type: "OBJECT",
              nullable: true,
              description: LOGO_INTEGRATION_DESCRIPTION,
              properties: {
                position: { type: "STRING", description: "Where the logo is placed." },
                size: { type: "STRING", description: "Logo size treatment." },
                treatment: { type: "STRING", description: "Visual treatment applied to the logo." },
                integration_style: { type: "STRING", description: "How the logo integrates into the scene." },
              },
              required: ["position", "size", "treatment", "integration_style"],
            },
            aspect_ratio: { type: "STRING", description: "The aspect ratio of the image." },
            negative_prompt: { type: "STRING", description: "Things to avoid in the generated image." },
          },
          required: [
            "subject",
            "composition",
            "visual_style",
            "color_specification",
            "required_elements",
            "logo_integration",
            "aspect_ratio",
            "negative_prompt",
          ],
        },
      },
      required: [
        "scenario_type",
        "subject_definition",
        "preservation_notes",
        "exact_text_required",
        "exact_text_value",
        "visual_constraints",
        "negative_constraints",
        "structured_image_prompt",
      ],
    },
  },
  required: ["headline", "subtext", "image_prompt", "caption", "text_blocks", "layout_archetype_id", "creative_plan"],
};

// ── Error + classification ──

export class PlanningSchemaError extends Error {
  constructor(message: string, public rawText: string, public attempt: 1 | 2) {
    super(message);
    this.name = "PlanningSchemaError";
  }
}

/**
 * "schema"    -> the model answered but its answer is unusable (bad JSON or schema-invalid).
 *                PLAN-02: these must NEVER silently produce a locally-templated post.
 * "transport" -> network/auth/empty-completion failures. CONTEXT.md locks these as
 *                UNCHANGED: they keep using buildLocalTextFallback(). An empty completion
 *                is classified transport (there is no JSON to validate) — conservative,
 *                preserves today's behavior.
 */
export function classifyPlanningFailure(err: unknown): "schema" | "transport" {
  if (err instanceof PlanningSchemaError) return "schema";
  if (err instanceof SyntaxError) return "schema";
  const msg = String((err as { message?: unknown } | null)?.message ?? err ?? "");
  if (msg === "no_json_found") return "schema";
  return "transport";
}

export function isPlanningSchemaError(err: unknown): boolean {
  return classifyPlanningFailure(err) === "schema";
}

// ── Wire-result validator ──
// No deep re-shaping here — normalizeGeminiTextResult owns downstream mapping.
// Throws PlanningSchemaError (never a bare Error) so classifyPlanningFailure can
// discriminate schema failures from transport failures.

const TEXT_BLOCK_ROLE_SET: ReadonlySet<string> = new Set(TEXT_BLOCK_ROLES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validatePlanningWireResult(raw: unknown, rawText: string, attempt: 1 | 2): PlanningWirePlan {
  if (!isPlainObject(raw)) {
    throw new PlanningSchemaError("planning result is not an object", rawText, attempt);
  }

  if (typeof raw.headline !== "string" || typeof raw.subtext !== "string") {
    throw new PlanningSchemaError("headline and subtext must be strings", rawText, attempt);
  }

  if (typeof raw.caption !== "string" || raw.caption.trim().length === 0) {
    throw new PlanningSchemaError("caption must be a non-empty string", rawText, attempt);
  }

  const imagePromptLength = typeof raw.image_prompt === "string" ? raw.image_prompt.trim().length : 0;
  if (typeof raw.image_prompt !== "string" || imagePromptLength < MIN_IMAGE_PROMPT_LENGTH) {
    throw new PlanningSchemaError(
      `image_prompt must be a dense description of at least ${MIN_IMAGE_PROMPT_LENGTH} characters (got ${imagePromptLength})`,
      rawText,
      attempt,
    );
  }

  const textBlocksValid =
    Array.isArray(raw.text_blocks) &&
    raw.text_blocks.length <= 3 &&
    raw.text_blocks.every(
      (block) =>
        isPlainObject(block) &&
        TEXT_BLOCK_ROLE_SET.has(block.role as string) &&
        typeof block.text === "string" &&
        block.text.trim().length > 0,
    );
  if (!textBlocksValid) {
    throw new PlanningSchemaError("text_blocks must be an array of at most 3 {role,text} entries", rawText, attempt);
  }

  if (!LAYOUT_ARCHETYPE_IDS.includes(raw.layout_archetype_id as LayoutArchetypeId)) {
    throw new PlanningSchemaError(
      `layout_archetype_id must be one of ${LAYOUT_ARCHETYPE_IDS.join(", ")}`,
      rawText,
      attempt,
    );
  }

  const creativePlan = raw.creative_plan;
  if (
    !isPlainObject(creativePlan) ||
    typeof creativePlan.subject_definition !== "string" ||
    !isPlainObject(creativePlan.structured_image_prompt)
  ) {
    throw new PlanningSchemaError("creative_plan.structured_image_prompt must be an object", rawText, attempt);
  }

  return raw as unknown as PlanningWirePlan;
}
