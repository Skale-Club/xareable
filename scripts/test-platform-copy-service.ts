/**
 * Tests for server/services/platform-copy.service.ts and the pure helpers in
 * social-publish.service.ts. The AI is ALWAYS a fake here: the real call uses
 * production keys and costs money, so no test may reach it.
 */
import assert from "node:assert/strict";

// The service modules import the app config, which validates env at import time.
// Harmless placeholders (set BEFORE the dynamic imports below) keep this test from
// ever depending on, or accidentally using, the real production credentials.
process.env.SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const {
  applyDeterministicFixes,
  buildPlatformCopyPrompt,
  buildRepairPrompt,
  describePlatformRule,
  generatePlatformCopy,
  languageInstruction,
} = await import("../server/services/platform-copy.service.js");
const { captionForPlatform, groupAccountIdsByPlatform } = await import("../server/services/social-publish.service.js");
import type { ModelCallResult } from "../server/services/platform-copy.service.js";

const context = { brandName: "Skale Club", companyType: "Marketing", language: "en" as const, caption: "Fresh batch today", creativeIntent: "bakery counter" };

function fakeModel(replies: (string | Error)[], extra: Partial<ModelCallResult> = {}) {
  const prompts: string[] = [];
  let index = 0;
  const callModel = async (prompt: string): Promise<ModelCallResult> => {
    prompts.push(prompt);
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (reply instanceof Error) throw reply;
    return { text: reply, model: "fake-model", usage: { promptTokenCount: 100, candidatesTokenCount: 50 }, ...extra };
  };
  return { callModel, prompts };
}

const good = JSON.stringify({
  instagram: { body: "Fresh bread every morning. #bakery #sourdough #freshbread" },
  facebook: { body: "Come visit us today. #bakery" },
});

