/**
 * Credits Routes - pay-per-use credits and auto-recharge endpoints
 */

import { Router, Request, Response } from "express";
import { createAdminSupabase } from "../supabase.js";
import {
    purchaseCreditsRequestSchema,
    updateAutoRechargeRequestSchema,
} from "../../shared/schema.js";
import {
    checkCredits,
    getCreditsState,
    getMinimumRechargeMicros,
} from "../quota.js";
import { createCreditCheckoutSession } from "../stripe.js";
import { getBillingModel } from "../stripe.js";
import {
    authenticateUser,
    AuthenticatedRequest,
} from "../middleware/auth.middleware.js";

const router = Router();

/**
 * GET /api/credits
 * Returns user credit balance and estimated operation status
 */
router.get("/api/credits", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user } = authResult;

    try {
        const data = await getCreditsState(user.id, "generate");
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ message: error.message || "Failed to load credits" });
    }
});

/**
 * GET /api/credits/transactions
 * Returns the last 50 credit ledger transactions for the user
 */
router.get("/api/credits/transactions", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user } = authResult;
    const sb = createAdminSupabase();
    const { data, error } = await sb
        .from("credit_transactions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

    if (error) {
        res.status(500).json({ message: error.message });
        return;
    }

    res.json({ transactions: data || [] });
});

/**
 * GET /api/credits/check
 * Checks if user can afford a given operation type
 */
router.get("/api/credits/check", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user } = authResult;
    const operation = typeof req.query.operation === "string" ? req.query.operation : "generate";
    const normalizedOperation =
        operation === "edit" || operation === "transcribe" ? operation : "generate";

    try {
        const status = await checkCredits(user.id, normalizedOperation);
        res.json(status);
    } catch (error: any) {
        res.status(500).json({ message: error.message || "Failed to check credits" });
    }
});

/**
 * POST /api/credits/purchase
 * Creates Stripe checkout session for credit top-up
 */
router.post("/api/credits/purchase", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user } = authResult;
    const parseResult = purchaseCreditsRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid amountMicros" });
        return;
    }

    const minRechargeMicros = await getMinimumRechargeMicros();
    if (parseResult.data.amountMicros < minRechargeMicros) {
        res.status(400).json({
            error: "below_minimum_purchase",
            message: `Minimum recharge is ${minRechargeMicros}`,
        });
        return;
    }

    try {
        const url = await createCreditCheckoutSession(
            user.id,
            user.email || "",
            parseResult.data.amountMicros,
        );
        res.json({ url });
    } catch (error: any) {
        res.status(500).json({ message: error.message || "Failed to create checkout session" });
    }
});

/**
 * PATCH /api/credits/auto-recharge
 * Updates user auto-recharge settings
 */
router.patch("/api/credits/auto-recharge", async (req: Request, res: Response): Promise<void> => {
    const authResult = await authenticateUser(req as AuthenticatedRequest);
    if (!authResult.success) {
        res.status(authResult.statusCode).json({ message: authResult.message });
        return;
    }

    const { user } = authResult;
    if ((await getBillingModel()) === "subscription_overage") {
        res.status(400).json({ message: "Auto-recharge is disabled in subscription billing mode" });
        return;
    }
    const parseResult = updateAutoRechargeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ message: "Invalid auto-recharge settings" });
        return;
    }

    const sb = createAdminSupabase();
    const { enabled, thresholdMicros, amountMicros } = parseResult.data;

    const { error } = await sb
        .from("user_credits")
        .update({
            auto_recharge_enabled: enabled,
            auto_recharge_threshold_micros: thresholdMicros,
            auto_recharge_amount_micros: amountMicros,
        })
        .eq("user_id", user.id);

    if (error) {
        res.status(500).json({ message: error.message });
        return;
    }

    const data = await getCreditsState(user.id, "generate");
    res.json(data);
});

export default router;
