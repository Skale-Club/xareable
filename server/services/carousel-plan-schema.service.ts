/**
 * Phase 25 (CRSL2-01) — the carousel narrative-plan structured-output contract.
 * Mirrors `planning-schema.service.ts`'s dual-dialect discipline (the same
 * module Phase 22's single-image art-director planning call uses): TWO schema
 * literals are exported below (`CAROUSEL_PLAN_JSON_SCHEMA` /
 * `CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA`) because the two transports use
 * INCOMPATIBLE dialects — OpenRouter's `response_format.json_schema` is
 * standard JSON Schema (lowercase types, `strict: true`,
 * `additionalProperties: false` at every object level, every property listed
 * in `required`), while Google's direct `generationConfig.responseSchema` uses
 * UPPERCASE Type enum strings, omits that per-object flag entirely, and has no
 * `strict` concept. Those two objects must NEVER be cross-wired into the wrong
 * transport branch (25-RESEARCH.md Pitfall 4) — exactly the mistake
 * `planning-schema.service.ts`'s own header comment warns against for the
 * single-image path.
 *
 * This module also owns the two pieces of CRSL2-01 logic that make the
 * narrative contract provable without any AI call: deterministic per-slide
 * `role` assignment (25-CONTEXT.md locks this as SERVER-DECIDED, never
 * model-decided) and the automated inter-slide composition-variation check
 * that satisfies ROADMAP SC2.
 */

import {
  DEFAULT_LAYOUT_ARCHETYPE_ID,
  LAYOUT_ARCHETYPE_IDS,
  MIN_IMAGE_PROMPT_LENGTH,
  type LayoutArchetypeId,
} from "./planning-schema.service.js";
import { TEXT_BLOCK_ROLES, type TextBlock } from "../../shared/schema.js";

// ── Narrative role contract ───────────────────────────────────────────────

export const SLIDE_ROLES = ["hook", "content", "cta"] as const;
export type SlideRole = typeof SLIDE_ROLES[number];

// Two composition_notes whose normalized token sets overlap at or above this
// Jaccard ratio count as "the same framing" for ROADMAP SC2's automated
// inter-slide composition-similarity check.
export const COMPOSITION_SIMILARITY_THRESHOLD = 0.8;

// Runtime floor for a "one specific sentence" composition_note (mirrors
// planning-schema.service.ts's MIN_IMAGE_PROMPT_LENGTH convention). NOT
// expressed as a JSON-Schema length keyword — see MIN_IMAGE_PROMPT_LENGTH's
// own comment for why.
export const MIN_COMPOSITION_NOTE_LENGTH = 15;

export interface CarouselWireSlide {
  slide_number: number;
  image_prompt: string;
  role: SlideRole; // model emits it for schema symmetry; SERVER OVERWRITES IT
  composition_note: string;
  text_blocks: TextBlock[];
}

export interface CarouselWirePlan {
  shared_style: string;
  layout_archetype_id: LayoutArchetypeId; // chosen ONCE for the whole carousel
  slides: CarouselWireSlide[];
  caption: string;
}

/**
 * Assigns each slide's narrative role DETERMINISTICALLY: slide 1 is always
 * "hook", the last slide is always "cta", everything in between is "content".
 * The model's own `role` value is discarded here — 25-CONTEXT.md locks
 * server-side deterministic assignment. Returns a NEW array of NEW objects;
 * never mutates the input.
 */
export function assignSlideRoles<T extends { role?: string }>(slides: T[]): Array<T & { role: SlideRole }> {
  return slides.map((s, i) => {
    let role: SlideRole;
    if (i === 0) {
      // A single-slide array yields ["hook"] — hook wins over cta because this
      // branch is checked first.
      role = "hook";
    } else if (i === slides.length - 1 && slides.length > 1) {
      role = "cta";
    } else {
      role = "content";
    }
    return { ...s, role };
  });
}

// ── Composition-variation check ─────────────────────────────────────────────

