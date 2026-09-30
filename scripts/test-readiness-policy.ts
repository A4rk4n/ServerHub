import assert from "node:assert/strict";
import test from "node:test";
import { minimumProcessStabilityMs, processStabilityReady, readinessProbeFor, readinessRemediation, readinessWaitingReason } from "../src/lib/readiness-policy";

test("readinessProbeFor selects the probe per provider and transport", () => {
  assert.equal(readinessProbeFor("minecraft", "TCP"), "minecraft-status");
  assert.equal(readinessProbeFor("minecraft-modded", "TCP"), "minecraft-status");
  assert.equal(readinessProbeFor("minecraft-bedrock", "UDP"), "process-stability");
  assert.equal(readinessProbeFor("dragonwilds", "UDP"), "process-stability");
  assert.equal(readinessProbeFor("valheim", "UDP"), "steam-a2s");
  assert.equal(readinessProbeFor("terraria", "TCP"), "tcp-connect");
});

test("process stability thresholds reflect provider requirements", () => {
  assert.equal(minimumProcessStabilityMs("dragonwilds"), 15000);
  assert.equal(minimumProcessStabilityMs("minecraft-bedrock"), 10000);
  assert.equal(processStabilityReady(1000, 10999), false);
  assert.equal(processStabilityReady(1000, 11000), true);
});

test("waiting reasons and remediation guidance stay actionable", () => {
  assert.ok(readinessWaitingReason("dragonwilds", "process-stability").includes("15 seconds"));
  assert.ok(readinessWaitingReason("ark", "steam-a2s").includes("A2S"));
  assert.ok(readinessRemediation("dragonwilds", "process-stability").includes("Owner ID"));
  assert.ok(readinessRemediation("ark", "steam-a2s").includes("query port"));
  console.log("PROVIDER_READINESS_POLICY_OK");
});
