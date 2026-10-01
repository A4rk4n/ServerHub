// Disk usage explorer: per-server storage breakdown (world / mods / logs /
// backups / rest), biggest files, day & week growth from daily snapshots,
// and actionable cleanup hints. Pure logic only — the runtime walks the
// directory and owns the snapshot file (appdata/disk-usage.json, no
// database schema change).

export type UsageCategory = "world" | "mods" | "logs" | "rest";

export const USAGE_CATEGORIES: readonly UsageCategory[] = ["world", "mods", "logs", "rest"];

/** Top-level directory names that hold world/save data, across supported games. */
const WORLD_DIRS = new Set([
  "world", "world_nether", "world_the_end", "worlds", "saves", "saved",
  "universe", "save", "savegames", "storage",
]);

/** Top-level directory names that hold mods/plugins/packs. */
const MOD_DIRS = new Set([
  "mods", "plugins", "coremods", "datapacks", "resourcepacks", "behavior_packs",
  "bepinex", "oxide", "libraries", "modpacks",
]);

/** Top-level directory names that hold logs and crash dumps. */
const LOG_DIRS = new Set(["logs", "crash-reports", "crashes", "debug"]);

const LOG_FILE_PATTERN = /\.log(?:\.\d+)?(?:\.gz)?$/i;

/** Classify a file by its server-relative POSIX path. */
export function classifyPath(relPath: string): UsageCategory {
  const top = relPath.split("/")[0]?.toLowerCase() ?? "";
  if (WORLD_DIRS.has(top)) return "world";
  if (MOD_DIRS.has(top)) return "mods";
  if (LOG_DIRS.has(top) || LOG_FILE_PATTERN.test(relPath)) return "logs";
  if (/\.(wld|twld|db|sav|anvil)$/i.test(relPath) && !relPath.includes("/")) return "world";
  return "rest";
}

export type UsageFile = { path: string; sizeBytes: number };
export type RankedFile = UsageFile & { category: UsageCategory };

export type UsageReport = {
  totalBytes: number;
  categories: Record<UsageCategory, number>;
  fileCount: number;
  biggest: RankedFile[];
  /** True when the walker stopped early (entry budget); numbers are then lower bounds. */
  truncated: boolean;
};

export const BIGGEST_FILES_LIMIT = 10;
/** Directory walk budget — beyond this the report is marked truncated. */
export const MAX_SCAN_ENTRIES = 50_000;

export function buildUsageReport(files: UsageFile[], truncated = false, biggestLimit = BIGGEST_FILES_LIMIT): UsageReport {
  const categories: Record<UsageCategory, number> = { world: 0, mods: 0, logs: 0, rest: 0 };
  const ranked: RankedFile[] = [];
  let totalBytes = 0;
  for (const file of files) {
    const category = classifyPath(file.path);
    const size = Number.isFinite(file.sizeBytes) && file.sizeBytes > 0 ? file.sizeBytes : 0;
    categories[category] += size;
    totalBytes += size;
    ranked.push({ ...file, sizeBytes: size, category });
  }
  ranked.sort((a, b) => b.sizeBytes - a.sizeBytes || a.path.localeCompare(b.path));
  return { totalBytes, categories, fileCount: files.length, biggest: ranked.slice(0, biggestLimit), truncated };
}

// ---------------------------------------------------------------------------
// Growth history (appdata/disk-usage.json)
// ---------------------------------------------------------------------------

export type UsageSnapshot = { day: string; totalBytes: number };
export type UsageHistory = Record<string, UsageSnapshot[]>;

export const MAX_HISTORY_DAYS = 90;

