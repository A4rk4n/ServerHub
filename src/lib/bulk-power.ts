// Pure decision logic for bulk fleet power actions. Which servers a bulk
// action may touch — and how starts are paced — is decided here so the
// rules are unit testable and shared between the API and the UI.

export type BulkAction = "start" | "stop" | "restart";

export const BULK_ACTIONS: BulkAction[] = ["start", "stop", "restart"];

// Milliseconds between consecutive starts: launching a fleet
// simultaneously spikes CPU/disk and can trip readiness probes.
export const START_STAGGER_MS = 2500;

// Maximum servers per bulk request; anything larger is a client bug.
export const BULK_LIMIT = 100;

// Start: anything not running and not busy installing/updating.
// Stop: running or on its way up (stopFlow also cancels queued restarts).
// Restart: only servers that are actually online, so a bulk restart
// never surprise-starts something the operator left stopped.
export function bulkActionEligible(status: string, action: BulkAction): boolean {
  if (action === "start") return ["offline", "crashed", "error"].includes(status);
  if (action === "stop") return ["online", "starting", "restarting"].includes(status);
  return status === "online";
}

export function partitionBulkAction<T extends { id: number; status: string }>(
  servers: T[],
  action: BulkAction
): { eligible: T[]; skipped: T[] } {
  const eligible: T[] = [];
  const skipped: T[] = [];
  for (const server of servers) {
    (bulkActionEligible(server.status, action) ? eligible : skipped).push(server);
  }
  return { eligible, skipped };
}

// Delay offsets for staggered starts: 0, 2500, 5000, …
export function startDelaysMs(count: number, stepMs = START_STAGGER_MS): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => index * stepMs);
}
