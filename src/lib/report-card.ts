// Weekly server report card (F59): one answer to "how healthy was
// this server this week?". Pure assembly over data the panel already
// collects — uptime day buckets, the activity trail, backup rows, and
// player sessions — plus a webhook-ready text rendering. The API
// route gathers; this file only computes.

import { aggregateSessions, type SessionLike } from "./digest";
import type { DayBucket } from "./uptime-history";

export const REPORT_WINDOW_DAYS = 7;

export type ReportVerdict = "solid" | "good" | "attention" | "quiet";

export type ReportCard = {
  serverName: string;
  windowFrom: number;
  windowTo: number;
  /** Percent 0–100 (1 decimal), or null when no samples exist yet. */
  uptimePct: number | null;
  crashes: number;
  watchdogSaves: number;
  restartLimits: number;
  backupsTotal: number;
  backupsFailed: number;
  /** Percent 0–100, or null when no backups ran this week. */
  backupSuccessPct: number | null;
  uniquePlayers: number;
  peakConcurrent: number;
  playtimeHours: number;
  verdict: ReportVerdict;
};

/**
 * Weekly uptime from UTC day buckets. Maintenance samples leave the
 * denominator — planned work is not an outage. Null until the first
 * sample ever lands, so a brand-new server reads "no data yet"
 * instead of "0% uptime".
 */
export function weeklyUptimePct(days: DayBucket[]): number | null {
  let online = 0;
  let denominator = 0;
  for (const day of days) {
    online += day.online;
    denominator += Math.max(0, day.total - day.maintenance);
  }
  if (denominator === 0) return null;
  return Math.min(100, +((online / denominator) * 100).toFixed(1));
}

/**
 * Verdict rules, deliberately strict at the top: "solid" is earned
 * (≥99.5% uptime, zero crashes, zero failed backups), "good" tolerates
 * a wobble (≥97%, ≤2 crashes, one failed backup), everything else
 * needs attention. A server with no uptime samples and no events is
 * simply "quiet".
 */
export function reportVerdict(uptimePct: number | null, crashes: number, backupsFailed: number, restartLimits: number): ReportVerdict {
  if (uptimePct === null) return crashes > 0 || backupsFailed > 0 ? "attention" : "quiet";
  if (restartLimits > 0) return "attention";
  if (uptimePct >= 99.5 && crashes === 0 && backupsFailed === 0) return "solid";
  if (uptimePct >= 97 && crashes <= 2 && backupsFailed <= 1) return "good";
  return "attention";
}

export type ReportInputs = {
  serverName: string;
  now: number;
  /** The window's UTC day buckets (missing days as zero buckets). */
  dayBuckets: DayBucket[];
  /** Activity kinds inside the window (already filtered to this server). */
  activityKinds: string[];
  /** Backup row statuses created inside the window. */
  backupStatuses: string[];
  /** Player sessions overlapping the window (epoch ms). */
  sessions: SessionLike[];
};

export function buildReportCard(inputs: ReportInputs): ReportCard {
  const windowTo = inputs.now;
  const windowFrom = windowTo - REPORT_WINDOW_DAYS * 86_400_000;
  const crashes = inputs.activityKinds.filter((k) => k === "crash").length;
  const watchdogSaves = inputs.activityKinds.filter((k) => k === "auto-restart").length;
  const restartLimits = inputs.activityKinds.filter((k) => k === "restart-limit").length;
  const backupsTotal = inputs.backupStatuses.length;
  const backupsFailed = inputs.backupStatuses.filter((s) => s === "failed" || s === "corrupt").length;
  const players = aggregateSessions(inputs.sessions, windowFrom, windowTo);
  const uptimePct = weeklyUptimePct(inputs.dayBuckets);
  return {
    serverName: inputs.serverName,
    windowFrom,
    windowTo,
    uptimePct,
    crashes,
    watchdogSaves,
    restartLimits,
    backupsTotal,
    backupsFailed,
    backupSuccessPct: backupsTotal === 0 ? null : +(((backupsTotal - backupsFailed) / backupsTotal) * 100).toFixed(0),
    uniquePlayers: players.uniquePlayers,
    peakConcurrent: players.peakConcurrent,
    playtimeHours: +(players.playtimeSec / 3600).toFixed(1),
    verdict: reportVerdict(uptimePct, crashes, backupsFailed, restartLimits),
  };
}

export const VERDICT_LABEL: Record<ReportVerdict, string> = {
  solid: "Rock solid",
  good: "Mostly healthy",
  attention: "Needs attention",
  quiet: "No data yet",
};

/** Webhook text — compact, Discord-safe (well under 2000 chars). */
export function formatReportCard(card: ReportCard): string {
  const lines = [
    `Weekly report — ${card.serverName}: ${VERDICT_LABEL[card.verdict]}`,
    `Uptime: ${card.uptimePct === null ? "no data yet" : `${card.uptimePct}%`}`,
    `Stability: ${card.crashes} crash${card.crashes === 1 ? "" : "es"} · ${card.watchdogSaves} watchdog save${card.watchdogSaves === 1 ? "" : "s"}${card.restartLimits > 0 ? ` · ${card.restartLimits} restart limit${card.restartLimits === 1 ? "" : "s"} hit` : ""}`,
    `Backups: ${card.backupsTotal === 0 ? "none this week" : `${card.backupsTotal - card.backupsFailed}/${card.backupsTotal} succeeded (${card.backupSuccessPct}%)`}`,
    `Players: ${card.uniquePlayers} unique · peak ${card.peakConcurrent} · ${card.playtimeHours} h played`,
  ];
  return lines.join("\n");
}
