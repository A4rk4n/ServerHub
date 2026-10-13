// Weekly power windows: "online 4pm–11pm on weekdays". A per-server set of
// day-of-week windows describing when the server SHOULD be running. This is
// the calendar-rule sibling of power-schedule.ts (which plans simple daily
// start/stop task pairs): windows know weekdays, span midnight, and are
// enforced by a runtime sweep that acts only at window EDGES (desired-state
// transitions) — in between, manual power controls always win, so an
// operator who starts a server for a late-night session is never fought by
// the scheduler. Stored in an app-data sidecar; no schema change.

import fsp from "node:fs/promises";
import path from "node:path";
import { appDataDir } from "./storage";

/** Days use JavaScript's Date#getDay numbering: 0 = Sunday … 6 = Saturday. */
export type PowerWindow = { days: number[]; start: string; end: string };
export type PowerWindowSchedule = { enabled: boolean; windows: PowerWindow[] };

export const MAX_POWER_WINDOWS = 4;

export const DEFAULT_WINDOW_SCHEDULE: PowerWindowSchedule = { enabled: false, windows: [] };

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutesOfDay(time: string): number {
  const match = TIME_RE.exec(time);
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Returns an error message, or null when the window is acceptable. */
export function validatePowerWindow(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "Each window must be an object";
  const w = raw as Partial<PowerWindow>;
  if (!Array.isArray(w.days) || w.days.length === 0) return "Each window needs at least one day";
  if (w.days.some((d) => !Number.isInteger(d) || Number(d) < 0 || Number(d) > 6)) return "Days must be 0 (Sunday) through 6 (Saturday)";
  if (new Set(w.days).size !== w.days.length) return "Days must not repeat";
  if (typeof w.start !== "string" || minutesOfDay(w.start) < 0) return "Start time must be HH:MM (24-hour)";
  if (typeof w.end !== "string" || minutesOfDay(w.end) < 0) return "End time must be HH:MM (24-hour)";
  if (w.start === w.end) return "A window cannot start and end at the same minute";
  return null;
}

/** Junk-tolerant: invalid windows are dropped; enabled requires at least one valid window. */
export function normalizeWindowSchedule(raw: unknown): PowerWindowSchedule {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<PowerWindowSchedule>;
  const windows: PowerWindow[] = [];
  if (Array.isArray(input.windows)) {
    for (const candidate of input.windows) {
      if (validatePowerWindow(candidate) !== null) continue;
      const w = candidate as PowerWindow;
      windows.push({ days: [...w.days].sort((a, b) => a - b), start: w.start, end: w.end });
      if (windows.length >= MAX_POWER_WINDOWS) break;
    }
  }
  return { enabled: input.enabled === true && windows.length > 0, windows };
}

/**
 * A window whose end is at or before its start spans midnight: it covers
 * [start, 24:00) on each listed day and [00:00, end) on the FOLLOWING day.
 */
export function isWithinWindows(windows: PowerWindow[], date: Date): boolean {
  const day = date.getDay();
  const minute = date.getHours() * 60 + date.getMinutes();
  const previousDay = (day + 6) % 7;
  for (const w of windows) {
    const start = minutesOfDay(w.start);
    const end = minutesOfDay(w.end);
    if (end > start) {
      if (w.days.includes(day) && minute >= start && minute < end) return true;
    } else {
      // Overnight window: tail on the listed day, head spilling into the next.
      if (w.days.includes(day) && minute >= start) return true;
      if (w.days.includes(previousDay) && minute < end) return true;
    }
  }
  return false;
}

/** null means the schedule expresses no opinion (disabled or empty). */
export function desiredPowerState(schedule: PowerWindowSchedule, date: Date): "online" | "offline" | null {
  if (!schedule.enabled || schedule.windows.length === 0) return null;
  return isWithinWindows(schedule.windows, date) ? "online" : "offline";
}

/** The next instant the desired state flips, scanning up to 8 days ahead. */
export function nextTransitionAt(schedule: PowerWindowSchedule, from: Date): Date | null {
  const current = desiredPowerState(schedule, from);
  if (current === null) return null;
  const boundaries: number[] = [];
  for (let offset = 0; offset <= 8; offset++) {
    const dayStart = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    for (const w of schedule.windows) {
      for (const time of [w.start, w.end]) {
        const minute = minutesOfDay(time);
        const candidate = new Date(dayStart.getTime());
        candidate.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
        if (candidate.getTime() > from.getTime()) boundaries.push(candidate.getTime());
      }
    }
  }
  boundaries.sort((a, b) => a - b);
  for (const at of boundaries) {
    // Overlapping windows can make a boundary a no-op; only real flips count.
    if (desiredPowerState(schedule, new Date(at)) !== current) return new Date(at);
  }
  return null;
}

// ---- app-data sidecar ------------------------------------------------------

function powerWindowsFile(base?: string) {
  return path.join(base ?? appDataDir(), "power-windows.json");
}

export async function readAllWindowSchedules(base?: string): Promise<Record<string, PowerWindowSchedule>> {
  try {
    const raw = JSON.parse(await fsp.readFile(powerWindowsFile(base), "utf8")) as Record<string, unknown>;
    const result: Record<string, PowerWindowSchedule> = {};
    for (const [id, value] of Object.entries(raw)) {
      const schedule = normalizeWindowSchedule(value);
      if (schedule.windows.length > 0) result[id] = schedule;
    }
    return result;
  } catch {
    return {};
  }
}

export async function readWindowSchedule(serverId: number, base?: string): Promise<PowerWindowSchedule> {
  const all = await readAllWindowSchedules(base);
  return all[String(serverId)] ?? DEFAULT_WINDOW_SCHEDULE;
}

export async function writeWindowSchedule(serverId: number, schedule: PowerWindowSchedule, base?: string): Promise<PowerWindowSchedule> {
  const all = await readAllWindowSchedules(base);
  const normalized = normalizeWindowSchedule(schedule);
  if (normalized.windows.length > 0) all[String(serverId)] = normalized;
  else delete all[String(serverId)];
  const dir = base ?? appDataDir();
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(powerWindowsFile(base), JSON.stringify(all, null, 2), "utf8");
  return normalized;
}
