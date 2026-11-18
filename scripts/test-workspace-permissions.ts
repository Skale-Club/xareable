import assert from "node:assert/strict";
import {
  canAssignRole,
  canCreateCompany,
  canManageMembers,
  isWorkspaceRole,
  normalizeInviteEmail,
  roleCan,
  wouldRemoveLastOwner,
} from "../shared/workspace-permissions.js";
import { escapeLikeValue } from "../server/services/workspace-access.service.js";

// Role matrix from the Phase 1 specification.
assert.equal(roleCan("owner", "manage_members"), true);
assert.equal(roleCan("owner", "delete_workspace"), true);
assert.equal(roleCan("manager", "manage_members"), false);
assert.equal(roleCan("manager", "edit_settings"), true);
assert.equal(roleCan("creator", "publish"), true);
assert.equal(roleCan("creator", "edit_settings"), false);
assert.equal(roleCan("viewer", "view"), true);
assert.equal(roleCan("viewer", "create_content"), false);
assert.equal(roleCan(null, "view"), false);

// Platform staff and workspace owners manage members; nobody else does.
assert.equal(canManageMembers({ role: "owner", isPlatformAdmin: false }), true);
assert.equal(canManageMembers({ role: null, isPlatformAdmin: true }), true);
assert.equal(canManageMembers({ role: "manager", isPlatformAdmin: false }), false);
assert.equal(canManageMembers({ role: "viewer", isPlatformAdmin: false }), false);
assert.equal(canManageMembers({ role: null, isPlatformAdmin: false }), false);

// A company can only be created by platform staff, never inferred from an owner role.
assert.equal(canCreateCompany({ isPlatformAdmin: true }), true);
assert.equal(canCreateCompany({ isPlatformAdmin: false }), false);

// Role assignment is limited to people who manage members, and a bad role is rejected.
assert.equal(canAssignRole({ role: "owner", isPlatformAdmin: false }, "viewer"), true);
assert.equal(canAssignRole({ role: "manager", isPlatformAdmin: false }, "viewer"), false);
assert.equal(canAssignRole({ role: "creator", isPlatformAdmin: false }, "owner"), false);
assert.equal(canAssignRole({ role: null, isPlatformAdmin: true }, "owner"), true);
assert.equal(canAssignRole({ role: "owner", isPlatformAdmin: false }, "admin" as any), false);

assert.equal(isWorkspaceRole("owner"), true);
assert.equal(isWorkspaceRole("admin"), false);
assert.equal(isWorkspaceRole(undefined), false);

// The last owner can neither be demoted nor removed; with a second owner it can.
const oneOwner = [
  { user_id: "a", role: "owner" as const },
  { user_id: "b", role: "viewer" as const },
];
assert.equal(wouldRemoveLastOwner(oneOwner, "a", null), true);
assert.equal(wouldRemoveLastOwner(oneOwner, "a", "manager"), true);
assert.equal(wouldRemoveLastOwner(oneOwner, "a", "owner"), false);
assert.equal(wouldRemoveLastOwner(oneOwner, "b", null), false);
assert.equal(wouldRemoveLastOwner(oneOwner, "zzz", null), false);
const twoOwners = [...oneOwner, { user_id: "c", role: "owner" as const }];
assert.equal(wouldRemoveLastOwner(twoOwners, "a", null), false);
assert.equal(wouldRemoveLastOwner(twoOwners, "a", "creator"), false);

// Emails are compared trimmed and case-insensitively; LIKE wildcards match literally.
assert.equal(normalizeInviteEmail("  Ana@Skale.CLUB "), "ana@skale.club");
assert.equal(escapeLikeValue("a_b%c\\d@x.com"), "a\\_b\\%c\\\\d@x.com");

console.log("PASS test-workspace-permissions");
