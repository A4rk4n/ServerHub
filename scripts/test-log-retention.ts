import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  ARCHIVE_KEEP_CEIL,
  ARCHIVE_KEEP_FLOOR,
  DEFAULT_LOG_RETENTION_CONFIG,
  LOG_SWEEP_EVERY_MS,
  PRUNE_BATCH,
  RETENTION_DAYS_CEIL,
  RETENTION_DAYS_FLOOR,
  archiveFileName,
  formatArchiveLine,
  normalizeLogRetentionConfig,
  retentionCutoff,
} from "../src/lib/log-retention";

test("log retention: config normalization", () => {
  assert.deepEqual(normalizeLogRetentionConfig(undefined), DEFAULT_LOG_RETENTION_CONFIG);
  assert.deepEqual(
    normalizeLogRetentionConfig({ enabled: true, retentionDays: 7, archive: false, archiveKeep: 10 }),
    { enabled: true, retentionDays: 7, archive: false, archiveKeep: 10 }
  );
  // safe-by-default: enabled + archive both default ON
  assert.equal(normalizeLogRetentionConfig({}).enabled, true);
  assert.equal(normalizeLogRetentionConfig({}).archive, true);
  assert.equal(normalizeLogRetentionConfig({ enabled: false }).enabled, false);
  // clamps
  assert.equal(normalizeLogRetentionConfig({ retentionDays: 0 }).retentionDays, RETENTION_DAYS_FLOOR);
  assert.equal(normalizeLogRetentionConfig({ retentionDays: 9999 }).retentionDays, RETENTION_DAYS_CEIL);
  assert.equal(normalizeLogRetentionConfig({ archiveKeep: 0 }).archiveKeep, ARCHIVE_KEEP_FLOOR);
  assert.equal(normalizeLogRetentionConfig({ archiveKeep: 9999 }).archiveKeep, ARCHIVE_KEEP_CEIL);
  // junk falls back
  assert.equal(normalizeLogRetentionConfig({ retentionDays: "30" }).retentionDays, DEFAULT_LOG_RETENTION_CONFIG.retentionDays);
  assert.equal(normalizeLogRetentionConfig({ archiveKeep: 7.5 }).archiveKeep, DEFAULT_LOG_RETENTION_CONFIG.archiveKeep);
  // sweep cadence and batch bound are sane
  assert.equal(LOG_SWEEP_EVERY_MS, 3_600_000);
  assert.ok(PRUNE_BATCH >= 1000);
});

test("log retention: cutoff math", () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);
  assert.equal(retentionCutoff(now, 30).getTime(), now - 30 * 86_400_000);
  assert.equal(retentionCutoff(now, 1).getTime(), now - 86_400_000);
});

test("log retention: archive file naming", () => {
  const stamp = Date.UTC(2026, 9, 2, 8, 15, 0);
  assert.equal(archiveFileName(3, stamp), "server-3-20261002-081500.log.gz");
  // lexicographic order follows time order
  assert.ok(archiveFileName(3, stamp) < archiveFileName(3, stamp + 61_000));
});

test("log retention: archive line format", () => {
  const ts = new Date(Date.UTC(2026, 9, 2, 7, 30, 0));
  assert.equal(
    formatArchiveLine({ ts, level: "info", source: "Server", message: "Done (3.2s)!" }),
    "2026-10-02T07:30:00.000Z [info] Server: Done (3.2s)!"
  );
  assert.equal(formatArchiveLine({ ts: null, level: "warn", source: "Console", message: "x" }), "unknown-time [warn] Console: x");
});

test("log retention: runtime + API wiring", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("void sweepLogRetention().catch(() => {})"), "the scheduler tick sweeps retention");
  assert.ok(runtime.includes("lte(consoleLogs.id, maxId), lt(consoleLogs.ts, cutoff)"), "deletion is bounded by the archived batch");
  assert.ok(runtime.includes("zlib.gzipSync(body)"), "archives are gzipped");
  assert.ok(runtime.includes("kept.slice(0, Math.max(0, kept.length - config.archiveKeep))"), "oldest archives beyond the cap are deleted");
  assert.ok(runtime.includes("logRetentionState.lastSweepAt = 0; // re-sweep promptly under the new config"), "saving a config re-schedules the sweep");
  const route = fs.readFileSync("src/app/api/log-retention/route.ts", "utf8");
  assert.ok(route.includes('return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })'), "malformed JSON cannot reset the window");
  console.log("LOG_RETENTION_SUITE_OK");
});
