// Import/adopt an existing server directory: detect which game lives in a
// folder from its executable fingerprints, and validate that the folder is
// safe to adopt (absolute, outside Server Hub's own appdata, not already
// claimed by another server). Pure logic here; the API routes do the I/O.

import fsp from "node:fs/promises";
import path from "node:path";

export type ImportSignature = { gameId: string; markers: string[] };

// Ordered most-specific first: every marker is a relative path (lowercase,
// forward slashes) that the game's dedicated server ships with. These
// mirror the executables launchSpec() looks for, so a detected game is a
// game Server Hub can actually start from that folder.
export const IMPORT_SIGNATURES: ImportSignature[] = [
  { gameId: "palworld", markers: ["palserver.exe", "palserver.sh", "pal/binaries/win64/palserver-win64-shipping-cmd.exe"] },
  { gameId: "satisfactory", markers: ["factoryserver.exe", "factoryserver.sh", "factorygame/binaries/win64/factoryserver-win64-shipping-cmd.exe"] },
  { gameId: "ark", markers: ["shootergame/binaries/win64/shootergameserver.exe", "shootergame/binaries/linux/shootergameserver"] },
  { gameId: "dragonwilds", markers: ["rsdragonwilds.exe", "rsdragonwildsserver.exe", "rsdragonwildsserver.sh"] },
  { gameId: "valheim", markers: ["valheim_server.exe", "valheim_server.x86_64"] },
  { gameId: "rust", markers: ["rustdedicated.exe", "rustdedicated"] },
  { gameId: "terraria", markers: ["terrariaserver.exe", "terrariaserver.bin.x86_64"] },
  { gameId: "minecraft-bedrock", markers: ["bedrock_server.exe", "bedrock_server"] },
  { gameId: "hytale", markers: ["server/hytaleserver.jar"] },
  { gameId: "minecraft", markers: ["server.jar"] },
];

export function normalizeRelPath(rel: string): string {
  return rel.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

export function detectGameFromFiles(relativePaths: string[]): string | null {
  const present = new Set(relativePaths.map(normalizeRelPath));
  for (const signature of IMPORT_SIGNATURES) {
    if (signature.markers.some((marker) => present.has(marker))) return signature.gameId;
  }
  return null;
}

// A directory may be adopted when it is an absolute path that is neither
// inside Server Hub's own appdata (managed directories are already owned
// by the Hub) nor already claimed by another server. Returns an error
// message, or null when the path is acceptable.
export function validateImportPath(directory: string, options: { appData: string; claimed: string[] }): string | null {
  const trimmed = directory.trim();
  if (!trimmed) return "A directory is required";
  if (!path.isAbsolute(trimmed)) return "The directory must be an absolute path";
  const resolved = path.resolve(trimmed);
  const appData = path.resolve(options.appData);
  const within = path.relative(appData, resolved);
  if (within === "" || (!within.startsWith("..") && !path.isAbsolute(within))) {
    return "That folder is managed by Server Hub already — it cannot be imported";
  }
  for (const other of options.claimed) {
    if (other && path.resolve(other) === resolved) return "Another server already uses that directory";
  }
  return null;
}

// Deep enough for Unreal-style layouts (ShooterGame/Binaries/Win64/*.exe).
export const IMPORT_SCAN_DEPTH = 4;
export const IMPORT_SCAN_LIMIT = 4000;

// Bounded, symlink-free walk used to fingerprint the directory: at most
// IMPORT_SCAN_LIMIT entries, IMPORT_SCAN_DEPTH levels deep.
export async function listImportCandidates(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > IMPORT_SCAN_DEPTH || found.length >= IMPORT_SCAN_LIMIT) return;
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (found.length >= IMPORT_SCAN_LIMIT) return;
      if (entry.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile()) found.push(rel);
      else if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel, depth + 1);
    }
  };
  await walk(root, "", 1);
  return found;
}
