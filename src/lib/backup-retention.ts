// Pure backup-retention policy: given a server's backup rows and its
// retention settings, decide which backups to prune. Enforcement (file
// deletion, database rows, audit logging) lives in runtime.ts; this module
// is side-effect free so the policy is directly unit-testable.

export interface RetentionBackup {
  id: number;
  status: string;
  createdAt: Date | null;
}

export interface RetentionInput {
  backups: RetentionBackup[];
  /** Keep at most this many complete backups. 0 disables the count limit. */
  retentionCount: number;
  /** Prune complete backups older than this many days. 0 disables the age limit. */
  retentionDays: number;
  /** Backup ids that must never be pruned (e.g. the active update safety backup). */
  protectedIds?: Iterable<number>;
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the ids of backups that should be pruned, ascending.
 *
 * Rules:
 * - Only backups with status "complete" are ever pruned. Rows that are
 *   still building keep running, and failed rows keep their diagnostic
 *   note until deleted explicitly.
 * - Protected ids are never pruned. A protected backup still occupies a
 *   retention slot: it is a real backup the operator can restore.
 * - The count limit keeps the newest `retentionCount` complete backups
 *   (newest by createdAt, ties broken by higher id).
 * - The age limit prunes complete backups strictly older than
 *   `retentionDays` days.
 * - A retention value of 0 disables that limit; if both are 0 nothing is
 *   ever pruned.
 */
export function selectBackupsToPrune(input: RetentionInput): number[] {
  const count = clampRetentionCount(input.retentionCount);
  const days = clampRetentionDays(input.retentionDays);
  if (count === 0 && days === 0) return [];

  const protectedIds = new Set(input.protectedIds ?? []);
  const now = input.now ?? new Date();
  const complete = input.backups
    .filter((backup) => backup.status === "complete")
    .sort((a, b) => {
      const at = a.createdAt?.getTime() ?? 0;
      const bt = b.createdAt?.getTime() ?? 0;
      if (bt !== at) return bt - at;
      return b.id - a.id;
    });

  const prune = new Set<number>();
  if (count > 0) {
    for (const backup of complete.slice(count)) prune.add(backup.id);
  }
  if (days > 0) {
    const cutoff = now.getTime() - days * DAY_MS;
    for (const backup of complete) {
      const created = backup.createdAt?.getTime();
      if (created !== undefined && created < cutoff) prune.add(backup.id);
    }
  }
  for (const id of protectedIds) prune.delete(id);
  return [...prune].sort((a, b) => a - b);
}

/** Valid range for the count limit: 0 (unlimited) to 100. */
export function clampRetentionCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Valid range for the age limit: 0 (unlimited) to 365 days. */
export function clampRetentionDays(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(365, Math.max(0, Math.round(value)));
}
