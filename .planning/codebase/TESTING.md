# Testing

**Analysis Date:** 2026-04-06

## Test Setup

**Status: No automated tests exist in this codebase.**

- No test framework installed (`package.json` has no `jest`, `vitest`, `mocha`, `ava`, or similar in dependencies or devDependencies)
- No test runner scripts in `package.json` (`scripts` contains only `dev`, `build`, `start`, `check`, `db:push`)
- No `jest.config.*`, `vitest.config.*`, or any other test config file found
- `tsconfig.json` explicitly excludes test files (`"exclude": ["**/*.test.ts"]`) — this exclusion is precautionary, not active
- No `*.test.ts`, `*.spec.ts`, `*.test.tsx`, or `*.spec.tsx` files exist anywhere in the project

## Test Types Present

None. There are no tests of any kind:
- No unit tests
- No integration tests
- No end-to-end tests
- No snapshot tests
- No API contract tests

## Coverage Areas

Nothing is covered by automated tests. The following areas have zero test coverage:

**Server:**
- `server/utils/errors.ts` — `AppError` class hierarchy, `sendError`, `asyncHandler`
- `server/config/index.ts` — environment variable validation logic
- `server/middleware/auth.middleware.ts` — `authenticateUser`, `requireAuth`, `requireAdmin`, `getGeminiApiKey`
- `server/routes/generate.routes.ts` — AI generation pipeline
- `server/routes/translate.routes.ts` — translation caching logic, rate limiting
- `server/routes/posts.routes.ts` — caption quality helpers, pagination
- `server/services/gemini.service.ts` — Gemini API interaction
- `server/quota.ts` — credit checking and deduction

**Shared:**
- `shared/schema.ts` — Zod schema validation rules and cross-field refinements

**Client:**
- `client/src/lib/queryClient.ts` — `throwIfResNotOk`, `apiRequest`, `getQueryFn`
- `client/src/lib/auth.tsx` — `AuthProvider`, affiliate referral claim logic
- All React components and pages

## Testing Gaps

Every part of the system is untested. Highest-risk areas without any coverage:

**Business logic at risk:**
- Credit enforcement (`server/quota.ts`) — incorrect logic could allow free usage or block paying users
- Admin/affiliate mutual exclusion constraint in `profileSchema` (`shared/schema.ts`)
- Caption quality fallback logic in `server/routes/posts.routes.ts` (`looksTruncatedCaption`, `isAcceptableCaption`)
- Translation cache invalidation logic in `server/routes/translate.routes.ts` (multiple `shouldRefresh*` helpers)
- `getGeminiApiKey()` — routing logic between user-owned key vs server key

**Security logic at risk:**
- `requireAdmin` / `requireAdminGuard` middleware — no test verifies admin bypass is impossible
- Auth token extraction and validation in `authenticateUser`

**Pure utility functions that are easy to test but untested:**
- `server/utils/errors.ts` — all error classes and `sendError`
- `server/routes/posts.routes.ts` — `looksTruncatedCaption`, `hasHashtags`, `isAcceptableCaption`, `buildCaptionFallback`
- `server/routes/translate.routes.ts` — `isRateLimited`, `parseTranslationsPayload`, `shouldRefreshLegacyAsciiTranslation`
- `shared/schema.ts` — Zod schema parse/safeParse behavior

## How to Run Tests

No test command exists. To introduce testing, the recommended setup would be:

```bash
# Install vitest (compatible with ESM + TypeScript + existing tsconfig)
npm install --save-dev vitest @vitest/coverage-v8

# Add to package.json scripts:
# "test": "vitest run"
# "test:watch": "vitest"
# "test:coverage": "vitest run --coverage"
```

Vitest is preferred over Jest for this project because:
- Native ESM support (project uses `"type": "module"`)
- No babel/transform config needed alongside `tsx`
- Compatible with the existing TypeScript setup
