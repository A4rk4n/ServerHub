#!/usr/bin/env node
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import dgram from "node:dgram";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const serverEntry = path.join(root, "build", "server", "server.js");
const data = path.join(root, "build", "installation-job-integration");
const dbPath = path.join(data, "serverhub.db");
let service = null;
let logs = "";

async function freeTcpPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
    server.once("error", reject);
  });
}

async function udpPort(block = false) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", reject);
    socket.bind(0, "0.0.0.0", () => {
      const address = socket.address();
      if (block) resolve({ port: address.port, socket });
      else socket.close(() => resolve({ port: address.port, socket: null }));
    });
  });
}

async function startService(port) {
  logs = "";
  const child = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      SERVERHUB_APPDATA: data,
      SERVERHUB_DB: dbPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  service = child;
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Service exited during startup (${child.exitCode}).\n${logs}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return base;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Service did not become healthy.\n${logs}`);
}

async function stopService(force = false) {
  const child = service;
  service = null;
  if (!child || child.exitCode !== null) return;
  child.kill(force ? "SIGKILL" : "SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 4_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function json(base, pathname, init) {
  const response = await fetch(`${base}${pathname}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${pathname}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function createCustom(base, port, name, launch = {}) {
  const body = await json(base, "/api/servers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameId: "custom",
      name,
      version: "manual",
      port,
      memoryMb: 1024,
      maxPlayers: 4,
      worldName: "integration",
      launchCommand: launch.command ?? (process.platform === "win32" ? "cmd.exe" : "/bin/true"),
      launchArgs: launch.args ?? (process.platform === "win32" ? "/d /c exit 0" : ""),
    }),
  });
  return body.server.id;
}

