import { Router, type Response } from "express";
import { z } from "zod";
import {
  createWorkspaceSchema,
  inviteWorkspaceMemberSchema,
  updateWorkspaceMemberRoleSchema,
  type WorkspaceRole,
} from "../../shared/schema.js";
import {
  canAssignRole,
  canCreateCompany,
  canManageMembers,
  isWorkspaceRole,
  wouldRemoveLastOwner,
} from "../../shared/workspace-permissions.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { createAdminSupabase } from "../supabase.js";
import { createWorkspaceSlug } from "../services/workspaces.service.js";
import {
  acceptPendingInvites,
  findUserIdByEmail,
  getWorkspaceActor,
  isMissingWorkspaceSchema,
  isPlatformAdmin,
  recordPlatformAudit,
} from "../services/workspace-access.service.js";

const router = Router();
const uuidSchema = z.string().uuid();

const WORKSPACE_COLUMNS = "id, name, slug, kind, language, timezone, is_skale_club";

const schemaUnavailable = (res: Response) =>
  res.status(503).json({ message: "Workspace setup is not available until the platform migration is applied." });

/**
 * GET /api/workspaces
 *
 * Lists only workspaces the authenticated member belongs to. The client never
 * supplies a user or workspace id, so tenant scope comes entirely from RLS.
 * Also tells the UI whether this person is Skale Club platform staff.
 */
router.get("/api/workspaces", requireAuth as any, async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const { data, error } = await authReq.supabase
    .from("workspace_members")
    .select(`role, workspace:workspaces(${WORKSPACE_COLUMNS})`)
    .order("created_at", { ascending: true });

  if (error) {
    // Safe for the staggered deploy: the UI can ship before the migration,
    // but it must never pretend that a missing schema means no access.
    if (isMissingWorkspaceSchema(error)) {
      return res.json({ workspaces: [], schemaReady: false, isPlatformAdmin: false, canCreateCompany: false });
    }
    return res.status(500).json({ message: "Failed to load workspaces." });
  }

  const workspaces = (data || [])
    .map((membership: any) => membership.workspace ? { ...membership.workspace, role: membership.role } : null)
    .filter(Boolean);
  const platformAdmin = await isPlatformAdmin(authReq.user.id);
  return res.json({
    workspaces,
    schemaReady: true,
    isPlatformAdmin: platformAdmin,
    canCreateCompany: canCreateCompany({ isPlatformAdmin: platformAdmin }),
  });
});

/**
 * POST /api/workspaces
 *
 * Only Skale Club platform staff create company workspaces. The optional owner is
 * added immediately when they already have an account, or invited otherwise.
 */
router.post("/api/workspaces", requireAuth as any, async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  if (!canCreateCompany({ isPlatformAdmin: await isPlatformAdmin(authReq.user.id) })) {
    return res.status(403).json({ message: "Only Skale Club platform staff can create company workspaces." });
  }

  const parsed = createWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((issue) => issue.message).join(", ") });
  }

  const slug = createWorkspaceSlug(parsed.data.slug || parsed.data.name);
  if (!slug) return res.status(400).json({ message: "Choose a name containing letters or numbers." });

  const admin = createAdminSupabase();
  const { data: workspace, error } = await admin
    .from("workspaces")
    .insert({
      name: parsed.data.name,
      slug,
      kind: "company",
      language: parsed.data.language ?? "en",
      timezone: parsed.data.timezone ?? "America/New_York",
      created_by: authReq.user.id,
    })
    .select(WORKSPACE_COLUMNS)
    .single();

  if (error) {
    if (isMissingWorkspaceSchema(error)) return schemaUnavailable(res);
    if (error.code === "23505") return res.status(409).json({ message: "That workspace URL is already in use." });
    return res.status(500).json({ message: "Failed to create workspace." });
  }

  let ownerStatus: "none" | Awaited<ReturnType<typeof addOrInviteMember>> = "none";
  if (parsed.data.owner_email) {
    ownerStatus = await addOrInviteMember(admin, workspace.id, parsed.data.owner_email, "owner", authReq.user.id);
  }

  await recordPlatformAudit(authReq.user.id, "workspace.create", workspace.id, {
    slug,
    owner_email: parsed.data.owner_email ?? null,
    owner_status: ownerStatus,
  });
  return res.status(201).json({ workspace, ownerStatus });
});

/**
 * GET /api/admin/workspaces
 *
 * Platform view: every company, its member count and owners. Platform staff only,
 * and it reads through the service role, so tenant RLS is not weakened for it.
 */
