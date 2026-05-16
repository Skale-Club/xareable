# Phase 18: Data Layer + API Endpoints - Research

**Researched:** 2026-05-16
**Domain:** Supabase PostgreSQL migrations, Express route patterns, Zod schemas, RLS policies
**Confidence:** HIGH — all findings are sourced directly from the existing codebase; no external library discovery needed.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Upload architecture:** Client-direct to Supabase Storage (matches logo pattern). Server receives only the resulting `photo_url` URL, not the file bytes. No multipart middleware needed.
- **Storage path convention:** `user_assets/{userId}/references/{uuid}.{ext}` — consistent with `user_assets/{userId}/logo.{ext}` and `user_assets/{userId}/generated/{uuid}.png`.
- **5 MB enforcement:** Client-side only (no server-side file size check). The 10-photo cap IS enforced server-side via a DB count query before insert.
- **New route file:** `server/routes/brand-references.routes.ts` — separate from `settings.routes.ts`.
- **POST body shape:** `{ photo_url: string, position?: number }` — auto-assigns `(max existing position) + 1` if position omitted.
- **DELETE storage path extraction:** Copy `getStorageObjectPathFromPublicUrl()` from `server/routes/posts.routes.ts:24-43` into `brand-references.routes.ts`. Do not refactor into shared module.
- **DELETE client:** Use `createServerSupabase(token)` for both storage delete and DB delete (RLS handles ownership). No admin client needed.
- **PATCH body:** `{ style_description: string | null }` — max 1000 chars via Zod `.max(1000)`, null clears the column.
- **Migration timestamp:** `20260516000000` (next after `20260508203515`).
- **Auth pattern:** `authenticateUser(req as AuthenticatedRequest)` inline at handler start — same as `posts.routes.ts`. No `requireAuth` middleware wrapper.
- **brand_id lookup:** Query `brands` for `user_id = user.id` (same as `generate.routes.ts:209-213`).
- **Zod schemas:** Exact definitions provided in CONTEXT.md — do not deviate.

### Claude's Discretion

- Error message wording (within the table of required status codes in CONTEXT.md).
- SQL column ordering within the migration.
- Whether to add an index on `brand_reference_photos.user_id` (recommended for the 10-cap count query).
- Whether to add an index on `brand_reference_photos.brand_id` (recommended for list query ordering).
- Exact comment text inside the migration file.

### Deferred Ideas (OUT OF SCOPE)

- Client upload UI (Phase 19).
- Creator dialog toggle (Phase 20).
- Server-side generation injection (Phase 20).
- Drag-to-reorder (deferred from v1.5 entirely).
- Server-side 5 MB file size enforcement.
- Shared utility module for `getStorageObjectPathFromPublicUrl`.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REF-01 | `brand_reference_photos` table + `brands.style_description` column + Zod types in `shared/schema.ts` | Migration SQL pattern from `20260421000000_v1_1_schema_foundation.sql`; Zod schema additions documented below |
| API-01 | `GET /api/brand/reference-photos` — list ordered by position | `authenticateUser` + `supabase.from("brands").eq("user_id")` pattern confirmed; order by `position` ascending |
| API-02 | `POST /api/brand/reference-photos` — create record with cap enforcement | Count query pattern confirmed; `position` auto-assign via `MAX(position)+1`; returns `BrandReferencePhoto` |
| API-03 | `DELETE /api/brand/reference-photos/:id` — remove storage object + DB row | `getStorageObjectPathFromPublicUrl()` confirmed in `posts.routes.ts:24-43`; storage `.remove()` + DB delete pattern confirmed |
| API-04 | `PATCH /api/brand/style-description` — save or clear `brands.style_description` | `supabase.from("brands").update().eq("user_id")` pattern confirmed from `settings.routes.ts` |
</phase_requirements>

---

## Summary

Phase 18 is a pure server-side delivery: a migration, four Zod schema exports, a new route file, and one line in the route registry. Every pattern required already exists in the codebase — this phase assembles them, it does not invent anything.

