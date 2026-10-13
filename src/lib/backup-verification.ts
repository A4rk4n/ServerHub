// Backup integrity verification. A backup that cannot be restored is not a
// backup — so the runtime re-checks every completed archive (sha-256 against
// the recorded checksum plus a full tar walk with the same safety posture as
// restore) on a rolling schedule, caches the verdicts in an app-data sidecar,
// and raises a `backup-corrupt` notification the moment a verdict flips bad.
// Pure logic here: state shape, candidate selection, pruning, summarizing.
// The runtime owns file IO, the scheduler, and delivery.

export type VerificationRecord = {
  ok: boolean;
  /** Human-readable reason when ok is false; empty when the archive is sound. */
  problem: string;
  checksum: string;
  verifiedAt: string;
  archiveBytes: number;
};

/** backup id (string) → latest verdict. */
export type VerificationState = Record<string, VerificationRecord>;

export const VERIFY_SWEEP_EVERY_MS = 6 * 3_600_000;
export const REVERIFY_AFTER_DAYS = 7;
/** Archives hashed per background sweep — backlogs drain across sweeps. */
export const MAX_VERIFY_PER_SWEEP = 2;
/** Cap for an operator-forced "verify now" pass. */
export const MAX_VERIFY_FORCED = 50;

export function normalizeVerificationState(raw: unknown): VerificationState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const state: VerificationState = {};
  for (const [id, record] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(id) || !record || typeof record !== "object") continue;
    const r = record as Record<string, unknown>;
    if (typeof r.ok !== "boolean") continue;
    const verifiedAt = typeof r.verifiedAt === "string" && Number.isFinite(Date.parse(r.verifiedAt)) ? r.verifiedAt : null;
    if (!verifiedAt) continue;
    state[id] = {
      ok: r.ok,
      problem: typeof r.problem === "string" ? r.problem.slice(0, 500) : "",
      checksum: typeof r.checksum === "string" ? r.checksum : "",
      verifiedAt,
      archiveBytes: typeof r.archiveBytes === "number" && Number.isFinite(r.archiveBytes) && r.archiveBytes >= 0 ? Math.floor(r.archiveBytes) : 0,
    };
  }
  return state;
}

export type VerifiableBackup = { id: number; status: string; archivePath: string };

/**
 * Pick which archives to (re-)hash this pass: completed backups with an
 * archive on record whose verdict is missing or older than `staleDays`.
 * Newest backups first — they are the ones a restore would reach for.
 */
export function selectBackupsToVerify(rows: VerifiableBackup[], state: VerificationState, nowMs: number, limit = MAX_VERIFY_PER_SWEEP, staleDays = REVERIFY_AFTER_DAYS): number[] {
  const staleBefore = nowMs - staleDays * 86_400_000;
  return rows
    .filter((row) => {
      if (row.status !== "complete" || !row.archivePath) return false;
      const record = state[String(row.id)];
      if (!record) return true;
      return Date.parse(record.verifiedAt) < staleBefore;
    })
    .sort((a, b) => b.id - a.id)
    .slice(0, Math.max(0, limit))
    .map((row) => row.id);
}

/** Drop verdicts for backups that no longer exist. */
export function pruneVerificationState(state: VerificationState, knownIds: Set<string>): VerificationState {
  const pruned: VerificationState = {};
  for (const [id, record] of Object.entries(state)) if (knownIds.has(id)) pruned[id] = record;
  return pruned;
}

export type VerificationSummary = { total: number; verified: number; corrupt: number; unverified: number };

export function summarizeVerification(state: VerificationState, backupIds: number[]): VerificationSummary {
  let verified = 0;
  let corrupt = 0;
  for (const id of backupIds) {
    const record = state[String(id)];
    if (!record) continue;
    if (record.ok) verified += 1;
    else corrupt += 1;
  }
  return { total: backupIds.length, verified, corrupt, unverified: backupIds.length - verified - corrupt };
}
