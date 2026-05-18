# Phase 13 — UAT Script

**Goal:** Verify CRSL-EDIT-01..07 end-to-end on a live deployment with both image providers.

## Pre-flight

- [ ] Migration `supabase/migrations/20260518000000_post_slide_versions.sql` applied via Supabase dashboard SQL editor.
- [ ] `npm run dev` running locally OR deployment is reachable.
- [ ] At least one carousel post (>=3 slides) exists in your account; if not, generate one via the creator dialog.
- [ ] `npx tsx scripts/verify-phase-13.ts` returns 7/7 PASS.

## Provider A: Gemini (default)

### Setup

1. Open `/admin` → confirm "AI Image Provider" is set to **Gemini**.
2. Confirm your Gemini API key is configured in Settings.

### Test Steps

3. Open a carousel post in the gallery — Post Viewer opens; slides load (visible carousel chevrons with "Slide N of Total" indicator).

4. Navigate to **slide 2** (or 3) using the slide chevrons.

5. Click **Edit Image** — PostEditDialog opens.
   - [ ] Dialog title reads **"Edit slide 2"** (or the current slide number).
   - [ ] Only **ONE step** is shown: "Edit Goal". No "Text on Image" step.
   - [ ] No slide-1 drift warning banner is visible (this is slide 2 or 3).

6. Type an edit goal (e.g. "Change the background to a marble countertop") and click **Edit Slide**.
   - [ ] SSE progress events appear (progress bar / phase messages).
   - [ ] On complete, the slide image in the viewer updates **without a full page reload**.
   - [ ] Toast notification fires: title "**Slide updated**", description "Slide N edited."

7. Verify version persistence in Supabase:
   - Run in Supabase SQL editor:
     ```sql
     SELECT * FROM post_slide_versions WHERE post_slide_id = '<the slide UUID>';
     ```
   - [ ] At least one row exists with `version_number = 1`.

8. Navigate to **slide 1**. Click **Edit Image**.
   - [ ] A non-blocking toast fires: title "**Editing slide 1**", description "Slide 1 sets the visual style for the rest of the carousel. Edits may cause visual drift in other slides."
   - [ ] PostEditDialog opens with the persistent **yellow warning banner**: "Editing slide 1 may affect the visual style of the rest of the carousel."
   - [ ] Only ONE step shown ("Edit Goal"). No "Text on Image" step.

9. Submit an edit for slide 1.
   - [ ] Slide 1 image updates locally.
   - [ ] Toast: "**Slide updated** — Slide 1 edited."

10. Click **Quick Remake** on slide 2 (navigate to it first).
    - [ ] A generating state / overlay appears (or progress text shows "**Remaking slide...**").
    - [ ] On complete, the slide image refreshes in place; toast fires: "**Slide remade** — Slide N updated."
    - [ ] `post:version-created` event fires (gallery cover thumbnail updates on close + reopen).

11. Verify credit deduction:
    - [ ] Credit balance decreased by **exactly 3** single-edit costs (steps 6, 9, 10 each cost 1x edit).
    - [ ] No credit charged for the drift-warning toast (step 8 — that was just the dialog open, not a submission).

### Regression: non-carousel post (run once, not per provider)

12. Open an **image** post. Click Edit Image.
    - [ ] PostEditDialog shows **TWO steps**: "Edit Goal" AND "Text on Image".
    - [ ] Submit → network call goes to `/api/edit-post` (not `/api/carousel/slide/edit`).

13. Click **Quick Remake** on the same image post.
    - [ ] Progress flows via `/api/edit-post` with `source: "quick_remake"`.
    - [ ] Toast: "**Quick remake complete**" (image/video flow, not carousel flow).

## Provider B: OpenAI

### Setup

1. In `/admin` → toggle "AI Image Provider" to **OpenAI**.
2. Confirm your OpenAI API key is set in Settings (required for OpenAI provider).

### Test Steps

3–10. Repeat steps 3–10 from Provider A on a carousel post.
   - [ ] Same functional outcomes as Provider A (slide updates, toasts, version row).
   - [ ] No "Provider not available" or "API key missing" errors.

11. Provider-specific check — server logs / network:
    - In server logs (or browser DevTools network tab for the SSE response), confirm:
    - [ ] The slide edit request reaches `/api/carousel/slide/edit` (not `/api/edit-post`).
    - [ ] For a **slide 2** (or later) edit, server logs show `additionalRefs` was populated (slide-1 anchor image was passed to the OpenAI Responses API). Look for log entries like "Editing slide..." after the "Loading slide images..." phase.

12. Verify credit deduction:
    - [ ] Same behavior as Provider A — exactly 1 edit cost per slide edit / quick remake action.

## Sign-off

| Check | Result |
|-------|--------|
| Provider A (Gemini) — all steps 3–11 | PASS / FAIL |
| Provider B (OpenAI) — all steps 3–12 | PASS / FAIL |
| Regression non-carousel (step 12–13) | PASS / FAIL |

- **Date / Operator:**
- **Notes (failures, deviations, observed diffs):**

---

> If any step FAILS, open a `/gsd:plan-phase 13 --gaps` follow-up and describe the failure. The gap plan will target the specific CRSL-EDIT requirement that did not pass.
