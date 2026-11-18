import type { User } from "@supabase/supabase-js";
import { createAdminSupabase } from "../supabase.js";
import { isWorkspaceRole, normalizeInviteEmail, type WorkspaceActor } from "../../shared/workspace-permissions.js";
import type { WorkspaceRole } from "../../shared/schema.js";

/**
 * Server-side workspace access lookups. These use the service role, so every caller
 * must decide authorization from the result (see shared/workspace-permissions.ts)
 * before reading or writing anything. Tenant RLS stays untouched for ordinary users;
 * this is the "platform admin surface" that, like Xphere, sees across companies.
 */

/** True when a database error means the workspace tables are not deployed yet. */
export function isMissingWorkspaceSchema(error: any): boolean {
  return error?.code === "42P01" || /workspace_(members|invites|id)|workspaces|platform_admins/i.test(String(error?.message || ""));
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data, error } = await createAdminSupabase()
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  // Missing table (migration not applied) means "no platform staff", never an error to the user.
  if (error) return false;
  return Boolean(data);
}

export async function getWorkspaceActor(userId: string, workspaceId: string): Promise<WorkspaceActor> {
  const admin = createAdminSupabase();
  const [platform, membership] = await Promise.all([
    isPlatformAdmin(userId),
    admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const role = membership.data?.role;
  return { isPlatformAdmin: platform, role: isWorkspaceRole(role) ? role : null };
}

/** Records a platform-level action apart from ordinary membership. Never throws. */
export async function recordPlatformAudit(
  actorId: string,
  action: string,
  workspaceId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await createAdminSupabase()
      .from("platform_audit_events")
      .insert({ actor_id: actorId, action, workspace_id: workspaceId, details });
  } catch {
    // Auditing must never block the action it describes.
  }
}

/** Escapes LIKE wildcards so an email is matched literally by ilike. */
export function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const { data } = await createAdminSupabase()
    .from("profiles")
    .select("id")
    .ilike("email", escapeLikeValue(normalizeInviteEmail(email)))
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Attaches the caller to every open, unexpired invite for their email. Only a
 * confirmed email is trusted, so nobody can claim an invite by typing someone
 * else's address into a sign-up form.
 */
export async function acceptPendingInvites(user: User): Promise<number> {
  if (!user.email || !user.email_confirmed_at) return 0;
  const admin = createAdminSupabase();
  const email = normalizeInviteEmail(user.email);

  const { data: invites, error } = await admin
    .from("workspace_invites")
    .select("id, workspace_id, role")
    .eq("email", email)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString());
  if (error || !invites?.length) return 0;

  let accepted = 0;
  for (const invite of invites) {
    if (!isWorkspaceRole(invite.role)) continue;
    // Never downgrade someone who already has a role in this workspace.
    const { error: insertError } = await admin
      .from("workspace_members")
      .upsert(
        { workspace_id: invite.workspace_id, user_id: user.id, role: invite.role as WorkspaceRole },
        { onConflict: "workspace_id,user_id", ignoreDuplicates: true },
      );
    if (insertError) continue;
    await admin
      .from("workspace_invites")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invite.id);
    accepted += 1;
  }
  return accepted;
}
