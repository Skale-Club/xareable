# Coding Conventions

**Analysis Date:** 2026-04-06

## Code Style

**TypeScript:**
- Strict mode enabled (`"strict": true` in `tsconfig.json`)
- `noEmit: true` — TypeScript is type-check only; transpilation handled by `tsx`/`esbuild`
- ESNext modules, `moduleResolution: "bundler"`
- No ESLint or Prettier config detected — formatting is not enforced by tooling

**Formatting (observed):**
- 4-space indentation on server-side files
- 2-space indentation on client-side files
- Double quotes on the server, double quotes on the client
- Trailing semicolons throughout

## Naming Conventions

**Files:**
- Server routes: `[feature].routes.ts` — e.g., `generate.routes.ts`, `admin.routes.ts`
- Server services: `[feature].service.ts` — e.g., `gemini.service.ts`, `user.service.ts`
- Server middleware: `[feature].middleware.ts`
- Client pages: kebab-case `.tsx` — e.g., `auth.tsx`, `affiliate-dashboard.tsx`
- Client components: kebab-case `.tsx` — e.g., `post-creator-dialog.tsx`, `app-sidebar.tsx`
- Client hooks: camelCase — `useTranslation.ts`, `use-toast.ts` (mixed, no single rule)
- Shared schemas: flat file `shared/schema.ts`

**Functions and variables:**
- `camelCase` for functions and variables throughout
- `PascalCase` for React components, TypeScript interfaces, and Zod schema type exports
- `UPPER_SNAKE_CASE` for constants — e.g., `POST_EXPIRATION_DAYS`, `SUPPORTED_LANGUAGES`
- `snake_case` for database field names and Supabase column references

**Types:**
- Zod schemas named `[entity]Schema`, inferred types via `z.infer<typeof [entity]Schema>`
- Interface names: `AuthenticatedRequest`, `AuthResult`, `AuthError` — descriptive, PascalCase
- Path aliases: `@/*` → `client/src/`, `@shared/*` → `shared/`

## Error Handling Patterns

**Server — structured error classes** (`server/utils/errors.ts`):
```typescript
// Typed error hierarchy
class AppError extends Error { statusCode; code; details }
class AuthenticationError extends AppError  // 401
class ValidationError extends AppError      // 400
class InsufficientCreditsError extends AppError // 402
class ExternalServiceError extends AppError  // 502

// Usage
throw new ValidationError("Invalid request", { field: "email" });

// Send helpers
sendError(res, error);   // formats + sends response
asyncHandler(fn);        // wraps async route handler, catches AppError
Errors.validation("msg") // factory shorthand
```

**Server — inline pattern** (dominant in routes):
```typescript
// Most routes use early-return style, not thrown exceptions
const authResult = await authenticateUser(req);
if (!authResult.success) {
    res.status(authResult.statusCode).json({ message: authResult.message });
    return;
}
```

**Client — error surfacing:**
- `throwIfResNotOk(res)` in `client/src/lib/queryClient.ts` parses JSON error bodies
- Errors are caught and displayed via `useToast()` hooks at the call site
- No global error boundary detected

**Logging:**
- Server uses `console.error`, `console.warn`, `console.info` directly — no structured logger
- Structured log line pattern observed in translate route: `[route] key=value key=value`
- Generation errors are also persisted to `generation_logs` Supabase table

## Validation Patterns

**Request body validation — always use `safeParse`:**
```typescript
const parseResult = translateRequestSchema.safeParse(req.body);
if (!parseResult.success) {
    res.status(400).json({
        message: "Invalid request: " + parseResult.error.errors.map(e => e.message).join(", "),
    });
    return;
}
const { targetLanguage, texts } = parseResult.data;
```

**Environment variables validated at startup** (`server/config/index.ts`):
```typescript
const envSchema = z.object({ SUPABASE_URL: z.string().url(), ... });
const result = envSchema.safeParse(process.env);
// Fails fast in production; logs warning in development
```

**Schema file** (`shared/schema.ts`):
- Single source of truth for all Zod schemas and TypeScript types
- Insert schemas (e.g., `insertBrandSchema`) separate from read schemas (e.g., `brandSchema`)
- `.refine()` used for cross-field constraints (e.g., admin/affiliate mutual exclusion)
- `as const` + type inference pattern for enums: `SUPPORTED_LANGUAGES`, `TEXT_BLOCK_ROLES`

## API Patterns

**Auth:** All protected routes pass `Authorization: Bearer <token>` header.

**Route handler structure:**
1. Authenticate via `authenticateUser(req)` — returns `AuthResult | AuthError`
2. Validate body with `schema.safeParse(req.body)`
3. Fetch Supabase data with user-scoped or admin client
4. Process business logic
5. Return `res.json(...)` or error response

**Supabase client selection:**
- `createServerSupabase(token)` — user-scoped, respects RLS
- `createAdminSupabase()` — service role, bypasses RLS (admin operations only)

**Response format:**
- Success: `res.json({ ...data })`
- Error: `res.status(N).json({ message: "..." })` or `{ error: "code", message: "..." }`

**Route file exports:**
```typescript
const router = Router();
router.post("/api/...", async (req, res) => { ... });
export default router;
```

## React Patterns

**Data fetching:**
- TanStack Query v5 with `useQuery` / `useMutation`
- `apiRequest(method, url, data)` from `client/src/lib/queryClient.ts` for mutations
- `getQueryFn({ on401: "throw" | "returnNull" })` for query functions
- `staleTime: Infinity`, `refetchOnWindowFocus: false` — manual invalidation expected

**Auth context** (`client/src/lib/auth.tsx`):
- `AuthProvider` wraps the app; `useAuth()` hook accesses `{ session, user, profile, brand }`
- `refreshProfile()` and `refreshBrand()` for manual state refresh

**Component patterns:**
- Shadcn/ui primitives from `client/src/components/ui/` — do not modify directly
- Feature components in `client/src/components/` (non-ui subdirectory or flat)
- Page components in `client/src/pages/` — one file per route
- Custom hooks in `client/src/hooks/`

**i18n:** `useTranslation()` → wraps `useLanguage()` from `LanguageContext`; translations fetched via `/api/translate` and cached in DB.
