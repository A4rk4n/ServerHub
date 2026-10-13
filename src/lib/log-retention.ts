// Console-log retention: the console_logs table grows without bound on a
// busy server (every chat line, every tick warning), and after a few weeks
// the panel pays for it on every search. An hourly sweep prunes lines older
// than the retention window — optionally gzip-archiving them to app-data
// first, so nothing is lost by default — and caps how many archive files
// each server keeps. Pure logic here; the runtime owns the timer, the
// database, and the filesystem.

export type LogRetentionConfig = {
  enabled: boolean;
  /** Console lines older than this many days are pruned. */
  retentionDays: number;
  /** Gzip pruned lines into app-data/log-archive/<serverId>/ before deletion. */
  archive: boolean;
  /** Maximum archive files kept per server; oldest are deleted first. */
  archiveKeep: number;
};

export const RETENTION_DAYS_FLOOR = 1;
export const RETENTION_DAYS_CEIL = 365;
export const ARCHIVE_KEEP_FLOOR = 1;
export const ARCHIVE_KEEP_CEIL = 365;
/** One sweep per hour is plenty — the batch bound keeps each sweep cheap. */
export const LOG_SWEEP_EVERY_MS = 60 * 60_000;
/** Per server, per sweep. A backlog drains over successive sweeps. */
export const PRUNE_BATCH = 5000;

export const DEFAULT_LOG_RETENTION_CONFIG: LogRetentionConfig = {
  enabled: true,
  retentionDays: 30,
  archive: true,
  archiveKeep: 30,
};

export function normalizeLogRetentionConfig(raw: unknown): LogRetentionConfig {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<LogRetentionConfig>;
  const retentionDays = Number.isInteger(input.retentionDays)
    ? Math.min(RETENTION_DAYS_CEIL, Math.max(RETENTION_DAYS_FLOOR, input.retentionDays as number))
    : DEFAULT_LOG_RETENTION_CONFIG.retentionDays;
  const archiveKeep = Number.isInteger(input.archiveKeep)
    ? Math.min(ARCHIVE_KEEP_CEIL, Math.max(ARCHIVE_KEEP_FLOOR, input.archiveKeep as number))
    : DEFAULT_LOG_RETENTION_CONFIG.archiveKeep;
  return {
    enabled: input.enabled !== false,
    retentionDays,
    archive: input.archive !== false,
    archiveKeep,
  };
}

export function retentionCutoff(nowMs: number, retentionDays: number): Date {
  return new Date(nowMs - retentionDays * 86_400_000);
}

/** UTC-stamped, lexicographically sortable: server-3-20261002-081500.log.gz */
export function archiveFileName(serverId: number, nowMs: number): string {
  const d = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `server-${serverId}-${stamp}.log.gz`;
}

export function formatArchiveLine(row: { ts: Date | null; level: string; source: string; message: string }): string {
  const at = row.ts instanceof Date ? row.ts.toISOString() : "unknown-time";
  return `${at} [${row.level}] ${row.source}: ${row.message}`;
}
