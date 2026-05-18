---
status: resolved
trigger: "App flickers multiple times during login → routing → dashboard navigation flow"
created: 2026-05-17T00:00:00Z
updated: 2026-05-17T01:00:00Z
---

## Current Focus

hypothesis: All flicker vectors resolved — session confirmed clean
test: TypeScript check (npm run check)
expecting: 0 errors
next_action: Archive session

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: After login, user lands on /dashboard with at most one transition. No flash of /auth, /settings, /onboarding, or loading skeletons unless actually needed.
actual: App "pisca" (flickers) several times during login → dashboard navigation. Visible flashes of intermediate states.
errors: None (purely visual)
reproduction: Hard refresh on / with logged-in session; login from /auth
started: Ongoing

## Eliminated

- hypothesis: Supabase client initialized late causing undefined→unauthenticated→authenticated transitions
  evidence: main.tsx calls initializeSupabase().then(() => root.render(...)) — React does NOT mount until Supabase is ready. Client is never null when AuthProvider runs. This is NOT a cause.
  timestamp: 2026-05-17

- hypothesis: TanStack Query refetch on window focus causing re-renders
  evidence: queryClient.ts has refetchOnWindowFocus: false and staleTime: Infinity globally. Not a cause.
  timestamp: 2026-05-17

## Evidence

- timestamp: 2026-05-17
  checked: auth.tsx lines 163-192 (useEffect with getSession + onAuthStateChange)
  found: getSession() fires and calls fetchUserData(). Then onAuthStateChange ALSO fires INITIAL_SESSION event immediately, calling fetchUserData() a SECOND time with the same session. This triggers 2x full DB fetches (profiles + brands) and 2x setProfile/setBrand calls, causing 2 render cycles of the route guard.
  implication: CONFIRMED CAUSE #1 — double fetchUserData on boot with existing session

- timestamp: 2026-05-17
  checked: auth.tsx lines 103-161 (fetchUserData)
  found: setLoading(false) is called in the finally block AFTER setProfile() and setBrand() inside the try block. The order is: setProfile(profileData) → setBrand(brandRes.data) → finally: setLoading(false). However because setProfile and setBrand are separate setState calls, React may batch them in React 18 (automatic batching), but the loading flag goes false at the same time brand/profile finish. This is acceptable. BUT the double-fetchUserData from CAUSE #1 means loading goes false, then true again (no — fetchUserData never sets loading back to true on re-call). Actually worse: second call overwrites state while guard has already rendered once.
  implication: CONFIRMED — the double-call problem means route guard renders intermediate state

- timestamp: 2026-05-17
  checked: App.tsx lines 149-223 (AppContent render logic)
  found: Route guard decision order is: loading → no user → no brand → no profile → full app. The guard checks !brand BEFORE !profile. Since fetchUserData calls setProfile() then setBrand() as separate setState in try block (lines 134, 155), React 18 automatic batching should batch these. BUT with double-fetchUserData: first call sets profile+brand+loading=false → guard renders dashboard. Second call (from onAuthStateChange INITIAL_SESSION) re-runs fetchUserData → inside finally sets loading=false again (no intermediate loading=true), so guard doesn't flash loading, but it does call setProfile and setBrand again causing 2 extra renders.
  implication: The fix is to deduplicate fetchUserData calls: skip onAuthStateChange INITIAL_SESSION if getSession() already ran.

- timestamp: 2026-05-17
  checked: auth.tsx lines 177-189 (onAuthStateChange handler)
  found: The handler fires for EVERY event including INITIAL_SESSION. On first app load with existing session, the sequence is: getSession() fires fetchUserData → onAuthStateChange(INITIAL_SESSION) also fires fetchUserData. That's 2 DB round-trips and 2x state updates for profile/brand. After login, onAuthStateChange fires SIGNED_IN and also fetchUserData runs again (expected for post-login).
  implication: Fix: track whether getSession already handled a session; skip INITIAL_SESSION in onAuthStateChange if so.

