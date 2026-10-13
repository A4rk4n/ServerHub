import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  COOLDOWN_MIN_CEIL,
  COOLDOWN_MIN_FLOOR,
  DEFAULT_DISK_ALERT_CONFIG,
  MIN_FREE_MB_CEIL,
  MIN_FREE_MB_FLOOR,
  diskAlertDetail,
  evaluateDiskFree,
  formatMb,
  isDiskAlertDue,
  normalizeDiskAlertConfig,
} from "../src/lib/disk-alerts";
import { notificationGroup } from "../src/lib/notifications";

test("disk alerts: config normalization", () => {
  assert.deepEqual(normalizeDiskAlertConfig(undefined), DEFAULT_DISK_ALERT_CONFIG);
  assert.deepEqual(normalizeDiskAlertConfig({ enabled: true, minFreeMb: 4096, cooldownMin: 60 }), { enabled: true, minFreeMb: 4096, cooldownMin: 60 });
  // enabled defaults ON — alert-only features are safe on
  assert.equal(normalizeDiskAlertConfig({}).enabled, true);
  assert.equal(normalizeDiskAlertConfig({ enabled: false }).enabled, false);
  // clamps
  assert.equal(normalizeDiskAlertConfig({ minFreeMb: 1 }).minFreeMb, MIN_FREE_MB_FLOOR);
  assert.equal(normalizeDiskAlertConfig({ minFreeMb: 99_999_999 }).minFreeMb, MIN_FREE_MB_CEIL);
  assert.equal(normalizeDiskAlertConfig({ cooldownMin: 1 }).cooldownMin, COOLDOWN_MIN_FLOOR);
  assert.equal(normalizeDiskAlertConfig({ cooldownMin: 999_999 }).cooldownMin, COOLDOWN_MIN_CEIL);
  // junk falls back
  assert.equal(normalizeDiskAlertConfig({ minFreeMb: "2048" }).minFreeMb, DEFAULT_DISK_ALERT_CONFIG.minFreeMb);
  assert.equal(normalizeDiskAlertConfig({ cooldownMin: 7.5 }).cooldownMin, DEFAULT_DISK_ALERT_CONFIG.cooldownMin);
});

test("disk alerts: breach evaluation", () => {
  assert.equal(evaluateDiskFree(2048, 2048), null, "exactly at the floor is not a breach");
  assert.deepEqual(evaluateDiskFree(2047, 2048), { freeMb: 2047, minFreeMb: 2048 });
  assert.equal(evaluateDiskFree(999_999, 2048), null);
  assert.equal(evaluateDiskFree(Number.NaN, 2048), null, "unreadable readings never alert");
  assert.equal(evaluateDiskFree(-5, 2048), null, "negative readings never alert");
});

test("disk alerts: cooldown", () => {
  const now = 1_700_000_000_000;
  assert.equal(isDiskAlertDue(now, 0, 360), true, "first alert fires immediately");
  assert.equal(isDiskAlertDue(now + 359 * 60_000, now, 360), false);
  assert.equal(isDiskAlertDue(now + 360 * 60_000, now, 360), true);
});

test("disk alerts: formatting", () => {
  assert.equal(formatMb(512), "512 MB");
  assert.equal(formatMb(1536), "1.5 GB");
  assert.equal(formatMb(20_480), "20 GB");
  assert.equal(diskAlertDetail({ freeMb: 900, minFreeMb: 2048 }), "900 MB free on the panel volume (threshold 2.0 GB)");
});

test("disk alerts: notification + runtime wiring", () => {
  assert.equal(notificationGroup("disk-low"), "always", "disk alerts bypass the status/crash/backup toggles");
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("void sweepDiskAlerts().catch(() => {})"), "the 15-second scheduler tick sweeps disk alerts");
  assert.ok(runtime.includes("diskAlertState.lastAlertAt = 0; // space recovered — re-arm immediately"), "recovery re-arms the alert");
  assert.ok(runtime.includes('void notify({ kind: "disk-low", serverName: "Panel", detail })'), "breaches notify fire-and-forget");
  assert.ok(runtime.includes('act(null, "guardrail", `Low disk space: ${detail}`)'), "breaches land in the activity feed");
  const route = fs.readFileSync("src/app/api/disk-alerts/route.ts", "utf8");
  assert.ok(route.includes('return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })'), "malformed JSON cannot reset the thresholds");
  console.log("DISK_ALERTS_SUITE_OK");
});
