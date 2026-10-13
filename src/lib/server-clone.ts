// Server cloning. The route stays thin: name/port resolution, the
// copy-eligibility rule, and the exclusion contracts live here where they
// are unit-testable. Two flavors: a config-only clone (safe anytime, fresh
// world, forces a reinstall) and a full clone that also copies the server
// directory — worlds, configs, mods — which requires the source to be
// stopped so the copy cannot race the game's own writes.

export type PortChoice = { ok: true; port: number } | { ok: false; status: number; error: string };

/** Explicit ports are validated and collision-checked; otherwise scan upward from the source's port. */
export function pickClonePort(sourcePort: number, usedPorts: number[], requested?: unknown): PortChoice {
  if (requested !== undefined && requested !== null) {
    const port = typeof requested === "number" && Number.isInteger(requested) ? requested : Number.NaN;
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      return { ok: false, status: 400, error: "Port must be an integer between 1024 and 65535" };
    }
    if (usedPorts.includes(port)) return { ok: false, status: 409, error: `Port ${port} is already configured on another server` };
    return { ok: true, port };
  }
  const used = new Set(usedPorts);
  for (let port = sourcePort + 1; port <= 65535; port += 1) if (!used.has(port)) return { ok: true, port };
  return { ok: false, status: 409, error: "No free adjacent port is available" };
}

export type NameChoice = { ok: true; name: string } | { ok: false; error: string };

/** Omitted name defaults to "<source> Copy"; an explicitly blank one is an error, not a silent default. */
export function resolveCloneName(requested: unknown, sourceName: string): NameChoice {
  if (requested === undefined || requested === null) return { ok: true, name: `${sourceName} Copy`.slice(0, 60) };
  if (typeof requested !== "string" || !requested.trim()) return { ok: false, error: "Clone name is required" };
  return { ok: true, name: requested.trim().slice(0, 60) };
}

/** Never cloned, with or without files: secrets and operational history belong to the source. */
export const CLONE_EXCLUDED = ["credentials", "backups", "players", "logs", "tasks", "schedules"] as const;
/** Additionally excluded from a config-only clone (a file copy brings these along). */
export const CONFIG_ONLY_EXCLUDED = ["world data", "mods", "server files"] as const;

/** File copies only run against a server that cannot be writing: stopped, crashed, or failed. */
export function canCopyFiles(sourceStatus: string): boolean {
  return ["offline", "crashed", "error"].includes(sourceStatus);
}

/**
 * A config-only clone gets a fresh world name so the game generates a new
 * world; a file clone keeps the original name so the copied world directory
 * is the one the server actually loads.
 */
export function cloneWorldName(sourceWorldName: string, copyFiles: boolean): string {
  return copyFiles ? sourceWorldName : `${sourceWorldName}-clone`.slice(0, 80);
}
