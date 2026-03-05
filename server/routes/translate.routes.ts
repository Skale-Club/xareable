/**
 * Translate Routes - cached UI/content translation endpoint
 */

import { Router, Request, Response } from "express";
import { createAdminSupabase, createServerSupabase } from "../supabase";
import { translateRequestSchema } from "../../shared/schema";

const router = Router();
const TRANSLATE_RATE_LIMIT_WINDOW_MS = 60_000;
const TRANSLATE_RATE_LIMIT_MAX_REQUESTS_ANON = 20;
const TRANSLATE_RATE_LIMIT_MAX_REQUESTS_AUTH = 60;
const TRANSLATE_MAX_TOTAL_CHARS_ANON = 6_000;
const TRANSLATE_MAX_TOTAL_CHARS_AUTH = 20_000;

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
            if (cachedMap.has(text)) {
                translations[text] = cachedMap.get(text)!;
            } else {
                uncachedTexts.push(text);
            }
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

            const translatePrompt = `You are a professional translator. Translate the following texts from English to ${languageNames[targetLanguage]}. 
Return a JSON object where each key is the original English text and the value is the translation.
Maintain the tone and style of the original text. For UI elements, keep them concise.

Texts to translate:
${JSON.stringify(uncachedTexts)}

Return ONLY valid JSON, no markdown or explanation:`;

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
                    try {
                        const newTranslations = JSON.parse(content);
                        const upsertRows: Array<{
                            source_text: string;
                            source_language: string;
                            target_language: string;
                            translated_text: string;
                        }> = [];

                        for (const source of uncachedTexts) {
                            const translated = (newTranslations as Record<string, unknown>)[source];
                            if (typeof translated === "string") {
                                const cleanTranslated = translated.trim();
                                if (!cleanTranslated) continue;
                                translations[source] = cleanTranslated;
                                upsertRows.push({
                                    source_text: source,
                                    source_language: "en",
                                    target_language: targetLanguage,
                                    translated_text: cleanTranslated,
                                });
                            }
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
                    } catch (e) {
                        console.error("Failed to parse translation response:", e);
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
