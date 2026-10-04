// Startup digest (v2.66.0) — the "since your last session" dashboard
// card. Pure aggregation (counts, notable cap, offline gap), the
// show/hide policy, the gap formatter, the heartbeat throttle, the
// panel-session sidecar round-trip, and pinned wiring into runtime
// boot, the scheduler sweep, the API route, and the dashboard.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  type DigestActivityRow,
  HEARTBEAT_INTERVAL_MS,
  MIN_OFFLINE_FOR_CARD_MS,
  NOTABLE_LIMIT,
  buildStartupDigest,
  digestWorthShowing,
  dismissStartupDigest,
  formatOfflineGap,
  getStartupDigest,
  heartbeatDue,
  loadPanelSession,
  panelSessionFile,
  resetStartupDigestState,
  savePanelSession,
  setStartupDigest,
} from "../src/lib/startup-digest";

const HOUR = 60 * 60 * 1000;

function row(kind: string, ts: number, message = kind): DigestActivityRow {
  return { kind, message, ts, serverId: 1 };
}

test("buildStartupDigest counts the previous session's trouble by category", () => {
  const prev = { bootAt: 0, lastSeenAt: 10 * HOUR };
  const rows = [
    row("crash", 1 * HOUR),
    row("crash", 2 * HOUR),
    row("auto-restart", 3 * HOUR),
    row("restart-limit", 4 * HOUR),
    row("backup-failed", 5 * HOUR),
    row("backup-corrupt", 5.5 * HOUR),
    row("mirror-failed", 5.7 * HOUR),
    row("disk-low", 6 * HOUR),
    row("guardrail", 7 * HOUR),
    row("security", 8 * HOUR),
    row("backup-complete", 9 * HOUR), // routine — never counted
    row("online", 9.5 * HOUR), // routine — never counted
  ];
  const digest = buildStartupDigest(rows, prev, 2, 12 * HOUR);
  assert.deepEqual(digest.counts, { crashes: 2, autoRestarts: 1, restartLimits: 1, backupFailures: 3, diskAlerts: 1, guardrails: 1, security: 1 });
  assert.equal(digest.interrupted, 2);
  assert.equal(digest.offlineMs, 2 * HOUR, "gap = boot minus previous lastSeenAt");
  assert.deepEqual(digest.window, { from: 0, to: 10 * HOUR });
  assert.equal(digest.notable.length, NOTABLE_LIMIT, "highlights are capped");
  assert.equal(digest.notable[0].kind, "security", "newest counted event first");
});

test("first run has no gap, no window, and stays hidden when quiet", () => {
  const digest = buildStartupDigest([], null, 0, 1000);
  assert.equal(digest.offlineMs, null);
  assert.equal(digest.window, null);
  assert.equal(digestWorthShowing(digest), false, "nothing to say on a clean first boot");
});

test("show policy: trouble, unclean exit, or a real offline gap", () => {
  const quiet = buildStartupDigest([], { bootAt: 0, lastSeenAt: HOUR }, 0, HOUR + 5 * 60 * 1000);
  assert.equal(digestWorthShowing(quiet), false, "a clean 5-minute restart stays silent");
  const longGap = buildStartupDigest([], { bootAt: 0, lastSeenAt: HOUR }, 0, HOUR + MIN_OFFLINE_FOR_CARD_MS);
  assert.equal(digestWorthShowing(longGap), true, "a real gap is worth a card");
  const unclean = buildStartupDigest([], { bootAt: 0, lastSeenAt: HOUR }, 1, HOUR + 60_000);
  assert.equal(digestWorthShowing(unclean), true, "an unclean exit always shows");
  const trouble = buildStartupDigest([row("crash", 10)], { bootAt: 0, lastSeenAt: HOUR }, 0, HOUR + 60_000);
  assert.equal(digestWorthShowing(trouble), true);
});

test("formatOfflineGap reads like a human wrote it", () => {
  assert.equal(formatOfflineGap(30_000), "under a minute");
  assert.equal(formatOfflineGap(45 * 60_000), "45 min");
  assert.equal(formatOfflineGap(2 * HOUR + 10 * 60_000), "2 h 10 min");
  assert.equal(formatOfflineGap(3 * 24 * HOUR + 4 * HOUR), "3 d 4 h");
  assert.equal(formatOfflineGap(2 * 24 * HOUR), "2 d");
});

test("heartbeat throttle: one write per interval", () => {
  assert.equal(heartbeatDue(0, HEARTBEAT_INTERVAL_MS - 1), false);
  assert.equal(heartbeatDue(0, HEARTBEAT_INTERVAL_MS), true);
  assert.equal(heartbeatDue(1000, 1000 + HEARTBEAT_INTERVAL_MS + 5), true);
});

test("panel-session sidecar round-trip and corrupt-file tolerance", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "panelsession-"));
  assert.equal(await loadPanelSession(base), null, "missing file is a clean first run");
  await savePanelSession({ bootAt: 100, lastSeenAt: 200 }, base);
  assert.deepEqual(await loadPanelSession(base), { bootAt: 100, lastSeenAt: 200 });
  writeFileSync(panelSessionFile(base), "{broken");
  assert.equal(await loadPanelSession(base), null, "corrupt sidecar degrades to first-run");
  writeFileSync(panelSessionFile(base), JSON.stringify({ bootAt: 500, lastSeenAt: 100 }));
  assert.equal(await loadPanelSession(base), null, "lastSeenAt before bootAt is rejected");
});

test("in-process state: set, show, dismiss for the session", () => {
  resetStartupDigestState();
  assert.equal(getStartupDigest(), null);
  setStartupDigest(buildStartupDigest([row("crash", 10)], { bootAt: 0, lastSeenAt: HOUR }, 0, 2 * HOUR));
  assert.equal(getStartupDigest()?.show, true);
  dismissStartupDigest();
  assert.equal(getStartupDigest()?.show, false, "dismissed for the rest of the session");
  resetStartupDigestState();
});

test("wiring is pinned: runtime boot, sweep heartbeat, route, dashboard", async () => {
  const { readFileSync } = await import("node:fs");
  const runtime = readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("setStartupDigest(buildStartupDigest(digestRows, previousSession, interruptedServers, bootAt))"));
  assert.ok(runtime.includes("await savePanelSession({ bootAt, lastSeenAt: bootAt })"));
  assert.ok(runtime.includes("void heartbeatPanelSession().catch(() => {})"), "heartbeat rides the 15-second scheduler");
  const route = readFileSync("src/app/api/overview/startup-digest/route.ts", "utf8");
  assert.ok(route.includes("getStartupDigest()"));
  assert.ok(route.includes("dismissStartupDigest()"));
  const dash = readFileSync("src/components/dashboard-view.tsx", "utf8");
  assert.ok(dash.includes("<StartupDigestCard />"));
  console.log("STARTUP_DIGEST_SUITE_OK");
});
