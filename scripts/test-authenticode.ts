import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeManagedSignature, classifyAuthenticode, verifyWindowsAuthenticode } from "../src/lib/windows-authenticode";

test("a valid signature classifies with normalized publisher and thumbprint", () => {
  const valid = classifyAuthenticode({ Status: "Valid", StatusMessage: "Signature verified", Subject: "CN=Valve Corp.", Thumbprint: "aa bb-12" });
  assert.deepEqual(valid, { state: "valid", publisher: "CN=Valve Corp.", thumbprint: "AABB12", detail: "Signature verified" });
  assert.doesNotThrow(() => assertSafeManagedSignature(valid));
});

test("an unsigned binary is classified but tolerated for repair", () => {
  const unsigned = classifyAuthenticode({ Status: "NotSigned", StatusMessage: "Not signed" });
  assert.equal(unsigned.state, "unsigned");
  assert.doesNotThrow(() => assertSafeManagedSignature(unsigned));
});

test("invalid signature states are rejected by the managed-signature policy", () => {
  for (const status of ["HashMismatch", "NotTrusted", "UnknownError"]) {
    const result = classifyAuthenticode({ Status: status, StatusMessage: "bad" });
    assert.equal(result.state, "invalid");
    assert.throws(() => assertSafeManagedSignature(result), /invalid Authenticode/);
  }
});

test("verifyWindowsAuthenticode shells out to Get-AuthenticodeSignature", async () => {
  const injected = await verifyWindowsAuthenticode("C:\\staged\\steamcmd.exe", async (command, args) => {
    assert.equal(command, "powershell.exe");
    assert.ok(args.join(" ").includes("Get-AuthenticodeSignature"));
    return { stdout: JSON.stringify({ Status: "Valid", Subject: "CN=Valve Corp.", Thumbprint: "ABC123" }) };
  });
  assert.equal(injected.state, "valid");
});

test("verification failures classify as unavailable and are rejected", async () => {
  const unavailable = await verifyWindowsAuthenticode("C:\\staged\\steamcmd.exe", async () => {
    throw new Error("PowerShell unavailable");
  });
  assert.equal(unavailable.state, "unavailable");
  assert.throws(() => assertSafeManagedSignature(unavailable), /unavailable/);
  console.log("AUTHENTICODE_POLICY_REGRESSION_OK");
});
