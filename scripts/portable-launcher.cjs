/* Server Hub Windows portable launcher — embedded into node.exe with Node SEA. */
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");

const host = "127.0.0.1";
const requestedPort = Number(process.env.SERVERHUB_PORT || 4321);
const executableDir = path.dirname(process.execPath);
const serverDir = path.join(executableDir, "resources", "server");
const serverEntry = path.join(serverDir, "server.js");

function pauseOnError(message) {
  console.error(`\nServer Hub could not start:\n${message}\n`);
  console.error("Press Enter to close.");
  process.stdin.resume();
  process.stdin.once("data", () => process.exit(1));
}

function available(candidate) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(candidate, host, () => probe.close(() => resolve(true)));
  });
}

async function selectPort() {
  for (let candidate = requestedPort; candidate < requestedPort + 50; candidate++) {
    if (await available(candidate)) return candidate;
  }
  throw new Error(`No available local port between ${requestedPort} and ${requestedPort + 49}.`);
}

function openBrowser(url) {
  const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `start "" "${url}"`], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref();
}

(async () => {
  if (!fs.existsSync(serverEntry)) {
    pauseOnError(`Missing ${serverEntry}. Extract the complete ServerHub folder before running ServerHub.exe.`);
    return;
  }

  const port = await selectPort();
  const appDataBase = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const appData = process.env.SERVERHUB_APPDATA || path.join(appDataBase, "ServerHub");
  fs.mkdirSync(appData, { recursive: true });

  process.env.PORT = String(port);
  process.env.HOSTNAME = host;
  process.env.NODE_ENV = "production";
  process.env.SERVERHUB_APPDATA = appData;
  process.env.SERVERHUB_DB = process.env.SERVERHUB_DB || path.join(appData, "serverhub.db");
  process.chdir(serverDir);
  process.argv[1] = serverEntry;

  console.log("============================================================");
  console.log(" Server Hub — real local game-server manager");
  console.log("============================================================");
  console.log(` Panel: http://${host}:${port}`);
  console.log(` Data:  ${appData}`);
  console.log(" Keep this window open. Press Ctrl+C to shut down Server Hub.");
  console.log("============================================================\n");

  const externalRequire = createRequire(serverEntry);
  externalRequire(serverEntry);
  setTimeout(() => openBrowser(`http://${host}:${port}`), 1_200);
})().catch((error) => pauseOnError(error?.stack || String(error)));
