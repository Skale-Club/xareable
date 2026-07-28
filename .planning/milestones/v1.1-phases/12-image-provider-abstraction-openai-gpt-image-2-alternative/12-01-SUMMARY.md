---
phase: 12-image-provider-abstraction-openai-gpt-image-2-alternative
plan: "01"
subsystem: api
tags: [openai, gemini, image-generation, abstraction, typescript, provider-pattern]

requires:
  - phase: 06-server-services
    provides: "generateImage and editImage in image-generation.service.ts that GeminiImageProvider delegates to"

provides:
  - "ImageProvider interface with generate() and edit() methods"
  - "Canonical types: ReferenceImage, ImageGenerationInput, ImageEditInput, ImageProviderResult"
  - "GeminiImageProvider class — thin adapter over existing Gemini image-generation service"
  - "openai npm SDK v6.38.0 installed"

affects:
  - 12-02-openai-image-provider
  - 12-03-provider-factory
  - 12-04-wire-callers

tech-stack:
  added: ["openai ^6.38.0"]
  patterns:
    - "Provider interface pattern — ImageProvider contract with generate()/edit() methods"
    - "Adapter pattern — GeminiImageProvider wraps existing service without modifying it"
    - "Canonical input/output types — provider-agnostic ReferenceImage shape"

key-files:
  created:
    - server/services/image-provider.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "GeminiImageProvider delegates to existing image-generation.service.ts (adapter, not rewrite) — byte-identical Gemini behavior preserved"
  - "ImageProvider interface name field typed as literal union 'gemini' | 'openai' — enables exhaustive checks in 12-03 factory"
  - "additionalRefs on ImageEditInput included for carousel style-consistency use case in 12-04"

patterns-established:
  - "Provider interface pattern: all image generation flows will call ImageProvider.generate()/edit() after 12-04 wiring"
  - "Canonical ReferenceImage{mimeType, data} shape used at provider boundary — each provider converts internally to its own API format"

requirements-completed: [PROV-01]

duration: 3min
completed: 2026-05-17
---

# Phase 12 Plan 01: Image Provider Abstraction Foundation Summary

**OpenAI SDK installed and ImageProvider interface + GeminiImageProvider adapter created — thin wrapper preserving byte-identical Gemini behavior, enabling OpenAI provider addition in 12-02**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-17T03:10:43Z
- **Completed:** 2026-05-17T03:13:14Z
- **Tasks:** 2
- **Files modified:** 3 (package.json, package-lock.json, server/services/image-provider.ts)

## Accomplishments

- Installed `openai` v6.38.0 — SDK ships TypeScript types, no separate @types package needed
- Created `server/services/image-provider.ts` with `ImageProvider` interface, four canonical types, and `GeminiImageProvider` adapter
- `GeminiImageProvider` delegates to the existing tested `generateImage`/`editImage` in `image-generation.service.ts` without modifying that file
- `npm run check` passes with zero TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Install openai SDK** - `44e30a7` (chore)
2. **Task 2: Create ImageProvider interface + GeminiImageProvider** - `7178533` (feat)

**Plan metadata:** _(docs commit below)_

## Files Created/Modified

- `server/services/image-provider.ts` — ImageProvider interface, ReferenceImage/ImageGenerationInput/ImageEditInput/ImageProviderResult types, GeminiImageProvider class
- `package.json` — openai ^6.38.0 added to dependencies
- `package-lock.json` — lockfile updated

## Decisions Made

- Used adapter pattern for GeminiImageProvider (delegates to existing service) rather than moving logic into provider class — preserves byte-identical Gemini behavior, bisectable regression isolation
- `ImageProvider.name` typed as `"gemini" | "openai"` literal union — enables exhaustive switch in 12-03 factory without extra type-guards
- `additionalRefs` included in `ImageEditInput` now (even though carousel style-consistency wiring is 12-04) — avoids interface churn when 12-02/12-03 are added in parallel

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `ImageProvider` contract is established; 12-02 can add `OpenAIImageProvider` against the same interface
- 12-03 can add `getActiveImageProvider()` factory using both classes
- 12-04 can wire all four route callers to use the factory
- Default Gemini behavior is completely unchanged — no regression risk until 12-04 wiring

---
*Phase: 12-image-provider-abstraction-openai-gpt-image-2-alternative*
*Completed: 2026-05-17*
