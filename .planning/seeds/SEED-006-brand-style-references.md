---
id: SEED-006
status: planted
planted: 2026-05-16
graduated: ~
graduated_as: ~
planted_during: conversation — user request for optional style reference panel in Settings
trigger_when: next milestone with a UX/brand-settings phase, or when reference-photo-driven generation quality becomes a differentiator
scope: Medium
---

# SEED-006: Brand Style References Panel

## Why This Matters

Today every user gets AI-generated posts shaped by their brand colors, logo, style, and mood — but the AI has no visual reference for what their real feed actually looks like. Users often have a strong existing aesthetic that isn't captured by the structured fields.

A persistent **style reference panel** lets clients upload up to 10 photos from their own feed and write a free-text description of their design preferences. These are saved globally to the brand profile and silently injected into every generation — removing the friction of re-attaching references on each post.

This is purely additive and optional: users with no references stored see zero change to their current experience.

---

## Feature Spec

### Where It Lives
New **"Style"** tab in `client/src/pages/settings.tsx` (4th tab alongside Info / Colors / Logo). The `TabsList` changes from `grid-cols-3` to `grid-cols-4`.

### Settings UI — "Style" Tab
- **Reference photo grid**: up to 10 slots displayed as a grid of thumbnails
  - Empty slots show a dashed `+` button (same pattern as the color "Add" button)
  - Populated slots: thumbnail with an `X` on hover to delete
  - File picker + drag & drop (mirrors the logo upload pattern)
  - Constraints: `image/*` only, **5 MB per file**, max **10 photos** per brand (enforced client + server)
  - Storage path: `user_assets/{userId}/references/{uuid}.{ext}`
- **Style description textarea** (optional): "Describe your visual style, aesthetic preferences, things you like or want to avoid."
  - Saved to `brands.style_description` (new nullable TEXT column)
  - Save button (same UX as other cards)

### Generation Dialog — Conditional Toggle
- Rendered **only when** the brand has ≥1 saved reference photo
- Label: "Use my style references" (checked by default)
- When unchecked: global references are excluded from that generation
- No new DB column — toggle state is ephemeral, per-generation
- Passed to the API as `use_brand_references: boolean` (new field in `generateRequestSchema`)

### AI Pipeline Integration (server-side)
In `server/routes/generate.routes.ts`, after fetching the brand:

1. If `use_brand_references` is `true` (or omitted), query `brand_reference_photos` for this brand
2. Fetch the photos from Supabase Storage (up to 4 — Gemini's practical multimodal limit)
3. Convert to base64, merge with any user-provided `reference_images` from the request body
   - User-provided images take slots first; brand references fill the remainder (total ≤ 4)
4. Pass the merged list into the existing `referenceImages` arg of image generation service calls

---

## Data Model

### New table: `brand_reference_photos`

```sql
create table brand_reference_photos (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references brands(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  photo_url   text not null,
  position    int  not null default 0,  -- display order
  created_at  timestamptz not null default now()
);

-- Max 10 per brand enforced at app layer; index for fast lookup
create index on brand_reference_photos(brand_id, position);

-- RLS: owner-only
alter table brand_reference_photos enable row level security;
create policy "owner" on brand_reference_photos
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

### Column addition: `brands.style_description`

```sql
alter table brands add column style_description text null;
```

---

## API Endpoints (new)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/brand/reference-photos` | List saved photos (ordered by position) |
| `POST` | `/api/brand/reference-photos` | Upload one photo (multipart/form-data, 5 MB limit, max 10 total) |
| `DELETE` | `/api/brand/reference-photos/:id` | Remove one photo |
| `PATCH` | `/api/brand/style-description` | Save style description text |

All endpoints use existing `requireAuth` middleware. The upload endpoint enforces the 10-photo cap server-side before writing to storage.

---

## Schema Changes (`shared/schema.ts`)

```ts
// New schemas
export const brandReferencePhotoSchema = z.object({
  id: z.string().uuid(),
  brand_id: z.string().uuid(),
  photo_url: z.string(),
  position: z.number().int(),
  created_at: z.string(),
});
export type BrandReferencePhoto = z.infer<typeof brandReferencePhotoSchema>;

// Add to brandSchema
style_description: z.string().nullable().optional(),

// Add to generateRequestSchema
use_brand_references: z.boolean().optional(),
```

---

## Implementation Phases (suggested breakdown)

**Phase A — Data layer**
- Supabase migration: `brand_reference_photos` table + `brands.style_description` column
- Zod schemas + TypeScript types in `shared/schema.ts`
- 3 API routes: list, upload, delete (with 5 MB + 10-photo cap)
- PATCH for style_description (can reuse brand update route or add new endpoint)

**Phase B — Settings UI**
- 4th "Style" tab in `settings.tsx`
- Reference photo grid component (upload slots, thumbnails, delete)
- Style description card with textarea + save
- Wire to new API endpoints via TanStack Query

**Phase C — Generation integration**
- Update `generateRequestSchema` with `use_brand_references`
- Server-side: fetch + inject brand reference photos at generation time
- Creator dialog: conditional "Use my style references" toggle (only if brand has photos)
- Carousel and enhancement routes: same injection pattern if applicable

---

## Edge Cases & Constraints

- **Storage cleanup**: deleting a `brand_reference_photos` row should also delete the file from `user_assets` storage (same pattern used in account deletion)
- **Gemini limit**: inject at most 4 reference photos total (brand + user). User-provided ones take priority.
- **Toggle visibility**: query `brand_reference_photos` count client-side (cached via TanStack Query on settings save); creator dialog reads from auth context or a separate cheap query
- **File type validation**: `image/*` client-side, MIME sniff server-side before upload to storage
- **Account deletion**: cascade in DB handles the rows; storage cleanup must be added to the account-delete service call

---

## Open Questions (resolve at planning time)

1. Should carousel generation also inject brand references, or only single-image generation?
2. Should the style description also be injected into the **text** generation phase (prompt building), not just image gen?
3. Max total file storage per user for references? (10 × 5 MB = 50 MB worst case — acceptable?)
4. Should `position` be user-reorderable via drag-and-drop in the grid, or just insertion order?
