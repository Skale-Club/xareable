# Frontend Changes

## Summary

The frontend no longer requires users to provide a Gemini API key. Three files were updated:

---

## 1. client/src/App.tsx

Removed `!profile?.api_key` from the app access guard:

```typescript
// Before
if (!brand || !profile?.api_key) return <OnboardingPage />;

// After
if (!brand) return <OnboardingPage />;
```

Users without an API key saved in their profile now proceed directly to the app.

---

## 2. client/src/pages/settings.tsx

- Removed imports: `Key`, `ExternalLink`, `Eye`, `EyeOff`, `Shield` from lucide-react
- Removed state: `apiKey`, `showKey`, `saving`
- Removed `handleSave()` function
- Removed "API Key" tab trigger from the `Tabs` grid (`grid-cols-4` → `grid-cols-3`)
- Removed the entire `TabsContent value="api"` block

---

## 3. client/src/pages/onboarding.tsx

The wizard went from **6 steps** to **5 steps**:

| Step | Before | After |
|---|---|---|
| 0 | Company Name | Company Name |
| 1 | Industry/Niche | Industry/Niche |
| 2 | Brand Colors | Brand Colors |
| 3 | Brand Mood | Brand Mood |
| 4 | Upload Logo | Upload Logo |
| 5 | ~~API Key~~ | *(removed)* |

Changes made:
- Removed `{ label: "API Key", icon: Key }` from `STEPS` array
- Removed `Key`, `Eye`, `EyeOff`, `ExternalLink` from lucide-react imports
- Removed `apiKey` and `showKey` state variables
- Removed `case 5` from `canAdvance()`
- Removed API key save block from `handleFinish()` (the `profiles.update({ api_key })` call)
- Removed step 5 JSX block
- Updated `goNext` max: `Math.min(s + 1, 5)` → `Math.min(s + 1, 4)`
