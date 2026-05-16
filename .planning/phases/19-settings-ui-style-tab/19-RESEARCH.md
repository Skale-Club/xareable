# Phase 19: Settings UI — Style Tab - Research

**Researched:** 2026-05-16
**Domain:** React UI — settings page extension (TanStack Query, Supabase Storage, shadcn/ui)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Tab Structure**
- Change `TabsList className="grid w-full grid-cols-3"` → `grid w-full grid-cols-4`.
- Add 4th `<TabsTrigger value="style">` with `ImagePlus` icon.
- Tab rendered only when `brand` exists (same guard as other three tabs).

**Listing Photos**
- `useQuery<BrandReferencePhotosResponse>({ queryKey: ["/api/brand/reference-photos"], enabled: !!brand })` using default `getQueryFn`.
- Import `BrandReferencePhotosResponse` from `@shared/schema`.

**Upload Flow**
- Client-side upload direct to Supabase Storage at `${user.id}/references/${crypto.randomUUID()}.${ext}`.
- Validate: size > 5 MB → toast + abort; photos.length >= 10 → toast + abort.
- POST `{ photo_url: publicUrl }` to `/api/brand/reference-photos` via `apiRequest`.
- Invalidate query key `["/api/brand/reference-photos"]` after upload.
- `crypto.randomUUID()` — no polyfill needed.

**Delete Flow**
- `apiRequest("DELETE", /api/brand/reference-photos/${photoId})` then invalidate.
- No confirmation dialog.
- X button on hover only (`group` + `group-hover:opacity-100`).

**Photo Grid Layout**
- `grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3` — 10 total slots.
- Each slot: `aspect-square rounded-xl border-2`.
- Filled: thumbnail `img` + X button absolute top-right.
- Empty: dashed border, "+" centered, acts as label for hidden file input.
- State: `uploadingPhoto: boolean` (single boolean, not per-slot string from CONTEXT.md final wording: "uploadingSlot: string | null" — see note below).
- State: `isPhotoDragActive: boolean`.
- One shared hidden `<input type="file" accept="image/*" />`.

**Style Description**
- Initial: `brand?.style_description ?? ""`.
- `PATCH /api/brand/style-description` via `apiRequest`, then `await refreshBrand()`.
- `maxLength={1000}`, character counter `{styleDescription.length}/1000`.
- Save button disabled when `savingStyleDesc`.

**State vars to add**
```tsx
const [uploadingPhoto, setUploadingPhoto] = useState(false);
const [isPhotoDragActive, setIsPhotoDragActive] = useState(false);
const [styleDescription, setStyleDescription] = useState(brand?.style_description ?? "");
const [savingStyleDesc, setSavingStyleDesc] = useState(false);
```

**useEffect sync**
```tsx
useEffect(() => {
  if (brand) {
    setStyleDescription(brand.style_description ?? "");
  }
}, [brand]);
```

**Import additions**
```tsx
import { Loader2, Check, Palette, Upload, ImageIcon, X, Building2, ShieldCheck, Trash2, ImagePlus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { BrandReferencePhotosResponse } from "@shared/schema";
```

**Tab Content Structure**
- `TabsContent value="style"` with two Cards: "Style References" (photo grid) and "Visual Style" (textarea + save).

### Claude's Discretion

- None listed in CONTEXT.md.

### Deferred Ideas (OUT OF SCOPE)

- Creator dialog toggle (Phase 20).
- Server-side generation injection (Phase 20).
- Drag-to-reorder photos.
- Photo captions or metadata beyond position.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SET-01 | New "Style" 4th tab in settings.tsx — grid-cols-3 → grid-cols-4, ImagePlus icon | Lines 284, 285 are the exact edit points; icon added to line 14 import |
| SET-02 | Reference photo grid — 10 slots, drag & drop, file picker, X-to-delete on hover | Logo handler pattern (lines 89–150, 579–607) is the canonical reference |
| SET-03 | Style description textarea — 1000 char limit with counter, save button, toast | Textarea component confirmed at client/src/components/ui/textarea.tsx |
</phase_requirements>

---

## Summary

