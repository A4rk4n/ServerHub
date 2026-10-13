import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_HISTORY_DAYS,
  buildUsageReport,
  classifyPath,
  cleanupHints,
  computeGrowth,
  formatBytes,
  normalizeUsageHistory,
  recordUsageSnapshot,
} from "../src/lib/disk-usage";

const MB = 1024 * 1024;
const GB = 1024 * MB;

test("disk usage: path classification covers the supported game layouts", () => {
  assert.equal(classifyPath("world/region/r.0.0.mca"), "world");
  assert.equal(classifyPath("world_nether/DIM-1/data.dat"), "world");
  assert.equal(classifyPath("Saved/SaveGames/slot0.sav"), "world", "UE-style Saved dir, case-insensitive");
  assert.equal(classifyPath("Worlds/main.wld"), "world");
  assert.equal(classifyPath("my-world.wld"), "world", "top-level save files count as world");
  assert.equal(classifyPath("mods/create-1.21.jar"), "mods");
  assert.equal(classifyPath("plugins/Essentials.jar"), "mods");
  assert.equal(classifyPath("BepInEx/core/patcher.dll"), "mods");
  assert.equal(classifyPath("logs/2026-09-30-1.log.gz"), "logs");
  assert.equal(classifyPath("crash-reports/crash-2026.txt"), "logs");
  assert.equal(classifyPath("latest.log"), "logs");
  assert.equal(classifyPath("console.log.3"), "logs");
  assert.equal(classifyPath("server.jar"), "rest");
  assert.equal(classifyPath("config/server.toml"), "rest");
  assert.equal(classifyPath("libraries-info.txt"), "rest", "only the top-level segment matches directory lists");
});

test("disk usage: report totals, categories, and biggest-file ranking", () => {
  const report = buildUsageReport(
    [
      { path: "world/level.dat", sizeBytes: 5 * MB },
      { path: "world/region/r.0.0.mca", sizeBytes: 40 * MB },
      { path: "mods/big-mod.jar", sizeBytes: 30 * MB },
      { path: "logs/latest.log", sizeBytes: 10 * MB },
      { path: "server.jar", sizeBytes: 50 * MB },
      { path: "broken-size.bin", sizeBytes: Number.NaN },
    ],
    false,
    3
  );
  assert.equal(report.totalBytes, 135 * MB);
  assert.deepEqual(report.categories, { world: 45 * MB, mods: 30 * MB, logs: 10 * MB, rest: 50 * MB });
  assert.equal(report.fileCount, 6);
  assert.deepEqual(
    report.biggest.map((file) => file.path),
    ["server.jar", "world/region/r.0.0.mca", "mods/big-mod.jar"],
    "ranked by size desc, capped at the limit"
  );
  assert.equal(report.biggest[0].category, "rest");
  assert.equal(report.truncated, false);
});

test("disk usage: snapshot history is normalized, deduped per day, and capped", () => {
  assert.deepEqual(normalizeUsageHistory(undefined), {});
  assert.deepEqual(normalizeUsageHistory({ "x": [], "1": "junk", "2": [{ day: "bad", totalBytes: 1 }, { totalBytes: 2 }] }), {});
  let history = normalizeUsageHistory({ "7": [{ day: "2026-09-29", totalBytes: 100 }, { day: "2026-09-28", totalBytes: 90 }] });
  assert.deepEqual(history["7"].map((row) => row.day), ["2026-09-28", "2026-09-29"], "rows are sorted by day");

  history = recordUsageSnapshot(history, 7, 120, new Date("2026-09-30T08:00:00Z"));
  history = recordUsageSnapshot(history, 7, 130, new Date("2026-09-30T20:00:00Z"));
  assert.deepEqual(history["7"].at(-1), { day: "2026-09-30", totalBytes: 130 }, "the latest scan of a day wins");
  assert.equal(history["7"].length, 3);

  let crowded = normalizeUsageHistory({});
  for (let i = 0; i < MAX_HISTORY_DAYS + 20; i++) {
    const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
    crowded = recordUsageSnapshot(crowded, 1, i, day);
  }
  assert.equal(crowded["1"].length, MAX_HISTORY_DAYS, "history never exceeds the cap");
});

test("disk usage: growth compares against snapshots old enough to matter", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const history = normalizeUsageHistory({
    "3": [
      { day: "2026-09-20", totalBytes: 1000 },
      { day: "2026-09-24", totalBytes: 1500 },
      { day: "2026-09-30", totalBytes: 1800 },
      { day: "2026-10-01", totalBytes: 1900 },
    ],
  });
  const growth = computeGrowth(history, 3, 2000, now);
  assert.equal(growth.dayBytes, 200, "vs the newest snapshot at least 1 day old (09-30)");
  assert.equal(growth.weekBytes, 500, "vs the newest snapshot at least 7 days old (09-24)");
  assert.deepEqual(computeGrowth(history, 99, 500, now), { dayBytes: null, weekBytes: null }, "no history, no growth");
  const youngOnly = normalizeUsageHistory({ "3": [{ day: "2026-10-01", totalBytes: 100 }] });
  assert.deepEqual(computeGrowth(youngOnly, 3, 150, now), { dayBytes: null, weekBytes: null }, "today's snapshot alone is too young");
});

test("disk usage: cleanup hints fire on real problems only, capped at four", () => {
  const quiet = cleanupHints({
    report: buildUsageReport([{ path: "world/level.dat", sizeBytes: 10 * MB }]),
    backupsBytes: 50 * MB,
    backupsCount: 3,
    retentionConfigured: false,
    crashReportCount: 2,
  });
  assert.deepEqual(quiet, [], "a healthy server gets no nagging");

  const noisy = cleanupHints({
    report: buildUsageReport([
      { path: "logs/huge.log", sizeBytes: 250 * MB },
      { path: "world/giant-region.mca", sizeBytes: 3 * GB },
    ]),
    backupsBytes: 12 * GB,
    backupsCount: 25,
    retentionConfigured: false,
    crashReportCount: 15,
  });
  assert.equal(noisy.length, 4);
  assert.match(noisy[0], /Logs take 250 MB/);
  assert.match(noisy[1], /15 crash reports/);
  assert.match(noisy[2], /25 backups \(12 GB\) with no retention policy/);
  assert.match(noisy[3], /world\/giant-region\.mca alone is 3.0 GB/);

  const retained = cleanupHints({
    report: buildUsageReport([]),
    backupsBytes: 12 * GB,
    backupsCount: 25,
    retentionConfigured: true,
    crashReportCount: 0,
  });
  assert.deepEqual(retained, [], "a retention policy silences the backup hint");

  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "2 KB");
  assert.equal(formatBytes(5 * MB + 250 * 1024), "5.2 MB");
  assert.equal(formatBytes(15 * GB), "15 GB");
  assert.equal(formatBytes(-3 * MB), "-3.0 MB");
  console.log("DISK_USAGE_SUITE_OK");
});
