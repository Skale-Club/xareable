# Project Documentation

This folder contains technical documentation for the My Social Autopilot project.

## Folder Structure

```
docs/
├── generation/      # AI content generation system (image + video)
├── integrations/    # Third-party integration documentation
├── architecture/    # System architecture docs
└── README.md        # This file
```

---

## Generation System

### Overview
**Folder:** [`generation/`](generation/)

Complete documentation for the AI-powered image and video generation pipeline — from the 6-step user wizard to the final asset stored in Supabase Storage.

| Document | Description |
|----------|-------------|
| [generation/README.md](generation/README.md) | Index and quick overview |
| [generation/pipeline.md](generation/pipeline.md) | Full end-to-end flow with sequence diagram |
| [generation/image.md](generation/image.md) | Image generation — implementation, capabilities, gaps |
| [generation/video.md](generation/video.md) | Video generation — Veo 3.1 implementation, gaps |
| [generation/models.md](generation/models.md) | AI model catalog and admin configuration |
| [generation/formats.md](generation/formats.md) | Aspect ratios, resolutions, format rules per content type |
| [generation/api.md](generation/api.md) | Server API reference for all generation endpoints |
| [generation/roadmap.md](generation/roadmap.md) | Known bugs, gaps, and planned improvements |

---

## Integrations

### Facebook Conversions API
**File:** [`integrations/facebook-conversions-api.md`](integrations/facebook-conversions-api.md)

Documentation for the Facebook Conversions API (CAPI) integration for server-side event tracking.

**Contents:**
- Overview and benefits
- Architecture diagram
- Configuration instructions
- Event types tracked
- User data matching
- Event deduplication
- Client-side integration
- Server-side API
- Testing and debugging
- Privacy considerations

---

## Related Documentation

- **Implementation Plans:** See [`../plan/`](../plan/) for feature implementation plans
- **Project Guidelines:** See [`../AGENTS.md`](../AGENTS.md) for AI agent guidelines
- **Database Schema:** See [`../supabase-setup.sql`](../supabase-setup.sql) for database schema
