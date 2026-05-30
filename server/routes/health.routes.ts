import { Router } from "express";

const router = Router();

// Liveness probe for Coolify / load balancers. Intentionally dependency-free
// (no DB / external calls) so it reflects process health, not upstream health,
// and returns fast for frequent polling.
router.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
