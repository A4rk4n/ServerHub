// Panel self-check (self-check.ts): evaluator thresholds, verdict
// wording, worst-of rollup, and the route/panel wiring pins.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  evalAddonFiles,
  evalBackupArchives,
  evalConsoleBacklog,
  evalDatabase,
  evalDiskFree,
  evalSidecars,
  formatBytes,
  summarizeSelfCheck,
} from "../src/lib/self-check";

test("database verdicts: corruption fails, unknown warns, size only ever warns", () => {
  assert.equal(evalDatabase(1024, "ok").status, "ok");
  assert.equal(evalDatabase(2 * 1024 * 1024 * 1024, "ok").status, "warn", "a huge but healthy db is a warning, not a failure");
  assert.equal(evalDatabase(1024, "*** in database main *** page 3: btreeInitPage").status, "fail");
  assert.equal(evalDatabase(1024, null).status, "warn", "an unrunnable integrity check is never silently ok");
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), "3.0 GB");
  assert.equal(formatBytes(512), "1 KB", "sizes never render as 0 KB");
});

test("console backlog and disk thresholds", () => {
  assert.equal(evalConsoleBacklog(999_999).status, "ok");
  assert.equal(evalConsoleBacklog(1_000_001).status, "warn");
  assert.equal(evalDiskFree(null).status, "warn");
  assert.equal(evalDiskFree(511).status, "fail");
  assert.equal(evalDiskFree(2_047).status, "warn");
  assert.equal(evalDiskFree(2_048).status, "ok");
  assert.ok(evalDiskFree(20_480).detail.includes("20.0 GB"), "large values render in GB");
});

test("backup archives: missing fails (unrestorable), orphaned only warns", () => {
  assert.equal(evalBackupArchives([], 0, 0).status, "ok");
  const missing = evalBackupArchives(["nightly", "pre-update"], 0, 0);
  assert.equal(missing.status, "fail");
  assert.ok(missing.detail.includes("cannot be restored"));
  const orphaned = evalBackupArchives([], 3, 50 * 1024 * 1024);
  assert.equal(orphaned.status, "warn");
  assert.ok(orphaned.detail.includes("safe to delete") && orphaned.detail.includes("50.0 MB"));
});

test("sidecars and mod files", () => {
  assert.equal(evalSidecars([], 12).status, "ok");
  const bad = evalSidecars(["notifications.json"], 12);
  assert.equal(bad.status, "fail");
  assert.ok(bad.detail.includes("notifications.json"));
  assert.equal(evalAddonFiles([]).status, "ok");
  const gone = evalAddonFiles(["Lithium (Main)"]);
  assert.equal(gone.status, "warn");
  assert.ok(gone.detail.includes("Lithium (Main)"));
});

test("summary is worst-of; wiring pins hold", () => {
  const ok = { id: "a", label: "", status: "ok" as const, detail: "" };
  const warn = { ...ok, id: "b", status: "warn" as const };
  const fail = { ...ok, id: "c", status: "fail" as const };
  assert.equal(summarizeSelfCheck([ok, ok]).status, "ok");
  assert.equal(summarizeSelfCheck([ok, warn]).status, "warn");
  assert.equal(summarizeSelfCheck([ok, warn, fail]).status, "fail");
  assert.deepEqual(summarizeSelfCheck([ok, warn, fail]), { status: "fail", ok: 1, warn: 1, fail: 1 });

  const route = fs.readFileSync("src/app/api/self-check/route.ts", "utf8");
  assert.ok(route.includes('prepare("PRAGMA quick_check")'), "integrity uses PRAGMA quick_check");
  assert.ok(route.includes("evalBackupArchives") && route.includes("evalAddonFiles"), "route wires every evaluator");
  const tools = fs.readFileSync("src/app/tools/page.tsx", "utf8");
  assert.ok(tools.includes("SelfCheckPanel"), "panel is mounted on the tools page");
  console.log("SELF_CHECK_SUITE_OK");
});
