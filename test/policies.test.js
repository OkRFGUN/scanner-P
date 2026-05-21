import test from "node:test";
import assert from "node:assert/strict";
import { detectAccessControl, getComplianceStatement } from "../src/policies.js";

test("detects access-control status codes", () => {
  const result = detectAccessControl("<html></html>", 429);
  assert.equal(result.blocked, true);
  assert.deepEqual(result.signals, ["HTTP 429"]);
});

test("detects captcha and login wall copy", () => {
  const result = detectAccessControl("<h1>Please sign in</h1><p>captcha required</p>", 200);
  assert.equal(result.blocked, true);
  assert.equal(result.signals.includes("captcha"), true);
  assert.equal(result.signals.includes("login required"), true);
});

test("declares disallowed evasion features", () => {
  const statement = getComplianceStatement();
  assert.equal(statement.disallowed.includes("captcha cracking"), true);
  assert.equal(statement.disallowed.includes("browser fingerprint spoofing"), true);
  assert.equal(statement.allowed.includes("manual captcha handoff"), true);
});
