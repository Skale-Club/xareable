# Technology Stack

**Analysis Date:** 2026-04-06

## Runtime & Language

**Primary:**
- TypeScript 5.6.3 — all source code (client, server, shared)
- JavaScript ESM — module format (`"type": "module"` in package.json)

**Runtime:**
- Node.js — server runtime (version pinned via `@types/node` 20.x)
- Package manager: npm (lockfile present: `package-lock.json`)

## Frontend

**Framework:**
- React 18.3.1 — UI rendering
- React DOM 18.3.1

**Routing:**
- wouter 3.3.5 — client-side routing (`client/src/`)

**Styling:**
- TailwindCSS 3.4.17 — utility-first CSS; config at `tailwind.config.ts`
- tailwindcss-animate 1.0.7 — animation utilities
- @tailwindcss/typography 0.5.15 — prose styles
- tw-animate-css 1.2.5 — additional CSS animations
- PostCSS 8.4.47 — CSS processing; config at `postcss.config.js`

**UI Components:**
- Radix UI primitives (^1.x–^2.x) — full set: accordion, dialog, dropdown-menu, select, tabs, toast, tooltip, etc.
- shadcn/ui pattern — Radix primitives + CVA + tailwind-merge
- class-variance-authority 0.7.1 — component variant API
- clsx 2.1.1 — className merging
- tailwind-merge 2.6.0 — Tailwind class conflict resolution
- lucide-react 0.453.0 — icon library
- react-icons 5.4.0 — additional icons

**State & Data Fetching:**
- TanStack Query (React Query) v5.60.5 — server state management; config at `client/src/lib/queryClient.ts`
- react-hook-form 7.55.0 — form state
- @hookform/resolvers 3.10.0 — Zod integration for forms

**Animation:**
- framer-motion 11.13.1 — declarative animations

**Charts & Visualization:**
- recharts 2.15.2 — data charts

**Other Frontend Libraries:**
- date-fns 3.6.0 — date utilities
- next-themes 0.4.6 — dark/light theme management
- embla-carousel-react 8.6.0 — carousel
- react-day-picker 8.10.1 — date picker
- react-resizable-panels 2.1.7 — resizable layout panels
- input-otp 1.4.2 — OTP input
- cmdk 1.1.1 — command menu
- vaul 1.1.2 — drawer component

**PWA:**
- vite-plugin-pwa 1.2.0 — service worker registration; configured NetworkOnly (no precaching)

## Backend

**Framework:**
- Express 5.0.1 — HTTP server; entry at `server/index.ts`
- express-session 1.18.1 — session middleware (memorystore or connect-pg-simple)

**Auth Middleware:**
- passport 0.7.0 + passport-local 1.0.0 — local strategy (present but Supabase JWT is primary auth)

**Session Stores:**
- memorystore 1.6.7 — in-memory session store
- connect-pg-simple 10.0.0 — PostgreSQL session store

**Image Processing:**
- sharp 0.33.5 — server-side image optimization/conversion; used in `server/services/image-optimization.service.ts`

**WebSockets:**
- ws 8.18.0 — WebSocket server

**SSE:**
- Custom SSE lib at `server/lib/sse.ts` — used for streaming generation progress to the client

## Database

**ORM:**
- drizzle-orm 0.39.3 — query builder and schema definition
- drizzle-kit 0.31.8 — migration CLI; config at `drizzle.config.ts`
- drizzle-zod 0.7.0 — Zod schema generation from Drizzle tables

**Driver:**
- pg 8.16.3 — PostgreSQL client

**Schema source of truth:** `shared/schema.ts`
**Migrations output:** `./migrations/`

## Build & Tooling

**Bundler:**
- Vite 7.3.0 — frontend bundler; config at `vite.config.ts`
  - Root: `client/`
  - Output: `dist/public/`
  - Manual chunks: `react-vendor`, `data-vendor`, `ui-vendor`, `analytics-vendor`

**Server Build:**
- esbuild 0.25.0 — bundles server to `dist/index.cjs`; script at `script/build.ts`

**TypeScript:**
- tsc 5.6.3 — type checking only (`noEmit: true`); config at `tsconfig.json`
- tsx 4.20.5 — TS execution in dev (`npm run dev`)
- cross-env 10.1.0 — cross-platform env vars

**Path Aliases:**
- `@/*` → `client/src/*`
- `@shared/*` → `shared/*`
- `@assets/*` → `attached_assets/*`

**Deployment:**
- PM2 — process manager; config at `deploy/hetzner/ecosystem.config.cjs`
- Target platform: Hetzner VPS (self-hosted)
- Vercel also detected (`@vercel/analytics` 1.6.1, `.vercel/` dir)

**Replit Dev Plugins (dev only):**
- @replit/vite-plugin-runtime-error-modal
- @replit/vite-plugin-cartographer
- @replit/vite-plugin-dev-banner

## Key Libraries

**Validation:**
- zod 3.24.2 — schema validation; all request bodies parsed with `safeParse`
- zod-validation-error 3.4.0 — human-readable Zod error messages

**Payments:**
- stripe 20.4.0 — billing, subscriptions, credit checkout; used in `server/stripe.ts`

**GitHub API:**
- @octokit/rest 22.0.0 — GitHub REST API client (usage: style catalog or admin tooling)

**Utilities:**
- dotenv 17.3.1 — loads `.env` at server startup
- @jridgewell/trace-mapping 0.3.25 — source map utilities

---

*Stack analysis: 2026-04-06*
