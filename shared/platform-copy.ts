/**
 * Per-platform post text: which fields each platform takes, the limits, and
 * plain-code checks that run on whatever the AI (or the user) wrote.
 *
 * Pure and dependency-free so the server (validation + repair) and the client
 * (live counters) share one definition.
 *
 * LIMITS ARE NOT VERIFIED. The numbers come from the vendor-sourced research
 * on the Notion plan page (2026-11-14), which itself flags that sources
 * disagree (Instagram hashtag cap 3 vs 5, TikTok caption cap). They are kept
 * in this one table so verifying against the official platform docs is a
 * one-file change. Do not treat them as platform truth until `verified` is set.
 */

export const COPY_PLATFORMS = ["instagram", "facebook", "tiktok", "youtube"] as const;
export type CopyPlatform = (typeof COPY_PLATFORMS)[number];

export interface PlatformCopyRule {
  platform: CopyPlatform;
  label: string;
  /** Separate title field (TikTok: the title IS the caption; YouTube: title + description). */
  hasTitle: boolean;
  titleMax: number | null;
  /** Body / description field. TikTok has none: its title is the whole caption. */
  hasBody: boolean;
  bodyMax: number | null;
  hashtagMin: number;
  hashtagMax: number;
  /** Where the hashtags are written. They live inside the text, not in a separate field. */
  hashtagsIn: "body" | "title";
  /** YouTube tags field, limited by combined length. null = platform has no tags field. */
  tagsMaxChars: number | null;
  /** True once the limits above were checked against the platform's official docs. */
  verified: boolean;
}

export const PLATFORM_COPY_RULES: Record<CopyPlatform, PlatformCopyRule> = {
  instagram: {
    platform: "instagram",
    label: "Instagram",
    hasTitle: false,
    titleMax: null,
    hasBody: true,
    bodyMax: 2200,
    hashtagMin: 3,
    hashtagMax: 5,
    hashtagsIn: "body",
    tagsMaxChars: null,
    verified: false,
  },
  facebook: {
    platform: "facebook",
    label: "Facebook",
    hasTitle: false,
    titleMax: null,
    hasBody: true,
    // The publish API accepts at most 5,000 characters of caption.
    bodyMax: 5000,
    hashtagMin: 0,
    hashtagMax: 3,
    hashtagsIn: "body",
    tagsMaxChars: null,
    verified: false,
  },
  tiktok: {
    platform: "tiktok",
    label: "TikTok",
    hasTitle: true,
    titleMax: 90,
    hasBody: false,
    bodyMax: null,
    hashtagMin: 3,
    hashtagMax: 5,
    hashtagsIn: "title",
    tagsMaxChars: null,
    verified: false,
  },
  youtube: {
    platform: "youtube",
    label: "YouTube",
    hasTitle: true,
    titleMax: 100,
    hasBody: true,
    bodyMax: 5000,
    hashtagMin: 0,
    hashtagMax: 3,
    hashtagsIn: "body",
    tagsMaxChars: 500,
    verified: false,
  },
};

export function isCopyPlatform(value: unknown): value is CopyPlatform {
  return typeof value === "string" && (COPY_PLATFORMS as readonly string[]).includes(value);
}

export interface PlatformCopy {
  platform: CopyPlatform;
  title?: string;
  body?: string;
  tags?: string[];
}

export type CopyIssueCode =
  | "title_missing"
  | "title_too_long"
  | "body_missing"
  | "body_too_long"
  | "hashtags_too_few"
  | "hashtags_too_many"
  | "tags_too_long";

export interface CopyIssue {
  code: CopyIssueCode;
  message: string;
}

export interface CopyCounts {
  titleLength: number;
  bodyLength: number;
  hashtags: number;
  tagsLength: number;
}

const HASHTAG_PATTERN = /(^|\s)#[\p{L}\p{N}_][\p{L}\p{N}_-]*/gu;

export function countHashtags(text: string): number {
  if (!text) return 0;
  return (text.match(HASHTAG_PATTERN) || []).length;
}

/**
 * Remove hashtags beyond `max`, keeping the first ones. Only whole hashtag
 * tokens are removed; surrounding text is left alone. A deterministic fix, so
 * "too many hashtags" never needs a second AI call.
 */
