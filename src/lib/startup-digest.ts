// Startup digest: when the panel boots, a "since your last session"
// card on the dashboard — how long the panel was off, whether the last
// session ended uncleanly (servers still running), and what the
// watchdog dealt with last session: crashes, auto-restarts, restart
// limits, failed backups, disk alerts, guardrail trips, security
// events. The webhook activity digest covers scheduled summaries;
// this covers the moment you sit back down. A panel-session.json
// sidecar tracks bootAt plus a heartbeated lastSeenAt so the offline
// gap and the previous session window are both known at next boot.

import fsp from "node:fs/promises";
import path from "node:path";
import { appDataDir } from "./storage";

export type PanelSession = { bootAt: number; lastSeenAt: number };

export type DigestActivityRow = { kind: string; message: string; ts: number; serverId: number | null };

export type StartupDigest = {
  /** How long the panel was off before this boot; null on first run. */
  offlineMs: number | null;
  /** Servers still marked running at boot — the last exit was unclean. */
  interrupted: number;
  /** Previous session window the counts cover; null on first run. */
  window: { from: number; to: number } | null;
  counts: {
    crashes: number;
    autoRestarts: number;
    restartLimits: number;
    backupFailures: number;
    diskAlerts: number;
    guardrails: number;
    security: number;
  };
  /** Newest-first highlights from the previous session. */
  notable: DigestActivityRow[];
  bootAt: number;
};

export const NOTABLE_LIMIT = 6;

/** Only a meaningful card is shown — a clean quick restart stays silent. */
export const MIN_OFFLINE_FOR_CARD_MS = 30 * 60 * 1000;

const COUNTED_KINDS = new Set(["crash", "auto-restart", "restart-limit", "backup-failed", "backup-corrupt", "mirror-failed", "disk-low", "guardrail", "security"]);

export function buildStartupDigest(
  rows: DigestActivityRow[],
  previous: PanelSession | null,
  interrupted: number,
  bootAt: number
): StartupDigest {
  const counts = { crashes: 0, autoRestarts: 0, restartLimits: 0, backupFailures: 0, diskAlerts: 0, guardrails: 0, security: 0 };
  const relevant = rows
    .filter((r) => COUNTED_KINDS.has(r.kind))
    .sort((a, b) => b.ts - a.ts);
  for (const row of relevant) {
    if (row.kind === "crash") counts.crashes += 1;
    else if (row.kind === "auto-restart") counts.autoRestarts += 1;
    else if (row.kind === "restart-limit") counts.restartLimits += 1;
    else if (row.kind === "backup-failed" || row.kind === "backup-corrupt" || row.kind === "mirror-failed") counts.backupFailures += 1;
    else if (row.kind === "disk-low") counts.diskAlerts += 1;
    else if (row.kind === "guardrail") counts.guardrails += 1;
    else if (row.kind === "security") counts.security += 1;
  }
  return {
    offlineMs: previous ? Math.max(0, bootAt - previous.lastSeenAt) : null,
    interrupted,
    window: previous ? { from: previous.bootAt, to: previous.lastSeenAt } : null,
    counts,
    notable: relevant.slice(0, NOTABLE_LIMIT),
    bootAt,
  };
}

/** Whether the card is worth pixels: trouble last session, an unclean exit, or a real gap. */
export function digestWorthShowing(digest: StartupDigest): boolean {
  const anyCount = Object.values(digest.counts).some((n) => n > 0);
  return anyCount || digest.interrupted > 0 || (digest.offlineMs !== null && digest.offlineMs >= MIN_OFFLINE_FOR_CARD_MS);
}

/** "3 d 4 h", "2 h 10 min", "45 min" — dashboard-sized duration. */
export function formatOfflineGap(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}

// ---- panel session sidecar -------------------------------------------------

export function panelSessionFile(base?: string): string {
  return path.join(base ?? appDataDir(), "panel-session.json");
}

export async function loadPanelSession(base?: string): Promise<PanelSession | null> {
  try {
    const raw = JSON.parse(await fsp.readFile(panelSessionFile(base), "utf8")) as Partial<PanelSession>;
    if (typeof raw?.bootAt === "number" && typeof raw?.lastSeenAt === "number" && raw.bootAt > 0 && raw.lastSeenAt >= raw.bootAt) {
      return { bootAt: raw.bootAt, lastSeenAt: raw.lastSeenAt };
    }
    return null;
  } catch {
    return null;
  }
}

export async function savePanelSession(session: PanelSession, base?: string): Promise<void> {
  try {
    const file = panelSessionFile(base);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(session, null, 2), "utf8");
  } catch {
    /* best effort — never breaks boot or the sweep */
  }
}

export const HEARTBEAT_INTERVAL_MS = 60_000;

/** Pure throttle: heartbeat only once the interval has elapsed. */
export function heartbeatDue(lastWriteAt: number, now: number, intervalMs = HEARTBEAT_INTERVAL_MS): boolean {
  return now - lastWriteAt >= intervalMs;
}

// ---- in-process digest state ------------------------------------------------
// The runtime computes the digest once at boot; the API route reads it.
// Dismissal lasts for the current panel session only.

let current: StartupDigest | null = null;
let dismissed = false;

export function setStartupDigest(digest: StartupDigest): void {
  current = digest;
  dismissed = false;
}

export function getStartupDigest(): { digest: StartupDigest; show: boolean } | null {
  if (!current) return null;
  return { digest: current, show: !dismissed && digestWorthShowing(current) };
}

export function dismissStartupDigest(): void {
  dismissed = true;
}

export function resetStartupDigestState(): void {
  current = null;
  dismissed = false;
}
