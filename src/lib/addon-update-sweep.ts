// Scheduled mod-update sweep: the manual "Check for updates" button
// (addon-updates.ts) covers one server on demand; this layer decides WHEN
// the whole fleet is re-checked automatically and WHAT is worth telling
// the operator about. Opt-in by design — it talks to an external API —
// and it only notifies when the set of available updates actually
// changes, so a daily sweep never degrades into a daily nag about the
// same pending update. Pure logic here; the runtime owns the timer, the
// network, and the state file.

export type AddonSweepConfig = {
  enabled: boolean;
  /** Hours between fleet-wide checks. */
  intervalHours: number;
};

export const SWEEP_HOURS_FLOOR = 6;
export const SWEEP_HOURS_CEIL = 168; // one week

// Disabled by default: contacting Modrinth on a schedule is the
// operator's call, not ours.
export const DEFAULT_ADDON_SWEEP_CONFIG: AddonSweepConfig = {
  enabled: false,
  intervalHours: 24,
};

export function normalizeAddonSweepConfig(raw: unknown): AddonSweepConfig {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<AddonSweepConfig>;
  const intervalHours = Number.isInteger(input.intervalHours)
    ? Math.min(SWEEP_HOURS_CEIL, Math.max(SWEEP_HOURS_FLOOR, input.intervalHours as number))
    : DEFAULT_ADDON_SWEEP_CONFIG.intervalHours;
  return { enabled: input.enabled === true, intervalHours };
}

/** A sweep is due when enabled and the interval has fully elapsed (a
 *  never-run state is due immediately). */
export function addonSweepDue(lastRunAtMs: number, nowMs: number, config: AddonSweepConfig): boolean {
  if (!config.enabled) return false;
  if (lastRunAtMs <= 0) return true;
  return nowMs - lastRunAtMs >= config.intervalHours * 3_600_000;
}

export type AddonUpdateFinding = { name: string; installed: string; latest: string };

/** Human line for notifications/activity: names the first few updates,
 *  counts the rest. */
export function formatAddonUpdateDetail(findings: AddonUpdateFinding[], max = 3): string {
  const shown = findings.slice(0, max).map((f) => `${f.name} ${f.installed} → ${f.latest}`);
  const rest = findings.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

/** Order-insensitive fingerprint of "what updates are on offer". Equal
 *  signatures on consecutive sweeps mean nothing new — stay silent. */
export function findingsSignature(findings: AddonUpdateFinding[]): string {
  return findings
    .map((f) => `${f.name}@${f.latest}`)
    .sort()
    .join("|");
}
