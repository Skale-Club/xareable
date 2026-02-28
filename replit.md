# My Social Autopilot

AI-powered social media content creation SaaS platform.

## Architecture

- **Frontend**: React + Vite + TailwindCSS + shadcn/ui
- **Backend**: Express.js API server
- **Database/Auth/Storage**: Supabase (PostgreSQL, Auth, Storage)
- **AI**: Google Gemini API (text + image generation)

## Key Dependencies

- `@supabase/supabase-js` - Supabase client for auth, DB, and storage
- `@google/generative-ai` - Google Gemini SDK (used for reference, actual calls use REST API)
- `framer-motion` - Page transitions and animations
- `wouter` - Client-side routing

## Project Structure

```
client/src/
  lib/
    supabase.ts       - Supabase client singleton (initialized before app render)
    auth.tsx           - Auth context provider (session, profile, brand state)
    queryClient.ts     - TanStack Query client with auth headers
  pages/
    auth.tsx           - Login/Register page (Supabase Auth)
    settings.tsx       - API key management
    onboarding.tsx     - Brand setup wizard (4 steps)
    dashboard.tsx      - New post creation form
    posts.tsx          - Post history grid
  components/
    app-sidebar.tsx    - Navigation sidebar
server/
  routes.ts           - /api/config, /api/generate endpoints
  supabase.ts         - Server-side Supabase client factory
shared/
  schema.ts           - Zod schemas and TypeScript types
```

## Environment Variables

- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anon/public key

## Database Setup

Run `supabase-setup.sql` in Supabase SQL Editor to create:
- `profiles` table (auto-created on user signup via trigger)
- `brands` table (company info, colors, mood, logo)
- `posts` table (generated content history)
- RLS policies for row-level security
- Storage bucket `user_assets` with access policies

## Auth Flow

1. User signs up/in via Supabase Auth (email/password)
2. Profile auto-created via DB trigger
3. If no API key → redirect to Settings
4. If no brand → redirect to Onboarding wizard
5. Main app with sidebar navigation

## AI Generation Pipeline

1. Frontend sends post config to `/api/generate`
2. Backend verifies auth, fetches user's Gemini API key
3. **Phase 1**: Gemini text model analyzes brand context → generates image prompt, headline, subtext, caption
4. **Phase 2**: Gemini image model generates social media graphic with text overlay
5. Image uploaded to Supabase Storage, post record created
6. Result returned to frontend for display
