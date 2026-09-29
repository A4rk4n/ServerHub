import assert from "node:assert/strict";
import fs from "node:fs";
const runtime=fs.readFileSync("src/lib/runtime.ts","utf8");for(const marker of ['updateValidationStatus:"installing"','updateTargetVersion:"provider-current"','updateSafetyBackupId:safety.id','updateRollbackAttempted:false','validated?.updateValidationStatus !== "validated"','previous version was restored and validated','status:maintenanceStatus,error:maintenanceError'])assert.ok(runtime.includes(marker),marker);assert.ok(!runtime.includes('Readiness failed; restoring safety backup:'));
console.log("SCHEDULED_MAINTENANCE_UPDATE_LIFECYCLE_OK");
