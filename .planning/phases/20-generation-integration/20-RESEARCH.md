# Phase 20: Generation Integration - Research

**Researched:** 2026-05-16
**Domain:** Zod schema extension, Express route injection, React dialog state + query
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Schema: add `use_brand_references: z.boolean().optional()` to `generateRequestSchema` after `reference_images` field
- Server: add `fetchBrandReferenceImagesAsBase64` helper at module scope before the route handler; inject brand reference photos using the `supabase` user-scoped client (RLS); merge with user images (user takes first slots, brand fills remainder up to 4 total)
- Client: new `useBrandReferences` state (default `true`); new `useQuery` for `/api/brand/reference-photos`; conditional checkbox toggle above Generate button shown only when `hasBrandReferences && contentType === "image"`; `use_brand_references` added to fetchSSE payload
- Scope: ONLY `/api/generate` route is modified. Carousel and enhancement routes are NOT touched.
- Verification: `scripts/verify-phase-20.ts` static checks (string-presence in files + `npm run check`)

### Claude's Discretion

- Placement of the `fetchBrandReferenceImagesAsBase64` helper: anywhere at module scope before the route handler (`router.post`)
- Exact formatting/indentation of inserted code blocks (match surrounding style)

### Deferred Ideas (OUT OF SCOPE)

- Carousel route injection (v1.6)
- Enhancement route injection (v1.6)
- Style description injected into text generation prompt
- Per-photo selection UI in creator dialog
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GEN-01 | Creator dialog toggle — "Use my style references" checkbox, shown ONLY when `contentType === "image"` AND brand has ≥1 saved photo; checked by default; ephemeral per-generation | Exact insertion lines confirmed for state var, query, toggle, payload, and reset |
| GEN-02 | Server-side injection — fetch brand photos, download as base64, merge with user inline reference_images (user takes priority, total ≤ 4 slots) | Exact lines confirmed for schema field, destructure, helper function, merge logic, downstream uses |
</phase_requirements>

---

## Summary

Phase 20 closes the loop between brand reference photos (stored in Phase 18, manageable in Phase 19) and AI image generation. The work is surgical: three files change, all edits are additive with no refactoring.

The server side adds one module-level helper function and replaces a single `const referenceImageBase64` line with a richer merge block. All downstream consumers of reference images switch from the old constant to `mergedReferenceImages`. The client side adds one state var, one `useQuery` call, one conditional JSX block, and one payload field.

**Primary recommendation:** Execute as three sequential tasks — (1) schema field, (2) server route edits, (3) client dialog edits — then run `npm run check` and the verification script.

---

## Standard Stack

All libraries already in the project. No new dependencies.

| Library | Purpose | Used In |
|---------|---------|---------|
| Zod | Schema validation | `shared/schema.ts` |
| Express 5 | Route handler | `server/routes/generate.routes.ts` |
| Supabase JS (server) | `brand_reference_photos` query via user-scoped client | `generate.routes.ts` (existing `supabase` var) |
| Node.js `fetch` (global) | Download brand photo URLs as ArrayBuffer | `fetchBrandReferenceImagesAsBase64` helper |
| TanStack Query v5 | Client-side brand ref photos count query | `post-creator-dialog.tsx` |
| React `useState` | `useBrandReferences` ephemeral state | `post-creator-dialog.tsx` |

**Node.js `fetch` availability:** Node 24.13.0 is running on this machine (verified with `node --version`). Global `fetch` has been stable since Node 18. No `import fetch from 'node-fetch'` required — use `fetch(url)` directly.

---

## Exact Line Numbers — Confirmed

### shared/schema.ts

| What | Line | Action |
|------|------|--------|
| `generateRequestSchema` opens | 877 | Context |
| `reference_images` field ends (line 882: `.optional(),`) | 882 | Insert `use_brand_references` AFTER this line |
| `post_mood` field (currently line 883) | 883 | Will shift to 884 after insert |
| `generateRequestSchema` closes | 904 | Context |

