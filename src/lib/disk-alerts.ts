// Disk-space alerts: the panel volume is checked every few minutes and a
// webhook + activity entry fire when free space drops below the threshold.
// A full disk is the silent killer of game servers — backups fail, worlds
// corrupt mid-save — and none of the per-server guardrails can see it
// coming. Alert-only by design: nothing is ever deleted automatically.
// Pure logic here — the runtime owns the timer, statfs, and delivery.

export type DiskAlertConfig = {
  enabled: boolean;
  /** Alert when free space on the panel volume drops below this. */
  minFreeMb: number;
  /** Minutes between repeat alerts while space stays low. */
  cooldownMin: number;
};

export const MIN_FREE_MB_FLOOR = 128;
export const MIN_FREE_MB_CEIL = 1_048_576; // 1 TB
export const COOLDOWN_MIN_FLOOR = 15;
export const COOLDOWN_MIN_CEIL = 10_080; // one week

export const DEFAULT_DISK_ALERT_CONFIG: DiskAlertConfig = {
  enabled: true,
  minFreeMb: 2048,
  cooldownMin: 360,
};

export function normalizeDiskAlertConfig(raw: unknown): DiskAlertConfig {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<DiskAlertConfig>;
  const minFreeMb = Number.isInteger(input.minFreeMb)
    ? Math.min(MIN_FREE_MB_CEIL, Math.max(MIN_FREE_MB_FLOOR, input.minFreeMb as number))
    : DEFAULT_DISK_ALERT_CONFIG.minFreeMb;
  const cooldownMin = Number.isInteger(input.cooldownMin)
    ? Math.min(COOLDOWN_MIN_CEIL, Math.max(COOLDOWN_MIN_FLOOR, input.cooldownMin as number))
    : DEFAULT_DISK_ALERT_CONFIG.cooldownMin;
  return { enabled: input.enabled !== false, minFreeMb, cooldownMin };
}

export type DiskBreach = { freeMb: number; minFreeMb: number };

/** Breached while free space sits strictly below the configured floor. */
export function evaluateDiskFree(freeMb: number, minFreeMb: number): DiskBreach | null {
  if (!Number.isFinite(freeMb) || freeMb < 0) return null;
  return freeMb < minFreeMb ? { freeMb, minFreeMb } : null;
}

/** First alert always fires; repeats wait out the cooldown. */
export function isDiskAlertDue(nowMs: number, lastAlertAtMs: number, cooldownMin: number): boolean {
  if (lastAlertAtMs <= 0) return true;
  return nowMs - lastAlertAtMs >= cooldownMin * 60_000;
}

export function formatMb(mb: number): string {
  if (mb >= 10_240) return `${(mb / 1024).toFixed(0)} GB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function diskAlertDetail(breach: DiskBreach): string {
  return `${formatMb(breach.freeMb)} free on the panel volume (threshold ${formatMb(breach.minFreeMb)})`;
}
