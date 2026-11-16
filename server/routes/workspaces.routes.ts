import { Router } from "express";
import { createWorkspaceSchema } from "../../shared/schema.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { createWorkspaceSlug } from "../services/workspaces.service.js";

const router = Router();

function isMissingWorkspaceSchema(error: any): boolean {
  return error?.code === "42P01" || /workspace_(members|id)|workspaces/i.test(String(error?.message || ""));
}

/**
 * GET /api/workspaces
 *
 * Lists only workspaces the authenticated member can access. The client never
 * supplies a user or workspace id, so tenant scope comes entirely from RLS.
 */
router.get("/api/workspaces", requireAuth as any, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const { data, error } = await authReq.supabase
    .from("workspace_members")
    .select("role, workspace:workspaces(id, name, slug, kind, language, timezone, is_skale_club)")
    .order("created_at", { ascending: true });

  if (error) {
    // Safe for the staggered deploy: the UI can ship before the migration,
    // but it must never pretend that a missing schema means no access.
    if (isMissingWorkspaceSchema(error)) {
      return res.json({ workspaces: [], schemaReady: false });
    }
    return res.status(500).json({ message: "Failed to load workspaces." });
  }

  const workspaces = (data || [])
    .map((membership: any) => membership.workspace ? { ...membership.workspace, role: membership.role } : null)
    .filter(Boolean);
  return res.json({ workspaces, schemaReady: true });
});

/**
 * POST /api/workspaces
 *
 * A signed-in user may create a workspace only for themselves. The migration's
 * security-definer trigger adds the creator as owner atomically.
 */
router.post("/api/workspaces", requireAuth as any, async (req, res) => {
  const authReq = req as AuthenticatedRequest;
  const parsed = createWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((issue) => issue.message).join(", ") });
  }

  const slug = createWorkspaceSlug(parsed.data.slug || parsed.data.name);
  if (!slug) return res.status(400).json({ message: "Choose a name containing letters or numbers." });

  const { data, error } = await authReq.supabase
    .from("workspaces")
    .insert({ name: parsed.data.name, slug, kind: "company", created_by: authReq.user.id })
    .select("id, name, slug, kind, language, timezone, is_skale_club")
    .single();

  if (error) {
    if (isMissingWorkspaceSchema(error)) {
      return res.status(503).json({ message: "Workspace setup is not available until the platform migration is applied." });
    }
    if (error.code === "23505") return res.status(409).json({ message: "That workspace URL is already in use." });
    return res.status(500).json({ message: "Failed to create workspace." });
  }

  return res.status(201).json({ workspace: { ...data, role: "owner" } });
});

export default router;
