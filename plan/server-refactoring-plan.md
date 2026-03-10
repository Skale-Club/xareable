# Server Routes Refactoring Plan

## Overview

The `server/app-routes.ts` file has grown to ~2,900+ lines and needs to be split into modular, maintainable components. This document outlines the strategy for extracting routes, services, and middleware into organized modules.

## Current State Analysis

### File Size: ~2,912 lines (`server/app-routes.ts`)

### Already Extracted (in `server/routes/`):
| File | Purpose | Status |
|------|---------|--------|
| `affiliate-public.routes.ts` | Public affiliate endpoints | ✅ Done |
| `affiliate.routes.ts` | Affiliate management | ✅ Done |
| `billing.routes.ts` | Billing/subscription logic | ✅ Done |
| `config.routes.ts` | Config endpoint | ✅ Done |
| `credits.routes.ts` | Credits management | ✅ Done |
| `generate.routes.ts` | Post generation | ⚠️ Exists but app-routes.ts still has /api/generate |
| `integrations.routes.ts` | Third-party integrations | ✅ Done |
| `markup.routes.ts` | Markup endpoints | ✅ Done |
| `posts.routes.ts` | Posts CRUD | ⚠️ Exists but app-routes.ts still has /api/posts |
| `seo.routes.ts` | SEO endpoints | ✅ Done |
| `stripe.routes.ts` | Stripe webhooks | ✅ Done |
| `style-catalog.routes.ts` | Style catalog | ⚠️ Exists but app-routes.ts still has /api/style-catalog |
| `transcribe.routes.ts` | Audio transcription | ✅ Done |
| `translate.routes.ts` | Translation endpoints | ✅ Done |

### Existing Middleware (`server/middleware/`):
| File | Purpose | Status |
|------|---------|--------|
| `auth.middleware.ts` | Authentication helpers | ✅ Done |

### Existing Services (`server/services/`):
| File | Purpose | Status |
|------|---------|--------|
| `gemini.service.ts` | Gemini AI integration | ✅ Done |

---

## Refactoring Strategy

### Phase 1: Extract Helper Functions to Services

#### 1.1 Create `server/services/prompt-builder.service.ts`

Extract prompt building logic from `app-routes.ts`:

```typescript
// Functions to extract:
- buildImagePromptFromStructuredJson()
- buildVideoPromptFromStructuredJson()
- downloadImageAsBase64()
```

**Benefits:**
- Reusable across generate and edit routes
- Easier to test and modify
- Cleaner route handlers

#### 1.2 Create `server/services/image-generation.service.ts`

Extract image generation logic:

```typescript
export interface ImageGenerationResult {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export async function generateImage(params: {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  apiKey: string;
  referenceImages?: Array<{ mimeType: string; data: string }>;
  logoImageData?: { mimeType: string; data: string } | null;
}): Promise<ImageGenerationResult>
```

#### 1.3 Create `server/services/video-generation.service.ts`

Extract video generation logic:

```typescript
export interface VideoGenerationResult {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

export async function generateVideo(params: {
  prompt: string;
  aspectRatio: string;
  duration: string;
  resolution: string;
  apiKey: string;
  referenceImages?: Array<{ mimeType: string; data: string }>;
}): Promise<VideoGenerationResult>
```

#### 1.4 Create `server/services/app-settings.service.ts`

Extract app settings logic:

```typescript
// Functions to extract:
- getLatestAppSettingsRow()
- getPublicAppSettings()
- normalizeGtmContainerId()
- isValidGtmContainerId()
- isAppSettingsSingletonConflict()
- DEFAULT_APP_SETTINGS
```

#### 1.5 Create `server/services/user.service.ts`

Extract user-related logic:

```typescript
// Functions to extract:
- normalizeAuthEmail()
- extractAuthProviders()
- getPrimaryAuthProvider()
- listAllAuthUsers()
- syncProfilesFromAuthUsers()
```

---

### Phase 2: Create Admin Routes Module

#### 2.1 Create `server/routes/admin.routes.ts`