**Insert after line 882:**
```typescript
  use_brand_references: z.boolean().optional(),
```

`BrandReferencePhotosResponse` is already exported from `shared/schema.ts` at line 91 — no new type needed in schema.ts.

---

### server/routes/generate.routes.ts

#### Module-scope helper insertion point

The file has two existing module-scope functions before `const router = Router()` (line 161):
- `logGenerationError` (lines 32–64)
- `sanitizeRequestForLogging` (lines 66–89)
- `buildTextFallback` (lines 91–153)
- `calculatePostExpirationIso` (lines 155–159)

**Insert `fetchBrandReferenceImagesAsBase64` after line 159** (after `calculatePostExpirationIso`) and before line 161 (`const router = Router()`).

#### Destructure block

| Lines | Content | Action |
|-------|---------|--------|
| 258–276 | `const { reference_text, reference_images, post_mood, ..., video_duration } = parseResult.data;` | Add `use_brand_references,` to the destructure list (after `reference_images,` on line 260) |

Current line 260: `        reference_images,`
Insert `        use_brand_references,` after line 260.

#### referenceImageBase64 replacement

| Lines | Current Content | Action |
|-------|----------------|--------|
| 370–371 | `// Extract base64 images from reference_images if provided` / `const referenceImageBase64 = reference_images?.map(img => img.data);` | Replace lines 370–371 with the full merge block |

**Replace lines 370–371 with:**
```typescript
        // Build final reference image list: user images fill first, brand fills remainder (≤ 4 total)
        const userRefImages: Array<{ mimeType: string; data: string }> = (reference_images || []).map(img => ({
            mimeType: img.mimeType,
            data: img.data,
        }));

        let mergedReferenceImages = userRefImages;

        if (use_brand_references !== false && userRefImages.length < 4) {
            const slotsRemaining = 4 - userRefImages.length;
            const { data: brandPhotos } = await supabase
                .from("brand_reference_photos")
                .select("photo_url")
                .eq("brand_id", brand.id)
                .order("position", { ascending: true })
                .limit(slotsRemaining);

            if (brandPhotos && brandPhotos.length > 0) {
                const brandImgs = await fetchBrandReferenceImagesAsBase64(
                    brandPhotos.map((p: { photo_url: string }) => p.photo_url)
                );
                mergedReferenceImages = [...userRefImages, ...brandImgs];
            }
        }
```

#### Downstream uses of reference images — CRITICAL TYPE SPLIT

There are TWO different `referenceImages` parameter signatures in the codebase:

| Consumer | Parameter type | Notes |
|----------|---------------|-------|
| `gemini.generateText()` (line 382) | `string[]` — base64 only | `referenceImageBase64` was already `.map(img => img.data)` |
| `generateVideo()` (line 437) | `Array<{ mimeType: string; data: string }>` | Takes full objects |
| `generateImageAsset()` (line 457) | `Array<{ mimeType: string; data: string }>` | Takes full objects |
| Thumbnail (line 492) | `Buffer.from(data, 'base64')` — reads `.data` field directly | |

This means the merge logic must produce `Array<{ mimeType: string; data: string }>` (which it does), but the `generateText` call must extract only `.data` strings:

| Location | Line | Old value | New value |
|----------|------|-----------|-----------|
| `gemini.generateText` `referenceImages:` arg | 382 | `referenceImageBase64` | `mergedReferenceImages.map(img => img.data)` |
| `generateVideo` `referenceImages:` arg | 437 | `reference_images` | `mergedReferenceImages` |
| `generateImageAsset` `referenceImages:` arg | 457 | `reference_images || []` | `mergedReferenceImages` |
| Thumbnail guard | 491 | `if (reference_images?.[0])` | `if (mergedReferenceImages[0])` |
| Thumbnail buffer | 492 | `Buffer.from(reference_images[0].data, 'base64')` | `Buffer.from(mergedReferenceImages[0].data, 'base64')` |

