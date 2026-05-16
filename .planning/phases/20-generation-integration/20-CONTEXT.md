---
phase: 20
name: Generation Integration
milestone: v1.5
status: context_captured
date: 2026-05-16
mode: auto
---

# Phase 20 Context: Generation Integration

## Phase Goal

Close the loop between stored brand reference photos and AI generation:
1. **Schema**: Add `use_brand_references` flag to `generateRequestSchema`
2. **Server**: Inject brand reference photos into the image generation pipeline at request time
3. **Creator dialog**: Conditional "Use my style references" toggle (only when brand has ≥1 photo, only for image content type)

## Requirements in Scope

- **GEN-01**: Creator dialog toggle — "Use my style references" checkbox, shown ONLY when `contentType === "image"` AND brand has ≥1 saved photo; checked by default; ephemeral per-generation
- **GEN-02**: Server-side injection — fetch brand photos, download as base64, merge with user inline reference_images (user takes priority, total ≤ 4 slots)

## Key Decisions

### Schema change: shared/schema.ts

Add to `generateRequestSchema` after `reference_images` field:

```typescript
use_brand_references: z.boolean().optional(),
```

### Server injection: generate.routes.ts

**Where:** After `brand` is fetched (line ~209) and after `const referenceImageBase64 = reference_images?.map(img => img.data);` (line ~371), before any generation call.

**New helper function** at module scope (before the route handler):

```typescript
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

**Destructure** `use_brand_references` from `parseResult.data` alongside existing fields.

**Injection logic** (replace existing `referenceImageBase64` constant + extend to merged array):

```typescript
// Build the final reference image list: user images fill first, brand fills remainder
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

// Use mergedReferenceImages everywhere reference_images was used previously
```

**Then update all downstream uses** of `reference_images` / `referenceImageBase64` to use `mergedReferenceImages`:
- Line ~382: `referenceImages: mergedReferenceImages.map(img => img.data)` (text gen)
- Line ~437: `referenceImages: mergedReferenceImages` (video gen)
- Line ~457: `referenceImages: mergedReferenceImages` (image gen)
- Line ~491: `if (mergedReferenceImages[0])` + `Buffer.from(mergedReferenceImages[0].data, 'base64')` (thumbnail)

**Note:** `supabase` is the user-scoped client from `authenticateUser()` — already available in the handler. RLS allows reading own brand's photos. No admin client needed.

### Creator dialog: post-creator-dialog.tsx

**New state var:**
```tsx
const [useBrandReferences, setUseBrandReferences] = useState(true);
```

**New query (add after existing queries near line 284):**
```tsx
const { data: brandRefPhotos } = useQuery<BrandReferencePhotosResponse>({
  queryKey: ["/api/brand/reference-photos"],
  enabled: !!brand && contentType === "image",
});
const hasBrandReferences = (brandRefPhotos?.photos?.length ?? 0) > 0;
```

**Toggle placement:** Inside `div className="flex flex-col items-end gap-3"` (line ~1966), before the Generate button. Only rendered when `hasBrandReferences && contentType === "image"`:

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

**Add to fetchSSE payload** (in `handleGenerate`, after existing fields):
```tsx
use_brand_references: hasBrandReferences ? useBrandReferences : undefined,
```

**Import addition:**
```tsx
import { BrandReferencePhotosResponse } from "@shared/schema";
```
(Add to existing `@shared/schema` import, which already imports GenerateResponse etc.)

**Reset on dialog open:** Add `setUseBrandReferences(true)` in any reset/fresh-start handlers (same pattern as other ephemeral state).

### Scope constraint: image content_type only

The toggle is hidden for `contentType === "carousel"` and `contentType === "enhancement"`. The carousel and enhancement routes (`/api/carousel/generate`, `/api/enhance`) are NOT modified in Phase 20 — only `/api/generate` (single-image + video paths). Server injection is also only added to `generate.routes.ts`.

### Verification script: scripts/verify-phase-20.ts

Static checks:
- `shared/schema.ts` contains `use_brand_references: z.boolean().optional()`
- `server/routes/generate.routes.ts` contains `fetchBrandReferenceImagesAsBase64`
- `server/routes/generate.routes.ts` contains `use_brand_references`
- `server/routes/generate.routes.ts` contains `mergedReferenceImages`
- `server/routes/generate.routes.ts` contains `brand_reference_photos`
- `client/src/components/post-creator-dialog.tsx` contains `useBrandReferences`
- `client/src/components/post-creator-dialog.tsx` contains `hasBrandReferences`
- `client/src/components/post-creator-dialog.tsx` contains `checkbox-use-brand-references`
- `client/src/components/post-creator-dialog.tsx` contains `use_brand_references`
- `npm run check` exits 0

## Code Context (Reusable Assets)

| Asset | Location | Used For |
|-------|----------|----------|
| `reference_images` destructure | `generate.routes.ts:260` | Extend to also destructure `use_brand_references` |
| `referenceImageBase64` const | `generate.routes.ts:371` | Replace with `mergedReferenceImages` logic |
| Image gen call | `generate.routes.ts:457` | `referenceImages: mergedReferenceImages` |
| `supabase` user-scoped client | `generate.routes.ts` (from `authenticateUser`) | Query `brand_reference_photos` |
| `brand.id` | `generate.routes.ts:209` | Filter brand_reference_photos by brand |
| `useQuery` import | `post-creator-dialog.tsx:2` | Already imported |
| `apiRequest` import | `post-creator-dialog.tsx:3` | Already imported |
| `brand` from `useAuth()` | `post-creator-dialog.tsx:221` | `enabled: !!brand` guard |
| Generate button container | `post-creator-dialog.tsx:1966` | Toggle rendered just above button |
| `handleGenerate` fetchSSE call | `post-creator-dialog.tsx:678` | Add `use_brand_references` to payload |

## Canonical References

- ROADMAP.md Phase 20 section — 4 success criteria
- `shared/schema.ts:877-895` — `generateRequestSchema` (add `use_brand_references`)
- `server/routes/generate.routes.ts:258-277` — destructure block
- `server/routes/generate.routes.ts:370-372` — referenceImageBase64 (replace with merge logic)
- `server/routes/generate.routes.ts:457` — image gen `referenceImages` arg
- `client/src/components/post-creator-dialog.tsx:284` — query insertion point
- `client/src/components/post-creator-dialog.tsx:1966` — toggle insertion point (flex-col items-end)
- `client/src/components/post-creator-dialog.tsx:678` — fetchSSE payload

## Out of Scope for Phase 20

- Carousel route injection (deferred to v1.6)
- Enhancement route injection (deferred to v1.6)
- Style description injected into text generation prompt (deferred)
- Per-photo selection UI in creator dialog (deferred)
