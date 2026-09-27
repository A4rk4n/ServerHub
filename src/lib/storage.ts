import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Server } from "@/db/schema";

/** Root for all mutable Server Hub data. Desktop builds set this to Electron's userData folder. */
export function appDataDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.SERVERHUB_APPDATA || path.join(os.homedir(), ".serverhub"));
}

export function managedServersDir(): string {
  return path.join(appDataDir(), "servers");
}

export function managedServerDir(id: number): string {
  return path.join(managedServersDir(), String(id));
}

export function serverDir(server: Pick<Server, "id" | "workingDirectory">): string {
  return server.workingDirectory?.trim()
    ? path.resolve(server.workingDirectory)
    : managedServerDir(server.id);
}

export function backupsDir(id: number): string {
  return path.join(appDataDir(), "backups", String(id));
}

export function toolsDir(): string {
  return path.join(appDataDir(), "tools");
}

export function ensureDataDirs(): void {
  for (const dir of [appDataDir(), managedServersDir(), path.join(appDataDir(), "backups"), toolsDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Resolve a browser-supplied relative path without allowing it to escape root. */
export function safePath(root: string, relative: string): string | null {
  if (!relative || relative.includes("\0") || path.isAbsolute(relative)) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolved === resolvedRoot || resolved.startsWith(prefix) ? resolved : null;
}

export function relativeUnix(root: string, fullPath: string): string {
  return path.relative(root, fullPath).split(path.sep).join("/");
}

export function safeFileName(input: string, fallback = "backup"): string {
  const cleaned = input
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned || fallback;
}
