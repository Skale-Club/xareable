/** Return a safe, useful message from an API error response. */
export function getApiErrorMessage(raw: string, isJson: boolean, fallback = "Request failed"): string {
  if (!isJson) return raw || fallback;

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.message === "string" && parsed.message.trim() ? parsed.message : raw || fallback;
  } catch {
    return raw || fallback;
  }
}
