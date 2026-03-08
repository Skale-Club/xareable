/**
 * Translate Routes - cached UI/content translation endpoint
 */

import { Router, Request, Response } from "express";
import { createAdminSupabase, createServerSupabase } from "../supabase.js";
import { translateRequestSchema, type SupportedLanguage } from "../../shared/schema.js";
import { normalizeTranslationKey, normalizeForComparison, isLikelyUntranslatedSource, SUSPICIOUS_PT_TERMS_FOR_ES } from "../../shared/utils.js";

const router = Router();
const TRANSLATE_RATE_LIMIT_WINDOW_MS = 60_000;
const TRANSLATE_RATE_LIMIT_MAX_REQUESTS_ANON = 20;
const TRANSLATE_RATE_LIMIT_MAX_REQUESTS_AUTH = 60;
const TRANSLATE_MAX_TOTAL_CHARS_ANON = 6_000;
const TRANSLATE_MAX_TOTAL_CHARS_AUTH = 20_000;
const ASCII_ONLY_REGEX = /^[\x00-\x7F]*$/;

// Rate limiting storage: requestId -> { count, expireAt }
const rateLimitMap = new Map<string, { count: number; expireAt: number }>();

function getRequestIp(req: Request): string | null {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0].trim();
    }
    return req.ip || null;
}

async function getOptionalUserId(req: Request): Promise<string | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        return null;
    }

    const token = authHeader.slice("Bearer ".length);
    try {
        const sb = createServerSupabase(token);
        const { data: { user }, error } = await sb.auth.getUser();
        if (error || !user) {
            return null;
        }
        return user.id;
    } catch {
        return null;
    }
}

function isRateLimited(requestId: string, maxRequests: number): boolean {
    const now = Date.now();
    const current = rateLimitMap.get(requestId);

    if (!current || current.expireAt < now) {
        rateLimitMap.set(requestId, { count: 1, expireAt: now + TRANSLATE_RATE_LIMIT_WINDOW_MS });
        return false;
    }

    if (current.count >= maxRequests) {
        return true;
    }

    current.count++;
    return false;
}

function shouldRefreshLegacyAsciiTranslation(
    targetLanguage: SupportedLanguage,
    sourceText: string,
    cachedTranslation: string
): boolean {
    // If cached translation is ASCII-only but source contains non-ASCII, it's likely old
    if (!ASCII_ONLY_REGEX.test(cachedTranslation) || ASCII_ONLY_REGEX.test(sourceText)) {
        return false;
    }
    return true;
}

function parseTranslationsPayload(content: string): { bySource?: Record<string, string>; byIndex?: string[] } | null {
    try {
        const parsed = JSON.parse(content);

        // Try to find a "translations" array
        if (Array.isArray(parsed.translations)) {
            return { byIndex: parsed.translations };
        }

        // If it's a direct object mapping source text to translations
        if (typeof parsed === "object" && !Array.isArray(parsed)) {
            return { bySource: parsed };
        }

        return null;
    } catch {
        return null;
    }
}

function shouldRefreshSuspiciousSpanishTranslation(
    targetLanguage: "pt" | "es" | "en",
    translatedText: string
): boolean {
    if (targetLanguage !== "es") {
        return false;
    }

    const normalized = normalizeForComparison(translatedText);
    return SUSPICIOUS_PT_TERMS_FOR_ES.some((term) => normalized.includes(term));
}

/**
 * POST /api/translate
 * Translates a list of strings and caches results in database
 */
