import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Server } from "@/db/schema";
import { MAX_SAFETY_COPIES, SAFETY_COPY_PATTERN, isSafetyCopy, safetyCopyName } from "./config-editor";
import { relativeUnix, safePath, serverDir } from "./storage";

export type FsNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  editable?: boolean;
  children?: FsNode[];
};

const EDITABLE_EXT = new Set([
  "txt", "json", "json5", "properties", "cfg", "ini", "sh", "bat", "cmd", "log",
  "yml", "yaml", "md", "conf", "toml", "xml", "csv", "env", "cfg", "cs",
]);
const EDIT_LIMIT = 1_000_000;
const TREE_LIMIT = 4_000;
const MAX_DEPTH = 8;

export function isEditable(filePath: string): boolean {
  let name = path.basename(filePath).toLowerCase();
  // Safety copies made by the config editor stay readable/restorable.
  if (isSafetyCopy(name)) name = name.replace(SAFETY_COPY_PATTERN, "");
  if (["eula.txt", "whitelist.json", "ops.json", "banned-players.json"].includes(name)) return true;
  return EDITABLE_EXT.has(name.split(".").pop() || "");
}

function inside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

export async function buildTree(server: Server): Promise<FsNode[]> {
  const root = serverDir(server);
  await fsp.mkdir(root, { recursive: true });
  let count = 0;

  async function walk(directory: string, depth: number): Promise<FsNode[]> {
    if (depth > MAX_DEPTH || count >= TREE_LIMIT) return [];
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const output: FsNode[] = [];
    for (const entry of entries) {
      if (count++ >= TREE_LIMIT) break;
      const full = path.join(directory, entry.name);
      const relative = relativeUnix(root, full);
      if (!inside(root, full)) continue;
      if (entry.isSymbolicLink()) {
        output.push({ name: entry.name, path: relative, type: "file", size: 0, editable: false });
      } else if (entry.isDirectory()) {
        output.push({ name: entry.name, path: relative, type: "dir", children: await walk(full, depth + 1) });
      } else if (entry.isFile()) {
        const stat = await fsp.stat(full).catch(() => null);
        const size = stat?.size ?? 0;
        output.push({
          name: entry.name,
          path: relative,
          type: "file",
          size: Math.max(1, Math.ceil(size / 1024)),
          editable: size <= EDIT_LIMIT && isEditable(relative),
        });
      }
    }
    return output;
  }

  return walk(root, 0);
}

export async function readServerFile(server: Server, relative: string) {
  const root = serverDir(server);
  const full = safePath(root, relative);
  if (!full) throw new Error("Invalid file path");
  const stat = await fsp.lstat(full);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Not a regular file");
  const realRoot = await fsp.realpath(root);
  const realFile = await fsp.realpath(full);
  if (!inside(realRoot, realFile)) throw new Error("File is outside the server directory");
  const editable = isEditable(relative) && stat.size <= EDIT_LIMIT;
  if (!editable) return { content: `(binary or read-only file, ${(stat.size / 1024).toFixed(1)} KB)`, editable: false };
  return { content: await fsp.readFile(realFile, "utf8"), editable: true };
}

export async function writeServerFile(server: Server, relative: string, content: string) {
  if (!isEditable(relative)) throw new Error("This file type is not editable");
  if (Buffer.byteLength(content, "utf8") > EDIT_LIMIT) throw new Error("File is larger than the 1 MB editor limit");
  const root = serverDir(server);
  const full = safePath(root, relative);
  if (!full) throw new Error("Invalid file path");
  const existing = await fsp.lstat(full).catch(() => null);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error("Only regular files can be edited");
  const parent = path.dirname(full);
  const realRoot = await fsp.realpath(root);
  const realParent = await fsp.realpath(parent);
  if (!inside(realRoot, realParent)) throw new Error("File is outside the server directory");
  // Safety copy: preserve the previous contents next to the file before
  // overwriting, and keep only the newest MAX_SAFETY_COPIES copies.
  let safetyCopy: string | null = null;
  if (existing?.isFile() && !isSafetyCopy(full)) {
    const previous = await fsp.readFile(full, "utf8").catch(() => null);
    if (previous !== null && previous !== content) {
      const copyPath = safetyCopyName(full);
      await fsp.copyFile(full, copyPath);
      safetyCopy = relativeUnix(root, copyPath);
      const base = path.basename(full);
      const siblings = (await fsp.readdir(parent).catch(() => []))
        .filter((name) => name.startsWith(`${base}.bak-`) && isSafetyCopy(name))
        .sort()
        .reverse();
      for (const stale of siblings.slice(MAX_SAFETY_COPIES)) {
        await fsp.unlink(path.join(parent, stale)).catch(() => {});
      }
    }
  }
  const temp = `${full}.serverhub-${process.pid}.tmp`;
  await fsp.writeFile(temp, content, "utf8");
  await fsp.rename(temp, full);
  return { safetyCopy };
}
