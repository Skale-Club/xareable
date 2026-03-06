# SQL Migration: Token & Cost Columns

## File

`supabase/migrations/20260302000001_usage_cost_tracking.sql`

## SQL

```sql
ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS text_input_tokens  INTEGER,
  ADD COLUMN IF NOT EXISTS text_output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS image_input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS image_output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS cost_usd_micros    BIGINT;
-- cost_usd_micros: 1 USD = 1_000_000. e.g. $0.039 → 39_000
```

## Column Reference

| Column | Type | Source | Notes |
|---|---|---|---|
| `text_input_tokens` | INTEGER | `textData.usageMetadata.promptTokenCount` | Tokens sent to `gemini-2.5-flash` |
| `text_output_tokens` | INTEGER | `textData.usageMetadata.candidatesTokenCount` | Tokens from `gemini-2.5-flash` |
| `image_input_tokens` | INTEGER | `imageData.usageMetadata.promptTokenCount` | Tokens sent to image model |
| `image_output_tokens` | INTEGER | `imageData.usageMetadata.candidatesTokenCount` | Tokens from image model |
| `cost_usd_micros` | BIGINT | Calculated server-side | Total cost in micro-dollars |

## How to Apply

Run this file in the Supabase SQL Editor, or use Supabase CLI:

```bash
supabase db push
```

All columns are nullable — existing rows are unaffected.