Extract all admin endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/stats` | GET | Platform statistics |
| `/api/admin/users` | GET | List all users |
| `/api/admin/users/sync` | POST | Sync auth users to profiles |
| `/api/admin/users/:id/posts` | GET | Get user's posts |
| `/api/admin/users/:id/admin` | PATCH | Toggle admin status |
| `/api/admin/users/:id/affiliate` | PATCH | Toggle affiliate status |
| `/api/admin/users/:id/affiliate-commission` | PATCH | Update commission % |
| `/api/admin/users/:id/referrer` | PATCH | Assign affiliate referrer |
| `/api/admin/migrate-colors` | POST | Run color migration |
| `/api/admin/style-catalog` | GET/PATCH | Style catalog management |
| `/api/admin/settings` | PATCH | Update app settings |
| `/api/admin/settings/upload-og-image` | POST | Upload OG image |

**Estimated size:** ~400-500 lines

---

### Phase 3: Create Landing Routes Module

#### 3.1 Create `server/routes/landing.routes.ts`

Extract landing page endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/landing/content` | GET | Get landing page content |
| `/api/admin/landing/content` | PATCH | Update landing content |
| `/api/admin/landing/upload-logo` | POST | Upload logo |
| `/api/admin/landing/upload-alt-logo` | POST | Upload alt logo |
| `/api/admin/landing/upload-icon` | POST | Upload favicon |
| `/api/admin/landing/upload-hero-image` | POST | Upload hero image |
| `/api/admin/landing/upload-cta-image` | POST | Upload CTA image |

**Estimated size:** ~250-300 lines

---

### Phase 4: Create Settings Routes Module

#### 4.1 Create `server/routes/settings.routes.ts`

Extract settings endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/settings` | GET | Get public app settings |
| `/api/admin/settings` | PATCH | Update app settings |
| `/api/admin/settings/upload-og-image` | POST | Upload OG image |

**Estimated size:** ~100-150 lines

---

### Phase 5: Update Existing Route Modules

#### 5.1 Update `server/routes/generate.routes.ts`

The file exists but `app-routes.ts` still contains the full `/api/generate` implementation (~750 lines). Need to:

1. Verify generate.routes.ts has complete implementation
2. Remove duplicate from app-routes.ts
3. Ensure all imports are correct

#### 5.2 Update `server/routes/posts.routes.ts`

The file exists but `app-routes.ts` still contains:
- `GET /api/posts` - List user posts
- `POST /api/posts/:id/thumbnail` - Upload thumbnail

Need to consolidate.

#### 5.3 Create `server/routes/edit.routes.ts`

Extract the `/api/edit-post` endpoint (~320 lines):

```typescript
// POST /api/edit-post - Edit existing post
```

---

### Phase 6: Create Middleware Module

#### 6.1 Create `server/middleware/admin.middleware.ts`

Extract admin-only middleware:

```typescript
import { requireAdminGuard } from './auth.middleware.js';

// Wrapper for admin routes
export function adminOnly(req, res, next) {
  requireAdminGuard(req, res).then(result => {
    if (result) {
      req.adminUserId = result.userId;
      next();
    }
  });
}
```

---

## Target File Structure

```
server/
├── index.ts                    # Entry point (minimal)
├── app-routes.ts              # DEPRECATED - to be removed
├── supabase.ts                # Supabase clients
├── storage.ts                 # Storage helpers
├── quota.ts                   # Quota management
├── stripe.ts                  # Stripe integration
├── static.ts                  # Static file serving
├── vite.ts                    # Vite dev server
├── config/
│   └── index.ts               # Config helpers
├── middleware/
│   ├── auth.middleware.ts     # Auth middleware (exists)
│   └── admin.middleware.ts    # Admin middleware (new)
├── routes/
│   ├── index.ts               # Route aggregator (exists)
│   ├── admin.routes.ts        # Admin endpoints (new)
│   ├── affiliate.routes.ts    # Affiliate (exists)
│   ├── affiliate-public.routes.ts # Public affiliate (exists)
│   ├── billing.routes.ts      # Billing (exists)
│   ├── config.routes.ts       # Config (exists)
│   ├── credits.routes.ts      # Credits (exists)
│   ├── edit.routes.ts         # Edit post (new)
│   ├── generate.routes.ts     # Generate (exists, update)
│   ├── integrations.routes.ts # Integrations (exists)
│   ├── landing.routes.ts      # Landing page (new)
│   ├── markup.routes.ts       # Markup (exists)
│   ├── posts.routes.ts        # Posts (exists, update)
│   ├── seo.routes.ts          # SEO (exists)
│   ├── settings.routes.ts     # Settings (new)
│   ├── stripe.routes.ts       # Stripe (exists)
│   ├── style-catalog.routes.ts # Style catalog (exists, update)
│   ├── transcribe.routes.ts   # Transcribe (exists)
│   └── translate.routes.ts    # Translate (exists)
├── services/
│   ├── gemini.service.ts      # Gemini AI (exists)
│   ├── prompt-builder.service.ts # Prompt building (new)
│   ├── image-generation.service.ts # Image gen (new)
│   ├── video-generation.service.ts # Video gen (new)
│   ├── app-settings.service.ts # App settings (new)
│   └── user.service.ts        # User helpers (new)
├── integrations/
│   ├── facebook.ts            # Facebook integration
│   ├── ghl.ts                 # GoHighLevel
│   ├── marketing.ts           # Marketing tracking
│   └── telegram.ts            # Telegram
└── utils/
    └── errors.ts              # Error helpers (exists)
