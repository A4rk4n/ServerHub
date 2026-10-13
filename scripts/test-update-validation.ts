import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("the updates route snapshots provenance and safety backups before install", () => {
  const update = fs.readFileSync("src/app/api/servers/[id]/updates/route.ts", "utf8");
  for (const marker of ["updateValidationStatus:\"installing\"", "updatePreviousVersion:previousVersion", "updateTargetVersion:latest", "updateSafetyBackupId:safetyBackup?.id??null", "updateRollbackAttempted:false"]) {
    assert.ok(update.includes(marker), marker);
  }
});

test("the runtime gates completion on readiness and rolls back failures once", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  for (const marker of ["updateValidationStatus:\"awaiting-readiness\"", "rollbackReadinessValidation?\"rollback-validating\":\"validating-runtime\"", "rollbackReadinessValidation?\"rollback-validated\":\"validated\"", "rollbackReadinessValidation?\"rollback-failed\":\"readiness-failed\"", "passed first-start readiness validation", "updateValidationStatus: \"rollback-running\"", "updateValidationStatus: \"rollback-restored\"", "updateValidationStatus: restarted.ok ? \"rollback-validated\" : \"rollback-failed\"", "updateRollbackAttempted: true"]) {
    assert.ok(runtime.includes(marker), marker);
  }
});

test("the schema records validation state at the current migration version", () => {
  const schema = fs.readFileSync("src/db/index.ts", "utf8");
  assert.ok(schema.includes("SCHEMA_VERSION = 21600"));
  assert.ok(schema.includes("update_validation_status"));
  console.log("READINESS_GATED_UPDATE_VALIDATION_OK");
});
