---
phase: 18
name: Data Layer + API Endpoints
milestone: v1.5
status: context_captured
date: 2026-05-16
mode: auto
---

# Phase 18 Context: Data Layer + API Endpoints

## Phase Goal

Create the complete server-side data contract for brand style references: Supabase migration, Zod schemas, and four API endpoints — so Phases 19 (UI) and 20 (generation integration) have a stable foundation to build on.

## Requirements in Scope

- **REF-01**: `brand_reference_photos` table + `brands.style_description` column + Zod types in `shared/schema.ts`
- **API-01**: `GET /api/brand/reference-photos` — list user's saved reference photos ordered by position
- **API-02**: `POST /api/brand/reference-photos` — create a new photo record (client uploads to Supabase Storage directly; server validates cap + ownership + inserts DB row)
- **API-03**: `DELETE /api/brand/reference-photos/:id` — delete photo (removes storage object + DB row)
- **API-04**: `PATCH /api/brand/style-description` — save or clear `brands.style_description`

## Key Decisions

### Upload Architecture: Client-Direct to Supabase Storage (matches logo pattern)

**Decision:** The client uploads the photo file directly to Supabase Storage (using the user-scoped `supabase()` client), then calls `POST /api/brand/reference-photos` with the resulting `photo_url`. The server creates the DB row, enforces the 10-photo cap, and validates brand ownership.

**Rationale:** This matches the existing logo upload pattern in `client/src/pages/settings.tsx:120-149`. The codebase has no multipart middleware (no multer/busboy). The enhance route uses base64-in-JSON; the logo uses client-direct. For a file management feature, client-direct avoids adding middleware and keeps the server endpoints lean.

**Storage path:** `user_assets/{userId}/references/{uuid}.{ext}` — consistent with `user_assets/{userId}/logo.{ext}` and `user_assets/{userId}/generated/{uuid}.png`.

**5 MB enforcement:** Client-side validation (same as logo: "PNG, JPG, SVG up to 5MB" label without server enforcement). The 10-photo cap IS enforced server-side (count DB rows before insert).

### New Route File: `server/routes/brand-references.routes.ts`

**Decision:** Create a new dedicated route file `server/routes/brand-references.routes.ts` (not added to `settings.routes.ts`).

**Rationale:** `settings.routes.ts` handles app-level settings (admin-scoped OG image, app settings). Brand user data belongs in a separate file. Register in `server/routes/index.ts` alongside other user-facing routes.

### POST body shape

```typescript
// POST /api/brand/reference-photos
{ photo_url: string, position?: number }
// → creates brand_reference_photos row
// → returns BrandReferencePhoto
```

Position auto-assigned as `(max existing position) + 1` if not provided.

### DELETE: storage path extraction

Reuse `getStorageObjectPathFromPublicUrl()` utility from `server/routes/posts.routes.ts:24`. Copy the function locally into `brand-references.routes.ts` (it's a pure utility — no shared import yet, don't refactor now).

Use `createServerSupabase(token)` for both the storage delete and the DB delete (RLS handles ownership). No need for admin client.

### PATCH /api/brand/style-description

```typescript
// Body: { style_description: string | null }
// Max 1000 chars enforced server-side via Zod .max(1000)
// null → sets column to NULL (clears it)
```

Updates `brands.style_description` for the authenticated user's brand (user-scoped client, RLS applies).

### Migration strategy: two additive changes

1. New table `brand_reference_photos` with full RLS
2. `ALTER TABLE brands ADD COLUMN IF NOT EXISTS style_description TEXT`

Timestamp: next after `20260508203515` → use `20260516000000`.

### Zod schemas (shared/schema.ts)

```typescript
export const brandReferencePhotoSchema = z.object({
  id: z.string().uuid(),
  brand_id: z.string().uuid(),
  user_id: z.string().uuid(),
  photo_url: z.string(),
  position: z.number().int(),
  created_at: z.string(),
});
export type BrandReferencePhoto = z.infer<typeof brandReferencePhotoSchema>;

export const brandReferencePhotosResponseSchema = z.object({
  photos: z.array(brandReferencePhotoSchema),
});

export const createBrandReferencePhotoSchema = z.object({
  photo_url: z.string().url(),
  position: z.number().int().min(0).optional(),
});

export const updateStyleDescriptionSchema = z.object({
  style_description: z.string().max(1000).nullable(),
});
```

Also add `style_description: z.string().nullable().optional()` to `brandSchema`.

### Auth pattern

All 4 endpoints use `authenticateUser(req as AuthenticatedRequest)` — the standard pattern from `posts.routes.ts` and others. No `requireAuth` middleware wrapper. Inline auth check at handler start.

Get brand_id by querying `brands` for `user_id = user.id` (same as generate route).

### Error responses

| Scenario | Status | Message |
|----------|--------|---------|
| Not authenticated | 401 | "Unauthorized" |
| Brand not found | 404 | "Brand not found" |
| 10-photo cap exceeded | 400 | "Maximum 10 reference photos allowed" |
| Photo not found or not owned | 404 | "Photo not found" |
| Style description too long | 400 | Zod validation message |

### Verification script

`scripts/verify-phase-18.ts` — static checks:
- Migration file exists with correct timestamp
- `brand_reference_photos` table SQL present
- `brands` ALTER TABLE present
- All 4 Zod schemas exported from `shared/schema.ts`
- Route file exists at `server/routes/brand-references.routes.ts`
- Route registered in `server/routes/index.ts`
- All 4 endpoints declared (`GET`, `POST`, `DELETE`, `PATCH`)

## Code Context (Reusable Assets)

| Asset | Location | Used For |
|-------|----------|----------|
| `uploadFile()` | `server/storage.ts` | Server-side storage uploads (not needed here — client uploads directly) |
| `getStorageObjectPathFromPublicUrl()` | `server/routes/posts.routes.ts:24-42` | Extract storage path from public URL for deletion |
| `authenticateUser` | `server/middleware/auth.middleware.ts` | Auth pattern for all 4 endpoints |
| `createServerSupabase(token)` | `server/supabase.ts` | User-scoped DB + storage operations |
| Logo upload pattern | `client/src/pages/settings.tsx:120-149` | Reference for client-direct upload flow (Phase 19) |
| Router pattern | Any `server/routes/*.routes.ts` | Route file structure |

## Canonical References

- ROADMAP.md Phase 18 section — success criteria (5 criteria)
- `server/routes/posts.routes.ts` — auth pattern + storage deletion utility
- `server/routes/settings.routes.ts` — brand PATCH pattern
- `shared/schema.ts` — existing `brandSchema` to extend
- `supabase/migrations/20260508203515_integration_settings_sync_on_signup.sql` — latest migration for timestamp reference
- `server/routes/index.ts` — where to register new route

## Out of Scope for This Phase

- Client upload UI (Phase 19)
- Creator dialog toggle (Phase 20)
- Server-side generation injection (Phase 20)
- Drag-to-reorder (deferred from v1.5 entirely)
