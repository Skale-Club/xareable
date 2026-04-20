# My Social Autopilot

## What This Is

AI-powered social media content creation SaaS platform. Users connect their brand identity (colors, logo, mood), describe what they want to post, and the platform uses Google Gemini to generate a complete post — headline, caption, and a branded image — ready to publish. Target audience is small businesses and creators who want consistent, on-brand social media presence without a design team.

## Core Value

Users can generate a complete, on-brand social media post (image + caption) in seconds using only a text prompt.

## Requirements

### Validated

- ✓ User can sign up and log in via email/password (Supabase Auth)
- ✓ User can configure their Gemini API key in settings
- ✓ User can complete brand onboarding (company name, colors, logo, mood)
- ✓ User can generate a post from a text prompt (Gemini text + image pipeline)
- ✓ User can view post history with generated images
- ✓ User can edit an existing post (image regeneration with edit prompt)
- ✓ User can transcribe voice input as post prompt
- ✓ Admin can view platform stats and manage users

### Active

- [ ] System correctly tracks and enforces usage credits/billing
- [ ] Auth token handling is secure and consistent across all endpoints
- [ ] All Supabase client usage (user-scoped vs admin) is correct per RLS policies
- [ ] Post version management (delete, cleanup) functions reliably
- [ ] Admin endpoints are protected and correctly surfaced to admins

### Out of Scope

- Mobile app — web-first, mobile deferred
- Real-time collaboration — single-user content creation
- Direct social media publishing — generation only, no OAuth to platforms
- Video generation — image-first for v1

## Context

Brownfield project with existing codebase. Full-stack TypeScript monorepo: React 18 + Vite (frontend), Express 5 (backend), Supabase (PostgreSQL + RLS + Auth + Storage), Google Gemini REST API. A comprehensive system audit (2026-04-20) identified 30 bugs across security, data integrity, and UX layers. This milestone addresses those findings before any new feature work.

## Constraints

- **Tech Stack**: TypeScript, React, Express 5, Supabase, Gemini — no new dependencies unless required for a fix
- **Supabase**: RLS policies must be respected; admin operations use service role client only
- **Auth**: All protected endpoints require `Authorization: Bearer <token>`; token extracted via prefix check (not string replace)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| User-scoped vs admin Supabase client | User client respects RLS; admin bypasses it — wrong client causes silent failures | ⚠️ Revisit — several routes use wrong client |
| Zod safeParse on all request bodies | Prevents processing malformed input | ✓ Good — pattern established |
| staleTime: Infinity on TanStack queries | Reduces API calls | ⚠️ Revisit — financial data needs cache invalidation |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-20 — Milestone v1.0 Bug Fixes & System Hardening initialized*
