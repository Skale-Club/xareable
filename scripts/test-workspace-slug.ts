import assert from "node:assert/strict";
import { createWorkspaceSlug } from "../server/services/workspaces.service.js";

assert.equal(createWorkspaceSlug("Skale Club"), "skale-club");
assert.equal(createWorkspaceSlug("Flüenverse — Agency!"), "fluenverse-agency");
assert.equal(createWorkspaceSlug("  already---clean  "), "already-clean");
assert.equal(createWorkspaceSlug("!@#$%"), "");
assert.equal(createWorkspaceSlug("a".repeat(100)).length, 70);

console.log("PASS test-workspace-slug");
