import { LANGUAGE_NAMES } from "../../shared/config/defaults.js";
import type { SupportedLanguage } from "../../shared/schema.js";

const SUPPORTED_CONTENT_LANGUAGES = new Set(["en", "pt", "es"] as const);

export function normalizeContentLanguage(input: unknown): SupportedLanguage {
    return typeof input === "string" && SUPPORTED_CONTENT_LANGUAGES.has(input as SupportedLanguage)
        ? (input as SupportedLanguage)
        : "en";
}

export function cleanCaptionText(text: string): string {
    if (!text) return "";
    return text
        .replace(/^```(?:text|markdown)?\s*/i, "")
        .replace(/```$/i, "")
        .replace(/^caption:\s*/i, "")
        .trim();
}

export function looksTruncatedCaption(text: string): boolean {
    if (!text) return true;
    const normalized = text.trim();
    if (normalized.length < 40) return true;
    if (/[,:;\-\/]\s*$/.test(normalized)) return true;
    if (/\b(como|com|and|or|with|de|do|da|dos|das|e|y|con|para|por)\s*$/i.test(normalized)) return true;
    if (/#\w[\w-]*\s*$/.test(normalized)) return false;
    if (!/[.!?…]$/.test(normalized)) return true;
    return false;
}

export function hasHashtags(text: string): boolean {
    return /(^|\s)#\w[\w-]*/.test(text);
}

export function isAcceptableCaption(text: string): boolean {
    const normalized = cleanCaptionText(text);
    if (normalized.length < 80) return false;
    if (looksTruncatedCaption(normalized)) return false;
    if (!hasHashtags(normalized)) return false;
    return true;
}

export function buildCaptionFallback(params: {
    brandName: string;
    companyType: string;
    contentLanguage: SupportedLanguage;
}): string {
    const brandTag = String(params.brandName || "Brand").replace(/\s+/g, "");
    if (params.contentLanguage === "pt") {
        return `Na ${params.brandName}, transformamos estrategia em resultado real para ${params.companyType}. Conteudo com clareza, consistencia e foco em conversao.\n\nPronto para elevar sua presenca digital com mais impacto e previsibilidade?\n\n#${brandTag} #marketingdigital #crescimento #marca`;
    }
    if (params.contentLanguage === "es") {
        return `En ${params.brandName}, convertimos estrategia en resultados reales para ${params.companyType}. Contenido con claridad, consistencia y foco en conversion.\n\nListo para elevar tu presencia digital con mas impacto y previsibilidad?\n\n#${brandTag} #marketingdigital #crecimiento #marca`;
    }
    return `At ${params.brandName}, we turn strategy into measurable results for ${params.companyType}. Content with clarity, consistency, and conversion focus.\n\nReady to elevate your digital presence with stronger impact and predictable growth?\n\n#${brandTag} #marketing #growth #brand`;
}

async function callGeminiForCaption(params: {
    apiKey: string;
    model: string;
    prompt: string;
}): Promise<string | null> {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${params.apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: params.prompt }] }],
                generationConfig: {
                    temperature: 0.6,
                    maxOutputTokens: 768,
                },
            }),
        }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
        return null;
    }

    const text = parts
        .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
        .join("\n");

    const caption = cleanCaptionText(text);
    return caption || null;
}

export async function ensureCaptionQuality(params: {
    apiKey: string;
    brandName: string;
    companyType: string;
    contentLanguage: SupportedLanguage;
    promptContext?: string | null;
    candidateCaption?: string | null;
    scenarioType?: string | null;
    subjectDefinition?: string | null;
    offerText?: string | null;
    model?: string;
    mode: "create" | "edit" | "remake";
    forceRewrite?: boolean;
}): Promise<string> {
    const candidate = cleanCaptionText(params.candidateCaption || "");
    if (candidate && isAcceptableCaption(candidate) && !params.forceRewrite) {
        return candidate;
    }

    const model = params.model || "gemini-2.5-flash";
    const languageLabel = LANGUAGE_NAMES[params.contentLanguage] || "English";
    const operationLabel =
        params.mode === "edit"
            ? "edited"
            : params.mode === "remake"
                ? "regenerated"
                : "generated";
    const scenarioSummary = `${params.scenarioType || ""} ${params.subjectDefinition || ""} ${params.offerText || ""} ${params.promptContext || ""}`.toLowerCase();
    const isPhysicalOfferScenario = /(food|meal|dish|plate|restaurant|menu|product|packaging|bottle|offer|price|promo|sale|burger|pizza|prato|comida|almoco|lunch|dinner)/.test(scenarioSummary);
    const scenarioRule = isPhysicalOfferScenario
        ? `- Anchor the caption in the actual visible subject and offer. Write about the meal, product, scene, or promotion first, while keeping the brand voice.\n- Do not fall back to generic company-service copy if the creative context is clearly about a physical subject or menu/product offer.`
        : "- Keep the caption anchored in the creative context instead of generic filler language.";
    const offerRule = params.offerText?.trim()
        ? `- If it fits naturally, mention this exact visible offer or CTA without changing the wording: ${params.offerText.trim()}`
        : "";
    const subjectRule = params.subjectDefinition?.trim()
        ? `Primary subject: ${params.subjectDefinition.trim()}`
        : "Primary subject: not specified";

    const basePrompt = `${params.forceRewrite ? "Rewrite" : "Write"} a social media caption for a ${operationLabel} post.
Brand: ${params.brandName}
Industry: ${params.companyType}
Scenario type: ${params.scenarioType || "not specified"}
${subjectRule}
Creative context: ${params.promptContext || "none"}
Current caption candidate: ${candidate || "none"}
Target language: ${languageLabel}

Rules:
- 2 short paragraphs + hashtags
- Natural marketing tone
- The text must be fully in ${languageLabel}
- Keep the caption semantically aligned with the actual generated visual
${scenarioRule}
${offerRule}
- Return complete sentences only
- End with a final hashtag block
- Include at least 3 hashtags
- Do not output JSON
- Return only the caption text`;

    try {
        const firstPass = await callGeminiForCaption({
            apiKey: params.apiKey,
            model,
            prompt: basePrompt,
        });
        if (firstPass && isAcceptableCaption(firstPass)) {
            return firstPass;
        }

        const retryPrompt = `${basePrompt}

Important retry instruction:
- Your previous output was incomplete or too short.
- Return a complete caption that ends with proper punctuation.
- Keep 2 short paragraphs plus a final hashtag block in ${languageLabel}.
- Preserve the core creative intent.`;
        const secondPass = await callGeminiForCaption({
            apiKey: params.apiKey,
            model,
            prompt: retryPrompt,
        });
        if (secondPass && isAcceptableCaption(secondPass)) {
            return secondPass;
        }

        const repairSource = secondPass || firstPass || candidate;
        if (repairSource) {
            const repairPrompt = `Fix and complete this social media caption in ${languageLabel}.

Broken caption:
${repairSource}

Rules:
- Keep the same meaning and tone.
- Return a complete caption with no truncation.
- 2 short paragraphs + a final hashtag block.
- At least 3 hashtags.
- Return only the final caption text.`;
            const repaired = await callGeminiForCaption({
                apiKey: params.apiKey,
                model,
                prompt: repairPrompt,
            });
            if (repaired && isAcceptableCaption(repaired)) {
                return repaired;
            }
        }
    } catch {
        // Fall back below.
    }

    return buildCaptionFallback({
        brandName: params.brandName,
        companyType: params.companyType,
        contentLanguage: params.contentLanguage,
    });
}
