# Phase 17: GHL Signup Sync (Wire-Up) - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Source:** Direct authoring after roadmapper surfaced 5 storage-shape Planning Concerns; all 5 verified against live code and resolved here.

<domain>
## Phase Boundary

Wire the existing GHL admin (functional but inert today) into the existing signup hook so every new Xareable user is pushed to GoHighLevel as a contact tagged `xareable`, gated by an admin opt-in checkbox, best-effort.

**In scope (3 GHL reqs):**
- GHL-01: server-side push branch in the signup hook handler that calls `getOrCreateGHLContact()` with email + name + tag `xareable` — gated by both `enabled=true` AND new flag `sync_on_signup=true`
- GHL-02: admin checkbox UI in the GHL card persisting the new opt-in flag
- GHL-03: best-effort error handling — push failures NEVER block signup, are logged via existing `recordIntegrationDeliveryLog()` for ops visibility

**Out of scope:**
- Other event types (first_generation, subscription, etc.)
- Bidirectional sync, webhook receivers, custom field mappings beyond email/name/tags
- Backfill of existing users
- Renaming `POST /api/telegram/notify-signup` route — that's bigger churn than v1.4 deserves

</domain>

<decisions>
## Implementation Decisions — 5 Planning Concerns RESOLVED

### Decision 1: Hook into existing `POST /api/telegram/notify-signup` handler

The existing route at `server/routes/integrations.routes.ts:1863` already:
- Validates this is a real signup (10-min window after `created_at`)
- Calls `trackMarketingEvent({ event_name: "CompleteRegistration", event_key: "signup:<user.id>", ... })` at line 1901
- Reads `integration_settings` for telegram, branches on enabled/configured, sends telegram message, records `integration_delivery_logs` row

**Decision: add GHL branch in PARALLEL with the telegram branch in the same handler.** Same pattern, different integration_type. No new routes. No rename.

The route name is admittedly misleading once GHL ships ("notify-signup" is the spirit; "telegram/" is historical baggage). **Mitigation:** add a JSDoc comment at the route declaration explaining: "Despite the path name, this handler fans the signup event to ALL configured integrations (telegram, GHL, future). Path is preserved for API contract stability."

### Decision 2: Reuse existing `integration_delivery_logs` for GHL deliveries

Per Planning Concern (b), `marketing_events.delivery_status` JSONB does NOT exist. The `marketing_events` table has fixed `ga4_status`/`facebook_status` columns and is the wrong place to add per-integration delivery state.

**Decision: reuse the existing `integration_delivery_logs` table** (created in migration `20260307000000_integration_observability.sql`). The telegram signup branch already writes to it via `recordIntegrationDeliveryLog()` at `server/routes/integrations.routes.ts:150`. Schema already supports any `integration_type` string — `'ghl'` slots in cleanly.

The `recordIntegrationDeliveryLog` helper accepts:
```typescript
{
  sb: SupabaseAdminClient,
  integrationType: string,    // → 'ghl'
  eventName: string,          // → 'CompleteRegistration'
  eventKey: string,           // → 'signup:<user.id>'
  userId: string,
  status: 'sent' | 'failed' | 'skipped',
  reason?: string,            // failure / skip details
  payload?: object,           // → { contact_id, created } on success
}
```

No migration needed. Identical observability surface to telegram.

### Decision 3: New `sync_on_signup boolean` column on `integration_settings`

Per Planning Concern (c), `integration_settings.ghl.settings` JSONB does NOT exist. The table has fixed columns + a single `custom_field_mappings` JSONB that is semantically different (GHL field-id mappings, not feature flags).

Three options were considered:
1. Add a `sync_on_signup boolean DEFAULT false` column — clean schema, query-friendly
2. Stash inside `custom_field_mappings` under a synthetic reserved key — zero migration but conflates concerns
3. Add a generic `settings jsonb` column for current + future flags — over-engineered for one boolean

