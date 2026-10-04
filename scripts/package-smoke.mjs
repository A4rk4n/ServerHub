#!/usr/bin/env node
// Packaged-app boot smoke test.
//
// Boots a built Server Hub server bundle (build/server or the bundle
// extracted from the portable ZIP) in-process, waits for /api/health to
// report ok, probes /api/catalog for a non-empty game list, and then
// exercises the exact graceful-shutdown path the native Windows launcher
// uses: process.emit("serverhub:shutdown"). The runtime's shutdown handler
// must bring the process down with exit code 0 on its own; a watchdog fails
// the run if it does not.
//
// Usage: node scripts/package-smoke.mjs [serverRoot]   (default build/server)
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const serverRoot = path.resolve(process.argv[2] ?? "build/server");
const serverJs = path.join(serverRoot, "server.js");
if (!fs.existsSync(serverJs)) {
  console.error(`[smoke] no server bundle at ${serverJs}`);
  process.exit(1);
}

// Ephemeral loopback port so parallel CI jobs and local runs never collide.
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    probe.close(() => resolve(address.port));
  });
});

const appData = fs.mkdtempSync(path.join(os.tmpdir(), "serverhub-smoke-"));
process.env.NODE_ENV = "production";
process.env.HOSTNAME = "127.0.0.1";
process.env.PORT = String(port);
process.env.SERVERHUB_APPDATA = appData;
process.env.SERVERHUB_DB = path.join(appData, "hub.db");
process.chdir(serverRoot);

console.log(`[smoke] booting ${serverJs} on 127.0.0.1:${port} (data: ${appData})`);
await import(pathToFileURL(serverJs).href);

const base = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 120_000;
let healthy = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${base}/api/health`);
    if (response.ok && (await response.json()).ok === true) {
      healthy = true;
      break;
    }
  } catch {
    /* not listening yet */
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (!healthy) {
  console.error("[smoke] /api/health never reported ok within 120s");
  process.exit(1);
}
console.log("[smoke] /api/health ok (runtime initialized, database reachable)");

const catalog = await (await fetch(`${base}/api/catalog`)).json();
if (!Array.isArray(catalog.games) || catalog.games.length === 0) {
  console.error("[smoke] /api/catalog returned no games");
  process.exit(1);
}
console.log(`[smoke] /api/catalog ok (${catalog.games.length} games)`);

// The health probe initialized the runtime, which registered the
// serverhub:shutdown handler — the same event the native launcher emits.
// That handler must exit 0 by itself; the ref'd watchdog fails the run
// (and keeps the event loop alive as a backstop) if it never does.
setTimeout(() => {
  console.error("[smoke] graceful shutdown did not complete within 30s");
  process.exit(1);
}, 30_000);
process.on("exit", (code) => {
  if (code === 0) console.log("PACKAGED_BOOT_SMOKE_OK");
});
console.log("[smoke] emitting serverhub:shutdown");
process.emit("serverhub:shutdown");
