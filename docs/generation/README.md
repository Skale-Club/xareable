# Content Generation System

This section documents the entire AI-powered content creation pipeline for My Social Autopilot — covering image generation, video generation, model configuration, formats, and known issues.

## Documents in This Section

| File | Description |
|------|-------------|
| [pipeline.md](pipeline.md) | End-to-end flow from user click to stored asset |
| [image.md](image.md) | Image generation — current implementation & gaps |
| [video.md](video.md) | Video generation — current implementation & gaps |
| [models.md](models.md) | AI model catalog, capabilities, and admin configuration |
| [formats.md](formats.md) | Aspect ratios, resolutions, and format rules per content type |
| [api.md](api.md) | Server API reference for all generation endpoints |
| [roadmap.md](roadmap.md) | Known issues, bugs, and planned improvements |

---

## Quick Overview

```
User (Wizard, 6 steps)
  │
  ▼
POST /api/generate
  │
  ├── Step 1: Gemini Text Model  →  headline, subtext, image_prompt, caption
  │
  ├── Step 2 (if image): Gemini Image Model  →  base64 PNG
  │
  └── Step 2 (if video): Veo 3.1  →  async long-running op  →  MP4
  │
  ▼
Supabase Storage  →  public URL
  │
  ▼
posts table  →  response to client
```

## Key Files

| Layer | File |
|-------|------|
| Schema / types | [`shared/schema.ts`](../../shared/schema.ts) |
| Primary server route | [`server/app-routes.ts`](../../server/app-routes.ts) |
| Gemini service | [`server/services/gemini.service.ts`](../../server/services/gemini.service.ts) |
| Frontend wizard | [`client/src/components/post-creator-dialog.tsx`](../../client/src/components/post-creator-dialog.tsx) |
| Media utilities | [`client/src/lib/media.ts`](../../client/src/lib/media.ts) |
| Admin format config | [`client/src/components/admin/post-creation/post-formats-card.tsx`](../../client/src/components/admin/post-creation/post-formats-card.tsx) |
| Admin models config | [`client/src/components/admin/post-creation/ai-models-card.tsx`](../../client/src/components/admin/post-creation/ai-models-card.tsx) |
