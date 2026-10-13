import assert from "node:assert/strict";
import test from "node:test";
import {
  DIGEST_WINDOW_MS,
  MAX_DIGEST_ROWS,
  aggregateSessions,
  digestDue,
  digestWindow,
  formatDigest,
  normalizeDigestConfig,
  uptimePercent,
  type ServerDigestRow,
} from "../src/lib/digest";
import { buildWebhookBody, notificationGroup, shouldNotify } from "../src/lib/notifications";

const row = (overrides: Partial<ServerDigestRow> = {}): ServerDigestRow => ({
  name: "alpha",
  uptimePct: 100,
  uniquePlayers: 0,
  peakConcurrent: 0,
  playtimeSec: 0,
  backupsOk: 0,
  backupsFailed: 0,
  crashes: 0,
  guardrails: 0,
  updateAvailable: null,
  ...overrides,
});

test("digest: config normalization and due logic", () => {
  assert.deepEqual(normalizeDigestConfig(undefined), { enabled: false, cadence: "daily", hour: 9 });
  assert.deepEqual(normalizeDigestConfig({ enabled: true, cadence: "weekly", hour: 23 }), { enabled: true, cadence: "weekly", hour: 23 });
  assert.deepEqual(normalizeDigestConfig({ enabled: "yes", cadence: "hourly", hour: 99 }), { enabled: false, cadence: "daily", hour: 9 });

  const daily = { enabled: true, cadence: "daily" as const, hour: 9 };
  const wedBefore = new Date(2026, 8, 30, 8, 59); // Wed Sep 30 08:59 local
  const wedAfter = new Date(2026, 8, 30, 9, 1);
  assert.equal(digestDue(daily, null, wedBefore), false, "not due before the configured hour");
  assert.equal(digestDue(daily, null, wedAfter), true, "due after the hour with no prior send");
  const sentToday = new Date(2026, 8, 30, 9, 0, 30).getTime();
  assert.equal(digestDue(daily, sentToday, new Date(2026, 8, 30, 15, 0)), false, "already sent today");
  const sentYesterday = new Date(2026, 8, 29, 9, 5).getTime();
  assert.equal(digestDue(daily, sentYesterday, wedAfter), true, "yesterday's send does not block today");
  assert.equal(digestDue({ ...daily, enabled: false }, null, wedAfter), false, "disabled never fires");

  const weekly = { enabled: true, cadence: "weekly" as const, hour: 9 };
  assert.equal(digestDue(weekly, null, wedAfter), false, "weekly only fires on Monday");
  const monday = new Date(2026, 8, 28, 9, 30); // Mon Sep 28
  assert.equal(monday.getDay(), 1);
  assert.equal(digestDue(weekly, null, monday), true);
  assert.equal(digestDue(weekly, new Date(2026, 8, 21, 9, 30).getTime(), monday), true, "last Monday's send does not block this Monday");
});

test("digest: reporting window sizes", () => {
  const now = new Date(2026, 9, 1, 9, 0);
  const daily = digestWindow("daily", now);
  assert.equal(daily.until - daily.since, DIGEST_WINDOW_MS.daily);
  assert.equal(daily.until, now.getTime());
  const weekly = digestWindow("weekly", now);
  assert.equal(weekly.until - weekly.since, 7 * 24 * 3600 * 1000);
});

test("digest: session aggregation clips, dedupes, and finds the real peak", () => {
  const since = 1_000_000;
  const until = since + 3_600_000; // one hour window
  const empty = aggregateSessions([], since, until);
  assert.deepEqual(empty, { uniquePlayers: 0, peakConcurrent: 0, playtimeSec: 0 });

  const sessions = [
    { name: "Alice", joinedAt: since - 600_000, leftAt: since + 600_000 }, // 10 min inside
    { name: "Bob", joinedAt: since + 300_000, leftAt: since + 900_000 }, // overlaps Alice 5 min
    { name: "alice", joinedAt: since + 1_800_000, leftAt: null }, // open session, 30 min to window end
    { name: "Zoe", joinedAt: until + 1, leftAt: null }, // outside window
  ];
  const agg = aggregateSessions(sessions, since, until);
  assert.equal(agg.uniquePlayers, 2, "Alice counted once (case-insensitive), Zoe outside");
  assert.equal(agg.peakConcurrent, 2, "Alice+Bob overlap");
  assert.equal(agg.playtimeSec, (600_000 + 600_000 + 1_800_000) / 1000);
  // back-to-back sessions do not double-count the peak
  const serial = aggregateSessions(
    [
      { name: "A", joinedAt: since, leftAt: since + 1000 },
      { name: "B", joinedAt: since + 1000, leftAt: since + 2000 },
    ],
    since,
    until
  );
  assert.equal(serial.peakConcurrent, 1);
});

test("digest: uptime percent from history buckets", () => {
  const since = 0;
  const until = 60 * 60_000; // 60 minutes
  assert.equal(uptimePercent([], since, until), 0);
  const half = Array.from({ length: 30 }, (_, i) => i * 60_000);
  assert.equal(uptimePercent(half, since, until), 50);
  const full = Array.from({ length: 60 }, (_, i) => i * 60_000);
  assert.equal(uptimePercent(full, since, until), 100);
  // duplicates and out-of-window buckets never inflate the number
  assert.equal(uptimePercent([...full, ...full, until + 60_000, -60_000], since, until), 100);
});

test("digest: formatting is deterministic, capped, and webhook-ready", () => {
  const until = new Date(Date.UTC(2026, 9, 1, 12, 0, 0));
  const emptyDigest = formatDigest("daily", until, []);
  assert.match(emptyDigest.title, /Daily digest — 2026-10-01 — 0 servers/);
  assert.match(emptyDigest.detail, /nothing to report/i);

  const busy = formatDigest("weekly", until, [
    row({ name: "lobby", uptimePct: 99.5, uniquePlayers: 12, peakConcurrent: 5, playtimeSec: 7_200, backupsOk: 7, updateAvailable: true }),
    row({ name: "survival", uptimePct: 72.1, crashes: 2, guardrails: 1, backupsFailed: 1, playtimeSec: 59 }),
  ]);
  assert.match(busy.title, /Weekly digest/);
  assert.match(busy.detail, /\*\*lobby\*\* — uptime 99\.5% · players 12 \(peak 5\) · playtime 2\.0h · backups 7✓\/0✗ · ⬆️ update available/);
  assert.match(busy.detail, /\*\*survival\*\*.*🔥 2 crashes · 📈 1 guardrail/);
  assert.match(busy.detail, /playtime 59s/);
  assert.match(busy.detail, /updates pending 1/);
  assert.doesNotMatch(busy.detail, /undefined|NaN/);

  const many = formatDigest("daily", until, Array.from({ length: MAX_DIGEST_ROWS + 3 }, (_, i) => row({ name: `s${i}` })));
  assert.match(many.detail, new RegExp(`…and 3 more servers`));
  assert.ok(many.detail.length < 1900, "stays under the webhook content limit");

  // the digest kind rides the existing notification pipeline
  assert.equal(notificationGroup("digest"), "always");
  assert.equal(shouldNotify({ url: "https://example.com/hook", events: { status: false, crash: false, backup: false } }, "digest"), true);
  const body = JSON.parse(buildWebhookBody("https://example.com/hook", { kind: "digest", serverName: "Server Hub", detail: busy.detail }));
  assert.equal(body.text, busy.detail, "generic webhooks receive the digest text verbatim");
  console.log("DIGEST_SUITE_OK");
});
