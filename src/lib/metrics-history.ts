// Persistent metrics history: live samples (one every ~2s while a server
// runs) are aggregated into one-minute buckets and appended to a small
// JSONL file per server under appdata/metrics. History therefore survives
// server restarts and Hub restarts, is bounded by a retention window, and
// stays tiny (a 24h day is at most 1440 lines per server).

import fsp from "node:fs/promises";
import path from "node:path";
import type { Metric } from "./runtime";
import { appDataDir } from "./storage";

export type HistoryPoint = { t: number; cpu: number; ram: number; players: number; tps: number | null };

export const BUCKET_MS = 60_000;
export const RETENTION_MS = 48 * 60 * 60 * 1000;
export const MAX_POINTS = Math.ceil(RETENTION_MS / BUCKET_MS); // 2880

export function metricsDir(base?: string): string {
  return path.join(base ?? appDataDir(), "metrics");
}

export function historyFile(serverId: number, base?: string): string {
  return path.join(metricsDir(base), `${serverId}.jsonl`);
}

export function bucketStart(t: number): number {
  return t - (t % BUCKET_MS);
}

// One bucket summarizes its samples: average CPU/RAM (what the server
// cost), peak players (what the server hosted), last known TPS.
export function aggregateBucket(t: number, samples: Metric[]): HistoryPoint | null {
  if (samples.length === 0) return null;
  const cpu = samples.reduce((sum, s) => sum + s.cpu, 0) / samples.length;
  const ram = samples.reduce((sum, s) => sum + s.ram, 0) / samples.length;
  const players = samples.reduce((peak, s) => Math.max(peak, s.players), 0);
  const tps = [...samples].reverse().find((s) => s.tps !== null)?.tps ?? null;
  return { t: bucketStart(t), cpu: +cpu.toFixed(1), ram: Math.round(ram), players, tps };
}

export function parseHistoryLine(line: string): HistoryPoint | null {
  try {
    const raw = JSON.parse(line) as Partial<HistoryPoint>;
    if (typeof raw?.t !== "number" || !Number.isFinite(raw.t)) return null;
    if (typeof raw.cpu !== "number" || !Number.isFinite(raw.cpu)) return null;
    if (typeof raw.ram !== "number" || !Number.isFinite(raw.ram)) return null;
    if (typeof raw.players !== "number" || !Number.isFinite(raw.players)) return null;
    return { t: raw.t, cpu: raw.cpu, ram: raw.ram, players: raw.players, tps: typeof raw.tps === "number" && Number.isFinite(raw.tps) ? raw.tps : null };
  } catch {
    return null;
  }
}

export function pruneHistory(points: HistoryPoint[], now: number): HistoryPoint[] {
  const cutoff = now - RETENTION_MS;
  const kept = points.filter((p) => p.t >= cutoff && p.t <= now + BUCKET_MS);
  return kept.length > MAX_POINTS ? kept.slice(kept.length - MAX_POINTS) : kept;
}

// ---- collection ----------------------------------------------------------
// Live samples accumulate in memory per server; when a sample lands in a
// new minute, the finished bucket is aggregated and appended. Collection
// never throws: metrics history must not be able to hurt a running server.

const pending = new Map<number, { bucket: number; samples: Metric[] }>();
const appendCounts = new Map<number, number>();
const COMPACT_EVERY = 240; // compact roughly every 4 hours of appends

export async function recordMetricsSample(serverId: number, sample: Metric, base?: string): Promise<void> {
  try {
    const bucket = bucketStart(sample.t);
    const entry = pending.get(serverId);
    if (!entry) {
      pending.set(serverId, { bucket, samples: [sample] });
      return;
    }
    if (entry.bucket === bucket) {
      entry.samples.push(sample);
      return;
    }
    const point = aggregateBucket(entry.bucket, entry.samples);
    pending.set(serverId, { bucket, samples: [sample] });
    if (!point) return;
    await fsp.mkdir(metricsDir(base), { recursive: true });
    await fsp.appendFile(historyFile(serverId, base), `${JSON.stringify(point)}\n`, "utf8");
    const count = (appendCounts.get(serverId) ?? 0) + 1;
    appendCounts.set(serverId, count);
    if (count % COMPACT_EVERY === 0) await compactHistory(serverId, base);
  } catch {
    /* history is best-effort by design */
  }
}

// Flush whatever is buffered for a server (called when it stops), so short
// sessions still leave a trace.
export async function flushMetricsHistory(serverId: number, base?: string): Promise<void> {
  try {
    const entry = pending.get(serverId);
    pending.delete(serverId);
    if (!entry) return;
    const point = aggregateBucket(entry.bucket, entry.samples);
    if (!point) return;
    await fsp.mkdir(metricsDir(base), { recursive: true });
    await fsp.appendFile(historyFile(serverId, base), `${JSON.stringify(point)}\n`, "utf8");
  } catch {
    /* best-effort */
  }
}

async function compactHistory(serverId: number, base?: string): Promise<void> {
  const file = historyFile(serverId, base);
  const points = await readHistory(serverId, RETENTION_MS, base);
  await fsp.writeFile(file, points.map((p) => JSON.stringify(p)).join("\n") + (points.length ? "\n" : ""), "utf8");
}

export async function readHistory(serverId: number, windowMs: number, base?: string): Promise<HistoryPoint[]> {
  try {
    const text = await fsp.readFile(historyFile(serverId, base), "utf8");
    const now = Date.now();
    const all = pruneHistory(
      text
        .split("\n")
        .map(parseHistoryLine)
        .filter((p): p is HistoryPoint => p !== null),
      now,
    );
    const cutoff = now - Math.min(windowMs, RETENTION_MS);
    return all.filter((p) => p.t >= cutoff).sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}
