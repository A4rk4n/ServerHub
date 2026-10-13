// F55 — tiered (grandfather-father) backup retention (v2.63.0).
// ISO week/day keys, survivor selection (newest per day slot + newest per
// week slot), sidecar round trip, and pinned wiring: the tiered branch in
// applyBackupRetention, the prune-task skip condition, route, and panel.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { RetentionBackup } from "../src/lib/backup-retention";
import {
  DEFAULT_BACKUP_TIERS,
  MAX_DAILY_TIERS,
  MAX_WEEKLY_TIERS,
  isoWeekKey,
  localDayKey,
  normalizeBackupTiers,
  readAllBackupTiers,
  readBackupTiers,
  selectTieredBackupsToPrune,
  selectTieredSurvivors,
  writeBackupTiers,
} from "../src/lib/backup-tiers";

function backup(id: number, iso: string, status = "complete"): RetentionBackup {
  return { id, status, createdAt: new Date(iso) };
}

test("normalizeBackupTiers clamps, defaults, and gates enabled", () => {
  assert.deepEqual(normalizeBackupTiers(null), { enabled: false, daily: 7, weekly: 4 });
  assert.deepEqual(normalizeBackupTiers({ enabled: true, daily: 3, weekly: 2 }), { enabled: true, daily: 3, weekly: 2 });
  assert.equal(normalizeBackupTiers({ enabled: true, daily: 999, weekly: 999 }).daily, MAX_DAILY_TIERS);
  assert.equal(normalizeBackupTiers({ enabled: true, daily: 999, weekly: 999 }).weekly, MAX_WEEKLY_TIERS);
  assert.equal(normalizeBackupTiers({ enabled: true, daily: 0, weekly: 0 }).enabled, false, "0+0 keeps nothing — meaningless");
  assert.equal(normalizeBackupTiers({ enabled: true, daily: -1, weekly: 1.5 }).daily, 7, "junk falls back to defaults");
  assert.deepEqual(DEFAULT_BACKUP_TIERS, { enabled: false, daily: 7, weekly: 4 });
});

test("day and ISO week keys handle year boundaries", () => {
  assert.equal(localDayKey(new Date(2026, 9, 4)), "2026-10-04");
  assert.equal(isoWeekKey(new Date(2026, 9, 4)), "2026-W40", "Sun Oct 4 2026 closes ISO week 40");
  assert.equal(isoWeekKey(new Date(2026, 9, 5)), "2026-W41", "Mon Oct 5 opens week 41");
  // ISO edge: Jan 1 2027 is a Friday → still week 53 of 2026.
  assert.equal(isoWeekKey(new Date(2027, 0, 1)), "2026-W53");
  assert.equal(isoWeekKey(new Date(2027, 0, 4)), "2027-W01", "Jan 4 is always week 1");
  // Dec 29 2025 is a Monday → already 2026-W01.
  assert.equal(isoWeekKey(new Date(2025, 11, 29)), "2026-W01");
});

test("tiered survivors: newest per day slot, newest per week slot, dedup across tiers", () => {
  // Three backups on Oct 4, one each on Oct 3 / Oct 2 / Sep 20 / Aug 1.
  const rows = [
    backup(1, "2026-08-01T12:00:00"),
    backup(2, "2026-09-20T12:00:00"),
    backup(3, "2026-10-02T12:00:00"),
    backup(4, "2026-10-03T12:00:00"),
    backup(5, "2026-10-04T08:00:00"),
    backup(6, "2026-10-04T12:00:00"),
    backup(7, "2026-10-04T18:00:00"),
  ];
  const tiers = { enabled: true, daily: 2, weekly: 3 };
  const survivors = selectTieredSurvivors(rows, tiers);
  // Daily slots: Oct 4 (newest = #7) and Oct 3 (#4).
  // Week slots: W40 (newest = #7, dedup), W39 = Oct 2's week? Oct 2 2026 is Friday of W40.
  // Oct 2/3/4 are all ISO week 40 → weekly slots: W40 (#7), W38 (Sep 20 → #2), W31 (Aug 1 → #1).
  assert.deepEqual([...survivors].sort((a, b) => a - b), [1, 2, 4, 7]);
  const pruned = selectTieredBackupsToPrune(rows, tiers);
  assert.deepEqual(pruned, [3, 5, 6], "mid-day duplicates and out-of-slot days go");
  // Disabled or zero tiers prune nothing.
  assert.deepEqual(selectTieredBackupsToPrune(rows, { enabled: false, daily: 2, weekly: 3 }), []);
});

