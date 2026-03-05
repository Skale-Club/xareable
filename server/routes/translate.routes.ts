/**
 * Translate Routes - cached UI/content translation endpoint
 */

import { Router, Request, Response } from "express";
import { createAdminSupabase, createServerSupabase } from "../supabase.js";
import { translateRequestSchema } from "../../shared/schema.js";

const router = Router();
const TRANSLATE_RATE_LIMIT_WINDOW_MS = 60_000;
const TRANSLATE_RATE_LIMIT_MAX_REQUESTS_ANON = 20;
const TRANSLATE_RATE_LIMIT_MAX_REQUESTS_AUTH = 60;
const TRANSLATE_MAX_TOTAL_CHARS_ANON = 6_000;
const TRANSLATE_MAX_TOTAL_CHARS_AUTH = 20_000;
const ASCII_ONLY_REGEX = /^[\x00-\x7F]*$/;
const SUSPICIOUS_PT_TERMS_FOR_ES = [
    "navegacao",
    "configuracoes",
    "informacoes",
    "chave",
    "cores",
    "pagina inicial",
    "politica de privacidade",
    "termos de servico",
    "proximo",
];

type RateLimitBucket = {
    windowStart: number;
    count: number;
};

const translateRateLimit = new Map<string, RateLimitBucket>();

function getRequestIp(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
        return forwarded.split(",")[0].trim();
    }
    return req.ip || "unknown";
}

function getBearerToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;
    if (!authHeader.startsWith("Bearer ")) return null;
    return authHeader.slice("Bearer ".length).trim();
}

async function getOptionalUserId(req: Request): Promise<string | null> {
    const token = getBearerToken(req);
    if (!token) return null;

    try {
        const supabase = createServerSupabase(token);
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) return null;
        return user.id;
    } catch {
        return null;
    }
}

function isRateLimited(identifier: string, maxRequests: number): boolean {
    const now = Date.now();

    if (translateRateLimit.size > 1_000) {
        translateRateLimit.forEach((bucket, key) => {
            if (now - bucket.windowStart >= TRANSLATE_RATE_LIMIT_WINDOW_MS * 2) {
                translateRateLimit.delete(key);
            }
        });
    }

    const current = translateRateLimit.get(identifier);

    if (!current || now - current.windowStart >= TRANSLATE_RATE_LIMIT_WINDOW_MS) {
        translateRateLimit.set(identifier, { windowStart: now, count: 1 });
        return false;
    }

    if (current.count >= maxRequests) {
        return true;
    }

    current.count += 1;
    translateRateLimit.set(identifier, current);
    return false;
}

function parseTranslationsPayload(
    rawContent: string
): { byIndex: string[]; bySource?: Record<string, string> } | null {
    try {
        const parsed = JSON.parse(rawContent) as unknown;

        if (Array.isArray(parsed)) {
            return {
                byIndex: parsed.map((item) => (typeof item === "string" ? item : "")),
            };
        }

        if (parsed && typeof parsed === "object") {
            const record = parsed as Record<string, unknown>;

            if (Array.isArray(record.translations)) {
                return {
                    byIndex: record.translations.map((item) => (typeof item === "string" ? item : "")),
                };
            }

            const bySource = Object.fromEntries(
                Object.entries(record).filter(([, value]) => typeof value === "string")
            ) as Record<string, string>;

            return {
                byIndex: [],
                bySource,
            };
        }
    } catch (error) {
        console.error("Failed to parse translation response:", error);
    }

    return null;
}

function shouldRefreshLegacyAsciiTranslation(
    targetLanguage: "pt" | "es" | "en",
    sourceText: string,
    translatedText: string
): boolean {
    if (targetLanguage !== "pt" && targetLanguage !== "es") {
        return false;
    }

    // Legacy translations were stored mostly in ASCII; refresh them opportunistically.
    if (!ASCII_ONLY_REGEX.test(translatedText)) {
        return false;
    }

    return /[A-Za-z]/.test(sourceText);
}

function shouldRefreshSuspiciousSpanishTranslation(
    targetLanguage: "pt" | "es" | "en",
    translatedText: string
): boolean {
    if (targetLanguage !== "es") {
        return false;
    }

    const normalized = translatedText
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    return SUSPICIOUS_PT_TERMS_FOR_ES.some((term) => normalized.includes(term));
}

function normalizeForComparison(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function isAcronymToken(text: string): boolean {
    const compact = text.trim();
    return /^[A-Z0-9_-]+$/.test(compact) && compact.length <= 6;
}

function isLikelyUntranslatedSource(
    targetLanguage: "pt" | "es" | "en",
    sourceText: string,
    translatedText: string
): boolean {
    if (targetLanguage === "en") {
        return false;
    }

    const source = sourceText.trim();
    const translated = translatedText.trim();
    if (!source || !translated) {
        return false;
    }

    if (!/[A-Za-z]/.test(source)) {
        return false;
    }

    if (isAcronymToken(source)) {
        return false;
    }

    return normalizeForComparison(source) === normalizeForComparison(translated);
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
