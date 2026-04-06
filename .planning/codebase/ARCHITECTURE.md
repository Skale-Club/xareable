# Architecture

**Analysis Date:** 2026-04-06

## Pattern Overview

**Overall:** Full-stack TypeScript monorepo with client/server split, BFF (Backend for Frontend) pattern, and external service delegation (Supabase, Gemini, Stripe).

**Key Characteristics:**
- React SPA served by an Express 5 API server (dev: Vite middleware; prod: static files)
- All auth delegated to Supabase Auth; server re-validates every request via JWT
- AI generation streamed over SSE rather than a single HTTP response
- Shared Zod schemas in `shared/schema.ts` are the single source of truth for types

## Layers

**Frontend (React SPA):**
- Purpose: User interface, routing, state management
- Location: `client/src/`
- Contains: Pages, components, context providers, hooks, lib utilities
- Depends on: `shared/schema.ts` types, `/api/*` endpoints, Supabase Auth client
- Used by: End users via browser

**Express API Server:**
- Purpose: Business logic, AI orchestration, auth validation, billing
- Location: `server/`
- Contains: Route modules, middleware, services, integrations
- Depends on: Supabase (DB + Storage), Gemini REST API, Stripe API
- Used by: Frontend SPA

**Shared Layer:**
- Purpose: Type contracts between client and server
- Location: `shared/schema.ts`, `shared/config/`
- Contains: Zod schemas, TypeScript types, constants
- Depends on: Nothing (pure Zod)
- Used by: Both `client/src/` and `server/`

**Services Layer (server-side):**
- Purpose: Isolate AI, image processing, and storage operations
- Location: `server/services/`
- Contains: Gemini service, image generation, text rendering, caption quality, storage cleanup
- Depends on: Gemini REST API, Sharp (image processing)
- Used by: Route handlers

## Data Flow

**AI Generation (POST /api/generate):**
1. Client sends `Authorization: Bearer <token>` + generation params via `apiRequest()`
2. `authenticateUser()` middleware validates JWT via `supabase.auth.getUser(token)`
3. Profile fetched via admin Supabase client (bypasses RLS)
4. `checkCredits()` (`server/quota.ts`) validates billing allowance
5. Server initializes SSE stream (`server/lib/sse.ts`) and streams progress events
6. Phase 1: `gemini.service.ts` calls Gemini text model → JSON content plan
7. Phase 2: `image-generation.service.ts` calls Gemini image model → PNG buffer
8. Optional: `text-rendering.service.ts` verifies/repairs exact text in image
9. Optional: logo overlay applied via `image-optimization.service.ts`
10. Image optimized + thumbnail generated; both uploaded to Supabase Storage (`user_assets/`)
11. `caption-quality.service.ts` polishes the social caption
12. Post record inserted into `posts` table; usage event recorded; credits deducted
13. `sse.sendComplete()` sends final payload to client

**Auth Flow:**
1. `main.tsx` calls `initializeSupabase()` → fetches `SUPABASE_URL` + anon key from `GET /api/config`
2. `AuthProvider` (`client/src/lib/auth.tsx`) subscribes to `supabase.auth.onAuthStateChange`
3. On session, profile and brand fetched directly from Supabase DB (client-side, RLS-gated)
4. Missing profile → auto-created; missing brand → redirect to `/onboarding`
5. All subsequent API calls attach `Authorization: Bearer <token>` header via `getAuthHeaders()` in `client/src/lib/queryClient.ts`

**State Management:**
- Server state: TanStack Query v5 with auth headers injected globally via `getQueryFn`
- UI/Auth state: React Context (`AuthContext`, `PostCreatorContext`, `PostViewerContext`, `AdminModeContext`, `AppSettingsContext`, `LanguageContext`)

## Key Abstractions

**AuthenticatedRequest:**
- Purpose: Extended Express Request carrying `user`, `supabase`, and `profile`
- Location: `server/middleware/auth.middleware.ts`
- Pattern: `authenticateUser()` returns `AuthResult | AuthError`; route handlers check `result.success`

**SSE Stream:**
- Purpose: Incremental progress reporting for long-running AI generation
- Location: `server/lib/sse.ts`
- Pattern: `initSSE(res)` returns helper with `sendProgress()`, `sendComplete()`, `sendError()`

**Quota / Credits:**
- Purpose: Per-user credit gating with billing model support
- Location: `server/quota.ts`
- Pattern: `checkCredits()` → `deductCredits()` → `recordUsageEvent()` after successful generation

**Style Catalog:**
- Purpose: Admin-configurable AI model config, text styles, post formats, moods
- Location: `server/routes/style-catalog.routes.ts`
- Pattern: `getStyleCatalogPayload()` exported and reused across route modules

## Entry Points

**Server:**
- Location: `server/index.ts`
- Triggers: `tsx server/index.ts` (dev) or compiled build (prod)
- Responsibilities: Express app setup, route registration via `createApiRouter()`, Vite middleware (dev) or static serving (prod)

**Client:**
- Location: `client/src/main.tsx`
- Triggers: Browser load
- Responsibilities: `initializeSupabase()` → render `<App />` with all providers

## Error Handling

**Strategy:** Fail fast for pre-flight errors (auth, validation, credits) with JSON responses; SSE `sendError()` for errors during streaming generation.

**Patterns:**
- Route handlers call `authenticateUser()` and check `result.success` before proceeding
- Zod `safeParse()` used on all request bodies before processing
- Generation errors logged to `generation_logs` table via `logGenerationError()`
- Global Express error handler in `server/index.ts` catches unhandled throws

## Cross-Cutting Concerns

**Logging:** `log()` function in `server/index.ts`; all `/api/*` requests logged with method, path, status, duration, response body.

**Validation:** Zod `safeParse()` server-side on all mutation endpoints; types shared from `shared/schema.ts`.

**Authentication:** `requireAuth` middleware (Express middleware style) or `authenticateUser()` (inline functional style) used per-route; `requireAdmin` / `requireAdminGuard` for admin routes.

**Billing:** `server/quota.ts` centralizes credit checking, deduction, and usage recording. `server/stripe.ts` handles Stripe webhooks and auto-recharge.

---

*Architecture analysis: 2026-04-06*