**Line 437 exact context:**
```typescript
referenceImages: reference_images,   // currently
referenceImages: mergedReferenceImages,  // after change
```

**Line 457 exact context:**
```typescript
referenceImages: reference_images || [],   // currently
referenceImages: mergedReferenceImages,    // after change (already [] if no refs)
```

#### supabase variable name

Confirmed at line 184: `const { user, supabase } = authResult;`
The `supabase` variable is the user-scoped client (RLS active). It is already in scope at line 370 where the merge block runs. No import or new variable needed.

#### brand.id availability

Confirmed: `brand` is fetched at lines 209–213 with `select("*")`, so `brand.id` is available. The merge block (replacing lines 370–371) runs after line 209.

---

### client/src/components/post-creator-dialog.tsx

#### @shared/schema import (lines 50–57)

```typescript
import {
  DEFAULT_STYLE_CATALOG,
  MAX_FEATURED_POST_MOODS_PER_STYLE,
  type CreditStatus,
  type GenerateResponse,
  type StyleCatalog,
  type TextRenderMode,
} from "@shared/schema";
```

**Add `type BrandReferencePhotosResponse,` to this import block.** `BrandReferencePhotosResponse` is exported from `shared/schema.ts` at line 91 (confirmed). Insert after line 53 (`type CreditStatus,`) or anywhere in the list.

#### useBrandReferences state var

State vars block starts at line 228. Last state var before the first `useQuery` is at line 283 (`isEnhancementDragActive`). The first `useQuery` is at line 284.

**Insert the new state var after line 283** (before the first `useQuery`):
```tsx
  const [useBrandReferences, setUseBrandReferences] = useState(true);
```

#### New useQuery insertion point

The existing queries are:
- Line 284: `const { data: creditStatus } = useQuery<CreditStatus>({...})` (ends ~line 289)
- Line 290: `const { data: styleCatalog } = useQuery<StyleCatalog>({...})` (ends ~line 293)

**Insert the new brand ref photos query after line 293** (end of `styleCatalog` query):
```tsx
  const { data: brandRefPhotos } = useQuery<BrandReferencePhotosResponse>({
    queryKey: ["/api/brand/reference-photos"],
    enabled: !!brand && contentType === "image",
  });
  const hasBrandReferences = (brandRefPhotos?.photos?.length ?? 0) > 0;
```

**Note on `enabled` guard:** `contentType` is initialized at line 229 with `ENABLED_CONTENT_TYPES[0]` which is `"image"` (the first enabled type). The query will only fire when the dialog is showing image content type and `brand` is available. TanStack Query v5 supports `enabled` with runtime state — no issues.

#### fetchSSE payload insertion point

The `fetchSSE` call is at line 677. The payload object ends at line 698 with `video_duration: isVideo ? videoDuration : undefined,`. 

**Insert after line 698** (after `video_duration` field, before the closing `},`):
```tsx
        use_brand_references: hasBrandReferences ? useBrandReferences : undefined,
```

#### Toggle insertion point

Lines 1966–1979 are the `div className="flex flex-col items-end gap-3"` container:
```tsx
<div className="flex flex-col items-end gap-3">
  {creditStatus && creditStatus.free_generations_remaining > 0 && (...)}
  <Button onClick={handleGenerateClick} ...>...</Button>
</div>
```

**Insert the toggle BEFORE the `<Button>` at line 1975**, inside the container:
```tsx
{hasBrandReferences && contentType === "image" && (
  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
    <input
      type="checkbox"
      checked={useBrandReferences}
      onChange={(e) => setUseBrandReferences(e.target.checked)}
      className="rounded"
      data-testid="checkbox-use-brand-references"
    />
    {t("Use my style references")}
  </label>
)}
```

#### Reset on dialog close

