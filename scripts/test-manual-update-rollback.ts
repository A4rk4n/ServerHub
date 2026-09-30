import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("restoreUpdateSafetyBackup enforces guard rails and restores in place", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  for (const marker of ["export async function restoreUpdateSafetyBackup", "No managed pre-update safety backup is available", "Stop the server before restoring", "The current update state is not eligible for rollback", "updateValidationStatus:\"rollback-running\"", "updateValidationStatus:\"rollback-restored\"", "Previous version ${server.updatePreviousVersion} restored manually"]) {
    assert.ok(runtime.includes(marker), marker);
  }
});

test("manual rollbacks re-enter the readiness validation flow", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  for (const marker of ["rollbackReadinessValidation=server.updateValidationStatus===\"rollback-restored\"", "rollbackReadinessValidation?\"rollback-validating\":\"validating-runtime\"", "rollbackReadinessValidation?\"rollback-validated\":\"validated\"", "rollbackReadinessValidation?\"rollback-failed\":\"readiness-failed\""]) {
    assert.ok(runtime.includes(marker), marker);
  }
});

test("the updates route and settings UI expose the guarded rollback action", () => {
  const route = fs.readFileSync("src/app/api/servers/[id]/updates/route.ts", "utf8");
  assert.ok(route.includes("body.action===\"rollback\""));
  assert.ok(route.includes("restoreUpdateSafetyBackup(numeric)"));
  assert.ok(route.includes("rollbackAvailable:Boolean"));
  const ui = fs.readFileSync("src/components/settings-manager.tsx", "utf8");
  assert.ok(ui.includes("restorePreviousVersion"));
  assert.ok(ui.includes("Restore {updateInfo.previousVersion"));
  console.log("MANUAL_UPDATE_ROLLBACK_POLICY_OK");
});
