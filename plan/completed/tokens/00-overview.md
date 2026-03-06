# Centralized API Key + Token Cost Tracking — Overview

## Goal

Migrate from user-provided Gemini API keys to a **centralized platform API key** managed
by the company. Every generation and edit event now records the exact token counts and
estimated cost in the database, enabling accurate financial reporting.

## What Changed

| Area | Before | After |
|---|---|---|
| Gemini API key | Each user stores their own key in `profiles.api_key` | Single `GEMINI_API_KEY` env var on the server |
| Cost tracking | Only event count stored in `usage_events` | Token counts + `cost_usd_micros` stored per event |
| Onboarding | 6 steps including "API Key" | 5 steps — API key step removed |
| Settings | "API Key" tab with key management | Tab removed |
| App guard | `!brand || !profile?.api_key` | `!brand` only |

## Architecture

```
[/api/generate or /api/edit-post]
        │
        ├─ Phase 1: gemini-2.5-flash (text)
        │       └─ Capture usageMetadata.promptTokenCount / candidatesTokenCount
        │
        └─ Phase 2: gemini-2.5-flash-image-preview (image)
                └─ Capture usageMetadata (may be null → fallback cost)
                        │
                        └─ recordUsageEvent(userId, postId, eventType, tokens)
                                └─ Calculates cost_usd_micros
                                └─ Inserts into usage_events
```

## Documents in This Folder

| File | Contents |
|---|---|
| `00-overview.md` | This file — summary and architecture |
| `01-migration.md` | SQL migration for token/cost columns |
| `02-server-changes.md` | Server-side changes: env var, usageMetadata capture |
| `03-cost-calculation.md` | Pricing model and cost_usd_micros calculation |
| `04-frontend-changes.md` | UI changes: removed API key from onboarding/settings |
| `05-env-setup.md` | Environment variable setup guide |
| `06-analytics-queries.md` | SQL queries for cost reporting |