**Decision: Option 1 — add `sync_on_signup boolean DEFAULT false NOT NULL` column.**

Reasoning:
- Single boolean, no need for JSONB
- Admin GET response can return it as a typed field (no JSON casting)
- Migration is trivial: `ALTER TABLE integration_settings ADD COLUMN IF NOT EXISTS sync_on_signup boolean NOT NULL DEFAULT false;`
- Future per-integration flags can each get their own column when the time comes (or migrate to JSONB then if it gets unwieldy)

**Migration filename:** `supabase/migrations/20260508{HHMMSS}_integration_settings_sync_on_signup.sql` (use current UTC timestamp).

The flag applies to ALL integration rows but only the GHL row uses it for now. Telegram has its own opt-in (`metadata.notify_on_new_signup` inside `custom_field_mappings`); we don't migrate that. Future consolidation is out of scope.

### Decision 4: `getOrCreateGHLContact()` already accepts `tags` — no wrapper change

Per Planning Concern (d), confirmed by reading `shared/schema.ts:592`:

```typescript
export const ghlContactPayloadSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  // ... address fields ...
  customFields: z.record(z.string()).optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type GHLContactPayload = z.infer<typeof ghlContactPayloadSchema>;
```

`tags` is already an optional array of strings. The `getOrCreateGHLContact(config, payload)` call at `server/integrations/ghl.ts:382` accepts the full payload. **No wrapper changes; just pass `tags: ['xareable']` in the payload.**

### Decision 5: Event name + idempotency

The signup event in `trackMarketingEvent` uses `event_name: "CompleteRegistration"` and `event_key: "signup:<user.id>"`. The GHL branch uses these EXACT names when calling `recordIntegrationDeliveryLog`.

The handler already gates on `looksLikeNewSignup` (10-min window after `created_at`), and `event_key` provides idempotency at the marketing_events level. For the GHL push specifically, idempotency comes from `getOrCreateGHLContact` itself (search-then-create-or-update), so duplicate calls produce one contact + N updates rather than N contacts.

The handler runs once per call to `POST /api/telegram/notify-signup`, which `client/src/lib/auth.tsx` invokes once per session (not on every page load — gated client-side). Combined: GHL push fires effectively once per signup.

### Decision 6: Field extraction — what to send to GHL

Pull from the Supabase auth user object available in the handler:

| GHL field | Source |
|---|---|
| `email` | `user.email` (always present) |
| `firstName` | `user.user_metadata?.full_name?.split(' ')[0]` if present, else `undefined` |
| `lastName` | `user.user_metadata?.full_name?.split(' ').slice(1).join(' ')` if present, else `undefined` |
| `name` | `user.user_metadata?.full_name` (if present) — GHL uses this if first/last empty |
| `source` | `'Xareable'` — overrides the default `'Xareable'` from `buildGHLContactPayload` (we don't use that builder; we construct the payload inline since the form-leads pattern doesn't apply) |
| `tags` | `['xareable']` |

**No phone, no address, no custom fields** — out of scope. The GHL admin can add custom field mappings later via existing field-mapping UI, but that's V2.

### Decision 7: Plan structure — recommend 1 plan, 4 tasks

Single plan because the work is glue between four already-existing surfaces:
1. Migration: add `sync_on_signup` column + extend `saveGHLSettingsRequestSchema` + `adminGHLStatusSchema` Zod schemas
2. Server: add GHL branch in `POST /api/telegram/notify-signup` handler (parallel to telegram); update GHL admin GET to include `sync_on_signup`; update GHL admin PATCH to accept and persist the flag; add JSDoc smell-comment to the route
3. Client: add the checkbox + help text in the GHL card in `integrations-tab.tsx`; wire up to existing TanStack Query mutation; reflect saved state without page reload
4. Verify harness: optional `scripts/verify-phase-17.ts` static checks (file exists, schema fields, helpers, etc.) — recommended but the planner can roll it into Task 2 or 3 if scope feels tight

