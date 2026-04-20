# Phase 1: Security & Auth Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 01-security-auth-hardening
**Areas discussed:** requireAdmin refactor scope, Settings route merge strategy, Token extraction fix scope

---

## Token Extraction Fix Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Fix only extractToken() | Minimal — one function, one change | |
| Fix all call sites | Fix extractToken + requireAdminGuard + requireAdmin inline usages | ✓ |

**User's choice:** Recommended (all call sites)
**Notes:** Same vulnerability exists in 3 places; fixing all is safer and consistent.

---

## requireAdmin Refactor Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal fix | Attach req.profile to request after admin check passes | ✓ |
| DRY refactor | Call authenticateUser() internally to eliminate duplicated auth logic | |

**User's choice:** Recommended (minimal fix)
**Notes:** DRY unification is valid future work but out of scope for a bugfix phase.

---

## Settings Route Merge Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Keep settings.routes.ts | Richer handler with icon_url logic — remove duplicate from config.routes.ts | ✓ |
| Keep config.routes.ts | Simpler handler — loses icon_url logic | |
| Extract to service | Move icon_url logic to shared service | |

**User's choice:** Recommended (keep settings.routes.ts)
**Notes:** icon_url from landing_content is the correct behavior; no new service layer needed.

---

## Claude's Discretion

- Exact error message wording for invalid Bearer token
- Whether to add JSDoc comment on corrected extractToken

## Deferred Ideas

None.
