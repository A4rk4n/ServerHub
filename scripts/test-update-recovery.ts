import assert from "node:assert/strict";
import test from "node:test";
import { recoverInterruptedUpdateState } from "../src/lib/update-recovery";

test("interrupted in-flight update states reconcile to their safe outcomes", () => {
  assert.equal(recoverInterruptedUpdateState("validating-runtime", false)?.status, "awaiting-readiness");
  assert.equal(recoverInterruptedUpdateState("rollback-validating", false)?.status, "rollback-restored");
  assert.equal(recoverInterruptedUpdateState("rollback-running", false)?.status, "rollback-failed");
  assert.equal(recoverInterruptedUpdateState("installing", false)?.status, "installation-failed");
  assert.equal(recoverInterruptedUpdateState("installing", true), null);
});

test("stable update states are left untouched on restart", () => {
  for (const stable of ["none", "awaiting-readiness", "validated", "readiness-failed", "rollback-restored", "rollback-validated", "rollback-failed"]) {
    assert.equal(recoverInterruptedUpdateState(stable, false), null, stable);
  }
  console.log("INTERRUPTED_UPDATE_RECOVERY_OK");
});