</decisions>

<canonical_refs>
## Canonical References

### Files to MODIFY
- `server/routes/integrations.routes.ts` — add GHL branch in `POST /api/telegram/notify-signup` handler (after the existing telegram branch, before the final `res.json()`); update GHL admin GET (around the `getLatestIntegrationSetting(sb, "ghl", ...)` call) to include `sync_on_signup`; update GHL admin PATCH to accept the flag in body and persist it.
- `shared/schema.ts` — extend `saveGHLSettingsRequestSchema` and `adminGHLStatusSchema` with `sync_on_signup: z.boolean().optional()` (`adminGHLStatusSchema`) and `sync_on_signup: z.boolean()` (`saveGHLSettingsRequestSchema` if existing, otherwise add)
- `client/src/components/admin/integrations-tab.tsx` — add the checkbox + help text in the GHL card (around line 1054 per the v1.4 roadmap reference); wire to existing GHL save mutation; reflect saved state from GET response

### Files to CREATE
- `supabase/migrations/{timestamp}_integration_settings_sync_on_signup.sql` — single ALTER TABLE adding the boolean column
- `scripts/verify-phase-17.ts` (optional but recommended) — static checks per the verify-phase pattern

### Files NOT to touch
- `server/integrations/ghl.ts` — `getOrCreateGHLContact` and the `tags` field both already exist; zero changes needed
- The original `integration_settings` migration (`20260305000013_integration_settings.sql`) — the new migration is additive
- `marketing_events` table or its delivery columns — not used for GHL delivery
- The telegram signup branch — left untouched; GHL branch runs in parallel

### Key existing patterns to mirror

#### `recordIntegrationDeliveryLog` (telegram precedent)

Used at `server/routes/integrations.routes.ts:1925, 1946, 360, 373, 386, 449, 461`:

```typescript
await recordIntegrationDeliveryLog({
  sb,
  integrationType: "ghl",
  eventName: "CompleteRegistration",
  eventKey,
  userId: user.id,
  status: "sent" | "failed" | "skipped",
  reason: "..." (failure or skip detail),
  payload: { contact_id: result.contactId, created: result.created },  // on success
});
```

#### `getLatestIntegrationSetting` for reading config

Telegram pattern (line 1922):
```typescript
const { row: telegramSettings, error } = await getLatestIntegrationSetting(
  sb, "telegram", "id, enabled, api_key, custom_field_mappings"
);
```

GHL pattern (NEW — add `sync_on_signup` to the column list):
```typescript
const { row: ghlSettings, error: ghlSettingsError } = await getLatestIntegrationSetting(
  sb, "ghl", "id, enabled, api_key, location_id, sync_on_signup"
);
```

</canonical_refs>

<specifics>
## Specific Ideas

### Migration

```sql
-- Phase 17 (v1.4) — opt-in flag for GHL signup sync.
-- Reuses existing integration_settings table; no new table.

ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS sync_on_signup boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.integration_settings.sync_on_signup IS
  'Per-integration opt-in: when true, this integration receives a push when a Xareable user signs up. Phase 17 wires the GHL branch; future integrations can opt in by reading this flag from their handler.';
```

### Server signup-handler GHL branch (sketch)

Add AFTER the existing telegram block, BEFORE the final `res.json()` in `POST /api/telegram/notify-signup`:

