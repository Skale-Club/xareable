// Functional test for CRSL2-01: the pure deterministic role-assignment +
// inter-slide composition-variation logic (no AI, no network, no DB, no
// Supabase). Run:
//   npx tsx scripts/test-carousel-narrative-plan.ts
import {
  assignSlideRoles,
  compositionNotesAreVaried,
  findDuplicateCompositionNotes,
} from "../server/services/carousel-plan-schema.js";

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    console.error(`FAIL ${label}\n  expected: ${expectedStr}\n  actual:   ${actualStr}`);
    process.exit(1);
  }
  console.log(`PASS ${label}`);
}

function assertTrue(label: string, cond: boolean): void {
  if (!cond) {
    console.error(`FAIL ${label}`);
    process.exit(1);
  }
  console.log(`PASS ${label}`);
}

// ── Fixture builders ────────────────────────────────────────────────────────

interface FixtureSlide {
  slide_number: number;
  role: string;
  image_prompt: string;
}

function slide(slideNumber: number, role: string): FixtureSlide {
  return { slide_number: slideNumber, role, image_prompt: `prompt for slide ${slideNumber}` };
}

function noteSlide(slideNumber: number, compositionNote: string): { slide_number: number; composition_note: string } {
  return { slide_number: slideNumber, composition_note: compositionNote };
}

// ── assignSlideRoles ─────────────────────────────────────────────────────────

{
  // The model deliberately emits the SAME wrong role ("cta") on every slide
  // here — the server must overwrite every one of them regardless of what the
  // model guessed. This is the locked 25-CONTEXT.md decision: role is never
  // model-decided.
  const input = [slide(1, "cta"), slide(2, "cta"), slide(3, "cta")];
  const result = assignSlideRoles(input);
  assertEqual(
    "assignSlideRoles: 3 slides -> [hook, content, cta] regardless of model's own role guess",
    result.map((s) => s.role),
    ["hook", "content", "cta"],
  );
}

{
  const input = Array.from({ length: 8 }, (_, i) => slide(i + 1, "content"));
  const result = assignSlideRoles(input);
  assertEqual(
    "assignSlideRoles: 8 slides -> hook + 6x content + cta",
    result.map((s) => s.role),
    ["hook", "content", "content", "content", "content", "content", "content", "cta"],
  );
}

{
  const result = assignSlideRoles([slide(1, "hook"), slide(2, "hook")]);
  assertEqual("assignSlideRoles: 2 slides -> [hook, cta]", result.map((s) => s.role), ["hook", "cta"]);
}

{
  const result = assignSlideRoles([slide(1, "cta")]);
  assertEqual("assignSlideRoles: 1 slide -> [hook] (hook wins over cta)", result.map((s) => s.role), ["hook"]);
}

{
  const input = [slide(1, "cta"), slide(2, "cta")];
  const result = assignSlideRoles(input);
  assertTrue(
    "assignSlideRoles: returns a NEW array (not the same reference as the input)",
    (result as unknown) !== (input as unknown),
  );
  assertTrue(
    "assignSlideRoles: does NOT mutate the input objects (input[0].role/input[1].role still 'cta')",
    input[0].role === "cta" && input[1].role === "cta",
  );
}

// ── findDuplicateCompositionNotes / compositionNotesAreVaried ───────────────

{
  const slides = [
    noteSlide(1, "Wide establishing shot of the entire cafe interior with morning light"),
    noteSlide(2, "Extreme close-up macro detail of ceramic mug texture and steam"),
    noteSlide(3, "Overhead flat-lay of pastries arranged on a marble counter"),
  ];
  assertEqual(
    "findDuplicateCompositionNotes: 3 genuinely different notes -> []",
    findDuplicateCompositionNotes(slides),
    [],
  );
  assertTrue("compositionNotesAreVaried: true for 3 genuinely different notes", compositionNotesAreVaried(slides));
}

{
  const note = "Wide establishing shot of the cafe";
  const slides = [noteSlide(1, note), noteSlide(2, note)];
  const dupes = findDuplicateCompositionNotes(slides);
  assertEqual("findDuplicateCompositionNotes: two byte-identical notes -> 1 pair", dupes.length, 1);
  assertEqual("findDuplicateCompositionNotes: byte-identical pair has similarity 1", dupes[0]?.similarity, 1);
  assertTrue("compositionNotesAreVaried: false for byte-identical notes", !compositionNotesAreVaried(slides));
}

{
  const slides = [
    noteSlide(1, "Wide establishing shot of the cafe"),
    noteSlide(2, "wide establishing shot of the cafe!"),
  ];
  const dupes = findDuplicateCompositionNotes(slides);
  assertEqual(
    "findDuplicateCompositionNotes: case/punctuation-only difference -> 1 pair (normalization)",
    dupes.length,
    1,
  );
}

{
  const slides = [
    noteSlide(1, "Wide establishing shot of the busy cafe interior"),
    noteSlide(2, "Wide establishing shot of a busy cafe interior"),
  ];
  const dupes = findDuplicateCompositionNotes(slides);
  assertEqual(
    "findDuplicateCompositionNotes: near-identical framing (token Jaccard >= threshold) -> 1 pair",
    dupes.length,
    1,
  );
}

{
  const slides = [noteSlide(1, ""), noteSlide(2, "")];
  const dupes = findDuplicateCompositionNotes(slides);
  assertEqual("findDuplicateCompositionNotes: two empty-string notes are treated as duplicates", dupes.length, 1);
  assertEqual("findDuplicateCompositionNotes: empty-string duplicate pair has similarity 1", dupes[0]?.similarity, 1);
}

console.log("\nAll carousel narrative plan assertions passed.");
