# Phase 18: Data Layer + API Endpoints — Discussion Log

> **Audit trail only.** Decisions are in CONTEXT.md — this log preserves alternatives considered.

**Date:** 2026-05-16
**Phase:** 18-data-layer-api-endpoints
**Mode:** --auto (Claude picked recommended defaults)
**Areas decided:** Upload architecture, route file structure, POST body shape, DELETE strategy, migration timestamp, Zod schemas, auth pattern

---

## Upload Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Client-direct upload | Client uploads file to Supabase Storage, then POSTs URL to server | ✓ |
| Server multipart | Client sends file to Express server via multipart/form-data; server uploads | |
| Base64 JSON | Client encodes file as base64, sends in JSON body | |

**Claude's choice:** Client-direct — matches existing logo upload pattern exactly. No multipart middleware needed.

---

## Route File

| Option | Description | Selected |
|--------|-------------|----------|
| New `brand-references.routes.ts` | Dedicated file for brand reference photo endpoints | ✓ |
| Add to `settings.routes.ts` | Extend existing settings route file | |

**Claude's choice:** New file — settings.routes.ts handles app-level settings, not user brand data.

---

## Claude's Discretion

- Migration timestamp (`20260516000000`)
- Position auto-assignment strategy (max+1)
- `getStorageObjectPathFromPublicUrl` copied locally rather than refactored into shared util
- Zod schema naming (`brandReferencePhotoSchema`, `createBrandReferencePhotoSchema`, `updateStyleDescriptionSchema`)

## Deferred Ideas

None identified for this phase.
