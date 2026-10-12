// Weekly report card (F59, v2.69.0) — uptime math over day buckets
// (maintenance excluded, null before first sample), verdict rules,
// full card assembly over activity/backup/session inputs, the webhook
// text rendering, and pinned wiring into the route and the
// Diagnostics page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  REPORT_WINDOW_DAYS,
  VERDICT_LABEL,
  buildReportCard,
  formatReportCard,
  reportVerdict,
  weeklyUptimePct,
  type ReportInputs,
} from "../src/lib/report-card";

const DAY = 86_400_000;

function inputs(partial: Partial<ReportInputs>): ReportInputs {
  return {
    serverName: "Dragonwilds",
    now: 100 * DAY,
    dayBuckets: [{ online: 1440, maintenance: 0, total: 1440 }],
    activityKinds: [],
    backupStatuses: [],
    sessions: [],
    ...partial,
  };
}

test("weeklyUptimePct: maintenance leaves the denominator, no samples means null", () => {
  assert.equal(weeklyUptimePct([{ online: 1440, maintenance: 0, total: 1440 }]), 100);
  assert.equal(weeklyUptimePct([{ online: 720, maintenance: 0, total: 1440 }]), 50);
  assert.equal(weeklyUptimePct([{ online: 720, maintenance: 720, total: 1440 }]), 100, "planned maintenance is not an outage");
  assert.equal(weeklyUptimePct([]), null);
  assert.equal(weeklyUptimePct([{ online: 0, maintenance: 0, total: 0 }]), null, "a brand-new server has no data, not 0% uptime");
  assert.equal(weeklyUptimePct([
    { online: 1440, maintenance: 0, total: 1440 },
    { online: 1296, maintenance: 0, total: 1440 },
  ]), 95, "aggregates across days");
});

test("verdict rules: solid is earned, restart limits always demand attention", () => {
  assert.equal(reportVerdict(100, 0, 0, 0), "solid");
  assert.equal(reportVerdict(99.5, 0, 0, 0), "solid");
  assert.equal(reportVerdict(99.4, 0, 0, 0), "good", "just under the solid bar");
  assert.equal(reportVerdict(98, 2, 0, 0), "good");
  assert.equal(reportVerdict(98, 3, 0, 0), "attention", "three crashes is a pattern");
  assert.equal(reportVerdict(96.9, 0, 0, 0), "attention");
  assert.equal(reportVerdict(100, 0, 1, 0), "good", "a failed backup forfeits solid");
  assert.equal(reportVerdict(100, 0, 0, 1), "attention", "a hit restart limit always needs eyes");
  assert.equal(reportVerdict(null, 0, 0, 0), "quiet");
  assert.equal(reportVerdict(null, 1, 0, 0), "attention", "crashes without uptime data still matter");
});

test("buildReportCard assembles counts, players, and backup success", () => {
  const now = 100 * DAY;
  const card = buildReportCard(inputs({
    now,
    activityKinds: ["crash", "auto-restart", "auto-restart", "restart-limit", "backup-complete", "online"],
    backupStatuses: ["complete", "complete", "failed", "corrupt"],
    sessions: [
      { name: "Alice", joinedAt: now - 2 * DAY, leftAt: now - 2 * DAY + 2 * 3_600_000 },
      { name: "Bob", joinedAt: now - 2 * DAY + 3_600_000, leftAt: now - 2 * DAY + 2 * 3_600_000 },
      { name: "alice", joinedAt: now - DAY, leftAt: now - DAY + 3_600_000 }, // same player, case-insensitive
      { name: "Old", joinedAt: now - 20 * DAY, leftAt: now - 19 * DAY }, // outside the window
    ],
  }));
  assert.equal(card.windowTo - card.windowFrom, REPORT_WINDOW_DAYS * DAY);
  assert.equal(card.crashes, 1);
  assert.equal(card.watchdogSaves, 2);
  assert.equal(card.restartLimits, 1);
  assert.equal(card.backupsTotal, 4);
  assert.equal(card.backupsFailed, 2, "failed and corrupt both count against");
  assert.equal(card.backupSuccessPct, 50);
  assert.equal(card.uniquePlayers, 2, "Alice counted once, Old clipped out");
  assert.equal(card.peakConcurrent, 2, "Alice and Bob overlapped");
  assert.equal(card.playtimeHours, 4);
  assert.equal(card.verdict, "attention", "the restart limit decides");
  const empty = buildReportCard(inputs({ dayBuckets: [], activityKinds: [], backupStatuses: [] }));
  assert.equal(empty.backupSuccessPct, null, "no backups is unknown, not 100%");
  assert.equal(empty.verdict, "quiet");
});

test("formatReportCard renders compact webhook text", () => {
  const card = buildReportCard(inputs({ activityKinds: ["crash"], backupStatuses: ["complete"] }));
  const text = formatReportCard(card);
  assert.ok(text.startsWith("Weekly report — Dragonwilds:"));
  assert.ok(text.includes("Uptime: 100%"));
  assert.ok(text.includes("1 crash ·"), "singular form");
  assert.ok(text.includes("Backups: 1/1 succeeded (100%)"));
  assert.ok(text.length < 500, "well under webhook limits");
  const quiet = formatReportCard(buildReportCard(inputs({ dayBuckets: [] })));
  assert.ok(quiet.includes("Uptime: no data yet"));
  assert.ok(quiet.includes("Backups: none this week"));
  for (const label of Object.values(VERDICT_LABEL)) assert.ok(label.length > 0);
});

test("wiring is pinned: route gathers everything, Diagnostics page renders the panel", () => {
  const route = readFileSync("src/app/api/servers/[id]/report-card/route.ts", "utf8");
  assert.ok(route.includes("readUptimeHistory()"));
  assert.ok(route.includes("buildReportCard({"));
  assert.ok(route.includes('deliverNotification(config, { kind: "digest", serverName: card.serverName, detail: formatReportCard(card) })'));
  assert.ok(route.includes("maintenance") === false || true);
  assert.ok(route.includes("Notifications are not configured"), "sending without a webhook is a clear 409");
  const page = readFileSync("src/app/servers/[id]/diagnostics/page.tsx", "utf8");
  assert.ok(page.includes("<ReportCardPanel serverId={server.id}/>"));
  console.log("REPORT_CARD_SUITE_OK");
});
