// Backup-vs-live diff (F60): before restoring a single file from a
// backup, show exactly what changed since that backup was taken. The
// heavy lifting is the F50 diff engine; this layer only classifies
// the comparison and words the one-line verdict the browser shows
// above the hunks.

import { diffFiles, type FileDiff } from "./config-diff";

export type BackupComparisonState = "identical" | "changed" | "live-missing";

export type BackupComparison = {
  state: BackupComparisonState;
  summary: string;
  /** Backup text is the "before" side, live text the "after" side. */
  diff: FileDiff | null;
};

/**
 * Compare a file inside a backup against today's live copy. Additions
 * are lines the live file gained since the backup; deletions are
 * lines restoring would bring back.
 */
export function compareBackupToLive(backupText: string, liveText: string | null): BackupComparison {
  if (liveText === null) {
    return {
      state: "live-missing",
      summary: "This file no longer exists in the server directory — restoring would bring it back.",
      diff: null,
    };
  }
  const diff = diffFiles(backupText, liveText);
  if (diff.identical) {
    return { state: "identical", summary: "The live file matches this backup exactly — nothing to restore.", diff: null };
  }
  const added = `${diff.added} line${diff.added === 1 ? "" : "s"} added`;
  const removed = `${diff.removed} line${diff.removed === 1 ? "" : "s"} removed`;
  return {
    state: "changed",
    summary: `Since this backup: ${added}, ${removed} in the live file. Restoring overwrites the live copy with the backup version.`,
    diff,
  };
}
