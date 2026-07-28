/**
 * Style & Art Direction Service (Phase 25, PLAN-05).
 *
 * The single source of dense art-direction prompt text for BOTH the
 * single-image path (gemini.service.ts) and the carousel path
 * (carousel-generation.service.ts), which until now resolved the style
 * catalog completely differently (25-RESEARCH.md Pitfall 1: the carousel
 * path never resolved it at all).
 *
 * These are pure, side-effect-free prompt-fragment builders — no AI calls,
 * no I/O — so both generation paths inject IDENTICAL text through one
 * implementation, and behavior is provable without an AI call.
 *
 * This block must NEVER mention typography, fonts, lettering, or on-image text — Phase 23 (TYPO-01) already owns the text-free contract, and duplicating it here risks contradictory instructions.
 */

import type { ArtDirection, BrandStyle, PostMood, StyleCatalog } from "../../shared/schema.js";

export interface ResolvedCatalogEntries {
    brandStyle: BrandStyle | undefined;
    postMood: PostMood | undefined;
    /** brandStyle?.label || the raw brandMoodId, so a stale/unknown id still reads naturally in prompts */
    brandStyleLabel: string;
    /** postMood?.label || the raw postMoodId */
    postMoodLabel: string;
}

/**
 * Resolve the brand's chosen style + the post's chosen mood from the style
 * catalog. Falls back to the raw id as the label when the catalog has no
 * matching entry (e.g. a stale id left over from a since-edited catalog) —
 * never throws.
 */
export function resolveCatalogEntries(
    catalog: StyleCatalog,
    brandMoodId: string | null | undefined,
    postMoodId: string | null | undefined,
): ResolvedCatalogEntries {
    const brandStyle = brandMoodId
        ? catalog.styles.find((item) => item.id === brandMoodId)
        : undefined;
    const postMood = postMoodId
        ? catalog.post_moods.find((item) => item.id === postMoodId)
        : undefined;

    return {
        brandStyle,
        postMood,
        brandStyleLabel: brandStyle?.label || brandMoodId || "",
        postMoodLabel: postMood?.label || postMoodId || "",
    };
}

/**
 * The platform-wide anti-AI-look negative block (PLAN-05). Applied to EVERY
 * generation regardless of style/mood — this is a constant, not per-style
 * data. Ten distinct, concrete AI-look failure modes; comma-joined so both
 * `.split(",")` (harness) and direct string interpolation work.
 */
export const GLOBAL_ANTI_AI_NEGATIVE_PROMPT: string = [
    "plastic waxy skin",
    "warped or extra fingers",
    "melted or garbled background signage",
    "symmetrical stock-photo staging",
    "over-smoothed HDR glow",
    "uncanny hyper-saturated color",
    "floating detached objects",
    "mismatched shadow directions",
    "generic gradient-blob backgrounds",
    "overly airbrushed plastic-looking retouching",
].join(", ");

/** Renders an ArtDirection's non-empty fields as `- Label: value` lines, in a
 *  fixed order. Empty fields are omitted rather than emitted as blank lines. */
function formatArtDirectionLines(art: ArtDirection | undefined): string[] {
    if (!art) return [];
    const lines: string[] = [];
    if (art.photography_type) lines.push(`- Photography: ${art.photography_type}`);
    if (art.lighting) lines.push(`- Lighting: ${art.lighting}`);
    if (art.composition) lines.push(`- Composition: ${art.composition}`);
    if (art.texture) lines.push(`- Texture: ${art.texture}`);
    return lines;
}

/** True when every dense-content field of an ArtDirection is empty (the
 *  EMPTY_ART_DIRECTION shape, or a catalog entry that predates PLAN-05). */
function isArtDirectionEmpty(art: ArtDirection | undefined): boolean {
    if (!art) return true;
    return !art.photography_type && !art.lighting && !art.composition && !art.texture;
}

/**
 * Renders the resolved style + mood into one dense, injectable art-direction
 * block. Plain prose lines only — no JSON, no markdown headings a model might
 * render onto the image. Returns "" only when the catalog itself is unusable
 * (both ids missing, so there is nothing at all — not even a raw id label —
 * to describe).
 *
 * With a fully-populated entry, includes each of photography_type/lighting/
 * composition/texture verbatim. With EMPTY_ART_DIRECTION on an entry, the
 * art-direction lines are omitted but the label/description line is always
 * kept, so the block is never a broken/empty fragment. With an unknown style
 * id, falls back to the raw id as the label and omits the art-direction
 * lines entirely (there is no catalog entry to source them from).
 */
export function buildStyleArtDirectionBlock(entries: ResolvedCatalogEntries): string {
    const { brandStyle, postMood, brandStyleLabel, postMoodLabel } = entries;

    if (!brandStyleLabel && !postMoodLabel) return "";

    const blocks: string[] = [];

    if (brandStyleLabel) {
        const desc = brandStyle?.description ? ` (${brandStyle.description})` : "";
        blocks.push(`Brand style: ${brandStyleLabel}${desc}`);
        if (!isArtDirectionEmpty(brandStyle?.art_direction)) {
            blocks.push(...formatArtDirectionLines(brandStyle?.art_direction));
        }
    }

    if (postMoodLabel) {
        const desc = postMood?.description ? ` (${postMood.description})` : "";
        blocks.push(`Post mood: ${postMoodLabel}${desc}`);
        if (!isArtDirectionEmpty(postMood?.art_direction)) {
            blocks.push(...formatArtDirectionLines(postMood?.art_direction));
        }
    }

    if (brandStyleLabel && postMoodLabel) {
        blocks.push(
            "When the style and mood art direction conflict, the brand style governs the overall look and the post mood governs the situation being depicted.",
        );
    }

    return blocks.join("\n");
}

/**
 * Merges the platform-wide anti-AI-look constant with both resolved entries'
 * `negative_prompts`, de-duplicated case-insensitively (global entries first,
 * then style, then mood — first occurrence wins on a case-insensitive key),
 * joined into one "Avoid: ..." sentence.
 */
export function buildNegativePromptBlock(entries: ResolvedCatalogEntries): string {
    const { brandStyle, postMood } = entries;

    const globalItems = GLOBAL_ANTI_AI_NEGATIVE_PROMPT.split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const styleItems = brandStyle?.art_direction?.negative_prompts ?? [];
    const moodItems = postMood?.art_direction?.negative_prompts ?? [];

    const seen = new Set<string>();
    const merged: string[] = [];
    for (const item of [...globalItems, ...styleItems, ...moodItems]) {
        const trimmed = item.trim();
        const key = trimmed.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(trimmed);
    }

    return `Avoid: ${merged.join(", ")}.`;
}
