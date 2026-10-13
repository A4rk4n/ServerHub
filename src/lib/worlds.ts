// World manager: list the world folders that actually exist in a
// Minecraft server's directory, switch the active one, and clean up
// old ones. A "world" is a top-level directory containing level.dat.
// Pure rules here; the route owns the filesystem walk.

export type WorldInfo = {
  name: string;
  sizeBytes: number;
  lastModified: number;
  active: boolean;
};

/** Java-edition layouts only: world folders live at the server root. */
export function isWorldCapable(gameId: string): boolean {
  return gameId === "minecraft" || gameId === "minecraft-modded";
}

/** Directory names that can never be worlds — skip without stat-ing. */
const NEVER_WORLDS = new Set([
  "mods", "config", "logs", "libraries", "versions", "crash-reports",
  "resourcepacks", "datapacks", "plugins", ".fabric",
]);

export function couldBeWorldDir(name: string): boolean {
  if (!name || name.startsWith(".")) return false;
  if (NEVER_WORLDS.has(name)) return false;
  // Anything a path separator could smuggle in is out.
  return !/[\\/]/.test(name);
}

/** Error message, or null when the world may be deleted. */
export function canDeleteWorld(name: string, activeWorld: string, serverStatus: string): string | null {
  if (name === activeWorld) return "This is the active world — switch to another world first.";
  if (serverStatus === "online" || serverStatus === "starting" || serverStatus === "restarting" || serverStatus === "stopping") {
    return "Stop the server before deleting worlds.";
  }
  return null;
}

/** Error message, or null when the switch makes sense. */
export function canActivateWorld(name: string, activeWorld: string): string | null {
  if (!couldBeWorldDir(name)) return "Not a valid world folder name.";
  if (name === activeWorld) return "This world is already active.";
  if (name.length > 40) return "World names are capped at 40 characters.";
  return null;
}
