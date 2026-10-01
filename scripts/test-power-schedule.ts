// Unit suite for power schedules: daily-time validation, the matched
// start/stop pair a power window creates, the run-vs-skip decision
// matrix, and the wiring that executes scheduled starts/stops through
// the real power flows with every outcome recorded in task history.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { powerTaskDecision, powerWindowPlan, validDailyTime } from "../src/lib/power-schedule";

test("daily times accept 24-hour HH:MM only", () => {
  for (const good of ["00:00", "09:30", "15:00", "23:59"]) assert.ok(validDailyTime(good), `${good} is valid`);
  for (const bad of ["24:00", "9:30", "12:60", "12-30", "noon", "", null, 1500]) {
    assert.ok(!validDailyTime(bad), `${JSON.stringify(bad)} is invalid`);
  }
});

test("a power window plans a matched daily start/stop pair", () => {
  const plan = powerWindowPlan("15:00", "23:00");
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((task) => task.type), ["start", "stop"]);
  assert.deepEqual(plan.map((task) => task.scheduleKind), ["daily", "daily"]);
  assert.deepEqual(plan.map((task) => task.scheduleTime), ["15:00", "23:00"]);
  assert.deepEqual(plan.map((task) => task.missedPolicy), ["run", "run"], "a missed stop still runs late — the promise is 'down outside the window'");
  const overnight = powerWindowPlan("18:00", "01:30");
  assert.equal(overnight[1].scheduleTime, "01:30", "overnight windows are two independent daily tasks");
  assert.throws(() => powerWindowPlan("15:00", "15:00"), /must differ/);
  assert.throws(() => powerWindowPlan("25:00", "23:00"), /HH:MM/);
});

test("the decision matrix skips satisfied wishes instead of failing", () => {
  assert.deepEqual(powerTaskDecision("start", false), { action: "run", reason: "" });
  assert.deepEqual(powerTaskDecision("stop", true), { action: "run", reason: "" });
  assert.deepEqual(powerTaskDecision("start", true), { action: "skip", reason: "Server is already running" });
  assert.deepEqual(powerTaskDecision("stop", false), { action: "skip", reason: "Server is already offline" });
  assert.deepEqual(powerTaskDecision("stop", true, true), { action: "skip", reason: "Server is already stopping" }, "a stop during the graceful-stop window is satisfied, not failed");
  assert.deepEqual(powerTaskDecision("stop", false, true), { action: "skip", reason: "Server is already offline" }, "offline wins over a stale stopping flag");
});

test("the scheduler executes power tasks through the real flows and records history", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes('task.type === "start" || task.type === "stop"'), "the sweep has a power branch");
  const branch = runtime.slice(runtime.indexOf('task.type === "start" || task.type === "stop"'));
  assert.ok(branch.includes("powerTaskDecision"), "skip semantics come from the pure decision");
  assert.ok(branch.includes("await startFlow(server.id)"), "scheduled starts use the validated start flow");
  // Since v2.41 scheduled stops route through the countdown-aware wrapper,
  // which still performs the real stopFlow attributed to the scheduler.
  assert.ok(branch.includes('warnedPower(server.id, "stop", task.name)'), "scheduled stops go through the warned power wrapper");
  assert.ok(/warnedPower[\s\S]{0,900}stopFlow\(serverId, "Scheduler"\)/.test(runtime), "the wrapper's stop is attributed to the scheduler");
  assert.ok(branch.includes('status: "skipped", error: decision.reason'), "skips land in task history with the reason");
  assert.ok(branch.includes('"countdown-started" : "succeeded"') && branch.includes(': "failed"'), "real runs record their outcome, including countdowns");
});

test("the API and UI offer the new types and the power-window helper", () => {
  const route = fs.readFileSync("src/app/api/servers/[id]/tasks/route.ts", "utf8");
  assert.ok(route.includes('"start", "stop"'), "start and stop are schedulable task types");
  const ui = fs.readFileSync("src/components/tasks-manager.tsx", "utf8");
  assert.ok(ui.includes("start: { label:") && ui.includes("stop: { label:"), "the task form offers both types");
  assert.ok(ui.includes("Power window"), "the one-click power-window helper exists");
  assert.ok(ui.includes("Overnight windows"), "overnight windows are documented in the dialog");
  console.log("POWER_SCHEDULE_SUITE_OK");
});
