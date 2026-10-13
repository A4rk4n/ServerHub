// Pre-launch checks (preflight). Every start — manual, scheduled, or
// watchdog-driven — is preceded by a sweep of cheap environmental checks so
// the operator sees WHY a launch cannot work before the process even spawns.
// Pure evaluation lives here; the runtime owns the probes (statfs, socket
// binds, process table) and feeds their results in. Blockers stop the start;
// warnings are logged to the server console but never stop anything.
import fsp from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import type os from "node:os";
import path from "node:path";
import { formatMb } from "./disk-alerts";
import { isAssignedLocalAddress } from "./provider-preflight";

export type PreflightSeverity = "ok" | "warning" | "blocker";

export type PreflightCheck = {
  id: string;
  label: string;
  severity: PreflightSeverity;
  detail: string;
};

export type PreflightSummary = {
  checks: PreflightCheck[];
  canStart: boolean;
  blockers: string[];
  warnings: string[];
};

export type FleetNeighbor = { id: number; name: string; port: number; status: string };

/** Statuses under which a neighbor is (or is about to be) holding its port. */
const ACTIVE_STATUSES = new Set(["online", "starting", "stopping"]);

/** Another server configured on the same port: blocker while it is active, warning while it is parked. */
export function evaluateFleetPortConflict(server: { id: number; port: number }, neighbors: FleetNeighbor[]): PreflightCheck {
  const clashes = neighbors.filter((n) => n.id !== server.id && n.port === server.port);
  const active = clashes.find((n) => ACTIVE_STATUSES.has(n.status));
  if (active) {
    return { id: "port-fleet", label: "Fleet port assignment", severity: "blocker", detail: `Port ${server.port} is configured on “${active.name}”, which is currently ${active.status}. Stop it or give one of the servers a different port.` };
  }
  if (clashes.length > 0) {
    return { id: "port-fleet", label: "Fleet port assignment", severity: "warning", detail: `Port ${server.port} is also configured on the stopped server “${clashes[0].name}” — the two can never run at the same time.` };
  }
  return { id: "port-fleet", label: "Fleet port assignment", severity: "ok", detail: `No other server is configured on port ${server.port}.` };
}

/** Live bind probe result: the port must be free on the configured address. */
export function evaluatePortProbe(port: number, protocol: "TCP" | "UDP", address: string, available: boolean | null): PreflightCheck {
  if (available === null) {
    return { id: "port-bind", label: "Port availability", severity: "ok", detail: `Port ${port}/${protocol} was not probed because this server is already running.` };
  }
  if (!available) {
    return { id: "port-bind", label: "Port availability", severity: "blocker", detail: `Port ${port}/${protocol} on ${address} is already in use by another process on this machine.` };
  }
  return { id: "port-bind", label: "Port availability", severity: "ok", detail: `Port ${port}/${protocol} is free on ${address}.` };
}

export type LaunchTargetProbe = { exists: boolean; executable: boolean };

/** Inspect an absolute launch-command path on disk; relative commands resolve via PATH at spawn time and return null. */
export async function probeLaunchTarget(command: string): Promise<LaunchTargetProbe | null> {
  const cmd = command.trim();
  if (!cmd || !path.isAbsolute(cmd)) return null;
  try {
    await fsp.access(cmd, fsConstants.F_OK);
  } catch {
    return { exists: false, executable: false };
  }
  // Windows has no executable bit — X_OK degrades to an existence check
  // there, so an existing target always counts as runnable.
  if (process.platform === "win32") return { exists: true, executable: true };
  try {
    await fsp.access(cmd, fsConstants.X_OK);
    return { exists: true, executable: true };
  } catch {
    return { exists: true, executable: false };
  }
}

