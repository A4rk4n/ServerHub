import assert from "node:assert/strict";
import {processStabilityReady,readinessProbeFor,readinessRemediation} from "../src/lib/readiness-policy";
assert.equal(readinessProbeFor("minecraft","TCP"),"minecraft-status");assert.equal(readinessProbeFor("minecraft-modded","TCP"),"minecraft-status");assert.equal(readinessProbeFor("minecraft-bedrock","UDP"),"process-stability");assert.equal(readinessProbeFor("dragonwilds","UDP"),"process-stability");assert.equal(readinessProbeFor("valheim","UDP"),"steam-a2s");assert.equal(readinessProbeFor("terraria","TCP"),"tcp-connect");
assert.equal(processStabilityReady(1000,10999),false);assert.equal(processStabilityReady(1000,11000),true);assert.ok(readinessRemediation("dragonwilds","process-stability").includes("Owner ID"));assert.ok(readinessRemediation("ark","steam-a2s").includes("query port"));
console.log("PROVIDER_READINESS_POLICY_OK");
