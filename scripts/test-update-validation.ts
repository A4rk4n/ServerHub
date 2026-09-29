import assert from "node:assert/strict";
import fs from "node:fs";
const update=fs.readFileSync("src/app/api/servers/[id]/updates/route.ts","utf8");for(const marker of ['updateValidationStatus:"installing"','updatePreviousVersion:previousVersion','updateTargetVersion:latest','updateSafetyBackupId:safetyBackup?.id??null','updateRollbackAttempted:false'])assert.ok(update.includes(marker),marker);
const runtime=fs.readFileSync("src/lib/runtime.ts","utf8");for(const marker of ['updateValidationStatus:"awaiting-readiness"','updateValidationStatus:"validating-runtime"','updateValidationStatus:"validated"','updateValidationStatus:"readiness-failed"','passed first-start readiness validation'])assert.ok(runtime.includes(marker),marker);
const schema=fs.readFileSync("src/db/index.ts","utf8");assert.ok(schema.includes("SCHEMA_VERSION = 21500"));assert.ok(schema.includes("update_validation_status"));
console.log("READINESS_GATED_UPDATE_VALIDATION_OK");
