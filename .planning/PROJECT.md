# My Social Autopilot

## What This Is

AI-powered social media content creation SaaS platform. Users connect their brand identity (colors, logo, mood), describe what they want to post, and the platform uses Google Gemini to generate a complete post — headline, caption, and a branded image — ready to publish. Target audience is small businesses and creators who want consistent, on-brand social media presence without a design team.

## Core Value

Users can generate on-brand visual content (single posts, multi-slide carousels, and professionally enhanced product photos) in seconds from a prompt or a reference image.

## Current Milestone: v1.1 Media Creation Expansion

**Goal:** Add two new media creation surfaces — an Instagram carousel generator and a single-image photo enhancement tool — alongside the existing post/video generator.

**Target features:**
- Carousel generator — N sequential Instagram-carousel slides (3–10) with shared visual identity, narrative flow (hook → develop → CTA), one unified caption, IG-safe aspect ratios (1:1, 4:5)
- Image enhancement — upgrades a raw user photo (e.g., restaurant product shot) into a professional-looking image with admin-curated scenery presets, no logo/text composition
- Schema + storage expansion to support multi-slide posts and a new `enhancement` content type
- Billing model that charges N × image cost for carousels and a single-image cost for enhancements
- Admin-curated scenery catalog for enhancement (reuses existing `style_catalog` admin pattern)
- Frontend creator and gallery surfaces updated to handle the two new content types

## Requirements

### Validated

- ✓ User can sign up and log in via email/password (Supabase Auth) — v1.0
- ✓ User can configure their Gemini API key in settings — v1.0
- ✓ User can complete brand onboarding (company name, colors, logo, mood) — v1.0
- ✓ User can generate a post from a text prompt (Gemini text + image pipeline) — v1.0
- ✓ User can view post history with generated images — v1.0
- ✓ User can edit an existing post (image regeneration with edit prompt) — v1.0
- ✓ User can transcribe voice input as post prompt — v1.0
- ✓ Admin can view platform stats and manage users — v1.0
- ✓ Server auth and security primitives reject malformed input correctly — v1.0 / Phase 1
- ✓ All Supabase client usage respects RLS policies (user-scoped vs admin) — v1.0 / Phase 2
- ✓ Post version management and admin queries are reliable at scale — v1.0 / Phase 3
- ✓ Client routing, auth state, error surfaces, and cache freshness are correct — v1.0 / Phase 4

### Active

<!-- v1.1 Media Creation Expansion — details live in REQUIREMENTS.md -->

- [ ] User can generate a multi-slide Instagram carousel from a single prompt
- [ ] User can enhance a raw product photo using admin-curated scenery presets
- [ ] Backend supports multi-slide posts and an `enhancement` content type end to end
- [ ] Billing correctly charges carousel × slide-count and enhancement as single-image cost
- [ ] Admin can manage the scenery catalog through the existing admin surface
- [ ] Creator UI and gallery surface carousels and enhancements consistently

### Out of Scope

- Mobile app — web-first, mobile deferred
- Real-time collaboration — single-user content creation
- Direct social media publishing — generation only, no OAuth to platforms
- Video generation in carousels — carousels are image-only for v1.1
- Text overlays or logo composition on enhancements — enhancement is a clean product shot, not a branded post
- User-uploaded custom sceneries — scenery catalog is admin-curated for v1.1

## Context

Brownfield project with existing codebase. Full-stack TypeScript monorepo: React 18 + Vite (frontend), Express 5 (backend), Supabase (PostgreSQL + RLS + Auth + Storage), Google Gemini REST API. Milestone v1.0 (Bug Fixes & System Hardening, completed 2026-04-20) closed 22 audit findings across security, auth, Supabase client correctness, data integrity, and frontend reliability. v1.1 is the first feature-expansion milestone and reuses the patterns hardened in v1.0 (SSE-streamed generation, shared auth middleware, admin-scoped Supabase operations, TanStack Query cache discipline).

## Constraints

- **Tech Stack**: TypeScript, React, Express 5, Supabase, Gemini — add new libraries only when strictly required for the new features
- **Language**: All planning docs, commit messages, code comments, and user-facing strings authored in this milestone must be in English
- **Supabase**: RLS policies must be respected; admin operations use the service role client only
- **Auth**: All protected endpoints require `Authorization: Bearer <token>`; reuse shared auth middleware (`authenticateUser`, `getGeminiApiKey`, `usesOwnApiKey`)
- **Storage**: New assets follow the existing `user_assets/{userId}/…` layout with thumbnails under `thumbnails/`
- **Billing**: Every paid generation path must flow through `checkCredits` → `recordUsageEvent` → `deductCredits` so affiliate commissions, usage budgets, and overage accounting stay consistent

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| User-scoped vs admin Supabase client | User client respects RLS; admin bypasses it — wrong client causes silent failures | ✓ Good — standardized in v1.0 Phase 2 |
| Zod safeParse on all request bodies | Prevents processing malformed input | ✓ Good — pattern established in v1.0 |
| staleTime: Infinity global with per-page overrides | Reduces API calls; billing pages override to staleTime: 0 | ✓ Good — v1.0 Phase 4 |
| Reuse `/api/generate` patterns for new routes | SSE streaming, credit gating, and admin-storage uploads are already battle-tested | — Pending — confirmed as constraint for v1.1 |
| Extend `content_type` enum vs new tables per media type | Single discriminator keeps gallery, billing, and storage code paths shared | — Pending — to be locked during v1.1 Phase 1 |

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
*Last updated: 2026-04-21 — Milestone v1.1 Media Creation Expansion initialized*
