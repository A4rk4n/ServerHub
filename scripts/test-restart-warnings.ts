import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DEFAULT_WARNING_INTERVALS,
  MAX_WARNING_STEPS,
  broadcastCommand,
  builtinBroadcastCommand,
  countdownPlan,
  humanizeSeconds,
  normalizeWarningConfig,
  warningMessage,
} from "../src/lib/restart-warnings";

test("restart warnings: config normalization", () => {
  assert.deepEqual(normalizeWarningConfig(undefined), { enabled: true, intervalsSec: DEFAULT_WARNING_INTERVALS, template: "" });
  const custom = normalizeWarningConfig({ enabled: false, intervalsSec: [30, 600, 30, 60], template: "say {message}" });
  assert.deepEqual(custom, { enabled: false, intervalsSec: [600, 60, 30], template: "say {message}" });
  // out-of-range, non-integer, and junk entries are dropped; empty falls back
  assert.deepEqual(normalizeWarningConfig({ intervalsSec: [2, 99999, 7.5, "60", null] }).intervalsSec, DEFAULT_WARNING_INTERVALS);
  const flood = normalizeWarningConfig({ intervalsSec: Array.from({ length: 20 }, (_, i) => 3600 - i * 60) });
  assert.equal(flood.intervalsSec.length, MAX_WARNING_STEPS);
  // bad templates are discarded, not saved
  assert.equal(normalizeWarningConfig({ template: "no placeholder" }).template, "");
  assert.equal(normalizeWarningConfig({ template: "say {message}\nsay again" }).template, "");
  assert.equal(normalizeWarningConfig({ template: `x`.repeat(300) + "{message}" }).template, "");
});

test("restart warnings: broadcast command resolution", () => {
  assert.equal(builtinBroadcastCommand("minecraft"), "say {message}");
  assert.equal(builtinBroadcastCommand("minecraft-modded"), "say {message}");
  assert.equal(builtinBroadcastCommand("minecraft-bedrock"), "say {message}");
  assert.equal(builtinBroadcastCommand("terraria"), "say {message}");
  assert.equal(builtinBroadcastCommand("rust"), "say {message}");
  assert.equal(builtinBroadcastCommand("valheim"), null);
  assert.equal(builtinBroadcastCommand("custom"), null);
  assert.equal(broadcastCommand("minecraft", "", "Hello"), "say Hello");
  assert.equal(broadcastCommand("custom", "", "Hello"), null, "no template, no builtin -> no broadcast");
  assert.equal(broadcastCommand("custom", "announce {message}", "Hello"), "announce Hello", "template opts custom servers in");
  assert.equal(broadcastCommand("minecraft", "tellraw @a {message}", "Hi"), "tellraw @a Hi", "template overrides the builtin");
});

test("restart warnings: human-friendly messages", () => {
  assert.equal(humanizeSeconds(600), "10 minutes");
  assert.equal(humanizeSeconds(60), "1 minute");
  assert.equal(humanizeSeconds(90), "90 seconds");
  assert.equal(humanizeSeconds(30), "30 seconds");
  assert.equal(humanizeSeconds(1), "1 second");
  assert.equal(warningMessage("stop", 300), "Server will shut down in 5 minutes");
  assert.equal(warningMessage("restart", 30), "Server will restart in 30 seconds");
});

test("restart warnings: countdown plan offsets", () => {
  const now = 1_000_000;
  const plan = countdownPlan([600, 300, 60, 30], now);
  assert.equal(plan.totalSec, 600);
  assert.equal(plan.actionAtMs, now + 600_000);
  assert.deepEqual(
    plan.steps.map((step) => ({ offsetSec: (step.atMs - now) / 1000, secondsLeft: step.secondsLeft })),
    [
      { offsetSec: 0, secondsLeft: 600 },
      { offsetSec: 300, secondsLeft: 300 },
      { offsetSec: 540, secondsLeft: 60 },
      { offsetSec: 570, secondsLeft: 30 },
    ]
  );
  // a single mark is both the first warning and the total length
  const single = countdownPlan([45], now);
  assert.equal(single.totalSec, 45);
  assert.deepEqual(single.steps, [{ atMs: now, secondsLeft: 45 }]);
  // unsorted input is handled
  assert.equal(countdownPlan([30, 300], now).totalSec, 300);
});

test("restart warnings: the scheduler routes power actions through the countdown", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes('warnedPower(server.id, "stop", task.name)'), "scheduled stops are warned");
  assert.ok(runtime.includes('warnedPower(server.id, "restart", task.name)'), "scheduled restarts are warned");
  assert.ok(runtime.includes('"countdown-started"'), "task runs record the countdown state");
  assert.ok(runtime.includes("cancelCountdown(entry.server.id"), "a dying process clears its countdown");
  assert.match(runtime, /stopFlow\(id: number, reason = "Panel"\)[\s\S]{0,200}cancelCountdown\(id/, "manual stops supersede the countdown");
  console.log("RESTART_WARNINGS_SUITE_OK");
});
