# My Social Autopilot

AI-powered social media content creation SaaS platform.

## Commands

```bash
npm run dev        # Start development server (tsx server/index.ts)
npm run build      # Build for production (tsx script/build.ts)
npm run start      # Run production build
npm run check      # TypeScript type check
npm run db:push    # Push Drizzle schema changes
```

## Architecture

- **Frontend**: React 18 + Vite + TailwindCSS v3 + shadcn/ui (Radix primitives)
- **Routing**: `wouter` (client-side)
- **State/Data**: TanStack Query v5
- **Backend**: Express 5 API server + `tsx` runner
- **Database/Auth/Storage**: Supabase (PostgreSQL with RLS, Auth, Storage bucket `user_assets`)
- **AI**: Google Gemini REST API (text: `gemini-2.5-flash`, image: `gemini-3.1-flash-image-preview`)
- **Validation**: Zod schemas in `shared/schema.ts`

## Project Structure

```
client/src/
  lib/
    supabase.ts       - Supabase client singleton (fetches config from /api/config)
    auth.tsx          - Auth context (session, profile, brand state)
    queryClient.ts    - TanStack Query client with auth headers
  pages/
    auth.tsx          - Login/Register (Supabase Auth)
    settings.tsx      - Gemini API key management
    onboarding.tsx    - Brand setup wizard (4 steps)
    dashboard.tsx     - New post creation form
    posts.tsx         - Post history grid
  components/
    app-sidebar.tsx   - Navigation sidebar
server/
  index.ts           - Express app entry point
  routes.ts          - All API endpoints
  supabase.ts        - Server-side Supabase client factories
  storage.ts         - Storage helpers
shared/
  schema.ts          - Zod schemas + TypeScript types (single source of truth)
```

## Environment Variables

```
SUPABASE_URL              - Supabase project URL
SUPABASE_ANON_KEY         - Supabase anon/public key
SUPABASE_SERVICE_ROLE_KEY - Service role key (admin operations only)
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | Returns Supabase URL + anon key to client |
| POST | `/api/generate` | Generate social media post (Gemini text + image) |
| POST | `/api/edit-post` | Edit existing post image (creates new version) |
| POST | `/api/transcribe` | Transcribe audio via Gemini (voice input) |
| GET | `/api/landing/content` | Get landing page copy |
| GET | `/api/admin/stats` | Admin: platform stats |
| GET | `/api/admin/users` | Admin: list all users |
| PATCH | `/api/admin/users/:id/admin` | Admin: toggle user admin status |
| PATCH | `/api/admin/landing/content` | Admin: update landing page copy |

## Database Tables (Supabase)

- `profiles` — auto-created on signup via trigger; stores `api_key`, `is_admin`
- `brands` — company info, colors (1-4), mood, logo_url; one per user
- `posts` — generated content; image_url, caption, ai_prompt_used, status
- `post_versions` — edit history; version_number, image_url, edit_prompt
- `landing_content` — editable landing page copy (single row)

Run `supabase-setup.sql` in Supabase SQL Editor to initialize tables + RLS policies.

## Auth Flow

1. User signs up/in → Supabase Auth (email/password)
2. Profile auto-created via DB trigger
3. No API key → redirect to `/settings`
4. No brand → redirect to `/onboarding`
5. Main app with sidebar navigation

## AI Generation Pipeline

**POST /api/generate:**
1. Verify JWT, fetch user's Gemini API key + brand from Supabase
2. Phase 1: Gemini text model (`gemini-2.5-flash`) → generates `headline`, `subtext`, `image_prompt`, `caption` as JSON
3. Phase 2: Gemini image model (`gemini-3.1-flash-image-preview`) → generates PNG from image_prompt
4. Upload image to Supabase Storage (`user_assets/{userId}/generated/{uuid}.png`)
5. Insert post record, return public URL + content to frontend

**POST /api/edit-post:**
1. Fetch latest version image (or original)
2. Send image + edit prompt to Gemini image model
3. Upload new image, insert `post_versions` record with incremented version_number

## Key Patterns

- All auth tokens passed via `Authorization: Bearer <token>` header
- `createServerSupabase(token)` — user-scoped client (respects RLS)
- `createAdminSupabase()` — service role client (bypasses RLS, admin only)
- `requireAdmin()` helper checks `profiles.is_admin` before admin endpoints
- Zod `safeParse` used on all request bodies before processing
- Path aliases: `@` → `client/src/`, `@shared` → `shared/`