async function waitForJob(base, serverId, expected, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let body;
  while (Date.now() < deadline) {
    body = await json(base, `/api/servers/${serverId}/installation`);
    if (body.job?.status === expected) return body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Job for server ${serverId} did not reach ${expected}: ${JSON.stringify(body)}`);
}

function openDb() {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

async function main() {
  await fs.access(serverEntry).catch(() => {
    throw new Error("build/server/server.js is missing. Run npm run build:server first.");
  });
  await fs.rm(data, { recursive: true, force: true });
  await fs.mkdir(data, { recursive: true });
  const servicePort = await freeTcpPort();
  let base = await startService(servicePort);

  const firstPort = (await udpPort()).port;
  const firstId = await createCustom(base, firstPort, "Durable installation smoke test");
  const completed = await waitForJob(base, firstId, "succeeded");
  if (completed.job.progress !== 100 || !completed.events.some((event) => event.phase === "preflight") || !completed.events.some((event) => event.phase === "completed")) {
    throw new Error(`Completed job did not retain structured progress: ${JSON.stringify(completed)}`);
  }

  const preservedFile = path.join(data, "servers", String(firstId), "world-preservation.fixture");
  await fs.writeFile(preservedFile, "world data must survive staged updates", "utf8");
  await json(base, `/api/servers/${firstId}/power`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "install" }),
  });
  const updated = await waitForJob(base, firstId, "succeeded");
  if (updated.job.kind !== "update" || await fs.readFile(preservedFile, "utf8") !== "world data must survive staged updates") {
    throw new Error("Staged update did not preserve files from the active installation.");
  }

  const crashCounter = path.join(data, "watchdog-counter.txt");
  const crashScript = path.join(data, "crash-fixture.mjs");
  await fs.writeFile(crashScript, `import fs from "node:fs";\nconst file=${JSON.stringify(crashCounter)};\nconst count=Number(fs.existsSync(file)?fs.readFileSync(file,"utf8"):0)+1;\nfs.writeFileSync(file,String(count));\nprocess.exit(17);\n`, "utf8");
  const crashPort = (await udpPort()).port;
  const crashId = await createCustom(base, crashPort, "Watchdog smoke test", { command: process.execPath, args: crashScript });
  await waitForJob(base, crashId, "succeeded");
  await json(base, `/api/servers/${crashId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoRestart: true, maxCrashRestarts: 2, restartWindowSec: 30 }),
  });
  await json(base, `/api/servers/${crashId}/power`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start" }),
  });
  const watchdogDeadline = Date.now() + 12_000;
  let crashCount = 0;
  while (Date.now() < watchdogDeadline) {
    crashCount = Number(await fs.readFile(crashCounter, "utf8").catch(() => "0"));
    if (crashCount >= 3) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (crashCount !== 3) throw new Error(`Watchdog expected three process launches, observed ${crashCount}.`);
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  const afterLimit = Number(await fs.readFile(crashCounter, "utf8"));
  const crashServer = await json(base, `/api/servers/${crashId}`);
  const crashConsole = await json(base, `/api/servers/${crashId}/console?after=0`);
  if (afterLimit !== 3 || crashServer.server.status !== "crashed" || !crashConsole.logs.some((line) => line.message.includes("restart limit reached"))) {
    throw new Error(`Watchdog did not stop the crash loop: count=${afterLimit}, status=${crashServer.server.status}`);
  }

  await fs.writeFile(crashCounter, "0", "utf8");
  const cancelPort = (await udpPort()).port;
  const cancelId = await createCustom(base, cancelPort, "Watchdog cancellation test", { command: process.execPath, args: crashScript });
  await waitForJob(base, cancelId, "succeeded");
  await json(base, `/api/servers/${cancelId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoRestart: true, maxCrashRestarts: 5, restartWindowSec: 30 }),
  });
  await json(base, `/api/servers/${cancelId}/power`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start" }),
  });
  const restartQueuedDeadline = Date.now() + 3_000;
  let queuedStatus = "";
  while (Date.now() < restartQueuedDeadline) {
    queuedStatus = (await json(base, `/api/servers/${cancelId}`)).server.status;
    if (queuedStatus === "restarting") break;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  if (queuedStatus !== "restarting") throw new Error(`Expected a queued watchdog restart, got ${queuedStatus}.`);
  await json(base, `/api/servers/${cancelId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoRestart: false }),
  });
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  const cancelledLaunches = Number(await fs.readFile(crashCounter, "utf8"));
  const cancelledServer = await json(base, `/api/servers/${cancelId}`);
  if (cancelledLaunches !== 1 || cancelledServer.server.status !== "offline") {
    throw new Error(`Disabling watchdog did not cancel the queued restart: count=${cancelledLaunches}, status=${cancelledServer.server.status}`);
  }

  const blocker = await udpPort(true);
  const retryId = await createCustom(base, blocker.port, "Retry installation smoke test");
  const failed = await waitForJob(base, retryId, "failed");
  if (!failed.job.error.includes("currently in use")) throw new Error(`Port preflight did not report the conflict: ${failed.job.error}`);
  await new Promise((resolve) => blocker.socket.close(resolve));
  await json(base, `/api/servers/${retryId}/installation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "retry" }),
  });
  const retried = await waitForJob(base, retryId, "succeeded");
  if (retried.job.id !== failed.job.id || retried.job.attempt !== 2) throw new Error("Retry did not reuse the recoverable job and increment its attempt.");

  const db = openDb();
  const now = Math.floor(Date.now() / 1000);
  const inserted = db.prepare(`
    INSERT INTO installation_jobs (
      server_id, kind, status, phase, progress, bytes_done, bytes_total,
      message, error, attempt, cancel_requested, created_at, updated_at
    ) VALUES (?, 'install', 'queued', 'queued', 0, 0, 0, 'Waiting', '', 1, 0, ?, ?)
  `).run(retryId, now, now);
  const recoveryJobId = Number(inserted.lastInsertRowid);
  db.prepare("UPDATE servers SET status = 'installing', updated_at = ? WHERE id = ?").run(now, retryId);
  await json(base, `/api/servers/${retryId}/installation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "cancel" }),
  });
  const cancelled = await waitForJob(base, retryId, "cancelled");
  if (cancelled.job.id !== recoveryJobId) throw new Error("Queued cancellation targeted the wrong job.");

  db.prepare(`
    UPDATE installation_jobs
    SET status = 'running', phase = 'installing', progress = 42,
        message = 'Interrupted fixture', cancel_requested = 0,
        updated_at = ?, completed_at = NULL
    WHERE id = ?
  `).run(now, recoveryJobId);
  db.prepare("UPDATE servers SET status = 'installing', updated_at = ? WHERE id = ?").run(now, retryId);
  db.close();

  await stopService(true);
  base = await startService(servicePort);
  const recovered = await waitForJob(base, retryId, "succeeded");
  if (recovered.job.id !== recoveryJobId || recovered.job.attempt !== 2) throw new Error("Interrupted job was not recovered in place.");
  if (!recovered.events.some((event) => event.message.includes("restarted"))) throw new Error("Recovery event was not retained in job history.");

  console.log("INSTALLATION_JOB_INTEGRATION_OK", {
    watchdogLaunches: crashCount,
    cancelledWatchdogLaunches: cancelledLaunches,
    completedJob: completed.job.id,
    retryJob: retried.job.id,
    recoveredJob: recovered.job.id,
  });
}

try {
  await main();
} finally {
  await stopService();
}
