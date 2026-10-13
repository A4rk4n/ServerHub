// Uptime history for the public status page. The runtime samples each
// server once a minute into UTC day buckets (sample counts, not seconds —
// cheap, additive, and restart-proof) kept in an app-data sidecar for the
// last 90 days. Pure logic only: bucket shape, normalization, pruning, and
// the per-day bar computation. Maintenance samples are excluded from the
// uptime denominator — planned work is not an outage.

export type DayBucket = { online: number; maintenance: number; total: number };

/** serverId (string) → UTC day "YYYY-MM-DD" → sample counts. */
export type UptimeHistory = Record<string, Record<string, DayBucket>>;

export const UPTIME_WINDOW_DAYS = 90;
export const UPTIME_SAMPLE_EVERY_MS = 60_000;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** UTC calendar day — the bars must not shift with the panel's timezone. */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** Corrupt files degrade to an empty history; junk buckets are dropped, counts are clamped sane. */
export function normalizeUptimeHistory(raw: unknown): UptimeHistory {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const history: UptimeHistory = {};
  for (const [serverId, days] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(serverId) || !days || typeof days !== "object" || Array.isArray(days)) continue;
    const clean: Record<string, DayBucket> = {};
    for (const [day, bucket] of Object.entries(days as Record<string, unknown>)) {
      if (!DAY_PATTERN.test(day) || !bucket || typeof bucket !== "object") continue;
      const record = bucket as Record<string, unknown>;
      const online = asCount(record.online);
      const maintenance = asCount(record.maintenance);
      const total = Math.max(asCount(record.total), online + maintenance);
      if (total > 0) clean[day] = { online, maintenance, total };
    }
    if (Object.keys(clean).length > 0) history[serverId] = clean;
  }
  return history;
}

export type UptimeSampleState = "online" | "maintenance" | "offline";

/** Add one sample to a server's day bucket (mutates and returns the history). */
export function recordUptimeSample(history: UptimeHistory, serverId: number, day: string, state: UptimeSampleState): UptimeHistory {
  const key = String(serverId);
  const days = (history[key] ??= {});
  const bucket = (days[day] ??= { online: 0, maintenance: 0, total: 0 });
  bucket.total += 1;
  if (state === "online") bucket.online += 1;
  if (state === "maintenance") bucket.maintenance += 1;
  return history;
}

/** Drop days outside the window and servers that no longer exist. */
export function pruneUptimeHistory(history: UptimeHistory, now: Date, keepDays = UPTIME_WINDOW_DAYS, knownServerIds?: Set<string>): UptimeHistory {
  const cutoff = utcDayKey(new Date(now.getTime() - (keepDays - 1) * DAY_MS));
  const pruned: UptimeHistory = {};
  for (const [serverId, days] of Object.entries(history)) {
    if (knownServerIds && !knownServerIds.has(serverId)) continue;
    const kept: Record<string, DayBucket> = {};
    for (const [day, bucket] of Object.entries(days)) if (day >= cutoff) kept[day] = bucket;
    if (Object.keys(kept).length > 0) pruned[serverId] = kept;
  }
  return pruned;
}

export type UptimeDayState = "up" | "degraded" | "down" | "maintenance" | "none";

export type UptimeDay = {
  date: string;
  /** Percent online of the non-maintenance samples; null when nothing counts against uptime. */
  pct: number | null;
  state: UptimeDayState;
};

function dayState(pct: number | null, bucket: DayBucket | undefined): UptimeDayState {
  if (pct === null) return bucket && bucket.maintenance > 0 ? "maintenance" : "none";
  if (pct >= 99) return "up";
  if (pct >= 50) return "degraded";
  return "down";
}

/** The classic status-page strip: one entry per UTC day, oldest first, ending today. */
export function uptimeBars(history: UptimeHistory, serverId: number, now: Date, days = UPTIME_WINDOW_DAYS): UptimeDay[] {
  const buckets = history[String(serverId)] ?? {};
  const bars: UptimeDay[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = utcDayKey(new Date(now.getTime() - i * DAY_MS));
    const bucket = buckets[date];
    const counted = bucket ? bucket.total - bucket.maintenance : 0;
    const pct = bucket && counted > 0 ? Math.round((bucket.online / counted) * 1000) / 10 : null;
    bars.push({ date, pct, state: dayState(pct, bucket) });
  }
  return bars;
}

/** Window-wide uptime percent across every sampled, non-maintenance moment; null before any data. */
export function uptimeWindowPercent(history: UptimeHistory, serverId: number, now: Date, days = UPTIME_WINDOW_DAYS): number | null {
  const cutoff = utcDayKey(new Date(now.getTime() - (days - 1) * DAY_MS));
  let online = 0;
  let counted = 0;
  for (const [day, bucket] of Object.entries(history[String(serverId)] ?? {})) {
    if (day < cutoff) continue;
    online += bucket.online;
    counted += bucket.total - bucket.maintenance;
  }
  return counted > 0 ? Math.round((online / counted) * 1000) / 10 : null;
}
