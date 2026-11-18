/**
 * Platform copy routes: write a separate text per social platform for a post.
 *
 * Billing: reuses the existing text-only "transcribe" usage event type, tagged
 * metadata.operation = "platform_copy". usage_events.event_type has a CHECK
 * constraint, so a dedicated type needs a migration; see the journal entry for
 * this feature (decision: reuse now, add a real type when the dev database
 * exists and a migration can be tested).
 */

import { Router, Request, Response } from "express";
import { platformCopyRequestSchema } from "../../shared/schema.js";
import { checkCredits, deductCredits, recordUsageEvent } from "../quota.js";
import { getStyleCatalogPayload } from "./style-catalog.routes.js";
import {
    authenticateUser,
    AuthenticatedRequest,
    usesOwnApiKey,
    getGeminiApiKey,
    getOpenRouterApiKey,
} from "../middleware/auth.middleware.js";
import { aiRateLimit, DEFAULT_AI_LIMITS } from "../middleware/rate-limit.middleware.js";
import { createPlatformCopyModelCall, generatePlatformCopy } from "../services/platform-copy.service.js";

const router = Router();

// Same budget as the other cheap text-only AI endpoint (/api/transcribe), own counter.
const platformCopyLimiter = aiRateLimit(DEFAULT_AI_LIMITS.transcribe);

router.post("/api/social/platform-copy", async (req: Request, res: Response): Promise<void> => {
    try {
        const authResult = await authenticateUser(req as AuthenticatedRequest);
        if (!authResult.success) {
            res.status(authResult.statusCode).json({ message: authResult.message });
            return;
        }
        const { user, supabase } = authResult;

        const parsed = platformCopyRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
            return;
        }
        const { post_id, platforms, language } = parsed.data;

        const { data: profile } = await supabase
            .from("profiles")
            .select("is_admin, is_affiliate, api_key, openrouter_api_key")
            .eq("id", user.id)
            .single();

        // Rate limit gate. The limiter reads the user and profile off the request.
        (req as any).user = user;
        (req as any).profile = profile;
        await new Promise<void>((resolve) => {
            platformCopyLimiter(req as any, res as any, () => resolve());
        });
        if (res.headersSent) return;

        // The user's own, non-trashed post only (RLS-scoped client plus explicit owner filter).
        const { data: post } = await supabase
            .from("posts")
            .select("id, caption, ai_prompt_used")
            .eq("id", post_id)
            .eq("user_id", user.id)
            .is("trashed_at", null)
            .maybeSingle();
        if (!post) {
            res.status(404).json({ message: "Post not found" });
            return;
        }

        const { data: brand } = await supabase
            .from("brands")
            .select("company_name, company_type")
            .eq("user_id", user.id)
            .maybeSingle();
        if (!brand) {
            res.status(400).json({ message: "No brand profile found" });
            return;
        }

        const ownApiKey = usesOwnApiKey(profile);
        let geminiApiKey = "";
        let openRouterApiKey = "";
        if (ownApiKey) {
            const { key, error } = await getOpenRouterApiKey(profile);
            if (error) {
                res.status(400).json({ message: error });
                return;
            }
            openRouterApiKey = key;
        } else {
            const { key, error } = await getGeminiApiKey(profile);
            if (error) {
                res.status(500).json({ message: error });
                return;
            }
            geminiApiKey = key;
        }

        const creditStatus = !ownApiKey ? await checkCredits(user.id, "transcribe") : null;
        if (creditStatus && !creditStatus.allowed) {
            const denialReason = creditStatus.denial_reason || null;
            const isBudgetReached = denialReason === "usage_budget_reached";
            const isSubscriptionMissing = denialReason === "inactive_subscription";
            res.status(402).json({
                error: isBudgetReached ? "usage_budget_reached" : isSubscriptionMissing ? "subscription_required" : "insufficient_credits",
                message: isBudgetReached
                    ? "Additional usage budget reached. Increase your budget in Billing to continue."
                    : isSubscriptionMissing
                        ? "An active subscription is required to continue."
                        : "Insufficient credits. Add credits to continue.",
                balance_micros: creditStatus.balance_micros,
                estimated_cost_micros: creditStatus.estimated_cost_micros,
            });
            return;
        }

        const styleCatalog = await getStyleCatalogPayload();
        const model = styleCatalog.ai_models?.text_generation || "gemini-2.5-flash";

        let output;
        try {
            output = await generatePlatformCopy({
                platforms,
                context: {
                    brandName: brand.company_name,
                    companyType: brand.company_type,
                    language,
                    caption: post.caption,
                    creativeIntent: post.ai_prompt_used,
                },
                callModel: createPlatformCopyModelCall({ geminiApiKey, openRouterApiKey, model }),
            });
        } catch (error: any) {
            console.error("[platform-copy] generation failed:", error?.message || error);
            res.status(502).json({ message: "Could not write the platform texts right now. Please try again." });
            return;
        }

        const hasTokens = output.usage.promptTokenCount + output.usage.candidatesTokenCount > 0;
        const usageEvent = await recordUsageEvent(
            user.id,
            post.id,
            "transcribe",
            hasTokens
                ? {
                      text_input_tokens: output.usage.promptTokenCount,
                      text_output_tokens: output.usage.candidatesTokenCount,
                  }
                : undefined,
            { text_model: output.model ?? model },
            output.costUsdMicros,
            creditStatus?.estimated_cost_micros,
            { operation: "platform_copy", platforms, model_calls: output.modelCalls },
        );
        if (!ownApiKey) {
            await deductCredits(user.id, usageEvent.id, usageEvent.cost_usd_micros, usageEvent.charged_amount_micros);
        }

        res.json({ copies: output.copies, repaired: output.repaired });
    } catch (error: any) {
        console.error("[platform-copy] unexpected error:", error?.message || error);
        res.status(500).json({ message: "An unexpected error occurred while writing the platform texts" });
    }
});

export default router;