```

---

## Implementation Order

### Step 1: Create Services (Low Risk)
1. `prompt-builder.service.ts` - Pure functions, easy to test
2. `app-settings.service.ts` - Isolated logic
3. `user.service.ts` - Isolated logic

### Step 2: Create New Route Modules (Medium Risk)
1. `admin.routes.ts` - Extract all admin endpoints
2. `landing.routes.ts` - Extract landing endpoints
3. `settings.routes.ts` - Extract settings endpoints
4. `edit.routes.ts` - Extract edit endpoint

### Step 3: Update Existing Routes (Medium Risk)
1. Update `generate.routes.ts` - Ensure complete
2. Update `posts.routes.ts` - Add missing endpoints
3. Update `style-catalog.routes.ts` - Ensure complete

### Step 4: Create Middleware (Low Risk)
1. `admin.middleware.ts` - Wrap existing guard

### Step 5: Update Index and Cleanup (High Risk)
1. Update `routes/index.ts` to include all new modules
2. Update `server/index.ts` to use new router
3. Remove deprecated `app-routes.ts`

---

## Testing Strategy

### Per-Module Testing
1. After creating each service, write unit tests
2. After creating each route module, test endpoints with curl/Postman
3. Verify authentication still works
4. Verify admin checks still work

### Integration Testing
1. Test full generate flow
2. Test full edit flow
3. Test admin dashboard operations
4. Test landing page operations

### Regression Testing
1. Run existing test suite (if available)
2. Manual testing of critical paths
3. Check error handling

---

## Migration Approach

### Option A: Big Bang (Not Recommended)
- Extract everything at once
- High risk of breaking changes
- Difficult to debug

### Option B: Incremental (Recommended)
- Extract one module at a time
- Keep both old and new routes temporarily
- Add deprecation warnings to old routes
- Remove old routes after verification

---

## Rollback Plan

1. Keep `app-routes.ts` as `app-routes.ts.backup`
2. Use git branches for each phase
3. Tag releases before major changes
4. Monitor error logs after deployment

---

## Estimated Effort

| Task | Lines | Effort | Risk |
|------|-------|--------|------|
| prompt-builder.service.ts | ~100 | 1h | Low |
| image-generation.service.ts | ~150 | 2h | Medium |
| video-generation.service.ts | ~200 | 2h | Medium |
| app-settings.service.ts | ~150 | 1h | Low |
| user.service.ts | ~100 | 1h | Low |
| admin.routes.ts | ~500 | 3h | Medium |
| landing.routes.ts | ~300 | 2h | Low |
| settings.routes.ts | ~150 | 1h | Low |
| edit.routes.ts | ~350 | 2h | Medium |
| Update generate.routes.ts | ~50 | 1h | Medium |
| Update posts.routes.ts | ~50 | 1h | Medium |
| admin.middleware.ts | ~50 | 0.5h | Low |
| Integration & Testing | - | 4h | High |
| **Total** | ~2,100 | ~21.5h | - |

---

## Success Criteria

1. ✅ `app-routes.ts` reduced to < 100 lines or removed entirely
2. ✅ All routes working as before
3. ✅ No regression in functionality
4. ✅ Improved code organization
5. ✅ Easier to locate and modify specific functionality
6. ✅ Better testability of individual components

---

## Next Steps

1. Review and approve this plan
2. Create feature branch `refactor/server-routes`
3. Begin with Phase 1 (Services)
4. Progress through phases incrementally
5. Test thoroughly after each phase
6. Merge to main after full verification
