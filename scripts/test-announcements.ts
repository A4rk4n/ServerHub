import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DEFAULT_ANNOUNCEMENT_CONFIG,
  MAX_ANNOUNCE_INTERVAL_MIN,
  MAX_ANNOUNCE_MESSAGES,
  MAX_ANNOUNCE_MESSAGE_LENGTH,
  MIN_ANNOUNCE_INTERVAL_MIN,
  isAnnouncementDue,
  nextAnnouncementIndex,
  normalizeAnnouncementConfig,
} from "../src/lib/announcements";

test("announcements: config normalization", () => {
  assert.deepEqual(normalizeAnnouncementConfig(undefined), DEFAULT_ANNOUNCEMENT_CONFIG);
  const custom = normalizeAnnouncementConfig({ enabled: true, intervalMin: 15, order: "random", template: "say {message}", messages: ["Join our Discord!", "Backups run nightly"] });
  assert.deepEqual(custom, { enabled: true, intervalMin: 15, order: "random", template: "say {message}", messages: ["Join our Discord!", "Backups run nightly"] });

  // interval clamps to [MIN, MAX]; junk falls back to the default
  assert.equal(normalizeAnnouncementConfig({ intervalMin: 0 }).intervalMin, MIN_ANNOUNCE_INTERVAL_MIN);
  assert.equal(normalizeAnnouncementConfig({ intervalMin: 999999 }).intervalMin, MAX_ANNOUNCE_INTERVAL_MIN);
  assert.equal(normalizeAnnouncementConfig({ intervalMin: 7.5 }).intervalMin, DEFAULT_ANNOUNCEMENT_CONFIG.intervalMin);
  assert.equal(normalizeAnnouncementConfig({ intervalMin: "30" }).intervalMin, DEFAULT_ANNOUNCEMENT_CONFIG.intervalMin);

  // messages: trimmed, empties/control chars/oversize dropped, capped
  const messy = normalizeAnnouncementConfig({ enabled: true, messages: ["  hello  ", "", "a\nb", "x".repeat(MAX_ANNOUNCE_MESSAGE_LENGTH + 1), 42, "ok"] });
  assert.deepEqual(messy.messages, ["hello", "ok"]);
  const flood = normalizeAnnouncementConfig({ enabled: true, messages: Array.from({ length: 40 }, (_, i) => `msg ${i}`) });
  assert.equal(flood.messages.length, MAX_ANNOUNCE_MESSAGES);

  // enabling with zero usable messages stores disabled — nothing to rotate
  assert.equal(normalizeAnnouncementConfig({ enabled: true, messages: [] }).enabled, false);
  assert.equal(normalizeAnnouncementConfig({ enabled: true, messages: ["\n"] }).enabled, false);
  assert.equal(normalizeAnnouncementConfig({ enabled: "yes", messages: ["hi"] }).enabled, false);

  // order falls back to sequential; bad templates are discarded, not saved
  assert.equal(normalizeAnnouncementConfig({ order: "shuffle" }).order, "sequential");
  assert.equal(normalizeAnnouncementConfig({ template: "no placeholder" }).template, "");
  assert.equal(normalizeAnnouncementConfig({ template: "say {message}\nsay again" }).template, "");
  assert.equal(normalizeAnnouncementConfig({ template: `x`.repeat(300) + "{message}" }).template, "");
});

test("announcements: rotation order", () => {
  // sequential wraps around and recovers from a stale index
  assert.equal(nextAnnouncementIndex("sequential", -1, 3), 0);
  assert.equal(nextAnnouncementIndex("sequential", 0, 3), 1);
  assert.equal(nextAnnouncementIndex("sequential", 2, 3), 0);
  assert.equal(nextAnnouncementIndex("sequential", 99, 3), 0);
  // degenerate counts
  assert.equal(nextAnnouncementIndex("sequential", 0, 0), -1);
  assert.equal(nextAnnouncementIndex("random", 0, 1), 0);
  // random never repeats the previous pick when it has a choice
  for (let i = 0; i < 50; i++) {
    const pick = nextAnnouncementIndex("random", 1, 3);
    assert.notEqual(pick, 1);
    assert.ok(pick === 0 || pick === 2);
  }
  // deterministic rand: a collision with lastIndex advances to the neighbour
  assert.equal(nextAnnouncementIndex("random", 1, 3, () => 0.5), 2);
  assert.equal(nextAnnouncementIndex("random", 2, 3, () => 0.99), 0);
});

test("announcements: due timing", () => {
  const now = 1_700_000_000_000;
  assert.equal(isAnnouncementDue(now, now, 30), false);
  assert.equal(isAnnouncementDue(now + 29 * 60_000, now, 30), false);
  assert.equal(isAnnouncementDue(now + 30 * 60_000, now, 30), true);
  assert.equal(isAnnouncementDue(now + 31 * 60_000, now, 30), true);
});

test("announcements: runtime wiring", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("void sweepAnnouncements().catch(() => {})"), "the 15-second scheduler tick sweeps announcements");
  assert.ok(runtime.includes('announcerState.set(serverId, { lastIndex: -1, lastSentAt: nowMs })'), "a fresh server anchors the cadence instead of broadcasting instantly");
  assert.ok(runtime.includes("announcerState.delete(entry.server.id)"), "a dying process clears its announcement cadence");
  assert.ok(runtime.includes("announcerState.delete(serverId); // restart the cadence under the new config"), "saving a config re-anchors the cadence");
  assert.ok(runtime.includes('runCommand(server, command, "Announcer")'), "broadcasts are delivered over the console like warnings");
  const route = fs.readFileSync("src/app/api/servers/[id]/announcements/route.ts", "utf8");
  assert.ok(route.includes('return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })'), "malformed JSON cannot reset the rotation");
  console.log("ANNOUNCEMENTS_SUITE_OK");
});