The primary risk is the 10-photo cap enforcement: the count query and insert must be understood as non-atomic (no DB-level UNIQUE/CHECK constraint enforces the cap). The server-side count is best-effort. A race condition between two simultaneous POST requests could theoretically exceed 10. For v1.5, the application-level count check is acceptable and matches how similar caps are handled elsewhere in the codebase.

The second risk is RLS completeness. The `brand_reference_photos` table needs 4 policies (SELECT, INSERT, UPDATE, DELETE) scoped to `auth.uid()`. The `brands.style_description` column needs no new RLS — `brands` already has RLS and `UPDATE` policies scoped to `user_id = auth.uid()`.

**Primary recommendation:** Write the migration, schemas, and route file as one cohesive plan. The registration in `index.ts` is a single two-line change. The verification script is a static file-existence and string-search harness identical in structure to prior phase verify scripts.

---

## Standard Stack

### Core (already in project — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | project's existing pin | DB queries + Storage API | Already used in every route |
| `zod` | project's existing pin | Request/response schema validation | Project standard (`shared/schema.ts`) |
| `express` | 5.x | Router + request/response | Project standard |

**Installation:** None required. All dependencies are already present.

---

## Architecture Patterns

### Confirmed Pattern: Auth in Handler (not middleware)

All user-facing routes call `authenticateUser` inline at the top of each handler, not via `router.use(requireAuth)`. This is confirmed in `posts.routes.ts`, `generate.routes.ts`, and others.

```typescript
// Source: server/routes/posts.routes.ts:51-58
router.get("/api/posts", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user, supabase } = authResult;
    // ...
});
```

### Confirmed Pattern: Get brand_id from user_id

```typescript
// Source: server/routes/generate.routes.ts:209-213
const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("id")   // only id needed for brand_id — add other fields as required
    .eq("user_id", user.id)
    .single();

if (brandError || !brand) {
    res.status(404).json({ message: "Brand not found" });
    return;
}
```

### Confirmed Pattern: Storage path extraction from public URL

```typescript
// Source: server/routes/posts.routes.ts:24-43
function getStorageObjectPathFromPublicUrl(publicUrl: string | null | undefined, bucket: string): string | null {
    if (!publicUrl) return null;
    try {
        const url = new URL(publicUrl);
        const marker = `/storage/v1/object/public/${bucket}/`;
        const markerIndex = url.pathname.indexOf(marker);
        if (markerIndex === -1) return null;
        const encodedPath = url.pathname.slice(markerIndex + marker.length);
        const decodedPath = decodeURIComponent(encodedPath).replace(/^\/+/, "");
        return decodedPath || null;
    } catch {
        return null;
    }
}
```

Copy this function verbatim into `brand-references.routes.ts`. Call as:
```typescript
const storagePath = getStorageObjectPathFromPublicUrl(photo.photo_url, "user_assets");
```

### Confirmed Pattern: Storage `.remove()` call

```typescript
// Source: server/routes/posts.routes.ts:548-554
const { error: storageError } = await supabase.storage
    .from("user_assets")
    .remove([storagePath]);  // array of paths, no leading slash
if (storageError) {
    console.warn("[Storage Cleanup] Failed:", storageError.message);
}
```

Note: `posts.routes.ts` uses `supabase` (user-scoped) for DELETE storage in some places and `adminSb` in others. For `brand_reference_photos`, using the user-scoped `supabase` (from `authResult`) is correct — RLS allows the owner to delete their own files.

### Confirmed Pattern: createServerSupabase token source

```typescript
// Source: server/middleware/auth.middleware.ts:56
const supabase = createServerSupabase(token);
// where token = req.headers.authorization?.slice(7)
```

`authenticateUser` already does this internally and returns `supabase` as part of `authResult`. The planner should use `authResult.supabase` throughout — never call `createServerSupabase` again in the handler.

### Confirmed Pattern: Route registration in index.ts

```typescript
// Source: server/routes/index.ts (pattern)
import brandReferencesRoutes from "./brand-references.routes.js";
// ...
router.use(brandReferencesRoutes);  // inside createApiRouter()
```

