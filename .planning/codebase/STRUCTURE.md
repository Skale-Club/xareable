# Project Structure

**Analysis Date:** 2026-04-06

## Directory Layout

```
xareable/
├── client/
│   └── src/
│       ├── components/        # Reusable React components
│       │   ├── admin/         # Admin-only UI components and tab panels
│       │   │   ├── post-creation/  # Sub-cards for post-creation admin tab
│       │   │   └── users/         # User management table + dialog
│       │   └── ui/            # shadcn/ui primitives + custom UI atoms
│       ├── context/           # React Context providers (LanguageContext)
│       ├── hooks/             # Custom React hooks
│       │   └── admin/         # Admin-specific hooks
│       ├── lib/               # Non-component utilities and context providers
│       │   └── admin/         # Admin utility types and helpers
│       └── pages/             # Full-page route components
├── server/
│   ├── config/                # App config loading and validation
│   ├── integrations/          # Third-party push integrations (Telegram, Facebook, GHL)
│   ├── lib/                   # Server utilities (SSE helper)
│   ├── middleware/             # Express middleware (auth, admin guards)
│   ├── routes/                # Route modules (one file per domain)
│   ├── services/              # Business logic services (AI, image, storage)
│   └── utils/                 # Server-side utility functions
├── shared/
│   ├── schema.ts              # Zod schemas + TypeScript types (single source of truth)
│   └── config/                # Shared constants
├── api/                       # Vercel serverless function entry point
├── script/                    # Build scripts (tsx script/build.ts)
├── scripts/                   # Additional maintenance scripts
├── supabase/
│   └── migrations/            # SQL migration files
├── docs/                      # Architecture and integration documentation
├── plan/                      # Feature planning documents (in-progress, completed, pending)
└── .planning/codebase/        # GSD codebase analysis documents
```

## Key Files

**Entry Points:**
- `server/index.ts`: Express server bootstrap, middleware setup, Vite dev integration
- `client/src/main.tsx`: React app mount, Supabase initialization
- `client/src/App.tsx`: Root component, all context providers, router, auth guards
- `api/`: Vercel serverless adapter

**Configuration:**
- `server/config/index.ts`: Server environment config loading
- `shared/schema.ts`: All Zod schemas and TypeScript types
- `server/supabase.ts`: `createServerSupabase()` and `createAdminSupabase()` factories
- `client/src/lib/supabase.ts`: Client singleton with lazy init via `/api/config`

**Core Server Logic:**
- `server/routes/index.ts`: Aggregates all route modules into one Express Router
- `server/middleware/auth.middleware.ts`: `authenticateUser`, `requireAuth`, `requireAdmin`, `getGeminiApiKey`
- `server/quota.ts`: Credit checking, deduction, usage event recording
- `server/stripe.ts`: Stripe webhook handling and auto-recharge
- `server/storage.ts`: Supabase Storage upload helpers
- `server/lib/sse.ts`: SSE stream helper for generation progress

**Core Client Logic:**
- `client/src/lib/auth.tsx`: `AuthProvider` + `useAuth` hook — session, profile, brand state
- `client/src/lib/queryClient.ts`: TanStack Query client with auth header injection
- `client/src/lib/post-creator.tsx`: Context for post creation dialog state
- `client/src/lib/post-viewer.tsx`: Context for post viewer/edit dialog state
- `client/src/lib/app-settings.tsx`: Context for admin-configurable app settings
- `client/src/lib/translations.ts`: i18n translation utilities

