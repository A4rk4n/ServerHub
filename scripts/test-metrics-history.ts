// Unit suite for persistent metrics history: bucket aggregation, defensive
// JSONL parsing, retention pruning, the on-disk round trip (record →
// flush → read), and the runtime/route/UI wiring.

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BUCKET_MS,
  MAX_POINTS,
  RETENTION_MS,
  aggregateBucket,
  bucketStart,
  flushMetricsHistory,
  historyFile,
  parseHistoryLine,
  pruneHistory,
  readHistory,
  recordMetricsSample,
} from "../src/lib/metrics-history";

const sample = (t: number, cpu: number, ram: number, players = 0, tps: number | null = null) => ({ t, cpu, ram, players, tps });

test("samples aggregate into one-minute buckets: mean cpu/ram, peak players, last tps", () => {
  const t = 1_700_000_000_000 - (1_700_000_000_000 % BUCKET_MS);
  assert.equal(bucketStart(t + 59_999), t);
  assert.equal(bucketStart(t + 60_000), t + BUCKET_MS);
  const point = aggregateBucket(t + 5000, [sample(t, 10, 100, 2, 20), sample(t + 2000, 20, 200, 5, null), sample(t + 4000, 40, 300, 1, 19.5)]);
  assert.deepEqual(point, { t, cpu: 23.3, ram: 200, players: 5, tps: 19.5 });
  assert.equal(aggregateBucket(t, []), null, "an empty bucket yields nothing");
});

test("history lines parse defensively", () => {
  assert.deepEqual(parseHistoryLine('{"t":1,"cpu":2.5,"ram":300,"players":4,"tps":null}'), { t: 1, cpu: 2.5, ram: 300, players: 4, tps: null });
  assert.equal(parseHistoryLine("not json"), null);
  assert.equal(parseHistoryLine('{"t":"soon","cpu":1,"ram":1,"players":0}'), null);
  assert.equal(parseHistoryLine('{"t":1,"cpu":null,"ram":1,"players":0}'), null);
  assert.equal(parseHistoryLine(""), null);
});

test("retention pruning drops points outside the window and caps the count", () => {
  const now = Date.now();
  const fresh = { t: now - 1000, cpu: 1, ram: 1, players: 0, tps: null };
  const stale = { t: now - RETENTION_MS - BUCKET_MS, cpu: 1, ram: 1, players: 0, tps: null };
  assert.deepEqual(pruneHistory([stale, fresh], now), [fresh]);
  const flood = Array.from({ length: MAX_POINTS + 50 }, (_, i) => ({ t: now - i * 1000, cpu: 1, ram: 1, players: 0, tps: null }));
  assert.equal(pruneHistory(flood, now).length, MAX_POINTS);
  assert.equal(MAX_POINTS, 2880, "48h of one-minute buckets");
});

test("record → bucket roll → flush → read round-trips through the JSONL file", async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hub-metrics-"));
  const now = Date.now();
  const b0 = bucketStart(now - 3 * BUCKET_MS);
  const b1 = b0 + BUCKET_MS;
  await recordMetricsSample(7, sample(b0, 10, 100, 1), base);
  await recordMetricsSample(7, sample(b0 + 2000, 30, 300, 3), base);
  assert.equal(fs.existsSync(historyFile(7, base)), false, "nothing is written until a bucket completes");
  await recordMetricsSample(7, sample(b1, 50, 500, 2), base); // rolls bucket b0 to disk
  await flushMetricsHistory(7, base); // flushes the partial b1 bucket (server stopped)
  const points = await readHistory(7, 24 * 60 * 60 * 1000, base);
  assert.deepEqual(points, [
    { t: b0, cpu: 20, ram: 200, players: 3, tps: null },
    { t: b1, cpu: 50, ram: 500, players: 2, tps: null },
  ]);
  await flushMetricsHistory(7, base);
  assert.deepEqual(await readHistory(7, 24 * 60 * 60 * 1000, base), points, "a second flush appends nothing");
  await fsp.appendFile(historyFile(7, base), "garbage line\n{\"t\":1}\n", "utf8");
  assert.deepEqual(await readHistory(7, 24 * 60 * 60 * 1000, base), points, "corrupt lines are skipped, not fatal");
  await fsp.rm(base, { recursive: true, force: true });
});

test("collection is wired into the runtime, the route is bounded, and the console offers a 24h view", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("void recordMetricsSample("), "sampling records history without ever awaiting it");
  assert.ok(runtime.includes("void flushMetricsHistory("), "process exit flushes the partial bucket");
  const route = fs.readFileSync("src/app/api/servers/[id]/stats/history/route.ts", "utf8");
  assert.ok(route.includes("Math.min(48"), "the window is clamped to the retention cap");
  assert.ok(route.includes("readHistory"), "the route serves persisted history");
  const view = fs.readFileSync("src/components/console-view.tsx", "utf8");
  assert.ok(view.includes("stats/history?hours=24"), "the console fetches the 24h view");
  assert.ok(view.includes('"live"') && view.includes('"24h"'), "the range toggle exists");
  assert.ok(view.includes("day-ram") && view.includes("day-players"), "the 24h view adds RAM and players charts");
  console.log("METRICS_HISTORY_SUITE_OK");
});
