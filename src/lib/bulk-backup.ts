// Pure decision logic for fleet-wide "backup everything" requests. The
// per-server archive work stays in the runtime (createBackup already
// builds asynchronously); this layer decides which servers may be
// snapshotted, how the batch is labeled, and how the outcome reads.

import { BULK_LIMIT } from "./bulk-power";

export { BULK_LIMIT };

// A backup taken mid-install or mid-update would archive a half-written
// directory — worse than no backup, because it looks restorable.
// Everything else (online, offline, crashed, …) snapshots fine: tar reads
// whatever is on disk, exactly like the existing per-server button.
export function bulkBackupEligible(status: string): boolean {
  return status !== "installing" && status !== "updating";
}

export function partitionBulkBackup<T extends { id: number; status: string }>(
  servers: T[]
): { eligible: T[]; skipped: T[] } {
  const eligible: T[] = [];
  const skipped: T[] = [];
  for (const server of servers) (bulkBackupEligible(server.status) ? eligible : skipped).push(server);
  return { eligible, skipped };
}

/** One shared label per batch, so a fleet snapshot reads as one event
 *  across every server's backup list. */
export function bulkBackupLabel(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `fleet-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export type BulkBackupOutcome = { id: number; name: string; outcome: "started" | "skipped" | "failed"; reason?: string };

/** Notice line for the fleet bar. */
export function summarizeBulkBackup(results: BulkBackupOutcome[]): string {
  const started = results.filter((r) => r.outcome === "started").length;
  const skipped = results.filter((r) => r.outcome === "skipped").length;
  const failed = results.filter((r) => r.outcome === "failed").length;
  const parts = [`Started ${started} backup${started === 1 ? "" : "s"}`];
  if (skipped > 0) parts.push(`skipped ${skipped}`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(", ");
}
