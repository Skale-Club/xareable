---
phase: 12
slug: image-provider-abstraction-openai-gpt-image-2-alternative
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 12 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | tsx (TypeScript scripts) + manual cross-provider UAT |
| **Config file** | scripts/verify-phase-12.ts (created Wave 2 in Plan 12-03, extended Wave 4 in Plan 12-05) + scripts/test-openai-converter.ts (Wave 2, Plan 12-02) |
| **Quick run command** | `npx tsx scripts/verify-phase-12.ts` |
| **Full suite command** | `npm run check && npx tsx scripts/verify-phase-12.ts` |
| **Estimated runtime** | ~15 seconds |

## Sampling Rate

- After every task commit: `npm run check`
- After every plan wave: `npx tsx scripts/verify-phase-12.ts`
- Before verify-work: full suite green
- Max feedback latency: 20 seconds

## Per-Task Verification Map

| Task | Plan | Wave | Requirement | Type | Command |
|------|------|------|-------------|------|---------|
| Install openai SDK | 01 | 1 | PROV-02 | dep check | `node -e "require('openai')"` |
| ImageProvider interface | 01 | 1 | PROV-01 | type check | `npm run check` |
| GeminiImageProvider wrap | 01 | 1 | PROV-01 | type check | `npm run check` |
| OpenAI provider | 02 | 2 | PROV-02 | type check | `npm run check` |
| Converter unit test | 02 | 2 | PROV-03 | unit | `npx tsx scripts/test-openai-converter.ts` |
| platform_settings + key res + Profile schema | 03 | 2 | PROV-04, PROV-06 | integration | `npx tsx scripts/verify-phase-12.ts` |
| Verify script baseline (created here) | 03 | 2 | PROV-01..04, PROV-06 | full | `npx tsx scripts/verify-phase-12.ts` |
| Wire 4 routes | 04 | 3 | PROV-07 | type check + re-run verify | `npm run check && npx tsx scripts/verify-phase-12.ts` |
| Admin UI toggle | 05 | 4 | PROV-05 | manual + grep | `npm run check` |
| Verify script extension (PROV-05+PROV-07 checks) | 05 | 4 | all PROV | full | `npx tsx scripts/verify-phase-12.ts` |

## Wave 2 Baseline Requirements

- [ ] `scripts/verify-phase-12.ts` created in Plan 12-03 — covers PROV-01..04 + PROV-06 + invokes PROV-03 converter unit test; re-runnable in Wave 3 (12-04) and EXTENDED in Wave 4 (12-05 adds PROV-05 + PROV-07 wire-through checks)
- [ ] `scripts/test-openai-converter.ts` created in Plan 12-02 — PROV-03 unit test (runnable tsx script, no jest)
- [ ] `openai` npm package installed (mandatory dependency)

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Steps |
|----------|-------------|------------|-------|
| Admin toggle switches provider live | PROV-05 | Requires browser + API call | Set image_provider=openai in admin UI, hit /api/generate, verify image returned from OpenAI |
| Carousel slide consistency on OpenAI | PROV-07 | Visual judgment | Generate 5-slide carousel with OpenAI, verify slide 2-5 maintain slide-1 style |
| Edit-post round trip on both | PROV-07 | Visual judgment | Edit same source with both providers, compare results |

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] No 3 consecutive tasks without automated verify
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set after all checks pass

**Approval:** pending
