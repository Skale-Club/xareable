import { LANGUAGE_NAMES, LOGO_POSITION_DESCRIPTIONS } from "../../shared/config/defaults.js";
import type { SupportedLanguage, TextStyle } from "../../shared/schema.js";
import { editImage } from "./image-generation.service.js";

export interface ExactTextVerificationResult {
    matches: boolean;
    detectedPromotionalText: string;
    reason: string;
}

function parseJsonResponse<T>(rawText: string): T | null {
    const normalized = rawText.trim();
    if (!normalized) return null;

    const direct = normalized.match(/\{[\s\S]*\}/);
    if (direct) {
        try {
            return JSON.parse(direct[0]) as T;
        } catch {
            return null;
        }
    }

    try {
        return JSON.parse(normalized) as T;
    } catch {
        return null;
    }
}

function buildTextStyleInstruction(textStyles?: TextStyle[]): string {
    if (!textStyles?.length) return "";

    const avoid = Array.from(new Set(textStyles.flatMap((style) => style.prompt_hints.avoid))).filter(Boolean);
    const styleSummary = textStyles.map((style) => `${style.label} (${style.description})`).join(", ");
    const typography = textStyles.map((style) => style.prompt_hints.typography).filter(Boolean).join("; ");
    const layout = textStyles.map((style) => style.prompt_hints.layout).filter(Boolean).join("; ");
    const emphasis = textStyles.map((style) => style.prompt_hints.emphasis).filter(Boolean).join("; ");
    const avoidInstruction = avoid.length > 0
        ? ` Avoid: ${avoid.join(", ")}.`
        : "";

    return `Text styles: ${styleSummary}. Typography: ${typography}. Layout: ${layout}. Emphasis: ${emphasis}.${avoidInstruction}`;
}

export async function verifyExactImageText(params: {
    apiKey: string;
    imageBase64: string;
    imageMimeType: string;
    expectedText: string;
    contentLanguage?: SupportedLanguage;
    model?: string;
}): Promise<ExactTextVerificationResult> {
    const languageLabel = LANGUAGE_NAMES[params.contentLanguage || "en"] || "English";
    const model = params.model || "gemini-2.5-flash";
    const prompt = `Inspect this social media image and evaluate only the promotional on-image text.

Expected exact text:
"${params.expectedText}"

Rules:
- Ignore logos, watermarks, and decorative brand marks.
- Focus only on the promotional text visible to the audience.
- Exact means the wording, numbers, currency symbols, punctuation, and meaning all match.
- Different line breaks are acceptable, but incorrect numbers, currency, words, or extra promo text are not.
- The intended language is ${languageLabel}.
- Return only valid JSON.

JSON format:
{
  "matches": true,
  "detectedPromotionalText": "string",
  "reason": "short explanation"
}`;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${params.apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: params.imageMimeType,
                                data: params.imageBase64,
                            },
                        },
                    ],
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 300,
                    responseMimeType: "application/json",
                },
            }),
        }
    );

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Exact text verification failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const rawText = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    const parsed = parseJsonResponse<Partial<ExactTextVerificationResult>>(rawText);

    if (!parsed) {
        return {
            matches: false,
            detectedPromotionalText: rawText,
            reason: "Could not parse verification response.",
        };
    }

    return {
        matches: parsed.matches === true,
        detectedPromotionalText: String(parsed.detectedPromotionalText || "").trim(),
        reason: String(parsed.reason || "").trim() || "No reason provided.",
    };
}

export async function enforceExactImageText(params: {
    apiKey: string;
    imageBuffer: Buffer;
    imageMimeType: string;
    expectedText: string;
    textStyles?: TextStyle[];
    brandName?: string;
    companyType?: string;
    contentLanguage?: SupportedLanguage;
    logoPosition?: string | null;
    subjectDefinition?: string | null;
    repairContext?: string | null;
    imageModel?: string;
    verificationModel?: string;
    logoImageData?: { mimeType: string; data: string } | null;
    maxRepairPasses?: number;
}): Promise<{
    buffer: Buffer;
    mimeType: string;
    verified: boolean;
    repaired: boolean;
    attempts: number;
    verification: ExactTextVerificationResult;
}> {
    const maxRepairPasses = Math.max(0, Math.min(params.maxRepairPasses ?? 2, 2));
    const expectedText = params.expectedText.trim();
    let currentBuffer = params.imageBuffer;
    let currentMimeType = params.imageMimeType;
    let repaired = false;
    let lastVerification: ExactTextVerificationResult = {
        matches: false,
        detectedPromotionalText: "",
        reason: "Verification not executed.",
    };

    if (!expectedText) {
        return {
            buffer: currentBuffer,
            mimeType: currentMimeType,
            verified: true,
            repaired: false,
            attempts: 0,
            verification: {
                matches: true,
                detectedPromotionalText: "",
                reason: "No exact text was requested.",
            },
        };
    }

    for (let pass = 0; pass <= maxRepairPasses; pass += 1) {
        lastVerification = await verifyExactImageText({
            apiKey: params.apiKey,
            imageBase64: currentBuffer.toString("base64"),
            imageMimeType: currentMimeType,
            expectedText,
            contentLanguage: params.contentLanguage,
            model: params.verificationModel,
        });

        if (lastVerification.matches) {
            return {
                buffer: currentBuffer,
                mimeType: currentMimeType,
                verified: true,
                repaired,
                attempts: pass,
                verification: lastVerification,
            };
        }

        if (pass === maxRepairPasses) {
            break;
        }

        const styleInstruction = buildTextStyleInstruction(params.textStyles);
        const repairPrompt = `Repair only the promotional text in this existing social media image.

Primary goal:
- Preserve the current subject, product, food, scene, composition, lighting, and colors.
- Do not replace the main subject with a different product, dish, or concept.
- Keep the brand look consistent for ${params.brandName || "the brand"}${params.companyType ? ` in ${params.companyType}` : ""}.

Exact text requirement:
- Remove or replace any incorrect promotional text.
- Render EXACTLY this promotional text: "${expectedText}"
- Preserve numbers, punctuation, currency symbols, and wording.
- Different line breaks are allowed only if readability improves.

Context:
- Subject anchor: ${params.subjectDefinition || "Keep the current visible subject unchanged."}
- Previous detected promotional text: ${lastVerification.detectedPromotionalText || "none"}
- Verification reason: ${lastVerification.reason || "none"}
${params.repairContext ? `- Additional creative context: ${params.repairContext}` : ""}
${styleInstruction ? `- ${styleInstruction}` : ""}
${params.logoPosition ? `- Keep the ${LOGO_POSITION_DESCRIPTIONS[params.logoPosition] || params.logoPosition} visually compatible with the logo placement.` : ""}

Hard constraints:
- Do not invent extra offer text.
- Do not alter the numeric value or currency formatting.
- Do not change the main food/product identity.
- Return the edited image only.`;

        const repairedImage = await editImage({
            prompt: repairPrompt,
            currentImageBase64: currentBuffer.toString("base64"),
            currentImageMimeType: currentMimeType,
            apiKey: params.apiKey,
            logoImageData: params.logoImageData,
            model: params.imageModel,
        });

        currentBuffer = repairedImage.buffer;
        currentMimeType = repairedImage.mimeType || currentMimeType;
        repaired = true;
    }

    return {
        buffer: currentBuffer,
        mimeType: currentMimeType,
        verified: false,
        repaired,
        attempts: maxRepairPasses,
        verification: lastVerification,
    };
}
