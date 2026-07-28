/**
 * Phase 25 (CRSL2-01) — the carousel narrative-plan structured-output contract.
 * Mirrors `planning-schema.service.ts`'s dual-dialect discipline (the same
 * module Phase 22's single-image art-director planning call uses): TWO schema
 * literals will be exported here (added by Task 2) because the two transports
 * use INCOMPATIBLE dialects — OpenRouter's `response_format.json_schema` is
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

import { type LayoutArchetypeId } from "./planning-schema.service.js";
import type { TextBlock } from "../../shared/schema.js";

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