**Route Modules (server):**
- `server/routes/generate.routes.ts`: `POST /api/generate` — main AI generation pipeline
- `server/routes/edit.routes.ts`: `POST /api/edit-post` — edit post image
- `server/routes/posts.routes.ts`: Post CRUD and listing
- `server/routes/billing.routes.ts`: Billing portal and subscription management
- `server/routes/credits.routes.ts`: Credit balance and top-up
- `server/routes/stripe.routes.ts`: Stripe webhooks
- `server/routes/admin.routes.ts`: Admin user and stats endpoints
- `server/routes/settings.routes.ts`: Gemini API key management
- `server/routes/affiliate.routes.ts`: Affiliate management (authenticated)
- `server/routes/affiliate-public.routes.ts`: Public affiliate referral endpoints
- `server/routes/transcribe.routes.ts`: `POST /api/transcribe` — audio transcription
- `server/routes/translate.routes.ts`: `POST /api/translate` — text translation
- `server/routes/config.routes.ts`: `GET /api/config` — public Supabase config
- `server/routes/landing.routes.ts`: Landing page content
- `server/routes/style-catalog.routes.ts`: Admin-editable AI style catalog
- `server/routes/markup.routes.ts`: Markup/pricing configuration
- `server/routes/integrations.routes.ts`: Third-party integration settings
- `server/routes/seo.routes.ts`: SEO metadata

**Pages (client):**
- `client/src/pages/landing.tsx`: Public marketing page (`/`)
- `client/src/pages/auth.tsx`: Login/register (`/login`)
- `client/src/pages/onboarding.tsx`: Brand setup wizard (`/onboarding`)
- `client/src/pages/posts.tsx`: Post gallery/dashboard (`/dashboard`)
- `client/src/pages/settings.tsx`: API key settings (`/settings`)
- `client/src/pages/credits.tsx`: Billing page (`/billing`)
- `client/src/pages/admin.tsx`: Admin panel with tabs (`/admin/:tab`)
- `client/src/pages/affiliate-dashboard.tsx`: Affiliate earnings dashboard (`/affiliate`)

## Module Boundaries

- `shared/` has no imports from `client/` or `server/` — it is a pure dependency
- `client/` imports from `shared/` via `@shared` alias; never imports from `server/`
- `server/` imports from `shared/` via relative path; never imports from `client/`
- Route modules import from `server/middleware/`, `server/services/`, `server/supabase.ts`, and `server/quota.ts` only — not from each other (exception: `style-catalog.routes.ts` exports `getStyleCatalogPayload` used by `generate.routes.ts`)

## Path Aliases

- `@` → `client/src/` (configured in `tsconfig.json` / Vite)
- `@shared` → `shared/` (configured in `tsconfig.json` / Vite)

## Naming Conventions

**Files:**
- Server route modules: `<domain>.routes.ts` (e.g., `generate.routes.ts`)
- Server services: `<domain>.service.ts` (e.g., `gemini.service.ts`)
- Server middleware: `<domain>.middleware.ts`
- Client pages: `<page-name>.tsx` (kebab-case, e.g., `affiliate-dashboard.tsx`)
- Client components: `<component-name>.tsx` (kebab-case, e.g., `app-sidebar.tsx`)
- Client hooks: `use<Name>.tsx` (e.g., `use-mobile.tsx`)

**Directories:**
- Feature groupings use kebab-case (`post-creation/`, `admin/`)

## Where to Add New Code

**New API endpoint:**
1. Create `server/routes/<domain>.routes.ts`
2. Register in `server/routes/index.ts` with `router.use(<newRoutes>)`

**New business logic / AI operation:**
- Implementation: `server/services/<domain>.service.ts`

**New frontend page:**
- Implementation: `client/src/pages/<page-name>.tsx`
- Register route in `client/src/App.tsx` (add `<Route>` to `AppRouter` and `AppContent`)

**New reusable component:**
- Shared UI atoms: `client/src/components/ui/<component>.tsx`
- Feature-specific: `client/src/components/<component>.tsx`

**New Zod schema or shared type:**
- Add to `shared/schema.ts`

**New server utility:**
- `server/utils/` for generic helpers
- `server/lib/` for infrastructure utilities (like SSE)

**New third-party push integration:**
- `server/integrations/<service>.ts`

---

*Structure analysis: 2026-04-06*
