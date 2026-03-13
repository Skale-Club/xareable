# Rollout Plan

## Phase 1

Stabilize contracts and planning.

Deliverables:

- approved product spec
- schema extension plan
- text style preset list
- unified acceptance criteria

## Phase 2

Refactor shared backend creative services.

Deliverables:

- canonical image generation path
- shared caption quality service
- structured prompt pipeline
- request normalization for text mode and text style

## Phase 3

Update frontend create and edit flows.

Deliverables:

- text style selector in create
- text style selector in edit
- exact-text aware payloads
- style catalog support for `text_styles`

## Phase 4

Run regression QA and tighten prompt rules.

Deliverables:

- baseline test matrix
- production-like screenshots
- failure log review
- repaired prompt rules for top failure categories

## Risks

- adding too many UI controls at once
- duplicating logic during transition
- shipping prompt changes without QA snapshots
- improving text rendering while still allowing subject drift

## Mitigations

- keep schema and service changes behind one canonical path
- migrate create and edit together
- reuse one caption-quality service
- require evidence capture for each regression scenario

## Definition Of Done

The rebuild is done only when:

- create and edit share the same creative quality policies
- text styles are available in the product and affect outputs
- captions no longer save in truncated form
- real product and food references remain recognizable
- the QA matrix passes on representative business cases