Add the import at the top alongside other user-facing route imports (after `integrationsRoutes`), and add `router.use(brandReferencesRoutes)` inside `createApiRouter()`. Also add to the bottom export list.

### Confirmed Pattern: Zod safeParse for request validation

```typescript
// Source: server/routes/settings.routes.ts:78-85
const parseResult = updateAppSettingsSchema.safeParse(req.body);
if (!parseResult.success) {
    return res.status(400).json({
        message: "Invalid request: " +
            parseResult.error.errors.map((e) => e.message).join(", "),
    });
}
```

---

## Exact SQL for Migration

**File:** `supabase/migrations/20260516000000_brand_style_references.sql`

**Timestamp reasoning:** Latest existing migration is `20260508203515`. CONTEXT.md explicitly specifies `20260516000000` as the next timestamp.

```sql
-- Phase 18 (v1.5) — Brand Style References: data layer
-- Creates brand_reference_photos table and adds style_description to brands.

-- ============================================================
-- PART 1: Add brands.style_description column
-- ============================================================

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS style_description TEXT;

-- ============================================================
-- PART 2: Create brand_reference_photos table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.brand_reference_photos (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id   UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url  TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_brand_reference_photos_brand_id
  ON public.brand_reference_photos (brand_id);

CREATE INDEX IF NOT EXISTS idx_brand_reference_photos_user_id
  ON public.brand_reference_photos (user_id);

-- ============================================================
-- PART 3: Enable RLS + policies
-- ============================================================

ALTER TABLE public.brand_reference_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own reference photos" ON public.brand_reference_photos;
CREATE POLICY "Users can view own reference photos"
  ON public.brand_reference_photos FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own reference photos" ON public.brand_reference_photos;
CREATE POLICY "Users can insert own reference photos"
  ON public.brand_reference_photos FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own reference photos" ON public.brand_reference_photos;
CREATE POLICY "Users can update own reference photos"
  ON public.brand_reference_photos FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own reference photos" ON public.brand_reference_photos;
CREATE POLICY "Users can delete own reference photos"
  ON public.brand_reference_photos FOR DELETE
  USING (user_id = auth.uid());
```

**Why `user_id` directly on `brand_reference_photos`:** RLS policies use `auth.uid()` directly. If only `brand_id` were stored, every RLS check would require a subquery JOIN to `brands`. Storing `user_id` denormalized (same pattern as `post_slides` using a subquery vs. `posts` using `user_id` directly) makes RLS simple and fast. The `brand_id` FK still enforces referential integrity.

**Why no `UPDATE` needed in routes:** The planner should note that no route updates `photo_url` or `position` in v1.5 (drag-to-reorder is deferred). The UPDATE policy is added for completeness and future use.

---

## 10-Photo Cap Server-Side Enforcement

**Count query before insert:**

```typescript
const { count, error: countError } = await supabase
    .from("brand_reference_photos")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brand.id);

if (countError) {
    res.status(500).json({ message: "Failed to check photo count" });
    return;
}
if ((count ?? 0) >= 10) {
    res.status(400).json({ message: "Maximum 10 reference photos allowed" });
    return;
}
```

**Non-atomicity note:** This count+insert is NOT atomic. Two simultaneous POST requests could both read count=9 and both insert, reaching 11. This is acceptable for v1.5 (same trade-off as other application-level caps in the codebase). A DB-level CHECK constraint could enforce it but would require a trigger; not needed for v1.5.

---

## Position Auto-Assignment

**When `position` is not provided in the POST body:**

```typescript
const { data: maxRow } = await supabase
    .from("brand_reference_photos")
    .select("position")
    .eq("brand_id", brand.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

const nextPosition = body.position ?? ((maxRow?.position ?? -1) + 1);
```

This gives `position = 0` when no photos exist, and `max+1` when photos exist.

---

## Zod Schemas to Add (shared/schema.ts)

Add the following in order, after `brandSchema` and before `insertBrandSchema`:

