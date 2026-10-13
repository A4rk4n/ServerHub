import assert from "node:assert/strict";
import fs from "node:fs";
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

test("classifies the SteamCMD stale-app-state failure (exit code 8, state 0xN) as recoverable", () => {
  // Verbatim shape from a user-reported Dragonwilds installation failure.
  const diagnosis = diagnoseInstallationFailure("Installer exited with code 8. Last output: ... Error! App '4019830' state is 0x6 after update job.");
  assert.equal(diagnosis?.code, "steam-app-state");
  assert.equal(diagnosis?.transient, true, "transient → the installer retry loop gets another attempt");
  assert.ok(diagnosis?.remediation.includes("revalidates"), "the remedy names the automatic cleanup");
  assert.equal(diagnoseInstallationFailure("App '896660' state is 0x606 after update job")?.code, "steam-app-state", "other state codes match too");

  // The retry loop must actually clean up before the next attempt.
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("clearStaleSteamAppState"), "recovery clears the stale state");
  assert.ok(runtime.includes('diagnosis?.code === "steam-app-state"'), "cleanup is gated on this diagnosis");
  assert.ok(runtime.includes("appmanifest_${appId}.acf") && runtime.includes('"downloading"'), "manifest and partial downloads are removed");
  assert.ok(runtime.includes("{ root, appId: game.steamAppId }"), "installSteam passes the install root and app id");
});

test("friendly failure messages never leak raw provider output", () => {
  const friendly = installationFailureMessage("ERROR! Failed to install app '4019830' (Missing configuration) followed by private raw output");
  assert.ok(friendly.includes("steam-missing-configuration"));
  assert.ok(!friendly.includes("private raw output"));
  console.log("INSTALLATION_DIAGNOSTICS_REGRESSION_OK");
});
