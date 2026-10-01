// Activity digest core: scheduling, aggregation, and formatting for the
// daily/weekly webhook summary. Pure functions — the runtime collects the
// raw data and delivers the result.

export type DigestCadence = "daily" | "weekly";

export type DigestConfig = {
  enabled: boolean;
  cadence: DigestCadence;
  /** Local hour of day (0–23) after which the digest is sent. */
  hour: number;
};

export const DEFAULT_DIGEST_CONFIG: DigestConfig = { enabled: false, cadence: "daily", hour: 9 };

/** Weekly digests go out on Monday (local time). */
export const WEEKLY_DIGEST_WEEKDAY = 1;

export const DIGEST_WINDOW_MS: Record<DigestCadence, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/** Keep the webhook payload comfortably under Discord's 2000-char limit. */
export const MAX_DIGEST_ROWS = 10;

export function normalizeDigestConfig(raw: unknown): DigestConfig {
  const candidate = (raw ?? {}) as Partial<DigestConfig>;
  return {
    enabled: candidate.enabled === true,
    cadence: candidate.cadence === "weekly" ? "weekly" : "daily",
    hour: typeof candidate.hour === "number" && Number.isInteger(candidate.hour) && candidate.hour >= 0 && candidate.hour <= 23 ? candidate.hour : 9,
  };
}

/**
 * A digest is due once local time passes the configured hour on a send day
 * (every day, or Monday for weekly) and nothing has been sent since that
 * scheduled moment. Catch-up after downtime is implicit: the digest fires
 * on the next sweep after the panel comes back.
 */
export function digestDue(config: DigestConfig, lastSentMs: number | null, now: Date): boolean {
  if (!config.enabled) return false;
  if (config.cadence === "weekly" && now.getDay() !== WEEKLY_DIGEST_WEEKDAY) return false;
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), config.hour, 0, 0, 0);
  if (now.getTime() < scheduled.getTime()) return false;
  return lastSentMs === null || lastSentMs < scheduled.getTime();
}

/** The reporting window a digest sent at `now` covers. */
export function digestWindow(cadence: DigestCadence, now: Date): { since: number; until: number } {
  return { since: now.getTime() - DIGEST_WINDOW_MS[cadence], until: now.getTime() };
}

export type SessionLike = { name: string; joinedAt: number; leftAt: number | null };

/** Clip sessions to the window and derive unique players, peak concurrency, and playtime. */
export function aggregateSessions(sessions: SessionLike[], since: number, until: number): { uniquePlayers: number; peakConcurrent: number; playtimeSec: number } {
  const names = new Set<string>();
  const events: Array<{ t: number; delta: number }> = [];
  let playtimeMs = 0;
  for (const session of sessions) {
    const start = Math.max(session.joinedAt, since);
    const end = Math.min(session.leftAt ?? until, until);
    if (end <= start) continue;
    names.add(session.name.toLowerCase());
    playtimeMs += end - start;
    events.push({ t: start, delta: 1 }, { t: end, delta: -1 });
  }
  events.sort((a, b) => a.t - b.t || a.delta - b.delta); // leaves before joins at the same instant
  let current = 0;
  let peak = 0;
  for (const event of events) {
    current += event.delta;
    peak = Math.max(peak, current);
  }
  return { uniquePlayers: names.size, peakConcurrent: peak, playtimeSec: Math.round(playtimeMs / 1000) };
}

/**
 * Uptime from metrics-history bucket timestamps: each distinct one-minute
 * bucket inside the window is a minute the server was running.
 */
export function uptimePercent(bucketStarts: number[], since: number, until: number): number {
  const minutes = Math.max(1, Math.round((until - since) / 60_000));
  const seen = new Set<number>();
  for (const t of bucketStarts) {
    if (t >= since && t < until) seen.add(t);
  }
  return Math.min(100, +((seen.size / minutes) * 100).toFixed(1));
}

export type ServerDigestRow = {
  name: string;
  uptimePct: number;
  uniquePlayers: number;
  peakConcurrent: number;
  playtimeSec: number;
  backupsOk: number;
  backupsFailed: number;
  crashes: number;
  guardrails: number;
  /** null = could not be determined (offline catalog, custom server, …). */
  updateAvailable: boolean | null;
};

function playtimeLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const hours = seconds / 3600;
  return hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(seconds / 60)}m`;
}

/** Render the digest. Deterministic; caps rows to stay inside webhook limits. */
export function formatDigest(cadence: DigestCadence, until: Date, rows: ServerDigestRow[]): { title: string; detail: string } {
  const label = cadence === "daily" ? "Daily" : "Weekly";
  const day = until.toISOString().slice(0, 10);
  const title = `📊 ${label} digest — ${day} — ${rows.length} server${rows.length === 1 ? "" : "s"}`;
  if (rows.length === 0) {
    return { title, detail: `${title}\nNo servers yet — nothing to report.` };
  }
  const updatesPending = rows.filter((row) => row.updateAvailable === true).length;
  const totals = [
    `uptime avg ${+(rows.reduce((sum, row) => sum + row.uptimePct, 0) / rows.length).toFixed(1)}%`,
    `players ${rows.reduce((sum, row) => sum + row.uniquePlayers, 0)}`,
    `backups ${rows.reduce((sum, row) => sum + row.backupsOk, 0)}✓/${rows.reduce((sum, row) => sum + row.backupsFailed, 0)}✗`,
    `crashes ${rows.reduce((sum, row) => sum + row.crashes, 0)}`,
    `guardrails ${rows.reduce((sum, row) => sum + row.guardrails, 0)}`,
    `updates pending ${updatesPending}`,
  ].join(" · ");
  const lines = rows.slice(0, MAX_DIGEST_ROWS).map((row) => {
    const parts = [
      `uptime ${row.uptimePct}%`,
      `players ${row.uniquePlayers} (peak ${row.peakConcurrent})`,
      `playtime ${playtimeLabel(row.playtimeSec)}`,
      `backups ${row.backupsOk}✓/${row.backupsFailed}✗`,
    ];
    if (row.crashes > 0) parts.push(`🔥 ${row.crashes} crash${row.crashes === 1 ? "" : "es"}`);
    if (row.guardrails > 0) parts.push(`📈 ${row.guardrails} guardrail${row.guardrails === 1 ? "" : "s"}`);
    if (row.updateAvailable === true) parts.push("⬆️ update available");
    return `• **${row.name}** — ${parts.join(" · ")}`;
  });
  if (rows.length > MAX_DIGEST_ROWS) lines.push(`…and ${rows.length - MAX_DIGEST_ROWS} more server${rows.length - MAX_DIGEST_ROWS === 1 ? "" : "s"}.`);
  return { title, detail: `${title}\n${totals}\n${lines.join("\n")}` };
}
