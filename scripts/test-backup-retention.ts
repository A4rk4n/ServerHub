// Unit suite for the pure backup-retention policy (src/lib/backup-retention).
// Enforcement (file deletion, rows, audit trail) is exercised through the
// runtime; the policy decisions themselves are verified here.

import test from "node:test";
import assert from "node:assert/strict";

import {
  clampRetentionCount,
  clampRetentionDays,
  selectBackupsToPrune,
  type RetentionBackup,
} from "../src/lib/backup-retention";

const now = new Date("2026-09-30T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

function fixture(): RetentionBackup[] {
  return [
    { id: 1, status: "complete", createdAt: daysAgo(40) },
    { id: 2, status: "complete", createdAt: daysAgo(20) },
    { id: 3, status: "failed", createdAt: daysAgo(15) },
    { id: 4, status: "complete", createdAt: daysAgo(10) },
    { id: 5, status: "building", createdAt: daysAgo(0) },
    { id: 6, status: "complete", createdAt: daysAgo(1) },
  ];
}

test("both limits disabled never prunes", () => {
  assert.deepEqual(
    selectBackupsToPrune({ backups: fixture(), retentionCount: 0, retentionDays: 0, now }),
    []
  );
});

test("count limit keeps the newest complete backups", () => {
  assert.deepEqual(
    selectBackupsToPrune({ backups: fixture(), retentionCount: 2, retentionDays: 0, now }),
    [1, 2]
  );
  assert.deepEqual(
    selectBackupsToPrune({ backups: fixture(), retentionCount: 4, retentionDays: 0, now }),
    []
  );
});

test("age limit prunes complete backups older than the cutoff", () => {
  assert.deepEqual(
    selectBackupsToPrune({ backups: fixture(), retentionCount: 0, retentionDays: 15, now }),
    [1, 2]
  );
  assert.deepEqual(
    selectBackupsToPrune({ backups: fixture(), retentionCount: 0, retentionDays: 45, now }),
    []
  );
});

test("count and age limits combine as a union", () => {
  assert.deepEqual(
    selectBackupsToPrune({ backups: fixture(), retentionCount: 3, retentionDays: 15, now }),
    [1, 2]
  );
  assert.deepEqual(
    selectBackupsToPrune({ backups: fixture(), retentionCount: 1, retentionDays: 30, now }),
    [1, 2, 4]
  );
});

test("building and failed backups are never pruned", () => {
  const pruned = selectBackupsToPrune({
    backups: fixture(),
    retentionCount: 1,
    retentionDays: 1,
    now,
  });
  assert.ok(!pruned.includes(3), "failed backup must not be pruned");
  assert.ok(!pruned.includes(5), "building backup must not be pruned");
});

test("protected ids survive every limit", () => {
  assert.deepEqual(
    selectBackupsToPrune({
      backups: fixture(),
      retentionCount: 1,
      retentionDays: 1,
      protectedIds: [1, 2],
      now,
    }),
    [4]
  );
});

test("creation-time ties break toward keeping the higher id", () => {
  const sameInstant: RetentionBackup[] = [
    { id: 10, status: "complete", createdAt: daysAgo(2) },
    { id: 11, status: "complete", createdAt: daysAgo(2) },
  ];
  assert.deepEqual(
    selectBackupsToPrune({ backups: sameInstant, retentionCount: 1, retentionDays: 0, now }),
    [10]
  );
});

test("backups without a creation time are exempt from the age limit", () => {
  const rows: RetentionBackup[] = [
    { id: 20, status: "complete", createdAt: null },
    { id: 21, status: "complete", createdAt: daysAgo(90) },
  ];
  assert.deepEqual(
    selectBackupsToPrune({ backups: rows, retentionCount: 0, retentionDays: 30, now }),
    [21]
  );
});

test("clamping bounds retention settings and rejects garbage", () => {
  assert.equal(clampRetentionCount(-5), 0);
  assert.equal(clampRetentionCount(3.6), 4);
  assert.equal(clampRetentionCount(1000), 100);
  assert.equal(clampRetentionCount(Number.NaN), 0);
  assert.equal(clampRetentionDays(-1), 0);
  assert.equal(clampRetentionDays(400), 365);
  assert.equal(clampRetentionDays(Number.POSITIVE_INFINITY), 0);
  console.log("BACKUP_RETENTION_POLICY_OK");
});