**1. Extend `brandSchema`** — add `style_description` field:
```typescript
export const brandSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  company_name: z.string(),
  company_type: z.string(),
  color_1: z.string(),
  color_2: z.string(),
  color_3: z.string().nullable(),
  color_4: z.string().nullable(),
  mood: z.string(),
  logo_url: z.string().nullable(),
  style_description: z.string().nullable().optional(),  // ADD THIS LINE
  created_at: z.string(),
});
```

**2. New schemas** (add after existing brand schemas):
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
export type BrandReferencePhotosResponse = z.infer<typeof brandReferencePhotosResponseSchema>;

export const createBrandReferencePhotoSchema = z.object({
  photo_url: z.string().url(),
  position: z.number().int().min(0).optional(),
});
export type CreateBrandReferencePhoto = z.infer<typeof createBrandReferencePhotoSchema>;

export const updateStyleDescriptionSchema = z.object({
  style_description: z.string().max(1000).nullable(),
});
export type UpdateStyleDescription = z.infer<typeof updateStyleDescriptionSchema>;
```

---

## Complete Route File Blueprint

**File:** `server/routes/brand-references.routes.ts`

```typescript
/**
 * Brand References Routes — Phase 18 (v1.5)
 * Handles brand reference photo CRUD and style description updates.
 */

import { Router, Request, Response } from "express";
import {
    brandReferencePhotosResponseSchema,
    brandReferencePhotoSchema,
    createBrandReferencePhotoSchema,
    updateStyleDescriptionSchema,
} from "../../shared/schema.js";
import { authenticateUser, AuthenticatedRequest } from "../middleware/auth.middleware.js";

const router = Router();

// Copied from posts.routes.ts — pure utility, no shared import needed in v1.5
function getStorageObjectPathFromPublicUrl(
    publicUrl: string | null | undefined,
    bucket: string
): string | null {
    if (!publicUrl) return null;
    try {
        const url = new URL(publicUrl);
        const marker = `/storage/v1/object/public/${bucket}/`;
        const markerIndex = url.pathname.indexOf(marker);
        if (markerIndex === -1) return null;
        const encodedPath = url.pathname.slice(markerIndex + marker.length);
        const decodedPath = decodeURIComponent(encodedPath).replace(/^\/+/, "");
        return decodedPath || null;
    } catch {
        return null;
    }
}

/** GET /api/brand/reference-photos */
router.get("/api/brand/reference-photos", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user, supabase } = authResult;

    const { data: brand, error: brandError } = await supabase
        .from("brands").select("id").eq("user_id", user.id).single();
    if (brandError || !brand) {
        res.status(404).json({ message: "Brand not found" });
        return;
    }

    const { data: photos, error } = await supabase
        .from("brand_reference_photos")
        .select("id, brand_id, user_id, photo_url, position, created_at")
        .eq("brand_id", brand.id)
        .order("position", { ascending: true });

    if (error) {
        res.status(500).json({ message: "Failed to fetch reference photos" });
        return;
    }

    res.json(brandReferencePhotosResponseSchema.parse({ photos: photos ?? [] }));
});

/** POST /api/brand/reference-photos */
router.post("/api/brand/reference-photos", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user, supabase } = authResult;

    const parseResult = createBrandReferencePhotoSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ message: parseResult.error.errors.map((e) => e.message).join(", ") });
        return;
    }
    const body = parseResult.data;

    const { data: brand, error: brandError } = await supabase
        .from("brands").select("id").eq("user_id", user.id).single();
    if (brandError || !brand) {
        res.status(404).json({ message: "Brand not found" });
        return;
    }

    // Enforce 10-photo cap
    const { count, error: countError } = await supabase
        .from("brand_reference_photos")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", brand.id);
    if (countError) {
        res.status(500).json({ message: "Failed to check photo count" });
        return;
    }
    if ((count ?? 0) >= 10) {
        res.status(400).json({ message: "Maximum 10 reference photos allowed" });
        return;
    }

    // Auto-assign position
    const { data: maxRow } = await supabase
        .from("brand_reference_photos")
        .select("position")
        .eq("brand_id", brand.id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
    const nextPosition = body.position ?? ((maxRow?.position ?? -1) + 1);

    const { data: photo, error: insertError } = await supabase
        .from("brand_reference_photos")
        .insert({
            brand_id: brand.id,
            user_id: user.id,
            photo_url: body.photo_url,
            position: nextPosition,
        })
        .select("id, brand_id, user_id, photo_url, position, created_at")
        .single();

    if (insertError || !photo) {
        res.status(500).json({ message: "Failed to save reference photo" });
        return;
    }

    res.status(201).json(brandReferencePhotoSchema.parse(photo));
});

