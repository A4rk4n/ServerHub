import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildStatusSnapshot } from "../src/lib/status-page";
import {
  UPTIME_WINDOW_DAYS,
  normalizeUptimeHistory,
  pruneUptimeHistory,
  recordUptimeSample,
  uptimeBars,
  uptimeWindowPercent,
  utcDayKey,
  type UptimeHistory,
} from "../src/lib/uptime-history";

const NOW = new Date("2026-10-02T12:00:00Z");

test("uptime history: normalization drops junk and clamps counts", () => {
  // Corrupt roots degrade to an empty history.
  for (const junk of [null, undefined, 42, "x", [], true]) assert.deepEqual(normalizeUptimeHistory(junk), {});
  const normalized = normalizeUptimeHistory({
    "3": {
      "2026-10-01": { online: 10, maintenance: 2, total: 15 },
      "2026-10-02": { online: -5, maintenance: Number.NaN, total: 4 },
      "not-a-day": { online: 1, maintenance: 0, total: 1 },
      "2026-09-30": "garbage",
    },
    "abc": { "2026-10-01": { online: 1, maintenance: 0, total: 1 } },
    "4": { "2026-10-01": { online: 0, maintenance: 0, total: 0 } },
  });
  assert.deepEqual(Object.keys(normalized), ["3"]);
  assert.deepEqual(normalized["3"]["2026-10-01"], { online: 10, maintenance: 2, total: 15 });
  // Negative/NaN counts clamp to zero; total is raised to cover online+maintenance.
  assert.deepEqual(normalized["3"]["2026-10-02"], { online: 0, maintenance: 0, total: 4 });
  assert.equal(normalized["3"]["not-a-day"], undefined);
  // total also rises when the stored value undercounts
  const lifted = normalizeUptimeHistory({ "9": { "2026-10-01": { online: 7, maintenance: 1, total: 3 } } });
  assert.deepEqual(lifted["9"]["2026-10-01"], { online: 7, maintenance: 1, total: 8 });
});

test("uptime history: sampling accumulates and pruning honors window and fleet", () => {
  const history: UptimeHistory = {};
  const day = utcDayKey(NOW);
  recordUptimeSample(history, 1, day, "online");
  recordUptimeSample(history, 1, day, "online");
  recordUptimeSample(history, 1, day, "offline");
  recordUptimeSample(history, 1, day, "maintenance");
  assert.deepEqual(history["1"][day], { online: 2, maintenance: 1, total: 4 });
  // Days older than the window and deleted servers are dropped.
  history["1"]["2026-01-01"] = { online: 5, maintenance: 0, total: 5 };
  history["2"] = { [day]: { online: 1, maintenance: 0, total: 1 } };
  const pruned = pruneUptimeHistory(history, NOW, UPTIME_WINDOW_DAYS, new Set(["1"]));
  assert.deepEqual(Object.keys(pruned), ["1"]);
  assert.equal(pruned["1"]["2026-01-01"], undefined);
  assert.deepEqual(pruned["1"][day], { online: 2, maintenance: 1, total: 4 });
  // The oldest in-window day survives exactly.
  const edge = utcDayKey(new Date(NOW.getTime() - (UPTIME_WINDOW_DAYS - 1) * 86_400_000));
  history["1"][edge] = { online: 1, maintenance: 0, total: 1 };
  assert.ok(pruneUptimeHistory(history, NOW, UPTIME_WINDOW_DAYS)["1"][edge]);
});

test("uptime history: bars run oldest to newest with maintenance excluded", () => {
  const today = utcDayKey(NOW);
  const yesterday = utcDayKey(new Date(NOW.getTime() - 86_400_000));
  const history: UptimeHistory = {
    "7": {
      [today]: { online: 59, maintenance: 0, total: 60 },
      [yesterday]: { online: 0, maintenance: 60, total: 60 },
    },
  };
  const bars = uptimeBars(history, 7, NOW);
  assert.equal(bars.length, UPTIME_WINDOW_DAYS);
  assert.equal(bars[0].date < bars[bars.length - 1].date, true, "oldest first");
  const last = bars[bars.length - 1];
  assert.equal(last.date, today);
  assert.equal(last.pct, 98.3);
  assert.equal(last.state, "degraded");
  // A fully-maintenance day has no uptime denominator — distinct state, null pct.
  const maint = bars[bars.length - 2];
  assert.deepEqual({ pct: maint.pct, state: maint.state }, { pct: null, state: "maintenance" });
  // Unsampled days render as gaps.
  assert.deepEqual({ pct: bars[0].pct, state: bars[0].state }, { pct: null, state: "none" });
  // Thresholds: >=99 up, >=50 degraded, below down.
  const t = (online: number, total: number) => uptimeBars({ "1": { [today]: { online, maintenance: 0, total } } }, 1, NOW)[UPTIME_WINDOW_DAYS - 1].state;
  assert.equal(t(60, 60), "up");
  assert.equal(t(30, 60), "degraded");
  assert.equal(t(29, 60), "down");
});

test("uptime history: window percent aggregates across days", () => {
  const today = utcDayKey(NOW);
  const yesterday = utcDayKey(new Date(NOW.getTime() - 86_400_000));
  const history: UptimeHistory = {
    "5": {
      [today]: { online: 30, maintenance: 0, total: 60 },
      [yesterday]: { online: 60, maintenance: 30, total: 90 },
      "2026-01-01": { online: 0, maintenance: 0, total: 1000 }, // outside the window — ignored
    },
  };
  // (30 + 60) online of (60 + 60) counted samples → 75%; maintenance excluded.
  assert.equal(uptimeWindowPercent(history, 5, NOW), 75);
  assert.equal(uptimeWindowPercent({}, 5, NOW), null, "no data yet means null, not 0%");
});

test("uptime history: snapshot whitelist and pinned runtime wiring", () => {
  const today = utcDayKey(NOW);
  const rows = [{
    name: "Lobby", gameName: "Minecraft", version: "26.3", loader: "vanilla", status: "online",
    maxPlayers: 20, onlineCount: 2, lastStartedAt: null,
    uptime: { windowPct: 99.9, days: [{ date: today, pct: 99.9, state: "up", leakedField: "nope" }] },
  }] as never[];
  const snapshot = buildStatusSnapshot("T", rows, NOW);
  const uptime = snapshot.servers[0].uptime;
  assert.ok(uptime);
  assert.equal(uptime.windowPct, 99.9);
  // Day entries are whitelist-copied — extra keys cannot leak to the public page.
  assert.deepEqual(uptime.days[0], { date: today, pct: 99.9, state: "up" });
  assert.equal(JSON.stringify(snapshot).includes("leakedField"), false);

  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("void sweepUptimeHistory().catch(() => {})"), "the 15-second scheduler tick samples uptime");
  assert.ok(runtime.includes('path.join(appDataDir(), "uptime-history.json")'), "history lives in the app-data sidecar");
  const view = fs.readFileSync("src/components/status-page-view.tsx", "utf8");
  assert.ok(view.includes("UptimeStrip"), "the public page renders the strip");
  assert.ok(view.includes("90 days ago"), "strip is labeled");
});

console.log("UPTIME_HISTORY_SUITE_OK");
