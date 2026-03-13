# Frontend Plan

## Goals

- expose stronger creative controls without making the wizard confusing
- keep `create` and `edit` aligned
- make text style selection visible and intentional

## Files To Change

- `client/src/components/post-creator-dialog.tsx`
- `client/src/components/post-edit-dialog.tsx`
- `client/src/components/post-viewer-dialog.tsx`
- `client/src/pages/posts.tsx`
- `client/src/lib/post-creator.tsx`
- `shared/schema.ts`

## Create Flow Changes

### Text On Image Step

Add:

- style preset selector
- optional exact-text hint in the UI
- preview chip showing current text mode

Suggested UX order:

1. `With Text` or `No Text`
2. Text input
3. Text style preset
4. Optional exact text indicator

### Form State

Add state fields for:

- `text_style_id`
- `text_mode`

If `no_text` is selected:

- clear style-specific render instructions from request payload

## Edit Flow Changes

The edit dialog should stop treating text changes as only `keep/improve/replace/remove`.

Add:

- `text_style_id` selector when text is kept, improved, or replaced
- clearer distinction between exact replacement and style-only improvement

Suggested edit behavior:

- `keep`: preserve wording, optionally improve visual style
- `improve`: preserve meaning, allow layout cleanup, allow style change
- `replace`: let user enter exact new wording and style
- `remove`: force no text

## Shared Schema Changes

Extend `generateRequestSchema` and `editPostRequestSchema` to support:

- `text_mode`
- `text_style_id`

Extend style catalog schema to support:

- `text_styles`

## Style Catalog Integration

Add a new catalog section to `platform_settings.setting_key = style_catalog`.

Proposed structure:

```ts
text_styles: [
  {
    id: "restaurant-menu",
    label: "Restaurant Menu",
    description: "Large price, compact support text, strong readability",
    categories: ["food", "offer"],
    prompt_hints: {
      typography: "bold rounded sans-serif",
      layout: "price dominant, title secondary",
      emphasis: "highlight numeric price",
      avoid: ["luxury serif", "tiny price text"]
    }
  }
]
```

## Viewer And Gallery

No major UX redesign is required in the first pass, but the viewer should display enough metadata during internal QA to confirm:

- text mode used
- text style used
- content language used

This can stay behind a debug-only switch if needed.

## Frontend Acceptance Checklist

- create flow can send text style and text mode
- edit flow can send text style and text mode
- no-text flow never leaks text instructions into request payload
- style catalog fallback still works if `text_styles` is absent
- TypeScript remains strict and schema-driven
