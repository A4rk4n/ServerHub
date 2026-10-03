// Server export bundle: a portable tar.gz twin of the import/adopt flow.
// The archive contains the server's files plus a manifest at its root
// (game, version, launch settings, per-file aggregate checksum) so another
// Server Hub — or a careful human — can verify and re-adopt it elsewhere.
// Pure logic here; the API route does the I/O.

import { createHash } from "node:crypto";

export const EXPORT_MANIFEST_NAME = "serverhub-export.json";
export const EXPORT_MANIFEST_VERSION = 1;
export const EXPORT_FILE_LIMIT = 20_000;

/** Settings that travel with the bundle. Secrets never do. */
export type ExportSettings = {
  name: string;
  gameId: string;
  version: string;
  loader: string;
  port: number;
  bindAddress: string;
  memoryMb: number;
  maxPlayers: number;
  motd: string;
  worldName: string;
  seed: string;
  difficulty: string;
  pvp: boolean;
  launchCommand: string;
  launchArgs: string;
  autoRestart: boolean;
  maxCrashRestarts: number;
  restartWindowSec: number;
  readinessTimeoutSec: number;
};

export type ExportManifest = {
  manifestVersion: number;
  exportedAt: string;
  exportedBy: string;
  server: ExportSettings;
  files: { count: number; totalBytes: number; checksum: { algorithm: "sha256"; value: string } };
};

const SETTINGS_KEYS: readonly (keyof ExportSettings)[] = [
  "name", "gameId", "version", "loader", "port", "bindAddress", "memoryMb", "maxPlayers",
  "motd", "worldName", "seed", "difficulty", "pvp", "launchCommand", "launchArgs",
  "autoRestart", "maxCrashRestarts", "restartWindowSec", "readinessTimeoutSec",
];

/**
 * Copy exactly the whitelisted settings — a server row carries secrets
 * (serverPassword, adminPassword) that must never enter a bundle, so the
 * manifest is built by inclusion, not exclusion.
 */
export function buildExportManifest(input: {
  server: ExportSettings & Record<string, unknown>;
  appVersion: string;
  files: { count: number; totalBytes: number; checksum: string };
  now?: Date;
}): ExportManifest {
  const settings = Object.fromEntries(SETTINGS_KEYS.map((key) => [key, input.server[key]])) as ExportSettings;
  return {
    manifestVersion: EXPORT_MANIFEST_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    exportedBy: `Server Hub ${input.appVersion}`,
    server: settings,
    files: {
      count: input.files.count,
      totalBytes: input.files.totalBytes,
      checksum: { algorithm: "sha256", value: input.files.checksum },
    },
  };
}

/** Transient files that never belong in a bundle. */
export function shouldExcludeFromExport(relPath: string): boolean {
  const normalized = relPath.replaceAll("\\", "/").replace(/^\.\//, "");
  const base = normalized.split("/").pop() ?? "";
  if (base === EXPORT_MANIFEST_NAME) return true; // regenerated per export
  if (base === "session.lock") return true; // live Minecraft lock
  if (/\.serverhub-\d+\.tmp$/.test(base)) return true; // editor temp files
  return false;
}

/**
 * Order-independent aggregate over per-file digests: sha256 of the sorted
 * "path\nsha256\n" lines. Verifiers recompute file hashes after extraction
 * and compare a single value.
 */
export function aggregateChecksum(entries: Array<{ path: string; sha256: string }>): string {
  const lines = entries
    .map((entry) => ({ path: entry.path.replaceAll("\\", "/"), sha256: entry.sha256.toLowerCase() }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.path}\n${entry.sha256}\n`);
  return createHash("sha256").update(lines.join(""), "utf8").digest("hex");
}

/** Bundle file name: safe slug + timestamp, always .tar.gz. */
export function exportFileName(serverName: string, now: Date = new Date()): string {
  const slug = serverName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "server";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${slug}-export-${stamp}.tar.gz`;
}

export const EXPORT_FILE_PATTERN = /^[a-z0-9][a-z0-9-]*-export-\d{8}-\d{6}\.tar\.gz$/;

/** Validate a parsed manifest (from an extracted bundle). */
export function verifyExportManifest(raw: unknown): { ok: true; manifest: ExportManifest } | { ok: false; problem: string } {
  if (!raw || typeof raw !== "object") return { ok: false, problem: "The manifest is not a JSON object" };
  const candidate = raw as Partial<ExportManifest>;
  if (candidate.manifestVersion !== EXPORT_MANIFEST_VERSION) {
    return { ok: false, problem: `Unsupported manifest version ${String(candidate.manifestVersion)} (expected ${EXPORT_MANIFEST_VERSION})` };
  }
  const server = candidate.server;
  if (!server || typeof server !== "object") return { ok: false, problem: "The manifest has no server section" };
  if (typeof server.name !== "string" || !server.name.trim()) return { ok: false, problem: "The manifest has no server name" };
  if (typeof server.gameId !== "string" || !server.gameId.trim()) return { ok: false, problem: "The manifest has no game id" };
  const files = candidate.files;
  if (!files || typeof files.count !== "number" || files.count < 0) return { ok: false, problem: "The manifest has no file inventory" };
  const checksum = files.checksum;
  if (!checksum || checksum.algorithm !== "sha256" || !/^[0-9a-f]{64}$/.test(checksum.value ?? "")) {
    return { ok: false, problem: "The manifest checksum is missing or malformed" };
  }
  return { ok: true, manifest: candidate as ExportManifest };
}
