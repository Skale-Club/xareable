import assert from "node:assert/strict";
import { getApiErrorMessage } from "../client/src/lib/http-error.js";

assert.equal(getApiErrorMessage('{"message":"Access denied"}', true), "Access denied");
assert.equal(getApiErrorMessage('{"error":"No message"}', true), '{"error":"No message"}');
assert.equal(getApiErrorMessage("not JSON", true), "not JSON");
assert.equal(getApiErrorMessage("Gateway unavailable", false), "Gateway unavailable");
assert.equal(getApiErrorMessage("", false), "Request failed");

console.log("PASS test-http-error");
