// Unit suite for player analytics: window clipping, open-session
// handling, the peak-concurrency sweep, daily series day boundaries,
// the hour-of-day histogram, and the runtime/API/UI wiring that keeps
// the session journal truthful for console-observed providers.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { dailyPlayerSeries, peakConcurrency, summarizePlayerActivity, type SessionLike } from "../src/lib/player-analytics";

const HOUR = 3_600_000;
// A fixed local-noon anchor keeps day-boundary math deterministic in any timezone.
const NOW = new Date(2026, 9, 1, 12, 0, 0).getTime();

const session = (key: string, startMsAgo: number, endMsAgo: number | null, name = key): SessionLike => ({
  observationKey: `console:${key}`,
  displayName: name,
  joinedAt: new Date(NOW - startMsAgo),
  leftAt: endMsAgo === null ? null : new Date(NOW - endMsAgo),
  durationSec: 0,
});

test("summaries count playtime, uniques, and clip to the window", () => {
  const sessions = [
    session("alice", 3 * HOUR, 1 * HOUR), // 2h inside the window
    session("alice", 30 * 86_400_000, 29 * 86_400_000), // far outside a 7d window
    session("bob", 2 * HOUR, null), // open: counts up to now
  ];
  const summary = summarizePlayerActivity(sessions, NOW, 7);
  assert.equal(summary.uniquePlayers, 2);
  assert.equal(summary.totalSessions, 2, "the month-old session is clipped away entirely");
  assert.equal(summary.totalPlaytimeSec, 4 * 3600, "2h closed + 2h still-open");
  assert.equal(summary.avgSessionSec, 2 * 3600);
  assert.equal(summary.onlineNow, 1, "only the open session counts as online");
  assert.equal(summary.topPlayers[0].name, "alice", "ties break on playtime first");
  const wide = summarizePlayerActivity(sessions, NOW, 30);
  assert.equal(wide.totalSessions, 3, "a 30d window includes the old session");
});

test("peak concurrency uses a sweep with joins winning ties", () => {
  assert.deepEqual(peakConcurrency([]), { peak: 0, at: null });
  const { peak, at } = peakConcurrency([
    { start: 0, end: 100 },
    { start: 50, end: 150 },
    { start: 100, end: 200 }, // starts exactly when the first ends: join before leave → 3 overlap
  ]);
  assert.equal(peak, 3);
  assert.equal(at, 100);
  assert.equal(peakConcurrency([{ start: 10, end: 10 }]).peak, 0, "zero-length intervals never count");
  const summary = summarizePlayerActivity([session("a", 2 * HOUR, HOUR), session("b", 90 * 60_000, 30 * 60_000)], NOW, 1);
  assert.equal(summary.peakConcurrent, 2);
});

test("the daily series respects local day boundaries and open sessions", () => {
  const sessions = [
    session("alice", 26 * HOUR, 25 * HOUR), // yesterday morning
    session("bob", 1 * HOUR, null), // today, still online
  ];
  const daily = dailyPlayerSeries(sessions, NOW, 3);
  assert.equal(daily.length, 3);
  assert.equal(daily[0].playtimeSec, 0, "two days ago is empty");
  assert.equal(daily[1].uniquePlayers, 1);
  assert.equal(daily[1].playtimeSec, 3600);
  assert.equal(daily[2].uniquePlayers, 1);
  assert.equal(daily[2].playtimeSec, 3600, "the open session counts up to now");
  assert.equal(daily[2].day, "2026-10-01");
  // A session spanning midnight splits between both days.
  const spanning = dailyPlayerSeries([session("carol", 13 * HOUR, 11 * HOUR)], NOW, 2);
  assert.equal(spanning[0].playtimeSec, 3600, "the hour before local midnight");
  assert.equal(spanning[1].playtimeSec, 3600, "the hour after local midnight");
});

test("the hourly histogram attributes player-minutes to local hours", () => {
  // 10:30 → 12:00 local: 30 min in hour 10, 60 min in hour 11.
  const summary = summarizePlayerActivity([session("dave", 90 * 60_000, 0)], NOW, 1);
  assert.equal(summary.hourly[10], 30);
  assert.equal(summary.hourly[11], 60);
  assert.equal(summary.hourly.reduce((a, b) => a + b, 0), 90);
  assert.equal(summary.hourly.length, 24);
});

test("the journal, API, and UI are wired", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("syncConsoleSession"), "console join/leave events open and close sessions");
  assert.ok(runtime.includes('observationKey("console"'), "console sessions use the shared observation key");
  const exits = runtime.split("closeAllSessions(").length - 1;
  assert.ok(exits >= 3, "sessions close on process exit AND runtime-restart recovery (definition + 2 call sites)");
  const route = fs.readFileSync("src/app/api/servers/[id]/analytics/route.ts", "utf8");
  assert.ok(route.includes("summarizePlayerActivity") && route.includes("dailyPlayerSeries"), "the analytics route serves both shapes");
  assert.ok(route.includes("Math.min(30, Math.max(1,"), "the window clamps to 1-30 days");
  const ui = fs.readFileSync("src/components/players-manager.tsx", "utf8");
  assert.ok(ui.includes("AnalyticsPanel"), "the Players tab renders the analytics panel");
  assert.ok(ui.includes("Playtime leaderboard") && ui.includes("Busy hours"), "leaderboard and busy-hours chart exist");
  console.log("PLAYER_ANALYTICS_SUITE_OK");
});
