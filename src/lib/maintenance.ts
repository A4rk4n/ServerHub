// Maintenance mode: a per-server pause switch for everything automated.
// While flagged, the scheduler skips the server's tasks, the crash watchdog
// stops auto-restarting it, scheduled announcements go quiet, and the
// public status page shows "maintenance" instead of a scary "offline".
// Manual actions (power buttons, console, backups) stay fully available —
// maintenance silences robots, not operators. Stored in an app-data
// sidecar; no schema change.

import fsp from "node:fs/promises";
import path from "node:path";
import { appDataDir } from "./storage";

export type MaintenanceState = {
  enabled: boolean;
  /** Optional operator note ("upgrading mods", "world surgery"). */
  note: string;
  /** ISO timestamp set when maintenance was switched on. */
  since: string | null;
};

export const MAX_MAINTENANCE_NOTE_LENGTH = 200;

export const DEFAULT_MAINTENANCE_STATE: MaintenanceState = { enabled: false, note: "", since: null };

export function normalizeMaintenanceState(raw: unknown): MaintenanceState {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<MaintenanceState>;
  let note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > MAX_MAINTENANCE_NOTE_LENGTH || /[\r\n\x00]/.test(note)) note = "";
  const since = typeof input.since === "string" && !Number.isNaN(Date.parse(input.since)) ? input.since : null;
  return { enabled: input.enabled === true, note, since };
}

// ---- app-data sidecar ------------------------------------------------------

function maintenanceFile(base?: string) {
  return path.join(base ?? appDataDir(), "maintenance.json");
}

export async function readAllMaintenance(base?: string): Promise<Record<string, MaintenanceState>> {
  try {
    const raw = JSON.parse(await fsp.readFile(maintenanceFile(base), "utf8")) as Record<string, unknown>;
    const result: Record<string, MaintenanceState> = {};
    for (const [id, value] of Object.entries(raw)) {
      const state = normalizeMaintenanceState(value);
      if (state.enabled) result[id] = state;
    }
    return result;
  } catch {
    return {};
  }
}

export async function readMaintenance(serverId: number, base?: string): Promise<MaintenanceState> {
  const all = await readAllMaintenance(base);
  return all[String(serverId)] ?? DEFAULT_MAINTENANCE_STATE;
}

export async function writeMaintenance(serverId: number, state: MaintenanceState, base?: string): Promise<MaintenanceState> {
  const all = await readAllMaintenance(base);
  const normalized = normalizeMaintenanceState(state);
  if (normalized.enabled) all[String(serverId)] = normalized;
  else delete all[String(serverId)];
  const dir = base ?? appDataDir();
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(maintenanceFile(base), JSON.stringify(all, null, 2), "utf8");
  return normalized;
}
