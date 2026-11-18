import { WORKSPACE_ROLES, type WorkspaceRole } from "./schema.js";

/**
 * Workspace permission rules, shared by the API and the UI.
 *
 * Two separate hats (see the agency workspace vision):
 *  - the platform role (Skale Club staff) oversees every company;
 *  - the workspace role (owner, manager, creator, viewer) controls what a person
 *    does inside one company.
 * The platform role is never inferred from a workspace role, and a workspace role
 * never grants platform power. The database RLS is the final enforcement layer;
 * these helpers only let the server and the UI agree on the same rules.
 */

export type WorkspaceCapability =
  | "view"
  | "edit_settings"
  | "manage_members"
  | "create_content"
  | "publish"
  | "delete_workspace";

const CAPABILITY_MATRIX: Record<WorkspaceRole, readonly WorkspaceCapability[]> = {
  owner: ["view", "edit_settings", "manage_members", "create_content", "publish", "delete_workspace"],
  manager: ["view", "edit_settings", "create_content", "publish"],
  creator: ["view", "create_content", "publish"],
  viewer: ["view"],
};

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function roleCan(role: WorkspaceRole | null | undefined, capability: WorkspaceCapability): boolean {
  if (!role) return false;
  return CAPABILITY_MATRIX[role].includes(capability);
}

export type WorkspaceActor = {
  /** The caller's role in the workspace, or null if they are not a member. */
  role: WorkspaceRole | null;
  /** True only for Skale Club platform staff (a separate platform permission). */
  isPlatformAdmin: boolean;
};

/** Platform staff and workspace owners may manage the member list and invites. */
export function canManageMembers(actor: WorkspaceActor): boolean {
  return actor.isPlatformAdmin || roleCan(actor.role, "manage_members");
}

/** Only platform staff may create company workspaces. Personal ones are created by the system. */
export function canCreateCompany(actor: Pick<WorkspaceActor, "isPlatformAdmin">): boolean {
  return actor.isPlatformAdmin;
}

/** Role assignment is limited to people who can manage members. A client-supplied role is never trusted on its own. */
export function canAssignRole(actor: WorkspaceActor, target: WorkspaceRole): boolean {
  if (!canManageMembers(actor)) return false;
  return isWorkspaceRole(target);
}

type MemberRow = { user_id: string; role: WorkspaceRole };

/**
 * True when applying the change would leave the workspace with no owner.
 * `nextRole` null means the member is being removed.
 */
export function wouldRemoveLastOwner(
  members: readonly MemberRow[],
  userId: string,
  nextRole: WorkspaceRole | null,
): boolean {
  const current = members.find((member) => member.user_id === userId);
  if (!current || current.role !== "owner") return false;
  if (nextRole === "owner") return false;
  const otherOwners = members.filter((member) => member.user_id !== userId && member.role === "owner");
  return otherOwners.length === 0;
}

/** Invite emails are compared case-insensitively and trimmed. */
export function normalizeInviteEmail(value: string): string {
  return value.trim().toLowerCase();
}
