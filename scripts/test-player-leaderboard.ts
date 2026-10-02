import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { leaderboardCsv, leaderboardCsvFileName, playerLeaderboard, type SessionLike } from "../src/lib/player-analytics";

const NOW = new Date("2026-10-02T12:00:00Z").getTime();
const HOUR = 3_600_000;

function session(key: string, name: string, startHoursAgo: number, hoursPlayed: number | null): SessionLike {
  return {
    observationKey: key,
    displayName: name,
    joinedAt: new Date(NOW - startHoursAgo * HOUR),
    leftAt: hoursPlayed === null ? null : new Date(NOW - startHoursAgo * HOUR + hoursPlayed * HOUR),
    durationSec: hoursPlayed === null ? 0 : hoursPlayed * 3600,
  };
}

test("leaderboard: ranks by playtime with name tiebreak and aggregates per player", () => {
  const rows = playerLeaderboard([
    session("steam:alice", "Alice", 30, 2),
    session("steam:alice", "Alice", 10, 4),
    session("steam:bob", "Bob", 20, 8),
    session("steam:zoe", "Zoe", 8, 6),
  ], NOW, 7);
  // Bob leads outright; Alice and Zoe tie at six hours — names break the tie.
  assert.deepEqual(rows.map((row) => [row.rank, row.name]), [[1, "Bob"], [2, "Alice"], [3, "Zoe"]]);
  const alice = rows[1];
  assert.equal(alice.playtimeSec, 6 * 3600, "two sessions summed");
  assert.equal(alice.sessions, 2);
  assert.equal(alice.avgSessionSec, 3 * 3600);
  assert.equal(alice.firstSeen, NOW - 30 * HOUR, "earliest join in window");
  assert.equal(alice.lastSeen, NOW - 6 * HOUR, "latest leave");
  assert.equal(alice.online, false);
});

test("leaderboard: open sessions count to now and flag the player online", () => {
  const rows = playerLeaderboard([session("console:dana", "Dana", 2, null)], NOW, 7);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].online, true);
  assert.equal(rows[0].playtimeSec, 2 * 3600, "open session accrues up to now");
  assert.equal(rows[0].lastSeen, NOW);
});

test("leaderboard: the window clips straddlers and excludes older sessions", () => {
  const rows = playerLeaderboard([
    session("steam:old", "Old Timer", 24 * 20, 5), // entirely outside a 7-day window
    session("steam:edge", "Edge", 24 * 7 + 2, 4),  // joined before the window, left inside it
  ], NOW, 7);
  assert.deepEqual(rows.map((row) => row.name), ["Edge"]);
  assert.equal(rows[0].playtimeSec, 2 * 3600, "only the in-window slice counts");
  assert.equal(playerLeaderboard([], NOW, 7).length, 0);
});

test("leaderboard: CSV escapes hostile player names and keeps a stable header", () => {
  const rows = playerLeaderboard([
    session("a", 'Robber "Bob", Jr.', 5, 1),
    session("b", "=HYPERLINK(evil)", 4, 2),
    session("c", "line\nbreak", 3, 1),
  ], NOW, 7);
  const csv = leaderboardCsv(rows);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "rank,player,playtime_hours,playtime_seconds,sessions,avg_session_minutes,first_seen,last_seen,online");
  assert.ok(csv.includes('"Robber ""Bob"", Jr."'), "quotes doubled, field quoted");
  assert.ok(csv.includes("'=HYPERLINK(evil)"), "formula injection neutralized");
  assert.ok(csv.includes('"line\nbreak"'), "newline fields stay quoted");
  assert.ok(csv.endsWith("\r\n"), "RFC-4180 CRLF termination");
  assert.equal(leaderboardCsv([]).trim(), lines[0], "empty leaderboard is just the header");
  assert.equal(leaderboardCsvFileName(7, 30, new Date("2026-10-02T09:00:00Z")), "players-server-7-30d-20261002.csv");
});

test("leaderboard: pinned route and UI wiring", () => {
  const route = fs.readFileSync("src/app/api/servers/[id]/analytics/route.ts", "utf8");
  assert.ok(route.includes('url.searchParams.get("format") === "csv"'), "CSV negotiated via ?format=csv");
  assert.ok(route.includes('"Content-Type": "text/csv; charset=utf-8"'));
  assert.ok(route.includes("Content-Disposition"));
  assert.ok(route.includes("playerLeaderboard(sessions, now, days)"));
  assert.ok(route.includes("leaderboard,"), "full leaderboard rides along in the JSON payload");
  const ui = fs.readFileSync("src/components/players-manager.tsx", "utf8");
  assert.ok(ui.includes("Export CSV"), "players page offers the CSV download");
  assert.ok(ui.includes("format=csv"));
});

console.log("PLAYER_LEADERBOARD_SUITE_OK");
