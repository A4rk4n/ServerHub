/* Server Hub Windows portable launcher — embedded into node.exe with Node SEA. */
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");
const { randomBytes } = require("node:crypto");

const host = "127.0.0.1";
const requestedPort = Number(process.env.SERVERHUB_PORT || 4321);
const executableDir = path.dirname(process.execPath);
const serverDir = path.join(executableDir, "resources", "server");
const serverEntry = path.join(serverDir, "server.js");
const shellDir = path.join(executableDir, "resources", "native-shell");
const shellEntry = path.join(shellDir, "entry.cjs");
const appDataBase = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const appData = process.env.SERVERHUB_APPDATA || path.join(appDataBase, "ServerHub");
const logFile = path.join(appData, "launcher.log");
const sessionToken = randomBytes(32).toString("base64url");
let nativeApp = null;
let mainWindow = null;
let mainWebview = null;
let shuttingDown = false;

function log(message) {
  try {
    fs.mkdirSync(appData, { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    /* The launcher must still try to start if logging is unavailable. */
  }
}

function psLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function showError(message) {
  log(`FATAL ${message}`);
  const full = `Server Hub could not start.\n\n${message}\n\nDiagnostic log:\n${logFile}`;
  try {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${psLiteral(full)}','Server Hub','OK','Error') | Out-Null`,
      ],
      { detached: true, windowsHide: true, stdio: "ignore" }
    );
    child.unref();
  } catch {
    /* The log remains available when PowerShell is disabled. */
  }
  setTimeout(() => process.exit(1), 250).unref();
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

async function waitForHealth(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "No response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`, { cache: "no-store", headers: { "x-serverhub-session": sessionToken } });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`The local application service did not become ready in time (${lastError}).`);
}

async function openNativeWindow(url) {
  log("Loading native WebView2 shell");
  process.env.NAPI_RS_ENFORCE_VERSION_CHECK = "0";
  const shellRequire = createRequire(shellEntry);
  const { Application } = shellRequire("@webviewjs/webview");
  nativeApp = new Application();
  nativeApp.on("application-close-requested", shutdown);
  await nativeApp.whenReady({ interval: 16, ref: true });
  mainWindow = nativeApp.createBrowserWindow({ title: "Server Hub", width: 1480, height: 940, logical: true, visible: false, resizable: true, maximizable: true, minimizable: true, focused: true, decorations: true });
  mainWindow.setMinSize(900, 640, true);
  mainWindow.center();
  const trustedOrigin = new URL(url).origin;
  mainWebview = mainWindow.createWebview({ url, enableDevtools: false, navigationHandler: (target) => { try { return new URL(target).origin === trustedOrigin; } catch { return false; } }, newWindowHandler: () => false });
  mainWebview.once("page-load-finished", () => { log("Native application window is ready"); mainWindow.show(); mainWindow.focus(); void fetch(`${trustedOrigin}/api/tools`, { method: "POST", headers: { "content-type": "application/json", "x-serverhub-session": sessionToken, "x-serverhub-native-shell": "webview2" }, body: JSON.stringify({ action: "record-native-use", toolId: "webview2" }) }).catch((error) => log(`Could not record WebView2 use: ${error?.message || error}`)); });
  const reveal = setTimeout(() => mainWindow?.show(), 4_000);
  reveal.unref?.();
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("Native application window closed; stopping Server Hub");
  try { nativeApp?.exit(); } catch { /* already disposed */ }
  if (process.listenerCount("serverhub:shutdown") > 0) process.emit("serverhub:shutdown");
  else process.exit(0);
  setTimeout(() => process.exit(0), 2_500);
}

(async () => {
  log(`Native launcher starting with Node ${process.versions.node}`);
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Missing ${serverEntry}. Extract the complete ServerHub folder before running ServerHub.exe.`);
  }

  if (!fs.existsSync(shellEntry)) throw new Error(`Missing native shell resources at ${shellDir}. Extract the complete ServerHub folder.`);
  const port = await selectPort();
  const url = `http://${host}:${port}`;
  fs.mkdirSync(appData, { recursive: true });

  process.env.PORT = String(port);
  process.env.HOSTNAME = host;
  process.env.NODE_ENV = "production";
  process.env.SERVERHUB_APPDATA = appData;
  process.env.SERVERHUB_SESSION_TOKEN = sessionToken;
  process.env.SERVERHUB_DB = process.env.SERVERHUB_DB || path.join(appData, "serverhub.db");
  process.chdir(serverDir);
  process.argv[1] = serverEntry;

  log(`Starting bundled local service at ${url}`);
  const externalRequire = createRequire(serverEntry);
  externalRequire(serverEntry);
  await waitForHealth(url);
  log("Bundled local service is healthy");
  await openNativeWindow(`${url}/?serverhub_token=${encodeURIComponent(sessionToken)}`);
})().catch((error) => showError(error?.stack || String(error)));
