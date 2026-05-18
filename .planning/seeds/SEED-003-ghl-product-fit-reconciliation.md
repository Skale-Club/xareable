---
id: SEED-003
status: graduated
planted: 2026-05-08
planted_during: v1.1 milestone post-completion (plan/ folder review)
graduated: 2026-05-18
graduated_as: "No new phase needed — integration is complete via two-phase architecture (tag-on-signup + enrich-on-brand-setup). Documented in fanGHLSignup JSDoc."
trigger_when: when adding any lead-capture surface to Xareable, OR when reviewing dead admin config to remove
scope: Small
---

> **STATUS NOTE (2026-05-18):** This seed was graduated without a dedicated phase. Audit found the GHL integration is complete and working:
>
> - **custom_field_mappings are NOT dead code.** They're applied in `syncLeadToGHL` (called from `POST /api/marketing/lead` → triggered by `trackLeadEvent` in `onboarding.tsx` on brand setup completion).
> - **`fanGHLSignup` is intentionally simple** (tag-only, no field mappings). At signup time, brand data doesn't exist yet so there are no answers to map. The full sync happens in Phase 2 (brand setup).
> - **Two-phase architecture** documented in JSDoc on `fanGHLSignup` (2026-05-18).
> - The "missing triggers" (`form_leads/progress`, `complete_lead`) were implemented differently than the original plan expected: as `POST /api/marketing/lead` during onboarding.
>
> The seed body below is preserved for historical context.

# SEED-003: GHL integration — product-fit reconciliation

## Why This Matters

The GHL (GoHighLevel) integration was built **half**:

✅ **Implemented:**
- Admin config UI (API key, location ID, test connection, custom field mapping)
- Server routes: `GET/PATCH /api/admin/ghl`, `POST /api/admin/ghl/test`, `GET /api/admin/ghl/custom-fields`
- Service module `server/integrations/ghl.ts` with full API wrapper (search/create/update contact)
- Zod schemas in `shared/schema.ts`
- DB tables: `integration_settings`, GHL config row

❌ **Not implementable as written:**
The original plan (`plan/in-progress/ghl-integration-plan.md`) defines two sync triggers:
- "Lead Complete in `/api/form-leads/progress`"
- "AI tool `complete_lead` handler in chat flow"

**Neither exists in Xareable.** Searching the codebase: zero matches for `form_leads`, `complete_lead`, or any chat/lead-capture surface. Xareable is an AI-powered post generator — it has no lead-capture forms, no AI chat with tool-calls, no contacts to sync.

The GHL plan was written for a different product context (probably an earlier vision of the platform).

## What's Left to Decide

Three honest options:

1. **Remove the GHL admin config entirely** — it can't do anything useful for Xareable users. Reduces dead code, removes confusing UI from admin panel, deletes related migrations.

2. **Build the lead-capture surface** — add a "Capture leads on landing/marketing pages" feature, then GHL sync becomes a real integration with a real source of leads. Sub-options: web form embed, AI chat assistant on landing, signup-event sync as the lead.

3. **Repurpose GHL as a marketing-events sink** — wire `trackMarketingEvent` to also push to GHL when the integration is enabled (treat each Xareable user signup or paying conversion as a "lead" in the GHL CRM). Smallest change; most opportunistic.

## When to Surface

**Trigger:** any of the following:
- Roadmap touches lead capture, contact forms, or onboarding sales funnels
- Admin housekeeping pass to remove dead config surfaces
- A user actually asks "what does the GHL integration do?" (would also indicate option 1 or 2 needs deciding)

Surface during `/gsd:new-milestone` if scope mentions: lead capture, forms, CRM, sales funnel, contact sync, marketing automation.

## Scope Estimate

**Small** — the decision itself is small. Each path has its own scope:
- Option 1 (remove): Small — strip routes, UI, schemas, run a cleanup migration
- Option 2 (build lead capture): Medium-Large — a whole new product surface
- Option 3 (repurpose as marketing-event sink): Small — add a GHL push branch to `trackMarketingEvent`

## Breadcrumbs

Existing GHL implementation (admin-side):
- `server/integrations/ghl.ts`
- `server/routes/integrations.routes.ts` — GHL endpoints
- `client/src/components/admin/integrations-tab.tsx` — admin UI
- `shared/schema.ts` — `adminGHLStatusSchema`, `saveGHLSettingsRequestSchema`, `ghlContactPayloadSchema`, `ghlCustomFieldSchema`
- `supabase/migrations/20260305000013_integration_settings.sql`
- `supabase/migrations/20260305183530_ghl_integration.sql`

Original plan (will be deleted with `plan/`; preserved here):
- `plan/in-progress/ghl-integration-plan.md` — full architecture, but lead-sync section assumes nonexistent product features

## Notes

This is a low-stakes, easy-to-defer decision. But it's worth surfacing because right now an admin sees "GHL integration" in the panel and can configure it but it cannot do anything observable. That's a UX trap.
