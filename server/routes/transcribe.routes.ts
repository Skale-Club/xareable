/**
 * Transcribe Routes - audio transcription via Gemini
 */

import { Router, Request, Response } from "express";
import { checkCredits, deductCredits, recordUsageEvent } from "../quota.js";
import { getStyleCatalogPayload } from "./style-catalog.routes.js";
import { trackMarketingEvent } from "../integrations/marketing.js";
import {
    authenticateUser,
    AuthenticatedRequest,
    usesOwnApiKey,
} from "../middleware/auth.middleware.js";

const router = Router();

/**
 * POST /api/transcribe
 * Transcribes audio data using Gemini model configured in style catalog
 */
router.post("/api/transcribe", async (req: Request, res: Response): Promise<void> => {
    try {
        const authResult = await authenticateUser(req as AuthenticatedRequest);
        if (!authResult.success) {
            res.status(authResult.statusCode).json({ message: authResult.message });
            return;
        }

        const { user, supabase } = authResult;

        const { data: transcribeProfile } = await supabase
            .from("profiles")
            .select("is_admin, is_affiliate, api_key")
            .eq("id", user.id)
            .single();

        const ownApiKey = usesOwnApiKey(transcribeProfile);

        if (ownApiKey && !transcribeProfile?.api_key) {
            res.status(400).json({
                message: "Admin and affiliate accounts must configure their own Gemini API key in Settings before transcribing.",
            });
            return;
        }

        const creditStatus = !ownApiKey
            ? await checkCredits(user.id, "transcribe")
            : null;

        if (creditStatus && !creditStatus.allowed) {
            const denialReason = creditStatus.denial_reason || null;
            const isBudgetReached = denialReason === "usage_budget_reached";
            const isSubscriptionMissing = denialReason === "inactive_subscription";
            res.status(402).json({
                error: isBudgetReached
                    ? "usage_budget_reached"
                    : isSubscriptionMissing
                        ? "subscription_required"
                        : "insufficient_credits",
                message: isBudgetReached
                    ? "Additional usage budget reached. Increase your budget in Billing to continue."
                    : isSubscriptionMissing
                        ? "An active subscription is required to continue."
                        : "Insufficient credits. Add credits to continue.",
                balance_micros: creditStatus.balance_micros,
                estimated_cost_micros: creditStatus.estimated_cost_micros,
                usage_budget_micros: creditStatus.usage_budget_micros ?? null,
                usage_budget_remaining_micros: creditStatus.usage_budget_remaining_micros ?? null,
                additional_usage_this_month_micros: creditStatus.additional_usage_this_month_micros ?? null,
            });
            return;
        }

        let geminiApiKey: string;
        if (ownApiKey) {
            if (!transcribeProfile?.api_key) {
                res.status(400).json({ message: "As affiliate, configure your Gemini API key in Settings." });
                return;
            }
            geminiApiKey = transcribeProfile.api_key;
        } else {
            const serverKey = process.env.GEMINI_API_KEY;
            if (!serverKey) {
                res.status(500).json({ message: "Gemini API key not configured on the server." });
                return;
            }
            geminiApiKey = serverKey;
        }

        const { audioData, mimeType } = req.body;

        if (!audioData) {
            res.status(400).json({ message: "Audio data is required" });
            return;
        }

        const audioMimeType = mimeType || "audio/webm";

        const prompt = `Transcribe the following audio recording. 

Requirements:
1. Provide an accurate transcription of all speech in the audio.
2. Do not include timestamps or speaker labels.
3. If the audio contains multiple sentences or thoughts, present them as a natural paragraph.
4. If the audio is unclear or has background noise, make your best effort to transcribe what is being said.
5. Only output the transcribed text, nothing else.

Output just the transcribed text:`;

        const styleCatalog = await getStyleCatalogPayload();
        const audioModel = styleCatalog.ai_models?.audio_transcription || "gemini-2.5-flash";

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${audioModel}:generateContent?key=${geminiApiKey}`;

        const response = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: audioMimeType,
                                    data: audioData,
                                },
                            },
                        ],
                    },
                ],
                generationConfig: {
                    temperature: 0.1,
                },
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            const errorMsg = errorData?.error?.message || "Failed to transcribe audio";
            console.error("Gemini transcription API error:", errorMsg);
            res.status(500).json({ message: `Transcription Error: ${errorMsg}` });
            return;
        }

        const data = await response.json();
        const transcription = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!transcription) {
            res.status(500).json({ message: "No transcription returned by the AI" });
            return;
        }

        const transcribeUsage = data.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
        const usageEvent = await recordUsageEvent(user.id, null, "transcribe", {
            text_input_tokens: transcribeUsage?.promptTokenCount,
            text_output_tokens: transcribeUsage?.candidatesTokenCount,
        });

        if (!ownApiKey) {
            await deductCredits(
                user.id,
                usageEvent.id,
                usageEvent.cost_usd_micros,
                usageEvent.charged_amount_micros,
            );
        }

        const forwarded = req.headers["x-forwarded-for"];
        const ipAddress = typeof forwarded === "string" && forwarded.trim()
            ? forwarded.split(",")[0].trim()
            : (req.ip || null);

        void trackMarketingEvent({
            event_name: "transcribe",
            event_source: "app",
            user_id: user.id,
            email: user.email || null,
            event_payload: {
                mime_type: audioMimeType,
                text_length: transcription.trim().length,
            },
            event_source_url: req.get("referer") || null,
            ip_address: ipAddress,
            user_agent: req.get("user-agent") || null,
        }).catch((trackingError) => {
            console.error("Marketing tracking failed (transcribe):", trackingError);
        });

        res.json({ text: transcription.trim() });
    } catch (error: any) {
        console.error("Transcribe error:", error);
        res.status(500).json({
            message: error.message || "An unexpected error occurred during transcription",
        });
    }
});

export default router;
