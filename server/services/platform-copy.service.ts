/**
 * Per-platform post text ("copy") generation.
 *
 * One AI call writes a version for every requested platform; plain code
 * (shared/platform-copy.ts) validates each version, fixes hashtag overflow
 * deterministically, and at most ONE repair call is made for versions that
 * still fail. Whatever still fails is returned WITH its issues so the user can
 * edit it, never silently shipped.
 *
 * The model call is injected (`callModel`) so the logic can be tested without
 * touching a real AI provider, which uses production keys and costs money.
 */

import { LANGUAGE_NAMES } from "../../shared/config/defaults.js";
import type { SupportedLanguage } from "../../shared/schema.js";
import {
    PLATFORM_COPY_RULES,
    capHashtags,
    normalizePlatformCopy,
    parsePlatformCopyJson,
    validatePlatformCopy,
    type CopyCounts,
    type CopyIssue,
    type CopyPlatform,
    type PlatformCopy,
} from "../../shared/platform-copy.js";
import { chatCompletion } from "./ai-gateway.service.js";
import { getCallRouting } from "./ai-gateway-settings.service.js";
import { config } from "../config/index.js";

export interface PlatformCopyContext {
    brandName: string;
    companyType: string;
    /** When omitted, the model matches the language of the existing caption (English if none). */
    language?: SupportedLanguage;
    /** The caption written when the post was created (may be empty). */
    caption?: string | null;
    /** What the image was meant to show / the user's original direction. */
    creativeIntent?: string | null;
}

export interface ModelCallResult {
    text: string;
    usage?: { promptTokenCount?: number; candidatesTokenCount?: number };
    costUsdMicros?: number;
    model: string;
}

export type PlatformCopyModelCall = (prompt: string) => Promise<ModelCallResult>;

export interface PlatformCopyResult extends PlatformCopy {
    issues: CopyIssue[];
    counts: CopyCounts;
}

export interface PlatformCopyOutput {
    copies: PlatformCopyResult[];
    usage: { promptTokenCount: number; candidatesTokenCount: number };
    /** Sum of the real gateway cost across calls, or undefined if the gateway reported none. */
    costUsdMicros?: number;
    model: string | null;
    modelCalls: number;
    repaired: boolean;
}

const MAX_CONTEXT_CHARS = 1500;

function clip(value: string | null | undefined): string {
    const text = (value ?? "").trim();
    return text.length > MAX_CONTEXT_CHARS ? `${text.slice(0, MAX_CONTEXT_CHARS)}…` : text;
}

/** The field-by-field spec for one platform, generated from the shared rules table. */
export function describePlatformRule(platform: CopyPlatform): string {
    const rule = PLATFORM_COPY_RULES[platform];
    const lines: string[] = [];
    if (rule.hasTitle) {
        lines.push(`"title": required, at most ${rule.titleMax} characters.`);
    }
    if (rule.hasBody) {
        lines.push(`"body": required, at most ${rule.bodyMax} characters.`);
    }
    if (rule.tagsMaxChars !== null) {
        lines.push(`"tags": array of search keywords without "#", ${rule.tagsMaxChars} characters in total at most.`);
    }
    const where = rule.hashtagsIn === "title" ? "the title" : "the body";
    lines.push(
        rule.hashtagMin > 0
            ? `Put ${rule.hashtagMin} to ${rule.hashtagMax} relevant hashtags inside ${where}.`
            : `Use at most ${rule.hashtagMax} relevant hashtags inside ${where} (fewer is fine).`,
    );
    if (!rule.hasBody) lines.push(`There is no separate body: the title is the whole caption.`);
    if (!rule.hasTitle) lines.push(`There is no title field: do not write one.`);
    return `${rule.label} (key "${platform}"):\n${lines.map((line) => `  - ${line}`).join("\n")}`;
}

/** The language instruction: an explicit language, else follow the existing caption. */
export function languageInstruction(language: SupportedLanguage | undefined): string {
    if (!language) return "the same language as the existing caption (English if there is none)";
    return LANGUAGE_NAMES[language] || "English";
}

export function buildPlatformCopyPrompt(platforms: readonly CopyPlatform[], context: PlatformCopyContext): string {
    const languageLabel = languageInstruction(context.language);
    const specs = platforms.map(describePlatformRule).join("\n\n");
    const exampleKeys = platforms.map((p) => `"${p}": { ... }`).join(", ");

    return `Write the text for one social media post, separately for each platform below.

Brand: ${context.brandName}
Industry: ${context.companyType}
Language: ${languageLabel} (everything must be written in ${languageLabel})
Existing caption for this post: ${clip(context.caption) || "none"}
What the image is about: ${clip(context.creativeIntent) || "not specified"}

Platform specs:
${specs}

Rules:
- Use only facts present in the brand, caption and image description above. Do not invent offers, prices, dates, places, statistics or claims.
- Write each platform's text natively for that platform, not as a copy of another version.
- SEO: put the main topic keyword and the hook early in the text, and choose hashtags a real audience would search for. No repeated or filler hashtags.
- Count hashtags carefully and stay inside the allowed range and character limits.
- Complete sentences only. No placeholder text.
- Reply with JSON only, no commentary, shaped like { ${exampleKeys} } where each value holds exactly the fields listed for that platform.`;
}

