# Backend Plan

## Goals

- remove duplicated creative logic across routes
- make prompt construction deterministic enough for business use
- centralize caption quality checks

## Files To Change

- `server/routes/generate.routes.ts`
- `server/routes/edit.routes.ts`
- `server/routes/posts.routes.ts`
- `server/services/gemini.service.ts`
- `server/services/image-generation.service.ts`
- `server/services/video-generation.service.ts`
- `server/services/prompt-builder.service.ts`

## Rebuild Direction

Create shared creative services instead of continuing route-local prompt logic.

### Proposed Service Layers

`creative-intent.service`

- normalize request inputs
- classify scenario type such as `food-offer`, `product-ad`, `testimonial`, `infographic`
- detect text mode
- apply text style metadata

`creative-prompt.service`

- generate structured prompt objects for image and video
- flatten structured prompt objects only at the boundary where the model needs text

`caption-quality.service`

- validate
- retry
- repair
- fallback

`creative-validation.service`

- basic output checks
- enforce no-text requests
- verify caption structure before persistence

## Immediate Refactors

### 1. Unify Image Generation Entry Point

The create route should stop using the weaker image generation path directly through `gemini.service.ts`.

Use `server/services/image-generation.service.ts` as the canonical image generation path so that:

- aspect ratio handling is consistent
- reference image handling is consistent
- future text-style handling stays centralized

### 2. Unify Caption Logic

Move caption validation logic out of `posts.routes.ts` and make it reusable for:

- create
- edit
- video create
- remake-caption

### 3. Structured Prompt Objects

Do not depend on one flat `image_prompt` string as the only intermediate representation.

Use a structured object with sections like:

- `subject`
- `reference_fidelity`
- `composition`
- `visual_style`
- `text_rendering`
- `logo_integration`
- `negative_constraints`

The flattening step should happen in one place.

## Text Rendering Strategy

### Exact Text

When the system detects exact commercial copy:

- preserve numbers and currency exactly
- preserve price punctuation like `9,90`
- prefer shorter compositions with stronger readability
- add negative constraints against paraphrasing or changing numeric values

### Text Style Mapping

`text_style_id` should inject rules into `text_rendering`, not only into generic prose.

Example fields:

- typography family direction
- weight
- hierarchy
- placement
- contrast
- emphasis target
- avoid list

## Reference Fidelity Strategy

For high-fidelity categories:

- use stronger wording around preserving the core subject
- explicitly forbid replacing a referenced product or meal with a new unrelated concept
- allow styling and cleanup without subject replacement

## Create And Edit Must Share Rules

The edit route must use the same creative intent and caption-quality services as create.

Differences between create and edit should be limited to:

- source media available or not
- preserve-layout options
- image-to-image vs text-to-image generation path

Everything else should be shared.

## Persistence And Observability

Extend generation logs or usage metadata to capture:

- scenario type
- detected text mode
- selected text style
- whether caption passed first attempt or required repair
- whether request used high-fidelity reference mode

## Backend Acceptance Checklist

- create and edit share caption validation service
- create and edit share text style handling
- create and edit share exact-text rules
- no-text requests do not persist text-bearing prompt sections
- logs are sufficient to debug failures in real production examples
