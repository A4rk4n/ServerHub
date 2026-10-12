// Scheduled mod-update sweep (addon-update-sweep.ts): config
// normalization, due-time arithmetic, notification detail formatting,
// change-detection signatures, and the runtime/API wiring pins.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  DEFAULT_ADDON_SWEEP_CONFIG,
  SWEEP_HOURS_CEIL,
  SWEEP_HOURS_FLOOR,
  addonSweepDue,
  findingsSignature,
  formatAddonUpdateDetail,
  normalizeAddonSweepConfig,
} from "../src/lib/addon-update-sweep";

test("normalizeAddonSweepConfig defaults garbage and clamps the interval", () => {
  assert.deepEqual(normalizeAddonSweepConfig(undefined), DEFAULT_ADDON_SWEEP_CONFIG);
  assert.deepEqual(normalizeAddonSweepConfig("nope"), DEFAULT_ADDON_SWEEP_CONFIG);
  assert.equal(DEFAULT_ADDON_SWEEP_CONFIG.enabled, false, "contacting an external API on a schedule is opt-in");
  assert.deepEqual(normalizeAddonSweepConfig({ enabled: true, intervalHours: 1 }), { enabled: true, intervalHours: SWEEP_HOURS_FLOOR });
  assert.deepEqual(normalizeAddonSweepConfig({ enabled: true, intervalHours: 9999 }), { enabled: true, intervalHours: SWEEP_HOURS_CEIL });
  assert.deepEqual(normalizeAddonSweepConfig({ enabled: true, intervalHours: 12.5 }), { enabled: true, intervalHours: 24 }, "non-integers fall back to the default");
  assert.equal(normalizeAddonSweepConfig({ enabled: "yes", intervalHours: 24 }).enabled, false, "enabled must be literally true");
});

test("addonSweepDue: disabled never, never-run immediately, then only after the full interval", () => {
  const enabled = { enabled: true, intervalHours: 24 };
  const hour = 3_600_000;
  const now = 1_700_000_000_000;
  assert.equal(addonSweepDue(0, now, { enabled: false, intervalHours: 24 }), false, "disabled config is never due");
  assert.equal(addonSweepDue(0, now, enabled), true, "a never-run sweep is due immediately");
  assert.equal(addonSweepDue(now - 23 * hour, now, enabled), false, "23h of a 24h interval is not due");
  assert.equal(addonSweepDue(now - 24 * hour, now, enabled), true, "exactly the interval is due");
  assert.equal(addonSweepDue(now - 25 * hour, now, enabled), true);
});

test("formatAddonUpdateDetail names the first few updates and counts the rest", () => {
  const one = [{ name: "Lithium", installed: "1.0.0", latest: "1.1.0" }];
  assert.equal(formatAddonUpdateDetail(one), "Lithium 1.0.0 → 1.1.0");
  const five = [
    { name: "A", installed: "1", latest: "2" },
    { name: "B", installed: "1", latest: "2" },
    { name: "C", installed: "1", latest: "2" },
    { name: "D", installed: "1", latest: "2" },
    { name: "E", installed: "1", latest: "2" },
  ];
  assert.equal(formatAddonUpdateDetail(five), "A 1 → 2, B 1 → 2, C 1 → 2 and 2 more");
  assert.equal(formatAddonUpdateDetail(five.slice(0, 3)), "A 1 → 2, B 1 → 2, C 1 → 2", "no remainder suffix at exactly the cap");
  assert.equal(formatAddonUpdateDetail([]), "");
});

test("findingsSignature is order-insensitive and changes only when the offer changes", () => {
  const a = [
    { name: "Lithium", installed: "1.0.0", latest: "1.1.0" },
    { name: "Sodium", installed: "0.5", latest: "0.6" },
  ];
  const reversed = [a[1], a[0]];
  assert.equal(findingsSignature(a), findingsSignature(reversed), "ordering never looks like a change");
  const bumped = [a[0], { name: "Sodium", installed: "0.5", latest: "0.7" }];
  assert.notEqual(findingsSignature(a), findingsSignature(bumped), "a newer latest is a new offer");
  const installedMoved = [{ name: "Lithium", installed: "1.0.5", latest: "1.1.0" }];
  assert.equal(
    findingsSignature(installedMoved),
    findingsSignature([a[0]]),
    "the installed version is not part of the offer — partial manual updates do not re-notify"
  );
  assert.equal(findingsSignature([]), "");
});

test("runtime and API wiring: scheduler tick, notification kind, route, panel", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("void sweepAddonUpdates().catch(() => {});"), "sweep runs on the scheduler tick");
  assert.ok(runtime.includes('kind: "addon-update"'), "sweep emits the addon-update notification kind");
  assert.ok(runtime.includes('addon-update-sweep.json') && runtime.includes('addon-update-state.json'), "config and state live in separate sidecars");
  const notifications = fs.readFileSync("src/lib/notifications.ts", "utf8");
  assert.ok(notifications.includes('"addon-update"'), "notifications module knows the kind");
  const route = fs.readFileSync("src/app/api/addon-update-sweep/route.ts", "utf8");
  assert.ok(route.includes("sweep-now") && route.includes("normalizeAddonSweepConfig"), "route exposes run-now and normalized saves");
  const tools = fs.readFileSync("src/app/tools/page.tsx", "utf8");
  assert.ok(tools.includes("AddonUpdateSweepPanel"), "panel is mounted on the tools page");
  console.log("ADDON_SWEEP_SUITE_OK");
});