/** Manual servers need a command; absolute commands must exist and be executable. */
export function evaluateLaunchTarget(launchCommand: string, required: boolean, probe: LaunchTargetProbe | null): PreflightCheck {
  const cmd = launchCommand.trim();
  if (!cmd) {
    if (required) {
      return { id: "launch-target", label: "Launch command", severity: "blocker", detail: "A launch command is required for a manual server before it can start." };
    }
    return { id: "launch-target", label: "Launch command", severity: "ok", detail: "The installer provides the launch command for this game." };
  }
  if (probe === null) {
    return { id: "launch-target", label: "Launch command", severity: "ok", detail: "The launch command is resolved from PATH when the server starts." };
  }
  if (!probe.exists) {
    return { id: "launch-target", label: "Launch command", severity: "blocker", detail: `The launch target ${cmd} does not exist on disk.` };
  }
  if (!probe.executable) {
    return { id: "launch-target", label: "Launch command", severity: "blocker", detail: `The launch target ${cmd} exists but is not executable.` };
  }
  return { id: "launch-target", label: "Launch command", severity: "ok", detail: `The launch target ${cmd} exists and is executable.` };
}

/** Free panel-volume space below the disk-alert floor is a warning — the start may still succeed. */
export function evaluateDiskFloor(freeMb: number | null, minFreeMb: number): PreflightCheck {
  if (freeMb === null || !Number.isFinite(freeMb)) {
    return { id: "disk-floor", label: "Free disk space", severity: "ok", detail: "Free disk space could not be measured on this volume." };
  }
  if (freeMb < minFreeMb) {
    return { id: "disk-floor", label: "Free disk space", severity: "warning", detail: `Only ${formatMb(freeMb)} free on the panel volume — below the ${formatMb(minFreeMb)} alert floor. Worlds, logs, and backups may fail to write.` };
  }
  return { id: "disk-floor", label: "Free disk space", severity: "ok", detail: `${formatMb(freeMb)} free on the panel volume.` };
}

/** A memory budget above what the OS currently has free is a warning, never a blocker. */
export function evaluateMemoryBudget(memoryMb: number, availableMb: number | null): PreflightCheck {
  if (availableMb === null || !Number.isFinite(availableMb)) {
    return { id: "memory-budget", label: "Memory budget", severity: "ok", detail: "Available system memory could not be measured." };
  }
  if (memoryMb > availableMb) {
    return { id: "memory-budget", label: "Memory budget", severity: "warning", detail: `The server is budgeted ${formatMb(memoryMb)} but only about ${formatMb(availableMb)} of system memory is free right now.` };
  }
  return { id: "memory-budget", label: "Memory budget", severity: "ok", detail: `${formatMb(memoryMb)} budgeted with about ${formatMb(availableMb)} of system memory free.` };
}

/** The bind address must belong to this machine or the socket bind will fail outright. */
export function evaluateBindAddress(address: string, interfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>): PreflightCheck {
  if (!isAssignedLocalAddress(address, interfaces)) {
    return { id: "bind-address", label: "Bind address", severity: "blocker", detail: `The bind address ${address} is not assigned to any network adapter on this machine. Fix it in Settings → Network.` };
  }
  return { id: "bind-address", label: "Bind address", severity: "ok", detail: `${address} is assigned to a local network adapter.` };
}

/** Minecraft refuses to boot without an accepted EULA, so surface it before the crash does. */
export function evaluateEula(gameId: string, eulaAccepted: boolean): PreflightCheck {
  const needsEula = gameId === "minecraft" || gameId === "minecraft-modded";
  if (needsEula && !eulaAccepted) {
    return { id: "eula", label: "Mojang EULA", severity: "blocker", detail: "Mojang’s EULA has not been accepted for this server, so the game would refuse to start. Accept it in Settings." };
  }
  return { id: "eula", label: "Mojang EULA", severity: "ok", detail: needsEula ? "The Mojang EULA is accepted." : "This game does not require a EULA acknowledgement." };
}

/** Collapse the check list into the start decision: any blocker halts the launch. */
export function summarizePreflight(checks: PreflightCheck[]): PreflightSummary {
  const blockers = checks.filter((c) => c.severity === "blocker").map((c) => c.detail);
  const warnings = checks.filter((c) => c.severity === "warning").map((c) => c.detail);
  return { checks, canStart: blockers.length === 0, blockers, warnings };
}
