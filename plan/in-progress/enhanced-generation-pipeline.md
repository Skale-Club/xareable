# Plan: Enhanced Reference Image Handling, Logo Integration & Prompt Engineering

**Status:** IMPLEMENTED (Phases 1-3)
**Date:** 2026-03-09

## Context

The current content generation system has several critical gaps that prevent it from fully utilizing user-provided reference materials and brand assets:

1. **Reference Images Are Not Fully Leveraged**: While reference images are passed to the AI models, they are not being used intelligently. For example, if a user uploads a Pepsi can photo and describes a Christmas event, the system should use that specific can design in the generated content, not create a generic can.

2. **Logo Not Actually Used**: The brand logo uploaded during onboarding is stored as a URL but never downloaded or passed as an image to the AI model. Instead, only a text description is included in the prompt, causing Gemini to generate a generic logo rather than using the actual brand logo.

3. **Multiple Reference Images Not Combined**: When users upload multiple reference images (e.g., a dog photo + a person photo), these should be intelligently combined in the output, but currently only the first reference is used for video generation.

4. **Prompt Engineering Not Optimal**: The current prompts don't leverage JSON-structured instructions that would give the AI clearer, more precise guidance (as demonstrated in Nano Banana 2 best practices).

5. **No Brand Designer Persona**: The AI is not explicitly positioned as a professional designer working for the specific brand, which would improve context and quality.

---

## Implementation Plan

### Phase 1: Logo Download & Integration (HIGH PRIORITY)

**Problem**: Brand logo URL is only mentioned in text prompts; the actual logo image is never passed to Gemini.

**Solution**: Download the logo from Supabase Storage and include it as a reference image in generation requests.

#### Files to Modify:
- `server/app-routes.ts` (POST `/api/generate` endpoint, ~line 587)
- `server/app-routes.ts` (POST `/api/edit-post` endpoint, ~line 1194)

#### Steps:
1. Create `downloadLogoAsBase64(logoUrl)` helper function
2. In `/api/generate`: download logo, add as reference image to both text + image generation
3. For image generation: add logo as FIRST reference image (highest priority)
4. For video generation: add logo as context image (not starting frame)
5. In `/api/edit-post`: include logo as reference when editing images

---

### Phase 2: Enhanced Prompt Engineering with JSON Structure (HIGH PRIORITY)

**Problem**: Current prompts use plain text which is less precise and harder for the AI to parse consistently.

**Solution**: Implement JSON-structured prompts with explicit field-level instructions.

#### Files to Modify:
- `server/app-routes.ts` (context prompt building, ~line 780)
- `server/services/gemini.service.ts` (buildContextPrompt method, ~line 47)

#### Steps:
1. Rewrite context prompt with brand designer persona ("You are a PROFESSIONAL BRAND DESIGNER working for {brand}")
2. Add structured JSON brand design system block (client, visual_identity, content_requirements, reference_materials)
3. Add explicit reference image analysis instructions (visual style, key objects, context clues)
4. Add logo integration requirements section (exact logo, position, size, integration style)
5. Add multi-reference combination strategy section
6. Request structured JSON output from text model (image_prompt as object with composition, visual_style, color_specification, required_elements, text_rendering, logo_integration)
7. For video: request video_prompt with shot_sequence, audio_cues, motion_quality
8. Create `buildImagePromptFromStructuredJson()` helper to flatten JSON → text prompt for image model
9. Create `buildVideoPromptFromStructuredJson()` helper to flatten JSON → text prompt for Veo
10. Update JSON parsing to handle both flat (backwards-compat) and nested structures

---

### Phase 3: Multi-Reference Image Intelligence (MEDIUM PRIORITY)

**Problem**: Multiple reference images are not intelligently combined. Only the first is used for video.

**Solution**: Enhance text generation prompt + update video API call to support multiple references.

#### Files to Modify:
- `server/app-routes.ts` (context prompt + video generation, ~line 780, ~line 926)

#### Steps:
1. Add multi-reference analysis instructions to text prompt (combine subjects, extract styles, maintain hierarchy)
2. Update Veo video API call: use first image as starting frame, additional images as `reference_images` array (up to 3)

---

### Phase 4: Reference Image Storage & Audit Trail (LOW PRIORITY - DEFERRED)

Not implementing in this iteration. Can be added later if needed.

---

## Critical Files to Modify

| File | Changes |
|------|---------|
| `server/app-routes.ts` | Logo download helper, enhanced prompt, multi-ref video support |
| `server/services/gemini.service.ts` | Update buildContextPrompt (if used by other routes) |

## Existing Functions to Reuse

- `supabase.storage.from("user_assets").upload()` — logo upload pattern (onboarding.tsx:101)
- `supabase.storage.from("user_assets").getPublicUrl()` — public URL pattern (onboarding.tsx:117)
- `Buffer.from(data, 'base64')` — image decoding (app-routes.ts:1075)
- `fetch(url)` — standard for downloading remote assets

## Implementation Order

1. **Phase 1** (Logo Download): HIGHEST IMPACT — fixes the most visible issue
2. **Phase 2** (JSON Prompts): HIGH IMPACT — significantly improves quality
3. **Phase 3** (Multi-Reference): MEDIUM IMPACT — enables advanced use cases

## Verification Steps

1. Upload a distinctive logo → generate with "Include Logo" → verify ACTUAL logo appears
2. Upload product photo + describe context → verify specific product used in output
3. Upload 2-3 reference images → verify all elements appear combined
4. Generate video with references → verify first ref as starting frame
5. Edit existing post with logo → verify logo in edited version
6. Run `npm run check` to verify TypeScript compiles