router.get("/api/admin/workspaces", requireAuth as any, async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  if (!(await isPlatformAdmin(authReq.user.id))) {
    return res.status(403).json({ message: "Platform access required." });
  }

  const admin = createAdminSupabase();
  const [workspaces, members] = await Promise.all([
    admin.from("workspaces").select(`${WORKSPACE_COLUMNS}, created_at`).order("created_at", { ascending: true }),
    admin.from("workspace_members").select("workspace_id, user_id, role"),
  ]);
  const failure = workspaces.error || members.error;
  if (failure) {
    if (isMissingWorkspaceSchema(failure)) return res.json({ workspaces: [], schemaReady: false });
    return res.status(500).json({ message: "Failed to load workspaces." });
  }

  const ownerIds = Array.from(new Set((members.data || []).filter((member) => member.role === "owner").map((member) => member.user_id)));
  const { data: profiles } = ownerIds.length
    ? await admin.from("profiles").select("id, email").in("id", ownerIds)
    : { data: [] as { id: string; email: string | null }[] };
  const emailById = new Map((profiles || []).map((profile) => [profile.id, profile.email]));

  // Personal workspaces are one-person spaces created by the system; the platform
  // view is about companies.
  const companies = (workspaces.data || [])
    .filter((workspace) => workspace.kind === "company")
    .map((workspace) => {
      const rows = (members.data || []).filter((member) => member.workspace_id === workspace.id);
      return {
        ...workspace,
        member_count: rows.length,
        owners: rows.filter((member) => member.role === "owner").map((member) => emailById.get(member.user_id) || member.user_id),
      };
    });
  return res.json({ workspaces: companies, schemaReady: true });
});

/**
 * POST /api/workspaces/accept-invites
 *
 * Called after sign-in: attaches the caller to every open invite for their
 * confirmed email.
 */
router.post("/api/workspaces/accept-invites", requireAuth as any, async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const accepted = await acceptPendingInvites(authReq.user);
  return res.json({ accepted });
});

/** Loads the caller's authority over a workspace, or sends the right error. */
async function requireMemberManager(req: AuthenticatedRequest, res: Response, workspaceId: unknown) {
  const idCheck = uuidSchema.safeParse(workspaceId);
  if (!idCheck.success) {
    res.status(400).json({ message: "Invalid workspace." });
    return null;
  }
  const admin = createAdminSupabase();
  const { data: workspace, error } = await admin
    .from("workspaces")
    .select("id, kind")
    .eq("id", idCheck.data)
    .maybeSingle();
  if (error) {
    if (isMissingWorkspaceSchema(error)) schemaUnavailable(res);
    else res.status(500).json({ message: "Failed to load workspace." });
    return null;
  }

  const actor = await getWorkspaceActor(req.user.id, idCheck.data);
  // Do not reveal whether a workspace exists to people who cannot see it.
  if (!workspace || (!actor.role && !actor.isPlatformAdmin)) {
    res.status(404).json({ message: "Workspace not found." });
    return null;
  }
  if (!canManageMembers(actor)) {
    res.status(403).json({ message: "Only workspace owners can manage members." });
    return null;
  }
  if (workspace.kind === "personal") {
    res.status(400).json({ message: "A personal workspace has a single member." });
    return null;
  }
  return { workspaceId: idCheck.data, actor, admin };
}

/** GET /api/workspaces/:id/members — members and open invites (owners and platform staff). */
router.get("/api/workspaces/:id/members", requireAuth as any, async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const access = await requireMemberManager(authReq, res, req.params.id);
  if (!access) return;

  const [members, invites] = await Promise.all([
    access.admin.from("workspace_members").select("user_id, role, created_at").eq("workspace_id", access.workspaceId).order("created_at", { ascending: true }),
    access.admin
      .from("workspace_invites")
      .select("id, email, role, created_at, expires_at")
      .eq("workspace_id", access.workspaceId)
      .is("accepted_at", null)
      .order("created_at", { ascending: true }),
  ]);
  if (members.error || invites.error) return res.status(500).json({ message: "Failed to load members." });

  const ids = (members.data || []).map((member) => member.user_id);
  const { data: profiles } = ids.length
    ? await access.admin.from("profiles").select("id, email").in("id", ids)
    : { data: [] as { id: string; email: string | null }[] };
  const emailById = new Map((profiles || []).map((profile) => [profile.id, profile.email]));

  return res.json({
    members: (members.data || []).map((member) => ({ ...member, email: emailById.get(member.user_id) ?? null })),
    invites: invites.data || [],
  });
});

/** POST /api/workspaces/:id/invites — add an existing user, or invite a new email. */
router.post("/api/workspaces/:id/invites", requireAuth as any, async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const access = await requireMemberManager(authReq, res, req.params.id);
  if (!access) return;

  const parsed = inviteWorkspaceMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors.map((issue) => issue.message).join(", ") });
  }
  if (!canAssignRole(access.actor, parsed.data.role)) {
    return res.status(403).json({ message: "You cannot assign that role." });
  }

  const status = await addOrInviteMember(access.admin, access.workspaceId, parsed.data.email, parsed.data.role, authReq.user.id);
  if (status === "exists") return res.status(409).json({ message: "That person is already a member of this workspace." });
  if (status === "failed") return res.status(500).json({ message: "Could not add that member." });

  if (access.actor.isPlatformAdmin && !access.actor.role) {
    await recordPlatformAudit(authReq.user.id, "workspace.member.add", access.workspaceId, { email: parsed.data.email, role: parsed.data.role, status });
  }
  return res.status(201).json({ status });
});

