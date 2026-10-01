// Player analytics computed from the player_sessions journal. All pure
// so the math is unit-testable: window clipping, peak-concurrency sweep,
// per-day series, and an hour-of-day activity histogram. Open sessions
// (leftAt null) count as "still online" up to `now`.

export type SessionLike = {
  observationKey: string;
  displayName: string;
  joinedAt: Date | string | null;
  leftAt: Date | string | null;
  durationSec: number;
};

type Interval = { key: string; name: string; start: number; end: number; open: boolean };

const DAY_MS = 86_400_000;

function toMs(value: Date | string | null): number | null {
  if (value === null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toIntervals(sessions: SessionLike[], now: number): Interval[] {
  const out: Interval[] = [];
  for (const session of sessions) {
    const start = toMs(session.joinedAt);
    if (start === null || start > now) continue;
    const left = toMs(session.leftAt);
    const end = left === null ? now : Math.min(Math.max(left, start), now);
    out.push({ key: session.observationKey, name: session.displayName, start, end, open: left === null });
  }
  return out;
}

function clip(intervals: Interval[], from: number, to: number): Interval[] {
  return intervals
    .filter((item) => item.end > from && item.start < to)
    .map((item) => ({ ...item, start: Math.max(item.start, from), end: Math.min(item.end, to) }));
}

// Sweep-line peak concurrency: joins sort before leaves at the same
// timestamp, so back-to-back reconnects at one instant count as overlap.
export function peakConcurrency(intervals: { start: number; end: number }[]): { peak: number; at: number | null } {
  const events: Array<{ t: number; delta: number }> = [];
  for (const item of intervals) {
    if (item.end <= item.start) continue;
    events.push({ t: item.start, delta: 1 }, { t: item.end, delta: -1 });
  }
  events.sort((a, b) => a.t - b.t || b.delta - a.delta);
  let current = 0;
  let peak = 0;
  let at: number | null = null;
  for (const event of events) {
    current += event.delta;
    if (current > peak) {
      peak = current;
      at = event.t;
    }
  }
  return { peak, at };
}

export type PlayerActivitySummary = {
  windowDays: number;
  uniquePlayers: number;
  totalSessions: number;
  totalPlaytimeSec: number;
  avgSessionSec: number;
  peakConcurrent: number;
  peakAt: number | null;
  onlineNow: number;
  topPlayers: Array<{ key: string; name: string; playtimeSec: number; sessions: number; lastSeen: number; online: boolean }>;
  hourly: number[]; // player-minutes per local hour of day, 24 buckets
};

export function summarizePlayerActivity(sessions: SessionLike[], now = Date.now(), windowDays = 7): PlayerActivitySummary {
  const clipped = clip(toIntervals(sessions, now), now - windowDays * DAY_MS, now);
  const byPlayer = new Map<string, { name: string; playtimeSec: number; sessions: number; lastSeen: number; online: boolean }>();
  const hourly = new Array<number>(24).fill(0);
  let totalPlaytimeSec = 0;
  for (const item of clipped) {
    const seconds = Math.round((item.end - item.start) / 1000);
    totalPlaytimeSec += seconds;
    const entry = byPlayer.get(item.key) ?? { name: item.name, playtimeSec: 0, sessions: 0, lastSeen: 0, online: false };
    entry.name = item.name;
    entry.playtimeSec += seconds;
    entry.sessions += 1;
    entry.lastSeen = Math.max(entry.lastSeen, item.end);
    entry.online = entry.online || item.open;
    byPlayer.set(item.key, entry);
    // Hour-of-day histogram: walk the interval in local-hour steps.
    let cursor = item.start;
    while (cursor < item.end) {
      const date = new Date(cursor);
      const hourEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours() + 1).getTime();
      const sliceEnd = Math.min(hourEnd, item.end);
      hourly[date.getHours()] += (sliceEnd - cursor) / 60_000;
      cursor = sliceEnd;
    }
  }
  const { peak, at } = peakConcurrency(clipped);
  const topPlayers = [...byPlayer.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.playtimeSec - a.playtimeSec || a.name.localeCompare(b.name))
    .slice(0, 10);
  return {
    windowDays,
    uniquePlayers: byPlayer.size,
    totalSessions: clipped.length,
    totalPlaytimeSec,
    avgSessionSec: clipped.length ? Math.round(totalPlaytimeSec / clipped.length) : 0,
    peakConcurrent: peak,
    peakAt: at,
    onlineNow: new Set(clipped.filter((item) => item.open).map((item) => item.key)).size,
    topPlayers,
    hourly: hourly.map((minutes) => Math.round(minutes)),
  };
}

export type DailyActivity = { day: string; uniquePlayers: number; playtimeSec: number; peakConcurrent: number };

export function dailyPlayerSeries(sessions: SessionLike[], now = Date.now(), days = 14): DailyActivity[] {
  const intervals = toIntervals(sessions, now);
  const today = new Date(now);
  const out: DailyActivity[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i).getTime();
    const dayEnd = Math.min(dayStart + DAY_MS, now + 1);
    const dayIntervals = clip(intervals, dayStart, dayEnd);
    const date = new Date(dayStart);
    out.push({
      day: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      uniquePlayers: new Set(dayIntervals.map((item) => item.key)).size,
      playtimeSec: Math.round(dayIntervals.reduce((sum, item) => sum + (item.end - item.start) / 1000, 0)),
      peakConcurrent: peakConcurrency(dayIntervals).peak,
    });
  }
  return out;
}
