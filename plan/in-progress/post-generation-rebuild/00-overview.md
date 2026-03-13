# Post Generation Rebuild

## Status

In Progress

## Core Decision

Treat post creation and post editing as one creative system.

Do not optimize `create` in isolation.
Do not treat `edit` as the fallback that fixes `create`.
Both flows must share the same quality rules for:

- reference fidelity
- text-on-image rendering
- caption quality
- logo handling
- thumbnail generation
- observability

## Why This Rebuild Exists

The current system can generate attractive outputs, but it is not yet reliable enough for production creative work.

The main issues are:

- subject drift between reference image and generated output
- weak control over exact text such as prices, dates, offers, and CTAs
- caption outputs that can be short, truncated, or structurally incomplete
- duplicated logic between create, edit, remake-caption, and video flows
- no first-class support for text style presets in `Text on Image`

## Target Outcomes

1. Preserve the main subject from the reference image when the user is creating a product or food post.
2. Render exact commercial text correctly when the user provides price-driven or offer-driven copy.
3. Produce captions that always pass structural quality checks before being shown or saved.
4. Make `create`, `edit`, `quick remake`, `video`, and `caption remake` use shared creative services instead of parallel logic.
5. Add text style controls in the UI and map them directly into prompt construction and image editing behavior.

## Current System Touchpoints

Frontend:

- `client/src/components/post-creator-dialog.tsx`
- `client/src/components/post-edit-dialog.tsx`
- `client/src/components/post-viewer-dialog.tsx`
- `client/src/lib/post-creator.tsx`
- `client/src/pages/posts.tsx`

Shared contracts:

- `shared/schema.ts`

Backend routes:

- `server/routes/generate.routes.ts`
- `server/routes/edit.routes.ts`
- `server/routes/posts.routes.ts`
- `server/routes/style-catalog.routes.ts`

Backend services:

- `server/services/gemini.service.ts`
- `server/services/image-generation.service.ts`
- `server/services/video-generation.service.ts`
- `server/services/prompt-builder.service.ts`
- `server/services/image-optimization.service.ts`

## Architecture Direction

Move from "prompt-heavy route handlers" to a shared creative pipeline:

1. Request normalization
2. Creative intent planning
3. Structured prompt generation
4. Media generation or media edit
5. Post-generation validation and repair
6. Persistence
7. Preview and gallery synchronization

## Planned Workstreams

- Product and UX specification
- Frontend wizard and edit flow updates
- Shared schemas and style catalog extension
- Backend creative pipeline refactor
- Caption validation, retry, repair, and fallback unification
- Regression QA matrix with real business scenarios

## Current Implementation Snapshot

Completed in the first implementation slice:

- shared schema support for `use_text`, `text_mode`, `text_style_id`, and `text_styles`
- default text style presets added to the public style catalog
- create flow updated to send text rendering mode and selected text style
- edit flow updated to expose text style presets and send `text_style_id`
- generate route moved to the canonical Gemini image generation service
- shared caption quality service added and wired into create, edit, and remake-caption
- exact-text verification and repair added for create and edit flows
- manual regression fixtures added for food, product, edit, and video scenarios

Validated:

- `npm run check`

Remaining in the active rebuild:

- full cleanup of the remaining dead legacy caption helper code in `posts.routes.ts`
- operational logging for exact-text verification outcomes
- regression evidence capture for food, product, price, and video cases

## Non-Goals For The First Pass

- Full admin UI for managing every prompt template
- Storing every reference image in a new audit table
- New billing behavior
- New provider beyond Gemini/Veo
