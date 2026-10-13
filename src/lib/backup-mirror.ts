// Backup mirror target: a secondary destination (second disk, NAS share,
// synced folder) that receives a checksum-verified copy of every completed
// backup archive. Pure logic only — configuration shape, directory safety,
// sync planning, health summaries, and the digest note. The runtime owns
// all file copies and hashing; mirror state lives in a JSON file under the
// app-data directory (no database schema change).

import path from "node:path";

export type MirrorConfig = {
  enabled: boolean;
  /** Absolute path of the mirror destination directory. */
  directory: string;
};

export const DEFAULT_MIRROR_CONFIG: MirrorConfig = { enabled: false, directory: "" };

export function normalizeMirrorConfig(raw: unknown): MirrorConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MIRROR_CONFIG };
  const record = raw as Record<string, unknown>;
  const directory = typeof record.directory === "string" ? record.directory.trim() : "";
  return { enabled: record.enabled === true && directory.length > 0, directory };
}

/**
 * Guard the mirror destination. The mirror must never live inside the
 * app-data directory (it would mirror onto the same disk the primaries are
 * on — and retention could then chase its own tail), and app-data must not
 * live inside the mirror (stale-cleanup would walk our own data).
 * Returns a human-readable problem, or null when the directory is safe.
 */
export function validateMirrorDirectory(directory: string, appData: string): string | null {
  const dir = directory.trim();
  if (!dir) return "Choose a mirror directory.";
  if (!path.isAbsolute(dir)) return "The mirror directory must be an absolute path.";
  const rel = path.relative(path.resolve(appData), path.resolve(dir));
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return "The mirror directory cannot be inside the Server Hub data directory.";
  }
  const inverse = path.relative(path.resolve(dir), path.resolve(appData));
  if (inverse === "" || (!inverse.startsWith("..") && !path.isAbsolute(inverse))) {
    return "The Server Hub data directory lives inside that path — pick a separate location.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mirror state (appdata/backup-mirror-state.json)
// ---------------------------------------------------------------------------

export type MirrorEntry = {
  status: "mirrored" | "failed";
  /** Relative path of the copy inside the mirror directory. */
  file: string;
  /** SHA-256 of the verified copy (empty for failed entries). */
  checksum: string;
  mirroredAt: string;
  error?: string;
};

export type MirrorState = { version: 1; entries: Record<string, MirrorEntry> };

export function normalizeMirrorState(raw: unknown): MirrorState {
  const fresh: MirrorState = { version: 1, entries: {} };
  if (!raw || typeof raw !== "object") return fresh;
  const entries = (raw as Record<string, unknown>).entries;
  if (!entries || typeof entries !== "object") return fresh;
  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || !value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const status = entry.status === "mirrored" || entry.status === "failed" ? entry.status : null;
    const file = typeof entry.file === "string" ? entry.file : "";
    if (!status || !file) continue;
    fresh.entries[key] = {
      status,
      file,
      checksum: typeof entry.checksum === "string" ? entry.checksum : "",
      mirroredAt: typeof entry.mirroredAt === "string" ? entry.mirroredAt : "",
      ...(typeof entry.error === "string" && entry.error ? { error: entry.error } : {}),
    };
  }
  return fresh;
}

// ---------------------------------------------------------------------------
// Layout & sync planning
// ---------------------------------------------------------------------------

/** Primary archive names look like `000042-my-label.tar.gz`. Stale cleanup only ever touches matches. */
export const MIRROR_ARCHIVE_PATTERN = /^\d{6}-[A-Za-z0-9._-]+\.tar\.gz$/;

/** Where a backup's copy lives inside the mirror directory (POSIX separators for state portability). */
export function mirrorRelativePath(serverId: number, archiveBasename: string): string {
  if (!Number.isInteger(serverId) || serverId <= 0) throw new Error(`Invalid server id: ${serverId}`);
  if (!MIRROR_ARCHIVE_PATTERN.test(archiveBasename)) throw new Error(`Unsafe archive name: ${archiveBasename}`);
  return `server-${serverId}/${archiveBasename}`;
}

export type MirrorBackupRef = { id: number; serverId: number; status: string; archiveBasename: string };

export type MirrorSyncPlan = {
  /** Backup ids that need a (re-)copy: never mirrored, previously failed, or the copy vanished. */
  toCopy: number[];
  /** Relative paths inside the mirror that match our naming but belong to no current backup (pruned primaries). */
  stale: string[];
  /** Backups whose verified copy is still present. */
  upToDate: number[];
};

/**
 * Reconcile the mirror with the primary backup list. `mirrorFiles` is the
 * set of relative paths (POSIX separators) actually present in the mirror
 * directory that match MIRROR_ARCHIVE_PATTERN under a `server-<id>/` folder.
 */
export function planMirrorSync(backups: MirrorBackupRef[], state: MirrorState, mirrorFiles: Set<string>): MirrorSyncPlan {
  const toCopy: number[] = [];
  const upToDate: number[] = [];
  const owned = new Set<string>();
  for (const backup of backups) {
    if (backup.status !== "complete") continue;
    let rel: string;
    try {
      rel = mirrorRelativePath(backup.serverId, backup.archiveBasename);
    } catch {
      continue; // a name we refuse to place in the mirror is never copied
    }
    owned.add(rel);
    const entry = state.entries[String(backup.id)];
    if (entry && entry.status === "mirrored" && entry.file === rel && mirrorFiles.has(rel)) upToDate.push(backup.id);
    else toCopy.push(backup.id);
  }
  const stale = [...mirrorFiles].filter((rel) => !owned.has(rel)).sort();
  return { toCopy, stale, upToDate };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type MirrorHealth = {
  /** Completed backups that should have a mirror copy. */
  eligible: number;
  mirrored: number;
  pending: number;
  failed: number;
  lastError: string | null;
};

export function summarizeMirrorHealth(backups: Array<{ id: number; status: string }>, state: MirrorState): MirrorHealth {
  let eligible = 0;
  let mirrored = 0;
  let failed = 0;
  let lastError: string | null = null;
  for (const backup of backups) {
    if (backup.status !== "complete") continue;
    eligible += 1;
    const entry = state.entries[String(backup.id)];
    if (entry?.status === "mirrored") mirrored += 1;
    else if (entry?.status === "failed") {
      failed += 1;
      if (entry.error) lastError = entry.error;
    }
  }
  return { eligible, mirrored, pending: eligible - mirrored - failed, failed, lastError };
}

/** One-line mirror health for the activity digest. Empty string when the mirror is disabled. */
export function formatMirrorNote(config: MirrorConfig, health: MirrorHealth): string {
  if (!config.enabled) return "";
  if (health.eligible === 0) return "🪞 Backup mirror: enabled, no backups to mirror yet.";
  const parts = [`${health.mirrored}/${health.eligible} mirrored`];
  if (health.pending > 0) parts.push(`${health.pending} pending`);
  if (health.failed > 0) parts.push(`⚠️ ${health.failed} FAILED`);
  return `🪞 Backup mirror: ${parts.join(" · ")}`;
}
