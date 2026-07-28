// server/services/style-reference.service.ts
//
// Phase 25 (PLAN-07) — Admin-Curated Style Reference Boards.
//
// Reference-image slot budgeting, extracted out of generate.routes.ts's
// inline two-tier merge block (lines 487-510, Phase 20) into a shared,
// testable service, and extended with a third tier.
//
// LOCKED PRIORITY ORDER (25-CONTEXT.md, "Admin-Curated Style Reference
// Boards"): when multiple reference-image sources compete for the limited
// multimodal image-slot budget, priority is —
//   1. user-uploaded images       (most specific intent)
//   2. brand reference photos    (established brand look)
//   3. style reference board     (general aesthetic direction, least specific)
// — filling remaining slots in that order, never exceeding the cap.
//
// REFERENCE_IMAGE_SLOT_LIMIT is the SAME 4-slot cap generate.routes.ts has
// always enforced (25-RESEARCH.md "Don't Hand-Roll": a second, slightly
// different cap invites drift). Both the single-image path (25-09) and the
// carousel path (25-12) consume this one implementation.

import { createAdminSupabase } from "../supabase.js";
import type { StyleReferenceScope } from "../../shared/schema.js";
import { MAX_STYLE_REFERENCE_PHOTOS } from "../../shared/schema.js";

export const REFERENCE_IMAGE_SLOT_LIMIT = 4;

export interface ReferenceImageData {
  mimeType: string;
  data: string;
}

export interface ReferenceSlotInput {
  userImages: ReferenceImageData[];
  brandPhotoUrls: string[];
  styleBoardPhotoUrls: string[];
  includeBrand?: boolean; // default true
  includeStyleBoard?: boolean; // default true
  limit?: number; // default REFERENCE_IMAGE_SLOT_LIMIT
}

export interface ReferenceSlotPlan {
  userImages: ReferenceImageData[];
  brandPhotoUrls: string[];
  styleBoardPhotoUrls: string[];
  usedSlots: number;
}

/**
 * Pure slot-priority merge. Fills the (limit)-slot budget strictly in tier
 * order — user images, then brand reference photos, then style board photos
 * — truncating each tier to whatever budget remains after the previous
 * tiers. A disabled tier (`includeBrand: false` / `includeStyleBoard: false`)
 * contributes an empty array WITHOUT consuming any slots — its slots simply
 * roll down to the next tier (or go unused if it's the last tier).
 *
 * Never mutates its inputs: every returned array is a fresh `.slice()`.
 * Ordering within each tier is preserved (input order in, input order out).
 */
export function planReferenceImageSlots(input: ReferenceSlotInput): ReferenceSlotPlan {
  const limit = input.limit ?? REFERENCE_IMAGE_SLOT_LIMIT;
  const includeBrand = input.includeBrand ?? true;
  const includeStyleBoard = input.includeStyleBoard ?? true;

  let remaining = limit;

  const userImages = input.userImages.slice(0, remaining);
  remaining -= userImages.length;

  const brandPhotoUrls = includeBrand ? input.brandPhotoUrls.slice(0, remaining) : [];
  if (includeBrand) {
    remaining -= brandPhotoUrls.length;
  }

  const styleBoardPhotoUrls = includeStyleBoard ? input.styleBoardPhotoUrls.slice(0, remaining) : [];
  if (includeStyleBoard) {
    remaining -= styleBoardPhotoUrls.length;
  }

  const usedSlots = userImages.length + brandPhotoUrls.length + styleBoardPhotoUrls.length;

  return { userImages, brandPhotoUrls, styleBoardPhotoUrls, usedSlots };
}

/**
 * Reads a platform-curated style reference board. Uses the service-role
 * client deliberately: generation runs server-side and must not depend on
 * the caller's RLS context. The table's public SELECT policy exists for
 * future client reads (25-CONTEXT.md locked decision), not for this call
 * path. Returns [] on any error — a missing board must never break a
 * generation.
 */
