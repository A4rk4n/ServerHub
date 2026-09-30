import assert from "node:assert/strict";
import test from "node:test";
import { MAX_REQUEST_BYTES, requestSizeAllowed, trustedLocalBoundary, validSession } from "../src/lib/local-security";
import { redactLogSecrets, sanitizeSupportText } from "../src/lib/support-redaction";
import { isProtectedSecret, protectSecret, revealSecret } from "../src/lib/credential-vault";

test("trustedLocalBoundary only accepts the loopback management endpoints", () => {
  assert.equal(trustedLocalBoundary("127.0.0.1:4321", null), true);
  assert.equal(trustedLocalBoundary("localhost:4321", "http://localhost:4321"), true);
  assert.equal(trustedLocalBoundary("[::1]:4321", "http://[::1]:4321"), true);
  for (const host of ["evil.test", "192.168.1.3:4321", "127.0.0.1.evil.test"]) {
    assert.equal(trustedLocalBoundary(host, null), false, host);
  }
  assert.equal(trustedLocalBoundary("127.0.0.1:4321", "http://127.0.0.1:9999"), false);
  console.log("LOCAL_API_BOUNDARY_BEHAVIOR_OK");
});

test("requestSizeAllowed enforces the maximum request byte budget", () => {
  assert.equal(requestSizeAllowed(String(MAX_REQUEST_BYTES)), true);
  assert.equal(requestSizeAllowed(String(MAX_REQUEST_BYTES + 1)), false);
});

test("validSession compares the issued and presented session tokens", () => {
  assert.equal(validSession("same-token", "same-token"), true);
  assert.equal(validSession("other", "same-token"), false);
});

test("credential vault round-trips protected and legacy secrets", async () => {
  assert.equal(isProtectedSecret("dpapi:user:v1:fixture"), true);
  assert.equal(isProtectedSecret("plaintext"), false);
  assert.equal(await protectSecret(""), "");
  assert.equal(await protectSecret("dpapi:user:v1:fixture"), "dpapi:user:v1:fixture");
  assert.equal(await revealSecret("legacy plaintext"), "legacy plaintext");
});

test("support redaction strips secrets, identifiers, and private paths", () => {
  const sensitive = "authorization: Bearer abc123 admin_password=hunter2 ownerId=76561198000000000 dpapi:user:v1:QUJDRA== C:\\Users\\Ahri\\world /home/ahri/server";
  const redacted = sanitizeSupportText(sensitive, ["C:\\Users\\Ahri\\world"]);
  for (const forbidden of ["abc123", "hunter2", "76561198000000000", "QUJDRA", "Ahri", "/home/ahri"]) {
    assert.equal(redacted.includes(forbidden), false, forbidden);
  }
  assert.match(redactLogSecrets("?token=secret&key=private"), /token=\[redacted\].*key=\[redacted\]/);
  console.log("SUPPORT_REDACTION_REGRESSION_OK");
});