async function main() {
  // 1. Good first reply: one call, no repair, usage recorded.
  {
    const fake = fakeModel([good], { costUsdMicros: 700 });
    const out = await generatePlatformCopy({ platforms: ["instagram", "facebook"], context, callModel: fake.callModel });
    assert.equal(out.modelCalls, 1);
    assert.equal(out.repaired, false);
    assert.equal(out.copies.length, 2);
    assert.ok(out.copies.every((c) => c.issues.length === 0));
    assert.deepEqual(out.usage, { promptTokenCount: 100, candidatesTokenCount: 50 });
    assert.equal(out.costUsdMicros, 700);
    assert.equal(out.model, "fake-model");
  }

  // 2. Too many hashtags is fixed by plain code: no second AI call.
  {
    const reply = JSON.stringify({ instagram: { body: "Fresh bread. #a #b #c #d #e #f #g" } });
    const fake = fakeModel([reply]);
    const out = await generatePlatformCopy({ platforms: ["instagram"], context, callModel: fake.callModel });
    assert.equal(out.modelCalls, 1);
    assert.equal(out.copies[0].counts.hashtags, 5);
    assert.equal(out.copies[0].issues.length, 0);
  }

  // 3. Too few hashtags needs the one repair call, which fixes it.
  {
    const bad = JSON.stringify({ instagram: { body: "Fresh bread every morning." } });
    const fixed = JSON.stringify({ instagram: { body: "Fresh bread every morning. #bakery #bread #local" } });
    const fake = fakeModel([bad, fixed]);
    const out = await generatePlatformCopy({ platforms: ["instagram"], context, callModel: fake.callModel });
    assert.equal(out.modelCalls, 2);
    assert.equal(out.repaired, true);
    assert.equal(out.copies[0].issues.length, 0);
    assert.deepEqual(out.usage, { promptTokenCount: 200, candidatesTokenCount: 100 });
    assert.match(fake.prompts[1], /at least 3 hashtags/i);
  }

  // 4. Repair that still fails: at most ONE repair, the issues are returned, not hidden.
  {
    const bad = JSON.stringify({ instagram: { body: "No tags at all." } });
    const fake = fakeModel([bad, bad, bad]);
    const out = await generatePlatformCopy({ platforms: ["instagram"], context, callModel: fake.callModel });
    assert.equal(out.modelCalls, 2);
    assert.equal(out.copies[0].issues[0].code, "hashtags_too_few");
  }

  // 5. A repair call that throws keeps the first-pass text with its issues.
  {
    const bad = JSON.stringify({ instagram: { body: "No tags at all." } });
    const fake = fakeModel([bad, new Error("provider down")]);
    const out = await generatePlatformCopy({ platforms: ["instagram"], context, callModel: fake.callModel });
    assert.equal(out.modelCalls, 1);
    assert.equal(out.repaired, false);
    assert.equal(out.copies[0].body, "No tags at all.");
    assert.equal(out.copies[0].issues.length > 0, true);
  }

  // 6. A platform the model forgot is repaired in the same single extra call.
  {
    const onlyInstagram = JSON.stringify({ instagram: { body: "Fresh bread. #a #b #c" } });
    const both = JSON.stringify({ facebook: { body: "Come visit. #bakery" } });
    const fake = fakeModel([onlyInstagram, both]);
    const out = await generatePlatformCopy({ platforms: ["instagram", "facebook"], context, callModel: fake.callModel });
    assert.equal(out.modelCalls, 2);
    assert.equal(out.copies.find((c) => c.platform === "facebook")?.body, "Come visit. #bakery");
    assert.equal(out.copies.every((c) => c.issues.length === 0), true);
  }

  // 7. Garbage reply: the first call throwing is surfaced to the caller (route maps it to a 502).
  {
    const fake = fakeModel([new Error("provider down")]);
    await assert.rejects(() => generatePlatformCopy({ platforms: ["instagram"], context, callModel: fake.callModel }), /provider down/);
  }

  // 8. No gateway cost reported: costUsdMicros stays undefined so token pricing applies.
  {
    const fake = fakeModel([good]);
    const out = await generatePlatformCopy({ platforms: ["instagram", "facebook"], context, callModel: fake.callModel });
    assert.equal(out.costUsdMicros, undefined);
  }

  // 9. Duplicate platforms are asked for once.
  {
    const fake = fakeModel([good]);
    const out = await generatePlatformCopy({ platforms: ["instagram", "instagram", "facebook"], context, callModel: fake.callModel });
    assert.equal(out.copies.length, 2);
  }

  // Prompt content: limits come from the rules table, facts are not invented, language is explicit or follows the caption.
  const prompt = buildPlatformCopyPrompt(["instagram", "tiktok"], context);
  assert.match(prompt, /2200 characters/);
  assert.match(prompt, /3 to 5 relevant hashtags inside the body/);
  assert.match(prompt, /at most 90 characters/);
  assert.match(prompt, /title is the whole caption/);
  assert.match(prompt, /Do not invent/);
  assert.match(prompt, /JSON only/);
  assert.match(prompt, /Skale Club/);
  assert.match(describePlatformRule("facebook"), /do not write one/);
  assert.match(languageInstruction("pt"), /Portuguese/);
  assert.match(languageInstruction(undefined), /same language as the existing caption/);
  assert.match(buildPlatformCopyPrompt(["instagram"], { ...context, language: undefined }), /same language as the existing caption/);

  // Long context is clipped so one huge caption cannot blow up the prompt.
  const huge = buildPlatformCopyPrompt(["instagram"], { ...context, caption: "x".repeat(10_000) });
  assert.ok(huge.length < 6_000);

  // Repair prompt carries the problem and the current text.
  const repairPrompt = buildRepairPrompt(
    [{ platform: "instagram", copy: { platform: "instagram", body: "Hi" }, issues: [{ code: "hashtags_too_few", message: "Instagram needs at least 3 hashtags; found 0." }] }],
    context,
  );
  assert.match(repairPrompt, /Instagram needs at least 3 hashtags/);
  assert.match(repairPrompt, /"body":"Hi"/);

  // Deterministic fixes only touch the hashtag field the platform uses.
  assert.equal(applyDeterministicFixes({ platform: "tiktok", title: "Hi #a #b #c #d #e #f", body: "ignored" }).title, "Hi #a #b #c #d #e");
  assert.equal(applyDeterministicFixes({ platform: "facebook", body: "Hi #a #b #c #d" }).body, "Hi #a #b #c");

  // Per-platform publishing helpers (pure): grouping and which text a group publishes.
  assert.deepEqual(
    groupAccountIdsByPlatform([
      { id: "1", platform: "instagram" },
      { id: "2", platform: "facebook" },
      { id: "3", platform: "instagram" },
    ]),
    [
      { platform: "instagram", accountIds: ["1", "3"] },
      { platform: "facebook", accountIds: ["2"] },
    ],
  );
  assert.deepEqual(groupAccountIdsByPlatform([]), []);
  assert.equal(captionForPlatform("instagram", { instagram: "IG text" }, "shared"), "IG text");
  assert.equal(captionForPlatform("facebook", { instagram: "IG text" }, "shared"), "shared");
  assert.equal(captionForPlatform("facebook", undefined, undefined), undefined);
  // An explicitly emptied platform text stays empty (it is not replaced by the shared caption).
  assert.equal(captionForPlatform("instagram", { instagram: "" }, "shared"), "");

  console.log("PASS test-platform-copy-service");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
