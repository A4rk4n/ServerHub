// Backup browser: look inside a backup archive without unpacking it —
// list entries, stream a single file out, and decide what is safe to
// preview inline. Shares the safety posture of inspectBackupArchive:
// absolute paths, dot-dot segments, and links are rejected outright.

import path from "node:path";
import * as tar from "tar";

export const MAX_BROWSER_ENTRIES = 5000;
export const PREVIEW_MAX_BYTES = 256 * 1024;
export const ENTRY_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  ".properties", ".json", ".json5", ".yml", ".yaml", ".toml", ".txt", ".log",
  ".cfg", ".conf", ".ini", ".env", ".sh", ".bat", ".cmd", ".mcmeta", ".csv", ".md", ".xml",
]);

export function isProbablyTextEntry(entryPath: string): boolean {
  return TEXT_EXTENSIONS.has(path.posix.extname(entryPath.toLowerCase()));
}

// Normalizes a user-supplied archive path and rejects anything that
// could escape the extraction root. Returns null when unsafe or empty.
export function sanitizeArchiveEntryPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.replaceAll("\\", "/").trim();
  while (value.startsWith("./")) value = value.slice(2);
  value = value.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (!value || value.length > 1024) return null;
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return null;
  if (value.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) return null;
  return value;
}

export type BackupEntry = { path: string; size: number; type: "file" | "dir"; mtime: number | null };

export async function listBackupEntries(file: string, limit = MAX_BROWSER_ENTRIES): Promise<{ entries: BackupEntry[]; truncated: boolean }> {
  const entries: BackupEntry[] = [];
  let truncated = false;
  await tar.t({
    file,
    gzip: true,
    strict: true,
    onentry: (entry) => {
      const normalized = String(entry.path).replaceAll("\\", "/");
      if (path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) throw new Error(`Unsafe backup path: ${entry.path}`);
      if (entry.type === "SymbolicLink" || entry.type === "Link") throw new Error(`Backup links are not permitted: ${entry.path}`);
      if (entries.length >= limit) {
        truncated = true;
        return;
      }
      entries.push({
        path: normalized.replace(/\/+$/, ""),
        size: Number(entry.size ?? 0),
        type: entry.type === "Directory" ? "dir" : "file",
        mtime: entry.mtime ? new Date(entry.mtime).getTime() : null,
      });
    },
  });
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, truncated };
}

// Streams one entry out of the archive into memory, capped at
// `maxBytes` — the browser preview and single-file download both go
// through here, so an absurdly large member can never balloon memory.
export async function readBackupEntry(file: string, entryPath: string, maxBytes = ENTRY_DOWNLOAD_MAX_BYTES): Promise<Buffer | null> {
  const wanted = sanitizeArchiveEntryPath(entryPath);
  if (!wanted) return null;
  const chunks: Buffer[] = [];
  let found = false;
  let total = 0;
  let overflow = false;
  await tar.t({
    file,
    gzip: true,
    strict: true,
    onentry: (entry) => {
      const normalized = String(entry.path).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
      if (normalized !== wanted || entry.type === "Directory") {
        entry.resume();
        return;
      }
      found = true;
      entry.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          overflow = true;
          return;
        }
        chunks.push(chunk);
      });
    },
  });
  if (overflow) throw new Error(`Entry is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
  if (!found) return null;
  return Buffer.concat(chunks);
}