The `useEffect` at line 329 handles the close path (when `!isOpen`). The block runs from ~line 339 to line 371. **Add `setUseBrandReferences(true);` anywhere inside this close block**, matching the pattern of the other state resets. A natural placement is after `setUseLogo(false);` at line 347.

---

## Architecture Patterns

### Pattern 1: Module-scope async helper before route handler
All existing module-scope helper functions in `generate.routes.ts` (`logGenerationError`, `sanitizeRequestForLogging`, `buildTextFallback`, `calculatePostExpirationIso`) are placed before `const router = Router()` at line 161. The new `fetchBrandReferenceImagesAsBase64` follows this exact pattern.

### Pattern 2: User-scoped Supabase client for brand data
The pattern throughout the route is to use `supabase` (user-scoped, from `authenticateUser`) for all user-owned data operations. Admin client (`createAdminSupabase()`) is only used for storage uploads (line 479). Brand reference photos are user-owned → use `supabase`, not admin client. RLS handles access control automatically.

### Pattern 3: Best-effort with silent skip
The `fetchBrandReferenceImagesAsBase64` helper uses `try/catch` per URL and continues on failure. This matches the project's pattern for non-critical AI pipeline steps (see logo overlay at line 553: `console.warn("Logo overlay failed, continuing without overlay:")`).

### Pattern 4: TanStack Query v5 conditional query
Existing example in the dialog at line 284:
```tsx
const { data: creditStatus } = useQuery<CreditStatus>({
  queryKey: ["/api/credits/check?operation=generate"],
  enabled: isOpen && !usesOwnApiKey,
  ...
});
```
The new brand ref query follows identical structure with `enabled: !!brand && contentType === "image"`.

### Anti-Patterns to Avoid
- **Do NOT import `node-fetch`**: Node 24 has global `fetch`. Adding an import would cause a redundancy and potential type conflict.
- **Do NOT use admin client for brand_reference_photos query**: The route already has the user-scoped `supabase` client in scope. Using `createAdminSupabase()` here would bypass RLS unnecessarily and is inconsistent with the established pattern.
- **Do NOT exceed 4 slots**: The merge block uses `slotsRemaining = 4 - userRefImages.length` and `.limit(slotsRemaining)`. This is load-bearing for Gemini's 4-image limit.
- **Do NOT pass `mergedReferenceImages` (objects) to `gemini.generateText()`**: That function expects `string[]` (base64 only). Use `.map(img => img.data)` at line 382.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Fetch image from URL as base64 | Custom streaming parser | `fetch(url).then(r => r.arrayBuffer()).then(buf => Buffer.from(buf).toString('base64'))` |
| Type the brand photos query result | Custom interface | `BrandReferencePhotosResponse` already in `shared/schema.ts` line 91 |
| Limit brand photos to remaining slots | Manual slice after fetch | `.limit(slotsRemaining)` in Supabase query |

---

## Common Pitfalls

### Pitfall 1: Type mismatch on `gemini.generateText` referenceImages
**What goes wrong:** Passing `mergedReferenceImages` (which is `Array<{ mimeType: string; data: string }>`) to `gemini.generateText()` which expects `string[]`. TypeScript will catch this at `npm run check` but only if the type is not `any`.

**How to avoid:** At line 382, always use `mergedReferenceImages.map(img => img.data)` — not the raw array.

**Warning signs:** TypeScript error on `referenceImages` arg in `generateText` call.

### Pitfall 2: Merge block runs inside SSE try block, but supabase query failure is not caught
**What goes wrong:** If the `supabase.from("brand_reference_photos")` query throws (network error, schema issue), it will propagate up and trigger the outer SSE error handler.

**How to avoid:** The merge block is inside the outer `try` at line 360. If the Supabase query returns `{ data: null, error: ... }` (typical pattern), the `if (brandPhotos && brandPhotos.length > 0)` guard silently skips. For hard throws, the outer catch logs and surfaces an error — this is acceptable behavior (generation fails cleanly rather than silently ignoring a critical error).

