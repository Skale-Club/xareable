# Xareable

Xareable is an AI-powered social media content platform for generating branded social posts, captions, and image variations with Google Gemini. It combines a React single-page app, an Express API, and Supabase for auth, storage, and data.

## What It Does

- Generates branded social media images and captions from a guided post creation flow
- Stores generated posts and edited versions
- Supports brand onboarding, logo placement, aspect ratios, and content styles
- Includes admin controls, billing, quotas, and white-label app settings
- Exposes SEO essentials for the public landing page, including `robots.txt`, `sitemap.xml`, and route-level metadata

## Stack

- Frontend: React 18, Vite, TailwindCSS, shadcn/ui, wouter
- Backend: Express 5, `tsx`
- Data: Supabase (Postgres, Auth, Storage)
- Validation: Zod
- AI: Google Gemini REST API
- Billing: Stripe

## Getting Started

### Prerequisites

- Node.js 20+
- npm
- A Supabase project
- A Google Gemini API key
- Stripe keys for billing flows

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file in the project root.

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

## Development

```bash
npm run dev
```

The app runs the Express server, which serves both the API and the Vite-powered client in development.

## Available Scripts

```bash
npm run dev      # Start development server
npm run build    # Build server and client for production
npm run start    # Run the production build
npm run check    # Run TypeScript type checking
npm run db:push  # Push Drizzle schema changes
```

## Project Structure

```text
client/
  index.html
  public/
  src/
    components/
    hooks/
    lib/
    pages/
    App.tsx
    main.tsx
server/
  index.ts
  routes.ts
  static.ts
  stripe.ts
  quota.ts
  supabase.ts
shared/
  schema.ts
script/
  build.ts
```

## Core Application Flows

### Authentication

1. Users sign in with Supabase Auth.
2. Profile data is loaded from `profiles`.
3. Users without a brand are sent to onboarding.
4. Authenticated users access the dashboard shell and tools.

### Post Generation

1. The user fills out the multi-step post creator dialog.
2. The client sends a request to `/api/generate`.
3. The server loads the user, brand, and applicable API key.
4. Gemini generates headline, subtext, image prompt, and caption.
5. Gemini generates the post image.
6. The image is uploaded to Supabase Storage.
7. A post record is saved and returned to the client.

### Post Editing

1. The user requests an edit for an existing generated post.
2. The latest image is fetched and sent back to Gemini with the edit prompt.
3. The edited image is uploaded and stored as a new `post_versions` row.

## Data Model

Key tables used by the app:

- `profiles`: user profile, admin flag, affiliate flag, optional per-user API key
- `brands`: company branding, colors, mood, logo
- `posts`: generated social posts
- `post_versions`: edited versions of posts
- `landing_content`: editable public landing page content
- `app_settings`: white-label settings, metadata, branding assets
- `subscription_plans`: Stripe-backed plans
- `user_subscriptions`: current subscription state
- `usage_events`: quota and cost tracking

## API Notes

- All authenticated API routes expect `Authorization: Bearer <token>`.
- Request validation is done with Zod schemas in [`shared/schema.ts`](/c:/Users/Vanildo/Dev/xareable/shared/schema.ts).
- User-scoped queries use `createServerSupabase(token)`.
- Admin operations use `createAdminSupabase()`.

## SEO

The public landing page is the only indexable route by default.

- Public metadata is managed in the client via a reusable SEO component
- Private routes use `noindex`
- The server provides:
  - `/robots.txt`
  - `/sitemap.xml`
  - `/site.webmanifest`

## Deployment

For production:

1. Set all required environment variables.
2. Run `npm run build`.
3. Run `npm run start`.

In production, the Express server serves the built frontend from the generated public assets.

## Notes For Contributors

- Keep request and response validation in `shared/schema.ts`
- Do not commit `.env` or any secrets
- Preserve Supabase RLS assumptions when adding queries
- Run `npm run check` before shipping changes