export async function fetchStyleBoardPhotoUrls(params: {
  scope: StyleReferenceScope;
  styleId: string | null | undefined;
  limit?: number; // default MAX_STYLE_REFERENCE_PHOTOS
}): Promise<string[]> {
  const { scope, styleId } = params;
  const limit = params.limit ?? MAX_STYLE_REFERENCE_PHOTOS;

  if (!styleId) {
    return [];
  }

  try {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from("style_reference_photos")
      .select("photo_url")
      .eq("scope", scope)
      .eq("style_id", styleId)
      .order("position", { ascending: true })
      .limit(limit);

    if (error) {
      console.warn(`[style-reference] fetchStyleBoardPhotoUrls failed for scope=${scope} styleId=${styleId}:`, error.message);
      return [];
    }

    return (data ?? []).map((row: { photo_url: string }) => row.photo_url);
  } catch (err) {
    console.warn(`[style-reference] fetchStyleBoardPhotoUrls threw for scope=${scope} styleId=${styleId}:`, (err as Error)?.message ?? err);
    return [];
  }
}

/**
 * Moved verbatim from generate.routes.ts (Phase 20). Parallel best-effort
 * downloads; failed fetches are dropped, order preserved. A failed download
 * silently shrinks the list — the model gets fewer references, never an
 * error.
 */
export async function fetchReferenceImagesAsBase64(photoUrls: string[]): Promise<ReferenceImageData[]> {
  const results = await Promise.all(
    photoUrls.map(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const contentType = response.headers.get("content-type") || "image/jpeg";
        const mimeType = contentType.split(";")[0].trim();
        const arrayBuffer = await response.arrayBuffer();
        return { mimeType, data: Buffer.from(arrayBuffer).toString("base64") };
      } catch {
        return null;
      }
    })
  );
  return results.filter((img): img is ReferenceImageData => img !== null);
}

/**
 * One-call resolver used by BOTH generation paths (single-image + carousel).
 * Applies the locked priority order and the 4-slot cap, then hydrates the
 * URL tiers to base64. A failed download silently shrinks the list — the
 * model gets fewer references, never an error.
 */
export async function resolveGenerationReferenceImages(params: {
  userImages: ReferenceImageData[];
  brandPhotoUrls: string[];
  brandStyleId?: string | null; // brands.mood — the style_catalog styles[] id
  postMoodId?: string | null; // the post_moods[] id
  includeBrand?: boolean;
  includeStyleBoard?: boolean;
  limit?: number;
}): Promise<{ images: ReferenceImageData[]; plan: ReferenceSlotPlan; styleBoardCount: number }> {
  const includeStyleBoard = params.includeStyleBoard ?? true;

  let styleBoardPhotoUrls: string[] = [];
  if (includeStyleBoard && (params.brandStyleId || params.postMoodId)) {
    const [stylePhotos, moodPhotos] = await Promise.all([
      params.brandStyleId
        ? fetchStyleBoardPhotoUrls({ scope: "style", styleId: params.brandStyleId })
        : Promise.resolve([]),
      params.postMoodId
        ? fetchStyleBoardPhotoUrls({ scope: "post_mood", styleId: params.postMoodId })
        : Promise.resolve([]),
    ]);
    // brand style before post mood, de-duplicated by URL.
    const seen = new Set<string>();
    styleBoardPhotoUrls = [...stylePhotos, ...moodPhotos].filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
  }

  const plan = planReferenceImageSlots({
    userImages: params.userImages,
    brandPhotoUrls: params.brandPhotoUrls,
    styleBoardPhotoUrls,
    includeBrand: params.includeBrand,
    includeStyleBoard: params.includeStyleBoard,
    limit: params.limit,
  });

  const [brandImgs, styleImgs] = await Promise.all([
    fetchReferenceImagesAsBase64(plan.brandPhotoUrls),
    fetchReferenceImagesAsBase64(plan.styleBoardPhotoUrls),
  ]);

  const images = [...plan.userImages, ...brandImgs, ...styleImgs];

  return { images, plan, styleBoardCount: styleImgs.length };
}