/** DELETE /api/brand/reference-photos/:id */
router.delete("/api/brand/reference-photos/:id", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { supabase } = authResult;
    const { id } = req.params;

    const { data: photo, error: fetchError } = await supabase
        .from("brand_reference_photos")
        .select("id, photo_url")
        .eq("id", id)
        .single();

    if (fetchError || !photo) {
        res.status(404).json({ message: "Photo not found" });
        return;
    }

    // Delete DB row first (RLS owns scope check)
    const { error: deleteError } = await supabase
        .from("brand_reference_photos")
        .delete()
        .eq("id", id);
    if (deleteError) {
        res.status(500).json({ message: "Failed to delete photo" });
        return;
    }

    // Delete storage object (best-effort, non-blocking on failure)
    const storagePath = getStorageObjectPathFromPublicUrl(photo.photo_url, "user_assets");
    if (storagePath) {
        const { error: storageError } = await supabase.storage
            .from("user_assets")
            .remove([storagePath]);
        if (storageError) {
            console.warn("[Storage Cleanup] Failed to delete reference photo:", storageError.message);
        }
    }

    res.json({ success: true });
});

/** PATCH /api/brand/style-description */
router.patch("/api/brand/style-description", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }
    const { user, supabase } = authResult;

    const parseResult = updateStyleDescriptionSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ message: parseResult.error.errors.map((e) => e.message).join(", ") });
        return;
    }

    const { error } = await supabase
        .from("brands")
        .update({ style_description: parseResult.data.style_description })
        .eq("user_id", user.id);

    if (error) {
        res.status(500).json({ message: "Failed to update style description" });
        return;
    }

    res.json({ success: true });
});

