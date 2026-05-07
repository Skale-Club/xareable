---
phase: 11
slug: post-trash-and-automated-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | tsx (TypeScript scripts) + manual browser UAT |
| **Config file** | scripts/verify-phase-11.ts (Wave 0 installs) |
| **Quick run command** | `npx tsx scripts/verify-phase-11.ts` |
| **Full suite command** | `npm run check && npx tsx scripts/verify-phase-11.ts` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run check`
- **After every plan wave:** Run `npx tsx scripts/verify-phase-11.ts`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| DB migration | 01 | 1 | TRSH-01 | schema check | `npm run db:push` | ⬜ pending |
| Cron job | 02 | 1 | TRSH-01, TRSH-02 | integration | `npx tsx scripts/verify-phase-11.ts` | ⬜ pending |
| Gallery filter | 03 | 1 | TRSH-01 | type check | `npm run check` | ⬜ pending |
| Trash API routes | 04 | 2 | TRSH-03, TRSH-04, TRSH-05 | integration | `npx tsx scripts/verify-phase-11.ts` | ⬜ pending |
| Trash UI page | 05 | 3 | TRSH-03, TRSH-04, TRSH-05 | manual browser | open /trash in browser | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-11.ts` — verification script covering TRSH-01 through TRSH-06

*Existing infrastructure (tsx, npm run check) covers type checking.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Trash page renders trashed posts with days-remaining | TRSH-03 | Requires browser UI | Navigate to /trash, verify posts appear with countdown |
| Restore button moves post back to gallery | TRSH-04 | Requires UI interaction | Click Restore on a trashed post, verify appears in /posts |
| Force-delete from trash removes immediately | TRSH-05 | Requires UI interaction | Click Delete Forever, verify post gone from /trash |
| Cron fires without admin HTTP call | TRSH-06 | Requires log inspection | Check server logs for cron execution without /api/posts/cleanup request |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