/** DELETE /api/workspaces/:id/invites/:inviteId — cancel an open invite. */
router.delete("/api/workspaces/:id/invites/:inviteId", requireAuth as any, async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const access = await requireMemberManager(authReq, res, req.params.id);
  if (!access) return;
  const inviteId = uuidSchema.safeParse(req.params.inviteId);
  if (!inviteId.success) return res.status(400).json({ message: "Invalid invite." });

  const { error } = await access.admin
    .from("workspace_invites")
    .delete()
    .eq("id", inviteId.data)
    .eq("workspace_id", access.workspaceId);
  if (error) return res.status(500).json({ message: "Could not cancel the invite." });
  return res.json({ ok: true });
});

/** PATCH /api/workspaces/:id/members/:userId — change a member's role. */
router.patch("/api/workspaces/:id/members/:userId", requireAuth as any, async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const access = await requireMemberManager(authReq, res, req.params.id);
  if (!access) return;
  const userId = uuidSchema.safeParse(req.params.userId);
  const parsed = updateWorkspaceMemberRoleSchema.safeParse(req.body);
  if (!userId.success || !parsed.success) return res.status(400).json({ message: "Invalid request." });
  if (!canAssignRole(access.actor, parsed.data.role)) return res.status(403).json({ message: "You cannot assign that role." });

  const { data: rows, error } = await access.admin
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", access.workspaceId);
  if (error) return res.status(500).json({ message: "Failed to load members." });
  const members = (rows || []).filter((row): row is { user_id: string; role: WorkspaceRole } => isWorkspaceRole(row.role));
  if (!members.some((member) => member.user_id === userId.data)) return res.status(404).json({ message: "Member not found." });
  if (wouldRemoveLastOwner(members, userId.data, parsed.data.role)) {
    return res.status(409).json({ message: "A workspace must keep at least one owner." });
  }

  const { error: updateError } = await access.admin
    .from("workspace_members")
    .update({ role: parsed.data.role })
    .eq("workspace_id", access.workspaceId)
    .eq("user_id", userId.data);
  if (updateError) return res.status(500).json({ message: "Could not change that role." });

  if (access.actor.isPlatformAdmin && !access.actor.role) {
    await recordPlatformAudit(authReq.user.id, "workspace.member.role", access.workspaceId, { user_id: userId.data, role: parsed.data.role });
  }
  return res.json({ ok: true });
});

/** DELETE /api/workspaces/:id/members/:userId — remove a member. */
router.delete("/api/workspaces/:id/members/:userId", requireAuth as any, async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const access = await requireMemberManager(authReq, res, req.params.id);
  if (!access) return;
  const userId = uuidSchema.safeParse(req.params.userId);
  if (!userId.success) return res.status(400).json({ message: "Invalid request." });

  const { data: rows, error } = await access.admin
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", access.workspaceId);
  if (error) return res.status(500).json({ message: "Failed to load members." });
  const members = (rows || []).filter((row): row is { user_id: string; role: WorkspaceRole } => isWorkspaceRole(row.role));
  if (!members.some((member) => member.user_id === userId.data)) return res.status(404).json({ message: "Member not found." });
  if (wouldRemoveLastOwner(members, userId.data, null)) {
    return res.status(409).json({ message: "A workspace must keep at least one owner." });
  }

  const { error: deleteError } = await access.admin
    .from("workspace_members")
    .delete()
    .eq("workspace_id", access.workspaceId)
    .eq("user_id", userId.data);
  if (deleteError) return res.status(500).json({ message: "Could not remove that member." });

  if (access.actor.isPlatformAdmin && !access.actor.role) {
    await recordPlatformAudit(authReq.user.id, "workspace.member.remove", access.workspaceId, { user_id: userId.data });
  }
  return res.json({ ok: true });
});

/**
 * Adds the person immediately when they already have an account, otherwise records
 * an invite that attaches when they first sign in with that confirmed email.
 */
async function addOrInviteMember(
  admin: ReturnType<typeof createAdminSupabase>,
  workspaceId: string,
  email: string,
  role: WorkspaceRole,
  invitedBy: string,
): Promise<"added" | "invited" | "exists" | "failed"> {
  const existingUserId = await findUserIdByEmail(email);
  if (existingUserId) {
    const { data: existing } = await admin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", existingUserId)
      .maybeSingle();
    if (existing) return "exists";
    const { error } = await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: existingUserId, role });
    return error ? "failed" : "added";
  }

  const { error } = await admin
    .from("workspace_invites")
    .insert({ workspace_id: workspaceId, email, role, invited_by: invitedBy });
  if (error) return error.code === "23505" ? "exists" : "failed";
  return "invited";
}

export default router;
