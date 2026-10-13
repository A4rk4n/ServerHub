// F49 — weekly power windows (v2.59.0).
// Pure calendar-rule lib (day-of-week windows, midnight spans, desired
// state, next transition), the sidecar round trip, and pinned wiring for
// the edges-only runtime sweep, API route, and settings panel.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_WINDOW_SCHEDULE,
  MAX_POWER_WINDOWS,
  desiredPowerState,
  isWithinWindows,
  minutesOfDay,
  nextTransitionAt,
  normalizeWindowSchedule,
  readAllWindowSchedules,
  readWindowSchedule,
  validatePowerWindow,
  writeWindowSchedule,
  type PowerWindowSchedule,
} from "../src/lib/power-windows";

// 2026-10-02 was a Friday; local-time Date construction keeps getDay stable.
const friday16 = new Date(2026, 9, 2, 16, 0); // Fri 16:00
const weekdays = { days: [1, 2, 3, 4, 5], start: "16:00", end: "23:00" };

test("validatePowerWindow rejects every malformed shape with a reason", () => {
  assert.equal(validatePowerWindow(weekdays), null);
  assert.match(validatePowerWindow(null)!, /object/);
  assert.match(validatePowerWindow({ days: [], start: "16:00", end: "23:00" })!, /at least one day/);
  assert.match(validatePowerWindow({ days: [7], start: "16:00", end: "23:00" })!, /0 \(Sunday\) through 6/);
  assert.match(validatePowerWindow({ days: [1, 1], start: "16:00", end: "23:00" })!, /repeat/);
  assert.match(validatePowerWindow({ days: [1], start: "24:00", end: "23:00" })!, /Start time/);
  assert.match(validatePowerWindow({ days: [1], start: "16:00", end: "16:60" })!, /End time/);
  assert.match(validatePowerWindow({ days: [1], start: "16:00", end: "16:00" })!, /same minute/);
  assert.equal(minutesOfDay("23:59"), 1439);
  assert.equal(minutesOfDay("9:30"), -1, "single-digit hours are not HH:MM");
});

test("normalizeWindowSchedule drops junk, sorts days, caps windows, gates enabled", () => {
  assert.deepEqual(normalizeWindowSchedule(null), { enabled: false, windows: [] });
  const mixed = normalizeWindowSchedule({ enabled: true, windows: [weekdays, { days: [9] }, { days: [6, 0], start: "10:00", end: "14:00" }] });
  assert.equal(mixed.enabled, true);
  assert.equal(mixed.windows.length, 2);
  assert.deepEqual(mixed.windows[1].days, [0, 6], "days come out sorted");
  // enabled without any valid window is meaningless.
  assert.equal(normalizeWindowSchedule({ enabled: true, windows: [{ days: [9] }] }).enabled, false);
  const many = normalizeWindowSchedule({ enabled: true, windows: Array.from({ length: 9 }, () => weekdays) });
  assert.equal(many.windows.length, MAX_POWER_WINDOWS);
});

test("isWithinWindows handles day matching and midnight-spanning windows", () => {
  assert.equal(isWithinWindows([weekdays], friday16), true);
  assert.equal(isWithinWindows([weekdays], new Date(2026, 9, 2, 23, 0)), false, "end minute is exclusive");
  assert.equal(isWithinWindows([weekdays], new Date(2026, 9, 2, 15, 59)), false);
  assert.equal(isWithinWindows([weekdays], new Date(2026, 9, 3, 16, 0)), false, "Saturday is not a weekday");
  // Friday 22:00 → 02:00 spans midnight into Saturday.
  const late = { days: [5], start: "22:00", end: "02:00" };
  assert.equal(isWithinWindows([late], new Date(2026, 9, 2, 23, 30)), true, "Friday night tail");
  assert.equal(isWithinWindows([late], new Date(2026, 9, 3, 1, 30)), true, "Saturday morning head");
  assert.equal(isWithinWindows([late], new Date(2026, 9, 3, 2, 0)), false, "head ends at 02:00");
  assert.equal(isWithinWindows([late], new Date(2026, 9, 1, 23, 30)), false, "Thursday night is not listed");
});

