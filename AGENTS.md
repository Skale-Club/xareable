# AI Agent Guidelines - Xareable

<!-- journal-protocol:v1 -->
## Journal (mandatory)

This app's history (what it does, how each part was built, decisions and releases) lives in its Notion Journal. It replaces the old GSD/PAUL planning flow; `.planning/` and `.paul/`, if present, are a read-only legacy archive.

- Journal hub: https://app.notion.com/p/411b7a68612181549d94de34285c8e2f
- Journal Entries data source: collection://8975533a-34ff-4439-a7e3-de89bdb2ed68
- Latest view: view://411b7a68-6121-8187-bee5-000c6b2dd08f
- Entry prefix: XAR
- Rules (they win on any conflict): https://app.notion.com/p/411b7a68612181b3ac36f4ce2b2c3850 (skill: `app-journal`)

**Start of session:** fetch the hub and read Identity and Current State; list the latest 20 entries with Notion query-data-sources in `view` mode on the Latest view above (`page_size` 20; view mode has no plan quota) and read only titles and summaries; use `rows` mode with a filter only to narrow down (it has a plan quota); if a read fails, say so and continue from the code, never guess journal content; open only the entries you need; never read the whole database. Cross-check with the code: the code is the fact.

**End of every task that changed code, behavior, infrastructure or a decision:**
1. Create ONE entry in the data source above (one per logical unit of work, not per commit): `Title` = `YYYY-MM-DD — <imperative summary>`, `date:Date:start` (YYYY-MM-DD, with `date:Date:is_datetime` = 0), `Type`, `Area` (JSON array of existing options), `Status`, `Summary` (max 280 characters), `Agent`, `Model`, `Repo / Branch`, `Commits / PR`, `Tests` (what ran, or "Not run"), and `Decision ID` / `Decision Status` when a choice was made.
2. Body headings: Context · What changed · How it was built · Decisions and why · Tests and evidence · Not done / risks · Next.
3. If the app changed, rewrite the affected part of the hub's Current State. Read back what you wrote; never report a write you did not see.
4. Notion unavailable: append the full entry to `docs/journal/PENDING-NOTION.md` and tell the owner.

Journal records are in English. No secrets.
<!-- /journal-protocol -->

<!-- model-routing:v1 -->
## Model routing (token economy) — mandatory, every task

The model the owner chose for this session is the **orchestrator**. It plans the work, splits it into pieces, picks the right model for each piece, and **audits and validates** every result. It does not have to execute everything itself: execution goes to faster, cheaper models whenever they can do the piece well. Without routing, tokens drain fast.

**Delegation ladder** (delegate one or two tiers down, never up):

| Session model (orchestrator) | Delegates execution to |
|---|---|
| Claude Fable | Opus (hard sub-problems), Sonnet (standard implementation, analysis, writing) |
| Claude Opus | Sonnet (implementation, analysis, writing), Haiku (bulk reads, search, mechanical edits, data entry) |
| Claude Sonnet | Haiku (bulk reads, search, mechanical edits), when it pays off |
| Claude Haiku | does the work itself |
| Codex / ChatGPT top model | the same idea with the smaller models available there (a mini model for bulk and mechanical work) |

**Rules**
1. **Routing plan first.** Before a multi-step task, list the pieces and give each one a tier. A trivial task (a handful of tool calls, or a lookup whose target is known) is done directly: an extra agent would cost more than it saves.
2. **Delegate:** bulk file reading and search, codebase mapping, mechanical multi-file edits, data entry (Notion rows, seed data), log and test-output triage, first drafts.
3. **Keep on the orchestrator:** decisions and trade-offs, architecture, anything touching production, credentials, money or customer data, security review, and the **final verification** of every delegated result.
4. **Self-contained briefs:** goal, files, constraints, what done looks like, output format. Ask for a concise report, never raw dumps.
5. **Audit before accepting:** read the diff, re-run the tests, spot-check the data. A subagent's report is a claim, not proof.
6. **Parallel when independent:** independent pieces run at the same time; dependent pieces run in order.
7. **Record it:** the journal entry says which models did what (Agent / Model fields).

How (Claude Code): the Agent tool with `model: "opus" | "sonnet" | "haiku"`; read-only searches can use the Explore agent type. Skill: `model-routing`. Notion: Projects → Templates → AI Model Routing Protocol.
<!-- /model-routing -->

This document provides guidelines for AI agents working on this codebase.

## Project Overview

Xareable is an AI-powered social media content creation SaaS platform that generates branded social media posts using Google Gemini AI.

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