export function buildRepairPrompt(
    failing: { platform: CopyPlatform; copy: PlatformCopy; issues: CopyIssue[] }[],
    context: PlatformCopyContext,
): string {
    const languageLabel = languageInstruction(context.language);
    const blocks = failing
        .map(({ platform, copy, issues }) => {
            const current = JSON.stringify(
                { title: copy.title, body: copy.body, tags: copy.tags },
                (_key, value) => (value === undefined ? undefined : value),
            );
            return `${describePlatformRule(platform)}\n  Current version: ${current}\n  Problems: ${issues.map((i) => i.message).join(" ")}`;
        })
        .join("\n\n");
    const exampleKeys = failing.map(({ platform }) => `"${platform}": { ... }`).join(", ");

    return `Fix these social media texts for ${context.brandName}. Keep the meaning and tone, stay in ${languageLabel}, and do not add facts that are not already in the current version.

${blocks}

Reply with JSON only, shaped like { ${exampleKeys} }, containing a corrected version for each platform listed.`;
}

function toResult(copy: PlatformCopy): PlatformCopyResult {
    const normalized = normalizePlatformCopy(copy);
    const { issues, counts } = validatePlatformCopy(normalized);
    return { ...normalized, issues, counts };
}

/** Fix what plain code can fix without a second AI call: hashtag overflow. */
export function applyDeterministicFixes(copy: PlatformCopy): PlatformCopy {
    const rule = PLATFORM_COPY_RULES[copy.platform];
    const normalized = normalizePlatformCopy(copy);
    if (rule.hashtagsIn === "title" && normalized.title) {
        normalized.title = capHashtags(normalized.title, rule.hashtagMax);
    } else if (rule.hashtagsIn === "body" && normalized.body) {
        normalized.body = capHashtags(normalized.body, rule.hashtagMax);
    }
    return normalized;
}

export async function generatePlatformCopy(params: {
    platforms: readonly CopyPlatform[];
    context: PlatformCopyContext;
    callModel: PlatformCopyModelCall;
}): Promise<PlatformCopyOutput> {
    const platforms = [...new Set(params.platforms)];
    const usage = { promptTokenCount: 0, candidatesTokenCount: 0 };
    let costUsdMicros: number | undefined;
    let model: string | null = null;
    let modelCalls = 0;

    const record = (result: ModelCallResult) => {
        modelCalls += 1;
        model = result.model || model;
        usage.promptTokenCount += result.usage?.promptTokenCount ?? 0;
        usage.candidatesTokenCount += result.usage?.candidatesTokenCount ?? 0;
        if (typeof result.costUsdMicros === "number") {
            costUsdMicros = (costUsdMicros ?? 0) + result.costUsdMicros;
        }
    };

    const first = await params.callModel(buildPlatformCopyPrompt(platforms, params.context));
    record(first);
    const parsed = parsePlatformCopyJson(first.text, platforms);

    const current = new Map<CopyPlatform, PlatformCopy>();
    for (const platform of platforms) {
        current.set(platform, applyDeterministicFixes(parsed[platform] ?? { platform }));
    }

    const failingNow = () =>
        platforms
            .map((platform) => ({ platform, copy: current.get(platform)!, ...validatePlatformCopy(current.get(platform)!) }))
            .filter((entry) => !entry.ok);

    let repaired = false;
    const failing = failingNow();
    if (failing.length > 0) {
        try {
            const repairResult = await params.callModel(
                buildRepairPrompt(
                    failing.map(({ platform, copy, issues }) => ({ platform, copy, issues })),
                    params.context,
                ),
            );
            record(repairResult);
            repaired = true;
            const fixed = parsePlatformCopyJson(repairResult.text, failing.map((f) => f.platform));
            for (const { platform } of failing) {
                const candidate = fixed[platform];
                if (candidate) current.set(platform, applyDeterministicFixes(candidate));
            }
        } catch {
            // The repair is best effort: the first-pass versions are still returned,
            // each with its issues, so the user can edit them.
        }
    }

    return {
        copies: platforms.map((platform) => toResult(current.get(platform)!)),
        usage,
        costUsdMicros,
        model,
        modelCalls,
        repaired,
    };
}

/**
 * The real model call, mirroring caption-quality's routing: the OpenRouter
 * gateway when routed there and a key exists, else direct Gemini. Throws on
 * failure (the caller maps it to an HTTP error) because, unlike a caption,
 * there is no safe generic fallback for per-platform text.
 */
export function createPlatformCopyModelCall(params: {
    geminiApiKey: string;
    openRouterApiKey?: string;
    model: string;
}): PlatformCopyModelCall {
    return async (prompt: string): Promise<ModelCallResult> => {
        const routing = await getCallRouting("planning");
        const orKey = params.openRouterApiKey || config.OPENROUTER_API_KEY;

        if (routing === "openrouter" && orKey) {
            const result = await chatCompletion({
                apiKey: orKey,
                model: params.model,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.6,
                maxTokens: 1500,
            });
            return {
                text: result.text,
                usage: result.usage,
                costUsdMicros: result.costUsdMicros,
                model: result.modelUsed || params.model,
            };
        }

        if (!params.geminiApiKey) {
            throw new Error("No AI key is available for this request");
        }
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": params.geminiApiKey },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.6, maxOutputTokens: 1500 },
                }),
            },
        );
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error?.message || "The AI request failed");
        }
        const data = await response.json();
        const parts = data?.candidates?.[0]?.content?.parts;
        const text = Array.isArray(parts)
            ? parts.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join("\n")
            : "";
        const meta = data?.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
        return { text, usage: meta, model: params.model };
    };
}