### Pitfall 3: `hasBrandReferences` computed outside component render scope
**What goes wrong:** The query `enabled: !!brand && contentType === "image"` means `brandRefPhotos` is `undefined` when `contentType !== "image"`. The `hasBrandReferences` derived value correctly handles this with `?? 0` fallback — no issue. But if `contentType` changes to `"image"` after the component mounts, the query will fire on re-render automatically.

**How to avoid:** Pattern is correct as specified. No additional guard needed.

### Pitfall 4: Reset omission — useBrandReferences not reset on close
**What goes wrong:** If the user unchecks the toggle, closes the dialog, and reopens it, the checkbox shows unchecked instead of defaulting to `true`.

**How to avoid:** Add `setUseBrandReferences(true);` in the close path of the `useEffect` at line 329–372. Confirmed that the close path is the `!isOpen` branch (else of the `if (isOpen)` guard at line 330).

### Pitfall 5: `use_brand_references: undefined` vs omitted in payload
**What goes wrong:** Sending `use_brand_references: undefined` in the fetchSSE payload is equivalent to omitting it (JSON.stringify drops `undefined` keys). The server receives no field and Zod's `.optional()` returns `undefined` — the condition `use_brand_references !== false` evaluates to `true`, so brand references ARE injected. This is the desired default behavior.

**How to avoid:** `use_brand_references: hasBrandReferences ? useBrandReferences : undefined` — when `hasBrandReferences` is false (no brand photos), we send `undefined`, which causes no injection (Supabase query will return 0 rows anyway). When brand has photos and toggle is checked, we send `true`. When unchecked, we send `false`, which skips injection. Logic is correct.

---

## Code Examples

### fetchBrandReferenceImagesAsBase64 (module scope, after line 159)
```typescript
// Source: CONTEXT.md locked decision
async function fetchBrandReferenceImagesAsBase64(
    photoUrls: string[]
): Promise<Array<{ mimeType: string; data: string }>> {
    const results: Array<{ mimeType: string; data: string }> = [];
    for (const url of photoUrls) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const contentType = response.headers.get("content-type") || "image/jpeg";
            const mimeType = contentType.split(";")[0].trim();
            const arrayBuffer = await response.arrayBuffer();
            results.push({ mimeType, data: Buffer.from(arrayBuffer).toString("base64") });
        } catch {
            // best-effort — skip failed fetches silently
        }
    }
    return results;
}
```

### Merge block (replaces lines 370–371)
```typescript
        // Build final reference image list: user images fill first, brand fills remainder (≤ 4 total)
        const userRefImages: Array<{ mimeType: string; data: string }> = (reference_images || []).map(img => ({
            mimeType: img.mimeType,
            data: img.data,
        }));

        let mergedReferenceImages = userRefImages;

        if (use_brand_references !== false && userRefImages.length < 4) {
            const slotsRemaining = 4 - userRefImages.length;
            const { data: brandPhotos } = await supabase
                .from("brand_reference_photos")
                .select("photo_url")
                .eq("brand_id", brand.id)
                .order("position", { ascending: true })
                .limit(slotsRemaining);

            if (brandPhotos && brandPhotos.length > 0) {
                const brandImgs = await fetchBrandReferenceImagesAsBase64(
                    brandPhotos.map((p: { photo_url: string }) => p.photo_url)
                );
                mergedReferenceImages = [...userRefImages, ...brandImgs];
            }
        }
```

### Client query + derived value (insert after line 293)
```tsx
  const { data: brandRefPhotos } = useQuery<BrandReferencePhotosResponse>({
    queryKey: ["/api/brand/reference-photos"],
    enabled: !!brand && contentType === "image",
  });
  const hasBrandReferences = (brandRefPhotos?.photos?.length ?? 0) > 0;
```