export function capHashtags(text: string, max: number): string {
  if (!text || max < 0) return text;
  let seen = 0;
  const kept = text.replace(HASHTAG_PATTERN, (match, lead: string) => {
    seen += 1;
    return seen <= max ? match : lead;
  });
  return kept
    .replace(/[ \t]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Drop fields the platform does not use, trim, and de-duplicate tags. */
export function normalizePlatformCopy(copy: PlatformCopy): PlatformCopy {
  const rule = PLATFORM_COPY_RULES[copy.platform];
  const out: PlatformCopy = { platform: copy.platform };
  if (rule.hasTitle) out.title = (copy.title ?? "").trim();
  if (rule.hasBody) out.body = (copy.body ?? "").trim();
  if (rule.tagsMaxChars !== null) {
    const seen = new Set<string>();
    out.tags = (copy.tags ?? [])
      .map((tag) => String(tag).replace(/^#/, "").trim())
      .filter((tag) => {
        const key = tag.toLowerCase();
        if (!tag || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  return out;
}

export function measurePlatformCopy(copy: PlatformCopy): CopyCounts {
  const rule = PLATFORM_COPY_RULES[copy.platform];
  const title = copy.title ?? "";
  const body = copy.body ?? "";
  const hashtagText = rule.hashtagsIn === "title" ? title : body;
  const tags = copy.tags ?? [];
  // YouTube counts tags by combined length; a tag with a space is quoted by the platform.
  const tagsLength = tags.reduce((sum, tag) => sum + tag.length + (/\s/.test(tag) ? 2 : 0), 0) + Math.max(tags.length - 1, 0);
  return {
    titleLength: title.length,
    bodyLength: body.length,
    hashtags: countHashtags(hashtagText),
    tagsLength,
  };
}

export function validatePlatformCopy(input: PlatformCopy): { ok: boolean; issues: CopyIssue[]; counts: CopyCounts } {
  const rule = PLATFORM_COPY_RULES[input.platform];
  const copy = normalizePlatformCopy(input);
  const counts = measurePlatformCopy(copy);
  const issues: CopyIssue[] = [];

  if (rule.hasTitle) {
    if (counts.titleLength === 0) issues.push({ code: "title_missing", message: `${rule.label} needs a title.` });
    else if (rule.titleMax !== null && counts.titleLength > rule.titleMax) {
      issues.push({ code: "title_too_long", message: `${rule.label} title is ${counts.titleLength} characters; the limit is ${rule.titleMax}.` });
    }
  }
  if (rule.hasBody) {
    if (counts.bodyLength === 0) issues.push({ code: "body_missing", message: `${rule.label} needs text.` });
    else if (rule.bodyMax !== null && counts.bodyLength > rule.bodyMax) {
      issues.push({ code: "body_too_long", message: `${rule.label} text is ${counts.bodyLength} characters; the limit is ${rule.bodyMax}.` });
    }
  }
  if (counts.hashtags < rule.hashtagMin) {
    issues.push({ code: "hashtags_too_few", message: `${rule.label} needs at least ${rule.hashtagMin} hashtags; found ${counts.hashtags}.` });
  }
  if (counts.hashtags > rule.hashtagMax) {
    issues.push({ code: "hashtags_too_many", message: `${rule.label} allows at most ${rule.hashtagMax} hashtags; found ${counts.hashtags}.` });
  }
  if (rule.tagsMaxChars !== null && counts.tagsLength > rule.tagsMaxChars) {
    issues.push({ code: "tags_too_long", message: `${rule.label} tags total ${counts.tagsLength} characters; the limit is ${rule.tagsMaxChars}.` });
  }

  return { ok: issues.length === 0, issues, counts };
}

/** The single text string sent to the publisher for this platform. */
export function publishTextFor(input: PlatformCopy): string {
  const rule = PLATFORM_COPY_RULES[input.platform];
  const copy = normalizePlatformCopy(input);
  if (!rule.hasBody) return copy.title ?? "";
  return copy.body ?? "";
}

/**
 * Parse the model's JSON reply: `{ "instagram": { "body": "..." }, "tiktok": { "title": "..." } }`.
 * Tolerates code fences and prose around the object. Unknown platforms and
 * platforms that were not requested are dropped. Never throws.
 */
export function parsePlatformCopyJson(
  raw: string,
  requested: readonly CopyPlatform[],
): Partial<Record<CopyPlatform, PlatformCopy>> {
  const result: Partial<Record<CopyPlatform, PlatformCopy>> = {};
  if (!raw) return result;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return result;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return result;
  }
  if (!parsed || typeof parsed !== "object") return result;

  for (const platform of requested) {
    const entry = (parsed as Record<string, unknown>)[platform];
    if (!entry || typeof entry !== "object") continue;
    const fields = entry as Record<string, unknown>;
    result[platform] = normalizePlatformCopy({
      platform,
      title: typeof fields.title === "string" ? fields.title : undefined,
      body: typeof fields.body === "string" ? fields.body : undefined,
      tags: Array.isArray(fields.tags) ? fields.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
    });
  }
  return result;
}