Phase 19 is a pure frontend extension of an existing page. All server-side contracts (API endpoints, Zod types, DB table) were delivered in Phase 18 and are confirmed stable. The work is entirely contained in `client/src/pages/settings.tsx` with no new files required beyond referencing existing components.

The page already has one `useQuery` call (line 60 for style catalog) and follows the pattern of importing `queryClient` directly from `@/lib/queryClient` (not `useQueryClient` hook) — consistent with how `trash.tsx`, `credits.tsx`, and all admin tab components handle cache invalidation. The upload flow mirrors the existing logo handler exactly (lines 120–150).

**Primary recommendation:** Follow the logo handler pattern (lines 89–150 for drag/drop state management, lines 120–150 for the actual upload) and the trash page pattern (direct `queryClient` import + `invalidateQueries`) for all new functionality.

---

## Standard Stack

### Core (already in project — no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tanstack/react-query | v5 (project standard) | `useQuery` for photo list | Already used in settings.tsx line 2 |
| @supabase/supabase-js | project standard | `supabase().storage.from("user_assets").upload()` | Already used throughout settings.tsx |
| lucide-react | project standard | `ImagePlus` icon for tab | Already imported at line 14 |
| shadcn/ui Textarea | local component | Style description field | Confirmed at `client/src/components/ui/textarea.tsx` |

**Installation:** No new packages required.

---

## Exact Edit Points in settings.tsx

### Line 14 — lucide-react import (ADD `ImagePlus`)

**Current (line 14):**
```tsx
import { Loader2, Check, Palette, Upload, ImageIcon, X, Building2, ShieldCheck, Trash2 } from "lucide-react";
```

**After edit:**
```tsx
import { Loader2, Check, Palette, Upload, ImageIcon, X, Building2, ShieldCheck, Trash2, ImagePlus } from "lucide-react";
```

### Lines 1–27 — Import block (ADD new imports after existing ones)

After line 26 (closing `}` of AlertDialog import block), add:
```tsx
import { Textarea } from "@/components/ui/textarea";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { BrandReferencePhotosResponse } from "@shared/schema";
```

**Note:** `useQuery` is already imported at line 2. No change to that line needed. `BrandReferencePhotosResponse` is the only new type import from `@shared/schema` — the existing import at line 16 (`DEFAULT_STYLE_CATALOG, type StyleCatalog`) will need `BrandReferencePhotosResponse` added to it. See exact wording below.

**Current line 16:**
```tsx
import { DEFAULT_STYLE_CATALOG, type StyleCatalog } from "@shared/schema";
```

**After edit:**
```tsx
import { DEFAULT_STYLE_CATALOG, type StyleCatalog, type BrandReferencePhotosResponse } from "@shared/schema";
```

### Lines 37–58 — State declarations (ADD 4 new state vars after existing)

After line 57 (`const [showDeleteDialog, ...`) and before line 59 (blank line before `useQuery`), insert:
```tsx
const [uploadingPhoto, setUploadingPhoto] = useState(false);
const [isPhotoDragActive, setIsPhotoDragActive] = useState(false);
const [styleDescription, setStyleDescription] = useState(brand?.style_description ?? "");
const [savingStyleDesc, setSavingStyleDesc] = useState(false);
```

### Lines 60–63 — useQuery block (ADD new useQuery after existing)

After line 63 (`const styles = styleCatalog?.styles || DEFAULT_STYLE_CATALOG.styles;`), insert:
```tsx
const { data: refPhotos } = useQuery<BrandReferencePhotosResponse>({
  queryKey: ["/api/brand/reference-photos"],
  enabled: !!brand,
});
const photos = refPhotos?.photos ?? [];
```

### Lines 77–87 — useEffect brand sync (ADD styleDescription sync inside existing block)

**Current useEffect (lines 77–87):**
```tsx
useEffect(() => {
  if (brand) {
    const brandColors = [brand.color_1, brand.color_2];
    if (brand.color_3) brandColors.push(brand.color_3);
    if (brand.color_4) brandColors.push(brand.color_4);
    setColors(brandColors);
    setCompanyName(brand.company_name);
    setCompanyType(brand.company_type);
    setBrandStyle(brand.mood);
  }
}, [brand]);
```

