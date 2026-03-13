# Product Spec

## Product Principle

The tool must behave like a reliable brand designer, not like a random image toy.

That means:

- preserve the user's product, meal, or subject
- apply brand identity without replacing the subject
- obey exact offer text when the user provides it
- produce captions that look publishable without manual fixing

## User Flows In Scope

- Create image post
- Create video post
- Edit image post
- Edit video post
- Quick remake
- Caption remake

## Text On Image Rebuild

The current `Text on Image` step needs to become a structured creative control panel.

### Required Inputs

- `with_text` or `no_text`
- `text_content`
- `text_mode`
- `text_style_id`
- `text_priority`

### Proposed Behavior

`with_text`

- user can enter exact commercial text
- system detects whether the text is exact or flexible

`no_text`

- system must avoid adding headline/subtext into the generated image

### Text Modes

Add an internal distinction between:

- `exact`
- `guided`
- `auto`

Rules:

- `exact`: preserve wording, numbers, currency, punctuation, and line breaks as closely as possible
- `guided`: preserve the commercial meaning but allow better layout and hierarchy
- `auto`: model can create text based on brand + mood

The UI can keep this simple at first by auto-detecting `exact` when text contains price, currency, percentage, dates, phone, or coupon-like tokens.

## Text Style Presets

Add style presets directly to `Text on Image`.

### Initial Presets

- `bold-offer`
- `clean-minimal`
- `premium-serif`
- `playful-sticker`
- `editorial-poster`
- `restaurant-menu`

### Each Preset Should Define

- human label
- short description
- best-fit use cases
- typography direction
- layout direction
- emphasis rules
- contrast rules
- negative rules

### Example

`restaurant-menu`

- best for meals, combos, specials, daily menu
- large price emphasis
- compact secondary copy
- high readability over food photography
- avoid luxury editorial spacing

## Reference Fidelity Rules

When the user uploads a reference image:

- preserve the core subject category
- preserve the product or meal identity
- preserve recognizable shape and composition cues when possible
- do not replace a casual real-world meal with unrelated gourmet plating unless the user explicitly asks for transformation

### High-Fidelity Scenarios

- food dishes
- packaged products
- cosmetics and bottles
- clothing items
- before/after transformations

These should default to stronger subject preservation than generic lifestyle posts.

## Caption Quality Rules

Every saved caption must pass:

- minimum length
- complete ending punctuation
- at least 2 short paragraphs
- final hashtag block
- no obvious truncation

If validation fails:

1. retry
2. repair
3. fallback

## Success Criteria

### Food Offer Example

Input:

- reference image of a prato feito
- text: `Prato do dia por R$ 9,90`
- style: `restaurant-menu`

Expected result:

- meal still looks like the provided meal category
- price is rendered correctly
- layout is legible
- caption is complete in the selected language

### Edit Example

Input:

- existing generated image
- replace text with a new offer
- keep subject and improve layout

Expected result:

- new text follows exact mode or guided mode rules
- caption updates without becoming short or broken
- version preview remains synchronized