### Toggle JSX (insert before line 1975)
```tsx
{hasBrandReferences && contentType === "image" && (
  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
    <input
      type="checkbox"
      checked={useBrandReferences}
      onChange={(e) => setUseBrandReferences(e.target.checked)}
      className="rounded"
      data-testid="checkbox-use-brand-references"
    />
    {t("Use my style references")}
  </label>
)}
```

---

## Environment Availability

Step 2.6: SKIPPED — this phase is code-only changes with no new external tool dependencies. Node.js global `fetch` is confirmed available (Node 24.13.0). Supabase and the existing stack are already in use.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Static TypeScript check + verification script |
| Config file | `tsconfig.json` |
| Quick run command | `npm run check` |
| Full suite command | `npx tsx scripts/verify-phase-20.ts && npm run check` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command |
|--------|----------|-----------|-------------------|
| GEN-01 | `checkbox-use-brand-references` exists in dialog | static | `npx tsx scripts/verify-phase-20.ts` |
| GEN-01 | `useBrandReferences` + `hasBrandReferences` in dialog file | static | `npx tsx scripts/verify-phase-20.ts` |
| GEN-02 | `fetchBrandReferenceImagesAsBase64` in route | static | `npx tsx scripts/verify-phase-20.ts` |
| GEN-02 | `mergedReferenceImages` + `brand_reference_photos` in route | static | `npx tsx scripts/verify-phase-20.ts` |
| GEN-02 | `use_brand_references` in schema + route + dialog | static | `npx tsx scripts/verify-phase-20.ts` |
| Both | All types resolve | type check | `npm run check` |

### Wave 0 Gaps
- [ ] `scripts/verify-phase-20.ts` — does not exist yet; must be created in Wave 0

---

## Open Questions

1. **`use_brand_references: true` sent explicitly vs `undefined` when toggle is checked**
   - What we know: JSON.stringify drops `undefined` fields; sending `true` vs omitting both result in `use_brand_references !== false` being `true` on the server.
   - What's unclear: Whether to always send `true` when checked or send `undefined`.
   - Recommendation: Send explicit `true` when checked and `false` when unchecked (only send `undefined` when `!hasBrandReferences`). This makes the intent clearer in logs.

2. **Thumbnail for video from `mergedReferenceImages`**
   - What we know: Line 491 checks `reference_images?.[0]` for video thumbnail generation. After the change it becomes `mergedReferenceImages[0]`. If the user provides no inline ref images but brand photos are injected, the first brand photo becomes the video thumbnail.
   - What's unclear: Whether this is desired or a side effect.
   - Recommendation: This is acceptable behavior — if the user toggles brand references on for a video, using the first brand reference as video thumbnail is coherent. The CONTEXT.md does not call it out as a problem.

---

## Sources

### Primary (HIGH confidence)
- Direct file reads: `shared/schema.ts`, `server/routes/generate.routes.ts`, `client/src/components/post-creator-dialog.tsx` — all line numbers are exact, confirmed by reading the actual file content
- `server/services/image-generation.service.ts` lines 49, 75 — confirms `referenceImages: Array<{ mimeType: string; data: string }>` parameter type
- `server/services/video-generation.service.ts` line 13 — confirms `referenceImages: Array<{ mimeType: string; data: string }>` parameter type
- `server/services/gemini.service.ts` line 94 — confirms `referenceImages?: string[]` (base64 only) for `generateText`
- `shared/schema.ts` lines 88–91 — confirms `BrandReferencePhotosResponse` already exported
- Node.js version: 24.13.0 — global `fetch` confirmed available without import

### Secondary (MEDIUM confidence)
- CONTEXT.md locked decisions — all code patterns sourced from there, verified against actual file line numbers

## Metadata

**Confidence breakdown:**
- Exact line numbers: HIGH — read directly from source files
- Type signatures: HIGH — read from service files
- Architecture patterns: HIGH — pattern matches existing code in same files
- Node.js fetch availability: HIGH — verified `node --version` = 24.13.0

**Research date:** 2026-05-16
**Valid until:** Until any of the three target files are modified (stable source files)