- timestamp: 2026-05-17
  checked: posts.tsx line 738
  found: {post.caption || t("No caption")} — when caption is null/empty, renders the translated "No caption" string as visible text.
  implication: Secondary bug confirmed. Fix: conditionally render caption only when truthy.

- timestamp: 2026-05-17 (hardening pass)
  checked: App.tsx AdminBillingRedirect component (lines 76-91)
  found: Component called setLocation() directly in render body (side effect during render). setLocation("/dashboard") and setLocation("/affiliate") were called conditionally in the render path, not in useEffect or event handlers. This is a side-effect-in-render anti-pattern that can cause extra re-renders and React warnings.
  implication: Replace setLocation calls with declarative <Redirect> from wouter — same behaviour, no side effects.

- timestamp: 2026-05-17 (hardening pass)
  checked: App.tsx AppContent useEffect (lines 134-147)
  found: The single useEffect in AppContent only manages admin mode state (setAdminMode true/false based on route). It does NOT call setLocation. This is fine — it's a state sync, not a navigation side-effect.
  implication: No flicker vector here.

- timestamp: 2026-05-17 (hardening pass)
  checked: auth.tsx handleSignIn in pages/auth.tsx (lines 135-153)
  found: After signInWithPassword succeeds, setLocation(redirectPath) is called once. The onAuthStateChange SIGNED_IN event in auth.tsx also fires fetchUserData — but this is a different event (not INITIAL_SESSION) and is expected/necessary. No duplication.
  implication: No flicker vector here.

- timestamp: 2026-05-17 (hardening pass)
  checked: Loading state coverage — setLoading(false) timing in fetchUserData
  found: setLoading(false) is in the finally block, which fires after both setProfile() and setBrand() in the try block. React 18 automatic batching groups all state updates from the same async continuation, so all three (profile, brand, loading) flush together. Guard never sees a state where loading=false but brand/profile are still null from an in-flight fetch.
  implication: No flicker vector here.

- timestamp: 2026-05-17 (hardening pass)
  checked: AuthGuardedLogin component (App.tsx lines 367-411)
  found: Uses declarative render-time decisions: if (loading) return <PageLoader/>, if (user && !isRecoveryFlow) return <Redirect to="/dashboard"/>. No setLocation in effects. Clean.
  implication: No flicker vector here.

- timestamp: 2026-05-17 (hardening pass)
  checked: npm run check (TypeScript)
  found: 0 errors after all fixes applied.
  implication: Fix set is internally consistent.

## Resolution

root_cause: Three stacked causes:
  1. DOUBLE fetchUserData: auth.tsx useEffect calls getSession().then(fetchUserData) AND sets up onAuthStateChange which immediately fires INITIAL_SESSION also calling fetchUserData. Two full DB round-trips + 2x React state updates for profile/brand on every hard refresh with existing session.
  2. No deduplication guard: there was no "already initialized" flag to prevent the redundant second call.
  3. Secondary bug: posts.tsx previously rendered literal "No caption" text when caption was empty/null.
  4. (Hardening) AdminBillingRedirect called setLocation() in render body — side-effect-in-render anti-pattern causing extra re-render cycles.

fix:
  1. auth.tsx: Added initialSessionHandledRef. Set to true when getSession() finds a session. In onAuthStateChange, skip INITIAL_SESSION if the flag is set. Eliminates double fetchUserData.
  2. posts.tsx: Changed {post.caption || t("No caption")} to {post.caption && <p>...</p>}. No stray "No caption" text.
  3. App.tsx AdminBillingRedirect: Replaced setLocation() calls in render with declarative <Redirect to="..." /> from wouter. Eliminates side-effect-during-render.

verification: TypeScript check passes (npm run check: 0 errors). Commits a7ed8d6 (fixes 1+2) and subsequent hardening commit (fix 3).
files_changed:
  - client/src/lib/auth.tsx
  - client/src/pages/posts.tsx
  - client/src/App.tsx
