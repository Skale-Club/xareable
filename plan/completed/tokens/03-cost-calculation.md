# Cost Calculation

## Gemini Pricing (as of 2026-03)

| Model | Direction | Price |
|---|---|---|
| `gemini-2.5-flash` | Input | $0.075 per 1M tokens |
| `gemini-2.5-flash` | Output | $0.300 per 1M tokens |
| `gemini-2.5-flash-image-preview` | Per image (fallback) | ~$0.039 |

> Note: The image model may not return `usageMetadata` token counts. When token counts
> are unavailable, a fixed fallback cost of **$0.039 per image** is applied.

## Storage Format

Cost is stored as **micro-dollars** (integer) to avoid floating-point precision issues.

```
1 USD = 1_000_000 micro-dollars
$0.039 = 39_000 micro-dollars
$0.001 = 1_000 micro-dollars
```

## Implementation (server/quota.ts)

```typescript
const TEXT_INPUT_PRICE_PER_TOKEN  = 0.075;   // USD per 1M tokens
const TEXT_OUTPUT_PRICE_PER_TOKEN = 0.300;   // USD per 1M tokens
const IMAGE_FALLBACK_COST_MICROS  = 39_000;  // $0.039 fallback per image

// Text cost (micro-dollars)
const textInputCost  = ((tokens?.text_input_tokens  ?? 0) * TEXT_INPUT_PRICE_PER_TOKEN)  / 1_000_000 * 1_000_000;
const textOutputCost = ((tokens?.text_output_tokens ?? 0) * TEXT_OUTPUT_PRICE_PER_TOKEN) / 1_000_000 * 1_000_000;

// Image cost (micro-dollars)
const imageCost = (tokens?.image_input_tokens != null)
  ? ((tokens.image_input_tokens * TEXT_INPUT_PRICE_PER_TOKEN) / 1_000_000 * 1_000_000)
  : IMAGE_FALLBACK_COST_MICROS; // fallback when model returns no token counts

const cost_usd_micros = Math.round(textInputCost + textOutputCost + imageCost);
```

## Example: Single Generate Event

Assume:
- Text prompt: 500 tokens input, 200 tokens output
- Image model: no usageMetadata (fallback)

```
Text input cost:  500 * 0.075 / 1_000_000 * 1_000_000 = 37.5 micro-dollars
Text output cost: 200 * 0.300 / 1_000_000 * 1_000_000 = 60.0 micro-dollars
Image cost:       39_000 micro-dollars (fallback)
─────────────────────────────────────────────────────
Total:            39_097 micro-dollars ≈ $0.039
```