export function normalizeUsageHistory(raw: unknown): UsageHistory {
  const history: UsageHistory = {};
  if (!raw || typeof raw !== "object") return history;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || !Array.isArray(value)) continue;
    const rows: UsageSnapshot[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const { day, totalBytes } = item as Record<string, unknown>;
      if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (typeof totalBytes !== "number" || !Number.isFinite(totalBytes) || totalBytes < 0) continue;
      rows.push({ day, totalBytes });
    }
    rows.sort((a, b) => a.day.localeCompare(b.day));
    if (rows.length) history[key] = rows.slice(-MAX_HISTORY_DAYS);
  }
  return history;
}

/** Record today's total (server dir + backups). One snapshot per day — the latest scan of a day wins. */
export function recordUsageSnapshot(history: UsageHistory, serverId: number, totalBytes: number, now = new Date()): UsageHistory {
  const day = now.toISOString().slice(0, 10);
  const key = String(serverId);
  const rows = (history[key] ?? []).filter((row) => row.day !== day);
  rows.push({ day, totalBytes });
  rows.sort((a, b) => a.day.localeCompare(b.day));
  return { ...history, [key]: rows.slice(-MAX_HISTORY_DAYS) };
}

export type UsageGrowth = {
  /** Byte delta vs the most recent snapshot at least 1 day old; null without history. */
  dayBytes: number | null;
  /** Byte delta vs the most recent snapshot at least 7 days old; null without history. */
  weekBytes: number | null;
};

function deltaAgainst(rows: UsageSnapshot[], current: number, today: string, minAgeDays: number): number | null {
  const cutoff = new Date(`${today}T00:00:00.000Z`).getTime() - minAgeDays * 86_400_000;
  const candidates = rows.filter((row) => new Date(`${row.day}T00:00:00.000Z`).getTime() <= cutoff);
  if (!candidates.length) return null;
  return current - candidates[candidates.length - 1].totalBytes;
}

export function computeGrowth(history: UsageHistory, serverId: number, currentTotal: number, now = new Date()): UsageGrowth {
  const rows = history[String(serverId)] ?? [];
  const today = now.toISOString().slice(0, 10);
  return {
    dayBytes: deltaAgainst(rows, currentTotal, today, 1),
    weekBytes: deltaAgainst(rows, currentTotal, today, 7),
  };
}

// ---------------------------------------------------------------------------
// Cleanup hints
// ---------------------------------------------------------------------------

export type CleanupContext = {
  report: UsageReport;
  backupsBytes: number;
  backupsCount: number;
  retentionConfigured: boolean;
  crashReportCount: number;
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Deterministic, ordered, capped at 4 — enough to act on, not a wall of nagging. */
export function cleanupHints(ctx: CleanupContext): string[] {
  const hints: string[] = [];
  if (ctx.report.categories.logs > 200 * MB) {
    hints.push(`Logs take ${formatBytes(ctx.report.categories.logs)} — old session logs and crash dumps can usually be deleted.`);
  }
  if (ctx.crashReportCount > 10) {
    hints.push(`${ctx.crashReportCount} crash reports accumulated — keep the newest few and clear the rest.`);
  }
  if (!ctx.retentionConfigured && ctx.backupsCount > 10) {
    hints.push(`${ctx.backupsCount} backups (${formatBytes(ctx.backupsBytes)}) with no retention policy — set count or age limits on the Backups page.`);
  }
  const giant = ctx.report.biggest.find((file) => file.sizeBytes > 2 * GB);
  if (giant) {
    hints.push(`${giant.path} alone is ${formatBytes(giant.sizeBytes)} — check whether it is still needed.`);
  }
  return hints.slice(0, 4);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 B";
  const negative = bytes < 0;
  const abs = Math.abs(bytes);
  const text =
    abs >= GB ? `${(abs / GB).toFixed(abs >= 10 * GB ? 0 : 1)} GB`
    : abs >= MB ? `${(abs / MB).toFixed(abs >= 10 * MB ? 0 : 1)} MB`
    : abs >= 1024 ? `${Math.round(abs / 1024)} KB`
    : `${Math.round(abs)} B`;
  return negative ? `-${text}` : text;
}