/**
 * lowercase -> decompose accents (NFD) -> strip diacritic marks -> strip
 * remaining punctuation -> collapse whitespace. Used for BOTH the
 * exact-equality path and as the basis for tokenization. Mirrors
 * shared/utils.ts's normalizeForComparison NFD-decompose pattern (avoids the
 * \p{L}/\p{N} unicode-property regex classes, which require an ES2018+
 * target this project's tsconfig does not set) so pt-BR/es accented
 * composition notes ("café", "montaña") still normalize sensibly.
 */
function normalizeCompositionNoteString(note: string): string {
  return note
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * lowercase -> strip punctuation -> collapse whitespace -> split on space ->
 * drop tokens shorter than 3 chars. The raw normalized string (pre-token-drop)
 * remains available via normalizeCompositionNoteString for the exact-equality
 * path in findDuplicateCompositionNotes.
 */
export function normalizeCompositionNote(note: string): string[] {
  const normalized = normalizeCompositionNoteString(note);
  if (normalized.length === 0) return [];
  return normalized.split(" ").filter((token) => token.length >= 3);
}

// Takes plain token arrays (not Sets) because this codebase's tsconfig has no
// explicit `target`, which defaults tsc to ES3 — iterating a Set directly
// (`for...of`) requires --downlevelIteration or an ES2015+ target. Array.from
// still works at any target (same pattern already used elsewhere in this repo,
// e.g. cleanup-cron.service.ts's `Array.from(new Set(...))`), so de-duplication
// happens via Array.from(new Set(...)) and iteration happens over the
// resulting plain array.
function jaccard(tokensA: string[], tokensB: string[]): number {
  const uniqueA = Array.from(new Set(tokensA));
  const uniqueB = Array.from(new Set(tokensB));
  if (uniqueA.length === 0 && uniqueB.length === 0) return 1;
  const setB = new Set(uniqueB);
  let intersectionSize = 0;
  for (const token of uniqueA) {
    if (setB.has(token)) intersectionSize++;
  }
  const unionSize = uniqueA.length + uniqueB.length - intersectionSize;
  return unionSize === 0 ? 1 : intersectionSize / unionSize;
}

/**
 * Compares every unordered pair of slides' `composition_note` values. Two
 * byte-identical (post-normalization) notes always score similarity 1. Two
 * empty-string notes are byte-identical to each other, so they too score 1.
 * Otherwise, similarity is the Jaccard ratio (|A intersect B| / |A union B|)
 * over each note's normalized token set. A pair is emitted whenever
 * similarity >= COMPOSITION_SIMILARITY_THRESHOLD. `a`/`b` are `slide_number`
 * values (not array indices).
 */
export function findDuplicateCompositionNotes(
  slides: Array<{ slide_number: number; composition_note: string }>,
): Array<{ a: number; b: number; similarity: number }> {
  const pairs: Array<{ a: number; b: number; similarity: number }> = [];
  for (let i = 0; i < slides.length; i++) {
    for (let j = i + 1; j < slides.length; j++) {
      const noteA = slides[i].composition_note;
      const noteB = slides[j].composition_note;
      const rawA = normalizeCompositionNoteString(noteA);
      const rawB = normalizeCompositionNoteString(noteB);

      let similarity: number;
      if (rawA === rawB) {
        similarity = 1;
      } else {
        similarity = jaccard(normalizeCompositionNote(noteA), normalizeCompositionNote(noteB));
      }

      if (similarity >= COMPOSITION_SIMILARITY_THRESHOLD) {
        pairs.push({ a: slides[i].slide_number, b: slides[j].slide_number, similarity });
      }
    }
  }
  return pairs;
}

/** true iff no pair of slides' composition_note values are "the same framing" per COMPOSITION_SIMILARITY_THRESHOLD. */
export function compositionNotesAreVaried(
  slides: Array<{ slide_number: number; composition_note: string }>,
): boolean {
  return findDuplicateCompositionNotes(slides).length === 0;
}

// ── Shared field description constants (declared once, referenced from BOTH
// dialects below — this is how planning-schema.service.ts keeps its two
// dialects' wording in sync) ─────────────────────────────────────────────────

const SHARED_STYLE_DESCRIPTION =
  "Dense visual style descriptor (2-3 sentences): lighting setup, color palette, composition style, mood, texture, typography direction. Must be specific enough that an image generator can reproduce the same visual feel across all slides.";

const SLIDE_IMAGE_PROMPT_DESCRIPTION =
  "Self-contained image prompt for this slide, incorporating shared_style inline. The scene itself must be completely text-free: never ask for rendered words, letters, numbers, or lettering of any kind — all copy is composited server-side.";

const SLIDE_ROLE_DESCRIPTION =
  "Narrative role of this slide: hook (slide 1, the scroll-stopping opener), content (developing middle slides), or cta (final call to action). The server reassigns this deterministically; emit your best guess.";

const COMPOSITION_NOTE_DESCRIPTION =
  "This slide's intended framing in one specific sentence: shot type, camera angle, subject distance, and what fills the frame. MUST be materially different from every other slide's composition_note — vary between wide establishing shots, close-up detail crops, overhead flat-lays, over-the-shoulder angles, and a clean product/CTA framing for the closer. Do NOT repeat the same framing across slides.";

const CAROUSEL_TEXT_BLOCKS_DESCRIPTION =
  "On-image text broken into at most 3 role-tagged blocks for this slide (highlight = main attention trigger, support = secondary line, cta = compact call to action). Emit an empty array when this slide must stay text-free. Consumed by the server-side typography compositor — these blocks are composited server-side onto the image, NOT rendered by the image model.";

const CAROUSEL_LAYOUT_ARCHETYPE_DESCRIPTION =
  "Layout archetype the text_blocks copy should occupy once composited server-side: bottom_band (a band across the lower third), top_stack (stacked at the top), or centered_hero (centered over the focal point). Choose bottom_band when uncertain. Chosen ONCE for the entire carousel and applied identically to every slide — do NOT vary it per slide.";

const CAPTION_DESCRIPTION = "Unified Instagram caption for the carousel post with hashtags.";

export const CAROUSEL_PLAN_SCHEMA_NAME = "carousel_narrative_plan";

// ── CAROUSEL_PLAN_JSON_SCHEMA — OpenRouter `response_format.json_schema`
// dialect. Standard JSON Schema: lowercase types, strict:true,
// `additionalProperties: false` at EVERY object level, every property listed
// in required. ───────────────────────────────────────────────────────────────

export const CAROUSEL_PLAN_JSON_SCHEMA = {
  name: CAROUSEL_PLAN_SCHEMA_NAME,
  strict: true,
  schema: {
    type: "object",
    properties: {
      shared_style: { type: "string", description: SHARED_STYLE_DESCRIPTION },
      layout_archetype_id: {
        type: "string",
        enum: [...LAYOUT_ARCHETYPE_IDS],
        description: CAROUSEL_LAYOUT_ARCHETYPE_DESCRIPTION,
      },
      slides: {
        type: "array",
        description: "One entry per carousel slide, in slide order.",
        items: {
          type: "object",
          properties: {
            slide_number: { type: "integer", description: "1-based slide position." },
            image_prompt: { type: "string", description: SLIDE_IMAGE_PROMPT_DESCRIPTION },
            role: { type: "string", enum: [...SLIDE_ROLES], description: SLIDE_ROLE_DESCRIPTION },
            composition_note: { type: "string", description: COMPOSITION_NOTE_DESCRIPTION },
            text_blocks: {
              type: "array",
              description: CAROUSEL_TEXT_BLOCKS_DESCRIPTION,
              items: {
                type: "object",
                properties: {
                  role: { type: "string", enum: [...TEXT_BLOCK_ROLES], description: "The role this text block plays." },
                  text: { type: "string", description: "The text content of this block." },
                },
                required: ["role", "text"],
                additionalProperties: false,
              },
            },
          },
          required: ["slide_number", "image_prompt", "role", "composition_note", "text_blocks"],
          additionalProperties: false,
        },
      },
      caption: { type: "string", description: CAPTION_DESCRIPTION },
    },
    required: ["shared_style", "layout_archetype_id", "slides", "caption"],
    additionalProperties: false,
  },
};

// ── CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA — direct-Gemini
// `generationConfig.responseSchema` dialect. UPPERCASE Type enum strings, NO
// per-object "additionalProperties" concept, and NO `strict`. This object and
// CAROUSEL_PLAN_JSON_SCHEMA above are NEVER interchangeable — do not pass one
// where the other transport expects it (25-RESEARCH.md Pitfall 4). ──────────

export const CAROUSEL_PLAN_GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    shared_style: { type: "STRING", description: SHARED_STYLE_DESCRIPTION },
    layout_archetype_id: {
      type: "STRING",
      enum: [...LAYOUT_ARCHETYPE_IDS],
      description: CAROUSEL_LAYOUT_ARCHETYPE_DESCRIPTION,
    },
    slides: {
      type: "ARRAY",
      description: "One entry per carousel slide, in slide order.",
      items: {
        type: "OBJECT",
        properties: {
          slide_number: { type: "INTEGER", description: "1-based slide position." },
          image_prompt: { type: "STRING", description: SLIDE_IMAGE_PROMPT_DESCRIPTION },
          role: { type: "STRING", enum: [...SLIDE_ROLES], description: SLIDE_ROLE_DESCRIPTION },
          composition_note: { type: "STRING", description: COMPOSITION_NOTE_DESCRIPTION },
          text_blocks: {
            type: "ARRAY",
            description: CAROUSEL_TEXT_BLOCKS_DESCRIPTION,
            items: {
              type: "OBJECT",
              properties: {
                role: { type: "STRING", enum: [...TEXT_BLOCK_ROLES], description: "The role this text block plays." },
                text: { type: "STRING", description: "The text content of this block." },
              },
              required: ["role", "text"],
            },
          },
        },
        required: ["slide_number", "image_prompt", "role", "composition_note", "text_blocks"],
      },
    },
    caption: { type: "STRING", description: CAPTION_DESCRIPTION },
  },
  required: ["shared_style", "layout_archetype_id", "slides", "caption"],
};