test("desiredPowerState and nextTransitionAt agree on the schedule's edges", () => {
  const schedule: PowerWindowSchedule = { enabled: true, windows: [weekdays] };
  assert.equal(desiredPowerState(schedule, friday16), "online");
  assert.equal(desiredPowerState({ ...schedule, enabled: false }, friday16), null);
  assert.equal(desiredPowerState(DEFAULT_WINDOW_SCHEDULE, friday16), null);
  // Inside the Friday window → next flip is 23:00 the same day.
  assert.equal(nextTransitionAt(schedule, friday16)!.getTime(), new Date(2026, 9, 2, 23, 0).getTime());
  // Friday 23:30 (outside) → next flip is MONDAY 16:00, skipping the weekend.
  assert.equal(nextTransitionAt(schedule, new Date(2026, 9, 2, 23, 30))!.getTime(), new Date(2026, 9, 5, 16, 0).getTime());
  // Overlapping windows: a boundary inside another window is a no-op, not a flip.
  const overlapping: PowerWindowSchedule = { enabled: true, windows: [weekdays, { days: [5], start: "20:00", end: "23:59" }] };
  assert.equal(nextTransitionAt(overlapping, new Date(2026, 9, 2, 21, 0))!.getTime(), new Date(2026, 9, 2, 23, 59).getTime(), "23:00 end is swallowed by the 20:00–23:59 window");
  assert.equal(nextTransitionAt({ ...schedule, enabled: false }, friday16), null);
});

test("sidecar round trip: write, read back, disable deletes, corrupt file degrades", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "power-windows-"));
  assert.deepEqual(await readWindowSchedule(7, base), DEFAULT_WINDOW_SCHEDULE);
  const written = await writeWindowSchedule(7, { enabled: true, windows: [weekdays] }, base);
  assert.equal(written.enabled, true);
  assert.deepEqual(await readWindowSchedule(7, base), written);
  // A second server's schedule coexists.
  await writeWindowSchedule(8, { enabled: false, windows: [{ days: [6], start: "10:00", end: "12:00" }] }, base);
  assert.equal(Object.keys(await readAllWindowSchedules(base)).length, 2);
  // Clearing the windows removes the entry entirely.
  await writeWindowSchedule(7, { enabled: false, windows: [] }, base);
  assert.deepEqual(await readWindowSchedule(7, base), DEFAULT_WINDOW_SCHEDULE);
  writeFileSync(path.join(base, "power-windows.json"), "{corrupt", "utf8");
  assert.deepEqual(await readAllWindowSchedules(base), {});
});

test("wiring is pinned: edges-only sweep, maintenance skip, route, and panel", () => {
  const runtime = readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("void sweepPowerSchedule().catch(() => {});"), "sweep rides the scheduler tick");
  assert.ok(runtime.includes("if (previous === desired) continue; // between edges, the operator is in charge"), "edges-only: manual control wins between transitions");
  assert.ok(runtime.includes("if (inMaintenance[key]?.enabled) continue;"), "maintenance silences the power scheduler");
  assert.ok(runtime.includes('desired === "online" && server.status === "offline"'), "only offline servers are schedule-started (crashed is the watchdog's job)");
  assert.ok(runtime.includes('stopFlow(id, "Power schedule")'));
  assert.ok(runtime.includes("export function powerScheduleChanged("), "edits re-arm the sweep");

  const route = readFileSync("src/app/api/servers/[id]/power-windows/route.ts", "utf8");
  assert.ok(route.includes("const problem = validatePowerWindow(candidate);"), "invalid windows are rejected loudly, not dropped");
  assert.ok(route.includes("powerScheduleChanged(server.id);"));
  assert.ok(route.includes("Enable needs at least one window"));

  const page = readFileSync("src/app/servers/[id]/settings/page.tsx", "utf8");
  assert.ok(page.includes("<PowerWindowsPanel serverId={s.id} accent={g.accent} />"));
  const panel = readFileSync("src/components/power-windows-panel.tsx", "utf8");
  assert.ok(panel.includes("Weekly power schedule"));
  assert.ok(panel.includes("manual power controls always win in between"));

  console.log("POWER_WINDOWS_SUITE_OK");
});
