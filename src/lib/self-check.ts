// Panel self-check: one on-demand sweep that answers "is the panel's
// own house in order?" — database integrity and size, console-log
// backlog, sidecar-file validity, backup archives that the database
// believes in but the disk lost (and vice versa), mod files that
// vanished from under their addon rows, and free disk. The API route
// gathers the facts; these evaluators turn facts into verdicts so every
// threshold is unit-testable. Distinct from /api/health (liveness ping)
// and Tool Health (external tools like Java/SteamCMD).

export type SelfCheckStatus = "ok" | "warn" | "fail";

export type SelfCheckItem = {
  id: string;
  label: string;
  status: SelfCheckStatus;
  detail: string;
};

const GIB = 1024 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** integrity: result of PRAGMA quick_check ("ok" when healthy), or null
 *  when the check could not run at all. */
export function evalDatabase(sizeBytes: number, integrity: string | null): SelfCheckItem {
  if (integrity !== null && integrity !== "ok") {
    return { id: "database", label: "Database", status: "fail", detail: `Integrity check reported: ${integrity.slice(0, 120)}` };
  }
  if (integrity === null) {
    return { id: "database", label: "Database", status: "warn", detail: "Could not run the integrity check" };
  }
  const size = formatBytes(sizeBytes);
  if (sizeBytes > GIB) {
    return { id: "database", label: "Database", status: "warn", detail: `Healthy, but large (${size}) — consider pruning console logs and task history` };
  }
  return { id: "database", label: "Database", status: "ok", detail: `Integrity ok, ${size}` };
}

export function evalConsoleBacklog(rows: number): SelfCheckItem {
  const detail = `${rows.toLocaleString("en-US")} console lines stored`;
  if (rows > 1_000_000) {
    return { id: "console-backlog", label: "Console log backlog", status: "warn", detail: `${detail} — searches slow down at this volume; lower the retention window` };
  }
  return { id: "console-backlog", label: "Console log backlog", status: "ok", detail };
}

export function evalSidecars(bad: string[], total: number): SelfCheckItem {
  if (bad.length > 0) {
    return { id: "sidecars", label: "Settings files", status: "fail", detail: `Unreadable JSON: ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? ` and ${bad.length - 5} more` : ""}` };
  }
  return { id: "sidecars", label: "Settings files", status: "ok", detail: `${total} app-data file${total === 1 ? "" : "s"} parse cleanly` };
}

export function evalBackupArchives(missingNames: string[], orphanedCount: number, orphanedBytes: number): SelfCheckItem {
  if (missingNames.length > 0) {
    return {
      id: "backup-archives",
      label: "Backup archives",
      status: "fail",
      detail: `${missingNames.length} completed backup${missingNames.length === 1 ? "" : "s"} missing on disk: ${missingNames.slice(0, 3).join(", ")}${missingNames.length > 3 ? "…" : ""} — these cannot be restored`,
    };
  }
  if (orphanedCount > 0) {
    return {
      id: "backup-archives",
      label: "Backup archives",
      status: "warn",
      detail: `${orphanedCount} archive file${orphanedCount === 1 ? "" : "s"} (${formatBytes(orphanedBytes)}) on disk with no database record — safe to delete`,
    };
  }
  return { id: "backup-archives", label: "Backup archives", status: "ok", detail: "Every completed backup exists on disk; no orphaned archives" };
}

export function evalAddonFiles(missing: string[]): SelfCheckItem {
  if (missing.length > 0) {
    return {
      id: "addon-files",
      label: "Mod files",
      status: "warn",
      detail: `${missing.length} installed mod${missing.length === 1 ? "" : "s"} missing from disk: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""} — uninstall and reinstall them`,
    };
  }
  return { id: "addon-files", label: "Mod files", status: "ok", detail: "Every tracked mod file is present" };
}

export function evalDiskFree(freeMb: number | null): SelfCheckItem {
  if (freeMb === null) return { id: "disk-free", label: "Disk space", status: "warn", detail: "Could not determine free space" };
  const detail = `${freeMb >= 10_240 ? `${(freeMb / 1024).toFixed(1)} GB` : `${freeMb} MB`} free`;
  if (freeMb < 512) return { id: "disk-free", label: "Disk space", status: "fail", detail: `${detail} — backups and worlds will start failing` };
  if (freeMb < 2_048) return { id: "disk-free", label: "Disk space", status: "warn", detail };
  return { id: "disk-free", label: "Disk space", status: "ok", detail };
}

/** Worst-of rollup: one fail fails the check, else one warn warns it. */
export function summarizeSelfCheck(items: SelfCheckItem[]): { status: SelfCheckStatus; ok: number; warn: number; fail: number } {
  const count = (status: SelfCheckStatus) => items.filter((item) => item.status === status).length;
  const fail = count("fail");
  const warn = count("warn");
  return { status: fail > 0 ? "fail" : warn > 0 ? "warn" : "ok", ok: count("ok"), warn, fail };
}
