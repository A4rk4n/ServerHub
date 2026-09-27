#!/usr/bin/env node
/**
 * Prepares the Next.js standalone server bundle for packaging.
 *
 * Next emits `.next/standalone` with a minimal server + node_modules, but you
 * must copy `.next/static` and `public/` in yourself. This script does that and
 * verifies the result is runnable.
 */
import { cp, mkdir, rm, stat, writeFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const out = path.join(root, "build", "server");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(path.join(standalone, "server.js")))) {
  console.error("[prepare] .next/standalone/server.js missing — run `next build` first.");
  process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// server bundle
await cp(standalone, out, { recursive: true });
// static assets (Next does not emit these into standalone)
const staticSrc = path.join(root, ".next", "static");
if (await exists(staticSrc)) await cp(staticSrc, path.join(out, ".next", "static"), { recursive: true });
// public assets (game art, icons)
const publicSrc = path.join(root, "public");
if (await exists(publicSrc)) await cp(publicSrc, path.join(out, "public"), { recursive: true });

const du = async (dir) => {
  if (!(await exists(dir))) return 0;
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  let total = 0;
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await du(p);
    else total += (await stat(p)).size;
  }
  return total;
};

const sizeMb = ((await du(out)) / 1024 / 1024).toFixed(1);
console.log(`[prepare] standalone server ready at build/server (${sizeMb} MB)`);

// A tiny launcher the desktop shell (and power users) can call directly.
await writeFile(
  path.join(out, "start.mjs"),
  `// Starts the bundled Server Hub server.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 4321;
const child = spawn(process.execPath, [path.join(here, "server.js")], {
  cwd: here,
  stdio: "inherit",
  env: { ...process.env, PORT: port, HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (c) => process.exit(c ?? 0));
`,
  "utf8"
);
console.log("[prepare] wrote build/server/start.mjs");
