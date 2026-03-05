/**
 * Stripe Routes - webhook endpoint
 */

import { Router, Request, Response } from "express";
import { stripe, handleStripeWebhook } from "../stripe.js";

const router = Router();

/**
 * POST /api/stripe/webhook
 * Verifies Stripe signature and dispatches webhook event
 */
router.post("/api/stripe/webhook", async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error("STRIPE_WEBHOOK_SECRET not configured");
        res.status(500).json({ message: "Webhook secret not configured" });
        return;
    }

    let event;
    try {
        event = stripe.webhooks.constructEvent(
            (req as any).rawBody,
            sig,
            webhookSecret,
        );
    } catch (err: any) {
        console.error("Webhook signature verification failed:", err.message);
        res.status(400).json({ message: `Webhook Error: ${err.message}` });
        return;
    }

    try {
        await handleStripeWebhook(event);
    } catch (err: any) {
        console.error("Webhook handler error:", err);
        res.status(500).json({ message: "Webhook processing failed" });
        return;
    }

    res.json({ received: true });
});

export default router;
