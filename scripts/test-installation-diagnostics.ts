import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseInstallationFailure, installationFailureMessage } from "../src/lib/installation-diagnostics";

test("classifies SteamCMD configuration and subscription failures", () => {
  const missing = diagnoseInstallationFailure("ERROR! Failed to install app '4019830' (Missing configuration)");
  assert.equal(missing?.code, "steam-missing-configuration");
  assert.equal(missing?.transient, true);
  const subscription = diagnoseInstallationFailure("Failed to install app 123 (No subscription)");
  assert.equal(subscription?.code, "steam-no-subscription");
  assert.equal(subscription?.transient, false);
});

test("classifies network, disk-space, and Windows binary launch failures", () => {
  assert.equal(diagnoseInstallationFailure("HTTP request failed; connection reset")?.code, "provider-network");
  assert.equal(diagnoseInstallationFailure("No space left on device")?.code, "disk-space");
  assert.equal(diagnoseInstallationFailure("spawn steamcmd.exe EFTYPE")?.code, "windows-launch-incompatible");
  assert.equal(diagnoseInstallationFailure("unknown provider issue"), null);
});

test("friendly failure messages never leak raw provider output", () => {
  const friendly = installationFailureMessage("ERROR! Failed to install app '4019830' (Missing configuration) followed by private raw output");
  assert.ok(friendly.includes("steam-missing-configuration"));
  assert.ok(!friendly.includes("private raw output"));
  console.log("INSTALLATION_DIAGNOSTICS_REGRESSION_OK");
});
