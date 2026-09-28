#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const SERVER_ALLOWLIST = new Set(["server.js", "package.json", ".next", "node_modules", "public", "start.mjs", "build-info.json"]);
const forbiddenSegments = new Set(["build", "data", "src", "release", "world", "worlds", "logs", "fixtures", "preview", "test-data"]);
const forbiddenNames = [/\.db(?:-wal|-shm)?$/i, /\.sqlite(?:3)?(?:-wal|-shm)?$/i, /\.log$/i, /(?:credential|token|secret)(?:s)?(?:\.|$)/i];

async function walk(root) {
  const result = [];
  async function visit(dir) {
    for (const item of await fsp.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, item.name);
      const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
      result.push({ absolute, relative, item });
      if (item.isDirectory()) await visit(absolute);
    }
  }
  await visit(root);
  return result;
}

export async function validateServerBundle(serverRoot) {
  const top = await fsp.readdir(serverRoot);
  const unexpected = top.filter((name) => !SERVER_ALLOWLIST.has(name));
  if (unexpected.length) throw new Error(`Unexpected server bundle entries: ${unexpected.join(", ")}`);
  for (const required of ["server.js", "package.json", ".next", "node_modules", "public", "start.mjs", "build-info.json"]) {
    if (!top.includes(required)) throw new Error(`Server bundle is missing ${required}`);
  }
  const entries = await walk(serverRoot);
  for (const { absolute, relative, item } of entries) {
    const parts = relative.toLowerCase().split("/");
    // Dependencies and compiled Next output legitimately contain directories
    // named src/build/fixtures. Reject build-time material at the bundle root,
    // while still detecting the historical recursive portable-package shape.
    if (forbiddenSegments.has(parts[0]) || relative.toLowerCase().includes("build/windows-portable/serverhub/resources/server")) {
      throw new Error(`Forbidden package path: ${relative}`);
    }
    if (!["node_modules", ".next"].includes(parts[0]) && forbiddenNames.some((pattern) => pattern.test(path.basename(relative)))) {
      throw new Error(`Sensitive/runtime file rejected: ${relative}`);
    }
    if (item.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${relative}`);
    if (item.isFile() && path.basename(relative).toLowerCase() === "serverhub.exe") throw new Error(`Recursive executable rejected: ${relative}`);
    if (item.isFile() && !["node_modules", ".next"].includes(parts[0]) && (await fsp.stat(absolute)).size < 2_000_000) {
      const text = await fsp.readFile(absolute, "utf8").catch(() => "");
      if (/\b(?:[A-Za-z]:\\Users\\[^\\]+\\ServerHub|\/home\/[^/]+\/ServerHub)\b/i.test(text)) throw new Error(`Absolute development path rejected: ${relative}`);
    }
  }
  return entries.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const root = path.resolve(process.argv[2] || "build/windows-portable/ServerHub/resources/server");
  validateServerBundle(root).then((count) => console.log("FINAL_NATIVE_PACKAGE_INTEGRITY_OK", { files: count })).catch((error) => { console.error(error); process.exit(1); });
}
