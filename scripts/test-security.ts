import assert from "node:assert/strict";
import { MAX_REQUEST_BYTES, requestSizeAllowed, trustedLocalBoundary, validSession } from "../src/lib/local-security";
import { isProtectedSecret, protectSecret, revealSecret } from "../src/lib/credential-vault";
async function main() {
assert.equal(trustedLocalBoundary("127.0.0.1:4321", null), true);
assert.equal(trustedLocalBoundary("localhost:4321", "http://localhost:4321"), true);
assert.equal(trustedLocalBoundary("[::1]:4321", "http://[::1]:4321"), true);
for (const host of ["evil.test", "192.168.1.3:4321", "127.0.0.1.evil.test"]) assert.equal(trustedLocalBoundary(host, null), false);
assert.equal(trustedLocalBoundary("127.0.0.1:4321", "http://127.0.0.1:9999"), false);
assert.equal(requestSizeAllowed(String(MAX_REQUEST_BYTES)), true);
assert.equal(requestSizeAllowed(String(MAX_REQUEST_BYTES + 1)), false);
assert.equal(validSession("same-token", "same-token"), true);
assert.equal(validSession("other", "same-token"), false);
assert.equal(isProtectedSecret("dpapi:user:v1:fixture"), true);
assert.equal(isProtectedSecret("plaintext"), false);
assert.equal(await protectSecret(""), "");
assert.equal(await protectSecret("dpapi:user:v1:fixture"), "dpapi:user:v1:fixture");
assert.equal(await revealSecret("legacy plaintext"), "legacy plaintext");
console.log("LOCAL_API_BOUNDARY_BEHAVIOR_OK");
}
void main().catch((error)=>{console.error(error);process.exit(1)});