// ── Error + validator ────────────────────────────────────────────────────────

export class CarouselPlanSchemaError extends Error {
  constructor(message: string, public readonly rawText: string, public readonly attempt: 1 | 2) {
    super(message);
    this.name = "CarouselPlanSchemaError";
  }
}

export function isCarouselPlanSchemaError(err: unknown): boolean {
  return err instanceof CarouselPlanSchemaError;
}

const TEXT_BLOCK_ROLE_SET: ReadonlySet<string> = new Set(TEXT_BLOCK_ROLES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Phase 22 (PLAN-03) bumped the single flat per-slide token budget from 350 to
// 700 (this phase adds composition_note + up to 3 text_blocks + role per
// slide, none of which existed in the old minimal {slide_number,image_prompt}
// shape). At 8 slides: CAROUSEL_PLAN_TOKEN_BASE(1200) +
// CAROUSEL_PLAN_MAX_OUTPUT_TOKENS_PER_SLIDE(700) * 8 = 6800 tokens, far under
// the 65,536 completion ceiling of every structured-outputs-capable slug.
export const CAROUSEL_PLAN_TOKEN_BASE = 1200; // shared_style + caption + JSON scaffolding
export const CAROUSEL_PLAN_MAX_OUTPUT_TOKENS_PER_SLIDE = 700; // composition_note + up to 3 text_blocks + role per slide

/**
 * Validates a raw structured-output result against the carousel narrative
 * plan contract. Throws CarouselPlanSchemaError (never a bare Error) on any
 * failure. `layout_archetype_id` is COERCED to DEFAULT_LAYOUT_ARCHETYPE_ID
 * when absent/invalid rather than throwing (matches the single-image path's
 * forgiving archetype handling). `slide_number` is normalized to `index + 1`
 * so a model that mis-numbers slides cannot desync the per-slide loop. `role`
 * is ALWAYS server-decided via assignSlideRoles — the model's own guess never
 * survives into the returned plan.
 */
export function validateCarouselWirePlan(
  raw: unknown,
  rawText: string,
  attempt: 1 | 2,
  expectedSlideCount: number,
): CarouselWirePlan {
  if (!isPlainObject(raw)) {
    throw new CarouselPlanSchemaError("carousel plan result is not an object", rawText, attempt);
  }

  if (typeof raw.shared_style !== "string" || raw.shared_style.trim().length === 0) {
    throw new CarouselPlanSchemaError("shared_style must be a non-empty string", rawText, attempt);
  }

  if (typeof raw.caption !== "string" || raw.caption.trim().length === 0) {
    throw new CarouselPlanSchemaError("caption must be a non-empty string", rawText, attempt);
  }

  const layoutArchetypeId: LayoutArchetypeId = LAYOUT_ARCHETYPE_IDS.includes(raw.layout_archetype_id as LayoutArchetypeId)
    ? (raw.layout_archetype_id as LayoutArchetypeId)
    : DEFAULT_LAYOUT_ARCHETYPE_ID;

  if (!Array.isArray(raw.slides) || raw.slides.length !== expectedSlideCount) {
    throw new CarouselPlanSchemaError(
      `slides must be an array of length ${expectedSlideCount} (got ${Array.isArray(raw.slides) ? raw.slides.length : typeof raw.slides})`,
      rawText,
      attempt,
    );
  }

  const rawSlides: CarouselWireSlide[] = raw.slides.map((slideRaw: unknown, index: number) => {
    if (!isPlainObject(slideRaw)) {
      throw new CarouselPlanSchemaError(`slides[${index}] is not an object`, rawText, attempt);
    }
    if (typeof slideRaw.slide_number !== "number") {
      throw new CarouselPlanSchemaError(`slides[${index}].slide_number must be a number`, rawText, attempt);
    }

    const imagePromptLength = typeof slideRaw.image_prompt === "string" ? slideRaw.image_prompt.trim().length : 0;
    if (typeof slideRaw.image_prompt !== "string" || imagePromptLength < MIN_IMAGE_PROMPT_LENGTH) {
      throw new CarouselPlanSchemaError(
        `slides[${index}].image_prompt must be a dense description of at least ${MIN_IMAGE_PROMPT_LENGTH} characters (got ${imagePromptLength})`,
        rawText,
        attempt,
      );
    }

    const compositionNoteLength =
      typeof slideRaw.composition_note === "string" ? slideRaw.composition_note.trim().length : 0;
    if (typeof slideRaw.composition_note !== "string" || compositionNoteLength < MIN_COMPOSITION_NOTE_LENGTH) {
      throw new CarouselPlanSchemaError(
        `slides[${index}].composition_note must be at least ${MIN_COMPOSITION_NOTE_LENGTH} characters (got ${compositionNoteLength})`,
        rawText,
        attempt,
      );
    }

    const rawTextBlocks = Array.isArray(slideRaw.text_blocks) ? slideRaw.text_blocks : [];
    const textBlocks: TextBlock[] = rawTextBlocks
      .filter(
        (block: unknown): block is { role: string; text: string } =>
          isPlainObject(block) &&
          TEXT_BLOCK_ROLE_SET.has(block.role as string) &&
          typeof block.text === "string" &&
          block.text.trim().length > 0,
      )
      .slice(0, 3)
      .map((block: { role: string; text: string }) => ({ role: block.role as TextBlock["role"], text: block.text }));

    // slide_number is normalized to index+1 below (not slideRaw.slide_number)
    // so a model that mis-numbers slides can never desync the per-slide loop.
    // role is a placeholder here — assignSlideRoles overwrites it below.
    return {
      slide_number: index + 1,
      image_prompt: slideRaw.image_prompt,
      role: "content",
      composition_note: slideRaw.composition_note,
      text_blocks: textBlocks,
    };
  });

  return {
    shared_style: raw.shared_style,
    layout_archetype_id: layoutArchetypeId,
    slides: assignSlideRoles(rawSlides),
    caption: raw.caption,
  };
}
