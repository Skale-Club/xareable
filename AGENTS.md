# AI Agent Guidelines - My Social Autopilot

This document provides guidelines for AI agents working on this codebase.

## Project Overview

My Social Autopilot is an AI-powered social media content creation SaaS platform that generates branded social media posts using Google Gemini AI.

## Tech Stack

- **Frontend**: React 18 + Vite + TailwindCSS v3 + shadcn/ui (Radix primitives)
- **Routing**: `wouter` (client-side)
- **State/Data**: TanStack Query v5
- **Backend**: Express 5 API server + `tsx` runner
- **Database/Auth/Storage**: Supabase (PostgreSQL with RLS, Auth, Storage bucket `user_assets`)
- **AI**: Google Gemini REST API (text: `gemini-2.5-flash`, image: `gemini-3.1-flash-image-preview`)
- **Validation**: Zod schemas in `shared/schema.ts`

## Development Commands

```bash
npm run dev        # Start development server (tsx server/index.ts)
npm run build      # Build for production (tsx script/build.ts)
npm run start      # Run production build
npm run check      # TypeScript type check
npm run db:push    # Push Drizzle schema changes
```

## Project Structure

```
client/src/
  lib/
    supabase.ts       - Supabase client singleton (fetches config from /api/config)
    auth.tsx          - Auth context (session, profile, brand state)
    queryClient.ts    - TanStack Query client with auth headers
    post-creator.tsx  - Post creator dialog state context
    post-viewer.tsx   - Post viewer dialog state context
    admin-mode.tsx    - Admin mode context
  pages/
    auth.tsx          - Login/Register (Supabase Auth)
    landing.tsx       - Public landing page
    settings.tsx      - Gemini API key management + brand settings
    onboarding.tsx    - Brand setup wizard (4 steps)
    posts.tsx         - Post history grid
    admin.tsx         - Admin dashboard
  components/
    app-sidebar.tsx   - Navigation sidebar
    post-creator-dialog.tsx  - Multi-step post creation wizard
    post-viewer-dialog.tsx   - Post preview and actions
    voice-input-button.tsx   - Audio transcription input
    ui/               - shadcn/ui components
server/
  index.ts           - Express app entry point
  routes.ts          - All API endpoints
  supabase.ts        - Server-side Supabase client factories
  storage.ts         - Storage helpers
  stripe.ts          - Stripe integration
  quota.ts           - Usage quota management
  seo/               - SEO utilities (sitemap, metadata)
shared/
  schema.ts          - Zod schemas + TypeScript types (single source of truth)
```

## Code Conventions

### TypeScript/React

- Use functional components with hooks
- Use Zod schemas for all API validation
- Path aliases: `@` → `client/src/`, `@shared` → `shared/`
- All auth tokens passed via `Authorization: Bearer <token>` header

### Styling

- Use TailwindCSS utility classes
- Follow shadcn/ui patterns for components
- Use `violet-400` as primary accent color
- Use `pink-400` as secondary accent color

### API Patterns

- `createServerSupabase(token)` — user-scoped client (respects RLS)
- `createAdminSupabase()` — service role client (bypasses RLS, admin only)
- `requireAdmin()` helper checks `profiles.is_admin` before admin endpoints
- Zod `safeParse` used on all request bodies before processing

## Database Tables (Supabase)

- `profiles` — auto-created on signup via trigger; stores `api_key`, `is_admin`
- `brands` — company info, colors (1-4), mood, logo_url; one per user
- `posts` — generated content; image_url, caption, ai_prompt_used, status
- `post_versions` — edit history; version_number, image_url, edit_prompt
- `landing_content` — editable landing page copy (single row)
- `subscription_plans` — Stripe subscription plans
- `user_subscriptions` — User subscription state

## Environment Variables

```
SUPABASE_URL              - Supabase project URL
SUPABASE_ANON_KEY         - Supabase anon/public key
SUPABASE_SERVICE_ROLE_KEY - Service role key (admin operations only)
STRIPE_SECRET_KEY         - Stripe API secret key
STRIPE_WEBHOOK_SECRET     - Stripe webhook signing secret
```

## Key Workflows

### Post Generation Flow

1. User fills out 5-step wizard in `post-creator-dialog.tsx`:
   - Step 1: Reference Material (images + text)
   - Step 2: Post Style (promo, info, clean, vibrant)
   - Step 3: Text on Image (with/without text)
   - Step 4: Logo Placement (include logo + 9-position selector)
   - Step 5: Format/Size (aspect ratio)
2. POST to `/api/generate` with all parameters
3. Server fetches user's brand + API key
4. Phase 1: Gemini text model generates headline, subtext, image_prompt, caption
5. Phase 2: Gemini image model generates PNG
6. Image uploaded to Supabase Storage
7. Post record inserted, result returned to frontend
8. `post-viewer-dialog.tsx` displays result

### Auth Flow

1. User signs up/in → Supabase Auth (email/password)
2. Profile auto-created via DB trigger
3. No API key → redirect to `/settings`
4. No brand → redirect to `/onboarding`
5. Main app with sidebar navigation

## Common Tasks

### Adding a new field to post generation

1. Update `generateRequestSchema` in `shared/schema.ts`
2. Update `post-creator-dialog.tsx` to collect the new input
3. Update `handleGenerate` to send the new field
4. Update `/api/generate` in `server/routes.ts` to use the new field

### Adding a new API endpoint

1. Add route in `server/routes.ts`
2. Create Zod schema in `shared/schema.ts` for request/response
3. Use `createServerSupabase(token)` for user-scoped operations
4. Return proper HTTP status codes

### Adding a new page

1. Create component in `client/src/pages/`
2. Add route in `client/src/App.tsx`
3. Add navigation item in `client/src/components/app-sidebar.tsx` if needed

## Important Notes

- Never commit `.env` files or secrets
- Always validate user input with Zod schemas
- Use RLS policies in Supabase for data security
- Test with `npm run check` before committing