Add `setStyleDescription(brand.style_description ?? "");` as the last line before the closing brace:
```tsx
useEffect(() => {
  if (brand) {
    const brandColors = [brand.color_1, brand.color_2];
    if (brand.color_3) brandColors.push(brand.color_3);
    if (brand.color_4) brandColors.push(brand.color_4);
    setColors(brandColors);
    setCompanyName(brand.company_name);
    setCompanyType(brand.company_type);
    setBrandStyle(brand.mood);
    setStyleDescription(brand.style_description ?? "");  // ADD THIS LINE
  }
}, [brand]);
```

### Line 284–285 — TabsList (CHANGE grid-cols-3 to grid-cols-4)

**Current (line 284):**
```tsx
<TabsList className="grid w-full grid-cols-3">
```

**After edit:**
```tsx
<TabsList className="grid w-full grid-cols-4">
```

### Lines 285–297 — TabsTrigger list (ADD 4th trigger before closing `</TabsList>`)

After line 296 (`</TabsTrigger>` for logo) and before line 297 (`</TabsList>`), insert:
```tsx
<TabsTrigger value="style" className="flex items-center gap-2">
  <ImagePlus className="w-4 h-4" />
  {t("Style")}
</TabsTrigger>
```

### Lines 634–635 — TabsContent list (ADD 4th content before `</Tabs>`)

After line 634 (`</TabsContent>` closing the logo tab) and before line 635 (`</Tabs>`), insert the entire Style tab content block (detailed in Architecture Patterns below).

---

## Architecture Patterns

### Photo Upload Handler — mirrors logo handler exactly

The existing `handleSaveLogo` (lines 120–150) and drag/drop callbacks (lines 89–118) are the canonical pattern. The reference photo upload follows the same structure.

