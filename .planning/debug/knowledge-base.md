# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## auth-route-flicker — Double fetchUserData on boot causing route guard flicker + render-time setLocation side-effect

- **Date:** 2026-05-17
- **Error patterns:** flicker, pisca, double fetch, INITIAL_SESSION, route guard, setLocation render, onAuthStateChange
- **Root cause:** (1) auth.tsx useEffect calls getSession().then(fetchUserData) and onAuthStateChange immediately fires INITIAL_SESSION also calling fetchUserData — two full DB round-trips and 2x React state updates for profile/brand on every hard refresh. (2) AdminBillingRedirect called setLocation() directly in render body (side-effect-in-render anti-pattern).
- **Fix:** (1) Added initialSessionHandledRef in auth.tsx — set to true when getSession processes a session, checked in onAuthStateChange to skip INITIAL_SESSION if already handled. (2) Replaced setLocation() calls in AdminBillingRedirect render with declarative <Redirect> from wouter. (3) Fixed posts.tsx caption rendering: replaced {caption || "No caption"} with conditional render.
- **Files changed:** client/src/lib/auth.tsx, client/src/pages/posts.tsx, client/src/App.tsx
---

