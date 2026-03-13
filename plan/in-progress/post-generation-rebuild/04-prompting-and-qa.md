# Prompting And QA Plan

## Prompting Principles

1. Separate subject preservation from visual styling.
2. Separate exact text rendering from generated copy.
3. Use structured prompts for planning and flatten only at the model boundary.
4. Treat image and video as different media types that still share one creative policy.

## Required Prompt Sections

- role and brand context
- scenario classification
- reference fidelity instructions
- text rendering instructions
- text style instructions
- logo instructions
- negative constraints
- output contract

## Negative Constraints

Use explicit negative instructions for the failure modes we already see:

- do not replace the referenced meal with a different gourmet dish
- do not change provided prices or currency formatting
- do not invent extra text when `no_text` is selected
- do not output incomplete or truncated caption text
- do not place the logo in the reserved text area

## Regression Matrix

### Create

- food offer with exact price
- product ad from packaging reference
- clean no-text post
- multi-reference promo post
- logo-enabled square post

### Edit

- replace exact offer text
- improve text style without changing wording
- remove text
- preserve subject while changing background

### Video

- caption generation in PT-BR
- caption repair when first output is too short
- thumbnail generation and gallery preview

## Evidence Required For QA

For each scenario capture:

- input payload summary
- reference image
- generated output
- caption output
- whether retries or repairs were triggered

## Acceptance Rules

### Text On Image

- exact text preserves number formatting
- price remains readable at card and viewer size
- selected text style is visible in the final design language

### Caption

- at least 80 characters
- 2 short paragraphs
- final hashtag block
- no broken ending

### Subject Fidelity

- referenced meal or product remains recognizable
- style changes do not erase subject identity

## Operational Quality Gates

Do not merge creative-pipeline changes without:

- `npm run check`
- manual QA on at least one food-offer case
- manual QA on at least one product-reference case
- manual QA on at least one caption repair case