```tsx
// Source: settings.tsx lines 120–150 (logo pattern adapted for reference photos)
async function handleUploadPhoto(file: File) {
  if (!brand || !user) return;
  if (file.size > 5 * 1024 * 1024) {
    toast({ title: t("File too large"), description: t("Max 5MB per photo"), variant: "destructive" });
    return;
  }
  if (photos.length >= 10) {
    toast({ title: t("Limit reached"), description: t("Maximum 10 reference photos"), variant: "destructive" });
    return;
  }
  setUploadingPhoto(true);
  const sb = supabase();
  const ext = file.name.split(".").pop() || "jpg";
  const filePath = `${user.id}/references/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await sb.storage
    .from("user_assets")
    .upload(filePath, file, { upsert: false });
  if (uploadError) {
    toast({ title: t("Upload failed"), description: uploadError.message, variant: "destructive" });
    setUploadingPhoto(false);
    return;
  }
  const { data: { publicUrl } } = sb.storage.from("user_assets").getPublicUrl(filePath);
  await apiRequest("POST", "/api/brand/reference-photos", { photo_url: publicUrl });
  queryClient.invalidateQueries({ queryKey: ["/api/brand/reference-photos"] });
  setUploadingPhoto(false);
}
```

### Delete Handler

```tsx
async function handleDeletePhoto(photoId: string) {
  await apiRequest("DELETE", `/api/brand/reference-photos/${photoId}`);
  queryClient.invalidateQueries({ queryKey: ["/api/brand/reference-photos"] });
}
```

### Style Description Save Handler

```tsx
async function handleSaveStyleDescription() {
  setSavingStyleDesc(true);
  await apiRequest("PATCH", "/api/brand/style-description", {
    style_description: styleDescription.trim() || null,
  });
  await refreshBrand();
  setSavingStyleDesc(false);
  toast({ title: t("Style description saved") });
}
```

### Style Tab JSX Content Block

Insert after the closing `</TabsContent>` of the logo tab (after line 634), before `</Tabs>` (line 635):

```tsx
<TabsContent value="style" className="mt-6 space-y-6">
  {brand ? (
    <>
      {/* Card 1: Reference Photos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("Style References")}</CardTitle>
          <CardDescription>
            {t("Up to 10 reference photos used to style your AI-generated content")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {/* Filled slots */}
            {photos.map((photo) => (
              <div key={photo.id} className="relative group aspect-square rounded-xl border-2 border-border overflow-hidden">
                <img
                  src={photo.photo_url}
                  alt={t("Reference photo")}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleDeletePhoto(photo.id)}
                  className="absolute top-1 right-1 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background/95 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {/* Empty slots up to 10 */}
            {photos.length < 10 && Array.from({ length: 10 - photos.length }).map((_, i) => (
              <label
                key={`empty-${i}`}
                className={`aspect-square rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer transition-colors ${isPhotoDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"} ${uploadingPhoto && i === 0 ? "opacity-50 pointer-events-none" : ""}`}
                onDrop={(e) => { e.preventDefault(); setIsPhotoDragActive(false); const file = e.dataTransfer.files?.[0]; if (file) handleUploadPhoto(file); }}
                onDragOver={(e) => { e.preventDefault(); setIsPhotoDragActive(true); }}
                onDragLeave={() => setIsPhotoDragActive(false)}
              >
                {uploadingPhoto && i === 0 ? (
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-xl text-muted-foreground">+</span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) handleUploadPhoto(file); e.target.value = ""; }}
                />
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Style Description */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("Visual Style")}</CardTitle>
          <CardDescription>
            {t("Describe your visual style in words — used as context in AI generation")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={styleDescription}
            onChange={(e) => setStyleDescription(e.target.value)}
            maxLength={1000}
            placeholder={t("e.g., Clean and minimalist with warm earthy tones, natural textures...")}
            className="min-h-[120px]"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{styleDescription.length}/1000</span>
            <Button
              onClick={handleSaveStyleDescription}
              disabled={savingStyleDesc}
              data-testid="button-save-style-description"
            >
              {savingStyleDesc ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              {t("Save Style")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  ) : (
    <Card>
      <CardContent className="py-8 text-center text-muted-foreground">
        {t("No brand configured. Please complete onboarding first.")}
      </CardContent>
    </Card>
  )}
</TabsContent>
```

### Anti-Patterns to Avoid

- **useQueryClient hook instead of direct import:** Other pages in this codebase (`trash.tsx`, `credits.tsx`, all admin tab components) import `queryClient` directly from `@/lib/queryClient`. CONTEXT.md confirms this. Do NOT use `useQueryClient()` hook.
- **Multer / multipart upload to server:** Phase 18 explicitly decided NO multer. Client uploads to Supabase Storage directly, then POSTs the `photo_url` string to the API.
- **Per-slot uploadingSlot string tracking:** CONTEXT.md spec for state vars uses `uploadingPhoto: boolean`. The planner should use a simple boolean, not a per-slot ID tracker. The loading indicator only shows on the first empty slot (i === 0) when `uploadingPhoto` is true.
- **Separate useEffect for styleDescription:** The sync belongs inside the existing brand `useEffect` at lines 77–87, not a new separate one. CONTEXT.md shows it as a separate `useEffect` — but merging into the existing block avoids a second dependency on `[brand]`.

---

## Component Availability

| Component | Path | Available | Notes |
|-----------|------|-----------|-------|
| Textarea | `client/src/components/ui/textarea.tsx` | YES | shadcn/ui standard; `resize-none` by default; accepts `maxLength`, `className` |
| Card, CardHeader, CardContent, CardTitle, CardDescription | `client/src/components/ui/card` | YES | Already imported in settings.tsx line 8 |
| Tabs, TabsList, TabsTrigger, TabsContent | `client/src/components/ui/tabs` | YES | Already imported in settings.tsx line 9 |
| Button | `client/src/components/ui/button` | YES | Already imported in settings.tsx line 5 |
| Loader2, X, Check, ImagePlus | `lucide-react` | YES | Loader2, X, Check already on line 14; ImagePlus is the only addition |
| useToast | `@/hooks/use-toast` | YES | Already imported in settings.tsx line 12 |
| useTranslation / t() | `@/hooks/useTranslation` | YES | Already imported in settings.tsx line 13 |
| supabase() | `client/src/lib/supabase` | YES | Already imported in settings.tsx line 4 |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth headers on fetch | Custom fetch wrapper | `apiRequest` from `@/lib/queryClient` | Already handles Bearer token injection |
| Query cache invalidation | Manual state reset | `queryClient.invalidateQueries(...)` | Single source of truth; no stale data |
| Auth-injected GET requests | Manual fetch with headers | `useQuery` with default `getQueryFn` | `getQueryFn` auto-injects auth headers (queryClient.ts line 68) |
| UUID generation for file paths | Custom random string | `crypto.randomUUID()` | Native browser API; already used in post-creator-dialog.tsx lines 811, 947 |
| Drag-over state management | Complex event system | Simple `setIsPhotoDragActive` boolean | Logo pattern (lines 109–118) is the proven pattern |

---

## Verified API Contract (Phase 18)

From `server/routes/brand-references.routes.ts`:

| Endpoint | Method | Request | Response |
|----------|--------|---------|---------|
| `/api/brand/reference-photos` | GET | — (auth header) | `{ photos: BrandReferencePhoto[] }` ordered by `position ASC` |
| `/api/brand/reference-photos` | POST | `{ photo_url: string, position?: number }` | `BrandReferencePhoto` (201) |
| `/api/brand/reference-photos/:id` | DELETE | — | `{ success: true }` |
| `/api/brand/style-description` | PATCH | `{ style_description: string \| null }` | `{ success: true }` |

**POST validation note:** `createBrandReferencePhotoSchema` uses `z.string().url()` — so the `photo_url` POSTed from the client MUST be a valid public URL (the Supabase Storage public URL). Upload must complete before POST.

**BrandReferencePhoto shape** (from `shared/schema.ts` lines 78–86):
```typescript
{
  id: string;          // uuid
  brand_id: string;    // uuid
  user_id: string;     // uuid
  photo_url: string;   // NOT validated as URL on the schema read side
  position: number;    // int, ascending order
  created_at: string;
}
```

**BrandReferencePhotosResponse shape** (lines 88–91):
```typescript
{
  photos: BrandReferencePhoto[];
}
```

**Brand.style_description** (lines 62–76): `z.string().nullable().optional()` — the field exists post-Phase 18 migration. `refreshBrand()` in `auth.tsx` (line 201) does `select("*")` which returns this column.

---

## Common Pitfalls

### Pitfall 1: Adding a 4th import from `@shared/schema` as a separate import line

**What goes wrong:** Creates a duplicate import declaration, TypeScript error.

**Why it happens:** Easy to overlook the existing `import { DEFAULT_STYLE_CATALOG, type StyleCatalog } from "@shared/schema"` on line 16.

**How to avoid:** Add `type BrandReferencePhotosResponse` to the existing `@shared/schema` import on line 16, not as a new import line.

### Pitfall 2: Using `useQueryClient()` hook instead of direct `queryClient` import

**What goes wrong:** Inconsistency with the project pattern; `useQueryClient` is valid but unnecessary when the singleton is already exported.

**Why it happens:** React Query docs show `useQueryClient` as the primary hook-based approach.

**How to avoid:** This codebase uses direct `queryClient` import consistently across trash.tsx, credits.tsx, and all admin tabs. Import `{ queryClient, apiRequest }` from `@/lib/queryClient`.

**Warning signs:** If you see `import { useQueryClient } from "@tanstack/react-query"` being added — stop, use direct import instead.

### Pitfall 3: `upsert: false` on storage upload causing errors on retry

**What goes wrong:** If a user retries an upload (after error) with the same file path, `upsert: false` will return an error.

**Why it happens:** `crypto.randomUUID()` generates a new path each call, so this is not a real risk — each upload always has a unique path.

**How to avoid:** Use `upsert: false` (as specified in CONTEXT.md). The UUID path ensures no collision.

### Pitfall 4: Empty-slot count logic renders wrong number of slots when photos.length === 10

**What goes wrong:** Rendering `Array.from({ length: 10 - photos.length })` when `photos.length === 10` renders 0 empty slots (correct), but the upload button condition `photos.length < 10` still needs to guard the entire empty-slots section.

**How to avoid:** Wrap the empty slots in `{photos.length < 10 && ...}`. Do not render an empty `Array.from({ length: 0 })`.

### Pitfall 5: Drag events on individual slot labels causing page-level drop behavior

**What goes wrong:** Browser fires `dragover` on the document, which can trigger page navigation on drop if `e.preventDefault()` is not called.

**How to avoid:** Call `e.preventDefault()` in both `onDragOver` and `onDrop` handlers on each empty slot label (same pattern as logo handler lines 103–107).

### Pitfall 6: `styleDescription` state not syncing when brand loads asynchronously

**What goes wrong:** Initial render has `brand === null`, so `useState(brand?.style_description ?? "")` initializes to `""`. When brand loads, the field stays empty.

**Why it happens:** `brand` is loaded async in the auth context; the `useState` initializer only runs once.

**How to avoid:** The `useEffect` sync on `[brand]` (lines 77–87 extended) handles this. Ensure `setStyleDescription(brand.style_description ?? "")` is inside that existing `useEffect`.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Per-slot uploadingSlot ID tracking | Single `uploadingPhoto: boolean` | Simpler; spinner shows on first empty slot only; sufficient for v1.5 |
| Separate useEffect for style description sync | Merged into existing brand useEffect | One subscription to `[brand]`, no duplicate effects |

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — this is a pure frontend code change with existing Supabase Storage already configured).

---

## Validation Architecture

`workflow.nyquist_validation` is not set in `.planning/config.json` (only `_auto_chain_active` is present). Treating as absent = enabled.

### Test Framework

No automated test framework detected in this project. The codebase uses `scripts/verify-phase-{N}.ts` static verification scripts (TypeScript type-check harnesses, not runtime test suites).

| Property | Value |
|----------|-------|
| Framework | Static TypeScript verification via `scripts/verify-phase-19.ts` |
| Config file | None — tsx runner via `npx tsx scripts/verify-phase-19.ts` |
| Quick run command | `npm run check` (TypeScript type check) |
| Full suite command | `npx tsx scripts/verify-phase-19.ts` (to be created in Wave 0) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SET-01 | 4th tab "Style" exists in TabsList; grid-cols-4 class applied | static check | `npm run check` | ✅ (type check catches structural errors) |
| SET-02 | Photo grid renders 10 slots; upload/delete functions defined | static check | `npx tsx scripts/verify-phase-19.ts` | ❌ Wave 0 |
| SET-03 | Textarea with maxLength=1000; save handler calls PATCH endpoint | static check | `npx tsx scripts/verify-phase-19.ts` | ❌ Wave 0 |

### Wave 0 Gaps

- [ ] `scripts/verify-phase-19.ts` — static verification harness covering SET-01, SET-02, SET-03 (TypeScript import + shape checks; no Supabase env required)

---

## Sources

### Primary (HIGH confidence)

- `client/src/pages/settings.tsx` — full read; all line numbers verified
- `client/src/lib/queryClient.ts` — full read; `apiRequest` at line 48, `getQueryFn` at line 68, `queryClient` export at line 93
- `client/src/lib/auth.tsx` — full read; `refreshBrand` at line 201 does `select("*")`; `brand.style_description` available post-Phase 18
- `shared/schema.ts` — full read; `BrandReferencePhoto` (lines 78–86), `BrandReferencePhotosResponse` (lines 88–91), `Brand.style_description` (line 73 — `z.string().nullable().optional()`)
- `server/routes/brand-references.routes.ts` — full read; all 4 endpoints confirmed
- `client/src/components/ui/textarea.tsx` — confirmed component exists, exports `Textarea`, accepts standard textarea props including `maxLength`
- Grep: `crypto.randomUUID()` used at `post-creator-dialog.tsx` lines 811, 947 — browser native, no polyfill
- Grep: `queryClient` direct import confirmed as project pattern across 10+ files

### Secondary (MEDIUM confidence)

- `.planning/phases/19-settings-ui-style-tab/19-CONTEXT.md` — all locked decisions sourced from here

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components verified as existing in the codebase
- Architecture: HIGH — edit points are exact line numbers from full file read
- Pitfalls: HIGH — derived from actual code reading, not hypothesis

**Research date:** 2026-05-16
**Valid until:** Phase 19 plan is created (file is stable; no external deps)
