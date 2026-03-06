# Server-Side Changes

## 1. Centralized Gemini API Key

### Before (user-provided key)

```typescript
// routes.ts — old pattern
const profileRes = await supabase.from("profiles").select("api_key").eq("id", user.id).single();
if (!profileRes.data?.api_key) {
  return res.status(400).json({ message: "Gemini API key not configured" });
}
const geminiApiKey = profileRes.data.api_key;
```

### After (centralized env var)

```typescript
// routes.ts — new pattern
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  return res.status(500).json({ message: "Gemini API key not configured on server" });
}
```

Applied to: `/api/generate`, `/api/edit-post`, `/api/transcribe`

---

## 2. Capturing usageMetadata

Gemini REST API returns token counts in the response body under `usageMetadata`.

### Text phase (`gemini-2.5-flash`)

```typescript
const textResponse = await fetch(`https://generativelanguage.googleapis.com/...`, { ... });
const textData = await textResponse.json();
const textUsage = textData.usageMetadata;
// Shape: { promptTokenCount: number, candidatesTokenCount: number, totalTokenCount: number }
```

### Image phase (`gemini-2.5-flash-image-preview`)

```typescript
const imageResponse = await fetch(`https://generativelanguage.googleapis.com/...`, { ... });
const imageData = await imageResponse.json();
const imageUsage = imageData.usageMetadata; // may be null for image models
```

---

## 3. Passing Tokens to recordUsageEvent

### /api/generate (text + image)

```typescript
await recordUsageEvent(user.id, post?.id ?? null, "generate", {
  text_input_tokens:   textUsage?.promptTokenCount,
  text_output_tokens:  textUsage?.candidatesTokenCount,
  image_input_tokens:  imageUsage?.promptTokenCount,
  image_output_tokens: imageUsage?.candidatesTokenCount,
});
```

### /api/edit-post (image only)

```typescript
await recordUsageEvent(user.id, post_id, "edit", {
  image_input_tokens:  editUsage?.promptTokenCount,
  image_output_tokens: editUsage?.candidatesTokenCount,
});
```

---

## 4. quota.ts — Updated recordUsageEvent Signature

```typescript
export interface UsageTokenData {
  text_input_tokens?:  number;
  text_output_tokens?: number;
  image_input_tokens?:  number;
  image_output_tokens?: number;
}

export async function recordUsageEvent(
  userId: string,
  postId: string | null,
  eventType: "generate" | "edit",
  tokens?: UsageTokenData,
): Promise<void>
```
