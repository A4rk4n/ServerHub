/**
 * Server Hub — desktop shell.
 *
 * Spawns the bundled Next.js standalone server as a child process and shows it
 * in a frameless window. Everything (including the SQLite database) is local —
 * no external services, no accounts, no network access required.
 */
const { app, BrowserWindow, shell, dialog, Menu, Tray, nativeImage } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");

const REQUESTED_PORT = Number(process.env.SERVERHUB_PORT || 4321);
const HOST = "127.0.0.1";
let port = REQUESTED_PORT;

function portAvailable(candidate) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(candidate, HOST, () => probe.close(() => resolve(true)));
  });
}

async function choosePort() {
  for (let candidate = REQUESTED_PORT; candidate < REQUESTED_PORT + 50; candidate++) {
    if (await portAvailable(candidate)) return candidate;
  }
  throw new Error(`No available local port between ${REQUESTED_PORT} and ${REQUESTED_PORT + 49}.`);
}

let serverProc = null;
let mainWindow = null;
let tray = null;
let shuttingDown = false;

function log(...args) {
  console.log("[serverhub]", ...args);
}

function resolveServerDir() {
  const candidates = [
    path.join(__dirname, "server"), // packaged: resources/server
    path.join(__dirname, "..", "build", "server"), // dev: build/server
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "server.js"))) return c;
  }
  return null;
}

function startServer() {
  const dir = resolveServerDir();
  if (!dir) {
    dialog.showErrorBox("Server Hub", "Could not find the bundled server (build/server/server.js).");
    app.quit();
    return;
  }

  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: HOST,
    NODE_ENV: "production",
    // Store the database in the user's app data folder so it survives updates.
    SERVERHUB_APPDATA: app.getPath("userData"),
    SERVERHUB_DB: path.join(app.getPath("userData"), "serverhub.db"),
    // The packaged Electron binary also provides the Node runtime used by the
    // standalone Next server. This prevents Electron from launching a second UI.
    ELECTRON_RUN_AS_NODE: "1",
  };

  log("starting server from", dir);
  serverProc = spawn(process.execPath, [path.join(dir, "server.js")], {
    cwd: dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProc.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on("exit", (code) => {
    serverProc = null;
    if (!shuttingDown) {
      dialog.showErrorBox("Server Hub", `The local server stopped unexpectedly (code ${code}).`);
      app.quit();
    }
  });
}

/** Polls /api/health until the server answers, so the window never 404s. */
async function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://${HOST}:${port}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

function desktopIcon() {
  return app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.join(__dirname, "..", "build-resources", "icon.png");
}

function createWindow() {
  const iconFile = desktopIcon();
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: "#fff8fc",
    title: "Server Hub",
    icon: fs.existsSync(iconFile) ? iconFile : undefined,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => (mainWindow = null));

  // External links open in the user's browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith(`http://localhost`)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.loadURL(`http://${HOST}:${port}/`);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ label: app.name, submenu: [{ role: "quit" }] }] : []),
      { label: "File", submenu: [{ label: "Reload", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.reload() }, { type: "separator" }, { role: "quit" }] },
      { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
      {
        label: "Server",
        submenu: [
          { label: "Open data folder", click: () => shell.openPath(app.getPath("userData")) },
          { label: `http://${HOST}:${port}`, click: () => shell.openExternal(`http://${HOST}:${port}`) },
        ],
      },
    ])
  );
}

function createTray() {
  const img = nativeImage.createFromPath(desktopIcon());
  if (img.isEmpty()) return;
  tray = new Tray(img.resize({ width: 16, height: 16 }));
  tray.setToolTip("Server Hub");
  tray.on("click", () => (mainWindow ? mainWindow.show() : createWindow()));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      port = await choosePort();
    } catch (error) {
      dialog.showErrorBox("Server Hub", String(error));
      app.quit();
      return;
    }
    startServer();
    buildMenu();
    createTray();

    const ok = await waitForServer();
    if (!ok) {
      dialog.showErrorBox("Server Hub", "The local server did not start in time. Check the console output for details.");
      app.quit();
      return;
    }
    createWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (!mainWindow) createWindow();
  });

  app.on("before-quit", () => {
    shuttingDown = true;
    if (serverProc) {
      try {
        serverProc.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  });
}