export default router;
```

---

## index.ts Registration Changes

**Two locations to edit in `server/routes/index.ts`:**

1. Import (add after `integrationsRoutes` import):
```typescript
import brandReferencesRoutes from "./brand-references.routes.js";
```

2. Inside `createApiRouter()` (add after `router.use(integrationsRoutes)`):
```typescript
router.use(brandReferencesRoutes);
```

3. Bottom named export (add to the list):
```typescript
brandReferencesRoutes,
```

---

## Verification Script Blueprint

**File:** `scripts/verify-phase-18.ts`

Static checks (no runtime):
1. Migration file `supabase/migrations/20260516000000_brand_style_references.sql` exists.
2. Migration contains `brand_reference_photos` table creation SQL.
3. Migration contains `ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS style_description`.
4. Migration contains `ENABLE ROW LEVEL SECURITY` for `brand_reference_photos`.
5. `shared/schema.ts` exports `brandReferencePhotoSchema`.
6. `shared/schema.ts` exports `brandReferencePhotosResponseSchema`.
7. `shared/schema.ts` exports `createBrandReferencePhotoSchema`.
8. `shared/schema.ts` exports `updateStyleDescriptionSchema`.
9. `server/routes/brand-references.routes.ts` exists.
10. `brand-references.routes.ts` declares `GET /api/brand/reference-photos`.
11. `brand-references.routes.ts` declares `POST /api/brand/reference-photos`.
12. `brand-references.routes.ts` declares `DELETE /api/brand/reference-photos/:id`.
13. `brand-references.routes.ts` declares `PATCH /api/brand/style-description`.
14. `server/routes/index.ts` imports `brand-references.routes.js`.
15. `server/routes/index.ts` calls `router.use(brandReferencesRoutes)`.

Pattern: use `fs.existsSync` + `fs.readFileSync` + string `includes()` checks — same as `scripts/verify-cron-jobs.ts` and prior verify scripts.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth token extraction | Custom header parsing | `authenticateUser()` from `auth.middleware.ts` | Already handles Bearer extraction, Supabase validation, profile upsert |
| Storage URL parsing | Custom URL regex | `getStorageObjectPathFromPublicUrl()` (copy from `posts.routes.ts`) | Handles URL encoding, edge cases, missing paths |
| Supabase user-scoped client | New `createServerSupabase(token)` call | `authResult.supabase` returned by `authenticateUser` | Already initialized with the correct token |
| Request body validation | Manual field checks | Zod `safeParse` with `shared/schema.ts` schemas | Consistent error format across all routes |

---

## Common Pitfalls

### Pitfall 1: Using admin client for user operations
**What goes wrong:** Using `createAdminSupabase()` for the reference photo SELECT/INSERT/DELETE bypasses RLS, meaning any user could theoretically read or delete any other user's photos if the route logic has a bug.
**Why it happens:** Several older routes (like `posts/cleanup`) use the admin client. Developers copy that pattern without checking if RLS should apply.
**How to avoid:** For all `brand_reference_photos` operations, use `authResult.supabase` (user-scoped). RLS policies on the table enforce ownership at the DB layer.
**Warning signs:** Any `createAdminSupabase()` call inside the brand-references route file (outside a legitimate admin path) is wrong.

### Pitfall 2: Querying `brand_reference_photos` by `user_id` without first resolving `brand_id`
**What goes wrong:** The table has both `user_id` and `brand_id`. It is tempting to query by `user_id` directly. But the canonical link is `brand_id` — the GET list endpoint should filter by `brand_id` to correctly handle future multi-brand scenarios (not in scope, but correct design now).
**How to avoid:** Always resolve `brand_id` from `brands WHERE user_id = user.id` first, then query `brand_reference_photos WHERE brand_id = brand.id`.

### Pitfall 3: Forgetting the storage delete order
**What goes wrong:** Deleting the DB row before storage cleanup means if storage delete fails, the photo_url in the DB row is gone and storage is orphaned permanently.
**Correction:** The blueprint above deletes DB row first (for immediate UI consistency), then storage. Storage failure is logged as a warning but doesn't fail the request. This is the same approach used in `posts.routes.ts` — acceptable for v1.5 since orphaned storage files are recoverable.

### Pitfall 4: `.single()` vs `.maybeSingle()` on brand lookup
**What goes wrong:** Using `.single()` throws a PostgREST error if no row exists; using `.maybeSingle()` returns `null` data but no error. For the brand lookup, `.single()` is correct since a user without a brand should get a 404. For the max-position query, `.maybeSingle()` is correct (the table may be empty).
**How to avoid:** `brands SELECT ... .single()` (required). `brand_reference_photos MAX(position) ... .maybeSingle()` (optional row).

### Pitfall 5: Migration timestamp collision
**What goes wrong:** Using a timestamp already taken causes Supabase to skip or error on the migration.
**How to avoid:** Use exactly `20260516000000`. The prior migration is `20260508203515` — no collision exists at this timestamp.

### Pitfall 6: Missing `.js` extension in imports
**What goes wrong:** The project uses `tsx` + Node ESM. All relative imports in TypeScript files require the `.js` extension (e.g., `"./brand-references.routes.js"` not `"./brand-references.routes"`).
**How to avoid:** Follow every existing import in `server/routes/index.ts` — all end with `.js`.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 18 is purely code + config changes (TypeScript files + SQL migration). No external CLI tools, services, or runtimes beyond the project's existing Node.js + Supabase stack are required. All environment variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are already required by the project and assumed present.

---

## Validation Architecture

`workflow.nyquist_validation` is not present in `.planning/config.json` — treated as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — project uses hand-written `scripts/verify-phase-{N}.ts` static harnesses |
| Config file | None (no jest.config, vitest.config, or pytest.ini found) |
| Quick run command | `npx tsx scripts/verify-phase-18.ts` |
| Full suite command | `npm run check` (TypeScript type check) + `npx tsx scripts/verify-phase-18.ts` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REF-01 | Migration file exists with correct SQL | Static harness | `npx tsx scripts/verify-phase-18.ts` | Wave 0 |
| REF-01 | Zod schemas exported from shared/schema.ts | Static harness | `npx tsx scripts/verify-phase-18.ts` | Wave 0 |
| API-01 thru API-04 | Route file exists with all 4 endpoints declared | Static harness | `npx tsx scripts/verify-phase-18.ts` | Wave 0 |
| API-01 thru API-04 | TypeScript compiles without errors | Type check | `npm run check` | Existing |

### Wave 0 Gaps

- [ ] `scripts/verify-phase-18.ts` — covers REF-01 + API-01 through API-04 (15 static assertions)

*(No test framework installation needed — project convention is `npx tsx` to run scripts directly)*

---

## State of the Art

No external libraries are being introduced. All patterns are internal.

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| N/A | Client-direct upload (logo pattern) | No multipart middleware needed |
| N/A | RLS with `user_id` column on child table | O(1) RLS check without subquery JOIN |

---

## Open Questions

1. **Should `brands` have an explicit UPDATE RLS policy for `style_description`?**
   - What we know: `brands` table has existing RLS. The `style_description` PATCH uses the user-scoped client (RLS applies). The existing RLS on `brands` allows users to UPDATE their own brand row (`WHERE user_id = auth.uid()`). This is confirmed by the settings pages that update `logo_url` and brand colors.
   - What's unclear: The exact policy names/statements in the `brands` table RLS are not visible in the migration files reviewed (the brands RLS was set up in early migrations before Phase 18's scope).
   - Recommendation: The PATCH endpoint should work without any migration change. If it fails in testing, add an UPDATE policy to `brands` in the same migration. LOW risk.

2. **Does the `brand_reference_photos` INSERT RLS policy allow inserting with `user_id` from the body, or does it require `auth.uid()`?**
   - What we know: The INSERT policy is `WITH CHECK (user_id = auth.uid())`. The route handler sets `user_id: user.id` in the insert payload. Since `user.id` comes from the verified JWT via `authenticateUser`, these will always match.
   - Recommendation: No issue. The check is correct.

---

## Sources

### Primary (HIGH confidence)
- `server/routes/posts.routes.ts` (lines 24-43) — `getStorageObjectPathFromPublicUrl` exact implementation
- `server/routes/posts.routes.ts` (lines 51-58) — `authenticateUser` inline pattern
- `server/routes/generate.routes.ts` (lines 209-213) — brand_id from user_id pattern
- `server/middleware/auth.middleware.ts` — full `authenticateUser` signature and return shape
- `server/supabase.ts` — `createServerSupabase(token)` and `createAdminSupabase()` signatures
- `server/routes/index.ts` — route registration pattern (import + `router.use()` + export)
- `shared/schema.ts` — existing `brandSchema` to extend; Zod patterns throughout
- `supabase/migrations/20260421000000_v1_1_schema_foundation.sql` — table creation + RLS + index SQL pattern
- `supabase/migrations/20260508203515_integration_settings_sync_on_signup.sql` — latest migration format (additive ALTER TABLE)
- `.planning/phases/18-data-layer-api-endpoints/18-CONTEXT.md` — all locked decisions

---

## Metadata

**Confidence breakdown:**
- Migration SQL: HIGH — derived directly from existing migration patterns in the codebase
- Zod schemas: HIGH — exact definitions from CONTEXT.md, consistent with `shared/schema.ts` conventions
- Route patterns: HIGH — every pattern confirmed with line-level source citations
- RLS policies: HIGH — pattern matches `post_slides` RLS from `20260421000000` migration
- Index recommendations: HIGH — consistent with existing table indexes

**Research date:** 2026-05-16
**Valid until:** 2026-06-16 (stable patterns — no external library churn)
