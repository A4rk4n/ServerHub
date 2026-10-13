// Unit suite for the scheduled "update" task: the availability decision
// matrix, target-version selection, and the scheduler/API/UI wiring.
// The core contract: an update task leaves the server completely
// untouched unless something new is actually published.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { autoUpdateDecision, autoUpdateTargetVersion } from "../src/lib/auto-update";

test("catalog-pinned games (mojang/fabric) update only when a newer stable exists", () => {
  const base = { installer: "mojang", currentVersion: "1.21.4", buildStatus: "unknown" as const };
  assert.deepEqual(autoUpdateDecision({ ...base, latestStableVersion: "1.21.4" }), { run: false, reason: "Already on the latest stable version (1.21.4)" });
  const outdated = autoUpdateDecision({ ...base, latestStableVersion: "26.3" });
  assert.equal(outdated.run, true);
  assert.ok(outdated.reason.includes("1.21.4 → 26.3"), "the reason names both versions");
  assert.equal(autoUpdateDecision({ ...base, latestStableVersion: null }).run, false, "an unreachable catalog must not trigger churn");
  assert.equal(autoUpdateDecision({ ...base, installer: "fabric", latestStableVersion: "26.3" }).run, true);
});

test("SteamCMD games follow the conservative build comparison", () => {
  const base = { installer: "steamcmd", currentVersion: "latest", latestStableVersion: null };
  assert.equal(autoUpdateDecision({ ...base, buildStatus: "update-available" }).run, true);
  assert.equal(autoUpdateDecision({ ...base, buildStatus: "up-to-date" }).run, false);
  assert.equal(autoUpdateDecision({ ...base, buildStatus: "unknown" }).run, false, "an unreachable mirror must not trigger churn");
});

test("custom servers never auto-update; rolling providers always refresh", () => {
  assert.equal(autoUpdateDecision({ installer: "manual", currentVersion: "manual", latestStableVersion: null, buildStatus: "unknown" }).run, false);
  assert.equal(autoUpdateDecision({ installer: "bedrock", currentVersion: "latest", latestStableVersion: null, buildStatus: "unknown" }).run, true);
  assert.equal(autoUpdateDecision({ installer: "hytale", currentVersion: "latest", latestStableVersion: null, buildStatus: "unknown" }).run, true);
});

test("the target version bumps only for catalog-pinned games", () => {
  assert.equal(autoUpdateTargetVersion({ installer: "mojang", currentVersion: "1.21.4", latestStableVersion: "26.3" }), "26.3");
  assert.equal(autoUpdateTargetVersion({ installer: "fabric", currentVersion: "1.21.4", latestStableVersion: null }), "1.21.4");
  assert.equal(autoUpdateTargetVersion({ installer: "steamcmd", currentVersion: "latest", latestStableVersion: null }), "latest");
});

test("the scheduler, tasks API, and UI are wired for the update task", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes('task.type === "update"'), "sweepTasks has the update branch");
  assert.ok(runtime.includes("autoUpdateDecision"), "the scheduler uses the tested decision");
  assert.ok(runtime.includes("fetchLatestGameBuild"), "SteamCMD availability uses the shared cached lookup");
  assert.ok(runtime.includes('status: "skipped", error: decision.reason'), "skipped checks record the reason without touching the server");
  assert.ok(runtime.includes("updateValidationStatus: \"installing\""), "real updates enter the validated-update lifecycle");
  const route = fs.readFileSync("src/app/api/servers/[id]/tasks/route.ts", "utf8");
  assert.ok(route.includes('"update"'), "the tasks API accepts the update type");
  const ui = fs.readFileSync("src/components/tasks-manager.tsx", "utf8");
  assert.ok(ui.includes('update: { label: "Game update"'), "the Tasks UI offers the Game update type");
  console.log("AUTO_UPDATE_TASK_OK");
});