router.post("/api/translate", async (req: Request, res: Response): Promise<void> => {
    const startedAt = Date.now();
    let isAuthenticated = false;
    let targetLanguageForLog = "unknown";
    let textsCount = 0;
    let totalChars = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    let usedProvider = false;
    let statusCode = 200;

    try {
        const userId = await getOptionalUserId(req);
        isAuthenticated = Boolean(userId);
        const requestId = userId ? `user:${userId}` : `ip:${getRequestIp(req)}`;
        const maxRequests = userId
            ? TRANSLATE_RATE_LIMIT_MAX_REQUESTS_AUTH
            : TRANSLATE_RATE_LIMIT_MAX_REQUESTS_ANON;

        if (isRateLimited(requestId, maxRequests)) {
            statusCode = 429;
            res.status(429).json({ message: "Too many translation requests. Please try again shortly." });
            return;
        }

        const parseResult = translateRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            statusCode = 400;
            res.status(400).json({
                message: "Invalid request: " + parseResult.error.errors.map(e => e.message).join(", "),
            });
            return;
        }

        const targetLanguage = parseResult.data.targetLanguage;
        targetLanguageForLog = targetLanguage;
        const texts = Array.from(
            new Set(
                parseResult.data.texts
                    .map((text) => text.trim())
                    .filter((text) => text.length > 0)
            )
        );
        textsCount = texts.length;

        if (texts.length === 0) {
            statusCode = 400;
            res.status(400).json({ message: "At least one non-empty text is required." });
            return;
        }

        totalChars = texts.reduce((sum, text) => sum + text.length, 0);
        const maxTotalChars = userId
            ? TRANSLATE_MAX_TOTAL_CHARS_AUTH
            : TRANSLATE_MAX_TOTAL_CHARS_ANON;
        if (totalChars > maxTotalChars) {
            statusCode = 400;
            res.status(400).json({
                message: `Total text length exceeds ${maxTotalChars} characters.`,
            });
            return;
        }

        if (targetLanguage === "en") {
            const translations: Record<string, string> = {};
            texts.forEach(text => { translations[text] = text; });
            res.json({ translations });
            return;
        }

        const sb = createAdminSupabase();

        const { data: cached, error: cachedError } = await sb
            .from("translations")
            .select("source_text, translated_text")
            .eq("target_language", targetLanguage)
            .in("source_text", texts);

        const cachedMap = new Map<string, string>();

        if (cachedError) {
            console.warn("Translation cache read failed:", cachedError.message);
        } else {
            (cached || []).forEach((t: { source_text: string; translated_text: string }) => {
                cachedMap.set(t.source_text, t.translated_text);
            });
        }

        const translations: Record<string, string> = {};
        const uncachedTexts: string[] = [];

        texts.forEach(text => {
            const cachedTranslation = cachedMap.get(text);
            if (!cachedTranslation) {
                uncachedTexts.push(text);
                return;
            }

            if (shouldRefreshLegacyAsciiTranslation(targetLanguage, text, cachedTranslation)) {
                uncachedTexts.push(text);
                return;
            }

            if (shouldRefreshSuspiciousSpanishTranslation(targetLanguage, cachedTranslation)) {
                uncachedTexts.push(text);
                return;
            }

            if (isLikelyUntranslatedSource(targetLanguage, text, cachedTranslation)) {
                uncachedTexts.push(text);
                return;
            }

            translations[text] = cachedTranslation;
        });
        cacheHits = texts.length - uncachedTexts.length;
        cacheMisses = uncachedTexts.length;

        if (uncachedTexts.length > 0) {
            const geminiApiKey = process.env.GEMINI_API_KEY;
            if (!geminiApiKey) {
                console.warn("GEMINI_API_KEY is not set; returning source text for uncached translations.");
                uncachedTexts.forEach(text => { translations[text] = text; });
                res.json({ translations });
                return;
            }

            const languageNames: Record<string, string> = {
                pt: "Brazilian Portuguese (pt-BR)",
                es: "Spanish (es)",
            };

            const translatePrompt = `You are a professional translator.
Translate the English UI strings below to ${languageNames[targetLanguage]}.

Rules:
1) Return ONLY JSON in this exact shape: {"translations":["..."]}.
2) Keep the same number of items and the exact same order as the input array.
3) Preserve punctuation, emojis, placeholders, and casing where possible.
4) Keep UI labels concise and natural.
5) Use proper native orthography with diacritics.
   - For pt-BR use accents and cedilla when appropriate (e.g., "ç", "ã", "á", "é", "í", "ó", "ú").
   - For es use proper accents/letters when appropriate (e.g., "ñ", "á", "é", "í", "ó", "ú", "ü").
6) If target language is Spanish, never answer in Portuguese.

Input:
${JSON.stringify(uncachedTexts)}
`;

            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
            usedProvider = true;

            const response = await fetch(geminiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: translatePrompt }] }],
                    generationConfig: {
                        temperature: 0.3,
                        responseMimeType: "application/json",
                    },
                }),
            });

            if (response.ok) {
                const data = await response.json();
                const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

                if (content) {
                    const parsedPayload = parseTranslationsPayload(content);
                    const upsertRows: Array<{
                        source_text: string;
                        source_language: string;
                        target_language: string;
                        translated_text: string;
                    }> = [];

                    for (let index = 0; index < uncachedTexts.length; index++) {
                        const source = uncachedTexts[index];

                        const bySourceTranslation =
                            parsedPayload?.bySource && typeof parsedPayload.bySource[source] === "string"
                                ? parsedPayload.bySource[source]
                                : null;

                        const byIndexTranslation =
                            parsedPayload?.byIndex && typeof parsedPayload.byIndex[index] === "string"
                                ? parsedPayload.byIndex[index]
                                : null;

                        const translated = bySourceTranslation || byIndexTranslation;
                        if (typeof translated !== "string") continue;

                        const cleanTranslated = translated.trim();
                        if (!cleanTranslated) continue;
                        if (isLikelyUntranslatedSource(targetLanguage, source, cleanTranslated)) continue;

                        translations[source] = cleanTranslated;
                        upsertRows.push({
                            source_text: source,
                            source_language: "en",
                            target_language: targetLanguage,
                            translated_text: cleanTranslated,
                        });
                    }

                    if (upsertRows.length > 0) {
                        const { error: upsertError } = await sb.from("translations").upsert(
                            upsertRows,
                            { onConflict: "source_text,target_language" }
                        );

                        if (upsertError) {
                            console.warn("Translation cache write failed:", upsertError.message);
                        }
                    }
                }
            } else {
                const errorBody = await response.text();
                console.error("Translation provider error:", response.status, errorBody);
            }

            uncachedTexts.forEach(text => {
                if (!translations[text]) {
                    translations[text] = text;
                }
            });
        }

        res.json({ translations });
    } catch (error: any) {
        console.error("Translation error:", error);
        statusCode = 500;
        res.status(500).json({ message: error.message || "Translation failed" });
    } finally {
        const durationMs = Date.now() - startedAt;
        console.info(
            `[translate] status=${statusCode} auth=${isAuthenticated} target=${targetLanguageForLog} texts=${textsCount} chars=${totalChars} hits=${cacheHits} misses=${cacheMisses} provider=${usedProvider} duration_ms=${durationMs}`,
        );
    }
});

export default router;
