import { Router } from "express";
import { createAdminSupabase } from "../supabase.js";

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

// Readiness probe: verifies the critical upstream (Supabase) is reachable.
// For dashboards/alerts — NOT the container liveness check, since a transient
// DB blip should never trigger a restart loop (that's what /api/health is for).
router.get("/api/health/ready", async (_req, res) => {
  const checks: Record<string, "ok" | "error"> = {};
  try {
    const sb = createAdminSupabase();
    const { error } = await sb.from("profiles").select("id").limit(1);
    checks.database = error ? "error" : "ok";
  } catch {
    checks.database = "error";
  }

  const ready = Object.values(checks).every((v) => v === "ok");
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "degraded",
    checks,
    timestamp: new Date().toISOString(),
  });
});

export default router;
