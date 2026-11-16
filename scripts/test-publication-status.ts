import assert from "node:assert/strict";
import { mapKnownPublicationStatus, resolvePublicationStatus } from "../server/services/publication-status.service.js";

assert.equal(mapKnownPublicationStatus("cancelled"), "failed");
assert.equal(mapKnownPublicationStatus("publishing"), "pending");
assert.equal(mapKnownPublicationStatus("partial"), null);
assert.equal(resolvePublicationStatus("pending", "scheduled", undefined), "scheduled");
assert.equal(resolvePublicationStatus("published", "publishing", undefined), "published");
assert.equal(resolvePublicationStatus("published", "failed", undefined), "published");
assert.equal(resolvePublicationStatus("failed", "published", undefined), "published");

console.log("PASS test-publication-status");