```typescript
// ── GHL branch (Phase 17, v1.4) ────────────────────────────────────────
// Despite the route name, this handler fans the signup event to ALL configured
// integrations. GHL is the second branch (telegram is the first). Path is
// preserved for API contract stability — rename out of scope for v1.4.
{
  const {
    row: ghlSettings,
    error: ghlSettingsError,
  } = await getLatestIntegrationSetting(
    sb,
    "ghl",
    "id, enabled, api_key, location_id, sync_on_signup",
  );

  if (ghlSettingsError) {
    console.error("[GHL] sync skipped: settings read failed", ghlSettingsError.message);
    await recordIntegrationDeliveryLog({
      sb,
      integrationType: "ghl",
      eventName: "CompleteRegistration",
      eventKey,
      userId: user.id,
      status: "failed",
      reason: ghlSettingsError.message || "settings_read_failed",
    });
  } else if (
    !ghlSettings?.enabled ||
    !ghlSettings?.sync_on_signup ||
    !ghlSettings?.api_key ||
    !ghlSettings?.location_id
  ) {
    await recordIntegrationDeliveryLog({
      sb,
      integrationType: "ghl",
      eventName: "CompleteRegistration",
      eventKey,
      userId: user.id,
      status: "skipped",
      reason: "integration_not_configured",
    });
  } else {
    const fullName = String(user.user_metadata?.full_name || "").trim();
    const [firstName, ...rest] = fullName ? fullName.split(/\s+/) : [];
    const lastName = rest.length > 0 ? rest.join(" ") : undefined;

    try {
      const result = await getOrCreateGHLContact(
        { apiKey: ghlSettings.api_key, locationId: ghlSettings.location_id },
        {
          email: user.email || undefined,
          firstName: firstName || undefined,
          lastName,
          name: fullName || undefined,
          source: "Xareable",
          tags: ["xareable"],
        },
      );

      if (result.success) {
        console.log(`[GHL] sync ok user=${user.id} contact=${result.contactId} created=${result.created}`);
        await recordIntegrationDeliveryLog({
          sb,
          integrationType: "ghl",
          eventName: "CompleteRegistration",
          eventKey,
          userId: user.id,
          status: "sent",
          reason: result.created ? "contact_created" : "contact_updated",
          payload: { contact_id: result.contactId, created: result.created },
        });
      } else {
        console.error(`[GHL] sync fail user=${user.id} reason=${result.error}`);
        await recordIntegrationDeliveryLog({
          sb,
          integrationType: "ghl",
          eventName: "CompleteRegistration",
          eventKey,
          userId: user.id,
          status: "failed",
          reason: result.error || "ghl_api_error",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown_error";
      console.error(`[GHL] sync threw user=${user.id} reason=${message}`);
      await recordIntegrationDeliveryLog({
        sb,
        integrationType: "ghl",
        eventName: "CompleteRegistration",
        eventKey,
        userId: user.id,
        status: "failed",
        reason: message,
      });
    }
  }
}
// ── end GHL branch ──────────────────────────────────────────────────────
```

The `try/catch` is defensive belt-and-suspenders: `getOrCreateGHLContact` already returns `{success:false, error}` on API errors per its contract, but a network exception or programming bug could throw — we catch that explicitly to honor the GHL-03 best-effort requirement.

### Admin GET extension (sketch)

Find the existing `GET /api/admin/ghl` handler (around `getLatestIntegrationSetting(sb, "ghl", ...)`); add `sync_on_signup` to the column list and to the response body:

```typescript
// Before (existing):
const { row: ghlSettings } = await getLatestIntegrationSetting(
  sb, "ghl", "id, enabled, api_key, location_id, custom_field_mappings, last_sync_at"
);
// + response: { configured, enabled, api_key_masked, location_id, last_sync_at, connection_status }

// After (add sync_on_signup):
const { row: ghlSettings } = await getLatestIntegrationSetting(
  sb, "ghl", "id, enabled, api_key, location_id, custom_field_mappings, last_sync_at, sync_on_signup"
);
// + response: { ..., sync_on_signup: Boolean(ghlSettings?.sync_on_signup) }
```

### Admin PATCH extension (sketch)

The existing `PATCH /api/admin/ghl` handler accepts `enabled`, `api_key`, `location_id`, `custom_field_mappings`. Add `sync_on_signup`:

