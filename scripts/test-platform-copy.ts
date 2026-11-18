import assert from "node:assert/strict";
import {
  PLATFORM_COPY_RULES,
  capHashtags,
  countHashtags,
  normalizePlatformCopy,
  parsePlatformCopyJson,
  publishTextFor,
  validatePlatformCopy,
} from "../shared/platform-copy.js";

// Hashtag counting: unicode letters, no false hits on "#" mid-word or URLs fragments.
assert.equal(countHashtags("Olá #educação #marketing_digital"), 2);
assert.equal(countHashtags("no tags here"), 0);
assert.equal(countHashtags("a#b c# #ok"), 1);
assert.equal(countHashtags(""), 0);

// Capping keeps the first N and leaves the prose intact.
assert.equal(capHashtags("Great day.\n\n#a #b #c #d", 2), "Great day.\n\n#a #b");
assert.equal(capHashtags("Great day. #a", 3), "Great day. #a");
assert.equal(countHashtags(capHashtags("x #a #b #c #d #e #f", 5)), 5);

// Instagram: body only, 3 to 5 hashtags, 2,200 characters.
const igOk = validatePlatformCopy({ platform: "instagram", body: "Fresh batch today. #a #b #c" });
assert.equal(igOk.ok, true);
assert.equal(igOk.counts.hashtags, 3);
assert.equal(validatePlatformCopy({ platform: "instagram", body: "No tags." }).issues[0].code, "hashtags_too_few");
assert.equal(
  validatePlatformCopy({ platform: "instagram", body: "x #a #b #c #d #e #f" }).issues[0].code,
  "hashtags_too_many",
);
assert.equal(
  validatePlatformCopy({ platform: "instagram", body: `${"a".repeat(2201)} #a #b #c` }).issues[0].code,
  "body_too_long",
);
assert.equal(validatePlatformCopy({ platform: "instagram", body: "" }).issues.some((i) => i.code === "body_missing"), true);

// Facebook: body only, hashtags optional but capped.
assert.equal(validatePlatformCopy({ platform: "facebook", body: "Come say hi." }).ok, true);
assert.equal(validatePlatformCopy({ platform: "facebook", body: "Hi #a #b #c #d" }).issues[0].code, "hashtags_too_many");

// TikTok: the title is the whole caption, hashtags live inside it, no body.
const tt = validatePlatformCopy({ platform: "tiktok", title: "New menu drop #food #nyc #fyp" });
assert.equal(tt.ok, true);
assert.equal(tt.counts.hashtags, 3);
assert.equal(validatePlatformCopy({ platform: "tiktok", title: `${"a".repeat(91)} #a #b #c` }).issues[0].code, "title_too_long");
assert.equal(validatePlatformCopy({ platform: "tiktok", title: "" }).issues[0].code, "title_missing");
assert.equal(publishTextFor({ platform: "tiktok", title: "Hi #a #b #c", body: "ignored" }), "Hi #a #b #c");

// YouTube: title + description + tags limited by combined length.
const yt = validatePlatformCopy({ platform: "youtube", title: "How we bake", body: "Full recipe inside. #baking", tags: ["bread", "sourdough"] });
assert.equal(yt.ok, true);
const longTags = Array.from({ length: 80 }, (_, i) => `keyword${i}`);
assert.equal(validatePlatformCopy({ platform: "youtube", title: "t", body: "b", tags: longTags }).issues[0].code, "tags_too_long");
assert.equal(publishTextFor({ platform: "youtube", title: "T", body: "Description" }), "Description");

// Fields a platform does not use are dropped, tags are de-duplicated.
const normalized = normalizePlatformCopy({ platform: "instagram", title: "ignored", body: "  hi #a  ", tags: ["x"] });
assert.deepEqual(normalized, { platform: "instagram", body: "hi #a" });
assert.deepEqual(
  normalizePlatformCopy({ platform: "youtube", title: "t", body: "b", tags: ["#Bread", "bread", " ", "yeast"] }).tags,
  ["Bread", "yeast"],
);

// Parsing the model reply: fences, prose, missing and unrequested platforms.
const reply = 'Sure!\n```json\n{"instagram":{"body":"Hello #a #b #c"},"tiktok":{"title":"Hi #a #b #c"},"youtube":{"title":"Nope"}}\n```';
const parsed = parsePlatformCopyJson(reply, ["instagram", "facebook", "tiktok"]);
assert.equal(parsed.instagram?.body, "Hello #a #b #c");
assert.equal(parsed.tiktok?.title, "Hi #a #b #c");
assert.equal(parsed.facebook, undefined);
assert.equal(parsed.youtube, undefined);
assert.deepEqual(parsePlatformCopyJson("not json", ["instagram"]), {});
assert.deepEqual(parsePlatformCopyJson("", ["instagram"]), {});
assert.deepEqual(parsePlatformCopyJson("{broken", ["instagram"]), {});

// The rules table is the single place limits live, and stays flagged unverified.
for (const rule of Object.values(PLATFORM_COPY_RULES)) {
  assert.equal(rule.verified, false);
  assert.ok(rule.hashtagMin <= rule.hashtagMax);
}

console.log("PASS test-platform-copy");
