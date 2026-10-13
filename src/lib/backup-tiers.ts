// Tiered (grandfather-father) backup retention: "keep the newest backup
// of each of the last N days, plus the newest of each of the last M ISO
// weeks". The flat policy in backup-retention.ts can only keep "newest N"
// or "younger than D days" — under it a month-old backup never survives a
// count limit. Tiers keep long-term history while capping storage. While
// enabled for a server, tiered selection REPLACES the flat limits.
// Stored in an app-data sidecar; no schema change.

import fsp from "node:fs/promises";
import path from "node:path";
import type { RetentionBackup } from "./backup-retention";
import { appDataDir } from "./storage";

export type BackupTiers = { enabled: boolean; daily: number; weekly: number };

export const MAX_DAILY_TIERS = 30;
export const MAX_WEEKLY_TIERS = 52;

export const DEFAULT_BACKUP_TIERS: BackupTiers = { enabled: false, daily: 7, weekly: 4 };

function clampTier(value: unknown, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return fallback;
  return Math.min(value, max);
}

/** Junk-tolerant; enabled requires at least one tier to actually keep something. */
export function normalizeBackupTiers(raw: unknown): BackupTiers {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<BackupTiers>;
  const daily = clampTier(input.daily, MAX_DAILY_TIERS, DEFAULT_BACKUP_TIERS.daily);
  const weekly = clampTier(input.weekly, MAX_WEEKLY_TIERS, DEFAULT_BACKUP_TIERS.weekly);
  return { enabled: input.enabled === true && daily + weekly > 0, daily, weekly };
}

/** Local calendar day, e.g. "2026-10-04". */
export function localDayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** ISO-8601 week, e.g. "2026-W40" — weeks start Monday, week 1 holds Jan 4. */
export function isoWeekKey(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - weekday + 3); // the Thursday that decides the ISO year
  const isoYear = d.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const week1Thursday = new Date(isoYear, 0, 4 - ((jan4.getDay() + 6) % 7) + 3);
  const week = 1 + Math.round((d.getTime() - week1Thursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Ids of the complete backups a tiered policy keeps: the newest backup of
 * each of the `daily` most recent distinct days that have backups, plus
 * the newest of each of the `weekly` most recent distinct ISO weeks.
 * Protected ids and rows without a timestamp always survive; non-complete
 * rows are not this policy's business.
 */
export function selectTieredSurvivors(backups: RetentionBackup[], tiers: BackupTiers, protectedIds: Iterable<number> = []): Set<number> {
  const survivors = new Set<number>(protectedIds);
  const complete = backups
    .filter((backup) => backup.status === "complete")
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0) || b.id - a.id);
  const seenDays = new Set<string>();
  const seenWeeks = new Set<string>();
  for (const backup of complete) {
    if (!backup.createdAt) {
      survivors.add(backup.id); // never guess about timestamp-less rows
      continue;
    }
    const day = localDayKey(backup.createdAt);
    if (seenDays.size < tiers.daily || seenDays.has(day)) {
      if (!seenDays.has(day)) {
        seenDays.add(day);
        survivors.add(backup.id); // newest of a fresh day slot
      }
    }
    const week = isoWeekKey(backup.createdAt);
    if (seenWeeks.size < tiers.weekly || seenWeeks.has(week)) {
      if (!seenWeeks.has(week)) {
        seenWeeks.add(week);
        survivors.add(backup.id); // newest of a fresh week slot
      }
    }
  }
  return survivors;
}

/** Complete, unprotected backups the tiered policy would prune — ascending ids. */
export function selectTieredBackupsToPrune(backups: RetentionBackup[], tiers: BackupTiers, protectedIds: Iterable<number> = []): number[] {
  if (!tiers.enabled || tiers.daily + tiers.weekly === 0) return [];
  const survivors = selectTieredSurvivors(backups, tiers, protectedIds);
  return backups
    .filter((backup) => backup.status === "complete" && !survivors.has(backup.id))
    .map((backup) => backup.id)
    .sort((a, b) => a - b);
}

// ---- app-data sidecar ------------------------------------------------------

function backupTiersFile(base?: string) {
  return path.join(base ?? appDataDir(), "backup-tiers.json");
}

export async function readAllBackupTiers(base?: string): Promise<Record<string, BackupTiers>> {
  try {
    const raw = JSON.parse(await fsp.readFile(backupTiersFile(base), "utf8")) as Record<string, unknown>;
    const result: Record<string, BackupTiers> = {};
    for (const [id, value] of Object.entries(raw)) {
      const tiers = normalizeBackupTiers(value);
      if (tiers.enabled) result[id] = tiers;
    }
    return result;
  } catch {
    return {};
  }
}

export async function readBackupTiers(serverId: number, base?: string): Promise<BackupTiers> {
  const all = await readAllBackupTiers(base);
  return all[String(serverId)] ?? DEFAULT_BACKUP_TIERS;
}

export async function writeBackupTiers(serverId: number, tiers: BackupTiers, base?: string): Promise<BackupTiers> {
  const all = await readAllBackupTiers(base);
  const normalized = normalizeBackupTiers(tiers);
  if (normalized.enabled) all[String(serverId)] = normalized;
  else delete all[String(serverId)];
  const dir = base ?? appDataDir();
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(backupTiersFile(base), JSON.stringify(all, null, 2), "utf8");
  return normalized;
}