```typescript
// In the handler:
const updates: Record<string, unknown> = {};
if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
if (typeof body.api_key === "string") updates.api_key = body.api_key;
if (typeof body.location_id === "string") updates.location_id = body.location_id;
if (body.custom_field_mappings) updates.custom_field_mappings = body.custom_field_mappings;
if (typeof body.sync_on_signup === "boolean") updates.sync_on_signup = body.sync_on_signup;  // NEW
```

Update `saveGHLSettingsRequestSchema` in `shared/schema.ts` accordingly.

### Admin UI checkbox (sketch)

In `client/src/components/admin/integrations-tab.tsx` GHL card, add after the existing enable toggle / API key fields:

```tsx
<div className="flex items-start gap-2 mt-3">
  <Checkbox
    id="ghl-sync-on-signup"
    checked={ghlSettings?.sync_on_signup ?? false}
    onCheckedChange={(checked) => {
      saveGhlMutation.mutate({ ...ghlSettings, sync_on_signup: Boolean(checked) });
    }}
    disabled={saveGhlMutation.isPending || !ghlSettings?.enabled}
  />
  <div className="space-y-1">
    <Label htmlFor="ghl-sync-on-signup" className="cursor-pointer font-medium">
      {t("Sync new signups to GHL (tagged \"xareable\")")}
    </Label>
    <p className="text-xs text-muted-foreground">
      {t("When enabled, every new Xareable user is automatically created as a contact in your GoHighLevel location, tagged \"xareable\". Use this tag to trigger campaigns or workflows inside GHL.")}
    </p>
  </div>
</div>
```

(Adjust to match the existing GHL card's spacing/layout. Use existing translation pattern if the file has `t()` already; if not, EN inline is fine — PT/ES translations can land in the same task.)

### Verification harness (optional, scripts/verify-phase-17.ts)

```typescript
// Static checks:
// 1. migration file exists with sync_on_signup column add
// 2. shared/schema.ts: saveGHLSettingsRequestSchema + adminGHLStatusSchema include sync_on_signup
// 3. server/routes/integrations.routes.ts: GHL branch present in /api/telegram/notify-signup handler
//    (grep for: integrationType: "ghl" AND eventName: "CompleteRegistration")
// 4. server/routes/integrations.routes.ts: GHL admin GET response includes sync_on_signup
// 5. server/routes/integrations.routes.ts: GHL admin PATCH accepts sync_on_signup in body
// 6. client/src/components/admin/integrations-tab.tsx: ghl-sync-on-signup checkbox present
// 7. server/integrations/ghl.ts: byte-identical to HEAD (sealed — wrapper unchanged)
// 8. npm run check + npm run build exit 0

// Optional dynamic check (gated on env): create a fake integration_settings row, hit
// the admin GET endpoint, assert sync_on_signup in response. Skip if no env.
```

</specifics>

<deferred>
## Deferred Ideas

- **Other event types** (first_generation, subscription_started, subscription_canceled) — V2 / future seed
- **Bidirectional GHL → Xareable sync** — never; out of scope by design
- **Webhook receivers from GHL** — not relevant for push-only model
- **Custom field mappings UI** — V2; the existing `custom_field_mappings` JSONB on `integration_settings` is wired but unused for v1.4
- **Backfill of existing users to GHL** — V2; one-shot script `scripts/backfill-ghl-signups.ts` if needed
- **Multi-tag support** — V2 if you want segmentation by signup-source-cohort later
- **Renaming `POST /api/telegram/notify-signup` route** — bigger churn than v1.4 deserves; rename is its own micro-phase
- **Consolidating telegram's `notify_on_new_signup` flag (currently inside `custom_field_mappings` JSONB) into the new `sync_on_signup` boolean** — V2 cleanup; would unify per-integration opt-in semantics

</deferred>

---

*Phase: 17-ghl-signup-sync-wire-up*
*Context gathered: 2026-05-08*
