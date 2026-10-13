// Fleet-wide backup (bulk-backup.ts): eligibility, partitioning, batch
// labels, outcome summaries, and the route/UI wiring pins.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  BULK_LIMIT,
  bulkBackupEligible,
  bulkBackupLabel,
  partitionBulkBackup,
  summarizeBulkBackup,
} from "../src/lib/bulk-backup";

test("bulkBackupEligible: only half-written directories are off limits", () => {
  for (const status of ["online", "offline", "crashed", "error", "starting", "stopping", "restarting"]) {
    assert.equal(bulkBackupEligible(status), true, `${status} servers snapshot fine`);
  }
  assert.equal(bulkBackupEligible("installing"), false, "mid-install archives look restorable but are not");
  assert.equal(bulkBackupEligible("updating"), false);
});

test("partitionBulkBackup splits and preserves order", () => {
  const fleet = [
    { id: 1, status: "online" },
    { id: 2, status: "installing" },
    { id: 3, status: "offline" },
    { id: 4, status: "updating" },
  ];
  const { eligible, skipped } = partitionBulkBackup(fleet);
  assert.deepEqual(eligible.map((s) => s.id), [1, 3]);
  assert.deepEqual(skipped.map((s) => s.id), [2, 4]);
  assert.ok(BULK_LIMIT >= 100, "shares the fleet-size cap with bulk power");
});

test("bulkBackupLabel stamps one minute-resolution name per batch", () => {
  const label = bulkBackupLabel(new Date(2026, 9, 12, 9, 5)); // 2026-10-12 09:05 local
  assert.equal(label, "fleet-2026-10-12-0905");
  assert.match(label, /^fleet-\d{4}-\d{2}-\d{2}-\d{4}$/, "filename-safe: feeds createBackup's safeFileName unchanged");
});

test("summarizeBulkBackup reads like a fleet-bar notice", () => {
  assert.equal(
    summarizeBulkBackup([
      { id: 1, name: "a", outcome: "started" },
      { id: 2, name: "b", outcome: "started" },
      { id: 3, name: "c", outcome: "skipped", reason: "status is installing" },
    ]),
    "Started 2 backups, skipped 1"
  );
  assert.equal(summarizeBulkBackup([{ id: 1, name: "a", outcome: "started" }]), "Started 1 backup");
  assert.equal(
    summarizeBulkBackup([
      { id: 1, name: "a", outcome: "failed", reason: "boom" },
    ]),
    "Started 0 backups, 1 failed"
  );
});

test("route and fleet-bar wiring", () => {
  const route = fs.readFileSync("src/app/api/servers/bulk-backup/route.ts", "utf8");
  assert.ok(route.includes("partitionBulkBackup") && route.includes("bulkBackupLabel"), "route uses the pure partition + label");
  assert.ok(route.includes('eq(backups.status, "building")'), "route never stacks a second archive on a building one");
  assert.ok(route.includes('createBackup(server.id, label, "fleet backup")'), "archives build through the existing runtime path");
  const view = fs.readFileSync("src/components/servers-view.tsx", "utf8");
  assert.ok(view.includes("runBulkBackup") && view.includes("/api/servers/bulk-backup"), "fleet bar calls the bulk route");
  assert.ok(view.includes('arming !== "backup"'), "backup button uses the same two-click arming as power actions");
  console.log("BULK_BACKUP_SUITE_OK");
});
