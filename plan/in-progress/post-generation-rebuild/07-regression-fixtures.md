# Regression Fixtures

Use these fixtures for manual QA and evidence capture during the post-generation rebuild.

## Fixture List

### 1. Create: Food Offer With Exact Price

- Payload: `fixtures/create-food-offer-exact-text.json`
- Goal: preserve the recognizable meal subject and render the exact price text correctly
- Evidence required:
  - reference image
  - generated image
  - detected promotional text after verification
  - whether exact-text repair was triggered

### 2. Create: Product Reference Preservation

- Payload: `fixtures/create-product-reference.json`
- Goal: preserve the reference product identity while changing the ad scene
- Evidence required:
  - reference image
  - generated image
  - subject fidelity notes
  - caption output

### 3. Edit: Replace Exact Offer Text

- Payload: `fixtures/edit-replace-exact-text.json`
- Goal: replace the visible promo text without changing the main subject
- Evidence required:
  - original image
  - edited image
  - detected promotional text after verification
  - whether exact-text repair was triggered

### 4. Video: PT-BR Caption Quality

- Payload: `fixtures/video-caption-pt-br.json`
- Goal: ensure the generated caption is complete, not truncated, and fully in PT-BR
- Evidence required:
  - generated video
  - generated caption
  - whether caption retry or repair was triggered

## Review Checklist

- Exact price, punctuation, and currency are preserved where required.
- The referenced meal or product remains recognizable.
- Text style selection is visible in the final design language.
- Captions have two short paragraphs plus a final hashtag block.
- No caption ends in a broken or truncated way.