test("protected, building, and timestamp-less backups are never pruned", () => {
  const rows = [
    backup(1, "2026-10-01T12:00:00"),
    backup(2, "2026-10-02T12:00:00"),
    backup(3, "2026-10-03T12:00:00", "building"),
    backup(4, "2026-10-04T12:00:00"),
    { id: 5, status: "complete", createdAt: null },
  ];
  const tiers = { enabled: true, daily: 1, weekly: 1 };
  const pruned = selectTieredBackupsToPrune(rows, tiers, [1]);
  // #4 survives (newest day+week slot), #1 protected, #3 building, #5 no timestamp → only #2 goes.
  assert.deepEqual(pruned, [2]);
});

test("sidecar round trip: write, read, disable deletes, corrupt degrades", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "backup-tiers-"));
  assert.deepEqual(await readBackupTiers(3, base), DEFAULT_BACKUP_TIERS);
  await writeBackupTiers(3, { enabled: true, daily: 5, weekly: 2 }, base);
  assert.deepEqual(await readBackupTiers(3, base), { enabled: true, daily: 5, weekly: 2 });
  await writeBackupTiers(4, { enabled: true, daily: 1, weekly: 0 }, base);
  assert.equal(Object.keys(await readAllBackupTiers(base)).length, 2);
  await writeBackupTiers(3, { enabled: false, daily: 5, weekly: 2 }, base);
  assert.deepEqual(await readBackupTiers(3, base), DEFAULT_BACKUP_TIERS, "disable removes the entry");
  writeFileSync(path.join(base, "backup-tiers.json"), "{nope", "utf8");
  assert.deepEqual(await readAllBackupTiers(base), {});
});

test("wiring is pinned: runtime tiered branch, prune-task skip, route, panel", () => {
  const runtime = readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("const tiers = await readBackupTiers(serverId);"), "applyBackupRetention consults tiers");
  assert.ok(runtime.includes("? selectTieredBackupsToPrune(rows, tiers, protectedIds)"), "tiered selection replaces flat limits while enabled");
  assert.ok(runtime.includes('if (!pruneTiers.enabled && server.backupRetentionCount === 0 && server.backupRetentionDays === 0) {'), "scheduled prunes no longer skip when tiers are on");
  assert.ok(runtime.includes("`keep ${tiers.daily} daily`"), "audit trail names the tiered limits");

  const route = readFileSync("src/app/api/servers/[id]/backup-tiers/route.ts", "utf8");
  assert.ok(route.includes("wouldPrune: pruneIds.length"), "the API previews what a policy would prune");
  assert.ok(route.includes("Enable needs at least one daily or weekly slot"));
  assert.ok(route.includes("server.updateSafetyBackupId"), "the update safety backup stays protected");

  const page = readFileSync("src/app/servers/[id]/settings/page.tsx", "utf8");
  assert.ok(page.includes("<BackupTiersPanel serverId={s.id} accent={g.accent} />"));
  const panel = readFileSync("src/components/backup-tiers-panel.tsx", "utf8");
  assert.ok(panel.includes("Tiered backup retention"));
  assert.ok(panel.includes("would prune"), "the panel shows the preview before anything is deleted");

  console.log("BACKUP_TIERS_SUITE_OK");
});
